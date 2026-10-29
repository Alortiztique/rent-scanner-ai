# Task 6 spec and standards review

The independent review axes compared `1f269bf2c8c9d9cd7434803ff3361efb38c88296...14f0f26`.
That includes the inherited Task 6 backend and the new web entry point. The specification was
Task 6 in `COLLABORATION_TASKS.md`, together with the session's Telegram handoff and clearly labelled
local-preview scope. WhatsApp delivery remains outside that scope.

No separate coding standards file or `docs/agents/issue-tracker.md` was available. Repository
source-fact, privacy and persisted-profile contracts supplied the standards; the code-review skill's
smell baseline supplied judgment calls. `/setup-matt-pocock-skills` can supply the missing tracker
guide; this review used the local task specification without depending on it.

## Standards

1. **P1, subscriber data loss.** The listener swallowed every JSON read error, then opened the
   database for truncation. This violated the persisted-profile contract. Fixed by rejecting
   unreadable data, serializing the listener's writes and atomically replacing flushed files.
   Tests cover corrupt JSON, invalid shape, replacement failure and concurrent threads.
2. **P1, invented verification.** Message formatters invented prices, scores, risk and perks and
   labelled all leases verified. This violated the source-fact boundary in the README and Scout
   listing model. Fixed by formatting supplied data only, labelling unknown rent and estimates,
   marking samples, and reporting the supplied model rather than a hardcoded attribution.
3. **P2, stale setup buttons.** Any final-step callback could create a session and overwrite a
   profile with default settings, bypassing the documented setup. Fixed by checking private-chat
   ownership, the active step, current menu message and allowed values before advancing.
4. **Judgment call, duplicated code.** Broadcast and personal formatters, request functions and
   token loaders were duplicated. They now share one formatter and transport. Cities and matching
   invariants live in `alert_model.py`.

Standards: four initial findings, all addressed. The worst were subscriber data loss and invented
verification claims.

## Spec

1. **P1, feed schema and currency mismatch.** "In their preferred city" failed for job records
   named New York City or San Francisco. Missing root prices became zero, and global budgets
   compared unrelated local currencies. Fixed by normalizing both existing feed formats and
   canonical city identities. Budget matching now needs a known price in the appropriate currency.
2. **P1, invented claims and omitted summary.** "Nemotron summary" was missing from both backend
   and frontend alerts, while missing facts and sample data were presented as verified. Fixed by
   including the supplied summary or declaring it absent and labelling samples consistently.
3. **P2, incorrect score floor.** "95+ Deal Score" was implemented as 90, and higher batch thresholds
   did not constrain private messages. The shared backend floor and frontend preview are now 95+;
   stricter batch thresholds constrain both channels and private messages.
4. **P2, repeated alerts.** "When a new ... sublease is detected" was not enforced. Successful
   delivery identities now persist per destination and source URL in SQLite. Repeated and
   concurrent batches skip them; failed sends can retry.
5. **P2, rewritten subscription preferences.** Custom-budget parsing changed 1000.50 into 100050
   and accepted negative input as positive. Stale callbacks reset profiles. Decimal amounts now
   retain their value, invalid input is rejected and stale callbacks leave stored settings alone.
6. **P2, incorrect housing and utility filtering.** Canonical `type` was ignored, and negated perks
   could satisfy mandatory utilities. Matching now uses explicit canonical types and boolean
   facts. Unknown or false facts do not satisfy a required filter.

Spec: six initial findings, all addressed. The worst were incorrect matching and false audit claims.

## Verification and limits

Offline Node checks, stdlib Python regression checks, lint, the production build and Scout server
typechecks validate the final branch. No real messages or provider requests are sent by the checks.
See `telegram-alerts.md` for deployment requirements, the single-listener profile-file constraint,
durable delivery state and the remaining network crash window for duplicate delivery. UI markup
checks do not establish browser layout or keyboard behavior. This branch does not deploy a bot,
schedule Task 4 or connect WhatsApp delivery.
