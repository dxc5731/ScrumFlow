import type { ProjectDataState, ReleaseEntity, StoryEntity } from "../types"

export const RELEASE_STATUS = {
  planning: "规划中",
  active: "进行中",
  released: "已发布",
} as const
export function validReleaseDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  )
}
export function matchesRelease(story: StoryEntity, filter?: string) {
  return (
    !filter ||
    filter === "all" ||
    (filter === "unassigned" ? !story.releaseId : story.releaseId === filter)
  )
}
export function planningStories(
  state: ProjectDataState,
  filter = state.workspace.releaseFilterId,
) {
  return Object.values(state.stories)
    .filter((story) =>
      filter
        ? matchesRelease(story, filter)
        : story.sprintId === state.workspace.selectedSprintId,
    )
    .sort((a, b) => a.order - b.order)
}
export function planningScopeLabel(state: ProjectDataState) {
  const filter = state.workspace.releaseFilterId
  return !filter
    ? (state.sprints[state.workspace.selectedSprintId]?.name ?? "未选择 Sprint")
    : filter === "all"
      ? "全部 Release"
      : filter === "unassigned"
        ? "未分配 Release"
        : (state.releases[filter]?.name ?? "Release 不存在")
}
export function storySprintIssue(
  state: Pick<ProjectDataState, "sprints" | "releases">,
  story: Pick<StoryEntity, "releaseId">,
  sprintId: string | null,
) {
  if (!sprintId) return null
  if (!story.releaseId || !state.releases[story.releaseId])
    return "进入 Sprint 前请先分配目标 Release"
  const sprint = state.sprints[sprintId]
  if (!sprint) return "目标 Sprint 不存在"
  if (sprint.releaseId !== story.releaseId)
    return "只能选择 Story 所属 Release 下的 Sprint"
  return null
}
export function inheritedDelivery(
  state: Pick<ProjectDataState, "stories" | "tasks" | "subtasks">,
  type: "story" | "task" | "subtask",
  id: string,
) {
  const storyId =
    type === "story"
      ? id
      : type === "task"
        ? state.tasks[id]?.storyId
        : state.tasks[state.subtasks[id]?.taskId]?.storyId
  const story = state.stories[storyId]
  return {
    releaseId: story?.releaseId ?? null,
    sprintId: story?.sprintId ?? null,
  }
}
export function releaseSummary(state: ProjectDataState, id: string, now: Date) {
  const stories = Object.values(state.stories).filter(
    (story) => story.releaseId === id,
  )
  const storyIds = new Set(stories.map((story) => story.id))
  const tasks = Object.values(state.tasks).filter((task) =>
    storyIds.has(task.storyId),
  )
  const taskIds = new Set(tasks.map((task) => task.id))
  const subtasks = Object.values(state.subtasks).filter((item) =>
    taskIds.has(item.taskId),
  )
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-")
  const accepted = stories.filter(
    (story) => story.deliveryStatus === "accepted",
  )
  const core = stories.filter((story) => story.isReleaseCore)
  const gate = core.length ? core : stories
  const severe = [...tasks, ...subtasks].filter(
    (item) => item.status === "blocked" && item.blockedSeverity === "severe",
  )
  const overdue = [
    ...stories
      .filter(
        (story) => story.deliveryStatus !== "accepted" && story.dueDate < today,
      )
      .map((story) => ({
        id: story.id,
        title: story.title,
        type: "story" as const,
        date: story.dueDate,
      })),
    ...tasks
      .filter((task) => task.status !== "done" && task.endDate < today)
      .map((task) => ({
        id: task.id,
        title: task.title,
        type: "task" as const,
        date: task.endDate,
      })),
    ...subtasks
      .filter((task) => task.status !== "done" && task.endDate < today)
      .map((task) => ({
        id: task.id,
        title: task.title,
        type: "subtask" as const,
        date: task.endDate,
      })),
  ]
  const sprintIds = new Set(
    Object.values(state.sprints)
      .filter((sprint) => sprint.releaseId === id)
      .map((sprint) => sprint.id),
  )
  const highRisks = Object.values(state.risks).filter(
    (risk) =>
      risk.level === "high" &&
      risk.status !== "resolved" &&
      (risk.targetType === "story"
        ? storyIds.has(risk.targetId)
        : risk.targetType === "task"
          ? taskIds.has(risk.targetId)
          : sprintIds.has(risk.targetId)),
  )
  const highRiskStories = stories.filter(
    (story) =>
      story.risk === "high" &&
      !highRisks.some(
        (risk) => risk.targetType === "story" && risk.targetId === story.id,
      ),
  )
  return {
    stories,
    accepted,
    core,
    severe,
    overdue,
    highRisks,
    highRiskStories,
    progress: stories.length
      ? Math.round((accepted.length / stories.length) * 100)
      : 0,
    canPublish:
      stories.length > 0 &&
      gate.every((story) => story.deliveryStatus === "accepted") &&
      severe.length === 0,
    gateIncomplete: gate.filter((story) => story.deliveryStatus !== "accepted"),
  }
}

/** Old plans retain their Sprint allocations under one clearly labelled migrated Release. */
export function normalizeReleases(
  state: ProjectDataState,
  legacy: boolean,
): ProjectDataState {
  const releases: Record<string, ReleaseEntity> = { ...(state.releases ?? {}) }
  const legacyId = "release-legacy"
  if (legacy && Object.keys(state.sprints).length)
    releases[legacyId] = {
      id: legacyId,
      name: "现有计划（迁移）",
      goal: state.project.goal || "保留升级前的交付计划",
      plannedDate: state.project.endDate,
      status: "planning",
      publishedAt: null,
      createdAt: "",
      updatedAt: "",
    }
  for (const [id, release] of Object.entries(releases)) {
    if (
      !release ||
      release.id !== id ||
      typeof release.name !== "string" ||
      !release.name.trim() ||
      typeof release.goal !== "string" ||
      !release.goal.trim() ||
      !validReleaseDate(release.plannedDate) ||
      !["planning", "active", "released"].includes(release.status)
    )
      throw new Error("Release 数据无效：" + id)
  }
  const sprints = Object.fromEntries(
    Object.entries(state.sprints).map(([id, sprint]) => {
      const releaseId = sprint.releaseId ?? (legacy ? legacyId : null)
      if (!releaseId || !releases[releaseId])
        throw new Error("Sprint 缺少有效的 Release：" + sprint.name)
      return [id, { ...sprint, releaseId }]
    }),
  )
  const stories = Object.fromEntries(
    Object.entries(state.stories).map(([id, story]) => {
      const releaseId =
        story.releaseId ??
        (legacy && story.sprintId
          ? sprints[story.sprintId]?.releaseId
          : null) ??
        null
      if (releaseId && !releases[releaseId])
        throw new Error("Story 的 Release 不存在：" + story.title)
      if (
        story.sprintId &&
        (!sprints[story.sprintId] ||
          sprints[story.sprintId].releaseId !== releaseId)
      )
        throw new Error("Story 与 Sprint 的 Release 不一致：" + story.title)
      return [
        id,
        {
          ...story,
          releaseId,
          isReleaseCore: story.isReleaseCore ?? false,
          releaseChanges: story.releaseChanges ?? [],
        },
      ]
    }),
  )
  return { ...state, releases, sprints, stories }
}
