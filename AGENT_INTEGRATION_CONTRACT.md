# Agent Integration Contract

Status: frozen for meeting Agent / event Agent integration. Changes to these types require a coordinated migration and tests.

## Shared model

- `AgentProposal` and `ProposalAction` are defined in `src/types.ts`. Event suggestions must use `AgentProposal` with `origin: "event"`; meetings use `origin: "meeting"`. The existing `triggerType`, `agentType`, `targetType`, `targetId`, summary, reasoning, evidence, original actions, reviewed actions, review metadata, and apply metadata remain the common audit contract.
- Each `ProposalAction` carries its decision, execution status, preconditions, dependencies on other actions, result target ID, and error. New operations extend `ProposalActionType`; there is one executor in `src/store/projectStore.ts`.
- `buildProjectAnalysisSnapshotForScope(state, scope, now)` is the shared deterministic analysis entry. `ProjectAnalysisScope` contains project, target, and optional focus IDs without a MeetingSession. The existing `buildProjectAnalysisSnapshot(state, session, memory, now)` is the meeting adapter and delegates to it. Event code passes its own scope; it does not construct a MeetingSession.
- `dependencyImpact`, `workloadAdvice`, `calculatePlanSchedule`, `validatePlanAgainstConstraints`, `businessChangeSummary`, `describeBusinessChanges`, `revalidateReviewedProposal`, and `buildExecutionSummary` are exported from `src/agents/`. They consume project state and explicit analysis inputs; none imports `MeetingRoom`.
- `ChangeHistoryItem` links the actual Store Action to `proposalId` and `proposalActionId`. A proposal marked applied without matching history and target data is reported as an execution discrepancy.

## Flow

Event trigger or meeting decision -> deterministic project analysis -> `AgentProposal` -> human review -> final revalidation when a plan is present -> `applyProposal` -> Store Action -> ChangeHistory -> execution summary.

The event side must call the same proposal review and executor. It must not write project entities from a scanner or bypass human review. Revalidation checks reviewed plan semantics; the executor remains responsible for preconditions, writes, stale/failed action status, and history.

## Ownership

- Meeting-owned: `MeetingSession`, `MeetingMessage`, `MeetingContext`, `MeetingTopic`, `MeetingFact`, digital member replies, Project Agent hosting, and Meeting Room.
- Meeting messages may additionally carry optional `artifactIds` referencing ordinary `DesignAssetEntity` records. The material organizer writes generated files through the existing attachment persistence API and does not add event triggers or change the event-agent protocol.
- `CREATE_SUBTASK.targetId` supports either an existing Task ID or an earlier `CREATE_TASK` action ID resolved by the executor. Both paths retain preconditions, review, execution status and change-history linkage.
- Event-owned: monitoring, event triggers, suggestion surfaces, and notifications.
- Shared: project snapshot facts, AgentProposal, ProposalAction, business summary, final plan validation where applicable, Proposal Executor, and ChangeHistory.

The meeting QA browser session is isolated from user persistence. QA records are files, not project meeting history. A live meeting is stored only when created through the normal project store.

## Implementation boundary checked on 2026-10-08

- The original two-person allocation separated a meeting workflow from an event/operations workflow. Later user requests explicitly expanded the meeting side to include digital members and the meeting material center. Meeting material generation is implemented; it is not an empty event-side placeholder.
- `project_monitor`, `collaboration_notification`, and `contribution_insight` currently have lightweight deterministic answers inside `meetingConversation.ts`. These read existing project facts. They are not complete event Agents: they do not implement automatic event scanning, notification delivery, or an independent contribution-insights workflow.
- Event-origin Proposal types and the common review/executor/history contract are available. No event-origin Proposal producer or standalone global pending-proposal center is currently implemented in this checkout. A teammate should reuse the shared contract rather than add another executor.
- The existing top-bar notification popup is a basic planning reminder, including a static dependency count. It is not evidence that the collaboration notification Agent is integrated.
- Material generators, analysis services, and the executor can be reused by the event workflow. This note describes current implementation and does not reassign the teammate's ownership.
