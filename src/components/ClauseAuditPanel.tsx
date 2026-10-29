import React, { useMemo, useSyncExternalStore } from 'react';
import type { AuditFinding, AuditSeverity, LegalSourceRef, Listing, ReAuditResult } from '../types';
import { createClauseAuditController } from '../services/clauseAudit';
import type { ClauseAuditState } from '../services/clauseAudit';
import { isHttpUrl } from '../services/tavilySearch';
import { AlertTriangle, ExternalLink, Info, ShieldAlert, Sparkles } from 'lucide-react';

const INPUT_ID = 'clause-audit-input';
const HINT_ID = 'clause-audit-hint';
const RESULT_HEADING_ID = 'clause-audit-result-title';

/** Own clause-audit state for one listing. The dossier is keyed by listing id, so it resets per selection. */
export const ClauseAuditSection: React.FC<{ listing: Listing }> = ({ listing }) => {
  const controller = useMemo(() => createClauseAuditController(listing), [listing]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  return (
    <ClauseAuditPanel
      cityName={listing.cityName}
      state={state}
      onClauseChange={controller.setClause}
      onSubmit={() => void controller.submit()}
    />
  );
};

interface ClauseAuditPanelProps {
  cityName: string;
  state: ClauseAuditState;
  onClauseChange: (clause: string) => void;
  onSubmit: () => void;
}

export const ClauseAuditPanel: React.FC<ClauseAuditPanelProps> = ({ cityName, state, onClauseChange, onSubmit }) => {
  const isAuditing = state.status === 'loading';
  const isBlank = !state.clause.trim();

  return (
    <div className="border border-zinc-850 bg-zinc-950 p-4">
      <div className="flex flex-wrap items-center justify-between gap-1 mb-2">
        <label htmlFor={INPUT_ID} className="text-xs font-bold text-zinc-300 uppercase flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
          CUSTOM LEASE CLAUSE AUDITOR (TEST LIVE VIA NEBIUS)
        </label>
        <span id={HINT_ID} className="text-[10px] text-zinc-500">
          PASTE SUBLET RULES OR CLAUSES
        </span>
      </div>
      <textarea
        id={INPUT_ID}
        value={state.clause}
        onChange={(e) => onClauseChange(e.target.value)}
        aria-describedby={HINT_ID}
        placeholder="e.g. Landlord demands $1,000 cash deposit without written receipt and 1-week notice eviction clause..."
        rows={2}
        className="w-full bg-zinc-900 border border-zinc-800 text-xs text-zinc-100 p-2.5 font-mono focus:outline-none focus:border-emerald-500 placeholder:text-zinc-600 mb-2"
      />
      {/* aria-disabled, not disabled, while a request runs: the focused button keeps keyboard focus. */}
      <button
        type="button"
        onClick={onSubmit}
        disabled={isBlank}
        aria-disabled={isAuditing}
        className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-xs font-bold uppercase transition cursor-pointer disabled:opacity-50 aria-disabled:opacity-50 aria-disabled:cursor-wait"
      >
        {isAuditing ? 'AUDITING VIA NEBIUS...' : 'RE-AUDIT CLAUSE WITH NEMOTRON'}
      </button>

      <div aria-live="polite" aria-busy={isAuditing} className="mt-3 empty:mt-0">
        {isAuditing && (
          <p className="text-xs text-zinc-400 font-sans">Checking your clause against {cityName} rules...</p>
        )}
        {state.status === 'success' && state.result && (
          <p className="text-xs text-zinc-200 font-sans">{describeOutcome(state.result)}</p>
        )}
      </div>

      {state.status === 'error' && state.error && (
        <div role="alert" className="mt-3 p-3 border border-red-800 bg-red-950/40 text-xs text-red-100 font-sans leading-relaxed">
          <strong className="font-mono uppercase text-red-300">{state.error.title}: </strong>
          {state.error.message}
        </div>
      )}

      {state.status === 'success' && state.result && <ClauseAuditResult result={state.result} />}
    </div>
  );
};

/** One sentence that states what the audit did and did not establish. */
function describeOutcome(result: ReAuditResult): string {
  const count = result.findings.length;
  if (count === 0) {
    return 'No issues found in the supplied text under the available rules. This does not mean the whole lease is legally valid: only the text you pasted was checked.';
  }
  const noun = count === 1 ? 'finding' : 'findings';
  return result.isValid
    ? `${count} ${noun} to review. None is rated illegal under the available rules.`
    : `${count} ${noun} to review. At least one is rated illegal under the available rules.`;
}

const SEVERITY_STYLE: Record<AuditSeverity, { label: string; badge: string; Icon: React.ElementType }> = {
  illegal: { label: 'Illegal', badge: 'bg-red-950 text-red-200 border-red-700', Icon: ShieldAlert },
  warning: { label: 'Warning', badge: 'bg-amber-950 text-amber-200 border-amber-700', Icon: AlertTriangle },
  info: { label: 'Info', badge: 'bg-zinc-900 text-zinc-200 border-zinc-600', Icon: Info },
};

/** A source is linked only when it is a real http(s) URL; any other nonempty text is shown as-is. */
function SourceReference({ source, title }: { source: string; title: string }) {
  const value = source.trim();
  if (!value) return null;
  if (!isHttpUrl(value)) return <span className="text-zinc-400"> Source: {value}</span>;
  return (
    <a
      href={value}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open source for ${title} (opens in a new tab)`}
      className="ml-1.5 inline-flex items-center gap-1 text-emerald-400 underline hover:text-emerald-300"
    >
      Source
      <ExternalLink className="w-3 h-3" aria-hidden="true" />
    </a>
  );
}

const ClauseAuditResult: React.FC<{ result: ReAuditResult }> = ({ result }) => {
  const sourceById = new Map<string, LegalSourceRef>(result.legalSources.map((source) => [source.id, source]));

  return (
    <section aria-labelledby={RESULT_HEADING_ID} className="mt-3 space-y-3 font-sans">
      <div className="flex flex-wrap items-center gap-2">
        <h4 id={RESULT_HEADING_ID} className="text-xs font-bold text-zinc-300 font-mono uppercase">
          Clause audit result
        </h4>
        <span
          className={`px-2 py-0.5 border text-[10px] font-mono font-bold uppercase ${
            result.isValid ? 'bg-emerald-950 text-emerald-300 border-emerald-700' : 'bg-red-950 text-red-200 border-red-700'
          }`}
        >
          {result.isValid ? (result.findings.length === 0 ? 'No issues found' : 'No finding rated illegal') : 'Illegal clause flagged'}
        </span>
      </div>

      {result.summary.trim() && (
        <p className="text-xs sm:text-sm text-zinc-200 leading-relaxed">{result.summary}</p>
      )}

      {result.findings.length > 0 && (
        <ol aria-label="Clause audit findings" className="space-y-3">
          {result.findings.map((finding, index) => (
            <FindingItem key={index} finding={finding} source={sourceById.get(finding.legalReference)} />
          ))}
        </ol>
      )}

      {result.legalSources.length > 0 && (
        <div className="text-[11px] text-zinc-400">
          <h5 className="font-mono font-bold uppercase text-zinc-400 mb-1">Rules checked</h5>
          <ul className="space-y-0.5">
            {result.legalSources.map((source) => (
              <li key={source.id}>
                <code className="text-zinc-300">{source.id}</code>: {source.title}
                <SourceReference source={source.source} title={source.title} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="pt-2 border-t border-zinc-800 text-[11px] text-zinc-400 leading-relaxed">
        <p>Model: {result.analyzedByModel}</p>
        <p className="whitespace-pre-line mt-1">{result.disclaimer}</p>
      </div>
    </section>
  );
};

const FindingItem: React.FC<{ finding: AuditFinding; source: LegalSourceRef | undefined }> = ({ finding, source }) => {
  const { label, badge, Icon } = SEVERITY_STYLE[finding.severity];
  const suggestion = finding.suggestedRevision.trim();

  return (
    <li className="p-3 bg-black/40 border border-zinc-800 text-xs text-zinc-300 leading-relaxed space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`px-2 py-0.5 border text-[10px] font-mono font-bold uppercase inline-flex items-center gap-1 ${badge}`}>
          <Icon className="w-3 h-3" aria-hidden="true" />
          <span className="sr-only">Severity: </span>
          {label}
        </span>
      </div>
      <blockquote className="pl-2 border-l-2 border-zinc-600 text-zinc-100 break-words">
        <span className="sr-only">Quoted clause: </span>
        "{finding.clauseText}"
      </blockquote>
      {!finding.quoteVerified && (
        <p className="text-amber-300">This quote could not be matched to your text. Check it against the original.</p>
      )}
      <p>
        <strong className="text-zinc-200">Issue: </strong>
        {finding.issue}
      </p>
      {suggestion && (
        <p>
          <strong className="text-zinc-200">Suggested revision: </strong>
          {suggestion}
        </p>
      )}
      <p>
        <strong className="text-zinc-200">Citation: </strong>
        <code className="text-emerald-300">{finding.legalReference}</code>
        {source?.title && <>: {source.title}</>}
        {source && <SourceReference source={source.source} title={source.title} />}
      </p>
      {!finding.legalReferenceVerified && (
        <p className="text-amber-300">
          The model cited a provision that was not among the rules checked, so the general framework is cited instead.
        </p>
      )}
    </li>
  );
};
