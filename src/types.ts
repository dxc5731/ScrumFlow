export type Priority = "critical" | "high" | "medium" | "low"
export type Status = "todo" | "in-progress" | "review" | "done" | "blocked"
export type RiskLevel = "high" | "medium" | "low" | "none"
export type TaskType = "frontend" | "backend" | "database" | "test" | "design" | "devops"
export type SprintStatus = "planning" | "active" | "review" | "closed"
export type ViewMode = "user" | "engineering" | "comprehensive"
export type MainView = "story-map" | "gantt" | "board"

export type Page = "project-use-case" | "overview" | "story-map" | "backlog" | "wbs" | "gantt" | "sprint" | "acceptance" | "board" | "daily-scrum" | "risks" | "assets" | "chat" | "cockpit" | "workload" | "contribution" | "release" | "retrospective" | "lab" | "settings"

export interface Member {
  id: string
  name: string
  initials: string
  color: string
  role: string
  capacityHours: number
}

export interface Subtask {
  id: string
  title: string
  done: boolean
  assigneeId: string
}

export interface EngineeringTask {
  id: string
  title: string
  type: TaskType
  assigneeId: string
  status: Status
  estimate: number
  startDate: string
  endDate: string
  storyId: string
  blocked?: boolean
  blockerNote?: string
}

export interface UserStory {
  id: string
  title: string
  as: string
  iWant: string
  soThat: string
  assigneeId: string
  collaboratorIds: string[]
  status: Status
  priority: Priority
  storyPoints: number
  risk: RiskLevel
  riskNote?: string
  startDate: string
  dueDate: string
  sprintId: string
  epicId: string
  taskId: string
  acceptanceCriteria: string[]
  engineeringTasks: EngineeringTask[]
  subtasks: Subtask[]
  cost?: number
  completedEngTasks?: number
  totalEngTasks?: number
}

export interface UserTask {
  id: string
  title: string
  activityId: string
}

export interface UserActivity {
  id: string
  title: string
  taskIds: string[]
  colorClass: string
  textColor: string
}

export interface Epic {
  id: string
  title: string
  taskId: string
  color: string
  textColor: string
}

export interface Sprint {
  id: string
  name: string
  startDate: string
  endDate: string
  goal: string
  status: SprintStatus
  velocity: number
  capacity: number
}

export interface ChatMessage {
  id: string
  senderId: string
  senderName: string
  content: string
  timestamp: string
  isAI?: boolean
  aiActions?: { label: string; action: string }[]
  aiContext?: string[]
}

export interface Risk {
  id: string
  title: string
  level: RiskLevel
  storyId?: string
  taskId?: string
  sprintId?: string
  description: string
  impact?: string
  mitigation?: string
  owner: string
  status: "open" | "mitigating" | "resolved"
}

// Canonical course-stage planning model. The legacy interfaces above remain
// available only so the original Figma demo data can be migrated at startup.
export type StoryMaturityStatus = "candidate" | "draft" | "ready"
export type StoryDeliveryStatus = "backlog" | "planned" | "in_progress" | "pending_acceptance" | "accepted" | "returned"
export type TaskStatus = "todo" | "in_progress" | "review" | "done" | "blocked"
export type RestorableTaskStatus = Exclude<TaskStatus, "blocked">
export type StorySource = "ai" | "meeting" | "manual" | "review" | "retro"
export type InspectorTab = "overview" | "engineering" | "assets" | "activity"
export type SelectedObjectType = "story" | "task" | "subtask" | null
export type ActorMode = "po" | "employee"

export interface ProjectEntity {
  id: string
  name: string
  subtitle: string
  goal: string
  requirementBrief: string
  startDate: string
  endDate: string
}

export interface UserActivityEntity {
  id: string
  title: string
  order: number
  domain: "governance" | "planning" | "design" | "delivery" | "quality" | "other"
}

export interface UserTaskEntity {
  id: string
  title: string
  activityId: string
  order: number
}

export interface EpicEntity {
  id: string
  title: string
  goalId: string
  startDate: string
  endDate: string
  order: number
}

export type ReleaseStatus = "planning" | "active" | "released"
export interface ReleaseEntity {
  id: string
  name: string
  goal: string
  plannedDate: string
  status: ReleaseStatus
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}
export interface ReleaseAssignment {
  fromReleaseId: string | null
  toReleaseId: string | null
  previousSprintId: string | null
  reason: string
  at: string
  byId: string
}

export interface SprintWorkSnapshot {
  date: string
  capturedAt: string
  totalHours: number
  remainingHours: number
  itemCount: number
}
export interface SprintBurndown {
  sprintId: string
  baselineHours: number
  baselineDate: string
  baselineKind: "sprint-start" | "first-observation"
  days: Record<string, SprintWorkSnapshot>
}

export interface SprintEntity {
  releaseId?: string | null
  id: string
  name: string
  goal: string
  startDate: string
  endDate: string
  status: SprintStatus
  velocity: number
  capacity: number
  memberIds: string[]
  reviewSummary: string
  goalAchieved: boolean | null
  retrospective: {
    mainProblem: string
    nextImprovement: string
  }
  closedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AcceptanceRecord {
  id: string
  result: "accepted" | "returned"
  byId: string
  at: string
  note: string
}

export interface StoryEntity {
  releaseId?: string | null
  isReleaseCore?: boolean
  releaseChanges?: ReleaseAssignment[]
  id: string
  title: string
  as: string
  iWant: string
  soThat: string
  assigneeId: string
  collaboratorIds: string[]
  maturityStatus: StoryMaturityStatus
  deliveryStatus: StoryDeliveryStatus
  priority: Priority
  storyPoints: number
  businessValue: number
  expectedBenefit: string
  risk: RiskLevel
  riskNote: string
  startDate: string
  dueDate: string
  sprintId: string | null
  epicId: string | null
  source: StorySource
  order: number
  taskIds: string[]
  acceptanceCriteriaIds: string[]
  acceptanceLog: AcceptanceRecord[]
  discussionIds: string[]
  createdAt: string
  updatedAt: string
}

export interface TaskEntity {
  id: string
  title: string
  type: TaskType
  assigneeId: string
  status: TaskStatus
  estimate: number
  progress: number
  startDate: string
  endDate: string
  storyId: string
  blockReasons: BlockReasonEntity[]
  blockedSeverity: "normal" | "severe"
  statusBeforeBlocked: RestorableTaskStatus | null
  resultSummary: string
  resultUrl: string
  resultLinks: string[]
  resultAssetIds: string[]
  submittedAt: string | null
  isMilestone: boolean
  qualityStatus: "pending" | "good" | "attention"
  qualityNote: string
  order: number
  subtaskIds: string[]
}

export interface SubtaskEntity {
  id: string
  title: string
  done: boolean
  status: TaskStatus
  estimate: number
  progress: number
  startDate: string
  endDate: string
  blockReasons: BlockReasonEntity[]
  blockedSeverity: "normal" | "severe"
  statusBeforeBlocked: RestorableTaskStatus | null
  resultSummary: string
  resultUrl: string
  resultLinks: string[]
  resultAssetIds: string[]
  submittedAt: string | null
  qualityStatus: "pending" | "good" | "attention"
  qualityNote: string
  assigneeId: string
  taskId: string
  order: number
}

export interface BlockReasonEntity {
  id: string
  source: "manual" | "dependency"
  message: string
  relatedTaskId: string | null
  dependencyId: string | null
  createdAt: string
}

export interface AcceptanceCriterion {
  id: string
  storyId: string
  content: string
  order: number
  satisfied: boolean
}

export interface DependencyEntity {
  id: string
  sourceTaskId: string
  targetTaskId: string
  type: "FS"
  createdAt: string
}

export type UmlDiagramKind = "use-case" | "sequence" | "class"

export type UmlNodeKind = "actor" | "use-case" | "participant" | "class"

export type UmlRelationType =
  | "association"
  | "dependency"
  | "generalization"
  | "realization"
  | "aggregation"
  | "composition"
  | "include"
  | "extend"
  | "message"
  | "return"

export interface UmlNodeEntity {
  id: string
  kind: UmlNodeKind
  label: string
  x: number
  y: number
  details: string[]
}

export interface UmlEdgeEntity {
  id: string
  source: string
  target: string
  relation: UmlRelationType
  label: string
  order: number
  sourceHandle?: "left" | "right" | "top" | "bottom"
  targetHandle?: "left" | "right" | "top" | "bottom"
}

/** Project-level use cases derive from activities (top-level goals); only their presentation is stored here. */
export interface ProjectUseCaseData {
  version: 1
  actors: UmlNodeEntity[]
  goalPositions: Record<string, { x: number; y: number }>
  edges: UmlEdgeEntity[]
}

export interface UmlDiagramData {
  version: 1
  kind: UmlDiagramKind
  sourceFormat: "plantuml"
  nodes: UmlNodeEntity[]
  edges: UmlEdgeEntity[]
}

export interface DesignAssetEntity {
  id: string
  name: string
  kind: "activity" | "use-case" | "sequence" | "class" | "wbs" | "image" | "pdf" | "drawio" | "attachment"
  links: AssetLink[]
  mimeType: string
  storage: "inline" | "local-file" | "indexeddb" | "external"
  contentRef: string
  sourceText: string
  umlData?: UmlDiagramData
  preview: string
  version: string
  sizeBytes?: number
  createdAt: string
  updatedAt: string
}

export type AssetLinkTargetType = "project" | "epic" | "story" | "task" | "sprint"

export interface AssetLink {
  targetType: AssetLinkTargetType
  targetId: string
}

export interface DiscussionMessageEntity {
  id: string
  targetType: "project" | "story" | "task"
  targetId: string
  storyId?: string
  authorId: string
  content: string
  createdAt: string
  isAI: boolean
}

export interface RiskEntity {
  id: string
  title: string
  targetType: "story" | "task" | "sprint"
  targetId: string
  level: Exclude<RiskLevel, "none">
  description: string
  impact: string
  mitigation: string
  ownerId: string
  status: "open" | "mitigating" | "resolved"
  createdAt: string
  updatedAt: string
}

export interface ImpactAnalysisEntity {
  id: string
  triggerType: "story" | "task" | "dependency"
  triggerId: string
  changeType: "schedule" | "assignee" | "sprint" | "dependency"
  affectedTaskIds: string[]
  affectedMilestoneIds: string[]
  affectedMemberIds: string[]
  releaseRisk: "low" | "medium" | "high"
  summary: string
  createdAt: string
}

export interface SprintPulseEntity {
  id: string
  sprintId: string
  date: string
  focus: string
  blockers: string
  notes: string
  createdAt: string
}

export interface ChangeHistoryItem {
  id: string
  createdAt: string
  actorId: string
  objectType: "release" | "project" | "activity" | "userTask" | "epic" | "story" | "task" | "subtask" | "acceptance" | "dependency" | "discussion" | "sprint" | "asset" | "risk" | "impact" | "pulse"
  objectId: string
  field: string
  before: unknown
  after: unknown
  source: "ui" | "drag" | "import" | "undo" | "system" | "agent"
  proposalId?: string
  proposalActionId?: string
}

export type ProposalTargetType = "project" | "sprint" | "story" | "task" | "subtask" | "member" | "dependency" | "risk"
export type AgentType = "project_orchestrator" | "task_decomposition" | "risk_dependency" | "workload_capacity" | "plan_execution" | "project_monitor" | "collaboration_notification" | "material_organizer" | "contribution_insight"
export type ProposalStatus = "draft" | "reviewed" | "applying" | "applied" | "partially_applied" | "rejected" | "failed"
export type ProposalActionType = "CREATE_TASK" | "CREATE_SUBTASK" | "UPDATE_TASK" | "UPDATE_SUBTASK" | "UPDATE_STORY" | "CREATE_RISK" | "UPDATE_RISK" | "ADD_DEPENDENCY" | "CREATE_DISCUSSION" | "BLOCK_TASK" | "REMOVE_DEPENDENCY" | "UPDATE_DEADLINE" | "CHANGE_ASSIGNEE" | "CHANGE_PRIORITY"
/** 事件侧历史别名：与冻结契约同义。 */
export type ProposalOrigin = "meeting" | "event"
export type ProposalTriggerType = "manual" | "data_change" | "sprint_close" | "scheduled"
export type AgentProposalStatus = ProposalStatus
export type ProposalActionDecision = "pending" | "accepted" | "rejected"

export interface ProposalPrecondition {
  targetType: ProposalTargetType
  targetId: string
  field: string
  expectedValue: unknown
}

export interface ProposalEvidence {
  agentType: AgentType
  targetType: ProposalTargetType
  targetId: string
  detail: string
}

export interface ProposalAction {
  id: string
  actionType: ProposalActionType
  targetType: ProposalTargetType
  targetId: string
  beforeValue: unknown
  proposedValue: Record<string, unknown>
  reason: string
  decision: "pending" | "accepted" | "rejected"
  status: "pending" | "applied" | "failed" | "stale"
  preconditions: ProposalPrecondition[]
  dependsOnActionIds: string[]
  resultTargetId: string | null
  appliedAt: string | null
  error: string | null
  executionOutcome?: "written" | "existing"
}

export interface AgentProposal {
  /** Attribution only; the shared meeting/event origin contract stays unchanged. */
  sourceMeetingId?: string
  schemaVersion: number
  id: string
  projectId: string
  origin: "meeting" | "event"
  triggerType: "manual" | "data_change" | "sprint_close" | "scheduled"
  agentType: AgentType
  targetType: ProposalTargetType
  targetId: string
  summary: string
  reasoning: string
  evidence: ProposalEvidence[]
  originalActions: ProposalAction[]
  sourcePlanId?: string
  sourcePlanRevision?: number
  constraintsSnapshot?: MeetingConstraints
  planSnapshot?: PlanRevision
  reviewedActions?: ProposalAction[]
  preconditions?: ProposalPrecondition[]
  actions: ProposalAction[]
  status: ProposalStatus
  createdBy: string
  createdAt: string
  updatedAt: string
  reviewedBy: string | null
  reviewedAt: string | null
  reviewNote: string
  appliedAt: string | null
  applyError: string | null
}

export interface MeetingConstraints {
  people?: { mode: "exact" | "max"; count: number } | null
  maxTotalHours?: number | null
  memberRules?: Record<string, { allowedTaskTypes?: TaskType[]; maxDays?: number; maxHours?: number; capacityWindowDays?: number }>
  maxPeople: number | null
  requiredPeople?: number | null
  maxDays: number | null
  maxHours: number | null
  excludedMemberIds: string[]
  preferredAssigneeId: string | null
  assignmentOverrides: Record<string, string>
  targetSprintId: string | null
  allowSubtasks: boolean
  parallel: boolean
  frontendBackend: boolean
  preserveExisting: boolean
  removedTaskKeys: string[]
  testOnlyMemberIds: string[]
  allowedMemberIds: string[]
  lockStartedTasks: boolean
  backendOnly: boolean
  lockedTaskKeys: string[]
  lockedTasks?: Record<string, MeetingPlanTask>
}

export interface MeetingPlanTask {
  key: string
  storyId: string
  sourceTaskId: string | null
  title: string
  type: TaskType
  estimate: number
  assigneeId: string
  phase: string
  dependsOnKeys: string[]
  subtaskTitles: string[]
  startDate: string
  endDate: string
}

export interface PlanOption {
  planId?: string
  revision?: number
  id: "A" | "B" | "C"
  title: string
  summary: string
  kind: "decomposition" | "workload" | "risk"
  tasks: MeetingPlanTask[]
  subtasks?: Array<{ key: string; parentTaskKey: string; title: string; estimate: number; assigneeId: string }>
  estimatedDurationDays: number
  totalHours: number
  workloadSummary: Record<string, number>
  riskSummary: string
  advantages: string[]
  tradeoffs: string[]
  feasible: boolean
  infeasibleReasons: string[]
  criticalPathHours?: number
  criticalPathTaskKeys?: string[]
  scheduledTasks?: Array<{ key: string; earliestStartDays: number; earliestFinishDays: number }>
}

export interface FocusPlanningContext {
  constraints: MeetingConstraints
  options: PlanOption[]
  activePlanId: PlanOption["id"] | null
  referencedTaskKeys: string[]
  pendingAssignment: { taskId: string; memberId: string } | null
  planningMode: "normal" | "next_sprint" | "wbs_only" | "diagnose"
  currentTopic: string
  lastAgentType: AgentType | null
  lastAnalysis: string
  decisionSummary: string
}

export interface MeetingMemory {
  workingState?: MeetingWorkingState
  currentTopic: string
  constraints: MeetingConstraints
  options: PlanOption[]
  activePlanId: PlanOption["id"] | null
  lastAgentType: AgentType | null
  lastAnalysis: string
  referencedTaskKeys: string[]
  referencedMemberIds: string[]
  discussionSummary: string
  decisionSummary: string
  focusStoryIds: string[]
  focusTaskIds: string[]
  focusSprintId: string | null
  focusMemberIds: string[]
  focusRiskIds: string[]
  previousStoryId: string | null
  pendingAssignment: { taskId: string; memberId: string } | null
  planningMode: "normal" | "next_sprint" | "wbs_only" | "diagnose"
  planningByFocus: Record<string, FocusPlanningContext>
}

export interface MeetingFocus {
  storyIds: string[]
  taskIds: string[]
  sprintId: string | null
}

export interface PlanRevision {
  planId: string
  revision: number
  optionId: PlanOption["id"]
  focus: MeetingFocus
  tasks: MeetingPlanTask[]
  subtasks?: NonNullable<PlanOption['subtasks']>
  dependencies: Array<{ sourceTaskKey: string; targetTaskKey: string; source: "registered" | "proposed" }>
  assignments: Record<string, string>
  estimates: Record<string, number>
  constraintsSnapshot: MeetingConstraints
  validation: { valid: boolean; errors: string[] }
  option: PlanOption
  createdAt: string
}

export interface MeetingWorkingState {
  schemaVersion: 1
  focus: MeetingFocus
  activeAgent: string | null
  activePlanId: string | null
  activePlanRevision: number | null
  constraints: MeetingConstraints
  planRevisions: PlanRevision[]
  whatIfResults: Array<Record<string, unknown>>
  whatIfBaselines?: Record<string, Pick<ProjectDataState, 'tasks' | 'dependencies'>>
  storeAtStart?: Pick<ProjectDataState, "project" | "stories" | "tasks" | "subtasks" | "members" | "sprints" | "dependencies" | "risks" | "acceptanceCriteria">
  historyAtStart?: string[]
}

export type ScrumMeetingType = "daily" | "planning" | "review" | "retrospective"
export type MeetingHostEventKind = "welcome" | "agenda" | "guide" | "time_warning" | "overtime" | "extended" | "closing" | "topic_deviation" | "sprint_blocker" | "blocker_followup" | "outcome"
export type MeetingHostChoice = "return" | "continue" | "incorrect" | "analyze" | "defer" | "propose"
export interface MeetingHostEvent {
  key: string
  kind: MeetingHostEventKind
  sourceMessageIds?: string[]
  taskIds?: string[]
  riskIds?: string[]
  topicSignature?: string
  assessment?: { basis: "model" | "rules"; reason: string }
  analysisMessageId?: string
  resolution?: { choice: MeetingHostChoice; at: string; taskId?: string }
}
export interface MeetingHostEventInput {
  key: string
  content: string
  sourceMessageIds?: string[]
  taskIds?: string[]
  riskIds?: string[]
  topicSignature?: string
  assessment?: MeetingHostEvent["assessment"]
  analysisMessageId?: string
  evidence?: string[]
}
export interface MeetingManagementState {
  reviewedThroughMessageId?: string
  lastReviewedAt?: string
  lastInterventionAt?: string
  deviationSuppressedUntil?: string
  dismissedTopicSignatures?: string[]
}

export interface MeetingStartOptions {
  meetingType: ScrumMeetingType
  sprintId?: string | null
  demoSpeed?: 1 | 30
  voiceEnabled?: boolean
}

export interface MeetingFacilitation {
  startedAt: string
  plannedMinutes: number
  sprintId: string | null
  demoSpeed: 1 | 30
  voiceEnabled: boolean
  actualDurationMs?: number
  actualOvertimeMs?: number | null
  demoElapsedMs?: number
  demoOvertimeMs?: number
  management?: MeetingManagementState
}

export interface MeetingSession {
  pinnedAt?: string | null
  demo?: {
    version: 1
    source: "project-snapshot" | "reference-snapshot"
    sourceCapturedAt: string
    sourceFingerprint: string
    recordedEvents: true
    materialStatus?: "pending" | "ready" | "error"
    materialsRevision?: number
    materialError?: string
    agendaTiming: Array<{ topicId: string; plannedMinutes: number; startedAt: string; endedAt: string }>
  }
  outcomeSnapshot?: MeetingOutcomeSnapshot
  id: string
  projectId: string
  targetType: "project" | "story" | "sprint"
  targetId: string
  title: string
  status: "active" | "ended"
  participantIds: string[]
  createdBy: string
  createdAt: string
  endedAt: string | null
  messageIds: string[]
  proposalIds: string[]
  memory?: MeetingMemory
  topics?: MeetingTopic[]
  facts?: MeetingFact[]
  minutes?: MeetingMinutes
  qaTrace?: MeetingQaTrace[]
  presentationMode?: "standard" | "defense"
  narrative?: MeetingNarrative
  meetingType?: ScrumMeetingType
  facilitation?: MeetingFacilitation
}

/** Frozen business facts at close. Only explicitly attributed Proposal follow-ups may advance later. */
export interface MeetingOutcomeSnapshot {
  version: 1
  capturedAt: string
  sourceProposalIds: string[]
  context: Pick<ProjectDataState, "project" | "members" | "sprints" | "stories" | "tasks" | "subtasks" | "risks" | "dependencies" | "acceptanceCriteria"> & Partial<Pick<ProjectDataState, "discussions">>
  proposals: Record<string, AgentProposal>
  history: ChangeHistoryItem[]
}

export interface MeetingNarrative {
  text: string
  references: Array<{ text: string; sourceMessageIds: string[] }>
  fingerprint: string
  generatedAt: string
  model: string
}

export interface MeetingQaTrace {
  messageId: string
  input: string
  resolvedIntent: string
  focusStoryIds: string[]
  focusSprintId: string | null
  referencedTaskKeys: string[]
  constraints: MeetingConstraints
  calledAgents: AgentType[]
  snapshotVersion: string
  selectedOptionId: PlanOption["id"] | null
  proposalId: string | null
  llmFallback: boolean
  llmReplyUsed?: boolean
  warnings: string[]
}

export interface MeetingTopic {
  id: string
  title: string
  type: "planning" | "risk" | "workload" | "decision" | "general"
  status: "pending" | "active" | "recorded" | "deferred" | "discussed" | "unresolved" | "decided"
  agendaKey?: string
  relatedEntityIds: string[]
  relatedAgentTypes: AgentType[]
  createdFromMessageId: string
}

export interface MeetingFact {
  id: string
  type: "fact" | "hypothesis" | "commitment" | "opinion"
  status: "unverified" | "confirmed" | "dismissed"
  content: string
  sourceMessageId: string
  relatedEntityIds: string[]
}

export interface MeetingMinutes {
  generatedAt: string
  executiveSummary: string[]
  topics: string[]
  keyFacts: string[]
  hypotheses: string[]
  decisions: string[]
  deferred: string[]
  actions: Array<{ title: string; detail: string; status: string; sourceMessageIds?: string[] }>
  executionResults: string[]
  openQuestions: string[]
  risks: string[]
  relatedEntities: string[]
  participantIds: string[]
  agentTypes: AgentType[]
}

export interface MeetingContext {
  facilitation?: { meetingType: ScrumMeetingType; name: string; agenda: string; guidance: string }
  digitalMemberId?: string
  meetingId: string
  targetType: MeetingSession["targetType"]
  targetId: string
  currentTopic: string
  recentMessages: MeetingMessage[]
  referencedStoryId: string | null
  referencedTaskKeys: string[]
  referencedMemberIds: string[]
  lastAgentType: AgentType | null
  lastAnalysis: string
  activePlan: PlanOption | null
  activeProposalId: string | null
  constraints: MeetingConstraints
  focusStoryIds: string[]
  focusTaskIds: string[]
  focusSprintId: string | null
  focusMemberIds: string[]
  focusRiskIds: string[]
  global: { meetingId: string; projectId: string; participantIds: string[]; recentMessages: MeetingMessage[]; summary: string }
  focus: { storyIds: string[]; taskIds: string[]; sprintId: string | null; memberIds: string[]; riskIds: string[] }
  planning: FocusPlanningContext
}

export interface MeetingMessage {
  inputSource?: "text" | "voice"
  hostEvent?: MeetingHostEvent
  id: string
  meetingId: string
  senderType: "user" | "agent" | "digital_member" | "system"
  senderId: string
  content: string
  signal?: "reanalyze"
  createdAt: string
  proposalId?: string
  evidence?: string[]
  rawEvidence?: ProposalEvidence[]
  artifactIds?: string[]
  handoffTo?: AgentType
}

export interface WorkspaceState {
  aiSessionId?: string
  aiFocusRequest?: {
    type: "events" | "proposals"
    nonce: number
  }
  projectTab?: "overview" | "details" | "use-case"
  sprintTab?: "progress" | "acceptance" | "risks"
  /** Empty selects the current Sprint; all/unassigned/a Release id selects cross-Sprint planning. */
  releaseFilterId?: string
  currentPage: Page
  currentView: MainView
  selectedSprintId: string
  selectedObjectType: SelectedObjectType
  selectedObjectId: string | null
  memberFilterId: string | null
  statusFilter: StoryDeliveryStatus | "all"
  riskFilter: RiskLevel | "all"
  actorMode: ActorMode
  currentUserId: string
  inspectorOpen: boolean
  inspectorTab: InspectorTab
  inspectorWidth: number
  backlogCollapsed: boolean
  backlogWidth: number
  backlogFullscreen: boolean
  storyMapZoom: number
  goalFocusId?: string
  storyMapScrollLeft: number
  storyMapScrollTop: number
  showEngineeringLayer: boolean
  showCompletedStories: boolean
  ganttRangeStart: string
  ganttRangeEnd: string
  ganttCollapsedIds: string[]
  ganttScrollLeft: number
  ganttScrollTop: number
  ganttCriticalPath: boolean
  ganttHeatmapHighlight: {
    date: string
    taskIds: string[]
    subtaskIds: string[]
    nonce: number
  } | null
  focusRequest: {
    type: "story" | "task" | "subtask"
    id: string
    nonce: number
  } | null
}

export interface ProjectEventRecord {
  id: string
  sprintId: string
  event: import("./utils/eventDetection").DetectedEvent
  fingerprint: string
  status: "new" | "pending" | "suggested" | "resolved" | "ignored"
  proposalId: string | null
  firstSeenAt: string
  updatedAt: string
}

export interface ProjectDataState {
  releases: Record<string, ReleaseEntity>
  schemaVersion: number
  project: ProjectEntity
  members: Record<string, Member>
  projectUseCase: ProjectUseCaseData
  activities: Record<string, UserActivityEntity>
  /** Legacy import compatibility only; schema 17 stores an empty map. */
  userTasks: Record<string, UserTaskEntity>
  epics: Record<string, EpicEntity>
  stories: Record<string, StoryEntity>
  tasks: Record<string, TaskEntity>
  subtasks: Record<string, SubtaskEntity>
  sprints: Record<string, SprintEntity>
  acceptanceCriteria: Record<string, AcceptanceCriterion>
  dependencies: Record<string, DependencyEntity>
  assets: Record<string, DesignAssetEntity>
  risks: Record<string, RiskEntity>
  impactAnalyses: ImpactAnalysisEntity[]
  sprintBurndowns: Record<string, SprintBurndown>
  sprintPulses: Record<string, SprintPulseEntity>
  discussions: Record<string, DiscussionMessageEntity>
  history: ChangeHistoryItem[]
  proposals: Record<string, AgentProposal>
  projectEvents: Record<string, ProjectEventRecord>
  meetingSessions: Record<string, MeetingSession>
  meetingMessages: Record<string, MeetingMessage>
  workspace: WorkspaceState
}
