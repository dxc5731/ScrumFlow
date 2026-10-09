export type Priority = "critical" | "high" | "medium" | "low"
export type Status = "todo" | "in-progress" | "review" | "done" | "blocked"
export type RiskLevel = "high" | "medium" | "low" | "none"
export type TaskType = "frontend" | "backend" | "database" | "test" | "design" | "devops"
export type SprintStatus = "planning" | "active" | "review" | "closed"
export type ViewMode = "user" | "engineering" | "comprehensive"
export type MainView = "story-map" | "gantt" | "board"

export type Page = "overview" | "story-map" | "backlog" | "wbs" | "gantt" | "sprint" | "acceptance" | "board" | "daily-scrum" | "risks" | "assets" | "chat" | "cockpit" | "workload" | "contribution" | "release" | "retrospective" | "lab" | "settings"

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
  userTaskId: string
  startDate: string
  endDate: string
  order: number
}

export interface SprintEntity {
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

export type ProposalOrigin = "meeting" | "event"
export type ProposalTriggerType =
  | "manual"
  | "data_change"
  | "sprint_close"
  | "scheduled"
export type AgentType =
  | "project_orchestrator"
  | "risk_dependency"
  | "workload_capacity"
  | "plan_execution"
  | "project_monitor"
  | "collaboration_notification"
  | "material_organizer"
  | "contribution_insight"
export type ProposalTargetType =
  | "project"
  | "sprint"
  | "story"
  | "task"
  | "subtask"
  | "member"
  | "dependency"
  | "risk"
export type ProposalActionType =
  | "CREATE_TASK"
  | "CREATE_SUBTASK"
  | "CREATE_RISK"
  | "CREATE_DISCUSSION"
  | "BLOCK_TASK"
  | "ADD_DEPENDENCY"
  | "REMOVE_DEPENDENCY"
  | "UPDATE_TASK"
  | "UPDATE_SUBTASK"
  | "UPDATE_STORY"
  | "UPDATE_RISK"
  | "UPDATE_DEADLINE"
  | "CHANGE_ASSIGNEE"
  | "CHANGE_PRIORITY"
export type ProposalActionDecision = "pending" | "accepted" | "rejected"
export type ProposalActionStatus = "pending" | "applied" | "failed" | "stale"
export type AgentProposalStatus =
  | "draft"
  | "reviewed"
  | "applying"
  | "applied"
  | "partially_applied"
  | "rejected"
  | "failed"

export interface ProposalPrecondition {
  targetType: ProposalTargetType
  targetId: string
  field: string
  expected: unknown
}

export interface ProposalAction {
  id: string
  actionType: ProposalActionType
  targetType: ProposalTargetType
  targetId: string | null
  beforeValue: unknown
  proposedValue: unknown
  reason: string
  decision: ProposalActionDecision
  status: ProposalActionStatus
  preconditions: ProposalPrecondition[]
  dependsOnActionIds: string[]
  resultTargetId: string | null
  appliedAt: string | null
  error: string
}

export interface AgentProposal {
  schemaVersion: number
  id: string
  projectId: string
  origin: ProposalOrigin
  triggerType: ProposalTriggerType
  agentType: AgentType
  targetType: ProposalTargetType
  targetId: string
  summary: string
  reasoning: string
  evidence: string[]
  originalActions: ProposalAction[]
  actions: ProposalAction[]
  status: AgentProposalStatus
  createdBy: string
  createdAt: string
  updatedAt: string
  reviewedBy: string | null
  reviewedAt: string | null
  reviewNote: string
  appliedAt: string | null
  applyError: string
}

export interface ChangeHistoryItem {
  id: string
  createdAt: string
  actorId: string
  objectType: "project" | "activity" | "userTask" | "epic" | "story" | "task" | "subtask" | "acceptance" | "dependency" | "discussion" | "sprint" | "asset" | "risk" | "impact" | "pulse" | "proposal"
  objectId: string
  field: string
  before: unknown
  after: unknown
  source: "ui" | "drag" | "import" | "undo" | "system" | "agent"
  proposalId?: string
  proposalActionId?: string
}

export interface WorkspaceState {
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

export interface ProjectDataState {
  schemaVersion: number
  project: ProjectEntity
  members: Record<string, Member>
  activities: Record<string, UserActivityEntity>
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
  sprintPulses: Record<string, SprintPulseEntity>
  discussions: Record<string, DiscussionMessageEntity>
  proposals: Record<string, AgentProposal>
  history: ChangeHistoryItem[]
  workspace: WorkspaceState
}
