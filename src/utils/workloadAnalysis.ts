import type { ProjectDataState, SubtaskEntity, TaskEntity } from "../types"

/** 全部分析入口使用项目所在时区，而非运行设备的本地时区。 */
export function projectDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now)
  const get = (type: string) => parts.find(part => part.type === type)!.value
  return `${get("year")}-${get("month")}-${get("day")}`
}

export const roundHours = (hours: number) => Math.round(hours * 100) / 100

export function workingDays(start: string, end: string): number {
  const first = Date.parse(`${start}T00:00:00Z`), last = Date.parse(`${end}T00:00:00Z`)
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return 0
  let count = 0
  for (let day = first; day <= last; day += 86400000) {
    const weekday = new Date(day).getUTCDay()
    if (weekday !== 0 && weekday !== 6) count++
  }
  return count
}

export function taskLeaves(state: ProjectDataState, task: TaskEntity): Array<TaskEntity | SubtaskEntity> {
  // WBS 父任务为汇总节点；已有子任务时不再叠加父任务工时。
  return task.subtaskIds.length ? task.subtaskIds.map(id => state.subtasks[id]).filter(Boolean) : [task]
}

export function remainingWork(leaf: TaskEntity | SubtaskEntity): number {
  if (leaf.status === "done") return 0
  // 当前模型没有单独填写的剩余工时字段，estimate 表示预计总工时。
  const progress = Number.isFinite(leaf.progress) ? leaf.progress : 0
  return roundHours(Math.max(0, leaf.estimate) * (1 - Math.min(100, Math.max(0, progress)) / 100))
}

export function taskContributions(state: ProjectDataState, task: TaskEntity): Record<string, number> {
  const result: Record<string, number> = {}
  if (task.status === "done") return result
  for (const leaf of taskLeaves(state, task)) {
    result[leaf.assigneeId] = roundHours((result[leaf.assigneeId] ?? 0) + remainingWork(leaf))
  }
  return result
}

export function sprintWindow(state: ProjectDataState, sprintId: string | null, now = new Date()) {
  const sprint = sprintId ? state.sprints[sprintId] : undefined
  const currentDate = projectDate(now)
  const planningWorkingDays = sprint ? workingDays(sprint.startDate, sprint.endDate) : 0
  const start = sprint && sprint.startDate > currentDate ? sprint.startDate : currentDate
  const remainingWorkingDays = sprint && sprint.status !== "closed" ? workingDays(start, sprint.endDate) : 0
  return { currentDate, planningWorkingDays, remainingWorkingDays }
}

export function buildWorkloadSnapshot(state: ProjectDataState, sprintId: string | null, now = new Date()) {
  const window = sprintWindow(state, sprintId, now)
  const tasks = Object.fromEntries(Object.values(state.tasks).map(task => {
    const byMember = taskContributions(state, task)
    return [task.id, { byMember, remainingHours: roundHours(Object.values(byMember).reduce((a, b) => a + b, 0)) }]
  }))
  const members = Object.fromEntries(Object.values(state.members).map(member => {
    let totalWorkload = 0, currentSprintWorkload = 0
    for (const task of Object.values(state.tasks)) {
      const hours = tasks[task.id].byMember[member.id] ?? 0
      totalWorkload += hours
      if (state.stories[task.storyId]?.sprintId === sprintId) currentSprintWorkload += hours
    }
    const dailyHours = Math.max(0, member.capacityHours / 5)
    const remainingTimeCapacity = roundHours(dailyHours * window.remainingWorkingDays)
    return [member.id, {
      dailyHours, totalWorkload: roundHours(totalWorkload), currentSprintWorkload: roundHours(currentSprintWorkload),
      planningCapacity: roundHours(dailyHours * window.planningWorkingDays), remainingTimeCapacity,
      remainingCapacity: roundHours(remainingTimeCapacity - currentSprintWorkload),
    }]
  }))
  return { ...window, sprintId, tasks, members }
}
