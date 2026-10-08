import type { MeetingPlanTask } from "../types"
import type { ProjectAnalysisSnapshot } from "./meetingSnapshot"

export interface ScheduledTask {
  key: string
  earliestStartDays: number
  earliestFinishDays: number
}

export interface PlanSchedule {
  tasks: ScheduledTask[]
  criticalPathKeys: string[]
  criticalPathHours: number
  estimatedDurationDays: number
  unresolvedDependencies: string[]
  cycle: boolean
}

export function calculatePlanSchedule(tasks: MeetingPlanTask[], snapshot: ProjectAnalysisSnapshot): PlanSchedule {
  const byKey = new Map(tasks.map((task) => [task.key, task]))
  const ordered: MeetingPlanTask[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const unresolved = new Set<string>()
  let cycle = false
  function visit(key: string) {
    if (visiting.has(key)) { cycle = true; return }
    if (visited.has(key)) return
    const task = byKey.get(key)
    if (!task) return
    visiting.add(key)
    for (const source of task.dependsOnKeys) {
      if (byKey.has(source)) visit(source)
      else if (snapshot.tasks[source]?.status !== "done") unresolved.add(source)
    }
    visiting.delete(key)
    visited.add(key)
    ordered.push(task)
  }
  tasks.forEach((task) => visit(task.key))
  if (cycle) return { tasks: [], criticalPathKeys: [], criticalPathHours: 0,
    estimatedDurationDays: 0, unresolvedDependencies: [...unresolved], cycle: true }

  const finish = new Map<string, number>()
  const chainHours = new Map<string, number>()
  const predecessor = new Map<string, string>()
  const memberAvailable = new Map<string, number>()
  for (const member of Object.values(snapshot.members)) {
    const plannedExisting = tasks.filter((task) => task.sourceTaskId && snapshot.tasks[task.sourceTaskId]?.assigneeId === member.id)
      .reduce((sum, task) => sum + (snapshot.tasks[task.sourceTaskId!]?.remainingHours ?? 0), 0)
    memberAvailable.set(member.id, Math.max(0, member.currentSprintWorkload - plannedExisting) / Math.max(0.1, member.dailyHours))
  }
  const scheduled: ScheduledTask[] = []
  for (const task of ordered) {
    const own = snapshot.members[task.assigneeId]
    const dailyHours = Math.max(0.1, own?.dailyHours ?? 0)
    const dependencies = task.dependsOnKeys.filter((key) => byKey.has(key))
    const prior = dependencies.sort((a, b) => (finish.get(b) ?? 0) - (finish.get(a) ?? 0))[0]
    const dependencyFinish = prior ? finish.get(prior) ?? 0 : 0
    const assigned = memberAvailable.get(task.assigneeId) ?? 0
    const earliestStartDays = Math.max(dependencyFinish, assigned)
    const earliestFinishDays = earliestStartDays + task.estimate / dailyHours
    finish.set(task.key, earliestFinishDays)
    memberAvailable.set(task.assigneeId, earliestFinishDays)
    scheduled.push({ key: task.key, earliestStartDays, earliestFinishDays })
    const longest = dependencies.sort((a, b) => (chainHours.get(b) ?? 0) - (chainHours.get(a) ?? 0))[0]
    if (longest) predecessor.set(task.key, longest)
    chainHours.set(task.key, task.estimate + (longest ? chainHours.get(longest) ?? 0 : 0))
  }
  const last = ordered.reduce<MeetingPlanTask | null>((longest, task) =>
    !longest || (chainHours.get(task.key) ?? 0) > (chainHours.get(longest.key) ?? 0) ? task : longest, null)
  const criticalPathKeys: string[] = []
  for (let key = last?.key; key; key = predecessor.get(key)) criticalPathKeys.unshift(key)
  return {
    tasks: scheduled,
    criticalPathKeys,
    criticalPathHours: last ? chainHours.get(last.key) ?? 0 : 0,
    estimatedDurationDays: Math.ceil(Math.max(0, ...scheduled.map((task) => task.earliestFinishDays))),
    unresolvedDependencies: [...unresolved], cycle: false,
  }
}
