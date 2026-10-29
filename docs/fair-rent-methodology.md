# Fair rent methodology: illustrative AGI and gross-pay hours

RentScanner shows two numbers on each bundled demo fixture listing: an **Illustrative AGI**
(Anti-Gentrification Index) and the **gross-pay hours** a month of rent takes. Both are
**illustrative calculations on demo data**. They are not an observed market measure, a verified
investor median, a savings claim, or advice about any live posting.

The calculation lives in `src/utils/fairRentCalculator.ts` and the pay defaults in
`src/data/cities.ts`. The listing card and the fixture dossier both render its output through
`src/components/FairRentMetrics.tsx`, so they cannot disagree. Scout search hits have no rent and
never get either number.

## What the numbers use

| Input | Where it comes from |
|---|---|
| Asking rent | The fixture's `priceLocal`, in the listing's own currency. |
| Demo reference rent | The fixture's `originalMarketPriceUsd`, converted to the listing's currency (below). |
| Gross hourly pay | The city default in `src/data/cities.ts`, or text the user enters. |
| Tenant protection factor | Fixed at 1.0. |

The **demo reference rent** is an illustrative value bundled with each fixture. It is not an
empirical market average and not a "speculative investor median". The city-level
`medianRentUsd` is not used.

### Currency of the reference

All amounts in one calculation share a currency.

- USD fixture: the reference is `originalMarketPriceUsd`.
- Any other currency: `originalMarketPriceUsd * priceLocal / priceUsd`. This reuses the fixture's
  own illustrative local/USD price relationship. It is **not** a live or sourced exchange rate,
  and no exchange-rate service is called. The conversion needs a finite `priceUsd` and
  `priceLocal` above zero. Without them the reference, and everything that depends on it, is
  shown as unavailable instead of using an invented rate.

## Formulas

```
Illustrative AGI = 100 * (1 - asking rent / demo reference rent) * tenant protection factor

asking hours      = asking rent / gross hourly pay
reference hours   = demo reference rent / gross hourly pay
difference        = reference hours - asking hours
```

- The tenant protection factor is a **disclosed modelling assumption**. It is 1.0 in this
  version, so AGI equals the percentage by which the asking rent sits below the demo reference.
  No legal-protection rubric supports another value, and none is configurable.
- AGI does not depend on pay. With a valid asking rent and reference it stays visible when the
  pay is missing or invalid.
- The result is **signed**. AGI is negative when the asking rent is above the reference. A
  positive difference means fewer hours than the reference. A negative difference means more
  hours, and the interface says "extra hours", never a saving.
- Nothing is rounded before arithmetic or before the difference is taken. Display rounds AGI and
  hours to **one decimal** and says so, so the three displayed hour values can differ by 0.1 from
  a subtraction of the displayed numbers. A value that rounds to 0.0 is shown as parity, never
  as `-0.0` or a gain.

Worked example, fixture `nyc-sublet-01` (asking $1,250, reference $2,800, pay $17.00/hour):

| Metric | Exact | Shown |
|---|---|---|
| Illustrative AGI | 55.357142857... | 55.4 |
| Asking rent hours | 73.529411764... | 73.5 h |
| Reference rent hours | 164.705882352... | 164.7 h |
| Difference | 91.176470588... | 91.2 fewer hours |

## Validity

- Asking rent must be finite and at least 0. A free listing (0) is valid when a reference is
  known; its AGI is 100.
- The reference must be finite and above 0.
- Gross hourly pay must be finite and above 0.
- A result that is not a finite number (for example an overflow) is treated as unavailable.
  `NaN` and `Infinity` are never shown.

## Gross hourly pay defaults

These are **gross** (before tax) amounts for the stated coverage, as of **2026-10-28**. They are
not take-home pay and not an average young-worker wage. Each default carries its basis,
effective date and sources in `src/data/cities.ts`, and the dossier shows them.

| City | Default (gross, per hour) | Coverage | Effective | Source |
|---|---|---|---|---|
| New York City | USD 17 | General covered non-tipped minimum wage | 2026-01-01 | [NY DOL](https://dol.ny.gov/minimum-wage), [NYC DCA](https://www.nyc.gov/site/dca/about/minimum-wage.page) |
| London | GBP 12.71 | Statutory floor for workers aged 21 and over. It is not the rate for younger workers. | 2026-04-01 | [GOV.UK](https://www.gov.uk/national-minimum-wage-rates) |
| Tokyo | JPY 1,280 | Tokyo minimum wage | 2026-10-01 | [Tokyo Metropolitan Government](https://www.koho.metro.tokyo.lg.jp/2026/10/oshirase03.html) |
| Bogotá | COP 9,620.36 (derived) | Derived gross hourly equivalent of the monthly minimum wage, transport allowance excluded | 2026-07-15 | See below |
| Paris | EUR 12.31 | Full adult SMIC rate. Reductions and exemptions may differ for workers under 18. | 2026-06-01 | [Legifrance](https://www.legifrance.gouv.fr/eli/arrete/2026/5/22/TRST2612929A/jo/texte) |
| Berlin | EUR 13.90 | Statutory minimum wage for generally covered workers. Statutory exemptions apply. | 2026-01-01 | [Bundesregierung](https://www.bundesregierung.de/breg-de/service/fragen-und-anworten/mindestlohn-steigt-2391010) |
| San Francisco | USD 19.61 | Generally covered San Francisco workers. Narrow government-supported exceptions differ. | 2026-07-01 | [City of San Francisco](https://media.api.sf.gov/documents/2026_Historical_San_Francisco_Minimum_Wage_Rates_M9ynRNo.pdf) |
| Dubai | none | No universal statutory minimum wage covers every Dubai worker | not applicable | [u.ae](https://u.ae/en/information-and-services/jobs/employment-in-the-private-sector/payment-of-wages) |

These defaults say nothing about whether a listing's tenant is paid a minimum wage, and no other
legal status is claimed beyond what each source states.

### Bogotá: a derived equivalent

Colombia sets the minimum wage per month, not per hour. The hourly figure is a conversion made
for this calculator:

```
COP 1,750,905 per month / (42 hours * 52 weeks / 12 months) = 1,750,905 / 182 = COP 9,620.357... per hour
```

- The monthly amount excludes the transport allowance. Decree 1469 of 2025 and the transitional
  Decree 159 of 2026 state the same amount:
  [Decree 1469 of 2025](https://normograma.crcom.gov.co/crc/compilacion/docs/decreto_1469_2025.htm),
  [Decree 159 of 2026](https://dapre.presidencia.gov.co/normativa/normativa/DECRETO%20No.%200159%20DEL%2019%20DE%20FEBRERO%20DE%202026.pdf).
- The 42-hour week phase is in
  [Function Publica](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=166506).
  The week reached 42 hours on 2026-07-15, which is the date shown for this default.
- The divisor of 182 working hours a month is an **analytical assumption**: an annual average of
  a 42-hour week. It is not an enacted hourly minimum and not a payroll or overtime divisor. The
  interface calls the result a "derived gross hourly equivalent" and shows the monthly amount and
  the conversion.

### Dubai: input required

Dubai has no default. Hours stay unavailable until the user enters a gross hourly pay in AED.
The interface says why. The Emirati or occupation-specific policies are narrower than "every
worker", so none of them is used as a universal rate.

## The pay control and its state

- The fixture dossier has a labelled number field, "Gross hourly pay", with the currency and the
  unit (per hour, before tax) in the label. It starts at the city default. Each listing card has
  a button that opens the dossier to set or edit it.
- Pay is kept **per city**, in memory in `App`. Changing it for one city updates that city's
  cards and its open dossier together and never touches another city. It is not saved: a page
  reload returns every city to its default. Closing and reopening a dossier keeps it.
- A custom value is labelled **entered by you**. It is never described as a statutory wage.
- Emptying the field, or entering something that is not a number above 0, leaves the hours
  unavailable and says what to fix. It does **not** quietly bring the default back. "Restore
  default" removes the override on purpose. Dubai has no default to restore.
- A card or dossier rendered without the pay props, for example by an older caller, uses the city
  default. A dossier without a change handler shows the numbers but no field.

## Limits

- The demo reference rent and the asking rents are illustrative fixture values. The AGI and
  hours therefore describe the fixtures, not real listings or a real market.
- The wage defaults are statutory floors for their stated coverage. A reader's own pay can be
  higher, lower, or taxed differently. Use the pay field for a better estimate.
- The tenant protection factor is neutral. AGI does not measure legal protection, and it does not
  replace the Nemotron deal score, `fairRentScore`, the categorical `gentrificationIndex`, or any
  filter or sort. Those fields are unchanged.

## Checks

```
node --experimental-strip-types --test tests/fair-rent-calculator.test.ts
```

The test is offline. It covers the arithmetic, the validation rules, the wage snapshot and all
eleven fixtures in all eight cities. It also renders the real card, dossier and `App` to static
markup and checks the text, labels and attributes shown for default, custom, cleared, invalid,
negative and parity states.

Static markup does not click, type, focus or press Escape. The tests call the card and pay control
as functions to check that their callbacks fire with the right city and text, but they do not run
a browser, so `App`'s state updates and the dialog's focus and Escape behavior are not exercised
by this suite. The test does not establish that any rate is current in law.
