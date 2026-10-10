import type { MeetingConstraints, MeetingPlanTask, PlanOption, ProjectDataState } from '../types'

/** Match the Store's leaf-work accounting. Parent estimates are rollups when steps exist. */
export function planWorkUnits(plan: Pick<PlanOption, 'tasks' | 'subtasks'>, state: ProjectDataState): MeetingPlanTask[] {
 return plan.tasks.flatMap(task => {
  const proposed = plan.subtasks?.filter(step => step.parentTaskKey === task.key) ?? []
  if (!proposed.length) return [task]
  const existing = task.sourceTaskId ? state.tasks[task.sourceTaskId]?.subtaskIds.map(id => state.subtasks[id]).filter(step => step && step.status !== 'done') ?? [] : []
  return [...existing.map(step => ({ ...step, key: step.id, assigneeId: task.assigneeId })), ...proposed]
   .map(step => ({ ...task, key: step.key, title: step.title, estimate: step.estimate, assigneeId: step.assigneeId, dependsOnKeys: [], subtaskTitles: [] }))
 })
}

/** Reconcile retained steps with the same latest hard rules as their parents. */
export function reconcilePlanSteps(plan: PlanOption, constraints: MeetingConstraints, state: ProjectDataState): void {
 const used = new Set(plan.tasks.map(task => task.assigneeId))
 const eligible = Object.values(state.members).filter(member => !constraints.excludedMemberIds.includes(member.id) &&
  (!constraints.allowedMemberIds.length || constraints.allowedMemberIds.includes(member.id)))
 for (const step of plan.subtasks ?? []) {
  const parent = plan.tasks.find(task => task.key === step.parentTaskKey)
  if (!parent) { step.assigneeId = ''; continue }
  const members = eligible.filter(member => (!constraints.memberRules?.[member.id]?.allowedTaskTypes || constraints.memberRules[member.id].allowedTaskTypes!.includes(parent.type)) &&
   (parent.type === 'test' || !constraints.testOnlyMemberIds.includes(member.id)))
  const override = constraints.assignmentOverrides[step.key]
  const selected = override ? members.find(member => member.id === override)
   : members.find(member => member.id === step.assigneeId) ?? members.find(member => member.id === parent.assigneeId) ?? members.find(member => used.has(member.id)) ?? members[0]
  step.assigneeId = selected?.id ?? ''
  if (selected) used.add(selected.id)
 }
 rollupPlanEstimates(plan, state)
}

export function rollupPlanEstimates(plan: PlanOption, state: ProjectDataState): void {
 const units = planWorkUnits(plan, state)
 for (const parent of plan.tasks) if (plan.subtasks?.some(step => step.parentTaskKey === parent.key)) {
  const keys = new Set(plan.subtasks.filter(step => step.parentTaskKey === parent.key).map(step => step.key))
  for (const id of state.tasks[parent.sourceTaskId ?? '']?.subtaskIds ?? []) keys.add(id)
  parent.estimate = units.filter(unit => keys.has(unit.key)).reduce((sum, unit) => sum + unit.estimate, 0)
 }
 plan.totalHours = units.reduce((sum, task) => sum + task.estimate, 0)
}
