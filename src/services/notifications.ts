import { z } from 'zod';
import { CITIES } from '../data/cities';
import type { AlertPreferences, Listing } from '../types';
import { formatCurrency } from '../utils/formatters';

export const TELEGRAM_BOT_URL = 'https://t.me/Rent_Scanner_AI_BOT?start=web';
const STORAGE_KEY = 'rentscanner_alert_preferences';

const preferencesSchema = z.object({
  cityId: z.string().refine((id) => CITIES.some((city) => city.id === id)),
  maxPriceLocal: z.number().finite().nonnegative().nullable(),
  minDealScore: z.number().int().min(90).max(100),
  channel: z.enum(['telegram', 'whatsapp']),
});

/** These preferences belong to the local preview, not a Telegram subscription. */
export function getAlertPreferences(defaultCityId: string): AlertPreferences {
  const defaults: AlertPreferences = {
    cityId: CITIES.some((city) => city.id === defaultCityId) ? defaultCityId : 'bogota',
    maxPriceLocal: null,
    minDealScore: 95,
    channel: 'telegram',
  };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const result = preferencesSchema.safeParse(JSON.parse(stored));
      if (result.success) return result.data;
    }
  } catch {
    // Storage may be blocked or contain an older or malformed value.
  }
  return defaults;
}

export function saveAlertPreferences(preferences: AlertPreferences): boolean {
  const result = preferencesSchema.safeParse(preferences);
  if (!result.success) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(result.data));
    return true;
  } catch {
    return false;
  }
}

/** Only the priced demo fixtures are supplied by App. Unverified Scout hits have no score. */
export function findAlertPreview(listings: readonly Listing[], preferences: AlertPreferences): Listing | undefined {
  return listings
    .filter((listing) =>
      listing.cityId === preferences.cityId &&
      Number.isFinite(listing.dealScore) && listing.dealScore >= preferences.minDealScore &&
      Number.isFinite(listing.priceLocal) && listing.priceLocal >= 0 &&
      (preferences.maxPriceLocal === null || listing.priceLocal <= preferences.maxPriceLocal)
    )
    .sort((a, b) => b.dealScore - a.dealScore)[0];
}

/** Plain text for an on-screen preview. No network request or delivery is performed. */
export function formatDealAlert(listing: Listing, channel: AlertPreferences['channel']): string {
  return [
    `RENTSCANNER // ${channel.toUpperCase()} DEMO ALERT`,
    'Sample data. Not a live listing or a delivered message.',
    '',
    `${listing.cityName} / ${listing.neighborhood}`,
    listing.title,
    `${formatCurrency(listing.priceLocal, listing.currency, listing.currencySymbol)} per month`,
    `Sample deal score: ${listing.dealScore}/100`,
    '',
    `Sample source: ${listing.sourceUrl}`,
  ].join('\n');
}
