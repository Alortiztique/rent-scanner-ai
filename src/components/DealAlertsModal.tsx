import { useState } from 'react';
import { Bell, ExternalLink, X } from 'lucide-react';
import { CITIES } from '../data/cities';
import type { AlertPreferences, Listing } from '../types';
import { findAlertPreview, formatDealAlert, getAlertPreferences, saveAlertPreferences, TELEGRAM_BOT_URL, MIN_ALERT_SCORE } from '../services/notifications';
import { MODAL_DIALOG_CLASS, useModalDialog } from './useModalDialog';

interface DealAlertsModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultCityId: string;
  listings: readonly Listing[];
}

export function DealAlertsModal({ isOpen, ...props }: DealAlertsModalProps) {
  if (!isOpen) return null;
  return <DealAlertsDialog {...props} />;
}

function DealAlertsDialog({ onClose, defaultCityId, listings }: Omit<DealAlertsModalProps, 'isOpen'>) {
  const { dialogRef, initialFocusRef } = useModalDialog(onClose);
  const [preferences, setPreferences] = useState(() => getAlertPreferences(defaultCityId));
  const [budget, setBudget] = useState(() => preferences.maxPriceLocal?.toString() ?? '');
  const [incompleteBudget, setIncompleteBudget] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const city = CITIES.find((item) => item.id === preferences.cityId)!;
  const amount = budget === '' ? null : Number(budget);
  const invalidBudget = incompleteBudget || (amount !== null && (!Number.isFinite(amount) || amount < 0));
  const currentPreferences = { ...preferences, maxPriceLocal: amount };
  const sample = invalidBudget ? undefined : findAlertPreview(listings, currentPreferences);

  const update = (next: Partial<AlertPreferences>) => {
    setPreferences((previous) => ({ ...previous, ...next }));
    setSaveStatus('');
  };

  return (
    <dialog ref={dialogRef} aria-labelledby="deal-alerts-heading" className={MODAL_DIALOG_CLASS}>
      <div className="w-full max-w-2xl max-h-full overflow-y-auto border border-zinc-700 bg-zinc-950 font-mono shadow-[6px_6px_0px_0px_#18181b]">
        <div className="flex items-center justify-between gap-3 p-4 border-b border-zinc-800">
          <h2 id="deal-alerts-heading" className="flex items-center gap-2 text-base font-bold text-emerald-400">
            <Bell className="w-4 h-4" aria-hidden="true" /> DEAL ALERTS
          </h2>
          <button ref={initialFocusRef} type="button" onClick={onClose} aria-label="Close deal alerts" className="p-2 hover:bg-zinc-800 cursor-pointer focus-visible:outline-2 focus-visible:outline-white">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-5 text-sm">
          <section aria-labelledby="telegram-alerts-heading" className="p-4 border border-emerald-900 bg-emerald-950/20 space-y-3">
            <h3 id="telegram-alerts-heading" className="font-bold text-zinc-100">Set up Telegram alerts</h3>
            <p className="text-zinc-400 font-sans">
              Open our Telegram bot, press Start, then choose your city, budget and housing preferences there.
              The bot must be running to respond. Opening it does not subscribe you automatically.
            </p>
            <a href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-400 hover:bg-emerald-300 text-black font-bold text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              CONTINUE IN TELEGRAM <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </section>

          <form onSubmit={(event) => {
            event.preventDefault();
            if (invalidBudget) return;
            setSaveStatus(saveAlertPreferences(currentPreferences)
              ? 'Preview settings saved on this device. Your Telegram subscription has not changed.'
              : 'Could not save preview settings. Browser storage may be unavailable.');
          }} className="space-y-4">
            <div>
              <h3 className="font-bold text-zinc-100">Preview a sample alert</h3>
              <p className="mt-1 text-zinc-400 font-sans text-xs">
                Uses bundled demo listings only. These controls do not send messages or change Telegram settings.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-xs text-zinc-300">
                City
                <select value={preferences.cityId} onChange={(event) => {
                  update({ cityId: event.target.value });
                  setBudget('');
                  setIncompleteBudget(false);
                }} className="mt-1 w-full p-2 bg-zinc-900 border border-zinc-700 focus-visible:outline-2 focus-visible:outline-emerald-400">
                  {CITIES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="block text-xs text-zinc-300">
                Preview channel
                <select value={preferences.channel} onChange={(event) => update({ channel: event.target.value as AlertPreferences['channel'] })} className="mt-1 w-full p-2 bg-zinc-900 border border-zinc-700 focus-visible:outline-2 focus-visible:outline-emerald-400">
                  <option value="telegram">Telegram</option>
                  <option value="whatsapp">WhatsApp preview only</option>
                </select>
              </label>
              <label className="block text-xs text-zinc-300">
                Maximum monthly rent ({city.currency})
                <input key={preferences.cityId} type="number" min="0" step="any" inputMode="decimal" value={budget} aria-invalid={invalidBudget} aria-describedby="alert-budget-help" onChange={(event) => {
                  setBudget(event.target.value);
                  setIncompleteBudget(event.target.validity.badInput);
                  setSaveStatus('');
                }} className="mt-1 w-full p-2 bg-zinc-900 border border-zinc-700 focus-visible:outline-2 focus-visible:outline-emerald-400" />
                <span id="alert-budget-help" className={`block mt-1 font-sans ${invalidBudget ? 'text-amber-300' : 'text-zinc-500'}`}>
                  {invalidBudget ? 'Enter a complete number of 0 or more.' : 'Leave blank for no limit. Changing city clears the budget.'}
                </span>
              </label>
              <label className="block text-xs text-zinc-300">
                Minimum sample deal score
                <select value={preferences.minDealScore} onChange={(event) => update({ minDealScore: Number(event.target.value) })} className="mt-1 w-full p-2 bg-zinc-900 border border-zinc-700 focus-visible:outline-2 focus-visible:outline-emerald-400">
                  {Array.from({ length: 101 - MIN_ALERT_SCORE }, (_, index) => MIN_ALERT_SCORE + index).map((score) => <option key={score} value={score}>{score} / 100</option>)}
                </select>
              </label>
            </div>

            {preferences.channel === 'whatsapp' && (
              <p className="text-xs text-amber-300 font-sans">WhatsApp delivery is not connected. You can preview its message here.</p>
            )}

            <section aria-label="Sample alert preview" aria-live="polite" className="p-3 border border-zinc-800 bg-black text-xs text-zinc-300">
              {invalidBudget ? <p>Fix the budget to preview an alert.</p>
                : sample ? <pre className="font-mono whitespace-pre-wrap wrap-anywhere">{formatDealAlert(sample, preferences.channel)}</pre>
                  : <p>No demo listing matches these preview settings. No message has been sent.</p>}
            </section>

            <button type="submit" disabled={invalidBudget} className="px-3 py-2 border border-zinc-600 bg-zinc-900 hover:bg-zinc-800 text-xs font-bold cursor-pointer disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-white">
              SAVE PREVIEW SETTINGS ON THIS DEVICE
            </button>
            <p role="status" className="text-xs font-sans text-zinc-400 empty:hidden">{saveStatus}</p>
          </form>
        </div>
      </div>
    </dialog>
  );
}
