import { addBusinessDays, differenceInBusinessDays, format, parseISO } from "date-fns"
import { runPlanningMeeting } from "./meeting"
import { calculatePlanSchedule } from "./meetingSchedule"
import { validatePlanAgainstConstraints } from "./meetingConstraintValidator"
import { businessChangeSummary, describeBusinessChanges } from "./meetingBusinessSummary"
import { buildProjectAnalysisSnapshot, type ProjectAnalysisSnapshot } from "./meetingSnapshot"
import { projectPlanCapacity, taskContributions } from "./meetingCapacity"
import { reconcilePlanSteps } from './meetingPlanWork'
import { buildWorkloadSnapshot, sprintWindow } from "../utils/workloadAnalysis"
import type {
  AgentProposal, MeetingConstraints, MeetingMemory, MeetingPlanTask, MeetingSession,
  PlanOption, ProjectDataState, ProposalAction, ProposalPrecondition, StoryEntity, TaskEntity,
} from "../types"

type WorkTrack = { label: string; type: TaskEntity["type"]; phase: string; steps?: string[] }

function engineeringTracks(story: StoryEntity, criteria: string[], frontendBackend: boolean): WorkTrack[] {
  const text = [story.title, story.iWant, story.soThat, ...criteria].join(" ")
  if (/Sprint Review|验收流程|验收结果|验收状态/.test(text)) return [
    { label: "实现 Story 验收状态与结果记录", type: "backend", phase: "数据与规则", steps: ["定义验收结果与状态转换", "保存并读取验收记录"] },
    { label: "开发 Sprint Review 验收操作", type: "frontend", phase: "交互实现" },
    { label: "实现未通过 Story 的后续排期处理", type: "backend", phase: "流程实现" },
    { label: "补充验收流程与退回场景测试", type: "test", phase: "验证" },
  ]
  if (/甘特|依赖线|时间轴/.test(text)) return [
    { label: "实现任务依赖关系查询", type: "backend", phase: "数据与接口" },
    { label: "绘制甘特任务依赖连接线", type: "frontend", phase: "交互实现" },
    { label: "验证跨 Story 依赖与日期变化", type: "test", phase: "验证" },
  ]
  if (/数据模型|字段|持久化|数据库/.test(text)) return [
    { label: "定义数据结构与字段校验", type: "database", phase: "数据设计" },
    { label: "实现数据读写与迁移", type: "backend", phase: "实现" },
    { label: "补充数据边界与兼容性测试", type: "test", phase: "验证" },
  ]
  if (frontendBackend || /界面|页面|操作|交互|接口/.test(text)) return [
    { label: `实现${story.title}的服务接口`, type: "backend", phase: "接口实现" },
    { label: `开发${story.title}的页面交互`, type: "frontend", phase: "并行开发" },
    { label: `验证${story.title}的端到端流程`, type: "test", phase: "联调验证" },
  ]
  return [
    { label: `梳理${story.title}的输入与边界`, type: "design", phase: "方案" },
    { label: `实现${story.title}的核心逻辑`, type: "backend", phase: "实现" },
    { label: `验证${story.title}的主要场景`, type: "test", phase: "验证" },
  ]
}

export function meetingStories(state: ProjectDataState, session: MeetingSession): StoryEntity[] {
  return session.targetType === "story" ? [state.stories[session.targetId]].filter(Boolean)
    : Object.values(state.stories).filter((story) => story.sprintId === session.targetId && story.deliveryStatus !== "accepted")
}

export function memberLoads(state: ProjectDataState, sprintId: string | null): Record<string, number> {
  return Object.fromEntries(Object.entries(buildWorkloadSnapshot(state, sprintId).members).map(([id, member]) => [id, member.currentSprintWorkload]))
}

export function remainingBusinessDays(state: ProjectDataState, sprintId: string | null, today = new Date()): number {
  return sprintWindow(state, sprintId, today).remainingWorkingDays
}

function dailyCapacity(state: ProjectDataState, memberId: string): number {
  return Math.max(0, (state.members[memberId]?.capacityHours ?? 0) / 5)
}

function sourceTasks(state: ProjectDataState, story: StoryEntity): MeetingPlanTask[] {
  return story.taskIds.map((id) => state.tasks[id]).filter((task) => task && task.status !== "done").map((task) => ({
    key: task.id, storyId: story.id, sourceTaskId: task.id, title: task.title, type: task.type,
    estimate: task.estimate, assigneeId: task.assigneeId, phase: "已有工作",
    dependsOnKeys: Object.values(state.dependencies).filter((dep) => dep.targetTaskId === task.id).map((dep) => dep.sourceTaskId),
    subtaskTitles: [], startDate: task.startDate, endDate: task.endDate,
  }))
}

function draftTasks(state: ProjectDataState, story: StoryEntity, count: number, frontendBackend: boolean): MeetingPlanTask[] {
  const criteria = story.acceptanceCriteriaIds.map((id) => state.acceptanceCriteria[id]?.content).filter((value): value is string => Boolean(value))
  const existing = story.taskIds.map((id) => state.tasks[id]?.title).filter(Boolean)
  const tracks = engineeringTracks(story, criteria, frontendBackend)
  const tasks: MeetingPlanTask[] = []
  for (const [index, track] of tracks.entries()) {
    if (tasks.length >= count) break
    const title = track.label
    if (existing.some((value) => value === title || value.includes(title) || title.includes(value))) continue
    const estimate = Math.max(2, Math.ceil((story.storyPoints * 2 || 12) / count))
    tasks.push({ key: `draft-${story.id}-${index}`, storyId: story.id, sourceTaskId: null, title,
      type: track.type,
      estimate, assigneeId: story.assigneeId, phase: track.phase, dependsOnKeys: [],
      subtaskTitles: estimate >= 10 ? track.steps ?? [] : [], startDate: story.startDate, endDate: story.dueDate })
  }
  const data = tasks.find((task) => task.phase === "数据与规则" || task.phase === "数据设计")
  const flow = tasks.find((task) => task.phase === "流程实现")
  const interaction = tasks.find((task) => task.type === "frontend")
  if (data && flow) flow.dependsOnKeys = [data.key]
  const validation = tasks.find((task) => task.type === "test")
  if (validation) validation.dependsOnKeys = [flow?.key, interaction?.key].filter((key): key is string => Boolean(key))
  return tasks
}

function workingTasks(state: ProjectDataState, session: MeetingSession, memory: MeetingMemory): MeetingPlanTask[] {
  const previous = memory.options.find((option) => option.id === memory.activePlanId)?.tasks
  const stories = meetingStories(state, session)
  if (previous?.length) {
    const currentExisting = stories.flatMap((story) => sourceTasks(state, story))
    const previousKeys = new Set(previous.map((task) => task.key))
    return [
      ...previous.filter((task) => !memory.constraints.removedTaskKeys.includes(task.key) && state.stories[task.storyId] && (!task.sourceTaskId || state.tasks[task.sourceTaskId])),
      ...currentExisting.filter((task) => !previousKeys.has(task.key)),
    ]
  }
  return stories.flatMap((story) => {
    const existing = sourceTasks(state, story)
    const wanted = Math.max(existing.length, engineeringTracks(story, story.acceptanceCriteriaIds.map((id) => state.acceptanceCriteria[id]?.content ?? ""), memory.constraints.frontendBackend).length)
    const drafts = draftTasks(state, story, Math.max(0, wanted - existing.length), memory.constraints.frontendBackend)
    return [...existing, ...drafts.filter((task) => !memory.constraints.backendOnly || task.type === "backend" || task.type === "database")]
  })
}

function optionMetrics(state: ProjectDataState, session: MeetingSession, tasks: MeetingPlanTask[], constraints: MeetingConstraints, mode: MeetingMemory["planningMode"], snapshot: ProjectAnalysisSnapshot) {
  const stories = meetingStories(state, session)
  const sprintId = mode === "wbs_only" ? null : constraints.targetSprintId ?? (session.targetType === "sprint" ? session.targetId : stories[0]?.sprintId ?? null)
  const projected = projectPlanCapacity(state, sprintId, tasks).projectedLoad
  const schedule = calculatePlanSchedule(tasks, snapshot)
  const duration = schedule.estimatedDurationDays
  const remaining = sprintId ? snapshot.sprints[sprintId]?.remainingWorkingDays ?? 0 : 10
  const reasons = [
    schedule.cycle ? "任务依赖形成循环，无法计算工期" : "",
    schedule.unresolvedDependencies.length ? `仍有 ${schedule.unresolvedDependencies.length} 个未完成的外部前置任务，工期需要先确认` : "",
    constraints.maxDays && duration > constraints.maxDays ? `按现有工时与依赖估算至少需要 ${duration} 个工作日，超过 ${constraints.maxDays} 天限制` : "",
    constraints.maxHours && tasks.reduce((sum, task) => sum + task.estimate, 0) > constraints.maxHours ? `总估算工时超过 ${constraints.maxHours} 小时限制` : "",
    sprintId && duration > remaining ? `${state.sprints[sprintId]?.name ?? "当前 Sprint"} 剩余 ${remaining} 个工作日，预计不足以完成` : "",
    sprintId && tasks.some((task) => !task.sourceTaskId && (task.startDate < state.sprints[sprintId].startDate || task.endDate > state.sprints[sprintId].endDate))
      ? `新增任务的计划日期超出 ${state.sprints[sprintId].name}，需先调整 Story 排期` : "",
    mode === "normal" && constraints.targetSprintId && stories.some((story) => story.sprintId !== constraints.targetSprintId) ? "Story 尚未安排到指定 Sprint，需先在项目中调整归属" : "",
    mode === "normal" && stories.some((story) => story.sprintId && state.sprints[story.sprintId]?.status === "closed") ? "Story 所属 Sprint 已关闭，无法新增任务" : "",
    tasks.some((task) => !state.members[task.assigneeId]) ? "部分任务没有可用负责人" : "",
    tasks.some((task) => constraints.excludedMemberIds.includes(task.assigneeId)) ? "方案仍包含已排除成员" : "",
    tasks.some((task) => constraints.testOnlyMemberIds.includes(task.assigneeId) && task.type !== "test") ? "指定成员只能承担测试工作" : "",
    tasks.some((task) => constraints.lockStartedTasks && task.sourceTaskId && state.tasks[task.sourceTaskId]?.status === "in_progress" && state.tasks[task.sourceTaskId].assigneeId !== task.assigneeId) ? "正在进行的任务不能更换负责人" : "",
    constraints.maxPeople && new Set(tasks.map((task) => task.assigneeId).filter(Boolean)).size > constraints.maxPeople
      ? `锁定分工需要超过 ${constraints.maxPeople} 位成员，人数限制无法同时满足` : "",
  ].filter(Boolean)
  return { projected, duration, totalHours: tasks.reduce((sum, task) => sum + task.estimate, 0), reasons, remaining, schedule }
}

export function createPlanOptions(state: ProjectDataState, session: MeetingSession, memory: MeetingMemory, analysis = buildProjectAnalysisSnapshot(state, session, memory)): PlanOption[] {
  const tasks = workingTasks(state, session, memory)
  if (!tasks.length) return []
  // These are proposed engineering relations in the Plan, never registered project facts.
  for (const storyId of new Set(tasks.map(task=>task.storyId))) {
    const group=tasks.filter(task=>task.storyId===storyId)
    if (!group.every(task=>task.sourceTaskId)) continue
    if (group.some(task=>task.dependsOnKeys.length)) continue
    const data=group.find(task=>task.type==='database') ?? group.find(task=>task.type==='backend')
    if (data) for (const task of group) if (task.key!==data.key && task.type!=='test') task.dependsOnKeys=[data.key]
    for (const task of group.filter(task=>task.type==='test')) task.dependsOnKeys=group.filter(other=>other.key!==task.key && other.type!=='test').map(other=>other.key)
  }
  const constraints = memory.constraints
  const stories = meetingStories(state, session)
  const sprintId = constraints.targetSprintId ?? (session.targetType === "sprint" ? session.targetId : stories[0]?.sprintId ?? null)
  const loads = sprintId === analysis.focusedSprint?.id
    ? Object.fromEntries(Object.values(analysis.members).map((member) => [member.id, member.currentSprintWorkload]))
    : memberLoads(state, sprintId)
  const requiredIds = new Set(tasks.filter((task) => constraints.lockedTaskKeys.includes(task.key) ||
    Boolean(task.sourceTaskId && constraints.lockStartedTasks && state.tasks[task.sourceTaskId]?.status === "in_progress"))
    .map((task) => task.assigneeId).concat(Object.values(constraints.assignmentOverrides)))
  const eligiblePool = Object.values(state.members).filter((member) => !constraints.excludedMemberIds.includes(member.id) &&
    (!constraints.allowedMemberIds.length || constraints.allowedMemberIds.includes(member.id)))
    .sort((a, b) => (loads[a.id] ?? 0) / Math.max(1, dailyCapacity(state, a.id)) - (loads[b.id] ?? 0) / Math.max(1, dailyCapacity(state, b.id)))
  const eligible = [...eligiblePool.filter((member) => requiredIds.has(member.id)),
    ...eligiblePool.filter((member) => !requiredIds.has(member.id))]
    .slice(0, Math.max(requiredIds.size, constraints.maxPeople ?? eligiblePool.length))
  const build = (id: "A" | "B"): PlanOption => {
    const assigned = { ...loads }
    for (const task of tasks) if (task.sourceTaskId) {
      for (const [memberId,hours] of Object.entries(taskContributions(state,state.tasks[task.sourceTaskId])))
        assigned[memberId] = Math.max(0,(assigned[memberId]??0)-hours)
    }
    const planned = tasks.map((task, index) => {
      const lockedTask = constraints.lockedTasks?.[task.key]
      const copy = lockedTask ? structuredClone(lockedTask) : { ...task, dependsOnKeys: [...task.dependsOnKeys], subtaskTitles: constraints.allowSubtasks ? [...task.subtaskTitles] : [] }
      const override = constraints.assignmentOverrides[task.key]
      const preferred = constraints.preferredAssigneeId
      const taskEligible = eligible.filter((member) => (task.type === "test" || !constraints.testOnlyMemberIds.includes(member.id)) &&
        (!constraints.memberRules?.[member.id]?.allowedTaskTypes || constraints.memberRules[member.id].allowedTaskTypes!.includes(task.type)))
      const locked = Boolean(lockedTask) || constraints.lockedTaskKeys.includes(task.key) || Boolean(task.sourceTaskId && constraints.lockStartedTasks && state.tasks[task.sourceTaskId]?.status === "in_progress")
      const keep = taskEligible.some((member) => member.id === task.assigneeId) && (locked || Boolean(task.sourceTaskId) && (constraints.preserveExisting || id === "A"))
      const candidate = locked && keep ? task.assigneeId
        : override && taskEligible.some((member) => member.id === override) ? override
        : id === "A" && keep ? task.assigneeId
          : id === "A" && preferred && taskEligible.some((member) => member.id === preferred) && index === 0 ? preferred
            : id === "A" && constraints.parallel && taskEligible.length ? taskEligible[index % taskEligible.length].id
            : [...taskEligible].sort((a, b) => (assigned[a.id] ?? 0) / Math.max(1, dailyCapacity(state, a.id)) - (assigned[b.id] ?? 0) / Math.max(1, dailyCapacity(state, b.id)))[0]?.id
      copy.assigneeId = lockedTask?.assigneeId ?? candidate ?? ""
      if (candidate) assigned[candidate] = (assigned[candidate] ?? 0) + task.estimate
      return copy
    })
    if (!constraints.parallel) {
      const newTasks = planned.filter((task) => !task.sourceTaskId)
      for (let index = 1; index < newTasks.length; index++) {
        if (!newTasks[index].dependsOnKeys.length) newTasks[index].dependsOnKeys = [newTasks[index - 1].key]
      }
    }
    const requiredPeople = constraints.requiredPeople ?? null
    if (requiredPeople && requiredPeople <= planned.length) {
      const used = new Set(planned.map((task) => task.assigneeId).filter(Boolean))
      for (const member of eligible.filter((item) => !used.has(item.id))) {
        if (used.size >= requiredPeople) break
        const movable = [...planned].reverse().find((task) =>
          !constraints.lockedTaskKeys.includes(task.key) && !constraints.lockedTasks?.[task.key] &&
          !constraints.assignmentOverrides[task.key] &&
          !(task.sourceTaskId && constraints.lockStartedTasks && state.tasks[task.sourceTaskId]?.status === "in_progress") &&
          (task.type === "test" || !constraints.testOnlyMemberIds.includes(member.id)) &&
          (!constraints.memberRules?.[member.id]?.allowedTaskTypes || constraints.memberRules[member.id].allowedTaskTypes!.includes(task.type)) &&
          planned.filter((item) => item.assigneeId === task.assigneeId).length > 1)
        if (!movable) break
        movable.assigneeId = member.id
        used.add(member.id)
      }
    }
    const metrics = optionMetrics(state, session, planned, constraints, memory.planningMode, analysis)
    const missingCriteria = stories.some((story) => story.acceptanceCriteriaIds.length === 0)
    const risk = [missingCriteria ? "部分 Story 缺少验收标准" : "", metrics.reasons[0] ?? ""].filter(Boolean).join("；") || "当前未发现明显的范围或容量冲突"
    const option: PlanOption = {
      id, kind: "decomposition", title: id === "A" ? "方案 A · 少改现有安排" : "方案 B · 优先平衡负载",
      summary: id === "A" ? "尽量保留已有任务和负责人，只补齐缺少的工作" : "在允许成员中重新比较负载，优先给空余较多的人",
      tasks: planned, estimatedDurationDays: metrics.duration, totalHours: metrics.totalHours,
      subtasks: structuredClone(memory.options.find(option=>option.id===memory.activePlanId)?.subtasks ?? []),
      workloadSummary: metrics.projected, riskSummary: risk,
      advantages: id === "A" ? ["现有任务改动少", "团队可沿用当前分工"] : ["新增工作分布更均衡", "可减轻高负载成员压力"],
      tradeoffs: id === "A" ? ["可能保留原有负载不均"] : ["可能需要调整已有任务负责人"],
      feasible: metrics.reasons.length === 0, infeasibleReasons: metrics.reasons,
      criticalPathHours: metrics.schedule.criticalPathHours,
      criticalPathTaskKeys: metrics.schedule.criticalPathKeys,
      scheduledTasks: metrics.schedule.tasks,
    }
    reconcilePlanSteps(option, constraints, state)
    if (option.subtasks?.length) {
      const revisedMetrics = optionMetrics(state, session, option.tasks, constraints, memory.planningMode, analysis)
      const schedule = revisedMetrics.schedule
      Object.assign(option, { estimatedDurationDays: revisedMetrics.duration,
        criticalPathHours: schedule.criticalPathHours, criticalPathTaskKeys: schedule.criticalPathKeys, scheduledTasks: schedule.tasks,
        workloadSummary: projectPlanCapacity(state, sprintId, option.tasks, new Date(), option.subtasks).projectedLoad,
        infeasibleReasons: revisedMetrics.reasons })
    }
    const checked = validatePlanAgainstConstraints(option, constraints, state)
    option.infeasibleReasons = [...new Set([...option.infeasibleReasons, ...checked.violations.map((item) => item.message)])]
    option.feasible = option.infeasibleReasons.length === 0
    return option
  }
  return [build("A"), build("B")]
}

export function describeOptions(state: ProjectDataState, options: PlanOption[]): string {
  if (!options.length) return "当前没有可继续拆分的工作。请先确认 Story 或 Sprint 是否仍有未完成内容。"
  const feasible = options.filter((option) => option.feasible)
  if (!feasible.length) return `当前条件无法同时满足：${[...new Set(options.flatMap((option) => option.infeasibleReasons))].join("；")}。请调整限制后再生成执行方案。`
  const tasks = feasible[0].tasks
  const critical = options[0].criticalPathTaskKeys?.map((key) => tasks.find((task) => task.key === key)?.title).filter(Boolean).join(" → ")
  const overview = `我把这项工作整理成 ${tasks.length} 个工程工作项，总估算 ${feasible[0].totalHours} 小时。依赖关键路径约 ${feasible[0].criticalPathHours ?? 0} 小时${critical ? `（${critical}）` : ""}；结合负责人每日容量，预计约 ${feasible[0].estimatedDurationDays} 个工作日。`
  const lines = feasible.map((option) => `${option.title}：预计约 ${option.estimatedDurationDays} 个工作日。${option.summary}。${option.advantages.join("；")}。`)
  const assignments = tasks.map((task, index) => `${index + 1}. ${task.phase}：${task.title}，${task.estimate} 小时，建议${state.members[task.assigneeId]?.name ?? "待确认"}负责${task.sourceTaskId ? "（沿用现有任务）" : ""}${task.dependsOnKeys.length ? `；前置：${task.dependsOnKeys.map((key) => tasks.find((item) => item.key === key)?.title ?? state.tasks[key]?.title ?? key).join("、")}` : "；可独立推进"}`).join("\n")
  const steps = (feasible[0].subtasks ?? []).map(step => `- 执行步骤：${step.title}，${step.estimate}h，${state.members[step.assigneeId]?.name ?? '待确认'}（父任务：${tasks.find(task => task.key === step.parentTaskKey)?.title ?? step.parentTaskKey}）`).join('\n')
  return `${overview}\n${assignments}\n${steps}\n${lines.join("\n")}\n你可以选 A 或 B，也可以继续修改人数、负责人和工期。`
}

function storyPreconditions(state: ProjectDataState, story: StoryEntity): ProposalPrecondition[] {
  return [
    { targetType: "story", targetId: story.id, field: "title", expectedValue: story.title },
    { targetType: "story", targetId: story.id, field: "sprintId", expectedValue: story.sprintId },
    { targetType: "story", targetId: story.id, field: "taskIds", expectedValue: story.taskIds },
    { targetType: "story", targetId: story.id, field: "acceptanceCriteriaIds", expectedValue: story.acceptanceCriteriaIds },
  ]
}

function proposalAction(type: ProposalAction["actionType"], targetType: ProposalAction["targetType"], targetId: string,
  value: Record<string, unknown>, reason: string, conditions: ProposalPrecondition[], dependencies: string[] = [], beforeValue: unknown = null): ProposalAction {
  return { id: `action-${crypto.randomUUID()}`, actionType: type, targetType, targetId,
    beforeValue, proposedValue: value, reason, decision: "pending", status: "pending", preconditions: conditions,
    dependsOnActionIds: dependencies, resultTargetId: null, appliedAt: null, error: null }
}

export function proposalFromOption(state: ProjectDataState, session: MeetingSession, option: PlanOption): AgentProposal | null {
  if (!option.feasible) return null
  if (option.tasks.some((task) => {
    const sprintId = state.stories[task.storyId]?.sprintId
    return sprintId && state.sprints[sprintId]?.status === "closed"
  })) return null
  const actions: ProposalAction[] = []
  const taskActionIds = new Map<string, string>()
  for (const task of option.tasks) {
    const story = state.stories[task.storyId]
    if (!story) continue
    if (!task.sourceTaskId) {
      if (story.taskIds.some((id) => state.tasks[id]?.title === task.title)) continue
      const create = proposalAction("CREATE_TASK", "story", story.id,
        { title: task.title, type: task.type, estimate: task.estimate, assigneeId: task.assigneeId, startDate: task.startDate, endDate: task.endDate },
        `${task.phase}阶段的执行工作；依据会议选定的${option.title}`, storyPreconditions(state, story))
      actions.push(create)
      taskActionIds.set(task.key, create.id)
      for (const title of task.subtaskTitles) actions.push(proposalAction("CREATE_SUBTASK", "task", create.id,
        { title, estimate: task.estimate / task.subtaskTitles.length, assigneeId: task.assigneeId },
        "保留可跟踪的完成与验证步骤", storyPreconditions(state, story), [create.id]))
    } else {
      const current = state.tasks[task.sourceTaskId]
      if (!current || current.assigneeId === task.assigneeId) continue
      actions.push(proposalAction("UPDATE_TASK", "task", current.id, { assigneeId: task.assigneeId },
        `按${option.title}平衡负责人负载`, [
          { targetType: "task", targetId: current.id, field: "assigneeId", expectedValue: current.assigneeId },
          { targetType: "task", targetId: current.id, field: "estimate", expectedValue: current.estimate },
        ], [], { assigneeId: current.assigneeId }))
      for (const id of current.subtaskIds) {
        const subtask = state.subtasks[id]
        if (subtask && subtask.assigneeId !== task.assigneeId) actions.push(proposalAction("UPDATE_SUBTASK", "subtask", id,
          { assigneeId: task.assigneeId }, "负责人调整后保持执行步骤一致", [
            { targetType: "subtask", targetId: id, field: "assigneeId", expectedValue: subtask.assigneeId },
          ], [], { assigneeId: subtask.assigneeId }))
      }
    }
  }
  for (const step of option.subtasks ?? []) {
    const parent = taskActionIds.get(step.parentTaskKey) ?? option.tasks.find(task=>task.key===step.parentTaskKey)?.sourceTaskId ?? step.parentTaskKey
    const task = option.tasks.find(task=>task.key===step.parentTaskKey)
    if (!task || state.subtasks[step.key]) continue
    const story = state.stories[task.storyId]
    actions.push(proposalAction('CREATE_SUBTASK','task',parent,{title:step.title,estimate:step.estimate,assigneeId:step.assigneeId},'版本化Plan中的新增执行步骤',storyPreconditions(state,story),taskActionIds.has(step.parentTaskKey)?[parent]:[]))
  }
  for (const task of option.tasks) for (const sourceKey of task.dependsOnKeys) {
    const sourceId = taskActionIds.get(sourceKey) ?? option.tasks.find((item) => item.key === sourceKey)?.sourceTaskId
    const targetId = taskActionIds.get(task.key) ?? task.sourceTaskId
    if (!sourceId || !targetId || Object.values(state.dependencies).some((dep) => dep.sourceTaskId === sourceId && dep.targetTaskId === targetId)) continue
    const story = state.stories[task.storyId]
    actions.push(proposalAction("ADD_DEPENDENCY", "dependency", `${sourceId}->${targetId}`,
      { sourceTaskId: sourceId, targetTaskId: targetId }, "会议方案中的前置关系", storyPreconditions(state, story),
      [sourceKey, task.key].map((key) => taskActionIds.get(key)).filter((id): id is string => Boolean(id))))
  }
  if (!actions.length) return null
  const analysisTarget = session.targetType === "project"
    ? { type: "story" as const, id: option.tasks[0].storyId }
    : { type: session.targetType, id: session.targetId }
  const base = runPlanningMeeting(state, analysisTarget.type, analysisTarget.id).proposal
  const now = new Date().toISOString()
  return { ...base, id: `proposal-${crypto.randomUUID()}`, agentType: "plan_execution",
    summary: `${option.title}：${describeBusinessChanges(businessChangeSummary(actions))}`,
    reasoning: `根据本次会议选定的${option.title}、成员容量与现有任务生成；预计至少 ${option.estimatedDurationDays} 个工作日。`,
    evidence: [...base.evidence, { agentType: "plan_execution", targetType: session.targetType, targetId: session.targetId,
      detail: `${option.totalHours} 小时；${option.riskSummary}；${option.summary}` }],
    originalActions: structuredClone(actions), actions, status: "draft", createdAt: now, updatedAt: now,
    reviewedAt: null, reviewedBy: null, appliedAt: null, applyError: null, reviewNote: "" }
}

export function projectedFinish(startDate: string, days: number): string {
  return format(addBusinessDays(parseISO(startDate), Math.max(0, days - 1)), "yyyy-MM-dd")
}
