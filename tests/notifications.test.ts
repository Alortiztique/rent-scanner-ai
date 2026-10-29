// Offline checks. Static rendering does not exercise browser focus, Escape, or layout.
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import type { AlertPreferences, Listing } from '../src/types/index.ts';

let server: ViteDevServer;
let notifications: typeof import('../src/services/notifications.ts');
let modal: typeof import('../src/components/DealAlertsModal.tsx');
let header: typeof import('../src/components/Header.tsx');
let app: typeof import('../src/App.tsx');
let listings: Listing[];
const storage = new Map<string, string>();
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalFetch = globalThis.fetch;
const key = 'rentscanner_alert_preferences';
const preferences: AlertPreferences = { cityId: 'nyc', maxPriceLocal: null, minDealScore: 95, channel: 'telegram' };

before(async () => {
  globalThis.fetch = () => { throw new Error('Real network access is disabled in notification tests'); };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (name: string) => storage.get(name) ?? null,
    setItem: (name: string, value: string) => { storage.set(name, value); },
  } });
  server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, envDir: false,
    appType: 'custom', logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true },
  });
  notifications = await server.ssrLoadModule('/src/services/notifications.ts');
  modal = await server.ssrLoadModule('/src/components/DealAlertsModal.tsx');
  header = await server.ssrLoadModule('/src/components/Header.tsx');
  app = await server.ssrLoadModule('/src/App.tsx');
  ({ MOCK_LISTINGS: listings } = await server.ssrLoadModule('/src/data/mockListings.ts'));
});

beforeEach(() => storage.clear());
after(async () => {
  globalThis.fetch = originalFetch;
  if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
  else Reflect.deleteProperty(globalThis, 'localStorage');
  await server?.close();
});

const renderPanel = (defaultCityId = 'nyc') => renderToStaticMarkup(createElement(modal.DealAlertsModal, {
  isOpen: true, onClose: () => {}, defaultCityId, listings,
}));

test('preview filters use the selected city, local currency budget and inclusive score and price boundaries', () => {
  const nyc = listings.find((listing) => listing.id === 'nyc-sublet-01')!;
  assert.ok(nyc);
  const higher = { ...nyc, id: 'higher', dealScore: 99, priceLocal: nyc.priceLocal + 1 };
  const input = [nyc, higher, ...listings.filter((listing) => listing.cityId !== 'nyc')];
  const capped = { ...preferences, maxPriceLocal: nyc.priceLocal, minDealScore: nyc.dealScore };
  assert.equal(notifications.findAlertPreview(input, capped)?.id, nyc.id);
  assert.equal(notifications.findAlertPreview(input, { ...capped, maxPriceLocal: nyc.priceLocal - 1 }), undefined);
  assert.equal(notifications.findAlertPreview(input, preferences)?.id, higher.id);
  assert.equal(input[0], nyc, 'selection does not reorder the feed');
  assert.equal(notifications.findAlertPreview(input, { ...preferences, cityId: 'berlin', minDealScore: 100 }), undefined);
});

test('an unpriced search result or invalid price cannot become a sample deal', () => {
  const listing = listings[0];
  for (const priceLocal of [NaN, Infinity, -1]) {
    assert.equal(notifications.findAlertPreview([{ ...listing, priceLocal }], preferences), undefined);
  }
  const unpriced = { cityId: 'nyc', kind: 'scout', title: 'Unknown price' } as unknown as Listing;
  assert.equal(notifications.findAlertPreview([unpriced], preferences), undefined);
});

test('saved preview settings round-trip, omit old delivery targets, and never indicate a subscription', () => {
  const saved = { ...preferences, maxPriceLocal: 1250, channel: 'whatsapp' as const, targetChatOrChannel: 'old-target' };
  assert.equal(notifications.saveAlertPreferences(saved), true);
  assert.deepEqual(notifications.getAlertPreferences('berlin'), {
    cityId: 'nyc', maxPriceLocal: 1250, minDealScore: 95, channel: 'whatsapp',
  });
  assert.doesNotMatch(storage.get(key)!, /target|subscribed|enabled/);
});

test('missing, corrupt and invalid stored settings fall back to the current city', () => {
  for (const value of [undefined, 'not json', 'null', '{}',
    JSON.stringify({ ...preferences, cityId: 'unknown' }),
    JSON.stringify({ ...preferences, maxPriceLocal: -1 }),
    JSON.stringify({ ...preferences, maxPriceLocal: '1250' }),
    JSON.stringify({ ...preferences, minDealScore: 101 }),
    JSON.stringify({ ...preferences, minDealScore: 94 }),
    JSON.stringify({ ...preferences, channel: 'email' }),
  ]) {
    if (value === undefined) storage.delete(key);
    else storage.set(key, value);
    const defaults = notifications.getAlertPreferences('berlin');
    assert.equal(defaults.cityId, 'berlin');
    assert.equal(defaults.maxPriceLocal, null);
    assert.equal(defaults.minDealScore, 95);
  }
  storage.clear();
  assert.equal(notifications.getAlertPreferences('all').cityId, 'bogota');
  assert.equal(notifications.saveAlertPreferences({ ...preferences, maxPriceLocal: Infinity }), false);
});

test('blocked browser storage leaves previews usable and reports that saving failed', () => {
  const workingStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Blocked'); } });
  try {
    assert.equal(notifications.getAlertPreferences('tokyo').cityId, 'tokyo');
    assert.equal(notifications.saveAlertPreferences(preferences), false);
    assert.match(renderPanel('tokyo'), /Preview a sample alert/);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', workingStorage);
  }
});

test('both channel previews label their data and make no delivery or verification claim', () => {
  for (const channel of ['telegram', 'whatsapp'] as const) {
    const message = notifications.formatDealAlert(listings[0], channel);
    assert.match(message, /DEMO ALERT/);
    assert.ok(message.includes(channel.toUpperCase()));
    assert.match(message, /Sample data\. Not a live listing or a delivered message\./);
    assert.ok(message.includes(listings[0].sourceUrl));
    assert.ok(message.includes(listings[0].nemotronAudit.leaseClauseSummary));
    assert.doesNotMatch(message, /Verified Lease|Audited by|delivered at/i);
  }
});

test('the panel names its dialog and controls and links to Telegram without passing local filters or user data', () => {
  const markup = renderPanel();
  assert.match(markup, /<dialog[^>]*aria-labelledby="deal-alerts-heading"/);
  assert.match(markup, /aria-label="Close deal alerts"/);
  assert.match(markup, /Maximum monthly rent \(USD\)/);
  assert.match(markup, /SAVE PREVIEW SETTINGS ON THIS DEVICE/);
  assert.match(markup, /do not send messages or change Telegram settings/);
  assert.ok(markup.includes(`href="${notifications.TELEGRAM_BOT_URL}"`));
  assert.equal(new URL(notifications.TELEGRAM_BOT_URL).searchParams.get('start'), 'web');
  assert.doesNotMatch(markup, /api\.telegram\.org|chat_id|bot token|subscribed successfully/i);
  assert.match(renderPanel('bogota'), /Maximum monthly rent \(COP\)/);
  const closed = renderToStaticMarkup(createElement(modal.DealAlertsModal, {
    isOpen: false, onClose: () => {}, defaultCityId: 'nyc', listings,
  }));
  assert.equal(closed, '');
});

test('stored channel and budget render an honest WhatsApp or empty preview', () => {
  notifications.saveAlertPreferences({ ...preferences, channel: 'whatsapp', maxPriceLocal: 0 });
  const markup = renderPanel();
  assert.match(markup, /WhatsApp delivery is not connected/);
  assert.match(markup, /No demo listing matches these preview settings/);
  assert.match(markup, /value="0"/);
  assert.doesNotMatch(markup, /RENTSCANNER \/\/ WHATSAPP DEMO ALERT/);
});

function elements(node: ReactNode): ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<{ children?: ReactNode }>;
  return [element, ...elements(element.props.children)];
}

test('the visible header action calls its alert opener, and App exposes it', () => {
  let opened = false;
  const tree = header.Header({
    onOpenTeamTasks: () => {}, onOpenLiveScout: () => {}, onOpenAlerts: () => { opened = true; },
  });
  const action = elements(tree).find((element) => element.type === 'button' && element.props['aria-haspopup'] === 'dialog');
  assert.ok(action);
  action.props.onClick();
  assert.equal(opened, true);
  const markup = renderToStaticMarkup(createElement(app.App));
  assert.match(markup, /DEAL ALERTS/);
  assert.doesNotMatch(markup, /id="deal-alerts-heading"/, 'the dialog starts closed');
});
