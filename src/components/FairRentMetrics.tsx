import React, { useRef } from 'react';
import { CITIES } from '../data/cities';
import type { City, Listing } from '../types';
import { formatSourceHost } from '../services/tavilySearch';
import { calculateListingFairRent, displayedSign, formatOneDecimal } from '../utils/fairRentCalculator';
import type { GrossPayState, ListingFairRent } from '../utils/fairRentCalculator';
import { formatUsd } from '../utils/formatters';
import { Clock, ExternalLink } from 'lucide-react';

const PAY_INPUT_ID = 'gross-hourly-pay';
const PAY_HINT_ID = 'gross-hourly-pay-hint';
const PAY_STATUS_ID = 'gross-hourly-pay-status';

interface FairRentMetricsProps {
  listing: Listing;
  /** Text the user entered for this listing's city. Undefined means the city default applies. */
  payOverride?: string;
  variant: 'card' | 'dossier';
  /** Card: opens the dossier, where the pay is edited. */
  onEditPay?: () => void;
  /** Dossier: sets this city's pay text, or restores the default when value is null. Without it the dossier shows no field. */
  onPayOverrideChange?: (cityId: string, value: string | null) => void;
}

/** Amounts here use one en-US format so a thousands separator never reads as a decimal point. */
const formatDigits = (amount: number, minFractionDigits: number, maxFractionDigits: number) =>
  amount.toLocaleString('en-US', { minimumFractionDigits: minFractionDigits, maximumFractionDigits: maxFractionDigits });

const formatRent = (amount: number, listing: Listing) => `${listing.currencySymbol}${formatDigits(amount, 0, 0)}`;

/**
 * Pay is shown to cents (whole units for JPY). A positive rate that rounds to zero there would
 * read as no pay while the hours still use it, so it keeps three significant digits instead.
 */
function formatPay(amount: number, listing: Listing): string {
  const rounded = formatDigits(amount, listing.currency === 'JPY' ? 0 : 2, 2);
  const digits = /[1-9]/.test(rounded) ? rounded : String(Number(amount.toPrecision(3)));
  return `${listing.currencySymbol}${digits}`;
}

/**
 * Illustrative AGI and gross-pay hours for one demo fixture, from the one shared calculator. The
 * listing card and the dossier both render this, so they show the same numbers for the same pay.
 */
export const FairRentMetrics: React.FC<FairRentMetricsProps> = ({
  listing,
  payOverride,
  variant,
  onEditPay,
  onPayOverrideChange,
}) => {
  const city = CITIES.find((c) => c.id === listing.cityId);
  const result = calculateListingFairRent(listing, city?.grossPay, payOverride);
  const isDossier = variant === 'dossier';
  const payAction = needsPay(result.pay) ? 'Enter hourly pay' : 'Set or edit hourly pay';

  // wrap-anywhere lets a very large finite value (a tiny pay makes huge hours) break inside the card.
  return (
    <section
      aria-label={`Illustrative wage parity, demo data: ${listing.title}`}
      data-fair-rent={variant}
      className={`wrap-anywhere ${isDossier ? 'space-y-3 font-mono' : 'mt-3 p-2 bg-zinc-900/60 border border-zinc-800 font-mono'}`}
    >
      {isDossier && (
        <h4 className="text-xs font-bold text-zinc-300 uppercase flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
          WAGE PARITY // ILLUSTRATIVE DEMO CALCULATION
        </h4>
      )}

      <AgiBadge agi={result.agi} />

      <dl className="mt-2 space-y-0.5 text-[11px] text-zinc-300">
        <MetricRow
          label={listing.currency === 'USD' ? 'Demo reference rent' : 'Demo reference rent (local currency)'}
          value={result.referenceRentLocal === null ? 'unavailable' : `${formatRent(result.referenceRentLocal, listing)}/mo`}
        />
        {result.hours && (
          <>
            <MetricRow label="Gross-pay hours, asking rent" value={`${formatOneDecimal(result.hours.asking)} h`} />
            <MetricRow
              label="Gross-pay hours, demo reference rent"
              value={`${formatOneDecimal(result.hours.reference)} h`}
            />
            <MetricRow label="Difference" value={describeDifference(result.hours.difference)} />
          </>
        )}
      </dl>

      {!result.hours && (
        <p className="mt-2 text-[11px] text-amber-200 font-sans leading-snug">
          <strong className="font-mono uppercase">Gross-pay hours unavailable. </strong>
          {describeUnavailableHours(result, city)}
        </p>
      )}

      {result.pay.hourly !== null && (
        <p className="mt-2 text-[10px] text-zinc-400 font-sans leading-snug">{describePay(result.pay, listing, city)}</p>
      )}

      {!isDossier && (
        <>
          <p className="mt-1 text-[10px] text-zinc-500 font-sans leading-snug">
            Demo data, not market data. AGI and hours are shown to one decimal.
          </p>
          {onEditPay && (
            <button
              type="button"
              onClick={onEditPay}
              aria-label={`${payAction} for ${listing.cityName} in the listing details`}
              className="mt-2 w-full py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 text-[11px] font-bold uppercase transition cursor-pointer"
            >
              {payAction.toUpperCase()}
            </button>
          )}
        </>
      )}

      {isDossier && onPayOverrideChange && (
        <GrossPayControl
          listing={listing}
          city={city}
          payOverride={payOverride}
          pay={result.pay}
          onChange={onPayOverrideChange}
        />
      )}

      {isDossier && <MethodNotes listing={listing} city={city} result={result} />}
    </section>
  );
};

const AgiBadge: React.FC<{ agi: number | null }> = ({ agi }) => {
  const sign = agi === null ? null : displayedSign(agi);
  const tone =
    sign === 1
      ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
      : sign === null
        ? 'bg-zinc-900 text-zinc-300 border-zinc-700'
        : 'bg-amber-950 text-amber-300 border-amber-700';
  const note =
    sign === null
      ? 'Needs a valid asking rent and demo reference rent.'
      : sign === 1
        ? 'Asking rent is below the demo reference rent.'
        : sign === -1
          ? 'Asking rent is above the demo reference rent.'
          : 'Asking rent matches the demo reference rent.';

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className={`px-2 py-0.5 border text-xs font-bold ${tone}`}>
        <span className="uppercase text-[10px]">Illustrative AGI</span>{' '}
        <strong className="font-black">{agi === null ? 'unavailable' : formatOneDecimal(agi)}</strong>
      </span>
      <span className="text-[10px] text-zinc-400 font-sans">{note}</span>
    </div>
  );
};

const MetricRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
    <dt className="text-zinc-400">{label}</dt>
    <dd className="font-bold text-zinc-100">{value}</dd>
  </div>
);

/** Direction is worded, not colored or signed alone, and a difference that shows as 0.0 is parity. */
function describeDifference(difference: number): string {
  const sign = displayedSign(difference);
  const amount = formatOneDecimal(Math.abs(difference));
  if (sign === 1) return `${amount} fewer hours than the demo reference`;
  if (sign === -1) return `${amount} extra hours vs the demo reference`;
  return 'Same hours as the demo reference (0.0 h at one decimal)';
}

const needsPay = (pay: GrossPayState) => pay.hourly === null;
const endSentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

function describeUnavailableHours(result: ListingFairRent, city: City | undefined): string {
  const hasDefault = (city?.grossPay.defaultHourly ?? null) !== null;
  switch (result.pay.status) {
    case 'required':
      return city && !hasDefault ? city.grossPay.basis : 'Enter a gross hourly pay in the listing details.';
    case 'cleared':
      // A number input reports unfinished text such as "1e" as empty, so this covers both.
      return `The gross hourly pay is empty or incomplete, so the default is not used. Enter a complete rate${hasDefault ? ' or restore the default' : ''} in the listing details.`;
    case 'invalid':
      return 'The gross hourly pay entered is not a number above 0. Fix it in the listing details.';
    default:
      // The pay is usable here, so the hours are missing because of the rents or an overflow.
      if (result.referenceRentLocal === null) return 'The demo reference rent is not available for this fixture.';
      if (result.agi === null) return 'The asking rent and demo reference rent do not give a usable result for this fixture.';
      return 'The hours are too large to calculate at this gross hourly pay. Enter a larger rate in the listing details.';
  }
}

function describePay(pay: GrossPayState & { hourly: number }, listing: Listing, city: City | undefined): string {
  const rate = `${formatPay(pay.hourly, listing)}/h gross`;
  if (pay.status === 'default' && city) {
    const { basis, effectiveDate } = city.grossPay;
    return `At ${rate}, city default: ${endSentence(basis)} Effective ${effectiveDate}.`;
  }
  return `At ${rate}, entered by you. This is your figure, not a statutory wage.`;
}

interface GrossPayControlProps {
  listing: Listing;
  city: City | undefined;
  payOverride: string | undefined;
  pay: GrossPayState;
  onChange: (cityId: string, value: string | null) => void;
}

const GrossPayControl: React.FC<GrossPayControlProps> = ({ listing, city, payOverride, pay, onChange }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const defaultHourly = city?.grossPay.defaultHourly ?? null;
  // The field starts at the exact default the hours use (Bogota's is not a round number), so
  // clearing it is a visible, deliberate act and re-entering the shown text changes nothing.
  const value = payOverride ?? (defaultHourly === null ? '' : String(defaultHourly));
  const unusable = pay.status === 'invalid' || pay.status === 'cleared';
  const canRestore = payOverride !== undefined && defaultHourly !== null;

  // The restore button unmounts once the default applies, so focus moves to the field first.
  const restoreDefault = () => {
    onChange(listing.cityId, null);
    inputRef.current?.focus();
  };

  let status = '';
  if (pay.status === 'invalid') status = 'Enter a number above 0, for example 12.50.';
  else if (pay.status === 'cleared') {
    // A number input reports unfinished text such as "1e" as empty, so this covers both.
    status = `The field is empty or incomplete, so hours stay unavailable until you enter a complete rate${canRestore ? ' or restore the default' : ''}.`;
  } else if (pay.status === 'required') {
    status = 'Required: enter a rate to see gross-pay hours.';
  }

  return (
    <div className="p-3 bg-black/40 border border-zinc-800">
      <label htmlFor={PAY_INPUT_ID} className="block text-xs font-bold text-zinc-200 mb-1.5">
        Gross hourly pay ({listing.currency} per hour, before tax)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          id={PAY_INPUT_ID}
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          required
          value={value}
          onChange={(e) => onChange(listing.cityId, e.target.value)}
          aria-invalid={unusable}
          aria-describedby={`${PAY_HINT_ID} ${PAY_STATUS_ID}`}
          className={`w-32 bg-zinc-900 border text-xs text-zinc-100 p-1.5 font-mono focus:outline-none focus:border-emerald-500 ${
            unusable || pay.status === 'required' ? 'border-amber-500' : 'border-zinc-700'
          }`}
        />
        <span className="text-xs text-zinc-400" aria-hidden="true">
          {listing.currency} / hour
        </span>
        {canRestore && (
          <button
            type="button"
            onClick={restoreDefault}
            className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 text-[11px] font-bold uppercase transition cursor-pointer"
          >
            RESTORE DEFAULT
          </button>
        )}
      </div>
      <p id={PAY_HINT_ID} className="mt-1.5 text-[10px] text-zinc-500 font-sans leading-snug">
        Gross pay before tax, in {listing.currency}. It applies to every {listing.cityName} listing and is kept only
        until the page reloads.
      </p>
      <p id={PAY_STATUS_ID} aria-live="polite" className="text-[11px] text-amber-200 font-sans leading-snug mt-1 empty:mt-0">
        {status}
      </p>
    </div>
  );
};

const MethodNotes: React.FC<{ listing: Listing; city: City | undefined; result: ListingFairRent }> = ({
  listing,
  city,
  result,
}) => {
  const grossPay = city?.grossPay;
  const conversion = grossPay?.monthlyConversion;

  return (
    <div className="space-y-1.5 text-[10px] text-zinc-400 font-sans leading-relaxed">
      <p>
        <strong className="font-mono uppercase text-zinc-300">Formula: </strong>
        Illustrative AGI = 100 * (1 - asking rent / demo reference rent) * 1.0. The 1.0 is a neutral tenant protection
        factor, a modelling assumption. Hours = monthly rent / gross hourly pay.
      </p>
      <p>
        <strong className="font-mono uppercase text-zinc-300">Demo reference rent: </strong>
        the fixture&apos;s illustrative reference price, not a verified investor median, market average, or saving on a
        live posting.
        {listing.currency !== 'USD' && result.referenceRentLocal !== null && (
          <>
            {' '}
            It is converted from {formatUsd(listing.originalMarketPriceUsd)} USD with this fixture&apos;s own
            local/USD price ratio. That is not a live exchange rate.
          </>
        )}
      </p>
      <p>
        <strong className="font-mono uppercase text-zinc-300">Precision: </strong>
        AGI and hours are shown to one decimal. The calculation uses unrounded values.
      </p>
      {grossPay && conversion && grossPay.defaultHourly !== null && (
        <p>
          <strong className="font-mono uppercase text-zinc-300">Derived gross hourly equivalent: </strong>
          {formatRent(conversion.monthlyAmount, listing)} per month / {conversion.hoursPerMonth} working hours a month
          = {formatPay(grossPay.defaultHourly, listing)} per hour. {conversion.assumption}
        </p>
      )}
      {grossPay && grossPay.sources.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <strong className="font-mono uppercase text-zinc-300">Wage sources for {listing.cityName}: </strong>
          {grossPay.sources.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open wage source ${formatSourceHost(url)} (opens in a new tab)`}
              className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
            >
              {formatSourceHost(url)}
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
          ))}
        </p>
      )}
    </div>
  );
};
