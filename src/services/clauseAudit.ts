/**
 * Clause audit state for the fixture dossier. It runs the jurisdiction-aware lease auditor
 * (LeaseAuditPrompt) on the text the user pasted and keeps the outcome apart from the listing's
 * generic NemotronAudit: a ReAuditResult is never converted into one, and a failed clause audit
 * never falls back to the heuristic listing audit.
 *
 * The controller is framework-free so the async rules can be tested without a DOM:
 * - blank text and a request already in flight cannot start another request;
 * - changing the text or starting a request clears the previous result and error;
 * - a reply is shown only if no later edit or request has replaced the one that asked for it,
 *   so a late answer for earlier text cannot appear as the current result.
 * Each selected listing creates its own controller, and the dossier is keyed by listing id.
 */
import type { Listing, ReAuditResult } from '../types';
import { LeaseAuditError, LeaseAuditPrompt, UnsupportedJurisdictionError } from '../prompts/leaseAuditPrompt';

export type ClauseAuditStatus = 'idle' | 'loading' | 'success' | 'error';

export interface ClauseAuditFailure {
  kind: 'unsupported' | 'failed';
  title: string;
  message: string;
}

export interface ClauseAuditState {
  clause: string;
  status: ClauseAuditStatus;
  result: ReAuditResult | null;
  error: ClauseAuditFailure | null;
}

export type LeaseAuditFn = (listing: Listing, leaseText: string) => Promise<ReAuditResult>;

export interface ClauseAuditController {
  getState: () => ClauseAuditState;
  subscribe: (listener: () => void) => () => void;
  setClause: (clause: string) => void;
  submit: () => Promise<void>;
}

const INITIAL_STATE: ClauseAuditState = { clause: '', status: 'idle', result: null, error: null };

/** Turns an audit failure into text a tenant can act on. Provider detail stays in the console. */
export function describeClauseAuditFailure(error: unknown): ClauseAuditFailure {
  if (error instanceof UnsupportedJurisdictionError) {
    return {
      kind: 'unsupported',
      title: 'Jurisdiction not supported',
      message: `No legal rules are loaded for ${error.cityName}, so this clause was not checked. Review it with a local tenant advisor or lawyer.`,
    };
  }
  if (error instanceof LeaseAuditError) {
    return {
      kind: 'failed',
      title: 'Clause audit failed',
      message:
        'The model returned no answer, or an answer that could not be validated. The clause was not checked. Check the connection and Nebius settings, then try again.',
    };
  }
  return {
    kind: 'failed',
    title: 'Clause audit failed',
    message: 'The clause audit stopped unexpectedly and the clause was not checked. Try again.',
  };
}

export function createClauseAuditController(
  listing: Listing,
  audit: LeaseAuditFn = LeaseAuditPrompt,
): ClauseAuditController {
  let state = INITIAL_STATE;
  let latestRequest = 0;
  const listeners = new Set<() => void>();

  const update = (next: ClauseAuditState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };

  return {
    getState: () => state,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    setClause: (clause) => {
      if (clause === state.clause) return;
      latestRequest++;
      update({ clause, status: 'idle', result: null, error: null });
    },

    submit: async () => {
      if (!state.clause.trim() || state.status === 'loading') return;
      const request = ++latestRequest;
      update({ ...state, status: 'loading', result: null, error: null });
      try {
        const result = await audit(listing, state.clause);
        if (request !== latestRequest) return;
        update({ ...state, status: 'success', result, error: null });
      } catch (err) {
        if (request !== latestRequest) return;
        console.error('Clause audit failed:', err);
        update({ ...state, status: 'error', result: null, error: describeClauseAuditFailure(err) });
      }
    },
  };
}
