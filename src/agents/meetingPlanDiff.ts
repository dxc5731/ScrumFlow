import type { PlanOption } from "../types"

export interface PlanDiff {
  addedTasks: string[]
  removedTasks: string[]
  updatedTasks: string[]
  assigneeChanges: string[]
  dependencyChanges: string[]
  durationChange: number
  small: boolean
}

export function comparePlans(previous: PlanOption, next: PlanOption): PlanDiff {
  const withSteps = (plan:PlanOption) => [...plan.tasks, ...(plan.subtasks ?? []).flatMap(step => {
    const parent=plan.tasks.find(task=>task.key===step.parentTaskKey)
    return parent ? [{ ...parent, ...step, subtaskTitles:[], dependsOnKeys:[] }] : []
  })]
  const previousWork = withSteps(previous), nextWork = withSteps(next)
  const oldTasks = new Map(previousWork.map((task) => [task.key, task]))
  const newTasks = new Map(nextWork.map((task) => [task.key, task]))
  const addedTasks = next.tasks.filter((task) => !oldTasks.has(task.key)).map((task) => task.title)
  const removedTasks = previous.tasks.filter((task) => !newTasks.has(task.key)).map((task) => task.title)
  const updatedTasks: string[] = []
  const assigneeChanges: string[] = []
  const dependencyChanges: string[] = []
  for (const task of nextWork) {
    const prior = oldTasks.get(task.key)
    if (!prior) continue
    if (task.title !== prior.title || task.estimate !== prior.estimate || task.type !== prior.type ||
      JSON.stringify(task.subtaskTitles) !== JSON.stringify(prior.subtaskTitles)) updatedTasks.push(task.title)
    if (task.assigneeId !== prior.assigneeId) assigneeChanges.push(task.title)
    if (JSON.stringify([...task.dependsOnKeys].sort()) !== JSON.stringify([...prior.dependsOnKeys].sort())) dependencyChanges.push(task.title)
  }
  const durationChange = next.estimatedDurationDays - previous.estimatedDurationDays
  return { addedTasks, removedTasks, updatedTasks, assigneeChanges, dependencyChanges, durationChange,
    small: addedTasks.length === 0 && removedTasks.length === 0 && updatedTasks.length === 0 &&
      assigneeChanges.length + dependencyChanges.length <= 1 }
}
