// Offline checks for the illustrative AGI and gross-pay labor-hours calculator
// (src/utils/fairRentCalculator.ts), the per-city gross pay defaults in src/data/cities.ts, and
// their use on the bundled demo fixtures. No network, provider, or .env file is involved.
// The calculator imports only types, so it loads directly under strip-types. The data modules
// need Vite's transform (extensionless imports), so they load through an in-process Vite SSR
// loader that reads no .env file, like tests/clause-audit.test.ts.
// These checks cover arithmetic, validation, the wage snapshot, and the fixture conversion.
// They also render the real ListingCard, ListingModal, and App with react-dom/server, which gives
// static markup only. Markup checks show what is displayed for a given state. They do not click,
// type, focus, or press Escape, and they cannot check layout. The handler wiring checks render
// the pay control inside a server render (it uses a ref hook), then invoke the props it passes
// down. That checks the callback contract and that restoring the default asks the field for
// focus, but it runs no browser: whether focus really lands, how a number input reports
// unfinished text, and whether very large values wrap were checked by hand in a real browser, not here.
// App's own state updates and the dialog focus behavior are not exercised here either.
// None of this establishes that any demo reference rent or minimum wage is current in law.
// Run: node --experimental-strip-types --test tests/fair-rent-calculator.test.ts
import { after, before, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import type { City, GrossPayOverrides, Listing, ScoutListing } from '../src/types/index.ts';
import {
  TENANT_PROTECTION_FACTOR,
  calculateAgi,
  calculateListingFairRent,
  calculateWorkingHours,
  demoReferenceRentLocal,
  displayedSign,
  formatOneDecimal,
  parseGrossPayInput,
  resolveGrossPay,
  setGrossPayOverride,
} from '../src/utils/fairRentCalculator.ts';

// Placeholders for the app's build-time settings. Vite reads them from the process environment
// because the loader below is told to read no .env file. The key is not a real key.
process.env.VITE_NEBIUS_API_KEY = 'offline-test-placeholder-not-a-key';
process.env.VITE_NEBIUS_BASE_URL = 'https://nebius.invalid/v1';

globalThis.fetch = (() => {
  throw new Error('real network access is disabled in fair-rent tests');
}) as typeof fetch;

for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  mock.method(console, method, () => {});
}

type CardModule = typeof import('../src/components/ListingCard.tsx');
type ModalModule = typeof import('../src/components/ListingModal.tsx');
type MetricsModule = typeof import('../src/components/FairRentMetrics.tsx');
type AppModule = typeof import('../src/App.tsx');

let server: ViteDevServer;
let CITIES: City[];
let MOCK_LISTINGS: Listing[];
let card: CardModule;
let modal: ModalModule;
let metricsModule: MetricsModule;
let app: AppModule;

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
  ({ CITIES } = (await server.ssrLoadModule('/src/data/cities.ts')) as { CITIES: City[] });
  ({ MOCK_LISTINGS } = (await server.ssrLoadModule('/src/data/mockListings.ts')) as { MOCK_LISTINGS: Listing[] });
  card = (await server.ssrLoadModule('/src/components/ListingCard.tsx')) as CardModule;
  modal = (await server.ssrLoadModule('/src/components/ListingModal.tsx')) as ModalModule;
  metricsModule = (await server.ssrLoadModule('/src/components/FairRentMetrics.tsx')) as MetricsModule;
  app = (await server.ssrLoadModule('/src/App.tsx')) as AppModule;
});

after(async () => {
  mock.restoreAll();
  await server.close();
});

function near(actual: number | null | undefined, expected: number, message?: string) {
  assert.equal(typeof actual, 'number', message);
  assert.ok(Math.abs((actual as number) - expected) < 1e-9, `${message ?? ''} expected ${expected}, got ${actual}`);
}

const cityById = (id: string) => {
  const city = CITIES.find((c) => c.id === id);
  assert.ok(city, `city ${id}`);
  return city;
};
const listingById = (id: string) => {
  const listing = MOCK_LISTINGS.find((l) => l.id === id);
  assert.ok(listing, `fixture ${id}`);
  return listing;
};

// ---------------------------------------------------------------------------------------------
// Acceptance examples

test('the neutral tenant protection factor is fixed at 1.0', () => {
  assert.equal(TENANT_PROTECTION_FACTOR, 1);
});

test('asking 1000, reference 2000, pay 20: AGI 50, 50 h vs 100 h, 50 fewer hours', () => {
  near(calculateAgi(1000, 2000), 50);
  const hours = calculateWorkingHours(1000, 2000, 20);
  assert.ok(hours);
  near(hours.asking, 50);
  near(hours.reference, 100);
  near(hours.difference, 50);
});

test('asking 2500, reference 2000, pay 20: negative AGI and negative difference are preserved', () => {
  near(calculateAgi(2500, 2000), -25);
  const hours = calculateWorkingHours(2500, 2000, 20);
  assert.ok(hours);
  near(hours.asking, 125);
  near(hours.reference, 100);
  near(hours.difference, -25);
  assert.equal(displayedSign(hours.difference), -1);
  assert.equal(formatOneDecimal(calculateAgi(2500, 2000) as number), '-25.0');
});

test('asking equal to the reference is parity: AGI 0, equal hours, no negative zero, no gain', () => {
  const agi = calculateAgi(2000, 2000);
  assert.ok(Object.is(agi, 0), 'AGI is a plain zero');
  const hours = calculateWorkingHours(2000, 2000, 20);
  assert.ok(hours);
  assert.equal(hours.asking, hours.reference);
  assert.ok(Object.is(hours.difference, 0), 'difference is a plain zero');
  assert.equal(displayedSign(hours.difference), 0);
  assert.equal(formatOneDecimal(hours.difference), '0.0');
});

test('zero asking rent is valid with a known reference: AGI 100, 0 h, full reference hours', () => {
  near(calculateAgi(0, 2000), 100);
  const hours = calculateWorkingHours(0, 2000, 20);
  assert.ok(hours);
  near(hours.asking, 0);
  near(hours.reference, 100);
  near(hours.difference, 100);
});

test('AGI does not depend on pay: invalid pay hides the hours and leaves AGI unchanged', () => {
  for (const pay of [undefined, null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(calculateWorkingHours(1000, 2000, pay), null, `pay ${String(pay)}`);
  }
  near(calculateAgi(1000, 2000), 50);
});

test('the NYC fixture reproduces the contract numbers and displays 55.4, 73.5 h, 164.7 h, 91.2 fewer', () => {
  const nyc = listingById('nyc-sublet-01');
  assert.equal(nyc.priceLocal, 1250);
  assert.equal(nyc.originalMarketPriceUsd, 2800);
  const result = calculateListingFairRent(nyc, cityById('nyc').grossPay);
  assert.equal(result.referenceRentLocal, 2800);
  near(result.agi, 55.357142857142854);
  assert.equal(result.pay.status, 'default');
  assert.ok(result.hours);
  near(result.hours.asking, 1250 / 17);
  near(result.hours.reference, 2800 / 17);
  near(result.hours.difference, (2800 - 1250) / 17);
  assert.equal(formatOneDecimal(result.agi as number), '55.4');
  assert.equal(formatOneDecimal(result.hours.asking), '73.5');
  assert.equal(formatOneDecimal(result.hours.reference), '164.7');
  assert.equal(formatOneDecimal(result.hours.difference), '91.2');
  assert.equal(displayedSign(result.hours.difference), 1);
});

// ---------------------------------------------------------------------------------------------
// Validation and non-finite results

test('invalid asking rent makes every dependent metric unavailable', () => {
  for (const asking of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '100' as unknown as number]) {
    assert.equal(calculateAgi(asking, 2000), null, `AGI for ${String(asking)}`);
    assert.equal(calculateWorkingHours(asking, 2000, 20), null, `hours for ${String(asking)}`);
  }
});

test('an invalid reference makes every dependent metric unavailable', () => {
  for (const reference of [0, -2000, Number.NaN, Number.POSITIVE_INFINITY, undefined as unknown as number]) {
    assert.equal(calculateAgi(1000, reference), null, `AGI for ${String(reference)}`);
    assert.equal(calculateWorkingHours(1000, reference, 20), null, `hours for ${String(reference)}`);
  }
});

test('overflowing derived values are unavailable, not Infinity', () => {
  assert.equal(calculateAgi(Number.MAX_VALUE, 1), null);
  assert.equal(calculateAgi(Number.MAX_VALUE, Number.MIN_VALUE), null);
  assert.equal(calculateWorkingHours(Number.MAX_VALUE, Number.MAX_VALUE, 1e-10), null);
  assert.equal(calculateWorkingHours(1, 1, Number.MIN_VALUE), null);
  // A large but representable result is kept.
  const hours = calculateWorkingHours(1e300, 2e300, 1);
  assert.ok(hours);
  assert.ok(Number.isFinite(hours.difference));
  // Output that is not finite is never formatted as a number.
  assert.equal(formatOneDecimal(Number.NaN), 'n/a');
  assert.equal(formatOneDecimal(Number.POSITIVE_INFINITY), 'n/a');
});

test('nothing is rounded before a difference is taken', () => {
  // 14.24 h and 28.66 h round to 14.2 and 28.7, whose difference would read 14.5. The true
  // difference is 14.42, which displays as 14.4.
  const hours = calculateWorkingHours(14.24, 28.66, 1);
  assert.ok(hours);
  assert.equal(hours.difference, hours.reference - hours.asking);
  assert.equal(formatOneDecimal(hours.asking), '14.2');
  assert.equal(formatOneDecimal(hours.reference), '28.7');
  assert.equal(formatOneDecimal(hours.difference), '14.4');
  // AGI is likewise computed from the exact ratio.
  assert.equal(calculateAgi(1250, 2800), 100 * (1 - 1250 / 2800) * 1.0);
});

test('a value that rounds to 0.0 reads as parity and never as -0.0', () => {
  assert.equal(formatOneDecimal(-0.04), '0.0');
  assert.equal(formatOneDecimal(0.04), '0.0');
  assert.equal(formatOneDecimal(-0), '0.0');
  assert.equal(formatOneDecimal(-0.049999), '0.0');
  assert.equal(displayedSign(-0.04), 0);
  assert.equal(displayedSign(0.04), 0);
  assert.equal(displayedSign(0.06), 1);
  assert.equal(displayedSign(-0.06), -1);
  assert.equal(formatOneDecimal(-0.06), '-0.1');
  assert.equal(formatOneDecimal(-0.05), '-0.1', 'half rounds away from zero, so it is not parity');
  assert.equal(formatOneDecimal(1234.56), '1,234.6');
  assert.equal(formatOneDecimal(-1234.56), '-1,234.6');
  assert.equal(displayedSign(Number.NaN), 0);
});

test('the calculator loads and formats where Intl rejects signDisplay "negative" (Firefox 114 and 115)', async () => {
  // The build targets Firefox 114, which throws a RangeError for that signDisplay value (added in 116).
  // A module-scope formatter using it would stop the whole app from loading, so import a fresh copy
  // of the module (the query string makes it a new instance) while the constructor rejects it.
  const NativeNumberFormat = Intl.NumberFormat;
  class OldNumberFormat extends NativeNumberFormat {
    constructor(locales?: string | string[], options?: Intl.NumberFormatOptions) {
      if (options?.signDisplay === 'negative') {
        throw new RangeError('Value negative out of range for Intl.NumberFormat options property signDisplay');
      }
      super(locales, options);
    }
  }
  Intl.NumberFormat = OldNumberFormat as typeof Intl.NumberFormat;
  try {
    const fresh = (await import('../src/utils/fairRentCalculator.ts?old-intl')) as typeof import('../src/utils/fairRentCalculator.ts');
    assert.notEqual(fresh.formatOneDecimal, formatOneDecimal, 'a separate module instance was loaded');
    assert.equal(fresh.formatOneDecimal(-25), '-25.0');
    assert.equal(fresh.formatOneDecimal(-0.04), '0.0');
    assert.equal(fresh.formatOneDecimal(-0), '0.0');
    assert.equal(fresh.formatOneDecimal(0.04), '0.0');
    assert.equal(fresh.formatOneDecimal(-0.06), '-0.1');
    assert.equal(fresh.formatOneDecimal(-1234.56), '-1,234.6');
    assert.equal(fresh.displayedSign(-0.04), 0);
    assert.equal(fresh.displayedSign(-0.06), -1);
  } finally {
    Intl.NumberFormat = NativeNumberFormat;
  }
});

// ---------------------------------------------------------------------------------------------
// Pay text and per-city overrides

test('parseGrossPayInput accepts positive decimals, with or without an exponent, and nothing else', () => {
  assert.equal(parseGrossPayInput('17'), 17);
  assert.equal(parseGrossPayInput(' 12.71 '), 12.71);
  assert.equal(parseGrossPayInput('.5'), 0.5);
  assert.equal(parseGrossPayInput('7.'), 7);
  // A number input reports exponent notation as typed, so it is accepted on purpose.
  assert.equal(parseGrossPayInput('1e2'), 100);
  assert.equal(parseGrossPayInput('1E2'), 100);
  assert.equal(parseGrossPayInput('2.5e-3'), 0.0025);
  assert.equal(parseGrossPayInput('1e-320'), 1e-320, 'a tiny positive denormal is still a positive finite pay');
  for (const text of ['', '   ', 'abc', '-1', '0', '0.0', '0e5', '1,5', '0x10', 'Infinity', 'NaN', '1e999', '1e', '12abc', '+5', '1 2']) {
    assert.equal(parseGrossPayInput(text), null, JSON.stringify(text));
  }
  assert.equal(parseGrossPayInput(17 as unknown as string), null);
});

test('resolveGrossPay uses the default only when no override exists', () => {
  const nyc = cityById('nyc').grossPay;
  assert.deepEqual(resolveGrossPay(nyc, undefined), { status: 'default', hourly: 17 });
  assert.deepEqual(resolveGrossPay(nyc, '25'), { status: 'custom', hourly: 25 });
  // Clearing or breaking the field must not silently bring the default back.
  assert.deepEqual(resolveGrossPay(nyc, ''), { status: 'cleared', hourly: null });
  assert.deepEqual(resolveGrossPay(nyc, '  '), { status: 'cleared', hourly: null });
  assert.deepEqual(resolveGrossPay(nyc, 'abc'), { status: 'invalid', hourly: null });
  assert.deepEqual(resolveGrossPay(nyc, '0'), { status: 'invalid', hourly: null });
  assert.deepEqual(resolveGrossPay(nyc, '-3'), { status: 'invalid', hourly: null });
  // No default (Dubai) or no city record: input is required.
  assert.deepEqual(resolveGrossPay(cityById('dubai').grossPay, undefined), { status: 'required', hourly: null });
  assert.deepEqual(resolveGrossPay(undefined, undefined), { status: 'required', hourly: null });
  assert.deepEqual(resolveGrossPay(cityById('dubai').grossPay, '45'), { status: 'custom', hourly: 45 });
});

test('setGrossPayOverride changes one city, keeps an explicit clear, and restores by removal', () => {
  const start: GrossPayOverrides = {};
  const nyc = setGrossPayOverride(start, 'nyc', '25');
  assert.deepEqual(nyc, { nyc: '25' });
  assert.deepEqual(start, {}, 'the previous object is not mutated');
  const both = setGrossPayOverride(nyc, 'sf', '30');
  assert.deepEqual(both, { nyc: '25', sf: '30' });
  const cleared = setGrossPayOverride(both, 'nyc', '');
  assert.deepEqual(cleared, { nyc: '', sf: '30' });
  assert.equal(resolveGrossPay(cityById('nyc').grossPay, cleared.nyc).status, 'cleared');
  const restored = setGrossPayOverride(cleared, 'nyc', null);
  assert.deepEqual(restored, { sf: '30' });
  assert.equal(resolveGrossPay(cityById('nyc').grossPay, restored.nyc).status, 'default');
  assert.equal(resolveGrossPay(cityById('sf').grossPay, restored.sf).hourly, 30);
});

// ---------------------------------------------------------------------------------------------
// Demo reference rent conversion

const listingWith = (overrides: Partial<Listing>): Listing => ({ ...listingById('london-sublet-01'), ...overrides });

test('a USD listing uses originalMarketPriceUsd as its demo reference', () => {
  assert.equal(demoReferenceRentLocal(listingById('sf-sublet-01')), 2600);
});

test('a non-USD listing converts with its own local/USD price relationship', () => {
  const london = listingById('london-sublet-01');
  assert.equal(demoReferenceRentLocal(london), (1950 * 720) / 915);
  const bogota = listingById('bogota-sublet-01');
  assert.equal(demoReferenceRentLocal(bogota), (950 * 1600000) / 395);
});

test('without a usable conversion the reference is unavailable, never a made-up rate', () => {
  for (const overrides of [
    { priceUsd: 0 },
    { priceUsd: -1 },
    { priceUsd: Number.NaN },
    { priceLocal: 0 },
    { priceLocal: Number.POSITIVE_INFINITY },
    { originalMarketPriceUsd: 0 },
    { originalMarketPriceUsd: Number.NaN },
    { originalMarketPriceUsd: Number.MAX_VALUE, priceLocal: Number.MAX_VALUE },
  ]) {
    assert.equal(demoReferenceRentLocal(listingWith(overrides)), null, JSON.stringify(overrides));
  }
  // An unavailable reference makes AGI and hours unavailable together.
  const result = calculateListingFairRent(listingWith({ priceUsd: 0 }), cityById('london').grossPay);
  assert.equal(result.referenceRentLocal, null);
  assert.equal(result.agi, null);
  assert.equal(result.hours, null);
});

test('a free USD listing is valid: AGI 100 with a known reference', () => {
  const free = { ...listingById('nyc-sublet-01'), priceLocal: 0, priceUsd: 0 };
  const result = calculateListingFairRent(free, cityById('nyc').grossPay);
  near(result.agi, 100);
  assert.ok(result.hours);
  near(result.hours.asking, 0);
  near(result.hours.reference, 2800 / 17);
});

test('valid rent with unusable pay still shows AGI while the hours are unavailable', () => {
  const nyc = listingById('nyc-sublet-01');
  for (const override of ['', 'abc', '0', '-4']) {
    const result = calculateListingFairRent(nyc, cityById('nyc').grossPay, override);
    near(result.agi, 55.357142857142854, `AGI with override ${JSON.stringify(override)}`);
    assert.equal(result.hours, null, `hours with override ${JSON.stringify(override)}`);
    assert.equal(result.pay.hourly, null);
  }
});

// ---------------------------------------------------------------------------------------------
// City wage snapshot

const SNAPSHOT: Record<string, { hourly: number | null; effective: string | null; currency: string }> = {
  nyc: { hourly: 17, effective: '2026-01-01', currency: 'USD' },
  london: { hourly: 12.71, effective: '2026-04-01', currency: 'GBP' },
  tokyo: { hourly: 1280, effective: '2026-10-01', currency: 'JPY' },
  bogota: { hourly: 1750905 / 182, effective: '2026-07-15', currency: 'COP' },
  paris: { hourly: 12.31, effective: '2026-06-01', currency: 'EUR' },
  berlin: { hourly: 13.9, effective: '2026-01-01', currency: 'EUR' },
  sf: { hourly: 19.61, effective: '2026-07-01', currency: 'USD' },
  dubai: { hourly: null, effective: null, currency: 'AED' },
};

test('all eight cities carry the frozen gross pay snapshot with basis, date, and sources', () => {
  assert.deepEqual([...CITIES.map((c) => c.id)].sort(), Object.keys(SNAPSHOT).sort());
  for (const city of CITIES) {
    const expected = SNAPSHOT[city.id];
    assert.equal(city.currency, expected.currency, `${city.id} currency`);
    assert.equal(city.grossPay.defaultHourly, expected.hourly, `${city.id} default`);
    assert.equal(city.grossPay.effectiveDate, expected.effective, `${city.id} effective date`);
    assert.ok(city.grossPay.basis.trim().length > 0, `${city.id} basis`);
    assert.ok(city.grossPay.sources.length > 0, `${city.id} sources`);
    for (const source of city.grossPay.sources) {
      assert.equal(new URL(source).protocol, 'https:', `${city.id} source ${source}`);
    }
    if (expected.effective) assert.match(expected.effective, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('Bogotá is a derived hourly equivalent with its monthly amount and 182-hour divisor exposed', () => {
  const { grossPay } = cityById('bogota');
  assert.ok(grossPay.monthlyConversion);
  assert.equal(grossPay.monthlyConversion.monthlyAmount, 1750905);
  assert.equal(grossPay.monthlyConversion.hoursPerMonth, (42 * 52) / 12);
  assert.equal(grossPay.monthlyConversion.hoursPerMonth, 182);
  assert.equal(grossPay.defaultHourly, grossPay.monthlyConversion.monthlyAmount / grossPay.monthlyConversion.hoursPerMonth);
  assert.match(grossPay.basis, /derived gross hourly equivalent/i);
  assert.match(grossPay.basis, /not an enacted hourly rate/i);
  assert.match(grossPay.monthlyConversion.assumption, /analytical assumption/i);
  // No other city is derived from a monthly figure.
  for (const city of CITIES.filter((c) => c.id !== 'bogota')) {
    assert.equal(city.grossPay.monthlyConversion, undefined, city.id);
  }
});

test('Dubai has no default, explains why, and does not borrow a narrower policy as a universal rate', () => {
  const { grossPay } = cityById('dubai');
  assert.equal(grossPay.defaultHourly, null);
  assert.equal(grossPay.effectiveDate, null);
  assert.match(grossPay.basis, /no universal statutory minimum/i);
  assert.match(grossPay.basis, /AED/);
});

test('the London default is the 21+ floor and is not labelled as the 18 to 20 rate', () => {
  const { basis } = cityById('london').grossPay;
  assert.match(basis, /21/);
  assert.doesNotMatch(basis, /18/);
});

// ---------------------------------------------------------------------------------------------
// All eleven fixtures across the eight cities

test('there are eleven priced fixtures and each is in a known city and currency', () => {
  assert.equal(MOCK_LISTINGS.length, 11);
  assert.deepEqual(
    [...new Set(MOCK_LISTINGS.map((l) => l.cityId))].sort(),
    CITIES.map((c) => c.id).sort(),
    'every city has a fixture',
  );
  for (const listing of MOCK_LISTINGS) {
    assert.equal(listing.currency, cityById(listing.cityId).currency, `${listing.id} currency matches its city`);
  }
});

test('every fixture gets a currency-consistent reference, AGI, and default-pay hours (Dubai needs input)', () => {
  for (const listing of MOCK_LISTINGS) {
    const city = cityById(listing.cityId);
    const expectedReference =
      listing.currency === 'USD'
        ? listing.originalMarketPriceUsd
        : (listing.originalMarketPriceUsd * listing.priceLocal) / listing.priceUsd;
    const result = calculateListingFairRent(listing, city.grossPay);
    near(result.referenceRentLocal, expectedReference, `${listing.id} reference`);
    near(result.agi, 100 * (1 - listing.priceLocal / expectedReference), `${listing.id} AGI`);
    assert.ok((result.agi as number) > 0, `${listing.id} is priced below its demo reference`);

    const hourly = SNAPSHOT[listing.cityId].hourly;
    if (hourly === null) {
      assert.equal(result.pay.status, 'required', listing.id);
      assert.equal(result.hours, null, `${listing.id} has no hours without entered pay`);
      continue;
    }
    assert.equal(result.pay.status, 'default', listing.id);
    assert.ok(result.hours, `${listing.id} hours`);
    near(result.hours.asking, listing.priceLocal / hourly, `${listing.id} asking hours`);
    near(result.hours.reference, expectedReference / hourly, `${listing.id} reference hours`);
    near(result.hours.difference, (expectedReference - listing.priceLocal) / hourly, `${listing.id} difference`);
    assert.ok(result.hours.difference > 0, `${listing.id} fewer hours than the reference`);
  }
});

test('a supplied AED pay produces Dubai hours', () => {
  const dubai = listingById('dubai-sublet-01');
  const result = calculateListingFairRent(dubai, cityById('dubai').grossPay, '50');
  assert.equal(result.pay.status, 'custom');
  assert.ok(result.hours);
  near(result.hours.asking, 3800 / 50);
  near(result.hours.reference, ((2200 * 3800) / 1035) / 50);
});

test('one city pay override changes only that city', () => {
  const overrides = setGrossPayOverride({}, 'nyc', '34');
  for (const listing of MOCK_LISTINGS) {
    const city = cityById(listing.cityId);
    const withOverrides = calculateListingFairRent(listing, city.grossPay, overrides[listing.cityId]);
    const baseline = calculateListingFairRent(listing, city.grossPay);
    if (listing.cityId === 'nyc') {
      assert.equal(withOverrides.pay.status, 'custom', listing.id);
      near(withOverrides.hours?.asking, listing.priceLocal / 34, listing.id);
    } else {
      assert.deepEqual(withOverrides, baseline, listing.id);
    }
  }
});

test('calculating never changes the bundled scores, audits, or prices', () => {
  const before = JSON.stringify(MOCK_LISTINGS);
  for (const listing of MOCK_LISTINGS) {
    calculateListingFairRent(listing, cityById(listing.cityId).grossPay, '21');
    calculateListingFairRent(listing, cityById(listing.cityId).grossPay);
  }
  assert.equal(JSON.stringify(MOCK_LISTINGS), before);
  for (const listing of MOCK_LISTINGS) {
    assert.equal(typeof listing.dealScore, 'number');
    assert.equal(typeof listing.nemotronAudit.fairRentScore, 'number');
    assert.match(listing.nemotronAudit.gentrificationIndex, /^(Anti-Gentrification Champion|Community Grounded|Corporate Gouging Alert)$/);
  }
});

// ---------------------------------------------------------------------------------------------
// Rendered card and dossier (static markup)

const nyc = () => listingById('nyc-sublet-01');

/** NYC with another asking rent. The demo reference stays USD 2,800 and the pay stays USD 17. */
const nycAsking = (priceLocal: number): Listing => ({ ...nyc(), priceLocal, priceUsd: priceLocal });

const renderCard = (listing: Listing, payOverride?: string) =>
  renderToStaticMarkup(createElement(card.ListingCard, { listing, onSelect: () => {}, payOverride }));

const renderDossier = (listing: Listing, payOverride?: string, editable = true) =>
  renderToStaticMarkup(
    createElement(modal.ListingModal, {
      listing,
      onClose: () => {},
      payOverride,
      onPayOverrideChange: editable ? () => {} : undefined,
    }),
  );

/** Visible text of some markup, with tags removed and entities decoded. */
const textOf = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/'/g, '&#x27;');

/** The fair-rent metrics block of a rendered card or dossier. */
function metricsBlock(markup: string, variant: 'card' | 'dossier'): string {
  const match = markup.match(new RegExp(`<section[^>]*data-fair-rent="${variant}"[\\s\\S]*?</section>`));
  assert.ok(match, `a ${variant} metrics block is rendered`);
  return match[0];
}

/** The values shown for the four metrics, as displayed text. */
function shownMetrics(markup: string, variant: 'card' | 'dossier') {
  const shown = textOf(metricsBlock(markup, variant));
  const pick = (pattern: RegExp) => shown.match(pattern)?.[1] ?? null;
  return {
    agi: pick(/Illustrative AGI (\S+)/),
    asking: pick(/Gross-pay hours, asking rent ([\d,.]+) h/),
    reference: pick(/Gross-pay hours, demo reference rent ([\d,.]+) h/),
    difference: pick(/Difference ([\d,.]+ (?:fewer|extra) hours|Same hours)/),
  };
}

/** What the calculator says the metrics should display, formatted the way the interface formats them. */
function expectedMetrics(listing: Listing, payOverride?: string) {
  const result = calculateListingFairRent(listing, cityById(listing.cityId).grossPay, payOverride);
  const diff = result.hours?.difference;
  return {
    agi: result.agi === null ? 'unavailable' : formatOneDecimal(result.agi),
    asking: result.hours ? formatOneDecimal(result.hours.asking) : null,
    reference: result.hours ? formatOneDecimal(result.hours.reference) : null,
    difference:
      diff === undefined
        ? null
        : displayedSign(diff) === 0
          ? 'Same hours'
          : `${formatOneDecimal(Math.abs(diff))} ${diff > 0 ? 'fewer' : 'extra'} hours`,
  };
}

test('the card and the dossier show the same numbers as the calculator for every fixture and several pays', () => {
  for (const listing of MOCK_LISTINGS) {
    for (const payOverride of [undefined, '25', '9.5', '', 'abc']) {
      const label = `${listing.id} pay ${JSON.stringify(payOverride)}`;
      const expected = expectedMetrics(listing, payOverride);
      assert.deepEqual(shownMetrics(renderCard(listing, payOverride), 'card'), expected, `card ${label}`);
      assert.deepEqual(shownMetrics(renderDossier(listing, payOverride), 'dossier'), expected, `dossier ${label}`);
    }
  }
});

test('NYC shows 55.4, 73.5 h, 164.7 h and 91.2 fewer hours with a labelled default basis', () => {
  for (const [name, markup, variant] of [
    ['card', renderCard(nyc()), 'card'],
    ['dossier', renderDossier(nyc()), 'dossier'],
  ] as const) {
    const shown = textOf(metricsBlock(markup, variant));
    assert.match(shown, /Illustrative AGI 55\.4/, name);
    assert.match(shown, /Demo reference rent \$2,800\/mo/, name);
    assert.match(shown, /Gross-pay hours, asking rent 73\.5 h/, name);
    assert.match(shown, /Gross-pay hours, demo reference rent 164\.7 h/, name);
    assert.match(shown, /Difference 91\.2 fewer hours than the demo reference/, name);
    assert.match(shown, /At \$17\.00\/h gross, city default: General covered non-tipped minimum wage\. Effective 2026-01-01\./, name);
  }
  assert.match(textOf(metricsBlock(renderCard(nyc()), 'card')), /shown to one decimal/);
  assert.match(textOf(metricsBlock(renderDossier(nyc()), 'dossier')), /shown to one decimal/);
});

test('the old Local Median caption is relabelled Demo reference rent and nothing claims an investor median', () => {
  for (const markup of [renderCard(nyc()), renderDossier(nyc())]) {
    assert.doesNotMatch(markup, /Local Median/);
    assert.match(markup, /Demo reference rent/);
  }
  const dossier = textOf(renderDossier(nyc()));
  assert.match(dossier, /not a verified investor median, market average, or saving on a live posting/);
  assert.match(dossier, /neutral tenant protection factor, a modelling assumption/);
  // The existing demo labels stay.
  assert.match(renderCard(nyc()), /Demo fixture · sample data/);
  assert.match(dossier, /DEMO FIXTURE DOSSIER #nyc-sublet-01/);
});

test('a non-USD dossier explains the conversion and a Bogotá dossier shows the monthly amount and divisor', () => {
  const london = textOf(renderDossier(listingById('london-sublet-01')));
  assert.match(london, /converted from \$1,950 USD with this fixture's own local\/USD price ratio/);
  assert.match(london, /not a live exchange rate/);
  assert.match(london, /Demo reference rent \(local currency\) £1,534\/mo/);
  // A USD fixture has nothing to convert.
  assert.doesNotMatch(textOf(renderDossier(nyc())), /price ratio/);

  const bogota = textOf(renderDossier(listingById('bogota-sublet-01')));
  assert.match(bogota, /Derived gross hourly equivalent: COP \$1,750,905 per month \/ 182 working hours a month = COP \$9,620\.36 per hour/);
  assert.match(bogota, /analytical assumption/);
  assert.match(bogota, /Not an enacted hourly rate/);
  assert.match(bogota, /At COP \$9,620\.36\/h gross, city default: Derived gross hourly equivalent/);
  assert.match(bogota, /Effective 2026-07-15/);
});

test('custom pay is labelled as entered by the user and never as a statutory wage', () => {
  for (const [markup, variant] of [
    [renderCard(nyc(), '25'), 'card'],
    [renderDossier(nyc(), '25'), 'dossier'],
  ] as const) {
    const shown = textOf(metricsBlock(markup, variant));
    assert.match(shown, /At \$25\.00\/h gross, entered by you\. This is your figure, not a statutory wage\./);
    assert.doesNotMatch(shown, /city default/);
    assert.match(shown, /Gross-pay hours, asking rent 50\.0 h/);
    assert.match(shown, /Gross-pay hours, demo reference rent 112\.0 h/);
    assert.match(shown, /Difference 62\.0 fewer hours/);
  }
});

test('clearing or breaking the pay hides only the hours and does not bring the default back', () => {
  const cases: [string, RegExp][] = [
    ['', /The gross hourly pay is empty or incomplete, so the default is not used/],
    ['   ', /The gross hourly pay is empty or incomplete/],
    ['abc', /not a number above 0/],
    ['0', /not a number above 0/],
    ['-5', /not a number above 0/],
    ['1e999', /not a number above 0/],
  ];
  for (const [override, reason] of cases) {
    for (const [markup, variant] of [
      [renderCard(nyc(), override), 'card'],
      [renderDossier(nyc(), override), 'dossier'],
    ] as const) {
      const label = `${variant} ${JSON.stringify(override)}`;
      const shown = textOf(metricsBlock(markup, variant));
      assert.match(shown, /Illustrative AGI 55\.4/, label);
      assert.match(shown, /Gross-pay hours unavailable\./, label);
      assert.match(shown, reason, label);
      assert.doesNotMatch(shown, /73\.5|164\.7|91\.2|city default|At \$17/, `${label} does not fall back to the default`);
      assert.doesNotMatch(shown, /Gross-pay hours, asking rent/, label);
    }
  }
});

test('Dubai has no default: hours are unavailable with a reason until AED pay is entered', () => {
  const dubai = listingById('dubai-sublet-01');
  const shown = textOf(metricsBlock(renderCard(dubai), 'card'));
  assert.match(shown, /Illustrative AGI 53\.0/);
  assert.match(shown, /Gross-pay hours unavailable\. No default\. There is no universal statutory minimum wage for every Dubai worker/);
  assert.doesNotMatch(shown, /city default/);
  assert.match(renderCard(dubai), /aria-label="Enter hourly pay for Dubai in the listing details"/);
  assert.match(renderCard(dubai), />ENTER HOURLY PAY</);

  const entered = textOf(metricsBlock(renderCard(dubai, '50'), 'card'));
  assert.match(entered, /Gross-pay hours, asking rent 76\.0 h/);
  assert.match(entered, /Gross-pay hours, demo reference rent 161\.5 h/);
  assert.match(entered, /entered by you/);
  assert.match(renderCard(dubai, '50'), />SET OR EDIT HOURLY PAY</);
  // The dossier field starts empty and is required.
  const field = renderDossier(dubai).match(/<input[^>]*id="gross-hourly-pay"[^>]*>/)?.[0] ?? '';
  assert.match(field, /value=""/);
  assert.match(field, /required=""/);
  assert.doesNotMatch(renderDossier(dubai), /RESTORE DEFAULT/);
});

test('a negative AGI and negative difference are shown as above-reference and extra hours, never savings', () => {
  const dear = nycAsking(3500);
  assert.deepEqual(shownMetrics(renderCard(dear), 'card'), {
    agi: '-25.0',
    asking: '205.9',
    reference: '164.7',
    difference: '41.2 extra hours',
  });
  const shownCard = textOf(metricsBlock(renderCard(dear), 'card'));
  assert.match(shownCard, /Asking rent is above the demo reference rent/);
  assert.doesNotMatch(shownCard, /fewer hours|\bsav/i);
  const shownDossier = textOf(metricsBlock(renderDossier(dear), 'dossier'));
  assert.match(shownDossier, /Illustrative AGI -25\.0/);
  assert.doesNotMatch(shownDossier, /fewer hours than/);
});

test('parity and near-parity show 0.0 and the same hours, never -0.0 or a gain', () => {
  for (const asking of [2800, 2799.99, 2800.01]) {
    const markup = renderCard(nycAsking(asking));
    const label = String(asking);
    assert.equal(shownMetrics(markup, 'card').agi, '0.0', label);
    assert.equal(shownMetrics(markup, 'card').difference, 'Same hours', label);
    const shown = textOf(metricsBlock(markup, 'card'));
    assert.match(shown, /Asking rent matches the demo reference rent/, label);
    assert.doesNotMatch(shown, /-0\.0|fewer hours|extra hours/, label);
  }
});

test('a free listing shows AGI 100.0 and 0.0 asking hours', () => {
  const free = { ...nyc(), priceLocal: 0, priceUsd: 0 };
  assert.deepEqual(shownMetrics(renderCard(free), 'card'), {
    agi: '100.0',
    asking: '0.0',
    reference: '164.7',
    difference: '164.7 fewer hours',
  });
});

test('nothing renders NaN or Infinity for unusable or overflowing inputs', () => {
  const broken: [string, Listing, string | undefined][] = [
    ['NaN rent', { ...nyc(), priceLocal: Number.NaN }, undefined],
    ['Infinity rent', { ...nyc(), priceLocal: Number.POSITIVE_INFINITY }, undefined],
    ['negative rent', { ...nyc(), priceLocal: -5 }, undefined],
    ['NaN reference', { ...nyc(), originalMarketPriceUsd: Number.NaN }, undefined],
    ['zero reference', { ...nyc(), originalMarketPriceUsd: 0 }, undefined],
    ['non-USD without a ratio', { ...listingById('london-sublet-01'), priceUsd: 0 }, undefined],
    ['overflowing hours', { ...nyc(), priceLocal: Number.MAX_VALUE }, '0.00001'],
    ['overflowing AGI', { ...nyc(), originalMarketPriceUsd: Number.MIN_VALUE, priceLocal: Number.MAX_VALUE }, undefined],
  ];
  // Only the new metrics block is checked. The existing price line still prints whatever priceLocal holds.
  for (const [name, listing, override] of broken) {
    const blocks = [
      metricsBlock(renderCard(listing, override), 'card'),
      metricsBlock(renderDossier(listing, override), 'dossier'),
    ];
    for (const block of blocks) {
      assert.doesNotMatch(textOf(block), /NaN|Infinity|undefined|e\+\d/, name);
    }
  }
  // The unusable rent hides AGI; the unusable pay does not.
  assert.equal(shownMetrics(renderCard({ ...nyc(), priceLocal: Number.NaN }), 'card').agi, 'unavailable');
  assert.match(textOf(renderCard({ ...nyc(), priceLocal: Number.NaN })), /Needs a valid asking rent and demo reference rent/);
  assert.equal(shownMetrics(renderCard({ ...nyc(), priceLocal: Number.MAX_VALUE }, '0.00001'), 'card').asking, null);
});

test('a card without a pay prop uses the city default, and a dossier without a handler has no pay field', () => {
  const bareCard = renderToStaticMarkup(createElement(card.ListingCard, { listing: nyc(), onSelect: () => {} }));
  assert.equal(shownMetrics(bareCard, 'card').asking, '73.5');
  const bareModal = renderToStaticMarkup(createElement(modal.ListingModal, { listing: nyc(), onClose: () => {} }));
  assert.equal(shownMetrics(bareModal, 'dossier').asking, '73.5');
  assert.doesNotMatch(bareModal, /gross-hourly-pay/);
  assert.match(bareModal, /clause-audit-input/);
});

test('the dossier pay field is a labelled native number input with currency, unit, and described states', () => {
  const markup = renderDossier(nyc());
  assert.match(markup, /<label[^>]*for="gross-hourly-pay"[^>]*>Gross hourly pay \(USD per hour, before tax\)<\/label>/);
  const field = markup.match(/<input[^>]*id="gross-hourly-pay"[^>]*>/)?.[0] ?? '';
  assert.match(field, /type="number"/);
  assert.match(field, /inputMode="decimal"/);
  assert.match(field, /min="0"/);
  assert.match(field, /step="any"/);
  assert.match(field, /required=""/);
  assert.match(field, /value="17"/);
  assert.match(field, /aria-invalid="false"/);
  assert.match(field, /aria-describedby="gross-hourly-pay-hint gross-hourly-pay-status"/);
  assert.match(markup, /id="gross-hourly-pay-hint"/);
  assert.match(markup, /id="gross-hourly-pay-status"[^>]*aria-live="polite"/);
  assert.match(textOf(markup), /Gross pay before tax, in USD\. It applies to every New York City listing and is kept only until the page reloads\./);
  // An override shows what was typed; the restore button appears only once there is something to restore.
  assert.match(markup, /Wage sources for New York City/);
  assert.doesNotMatch(markup, /RESTORE DEFAULT/);
  const typed = renderDossier(nyc(), '25');
  assert.match(typed.match(/<input[^>]*id="gross-hourly-pay"[^>]*>/)?.[0] ?? '', /value="25"/);
  assert.match(typed, />RESTORE DEFAULT</);
  // Wage sources open safely in a new tab.
  assert.match(markup, /<a href="https:\/\/dol\.ny\.gov\/minimum-wage" target="_blank" rel="noopener noreferrer"/);
});

test('an emptied or invalid field is flagged for assistive technology and offers a way back', () => {
  for (const override of ['', 'abc', '0']) {
    const markup = renderDossier(nyc(), override);
    const field = markup.match(/<input[^>]*id="gross-hourly-pay"[^>]*>/)?.[0] ?? '';
    assert.match(field, /aria-invalid="true"/, JSON.stringify(override));
    assert.match(field, new RegExp(`value="${override}"`), JSON.stringify(override));
    assert.match(markup, />RESTORE DEFAULT</, JSON.stringify(override));
    const status = markup.match(/<p id="gross-hourly-pay-status"[^>]*>([^<]*)<\/p>/)?.[1] ?? '';
    assert.ok(status.length > 0, `a status message for ${JSON.stringify(override)}`);
  }
});

test('an empty field and unfinished text share one truthful message, since a number input reports both as empty', () => {
  // Typing "1e" or "-" into a number input leaves value "" (validity.badInput), which the override
  // records as an empty string. The wording therefore has to be true for either case.
  const markup = renderDossier(nyc(), '');
  const status = markup.match(/<p id="gross-hourly-pay-status"[^>]*>([^<]*)<\/p>/)?.[1] ?? '';
  assert.match(status, /The field is empty or incomplete, so hours stay unavailable until you enter a complete rate or restore the default\./);
  assert.doesNotMatch(status, /^The field is empty,/);
  assert.match(textOf(metricsBlock(markup, 'dossier')), /The gross hourly pay is empty or incomplete, so the default is not used\. Enter a complete rate or restore the default/);
  // No default to restore (Dubai): the message offers only entering a rate.
  const dubai = renderDossier(listingById('dubai-sublet-01'), '');
  assert.match(textOf(metricsBlock(dubai, 'dossier')), /empty or incomplete, so the default is not used\. Enter a complete rate in the listing details/);
  assert.doesNotMatch(textOf(metricsBlock(dubai, 'dossier')), /restore the default/);
  // The number control stays: no sentinel text goes into the value.
  assert.match(markup.match(/<input[^>]*id="gross-hourly-pay"[^>]*>/)?.[0] ?? '', /type="number"[^>]*value=""/);
});

test('hours that are unavailable say why: an absent reference, unusable rents, or an overflow', () => {
  const cases: [string, Listing, string | undefined, RegExp, RegExp][] = [
    [
      'reference rent absent',
      { ...listingById('london-sublet-01'), priceUsd: 0 },
      undefined,
      /The demo reference rent is not available for this fixture\./,
      /too large to calculate|do not give a usable result/,
    ],
    [
      'unusable asking rent',
      { ...nyc(), priceLocal: Number.NaN },
      undefined,
      /The asking rent and demo reference rent do not give a usable result for this fixture\./,
      /reference rent is not available|too large to calculate/,
    ],
    [
      'overflow with a valid rent and reference',
      nyc(),
      '1e-320',
      /The hours are too large to calculate at this gross hourly pay\. Enter a larger rate in the listing details\./,
      /reference rent is not available|do not give a usable result/,
    ],
    [
      'overflow from a small but ordinary-looking pay',
      { ...nyc(), priceLocal: Number.MAX_VALUE },
      '0.00001',
      /too large to calculate at this gross hourly pay/,
      /reference rent is not available/,
    ],
  ];
  for (const [name, listing, override, reason, notReason] of cases) {
    for (const [markup, variant] of [
      [renderCard(listing, override), 'card'],
      [renderDossier(listing, override), 'dossier'],
    ] as const) {
      const shown = textOf(metricsBlock(markup, variant));
      assert.match(shown, /Gross-pay hours unavailable\./, `${name} ${variant}`);
      assert.match(shown, reason, `${name} ${variant}`);
      assert.doesNotMatch(shown, notReason, `${name} ${variant} gives only its own reason`);
    }
  }
  // The overflow case keeps the reference row and AGI, which do not depend on the pay.
  const overflow = textOf(metricsBlock(renderCard(nyc(), '1e-320'), 'card'));
  assert.match(overflow, /Illustrative AGI 55\.4/);
  assert.match(overflow, /Demo reference rent \$2,800\/mo/);
  assert.match(overflow, /At \$1e-320\/h gross, entered by you/);
  assert.doesNotMatch(overflow, /NaN|Infinity/);
});

test('an accepted tiny pay is never described as zero', () => {
  const shownPay = (listing: Listing, override: string | undefined) =>
    textOf(metricsBlock(renderCard(listing, override), 'card')).match(/At (.+?)\/h gross/)?.[1];
  const tokyo = listingById('tokyo-sublet-01');
  const cases: [Listing, string, string][] = [
    [nyc(), '0.005', '$0.01'],
    [nyc(), '0.004', '$0.004'],
    [nyc(), '0.001', '$0.001'],
    [nyc(), '0.0001', '$0.0001'],
    [nyc(), '0.00012345', '$0.000123'],
    [nyc(), '1e-7', '$1e-7'],
    [nyc(), '1e-320', '$1e-320'],
    [tokyo, '0.4', '¥0.4'],
    [tokyo, '0.001', '¥0.001'],
    [tokyo, '1500', '¥1,500'],
  ];
  for (const [listing, override, expected] of cases) {
    assert.equal(shownPay(listing, override), expected, `${listing.currency} pay ${override}`);
    assert.ok(parseGrossPayInput(override) !== null && (parseGrossPayInput(override) as number) > 0);
  }
  // Ordinary rates are unchanged: cents, with grouping, and whole yen.
  assert.equal(shownPay(nyc(), '25'), '$25.00');
  assert.equal(shownPay(nyc(), '12.5'), '$12.50');
  assert.equal(shownPay(nyc(), undefined), '$17.00');
  assert.equal(shownPay(tokyo, undefined), '¥1,280');
  assert.equal(shownPay(listingById('bogota-sublet-01'), undefined), 'COP $9,620.36');
  // Whatever the currency, a positive entered rate is never printed as 0, 0.0 or 0.00.
  for (const listing of MOCK_LISTINGS) {
    for (const override of ['0.001', '1e-7']) {
      const text = textOf(metricsBlock(renderDossier(listing, override), 'dossier'));
      assert.doesNotMatch(text, /At \D*0(?:\.0+)?\/h gross/, `${listing.id} ${override}`);
    }
  }
});

test('the pay field starts at the exact default the hours use, so entering the shown text changes nothing', () => {
  for (const listing of MOCK_LISTINGS) {
    const { grossPay } = cityById(listing.cityId);
    const field = renderDossier(listing).match(/<input[^>]*id="gross-hourly-pay"[^>]*>/)?.[0] ?? '';
    const shown = field.match(/value="([^"]*)"/)?.[1];
    if (grossPay.defaultHourly === null) {
      assert.equal(shown, '', `${listing.id} has no default to show`);
      continue;
    }
    assert.equal(Number(shown), grossPay.defaultHourly, `${listing.id} field text is the default`);
    const typed = calculateListingFairRent(listing, grossPay, shown);
    const byDefault = calculateListingFairRent(listing, grossPay);
    assert.equal(typed.pay.status, 'custom');
    assert.deepEqual(typed.hours, byDefault.hours, `${listing.id} re-entering the field text gives the same hours`);
  }
  // Bogota's derived 1,750,905 / 182 is not a round number. The field must not be a 2-decimal copy of it.
  const bogota = renderDossier(listingById('bogota-sublet-01')).match(/<input[^>]*id="gross-hourly-pay"[^>]*>/)?.[0] ?? '';
  assert.match(bogota, /value="9620\.357142857143"/);
});

test('very large finite hours are shown in full, never dropped, and the region is set to wrap them', () => {
  const sf = listingById('sf-sublet-01');
  for (const override of ['1e-300', '1e-100']) {
    const result = calculateListingFairRent(sf, cityById('sf').grossPay, override);
    assert.ok(result.hours, `finite hours for ${override}`);
    for (const [markup, variant] of [
      [renderCard(sf, override), 'card'],
      [renderDossier(sf, override), 'dossier'],
    ] as const) {
      const block = metricsBlock(markup, variant);
      const shown = shownMetrics(markup, variant);
      assert.equal(shown.asking, formatOneDecimal(result.hours.asking), `${variant} ${override} asking hours`);
      assert.equal(shown.reference, formatOneDecimal(result.hours.reference), `${variant} ${override} reference hours`);
      assert.ok((shown.asking as string).replace(/\D/g, '').length > 100, 'the full digits are kept');
      assert.doesNotMatch(textOf(block), /Gross-pay hours unavailable/, `${variant} ${override}`);
      // Layout cannot be measured here. Real-browser wrapping was checked separately.
      assert.match(block, /^<section[^>]*class="wrap-anywhere /, `${variant} region can wrap an unbroken number`);
    }
  }
});

test('the dossier prints no dollar savings line beside the demo reference rent', () => {
  // The old "Save ~$X/mo" line subtracted the asking price from the reference and read as a real
  // saving. The shared metrics now carry that comparison, with its demo label and direction.
  for (const listing of [nyc(), nycAsking(3500), nycAsking(2800), listingById('london-sublet-01'), listingById('bogota-sublet-02')]) {
    const text = textOf(renderDossier(listing));
    assert.doesNotMatch(text, /Save ~|\$-\d/, listing.id);
    assert.match(text, /Demo reference rent/, listing.id);
  }
  assert.match(textOf(metricsBlock(renderDossier(nycAsking(3500)), 'dossier')), /41\.2 extra hours/);
});

test('the card has a labelled route to the pay field in the details', () => {
  const markup = renderCard(nyc());
  assert.match(markup, /<button[^>]*aria-label="Set or edit hourly pay for New York City in the listing details"[^>]*>SET OR EDIT HOURLY PAY<\/button>/);
  assert.match(renderCard(nyc(), ''), /aria-label="Enter hourly pay for New York City in the listing details"/);
});

test('the card route button name contains its visible text and the city (WCAG 2.5.3 label in name)', () => {
  for (const listing of MOCK_LISTINGS) {
    for (const override of [undefined, '', '25']) {
      const markup = renderCard(listing, override);
      const match = markup.match(/<button[^>]*aria-label="([^"]*)"[^>]*>([^<]*)<\/button>/);
      assert.ok(match, `${listing.id} has a labelled route button`);
      const [, name, visible] = match;
      assert.match(visible, /^(ENTER|SET OR EDIT) HOURLY PAY$/, `${listing.id} visible text`);
      assert.ok(name.toLowerCase().includes(visible.toLowerCase()), `"${name}" contains "${visible}"`);
      assert.ok(name.includes(listing.cityName), `"${name}" names the city`);
    }
  }
});

test('every metrics region has its own name, so the landmark list tells the listings apart', () => {
  const markup = renderToStaticMarkup(createElement(app.App));
  const names = [...markup.matchAll(/<section[^>]*aria-label="([^"]*)"[^>]*data-fair-rent="card"/g)].map((m) => m[1]);
  assert.equal(names.length, 11);
  assert.equal(new Set(names).size, 11, 'no two card regions share a name');
  for (const listing of MOCK_LISTINGS) {
    assert.ok(names.some((name) => name.includes(escapeHtml(listing.title))), `${listing.id} is named by its title`);
  }
  // The dossier region is named for its listing too.
  assert.match(renderDossier(nyc()), new RegExp(`<section[^>]*aria-label="Illustrative wage parity, demo data: ${escapeHtml(nyc().title)}"`));
});

test('a pay override for one city changes that city only, on every card', () => {
  const overrides = setGrossPayOverride({}, 'nyc', '34');
  for (const listing of MOCK_LISTINGS) {
    const withOverrides = textOf(metricsBlock(renderCard(listing, overrides[listing.cityId]), 'card'));
    const baseline = textOf(metricsBlock(renderCard(listing), 'card'));
    if (listing.cityId === 'nyc') {
      assert.match(withOverrides, /entered by you/, listing.id);
      assert.notEqual(withOverrides, baseline, listing.id);
    } else {
      assert.equal(withOverrides, baseline, listing.id);
    }
  }
  // Both NYC fixtures follow the one override.
  const nycCards = MOCK_LISTINGS.filter((l) => l.cityId === 'nyc');
  assert.equal(nycCards.length, 2);
  for (const listing of nycCards) {
    assert.equal(shownMetrics(renderCard(listing, '34'), 'card').asking, formatOneDecimal(listing.priceLocal / 34));
  }
});

// ---------------------------------------------------------------------------------------------
// Callback wiring (no DOM): the hook-free components are called as functions and their props invoked

function findElements(node: ReactNode, match: (element: ReactElement<any>) => boolean, found: ReactElement<any>[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) findElements(child, match, found);
  } else if (isValidElement(node)) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    if (match(element)) found.push(element);
    findElements(element.props.children, match, found);
  }
  return found;
}

test('the card route button opens the dossier for its own listing (callback wiring)', () => {
  const selected: Listing[] = [];
  const tree = card.ListingCard({ listing: nyc(), onSelect: (l) => selected.push(l) });
  const [metrics] = findElements(tree, (el) => el.type === metricsModule.FairRentMetrics);
  assert.ok(metrics, 'the card renders the shared metrics');
  assert.equal(metrics.props.variant, 'card');
  const section = metricsModule.FairRentMetrics(metrics.props);
  const [route] = findElements(section, (el) => el.type === 'button');
  assert.ok(route);
  route.props.onClick();
  assert.deepEqual(selected.map((l) => l.id), ['nyc-sublet-01']);
});

test('typing in the dossier field and restoring the default report the city and text, and restore asks the field for focus (callback wiring)', () => {
  const events: string[] = [];
  const onPayOverrideChange = (cityId: string, value: string | null) => events.push(`change ${cityId} ${JSON.stringify(value)}`);
  const section = metricsModule.FairRentMetrics({
    listing: nyc(),
    variant: 'dossier',
    payOverride: '25',
    onPayOverrideChange,
  });
  const [control] = findElements(section, (el) => typeof el.type === 'function' && el.type.name === 'GrossPayControl');
  assert.ok(control, 'the dossier renders the pay control');
  // The control holds a ref, so it can only run inside a render. A stand-in component calls it once.
  let rendered: ReactNode = null;
  const RenderControl = () => {
    rendered = (control.type as (props: unknown) => ReactNode)(control.props);
    return null;
  };
  renderToStaticMarkup(createElement(RenderControl));
  const [input] = findElements(rendered, (el) => el.type === 'input');
  const [restore] = findElements(rendered, (el) => el.type === 'button');
  assert.ok(input && restore);
  // A server render never attaches the ref, so give it a stand-in element that records focus().
  const field = input.props.ref as { current: { focus: () => void } | null };
  assert.ok(field && 'current' in field, 'the input receives a ref object');
  field.current = { focus: () => events.push('focus') };

  input.props.onChange({ target: { value: '31.5' } });
  input.props.onChange({ target: { value: '' } });
  assert.deepEqual(events, ['change nyc "31.5"', 'change nyc ""'], 'typing never moves focus');
  restore.props.onClick();
  assert.deepEqual(events.slice(2), ['change nyc null', 'focus'], 'restoring reports the city and then focuses the field');
});

// ---------------------------------------------------------------------------------------------
// Scout hits stay unpriced; the dossier keeps its other parts; App shows eleven priced cards

const scoutHit: ScoutListing = {
  kind: 'scout',
  mode: 'live',
  id: 'scout:live:nyc:https://example.org/a',
  title: 'Unverified Brooklyn room',
  cityId: 'nyc',
  cityName: 'New York City',
  source: 'Tavily Web Scout',
  sourceUrl: 'https://example.org/a',
  description: 'A snippet.',
  tags: [],
};

test('Scout hits get no AGI, hours, reference rent, or pay field', () => {
  const cardMarkup = renderToStaticMarkup(createElement(card.ScoutCandidateCard, { candidate: scoutHit, onSelect: () => {} }));
  const modalMarkup = renderToStaticMarkup(
    createElement(modal.ListingModal, {
      listing: scoutHit,
      onClose: () => {},
      payOverride: '25',
      onPayOverrideChange: () => {},
    }),
  );
  for (const markup of [cardMarkup, modalMarkup]) {
    assert.doesNotMatch(markup, /Illustrative AGI|data-fair-rent|gross-hourly-pay|Demo reference rent|Gross-pay hours/);
  }
  assert.match(modalMarkup, /UNVERIFIED SEARCH HIT/);
});

test('the fixture dossier keeps its native dialog, audit, negotiation script, and clause auditor', () => {
  const markup = renderDossier(nyc(), '25');
  assert.match(markup, /<dialog[^>]*aria-labelledby="fixture-dossier-title"/);
  assert.match(markup, /aria-label="Close listing dossier"/);
  assert.match(markup, /id="fixture-dossier-title"/);
  assert.ok(markup.includes(nyc().nemotronAudit.negotiationScript));
  assert.ok(markup.includes(`${nyc().dealScore}/100 DEAL SCORE`));
  assert.match(markup, /<textarea[^>]*id="clause-audit-input"/);
});

test('App renders the eleven fixtures in the unchanged deal-score order, each with the shared metrics', () => {
  const markup = renderToStaticMarkup(createElement(app.App));
  assert.equal((markup.match(/data-fair-rent="card"/g) ?? []).length, 11);
  assert.equal((markup.match(/Illustrative AGI<\/span>/g) ?? []).length, 11);
  assert.doesNotMatch(markup, /<dialog/, 'no dossier is open at first');
  assert.doesNotMatch(markup, /NaN|Infinity/);
  // Scores and sort order are the existing ones.
  const expectedOrder = [...MOCK_LISTINGS].sort((a, b) => b.dealScore - a.dealScore);
  let cursor = -1;
  for (const listing of expectedOrder) {
    const at = markup.indexOf(escapeHtml(listing.title), cursor + 1);
    assert.ok(at > cursor, `${listing.id} follows the previous card in deal-score order`);
    cursor = at;
    assert.ok(markup.includes(`${listing.dealScore}/100 SCORE`), `${listing.id} keeps its deal score`);
  }
  // Each card carries its own city default: spot-check one per currency family.
  assert.match(markup, /At \$17\.00\/h gross, city default/);
  assert.match(markup, /At £12\.71\/h gross, city default/);
  assert.match(markup, /At ¥1,280\/h gross, city default/);
  assert.match(markup, /At COP \$9,620\.36\/h gross, city default/);
  assert.match(markup, /At €12\.31\/h gross, city default/);
  assert.match(markup, /At €13\.90\/h gross, city default/);
  assert.match(markup, /At \$19\.61\/h gross, city default/);
  assert.match(textOf(markup), /Gross-pay hours unavailable\. No default\./);
});
