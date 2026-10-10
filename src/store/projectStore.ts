import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { z } from "zod"
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns"
import { localProjectStorage } from "./localPersistence"
import { eventConditionError, reconcileProjectEvents } from "../utils/eventLifecycle"
import { calculatePlanSchedule } from "../agents/meetingSchedule"
import { validatePlanAgainstConstraints } from "../agents/meetingConstraintValidator"
import { revalidateReviewedProposal } from "../agents/meetingFinalRevalidation"
import {
  CURRENT_SCHEMA_VERSION,
  createDemoProjectState,
} from "../data/demoProject"
import type {
  AcceptanceCriterion,
  AcceptanceRecord,
  AgentProposal,
  AgentType,
  AssetLinkTargetType,
  BlockReasonEntity,
  ChangeHistoryItem,
  DesignAssetEntity,
  DependencyEntity,
  DiscussionMessageEntity,
  EpicEntity,
  ImpactAnalysisEntity,
  InspectorTab,
  Member,
  MeetingMessage,
  MeetingMemory,
  MeetingQaTrace,
  MeetingSession,
  ProjectDataState,
  ProposalAction,
  ProposalActionDecision,
  ProposalActionType,
  ProposalEvidence,
  ProposalOrigin,
  ProposalPrecondition,
  ProposalTargetType,
  ProposalTriggerType,
  RiskEntity,
  SprintPulseEntity,
  SprintEntity,
  SprintStatus,
  StoryEntity,
  StoryMaturityStatus,
  SubtaskEntity,
  TaskEntity,
  UserActivityEntity,
  UserTaskEntity,
  WorkspaceState,
} from "../types"
import { createMeetingMemory } from "../agents/meetingContext"
import { buildProjectAnalysisSnapshot } from "../agents/meetingSnapshot"
import { synchronizeWorkingState } from '../agents/meetingWorkingState'
import { generateMeetingMinutes, meetingFactFromMessage, recordMeetingTopic, topicFromMeetingFact } from "../agents/meetingMinutes"

function refreshedEndedMeetingMinutes(state: ProjectDataState, proposalId: string) {
  const sessions = Object.values(state.meetingSessions).filter((session) => session.status === "ended" && session.proposalIds.includes(proposalId))
  if (!sessions.length) return state.meetingSessions
  return { ...state.meetingSessions, ...Object.fromEntries(sessions.map((session) => [session.id, {
    ...session, minutes: generateMeetingMinutes(state, session),
  }])) }
}

type ChangeSource = ChangeHistoryItem["source"]

export type ScheduleEntityType = "epic" | "story" | "task" | "subtask"
export type ScheduleChangeMode = "move" | "left" | "right" | "resize"

export interface ScheduleRange {
  startDate: string
  endDate: string
}

interface HierarchyScheduleSnapshot {
  epics: Record<string, ScheduleRange>
  stories: Record<string, ScheduleRange>
  tasks: Record<string, ScheduleRange>
  subtasks: Record<string, ScheduleRange>
}

export type HierarchySchedulePlan =
  | { ok: false; message: string }
  | {
      ok: true
      message: string
      epics: ProjectDataState["epics"]
      stories: ProjectDataState["stories"]
      tasks: ProjectDataState["tasks"]
      subtasks: ProjectDataState["subtasks"]
      before: HierarchyScheduleSnapshot
      after: HierarchyScheduleSnapshot
    }

export interface ActionResult {
  ok: boolean
  message: string
}

export interface SprintStartCheck {
  key: "goal" | "dates" | "stories" | "assignees" | "no_other_active"
  label: string
  passed: boolean
  detail: string
}

export interface SprintClosePayload {
  goalAchieved: boolean
  retrospective: {
    mainProblem: string
    nextImprovement: string
  }
  carryOver: Array<{ storyId: string; to: "backlog" | string }>
}

export interface ResultSubmission {
  note: string
  links: string[]
  assetIds: string[]
}

export interface BlankProjectInput {
  name: string
  goal: string
  requirementBrief: string
  startDate: string
  endDate: string
  members: Array<Pick<Member, "name" | "role" | "capacityHours">>
}

export interface ProjectActions {
  refreshProjectEvents: (now?: Date) => void
  ignoreProjectEvent: (id: string) => void
  createMeeting: (targetType: "project" | "story" | "sprint", targetId: string) => MeetingSession
  addMeetingMessage: (meetingId: string, input: Pick<MeetingMessage, "senderType" | "senderId" | "content"> & Partial<Pick<MeetingMessage, "proposalId" | "evidence" | "rawEvidence" | "signal" | "artifactIds" | "handoffTo">>) => MeetingMessage
  endMeeting: (meetingId: string) => ActionResult
  setMeetingPresentation: (meetingId: string, patch: Pick<MeetingSession, "narrative" | "presentationMode">) => void
  linkMeetingProposal: (meetingId: string, proposalId: string) => ActionResult
  setMeetingMemory: (meetingId: string, memory: MeetingMemory) => ActionResult
  recordMeetingQaTrace: (meetingId: string, trace: MeetingQaTrace) => ActionResult
  saveProposal: (proposal: AgentProposal) => ActionResult
  setProposalDecision: (proposalId: string, actionId: string, decision: ProposalAction["decision"]) => ActionResult
  updateProposalValue: (proposalId: string, actionId: string, value: Record<string, unknown>) => ActionResult
  rejectProposal: (proposalId: string, note?: string) => ActionResult
  applyProposal: (proposalId: string, note?: string) => ActionResult
  createProposal: (input: CreateProposalInput) => AgentProposal
  updateProposal: (id: string, patch: Partial<AgentProposal>) => ActionResult
  setProposalActionDecision: (
    id: string,
    actionId: string,
    decision: ProposalActionDecision,
  ) => ActionResult
  deleteProposal: (id: string) => ActionResult
  createBlankProject: (input: BlankProjectInput) => ActionResult
  updateProject: (
    patch: Partial<ProjectDataState["project"]>,
  ) => ActionResult
  setWorkspace: (patch: Partial<WorkspaceState>) => void
  setInspectorTab: (tab: InspectorTab) => void
  selectObject: (
    type: "story" | "task" | "subtask" | null,
    id?: string | null,
  ) => void
  navigateTo: (view: "story-map" | "gantt" | "board") => void
  requestFocus: (
    type: "story" | "task" | "subtask",
    id: string,
    view?: "story-map" | "gantt" | "board",
  ) => void
  selectSprint: (id: string) => ActionResult
  createSprint: (
    input: Pick<SprintEntity, "name" | "goal" | "startDate" | "endDate" | "capacity"> & Partial<SprintEntity>,
  ) => SprintEntity
  updateSprint: (
    id: string,
    patch: Partial<SprintEntity>,
    source?: ChangeSource,
  ) => ActionResult
  setSprintStatus: (id: string, status: SprintStatus) => ActionResult
  addStoriesToSprint: (sprintId: string, storyIds: string[]) => ActionResult
  removeStoryFromSprint: (storyId: string) => ActionResult
  startSprint: (sprintId: string) => ActionResult
  closeSprint: (sprintId: string, payload: SprintClosePayload) => ActionResult
  reopenSprint: (sprintId: string) => ActionResult
  updateStory: (
    id: string,
    patch: Partial<StoryEntity>,
    source?: ChangeSource,
  ) => ActionResult
  createStory: (
    input: Partial<StoryEntity> & Pick<StoryEntity, "title" | "source">,
  ) => StoryEntity
  deleteStory: (id: string) => ActionResult
  setStoryMaturity: (id: string, maturity: StoryMaturityStatus) => ActionResult
  moveStory: (
    id: string,
    epicId: string | null,
    sprintId: string | null,
    targetIndex?: number,
  ) => ActionResult
  reorderBacklog: (id: string, targetIndex: number) => ActionResult
  createActivity: (
    input: Pick<UserActivityEntity, "title"> & Partial<UserActivityEntity>,
  ) => UserActivityEntity
  updateActivity: (
    id: string,
    patch: Partial<UserActivityEntity>,
    source?: ChangeSource,
  ) => ActionResult
  deleteActivity: (id: string) => ActionResult
  createUserTask: (
    activityId: string,
    input?: Partial<UserTaskEntity>,
  ) => UserTaskEntity
  updateUserTask: (
    id: string,
    patch: Partial<UserTaskEntity>,
    source?: ChangeSource,
  ) => ActionResult
  deleteUserTask: (id: string) => ActionResult
  createEpic: (userTaskId: string, input?: Partial<EpicEntity>) => EpicEntity
  updateEpic: (
    id: string,
    patch: Partial<EpicEntity>,
    source?: ChangeSource,
  ) => ActionResult
  deleteEpic: (id: string) => ActionResult
  moveActivity: (id: string, targetIndex: number) => void
  moveUserTask: (id: string, activityId: string, targetIndex: number) => void
  moveEpic: (id: string, userTaskId: string, targetIndex: number) => void
  rescheduleItem: (
    type: ScheduleEntityType,
    id: string,
    startDate: string,
    endDate: string,
    mode: ScheduleChangeMode,
    source?: ChangeSource,
  ) => ActionResult
  updateTask: (
    id: string,
    patch: Partial<TaskEntity>,
    source?: ChangeSource,
  ) => ActionResult
  createTask: (storyId: string, input?: Partial<TaskEntity>) => TaskEntity
  deleteTask: (id: string) => ActionResult
  moveTask: (id: string, storyId: string, targetIndex?: number) => ActionResult
  updateSubtask: (
    id: string,
    patch: Partial<SubtaskEntity>,
    source?: ChangeSource,
  ) => ActionResult
  deleteSubtask: (id: string) => ActionResult
  reorderSubtask: (id: string, targetIndex: number) => void
  addSubtask: (taskId: string, title: string) => SubtaskEntity
  toggleSubtask: (id: string) => void
  submitTaskResult: (
    type: "task" | "subtask",
    id: string,
    result: ResultSubmission,
  ) => ActionResult
  acceptStory: (storyId: string, note?: string) => ActionResult
  returnStory: (
    storyId: string,
    reason: string,
    reopenIds: Array<{ type: "task" | "subtask"; id: string }>,
    resetTo?: "in_progress" | "review",
  ) => ActionResult
  addTaskBlockReason: (
    taskId: string,
    message: string,
    relatedTaskId?: string | null,
  ) => ActionResult
  deleteTaskBlockReason: (taskId: string, reasonId: string) => ActionResult
  addSubtaskBlockReason: (
    subtaskId: string,
    message: string,
    relatedTaskId?: string | null,
  ) => ActionResult
  deleteSubtaskBlockReason: (
    subtaskId: string,
    reasonId: string,
  ) => ActionResult
  addAcceptanceCriterion: (
    storyId: string,
    content: string,
  ) => AcceptanceCriterion
  updateAcceptanceCriterion: (
    id: string,
    patch: Partial<AcceptanceCriterion>,
  ) => void
  deleteAcceptanceCriterion: (id: string) => void
  reorderAcceptanceCriterion: (id: string, targetIndex: number) => void
  addDependency: (sourceTaskId: string, targetTaskId: string) => ActionResult
  deleteDependency: (id: string) => ActionResult
  createAsset: (
    input: Pick<DesignAssetEntity, "name" | "kind"> & Partial<DesignAssetEntity>,
  ) => DesignAssetEntity
  updateAsset: (
    id: string,
    patch: Partial<DesignAssetEntity>,
    source?: ChangeSource,
  ) => ActionResult
  linkAsset: (
    id: string,
    targetType: AssetLinkTargetType,
    targetId: string,
  ) => ActionResult
  unlinkAsset: (
    id: string,
    targetType: AssetLinkTargetType,
    targetId: string,
  ) => ActionResult
  deleteAsset: (id: string) => ActionResult
  createRisk: (
    input: Omit<RiskEntity, "id" | "createdAt" | "updatedAt">,
  ) => RiskEntity
  updateRisk: (id: string, patch: Partial<RiskEntity>) => ActionResult
  deleteRisk: (id: string) => ActionResult
  addSprintPulse: (
    input: Omit<SprintPulseEntity, "id" | "createdAt">,
  ) => SprintPulseEntity
  deleteSprintPulse: (id: string) => ActionResult
  addDiscussion: (
    targetType: DiscussionMessageEntity["targetType"],
    targetId: string,
    content: string,
  ) => ActionResult
  undoLastChange: () => ActionResult
  exportProjectJson: () => string
  importProjectJson: (json: string) => ActionResult
  resetDemoData: () => void
}

export type ProjectStore = ProjectDataState & ProjectActions

const importSchema = z
  .object({
    schemaVersion: z.number(),
    project: z.object({ id: z.string(), name: z.string() }).passthrough(),
    stories: z.record(z.string(), z.unknown()),
    tasks: z.record(z.string(), z.unknown()),
    workspace: z.object({ selectedSprintId: z.string() }).passthrough(),
  })
  .passthrough()

const dataKeys: (keyof ProjectDataState)[] = [
  "schemaVersion",
  "project",
  "members",
  "activities",
  "userTasks",
  "epics",
  "stories",
  "tasks",
  "subtasks",
  "sprints",
  "acceptanceCriteria",
  "dependencies",
  "assets",
  "risks",
  "impactAnalyses",
  "sprintPulses",
  "discussions",
  "history",
  "proposals",
  "projectEvents",
  "meetingSessions",
  "meetingMessages",
  "workspace",
]

function dataSnapshot(
  state: ProjectStore | ProjectDataState,
): ProjectDataState {
  return Object.fromEntries(
    dataKeys.map((key) => [key, structuredClone(state[key])]),
  ) as unknown as ProjectDataState
}

function nowIso() {
  return new Date().toISOString()
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function historyItem(
  objectType: ChangeHistoryItem["objectType"],
  objectId: string,
  field: string,
  before: unknown,
  after: unknown,
  source: ChangeSource,
): ChangeHistoryItem {
  return {
    id: makeId("history"),
    createdAt: nowIso(),
    actorId: "m1",
    objectType,
    objectId,
    field,
    before: structuredClone(before),
    after: structuredClone(after),
    source,
  }
}

function appendHistory(
  history: ChangeHistoryItem[],
  items: ChangeHistoryItem[],
) {
  const all = [...history, ...items]
  return all.filter((entry, index) => entry.source === "agent" || index >= all.length - 240)
}

function appendImpact(
  items: ImpactAnalysisEntity[],
  item?: ImpactAnalysisEntity | null,
) {
  return item ? [...items, item].slice(-100) : items
}

function executionSprint(
  state: Pick<ProjectDataState, "stories" | "tasks" | "subtasks" | "sprints">,
  type: "task" | "subtask",
  id: string,
) {
  const task =
    type === "task" ? state.tasks[id] : state.tasks[state.subtasks[id]?.taskId]
  const story = task ? state.stories[task.storyId] : null
  return story?.sprintId ? state.sprints[story.sprintId] : null
}

function executionWriteGuard(
  state: Pick<ProjectDataState, "stories" | "tasks" | "subtasks" | "sprints">,
  type: "task" | "subtask",
  id: string,
) {
  const sprint = executionSprint(state, type, id)
  return sprint?.status === "closed"
    ? `${sprint.name} 已关闭，请先重开 Sprint 再修改执行数据`
    : null
}

function downstreamTaskIds(
  state: Pick<ProjectDataState, "dependencies">,
  roots: string[],
) {
  const found = new Set(roots)
  const queue = [...roots]
  while (queue.length) {
    const current = queue.shift()!
    Object.values(state.dependencies)
      .filter((item) => item.sourceTaskId === current)
      .forEach((item) => {
        if (found.has(item.targetTaskId)) return
        found.add(item.targetTaskId)
        queue.push(item.targetTaskId)
      })
  }
  return [...found]
}

function makeImpactAnalysis(
  state: ProjectDataState,
  triggerType: ImpactAnalysisEntity["triggerType"],
  triggerId: string,
  changeType: ImpactAnalysisEntity["changeType"],
  rootTaskIds: string[],
  extraMemberIds: string[] = [],
) {
  const affectedTaskIds = downstreamTaskIds(state, rootTaskIds).filter((id) =>
    Boolean(state.tasks[id]),
  )
  const affectedMilestoneIds = affectedTaskIds.filter(
    (id) => state.tasks[id]?.isMilestone,
  )
  const affectedMemberIds = [
    ...new Set([
      ...extraMemberIds,
      ...affectedTaskIds.map((id) => state.tasks[id]?.assigneeId).filter(Boolean),
    ]),
  ] as string[]
  const beyondProject = affectedTaskIds.some(
    (id) => state.tasks[id]?.endDate > state.project.endDate,
  )
  const releaseRisk: ImpactAnalysisEntity["releaseRisk"] =
    beyondProject || affectedTaskIds.length >= 5
      ? "high"
      : affectedMilestoneIds.length || affectedTaskIds.length >= 2
        ? "medium"
        : "low"
  const label =
    changeType === "schedule"
      ? "排期"
      : changeType === "assignee"
        ? "负责人"
        : changeType === "sprint"
          ? "Sprint"
          : "依赖"
  return {
    id: makeId("impact"),
    triggerType,
    triggerId,
    changeType,
    affectedTaskIds,
    affectedMilestoneIds,
    affectedMemberIds,
    releaseRisk,
    summary: `${label}变更影响 ${affectedTaskIds.length} 个任务、${affectedMilestoneIds.length} 个里程碑和 ${affectedMemberIds.length} 位成员。`,
    createdAt: nowIso(),
  } satisfies ImpactAnalysisEntity
}

function storyExecutionLeaves(
  state: Pick<ProjectDataState, "tasks" | "subtasks">,
  storyId: string,
): Array<TaskEntity | SubtaskEntity> {
  const leaves: Array<TaskEntity | SubtaskEntity> = []
  Object.values(state.tasks)
    .filter((task) => task.storyId === storyId)
    .forEach((task) => {
      const children = Object.values(state.subtasks).filter(
        (subtask) => subtask.taskId === task.id,
      )
      if (children.length) leaves.push(...children)
      else leaves.push(task)
    })
  return leaves
}

export function nextStoryDeliveryStatus(
  state: Pick<ProjectDataState, "stories" | "tasks" | "subtasks">,
  storyId: string,
) {
  const story = state.stories[storyId]
  if (!story || story.deliveryStatus === "accepted") return null
  const leaves = storyExecutionLeaves(state, storyId)
  if (!leaves.length) return null
  const allDone = leaves.every((item) => item.status === "done")
  if (allDone && story.sprintId) return "pending_acceptance" as const
  if (story.deliveryStatus === "pending_acceptance" || story.deliveryStatus === "returned") {
    return "in_progress" as const
  }
  const hasStarted = leaves.some(
    (item) => item.status !== "todo" || item.progress > 0,
  )
  if (hasStarted && story.sprintId && story.deliveryStatus === "planned") {
    return "in_progress" as const
  }
  return null
}

function deriveStoryDelivery(
  state: Pick<ProjectDataState, "stories" | "tasks" | "subtasks">,
  storyId: string,
) {
  const story = state.stories[storyId]
  const nextStatus = nextStoryDeliveryStatus(state, storyId)
  if (!story || !nextStatus || story.deliveryStatus === nextStatus) {
    return { stories: state.stories, history: [] as ChangeHistoryItem[] }
  }
  return {
    stories: {
      ...state.stories,
      [storyId]: {
        ...story,
        deliveryStatus: nextStatus,
        updatedAt: nowIso(),
      },
    },
    history: [
      historyItem(
        "story",
        storyId,
        "deliveryStatus",
        story.deliveryStatus,
        nextStatus,
        "system",
      ),
    ],
  }
}

function deriveAllStoryDeliveries(
  state: Pick<ProjectDataState, "stories" | "tasks" | "subtasks">,
) {
  let stories = state.stories
  const history: ChangeHistoryItem[] = []
  Object.keys(stories).forEach((storyId) => {
    const derived = deriveStoryDelivery(
      { stories, tasks: state.tasks, subtasks: state.subtasks },
      storyId,
    )
    stories = derived.stories
    history.push(...derived.history)
  })
  return { stories, history }
}

export function sprintStartChecks(
  state: Pick<ProjectDataState, "sprints" | "stories" | "tasks">,
  sprintId: string,
): SprintStartCheck[] {
  const sprint = state.sprints[sprintId]
  if (!sprint) return []
  const stories = Object.values(state.stories).filter(
    (story) => story.sprintId === sprintId,
  )
  const storyIds = new Set(stories.map((story) => story.id))
  const tasks = Object.values(state.tasks).filter((task) =>
    storyIds.has(task.storyId),
  )
  const otherActive = Object.values(state.sprints).find(
    (item) => item.id !== sprintId && item.status === "active",
  )
  return [
    {
      key: "goal",
      label: "已填写 Sprint Goal",
      passed: Boolean(sprint.goal.trim()),
      detail: sprint.goal.trim() ? "已填写" : "Sprint Goal 不能为空",
    },
    {
      key: "dates",
      label: "Sprint 日期有效",
      passed: sprint.startDate < sprint.endDate,
      detail:
        sprint.startDate < sprint.endDate
          ? `${sprint.startDate} 至 ${sprint.endDate}`
          : "结束日期必须晚于开始日期",
    },
    {
      key: "stories",
      label: "至少包含一个 Story",
      passed: stories.length > 0,
      detail: stories.length ? `已加入 ${stories.length} 个 Story` : "请先加入 Ready Story",
    },
    {
      key: "assignees",
      label: "至少有一个已分配任务",
      passed: tasks.some((task) => Boolean(task.assigneeId)),
      detail: tasks.some((task) => Boolean(task.assigneeId))
        ? "任务负责人已分配"
        : "Sprint 中至少需要一个有负责人的任务",
    },
    {
      key: "no_other_active",
      label: "没有其他进行中的 Sprint",
      passed: !otherActive,
      detail: otherActive ? `${otherActive.name} 正在进行中` : "无冲突",
    },
  ]
}

function ordered<T extends { order: number }>(
  record: Record<string, T>,
  predicate: (item: T) => boolean,
) {
  return Object.values(record)
    .filter(predicate)
    .sort((a, b) => a.order - b.order)
}

function resequence<T extends { id: string; order: number }>(
  record: Record<string, T>,
  ids: string[],
) {
  const next = { ...record }
  ids.forEach((id, order) => {
    if (next[id]) next[id] = { ...next[id], order }
  })
  return next
}

type ScheduleRecords = Pick<
  ProjectDataState,
  "epics" | "stories" | "tasks" | "subtasks"
>

function scheduleLabel(type: ScheduleEntityType) {
  if (type === "epic") return "Epic"
  if (type === "story") return "用户故事"
  if (type === "task") return "工程任务"
  return "Subtask"
}

function validScheduleDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parseISO(value).getTime())
}

function readScheduleRange(
  records: ScheduleRecords,
  type: ScheduleEntityType,
  id: string,
): ScheduleRange | null {
  if (type === "epic") {
    const entity = records.epics[id]
    return entity
      ? { startDate: entity.startDate, endDate: entity.endDate }
      : null
  }
  if (type === "story") {
    const entity = records.stories[id]
    return entity
      ? { startDate: entity.startDate, endDate: entity.dueDate }
      : null
  }
  const entity =
    type === "task" ? records.tasks[id] : records.subtasks[id]
  return entity
    ? { startDate: entity.startDate, endDate: entity.endDate }
    : null
}

function writeScheduleRange(
  records: ScheduleRecords,
  type: ScheduleEntityType,
  id: string,
  range: ScheduleRange,
) {
  if (type === "epic" && records.epics[id]) {
    records.epics[id] = { ...records.epics[id], ...range }
  } else if (type === "story" && records.stories[id]) {
    records.stories[id] = {
      ...records.stories[id],
      startDate: range.startDate,
      dueDate: range.endDate,
      updatedAt: nowIso(),
    }
  } else if (type === "task" && records.tasks[id]) {
    records.tasks[id] = { ...records.tasks[id], ...range }
  } else if (type === "subtask" && records.subtasks[id]) {
    records.subtasks[id] = { ...records.subtasks[id], ...range }
  }
}

function scheduleChildren(
  records: ScheduleRecords,
  type: ScheduleEntityType,
  id: string,
) {
  if (type === "epic") {
    return Object.values(records.stories)
      .filter((story) => story.epicId === id)
      .map((story) => ({ type: "story" as const, id: story.id }))
  }
  if (type === "story") {
    return Object.values(records.tasks)
      .filter((task) => task.storyId === id)
      .map((task) => ({ type: "task" as const, id: task.id }))
  }
  if (type === "task") {
    return Object.values(records.subtasks)
      .filter((subtask) => subtask.taskId === id)
      .map((subtask) => ({ type: "subtask" as const, id: subtask.id }))
  }
  return []
}

function scheduleParent(
  records: ScheduleRecords,
  type: ScheduleEntityType,
  id: string,
): { type: ScheduleEntityType; id: string } | null {
  if (type === "story") {
    const epicId = records.stories[id]?.epicId
    return epicId ? { type: "epic", id: epicId } : null
  }
  if (type === "task") {
    const storyId = records.tasks[id]?.storyId
    return storyId ? { type: "story", id: storyId } : null
  }
  if (type === "subtask") {
    const taskId = records.subtasks[id]?.taskId
    return taskId ? { type: "task", id: taskId } : null
  }
  return null
}

function expandAncestorSchedules(
  records: ScheduleRecords,
  childType: ScheduleEntityType,
  childId: string,
) {
  let current = { type: childType, id: childId }
  while (true) {
    const parent = scheduleParent(records, current.type, current.id)
    if (!parent) return
    const childRange = readScheduleRange(records, current.type, current.id)
    const parentRange = readScheduleRange(records, parent.type, parent.id)
    if (!childRange || !parentRange) return
    writeScheduleRange(records, parent.type, parent.id, {
      startDate:
        childRange.startDate < parentRange.startDate
          ? childRange.startDate
          : parentRange.startDate,
      endDate:
        childRange.endDate > parentRange.endDate
          ? childRange.endDate
          : parentRange.endDate,
    })
    current = parent
  }
}

function shiftScheduleRange(range: ScheduleRange, dayDelta: number) {
  return {
    startDate: format(addDays(parseISO(range.startDate), dayDelta), "yyyy-MM-dd"),
    endDate: format(addDays(parseISO(range.endDate), dayDelta), "yyyy-MM-dd"),
  }
}

function inferScheduleChangeMode(
  current: ScheduleRange,
  next: ScheduleRange,
): ScheduleChangeMode {
  const startDelta = differenceInCalendarDays(
    parseISO(next.startDate),
    parseISO(current.startDate),
  )
  const endDelta = differenceInCalendarDays(
    parseISO(next.endDate),
    parseISO(current.endDate),
  )
  if (startDelta !== 0 && startDelta === endDelta) return "move"
  if (startDelta !== 0 && endDelta === 0) return "left"
  if (endDelta !== 0 && startDelta === 0) return "right"
  return "resize"
}

function captureScheduleChanges(
  beforeRecords: ScheduleRecords,
  afterRecords: ScheduleRecords,
) {
  const before: HierarchyScheduleSnapshot = {
    epics: {},
    stories: {},
    tasks: {},
    subtasks: {},
  }
  const after: HierarchyScheduleSnapshot = {
    epics: {},
    stories: {},
    tasks: {},
    subtasks: {},
  }
  const groups = [
    ["epic", "epics"],
    ["story", "stories"],
    ["task", "tasks"],
    ["subtask", "subtasks"],
  ] as const
  groups.forEach(([type, key]) => {
    Object.keys(afterRecords[key]).forEach((id) => {
      const previous = readScheduleRange(beforeRecords, type, id)
      const next = readScheduleRange(afterRecords, type, id)
      if (!previous || !next || JSON.stringify(previous) === JSON.stringify(next))
        return
      before[key][id] = previous
      after[key][id] = next
    })
  })
  return { before, after }
}

export function planHierarchySchedule(
  state: ProjectDataState,
  type: ScheduleEntityType,
  id: string,
  startDate: string,
  endDate: string,
  mode: ScheduleChangeMode,
): HierarchySchedulePlan {
  if (!validScheduleDate(startDate) || !validScheduleDate(endDate)) {
    return { ok: false, message: "排期日期格式无效" }
  }
  if (endDate < startDate) {
    return { ok: false, message: "结束日期不能早于开始日期" }
  }

  const beforeRecords: ScheduleRecords = {
    epics: state.epics,
    stories: state.stories,
    tasks: state.tasks,
    subtasks: state.subtasks,
  }
  const records: ScheduleRecords = {
    epics: { ...state.epics },
    stories: { ...state.stories },
    tasks: { ...state.tasks },
    subtasks: { ...state.subtasks },
  }
  const current = readScheduleRange(records, type, id)
  if (!current) return { ok: false, message: `${scheduleLabel(type)} 不存在` }

  if (mode === "move") {
    const startDelta = differenceInCalendarDays(
      parseISO(startDate),
      parseISO(current.startDate),
    )
    const endDelta = differenceInCalendarDays(
      parseISO(endDate),
      parseISO(current.endDate),
    )
    if (startDelta !== endDelta) {
      return { ok: false, message: "平移排期时必须保持原工期" }
    }
    const shiftNode = (
      nodeType: ScheduleEntityType,
      nodeId: string,
    ) => {
      const range = readScheduleRange(records, nodeType, nodeId)
      if (!range) return
      writeScheduleRange(
        records,
        nodeType,
        nodeId,
        shiftScheduleRange(range, startDelta),
      )
      scheduleChildren(records, nodeType, nodeId).forEach((child) =>
        shiftNode(child.type, child.id),
      )
    }
    shiftNode(type, id)
    expandAncestorSchedules(records, type, id)
  } else {
    const nextRange = { startDate, endDate }
    writeScheduleRange(records, type, id, nextRange)
    const fitChildren = (
      parentType: ScheduleEntityType,
      parentId: string,
      boundary: ScheduleRange,
    ): ActionResult => {
      for (const child of scheduleChildren(records, parentType, parentId)) {
        const childRange = readScheduleRange(records, child.type, child.id)
        if (!childRange) continue
        if (
          childRange.endDate < boundary.startDate ||
          childRange.startDate > boundary.endDate
        ) {
          return {
            ok: false,
            message: `该缩短会完整覆盖 ${scheduleLabel(child.type)} ${child.id.toUpperCase()}，操作已取消`,
          }
        }
        const fitted = {
          startDate:
            childRange.startDate < boundary.startDate
              ? boundary.startDate
              : childRange.startDate,
          endDate:
            childRange.endDate > boundary.endDate
              ? boundary.endDate
              : childRange.endDate,
        }
        writeScheduleRange(records, child.type, child.id, fitted)
        const nested = fitChildren(child.type, child.id, fitted)
        if (!nested.ok) return nested
      }
      return { ok: true, message: "排期已保存" }
    }
    const fitted = fitChildren(type, id, nextRange)
    if (!fitted.ok) return { ok: false, message: fitted.message }
    expandAncestorSchedules(records, type, id)
  }

  const { before, after } = captureScheduleChanges(beforeRecords, records)
  return {
    ok: true,
    message: "排期及下级工作项已同步",
    ...records,
    before,
    after,
  }
}

function restoreHierarchySchedule(
  state: ProjectDataState,
  snapshot: HierarchyScheduleSnapshot,
) {
  const records: ScheduleRecords = {
    epics: { ...state.epics },
    stories: { ...state.stories },
    tasks: { ...state.tasks },
    subtasks: { ...state.subtasks },
  }
  const groups = [
    ["epic", "epics"],
    ["story", "stories"],
    ["task", "tasks"],
    ["subtask", "subtasks"],
  ] as const
  groups.forEach(([type, key]) => {
    Object.entries(snapshot[key]).forEach(([id, range]) =>
      writeScheduleRange(records, type, id, range),
    )
  })
  return records
}

function hasDependencyPath(
  dependencies: Record<string, DependencyEntity>,
  start: string,
  goal: string,
) {
  const adjacency = new Map<string, string[]>()
  Object.values(dependencies).forEach((dependency) => {
    adjacency.set(dependency.sourceTaskId, [
      ...(adjacency.get(dependency.sourceTaskId) ?? []),
      dependency.targetTaskId,
    ])
  })
  const stack = [start]
  const seen = new Set<string>()
  while (stack.length) {
    const current = stack.pop()!
    if (current === goal) return true
    if (seen.has(current)) continue
    seen.add(current)
    stack.push(...(adjacency.get(current) ?? []))
  }
  return false
}

function dependencyReasonId(dependencyId: string) {
  return `block-${dependencyId}`
}

function clampProgress(progress: number) {
  return Math.min(100, Math.max(0, Number.isFinite(progress) ? progress : 0))
}

function statusFromProgress(
  progress: number,
): Exclude<TaskEntity["status"], "review" | "blocked"> {
  if (progress <= 0) return "todo"
  if (progress >= 100) return "done"
  return "in_progress"
}

function normalizeExecutionState(
  current: Pick<
    TaskEntity,
    "status" | "progress" | "statusBeforeBlocked"
  >,
  patch: Pick<Partial<TaskEntity>, "status" | "progress">,
) {
  let status = patch.status ?? current.status
  let progress =
    patch.progress === undefined
      ? current.progress
      : clampProgress(patch.progress)
  let statusBeforeBlocked = current.statusBeforeBlocked

  if (patch.status && patch.status !== "blocked") {
    statusBeforeBlocked = null
    if (patch.status === "done") progress = 100
    if (patch.status === "todo") progress = 0
    if (patch.status === "review") {
      progress = Math.min(99, Math.max(80, progress))
    }
    if (patch.status === "in_progress" && progress <= 0) progress = 1
    if (patch.status === "in_progress" && progress >= 100) progress = 99
  } else if (
    patch.progress !== undefined &&
    progress !== current.progress
  ) {
    const inferredStatus = statusFromProgress(progress)
    if (current.status === "blocked") {
      status = "blocked"
      statusBeforeBlocked = inferredStatus
    } else {
      status = inferredStatus
      statusBeforeBlocked = null
    }
  }

  return { status, progress, statusBeforeBlocked }
}

function makeDependencyBlockReason(
  dependency: DependencyEntity,
  tasks: Record<string, TaskEntity>,
): BlockReasonEntity {
  const source = tasks[dependency.sourceTaskId]
  return {
    id: dependencyReasonId(dependency.id),
    source: "dependency",
    message: `等待前置任务 ${dependency.sourceTaskId.toUpperCase()}${source ? `「${source.title}」` : ""}完成`,
    relatedTaskId: dependency.sourceTaskId,
    dependencyId: dependency.id,
    createdAt: dependency.createdAt,
  }
}

function addBlockReason<T extends TaskEntity | SubtaskEntity>(
  entity: T,
  reason: BlockReasonEntity,
): T {
  if (entity.blockReasons.some((item) => item.id === reason.id)) return entity
  return {
    ...entity,
    statusBeforeBlocked:
      entity.status === "blocked"
        ? (entity.statusBeforeBlocked ?? "todo")
        : entity.status,
    status: "blocked",
    ...( "done" in entity ? { done: false } : {}),
    blockReasons: [...entity.blockReasons, reason],
  } as T
}

function removeBlockReason<T extends TaskEntity | SubtaskEntity>(
  entity: T,
  reasonId: string,
): T {
  const blockReasons = entity.blockReasons.filter((item) => item.id !== reasonId)
  if (blockReasons.length > 0) return { ...entity, blockReasons } as T
  const restoredStatus = entity.statusBeforeBlocked ?? "todo"
  return {
    ...entity,
    blockReasons,
    status: restoredStatus,
    statusBeforeBlocked: null,
    ...( "done" in entity ? { done: restoredStatus === "done" } : {}),
  } as T
}

function reconcileDependencyBlocks(
  tasks: Record<string, TaskEntity>,
  dependencies: Record<string, DependencyEntity>,
) {
  let next = Object.fromEntries(
    Object.entries(tasks).map(([id, task]) => {
      const manualReasons = task.blockReasons.filter(
        (reason) => reason.source === "manual",
      )
      if (manualReasons.length > 0) {
        return [
          id,
          {
            ...task,
            blockReasons: manualReasons,
            statusBeforeBlocked:
              task.status === "blocked"
                ? (task.statusBeforeBlocked ?? "todo")
                : task.status,
            status: "blocked",
          },
        ]
      }
      const hadDependencyBlock = task.blockReasons.some(
        (reason) => reason.source === "dependency",
      )
      if (hadDependencyBlock || task.status === "blocked") {
        return [
          id,
          {
            ...task,
            blockReasons: [],
            status: task.statusBeforeBlocked ?? "todo",
            statusBeforeBlocked: null,
          },
        ]
      }
      return [id, { ...task, blockReasons: [] }]
    }),
  ) as Record<string, TaskEntity>

  for (let pass = 0; pass <= Object.keys(tasks).length; pass += 1) {
    let changed = false
    Object.values(dependencies).forEach((dependency) => {
      const source = next[dependency.sourceTaskId]
      const target = next[dependency.targetTaskId]
      if (!source || !target || source.status === "done") return
      const reason = makeDependencyBlockReason(dependency, next)
      if (target.blockReasons.some((item) => item.id === reason.id)) return
      next[dependency.targetTaskId] = addBlockReason(target, reason)
      changed = true
    })
    if (!changed) break
  }
  return next
}

function removeEpicSubtrees(
  state: ProjectDataState,
  epicIds: Set<string>,
) {
  const storyIds = new Set(
    Object.values(state.stories)
      .filter((story) => story.epicId && epicIds.has(story.epicId))
      .map((story) => story.id),
  )
  const taskIds = new Set(
    Object.values(state.tasks)
      .filter((task) => storyIds.has(task.storyId))
      .map((task) => task.id),
  )
  const subtaskIds = new Set(
    Object.values(state.subtasks)
      .filter((subtask) => taskIds.has(subtask.taskId))
      .map((subtask) => subtask.id),
  )
  const dependencies = Object.fromEntries(
    Object.entries(state.dependencies).filter(
      ([, dependency]) =>
        !taskIds.has(dependency.sourceTaskId) &&
        !taskIds.has(dependency.targetTaskId),
    ),
  ) as Record<string, DependencyEntity>
  let tasks = Object.fromEntries(
    Object.entries(state.tasks)
      .filter(([id]) => !taskIds.has(id))
      .map(([id, task]) => [
        id,
        {
          ...task,
          blockReasons: task.blockReasons.map((reason) =>
            reason.source === "manual" &&
            reason.relatedTaskId &&
            taskIds.has(reason.relatedTaskId)
              ? { ...reason, relatedTaskId: null }
              : reason,
          ),
        },
      ]),
  ) as Record<string, TaskEntity>
  tasks = reconcileDependencyBlocks(tasks, dependencies)
  const subtasks = Object.fromEntries(
    Object.entries(state.subtasks)
      .filter(([id]) => !subtaskIds.has(id))
      .map(([id, subtask]) => [
        id,
        {
          ...subtask,
          blockReasons: subtask.blockReasons.map((reason) =>
            reason.source === "manual" &&
            reason.relatedTaskId &&
            taskIds.has(reason.relatedTaskId)
              ? { ...reason, relatedTaskId: null }
              : reason,
          ),
        },
      ]),
  ) as Record<string, SubtaskEntity>
  const removedSelection =
    Boolean(state.workspace.selectedObjectId) &&
    (storyIds.has(state.workspace.selectedObjectId!) ||
      taskIds.has(state.workspace.selectedObjectId!) ||
      subtaskIds.has(state.workspace.selectedObjectId!))
  const focusId = state.workspace.focusRequest?.id
  const removedFocus =
    Boolean(focusId) &&
    (storyIds.has(focusId!) || taskIds.has(focusId!) || subtaskIds.has(focusId!))

  return {
    stories: Object.fromEntries(
      Object.entries(state.stories).filter(([id]) => !storyIds.has(id)),
    ) as ProjectDataState["stories"],
    tasks,
    subtasks,
    acceptanceCriteria: Object.fromEntries(
      Object.entries(state.acceptanceCriteria).filter(
        ([, criterion]) => !storyIds.has(criterion.storyId),
      ),
    ) as ProjectDataState["acceptanceCriteria"],
    discussions: Object.fromEntries(
      Object.entries(state.discussions).filter(
        ([, discussion]) =>
          !(
            discussion.targetType === "story" &&
            storyIds.has(discussion.targetId)
          ) &&
          !(
            discussion.targetType === "task" &&
            taskIds.has(discussion.targetId)
          ),
      ),
    ) as ProjectDataState["discussions"],
    risks: Object.fromEntries(
      Object.entries(state.risks).filter(
        ([, risk]) =>
          !(risk.targetType === "story" && storyIds.has(risk.targetId)) &&
          !(risk.targetType === "task" && taskIds.has(risk.targetId)),
      ),
    ) as ProjectDataState["risks"],
    dependencies,
    assets: Object.fromEntries(
      Object.entries(state.assets).map(([assetId, asset]) => [
        assetId,
        {
          ...asset,
          links: asset.links.filter(
            (link) =>
              !(link.targetType === "epic" && epicIds.has(link.targetId)) &&
              !(link.targetType === "story" && storyIds.has(link.targetId)) &&
              !(link.targetType === "task" && taskIds.has(link.targetId)),
          ),
        },
      ]),
    ) as ProjectDataState["assets"],
    workspace: {
      ...state.workspace,
      ...(removedSelection
        ? {
            selectedObjectId: null,
            selectedObjectType: null,
            inspectorOpen: false,
          }
        : {}),
      focusRequest: removedFocus ? null : state.workspace.focusRequest,
      ganttCollapsedIds: state.workspace.ganttCollapsedIds.filter(
        (id) =>
          !epicIds.has(id) &&
          !storyIds.has(id) &&
          !taskIds.has(id) &&
          !subtaskIds.has(id),
      ),
    },
  }
}

function assetTargetExists(
  state: ProjectDataState,
  targetType: AssetLinkTargetType,
  targetId: string,
) {
  if (targetType === "project") return state.project.id === targetId
  if (targetType === "epic") return Boolean(state.epics[targetId])
  if (targetType === "story") return Boolean(state.stories[targetId])
  if (targetType === "sprint") return Boolean(state.sprints[targetId])
  return Boolean(state.tasks[targetId])
}

const memoryStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
}

function normalizeProjectData(
  value?: Partial<ProjectDataState>,
): ProjectDataState {
  const demo = createDemoProjectState()
  const incoming = (value ?? {}) as Partial<ProjectDataState> & {
    assets?: Record<string, unknown>
    sprints?: Record<string, unknown>
    epics?: Record<string, unknown>
    stories?: Record<string, unknown>
    tasks?: Record<string, unknown>
    subtasks?: Record<string, unknown>
    discussions?: Record<string, unknown>
  }
  const refreshDemoContent =
    incoming.project?.id === demo.project.id &&
    ((incoming.schemaVersion ?? 0) < 13 ||
      (incoming.project?.startDate === "2026-08-24" &&
        !incoming.assets?.["asset-class-project-model"]))
  const members = Object.fromEntries(
    Object.entries(incoming.members ?? demo.members).map(([id, value]) => {
      const raw = value as Partial<Member>
      const fallback = demo.members[id]
      return [
        id,
        {
          ...fallback,
          ...raw,
          id,
          name: raw.name ?? fallback?.name ?? "未命名成员",
          initials:
            raw.initials ??
            fallback?.initials ??
            (raw.name ?? "成员").slice(0, 2).toUpperCase(),
          color: raw.color ?? fallback?.color ?? "#475467",
          role: raw.role ?? fallback?.role ?? "项目成员",
          capacityHours: raw.capacityHours ?? fallback?.capacityHours ?? 40,
        } satisfies Member,
      ]
    }),
  )
  const rawAssets = refreshDemoContent
    ? { ...demo.assets, ...(incoming.assets ?? {}) }
    : incoming.assets ?? demo.assets
  const assets = Object.fromEntries(
    Object.entries(rawAssets).map(([id, value]) => {
      const raw = (value ?? {}) as Partial<DesignAssetEntity> & {
        kind?: string
        storyIds?: string[]
        taskIds?: string[]
        epicIds?: string[]
        projectId?: string
      }
      const legacyLinks = [
        ...(raw.projectId
          ? [{ targetType: "project" as const, targetId: raw.projectId }]
          : []),
        ...(raw.epicIds ?? []).map((targetId) => ({
          targetType: "epic" as const,
          targetId,
        })),
        ...(raw.storyIds ?? []).map((targetId) => ({
          targetType: "story" as const,
          targetId,
        })),
        ...(raw.taskIds ?? []).map((targetId) => ({
          targetType: "task" as const,
          targetId,
        })),
      ]
      const rawKind = (raw as { kind?: string }).kind
      const legacyKind =
        rawKind === "file"
          ? raw.name?.toLowerCase().endsWith(".drawio")
            ? "drawio"
            : "attachment"
          : rawKind as DesignAssetEntity["kind"] | undefined
      return [
        id,
        {
          id,
          name: raw.name ?? "未命名资产",
          kind: legacyKind ?? "attachment",
          links: raw.links ?? legacyLinks,
          mimeType:
            raw.mimeType ??
            (legacyKind === "activity" ||
            legacyKind === "use-case" ||
            legacyKind === "sequence" ||
            legacyKind === "class"
              ? "text/mermaid"
              : "application/octet-stream"),
          storage: raw.storage ?? (raw.sourceText ? "inline" : "indexeddb"),
          contentRef: raw.contentRef ?? id,
          sourceText:
            raw.sourceText ??
            (raw.preview?.startsWith("mermaid:")
              ? raw.preview.slice("mermaid:".length)
              : ""),
          umlData: raw.umlData,
          preview: raw.preview ?? "",
          version: raw.version ?? "v1.0",
          sizeBytes: raw.sizeBytes,
          createdAt: raw.createdAt ?? nowIso(),
          updatedAt: raw.updatedAt ?? nowIso(),
        } satisfies DesignAssetEntity,
      ]
    }),
  )
  const rawSprints = incoming.sprints ?? demo.sprints
  const sprints = Object.fromEntries(
    Object.entries(rawSprints).map(([id, value]) => {
      const persisted = (value ?? {}) as Partial<SprintEntity> & {
        retrospective?: SprintEntity["retrospective"] | string
      }
      const fallback = demo.sprints[id]
      const raw = refreshDemoContent && fallback
        ? { ...persisted, startDate: fallback.startDate, endDate: fallback.endDate }
        : persisted
      const rawRetrospective = raw.retrospective
      const retrospective =
        typeof rawRetrospective === "string"
          ? { mainProblem: rawRetrospective, nextImprovement: "" }
          : rawRetrospective ?? fallback?.retrospective ?? {
              mainProblem: "",
              nextImprovement: "",
            }
      return [
        id,
        {
          id,
          name: raw.name ?? fallback?.name ?? "未命名 Sprint",
          goal: raw.goal ?? fallback?.goal ?? "",
          startDate:
            raw.startDate ?? fallback?.startDate ?? demo.project.startDate,
          endDate: raw.endDate ?? fallback?.endDate ?? demo.project.endDate,
          status: raw.status ?? fallback?.status ?? "planning",
          velocity: raw.velocity ?? fallback?.velocity ?? 0,
          capacity: raw.capacity ?? fallback?.capacity ?? 0,
          memberIds:
            raw.memberIds ?? fallback?.memberIds ?? Object.keys(demo.members),
          reviewSummary: raw.reviewSummary ?? "",
          goalAchieved: raw.goalAchieved ?? null,
          retrospective,
          closedAt: raw.closedAt ?? null,
          createdAt: raw.createdAt ?? nowIso(),
          updatedAt: raw.updatedAt ?? nowIso(),
        } satisfies SprintEntity,
      ]
    }),
  )
  const stories = Object.fromEntries(
    Object.entries(incoming.stories ?? demo.stories).map(([id, value]) => {
      const persisted = (value ?? {}) as Partial<StoryEntity>
      const fallback = demo.stories[id]
      const raw = refreshDemoContent && fallback
        ? { ...persisted, startDate: fallback.startDate, dueDate: fallback.dueDate }
        : persisted
      return [
        id,
        {
          ...fallback,
          ...raw,
          id,
          expectedBenefit:
            raw.expectedBenefit ??
            raw.soThat ??
            fallback?.expectedBenefit ??
            "",
          acceptanceLog: raw.acceptanceLog ?? fallback?.acceptanceLog ?? [],
        } as StoryEntity,
      ]
    }),
  )
  const tasks = Object.fromEntries(
    Object.entries(incoming.tasks ?? demo.tasks).map(([id, value]) => {
      const persisted = (value ?? {}) as Partial<TaskEntity> & {
        blockedReason?: string
      }
      const fallback = demo.tasks[id]
      const raw = refreshDemoContent && fallback
        ? { ...persisted, startDate: fallback.startDate, endDate: fallback.endDate }
        : persisted
      const legacyReason = raw.blockedReason?.trim()
      return [
        id,
        {
          ...fallback,
          ...raw,
          id,
          isMilestone: raw.isMilestone ?? fallback?.isMilestone ?? false,
          blockedSeverity:
            raw.blockedSeverity ?? fallback?.blockedSeverity ?? "normal",
          blockReasons:
            raw.blockReasons ??
            (legacyReason
              ? [
                  {
                    id: makeId("block-legacy"),
                    source: "manual",
                    message: legacyReason,
                    relatedTaskId: null,
                    dependencyId: null,
                    createdAt: nowIso(),
                  },
                ]
              : (fallback?.blockReasons ?? [])),
          statusBeforeBlocked:
            raw.statusBeforeBlocked ??
            fallback?.statusBeforeBlocked ??
            (raw.status === "blocked" ? "todo" : null),
          resultSummary: raw.resultSummary ?? fallback?.resultSummary ?? "",
          resultUrl: raw.resultUrl ?? fallback?.resultUrl ?? "",
          resultLinks:
            raw.resultLinks ??
            (raw.resultUrl ? [raw.resultUrl] : fallback?.resultLinks ?? []),
          resultAssetIds:
            raw.resultAssetIds ?? fallback?.resultAssetIds ?? [],
          submittedAt: raw.submittedAt ?? fallback?.submittedAt ?? null,
          qualityStatus:
            raw.qualityStatus ?? fallback?.qualityStatus ?? "pending",
          qualityNote: raw.qualityNote ?? fallback?.qualityNote ?? "",
        } as TaskEntity,
      ]
    }),
  )
  const subtasks = Object.fromEntries(
    Object.entries(incoming.subtasks ?? demo.subtasks).map(([id, value]) => {
      const persisted = (value ?? {}) as Partial<SubtaskEntity> & {
        blockedReason?: string
      }
      const fallback = demo.subtasks[id]
      const raw = refreshDemoContent && fallback
        ? { ...persisted, startDate: fallback.startDate, endDate: fallback.endDate }
        : persisted
      const parent = raw.taskId ? tasks[raw.taskId] : undefined
      const done = raw.done ?? fallback?.done ?? raw.status === "done"
      const legacyReason = raw.blockedReason?.trim()
      return [
        id,
        {
          ...fallback,
          ...raw,
          id,
          done,
          status: raw.status ?? (done ? "done" : "todo"),
          estimate: raw.estimate ?? fallback?.estimate ?? 1,
          progress: raw.progress ?? (done ? 100 : 0),
          startDate:
            raw.startDate ??
            fallback?.startDate ??
            parent?.startDate ??
            demo.project.startDate,
          endDate:
            raw.endDate ??
            fallback?.endDate ??
            parent?.endDate ??
            demo.project.endDate,
          blockReasons:
            raw.blockReasons ??
            (legacyReason
              ? [
                  {
                    id: makeId("block-legacy"),
                    source: "manual",
                    message: legacyReason,
                    relatedTaskId: null,
                    dependencyId: null,
                    createdAt: nowIso(),
                  },
                ]
              : (fallback?.blockReasons ?? [])),
          statusBeforeBlocked:
            raw.statusBeforeBlocked ??
            fallback?.statusBeforeBlocked ??
            (raw.status === "blocked" ? "todo" : null),
          resultSummary: raw.resultSummary ?? "",
          resultUrl: raw.resultUrl ?? "",
          resultLinks:
            raw.resultLinks ?? (raw.resultUrl ? [raw.resultUrl] : []),
          resultAssetIds: raw.resultAssetIds ?? [],
          submittedAt: raw.submittedAt ?? null,
          blockedSeverity:
            raw.blockedSeverity ?? fallback?.blockedSeverity ?? "normal",
          qualityStatus:
            raw.qualityStatus ?? fallback?.qualityStatus ?? "pending",
          qualityNote: raw.qualityNote ?? fallback?.qualityNote ?? "",
        } as SubtaskEntity,
      ]
    }),
  )
  const dependencies = incoming.dependencies ?? demo.dependencies
  const project = {
    ...demo.project,
    ...(incoming.project ?? {}),
    ...(refreshDemoContent
      ? { startDate: demo.project.startDate, endDate: demo.project.endDate }
      : {}),
  }
  const discussions = Object.fromEntries(
    Object.entries(incoming.discussions ?? demo.discussions).map(([id, value]) => {
      const raw = (value ?? {}) as Partial<DiscussionMessageEntity> & {
        storyId?: string
      }
      const targetType = raw.targetType ?? (raw.storyId ? "story" : "project")
      const targetId =
        raw.targetId ?? raw.storyId ?? project.id
      return [
        id,
        {
          id,
          targetType,
          targetId,
          ...(targetType === "story" ? { storyId: targetId } : {}),
          authorId: raw.authorId ?? "m1",
          content: raw.content ?? "",
          createdAt: raw.createdAt ?? nowIso(),
          isAI: false,
        } satisfies DiscussionMessageEntity,
      ]
    }),
  )
  const normalizedTasks = Object.fromEntries(
    Object.entries(tasks).map(([id, task]) => {
      const children = Object.values(subtasks).filter(
        (subtask) => subtask.taskId === id,
      )
      if (!children.length) return [id, task]
      return [
        id,
        {
          ...task,
          startDate: [
            task.startDate,
            ...children.map((child) => child.startDate),
          ].sort()[0],
          endDate: [
            task.endDate,
            ...children.map((child) => child.endDate),
          ].sort().at(-1)!,
        },
      ]
    }),
  ) as Record<string, TaskEntity>
  const normalizedStories = Object.fromEntries(
    Object.entries(stories).map(([id, story]) => {
      const children = Object.values(normalizedTasks).filter(
        (task) => task.storyId === id,
      )
      if (!children.length) return [id, story]
      return [
        id,
        {
          ...story,
          startDate: [
            story.startDate,
            ...children.map((child) => child.startDate),
          ].sort()[0],
          dueDate: [
            story.dueDate,
            ...children.map((child) => child.endDate),
          ].sort().at(-1)!,
        },
      ]
    }),
  ) as Record<string, StoryEntity>
  const rawEpics = incoming.epics ?? demo.epics
  const reconciledTasks = reconcileDependencyBlocks(normalizedTasks, dependencies)
  const derivedStories = deriveAllStoryDeliveries({
    stories: normalizedStories,
    tasks: reconciledTasks,
    subtasks,
  }).stories
  const epics = Object.fromEntries(
    Object.entries(rawEpics).map(([id, value]) => {
      const persisted = (value ?? {}) as Partial<EpicEntity>
      const fallback = demo.epics[id]
      const raw = refreshDemoContent && fallback
        ? { ...persisted, startDate: fallback.startDate, endDate: fallback.endDate }
        : persisted
      const children = Object.values(derivedStories).filter(
        (story) => story.epicId === id,
      )
      const fallbackStart =
        raw.startDate ?? fallback?.startDate ?? project.startDate
      const fallbackEnd = raw.endDate ?? fallback?.endDate ?? project.endDate
      return [
        id,
        {
          ...fallback,
          ...raw,
          id,
          title: raw.title ?? fallback?.title ?? "未命名 Epic",
          userTaskId: raw.userTaskId ?? fallback?.userTaskId ?? "",
          startDate: children.length
            ? [fallbackStart, ...children.map((child) => child.startDate)].sort()[0]
            : fallbackStart,
          endDate: children.length
            ? [fallbackEnd, ...children.map((child) => child.dueDate)].sort().at(-1)!
            : fallbackEnd,
          order: raw.order ?? fallback?.order ?? 0,
        } satisfies EpicEntity,
      ]
    }),
  )
  return {
    ...demo,
    ...incoming,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    project,
    members,
    assets,
    sprints,
    epics,
    stories: derivedStories,
    tasks: reconciledTasks,
    subtasks,
    dependencies,
    risks: incoming.risks ?? demo.risks,
    impactAnalyses: incoming.impactAnalyses ?? demo.impactAnalyses,
    sprintPulses: incoming.sprintPulses ?? demo.sprintPulses,
    discussions,
    proposals: Object.fromEntries(Object.entries(incoming.proposals ?? {}).map(([id, proposal]) => [id,
      proposal.status === "applying" ? { ...proposal,
        status: proposal.actions.some(action => action.status === "applied") ? "partially_applied" : "failed",
        applyError: "上次执行被中断；请检查各项结果后重试，已成功动作不会重复执行。",
      } : proposal,
    ])),
    projectEvents: incoming.projectEvents ?? {},
    meetingSessions: incoming.meetingSessions ?? {},
    meetingMessages: incoming.meetingMessages ?? {},
    workspace: {
      ...demo.workspace,
      ...(incoming.workspace ?? {}),
      currentPage:
        incoming.workspace?.currentPage === "chat" || incoming.workspace?.currentPage === "release"
          ? "overview"
          : incoming.workspace?.currentPage ?? demo.workspace.currentPage,
      ...(refreshDemoContent
        ? {
            ganttRangeStart: demo.workspace.ganttRangeStart,
            ganttRangeEnd: demo.workspace.ganttRangeEnd,
          }
        : {}),
    },
  }
}

const initialDemoState = normalizeProjectData(createDemoProjectState())
const executingProposals = new Set<string>()

function createInitialProjectState() {
  return structuredClone(initialDemoState)
}

function proposalEntity(state: ProjectDataState, type: ProposalAction["targetType"], id: string): unknown {
  switch (type) {
    case "project": return state.project.id === id ? state.project : undefined
    case "sprint": return state.sprints[id]
    case "story": return state.stories[id]
    case "task": return state.tasks[id]
    case "subtask": return state.subtasks[id]
    case "member": return state.members[id]
    case "dependency": return state.dependencies[id]
    case "risk": return state.risks[id]
  }
}

function staleReason(state: ProjectDataState, action: ProposalAction, appliedActions: ProposalAction[] = []): string | null {
  for (const condition of action.preconditions) {
    if (condition.field === "eventBasis") {
      const error = eventConditionError(state, condition)
      if (error) return error
      continue
    }
    const entity = proposalEntity(state, condition.targetType, condition.targetId)
    if (!entity || typeof entity !== "object") return `${condition.targetType} ${condition.targetId} 已不存在`
    const current = condition.targetType === "story" && condition.field === "acceptanceCriteriaContents"
      ? state.stories[condition.targetId].acceptanceCriteriaIds.map((id) => state.acceptanceCriteria[id]?.content ?? null)
      : condition.targetType === "story" && condition.field === "openRiskIds"
        ? Object.values(state.risks).filter((risk) => risk.targetType === "story" && risk.targetId === condition.targetId && risk.status !== "resolved").map((risk) => risk.id).sort()
      : condition.targetType === "story" && condition.field === "taskIds"
        ? (entity as StoryEntity).taskIds.filter((id) => !appliedActions.some((applied) => applied.actionType === "CREATE_TASK" && applied.status === "applied" && applied.targetId === condition.targetId && applied.resultTargetId === id))
      : (entity as Record<string, unknown>)[condition.field]
    if (JSON.stringify(current) !== JSON.stringify(condition.expectedValue)) {
      // 重试时目标字段可能已经达到该动作要求的值，不再次写入。
      if (["UPDATE_TASK", "UPDATE_SUBTASK", "UPDATE_STORY", "UPDATE_RISK", "UPDATE_DEADLINE", "CHANGE_ASSIGNEE", "CHANGE_PRIORITY"].includes(action.actionType) &&
        condition.targetType === action.targetType && condition.targetId === action.targetId && condition.field in action.proposedValue &&
        JSON.stringify(current) === JSON.stringify(action.proposedValue[condition.field])) continue
      if (condition.field === "openRiskIds" && existingProposalResult(state, action)) continue
      if (action.actionType === "BLOCK_TASK" && condition.targetId === action.targetId && condition.field === "status" && existingProposalResult(state, action)) continue
      return `${condition.targetType} ${condition.targetId}.${condition.field} 已变化，请重新分析确认`
    }
  }
  return null
}

function validateProposalValue(state: ProjectDataState, action: ProposalAction): string | null {
  const value = action.proposedValue
  const expectedTarget: Record<ProposalAction["actionType"], ProposalAction["targetType"] | "risk_target" | "any"> = {
    CREATE_TASK: "story", CREATE_SUBTASK: "task", UPDATE_TASK: "task",
    UPDATE_SUBTASK: "subtask", UPDATE_STORY: "story", CREATE_RISK: "risk_target",
    UPDATE_RISK: "risk", ADD_DEPENDENCY: "dependency",
    CREATE_DISCUSSION: "any", BLOCK_TASK: "task", REMOVE_DEPENDENCY: "dependency",
    UPDATE_DEADLINE: "task", CHANGE_ASSIGNEE: "task", CHANGE_PRIORITY: "story",
  }
  if (!action.preconditions.length) return "Action 缺少执行前置条件"
  const target = expectedTarget[action.actionType]
  if (target !== "any" && (target === "risk_target" ? !["story", "task", "sprint"].includes(action.targetType) : action.targetType !== target)) return "Action 目标类型无效"
  const allowed: Record<ProposalAction["actionType"], string[]> = {
    CREATE_TASK: ["title", "type", "estimate", "assigneeId", "startDate", "endDate", "storyId"],
    CREATE_SUBTASK: ["title", "estimate", "assigneeId", "taskId"],
    UPDATE_TASK: ["title", "type", "estimate", "assigneeId", "startDate", "endDate", "status", "progress"],
    UPDATE_SUBTASK: ["title", "estimate", "assigneeId", "startDate", "endDate", "status", "progress"],
    UPDATE_STORY: ["risk", "riskNote", "assigneeId", "title", "priority", "dueDate", "storyPoints"],
    CREATE_RISK: ["title", "targetType", "targetId", "level", "description", "impact", "mitigation", "ownerId", "status"],
    UPDATE_RISK: ["title", "level", "description", "impact", "mitigation", "ownerId", "status"],
    ADD_DEPENDENCY: ["sourceTaskId", "targetTaskId"],
    CREATE_DISCUSSION: ["content", "targetType", "targetId"],
    BLOCK_TASK: ["taskId", "message", "relatedTaskId"],
    REMOVE_DEPENDENCY: ["dependencyId"],
    UPDATE_DEADLINE: ["endDate"],
    CHANGE_ASSIGNEE: ["assigneeId"],
    CHANGE_PRIORITY: ["priority"],
  }
  if (!Object.keys(value).length || Object.keys(value).some((field) => !allowed[action.actionType].includes(field))) return "建议包含不允许修改的字段"
  const required: Partial<Record<ProposalAction["actionType"], string[]>> = {
    CREATE_TASK: ["title", "type", "estimate", "assigneeId", "startDate", "endDate"],
    CREATE_SUBTASK: ["title", "estimate", "assigneeId"],
    CREATE_RISK: ["title", "targetType", "targetId", "level", "description", "impact", "mitigation", "ownerId", "status"],
    ADD_DEPENDENCY: ["sourceTaskId", "targetTaskId"],
    CREATE_DISCUSSION: ["content"],
    BLOCK_TASK: ["taskId"],
    REMOVE_DEPENDENCY: ["dependencyId"],
    UPDATE_DEADLINE: ["endDate"],
    CHANGE_ASSIGNEE: ["assigneeId"],
    CHANGE_PRIORITY: ["priority"],
  }
  if (required[action.actionType]?.some((field) => !(field in value))) return "建议缺少必填字段"
  if ("title" in value && (typeof value.title !== "string" || !value.title.trim())) return "标题不能为空"
  if ("estimate" in value && (typeof value.estimate !== "number" || !Number.isFinite(value.estimate) || value.estimate < 0 || value.estimate > 1000)) return "预计工时须为 0 至 1000 小时"
  if ("assigneeId" in value && (typeof value.assigneeId !== "string" || !state.members[value.assigneeId])) return "负责人不存在"
  if ("ownerId" in value && (typeof value.ownerId !== "string" || !state.members[value.ownerId])) return "风险负责人不存在"
  if ("type" in value && !["frontend", "backend", "database", "test", "design", "devops"].includes(String(value.type))) return "任务类型无效"
  if ("risk" in value && !["none", "low", "medium", "high"].includes(String(value.risk))) return "风险级别无效"
  if ("level" in value && !["low", "medium", "high"].includes(String(value.level))) return "风险级别无效"
  if ("status" in value && (action.actionType === "CREATE_RISK" || action.actionType === "UPDATE_RISK") && !["open", "mitigating", "resolved"].includes(String(value.status))) return "风险状态无效"
  if (action.actionType === "ADD_DEPENDENCY" && (typeof value.sourceTaskId !== "string" || typeof value.targetTaskId !== "string")) return "依赖任务 ID 无效"
  for (const field of ["startDate", "endDate", "riskNote", "description", "impact", "mitigation"] as const) {
    if (field in value && typeof value[field] !== "string") return `${field} 格式无效`
  }
  if ("startDate" in value && "endDate" in value && String(value.endDate) < String(value.startDate)) return "结束日期不能早于开始日期"
  if (action.actionType === "CREATE_RISK" && (value.targetType !== action.targetType || value.targetId !== action.targetId || !["story", "task", "sprint"].includes(String(value.targetType)))) return "风险目标无效"
  if (action.actionType === "CREATE_DISCUSSION" && (typeof value.content !== "string" || !value.content.trim() ||
    value.targetType !== undefined && value.targetType !== action.targetType || value.targetId !== undefined && value.targetId !== action.targetId)) return "讨论内容或目标无效"
  if (action.actionType === "BLOCK_TASK" && (value.taskId !== action.targetId || !state.tasks[action.targetId])) return "阻塞目标无效"
  return null
}

function existingProposalResult(state: ProjectDataState, action: ProposalAction, resolvedIds: Record<string, string> = {}): string | null {
  const value = action.proposedValue
  const matches = (entity: object, fields: string[]) => fields.every(field => !(field in value) || JSON.stringify((entity as Record<string, unknown>)[field]) === JSON.stringify(value[field]))
  switch (action.actionType) {
    case "CREATE_RISK": return Object.values(state.risks).find(risk => risk.status !== "resolved" && risk.targetType === value.targetType && risk.targetId === value.targetId && risk.title === value.title)?.id ?? null
    case "CREATE_DISCUSSION": return Object.values(state.discussions).find(item => item.targetType === (value.targetType ?? action.targetType) && item.targetId === (value.targetId ?? action.targetId) && item.content === value.content)?.id ?? null
    case "CREATE_TASK": return Object.values(state.tasks).find(task => task.storyId === action.targetId && matches(task, ["title", "type", "assigneeId", "estimate", "startDate", "endDate"]))?.id ?? null
    case "CREATE_SUBTASK": return Object.values(state.subtasks).find(step => step.taskId === (resolvedIds[action.targetId] ?? action.targetId) && matches(step, ["title", "assigneeId", "estimate"]))?.id ?? null
    case "ADD_DEPENDENCY": return Object.values(state.dependencies).find(dep => dep.sourceTaskId === (resolvedIds[String(value.sourceTaskId)] ?? value.sourceTaskId) && dep.targetTaskId === (resolvedIds[String(value.targetTaskId)] ?? value.targetTaskId))?.id ?? null
    case "BLOCK_TASK": return state.tasks[action.targetId]?.blockReasons.some(reason => reason.message === value.message && reason.relatedTaskId === (value.relatedTaskId ?? null)) ? action.targetId : null
    case "UPDATE_TASK": case "UPDATE_SUBTASK": case "UPDATE_STORY": case "UPDATE_RISK":
    case "UPDATE_DEADLINE": case "CHANGE_ASSIGNEE": case "CHANGE_PRIORITY": {
      const entity = proposalEntity(state, action.targetType, action.targetId)
      return entity && matches(entity as object, Object.keys(value)) ? action.targetId : null
    }
    default: return null
  }
}

function executeProposalAction(store: ProjectStore, action: ProposalAction, resolvedIds: Record<string, string>): { ok: boolean; message: string; id: string | null; existing?: boolean } {
  const existing = existingProposalResult(store, action, resolvedIds)
  if (existing) return { ok: true, message: "处理结果已存在，未重复写入", id: existing, existing: true }
  const value = action.proposedValue
  const patch = value as Record<string, never>
  switch (action.actionType) {
    case "CREATE_TASK": {
      const created = store.createTask(action.targetId, value as Partial<TaskEntity>)
      return { ok: true, message: "Task 已创建", id: created.id }
    }
    case "CREATE_SUBTASK": {
      const parentId = resolvedIds[action.targetId] ?? (store.tasks[action.targetId] ? action.targetId : undefined)
      if (!parentId) return { ok: false, message: "父 Task 未创建", id: null }
      const created = store.addSubtask(parentId, String(value.title))
      const updated = store.updateSubtask(created.id, { estimate: Number(value.estimate), assigneeId: String(value.assigneeId) }, "agent")
      return { ...updated, id: created.id }
    }
    case "UPDATE_TASK": return { ...store.updateTask(action.targetId, patch as Partial<TaskEntity>, "agent"), id: action.targetId }
    case "UPDATE_SUBTASK": return { ...store.updateSubtask(action.targetId, patch as Partial<SubtaskEntity>, "agent"), id: action.targetId }
    case "UPDATE_STORY": return { ...store.updateStory(action.targetId, patch as Partial<StoryEntity>, "agent"), id: action.targetId }
    case "CREATE_RISK": {
      const created = store.createRisk(value as unknown as Omit<RiskEntity, "id" | "createdAt" | "updatedAt">)
      return { ok: true, message: "Risk 已创建", id: created.id }
    }
    case "UPDATE_RISK": return { ...store.updateRisk(action.targetId, patch as Partial<RiskEntity>), id: action.targetId }
    case "ADD_DEPENDENCY": {
      const source = resolvedIds[String(value.sourceTaskId)] ?? String(value.sourceTaskId)
      const target = resolvedIds[String(value.targetTaskId)] ?? String(value.targetTaskId)
      const result = store.addDependency(source, target)
      const found = Object.values(useProjectStore.getState().dependencies).find((item) => item.sourceTaskId === source && item.targetTaskId === target)
      return { ...result, id: found?.id ?? null }
    }
    case "CREATE_DISCUSSION": {
      const targetType = (typeof value.targetType === "string" &&
        (value.targetType === "story" || value.targetType === "task")
        ? value.targetType
        : (action.targetType === "story" || action.targetType === "task"
          ? action.targetType
          : "project")) as DiscussionMessageEntity["targetType"]
      const targetId = typeof value.targetId === "string" && value.targetId
        ? value.targetId
        : action.targetId
      const result = store.addDiscussion(
        targetType,
        targetId,
        typeof value.content === "string" && value.content ? value.content : action.reason,
      )
      const created = Object.values(useProjectStore.getState().discussions).find(item => item.targetType === targetType && item.targetId === targetId && item.content === value.content)
      return { ...result, id: created?.id ?? null }
    }
    case "BLOCK_TASK": {
      const taskId = typeof value.taskId === "string" && value.taskId ? value.taskId : action.targetId
      const result = store.addTaskBlockReason(
        taskId,
        typeof value.message === "string" && value.message ? value.message : action.reason,
        typeof value.relatedTaskId === "string" ? value.relatedTaskId : null,
      )
      return { ...result, id: taskId }
    }
    case "REMOVE_DEPENDENCY": {
      const dependencyId = typeof value.dependencyId === "string" && value.dependencyId
        ? value.dependencyId
        : action.targetId
      const result = store.deleteDependency(dependencyId)
      return { ...result, id: dependencyId }
    }
    case "UPDATE_DEADLINE":
    case "CHANGE_ASSIGNEE":
      return executeProposalAction(store, { ...action, actionType: "UPDATE_TASK" }, resolvedIds)
    case "CHANGE_PRIORITY":
      return executeProposalAction(store, { ...action, actionType: "UPDATE_STORY" }, resolvedIds)
  }
}

export interface ProposalActionInput {
  actionType: ProposalActionType
  targetType: ProposalTargetType
  targetId: string
  proposedValue: Record<string, unknown>
  reason: string
  beforeValue?: unknown
  preconditions?: ProposalPrecondition[]
  dependsOnActionIds?: string[]
}

export interface CreateProposalInput {
  origin: ProposalOrigin
  triggerType: ProposalTriggerType
  agentType: AgentType
  targetType: ProposalTargetType
  targetId: string
  summary: string
  reasoning: string
  evidence: ProposalEvidence[]
  actions: ProposalActionInput[]
}

export const PROPOSAL_SCHEMA_VERSION = 1

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      ...createInitialProjectState(),

      refreshProjectEvents: (now = new Date()) => {
        const state = get()
        const projectEvents = reconcileProjectEvents(state, now)
        if (projectEvents !== state.projectEvents) set({ projectEvents })
      },
      ignoreProjectEvent: (id) => {
        const record = get().projectEvents[id]
        if (record) set(state => ({ projectEvents: { ...state.projectEvents, [id]: { ...record, status: "ignored", updatedAt: nowIso() } } }))
      },

      createMeeting: (targetType, targetId) => {
        const state = get()
        const story = targetType === "story" ? state.stories[targetId] : null
        const sprint = targetType === "sprint" ? state.sprints[targetId] : null
        const project = targetType === "project" && state.project.id === targetId ? state.project : null
        if (!story && !sprint && !project) throw new Error("会议目标不存在")
        const participantIds = [...new Set([
          state.workspace.currentUserId,
          ...(story ? [story.assigneeId, ...story.collaboratorIds] : sprint?.memberIds ?? []),
          ...Object.keys(state.members),
        ])].filter((id) => Boolean(state.members[id])).slice(0, 4)
        const id = makeId("meeting")
        const targetName = story?.title ?? sprint?.name ?? project!.name
        const title = targetType === "project" ? "AI 项目协作会议" : `${targetType === "story" ? "Story 规划" : "Sprint 规划"}会议`
        const session: MeetingSession = {
          id, projectId: state.project.id, targetType, targetId, title,
          status: "active", participantIds, createdBy: state.workspace.currentUserId,
           createdAt: nowIso(), endedAt: null, messageIds: [], proposalIds: [], topics: [], facts: [],
          memory: {
            ...createMeetingMemory(),
            focusStoryIds: story ? [story.id] : [],
            focusSprintId: sprint?.id ?? story?.sprintId ?? null,
          },
        }
        synchronizeWorkingState(session.memory!, state, session)
        const existingTasks = story ? story.taskIds.length : Object.values(state.tasks).filter((task) => state.stories[task.storyId]?.sprintId === targetId).length
        const sprintName = story?.sprintId ? state.sprints[story.sprintId]?.name : sprint?.name
        const currentSprint = buildProjectAnalysisSnapshot(state, session, session.memory!).activeSprint
        const openRisks = Object.values(state.risks).filter((risk) => risk.status !== "resolved").length
        const unfinished = Object.values(state.tasks).filter((task) => task.status !== "done").length
        const welcome: MeetingMessage = {
          id: makeId("meeting-message"), meetingId: id, senderType: "agent",
          senderId: "project_orchestrator", createdAt: nowIso(),
          content: project
            ? `项目会议已创建。目前${currentSprint ? currentSprint.effectiveStatus === "overdue" ? `${currentSprint.name} 在项目中仍标为进行中，但计划期已过` : `${currentSprint.name} 正在${currentSprint.status === "active" ? "进行" : "规划"}` : "没有进行中的 Sprint"}，项目共有 ${Object.keys(state.stories).length} 个 Story、${unfinished} 个未完成任务和 ${openRisks} 项未解决风险。可以讨论整个项目，也可以 @成员、@专业助手，或用 # 引用具体工作。`
            : `会议已创建。我们正在讨论${targetType === "story" ? ` ${story!.id.toUpperCase()}「${targetName}」` : `「${targetName}」`}。${sprintName ? `它属于 ${sprintName}，` : ""}目前有 ${existingTasks} 个任务。你可以直接提问，也可以输入 @ 让专业助手一起分析。`,
        }
        session.messageIds.push(welcome.id)
        set((current) => ({
          meetingSessions: { ...current.meetingSessions, [id]: session },
          meetingMessages: { ...current.meetingMessages, [welcome.id]: welcome },
        }))
        return session
      },

      addMeetingMessage: (meetingId, input) => {
        const session = get().meetingSessions[meetingId]
        if (!session || session.status !== "active") throw new Error("会议已结束，请发起新会议")
        if (!input.content.trim()) throw new Error("消息不能为空")
        const message: MeetingMessage = {
          ...input, id: makeId("meeting-message"), meetingId,
          content: input.content.trim(), createdAt: nowIso(),
        }
         const fact = meetingFactFromMessage(get(), message)
         set((state) => ({
           meetingMessages: { ...state.meetingMessages, [message.id]: message },
           meetingSessions: { ...state.meetingSessions, [meetingId]: {
             ...state.meetingSessions[meetingId],
             messageIds: [...state.meetingSessions[meetingId].messageIds, message.id],
             facts: fact ? [ ...(state.meetingSessions[meetingId].facts ?? []).map((previous) =>
               fact.type === "fact" && fact.status === "confirmed" && previous.type === "hypothesis" &&
               previous.relatedEntityIds.some((id) => fact.relatedEntityIds.includes(id))
                 ? { ...previous, status: "confirmed" as const } : previous), fact] : state.meetingSessions[meetingId].facts,
             topics: fact ? topicFromMeetingFact(state.meetingSessions[meetingId], fact) : state.meetingSessions[meetingId].topics,
           } },
        }))
        return message
      },

      setMeetingPresentation: (meetingId, patch) => {
        set(state => ({ meetingSessions: { ...state.meetingSessions, [meetingId]: { ...state.meetingSessions[meetingId], ...patch } } }))
      },

      endMeeting: (meetingId) => {
         const session = get().meetingSessions[meetingId]
         if (!session || session.status === "ended") return { ok: false, message: "会议已结束或不存在" }
         const ended = { ...session, status: "ended" as const, endedAt: nowIso(),
           topics: session.topics?.map((topic) => topic.status === "active" ? { ...topic, status: "recorded" as const } : topic) }
         set((state) => ({ meetingSessions: { ...state.meetingSessions, [meetingId]: {
           ...ended, minutes: generateMeetingMinutes(state, ended),
         } } }))
        return { ok: true, message: "会议已结束，记录已保存" }
      },

      linkMeetingProposal: (meetingId, proposalId) => {
        const session = get().meetingSessions[meetingId]
        const proposal = get().proposals[proposalId]
        if (!session || !proposal || session.projectId !== proposal.projectId) return { ok: false, message: "会议或建议不存在" }
        if (session.proposalIds.includes(proposalId)) return { ok: true, message: "建议已关联会议" }
        set((state) => ({ meetingSessions: { ...state.meetingSessions, [meetingId]: {
          ...session, proposalIds: [...session.proposalIds, proposalId],
        } } }))
        return { ok: true, message: "建议已加入会议" }
      },

      setMeetingMemory: (meetingId, memory) => {
        synchronizeWorkingState(memory)
        const session = get().meetingSessions[meetingId]
        if (!session || session.status !== "active") return { ok: false, message: "会议已结束或不存在" }
         const source = [...session.messageIds].reverse().map((id) => get().meetingMessages[id]).find((item) => item?.senderType === "user")
         set((state) => ({ meetingSessions: { ...state.meetingSessions, [meetingId]: {
           ...session, memory: structuredClone(memory),
           topics: source ? recordMeetingTopic(session, source, memory) : session.topics,
         } } }))
        return { ok: true, message: "会议决策已保存" }
      },

      recordMeetingQaTrace: (meetingId, trace) => {
        const session = get().meetingSessions[meetingId]
        if (!session) return { ok: false, message: "会议不存在" }
        set((state) => ({ meetingSessions: { ...state.meetingSessions, [meetingId]: {
          ...session, qaTrace: [...(session.qaTrace ?? []), structuredClone(trace)],
        } } }))
        return { ok: true, message: "会议质量轨迹已记录" }
      },

      saveProposal: (proposal) => {
        if (proposal.projectId !== get().project.id || get().proposals[proposal.id]) return { ok: false, message: "Proposal 项目不匹配或已存在" }
        if (proposal.schemaVersion !== 1 || !proposal.id || new Set(proposal.actions.map((item) => item.id)).size !== proposal.actions.length) return { ok: false, message: "Proposal 协议无效" }
        set((state) => ({ proposals: { ...state.proposals, [proposal.id]: structuredClone(proposal) } }))
        return { ok: true, message: "Proposal 已保存" }
      },

      setProposalDecision: (proposalId, actionId, decision) => {
        const proposal = get().proposals[proposalId]
        if (!proposal || !["draft", "reviewed"].includes(proposal.status)) return { ok: false, message: "Proposal 不可审核" }
        const target = proposal.actions.find((action) => action.id === actionId)
        if (!target || target.status !== "pending") return { ok: false, message: "Action 不可审核" }
        const actions = proposal.actions.map((item) => item.id === actionId ? { ...item, decision } : item)
        const reviewed = actions.every((item) => item.decision !== "pending")
         set((state) => ({ proposals: { ...state.proposals, [proposalId]: {
           ...proposal, actions, reviewedActions: structuredClone(actions), status: reviewed ? "reviewed" : "draft", updatedAt: nowIso(),
           reviewedBy: reviewed ? state.workspace.currentUserId : proposal.reviewedBy,
           reviewedAt: reviewed ? nowIso() : proposal.reviewedAt,
         } } }))
         set((state) => ({ meetingSessions: refreshedEndedMeetingMinutes(state, proposalId) }))
        return { ok: true, message: "审核决策已保存" }
      },

      updateProposalValue: (proposalId, actionId, value) => {
        const proposal = get().proposals[proposalId]
        if (!proposal || !["draft", "reviewed"].includes(proposal.status)) return { ok: false, message: "Proposal 不可修改" }
        const target = proposal.actions.find((action) => action.id === actionId)
        if (!target || target.status !== "pending") return { ok: false, message: "Action 不可修改" }
        const next = { ...target, proposedValue: structuredClone(value) }
        const invalid = validateProposalValue(get(), next)
        if (invalid) return { ok: false, message: invalid }
         set((state) => ({ proposals: { ...state.proposals, [proposalId]: {
           ...proposal, actions: proposal.actions.map((item) => item.id === actionId ? next : item),
           reviewedActions: structuredClone(proposal.actions.map((item) => item.id === actionId ? next : item)), updatedAt: nowIso(),
         } } }))
         set((state) => ({ meetingSessions: refreshedEndedMeetingMinutes(state, proposalId) }))
        return { ok: true, message: "人工修改已保存" }
      },

      rejectProposal: (proposalId, note = "") => {
        const proposal = get().proposals[proposalId]
        if (!proposal || !["draft", "reviewed"].includes(proposal.status)) return { ok: false, message: "Proposal 不可驳回" }
         set((state) => ({ proposals: { ...state.proposals, [proposalId]: {
           ...proposal, actions: proposal.actions.map((action) => ({ ...action, decision: "rejected" as const })),
           reviewedActions: proposal.actions.map((action) => ({ ...action, decision: "rejected" as const })),
           status: "rejected", reviewNote: note, reviewedBy: state.workspace.currentUserId,
           reviewedAt: nowIso(), updatedAt: nowIso(),
         } } }))
         set((state) => ({ meetingSessions: refreshedEndedMeetingMinutes(state, proposalId) }))
        return { ok: true, message: "Proposal 已驳回" }
      },

      applyProposal: (proposalId, note = "") => {
        if (executingProposals.has(proposalId)) return { ok: false, message: "建议正在执行，请稍候" }
        const proposal = get().proposals[proposalId]
        if (proposal?.status === "applied") return { ok: true, message: "建议已处理，未重复写入" }
        if (!proposal || !["draft", "reviewed", "failed", "partially_applied", "applying"].includes(proposal.status)) return { ok: false, message: "Proposal 不可执行" }
        if (proposal.projectId !== get().project.id) return { ok: false, message: "Proposal 不属于当前项目" }
        const owningMeeting = Object.values(get().meetingSessions).find((session) => session.proposalIds.includes(proposalId))
        if (proposal.constraintsSnapshot || proposal.agentType === "plan_execution" && owningMeeting) {
          const finalReview = revalidateReviewedProposal(get(), proposal, owningMeeting)
          if (!finalReview.valid) {
            const actions=proposal.actions.map(action=>{
              const stale=action.decision==='accepted'?staleReason(get(),action):null
              return stale?{...action,status:'stale' as const,error:stale}:action
            })
            if(actions.some(action=>action.status==='stale')) set(state=>({proposals:{...state.proposals,[proposalId]:{...proposal,actions,status:'failed',applyError:finalReview.errors.join('；')}}}))
            return { ok: false, message: `最终计划未通过校验：${finalReview.errors.join("；")}` }
          }
        }
        const accepted = proposal.actions.filter((action) => action.decision === "accepted" && action.status !== "applied")
        if (!accepted.length) return { ok: false, message: "请先采纳至少一条 Action" }
        // 先检查所有待执行动作，再按已有依赖顺序逐项执行；每项写回前再次检查。
        const preflight = new Map(accepted.map(action => [action.id, {
          stale: action.status === "stale" ? action.error ?? "建议已失效，请重新分析" : staleReason(get(), action, proposal.actions),
          invalid: validateProposalValue(get(), action),
        }]))
        const started: AgentProposal = {
          ...proposal, status: "applying", reviewedBy: get().workspace.currentUserId,
          reviewedAt: proposal.reviewedAt ?? nowIso(), reviewNote: note,
          updatedAt: nowIso(),
        }
        executingProposals.add(proposalId)
        try {
        set((state) => ({ proposals: { ...state.proposals, [proposalId]: started } }))
        const results = structuredClone(started.actions)
        const pending = results.filter((item) => item.decision === "accepted" && item.status !== "applied")
        while (pending.length) {
          const readyIndex = pending.findIndex((item) => item.dependsOnActionIds.every((id) => !pending.some((candidate) => candidate.id === id)))
          if (readyIndex < 0) {
            for (const item of pending) {
              item.status = "failed"
              item.error = "Action 依赖存在循环"
            }
            set((state) => ({ proposals: { ...state.proposals, [proposalId]: {
              ...state.proposals[proposalId], actions: structuredClone(results), updatedAt: nowIso(),
            } } }))
            break
          }
          const [item] = pending.splice(readyIndex, 1)
          const dependencies = item.dependsOnActionIds.map((id) => results.find((candidate) => candidate.id === id))
          const failedDependency = dependencies.find((candidate) => !candidate || candidate.status !== "applied")
          if (dependencies.some(candidate => !candidate || candidate.status !== "applied")) {
            item.status = "failed"
              item.error = `已跳过：依赖 Action ${failedDependency?.id ?? "不存在"} 未成功执行`
          } else {
            const stale = preflight.get(item.id)?.stale ?? staleReason(get(), item, results)
            if (stale) {
              item.status = "stale"
              item.error = stale
            } else {
              const invalid = preflight.get(item.id)?.invalid ?? validateProposalValue(get(), item)
              if (invalid) {
                item.status = "failed"
                item.error = invalid
              } else {
                const beforeIds = new Set(get().history.map((entry) => entry.id))
                try {
                  const resolvedIds = Object.fromEntries(results.filter((candidate) => candidate.resultTargetId).map((candidate) => [candidate.id, candidate.resultTargetId!]))
                  const result = executeProposalAction(get(), item, resolvedIds)
                  item.resultTargetId = result.id
                  const changed = get().history.some((entry) => !beforeIds.has(entry.id))
                  item.status = result.ok && (changed || result.existing) ? "applied" : "failed"
                  item.executionOutcome = item.status === "applied" ? result.existing ? "existing" : "written" : undefined
                  item.error = item.status === "failed" ? (result.ok ? "Store Action 未产生实际变更" : result.message) : null
                  if (item.status === "applied") item.appliedAt = nowIso()
                } catch (error) {
                  item.status = "failed"
                  item.error = error instanceof Error ? error.message : "执行失败"
                }
                set((state) => ({ history: state.history.map((entry) => beforeIds.has(entry.id) ? entry : {
                  ...entry, source: "agent" as const, proposalId, proposalActionId: item.id,
                }) }))
              }
            }
          }
          set((state) => ({ proposals: { ...state.proposals, [proposalId]: {
            ...state.proposals[proposalId], actions: structuredClone(results), updatedAt: nowIso(),
          } } }))
        }
        const succeeded = results.filter((item) => item.status === "applied").length
        const failures = results.filter((item) => item.status === "failed" || item.status === "stale")
        const status: AgentProposal["status"] = succeeded
          ? failures.length ? "partially_applied" : "applied"
          : "failed"
         set((state) => ({ proposals: { ...state.proposals, [proposalId]: {
           ...state.proposals[proposalId], actions: results, reviewedActions: structuredClone(results), status,
           appliedAt: succeeded ? nowIso() : null, updatedAt: nowIso(),
           applyError: failures.length ? failures.map((item) => `${item.id}: ${item.error}`).join("；") : null,
         } } }))
         set((state) => ({ meetingSessions: refreshedEndedMeetingMinutes(state, proposalId) }))
        const rejected = results.filter((item) => item.decision === "rejected").length
        const existing = results.filter(item => item.executionOutcome === "existing").length
        return { ok: status === "applied", message: status === "applied" ? `计划已应用：${succeeded - existing} 项实际变更${existing ? `，${existing} 项复用已有结果` : ""}${rejected ? `，${rejected} 项建议按你的决定未执行` : ""}` : status === "partially_applied" ? "部分建议已应用，请查看失败或过期项" : "建议未能应用，请查看原因" }
        } finally { executingProposals.delete(proposalId) }
      },

      createProposal: (input) => {
        const now = nowIso()
        const proposalId = makeId("proposal")
        const actions: ProposalAction[] = input.actions.map((action) => ({
          id: makeId("action"),
          actionType: action.actionType,
          targetType: action.targetType,
          targetId: action.targetId,
          beforeValue: structuredClone(action.beforeValue ?? null),
          proposedValue: structuredClone(action.proposedValue),
          reason: action.reason,
          decision: "pending",
          status: "pending",
          preconditions: structuredClone(action.preconditions ?? []),
          dependsOnActionIds: action.dependsOnActionIds ?? [],
          resultTargetId: null,
          appliedAt: null,
          error: null,
        }))
        const proposal: AgentProposal = {
          schemaVersion: PROPOSAL_SCHEMA_VERSION,
          id: proposalId,
          projectId: get().project.id,
          origin: input.origin,
          triggerType: input.triggerType,
          agentType: input.agentType,
          targetType: input.targetType,
          targetId: input.targetId,
          summary: input.summary,
          reasoning: input.reasoning,
          evidence: input.evidence,
          originalActions: structuredClone(actions),
          actions,
          status: "draft",
          createdBy: get().workspace.currentUserId,
          createdAt: now,
          updatedAt: now,
          reviewedBy: null,
          reviewedAt: null,
          reviewNote: "",
          appliedAt: null,
          applyError: null,
        }
        // 提案是会议与执行审计的持久记录，不能随新事件创建而截断。
        set((state) => ({ proposals: { ...state.proposals, [proposalId]: proposal } }))
        return proposal
      },

      updateProposal: (id, patch) => {
        const proposal = get().proposals[id]
        if (!proposal) return { ok: false, message: "Proposal 不存在" }
        if (proposal.status === "applied" || proposal.status === "rejected") {
          return { ok: false, message: "已结束的 Proposal 不能再次修改" }
        }
        set((state) => ({
          proposals: {
            ...state.proposals,
            [id]: { ...proposal, ...patch, id, updatedAt: nowIso() },
          },
        }))
        return { ok: true, message: "Proposal 已更新" }
      },

      setProposalActionDecision: (id, actionId, decision) =>
        get().setProposalDecision(id, actionId, decision),

      deleteProposal: (id) => {
        if (!get().proposals[id]) return { ok: false, message: "Proposal 不存在" }
        set((state) => {
          const next = { ...state.proposals }
          delete next[id]
          return { proposals: next }
        })
        return { ok: true, message: "Proposal 已删除" }
      },

      createBlankProject: (input) => {
        if (!input.name.trim() || !input.goal.trim()) {
          return { ok: false, message: "项目名称和项目目标必填" }
        }
        if (!input.startDate || !input.endDate || input.endDate < input.startDate) {
          return { ok: false, message: "请检查项目起止日期" }
        }
        if (!input.members.length || input.members.some((member) => !member.name.trim())) {
          return { ok: false, message: "至少需要一名已填写姓名的团队成员" }
        }
        const projectId = makeId("project")
        const colors = ["#4F46E5", "#059669", "#D97706", "#7C3AED", "#0284C7"]
        const members = Object.fromEntries(
          input.members.map((member, index) => {
            const id = `m${index + 1}`
            const normalized: Member = {
              id,
              name: member.name.trim(),
              initials: member.name.trim().slice(-2).toUpperCase(),
              color: colors[index % colors.length],
              role: member.role.trim() || "项目成员",
              capacityHours: Math.max(0, member.capacityHours || 40),
            }
            return [id, normalized]
          }),
        )
        const project = {
          id: projectId,
          name: input.name.trim(),
          subtitle: "PO 端项目工作区",
          goal: input.goal.trim(),
          requirementBrief: input.requirementBrief.trim(),
          startDate: input.startDate,
          endDate: input.endDate,
        }
        const workspace = {
          ...createDemoProjectState().workspace,
          currentPage: "overview" as const,
          selectedSprintId: "",
          selectedObjectType: null,
          selectedObjectId: null,
          inspectorOpen: false,
          actorMode: "po" as const,
          currentUserId: "m1",
          ganttRangeStart: input.startDate,
          ganttRangeEnd: input.endDate,
        }
        set({
          schemaVersion: CURRENT_SCHEMA_VERSION,
          project,
          members,
          activities: {},
          userTasks: {},
          epics: {},
          stories: {},
          tasks: {},
          subtasks: {},
          sprints: {},
          acceptanceCriteria: {},
          dependencies: {},
          assets: {},
          risks: {},
          impactAnalyses: [],
          sprintPulses: {},
          discussions: {},
          history: [historyItem("project", projectId, "create", null, project, "ui")],
          proposals: {},
          projectEvents: {},
          meetingSessions: {},
          meetingMessages: {},
          workspace,
        })
        return { ok: true, message: "空白项目已创建" }
      },

      updateProject: (patch) => {
        const current = get().project
        const next = { ...current, ...patch, id: current.id }
        if (!next.name.trim() || !next.goal.trim()) {
          return { ok: false, message: "项目名称和项目目标必填" }
        }
        if (next.endDate < next.startDate) {
          return { ok: false, message: "项目结束日期不能早于开始日期" }
        }
        set((state) => ({
          project: next,
          history: appendHistory(state.history, [
            historyItem("project", current.id, "update", current, next, "ui"),
          ]),
        }))
        return { ok: true, message: "项目资料已保存" }
      },

      setWorkspace: (patch) =>
        set((state) => ({ workspace: { ...state.workspace, ...patch } })),

      setInspectorTab: (tab) =>
        set((state) => ({
          workspace: { ...state.workspace, inspectorTab: tab },
        })),

      selectObject: (type, id = null) =>
        set((state) => ({
          workspace: {
            ...state.workspace,
            selectedObjectType: type,
            selectedObjectId: type ? id : null,
            inspectorOpen: Boolean(type && id),
            ganttHeatmapHighlight: null,
            inspectorTab:
              type === "task" || type === "subtask"
                ? "overview"
                : state.workspace.inspectorTab,
          },
        })),

      navigateTo: (view) =>
        set((state) => ({
          workspace: {
            ...state.workspace,
            currentPage: view,
            currentView: view,
            focusRequest:
              state.workspace.selectedObjectType &&
              state.workspace.selectedObjectId
                ? {
                    type: state.workspace.selectedObjectType,
                    id: state.workspace.selectedObjectId,
                    nonce: Date.now(),
                  }
                : state.workspace.focusRequest,
          },
        })),

      requestFocus: (type, id, view) =>
        set((state) => ({
          workspace: {
            ...state.workspace,
            ...(view ? { currentPage: view, currentView: view } : {}),
            selectedObjectType: type,
            selectedObjectId: id,
            inspectorOpen: true,
            ganttHeatmapHighlight: null,
            focusRequest: { type, id, nonce: Date.now() },
          },
        })),

      selectSprint: (id) => {
        if (!get().sprints[id]) return { ok: false, message: "Sprint 不存在" }
        set((state) => ({
          workspace: { ...state.workspace, selectedSprintId: id },
        }))
        return { ok: true, message: "Sprint 已切换" }
      },

      createSprint: (input) => {
        if (get().workspace.actorMode !== "po") {
          throw new Error("只有 PO 可以创建 Sprint")
        }
        if (input.endDate < input.startDate)
          throw new Error("Sprint 结束日期不能早于开始日期")
        if (
          input.status === "active" &&
          Object.values(get().sprints).some(
            (sprint) => sprint.status === "active",
          )
        ) {
          throw new Error("同时只能存在一个进行中的 Sprint")
        }
        const id = input.id ?? makeId("sprint")
        const sprint: SprintEntity = {
          id,
          name: input.name.trim() || "未命名 Sprint",
          goal: input.goal.trim(),
          startDate: input.startDate,
          endDate: input.endDate,
          status: input.status ?? "planning",
          velocity: input.velocity ?? 0,
          capacity: input.capacity,
          memberIds: input.memberIds ?? Object.keys(get().members),
          reviewSummary: input.reviewSummary ?? "",
          goalAchieved: input.goalAchieved ?? null,
          retrospective: input.retrospective ?? {
            mainProblem: "",
            nextImprovement: "",
          },
          closedAt: input.closedAt ?? null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }
        set((state) => ({
          sprints: { ...state.sprints, [id]: sprint },
          history: appendHistory(state.history, [
            historyItem("sprint", id, "create", null, sprint, "ui"),
          ]),
        }))
        return sprint
      },

      updateSprint: (id, patch, source = "ui") => {
        if (get().workspace.actorMode !== "po") {
          return { ok: false, message: "只有 PO 可以编辑 Sprint" }
        }
        const current = get().sprints[id]
        if (!current) return { ok: false, message: "Sprint 不存在" }
        const next = { ...current, ...patch, id, updatedAt: nowIso() }
        if (next.endDate < next.startDate)
          return { ok: false, message: "Sprint 结束日期不能早于开始日期" }
        if (
          next.status === "active" &&
          Object.values(get().sprints).some(
            (sprint) => sprint.id !== id && sprint.status === "active",
          )
        ) {
          return { ok: false, message: "同时只能存在一个进行中的 Sprint" }
        }
        const changes = Object.entries(patch)
          .filter(
            ([field, value]) =>
              JSON.stringify(current[(field as keyof SprintEntity)]) !==
              JSON.stringify(value),
          )
          .map(([field, value]) =>
            historyItem(
              "sprint",
              id,
              field,
              current[(field as keyof SprintEntity)],
              value,
              source,
            ),
          )
        set((state) => ({
          sprints: { ...state.sprints, [id]: next },
          history: appendHistory(state.history, changes),
        }))
        return { ok: true, message: "Sprint 已保存" }
      },

      setSprintStatus: (id, status) =>
        get().updateSprint(id, {
          status,
          closedAt: status === "closed" ? nowIso() : null,
        }),

      addStoriesToSprint: (sprintId, storyIds) => {
        if (get().workspace.actorMode !== "po") {
          return { ok: false, message: "只有 PO 可以向 Sprint 加入 Story" }
        }
        const sprint = get().sprints[sprintId]
        if (!sprint) return { ok: false, message: "Sprint 不存在" }
        if (sprint.status === "closed") {
          return { ok: false, message: "已关闭的 Sprint 不能加入 Story" }
        }
        const uniqueIds = [...new Set(storyIds)]
        const invalid = uniqueIds
          .map((id) => get().stories[id])
          .filter(
            (story) =>
              !story || story.maturityStatus !== "ready" || story.sprintId !== null,
          )
        if (invalid.length) {
          return {
            ok: false,
            message: "只能加入 Ready 且仍在 Product Backlog 中的 Story",
          }
        }
        set((state) => {
          const stories = { ...state.stories }
          const history: ChangeHistoryItem[] = []
          let impactAnalyses = state.impactAnalyses
          uniqueIds.forEach((id) => {
            const story = stories[id]
            stories[id] = {
              ...story,
              sprintId,
              deliveryStatus:
                story.deliveryStatus === "accepted" ? "accepted" : "planned",
              updatedAt: nowIso(),
            }
            history.push(
              historyItem("story", id, "sprintId", null, sprintId, "ui"),
            )
            const impact = makeImpactAnalysis(
              { ...state, stories },
              "story",
              id,
              "sprint",
              story.taskIds,
            )
            impactAnalyses = appendImpact(impactAnalyses, impact)
            history.push(historyItem("impact", impact.id, "create", null, impact, "system"))
          })
          return {
            stories,
            impactAnalyses,
            history: appendHistory(state.history, history),
          }
        })
        return { ok: true, message: `已加入 ${uniqueIds.length} 个 Story` }
      },

      removeStoryFromSprint: (storyId) => {
        if (get().workspace.actorMode !== "po") {
          return { ok: false, message: "只有 PO 可以从 Sprint 移出 Story" }
        }
        const story = get().stories[storyId]
        if (!story) return { ok: false, message: "Story 不存在" }
        if (!story.sprintId) return { ok: false, message: "Story 已在 Product Backlog" }
        const sprint = get().sprints[story.sprintId]
        if (sprint?.status === "closed") {
          return { ok: false, message: "已关闭 Sprint 中的 Story 不能直接移出" }
        }
        return get().moveStory(storyId, story.epicId, null)
      },

      startSprint: (sprintId) => {
        if (get().workspace.actorMode !== "po") {
          return { ok: false, message: "只有 PO 可以启动 Sprint" }
        }
        const sprint = get().sprints[sprintId]
        if (!sprint) return { ok: false, message: "Sprint 不存在" }
        if (sprint.status !== "planning") {
          return { ok: false, message: "只有规划中的 Sprint 可以启动" }
        }
        const failed = sprintStartChecks(get(), sprintId).filter(
          (check) => !check.passed,
        )
        if (failed.length) {
          return {
            ok: false,
            message: failed.map((check) => check.detail).join("；"),
          }
        }
        set((state) => ({
          sprints: {
            ...state.sprints,
            [sprintId]: {
              ...state.sprints[sprintId],
              status: "active",
              updatedAt: nowIso(),
            },
          },
          workspace: { ...state.workspace, selectedSprintId: sprintId },
          history: appendHistory(state.history, [
            historyItem("sprint", sprintId, "status", "planning", "active", "ui"),
          ]),
        }))
        return { ok: true, message: `${sprint.name} 已启动` }
      },

      closeSprint: (sprintId, payload) => {
        const state = get()
        if (state.workspace.actorMode !== "po") {
          return { ok: false, message: "只有 PO 可以关闭 Sprint" }
        }
        const sprint = state.sprints[sprintId]
        if (!sprint) return { ok: false, message: "Sprint 不存在" }
        if (sprint.status !== "active") {
          return { ok: false, message: "只能关闭进行中的 Sprint" }
        }
        if (!payload.retrospective.mainProblem.trim()) {
          return { ok: false, message: "请填写本轮主要问题" }
        }
        if (!payload.retrospective.nextImprovement.trim()) {
          return { ok: false, message: "请填写下一轮改进事项" }
        }
        const unfinished = Object.values(state.stories).filter(
          (story) =>
            story.sprintId === sprintId && story.deliveryStatus !== "accepted",
        )
        const decisions = new Map(
          payload.carryOver.map((item) => [item.storyId, item.to]),
        )
        const missing = unfinished.filter((story) => !decisions.has(story.id))
        if (missing.length) {
          return {
            ok: false,
            message: `还有 ${missing.length} 个未完成 Story 未指定去向`,
          }
        }
        for (const story of unfinished) {
          const target = decisions.get(story.id)
          if (target !== "backlog") {
            const targetSprint = target ? state.sprints[target] : null
            if (!targetSprint || targetSprint.id === sprintId || targetSprint.status === "closed") {
              return { ok: false, message: `${story.title} 的目标 Sprint 无效` }
            }
          }
        }
        set((current) => {
          const stories = { ...current.stories }
          const changes: ChangeHistoryItem[] = []
          unfinished.forEach((story) => {
            const target = decisions.get(story.id)!
            const sprintTarget = target === "backlog" ? null : target
            stories[story.id] = {
              ...story,
              sprintId: sprintTarget,
              deliveryStatus: sprintTarget ? "planned" : "backlog",
              updatedAt: nowIso(),
            }
            changes.push(
              historyItem(
                "story",
                story.id,
                "sprintId",
                sprintId,
                sprintTarget,
                "ui",
              ),
            )
          })
          const derivedStories = deriveAllStoryDeliveries({
            stories,
            tasks: current.tasks,
            subtasks: current.subtasks,
          }).stories
          const closed: SprintEntity = {
            ...current.sprints[sprintId],
            status: "closed",
            goalAchieved: payload.goalAchieved,
            retrospective: {
              mainProblem: payload.retrospective.mainProblem.trim(),
              nextImprovement: payload.retrospective.nextImprovement.trim(),
            },
            closedAt: nowIso(),
            updatedAt: nowIso(),
          }
          return {
            stories: derivedStories,
            sprints: { ...current.sprints, [sprintId]: closed },
            history: appendHistory(current.history, [
              historyItem("sprint", sprintId, "status", "active", "closed", "ui"),
              ...changes,
            ]),
          }
        })
        return { ok: true, message: `${sprint.name} 已关闭` }
      },

      reopenSprint: (sprintId) => {
        if (get().workspace.actorMode !== "po") {
          return { ok: false, message: "只有 PO 可以重开 Sprint" }
        }
        const sprint = get().sprints[sprintId]
        if (!sprint) return { ok: false, message: "Sprint 不存在" }
        if (sprint.status !== "closed") {
          return { ok: false, message: "只有已关闭的 Sprint 可以重开" }
        }
        const otherActive = Object.values(get().sprints).find(
          (item) => item.id !== sprintId && item.status === "active",
        )
        if (otherActive) {
          return {
            ok: false,
            message: `请先关闭进行中的 ${otherActive.name}`,
          }
        }
        return get().updateSprint(sprintId, {
          status: "active",
          closedAt: null,
        })
      },

      updateStory: (id, patch, source = "ui") => {
        const current = get().stories[id]
        if (!current) return { ok: false, message: "Story 不存在" }
        if (current.sprintId && get().sprints[current.sprintId]?.status === "closed") {
          return { ok: false, message: "已关闭 Sprint 中的 Story 不能修改" }
        }
        if (
          (patch.sprintId !== undefined && patch.sprintId !== current.sprintId) ||
          (patch.epicId !== undefined && patch.epicId !== current.epicId)
        ) {
          const moveResult = get().moveStory(
            id,
            patch.epicId === undefined ? current.epicId : patch.epicId,
            patch.sprintId === undefined ? current.sprintId : patch.sprintId,
            current.order,
          )
          if (!moveResult.ok) return moveResult
          const remainingPatch: Partial<StoryEntity> = { ...patch }
          delete remainingPatch.sprintId
          delete remainingPatch.epicId
          return Object.keys(remainingPatch).length
            ? get().updateStory(id, remainingPatch, source)
            : moveResult
        }
        if (patch.startDate !== undefined || patch.dueDate !== undefined) {
          const nextRange = {
            startDate: patch.startDate ?? current.startDate,
            endDate: patch.dueDate ?? current.dueDate,
          }
          const scheduleResult = get().rescheduleItem(
            "story",
            id,
            nextRange.startDate,
            nextRange.endDate,
            inferScheduleChangeMode(
              { startDate: current.startDate, endDate: current.dueDate },
              nextRange,
            ),
            source,
          )
          if (!scheduleResult.ok) return scheduleResult
          const remainingPatch: Partial<StoryEntity> = { ...patch }
          delete remainingPatch.startDate
          delete remainingPatch.dueDate
          if (!Object.keys(remainingPatch).length) return scheduleResult
          return get().updateStory(id, remainingPatch, source)
        }
        const next = { ...current, ...patch, id, updatedAt: nowIso() }
        if (next.startDate && next.dueDate && next.dueDate < next.startDate) {
          return { ok: false, message: "截止日期不能早于开始日期" }
        }
        const changes = Object.entries(patch)
          .filter(
            ([field, value]) =>
              JSON.stringify(current[(field as keyof StoryEntity)]) !==
              JSON.stringify(value),
          )
          .map(([field, value]) =>
            historyItem(
              "story",
              id,
              field,
              current[(field as keyof StoryEntity)],
              value,
              source,
            ),
          )
        set((state) => {
          const records: ScheduleRecords = {
            epics: { ...state.epics },
            stories: { ...state.stories, [id]: next },
            tasks: state.tasks,
            subtasks: state.subtasks,
          }
          expandAncestorSchedules(records, "story", id)
          const impact = changes.some((change) => change.field === "assigneeId")
            ? makeImpactAnalysis(
                { ...state, stories: records.stories },
                "story",
                id,
                "assignee",
                current.taskIds,
                [current.assigneeId, next.assigneeId],
              )
            : null
          return {
            epics: records.epics,
            stories: records.stories,
            impactAnalyses: appendImpact(state.impactAnalyses, impact),
            history: appendHistory(state.history, [
              ...changes,
              ...(impact
                ? [historyItem("impact", impact.id, "create", null, impact, "system")]
                : []),
            ]),
          }
        })
        return { ok: true, message: "Story 已保存" }
      },

      createStory: (input) => {
        const id = input.id ?? makeId("story")
        const story: StoryEntity = {
          id,
          title: input.title.trim() || "未命名 Story",
          as: input.as ?? "",
          iWant: input.iWant ?? "",
          soThat: input.soThat ?? "",
          assigneeId: input.assigneeId ?? get().workspace.currentUserId,
          collaboratorIds: input.collaboratorIds ?? [],
          maturityStatus: input.maturityStatus ?? "draft",
          deliveryStatus: input.deliveryStatus ?? "backlog",
          priority: input.priority ?? "medium",
          storyPoints: input.storyPoints ?? 3,
          businessValue: input.businessValue ?? 3,
          expectedBenefit: input.expectedBenefit ?? "",
          risk: input.risk ?? "none",
          riskNote: input.riskNote ?? "",
          startDate: input.startDate ?? "2026-09-13",
          dueDate: input.dueDate ?? "2026-09-18",
          sprintId: input.sprintId ?? null,
          epicId: input.epicId ?? null,
          source: input.source,
          order:
            input.order ??
            ordered(get().stories, (story) => story.sprintId === null).length,
          taskIds: input.taskIds ?? [],
          acceptanceCriteriaIds: input.acceptanceCriteriaIds ?? [],
          acceptanceLog: input.acceptanceLog ?? [],
          discussionIds: input.discussionIds ?? [],
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }
        set((state) => {
          const records: ScheduleRecords = {
            epics: { ...state.epics },
            stories: { ...state.stories, [id]: story },
            tasks: state.tasks,
            subtasks: state.subtasks,
          }
          expandAncestorSchedules(records, "story", id)
          return {
            epics: records.epics,
            stories: records.stories,
            history: appendHistory(state.history, [
              historyItem("story", id, "create", null, story, "ui"),
            ]),
          }
        })
        return story
      },

      deleteStory: (id) => {
        const current = get().stories[id]
        if (!current) return { ok: false, message: "Story 不存在" }
        if (current.sprintId && get().sprints[current.sprintId]?.status === "closed") {
          return { ok: false, message: "已关闭 Sprint 中的 Story 不能删除" }
        }
        set((state) => {
          const story = state.stories[id]
          if (!story) return state
          const stories = { ...state.stories }
          delete stories[id]
          const tasks = { ...state.tasks }
          const subtasks = { ...state.subtasks }
          const acceptanceCriteria = { ...state.acceptanceCriteria }
          const discussions = { ...state.discussions }
          const dependencies = { ...state.dependencies }
          const assets = Object.fromEntries(
            Object.entries(state.assets).map(([assetId, asset]) => [
              assetId,
              {
                ...asset,
                links: asset.links.filter(
                  (link) =>
                    !(link.targetType === "story" && link.targetId === id) &&
                    !(
                      link.targetType === "task" &&
                      story.taskIds.includes(link.targetId)
                    ),
                ),
              },
            ]),
          )
          story.taskIds.forEach((taskId) => {
            state.tasks[taskId]?.subtaskIds.forEach(
              (subtaskId) => delete subtasks[subtaskId],
            )
            delete tasks[taskId]
          })
          story.acceptanceCriteriaIds.forEach(
            (criterionId) => delete acceptanceCriteria[criterionId],
          )
          story.discussionIds.forEach(
            (discussionId) => delete discussions[discussionId],
          )
          Object.values(discussions).forEach((discussion) => {
            if (
              (discussion.targetType === "story" && discussion.targetId === id) ||
              (discussion.targetType === "task" && story.taskIds.includes(discussion.targetId))
            ) {
              delete discussions[discussion.id]
            }
          })
          Object.values(dependencies).forEach((dependency) => {
            if (
              story.taskIds.includes(dependency.sourceTaskId) ||
              story.taskIds.includes(dependency.targetTaskId)
            )
              delete dependencies[dependency.id]
          })
          const risks = Object.fromEntries(
            Object.entries(state.risks).filter(([, risk]) =>
              !(
                (risk.targetType === "story" && risk.targetId === id) ||
                (risk.targetType === "task" && story.taskIds.includes(risk.targetId))
              ),
            ),
          )
          return {
            stories,
            tasks,
            subtasks,
            acceptanceCriteria,
            discussions,
            dependencies,
            assets,
            risks,
            history: appendHistory(state.history, [
              historyItem("story", id, "delete", story, null, "ui"),
            ]),
            workspace:
              state.workspace.selectedObjectId === id
                ? {
                    ...state.workspace,
                    selectedObjectId: null,
                    selectedObjectType: null,
                    inspectorOpen: false,
                  }
                : state.workspace,
          }
        })
        return { ok: true, message: "Story 及其执行子树已删除" }
      },

      setStoryMaturity: (id, maturity) => {
        const story = get().stories[id]
        if (!story) return { ok: false, message: "Story 不存在" }
        if (
          maturity === "ready" &&
          (!story.title.trim() ||
            !story.epicId ||
            !story.as.trim() ||
            !story.iWant.trim() ||
            !story.soThat.trim())
        ) {
          return {
            ok: false,
            message: "补全名称、Epic 和三段式描述后才能标记 Ready",
          }
        }
        return get().updateStory(id, { maturityStatus: maturity }, "ui")
      },

      moveStory: (
        id,
        epicId,
        sprintId,
        targetIndex = Number.MAX_SAFE_INTEGER,
      ) => {
        const story = get().stories[id]
        if (!story) return { ok: false, message: "Story 不存在" }
        if (story.sprintId && get().sprints[story.sprintId]?.status === "closed") {
          return { ok: false, message: "已关闭 Sprint 中的 Story 不能移动" }
        }
        if (sprintId && get().sprints[sprintId]?.status === "closed") {
          return { ok: false, message: "不能将 Story 移入已关闭 Sprint" }
        }
        if (sprintId && story.maturityStatus !== "ready") {
          return { ok: false, message: "候选或草稿 Story 不能直接加入 Sprint" }
        }
        if (epicId && !get().epics[epicId])
          return { ok: false, message: "目标 Epic 不存在" }

        const before = structuredClone(story)
        set((state) => {
          let stories = { ...state.stories }
          const oldIds = ordered(
            stories,
            (item) =>
              item.id !== id &&
              item.epicId === story.epicId &&
              item.sprintId === story.sprintId,
          ).map((item) => item.id)
          stories = resequence(stories, oldIds)
          const targetIds = ordered(
            stories,
            (item) =>
              item.id !== id &&
              item.epicId === epicId &&
              item.sprintId === sprintId,
          ).map((item) => item.id)
          targetIds.splice(Math.min(targetIndex, targetIds.length), 0, id)
          stories[id] = {
            ...story,
            epicId,
            sprintId,
            deliveryStatus: sprintId
              ? story.deliveryStatus === "accepted"
                ? "accepted"
                : "planned"
              : "backlog",
            updatedAt: nowIso(),
          }
          stories = resequence(stories, targetIds)
          const records: ScheduleRecords = {
            epics: { ...state.epics },
            stories,
            tasks: state.tasks,
            subtasks: state.subtasks,
          }
          expandAncestorSchedules(records, "story", id)
          const impact = story.sprintId !== sprintId
            ? makeImpactAnalysis(
                { ...state, stories: records.stories },
                "story",
                id,
                "sprint",
                story.taskIds,
              )
            : null
          return {
            epics: records.epics,
            stories: records.stories,
            impactAnalyses: appendImpact(state.impactAnalyses, impact),
            history: appendHistory(state.history, [
              historyItem("story", id, "move", before, stories[id], "drag"),
              ...(impact
                ? [historyItem("impact", impact.id, "create", null, impact, "system")]
                : []),
            ]),
          }
        })
        return {
          ok: true,
          message: sprintId
            ? "Story 已移动并保存"
            : "Story 已移回 Product Backlog",
        }
      },

      reorderBacklog: (id, targetIndex) => {
        const story = get().stories[id]
        if (!story || story.sprintId !== null)
          return { ok: false, message: "仅 Product Backlog Story 可在此排序" }
        set((state) => {
          const ids = ordered(state.stories, (item) => item.sprintId === null)
            .map((item) => item.id)
            .filter((itemId) => itemId !== id)
          ids.splice(Math.min(Math.max(targetIndex, 0), ids.length), 0, id)
          const stories = resequence(state.stories, ids)
          return {
            stories,
            history: appendHistory(state.history, [
              historyItem(
                "story",
                id,
                "order",
                story.order,
                stories[id].order,
                "drag",
              ),
            ]),
          }
        })
        return { ok: true, message: "Backlog 顺序已保存" }
      },

      createActivity: (input) => {
        const id = input.id ?? makeId("activity")
        const activity: UserActivityEntity = {
          id,
          title: input.title.trim() || "未命名 Activity",
          domain: input.domain ?? "other",
          order: input.order ?? ordered(get().activities, () => true).length,
        }
        set((state) => ({
          activities: { ...state.activities, [id]: activity },
          history: appendHistory(state.history, [
            historyItem("activity", id, "create", null, activity, "ui"),
          ]),
        }))
        return activity
      },

      updateActivity: (id, patch, source = "ui") => {
        const current = get().activities[id]
        if (!current) return { ok: false, message: "User Activity 不存在" }
        const title = patch.title === undefined ? current.title : patch.title.trim()
        if (!title) return { ok: false, message: "Activity 名称不能为空" }
        const next: UserActivityEntity = { ...current, ...patch, id, title }
        const changes = (Object.keys(next) as (keyof UserActivityEntity)[])
          .filter(
            (field) =>
              JSON.stringify(current[field]) !== JSON.stringify(next[field]),
          )
          .map((field) =>
            historyItem(
              "activity",
              id,
              field,
              current[field],
              next[field],
              source,
            ),
          )
        set((state) => ({
          activities: { ...state.activities, [id]: next },
          history: appendHistory(state.history, changes),
        }))
        return { ok: true, message: "User Activity 已保存" }
      },

      deleteActivity: (id) => {
        const activity = get().activities[id]
        if (!activity) return { ok: false, message: "User Activity 不存在" }
        const userTaskIds = new Set(
          Object.values(get().userTasks)
            .filter((task) => task.activityId === id)
            .map((task) => task.id),
        )
        const epicIds = new Set(
          Object.values(get().epics)
            .filter((epic) => userTaskIds.has(epic.userTaskId))
            .map((epic) => epic.id),
        )
        if (
          Object.values(get().stories).some(
            (story) =>
              story.epicId &&
              epicIds.has(story.epicId) &&
              story.sprintId &&
              get().sprints[story.sprintId]?.status === "closed",
          )
        ) {
          return { ok: false, message: "该层级包含已关闭 Sprint 的 Story，不能删除" }
        }
        set((state) => {
          const cascade = removeEpicSubtrees(state, epicIds)
          const activities = { ...state.activities }
          delete activities[id]
          const activityIds = ordered(activities, () => true).map(
            (item) => item.id,
          )
          return {
            ...cascade,
            activities: resequence(activities, activityIds),
            userTasks: Object.fromEntries(
              Object.entries(state.userTasks).filter(
                ([userTaskId]) => !userTaskIds.has(userTaskId),
              ),
            ),
            epics: Object.fromEntries(
              Object.entries(state.epics).filter(
                ([epicId]) => !epicIds.has(epicId),
              ),
            ),
            history: appendHistory(state.history, [
              historyItem("activity", id, "delete", activity, null, "ui"),
            ]),
          }
        })
        return { ok: true, message: "User Activity 及其完整子树已删除" }
      },

      createUserTask: (activityId, input = {}) => {
        if (!get().activities[activityId]) throw new Error("User Activity 不存在")
        const id = input.id ?? makeId("user-task")
        const userTask: UserTaskEntity = {
          id,
          title: input.title?.trim() || "未命名 User Task",
          activityId,
          order:
            input.order ??
            ordered(
              get().userTasks,
              (task) => task.activityId === activityId,
            ).length,
        }
        set((state) => ({
          userTasks: { ...state.userTasks, [id]: userTask },
          history: appendHistory(state.history, [
            historyItem("userTask", id, "create", null, userTask, "ui"),
          ]),
        }))
        return userTask
      },

      updateUserTask: (id, patch, source = "ui") => {
        const current = get().userTasks[id]
        if (!current) return { ok: false, message: "User Task 不存在" }
        const title = patch.title === undefined ? current.title : patch.title.trim()
        if (!title) return { ok: false, message: "User Task 名称不能为空" }
        const activityId = patch.activityId ?? current.activityId
        if (!get().activities[activityId])
          return { ok: false, message: "目标 User Activity 不存在" }
        set((state) => {
          let userTasks = { ...state.userTasks }
          if (activityId !== current.activityId) {
            const oldIds = ordered(
              userTasks,
              (task) =>
                task.id !== id && task.activityId === current.activityId,
            ).map((task) => task.id)
            userTasks = resequence(userTasks, oldIds)
            const targetIds = ordered(
              userTasks,
              (task) => task.id !== id && task.activityId === activityId,
            ).map((task) => task.id)
            targetIds.push(id)
            userTasks[id] = { ...current, ...patch, id, title, activityId }
            userTasks = resequence(userTasks, targetIds)
          } else {
            userTasks[id] = { ...current, ...patch, id, title, activityId }
          }
          return {
            userTasks,
            history: appendHistory(state.history, [
              historyItem(
                "userTask",
                id,
                "update",
                current,
                userTasks[id],
                source,
              ),
            ]),
          }
        })
        return { ok: true, message: "User Task 已保存" }
      },

      deleteUserTask: (id) => {
        const userTask = get().userTasks[id]
        if (!userTask) return { ok: false, message: "User Task 不存在" }
        const epicIds = new Set(
          Object.values(get().epics)
            .filter((epic) => epic.userTaskId === id)
            .map((epic) => epic.id),
        )
        if (
          Object.values(get().stories).some(
            (story) =>
              story.epicId &&
              epicIds.has(story.epicId) &&
              story.sprintId &&
              get().sprints[story.sprintId]?.status === "closed",
          )
        ) {
          return { ok: false, message: "该层级包含已关闭 Sprint 的 Story，不能删除" }
        }
        set((state) => {
          const cascade = removeEpicSubtrees(state, epicIds)
          const userTasks = { ...state.userTasks }
          delete userTasks[id]
          const siblingIds = ordered(
            userTasks,
            (task) => task.activityId === userTask.activityId,
          ).map((task) => task.id)
          return {
            ...cascade,
            userTasks: resequence(userTasks, siblingIds),
            epics: Object.fromEntries(
              Object.entries(state.epics).filter(
                ([epicId]) => !epicIds.has(epicId),
              ),
            ),
            history: appendHistory(state.history, [
              historyItem("userTask", id, "delete", userTask, null, "ui"),
            ]),
          }
        })
        return { ok: true, message: "User Task 及其完整子树已删除" }
      },

      createEpic: (userTaskId, input = {}) => {
        if (!get().userTasks[userTaskId]) throw new Error("User Task 不存在")
        const id = input.id ?? makeId("epic")
        const selectedSprint = get().sprints[get().workspace.selectedSprintId]
        const startDate =
          input.startDate ?? selectedSprint?.startDate ?? get().project.startDate
        const endDate =
          input.endDate ?? selectedSprint?.endDate ?? get().project.endDate
        if (endDate < startDate) throw new Error("Epic 结束日期不能早于开始日期")
        const epic: EpicEntity = {
          id,
          title: input.title?.trim() || "未命名 Epic",
          userTaskId,
          startDate,
          endDate,
          order:
            input.order ??
            ordered(get().epics, (item) => item.userTaskId === userTaskId)
              .length,
        }
        set((state) => ({
          epics: { ...state.epics, [id]: epic },
          history: appendHistory(state.history, [
            historyItem("epic", id, "create", null, epic, "ui"),
          ]),
        }))
        return epic
      },

      updateEpic: (id, patch, source = "ui") => {
        const current = get().epics[id]
        if (!current) return { ok: false, message: "Epic 不存在" }
        if (patch.startDate !== undefined || patch.endDate !== undefined) {
          const nextRange = {
            startDate: patch.startDate ?? current.startDate,
            endDate: patch.endDate ?? current.endDate,
          }
          const scheduleResult = get().rescheduleItem(
            "epic",
            id,
            nextRange.startDate,
            nextRange.endDate,
            inferScheduleChangeMode(current, nextRange),
            source,
          )
          if (!scheduleResult.ok) return scheduleResult
          const remainingPatch: Partial<EpicEntity> = { ...patch }
          delete remainingPatch.startDate
          delete remainingPatch.endDate
          if (!Object.keys(remainingPatch).length) return scheduleResult
          return get().updateEpic(id, remainingPatch, source)
        }
        const title = patch.title === undefined ? current.title : patch.title.trim()
        if (!title) return { ok: false, message: "Epic 名称不能为空" }
        const userTaskId = patch.userTaskId ?? current.userTaskId
        if (!get().userTasks[userTaskId])
          return { ok: false, message: "目标 User Task 不存在" }
        set((state) => {
          let epics = { ...state.epics }
          if (userTaskId !== current.userTaskId) {
            const oldIds = ordered(
              epics,
              (epic) =>
                epic.id !== id && epic.userTaskId === current.userTaskId,
            ).map((epic) => epic.id)
            epics = resequence(epics, oldIds)
            const targetIds = ordered(
              epics,
              (epic) => epic.id !== id && epic.userTaskId === userTaskId,
            ).map((epic) => epic.id)
            targetIds.push(id)
            epics[id] = { ...current, ...patch, id, title, userTaskId }
            epics = resequence(epics, targetIds)
          } else {
            epics[id] = { ...current, ...patch, id, title, userTaskId }
          }
          return {
            epics,
            history: appendHistory(state.history, [
              historyItem(
                "epic",
                id,
                "update",
                current,
                epics[id],
                source,
              ),
            ]),
          }
        })
        return { ok: true, message: "Epic 已保存" }
      },

      deleteEpic: (id) => {
        const epic = get().epics[id]
        if (!epic) return { ok: false, message: "Epic 不存在" }
        const epicIds = new Set([id])
        if (
          Object.values(get().stories).some(
            (story) =>
              story.epicId === id &&
              story.sprintId &&
              get().sprints[story.sprintId]?.status === "closed",
          )
        ) {
          return { ok: false, message: "Epic 包含已关闭 Sprint 的 Story，不能删除" }
        }
        set((state) => {
          const cascade = removeEpicSubtrees(state, epicIds)
          const epics = { ...state.epics }
          delete epics[id]
          const siblingIds = ordered(
            epics,
            (item) => item.userTaskId === epic.userTaskId,
          ).map((item) => item.id)
          return {
            ...cascade,
            epics: resequence(epics, siblingIds),
            history: appendHistory(state.history, [
              historyItem("epic", id, "delete", epic, null, "ui"),
            ]),
          }
        })
        return { ok: true, message: "Epic 及其完整 Story 子树已删除" }
      },

      moveActivity: (id, targetIndex) =>
        set((state) => {
          const ids = ordered(state.activities, () => true)
            .map((item) => item.id)
            .filter((itemId) => itemId !== id)
          ids.splice(Math.min(Math.max(targetIndex, 0), ids.length), 0, id)
          return {
            activities: resequence(state.activities, ids),
            history: appendHistory(state.history, [
              historyItem(
                "activity",
                id,
                "order",
                state.activities[id]?.order,
                targetIndex,
                "drag",
              ),
            ]),
          }
        }),

      moveUserTask: (id, activityId, targetIndex) =>
        set((state) => {
          const current = state.userTasks[id]
          if (!current || !state.activities[activityId]) return state
          let userTasks = { ...state.userTasks }
          const oldIds = ordered(
            userTasks,
            (item) => item.id !== id && item.activityId === current.activityId,
          ).map((item) => item.id)
          userTasks = resequence(userTasks, oldIds)
          const targetIds = ordered(
            userTasks,
            (item) => item.id !== id && item.activityId === activityId,
          ).map((item) => item.id)
          targetIds.splice(Math.min(targetIndex, targetIds.length), 0, id)
          userTasks[id] = { ...current, activityId }
          userTasks = resequence(userTasks, targetIds)
          return {
            userTasks,
            history: appendHistory(state.history, [
              historyItem(
                "userTask",
                id,
                "move",
                current,
                userTasks[id],
                "drag",
              ),
            ]),
          }
        }),

      moveEpic: (id, userTaskId, targetIndex) =>
        set((state) => {
          const current = state.epics[id]
          if (!current || !state.userTasks[userTaskId]) return state
          let epics = { ...state.epics }
          const oldIds = ordered(
            epics,
            (item) => item.id !== id && item.userTaskId === current.userTaskId,
          ).map((item) => item.id)
          epics = resequence(epics, oldIds)
          const targetIds = ordered(
            epics,
            (item) => item.id !== id && item.userTaskId === userTaskId,
          ).map((item) => item.id)
          targetIds.splice(Math.min(targetIndex, targetIds.length), 0, id)
          epics[id] = { ...current, userTaskId }
          epics = resequence(epics, targetIds)
          return {
            epics,
            history: appendHistory(state.history, [
              historyItem("epic", id, "move", current, epics[id], "drag"),
            ]),
          }
        }),

      rescheduleItem: (
        type,
        id,
        startDate,
        endDate,
        mode,
        source = "drag",
      ) => {
        if (type === "story") {
          const story = get().stories[id]
          if (story?.sprintId && get().sprints[story.sprintId]?.status === "closed") {
            return { ok: false, message: "已关闭 Sprint 中的 Story 不能调整排期" }
          }
        }
        if (type === "epic") {
          const hasClosedDescendant = Object.values(get().stories).some(
            (story) =>
              story.epicId === id &&
              story.sprintId &&
              get().sprints[story.sprintId]?.status === "closed",
          )
          if (hasClosedDescendant) {
            return { ok: false, message: "Epic 含已关闭 Sprint 的 Story，不能整体调整排期" }
          }
        }
        if (type === "task" || type === "subtask") {
          const message = executionWriteGuard(get(), type, id)
          if (message) return { ok: false, message }
        }
        const plan = planHierarchySchedule(
          get(),
          type,
          id,
          startDate,
          endDate,
          mode,
        )
        if (!plan.ok) return plan
        const hasChanges = Object.values(plan.after).some(
          (group) => Object.keys(group).length > 0,
        )
        if (!hasChanges) return { ok: true, message: "排期未变化" }
        set((state) => {
          const rootTaskIds =
            type === "task"
              ? [id]
              : type === "subtask"
                ? [state.subtasks[id]?.taskId].filter(Boolean) as string[]
                : type === "story"
                  ? state.stories[id]?.taskIds ?? []
                  : []
          const impact = rootTaskIds.length
            ? makeImpactAnalysis(
                { ...state, epics: plan.epics, stories: plan.stories, tasks: plan.tasks, subtasks: plan.subtasks },
                type === "story" ? "story" : "task",
                type === "subtask" ? state.subtasks[id]?.taskId ?? id : id,
                "schedule",
                rootTaskIds,
              )
            : null
          return {
            epics: plan.epics,
            stories: plan.stories,
            tasks: plan.tasks,
            subtasks: plan.subtasks,
            impactAnalyses: appendImpact(state.impactAnalyses, impact),
            history: appendHistory(state.history, [
              historyItem(
                type,
                id,
                "schedule",
                plan.before,
                plan.after,
                source,
              ),
              ...(impact
                ? [historyItem("impact", impact.id, "create", null, impact, "system")]
                : []),
            ]),
          }
        })
        return { ok: true, message: plan.message }
      },

      updateTask: (id, patch, source = "ui") => {
        const current = get().tasks[id]
        if (!current) return { ok: false, message: "工程任务不存在" }
        const locked = executionWriteGuard(get(), "task", id)
        if (locked) return { ok: false, message: locked }
        if (patch.status === "blocked" && current.status !== "blocked") {
          return { ok: false, message: "请在右侧详情中添加阻塞原因" }
        }
        if (
          patch.status &&
          patch.status !== "blocked" &&
          current.blockReasons.length > 0
        ) {
          return { ok: false, message: "请先处理现有阻塞原因" }
        }
        const requestedProgress =
          patch.progress === undefined
            ? current.progress
            : clampProgress(patch.progress)
        if (
          current.blockReasons.length > 0 &&
          patch.progress !== undefined &&
          requestedProgress !== current.progress &&
          requestedProgress === 100
        ) {
          return { ok: false, message: "请先处理现有阻塞原因再完成任务" }
        }
        if (patch.startDate !== undefined || patch.endDate !== undefined) {
          const nextRange = {
            startDate: patch.startDate ?? current.startDate,
            endDate: patch.endDate ?? current.endDate,
          }
          const scheduleResult = get().rescheduleItem(
            "task",
            id,
            nextRange.startDate,
            nextRange.endDate,
            inferScheduleChangeMode(current, nextRange),
            source,
          )
          if (!scheduleResult.ok) return scheduleResult
          const remainingPatch: Partial<TaskEntity> = { ...patch }
          delete remainingPatch.startDate
          delete remainingPatch.endDate
          if (!Object.keys(remainingPatch).length) return scheduleResult
          return get().updateTask(id, remainingPatch, source)
        }
        const execution = normalizeExecutionState(current, patch)
        const next = { ...current, ...patch, ...execution, id }
        if (next.endDate < next.startDate)
          return { ok: false, message: "结束日期不能早于开始日期" }
        const changedFields = new Set<keyof TaskEntity>([
          ...(Object.keys(patch) as (keyof TaskEntity)[]),
          "status",
          "progress",
          "statusBeforeBlocked",
        ])
        const changes = [...changedFields]
          .map((field) => [field, next[field]] as const)
          .filter(
            ([field, value]) =>
              JSON.stringify(current[field]) !==
              JSON.stringify(value),
          )
          .map(([field, value]) =>
            historyItem(
              "task",
              id,
              field,
              current[field],
              value,
              source,
            ),
          )
        set((state) => {
          const beforeSync = { ...state.tasks, [id]: next }
          const tasks = reconcileDependencyBlocks(beforeSync, state.dependencies)
          const derived = deriveAllStoryDeliveries({
            stories: state.stories,
            tasks,
            subtasks: state.subtasks,
          })
          const dependencyChanges = Object.values(tasks)
            .filter((task) => task.id !== id)
            .flatMap((after) => {
              const before = beforeSync[after.id]
              if (!before || !after || JSON.stringify(before) === JSON.stringify(after))
                return []
              return [
                historyItem(
                  "task",
                  after.id,
                  "dependency block",
                  before,
                  after,
                  "system",
                ),
              ]
            })
          const impact = changes.some((change) => change.field === "assigneeId")
            ? makeImpactAnalysis(
                { ...state, tasks },
                "task",
                id,
                "assignee",
                [id],
                [current.assigneeId, next.assigneeId],
              )
            : null
          return {
            tasks,
            stories: derived.stories,
            impactAnalyses: appendImpact(state.impactAnalyses, impact),
            history: appendHistory(state.history, [
              ...changes,
              ...dependencyChanges,
              ...derived.history,
              ...(impact
                ? [historyItem("impact", impact.id, "create", null, impact, "system")]
                : []),
            ]),
          }
        })
        return { ok: true, message: "任务已保存" }
      },

      createTask: (storyId, input = {}) => {
        const story = get().stories[storyId]
        if (!story) throw new Error("Story 不存在")
        if (story.sprintId && get().sprints[story.sprintId]?.status === "closed") {
          throw new Error("已关闭 Sprint 中不能新增工程任务")
        }
        const id = input.id ?? makeId("task")
        const execution = normalizeExecutionState(
          { status: "todo", progress: 0, statusBeforeBlocked: null },
          { status: input.status, progress: input.progress },
        )
        const task: TaskEntity = {
          id,
          title: input.title ?? "新工程任务",
          type: input.type ?? "frontend",
          assigneeId: input.assigneeId ?? get().workspace.currentUserId,
          status: execution.status,
          estimate: input.estimate ?? 4,
          progress: execution.progress,
          startDate: input.startDate ?? story.startDate,
          endDate: input.endDate ?? story.dueDate,
          storyId,
          blockReasons: input.blockReasons ?? [],
          blockedSeverity: input.blockedSeverity ?? "normal",
          statusBeforeBlocked:
            input.statusBeforeBlocked ?? execution.statusBeforeBlocked,
          resultSummary: input.resultSummary ?? "",
          resultUrl: input.resultUrl ?? "",
          resultLinks:
            input.resultLinks ?? (input.resultUrl ? [input.resultUrl] : []),
          resultAssetIds: input.resultAssetIds ?? [],
          submittedAt: input.submittedAt ?? null,
          isMilestone: input.isMilestone ?? false,
          qualityStatus: input.qualityStatus ?? "pending",
          qualityNote: input.qualityNote ?? "",
          order: story.taskIds.length,
          subtaskIds: [],
        }
        set((state) => {
          const records: ScheduleRecords = {
            epics: { ...state.epics },
            stories: {
              ...state.stories,
              [storyId]: {
                ...story,
                taskIds: [...story.taskIds, id],
                updatedAt: nowIso(),
              },
            },
            tasks: { ...state.tasks, [id]: task },
            subtasks: state.subtasks,
          }
          expandAncestorSchedules(records, "task", id)
          const derived = deriveStoryDelivery(
            {
              stories: records.stories,
              tasks: records.tasks,
              subtasks: records.subtasks,
            },
            storyId,
          )
          return {
            epics: records.epics,
            stories: derived.stories,
            tasks: records.tasks,
            history: appendHistory(state.history, [
              historyItem("task", id, "create", null, task, "ui"),
              ...derived.history,
            ]),
          }
        })
        return task
      },

      deleteTask: (id) => {
        const state = get()
        const task = state.tasks[id]
        const story = task ? state.stories[task.storyId] : null
        if (!task || !story) return { ok: false, message: "工程任务不存在" }
        const locked = executionWriteGuard(state, "task", id)
        if (locked) return { ok: false, message: locked }
        set((current) => {
          let tasks = { ...current.tasks }
          const subtasks = { ...current.subtasks }
          const dependencies = { ...current.dependencies }
          const assets = Object.fromEntries(
            Object.entries(current.assets).map(([assetId, asset]) => [
              assetId,
              {
                ...asset,
                links: asset.links.filter(
                  (link) => link.targetType !== "task" || link.targetId !== id,
                ),
              },
            ]),
          )
          const discussions = Object.fromEntries(
            Object.entries(current.discussions).filter(
              ([, discussion]) =>
                discussion.targetType !== "task" || discussion.targetId !== id,
            ),
          )
          const risks = Object.fromEntries(
            Object.entries(current.risks).filter(
              ([, risk]) => risk.targetType !== "task" || risk.targetId !== id,
            ),
          )
          delete tasks[id]
          task.subtaskIds.forEach((subtaskId) => delete subtasks[subtaskId])
          Object.values(dependencies).forEach((dependency) => {
            if (dependency.sourceTaskId === id) {
              const target = tasks[dependency.targetTaskId]
              if (target) {
                tasks[dependency.targetTaskId] = removeBlockReason(
                  target,
                  dependencyReasonId(dependency.id),
                )
              }
            }
            if (
              dependency.sourceTaskId === id ||
              dependency.targetTaskId === id
            ) {
              delete dependencies[dependency.id]
            }
          })
          tasks = Object.fromEntries(
            Object.entries(tasks).map(([taskId, item]) => [
              taskId,
              {
                ...item,
                blockReasons: item.blockReasons.map((reason) =>
                  reason.source === "manual" && reason.relatedTaskId === id
                    ? { ...reason, relatedTaskId: null }
                    : reason,
                ),
              },
            ]),
          )
          const normalizedSubtasks = Object.fromEntries(
            Object.entries(subtasks).map(([subtaskId, item]) => [
              subtaskId,
              {
                ...item,
                blockReasons: item.blockReasons.map((reason) =>
                  reason.source === "manual" && reason.relatedTaskId === id
                    ? { ...reason, relatedTaskId: null }
                    : reason,
                ),
              },
            ]),
          )
          delete tasks[id]
          tasks = reconcileDependencyBlocks(tasks, dependencies)
          const baseStories = {
            ...current.stories,
            [story.id]: {
              ...story,
              taskIds: story.taskIds.filter((taskId) => taskId !== id),
              updatedAt: nowIso(),
            },
          }
          const derived = deriveAllStoryDeliveries({
            stories: baseStories,
            tasks,
            subtasks: normalizedSubtasks,
          })
          return {
            tasks,
            subtasks: normalizedSubtasks,
            dependencies,
            assets,
            discussions,
            risks,
            stories: derived.stories,
            history: appendHistory(current.history, [
              historyItem("task", id, "delete", task, null, "ui"),
              ...derived.history,
            ]),
            workspace:
              current.workspace.selectedObjectId === id
                ? {
                    ...current.workspace,
                    selectedObjectId: story.id,
                    selectedObjectType: "story",
                  }
                : current.workspace,
          }
        })
        return { ok: true, message: "工程任务及其 Subtask、依赖已删除" }
      },

      moveTask: (id, storyId, targetIndex = Number.MAX_SAFE_INTEGER) => {
        const task = get().tasks[id]
        const targetStory = get().stories[storyId]
        const sourceStory = task ? get().stories[task.storyId] : null
        if (!task || !targetStory || !sourceStory)
          return { ok: false, message: "任务或 Story 不存在" }
        const locked = executionWriteGuard(get(), "task", id)
        if (locked) return { ok: false, message: locked }
        if (targetStory.sprintId && get().sprints[targetStory.sprintId]?.status === "closed") {
          return { ok: false, message: "不能向已关闭 Sprint 移入工程任务" }
        }
        set((state) => {
          const sourceTaskIds = sourceStory.taskIds.filter(
            (taskId) => taskId !== id,
          )
          const targetTaskIds = targetStory.taskIds.filter(
            (taskId) => taskId !== id,
          )
          targetTaskIds.splice(
            Math.min(targetIndex, targetTaskIds.length),
            0,
            id,
          )
          let tasks = { ...state.tasks, [id]: { ...task, storyId } }
          tasks = resequence(tasks, sourceTaskIds)
          tasks = resequence(tasks, targetTaskIds)
          const stories = {
            ...state.stories,
            [sourceStory.id]: {
              ...sourceStory,
              taskIds: sourceTaskIds,
              updatedAt: nowIso(),
            },
            [targetStory.id]: {
              ...targetStory,
              taskIds: targetTaskIds,
              updatedAt: nowIso(),
            },
          }
          const records: ScheduleRecords = {
            epics: { ...state.epics },
            stories,
            tasks,
            subtasks: state.subtasks,
          }
          expandAncestorSchedules(records, "task", id)
          return {
            epics: records.epics,
            tasks: records.tasks,
            stories: records.stories,
            history: appendHistory(state.history, [
              historyItem("task", id, "move", task, tasks[id], "drag"),
            ]),
          }
        })
        return { ok: true, message: "工程任务已移动" }
      },

      updateSubtask: (id, patch, source = "ui") => {
        const current = get().subtasks[id]
        if (!current) return { ok: false, message: "Subtask 不存在" }
        const locked = executionWriteGuard(get(), "subtask", id)
        if (locked) return { ok: false, message: locked }
        if (patch.status === "blocked" && current.status !== "blocked") {
          return { ok: false, message: "请在右侧详情中添加阻塞原因" }
        }
        if (
          patch.status &&
          patch.status !== "blocked" &&
          current.blockReasons.length > 0
        ) {
          return { ok: false, message: "请先处理现有阻塞原因" }
        }
        const requestedProgress =
          patch.progress === undefined
            ? current.progress
            : clampProgress(patch.progress)
        if (
          current.blockReasons.length > 0 &&
          patch.progress !== undefined &&
          requestedProgress !== current.progress &&
          requestedProgress === 100
        ) {
          return { ok: false, message: "请先处理现有阻塞原因再完成 Subtask" }
        }
        if (patch.startDate !== undefined || patch.endDate !== undefined) {
          const nextRange = {
            startDate: patch.startDate ?? current.startDate,
            endDate: patch.endDate ?? current.endDate,
          }
          const scheduleResult = get().rescheduleItem(
            "subtask",
            id,
            nextRange.startDate,
            nextRange.endDate,
            inferScheduleChangeMode(current, nextRange),
            source,
          )
          if (!scheduleResult.ok) return scheduleResult
          const remainingPatch: Partial<SubtaskEntity> = { ...patch }
          delete remainingPatch.startDate
          delete remainingPatch.endDate
          if (!Object.keys(remainingPatch).length) return scheduleResult
          return get().updateSubtask(id, remainingPatch, source)
        }
        const executionPatch = {
          status:
            patch.done === true
              ? ("done" as const)
              : patch.done === false && current.done && !patch.status
                ? ("todo" as const)
                : patch.status,
          progress: patch.progress,
        }
        const execution = normalizeExecutionState(current, executionPatch)
        const next = {
          ...current,
          ...patch,
          ...execution,
          id,
          done: execution.status === "done",
        }
        if (next.endDate < next.startDate)
          return { ok: false, message: "Subtask 结束日期不能早于开始日期" }
        const changedFields = new Set<keyof SubtaskEntity>([
          ...(Object.keys(patch) as (keyof SubtaskEntity)[]),
          "status",
          "progress",
          "statusBeforeBlocked",
          "done",
        ])
        const changes = [...changedFields]
          .map((field) => [field, next[field]] as const)
          .filter(
            ([field, value]) =>
              JSON.stringify(current[field]) !==
              JSON.stringify(value),
          )
          .map(([field, value]) =>
            historyItem(
              "subtask",
              id,
              field,
              current[field],
              value,
              source,
            ),
          )
        set((state) => {
          const subtasks = { ...state.subtasks, [id]: next }
          const task = state.tasks[next.taskId]
          const derived = task
            ? deriveStoryDelivery(
                { stories: state.stories, tasks: state.tasks, subtasks },
                task.storyId,
              )
            : { stories: state.stories, history: [] }
          const impact =
            task && changes.some((change) => change.field === "assigneeId")
              ? makeImpactAnalysis(
                  { ...state, subtasks },
                  "task",
                  task.id,
                  "assignee",
                  [task.id],
                  [current.assigneeId, next.assigneeId],
                )
              : null
          return {
            subtasks,
            stories: derived.stories,
            impactAnalyses: appendImpact(state.impactAnalyses, impact),
            history: appendHistory(state.history, [
              ...changes,
              ...derived.history,
              ...(impact
                ? [historyItem("impact", impact.id, "create", null, impact, "system")]
                : []),
            ]),
          }
        })
        return { ok: true, message: "Subtask 已保存" }
      },

      deleteSubtask: (id) => {
        const subtask = get().subtasks[id]
        const task = subtask ? get().tasks[subtask.taskId] : null
        if (!subtask || !task) return { ok: false, message: "Subtask 不存在" }
        const locked = executionWriteGuard(get(), "subtask", id)
        if (locked) return { ok: false, message: locked }
        set((state) => {
          const subtasks = { ...state.subtasks }
          delete subtasks[id]
          const tasks = {
            ...state.tasks,
            [task.id]: {
              ...task,
              subtaskIds: task.subtaskIds.filter(
                (subtaskId) => subtaskId !== id,
              ),
            },
          }
          const derived = deriveStoryDelivery(
            { stories: state.stories, tasks, subtasks },
            task.storyId,
          )
          return {
            subtasks,
            tasks,
            stories: derived.stories,
            history: appendHistory(state.history, [
              historyItem("subtask", id, "delete", subtask, null, "ui"),
              ...derived.history,
            ]),
            workspace:
              state.workspace.selectedObjectId === id
                ? {
                    ...state.workspace,
                    selectedObjectType: "task",
                    selectedObjectId: task.id,
                  }
                : state.workspace,
          }
        })
        return { ok: true, message: "Subtask 已删除" }
      },

      reorderSubtask: (id, targetIndex) =>
        set((state) => {
          const subtask = state.subtasks[id]
          if (!subtask) return state
          if (executionWriteGuard(state, "subtask", id)) return state
          const ids = ordered(
            state.subtasks,
            (item) => item.taskId === subtask.taskId,
          )
            .map((item) => item.id)
            .filter((itemId) => itemId !== id)
          ids.splice(Math.min(targetIndex, ids.length), 0, id)
          const subtasks = resequence(state.subtasks, ids)
          return {
            subtasks,
            history: appendHistory(state.history, [
              historyItem(
                "subtask",
                id,
                "order",
                subtask.order,
                subtasks[id].order,
                "drag",
              ),
            ]),
          }
        }),

      addSubtask: (taskId, title) => {
        const task = get().tasks[taskId]
        if (!task) throw new Error("任务不存在")
        const locked = executionWriteGuard(get(), "task", taskId)
        if (locked) throw new Error(locked)
        const id = makeId("subtask")
        const subtask: SubtaskEntity = {
          id,
          taskId,
          title,
          done: false,
          status: "todo",
          estimate: 1,
          progress: 0,
          startDate: task.startDate,
          endDate: task.endDate,
          blockReasons: [],
          blockedSeverity: "normal",
          statusBeforeBlocked: null,
          resultSummary: "",
          resultUrl: "",
          resultLinks: [],
          resultAssetIds: [],
          submittedAt: null,
          qualityStatus: "pending",
          qualityNote: "",
          assigneeId: task.assigneeId,
          order: task.subtaskIds.length,
        }
        set((state) => {
          const subtasks = { ...state.subtasks, [id]: subtask }
          const tasks = {
            ...state.tasks,
            [taskId]: { ...task, subtaskIds: [...task.subtaskIds, id] },
          }
          const derived = deriveStoryDelivery(
            { stories: state.stories, tasks, subtasks },
            task.storyId,
          )
          return {
            subtasks,
            tasks,
            stories: derived.stories,
            history: appendHistory(state.history, [
              historyItem("subtask", id, "create", null, subtask, "ui"),
              ...derived.history,
            ]),
          }
        })
        return subtask
      },

      toggleSubtask: (id) => {
        const subtask = get().subtasks[id]
        if (subtask)
          get().updateSubtask(id, {
            done: !subtask.done,
            status: subtask.done ? "todo" : "done",
            progress: subtask.done ? 0 : 100,
          })
      },

      submitTaskResult: (type, id, result) => {
        const entity =
          type === "task" ? get().tasks[id] : get().subtasks[id]
        if (!entity) return { ok: false, message: "任务不存在" }
        const locked = executionWriteGuard(get(), type, id)
        if (locked) return { ok: false, message: locked }
        const workspace = get().workspace
        if (
          workspace.actorMode === "employee" &&
          entity.assigneeId !== workspace.currentUserId
        ) {
          return { ok: false, message: "员工只能提交自己负责的任务成果" }
        }
        const links = result.links.map((link) => link.trim()).filter(Boolean)
        const invalidLink = links.find((link) => {
          try {
            const url = new URL(link)
            return url.protocol !== "http:" && url.protocol !== "https:"
          } catch {
            return true
          }
        })
        if (invalidLink) {
          return { ok: false, message: "成果链接需以 http:// 或 https:// 开头" }
        }
        const assetIds = [...new Set(result.assetIds)].filter((assetId) =>
          Boolean(get().assets[assetId]),
        )
        if (!result.note.trim() && !links.length && !assetIds.length) {
          return {
            ok: false,
            message: "请至少填写成果说明、外部链接或关联文件",
          }
        }
        const patch = {
          resultSummary: result.note.trim(),
          resultUrl: links[0] ?? "",
          resultLinks: links,
          resultAssetIds: assetIds,
          submittedAt: nowIso(),
        }
        return type === "task"
          ? get().updateTask(id, patch)
          : get().updateSubtask(id, patch)
      },

      acceptStory: (storyId, note = "") => {
        const story = get().stories[storyId]
        if (!story) return { ok: false, message: "Story 不存在" }
        if (story.sprintId && get().sprints[story.sprintId]?.status === "closed") {
          return { ok: false, message: "已关闭 Sprint 中不能继续验收" }
        }
        if (get().workspace.actorMode !== "po") {
          return { ok: false, message: "只有 PO 可以验收 Story" }
        }
        if (story.deliveryStatus !== "pending_acceptance") {
          return { ok: false, message: "只有待验收的 Story 可以通过验收" }
        }
        const record: AcceptanceRecord = {
          id: makeId("acceptance"),
          result: "accepted",
          byId: get().workspace.currentUserId,
          at: nowIso(),
          note: note.trim(),
        }
        set((state) => ({
          stories: {
            ...state.stories,
            [storyId]: {
              ...state.stories[storyId],
              deliveryStatus: "accepted",
              acceptanceLog: [
                ...state.stories[storyId].acceptanceLog,
                record,
              ],
              updatedAt: nowIso(),
            },
          },
          history: appendHistory(state.history, [
            historyItem(
              "acceptance",
              storyId,
              "accepted",
              story.deliveryStatus,
              record,
              "ui",
            ),
          ]),
        }))
        return { ok: true, message: "Story 已验收通过" }
      },

      returnStory: (
        storyId,
        reason,
        reopenIds,
        resetTo = "in_progress",
      ) => {
        const state = get()
        const story = state.stories[storyId]
        if (!story) return { ok: false, message: "Story 不存在" }
        if (story.sprintId && state.sprints[story.sprintId]?.status === "closed") {
          return { ok: false, message: "已关闭 Sprint 中不能退回 Story" }
        }
        if (state.workspace.actorMode !== "po") {
          return { ok: false, message: "只有 PO 可以退回 Story" }
        }
        if (
          story.deliveryStatus !== "pending_acceptance" &&
          story.deliveryStatus !== "accepted"
        ) {
          return { ok: false, message: "只有待验收或已验收 Story 可以退回" }
        }
        if (!reason.trim()) return { ok: false, message: "退回原因必填" }
        if (!reopenIds.length) {
          return { ok: false, message: "退回时必须至少重开一个 Task 或 Subtask" }
        }
        const invalid = reopenIds.find((item) => {
          if (item.type === "task") {
            const task = state.tasks[item.id]
            return !task || task.storyId !== storyId || task.status !== "done"
          }
          const subtask = state.subtasks[item.id]
          const task = subtask ? state.tasks[subtask.taskId] : null
          return !subtask || !task || task.storyId !== storyId || subtask.status !== "done"
        })
        if (invalid) {
          return { ok: false, message: "只能重开该 Story 下已完成的执行项" }
        }
        const record: AcceptanceRecord = {
          id: makeId("acceptance"),
          result: "returned",
          byId: state.workspace.currentUserId,
          at: nowIso(),
          note: reason.trim(),
        }
        set((current) => {
          const tasks = { ...current.tasks }
          const subtasks = { ...current.subtasks }
          reopenIds.forEach((item) => {
            if (item.type === "task") {
              const task = tasks[item.id]
              tasks[item.id] = {
                ...task,
                status: resetTo,
                progress: resetTo === "review" ? 90 : 60,
                statusBeforeBlocked: null,
              }
            } else {
              const subtask = subtasks[item.id]
              subtasks[item.id] = {
                ...subtask,
                status: resetTo,
                progress: resetTo === "review" ? 90 : 60,
                done: false,
                statusBeforeBlocked: null,
              }
            }
          })
          return {
            tasks,
            subtasks,
            stories: {
              ...current.stories,
              [storyId]: {
                ...current.stories[storyId],
                deliveryStatus: "in_progress",
                acceptanceLog: [
                  ...current.stories[storyId].acceptanceLog,
                  record,
                ],
                updatedAt: nowIso(),
              },
            },
            history: appendHistory(current.history, [
              historyItem(
                "acceptance",
                storyId,
                "returned",
                story.deliveryStatus,
                record,
                "ui",
              ),
            ]),
          }
        })
        return { ok: true, message: "Story 已退回并恢复为进行中" }
      },

      addTaskBlockReason: (taskId, message, relatedTaskId = null) => {
        const task = get().tasks[taskId]
        if (!task) return { ok: false, message: "工程任务不存在" }
        const locked = executionWriteGuard(get(), "task", taskId)
        if (locked) return { ok: false, message: locked }
        if (!message.trim()) return { ok: false, message: "请填写阻塞原因" }
        if (relatedTaskId && !get().tasks[relatedTaskId])
          return { ok: false, message: "引用任务不存在" }
        if (relatedTaskId === taskId)
          return { ok: false, message: "阻塞原因不能引用任务自身" }
        const reason: BlockReasonEntity = {
          id: makeId("block"),
          source: "manual",
          message: message.trim(),
          relatedTaskId,
          dependencyId: null,
          createdAt: nowIso(),
        }
        set((state) => {
          const next = addBlockReason(state.tasks[taskId], reason)
          const tasks = reconcileDependencyBlocks(
            { ...state.tasks, [taskId]: next },
            state.dependencies,
          )
          const derived = deriveAllStoryDeliveries({
            stories: state.stories,
            tasks,
            subtasks: state.subtasks,
          })
          return {
            tasks,
            stories: derived.stories,
            history: appendHistory(state.history, [
              historyItem("task", taskId, "block reason", null, reason, "ui"),
              ...derived.history,
            ]),
          }
        })
        return { ok: true, message: "阻塞原因已添加" }
      },

      deleteTaskBlockReason: (taskId, reasonId) => {
        const task = get().tasks[taskId]
        const reason = task?.blockReasons.find((item) => item.id === reasonId)
        if (!task || !reason) return { ok: false, message: "阻塞原因不存在" }
        const locked = executionWriteGuard(get(), "task", taskId)
        if (locked) return { ok: false, message: locked }
        if (reason.source === "dependency" && reason.dependencyId) {
          return get().deleteDependency(reason.dependencyId)
        }
        set((state) => {
          const next = removeBlockReason(state.tasks[taskId], reasonId)
          const tasks = reconcileDependencyBlocks(
            { ...state.tasks, [taskId]: next },
            state.dependencies,
          )
          const derived = deriveAllStoryDeliveries({
            stories: state.stories,
            tasks,
            subtasks: state.subtasks,
          })
          return {
            tasks,
            stories: derived.stories,
            history: appendHistory(state.history, [
              historyItem("task", taskId, "block reason", reason, null, "ui"),
              ...derived.history,
            ]),
          }
        })
        return { ok: true, message: "阻塞原因已删除" }
      },

      addSubtaskBlockReason: (subtaskId, message, relatedTaskId = null) => {
        const subtask = get().subtasks[subtaskId]
        if (!subtask) return { ok: false, message: "Subtask 不存在" }
        const locked = executionWriteGuard(get(), "subtask", subtaskId)
        if (locked) return { ok: false, message: locked }
        if (!message.trim()) return { ok: false, message: "请填写阻塞原因" }
        if (relatedTaskId && !get().tasks[relatedTaskId])
          return { ok: false, message: "引用任务不存在" }
        const reason: BlockReasonEntity = {
          id: makeId("block"),
          source: "manual",
          message: message.trim(),
          relatedTaskId,
          dependencyId: null,
          createdAt: nowIso(),
        }
        set((state) => {
          const next = addBlockReason(state.subtasks[subtaskId], reason)
          const subtasks = { ...state.subtasks, [subtaskId]: next }
          const task = state.tasks[next.taskId]
          const derived = task
            ? deriveStoryDelivery(
                { stories: state.stories, tasks: state.tasks, subtasks },
                task.storyId,
              )
            : { stories: state.stories, history: [] }
          return {
            subtasks,
            stories: derived.stories,
            history: appendHistory(state.history, [
              historyItem(
                "subtask",
                subtaskId,
                "block reason",
                null,
                reason,
                "ui",
              ),
              ...derived.history,
            ]),
          }
        })
        return { ok: true, message: "阻塞原因已添加" }
      },

      deleteSubtaskBlockReason: (subtaskId, reasonId) => {
        const subtask = get().subtasks[subtaskId]
        const reason = subtask?.blockReasons.find((item) => item.id === reasonId)
        if (!subtask || !reason)
          return { ok: false, message: "阻塞原因不存在" }
        const locked = executionWriteGuard(get(), "subtask", subtaskId)
        if (locked) return { ok: false, message: locked }
        set((state) => {
          const next = removeBlockReason(state.subtasks[subtaskId], reasonId)
          const subtasks = { ...state.subtasks, [subtaskId]: next }
          const task = state.tasks[next.taskId]
          const derived = task
            ? deriveStoryDelivery(
                { stories: state.stories, tasks: state.tasks, subtasks },
                task.storyId,
              )
            : { stories: state.stories, history: [] }
          return {
            subtasks,
            stories: derived.stories,
            history: appendHistory(state.history, [
              historyItem(
                "subtask",
                subtaskId,
                "block reason",
                reason,
                null,
                "ui",
              ),
              ...derived.history,
            ]),
          }
        })
        return { ok: true, message: "阻塞原因已删除" }
      },

      addAcceptanceCriterion: (storyId, content) => {
        const story = get().stories[storyId]
        if (!story) throw new Error("Story 不存在")
        if (story.sprintId && get().sprints[story.sprintId]?.status === "closed") {
          throw new Error("已关闭 Sprint 中不能修改验收标准")
        }
        const id = makeId("ac")
        const criterion: AcceptanceCriterion = {
          id,
          storyId,
          content: content.trim(),
          order: story.acceptanceCriteriaIds.length,
          satisfied: false,
        }
        set((state) => ({
          acceptanceCriteria: { ...state.acceptanceCriteria, [id]: criterion },
          stories: {
            ...state.stories,
            [storyId]: {
              ...story,
              acceptanceCriteriaIds: [...story.acceptanceCriteriaIds, id],
              updatedAt: nowIso(),
            },
          },
          history: appendHistory(state.history, [
            historyItem("acceptance", id, "create", null, criterion, "ui"),
          ]),
        }))
        return criterion
      },

      updateAcceptanceCriterion: (id, patch) =>
        set((state) => {
          const current = state.acceptanceCriteria[id]
          if (!current) return state
          const story = state.stories[current.storyId]
          if (story?.sprintId && state.sprints[story.sprintId]?.status === "closed") return state
          const next = { ...current, ...patch, id }
          return {
            acceptanceCriteria: { ...state.acceptanceCriteria, [id]: next },
            history: appendHistory(state.history, [
              historyItem("acceptance", id, "update", current, next, "ui"),
            ]),
          }
        }),

      deleteAcceptanceCriterion: (id) =>
        set((state) => {
          const criterion = state.acceptanceCriteria[id]
          const story = criterion ? state.stories[criterion.storyId] : null
          if (!criterion || !story) return state
          if (story.sprintId && state.sprints[story.sprintId]?.status === "closed") return state
          const acceptanceCriteria = { ...state.acceptanceCriteria }
          delete acceptanceCriteria[id]
          return {
            acceptanceCriteria,
            stories: {
              ...state.stories,
              [story.id]: {
                ...story,
                acceptanceCriteriaIds: story.acceptanceCriteriaIds.filter(
                  (itemId) => itemId !== id,
                ),
                updatedAt: nowIso(),
              },
            },
            history: appendHistory(state.history, [
              historyItem("acceptance", id, "delete", criterion, null, "ui"),
            ]),
          }
        }),

      reorderAcceptanceCriterion: (id, targetIndex) =>
        set((state) => {
          const criterion = state.acceptanceCriteria[id]
          const story = criterion ? state.stories[criterion.storyId] : null
          if (!criterion || !story) return state
          if (story.sprintId && state.sprints[story.sprintId]?.status === "closed") return state
          const ids = story.acceptanceCriteriaIds.filter(
            (itemId) => itemId !== id,
          )
          ids.splice(Math.min(targetIndex, ids.length), 0, id)
          const acceptanceCriteria = resequence(state.acceptanceCriteria, ids)
          return {
            acceptanceCriteria,
            stories: {
              ...state.stories,
              [story.id]: {
                ...story,
                acceptanceCriteriaIds: ids,
                updatedAt: nowIso(),
              },
            },
            history: appendHistory(state.history, [
              historyItem(
                "acceptance",
                id,
                "order",
                criterion.order,
                acceptanceCriteria[id].order,
                "drag",
              ),
            ]),
          }
        }),

      addDependency: (sourceTaskId, targetTaskId) => {
        const state = get()
        if (!state.tasks[sourceTaskId] || !state.tasks[targetTaskId])
          return { ok: false, message: "依赖任务不存在" }
        if (sourceTaskId === targetTaskId)
          return { ok: false, message: "任务不能依赖自身" }
        const sourceLocked = executionWriteGuard(state, "task", sourceTaskId)
        const targetLocked = executionWriteGuard(state, "task", targetTaskId)
        if (sourceLocked || targetLocked) {
          return { ok: false, message: sourceLocked ?? targetLocked! }
        }
        if (
          Object.values(state.dependencies).some(
            (dep) =>
              dep.sourceTaskId === sourceTaskId &&
              dep.targetTaskId === targetTaskId,
          )
        ) {
          return { ok: false, message: "该依赖已存在" }
        }
        if (hasDependencyPath(state.dependencies, targetTaskId, sourceTaskId))
          return { ok: false, message: "已拦截环形依赖" }
        const dependency: DependencyEntity = {
          id: makeId("dep"),
          sourceTaskId,
          targetTaskId,
          type: "FS",
          createdAt: nowIso(),
        }
        set((current) => {
          const target = current.tasks[targetTaskId]
          const dependencies = {
            ...current.dependencies,
            [dependency.id]: dependency,
          }
          const tasks = reconcileDependencyBlocks(current.tasks, dependencies)
          const nextTarget = tasks[targetTaskId]
          const derived = deriveAllStoryDeliveries({
            stories: current.stories,
            tasks,
            subtasks: current.subtasks,
          })
          const impact = makeImpactAnalysis(
            { ...current, dependencies, tasks },
            "dependency",
            dependency.id,
            "dependency",
            [targetTaskId],
          )
          return {
            dependencies,
            tasks,
            stories: derived.stories,
            impactAnalyses: appendImpact(current.impactAnalyses, impact),
            history: appendHistory(current.history, [
              historyItem(
                "dependency",
                dependency.id,
                "create",
                null,
                dependency,
                "ui",
              ),
              ...(nextTarget !== target
                ? [
                    historyItem(
                      "task",
                      targetTaskId,
                      "dependency block",
                      target,
                      nextTarget,
                      "system",
                    ),
                  ]
                : []),
              ...derived.history,
              historyItem("impact", impact.id, "create", null, impact, "system"),
            ]),
          }
        })
        return { ok: true, message: "FS 依赖已创建" }
      },

      deleteDependency: (id) => {
        const dependency = get().dependencies[id]
        if (!dependency) return { ok: false, message: "依赖不存在" }
        const sourceLocked = executionWriteGuard(get(), "task", dependency.sourceTaskId)
        const targetLocked = executionWriteGuard(get(), "task", dependency.targetTaskId)
        if (sourceLocked || targetLocked) {
          return { ok: false, message: sourceLocked ?? targetLocked! }
        }
        set((state) => {
          const dependencies = { ...state.dependencies }
          delete dependencies[id]
          const target = state.tasks[dependency.targetTaskId]
          const tasks = reconcileDependencyBlocks(state.tasks, dependencies)
          const nextTarget = target ? tasks[target.id] : null
          const derived = deriveAllStoryDeliveries({
            stories: state.stories,
            tasks,
            subtasks: state.subtasks,
          })
          const impact = makeImpactAnalysis(
            { ...state, dependencies, tasks },
            "dependency",
            id,
            "dependency",
            [dependency.targetTaskId],
          )
          return {
            dependencies,
            tasks,
            stories: derived.stories,
            impactAnalyses: appendImpact(state.impactAnalyses, impact),
            history: appendHistory(state.history, [
              historyItem("dependency", id, "delete", dependency, null, "ui"),
              ...(target && nextTarget && nextTarget !== target
                ? [
                    historyItem(
                      "task",
                      target.id,
                      "dependency block",
                      target,
                      nextTarget,
                      "system",
                    ),
                  ]
                : []),
              ...derived.history,
              historyItem("impact", impact.id, "create", null, impact, "system"),
            ]),
          }
        })
        return { ok: true, message: "依赖已删除" }
      },

      createAsset: (input) => {
        const id = input.id ?? makeId("asset")
        const links = input.links ?? []
        const state = get()
        if (
          links.some(
            (link) => !assetTargetExists(state, link.targetType, link.targetId),
          )
        ) {
          throw new Error("资产关联对象不存在")
        }
        const asset: DesignAssetEntity = {
          id,
          name: input.name.trim() || "未命名资产",
          kind: input.kind,
          links: links.map((link) => ({ ...link })),
          mimeType:
            input.mimeType ??
            (input.kind === "activity" ||
            input.kind === "use-case" ||
            input.kind === "sequence" ||
            input.kind === "class"
              ? "text/mermaid"
              : "application/octet-stream"),
          storage: input.storage ?? "inline",
          contentRef: input.contentRef ?? "",
          sourceText: input.sourceText ?? "",
          umlData: input.umlData,
          preview: input.preview ?? "",
          version: input.version ?? "v1.0",
          sizeBytes: input.sizeBytes,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }
        set((current) => ({
          assets: { ...current.assets, [id]: asset },
          history: appendHistory(current.history, [
            historyItem("asset", id, "create", null, asset, "ui"),
          ]),
        }))
        return asset
      },

      updateAsset: (id, patch, source = "ui") => {
        const current = get().assets[id]
        if (!current) return { ok: false, message: "设计资产不存在" }
        const next = { ...current, ...patch, id, updatedAt: nowIso() }
        if (
          next.links.some(
            (link) => !assetTargetExists(get(), link.targetType, link.targetId),
          )
        ) {
          return { ok: false, message: "资产关联对象不存在" }
        }
        const changes = Object.entries(patch)
          .filter(
            ([field, value]) =>
              JSON.stringify(current[(field as keyof DesignAssetEntity)]) !==
              JSON.stringify(value),
          )
          .map(([field, value]) =>
            historyItem(
              "asset",
              id,
              field,
              current[(field as keyof DesignAssetEntity)],
              value,
              source,
            ),
          )
        set((state) => ({
          assets: { ...state.assets, [id]: next },
          history: appendHistory(state.history, changes),
        }))
        return { ok: true, message: "设计资产已保存" }
      },

      linkAsset: (id, targetType, targetId) => {
        const asset = get().assets[id]
        if (!asset) return { ok: false, message: "设计资产不存在" }
        if (!assetTargetExists(get(), targetType, targetId))
          return { ok: false, message: "资产关联对象不存在" }
        if (
          asset.links.some(
            (link) =>
              link.targetType === targetType && link.targetId === targetId,
          )
        ) {
          return { ok: false, message: "资产已关联该对象" }
        }
        return get().updateAsset(id, {
          links: [...asset.links, { targetType, targetId }],
        })
      },

      unlinkAsset: (id, targetType, targetId) => {
        const asset = get().assets[id]
        if (!asset) return { ok: false, message: "设计资产不存在" }
        const links = asset.links.filter(
          (link) =>
            link.targetType !== targetType || link.targetId !== targetId,
        )
        if (links.length === asset.links.length)
          return { ok: false, message: "资产未关联该对象" }
        return get().updateAsset(id, { links })
      },

      deleteAsset: (id) => {
        const asset = get().assets[id]
        if (!asset) return { ok: false, message: "设计资产不存在" }
        set((state) => {
          const assets = { ...state.assets }
          delete assets[id]
          return {
            assets,
            history: appendHistory(state.history, [
              historyItem("asset", id, "delete", asset, null, "ui"),
            ]),
          }
        })
        return { ok: true, message: "设计资产已删除" }
      },

      createRisk: (input) => {
        const state = get()
        const targetExists =
          input.targetType === "story"
            ? Boolean(state.stories[input.targetId])
            : input.targetType === "task"
              ? Boolean(state.tasks[input.targetId])
              : Boolean(state.sprints[input.targetId])
        if (!targetExists) throw new Error("风险关联对象不存在")
        if (!input.title.trim()) throw new Error("风险标题不能为空")
        const id = makeId("risk")
        const risk: RiskEntity = {
          ...input,
          id,
          title: input.title.trim(),
          description: input.description.trim(),
          impact: input.impact.trim(),
          mitigation: input.mitigation.trim(),
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }
        set((current) => ({
          risks: { ...current.risks, [id]: risk },
          history: appendHistory(current.history, [
            historyItem("risk", id, "create", null, risk, "ui"),
          ]),
        }))
        return risk
      },

      updateRisk: (id, patch) => {
        const current = get().risks[id]
        if (!current) return { ok: false, message: "风险不存在" }
        const next = { ...current, ...patch, id, updatedAt: nowIso() }
        if (!next.title.trim()) return { ok: false, message: "风险标题不能为空" }
        const state = get()
        const targetExists =
          next.targetType === "story"
            ? Boolean(state.stories[next.targetId])
            : next.targetType === "task"
              ? Boolean(state.tasks[next.targetId])
              : Boolean(state.sprints[next.targetId])
        if (!targetExists) return { ok: false, message: "风险关联对象不存在" }
        set((value) => ({
          risks: { ...value.risks, [id]: next },
          history: appendHistory(value.history, [
            historyItem("risk", id, "update", current, next, "ui"),
          ]),
        }))
        return { ok: true, message: "风险已保存" }
      },

      deleteRisk: (id) => {
        const risk = get().risks[id]
        if (!risk) return { ok: false, message: "风险不存在" }
        set((state) => {
          const risks = { ...state.risks }
          delete risks[id]
          return {
            risks,
            history: appendHistory(state.history, [
              historyItem("risk", id, "delete", risk, null, "ui"),
            ]),
          }
        })
        return { ok: true, message: "风险已删除" }
      },

      addSprintPulse: (input) => {
        if (!get().sprints[input.sprintId]) throw new Error("Sprint 不存在")
        const id = makeId("pulse")
        const pulse: SprintPulseEntity = {
          ...input,
          id,
          focus: input.focus.trim(),
          blockers: input.blockers.trim(),
          notes: input.notes.trim(),
          createdAt: nowIso(),
        }
        set((state) => ({
          sprintPulses: { ...state.sprintPulses, [id]: pulse },
          history: appendHistory(state.history, [
            historyItem("pulse", id, "create", null, pulse, "ui"),
          ]),
        }))
        return pulse
      },

      deleteSprintPulse: (id) => {
        const pulse = get().sprintPulses[id]
        if (!pulse) return { ok: false, message: "Sprint 日志不存在" }
        set((state) => {
          const sprintPulses = { ...state.sprintPulses }
          delete sprintPulses[id]
          return {
            sprintPulses,
            history: appendHistory(state.history, [
              historyItem("pulse", id, "delete", pulse, null, "ui"),
            ]),
          }
        })
        return { ok: true, message: "Sprint 日志已删除" }
      },

      addDiscussion: (targetType, targetId, content) => {
        const state = get()
        const targetExists =
          targetType === "project"
            ? targetId === state.project.id
            : targetType === "story"
              ? Boolean(state.stories[targetId])
              : Boolean(state.tasks[targetId])
        if (!targetExists) return { ok: false, message: "讨论对象不存在" }
        if (!content.trim()) return { ok: false, message: "讨论内容不能为空" }
        const id = makeId("discussion")
        const discussion: DiscussionMessageEntity = {
          id,
          targetType,
          targetId,
          ...(targetType === "story" ? { storyId: targetId } : {}),
          authorId: state.workspace.currentUserId,
          content: content.trim(),
          createdAt: nowIso(),
          isAI: false,
        }
        set((current) => ({
          discussions: { ...current.discussions, [id]: discussion },
          ...(targetType === "story"
            ? {
                stories: {
                  ...current.stories,
                  [targetId]: {
                    ...current.stories[targetId],
                    discussionIds: [...current.stories[targetId].discussionIds, id],
                    updatedAt: nowIso(),
                  },
                },
              }
            : {}),
          history: appendHistory(current.history, [
            historyItem("discussion", id, "create", null, discussion, "ui"),
          ]),
        }))
        return { ok: true, message: "讨论已发送" }
      },

      undoLastChange: () => {
        const state = get()
        const last = [...state.history]
          .reverse()
          .find((item) => item.source !== "undo" && item.objectType !== "impact")
        if (!last) return { ok: false, message: "没有可撤销的修改" }
        if (
          last.field === "schedule" &&
          ["epic", "story", "task", "subtask"].includes(last.objectType) &&
          last.before &&
          typeof last.before === "object"
        ) {
          const restored = restoreHierarchySchedule(
            state,
            last.before as HierarchyScheduleSnapshot,
          )
          set((current) => ({
            ...restored,
            history: appendHistory(current.history, [
              historyItem(
                last.objectType,
                last.objectId,
                "undo schedule",
                last.after,
                last.before,
                "undo",
              ),
            ]),
          }))
          return { ok: true, message: "已撤销层级排期修改" }
        }
        if (last.objectType === "story" && state.stories[last.objectId]) {
          if (
            last.field === "move" &&
            last.before &&
            typeof last.before === "object"
          ) {
            set((current) => ({
              stories: {
                ...current.stories,
                [last.objectId]: last.before as StoryEntity,
              },
              history: appendHistory(current.history, [
                historyItem(
                  "story",
                  last.objectId,
                  "undo move",
                  last.after,
                  last.before,
                  "undo",
                ),
              ]),
            }))
          } else {
            get().updateStory(
              last.objectId,
              { [last.field]: last.before } as Partial<StoryEntity>,
              "undo",
            )
          }
          return { ok: true, message: "已撤销上一步 Story 修改" }
        }
        if (last.objectType === "task" && state.tasks[last.objectId]) {
          if (
            last.field === "move" &&
            last.before &&
            typeof last.before === "object"
          ) {
            const before = last.before as TaskEntity
            get().moveTask(last.objectId, before.storyId, before.order)
          } else {
            get().updateTask(
              last.objectId,
              { [last.field]: last.before } as Partial<TaskEntity>,
              "undo",
            )
          }
          return { ok: true, message: "已撤销上一步任务修改" }
        }
        if (last.objectType === "subtask" && state.subtasks[last.objectId]) {
          get().updateSubtask(
            last.objectId,
            { [last.field]: last.before } as Partial<SubtaskEntity>,
            "undo",
          )
          return { ok: true, message: "已撤销上一步 Subtask 修改" }
        }
        if (
          last.objectType === "activity" &&
          state.activities[last.objectId] &&
          typeof last.before === "number"
        ) {
          get().moveActivity(last.objectId, last.before)
          return { ok: true, message: "已撤销 Activity 移动" }
        }
        if (
          last.objectType === "userTask" &&
          state.userTasks[last.objectId] &&
          last.before &&
          typeof last.before === "object"
        ) {
          const before = last.before as UserTaskEntity
          get().moveUserTask(last.objectId, before.activityId, before.order)
          return { ok: true, message: "已撤销 User Task 移动" }
        }
        if (
          last.objectType === "epic" &&
          state.epics[last.objectId] &&
          last.before &&
          typeof last.before === "object"
        ) {
          const before = last.before as EpicEntity
          get().moveEpic(last.objectId, before.userTaskId, before.order)
          return { ok: true, message: "已撤销 Epic 移动" }
        }
        return { ok: false, message: "该操作暂不支持撤销" }
      },

      exportProjectJson: () => JSON.stringify(dataSnapshot(get()), null, 2),

      importProjectJson: (json) => {
        try {
          const parsed = JSON.parse(json) as ProjectDataState
          importSchema.parse(parsed)
          const migrated = normalizeProjectData(parsed)
          set({
            ...migrated,
            history: appendHistory(migrated.history ?? [], [
              historyItem(
                "project",
                migrated.project.id,
                "import",
                null,
                "JSON",
                "import",
              ),
            ]),
          })
          return { ok: true, message: "项目 JSON 已导入" }
        } catch (error) {
          return {
            ok: false,
            message:
              error instanceof Error
                ? `导入失败：${error.message}`
                : "导入失败",
          }
        }
      },

      resetDemoData: () => set(createInitialProjectState()),
    }),
    {
      name: "scrumflow-course-project-v2",
      version: CURRENT_SCHEMA_VERSION,
      storage: createJSONStorage(() =>
        typeof window === "undefined" || import.meta.env.MODE === "test"
          ? memoryStorage
          : localProjectStorage,
      ),
      partialize: (state) => dataSnapshot(state),
      migrate: (persisted, version) => {
        if (!persisted || version >= CURRENT_SCHEMA_VERSION)
          return persisted as ProjectDataState
        return normalizeProjectData(persisted as Partial<ProjectDataState>)
      },
      merge: (persisted, current) => ({
        ...current,
        ...normalizeProjectData(persisted as Partial<ProjectDataState>),
      }),
    },
  ),
)

export function resetProjectStoreForTests() {
  useProjectStore.setState({ ...createInitialProjectState() })
}
