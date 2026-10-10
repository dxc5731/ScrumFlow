import type {
  AgentProposal, AgentType, ProposalAction, ProposalEvidence,
  ProposalPrecondition, ProjectDataState, StoryEntity, TaskEntity,
} from "../types"
import { addDays, differenceInBusinessDays, parseISO } from "date-fns"
import { buildWorkloadSnapshot, remainingWork, taskLeaves } from "../utils/workloadAnalysis"
import { detectProjectEvents } from "../utils/eventDetection"
import { eventCondition } from "../utils/eventLifecycle"

export interface MeetingStage {
  agentType: AgentType
  title: string
  findings: string[]
}

export interface MeetingResult {
  proposal: AgentProposal
  stages: MeetingStage[]
}

const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

function action(
  actionType: ProposalAction["actionType"],
  targetType: ProposalAction["targetType"],
  targetId: string,
  proposedValue: Record<string, unknown>,
  reason: string,
  preconditions: ProposalPrecondition[],
  dependsOnActionIds: string[] = [],
  beforeValue: unknown = null,
): ProposalAction {
  return {
    id: uid("action"), actionType, targetType, targetId, beforeValue,
    proposedValue, reason, decision: "pending", status: "pending",
    preconditions, dependsOnActionIds, resultTargetId: null,
    appliedAt: null, error: null,
  }
}

function storyConditions(state: ProjectDataState, story: StoryEntity): ProposalPrecondition[] {
  return [
    { targetType: "story", targetId: story.id, field: "title", expectedValue: story.title },
    { targetType: "story", targetId: story.id, field: "sprintId", expectedValue: story.sprintId },
    { targetType: "story", targetId: story.id, field: "startDate", expectedValue: story.startDate },
    { targetType: "story", targetId: story.id, field: "dueDate", expectedValue: story.dueDate },
    { targetType: "story", targetId: story.id, field: "acceptanceCriteriaIds", expectedValue: story.acceptanceCriteriaIds },
    { targetType: "story", targetId: story.id, field: "acceptanceCriteriaContents", expectedValue: story.acceptanceCriteriaIds.map((id) => state.acceptanceCriteria[id]?.content ?? null) },
  ]
}

function memberLoads(state: ProjectDataState, sprintId: string | null) {
  return Object.fromEntries(Object.entries(buildWorkloadSnapshot(state, sprintId).members).map(([id, member]) => [id, member.currentSprintWorkload]))
}

function affectedTasks(state: ProjectDataState, blockedTaskIds: string[]) {
  const affected = new Set<string>()
  const queue = [...blockedTaskIds]
  while (queue.length) {
    const current = queue.shift()!
    for (const dependency of Object.values(state.dependencies)) {
      if (dependency.sourceTaskId !== current || affected.has(dependency.targetTaskId)) continue
      affected.add(dependency.targetTaskId)
      queue.push(dependency.targetTaskId)
    }
  }
  return [...affected]
}

function capacity(state: ProjectDataState, sprintId: string | null, memberId: string) {
  return buildWorkloadSnapshot(state, sprintId).members[memberId]?.remainingTimeCapacity ?? 0
}

function availableMember(state: ProjectDataState, loads: Record<string, number>, estimate: number, sprintId: string | null) {
  return Object.values(state.members)
    .sort((a, b) => (loads[a.id] / Math.max(1, capacity(state, sprintId, a.id))) - (loads[b.id] / Math.max(1, capacity(state, sprintId, b.id))))
    .find((member) => loads[member.id] + estimate <= capacity(state, sprintId, member.id))?.id
    ?? Object.values(state.members)[0]?.id ?? ""
}

export function runPlanningMeeting(
  state: ProjectDataState,
  targetType: "story" | "sprint",
  targetId: string,
): MeetingResult {
  const sprint = targetType === "sprint" ? state.sprints[targetId] : null
  const story = targetType === "story" ? state.stories[targetId] : null
  if (!sprint && !story) throw new Error("会议目标不存在")
  const stories = story ? [story] : Object.values(state.stories).filter((item) => item.sprintId === targetId)
  const evidence: ProposalEvidence[] = []
  const actions: ProposalAction[] = []
  const stages: MeetingStage[] = []
  const context = `${stories.length} 个 Story、${stories.reduce((sum, item) => sum + item.taskIds.length, 0)} 个现有 Task、${Object.keys(state.members).length} 位成员`
  stages.push({ agentType: "project_orchestrator", title: "项目上下文", findings: [context, sprint ? `Sprint ${sprint.name}：${sprint.startDate} 至 ${sprint.endDate}` : `Story ${story!.title}`] })

  const decomposition: string[] = []
  const dependencyActions: ProposalAction[] = []
  const plannedLoads = new Map<string, Record<string, number>>()
  for (const item of stories) {
    const criteria = item.acceptanceCriteriaIds.map((id) => state.acceptanceCriteria[id]).filter(Boolean)
    evidence.push({ agentType: "task_decomposition", targetType: "story", targetId: item.id, detail: `${criteria.length} 条验收标准，${item.taskIds.length} 个现有 Task；Story 时间 ${item.startDate} 至 ${item.dueDate}` })
    if (item.taskIds.length || item.deliveryStatus === "accepted" || (item.sprintId && state.sprints[item.sprintId]?.status === "closed")) {
      decomposition.push(`${item.id} 已有任务、已验收或所在 Sprint 已关闭，保留现有拆分`)
      continue
    }
    const loadKey = item.sprintId ?? "backlog"
    const loads = plannedLoads.get(loadKey) ?? memberLoads(state, item.sprintId)
    plannedLoads.set(loadKey, loads)
    const inputs = criteria.length ? criteria.slice(0, 4).map((criterion) => criterion.content) : [item.iWant || item.title]
    let previousTask: ProposalAction | null = null
    for (const [index, criterion] of inputs.entries()) {
      const estimate = Math.max(2, Math.min(8, Math.ceil(item.storyPoints * 2 / inputs.length) || 4))
      const assigneeId = availableMember(state, loads, estimate, item.sprintId)
      loads[assigneeId] = (loads[assigneeId] ?? 0) + estimate
      const title = criterion.length > 48 ? `${criterion.slice(0, 48)}…` : criterion
      const type: TaskEntity["type"] = /测试|验证|验收/.test(criterion) ? "test" : /界面|页面|交互/.test(criterion) ? "frontend" : /数据|存储/.test(criterion) ? "database" : "backend"
      const task = action("CREATE_TASK", "story", item.id,
        { title, type, estimate, assigneeId, startDate: item.startDate, endDate: item.dueDate },
        `根据验收标准 ${index + 1} 拆分，预计 ${estimate} 小时；按当前 Sprint 负载建议负责人`, storyConditions(state, item))
      actions.push(task)
      actions.push(action("CREATE_SUBTASK", "task", task.id,
        { title: `实现：${title}`, estimate: Math.max(1, estimate - 1), assigneeId },
        "把实现工作拆为可跟踪的执行项", storyConditions(state, item), [task.id]))
      actions.push(action("CREATE_SUBTASK", "task", task.id,
        { title: `验证：${title}`, estimate: 1, assigneeId },
        "为验收标准保留明确的验证步骤", storyConditions(state, item), [task.id]))
      if (previousTask && /依赖|前置|之后|完成.*后/.test(criterion)) {
        dependencyActions.push(action("ADD_DEPENDENCY", "dependency", `${previousTask.id}->${task.id}`,
          { sourceTaskId: previousTask.id, targetTaskId: task.id },
          `验收标准 ${index + 1} 明确包含前后置线索，建议先完成上一项`, storyConditions(state, item), [previousTask.id, task.id]))
        decomposition.push(`${item.id}：建议任务 ${index} 完成后开始任务 ${index + 1}`)
      }
      previousTask = task
      decomposition.push(`${item.id}：从验收标准 ${index + 1} 生成 1 个 Task 和 2 个 Subtask`)
    }
  }
  actions.push(...dependencyActions)
  stages.push({ agentType: "task_decomposition", title: "Task 拆分", findings: decomposition.length ? decomposition : ["没有可拆分的 Story"] })

  const riskFindings: string[] = []
  for (const item of stories) {
    const itemSprint = item.sprintId ? state.sprints[item.sprintId] : null
    const blocked = item.taskIds.map((id) => state.tasks[id]).filter((task) => task?.status === "blocked")
    const affected = affectedTasks(state, blocked.map((task) => task.id))
    const late = Boolean(itemSprint && item.dueDate > itemSprint.endDate)
    const existing = Object.values(state.risks).find((risk) => risk.targetType === "story" && risk.targetId === item.id && risk.status !== "resolved")
    const relatedDependencies = Object.values(state.dependencies).filter((dep) => item.taskIds.includes(dep.sourceTaskId) || item.taskIds.includes(dep.targetTaskId))
    evidence.push({ agentType: "risk_dependency", targetType: "story", targetId: item.id, detail: `阻塞 Task ${blocked.map((task) => task.id).join(", ") || "无"}；受影响 Task ${affected.join(", ") || "无"}；关联 FS 依赖 ${relatedDependencies.length} 条；${late ? "截止日期超过 Sprint 结束日" : "截止日期未超过 Sprint"}` })
    const reasons = [blocked.length ? `${blocked.length} 个 Task 阻塞` : "", affected.length ? `影响下游任务 ${affected.join(", ")}` : "", late ? "Story 截止日期超出 Sprint" : "", item.risk === "high" ? "Story 风险等级为高" : ""].filter(Boolean)
    const impact = affected.length ? `受影响 Task：${affected.join(", ")}；可能影响 Story 验收及 Sprint 目标` : "可能影响 Story 验收及 Sprint 目标"
    if (reasons.length && !existing) {
      actions.push(action("CREATE_RISK", "story", item.id, {
        title: `${item.title} 交付风险`, targetType: "story", targetId: item.id,
        level: blocked.length || late || item.risk === "high" ? "high" : "medium", description: reasons.join("；"),
        impact, mitigation: "确认阻塞项和排期，优先处理关键路径", ownerId: item.assigneeId, status: "open",
      }, reasons.join("；"), [
        { targetType: "story", targetId: item.id, field: "risk", expectedValue: item.risk },
        { targetType: "story", targetId: item.id, field: "dueDate", expectedValue: item.dueDate },
        { targetType: "story", targetId: item.id, field: "openRiskIds", expectedValue: Object.values(state.risks).filter((risk) => risk.targetType === "story" && risk.targetId === item.id && risk.status !== "resolved").map((risk) => risk.id).sort() },
        ...(itemSprint ? [{ targetType: "sprint" as const, targetId: itemSprint.id, field: "endDate", expectedValue: itemSprint.endDate }] : []),
        ...blocked.map((task) => ({ targetType: "task" as const, targetId: task.id, field: "status", expectedValue: task.status })),
      ]))
      riskFindings.push(`${item.id}：${reasons.join("；")}`)
    } else if (existing && (blocked.length || late) && existing.level !== "high") {
      actions.push(action("UPDATE_RISK", "risk", existing.id,
        { level: "high", impact, mitigation: "确认阻塞项和排期，优先处理关键路径" },
        `${reasons.join("；")}；已有 Risk ${existing.id} 等级需上调`, [
          { targetType: "risk", targetId: existing.id, field: "level", expectedValue: existing.level },
          { targetType: "risk", targetId: existing.id, field: "status", expectedValue: existing.status },
          { targetType: "story", targetId: item.id, field: "dueDate", expectedValue: item.dueDate },
        ], [], { level: existing.level, impact: existing.impact, mitigation: existing.mitigation }))
      riskFindings.push(`${item.id}：建议上调已有 Risk ${existing.id} 的等级`)
    } else riskFindings.push(`${item.id}：已核对阻塞、依赖和排期，暂无新增 Risk`)
  }
  stages.push({ agentType: "risk_dependency", title: "风险与依赖", findings: riskFindings })

  const workloadFindings: string[] = []
  const sprintIds = [...new Set(stories.map((item) => item.sprintId))]
  for (const sprintId of sprintIds) {
    const loads = memberLoads(state, sprintId)
    for (const member of Object.values(state.members)) {
      const hours = loads[member.id] ?? 0
      const memberCapacity = capacity(state, sprintId, member.id)
      evidence.push({ agentType: "workload_capacity", targetType: "member", targetId: member.id, detail: `${sprintId ?? "Backlog"}：未完成任务 ${hours}h，按 Sprint 工作日折算容量 ${memberCapacity}h` })
      if (hours <= memberCapacity) continue
      workloadFindings.push(`${member.name}：${hours}h / ${memberCapacity}h，存在超载`)
      const candidate = Object.values(state.tasks).filter(task => state.stories[task.storyId]?.sprintId === sprintId && task.status !== "done")
        .flatMap(task => taskLeaves(state, task)).find(leaf => leaf.assigneeId === member.id && leaf.status === "todo")
      if (!candidate) continue
      const replacement = Object.values(state.members).find((other) => other.id !== member.id && (loads[other.id] ?? 0) + remainingWork(candidate) <= capacity(state, sprintId, other.id))
      if (!replacement) continue
      const type = state.tasks[candidate.id] ? "task" as const : "subtask" as const
      const event = sprintId ? detectProjectEvents(state, sprintId).find(event => event.kind === "workload" && event.targetId === member.id) : undefined
      actions.push(action(type === "task" ? "UPDATE_TASK" : "UPDATE_SUBTASK", type, candidate.id, { assigneeId: replacement.id },
        `${member.name} 已超载；${replacement.name} 当前 ${loads[replacement.id] ?? 0}h / ${capacity(state, sprintId, replacement.id)}h`,
        [{ targetType: type, targetId: candidate.id, field: "assigneeId", expectedValue: member.id },
          { targetType: type, targetId: candidate.id, field: "estimate", expectedValue: candidate.estimate },
          { targetType: "member", targetId: replacement.id, field: "capacityHours", expectedValue: replacement.capacityHours },
          ...(event && sprintId ? [eventCondition(state, event, sprintId)] : [])],
        [], { assigneeId: member.id }))
    }
  }
  stages.push({ agentType: "workload_capacity", title: "负载与容量", findings: workloadFindings.length ? workloadFindings : ["现有任务负载未超过成员容量"] })

  const now = new Date().toISOString()
  const proposal: AgentProposal = {
    schemaVersion: 1, id: uid("proposal"), projectId: state.project.id,
    origin: "meeting", triggerType: "manual", agentType: "project_orchestrator",
    targetType, targetId,
    summary: `${story?.title ?? sprint!.name}：${actions.length} 条规划建议`,
    reasoning: "依据当前 Story 验收标准、现有任务、依赖、风险、Sprint 日期和成员容量生成。所有建议需人工审核后执行。",
    evidence, originalActions: structuredClone(actions), actions, status: "draft",
    createdBy: state.workspace.currentUserId, createdAt: now, updatedAt: now,
    reviewedBy: null, reviewedAt: null, reviewNote: "", appliedAt: null, applyError: null,
  }
  stages.push({ agentType: "project_orchestrator", title: "汇总 Proposal", findings: [`生成 ${actions.length} 条 Action；等待人工审阅`] })
  return { proposal, stages }
}

export function buildParallelTaskProposal(state: ProjectDataState, storyId: string, count = 3): AgentProposal | null {
  const story = state.stories[storyId]
  if (!story || story.deliveryStatus === "accepted" || (story.sprintId && state.sprints[story.sprintId]?.status === "closed")) return null
  const base = runPlanningMeeting(state, "story", storyId).proposal
  const criteria = story.acceptanceCriteriaIds.map((id) => state.acceptanceCriteria[id]?.content).filter((item): item is string => Boolean(item))
  const tracks = [
    { title: "资料与输入准备", type: "database" as const },
    { title: "核心功能实现", type: "backend" as const },
    { title: "验证与交付", type: "test" as const },
  ]
  const loads = memberLoads(state, story.sprintId)
  const members = Object.values(state.members).sort((a, b) => (loads[a.id] ?? 0) - (loads[b.id] ?? 0))
  const actions: ProposalAction[] = []
  for (let index = 0; index < Math.min(Math.max(count, 2), 4); index++) {
    const track = tracks[index] ?? { title: `补充工作流 ${index + 1}`, type: "backend" as const }
    const assigneeId = members[index % Math.max(members.length, 1)]?.id ?? story.assigneeId
    const estimate = Math.max(2, Math.min(12, Math.ceil(story.storyPoints * 2 / count) || 4))
    const title = criteria[index] ? criteria[index].slice(0, 42) : `${track.title}：${story.title}`
    const task = action("CREATE_TASK", "story", story.id,
      { title, type: track.type, estimate, assigneeId, startDate: story.startDate, endDate: story.dueDate },
      criteria[index] ? `对应验收标准 ${index + 1}；安排独立工作流并建议负责人` : `当前缺少对应验收标准；先按“${track.title}”拟定并行工作流，请在采纳前确认边界`,
      storyConditions(state, story))
    actions.push(task)
    actions.push(action("CREATE_SUBTASK", "task", task.id,
      { title: `完成并验证：${title}`, estimate: Math.max(1, estimate - 1), assigneeId },
      "为该工作流保留可跟踪的交付步骤", storyConditions(state, story), [task.id]))
  }
  return {
    ...base, id: uid("proposal"), agentType: "task_decomposition",
    summary: `${story.title}：${Math.floor(actions.length / 2)} 条并行工作流建议`,
    reasoning: criteria.length
      ? "依据现有验收标准、Story 排期和成员当前任务量分配独立工作流；采纳前请确认工作边界。"
      : "Story 暂无验收标准，先用资料、实现、验证三个工作流形成讨论草案；采纳前请补充验收边界。",
    evidence: base.evidence.filter((item) => item.agentType === "task_decomposition" || item.agentType === "workload_capacity"),
    originalActions: structuredClone(actions), actions,
  }
}
