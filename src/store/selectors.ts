import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns"
import { buildWorkloadSnapshot, projectDate } from "../utils/workloadAnalysis"
import type {
  AgentProposal,
  AssetLinkTargetType,
  BlockReasonEntity,
  ProjectDataState,
  StoryEntity,
  SubtaskEntity,
  TaskEntity,
  TaskStatus,
} from "../types"

const PENDING_PROPOSAL_STATUSES: AgentProposal["status"][] = [
  "draft",
  "reviewed",
  "partially_applied",
  "failed",
]

/** 整单状态中文展示：全是 stale 时显示"已失效"，与真正执行失败区分。仅展示层，不改契约值。 */
export function proposalStatusLabel(proposal: AgentProposal) {
  if (proposal.status === "failed") {
    const failed = proposal.actions.filter(
      (action) => action.decision === "accepted" && action.status === "failed",
    ).length
    const stale = proposal.actions.filter(
      (action) => action.decision === "accepted" && action.status === "stale",
    ).length
    if (failed === 0 && stale > 0) return "已失效"
    return "失败"
  }
  if (proposal.status === "partially_applied") return "部分执行"
  if (proposal.status === "applied") return "已执行"
  if (proposal.status === "rejected") return "已忽略"
  if (proposal.status === "reviewed") return "待确认"
  if (proposal.status === "applying") return "执行中"
  return "待确认"
}

/** 需要用户处理的 Proposal：待确认、部分执行或执行失败（含失效）。 */
export function selectPendingProposals(state: Pick<ProjectDataState, "proposals">) {
  return Object.values(state.proposals)
    .filter((proposal) => PENDING_PROPOSAL_STATUSES.includes(proposal.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function selectPendingActionCount(state: Pick<ProjectDataState, "proposals">) {
  return selectPendingProposals(state).reduce(
    (sum, proposal) =>
      sum + proposal.actions.filter((action) => action.decision === "pending").length,
    0,
  )
}

export function byOrder<T extends { order: number }>(items: T[]) {
  return [...items].sort((a, b) => a.order - b.order)
}

export function selectActivities(state: ProjectDataState) {
  return byOrder(Object.values(state.activities))
}

export function selectUserTasks(state: ProjectDataState, activityId?: string) {
  return byOrder(
    Object.values(state.userTasks).filter(
      (task) => !activityId || task.activityId === activityId,
    ),
  )
}

export function selectEpics(state: ProjectDataState, userTaskId?: string) {
  return byOrder(
    Object.values(state.epics).filter(
      (epic) => !userTaskId || epic.userTaskId === userTaskId,
    ),
  )
}

export function selectStories(
  state: ProjectDataState,
  options: {
    epicId?: string | null
    sprintId?: string | null
    backlogOnly?: boolean
  } = {},
) {
  return byOrder(
    Object.values(state.stories).filter((story) => {
      if (options.backlogOnly && story.sprintId !== null) return false
      if ("epicId" in options && story.epicId !== options.epicId) return false
      if ("sprintId" in options && story.sprintId !== options.sprintId)
        return false
      return true
    }),
  )
}

export function selectBacklogStories(state: ProjectDataState) {
  return selectStories(state, { backlogOnly: true })
}

export function selectSprintStories(state: ProjectDataState, sprintId: string) {
  return selectStories(state, { sprintId })
}

export function selectSprintTasks(state: ProjectDataState, sprintId: string) {
  const storyIds = new Set(
    selectSprintStories(state, sprintId).map((story) => story.id),
  )
  return byOrder(
    Object.values(state.tasks).filter((task) => storyIds.has(task.storyId)),
  )
}

export function selectSprintSubtasks(
  state: ProjectDataState,
  sprintId: string,
) {
  const taskIds = new Set(
    selectSprintTasks(state, sprintId).map((task) => task.id),
  )
  return byOrder(
    Object.values(state.subtasks).filter((subtask) =>
      taskIds.has(subtask.taskId),
    ),
  )
}

export function selectStoryTasks(state: ProjectDataState, storyId: string) {
  return byOrder(
    Object.values(state.tasks).filter((task) => task.storyId === storyId),
  )
}

export function selectTaskSubtasks(state: ProjectDataState, taskId: string) {
  return byOrder(
    Object.values(state.subtasks).filter(
      (subtask) => subtask.taskId === taskId,
    ),
  )
}

export function selectStoryCriteria(state: ProjectDataState, storyId: string) {
  return byOrder(
    Object.values(state.acceptanceCriteria).filter(
      (criterion) => criterion.storyId === storyId,
    ),
  )
}

export function selectAssetsForTarget(
  state: ProjectDataState,
  targetType: AssetLinkTargetType,
  targetId: string,
) {
  return Object.values(state.assets).filter((asset) =>
    asset.links.some(
      (link) => link.targetType === targetType && link.targetId === targetId,
    ),
  )
}

export function selectStoryAssets(state: ProjectDataState, storyId: string) {
  return selectAssetsForTarget(state, "story", storyId).sort((a, b) => {
    const rank = (kind: string) => kind === "activity" ? 0 : ["use-case", "sequence", "class"].includes(kind) ? 1 : 2
    return rank(a.kind) - rank(b.kind) || b.updatedAt.localeCompare(a.updatedAt)
  })
}

export function selectTaskAssets(state: ProjectDataState, taskId: string) {
  return selectAssetsForTarget(state, "task", taskId)
}

export function selectSprintAssets(state: ProjectDataState, sprintId: string) {
  return selectAssetsForTarget(state, "sprint", sprintId)
}

export function selectSprintMetrics(state: ProjectDataState, sprintId: string, now = new Date()) {
  const stories = selectSprintStories(state, sprintId)
  const tasks = selectSprintTasks(state, sprintId)
  const statusCounts: Record<TaskEntity["status"], number> = {
    todo: 0,
    in_progress: 0,
    review: 0,
    done: 0,
    blocked: 0,
  }
  const memberHours = Object.fromEntries(Object.entries(buildWorkloadSnapshot(state, sprintId, now).members).map(([id, member]) => [id, member.currentSprintWorkload]))
  tasks.forEach((task) => {
    statusCounts[task.status] += 1
  })
  const subtasks = selectSprintSubtasks(state, sprintId)
  const blockedReasons = [
    ...tasks.flatMap((task) =>
      task.blockReasons.map((reason) => ({
        entityType: "task" as const,
        entityId: task.id,
        title: task.title,
        storyId: task.storyId,
        reason,
      })),
    ),
    ...subtasks.flatMap((subtask) => {
      const task = state.tasks[subtask.taskId]
      return subtask.blockReasons.map((reason) => ({
        entityType: "subtask" as const,
        entityId: subtask.id,
        title: subtask.title,
        storyId: task?.storyId ?? "",
        reason,
      }))
    }),
  ]
  return {
    storyCount: stories.length,
    taskCount: tasks.length,
    pendingAcceptanceCount: stories.filter(
      (story) => story.deliveryStatus === "pending_acceptance",
    ).length,
    acceptedStoryCount: stories.filter(
      (story) => story.deliveryStatus === "accepted",
    ).length,
    riskStoryCount: stories.filter((story) => story.risk !== "none").length,
    statusCounts,
    memberHours,
    blockedReasons,
  }
}

export interface StoryExecutionLeaf {
  type: "task" | "subtask"
  id: string
  title: string
  assigneeId: string
  status: TaskStatus
  progress: number
  blockReasons: BlockReasonEntity[]
  submittedAt: string | null
  resultSummary: string
  resultLinks: string[]
  resultAssetIds: string[]
  parentTaskId: string | null
}

export function selectStoryExecutionLeaves(
  state: ProjectDataState,
  storyId: string,
): StoryExecutionLeaf[] {
  const leaves: StoryExecutionLeaf[] = []
  selectStoryTasks(state, storyId).forEach((task) => {
    const subtasks = selectTaskSubtasks(state, task.id)
    if (subtasks.length) {
      leaves.push(
        ...subtasks.map((subtask) => ({
          type: "subtask" as const,
          id: subtask.id,
          title: subtask.title,
          assigneeId: subtask.assigneeId,
          status: subtask.status,
          progress: subtask.progress,
          blockReasons: subtask.blockReasons,
          submittedAt: subtask.submittedAt,
          resultSummary: subtask.resultSummary,
          resultLinks: subtask.resultLinks,
          resultAssetIds: subtask.resultAssetIds,
          parentTaskId: task.id,
        })),
      )
    } else {
      leaves.push({
        type: "task",
        id: task.id,
        title: task.title,
        assigneeId: task.assigneeId,
        status: task.status,
        progress: task.progress,
        blockReasons: task.blockReasons,
        submittedAt: task.submittedAt,
        resultSummary: task.resultSummary,
        resultLinks: task.resultLinks,
        resultAssetIds: task.resultAssetIds,
        parentTaskId: null,
      })
    }
  })
  return leaves
}

export function selectAcceptanceBuckets(
  state: ProjectDataState,
  sprintId: string,
) {
  const stories = selectSprintStories(state, sprintId)
  const wasReturned = (story: StoryEntity) =>
    story.deliveryStatus === "in_progress" &&
    story.acceptanceLog.at(-1)?.result === "returned"
  return {
    pending: stories.filter(
      (story) => story.deliveryStatus === "pending_acceptance",
    ),
    returned: stories.filter(wasReturned),
    inFlight: stories.filter(
      (story) =>
        (story.deliveryStatus === "planned" ||
          story.deliveryStatus === "in_progress" ||
          story.deliveryStatus === "returned") &&
        !wasReturned(story),
    ),
    accepted: stories.filter(
      (story) => story.deliveryStatus === "accepted",
    ),
  }
}

export function selectProjectCompletion(state: ProjectDataState) {
  const stories = Object.values(state.stories).filter(
    (story) => story.maturityStatus === "ready" || story.sprintId !== null,
  )
  let weightedScore = 0
  let totalPoints = 0
  let acceptedPoints = 0
  let pendingAcceptancePoints = 0
  stories.forEach((story) => {
    const points = Math.max(0, story.storyPoints)
    const leaves = selectStoryExecutionLeaves(state, story.id)
    const execution = leaves.length
      ? leaves.reduce((sum, leaf) => {
          const blockedPenalty = leaf.blockReasons.length ? 0.85 : 1
          return sum + leaf.progress * blockedPenalty
        }, 0) / leaves.length
      : 0
    const score =
      story.deliveryStatus === "accepted"
        ? 100
        : story.deliveryStatus === "pending_acceptance"
          ? Math.min(90, 70 + execution * 0.2)
          : execution * 0.7
    totalPoints += points
    weightedScore += score * points
    if (story.deliveryStatus === "accepted") acceptedPoints += points
    if (story.deliveryStatus === "pending_acceptance") {
      pendingAcceptancePoints += points
    }
  })
  return {
    percent:
      totalPoints > 0 ? Math.round(weightedScore / totalPoints) : 0,
    acceptedPoints,
    pendingAcceptancePoints,
    totalPoints,
  }
}

export function selectStorySummaryDates(
  state: ProjectDataState,
  storyId: string,
) {
  const story = state.stories[storyId]
  if (!story) return { startDate: "", endDate: "" }
  return { startDate: story.startDate, endDate: story.dueDate }
}

export function selectStoryProgress(state: ProjectDataState, storyId: string) {
  const tasks = selectStoryTasks(state, storyId)
  if (!tasks.length)
    return state.stories[storyId]?.deliveryStatus === "accepted" ? 100 : 0
  const leafProgress = tasks.map((task) => {
    const subtasks = selectTaskSubtasks(state, task.id)
    return subtasks.length
      ? subtasks.reduce((sum, subtask) => sum + subtask.progress, 0) /
          subtasks.length
      : task.progress
  })
  return Math.round(
    leafProgress.reduce((sum, progress) => sum + progress, 0) /
      leafProgress.length,
  )
}

export function storyDisplayStatus(story: StoryEntity): TaskEntity["status"] {
  if (story.deliveryStatus === "accepted") return "done"
  if (story.deliveryStatus === "pending_acceptance") return "review"
  if (story.deliveryStatus === "in_progress") return "in_progress"
  return "todo"
}

export function storyReadyIssues(story: StoryEntity) {
  const issues: string[] = []
  if (!story.title.trim()) issues.push("名称")
  if (!story.epicId) issues.push("Epic")
  if (!story.as.trim() || !story.iWant.trim() || !story.soThat.trim())
    issues.push("三段式描述")
  return issues
}

export function selectIncomingDependencies(
  state: ProjectDataState,
  taskId: string,
) {
  return Object.values(state.dependencies).filter(
    (dependency) => dependency.targetTaskId === taskId,
  )
}

export function selectOutgoingDependencies(
  state: ProjectDataState,
  taskId: string,
) {
  return Object.values(state.dependencies).filter(
    (dependency) => dependency.sourceTaskId === taskId,
  )
}

export function selectBlockedByIncompletePredecessor(
  state: ProjectDataState,
  taskId: string,
) {
  return selectIncomingDependencies(state, taskId).some(
    (dependency) => state.tasks[dependency.sourceTaskId]?.status !== "done",
  )
}

export function selectCriticalPathTaskIds(state: ProjectDataState) {
  const taskIds = Object.keys(state.tasks)
  const predecessors = new Map<string, string[]>()
  const successors = new Map<string, string[]>()
  Object.values(state.dependencies).forEach((dependency) => {
    predecessors.set(dependency.targetTaskId, [
      ...(predecessors.get(dependency.targetTaskId) ?? []),
      dependency.sourceTaskId,
    ])
    successors.set(dependency.sourceTaskId, [
      ...(successors.get(dependency.sourceTaskId) ?? []),
      dependency.targetTaskId,
    ])
  })

  const indegree = new Map(
    taskIds.map((id) => [id, predecessors.get(id)?.length ?? 0]),
  )
  const queue = taskIds.filter((id) => (indegree.get(id) ?? 0) === 0)
  const distance = new Map<string, number>()
  const previous = new Map<string, string | null>()
  taskIds.forEach((id) => {
    const task = state.tasks[id]
    distance.set(
      id,
      Math.max(
        1,
        differenceInCalendarDays(
          parseISO(task.endDate),
          parseISO(task.startDate),
        ) + 1,
      ),
    )
    previous.set(id, null)
  })

  while (queue.length) {
    const current = queue.shift()!
    for (const next of successors.get(current) ?? []) {
      const task = state.tasks[next]
      const duration = Math.max(
        1,
        differenceInCalendarDays(
          parseISO(task.endDate),
          parseISO(task.startDate),
        ) + 1,
      )
      const candidate = (distance.get(current) ?? 0) + duration
      if (candidate > (distance.get(next) ?? 0)) {
        distance.set(next, candidate)
        previous.set(next, current)
      }
      indegree.set(next, (indegree.get(next) ?? 1) - 1)
      if (indegree.get(next) === 0) queue.push(next)
    }
  }

  const end = [...distance.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (!end) return new Set<string>()
  const path = new Set<string>()
  let current: string | null = end
  while (current) {
    path.add(current)
    current = previous.get(current) ?? null
  }
  return path
}

export function selectVisibleStories(state: ProjectDataState) {
  const {
    selectedSprintId,
    memberFilterId,
    statusFilter,
    riskFilter,
    showCompletedStories,
  } = state.workspace
  return Object.values(state.stories).filter((story) => {
    if (story.sprintId !== selectedSprintId && story.sprintId !== null)
      return false
    if (memberFilterId && story.assigneeId !== memberFilterId) return false
    if (statusFilter !== "all" && story.deliveryStatus !== statusFilter)
      return false
    if (riskFilter !== "all" && story.risk !== riskFilter) return false
    if (!showCompletedStories && story.deliveryStatus === "accepted")
      return false
    return true
  })
}

export function selectRisks(
  state: ProjectDataState,
  targetType?: "story" | "task" | "sprint",
  targetId?: string,
) {
  return Object.values(state.risks)
    .filter((risk) => !targetType || risk.targetType === targetType)
    .filter((risk) => !targetId || risk.targetId === targetId)
    .sort((a, b) => {
      const rank = { high: 3, medium: 2, low: 1 }
      return rank[b.level] - rank[a.level] || b.updatedAt.localeCompare(a.updatedAt)
    })
}

export function selectActiveRisks(state: ProjectDataState) {
  return selectRisks(state).filter((risk) => risk.status !== "resolved")
}

export function selectStoryRiskLevel(state: ProjectDataState, storyId: string) {
  const story = state.stories[storyId]
  const levels = [
    story?.risk ?? "none",
    ...selectRisks(state, "story", storyId)
      .filter((risk) => risk.status !== "resolved")
      .map((risk) => risk.level),
  ]
  const rank = { none: 0, low: 1, medium: 2, high: 3 }
  return levels.sort((a, b) => rank[b] - rank[a])[0] ?? "none"
}

export function selectDiscussions(
  state: ProjectDataState,
  targetType: "project" | "story" | "task",
  targetId: string,
) {
  return Object.values(state.discussions)
    .filter(
      (message) =>
        message.targetType === targetType && message.targetId === targetId,
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function selectImpacts(
  state: ProjectDataState,
  triggerType?: "story" | "task" | "dependency",
  triggerId?: string,
) {
  return [...state.impactAnalyses]
    .filter((impact) => !triggerType || impact.triggerType === triggerType)
    .filter((impact) => !triggerId || impact.triggerId === triggerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function selectScheduleHealth(
  startDate: string,
  endDate: string,
  actualProgress: number,
  today = projectDate(),
) {
  const totalDays = Math.max(
    1,
    differenceInCalendarDays(parseISO(endDate), parseISO(startDate)) + 1,
  )
  const elapsedDays = Math.min(
    totalDays,
    Math.max(
      0,
      differenceInCalendarDays(parseISO(today), parseISO(startDate)) + 1,
    ),
  )
  const expectedProgress = Math.round((elapsedDays / totalDays) * 100)
  const variance = Math.round(actualProgress - expectedProgress)
  return {
    expectedProgress,
    actualProgress: Math.round(actualProgress),
    variance,
    overdue: today > endDate && actualProgress < 100,
  }
}

export function selectTaskVisualState(
  task: Pick<TaskEntity, "status" | "progress" | "endDate" | "blockedSeverity">,
  today = new Date().toISOString().slice(0, 10),
) {
  if (task.status === "blocked" && task.blockedSeverity === "severe") {
    return "severe-blocked" as const
  }
  if (today > task.endDate && task.progress < 100) return "overdue" as const
  return task.status
}

export function selectMemberWorkload(state: ProjectDataState, memberId: string, now = new Date(), sprintId = state.workspace.selectedSprintId) {
  const taskLeaves: Array<TaskEntity | SubtaskEntity> = []
  Object.values(state.tasks).forEach((task) => {
    if (state.stories[task.storyId]?.sprintId !== sprintId) return
    const children = selectTaskSubtasks(state, task.id)
    taskLeaves.push(...(children.length ? children : [task]))
  })
  const allAssigned = taskLeaves.filter((item) => item.assigneeId === memberId)
  const assigned = allAssigned.filter((item) => item.status !== "done" && !("taskId" in item && state.tasks[item.taskId]?.status === "done"))
  const snapshot = buildWorkloadSnapshot(state, sprintId, now)
  const analysis = snapshot.members[memberId]
  const plannedHours = analysis?.currentSprintWorkload ?? 0
  const capacityHours = analysis?.remainingTimeCapacity ?? 0
  const utilization = capacityHours
    ? Math.round((plannedHours / capacityHours) * 100)
    : plannedHours
      ? 100
      : 0
  return {
    memberId,
    taskCount: assigned.length,
    plannedHours,
    capacityHours,
    planningCapacity: analysis?.planningCapacity ?? 0,
    totalWorkload: analysis?.totalWorkload ?? 0,
    remainingCapacity: analysis?.remainingCapacity ?? 0,
    calculationDate: snapshot.currentDate,
    utilization,
    overdueCount: assigned.filter(
      (item) => selectScheduleHealth(item.startDate, item.endDate, item.progress).overdue,
    ).length,
    blockedCount: assigned.filter((item) => item.status === "blocked").length,
    qualityAttentionCount: assigned.filter(
      (item) => item.qualityStatus === "attention",
    ).length,
    completedCount: allAssigned.filter((item) => item.status === "done").length,
    onTimeCount: allAssigned.filter(
      (item) =>
        item.status === "done" &&
        (!item.submittedAt || item.submittedAt.slice(0, 10) <= item.endDate),
    ).length,
    reworkCount: Object.values(state.stories).filter(
      (story) =>
        story.assigneeId === memberId &&
        story.acceptanceLog.some((record) => record.result === "returned"),
    ).length,
    stalledCount: assigned.filter((item) => {
      const lastProgress = [...state.history]
        .reverse()
        .find(
          (history) =>
            history.objectId === item.id &&
            ["progress", "status", "resultSummary"].includes(history.field),
        )
      if (!lastProgress) return false
      return differenceInCalendarDays(new Date(), parseISO(lastProgress.createdAt)) >= 3
    }).length,
  }
}

export function selectTeamWorkloads(state: ProjectDataState, now = new Date(), sprintId = state.workspace.selectedSprintId) {
  return Object.values(state.members)
    .map((member) => ({ member, ...selectMemberWorkload(state, member.id, now, sprintId) }))
    .sort((a, b) => b.utilization - a.utilization)
}

export function selectDailyWorkloadHeatmap(
  state: ProjectDataState,
  anchorDate = new Date().toISOString().slice(0, 10),
  daysBefore = 14,
  daysAfter = 14,
) {
  const anchor = parseISO(anchorDate)
  const dates = Array.from({ length: daysBefore + daysAfter + 1 }, (_, index) => {
    const value = addDays(anchor, index - daysBefore)
    const date = format(value, "yyyy-MM-dd")
    const day = value.getDay()
    return {
      date,
      dateLabel: format(value, "MM/dd"),
      dayLabel: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][day],
      isToday: date === anchorDate,
      isWeekend: day === 0 || day === 6,
    }
  })
  const leaves: Array<TaskEntity | SubtaskEntity> = []
  Object.values(state.tasks).forEach((task) => {
    const children = selectTaskSubtasks(state, task.id)
    leaves.push(...(children.length ? children : [task]))
  })
  const rows = Object.values(state.members).map((member) => {
    const assigned = leaves.filter((item) => item.assigneeId === member.id)
    const details = dates.map(({ date }) =>
      assigned.flatMap((item) => {
        if (date < item.startDate || date > item.endDate) return []
        const duration = Math.max(
          1,
          differenceInCalendarDays(parseISO(item.endDate), parseISO(item.startDate)) + 1,
        )
        const isSubtask = "taskId" in item
        return [{
          type: isSubtask ? "subtask" as const : "task" as const,
          id: item.id,
          taskId: isSubtask ? item.taskId : item.id,
          title: item.title,
          allocatedHours: Math.round((item.estimate / duration) * 10) / 10,
          startDate: item.startDate,
          endDate: item.endDate,
        }]
      }),
    )
    const cells = details.map((items) =>
      Math.round(items.reduce((total, item) => total + item.allocatedHours, 0) * 10) / 10,
    )
    return {
      member,
      cells,
      details,
      totalHours: Math.round(cells.reduce((sum, hours) => sum + hours, 0) * 10) / 10,
    }
  })
  const maxHours = Math.max(0, ...rows.flatMap((row) => row.cells))
  return { anchorDate, dates, rows, maxHours }
}

export type DailyActualWorkloadDetail = {
  type: "progress" | "submission"
  entityType: "task" | "subtask"
  id: string
  taskId: string
  title: string
  score: number
  progressDelta?: number
  estimate: number
  businessValue: number
  resultSummary?: string
  submittedAt?: string
  linkCount?: number
  assetCount?: number
}

function stableWorkloadWeight(seed: string) {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return 0.7 + ((hash >>> 0) % 601) / 1000
}

export function selectDailyActualWorkloadHeatmap(
  state: ProjectDataState,
  anchorDate = new Date().toISOString().slice(0, 10),
  daysBefore = 41,
) {
  const anchor = parseISO(anchorDate)
  const dates = Array.from({ length: daysBefore + 1 }, (_, index) => {
    const value = addDays(anchor, index - daysBefore)
    const date = format(value, "yyyy-MM-dd")
    const day = value.getDay()
    return {
      date,
      dateLabel: format(value, "MM/dd"),
      dayLabel: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][day],
      isToday: date === anchorDate,
      isWeekend: day === 0 || day === 6,
    }
  })
  const dateIndex = new Map(dates.map((item, index) => [item.date, index]))
  const leaves: Array<TaskEntity | SubtaskEntity> = []
  Object.values(state.tasks).forEach((task) => {
    const children = selectTaskSubtasks(state, task.id)
    leaves.push(...(children.length ? children : [task]))
  })
  const rows = Object.values(state.members).map((member) => {
    const details: DailyActualWorkloadDetail[][] = dates.map(() => [])
    leaves
      .filter((item) => item.assigneeId === member.id)
      .forEach((item) => {
        const isSubtask = "taskId" in item
        const parentTask = isSubtask ? state.tasks[item.taskId] : item
        const businessValue = state.stories[parentTask?.storyId]?.businessValue ?? 1
        const valueFactor = 0.7 + businessValue * 0.12
        const progressEndDate = item.endDate < anchorDate ? item.endDate : anchorDate
        const progressDates = dates
          .map((date) => date.date)
          .filter((date) => date >= item.startDate && date <= progressEndDate)
        if (item.progress > 0 && progressDates.length) {
          const weights = progressDates.map((date) => stableWorkloadWeight(`${item.id}:${date}`))
          const weightTotal = weights.reduce((sum, weight) => sum + weight, 0)
          progressDates.forEach((date, progressIndex) => {
            const progressDelta = Math.round((item.progress * weights[progressIndex] / weightTotal) * 10) / 10
            const score = Math.round((item.estimate * (progressDelta / 100) * valueFactor) * 100) / 100
            details[dateIndex.get(date)!].push({
              type: "progress",
              entityType: isSubtask ? "subtask" : "task",
              id: item.id,
              taskId: isSubtask ? item.taskId : item.id,
              title: item.title,
              score,
              progressDelta,
              estimate: item.estimate,
              businessValue,
            })
          })
        }
        const submittedDate = item.submittedAt?.slice(0, 10)
        const submittedIndex = submittedDate ? dateIndex.get(submittedDate) : undefined
        if (submittedDate && submittedIndex !== undefined) {
          const linkCount = item.resultLinks.length + (item.resultUrl ? 1 : 0)
          const resultSummary = item.resultSummary.trim()
            || (linkCount || item.resultAssetIds.length
              ? `提交 ${linkCount} 个链接、${item.resultAssetIds.length} 个设计资产`
              : "提交任务成果")
          details[submittedIndex].push({
            type: "submission",
            entityType: isSubtask ? "subtask" : "task",
            id: item.id,
            taskId: isSubtask ? item.taskId : item.id,
            title: item.title,
            score: Math.round((item.estimate * 0.15 * valueFactor) * 100) / 100,
            estimate: item.estimate,
            businessValue,
            resultSummary,
            submittedAt: item.submittedAt ?? undefined,
            linkCount,
            assetCount: item.resultAssetIds.length,
          })
        }
      })
    const cells = details.map((items) =>
      Math.round(items.reduce((total, item) => total + item.score, 0) * 100) / 100,
    )
    return {
      member,
      cells,
      details,
      totalScore: Math.round(cells.reduce((sum, score) => sum + score, 0) * 10) / 10,
    }
  })
  const maxScore = Math.max(0, ...rows.flatMap((row) => row.cells))
  return { anchorDate, dates, rows, maxScore }
}

export function selectCapabilityMatch(
  state: ProjectDataState,
  memberId: string,
  taskType: TaskEntity["type"],
) {
  const role = (state.members[memberId]?.role ?? "").toLowerCase()
  const keywords: Record<TaskEntity["type"], string[]> = {
    frontend: ["frontend", "front end", "full stack", "design"],
    backend: ["backend", "back end", "full stack"],
    database: ["backend", "database", "data", "full stack"],
    test: ["test", "quality", "qa", "full stack"],
    design: ["design", "ux", "ui", "frontend"],
    devops: ["devops", "ops", "backend", "full stack"],
  }
  const matched = keywords[taskType].some((keyword) => role.includes(keyword))
  return {
    matched,
    label: matched ? "角色能力匹配" : "需确认专业能力",
    detail: `${state.members[memberId]?.role ?? "未设置角色"} / ${taskType}`,
  }
}

export function selectSprintAnalytics(state: ProjectDataState, sprintId: string) {
  const sprint = state.sprints[sprintId]
  const stories = selectSprintStories(state, sprintId)
  const tasks = selectSprintTasks(state, sprintId)
  const completed = tasks.filter((task) => task.status === "done")
  const totalEstimate = tasks.reduce((sum, task) => sum + task.estimate, 0)
  const completedEstimate = completed.reduce((sum, task) => sum + task.estimate, 0)
  const activeRisks = selectActiveRisks(state).filter(
    (risk) =>
      (risk.targetType === "sprint" && risk.targetId === sprintId) ||
      (risk.targetType === "story" && stories.some((story) => story.id === risk.targetId)) ||
      (risk.targetType === "task" && tasks.some((task) => task.id === risk.targetId)),
  )
  return {
    sprint,
    storyCount: stories.length,
    acceptedStoryCount: stories.filter((story) => story.deliveryStatus === "accepted").length,
    taskCount: tasks.length,
    completedTaskCount: completed.length,
    blockedTaskCount: tasks.filter((task) => task.status === "blocked").length,
    overdueTaskCount: tasks.filter(
      (task) => selectScheduleHealth(task.startDate, task.endDate, task.progress).overdue,
    ).length,
    totalEstimate,
    completedEstimate,
    completionRate: totalEstimate
      ? Math.round((completedEstimate / totalEstimate) * 100)
      : 0,
    activeRiskCount: activeRisks.length,
    highRiskCount: activeRisks.filter((risk) => risk.level === "high").length,
    pulseCount: Object.values(state.sprintPulses).filter(
      (pulse) => pulse.sprintId === sprintId,
    ).length,
  }
}

export function selectReleaseSummary(state: ProjectDataState) {
  const stories = Object.values(state.stories)
  const accepted = stories.filter((story) => story.deliveryStatus === "accepted")
  const totalValue = stories.reduce((sum, story) => sum + story.businessValue, 0)
  const deliveredValue = accepted.reduce(
    (sum, story) => sum + story.businessValue,
    0,
  )
  const activeRisks = selectActiveRisks(state)
  const milestones = Object.values(state.tasks).filter((task) => task.isMilestone)
  return {
    storyCount: stories.length,
    acceptedStoryCount: accepted.length,
    totalValue,
    deliveredValue,
    valueRate: totalValue ? Math.round((deliveredValue / totalValue) * 100) : 0,
    activeRiskCount: activeRisks.length,
    highRiskCount: activeRisks.filter((risk) => risk.level === "high").length,
    milestoneCount: milestones.length,
    delayedMilestoneCount: milestones.filter(
      (task) => selectScheduleHealth(task.startDate, task.endDate, task.progress).overdue,
    ).length,
  }
}
