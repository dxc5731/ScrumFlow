# Meeting Agent Final Report

## Architecture and responsibilities

The Project Agent coordinates focus, facts, topics, and corrections. Task Decomposition builds engineering tasks and calls the deterministic DAG schedule and hard-constraint validator. Risk & Dependency traverses recorded dependencies and labels delay scenarios as What-if. Workload & Capacity uses the focused Sprint snapshot for candidate and opportunity-cost answers. Plan Execution converts a confirmed plan into an `AgentProposal`; it does not write project entities. Digital Member reads member and focus-specific project data, without independent write authority.

LLM handles intent and phrasing. Project state, dates, hours, dependency propagation, schedule, constraints, proposal review, writes, and ChangeHistory are decided by code. Lightweight interpretation now defaults to `deepseek-chat` with JSON response and at most one retry. Development telemetry records model, request type, latency, retry count, and fallback reason.

## Changed files

- `src/agents/meetingFinalRevalidation.ts`, `meetingExecutionSummary.ts`, `meetingPlanDiff.ts`: reviewed-plan checks, actual execution details, and concise plan deltas.
- `src/agents/meetingSnapshot.ts`, `meetingLlm.ts`, `meetingDecision.ts`, `meetingMinutes.ts`: shared scope entry, LLM telemetry, response correction, and minutes.
- `server/meetingLlm.ts`: chat model for short structured interpretation and one bounded retry.
- `src/store/projectStore.ts`, `src/types.ts`: final validation gate and minutes contract.
- `src/components/planning/MeetingRoom.tsx`, `MeetingRoom.css`: final impact preview and confirmation.
- `src/tests/meetingFinalRevalidation.test.ts`, `meetingConstraintRegression.test.ts`, `meetingMaturity.test.ts`: reviewed-plan, scope, reset, and revised minutes regression.
- `FINAL_ONLINE_QA.md`, `FINAL_REGRESSION.md`, `AGENT_INTEGRATION_CONTRACT.md`: audit and integration artifacts.

## Review, revalidation, apply

The decision panel now requires a reviewed-plan preview and explicit confirmation. Review changes invalidate the preview. `revalidateReviewedProposal` rebuilds accepted tasks and dependencies, recalculates schedule and capacity, checks hard constraints and stale inputs, then returns errors and warnings. Errors block Apply. The existing Proposal Executor performs Store Actions and records ChangeHistory. `buildExecutionSummary` requires applied status, a matching ChangeHistory entry, and an existing result target before reporting a real change. Minutes keep decisions separate from actual execution and show an executive summary.

## Verification

- Offline: 144 tests passed after the final regression additions.
- Live online QA: 27 turns, 23 DeepSeek chat requests, 0 reasoner requests, 0 retries, 0 fallback. Full unedited turn output is in `FINAL_ONLINE_QA.md`. It ran in an isolated browser session and was not added to the user's current project meeting history.
- Browser UI: opened a project meeting, reviewed a proposal, accepted all, rejected one dependency, verified preview invalidation and recomputation, changed one assignee, revalidated workload, clicked Confirm Apply, and read the resulting minutes.
- Typecheck and production build passed. Build retains the existing large-chunk warning.

## Freeze boundary

Meeting Agent functionality is ready to freeze for feature work. Remaining work is bug fixing and event Agent integration through `AGENT_INTEGRATION_CONTRACT.md`. Known limits: capacity uses recorded workload rather than a full leave calendar; risk mitigation suggestions require owner confirmation; isolated QA conversations are retained as files and do not appear in normal meeting history. Event Agents must reuse AgentProposal, Proposal Executor, and ChangeHistory.

The online run exposed one phrasing defect: after a two-to-three-person replan, the reply initially reported only a changed task owner. The response now states the current participant count and names the new owner. A newly added Sprint-window hard stop also blocked two existing proposal paths; it was corrected to a visible warning because the project can legitimately record a plan that needs a date review. Neither issue remains open in the final regression. The only unresolved scheduling limitation is the lack of a full holiday/leave calendar.
