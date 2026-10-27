// Offline checks for the dossier clause audit (src/services/clauseAudit.ts and
// src/components/ClauseAuditPanel.tsx). The clause audit controller runs the real
// LeaseAuditPrompt, legal retrieval, and Nebius transport against a fake provider: the global
// fetch is replaced before any app module loads, answers only for the fake .invalid base URL,
// and throws for anything else, so no real network call can happen. The API key is a placeholder.
// The app modules need Vite's transform (extensionless imports, import.meta.env, TSX), so they
// load through an in-process Vite SSR loader that reads no .env file.
// These checks cover state handling, request wiring, and rendering. They do not establish that
// any legal conclusion is correct.
// Run: node --experimental-strip-types --test tests/clause-audit.test.ts
import { after, before, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import type { Listing, ReAuditResult } from '../src/types/index.ts';
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

function modelReply(summary: string, findings: ScriptedFinding[]) {
  return JSON.stringify({
    language: 'English',
    summary,
    findings: findings.map((f) => ({
      category: 'security_deposit',
      severity: 'illegal',
      issue: 'Exceeds the cap in the retrieved provision.',
      legalReference: 'US_NYC.securityDeposit',
      suggestedRevision: 'Tenant pays a security deposit of no more than one month of rent.',
      ...f,
    })),
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
type PanelModule = typeof import('../src/components/ClauseAuditPanel.tsx');
type ModalModule = typeof import('../src/components/ListingModal.tsx');

let server: ViteDevServer;
let clauseAudit: ClauseAuditModule;
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
