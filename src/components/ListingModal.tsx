import React, { useLayoutEffect, useRef, useState } from 'react';
import type { Listing, RadarListing, ScoutListing } from '../types';
import { formatCurrency, formatUsd } from '../utils/formatters';
import { auditListingWithNemotron } from '../services/nebius';
import { isScoutListing } from '../services/scoutListings';
import { formatSourceHost } from '../services/tavilySearch';
import {
  X,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Copy,
  Check,
  ExternalLink,
  MessageSquare,
  Flame,
  Cpu,
  FileText,
  AlertTriangle,
  FlaskConical,
  SearchCheck,
} from 'lucide-react';

interface ListingModalProps {
  listing: RadarListing | null;
  onClose: () => void;
}

/**
 * Each selection mounts a fresh details view keyed by its id, so an audit, clause text, or
 * copy state from an earlier selection (including a late re-audit reply) cannot carry over.
 * Scout candidates get a separate view that has no audit, model attribution, or script.
 */
export const ListingModal: React.FC<ListingModalProps> = ({ listing, onClose }) => {
  if (!listing) return null;
  if (isScoutListing(listing)) {
    return <ScoutCandidateDetails key={listing.id} candidate={listing} onClose={onClose} />;
  }
  return <FixtureDossier key={listing.id} listing={listing} onClose={onClose} />;
};

/**
 * Shows a details view as a native modal dialog. showModal() makes the rest of the page inert,
 * so Tab and Shift+Tab cannot reach covered Radar controls, and Escape closes it natively.
 * A native close reports through onClose so React clears the selection. Closing by button
 * unmounts the view instead; cleanup then closes the dialog and refocuses the control that
 * opened it.
 */
function useModalDialog(onClose: () => void) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !dialog.isConnected) return;
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body && !dialog.contains(active) ? active : null;

    // The close event is queued, so one from an earlier setup can arrive after the dialog was
    // reopened (for example on a remount). Only a dialog that is actually closed reports it.
    const handleClose = () => {
      if (!dialog.open) onCloseRef.current();
    };
    dialog.addEventListener('close', handleClose);
    if (!dialog.open) dialog.showModal();
    initialFocusRef.current?.focus();

    return () => {
      dialog.removeEventListener('close', handleClose);
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return { dialogRef, initialFocusRef };
}

// Fills the viewport and centers the panel like the former overlay; ::backdrop dims the page.
// Display is set only while open so the user agent's closed-dialog hiding still applies.
const DIALOG_CLASS =
  'fixed inset-0 m-0 h-full max-h-none w-full max-w-none open:flex items-center justify-center p-3 sm:p-6 bg-transparent text-zinc-100 overflow-y-auto backdrop:bg-black/85 backdrop:backdrop-blur-sm';

const ScoutCandidateDetails: React.FC<{ candidate: ScoutListing; onClose: () => void }> = ({
  candidate,
  onClose,
}) => {
  const { dialogRef, initialFocusRef: closeRef } = useModalDialog(onClose);
  const isDemo = candidate.mode === 'demo';
  const host = formatSourceHost(candidate.sourceUrl);
  const headingId = 'scout-candidate-details-title';

  return (
    <dialog ref={dialogRef} aria-labelledby={headingId} className={DIALOG_CLASS}>
      <div className="relative w-full max-w-2xl bg-zinc-950 border-2 border-cyan-900 shadow-[8px_8px_0px_0px_#164e63] my-8 overflow-hidden font-mono">
        <div className="flex items-center justify-between px-4 py-3 bg-zinc-900 border-b border-zinc-800">
          <span className="text-xs font-bold text-zinc-200 tracking-wider uppercase">
            RENTSCANNER // {isDemo ? 'DEMO SAMPLE' : 'UNVERIFIED SEARCH HIT'}
          </span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close search hit details"
            className="p-1 hover:bg-zinc-800 text-zinc-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-4 sm:p-6 max-h-[80vh] overflow-y-auto space-y-5">
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] uppercase">
            {isDemo ? (
              <span className="px-1.5 py-0.5 bg-amber-950 text-amber-300 border border-amber-700 font-bold flex items-center gap-1">
                <FlaskConical className="w-3 h-3" aria-hidden="true" />
                Demo sample
              </span>
            ) : (
              <span className="px-1.5 py-0.5 bg-zinc-800 text-zinc-200 border border-zinc-600 font-bold flex items-center gap-1">
                <SearchCheck className="w-3 h-3" aria-hidden="true" />
                Unverified search hit
              </span>
            )}
            <span className="px-1.5 py-0.5 bg-zinc-900 text-zinc-400 border border-zinc-800">{candidate.source}</span>
          </div>

          <div>
            <div className="text-xs text-zinc-400 uppercase mb-1">
              {candidate.cityName} · {host}
            </div>
            <h2 id={headingId} className="text-base sm:text-lg font-bold text-white leading-snug break-words">
              {candidate.title}
            </h2>
          </div>

          <div
            className={`p-3 border text-xs font-sans leading-relaxed ${
              isDemo ? 'border-amber-800 bg-amber-950/30 text-amber-100' : 'border-zinc-700 bg-zinc-900/70 text-zinc-200'
            }`}
          >
            {isDemo ? (
              <>
                This is a local demo sample: no live search ran. Its text is synthetic and it is not a real
                posting. The link opens the {host} homepage, not a listing.
              </>
            ) : (
              <>
                Only the title, snippet, and link come from the source. Rent, availability, and property details
                are unknown, and this hit has not been deal-scored or audited. Check everything on the original
                source before contacting anyone.
              </>
            )}
          </div>

          <div className="p-4 bg-zinc-900/40 border border-zinc-800">
            <h3 className="text-xs font-bold text-zinc-300 uppercase mb-2 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
              {isDemo ? 'SAMPLE TEXT' : 'SOURCE SNIPPET'}
            </h3>
            <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed whitespace-pre-line font-sans break-words">
              {candidate.description || 'The source returned no snippet.'}
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {candidate.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 bg-zinc-900 border border-zinc-800 text-zinc-300 text-[10px] uppercase font-bold"
              >
                #{tag}
              </span>
            ))}
          </div>

          <div className="pt-3 border-t border-zinc-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="text-xs text-zinc-500 break-all">{candidate.sourceUrl}</span>
            <a
              href={candidate.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={
                isDemo
                  ? `Open demo source site ${host} (opens in a new tab)`
                  : `Open original source for "${candidate.title}" on ${host} (opens in a new tab)`
              }
              className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 flex items-center gap-1.5 transition cursor-pointer shrink-0"
            >
              <span>{isDemo ? 'OPEN DEMO SOURCE SITE' : 'OPEN ORIGINAL SOURCE'}</span>
              <ExternalLink className="w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
            </a>
          </div>
        </div>

        <div className="p-4 bg-zinc-900 border-t border-zinc-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold uppercase transition cursor-pointer"
          >
            CLOSE
          </button>
        </div>
      </div>
    </dialog>
  );
};

const FixtureDossier: React.FC<{ listing: Listing; onClose: () => void }> = ({ listing, onClose }) => {
  const { dialogRef, initialFocusRef: closeRef } = useModalDialog(onClose);
  const [copied, setCopied] = useState(false);
  const [customClause, setCustomClause] = useState('');
  const [isAuditing, setIsAuditing] = useState(false);
  const [currentAudit, setCurrentAudit] = useState(listing.nemotronAudit);
  const headingId = 'fixture-dossier-title';

  const handleCopyNegotiation = () => {
    const textToCopy = currentAudit?.negotiationScript || listing.nemotronAudit.negotiationScript;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleReauditWithCustomClause = async () => {
    if (!customClause.trim()) return;
    setIsAuditing(true);
    try {
      const updatedAudit = await auditListingWithNemotron(listing, customClause);
      setCurrentAudit(updatedAudit);
    } catch (err) {
      console.error('Error during re-audit:', err);
    } finally {
      setIsAuditing(false);
    }
  };

  const activeAudit = currentAudit || listing.nemotronAudit;

  return (
    <dialog ref={dialogRef} aria-labelledby={headingId} className={DIALOG_CLASS}>
      <div className="relative w-full max-w-4xl bg-zinc-950 border-2 border-zinc-700 shadow-[8px_8px_0px_0px_#18181b] my-8 overflow-hidden font-mono">
        {/* Top Header Bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-zinc-900 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-emerald-500"></span>
            <span className="text-xs font-bold text-zinc-200 tracking-wider uppercase">
              RENTSCANNER // DEMO FIXTURE DOSSIER #{listing.id}
            </span>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close listing dossier"
            className="p-1 hover:bg-zinc-800 text-zinc-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-4 sm:p-6 max-h-[80vh] overflow-y-auto space-y-6">
          <div className="p-3 border border-amber-800 bg-amber-950/30 text-xs text-amber-100 font-sans leading-relaxed">
            <strong className="font-mono uppercase text-amber-300">Demo fixture: </strong>
            bundled sample listing. Its price, median, deal score, availability, and audit are illustrative
            sample values, not a live posting.
          </div>

          {/* Main Visual & Title Grid */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            <div className="md:col-span-6">
              <div className="relative h-64 border border-zinc-800 overflow-hidden bg-zinc-900">
                <img
                  src={listing.imageUrl}
                  alt={listing.title}
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-2 left-2 bg-black/85 px-2.5 py-1 text-xs border border-zinc-800 text-emerald-400 font-bold">
                  {listing.dealScore}/100 DEAL SCORE // -{listing.savingsPercentage}% MKT
                </div>
              </div>

              {/* Tag row */}
              <div className="flex flex-wrap gap-1.5 mt-3">
                {listing.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 bg-zinc-900 border border-zinc-800 text-zinc-300 text-[10px] uppercase font-bold"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>

            <div className="md:col-span-6 flex flex-col justify-between">
              <div>
                <div className="text-xs text-zinc-400 uppercase mb-1">
                  {listing.neighborhood}, {listing.cityName}
                </div>
                <h2 id={headingId} className="text-base sm:text-lg font-bold text-white leading-snug">
                  {listing.title}
                </h2>

                {/* Price metrics callout */}
                <div className="my-4 p-3 bg-zinc-900/80 border border-zinc-800">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <div className="text-2xl font-black text-emerald-400">
                        {formatCurrency(listing.priceLocal, listing.currency, listing.currencySymbol)}
                        <span className="text-xs text-zinc-400 font-normal"> / month</span>
                      </div>
                      {listing.currency !== 'USD' && (
                        <div className="text-xs text-zinc-400 mt-0.5">
                          Equivalent: {formatUsd(listing.priceUsd)} USD
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-zinc-500 uppercase">Local Median</div>
                      <div className="text-sm text-zinc-400 line-through">
                        {formatUsd(listing.originalMarketPriceUsd)}/mo
                      </div>
                      <div className="text-xs text-emerald-400 font-bold mt-0.5">
                        Save ~${(listing.originalMarketPriceUsd - listing.priceUsd).toLocaleString()}/mo
                      </div>
                    </div>
                  </div>
                </div>

                {/* Quick specs */}
                <div className="grid grid-cols-2 gap-2 text-xs text-zinc-300">
                  <div className="p-2 bg-zinc-900 border border-zinc-850">
                    <span className="text-zinc-500 uppercase block text-[10px]">DURATION:</span>
                    <span className="font-bold">{listing.duration}</span>
                  </div>
                  <div className="p-2 bg-zinc-900 border border-zinc-850">
                    <span className="text-zinc-500 uppercase block text-[10px]">MOVE-IN:</span>
                    <span className="font-bold">{listing.availableDate}</span>
                  </div>
                </div>
              </div>

              {/* Source Action */}
              <div className="mt-4 pt-3 border-t border-zinc-900 flex items-center justify-between">
                <span className="text-xs text-zinc-500">Source: {listing.source}</span>
                <a
                  href={listing.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 flex items-center gap-1.5 transition cursor-pointer"
                >
                  <span>VIEW ORIGINAL POSTING</span>
                  <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                </a>
              </div>
            </div>
          </div>

          {/* Description Section */}
          <div className="p-4 bg-zinc-900/40 border border-zinc-800">
            <h4 className="text-xs font-bold text-zinc-300 uppercase mb-2 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-zinc-400" />
              POSTING DESCRIPTION
            </h4>
            <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed whitespace-pre-line font-sans">
              {listing.description}
            </p>
          </div>

          {/* NVIDIA Nemotron Deep Lease & Scam Audit */}
          <div className="border border-emerald-900/60 bg-emerald-950/20 p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-emerald-900/40">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-emerald-500 text-black font-black text-xs">
                  <Cpu className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-emerald-400 uppercase tracking-wide">
                    NVIDIA NEMOTRON LEASE AUDITOR & SCAM SCANNER
                  </h3>
                  <p className="text-[11px] text-zinc-400 font-normal">
                    Model: {activeAudit.analyzedByModel}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-zinc-900 border border-zinc-700 text-xs text-zinc-300">
                  SCAM RISK: <strong className="text-emerald-400">{activeAudit.scamRiskScore}/10</strong>
                </span>
                <span className="px-2 py-0.5 bg-emerald-950 border border-emerald-600 text-xs text-emerald-300 font-bold">
                  {activeAudit.gentrificationIndex}
                </span>
              </div>
            </div>

            {/* Market Comparison */}
            <div className="mb-4 text-xs sm:text-sm text-zinc-200 bg-black/40 p-3 border border-zinc-800">
              <strong className="text-emerald-400 uppercase">Valuation Benchmark: </strong>
              {activeAudit.marketPriceComparison}
            </div>

            {/* Perks vs Warnings Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-3 bg-zinc-950 border border-zinc-800">
                <h5 className="text-xs font-bold text-emerald-400 uppercase mb-2 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  VERIFIED PROTECTIONS & VALUE PERKS
                </h5>
                <ul className="space-y-1.5 text-xs text-zinc-300">
                  {activeAudit.verifiedPerks.map((perk, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="text-emerald-500 font-bold">✓</span>
                      <span>{perk}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="p-3 bg-zinc-950 border border-zinc-800">
                <h5 className="text-xs font-bold text-amber-400 uppercase mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  AUDIT CAUTIONS & TENANT ADVISORIES
                </h5>
                <ul className="space-y-1.5 text-xs text-zinc-300">
                  {activeAudit.auditWarnings.map((warning, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="text-amber-500 font-bold">!</span>
                      <span>{warning}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* AI Landlord Negotiation Generator */}
          <div className="border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-emerald-400" />
                <h4 className="text-xs sm:text-sm font-bold text-white uppercase tracking-wide">
                  AI-GENERATED LANDLORD NEGOTIATION SCRIPT
                </h4>
              </div>
              <button
                onClick={handleCopyNegotiation}
                className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold uppercase transition cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'COPIED TO CLIPBOARD' : 'COPY SCRIPT'}</span>
              </button>
            </div>

            <p className="text-xs text-zinc-400 mb-2 font-mono">
              Designed by Nemotron to maximize tenant credibility, bypass broker fees, and lock in the lease:
            </p>

            <div className="p-3 bg-black border border-zinc-800 text-xs sm:text-sm text-zinc-200 font-sans leading-relaxed select-all">
              "{activeAudit.negotiationScript}"
            </div>
          </div>

          {/* Interactive Clause / Contract Tester */}
          <div className="border border-zinc-850 bg-zinc-950 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-zinc-300 uppercase flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                CUSTOM LEASE CLAUSE AUDITOR (TEST LIVE VIA NEBIUS)
              </span>
              <span className="text-[10px] text-zinc-500">
                PASTE SUBLET RULES OR CLAUSES
              </span>
            </div>
            <textarea
              value={customClause}
              onChange={(e) => setCustomClause(e.target.value)}
              placeholder="e.g. Landlord demands $1,000 cash deposit without written receipt and 1-week notice eviction clause..."
              rows={2}
              className="w-full bg-zinc-900 border border-zinc-800 text-xs text-zinc-100 p-2.5 font-mono focus:outline-none focus:border-emerald-500 placeholder:text-zinc-600 mb-2"
            />
            <button
              onClick={handleReauditWithCustomClause}
              disabled={isAuditing || !customClause.trim()}
              className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-xs font-bold uppercase transition cursor-pointer disabled:opacity-50"
            >
              {isAuditing ? 'AUDITING VIA NEBIUS...' : 'RE-AUDIT CLAUSE WITH NEMOTRON'}
            </button>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-zinc-900 border-t border-zinc-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold uppercase transition cursor-pointer"
          >
            CLOSE DOSSIER
          </button>
        </div>
      </div>
    </dialog>
  );
};
