import type { MeetingConstraints, MeetingPlanTask, PlanOption, ProjectDataState } from "../types"
import { normalizeConstraints } from "./meetingWorkingState"
import { planWorkUnits } from './meetingPlanWork'
import { addBusinessDays, format } from 'date-fns'
import { taskContributions } from './meetingCapacity'

export interface ConstraintViolation {
  type: string
  expected: string | number | boolean
  actual: string | number | boolean
  message: string
  severity: "hard" | "preference"
}

export function validatePlanAgainstConstraints(
  plan: PlanOption, constraints: MeetingConstraints, state: ProjectDataState,
): { valid: boolean; violations: ConstraintViolation[] } {
  constraints = normalizeConstraints(constraints)
  const violations: ConstraintViolation[] = []
  const add = (type: string, expected: ConstraintViolation["expected"], actual: ConstraintViolation["actual"], message: string) =>
    violations.push({ type, expected, actual, message, severity: "hard" })
  const tasks = planWorkUnits(plan, state)
  const assignees = new Set(tasks.map((task) => task.assigneeId).filter(Boolean))
  const requiredPeople = constraints.requiredPeople ?? null
  if (requiredPeople && assignees.size !== requiredPeople)
    add("requiredMemberCount", requiredPeople, assignees.size, `要求 ${requiredPeople} 人参与，当前只有 ${assignees.size} 人；不能把这份安排作为推荐方案`)
  if (constraints.maxPeople && assignees.size > constraints.maxPeople)
    add("maxMemberCount", constraints.maxPeople, assignees.size, `当前使用 ${assignees.size} 人，超过 ${constraints.maxPeople} 人上限`)
  if (constraints.maxDays && plan.estimatedDurationDays > constraints.maxDays)
    add("maxDuration", constraints.maxDays, plan.estimatedDurationDays, `计算工期约 ${plan.estimatedDurationDays} 个工作日，超过 ${constraints.maxDays} 天上限`)
  const totalHours = tasks.reduce((sum, task) => sum + task.estimate, 0)
  if (constraints.maxHours && totalHours > constraints.maxHours)
    add("maxHours", constraints.maxHours, totalHours, `总工时 ${totalHours}h 超过 ${constraints.maxHours}h 上限`)
  for (const task of tasks) {
    if (!state.members[task.assigneeId]) add("assignee", "现有项目成员", task.assigneeId, `「${task.title}」没有有效负责人`)
    if (constraints.excludedMemberIds.includes(task.assigneeId))
      add("excludedMember", "不参与", state.members[task.assigneeId]?.name ?? task.assigneeId, `已排除成员仍负责「${task.title}」`)
    if (constraints.allowedMemberIds.length && !constraints.allowedMemberIds.includes(task.assigneeId))
      add("allowedMember", "允许的成员", state.members[task.assigneeId]?.name ?? task.assigneeId, `「${task.title}」分配给了限制之外的成员`)
    if (constraints.testOnlyMemberIds.includes(task.assigneeId) && task.type !== "test")
      add("memberRole", "test", task.type, `${state.members[task.assigneeId]?.name ?? "该成员"}只能负责测试工作`)
    const rule = constraints.memberRules?.[task.assigneeId]
    if (rule?.allowedTaskTypes && !rule.allowedTaskTypes.includes(task.type))
      add("memberTaskType", rule.allowedTaskTypes.join(","), task.type, `${state.members[task.assigneeId]?.name ?? task.assigneeId}不能承担「${task.title}」的工作类型`)
    if (!constraints.allowSubtasks && task.subtaskTitles.length)
      add("noSubtasks", 0, task.subtaskTitles.length, `「${task.title}」仍包含子任务`)
    const locked = constraints.lockedTasks?.[task.key]
    if (locked) {
      // Dependencies have their own review actions; a task lock protects its work/owner metadata.
      const { dependsOnKeys: ignoredBefore, ...before } = locked
      const { dependsOnKeys: ignoredAfter, ...after } = task
      void ignoredBefore; void ignoredAfter
      if (JSON.stringify(after) !== JSON.stringify(before))
        add("lockedTask", "原任务属性与负责人", "任务已改变", `锁定的「${locked.title}」被修改`)
    }
    const original = task.sourceTaskId ? state.tasks[task.sourceTaskId] : null
    if (constraints.lockStartedTasks && original?.status === "in_progress" &&
      (task.assigneeId !== original.assigneeId || task.title !== original.title || task.estimate !== original.estimate))
      add("startedTask", "保持原任务", "已修改", `正在进行的「${original.title}」不能修改`)
  }
  for (const task of [...plan.tasks, ...tasks]) {
    const override = constraints.assignmentOverrides[task.key]
    if (override && override !== task.assigneeId)
      add("fixedAssignee", state.members[override]?.name ?? override, state.members[task.assigneeId]?.name ?? task.assigneeId, `「${task.title}」没有交给指定负责人`)
  }
  for (const [memberId, rule] of Object.entries(constraints.memberRules ?? {})) {
    const hours = tasks.filter(task => task.assigneeId === memberId).reduce((sum, task) => sum + task.estimate, 0)
    const daily = (state.members[memberId]?.capacityHours ?? 0) / 5
    const days = hours === 0 ? 0 : daily > 0 ? Math.ceil(hours / daily) : Infinity
    if (rule.maxHours !== undefined && hours > rule.maxHours)
      add("memberMaxHours", rule.maxHours, hours, `${state.members[memberId]?.name ?? memberId}的 ${hours}h 超过个人 ${rule.maxHours}h 上限`)
    if (rule.maxDays !== undefined && days > rule.maxDays)
      add("memberMaxDays", rule.maxDays, days, `${state.members[memberId]?.name ?? memberId}需要 ${days} 个投入工作日，超过个人 ${rule.maxDays} 天上限`)
    if (rule.capacityWindowDays !== undefined) {
      const windowEnd = format(addBusinessDays(new Date(), rule.capacityWindowDays), "yyyy-MM-dd")
      const replaced = new Set(plan.tasks.map(task => task.sourceTaskId).filter(Boolean))
      const committed = Object.values(state.tasks).filter(task => !replaced.has(task.id) && task.startDate <= windowEnd)
        .reduce((sum, task) => sum + (taskContributions(state, task)[memberId] ?? 0), 0)
      const available = Math.max(0, daily * rule.capacityWindowDays - committed)
      if (hours > available) add("memberRemainingCapacity", available, hours,
        `${state.members[memberId]?.name ?? memberId}未来 ${rule.capacityWindowDays} 个工作日扣除其他已承诺工作 ${committed}h 后，剩余约 ${available}h；方案安排 ${hours}h，超过剩余容量`)
    }
  }
  for (const key of constraints.lockedTaskKeys) if (!tasks.some((task) => task.key === key))
    add("lockedTask", "保留", "缺失", `锁定任务 ${key} 已从方案中消失`)
  if (constraints.parallel && tasks.length > 1 && !tasks.some((task, index) =>
    tasks.some((other, otherIndex) => index !== otherIndex && task.assigneeId !== other.assigneeId &&
      !task.dependsOnKeys.includes(other.key) && !other.dependsOnKeys.includes(task.key))))
    add("parallelRequired", true, false, "当前依赖和分工无法形成并行工作")
  return { valid: violations.length === 0, violations }
}
