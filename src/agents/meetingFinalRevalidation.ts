import { businessChangeSummary, type BusinessChangeSummary } from "./meetingBusinessSummary"
import { validatePlanAgainstConstraints, type ConstraintViolation } from "./meetingConstraintValidator"
import { calculatePlanSchedule } from "./meetingSchedule"
import { buildProjectAnalysisSnapshotForScope } from "./meetingSnapshot"
import { projectPlanCapacity } from "./meetingCapacity"
import { validateProjectDependencyGraph } from "./projectDependencyGraph"
import { projectReviewedActions } from './meetingReviewProjection'
import { eventConditionError } from "../utils/eventLifecycle"
import type { AgentProposal, MeetingPlanTask, MeetingSession, ProjectDataState, ProposalAction } from "../types"

export interface FinalPlanValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  businessSummary: BusinessChangeSummary
  scheduleSummary: string
  workloadSummary: string[]
  dependencySummary: string
  criticalPath: string[]
  estimatedDuration: number
  constraintViolations: ConstraintViolation[]
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function currentValue(state: ProjectDataState, type: ProposalAction["targetType"], id: string, field: string): unknown {
  const entity = type === "story" ? state.stories[id]
    : type === "task" ? state.tasks[id]
      : type === "subtask" ? state.subtasks[id]
        : type === "sprint" ? state.sprints[id]
          : type === "risk" ? state.risks[id]
            : type === "member" ? state.members[id]
              : type === "dependency" ? state.dependencies[id]
                : type === "project" && state.project.id === id ? state.project : null
  if (!entity) return undefined
  if (type === "story" && field === "acceptanceCriteriaContents")
    return state.stories[id].acceptanceCriteriaIds.map((key) => state.acceptanceCriteria[key]?.content ?? null)
  if (type === "story" && field === "openRiskIds")
    return Object.values(state.risks).filter((risk) => risk.targetType === "story" && risk.targetId === id && risk.status !== "resolved").map((risk) => risk.id).sort()
  return (entity as unknown as Record<string, unknown>)[field]
}

export function revalidateReviewedProposal(
  state: ProjectDataState, proposal: AgentProposal, session?: MeetingSession,
): FinalPlanValidationResult {
  // The review projection is the only mutable action set; originals and the source plan stay frozen.
  proposal = { ...proposal, actions: proposal.reviewedActions ?? proposal.actions }
  const accepted = proposal.actions.filter((action) => action.decision === "accepted" && action.status === "pending")
  const errors: string[] = []
  const warnings: string[] = []
  const rejected = proposal.actions.filter((action) => action.decision === "rejected")
  const pending = proposal.actions.filter((action) => action.decision === "pending" && action.status === "pending")
  if (pending.length) errors.push(`还有 ${pending.length} 项建议尚未审核`)
  if (!accepted.length) errors.push("请先采纳至少一项项目变更")
  const acceptedIds = new Set(proposal.actions.filter(action => action.decision === "accepted" && (action.status === "pending" || action.status === "applied")).map(action => action.id))
  for (const action of accepted) {
    for (const id of action.dependsOnActionIds) if (!acceptedIds.has(id))
      errors.push(`「${String(action.proposedValue.title ?? "依赖关系")}」所需的前置变更未被采纳`)
    for (const condition of action.preconditions) if (condition.field === "eventBasis" ? eventConditionError(state, condition) : !equal(currentValue(state, condition.targetType, condition.targetId, condition.field), condition.expectedValue))
      errors.push(`「${String(action.proposedValue.title ?? action.targetId)}」对应的项目数据已变化，请重新生成建议`)
    if (["UPDATE_TASK", "UPDATE_SUBTASK"].includes(action.actionType)) {
      const existing = action.actionType === "UPDATE_TASK" ? state.tasks[action.targetId] : state.subtasks[action.targetId]
      if (!existing || existing.status === "done") errors.push("已完成的工作不能在本次审核中修改")
    }
  }

  const memory = session?.memory
  const selected = proposal.planSnapshot?.option ?? memory?.options.find((option) => option.id === memory.activePlanId)
  const tasks: MeetingPlanTask[] = selected ? structuredClone(selected.tasks) : []
  const originalById = new Map(proposal.originalActions.map((action) => [action.id, action]))
  const createByKey = new Map<string, ProposalAction>()
  for (const action of proposal.actions.filter((item) => item.actionType === "CREATE_TASK")) {
    const original = originalById.get(action.id)
    const task = tasks.find((item) => !item.sourceTaskId && (item.key===action.id || item.storyId === action.targetId && item.title === original?.proposedValue.title))
    if (task) createByKey.set(task.key, action)
  }
  for (let index = tasks.length - 1; index >= 0; index--) {
    const task = tasks[index]
    const action = task.sourceTaskId
      ? proposal.actions.find((item) => item.actionType === "UPDATE_TASK" && item.targetId === task.sourceTaskId)
      : createByKey.get(task.key)
    if (!action) continue
    if (action.decision !== "accepted") {
      if (!task.sourceTaskId) tasks.splice(index, 1)
      else {
        const current = state.tasks[task.sourceTaskId]
        if (current) {
          task.assigneeId = current.assigneeId
          task.title = current.title
          task.estimate = current.estimate
        }
      }
      continue
    }
    const value = action.proposedValue
    if (typeof value.assigneeId === "string") task.assigneeId = value.assigneeId
    if (typeof value.title === "string") task.title = value.title
    if (typeof value.estimate === "number") task.estimate = value.estimate
    if (typeof value.type === "string") task.type = value.type as MeetingPlanTask["type"]
    if (typeof value.startDate === "string") task.startDate = value.startDate
    if (typeof value.endDate === "string") task.endDate = value.endDate
    if (action.actionType === "CREATE_TASK") task.subtaskTitles = proposal.actions.filter((item) =>
      item.actionType === "CREATE_SUBTASK" && item.targetId === action.id && item.decision === "accepted")
      .map((item) => String(item.proposedValue.title ?? ""))
  }
  const keyForReference = (reference: unknown) => tasks.find((task) =>
    task.sourceTaskId === reference || createByKey.get(task.key)?.id === reference)?.key
  const reviewedDependencies = new Map<string, ProposalAction>()
  for (const action of proposal.actions.filter((item) => item.actionType === "ADD_DEPENDENCY")) {
    const source = keyForReference(action.proposedValue.sourceTaskId)
    const target = keyForReference(action.proposedValue.targetTaskId)
    if (source && target) reviewedDependencies.set(`${source}->${target}`, action)
  }
  for (const task of tasks) task.dependsOnKeys = task.dependsOnKeys.filter((source) => {
    if (!tasks.some((item) => item.key === source)) return true
    const reviewed = reviewedDependencies.get(`${source}->${task.key}`)
    return !reviewed || reviewed.decision === "accepted"
  })
  for (const [edge, action] of reviewedDependencies) if (action.decision === "accepted") {
    const [source, target] = edge.split("->")
    const task = tasks.find((item) => item.key === target)
    if (task && !task.dependsOnKeys.includes(source)) task.dependsOnKeys.push(source)
  }
  if (rejected.some((action) => action.actionType === "ADD_DEPENDENCY"))
    warnings.push("你移除了一条建议依赖；两项工作能否独立推进仍需负责人确认")

  const focus = proposal.planSnapshot?.focus
  const snapshot = buildProjectAnalysisSnapshotForScope(state, {
    projectId: state.project.id, scopeId: proposal.id,
    targetType: focus?.storyIds.length === 1 ? "story" : focus?.sprintId ? "sprint" : proposal.targetType === 'story' || proposal.targetType === 'sprint' ? proposal.targetType : 'project',
    targetId: focus?.storyIds.length === 1 ? focus.storyIds[0] : focus?.sprintId ?? proposal.targetId,
  })
  const schedule = snapshot && tasks.length ? calculatePlanSchedule(tasks, snapshot) : null
  if (schedule?.cycle) errors.push("审核后的任务依赖形成循环")
  if (schedule?.unresolvedDependencies.length) warnings.push(`有 ${schedule.unresolvedDependencies.length} 项外部前置工作尚未完成，完成日期需要复核`)
  const reviewed = selected ? { ...selected, tasks, totalHours: tasks.reduce((sum, task) => sum + task.estimate, 0),
    estimatedDurationDays: schedule?.estimatedDurationDays ?? 0 } : null
  const constraints = proposal.constraintsSnapshot ?? memory?.constraints
  const projectedState = projectReviewedActions(state, proposal.actions)
  const effectiveTasks = tasks.flatMap(task => {
    const id = task.sourceTaskId ?? createByKey.get(task.key)?.id ?? task.key
    const actual = projectedState.tasks[id]
    if (!actual?.subtaskIds.length) return [{ ...task, assigneeId: actual?.assigneeId ?? task.assigneeId, estimate: actual?.estimate ?? task.estimate }]
    return actual.subtaskIds.map(key=>projectedState.subtasks[key]).filter(step=>step && step.status!=='done').map(step=>({ ...task, sourceTaskId: null, key: step.id, assigneeId: step.assigneeId, estimate: step.estimate, title: step.title, dependsOnKeys: [], subtaskTitles: [] }))
  })
  const stepsOnly = accepted.length > 0 && accepted.every(action => action.actionType === "CREATE_SUBTASK")
  const reviewedConstraints = constraints && stepsOnly ? { ...constraints, requiredPeople: null,
    people: constraints.people ? { ...constraints.people, mode: "max" as const } : null } : constraints
  const checked = reviewed && constraints ? validatePlanAgainstConstraints({ ...reviewed, tasks: effectiveTasks,
    totalHours: effectiveTasks.reduce((sum,task)=>sum+task.estimate,0) }, { ...reviewedConstraints!, lockedTaskKeys: [], lockedTasks: {} }, projectedState) : null
  if (stepsOnly && constraints?.requiredPeople) warnings.push("本次只应用新增步骤；整体方案的人数目标保留为讨论安排，未采纳的负责人调整不会写入项目")
  const metadataChecked = reviewed && constraints ? validatePlanAgainstConstraints(reviewed, { ...constraints, people:null, requiredPeople:null,maxPeople:null,maxHours:null,maxTotalHours:null,memberRules:{},testOnlyMemberIds:[],excludedMemberIds:[],allowedMemberIds:[] }, state) : null
  if (checked) errors.push(...checked.violations.map((item) => item.message))
  if (metadataChecked) errors.push(...metadataChecked.violations.map(item=>item.message))
  if (proposal.sourcePlanId && (!proposal.planSnapshot || proposal.planSnapshot.planId !== proposal.sourcePlanId || proposal.planSnapshot.revision !== proposal.sourcePlanRevision))
    errors.push("Proposal来源Plan revision不一致")
  const sourceSession=Object.values(state.meetingSessions).find(item=>item.proposalIds.includes(proposal.id))??session
  const latestRevision=sourceSession?.memory?.workingState?.planRevisions.filter(plan=>plan.planId===proposal.sourcePlanId).at(-1)
  if(latestRevision&&latestRevision.revision!==proposal.sourcePlanRevision)
    errors.push('来源Plan已产生新revision，请按最新约束重新生成Proposal；旧建议不能继续Apply')
  for (const action of accepted.filter(item=>item.actionType==='CREATE_SUBTASK')) {
    const id=String(action.proposedValue.assigneeId??'')
    if (constraints?.excludedMemberIds.includes(id)) errors.push("新增子任务仍分配给已排除成员")
  }
  errors.push(...validateProjectDependencyGraph(projectedState))
  const capacitySprintId = proposal.planSnapshot?.focus.sprintId ?? (tasks[0] ? state.stories[tasks[0].storyId]?.sprintId : null)
  if (capacitySprintId && tasks.length) {
    const before=projectPlanCapacity(state,capacitySprintId,[])
    const capacity=projectPlanCapacity(projectedState,capacitySprintId,[])
    for (const member of Object.values(capacity.members)) if (member.projectedLoad>member.timeWindowCapacityHours && member.projectedLoad>before.members[member.memberId].currentLoad)
      errors.push(`${member.memberName}调整后 ${member.projectedLoad}h 超过剩余时间窗口容量 ${member.timeWindowCapacityHours}h`)
  }
  if (schedule && snapshot?.focusedSprint && schedule.estimatedDurationDays > snapshot.focusedSprint.remainingWorkingDays)
    warnings.push(`${snapshot.focusedSprint.name}剩余 ${snapshot.focusedSprint.remainingWorkingDays} 个工作日，少于审核后的预计工期；请确认排期`)
  if (tasks.some((task) => state.stories[task.storyId]?.sprintId && state.sprints[state.stories[task.storyId].sprintId!]?.status === "closed"))
    errors.push("已关闭 Sprint 中的 Story 不能执行新增任务计划")

  const workloadSummary: string[] = []
  if (snapshot) for (const member of Object.values(snapshot.members)) {
    const before = member.currentSprintWorkload
    let after = before
    for (const task of tasks) {
      if (task.sourceTaskId) {
        const current = snapshot.tasks[task.sourceTaskId]
        if (current && current.assigneeId !== task.assigneeId) {
          if (current.assigneeId === member.id) after -= current.remainingHours
          if (task.assigneeId === member.id) after += current.remainingHours
        }
      } else if (task.assigneeId === member.id) after += task.estimate
    }
    if (after !== before) {
      workloadSummary.push(`${member.name}：${before}h → ${after}h`)
      const capacity = Math.max(0, member.dailyHours * (snapshot.focusedSprint?.remainingWorkingDays ?? 0))
      if (after > capacity && after > before) warnings.push(`${member.name}在当前 Sprint 的工作量将达到 ${after}h，超过剩余容量 ${capacity}h`)
    }
  }
  const criticalPath = schedule?.criticalPathKeys.map((key) => tasks.find((task) => task.key === key)?.title ?? key) ?? []
  return {
    valid: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)],
    businessSummary: businessChangeSummary(accepted),
    scheduleSummary: schedule ? `预计约 ${schedule.estimatedDurationDays} 个工作日` : "当前建议没有可计算的任务计划",
    workloadSummary, dependencySummary: `采纳 ${accepted.filter((action) => action.actionType === "ADD_DEPENDENCY").length} 条依赖，拒绝 ${rejected.filter((action) => action.actionType === "ADD_DEPENDENCY").length} 条建议依赖`,
    criticalPath, estimatedDuration: schedule?.estimatedDurationDays ?? 0,
    constraintViolations: checked?.violations ?? [],
  }
}
