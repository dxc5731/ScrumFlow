import { differenceInCalendarDays, parseISO } from "date-fns"
import { buildWorkloadSnapshot, projectDate, roundHours, sprintWindow, taskContributions } from "../utils/workloadAnalysis"
import type { MeetingMemory, MeetingSession, ProjectDataState, SprintStatus, StoryDeliveryStatus, TaskStatus } from "../types"

export interface SprintAnalysis {
  id: string
  name: string
  status: SprintStatus
  effectiveStatus: SprintStatus | "overdue"
  startDate: string
  endDate: string
  remainingCalendarDays: number
  remainingWorkingDays: number
  planningWorkingDays: number
}

export interface StoryAnalysis {
  id: string
  title: string
  status: StoryDeliveryStatus
  sprintId: string | null
  taskCount: number
  completedTaskCount: number
  remainingHours: number
  riskCount: number
  acceptanceCriteriaCount: number
}

export interface TaskAnalysis {
  id: string
  title: string
  storyId: string
  status: TaskStatus
  estimate: number
  remainingHours: number
  startDate: string
  endDate: string
  assigneeId: string
  dependencyIds: string[]
  dependentIds: string[]
}

export interface MemberAnalysis {
  id: string
  name: string
  dailyHours: number
  currentSprintWorkload: number
  totalWorkload: number
  remainingCapacity: number
  remainingTimeCapacity: number
  planningCapacity: number
  focusedTaskIds: string[]
}

export interface ProjectAnalysisSnapshot {
  version: string
  currentDate: string
  projectId: string
  activeSprint: SprintAnalysis | null
  focusedSprint: SprintAnalysis | null
  focusedStory: StoryAnalysis | null
  focusedStoryIds: string[]
  focusedTasks: TaskAnalysis[]
  focusedMembers: MemberAnalysis[]
  sprints: Record<string, SprintAnalysis>
  stories: Record<string, StoryAnalysis>
  tasks: Record<string, TaskAnalysis>
  members: Record<string, MemberAnalysis>
}

export interface ProjectAnalysisScope {
  projectId: string
  scopeId: string
  revision?: string | number
  targetType: "project" | "story" | "sprint"
  targetId: string
  focusStoryIds?: string[]
  focusTaskIds?: string[]
  focusSprintId?: string | null
  focusMemberIds?: string[]
  targetSprintId?: string | null
}

export function taskRemainingHours(state: ProjectDataState, taskId: string): number {
  const task = state.tasks[taskId]
  return task ? roundHours(Object.values(taskContributions(state, task)).reduce((a, b) => a + b, 0)) : 0
}

export function buildProjectAnalysisSnapshot(
  state: ProjectDataState, session: MeetingSession, memory: MeetingMemory, now = new Date(),
): ProjectAnalysisSnapshot {
  return buildProjectAnalysisSnapshotForScope(state, {
    projectId: session.projectId, scopeId: session.id, revision: session.messageIds.length,
    targetType: session.targetType, targetId: session.targetId,
    focusStoryIds: memory.focusStoryIds, focusTaskIds: memory.focusTaskIds,
    focusSprintId: memory.focusSprintId, focusMemberIds: memory.focusMemberIds,
    targetSprintId: memory.constraints.targetSprintId,
  }, now)
}

export function buildProjectAnalysisSnapshotForScope(
  state: ProjectDataState, scope: ProjectAnalysisScope, now = new Date(),
): ProjectAnalysisSnapshot {
  if (scope.projectId !== state.project.id) throw new Error("Analysis scope does not match the project")
  const currentDate = projectDate(now)
  const sprints = Object.fromEntries(Object.values(state.sprints).map((sprint) => {
    const start = sprint.startDate > currentDate ? sprint.startDate : currentDate
    const remainingCalendarDays = sprint.status === "closed" ? 0 : Math.max(0, differenceInCalendarDays(parseISO(sprint.endDate), parseISO(start)) + 1)
    const { remainingWorkingDays, planningWorkingDays } = sprintWindow(state, sprint.id, now)
    const value: SprintAnalysis = {
      id: sprint.id, name: sprint.name, status: sprint.status,
      effectiveStatus: sprint.status !== "closed" && sprint.endDate < currentDate ? "overdue" : sprint.status,
      startDate: sprint.startDate, endDate: sprint.endDate, remainingCalendarDays, remainingWorkingDays, planningWorkingDays,
    }
    return [sprint.id, value]
  })) as Record<string, SprintAnalysis>

  const dependencyList = Object.values(state.dependencies)
  const tasks = Object.fromEntries(Object.values(state.tasks).map((task) => [task.id, {
    id: task.id, title: task.title, storyId: task.storyId, status: task.status,
    estimate: task.estimate, remainingHours: taskRemainingHours(state, task.id),
    startDate: task.startDate, endDate: task.endDate, assigneeId: task.assigneeId,
    dependencyIds: dependencyList.filter((item) => item.targetTaskId === task.id).map((item) => item.sourceTaskId),
    dependentIds: dependencyList.filter((item) => item.sourceTaskId === task.id).map((item) => item.targetTaskId),
  }])) as Record<string, TaskAnalysis>
  const stories = Object.fromEntries(Object.values(state.stories).map((story) => {
    const storyTasks = story.taskIds.map((id) => tasks[id]).filter(Boolean)
    const taskIds = new Set(story.taskIds)
    const riskCount = Object.values(state.risks).filter((risk) => risk.status !== "resolved" && (
      risk.targetType === "story" && risk.targetId === story.id || risk.targetType === "task" && taskIds.has(risk.targetId)
    )).length
    return [story.id, {
      id: story.id, title: story.title, status: story.deliveryStatus, sprintId: story.sprintId,
      taskCount: storyTasks.length, completedTaskCount: storyTasks.filter((task) => task.status === "done").length,
      remainingHours: roundHours(storyTasks.reduce((sum, task) => sum + task.remainingHours, 0)), riskCount,
      acceptanceCriteriaCount: story.acceptanceCriteriaIds.length,
    }]
  })) as Record<string, StoryAnalysis>

  const focusStoryIds = scope.focusStoryIds?.length ? scope.focusStoryIds : scope.targetType === "story" ? [scope.targetId] : []
  const focusedStory = focusStoryIds.length === 1 ? stories[focusStoryIds[0]] ?? null : null
  const activeSprint = Object.values(sprints).find((item) => item.status === "active") ?? null
  const focusedSprint = sprints[scope.targetSprintId ?? scope.focusSprintId ?? focusedStory?.sprintId ?? (scope.targetType === "sprint" ? scope.targetId : "")] ?? activeSprint
  const workload = buildWorkloadSnapshot(state, focusedSprint?.id ?? null, now)
  const members = Object.fromEntries(Object.values(state.members).map((member) => {
    const focusedTaskIds: string[] = []
    for (const task of Object.values(state.tasks)) {
      if (!workload.tasks[task.id].byMember[member.id]) continue
      if (focusStoryIds.includes(task.storyId) || scope.focusTaskIds?.includes(task.id)) focusedTaskIds.push(task.id)
    }
    return [member.id, {
      id: member.id, name: member.name, ...workload.members[member.id],
      focusedTaskIds,
    }]
  })) as Record<string, MemberAnalysis>
  const focusTaskIds = scope.focusTaskIds?.length ? scope.focusTaskIds : focusedStory
    ? state.stories[focusedStory.id]?.taskIds ?? [] : []
  return {
    version: `${currentDate}:${scope.scopeId}:${scope.revision ?? 0}:${focusStoryIds.join(",")}:${focusedSprint?.id ?? "project"}`,
    currentDate, projectId: state.project.id, activeSprint, focusedSprint, focusedStory,
    focusedStoryIds: focusStoryIds, focusedTasks: focusTaskIds.map((id) => tasks[id]).filter(Boolean),
    focusedMembers: (scope.focusMemberIds ?? []).map((id) => members[id]).filter(Boolean),
    sprints, stories, tasks, members,
  }
}
