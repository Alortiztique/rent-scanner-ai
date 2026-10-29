// Offline checks for the illustrative AGI and gross-pay labor-hours calculator
// (src/utils/fairRentCalculator.ts), the per-city gross pay defaults in src/data/cities.ts, and
// their use on the bundled demo fixtures. No network, provider, or .env file is involved.
// The calculator imports only types, so it loads directly under strip-types. The data modules
// need Vite's transform (extensionless imports), so they load through an in-process Vite SSR
// loader that reads no .env file, like tests/clause-audit.test.ts.
// These checks cover arithmetic, validation, the wage snapshot, and the fixture conversion. They
// do not establish that any demo reference rent or minimum wage is current or correct in law.
// Run: node --experimental-strip-types --test tests/fair-rent-calculator.test.ts
import { after, before, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import type { City, GrossPayOverrides, Listing } from '../src/types/index.ts';
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

globalThis.fetch = (() => {
  throw new Error('real network access is disabled in fair-rent tests');
}) as typeof fetch;

for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  mock.method(console, method, () => {});
}

let server: ViteDevServer;
let CITIES: City[];
let MOCK_LISTINGS: Listing[];

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
  assert.equal(displayedSign(-0.04), 0);
  assert.equal(displayedSign(0.04), 0);
  assert.equal(displayedSign(0.06), 1);
  assert.equal(displayedSign(-0.06), -1);
  assert.equal(formatOneDecimal(-0.06), '-0.1');
  assert.equal(formatOneDecimal(1234.56), '1,234.6');
  assert.equal(displayedSign(Number.NaN), 0);
});

// ---------------------------------------------------------------------------------------------
// Pay text and per-city overrides

test('parseGrossPayInput accepts plain positive decimals only', () => {
  assert.equal(parseGrossPayInput('17'), 17);
  assert.equal(parseGrossPayInput(' 12.71 '), 12.71);
  assert.equal(parseGrossPayInput('.5'), 0.5);
  assert.equal(parseGrossPayInput('1e2'), 100);
  for (const text of ['', '   ', 'abc', '-1', '0', '0.0', '1,5', '0x10', 'Infinity', 'NaN', '1e999', '12abc', '+5', '1 2']) {
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
