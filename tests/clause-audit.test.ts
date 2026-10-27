// Offline checks for the dossier clause audit (src/services/clauseAudit.ts and
// src/components/ClauseAuditPanel.tsx). The clause audit controller runs the real
// LeaseAuditPrompt, legal retrieval, and Nebius transport against a fake provider: the global
// fetch is replaced before any app module loads, answers only for the fake .invalid base URL,
// and throws for anything else, so no real network call can happen. The API key is a placeholder.
// The app modules need Vite's transform (extensionless imports, import.meta.env, TSX), so they
// load through an in-process Vite SSR loader that reads no .env file.
// These checks cover state handling, request wiring, and rendering. The duplicate-finding and
// whitespace-only-quote checks call LeaseAuditPrompt itself with scripted provider replies. The
// text-folding checks call the public functions of src/utils/legalRetriever.ts directly. They
// do not establish that any legal conclusion is correct.
// Run: node --experimental-strip-types --test tests/clause-audit.test.ts
import { after, before, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import type { AuditFinding, Listing, ReAuditResult } from '../src/types/index.ts';
import type { ClauseAuditController, ClauseAuditState } from '../src/services/clauseAudit.ts';

const FAKE_BASE_URL = 'https://nebius.invalid/v1';
const FAKE_MODEL = 'test/offline-model';
const ENDPOINT = `${FAKE_BASE_URL}/chat/completions`;
const DEPOSIT_CLAUSE = 'Tenant must pay a $3,000 cash security deposit on the day of signing.';
const OTHER_CLAUSE = 'Late rent costs $200 for each day it is overdue.';

// Placeholders for the app's build-time settings, set before the modules load. Vite reads them
// from the process environment because the loader below is told to read no .env file.
process.env.VITE_NEBIUS_API_KEY = 'offline-test-placeholder-not-a-key';
process.env.VITE_NEBIUS_BASE_URL = FAKE_BASE_URL;
process.env.VITE_NEBIUS_REASONING_MODEL = FAKE_MODEL;

const NO_NETWORK = (() => {
  throw new Error('real network access is disabled in clause-audit tests');
}) as typeof fetch;
globalThis.fetch = NO_NETWORK;

for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  mock.method(console, method, () => {});
}

// ---------------------------------------------------------------------------------------------
// Fake provider

interface ProviderCall {
  url: string;
  model: string;
  temperature: number;
  system: string;
  user: string;
}

type ProviderHandler = (call: ProviderCall) => Response | Promise<Response>;

let providerCalls: ProviderCall[] = [];
let providerHandler: ProviderHandler = () => {
  throw new Error('no provider reply scripted');
};

globalThis.fetch = ((input: unknown, init?: { body?: string }) => {
  const url = String(input);
  if (url !== ENDPOINT) throw new Error(`blocked request to ${url}`);
  const body = JSON.parse(init?.body ?? '{}') as {
    model: string;
    temperature: number;
    messages: { role: string; content: string }[];
  };
  const call: ProviderCall = {
    url,
    model: body.model,
    temperature: body.temperature,
    system: body.messages.find((m) => m.role === 'system')?.content ?? '',
    user: body.messages.find((m) => m.role === 'user')?.content ?? '',
  };
  providerCalls.push(call);
  return Promise.resolve().then(() => providerHandler(call));
}) as typeof fetch;

const completion = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

interface ScriptedFinding {
  clauseText: string;
  category?: string;
  severity?: 'info' | 'warning' | 'illegal';
  issue?: string;
  legalReference?: string;
  suggestedRevision?: string;
}

/** What a scripted finding says unless a test overrides it. modelReply and finding() both start here. */
const FINDING_DEFAULTS: Required<Omit<ScriptedFinding, 'clauseText'>> = {
  category: 'security_deposit',
  severity: 'illegal',
  issue: 'Exceeds the cap in the retrieved provision.',
  legalReference: 'US_NYC.securityDeposit',
  suggestedRevision: 'Tenant pays a security deposit of no more than one month of rent.',
};

function modelReply(summary: string, findings: ScriptedFinding[]) {
  return JSON.stringify({
    language: 'English',
    summary,
    findings: findings.map((f) => ({ ...FINDING_DEFAULTS, ...f })),
  });
}

/** Provider calls that the test finishes by hand, so replies can arrive in any order. */
function heldProvider() {
  const resolvers: ((response: Response) => void)[] = [];
  const answered = new Set<number>();
  providerHandler = () => new Promise<Response>((resolve) => resolvers.push(resolve));
  const reply = (index: number, response: Response) => {
    assert.ok(resolvers[index], `provider call ${index} has not been made`);
    answered.add(index);
    resolvers[index](response);
  };
  return {
    reply,
    replyOldest: (response: Response) => {
      const index = resolvers.findIndex((_, i) => !answered.has(i));
      assert.notEqual(index, -1, 'no unanswered provider call');
      reply(index, response);
    },
  };
}

/** Waits for an asynchronous condition without relying on a fixed number of ticks. */
async function until(condition: () => boolean) {
  for (let tick = 0; tick < 1000 && !condition(); tick++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(condition(), 'condition was not reached');
}

// ---------------------------------------------------------------------------------------------
// Module loading and fixtures

type ClauseAuditModule = typeof import('../src/services/clauseAudit.ts');
type LeaseAuditModule = typeof import('../src/prompts/leaseAuditPrompt.ts');
type RetrieverModule = typeof import('../src/utils/legalRetriever.ts');
type PanelModule = typeof import('../src/components/ClauseAuditPanel.tsx');
type ModalModule = typeof import('../src/components/ListingModal.tsx');

let server: ViteDevServer;
let clauseAudit: ClauseAuditModule;
let leaseAudit: LeaseAuditModule;
let retriever: RetrieverModule;
let panel: PanelModule;
let modal: ModalModule;
let nycListing: Listing;
let londonListing: Listing;

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    configFile: false,
    envDir: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true },
  });
  clauseAudit = (await server.ssrLoadModule('/src/services/clauseAudit.ts')) as ClauseAuditModule;
  leaseAudit = (await server.ssrLoadModule('/src/prompts/leaseAuditPrompt.ts')) as LeaseAuditModule;
  retriever = (await server.ssrLoadModule('/src/utils/legalRetriever.ts')) as RetrieverModule;
  panel = (await server.ssrLoadModule('/src/components/ClauseAuditPanel.tsx')) as PanelModule;
  modal = (await server.ssrLoadModule('/src/components/ListingModal.tsx')) as ModalModule;
  const { MOCK_LISTINGS } = (await server.ssrLoadModule('/src/data/mockListings.ts')) as {
    MOCK_LISTINGS: Listing[];
  };
  const byCity = (cityName: string) => {
    const found = MOCK_LISTINGS.find((l) => l.cityName === cityName);
    assert.ok(found, `fixture listing for ${cityName}`);
    return found;
  };
  nycListing = byCity('New York City');
  londonListing = byCity('London');
});

after(async () => {
  mock.restoreAll();
  await server.close();
});

beforeEach(() => {
  providerCalls = [];
  providerHandler = () => {
    throw new Error('no provider reply scripted');
  };
});

function controllerFor(listing: Listing): ClauseAuditController {
  return clauseAudit.createClauseAuditController(listing);
}

function renderPanel(state: ClauseAuditState, cityName = 'New York City') {
  return renderToStaticMarkup(
    createElement(panel.ClauseAuditPanel, { cityName, state, onClauseChange: () => {}, onSubmit: () => {} }),
  );
}

function resultWith(overrides: Partial<ReAuditResult>): ReAuditResult {
  return {
    isValid: true,
    language: 'English',
    summary: 'Summary text.',
    findings: [],
    legalSources: [],
    disclaimer: 'Informational only.',
    analyzedByModel: 'test-model',
    ...overrides,
  };
}

const successState = (result: ReAuditResult): ClauseAuditState => ({
  clause: 'clause',
  status: 'success',
  result,
  error: null,
});

// ---------------------------------------------------------------------------------------------
// Wiring to the real auditor

test('a nonblank clause reaches the real LeaseAuditPrompt with the selected listing and the typed text', async () => {
  providerHandler = () =>
    completion(modelReply('The deposit is above the cap.', [{ clauseText: '$3,000 cash security deposit' }]));
  const before = JSON.stringify(nycListing.nemotronAudit);
  const controller = controllerFor(nycListing);

  controller.setClause(DEPOSIT_CLAUSE);
  const done = controller.submit();
  assert.equal(controller.getState().status, 'loading');
  await done;

  assert.equal(providerCalls.length, 1);
  const [call] = providerCalls;
  assert.equal(call.model, FAKE_MODEL);
  assert.equal(call.user, DEPOSIT_CLAUSE);
  assert.match(call.system, /TARGET JURISDICTION: New York City/);
  assert.match(call.system, new RegExp(`Monthly rent: ${nycListing.priceLocal} ${nycListing.currency}`));
  assert.match(call.system, /\[US_NYC\.securityDeposit\]/);

  const state = controller.getState();
  assert.equal(state.status, 'success');
  assert.equal(state.error, null);
  const result = state.result;
  assert.ok(result);
  assert.equal(result.isValid, false);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].severity, 'illegal');
  assert.equal(result.findings[0].legalReference, 'US_NYC.securityDeposit');
  assert.equal(result.findings[0].quoteVerified, true);
  assert.ok(result.legalSources.some((s) => s.id === 'US_NYC.securityDeposit' && s.title === 'Security deposit rules'));
  assert.ok(result.analyzedByModel.includes(FAKE_MODEL));
  assert.ok(result.disclaimer.trim());
  // The generic assessment is untouched and is not replaced by the clause result.
  assert.equal(JSON.stringify(nycListing.nemotronAudit), before);
});

test('the listing jurisdiction decides which legal rules are retrieved', async () => {
  providerHandler = () => completion(modelReply('Nothing to report.', []));
  const controller = controllerFor(londonListing);
  controller.setClause(DEPOSIT_CLAUSE);
  await controller.submit();
  assert.equal(providerCalls.length, 1);
  assert.match(providerCalls[0].system, /TARGET JURISDICTION: London/);
  assert.match(providerCalls[0].system, /\[UK_LON\./);
  assert.doesNotMatch(providerCalls[0].system, /US_NYC/);
});

// ---------------------------------------------------------------------------------------------
// Input protection and duplicate submissions

test('blank and whitespace-only text never starts a request', async () => {
  const controller = controllerFor(nycListing);
  await controller.submit();
  controller.setClause('   \n\t ');
  await controller.submit();
  assert.equal(providerCalls.length, 0);
  assert.equal(controller.getState().status, 'idle');
  assert.match(renderPanel(controller.getState()), /<button[^>]*disabled=""/);
});

test('a second submit while a request is running makes no second request', async () => {
  const provider = heldProvider();
  const controller = controllerFor(nycListing);
  controller.setClause(DEPOSIT_CLAUSE);
  const first = controller.submit();
  const second = controller.submit();
  await until(() => providerCalls.length === 1);

  provider.reply(0, completion(modelReply('Done.', [])));
  await Promise.all([first, second]);
  assert.equal(controller.getState().status, 'success');
  assert.equal(providerCalls.length, 1);
});

test('the button shows the running state without losing focus', async () => {
  const idle = renderPanel({ clause: 'x', status: 'idle', result: null, error: null });
  assert.match(idle, /RE-AUDIT CLAUSE WITH NEMOTRON/);
  const loading = renderPanel({ clause: 'x', status: 'loading', result: null, error: null });
  assert.match(loading, /AUDITING VIA NEBIUS\.\.\./);
  assert.match(loading, /<button[^>]*aria-disabled="true"/);
  assert.doesNotMatch(loading, /<button[^>]*\sdisabled=""/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /Checking your clause against New York City rules/);
});

// ---------------------------------------------------------------------------------------------
// Outdated and late results

test('editing the text clears the previous result and error and drops the running request', async () => {
  const provider = heldProvider();
  const controller = controllerFor(nycListing);
  controller.setClause(DEPOSIT_CLAUSE);
  const stale = controller.submit();
  await until(() => providerCalls.length === 1);

  controller.setClause(OTHER_CLAUSE);
  assert.equal(controller.getState().status, 'idle');
  assert.equal(controller.getState().clause, OTHER_CLAUSE);

  provider.reply(0, completion(modelReply('Stale answer.', [{ clauseText: '$3,000 cash security deposit' }])));
  await stale;
  const state = controller.getState();
  assert.equal(state.status, 'idle');
  assert.equal(state.result, null);
  assert.equal(state.error, null);
  assert.equal(state.clause, OTHER_CLAUSE);
});

test('a late reply for earlier text never replaces the reply for the current text', async () => {
  const provider = heldProvider();
  const controller = controllerFor(nycListing);
  controller.setClause(DEPOSIT_CLAUSE);
  const first = controller.submit();
  await until(() => providerCalls.length === 1);
  controller.setClause(OTHER_CLAUSE);
  const second = controller.submit();
  await until(() => providerCalls.length === 2);

  // The reply for the current text arrives first, then the late one for the earlier text.
  provider.reply(
    1,
    completion(modelReply('Current answer.', [{ clauseText: '$200 for each day', category: 'late_fee', legalReference: 'US_NYC.lateFees' }])),
  );
  await second;
  provider.reply(0, completion(modelReply('Late answer.', [{ clauseText: '$3,000 cash security deposit' }])));
  await first;

  const state = controller.getState();
  assert.equal(state.status, 'success');
  assert.equal(state.result?.summary, 'Current answer.');
  assert.equal(state.result?.findings[0].legalReference, 'US_NYC.lateFees');
});

test('a late failure for earlier text does not show an error for the current text', async () => {
  const provider = heldProvider();
  const controller = controllerFor(nycListing);
  controller.setClause(DEPOSIT_CLAUSE);
  const first = controller.submit();
  await until(() => providerCalls.length === 1);
  controller.setClause(OTHER_CLAUSE);
  const second = controller.submit();
  await until(() => providerCalls.length === 2);

  provider.reply(1, completion(modelReply('Current answer.', [])));
  await second;
  // The earlier request fails on every retry, after the current one has finished.
  for (let attempt = 0; attempt < 3; attempt++) {
    await until(() => providerCalls.length >= 2 + attempt);
    provider.replyOldest(new Response('server error', { status: 500 }));
  }
  await first;

  assert.equal(controller.getState().status, 'success');
  assert.equal(controller.getState().error, null);
  assert.equal(controller.getState().result?.summary, 'Current answer.');
});

test('a new request clears the previous result and a changed text clears a previous error', async () => {
  providerHandler = () => completion(modelReply('First.', []));
  const controller = controllerFor(nycListing);
  controller.setClause(DEPOSIT_CLAUSE);
  await controller.submit();
  assert.equal(controller.getState().result?.summary, 'First.');

  providerHandler = () => new Response('server error', { status: 500 });
  const again = controller.submit();
  assert.equal(controller.getState().status, 'loading');
  assert.equal(controller.getState().result, null);
  await again;
  assert.equal(controller.getState().status, 'error');
  assert.equal(controller.getState().result, null);
  assert.ok(controller.getState().error);

  controller.setClause(`${DEPOSIT_CLAUSE} Extra.`);
  assert.equal(controller.getState().status, 'idle');
  assert.equal(controller.getState().error, null);
});

test('each listing has its own controller, so one listing never shows another listing result', async () => {
  const provider = heldProvider();
  const nycController = controllerFor(nycListing);
  const londonController = controllerFor(londonListing);
  nycController.setClause(DEPOSIT_CLAUSE);
  const nyc = nycController.submit();
  await until(() => providerCalls.length === 1);

  londonController.setClause(OTHER_CLAUSE);
  assert.equal(londonController.getState().status, 'idle');
  provider.reply(0, completion(modelReply('NYC only.', [])));
  await nyc;

  assert.equal(nycController.getState().result?.summary, 'NYC only.');
  assert.equal(londonController.getState().result, null);
  assert.equal(londonController.getState().clause, OTHER_CLAUSE);
});

// ---------------------------------------------------------------------------------------------
// Errors

test('an unsupported jurisdiction is reported without calling the provider or the heuristic audit', async () => {
  const controller = controllerFor({ ...nycListing, cityName: 'Atlantis' });
  controller.setClause(DEPOSIT_CLAUSE);
  await controller.submit();

  assert.equal(providerCalls.length, 0);
  const state = controller.getState();
  assert.equal(state.status, 'error');
  assert.equal(state.result, null);
  assert.equal(state.error?.kind, 'unsupported');
  assert.match(state.error?.message ?? '', /Atlantis/);

  const markup = renderPanel(state, 'Atlantis');
  assert.match(markup, /role="alert"/);
  assert.match(markup, /Jurisdiction not supported/);
  assert.match(markup, /Atlantis/);
});

const FAILURE_CASES: [string, ProviderHandler][] = [
  ['an HTTP error from the provider', () => new Response('upstream failure', { status: 503 })],
  ['an empty model answer', () => completion('')],
  ['an answer that is not JSON', () => completion('Sorry, I cannot help with that.')],
  ['JSON that fails validation', () => completion(JSON.stringify({ language: 'English', summary: 'x' }))],
  ['a finding whose quote is only whitespace', () => completion(modelReply('x', [{ clauseText: ' \n\t ' }]))],
  [
    'a valid finding beside one whose quote is only whitespace',
    () => completion(modelReply('x', [{ clauseText: '$3,000 cash security deposit' }, { clauseText: ' ' }])),
  ],
];

for (const [name, handler] of FAILURE_CASES) {
  test(`${name} becomes a visible audit failure with no substitute result`, async () => {
    providerHandler = handler;
    const controller = controllerFor(nycListing);
    controller.setClause(DEPOSIT_CLAUSE);
    await controller.submit();

    assert.equal(providerCalls.length, 3, 'the auditor retries twice before giving up');
    const state = controller.getState();
    assert.equal(state.status, 'error');
    assert.equal(state.result, null);
    assert.equal(state.error?.kind, 'failed');
    assert.equal(state.error?.title, 'Clause audit failed');
    assert.doesNotMatch(state.error?.message ?? '', /upstream failure|503|Sorry/);

    const markup = renderPanel(state);
    assert.match(markup, /role="alert"/);
    assert.match(markup, /Clause audit failed/);
    assert.doesNotMatch(markup, /Clause audit result/);
  });
}

test('a network error, which the transport turns into an empty answer, is a visible failure', async () => {
  // callNebiusTokenFactory also answers "" when the API key is missing. The auditor must not
  // treat that as an audit with no findings.
  providerHandler = () => {
    throw new TypeError('fetch failed');
  };
  const controller = controllerFor(nycListing);
  controller.setClause(DEPOSIT_CLAUSE);
  await controller.submit();
  assert.equal(controller.getState().status, 'error');
  assert.equal(controller.getState().result, null);
});

// ---------------------------------------------------------------------------------------------
// Duplicate findings in the real auditor
//
// These call LeaseAuditPrompt with scripted provider replies. Findings with the same category
// and the same quote (ignoring case and whitespace) form a group, and one finding per group
// survives. The winner is chosen after verification: highest verified severity, then fully
// verified evidence, then the earliest in the model reply. Each survivor keeps its own place in
// the model reply, so a winner that came after other findings is listed after them.

const DEDUP_LEASE = `${DEPOSIT_CLAUSE} ${OTHER_CLAUSE}`;
const DEPOSIT_QUOTE = '$3,000 cash security deposit';
// The same quote as DEPOSIT_QUOTE once case and whitespace are normalized.
const DEPOSIT_QUOTE_VARIANT = '$3,000  CASH\nsecurity   deposit';
const ABSENT_QUOTE = 'Tenant forfeits the whole deposit if the unit is not left spotless.';
const FABRICATED_REF = 'US_NYC.madeUpProvision';

type FullFinding = Required<ScriptedFinding>;

/** A default finding named by its issue. The issue and revision text are specific to each fixture. */
function finding(issue: string, overrides: Partial<ScriptedFinding> = {}): FullFinding {
  return {
    clauseText: DEPOSIT_QUOTE,
    ...FINDING_DEFAULTS,
    issue,
    suggestedRevision: `Revision: ${issue}`,
    ...overrides,
  };
}

/** The finding the auditor should return when quote and citation both check out. */
const verified = (f: FullFinding, overrides: Partial<AuditFinding> = {}) => ({
  ...f,
  quoteVerified: true,
  legalReferenceVerified: true,
  ...overrides,
});

/** The finding the auditor should return when the citation is not among the retrieved provisions. */
const unsupported = (f: FullFinding, overrides: Partial<AuditFinding> = {}) =>
  verified(f, { legalReference: 'US_NYC.summary', legalReferenceVerified: false, ...overrides });

const unsupportedIllegal = finding('unsupported illegal', { legalReference: FABRICATED_REF });
const supportedIllegal = finding('supported illegal', { clauseText: DEPOSIT_QUOTE_VARIANT });
const unsupportedWarning = finding('unsupported warning', { severity: 'warning', legalReference: FABRICATED_REF });
const supportedWarning = finding('supported warning', { severity: 'warning' });
const unsupportedInfo = finding('unsupported info', { severity: 'info', legalReference: FABRICATED_REF });
const supportedInfo = finding('supported info', { severity: 'info' });
// A group of its own: another category and quote, a warning that is fully verified.
const lateFee = finding('late fee', {
  clauseText: '$200 for each day',
  category: 'late_fee',
  severity: 'warning',
  legalReference: 'US_NYC.lateFees',
});

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

/** Runs the real auditor on a scripted model reply and checks the fixture assumptions first. */
async function auditReply(findings: FullFinding[]): Promise<ReAuditResult> {
  providerCalls = [];
  providerHandler = () => completion(modelReply('Duplicate check.', findings));
  const result = await leaseAudit.LeaseAuditPrompt(nycListing, DEDUP_LEASE);
  assert.equal(providerCalls.length, 1);
  const allowed = (providerCalls[0].system.match(/ALLOWED legalReference VALUES \(closed list\): (.*)/)?.[1] ?? '').split(', ');
  for (const ref of ['US_NYC.summary', 'US_NYC.securityDeposit', 'US_NYC.lateFees']) {
    assert.ok(allowed.includes(ref), `${ref} is retrieved for the fixture lease`);
  }
  assert.ok(!allowed.includes(FABRICATED_REF));
  return result;
}

const orderLabel = (findings: FullFinding[]) => findings.map((f) => f.issue).join(' > ');

test('a supported illegal finding survives an unsupported duplicate, whichever comes first', async () => {
  for (const findings of permutations([unsupportedIllegal, supportedIllegal])) {
    const result = await auditReply(findings);
    const label = orderLabel(findings);
    assert.equal(result.isValid, false, label);
    assert.deepEqual(result.findings, [verified(supportedIllegal)], label);
  }
});

test('an unsupported illegal finding alone is still downgraded and keeps the fallback citation', async () => {
  const result = await auditReply([unsupportedIllegal]);
  assert.equal(result.isValid, true);
  assert.deepEqual(result.findings, [unsupported(unsupportedIllegal, { severity: 'warning' })]);
});

test('duplicates compete on verified severity, not on the severity the model claimed', async () => {
  // Verified, the claimed "illegal" is a warning with an unverified citation. It no longer
  // outranks a supported warning, and the supported info finding is below both.
  for (const findings of permutations([unsupportedIllegal, supportedWarning, supportedInfo])) {
    const result = await auditReply(findings);
    const label = orderLabel(findings);
    assert.equal(result.isValid, true, label);
    assert.deepEqual(result.findings, [verified(supportedWarning)], label);
  }
});

test('a higher verified severity beats better evidence at a lower severity', async () => {
  for (const findings of permutations([unsupportedIllegal, supportedInfo])) {
    const result = await auditReply(findings);
    assert.deepEqual(result.findings, [unsupported(unsupportedIllegal, { severity: 'warning' })], orderLabel(findings));
  }
  for (const findings of permutations([unsupportedWarning, supportedInfo])) {
    const result = await auditReply(findings);
    assert.deepEqual(result.findings, [unsupported(unsupportedWarning)], orderLabel(findings));
  }
});

test('at equal verified severity, fully verified evidence beats unverified evidence', async () => {
  const cases: [string, FullFinding, FullFinding][] = [
    ['warning', unsupportedWarning, supportedWarning],
    ['info', unsupportedInfo, supportedInfo],
    ['downgraded illegal against a supported warning', unsupportedIllegal, supportedWarning],
  ];
  for (const [name, weak, strong] of cases) {
    for (const findings of permutations([weak, strong])) {
      const result = await auditReply(findings);
      assert.deepEqual(result.findings, [verified(strong)], `${name}: ${orderLabel(findings)}`);
    }
  }
});

test('equivalent duplicates keep the first one with its own fields and merge nothing', async () => {
  // Two fully verified illegal findings that differ in issue, revision, and citation.
  const otherIllegal = finding('other supported illegal', { legalReference: 'US_NYC.summary' });
  for (const findings of permutations([supportedIllegal, otherIllegal])) {
    const result = await auditReply(findings);
    assert.equal(result.isValid, false);
    assert.deepEqual(result.findings, [verified(findings[0])], orderLabel(findings));
  }

  // Two warnings whose citations are both unsupported.
  const otherWarning = finding('other unsupported warning', { severity: 'warning', legalReference: 'US_NYC.alsoMadeUp' });
  for (const findings of permutations([unsupportedWarning, otherWarning])) {
    const result = await auditReply(findings);
    assert.deepEqual(result.findings, [unsupported(findings[0])], orderLabel(findings));
  }

  // The quote is not in the lease, so neither is fully verified, even though one citation is real.
  const absentFabricated = finding('absent quote, fabricated citation', {
    clauseText: ABSENT_QUOTE,
    severity: 'warning',
    legalReference: FABRICATED_REF,
  });
  const absentCited = finding('absent quote, retrieved citation', { clauseText: ABSENT_QUOTE });
  for (const findings of permutations([absentFabricated, absentCited])) {
    const result = await auditReply(findings);
    const [first] = findings;
    const expected =
      first === absentCited
        ? verified(first, { severity: 'warning', quoteVerified: false })
        : unsupported(first, { quoteVerified: false });
    assert.equal(result.isValid, true);
    assert.deepEqual(result.findings, [expected], orderLabel(findings));
  }
});

test('different categories and different quotes stay separate, and the result is sorted by verified severity', async () => {
  const otherCategory = finding('same quote, other category', { category: 'fees_and_charges', severity: 'warning' });
  const otherQuote = finding('same category, other quote', {
    clauseText: 'on the day of signing',
    severity: 'info',
    legalReference: 'US_NYC.summary',
  });
  const summarize = (result: ReAuditResult) => result.findings.map((f) => [f.severity, f.issue]);

  const first = await auditReply([otherQuote, otherCategory, unsupportedIllegal, lateFee, supportedIllegal]);
  assert.equal(first.isValid, false);
  assert.deepEqual(summarize(first), [
    ['illegal', 'supported illegal'],
    ['warning', 'same quote, other category'],
    ['warning', 'late fee'],
    ['info', 'same category, other quote'],
  ]);

  // Findings of equal severity stay in the order the model returned them.
  const second = await auditReply([supportedIllegal, lateFee, unsupportedIllegal, otherCategory, otherQuote]);
  assert.equal(second.isValid, false);
  assert.deepEqual(summarize(second), [
    ['illegal', 'supported illegal'],
    ['warning', 'late fee'],
    ['warning', 'same quote, other category'],
    ['info', 'same category, other quote'],
  ]);
});

test('a winner that replaces an earlier duplicate is listed where the winner came, not where its group began', async () => {
  // Reply order is A1, B, A2. A1 claims illegal with a made-up citation, so it is a warning after
  // verification. A2 is a fully verified warning on the same category and quote, so it replaces A1.
  // B is a fully verified warning in a group of its own. A2 came after B, so the result is B, A2.
  // Listing groups by their first member would give A2, B. All three are warnings, so the final
  // severity sort leaves this order alone.
  const result = await auditReply([unsupportedIllegal, lateFee, supportedWarning]);
  assert.equal(result.isValid, true);
  assert.deepEqual(result.findings, [verified(lateFee), verified(supportedWarning)]);

  // In any reply order the survivors keep the order of the reply, and only A1 is dropped.
  for (const findings of permutations([unsupportedIllegal, lateFee, supportedWarning])) {
    const reordered = await auditReply(findings);
    const label = orderLabel(findings);
    assert.equal(reordered.isValid, true, label);
    assert.deepEqual(
      reordered.findings,
      findings.filter((f) => f !== unsupportedIllegal).map((f) => verified(f)),
      label,
    );
  }
});

test('isValid is computed from the findings that remain after deduplication', async () => {
  const unsupportedElsewhere = finding('unsupported illegal elsewhere', {
    clauseText: '$200 for each day',
    category: 'late_fee',
    legalReference: FABRICATED_REF,
  });
  const supportedElsewhere = finding('supported illegal elsewhere', {
    clauseText: '$200 for each day',
    category: 'late_fee',
    legalReference: 'US_NYC.lateFees',
  });
  const cases: [string, FullFinding[], boolean][] = [
    ['no findings', [], true],
    ['only an unsupported illegal', [unsupportedIllegal], true],
    ['only a supported illegal', [supportedIllegal], false],
    ['an unsupported and a supported illegal on one quote', [unsupportedIllegal, supportedIllegal], false],
    ['a supported warning beside an unsupported illegal on one quote', [unsupportedIllegal, supportedWarning], true],
    ['a supported illegal beside an unsupported illegal on another quote', [unsupportedElsewhere, supportedIllegal], false],
    ['unsupported duplicates on one quote and a supported illegal on another', [unsupportedIllegal, unsupportedWarning, supportedElsewhere], false],
  ];
  for (const [name, scripted, expected] of cases) {
    for (const findings of permutations(scripted)) {
      const result = await auditReply(findings);
      const label = `${name}: ${orderLabel(findings)}`;
      assert.equal(result.isValid, expected, label);
      assert.equal(result.isValid, !result.findings.some((f) => f.severity === 'illegal'), label);
    }
  }
});

test('the dossier clause auditor still flags the supported illegal finding behind an unsupported duplicate', async () => {
  providerHandler = () => completion(modelReply('Deposit is above the cap.', [unsupportedIllegal, supportedIllegal]));
  const controller = controllerFor(nycListing);
  controller.setClause(DEDUP_LEASE);
  await controller.submit();

  const state = controller.getState();
  assert.equal(state.status, 'success');
  assert.equal(state.result?.isValid, false);
  assert.deepEqual(state.result?.findings, [verified(supportedIllegal)]);
  const markup = renderPanel(state);
  assert.match(markup, /Illegal clause flagged/);
  assert.match(markup, /supported illegal/);
  assert.doesNotMatch(markup, /unsupported illegal/);
  assert.doesNotMatch(markup, /None is rated illegal/);
});

// ---------------------------------------------------------------------------------------------
// Quotes that are only whitespace
//
// A quote that is empty after whitespace normalization is contained in every lease, so it would
// verify without naming any clause. The real auditor rejects a reply that holds one at schema
// validation. That is the same retry path as any other invalid reply: a later valid reply
// recovers, and running out of attempts is a LeaseAuditError. Nothing is dropped or repaired.

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
// The ECMAScript WhiteSpace and LineTerminator code points, which is what JavaScript trims.
const BLANK_CODE_POINTS = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, ...range(0x2000, 0x200a), 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
  0xfeff,
];
const BLANK_QUOTES = [
  '',
  '   ',
  ' \t\r\n\v\f ',
  ...BLANK_CODE_POINTS.map((codePoint) => String.fromCodePoint(codePoint)),
  String.fromCodePoint(...BLANK_CODE_POINTS),
];
const quoteLabel = (quote: string) =>
  [...quote].map((c) => `U+${c.codePointAt(0)?.toString(16).padStart(4, '0')}`).join(' ') || 'empty string';

const blankFinding = finding('blank quote', { clauseText: ' \n\t ' });
const BLANK_REPLY = modelReply('Blank quote.', [blankFinding]);
const RECOVERY_REPLY = modelReply('Recovered.', [supportedWarning]);

/** Runs the real auditor on provider replies in order. The last reply repeats if more are needed. */
function auditSequence(...replies: string[]): Promise<ReAuditResult> {
  providerCalls = [];
  let next = 0;
  providerHandler = () => completion(replies[Math.min(next++, replies.length - 1)]);
  return leaseAudit.LeaseAuditPrompt(nycListing, DEDUP_LEASE);
}

function isAttemptLimitError(error: unknown) {
  assert.ok(error instanceof leaseAudit.LeaseAuditError);
  assert.match(error.message, /Lease audit failed after 3 attempts/);
  assert.match(error.message, /clauseText must not be blank/);
  return true;
}

test('a quote of any whitespace is rejected, retried to the attempt limit, and never becomes a finding', async () => {
  for (const quote of BLANK_QUOTES) {
    const label = quoteLabel(quote);
    assert.equal(quote.trim(), '', `${label} is blank under the JavaScript whitespace policy`);
    // The default fixture finding is "illegal" with a retrieved citation, the case that used to verify.
    const reply = modelReply('Blank quote.', [finding('blank quote', { clauseText: quote })]);
    await assert.rejects(auditSequence(reply), isAttemptLimitError, label);
    assert.equal(providerCalls.length, 3, label);
  }
});

test('a valid reply after a blank-quote reply recovers, and a late one does not extend the attempt limit', async () => {
  const clean = await auditSequence(RECOVERY_REPLY);
  assert.equal(providerCalls.length, 1);
  assert.equal(clean.summary, 'Recovered.');
  assert.deepEqual(clean.findings, [verified(supportedWarning)]);

  for (const blankReplies of [1, 2]) {
    const recovered = await auditSequence(...Array<string>(blankReplies).fill(BLANK_REPLY), RECOVERY_REPLY);
    assert.equal(providerCalls.length, blankReplies + 1);
    assert.deepEqual(recovered, clean);
  }

  await assert.rejects(auditSequence(BLANK_REPLY, BLANK_REPLY, BLANK_REPLY, RECOVERY_REPLY), isAttemptLimitError);
  assert.equal(providerCalls.length, 3);
});

test('a reply that mixes a blank quote with a valid finding is rejected whole, not trimmed to the valid part', async () => {
  for (const findings of permutations([supportedIllegal, blankFinding])) {
    const mixed = modelReply('Mixed.', findings);
    const label = orderLabel(findings);

    await assert.rejects(auditSequence(mixed), isAttemptLimitError, label);
    assert.equal(providerCalls.length, 3, label);

    const recovered = await auditSequence(mixed, RECOVERY_REPLY);
    assert.equal(providerCalls.length, 2, label);
    assert.equal(recovered.summary, 'Recovered.', label);
    assert.deepEqual(recovered.findings, [verified(supportedWarning)], label);
    assert.equal(recovered.isValid, true, label);
  }
});

test('quotes keep their case, tabs, line breaks, and edge whitespace, and still match ignoring them', async () => {
  const quotes = [
    '  $3,000 cash security deposit\n',
    '\n\t$3,000\tcash\r\nsecurity deposit　',
    '$3,000 CASH Security DEPOSIT',
    '$',
  ];
  for (const clauseText of quotes) {
    const f = finding('nonblank quote', { clauseText });
    const result = await auditReply([f]);
    assert.deepEqual(result.findings, [verified(f)], quoteLabel(clauseText));
    assert.equal(result.findings[0].clauseText, clauseText);
  }
});

test('after a blank-quote reply, duplicates, absent quotes, and unsupported citations are handled as before', async () => {
  const absentIllegal = finding('absent quote', { clauseText: ABSENT_QUOTE });
  const cases: [string, FullFinding[], unknown[], boolean][] = [
    ['duplicates', [unsupportedIllegal, supportedIllegal], [verified(supportedIllegal)], false],
    ['fabricated citation', [unsupportedIllegal], [unsupported(unsupportedIllegal, { severity: 'warning' })], true],
    ['absent quote', [absentIllegal], [verified(absentIllegal, { severity: 'warning', quoteVerified: false })], true],
  ];
  for (const [name, scripted, expected, isValid] of cases) {
    const reply = modelReply('Same reply.', scripted);
    const direct = await auditSequence(reply);
    assert.deepEqual(direct.findings, expected, name);
    assert.equal(direct.isValid, isValid, name);

    const recovered = await auditSequence(BLANK_REPLY, reply);
    assert.equal(providerCalls.length, 2, name);
    assert.deepEqual(recovered, direct, name);
  }
});

// ---------------------------------------------------------------------------------------------
// Rendering

test('a real audit result shows the quote, severity, issue, revision, citation title, model, and disclaimer', async () => {
  providerHandler = () =>
    completion(
      modelReply('One clause is above the cap.', [
        { clauseText: '$3,000 cash security deposit', issue: 'Above one month of rent.', suggestedRevision: 'Cap the deposit at one month.' },
        { clauseText: 'on the day of signing', severity: 'info', suggestedRevision: '', issue: 'Timing is common.', legalReference: 'US_NYC.summary' },
      ]),
    );
  const controller = controllerFor(nycListing);
  controller.setClause(DEPOSIT_CLAUSE);
  await controller.submit();
  const markup = renderPanel(controller.getState());

  assert.match(markup, /&quot;\$3,000 cash security deposit&quot;/);
  assert.match(markup, /Severity: <\/span>Illegal/);
  assert.match(markup, /Severity: <\/span>Info/);
  assert.match(markup, /Above one month of rent\./);
  assert.match(markup, /Suggested revision: <\/strong>Cap the deposit at one month\./);
  assert.equal((markup.match(/Suggested revision/g) ?? []).length, 1, 'no revision line for an empty revision');
  assert.match(markup, /<code[^>]*>US_NYC\.securityDeposit<\/code>: Security deposit rules/);
  assert.match(markup, /Illegal clause flagged/);
  assert.ok(markup.includes(`Model: ${FAKE_MODEL} (via Nebius Token Factory)`));
  assert.match(markup, /not legal advice/);
  // Every corpus source field is empty today, so nothing may be linked.
  assert.doesNotMatch(markup, /<a /);
  assert.doesNotMatch(markup, /href=/);
});

test('an empty findings list says no issues were found in the supplied text, not that the lease is valid', () => {
  const markup = renderPanel(successState(resultWith({ isValid: true, findings: [] })));
  assert.match(markup, /No issues found in the supplied text under the available rules\./);
  assert.match(markup, /does not mean the whole lease is legally valid/);
  assert.doesNotMatch(markup, /<ol/);
  assert.doesNotMatch(markup, /No finding rated illegal/);
});

test('isValid only means that no returned finding is rated illegal', () => {
  const finding = {
    clauseText: 'Late fee is $200.',
    category: 'late_fee' as const,
    severity: 'warning' as const,
    issue: 'Unusual fee.',
    legalReference: 'US_NYC.lateFees',
    suggestedRevision: '',
    quoteVerified: true,
    legalReferenceVerified: true,
  };
  const warningOnly = renderPanel(successState(resultWith({ isValid: true, findings: [finding] })));
  assert.match(warningOnly, /1 finding to review\. None is rated illegal under the available rules\./);
  assert.match(warningOnly, /No finding rated illegal/);
  assert.doesNotMatch(warningOnly, /legally valid/);

  const illegal = renderPanel(
    successState(resultWith({ isValid: false, findings: [{ ...finding, severity: 'illegal' }] })),
  );
  assert.match(illegal, /At least one is rated illegal/);
  assert.match(illegal, /Illegal clause flagged/);
});

test('a source is linked only when it is a nonempty http(s) URL', () => {
  const finding = (legalReference: string) => ({
    clauseText: 'Clause.',
    category: 'other' as const,
    severity: 'warning' as const,
    issue: 'Issue.',
    legalReference,
    suggestedRevision: '',
    quoteVerified: true,
    legalReferenceVerified: true,
  });
  const markup = renderPanel(
    successState(
      resultWith({
        findings: [finding('X.linked'), finding('X.text'), finding('X.script'), finding('X.blank')],
        legalSources: [
          { id: 'X.linked', title: 'Linked rule', source: 'https://example.org/statute' },
          { id: 'X.text', title: 'Text rule', source: 'Civil Code art. 5' },
          { id: 'X.script', title: 'Script rule', source: 'javascript:alert(1)' },
          { id: 'X.blank', title: 'Blank rule', source: '   ' },
        ],
      }),
    ),
  );
  const anchors = markup.match(/<a [^>]*>/g) ?? [];
  assert.equal(anchors.length > 0, true);
  for (const anchor of anchors) {
    assert.match(anchor, /href="https:\/\/example\.org\/statute"/);
    assert.match(anchor, /rel="noopener noreferrer"/);
    assert.match(anchor, /target="_blank"/);
  }
  assert.doesNotMatch(markup, /href="(?!https:\/\/example\.org\/statute")/);
  assert.match(markup, /Source: Civil Code art\. 5/);
});

test('a citation with no matching source title still shows its ID', () => {
  const markup = renderPanel(
    successState(
      resultWith({
        findings: [
          {
            clauseText: 'Clause.',
            category: 'other',
            severity: 'info',
            issue: 'Issue.',
            legalReference: 'US_NYC.unknown',
            suggestedRevision: '',
            quoteVerified: false,
            legalReferenceVerified: false,
          },
        ],
      }),
    ),
  );
  assert.match(markup, /<code[^>]*>US_NYC\.unknown<\/code>/);
  assert.match(markup, /could not be matched to your text/);
  assert.match(markup, /not among the rules checked/);
});

// ---------------------------------------------------------------------------------------------
// Legal retrieval text folding

test('city lookup folds accents, case, decomposed marks, and punctuation, and keeps Japanese and Chinese characters', () => {
  const { findLegalContext, normalizeCityName } = retriever;
  const resolves = (code: string, names: string[]) => {
    for (const name of names) assert.equal(findLegalContext(name)?.code, code, name);
  };
  resolves('CO_BOG', ['Bogotá D.C.', 'BOGOTÁ D.C.', 'Bogotá dc', 'bogota']);
  resolves('DE_BER', ['Berlín', 'BERLIN', 'Berlín']);
  resolves('US_NYC', ['Nueva York', 'NUEVA YORK', 'new-york', 'N.Y.C.']);
  resolves('US_SF', ['San Francisco, CA', 'S.F.']);
  resolves('JP_TYO', ['Tokyo', 'Tōkyō', '東京']);
  assert.equal(normalizeCityName('Tōkyō'), 'tokyo');
  assert.equal(normalizeCityName('東京'), '東京');
  // Folding is accents and case only. It does not map compatibility forms, kana, or other
  // cities onto a supported city.
  for (const name of ['Ｔｏｋｙｏ', 'とうきょう', '北京', 'Tokyo, Japan']) {
    assert.equal(findLegalContext(name), null, name);
  }
});

test('category detection gives one result for the accented, uppercase, decomposed, and plain spelling of a term', () => {
  const { detectCategories } = retriever;
  const spellings: [string[], string][] = [
    [['Kündigungsfrist', 'KÜNDIGUNGSFRIST', 'Kündigungsfrist', 'kundigungsfrist'], 'termination'],
    [['Mieterhöhung', 'MIETERHÖHUNG', 'Mieterhöhung', 'mieterhohung'], 'rent_increase'],
    [['dépôt de garantie', 'DÉPÔT DE GARANTIE', 'dépôt de garantie', 'depot de garantie'], 'security_deposit'],
    [['pénalité de retard', 'PÉNALITÉ DE RETARD', 'pénalité de retard', 'penalite de retard'], 'late_fee'],
  ];
  for (const [forms, category] of spellings) {
    const expected = detectCategories(forms[0]);
    assert.deepEqual(expected.map((d) => d.category), [category], forms[0]);
    for (const form of forms) assert.deepEqual(detectCategories(form), expected, form);
  }
  // Short terms keep their word boundaries, and non-Latin text adds no category of its own.
  assert.deepEqual(detectCategories('IRL').map((d) => d.category), ['rent_increase']);
  assert.deepEqual(detectCategories('irlx bondage'), []);
  assert.deepEqual(detectCategories('敷金 礼金 賃貸'), []);
  assert.deepEqual(detectCategories('敷金 shikikin').map((d) => d.category), ['security_deposit']);
});

test('retrieval returns the same chunks, scores, and reasons for every spelling of the same words', () => {
  const { retrieveLegalChunks } = retriever;
  const [reference, ...others] = [
    'Kündigungsfrist und Mieterhöhung',
    'KÜNDIGUNGSFRIST UND MIETERHÖHUNG',
    'Kündigungsfrist und Mieterhöhung',
    'kundigungsfrist und mieterhohung',
  ].map((text) => retrieveLegalChunks('DE_BER', text));
  assert.deepEqual([...reference.detectedCategories].sort(), ['rent_increase', 'termination']);
  // The accented words reach the index terms: a score above zero needs the folded token to match.
  const termination = reference.chunks.find((c) => c.chunk.id === 'DE_BER.terminationRules');
  assert.ok(termination);
  assert.equal(termination.reason, 'category');
  assert.ok(termination.score > 0);
  for (const other of others) assert.deepEqual(other, reference);

  // Text with no Latin letters gives no signal, so the jurisdiction framework and core rules come back.
  const japanese = retrieveLegalChunks('JP_TYO', '敷金は2か月分、礼金は1か月分。');
  assert.deepEqual(japanese.detectedCategories, []);
  assert.deepEqual(
    japanese.chunks.map((c) => c.reason),
    ['always', 'fallback', 'fallback', 'fallback', 'fallback'],
  );
});

// ---------------------------------------------------------------------------------------------
// The dossier

test('the fixture dossier keeps its generic assessment and adds a labelled clause auditor', () => {
  const markup = renderToStaticMarkup(createElement(modal.ListingModal, { listing: nycListing, onClose: () => {} }));
  const audit = nycListing.nemotronAudit;
  assert.ok(markup.includes(`${audit.scamRiskScore}/10`));
  assert.ok(markup.includes(audit.analyzedByModel));
  assert.ok(markup.includes(audit.marketPriceComparison));
  assert.ok(markup.includes(audit.negotiationScript));
  assert.match(markup, /<label[^>]*for="clause-audit-input"/);
  assert.match(markup, /<textarea[^>]*id="clause-audit-input"/);
  assert.match(markup, /RE-AUDIT CLAUSE WITH NEMOTRON/);
  assert.match(markup, /<button[^>]*disabled=""[^>]*>RE-AUDIT CLAUSE WITH NEMOTRON/);
});

test('a Scout candidate has no clause auditor', () => {
  const candidate = {
    kind: 'scout' as const,
    mode: 'demo' as const,
    id: 'scout-1',
    title: 'Sample hit',
    cityId: 'nyc',
    cityName: 'New York City',
    source: 'Tavily Web Scout' as const,
    sourceUrl: 'https://example.org/',
    description: 'Sample text.',
    tags: [],
  };
  const markup = renderToStaticMarkup(createElement(modal.ListingModal, { listing: candidate, onClose: () => {} }));
  assert.doesNotMatch(markup, /clause-audit-input/);
  assert.doesNotMatch(markup, /RE-AUDIT CLAUSE/);
});
