// Offline checks for the dossier clause audit (src/services/clauseAudit.ts and
// src/components/ClauseAuditPanel.tsx). The clause audit controller runs the real
// LeaseAuditPrompt, legal retrieval, and Nebius transport against a fake provider: the global
// fetch is replaced before any app module loads, answers only for the fake .invalid base URL,
// and throws for anything else, so no real network call can happen. The API key is a placeholder.
// The app modules need Vite's transform (extensionless imports, import.meta.env, TSX), so they
// load through an in-process Vite SSR loader that reads no .env file.
// These checks cover state handling, request wiring, and rendering. The duplicate-finding and
// whitespace-only-quote checks call LeaseAuditPrompt itself with scripted provider replies. The
// text-folding checks call the public functions of src/utils/legalRetriever.ts directly. The
// supporting-rule checks for New York City and Berlin do both, and so do the New York City
// rent-increase checks and the London, Tokyo, and Bogota rule checks. They do not establish that
// any legal conclusion is correct.
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
const RENT_INCREASE_ID = 'US_NYC.rentIncreases';
const RENT_INCREASE_SOURCE = 'https://www.nysenate.gov/legislation/laws/RPP/216';

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
let berlinListing: Listing;
let tokyoListing: Listing;
let bogotaListing: Listing;

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
  berlinListing = byCity('Berlin');
  tokyoListing = byCity('Tokyo');
  bogotaListing = byCity('Bogotá');
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

/** The "Rules checked" list items of a rendered result, by rule ID. */
function rulesChecked(markup: string): Record<string, string> {
  return Object.fromEntries([...markup.matchAll(/<li><code[^>]*>([\w.]+)<\/code>:.*?<\/li>/g)].map((m) => [m[1], m[0]]));
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

/** The closed list of citable IDs that the prompt gives the model. */
const allowedReferences = (system: string) =>
  (system.match(/ALLOWED legalReference VALUES \(closed list\): (.*)/)?.[1] ?? '').split(', ');

/** Runs the real auditor on a scripted model reply and checks the fixture assumptions first. */
async function auditReply(findings: FullFinding[]): Promise<ReAuditResult> {
  providerCalls = [];
  providerHandler = () => completion(modelReply('Duplicate check.', findings));
  const result = await leaseAudit.LeaseAuditPrompt(nycListing, DEDUP_LEASE);
  assert.equal(providerCalls.length, 1);
  const allowed = allowedReferences(providerCalls[0].system);
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
  // A rule is linked only when it has a source. The summary, deposit, late fee, and termination rules
  // retrieved for a deposit clause have none, so their entries carry no link. The rent-increase rule
  // retrieved beside them has an official source, and it is the only link.
  const entries = rulesChecked(markup);
  for (const id of ['US_NYC.summary', 'US_NYC.securityDeposit', 'US_NYC.lateFees', 'US_NYC.terminationRules']) {
    assert.ok(entries[id], `${id} is listed`);
    assert.doesNotMatch(entries[id], /<a /, id);
    assert.doesNotMatch(entries[id], /href=/, id);
  }
  assert.match(entries[RENT_INCREASE_ID] ?? '', new RegExp(`<a href="${RENT_INCREASE_SOURCE}"`));
  assert.equal((markup.match(/<a /g) ?? []).length, 1);
  assert.equal((markup.match(/href=/g) ?? []).length, 1);
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
// Supporting rules for New York City and Berlin
//
// Application fees and the rent-stabilization rider (New York City), and the registration
// confirmation and subletting (Berlin), are chunks of their own. Each has a retrieval category and
// an official source. These checks run the real retriever and LeaseAuditPrompt with scripted
// provider replies. They show that a clause on each topic retrieves its rule by default, that the
// rule reaches the prompt text and the closed citation list, and that its title and source reach
// the result. A scripted reply says nothing about whether a model reasons correctly about the law.

interface SupportingRule {
  code: string;
  id: string;
  category: string; // the retrieval category of the chunk
  findingCategory: string; // the audit category a finding on this topic would use
  source: string;
  anchors: string[]; // phrases the rule text must keep, so a trimmed or swapped text fails
  clauses: { language: string; lease: string; quote: string }[];
}

const SUPPORTING_RULES: SupportingRule[] = [
  {
    code: 'US_NYC',
    id: 'US_NYC.applicationFees',
    category: 'fees_and_charges',
    findingCategory: 'fees_and_charges',
    source: 'https://www.nysenate.gov/legislation/laws/RPP/238-A',
    anchors: ['$20', '30 days', 'receipt or invoice', 'not a permitted flat application fee'],
    clauses: [
      {
        language: 'English application fee',
        lease: 'Applicant pays a non-refundable $200 application fee when submitting the application.',
        quote: '$200 application fee',
      },
      {
        language: 'English credit and background check fee',
        lease: 'A $75 credit and background check fee is charged at signing.',
        quote: '$75 credit and background check fee',
      },
      {
        language: 'Spanish application fee',
        lease: 'El solicitante pagará una tarifa de solicitud de $200 al presentar la solicitud.',
        quote: 'tarifa de solicitud de $200',
      },
      {
        language: 'Spanish credit check',
        lease: 'Se cobra una verificación de crédito de $75 al firmar.',
        quote: 'verificación de crédito de $75',
      },
    ],
  },
  {
    code: 'US_NYC',
    id: 'US_NYC.rentStabilizationRider',
    category: 'rent_stabilization',
    findingCategory: 'other',
    source: 'https://hcr.ny.gov/leases',
    anchors: ['RA-LR1', 'vacancy lease', 'renewal lease', 'market-rate'],
    clauses: [
      {
        language: 'English DHCR rider',
        lease: 'This apartment is rent stabilized, but the owner will not provide the DHCR rider with the vacancy lease.',
        quote: 'will not provide the DHCR rider',
      },
      {
        language: 'English form number',
        lease: 'The owner refuses to attach Form RA-LR1 to the renewal lease.',
        quote: 'refuses to attach Form RA-LR1',
      },
      {
        language: 'Spanish DHCR rider',
        lease: 'El propietario no entregará el anexo de estabilización DHCR del contrato de renovación.',
        quote: 'no entregará el anexo de estabilización DHCR',
      },
    ],
  },
  {
    code: 'DE_BER',
    id: 'DE_BER.registrationConfirmation',
    category: 'tenant_registration',
    findingCategory: 'other',
    source: 'https://www.gesetze-im-internet.de/bmg/__19.html',
    anchors: ['two weeks', 'Wohnungsgeberbestätigung', '§ 19 BMG', 'does not show a refusal'],
    clauses: [
      {
        language: 'German Wohnungsgeberbestätigung',
        lease: 'Der Vermieter verweigert die Wohnungsgeberbestätigung, daher ist die Anmeldung beim Bürgeramt untersagt.',
        quote: 'verweigert die Wohnungsgeberbestätigung',
      },
      {
        language: 'English landlord confirmation',
        lease: 'The landlord will not issue the landlord confirmation, so the tenant cannot complete city registration.',
        quote: 'will not issue the landlord confirmation',
      },
      {
        language: 'Spanish confirmación del arrendador',
        lease: 'El arrendador no entrega la confirmación del arrendador y prohíbe el empadronamiento.',
        quote: 'no entrega la confirmación del arrendador',
      },
    ],
  },
  {
    code: 'DE_BER',
    id: 'DE_BER.subletting',
    category: 'subletting',
    findingCategory: 'termination',
    source: 'https://www.gesetze-im-internet.de/bgb/__553.html',
    anchors: ['part of the dwelling', '§ 553', 'blanket ban'],
    clauses: [
      {
        language: 'German Untervermietung',
        lease: 'Jede Untervermietung ist verboten, auch für ein einzelnes Zimmer.',
        quote: 'Jede Untervermietung ist verboten',
      },
      {
        language: 'German Untermietvertrag',
        lease: 'Ein Untermietvertrag ist ausgeschlossen.',
        quote: 'Ein Untermietvertrag ist ausgeschlossen',
      },
      {
        language: 'English subletting',
        lease: 'Subletting of any kind is strictly prohibited.',
        quote: 'Subletting of any kind is strictly prohibited',
      },
      {
        language: 'Spanish subarriendo',
        lease: 'Queda prohibido cualquier subarriendo.',
        quote: 'prohibido cualquier subarriendo',
      },
    ],
  },
];

const ALL_CITY_CODES = ['US_NYC', 'UK_LON', 'JP_TYO', 'CO_BOG', 'AE_DXB', 'FR_PAR', 'DE_BER', 'US_SF'];
const listingFor = (code: string) => {
  const listing = { US_NYC: nycListing, UK_LON: londonListing, JP_TYO: tokyoListing, CO_BOG: bogotaListing, DE_BER: berlinListing }[code];
  assert.ok(listing, `fixture listing for ${code}`);
  return listing;
};
const ruleFor = (id: string) => {
  const rule = SUPPORTING_RULES.find((r) => r.id === id);
  assert.ok(rule, id);
  return rule;
};
const chunkFor = (rule: SupportingRule) => {
  const chunk = retriever.getCorpusForCity(rule.code).find((c) => c.id === rule.id);
  assert.ok(chunk, rule.id);
  return chunk;
};

// A clause on two supporting topics, with the quote that a finding on each rule would cite.
const MIXED_CLAUSES: { code: string; language: string; lease: string; cited: [string, string][] }[] = [
  {
    code: 'US_NYC',
    language: 'English',
    lease: 'Applicant pays a $200 application fee. The apartment is rent stabilized, but the owner will not attach the DHCR rider to the vacancy lease.',
    cited: [
      ['US_NYC.applicationFees', '$200 application fee'],
      ['US_NYC.rentStabilizationRider', 'will not attach the DHCR rider'],
    ],
  },
  {
    code: 'US_NYC',
    language: 'English with a renewal and a deposit',
    lease: 'A $75 credit and background check fee is due, with a $3,000 security deposit. The owner refuses to attach Form RA-LR1 to the renewal lease.',
    cited: [
      ['US_NYC.applicationFees', '$75 credit and background check fee'],
      ['US_NYC.rentStabilizationRider', 'refuses to attach Form RA-LR1'],
    ],
  },
  {
    code: 'US_NYC',
    language: 'Spanish',
    lease: 'El solicitante pagará una tarifa de solicitud de $200. El propietario no entregará el anexo de estabilización DHCR.',
    cited: [
      ['US_NYC.applicationFees', 'tarifa de solicitud de $200'],
      ['US_NYC.rentStabilizationRider', 'no entregará el anexo de estabilización DHCR'],
    ],
  },
  {
    code: 'DE_BER',
    language: 'German',
    lease: 'Der Vermieter verweigert die Wohnungsgeberbestätigung. Jede Untervermietung ist ausnahmslos verboten.',
    cited: [
      ['DE_BER.registrationConfirmation', 'verweigert die Wohnungsgeberbestätigung'],
      ['DE_BER.subletting', 'Jede Untervermietung ist ausnahmslos verboten'],
    ],
  },
  {
    code: 'DE_BER',
    language: 'English',
    lease: 'The landlord refuses the landlord confirmation needed for city registration. Subletting of any kind is prohibited.',
    cited: [
      ['DE_BER.registrationConfirmation', 'refuses the landlord confirmation'],
      ['DE_BER.subletting', 'Subletting of any kind is prohibited'],
    ],
  },
  {
    code: 'DE_BER',
    language: 'Spanish',
    lease: 'El arrendador se niega a dar la confirmación del arrendador. Queda prohibido el subarriendo.',
    cited: [
      ['DE_BER.registrationConfirmation', 'se niega a dar la confirmación del arrendador'],
      ['DE_BER.subletting', 'Queda prohibido el subarriendo'],
    ],
  },
];

test('each supporting rule is a sourced chunk with its own category in the right city', () => {
  for (const rule of SUPPORTING_RULES) {
    const chunk = chunkFor(rule);
    assert.equal(chunk.cityCode, rule.code, rule.id);
    assert.equal(chunk.category, rule.category, rule.id);
    assert.ok(chunk.title.trim(), rule.id);
    assert.equal(chunk.source, rule.source, rule.id);
    assert.equal(new URL(chunk.source).protocol, 'https:', rule.id);
    for (const anchor of rule.anchors) assert.ok(chunk.text.includes(anchor), `${rule.id} keeps "${anchor}"`);
  }
});

test('a clause on each supporting topic retrieves its rule by routing, in English and in local forms', () => {
  for (const rule of SUPPORTING_RULES) {
    for (const { language, lease } of rule.clauses) {
      const label = `${rule.id}: ${language}`;
      const { chunks, detectedCategories } = retriever.retrieveLegalChunks(rule.code, lease);
      assert.ok(detectedCategories.includes(rule.category as (typeof detectedCategories)[number]), label);
      assert.equal(chunks.find((c) => c.chunk.id === rule.id)?.reason, 'category', label);
      assert.ok(chunks.every((c) => c.chunk.cityCode === rule.code), label);
    }
  }
});

test('each supporting rule reaches the prompt and its closed citation list, and its source reaches the verified result', async () => {
  for (const rule of SUPPORTING_RULES) {
    const chunk = chunkFor(rule);
    for (const { language, lease, quote } of rule.clauses) {
      const label = `${rule.id}: ${language}`;
      const cited = finding(`Checks ${rule.id}`, {
        clauseText: quote,
        category: rule.findingCategory,
        legalReference: rule.id,
      });
      providerCalls = [];
      providerHandler = () => completion(modelReply('Supporting rule check.', [cited]));
      const result = await leaseAudit.LeaseAuditPrompt(listingFor(rule.code), lease);

      assert.equal(providerCalls.length, 1, label);
      const { system, user } = providerCalls[0];
      assert.equal(user, lease, label);
      assert.ok(system.includes(`[${rule.id}] ${chunk.title}`), label);
      assert.ok(system.includes(chunk.text), label);
      assert.ok(system.includes(`(Source: ${rule.source})`), label);
      const allowed = allowedReferences(system);
      assert.ok(allowed.includes(rule.id), label);
      assert.ok(allowed.includes(`${rule.code}.summary`), label);
      assert.ok(allowed.every((id) => id.startsWith(`${rule.code}.`)), label);
      for (const code of ALL_CITY_CODES.filter((c) => c !== rule.code)) {
        assert.ok(!system.includes(`${code}.`), `${label} has no ${code} rule`);
      }

      assert.deepEqual(
        result.legalSources.find((s) => s.id === rule.id),
        { id: rule.id, title: chunk.title, source: rule.source },
        label,
      );
      assert.deepEqual(result.findings, [verified(cited)], label);
      assert.equal(result.isValid, false, label);
    }
  }
});

test('the official source of a retrieved supporting rule is a link in the clause audit result', async () => {
  for (const rule of SUPPORTING_RULES) {
    const [{ lease, quote }] = rule.clauses;
    providerHandler = () =>
      completion(
        modelReply('Source check.', [
          finding('Source check', { clauseText: quote, category: rule.findingCategory, legalReference: rule.id }),
        ]),
      );
    const controller = controllerFor(listingFor(rule.code));
    controller.setClause(lease);
    await controller.submit();
    assert.equal(controller.getState().status, 'success', rule.id);

    const markup = renderPanel(controller.getState(), listingFor(rule.code).cityName);
    const anchors = markup.match(/<a [^>]*>/g) ?? [];
    assert.ok(
      anchors.some((a) => a.includes(`href="${rule.source}"`) && a.includes('rel="noopener noreferrer"')),
      rule.id,
    );
    assert.match(markup, new RegExp(`<code[^>]*>${rule.id.replace('.', '\\.')}</code>`), rule.id);
  }
});

test('a clause on two supporting topics retrieves both rules within the default budget, from its own city only', async () => {
  for (const { code, language, lease, cited } of MIXED_CLAUSES) {
    const label = `${code}: ${language}`;
    const { chunks } = retriever.retrieveLegalChunks(code, lease);
    assert.ok(chunks.length <= 5, `${label} fits the default topK`);
    assert.ok(chunks.reduce((sum, c) => sum + c.chunk.text.length, 0) <= 6000, `${label} fits the default maxChars`);
    assert.ok(chunks.every((c) => c.chunk.cityCode === code), label);
    assert.ok(chunks.some((c) => c.chunk.id === `${code}.summary`), label);
    for (const [id] of cited) assert.equal(chunks.find((c) => c.chunk.id === id)?.reason, 'category', `${label}: ${id}`);

    const findings = cited.map(([id, quote]) =>
      finding(`Checks ${id}`, { clauseText: quote, category: ruleFor(id).findingCategory, legalReference: id }),
    );
    providerCalls = [];
    providerHandler = () => completion(modelReply('Mixed topics.', findings));
    const result = await leaseAudit.LeaseAuditPrompt(listingFor(code), lease);

    const allowed = allowedReferences(providerCalls[0].system);
    assert.deepEqual(allowed, chunks.map((c) => c.chunk.id), label);
    assert.deepEqual(result.findings, findings.map((f) => verified(f)), label);
    for (const [id] of cited) {
      assert.equal(result.legalSources.find((s) => s.id === id)?.source, ruleFor(id).source, `${label}: ${id}`);
    }
    for (const other of ALL_CITY_CODES.filter((c) => c !== code)) {
      assert.ok(!providerCalls[0].system.includes(`${other}.`), `${label} has no ${other} rule`);
    }
  }
});

test('supporting rules stay out of core-topic retrieval, and the no-signal fallback stays on the core rules', () => {
  const { retrieveLegalChunks } = retriever;
  const supportingIds = new Set(SUPPORTING_RULES.map((r) => r.id));
  const idsOf = (code: string, text: string) => retrieveLegalChunks(code, text).chunks.map((c) => c.chunk.id);

  // Words such as "tenant" or "must" are common to every clause. If a supporting rule scored on
  // them, it would take a slot in unrelated retrieval and put a source link in the audit result.
  for (const id of idsOf('US_NYC', DEPOSIT_CLAUSE)) assert.ok(!supportingIds.has(id), id);
  for (const id of idsOf('DE_BER', 'Kündigungsfrist und Mieterhöhung')) assert.ok(!supportingIds.has(id), id);

  // No signal still returns the summary and the four core rules, in the default budget.
  for (const code of ['US_NYC', 'DE_BER', 'UK_LON', 'JP_TYO', 'CO_BOG']) {
    const result = retrieveLegalChunks(code, 'zzzz qqqq');
    assert.deepEqual(result.detectedCategories, [], code);
    assert.deepEqual(
      result.chunks.map((c) => [c.chunk.id, c.reason]),
      [
        [`${code}.summary`, 'always'],
        [`${code}.securityDeposit`, 'fallback'],
        [`${code}.lateFees`, 'fallback'],
        [`${code}.rentIncreases`, 'fallback'],
        [`${code}.terminationRules`, 'fallback'],
      ],
      code,
    );
  }
});

test('a supporting rule is retrieved only for its own city, whatever the language of the clause', () => {
  for (const rule of SUPPORTING_RULES) {
    for (const { language, lease } of rule.clauses) {
      for (const code of ALL_CITY_CODES) {
        const { chunks } = retriever.retrieveLegalChunks(code, lease);
        const label = `${rule.id}: ${language} in ${code}`;
        assert.ok(chunks.every((c) => c.chunk.cityCode === code), label);
        assert.equal(chunks.some((c) => c.chunk.id === rule.id), code === rule.code, label);
      }
    }
  }
});

test('supporting-rule terms give one result for the accented, uppercase, decomposed, and plain spelling', () => {
  const { detectCategories, retrieveLegalChunks } = retriever;
  const spellings: [string, string][] = [
    ['Wohnungsgeberbestätigung', 'tenant_registration'],
    ['Bürgeramt', 'tenant_registration'],
    ['confirmación del arrendador', 'tenant_registration'],
    ['anexo de estabilización', 'rent_stabilization'],
    ['verificación de crédito', 'fees_and_charges'],
    ['tarifa de solicitud', 'fees_and_charges'],
    ['Untermietvertrag', 'subletting'],
  ];
  for (const [term, category] of spellings) {
    const forms = [term, term.toUpperCase(), term.normalize('NFD'), term.normalize('NFD').replace(/[\u0300-\u036f]/g, '')];
    const expected = detectCategories(term);
    assert.deepEqual(expected.map((d) => d.category), [category], term);
    for (const form of forms) assert.deepEqual(detectCategories(form), expected, form);
  }
  // Short terms keep their word boundaries, and the form number is found in its common spellings.
  assert.deepEqual(detectCategories('dhcrx'), []);
  for (const form of ['DHCR', 'RA-LR1', 'ra lr1', 'RALR1']) {
    assert.deepEqual(detectCategories(form).map((d) => d.category), ['rent_stabilization'], form);
  }

  // The folded words also reach the index terms, so every spelling gives the same chunks and scores.
  const [reference, ...others] = [
    'Wohnungsgeberbestätigung und Untermietvertrag',
    'WOHNUNGSGEBERBESTÄTIGUNG UND UNTERMIETVERTRAG',
    'Wohnungsgeberbestätigung und Untermietvertrag'.normalize('NFD'),
    'wohnungsgeberbestatigung und untermietvertrag',
  ].map((text) => retrieveLegalChunks('DE_BER', text));
  assert.deepEqual([...reference.detectedCategories].sort(), ['subletting', 'tenant_registration']);
  for (const id of ['DE_BER.registrationConfirmation', 'DE_BER.subletting']) {
    const hit = reference.chunks.find((c) => c.chunk.id === id);
    assert.ok(hit, id);
    assert.equal(hit.reason, 'category', id);
    assert.ok(hit.score > 0, id);
  }
  for (const other of others) assert.deepEqual(other, reference);
});

// ---------------------------------------------------------------------------------------------
// New York City rent increases and the Good Cause rent standard
//
// US_NYC.rentIncreases is a core rule. It gives the Good Cause local rent standard (the lesser of
// 10% and local CPI plus five percentage points) as a rebuttable presumption that a court assesses,
// not as an annual cap. It also carries the coverage caveat, keeps rent stabilization a separate
// regime, and names the statute as its source. These checks run the real retriever and
// LeaseAuditPrompt with scripted provider replies. They show that the rule, its source, and its
// citable ID reach the prompt and the result for each kind of increase clause. A scripted reply
// says nothing about whether a model reasons correctly about the law.

interface RentIncreaseClause {
  scenario: string;
  lease: string;
  quote: string; // the excerpt that a finding on this clause would cite
  reason: 'category' | 'bm25'; // how the retriever selects the rule
  alsoRetrieved: string[];
}

const RENT_INCREASE_CLAUSES: RentIncreaseClause[] = [
  {
    scenario: 'a 12% renewal increase with completed significant repairs and higher property taxes',
    lease: 'On renewal the rent increases by 12% to reflect completed significant repairs and higher property taxes.',
    quote: 'the rent increases by 12%',
    reason: 'category',
    alsoRetrieved: ['US_NYC.terminationRules'],
  },
  {
    scenario: 'an increase on a unit whose Good Cause coverage is unknown',
    lease: 'The monthly rent increases by 15% at the start of the next lease term.',
    quote: 'increases by 15%',
    reason: 'category',
    alsoRetrieved: [],
  },
  {
    scenario: 'an increase in a rent-stabilized unit',
    lease: 'This apartment is rent stabilized, and the rent increases by 12% at renewal.',
    quote: 'the rent increases by 12% at renewal',
    reason: 'category',
    alsoRetrieved: ['US_NYC.rentStabilizationRider'],
  },
  {
    scenario: 'a CPI formula',
    lease: 'Each year the rent increases by the local CPI plus 5%, with no ceiling.',
    quote: 'increases by the local CPI plus 5%',
    reason: 'category',
    alsoRetrieved: [],
  },
  {
    // No routing term such as "increase", so the CPI wording of the rule itself has to match.
    scenario: 'a CPI formula with no word that routes to rent increases',
    lease: 'Each year the rent is adjusted by the local CPI plus 5%, with no ceiling.',
    quote: 'adjusted by the local CPI plus 5%',
    reason: 'bm25',
    alsoRetrieved: [],
  },
];

const rentIncreaseChunk = () => {
  const chunk = retriever.getCorpusForCity('US_NYC').find((c) => c.id === RENT_INCREASE_ID);
  assert.ok(chunk, RENT_INCREASE_ID);
  return chunk;
};

test('the rent-increase rule keeps its ID, category, and title, and names the statute as its source', () => {
  const chunk = rentIncreaseChunk();
  assert.equal(chunk.cityCode, 'US_NYC');
  assert.equal(chunk.category, 'rent_increase');
  assert.equal(chunk.title, 'Rent increases');
  assert.equal(chunk.source, RENT_INCREASE_SOURCE);
  assert.equal(new URL(chunk.source).protocol, 'https:');
});

test('the rent-increase rule gives the Good Cause standard as a rebuttable presumption for a court, not an annual cap', () => {
  const { text } = rentIncreaseChunk();
  const distinctions: [string, string][] = [
    ['formula', 'the lesser of 10% or the local CPI inflation rate plus 5 percentage points'],
    ['presumption', 'is presumed unreasonable, but the presumption is rebuttable and is not an absolute cap'],
    ['at or below the standard', 'at or below the standard is not deemed unreasonable under this law, though other laws can still apply'],
    ['court', 'A court decides whether the increase is unreasonable'],
    ['property taxes', "the landlord's property tax expenses and recent increases in them"],
    ['repairs', 'completed significant repairs (cosmetic work does not count'],
    ['not automatically illegal', 'not automatically illegal or void'],
    ['coverage', 'Coverage is not automatic for every market-rate unit'],
    ['stabilized units', 'increases limited to Rent Guidelines Board orders. That regime is separate'],
    ['market-rate notice', 'written notice is required (30/60/90 days depending on size of increase and length of tenancy)'],
  ];
  for (const [name, phrase] of distinctions) assert.ok(text.includes(phrase), `${name}: "${phrase}"`);

  // The old wording called the standard an annual cap, and "CPI + 5%" reads as 5% of CPI.
  assert.doesNotMatch(text, /annual cap/i);
  assert.doesNotMatch(text, /CPI \+ 5%/);
  // The only percentages are the two statutory constants. No year's CPI or threshold is fixed here.
  for (const percentage of text.match(/\d+(?:\.\d+)?\s*%/g) ?? []) assert.ok(['10%', '5%'].includes(percentage), percentage);
});

test('each kind of rent-increase clause retrieves the corrected rule, and it reaches the prompt, the closed list, and the result', async () => {
  const chunk = rentIncreaseChunk();
  for (const { scenario, lease, quote, reason, alsoRetrieved } of RENT_INCREASE_CLAUSES) {
    const { chunks } = retriever.retrieveLegalChunks('US_NYC', lease);
    assert.equal(chunks.find((c) => c.chunk.id === RENT_INCREASE_ID)?.reason, reason, scenario);
    for (const id of alsoRetrieved) assert.ok(chunks.some((c) => c.chunk.id === id), `${scenario}: ${id}`);

    const cited = finding(`Checks ${RENT_INCREASE_ID}`, {
      clauseText: quote,
      category: 'rent_increase',
      severity: 'warning',
      legalReference: RENT_INCREASE_ID,
    });
    providerCalls = [];
    providerHandler = () => completion(modelReply('Rent increase check.', [cited]));
    const result = await leaseAudit.LeaseAuditPrompt(nycListing, lease);

    assert.equal(providerCalls.length, 1, scenario);
    const { system, user } = providerCalls[0];
    assert.equal(user, lease, scenario);
    assert.ok(system.includes(`[${RENT_INCREASE_ID}] ${chunk.title}`), scenario);
    assert.ok(system.includes(chunk.text), scenario);
    assert.ok(system.includes(`(Source: ${RENT_INCREASE_SOURCE})`), scenario);
    const allowed = allowedReferences(system);
    assert.ok(allowed.includes(RENT_INCREASE_ID), scenario);
    assert.ok(allowed.includes('US_NYC.summary'), scenario);
    assert.ok(allowed.every((id) => id.startsWith('US_NYC.')), scenario);
    for (const id of alsoRetrieved) assert.ok(allowed.includes(id), `${scenario}: ${id}`);

    assert.deepEqual(
      result.legalSources.find((s) => s.id === RENT_INCREASE_ID),
      { id: RENT_INCREASE_ID, title: chunk.title, source: RENT_INCREASE_SOURCE },
      scenario,
    );
    assert.deepEqual(result.findings, [verified(cited)], scenario);
    assert.equal(result.findings[0].clauseText, quote, scenario);
  }
});

test('the official source of the rent-increase rule is a link in the clause audit result, beside its title', async () => {
  for (const { scenario, lease, quote } of RENT_INCREASE_CLAUSES) {
    providerHandler = () =>
      completion(
        modelReply('Source check.', [
          finding('Source check', { clauseText: quote, category: 'rent_increase', severity: 'warning', legalReference: RENT_INCREASE_ID }),
        ]),
      );
    const controller = controllerFor(nycListing);
    controller.setClause(lease);
    await controller.submit();
    assert.equal(controller.getState().status, 'success', scenario);

    const markup = renderPanel(controller.getState());
    const entry = rulesChecked(markup)[RENT_INCREASE_ID];
    assert.ok(entry, scenario);
    assert.match(entry, /: Rent increases<a /, scenario);
    assert.match(entry, new RegExp(`<a href="${RENT_INCREASE_SOURCE}"[^>]*rel="noopener noreferrer"`), scenario);
  }
});

test('the rent-increase rule and its source never reach the audit of another city', async () => {
  const otherCodes = ALL_CITY_CODES.filter((code) => code !== 'US_NYC');
  for (const { scenario, lease } of RENT_INCREASE_CLAUSES) {
    for (const code of otherCodes) {
      const { chunks } = retriever.retrieveLegalChunks(code, lease);
      const label = `${code}: ${scenario}`;
      assert.ok(chunks.every((c) => c.chunk.cityCode === code), label);
      assert.ok(chunks.every((c) => c.chunk.id !== RENT_INCREASE_ID && c.chunk.source !== RENT_INCREASE_SOURCE), label);
    }
    for (const listing of [londonListing, berlinListing]) {
      const code = retriever.findLegalContext(listing.cityName)?.code;
      assert.ok(code && otherCodes.includes(code), listing.cityName);
      const label = `${code}: ${scenario}`;
      providerCalls = [];
      providerHandler = () => completion(modelReply('Nothing to report.', []));
      const result = await leaseAudit.LeaseAuditPrompt(listing, lease);

      assert.equal(providerCalls.length, 1, label);
      const { system } = providerCalls[0];
      assert.ok(allowedReferences(system).every((id) => id.startsWith(`${code}.`)), label);
      for (const foreign of ['US_NYC', 'Good Cause', 'nysenate.gov']) assert.ok(!system.includes(foreign), `${label} has no ${foreign}`);
      assert.ok(result.legalSources.every((s) => s.id !== RENT_INCREASE_ID && s.source !== RENT_INCREASE_SOURCE), label);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// London, Tokyo, and Bogota rule corrections
//
// UK_LON.prohibitedPayments is a new general rule on tenant fees. It gives a tenant-requested early
// termination two separate caps: the landlord's loss for a payment to the landlord, and the agent's
// reasonable costs for a payment to a letting agent that arranges it (Schedule 1, paragraph 7).
// UK_LON.securityDeposit,
// JP_TYO.terminationRules, and CO_BOG.securityDeposit keep their IDs and categories and gain the
// statutory conditions they lacked: the 30-day deposit duties, the Article 38 explanation and
// notice for a fixed-term lease, and the Article 15 utility-provider guarantee beside the
// Article 16 ban. Each names an official source. These checks run the real retriever,
// LeaseAuditPrompt, and panel with scripted provider replies. They show that a clause on each
// topic retrieves the rule by default, that the rule text with its distinctions, its source, and
// its citable ID reach the prompt and the result, and that the source is a link. A scripted
// reply, even one that finds nothing, says nothing about whether a model reasons correctly about
// the law.

const FEE_RULE = 'UK_LON.prohibitedPayments';
const LONDON_DEPOSIT_RULE = 'UK_LON.securityDeposit';
const TOKYO_TERMINATION_RULE = 'JP_TYO.terminationRules';
const BOGOTA_DEPOSIT_RULE = 'CO_BOG.securityDeposit';

interface CorrectedRule {
  id: string;
  category: string; // the retrieval category of the chunk
  title: string;
  source: string;
  anchors: string[]; // phrases the rule text must keep, so a trimmed or swapped text fails
}

const CORRECTED_RULES: CorrectedRule[] = [
  {
    id: FEE_RULE,
    category: 'fees_and_charges',
    title: 'Tenant fees and prohibited payments (Tenant Fees Act 2019)',
    source: 'https://www.legislation.gov.uk/ukpga/2019/4/section/1',
    anchors: [
      'a payment is prohibited unless Schedule 1 permits it',
      'an administrative, referencing or similar fee charged for a tenancy is not permitted',
      'Schedule 1 permits only: rent',
      "a tenancy deposit of up to 5 weeks' rent (6 weeks if annual rent is £50,000 or more)",
      "a holding deposit of up to 1 week's rent",
      'for rent more than 14 days late, limited to 3% a year above the Bank of England base rate',
      'a payment on a tenant-requested early termination (Schedule 1, paragraph 7), which has two separate limits',
      "a payment to the landlord in consideration of the termination, up to the landlord's loss",
      "a payment to a letting agent in consideration of arranging the termination, up to the agent's reasonable costs in respect of it",
      "the landlord's loss does not cap the agent's costs, and the agent's costs do not raise the landlord's cap",
      'Both apply only if the tenant requested the termination before the end of a fixed term (any tenancy that is not periodic), or, for a periodic tenancy, without giving the notice required by the tenancy agreement or by law',
      'A termination payment outside those conditions, such as a fee for ending a periodic tenancy on the full required notice, is not permitted',
      'This is not a ban on every charge: a permitted payment within its limit is lawful',
      'but not social housing tenancies or long leases',
    ],
  },
  {
    id: LONDON_DEPOSIT_RULE,
    category: 'security_deposit',
    title: 'Security deposit rules',
    source: 'https://www.legislation.gov.uk/ukpga/2004/34/section/213',
    anchors: [
      "Tenancy deposit capped at 5 weeks of rent (6 weeks if annual rent is £50,000 or more). Holding deposit capped at 1 week of rent",
      'must be dealt with under a government-authorised tenancy deposit scheme',
      "Within 30 days of receiving the deposit, the landlord must meet the scheme's initial requirements",
      "anyone who paid the deposit on the tenant's behalf, the prescribed information about the scheme and the deposit (Housing Act 2004, section 213)",
      "Both 30-day periods run from the landlord's receipt of the deposit, not from signing or from the start of the tenancy",
      'They do not turn other payments, such as rent, into deposits',
    ],
  },
  {
    id: TOKYO_TERMINATION_RULE,
    category: 'termination',
    title: 'Termination, renewal and eviction',
    source: 'https://laws.e-gov.go.jp/law/403AC0000000090',
    anchors: [
      "landlords need 'just cause' and generally 6 months' notice to refuse renewal",
      'only if Article 38 of the Act on Land and Building Leases is met',
      'such as a notarial deed, or in an electronic record, which counts as writing',
      'the landlord must give the tenant a document stating that the lease has no renewal and ends when the term expires, and must explain it to the tenant',
      "With the tenant's consent, the landlord may provide that content electronically instead of on paper",
      'the no-renewal stipulation is void. The whole lease is not automatically void',
      'If the term is 1 year or more',
      'between 1 year and 6 months before the term ends',
      'the landlord cannot rely on the end of the lease against the tenant',
      'only after 6 months have passed from the date of the notice',
      'For a term under 1 year this notice duty does not apply',
    ],
  },
  {
    id: BOGOTA_DEPOSIT_RULE,
    category: 'security_deposit',
    title: 'Security deposit rules',
    source: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=8738',
    anchors: [
      'Article 16 of Ley 820 de 2003 prohibits requiring cash deposits or other real security',
      'under a different name',
      'Personal guarantees (codeudor / coarrendatario) are the usual alternative',
      'Ley 820 has no general ban on paying rent in advance',
      "Article 15 is a narrow exception for utility bills, not for the landlord's own security",
      'secure payment to the utility provider',
      'is given in favour of the provider',
      'two consecutive billing periods',
      "the 'cargo fijo por unidad de consumo' at the average of the last three billing periods plus 50%",
      'The landlord reports the lease to the provider and forwards the constituted guarantee or deposit to it',
      'Receiving it from the tenant in order to forward it is part of that procedure, and keeping it as the landlord\'s own security is not',
      'is not the prohibited landlord deposit',
      "A cash deposit that the landlord keeps as its own security is outside the exception and conflicts with Article 16, even if it is labelled 'utilities'",
      'An amount above the cap is also outside it',
    ],
  },
];

const ruleById = (id: string) => {
  const rule = CORRECTED_RULES.find((r) => r.id === id);
  assert.ok(rule, id);
  return rule;
};
const codeOf = (id: string) => id.slice(0, id.indexOf('.'));
const correctedChunk = (id: string) => {
  const chunk = retriever.getCorpusForCity(codeOf(id)).find((c) => c.id === id);
  assert.ok(chunk, id);
  return chunk;
};

interface CorrectionScenario {
  scenario: string;
  code: string;
  lease: string;
  retrieved: [id: string, reason: 'category' | 'bm25'][]; // corrected rules the default retrieval must include
  cited: { id: string; quote: string; findingCategory: string; severity: ScriptedFinding['severity'] }[];
}

const CORRECTION_SCENARIOS: CorrectionScenario[] = [
  {
    scenario: 'London general administrative fee before signing',
    code: 'UK_LON',
    lease: 'The tenant pays a £400 administrative fee before signing the tenancy agreement.',
    retrieved: [[FEE_RULE, 'category']],
    cited: [{ id: FEE_RULE, quote: '£400 administrative fee', findingCategory: 'fees_and_charges', severity: 'illegal' }],
  },
  {
    scenario: 'London administrative fee in Spanish',
    code: 'UK_LON',
    lease: 'El inquilino pagará una tarifa administrativa de £400 antes de firmar el contrato.',
    retrieved: [[FEE_RULE, 'category']],
    cited: [{ id: FEE_RULE, quote: 'tarifa administrativa de £400', findingCategory: 'fees_and_charges', severity: 'illegal' }],
  },
  {
    scenario: 'London fee beside a security deposit and a holding deposit within the caps',
    code: 'UK_LON',
    lease: 'The tenant pays a £400 administrative fee, a security deposit of five weeks of rent and a holding deposit of one week of rent.',
    retrieved: [[FEE_RULE, 'category'], [LONDON_DEPOSIT_RULE, 'category']],
    cited: [{ id: FEE_RULE, quote: '£400 administrative fee', findingCategory: 'fees_and_charges', severity: 'illegal' }],
  },
  {
    // No routing term such as "administrative fee", so the rule's keywords have to match.
    scenario: 'London referencing fee with no word that routes to fees',
    code: 'UK_LON',
    lease: 'A £150 referencing fee is payable at signing.',
    retrieved: [[FEE_RULE, 'bm25']],
    cited: [{ id: FEE_RULE, quote: '£150 referencing fee', findingCategory: 'fees_and_charges', severity: 'illegal' }],
  },
  {
    scenario: 'London payments that Schedule 1 permits',
    code: 'UK_LON',
    lease: 'Rent is paid monthly. The tenant pays reasonable evidenced costs for a lost key, and interest of 3% above the Bank of England base rate on rent more than 14 days late.',
    retrieved: [[FEE_RULE, 'bm25']],
    cited: [],
  },
  {
    // The two caps are separate. The agent's payment sits inside its own cap, and no landlord loss
    // is needed for it. The finding is info: a scripted reply, not a legal determination.
    scenario: 'London letting agent reasonable costs for a tenant-requested early termination, no landlord loss',
    code: 'UK_LON',
    lease: 'The tenant asked to end this periodic tenancy without giving the full notice required by the tenancy agreement. The tenant pays the letting agent £100 for its reasonable costs of arranging the early termination. The landlord suffers no loss.',
    retrieved: [[FEE_RULE, 'bm25']],
    cited: [
      { id: FEE_RULE, quote: '£100 for its reasonable costs of arranging the early termination', findingCategory: 'fees_and_charges', severity: 'info' },
    ],
  },
  {
    scenario: 'London letting agent charge above its reasonable costs for an early termination',
    code: 'UK_LON',
    lease: 'The tenant asked to end this periodic tenancy without giving the full notice required by the tenancy agreement. The letting agent charges £400 to arrange the early termination, although its reasonable costs are £100.',
    retrieved: [[FEE_RULE, 'bm25']],
    cited: [
      { id: FEE_RULE, quote: 'charges £400 to arrange the early termination', findingCategory: 'fees_and_charges', severity: 'illegal' },
    ],
  },
  {
    scenario: 'London landlord payment above the landlord loss for an early termination',
    code: 'UK_LON',
    lease: "The tenant asked to end this fixed-term tenancy before the end of the term and pays the landlord £3,000. The landlord's actual loss from the termination is £1,200.",
    retrieved: [[FEE_RULE, 'bm25']],
    cited: [
      { id: FEE_RULE, quote: 'pays the landlord £3,000', findingCategory: 'fees_and_charges', severity: 'illegal' },
    ],
  },
  {
    scenario: 'London deposit protection and prescribed information at 90 days',
    code: 'UK_LON',
    lease: 'The landlord will protect the tenancy deposit and supply the prescribed information within 90 days of receipt.',
    retrieved: [[LONDON_DEPOSIT_RULE, 'category']],
    cited: [
      { id: LONDON_DEPOSIT_RULE, quote: 'supply the prescribed information within 90 days of receipt', findingCategory: 'security_deposit', severity: 'illegal' },
    ],
  },
  {
    scenario: 'London administrative fee and 90-day protection in one clause',
    code: 'UK_LON',
    lease: 'The tenant pays a £400 administrative fee before signing. The landlord will protect the tenancy deposit and supply the prescribed information within 90 days of receipt.',
    retrieved: [[LONDON_DEPOSIT_RULE, 'category'], [FEE_RULE, 'category']],
    cited: [
      { id: FEE_RULE, quote: '£400 administrative fee', findingCategory: 'fees_and_charges', severity: 'illegal' },
      { id: LONDON_DEPOSIT_RULE, quote: 'supply the prescribed information within 90 days of receipt', findingCategory: 'security_deposit', severity: 'illegal' },
    ],
  },
  {
    scenario: 'Tokyo two-year Teiki lease with no advance explanation and no notice',
    code: 'JP_TYO',
    lease: 'This is a Teiki Shakuya fixed-term lease of 2 years that ends on 31 March 2028 with no renewal. The landlord gave no advance explanation and will send no notice of expiry.',
    retrieved: [[TOKYO_TERMINATION_RULE, 'category']],
    cited: [{ id: TOKYO_TERMINATION_RULE, quote: 'will send no notice of expiry', findingCategory: 'termination', severity: 'warning' }],
  },
  {
    scenario: 'Tokyo two-year Teiki lease with an explanation and a notice in the statutory window',
    code: 'JP_TYO',
    lease: 'This is a Teiki Shakuya fixed-term lease of 2 years. Before signing, the landlord handed the tenant a written explanation that the lease has no renewal and ends on 31 March 2028, and the landlord will send a notice of expiry between 1 year and 6 months before that date.',
    retrieved: [[TOKYO_TERMINATION_RULE, 'category']],
    cited: [
      { id: TOKYO_TERMINATION_RULE, quote: 'will send a notice of expiry between 1 year and 6 months before that date', findingCategory: 'termination', severity: 'info' },
    ],
  },
  {
    // No routing term such as "renewal" or "notice", so the words of the rule itself have to match.
    scenario: 'Tokyo fixed-term clause with no word that routes to termination',
    code: 'JP_TYO',
    lease: 'The fixed term is 2 years, the lease expires on 31 March 2028 and will not be extended.',
    retrieved: [[TOKYO_TERMINATION_RULE, 'bm25']],
    cited: [{ id: TOKYO_TERMINATION_RULE, quote: 'will not be extended', findingCategory: 'termination', severity: 'warning' }],
  },
  {
    scenario: 'Bogota cash deposit for utilities that the landlord keeps',
    code: 'CO_BOG',
    lease: 'El arrendatario entregará al arrendador un depósito en efectivo de $1.500.000 por servicios públicos, que el arrendador conservará hasta la entrega del inmueble.',
    retrieved: [[BOGOTA_DEPOSIT_RULE, 'category']],
    cited: [
      { id: BOGOTA_DEPOSIT_RULE, quote: 'depósito en efectivo de $1.500.000 por servicios públicos', findingCategory: 'security_deposit', severity: 'illegal' },
    ],
  },
  {
    scenario: 'Bogota guarantee in favour of the utility provider',
    code: 'CO_BOG',
    lease: 'El arrendatario constituirá una garantía a favor de la empresa de servicios públicos domiciliarios por el equivalente a dos períodos consecutivos de facturación, y el arrendador la remitirá a la empresa.',
    retrieved: [[BOGOTA_DEPOSIT_RULE, 'category']],
    cited: [
      { id: BOGOTA_DEPOSIT_RULE, quote: 'garantía a favor de la empresa de servicios públicos domiciliarios', findingCategory: 'security_deposit', severity: 'info' },
    ],
  },
  {
    scenario: 'Bogota cash deposit for utilities in English',
    code: 'CO_BOG',
    lease: 'The tenant must pay the landlord a cash deposit of COP 1,500,000 for utilities, which the landlord keeps.',
    retrieved: [[BOGOTA_DEPOSIT_RULE, 'category']],
    cited: [{ id: BOGOTA_DEPOSIT_RULE, quote: 'cash deposit of COP 1,500,000 for utilities', findingCategory: 'security_deposit', severity: 'illegal' }],
  },
];

const scriptedFindings = (cited: CorrectionScenario['cited']) =>
  cited.map((c) =>
    finding(`Checks ${c.id}`, { clauseText: c.quote, category: c.findingCategory, severity: c.severity, legalReference: c.id }),
  );

test('each corrected rule keeps its ID, category, and title, names an official source, and states its statutory distinctions', () => {
  for (const rule of CORRECTED_RULES) {
    const chunk = correctedChunk(rule.id);
    assert.equal(chunk.cityCode, codeOf(rule.id), rule.id);
    assert.equal(chunk.category, rule.category, rule.id);
    assert.equal(chunk.title, rule.title, rule.id);
    assert.equal(chunk.source, rule.source, rule.id);
    assert.equal(new URL(chunk.source).protocol, 'https:', rule.id);
    for (const anchor of rule.anchors) assert.ok(chunk.text.includes(anchor), `${rule.id} keeps "${anchor}"`);
  }

  // The three corrected rules keep their IDs, and London gains one general fee rule after its four.
  const core = ['summary', 'securityDeposit', 'lateFees', 'rentIncreases', 'terminationRules'];
  const idsOf = (code: string) => retriever.getCorpusForCity(code).map((c) => c.id);
  assert.deepEqual(idsOf('UK_LON'), [...core.map((id) => `UK_LON.${id}`), FEE_RULE]);
  assert.deepEqual(idsOf('JP_TYO'), core.map((id) => `JP_TYO.${id}`));
  assert.deepEqual(idsOf('CO_BOG'), core.map((id) => `CO_BOG.${id}`));

  // No blanket fee cap: the only amounts are the two Schedule 1 constants.
  for (const amount of correctedChunk(FEE_RULE).text.match(/£[\d,]+/g) ?? []) assert.ok(['£50,000', '£50'].includes(amount), amount);
  // Early termination has two caps, one per payee. The landlord's loss caps only the landlord's payment,
  // so the old wording that gave the whole item one landlord-loss cap must not return.
  const fees = correctedChunk(FEE_RULE).text;
  assert.equal(fees.match(/up to the landlord's loss/g)?.length, 1);
  assert.equal(fees.match(/up to the agent's reasonable costs/g)?.length, 1);
  assert.doesNotMatch(fees, /early termination, up to the landlord's loss/);
  // The deposit duties run for 30 days from receipt. Nothing here accepts the 90 days of the clause.
  assert.doesNotMatch(correctedChunk(LONDON_DEPOSIT_RULE).text, /\b90\b/);
  // A fixed-term lease does not end unconditionally, and nothing here makes paper the only form.
  assert.doesNotMatch(correctedChunk(TOKYO_TERMINATION_RULE).text, /expire on the stated date without automatic renewal/);
  assert.doesNotMatch(correctedChunk(TOKYO_TERMINATION_RULE).text, /paper[- ]only|only on paper/i);
  // The only figure for Bogota is the 50% that the statute adds to its average. No cash amount is set.
  const bogota = correctedChunk(BOGOTA_DEPOSIT_RULE).text;
  assert.deepEqual(bogota.match(/\d+(?:\.\d+)?\s*%/g), ['50%']);
  assert.doesNotMatch(bogota, /\$|COP/);
  // Ley 820 has no rule against prepaid rent, so the rule does not claim one.
  assert.doesNotMatch(bogota, /advance payments?[^.]*not allowed|beyond the current rental period/i);
});

test('a clause on each corrected topic retrieves its rule by default, within the default budget and from its own city only', () => {
  for (const { scenario, code, lease, retrieved } of CORRECTION_SCENARIOS) {
    const { chunks, detectedCategories } = retriever.retrieveLegalChunks(code, lease);
    assert.ok(chunks.length <= 5, `${scenario} fits the default topK`);
    assert.ok(chunks.reduce((sum, c) => sum + c.chunk.text.length, 0) <= 6000, `${scenario} fits the default maxChars`);
    assert.ok(chunks.every((c) => c.chunk.cityCode === code), scenario);
    assert.ok(chunks.some((c) => c.chunk.id === `${code}.summary`), scenario);
    for (const [id, reason] of retrieved) {
      assert.equal(chunks.find((c) => c.chunk.id === id)?.reason, reason, `${scenario}: ${id}`);
      if (reason === 'category') {
        assert.ok(detectedCategories.includes(ruleById(id).category as (typeof detectedCategories)[number]), `${scenario}: ${id}`);
      }
    }
    for (const other of ALL_CITY_CODES.filter((c) => c !== code)) {
      const { chunks: foreign } = retriever.retrieveLegalChunks(other, lease);
      assert.ok(foreign.every((c) => c.chunk.cityCode === other), `${scenario} in ${other}`);
      for (const [id] of retrieved) assert.ok(!foreign.some((c) => c.chunk.id === id), `${scenario}: ${id} in ${other}`);
    }
  }
});

test('each corrected rule reaches the prompt with its distinctions and the closed citation list, and its source reaches the verified result', async () => {
  for (const { scenario, code, lease, retrieved, cited } of CORRECTION_SCENARIOS) {
    const findings = scriptedFindings(cited);
    providerCalls = [];
    providerHandler = () => completion(modelReply('Corrected rule check.', findings));
    const result = await leaseAudit.LeaseAuditPrompt(listingFor(code), lease);

    assert.equal(providerCalls.length, 1, scenario);
    const { system, user } = providerCalls[0];
    assert.equal(user, lease, scenario);
    const allowed = allowedReferences(system);
    assert.deepEqual(allowed, retriever.retrieveLegalChunks(code, lease).chunks.map((c) => c.chunk.id), scenario);
    assert.ok(allowed.every((id) => id.startsWith(`${code}.`)), scenario);
    for (const other of ALL_CITY_CODES.filter((c) => c !== code)) {
      assert.ok(!system.includes(`${other}.`), `${scenario} has no ${other} rule`);
    }

    for (const [id] of retrieved) {
      const rule = ruleById(id);
      assert.ok(allowed.includes(id), `${scenario}: ${id}`);
      assert.ok(system.includes(`[${id}] ${rule.title}`), `${scenario}: ${id}`);
      assert.ok(system.includes(correctedChunk(id).text), `${scenario}: ${id}`);
      assert.ok(system.includes(`(Source: ${rule.source})`), `${scenario}: ${id}`);
      for (const anchor of rule.anchors) assert.ok(system.includes(anchor), `${scenario}: ${id} keeps "${anchor}"`);
      assert.deepEqual(
        result.legalSources.find((s) => s.id === id),
        { id, title: rule.title, source: rule.source },
        `${scenario}: ${id}`,
      );
    }
    assert.deepEqual(result.findings, findings.map((f) => verified(f)), scenario);
    assert.equal(result.isValid, !cited.some((c) => c.severity === 'illegal'), scenario);
  }
});

test('the official source of each retrieved corrected rule is a link in the clause audit result, and rules without a source stay unlinked', async () => {
  for (const { scenario, code, lease, retrieved, cited } of CORRECTION_SCENARIOS) {
    providerHandler = () => completion(modelReply('Source check.', scriptedFindings(cited)));
    const controller = controllerFor(listingFor(code));
    controller.setClause(lease);
    await controller.submit();
    assert.equal(controller.getState().status, 'success', scenario);

    const entries = rulesChecked(renderPanel(controller.getState(), listingFor(code).cityName));
    for (const [id] of retrieved) {
      const entry = entries[id];
      assert.ok(entry, `${scenario}: ${id} is listed`);
      assert.ok(entry.includes(`<a href="${ruleById(id).source}"`), `${scenario}: ${id}`);
      assert.match(entry, /rel="noopener noreferrer"/, `${scenario}: ${id}`);
    }
    // A rule that has no source, such as the London late-fee rule that rides along, gets no link.
    for (const { chunk } of retriever.retrieveLegalChunks(code, lease).chunks) {
      if (chunk.source) continue;
      assert.ok(entries[chunk.id], `${scenario}: ${chunk.id} is listed`);
      assert.doesNotMatch(entries[chunk.id], /<a |href=/, `${scenario}: ${chunk.id}`);
    }
  }
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
