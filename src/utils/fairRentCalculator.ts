/**
 * Illustrative Anti-Gentrification Index (AGI) and gross-pay labor hours for the bundled demo
 * fixtures. See docs/fair-rent-methodology.md.
 *
 * Everything here is a pure function of its arguments. The only imports are types, so
 * `node --experimental-strip-types` can load this file directly. Amounts are in one local
 * currency. Nothing is rounded before arithmetic or before a difference is taken; rounding
 * happens only in the display helpers at the bottom. Any result that is not a finite number
 * comes back as null, so NaN and Infinity never reach a caller.
 */
import type { CityGrossPay, GrossPayOverrides, Listing } from '../types';

/**
 * The neutral tenant protection factor. It is a disclosed modelling assumption, fixed at 1.0 in
 * this version. No legal-protection rubric backs a different value.
 */
export const TENANT_PROTECTION_FACTOR = 1.0;

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isPositive = (value: unknown): value is number => isFiniteNumber(value) && value > 0;
const isNonNegative = (value: unknown): value is number => isFiniteNumber(value) && value >= 0;

/**
 * Illustrative AGI = 100 * (1 - asking rent / demo reference rent) * tenant protection factor.
 * Asking rent must be finite and >= 0 (zero is valid); the reference must be finite and > 0.
 * The result is signed: it is negative when the asking rent is above the reference. It does not
 * depend on hourly pay. Returns null for invalid inputs or a result that is not finite.
 */
export function calculateAgi(askingRent: number, referenceRent: number): number | null {
  if (!isNonNegative(askingRent) || !isPositive(referenceRent)) return null;
  const agi = 100 * (1 - askingRent / referenceRent) * TENANT_PROTECTION_FACTOR;
  return isFiniteNumber(agi) ? agi : null;
}

export interface WorkingHours {
  /** Hours of gross pay needed to cover the asking monthly rent. */
  asking: number;
  /** Hours of gross pay needed to cover the demo reference monthly rent. */
  reference: number;
  /** reference - asking. Positive: fewer hours than the reference. Negative: more hours. */
  difference: number;
}

/**
 * Gross-pay hours to cover one month of rent: rent / gross hourly pay. Pay must be finite and
 * > 0. Returns null for invalid inputs or when any derived value is not finite (for example an
 * overflow), so the caller can show the hours as unavailable.
 */
export function calculateWorkingHours(
  askingRent: number,
  referenceRent: number,
  grossHourlyPay: number | null | undefined,
): WorkingHours | null {
  if (!isNonNegative(askingRent) || !isPositive(referenceRent) || !isPositive(grossHourlyPay)) return null;
  const asking = askingRent / grossHourlyPay;
  const reference = referenceRent / grossHourlyPay;
  const difference = reference - asking;
  if (!isFiniteNumber(asking) || !isFiniteNumber(reference) || !isFiniteNumber(difference)) return null;
  return { asking, reference, difference };
}

type DemoReferenceInputs = Pick<Listing, 'currency' | 'priceLocal' | 'priceUsd' | 'originalMarketPriceUsd'>;

/**
 * The demo reference monthly rent in the listing's local currency. It is the fixture's
 * originalMarketPriceUsd, which is an illustrative value and not an observed market or investor
 * median. A USD listing uses it as is. For another currency it reuses the fixture's own
 * local/USD price relationship: originalMarketPriceUsd * priceLocal / priceUsd. That ratio is
 * not a live or sourced exchange rate. Returns null when the conversion cannot be made.
 */
export function demoReferenceRentLocal(listing: DemoReferenceInputs): number | null {
  const referenceUsd = listing.originalMarketPriceUsd;
  if (!isPositive(referenceUsd)) return null;
  if (listing.currency === 'USD') return referenceUsd;
  if (!isPositive(listing.priceUsd) || !isPositive(listing.priceLocal)) return null;
  const reference = (referenceUsd * listing.priceLocal) / listing.priceUsd;
  return isPositive(reference) ? reference : null;
}

/**
 * Where the gross hourly pay for a calculation comes from.
 * default: the city's source-backed or derived default.
 * custom: text the user entered, parsed to a positive number.
 * required: the city has no default and nothing was entered.
 * cleared: the user emptied the field. The default is NOT restored behind their back.
 * invalid: the entered text is not a finite number above zero.
 */
export type GrossPayState =
  | { status: 'default' | 'custom'; hourly: number }
  | { status: 'required' | 'cleared' | 'invalid'; hourly: null };

const DECIMAL_NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * Parses entered pay text: a decimal such as 12.5 or .5, with an optional exponent such as 1e2
 * (a number input reports that form too). Anything else is rejected, and so is a result that is
 * not finite or not above zero.
 */
export function parseGrossPayInput(text: string): number | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!DECIMAL_NUMBER.test(trimmed)) return null;
  const value = Number(trimmed);
  return isPositive(value) ? value : null;
}

/**
 * Decides the pay for one city from its default and the user's override text. An override that
 * exists but is empty or unusable stays unusable; it never falls back to the default.
 */
export function resolveGrossPay(
  grossPay: Pick<CityGrossPay, 'defaultHourly'> | undefined,
  override: string | undefined,
): GrossPayState {
  if (override === undefined) {
    const defaultHourly = grossPay?.defaultHourly;
    return isPositive(defaultHourly)
      ? { status: 'default', hourly: defaultHourly }
      : { status: 'required', hourly: null };
  }
  if (typeof override === 'string' && override.trim() === '') return { status: 'cleared', hourly: null };
  const hourly = parseGrossPayInput(override);
  return hourly === null ? { status: 'invalid', hourly: null } : { status: 'custom', hourly };
}

/**
 * Returns new overrides with one city's text set, or with the city's override removed when
 * value is null (restore the default). An empty string is kept: it records an explicit clear.
 * Other cities are untouched.
 */
export function setGrossPayOverride(
  overrides: GrossPayOverrides,
  cityId: string,
  value: string | null,
): GrossPayOverrides {
  const next = { ...overrides };
  if (value === null) delete next[cityId];
  else next[cityId] = value;
  return next;
}

export interface ListingFairRent {
  /** Demo reference monthly rent in the listing's currency, or null when it cannot be derived. */
  referenceRentLocal: number | null;
  /** Illustrative AGI. Null only when the rent or reference is unusable; independent of pay. */
  agi: number | null;
  pay: GrossPayState;
  /** Null when the pay or the rent inputs are unusable. */
  hours: WorkingHours | null;
}

/** The one calculation both the card and the dossier render. */
export function calculateListingFairRent(
  listing: DemoReferenceInputs,
  grossPay: Pick<CityGrossPay, 'defaultHourly'> | undefined,
  payOverride?: string,
): ListingFairRent {
  const referenceRentLocal = demoReferenceRentLocal(listing);
  const pay = resolveGrossPay(grossPay, payOverride);
  if (referenceRentLocal === null) return { referenceRentLocal, agi: null, pay, hours: null };
  return {
    referenceRentLocal,
    agi: calculateAgi(listing.priceLocal, referenceRentLocal),
    pay,
    hours: calculateWorkingHours(listing.priceLocal, referenceRentLocal, pay.hourly),
  };
}

// ---------------------------------------------------------------------------------------------
// Display

/** AGI and hours are shown to one decimal. The values behind them are never rounded. */
export const DISPLAY_DECIMALS = 1;

// Formats magnitudes only. The sign is added by formatOneDecimal, because the Intl signDisplay
// value "negative" (the one that drops the sign of a value that rounds to zero) is missing from
// Firefox before 116, which the build still targets.
const ONE_DECIMAL = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: DISPLAY_DECIMALS,
  maximumFractionDigits: DISPLAY_DECIMALS,
});
const ZERO_TEXT = ONE_DECIMAL.format(0);

/**
 * The direction of a value as displayed: 1, -1, or 0 when it shows as 0.0. A difference that
 * rounds to 0.0 is therefore never described as a gain or a loss.
 */
export function displayedSign(value: number): 1 | 0 | -1 {
  if (!isFiniteNumber(value) || ONE_DECIMAL.format(Math.abs(value)) === ZERO_TEXT) return 0;
  return value > 0 ? 1 : -1;
}

/**
 * Formats a value to one decimal, or returns n/a for a value that is not a finite number. A value
 * that rounds to 0.0 has no sign, so -0 and -0.04 read 0.0 and never -0.0.
 */
export function formatOneDecimal(value: number): string {
  if (!isFiniteNumber(value)) return 'n/a';
  const magnitude = ONE_DECIMAL.format(Math.abs(value));
  return displayedSign(value) === -1 ? `-${magnitude}` : magnitude;
}
