import type { City } from '../types';

// Bogotá's minimum wage is enacted per month. The hourly equivalent divides it by an annual-average
// 42-hour week: 42 * 52 / 12 = 182 working hours a month. That divisor is an analytical assumption,
// not an enacted hourly minimum and not a payroll or overtime divisor.
const BOGOTA_MONTHLY_MINIMUM_COP = 1750905;
const BOGOTA_WEEKLY_HOURS = 42;
const BOGOTA_HOURS_PER_MONTH = (BOGOTA_WEEKLY_HOURS * 52) / 12;

// Gross pay defaults are as of 2026-10-28. They are statutory floors for the stated coverage, not
// take-home pay and not a universal young-worker average. Derivation and sources are in
// docs/fair-rent-methodology.md.
export const CITIES: City[] = [
  {
    id: 'nyc',
    name: 'New York City',
    country: 'United States',
    currency: 'USD',
    currencySymbol: '$',
    medianRentUsd: 3450,
    topAffordableNeighborhoods: ['Bushwick', 'Ridgewood', 'Crown Heights', 'Inwood', 'Chinatown'],
    gentrificationRating: 'Severe',
    activeDealsCount: 42,
    grossPay: {
      defaultHourly: 17,
      basis: 'General covered non-tipped minimum wage',
      effectiveDate: '2026-01-01',
      sources: ['https://dol.ny.gov/minimum-wage', 'https://www.nyc.gov/site/dca/about/minimum-wage.page'],
    },
  },
  {
    id: 'london',
    name: 'London',
    country: 'United Kingdom',
    currency: 'GBP',
    currencySymbol: '£',
    medianRentUsd: 2650,
    topAffordableNeighborhoods: ['Deptford', 'Peckham', 'Walthamstow', 'Hackney Wick', 'Lewisham'],
    gentrificationRating: 'Severe',
    activeDealsCount: 38,
    grossPay: {
      defaultHourly: 12.71,
      basis: 'Statutory floor for workers aged 21 and over (not the rate for younger workers)',
      effectiveDate: '2026-04-01',
      sources: ['https://www.gov.uk/national-minimum-wage-rates'],
    },
  },
  {
    id: 'tokyo',
    name: 'Tokyo',
    country: 'Japan',
    currency: 'JPY',
    currencySymbol: '¥',
    medianRentUsd: 1450,
    topAffordableNeighborhoods: ['Koenji', 'Shimokitazawa Sub-alleys', 'Koto-ku', 'Nakano', 'Adachi'],
    gentrificationRating: 'Moderate',
    activeDealsCount: 29,
    grossPay: {
      defaultHourly: 1280,
      basis: 'Tokyo minimum wage',
      effectiveDate: '2026-10-01',
      sources: ['https://www.koho.metro.tokyo.lg.jp/2026/10/oshirase03.html'],
    },
  },
  {
    id: 'bogota',
    name: 'Bogotá',
    country: 'Colombia',
    currency: 'COP',
    currencySymbol: 'COP $',
    medianRentUsd: 650,
    topAffordableNeighborhoods: ['Chapinero Alto', 'Teusaquillo', 'La Soledad', 'Parkway', 'Cedritos'],
    gentrificationRating: 'High',
    activeDealsCount: 31,
    grossPay: {
      defaultHourly: BOGOTA_MONTHLY_MINIMUM_COP / BOGOTA_HOURS_PER_MONTH,
      basis:
        'Derived gross hourly equivalent of the monthly minimum wage (transport allowance excluded). ' +
        'Not an enacted hourly rate.',
      // The date the 42-hour week was reached, which is when this equivalent's divisor applies.
      effectiveDate: '2026-07-15',
      sources: [
        'https://normograma.crcom.gov.co/crc/compilacion/docs/decreto_1469_2025.htm',
        'https://dapre.presidencia.gov.co/normativa/normativa/DECRETO%20No.%200159%20DEL%2019%20DE%20FEBRERO%20DE%202026.pdf',
        'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=166506',
      ],
      monthlyConversion: {
        monthlyAmount: BOGOTA_MONTHLY_MINIMUM_COP,
        hoursPerMonth: BOGOTA_HOURS_PER_MONTH,
        assumption:
          '42 hours a week * 52 weeks / 12 months = 182 working hours a month. An analytical assumption ' +
          'based on the 42-hour week reached on 2026-07-15, not a payroll or overtime divisor.',
      },
    },
  },
  {
    id: 'dubai',
    name: 'Dubai',
    country: 'United Arab Emirates',
    currency: 'AED',
    currencySymbol: 'AED ',
    medianRentUsd: 2350,
    topAffordableNeighborhoods: ['JLT Cluster V', 'Al Barsha 1', 'Silicon Oasis', 'Deira Heritage'],
    gentrificationRating: 'High',
    activeDealsCount: 24,
    grossPay: {
      defaultHourly: null,
      basis:
        'No default. There is no universal statutory minimum wage for every Dubai worker, so enter your own ' +
        'gross hourly pay in AED.',
      effectiveDate: null,
      sources: ['https://u.ae/en/information-and-services/jobs/employment-in-the-private-sector/payment-of-wages'],
    },
  },
  {
    id: 'paris',
    name: 'Paris',
    country: 'France',
    currency: 'EUR',
    currencySymbol: '€',
    medianRentUsd: 2150,
    topAffordableNeighborhoods: ['19th Arrondissement', '20th Belleville', '11th Oberkampf Backstreet', 'Montreuil'],
    gentrificationRating: 'Severe',
    activeDealsCount: 33,
    grossPay: {
      defaultHourly: 12.31,
      basis: 'Full adult SMIC rate (reductions and exemptions may differ for workers under 18)',
      effectiveDate: '2026-06-01',
      sources: ['https://www.legifrance.gouv.fr/eli/arrete/2026/5/22/TRST2612929A/jo/texte'],
    },
  },
  {
    id: 'berlin',
    name: 'Berlin',
    country: 'Germany',
    currency: 'EUR',
    currencySymbol: '€',
    medianRentUsd: 1800,
    topAffordableNeighborhoods: ['Wedding', 'Neukölln Outer', 'Moabit', 'Friedrichshain Nord'],
    gentrificationRating: 'Severe',
    activeDealsCount: 36,
    grossPay: {
      defaultHourly: 13.9,
      basis: 'Statutory minimum wage for generally covered workers (statutory exemptions apply)',
      effectiveDate: '2026-01-01',
      sources: ['https://www.bundesregierung.de/breg-de/service/fragen-und-anworten/mindestlohn-steigt-2391010'],
    },
  },
  {
    id: 'sf',
    name: 'San Francisco',
    country: 'United States',
    currency: 'USD',
    currencySymbol: '$',
    medianRentUsd: 3150,
    topAffordableNeighborhoods: ['Inner Sunset', 'Mission District (Co-op)', 'West Oakland', 'Berkeley South'],
    gentrificationRating: 'Severe',
    activeDealsCount: 27,
    grossPay: {
      defaultHourly: 19.61,
      basis: 'Minimum wage for generally covered San Francisco workers (narrow government-supported exceptions differ)',
      effectiveDate: '2026-07-01',
      sources: ['https://media.api.sf.gov/documents/2026_Historical_San_Francisco_Minimum_Wage_Rates_M9ynRNo.pdf'],
    },
  },
];
