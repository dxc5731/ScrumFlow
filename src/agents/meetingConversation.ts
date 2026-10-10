import { addDays, differenceInBusinessDays, parseISO } from "date-fns"
import { buildParallelTaskProposal, runPlanningMeeting } from "./meeting"
import { analyzeMeetingRequest } from "./meetingRequest"
import { requestsPlanReview } from "./meetingHandoff"
import type {
  AgentProposal, AgentType, MeetingSession, ProjectDataState,
  ProposalAction, ProposalEvidence, StoryEntity,
} from "../types"

export type MeetingAgentId = AgentType | "auto"

export const meetingAgents: Array<{
  id: MeetingAgentId
  name: string
  handle: string
  description: string
  prompts: string[]
}> = [
  { id: "auto", name: "智能助手", handle: "AI", description: "不确定找谁时，由项目主持协调专业助手", prompts: ["帮我看看为什么推进不动", "总结一下这次讨论"] },
  { id: "project_orchestrator", name: "项目主持", handle: "项目主持", description: "梳理项目问题，协调专业助手并汇总结论", prompts: ["看看当前项目情况", "把讨论整理成结论"] },
  { id: "task_decomposition", name: "任务拆解", handle: "任务拆解", description: "把 Story 拆成任务、步骤、工时和负责人建议", prompts: ["帮我拆这个 Story", "按三个人并行拆分"] },
  { id: "risk_dependency", name: "风险与依赖", handle: "风险与依赖", description: "检查阻塞、任务依赖、延期和受影响工作", prompts: ["检查这个方案的风险", "哪些任务会被阻塞"] },
  { id: "workload_capacity", name: "负载与容量", handle: "负载与容量", description: "比较成员现有工作与 Sprint 可用容量", prompts: ["这几个任务给谁合适", "谁可能超载"] },
  { id: "plan_execution", name: "计划落地", handle: "计划落地", description: "把讨论整理成可审核的项目行动项", prompts: ["整理成待确认行动", "生成可执行建议"] },
  { id: "project_monitor", name: "项目巡检", handle: "项目巡检", description: "关注逾期、阻塞、低进度和 Sprint 目标", prompts: ["现在有什么异常", "本轮目标有风险吗"] },
  { id: "collaboration_notification", name: "协作建议", handle: "协作建议", description: "找出需要参与讨论的人和待澄清的问题", prompts: ["应该找谁一起讨论", "还有谁需要参与"] },
  { id: "material_organizer", name: "材料整理", handle: "材料整理", description: "创作 UML、甘特图、用户地图、Word 和 Excel，可预览下载", prompts: ["生成项目管理作业成果包", "画用例图并整理需求说明书"] },
  { id: "contribution_insight", name: "贡献洞察", handle: "贡献洞察", description: "依据完成任务和有效讨论总结团队贡献", prompts: ["总结本轮贡献", "各成员完成了什么"] },
]

export function agentName(id: string) {
  return meetingAgents.find((agent) => agent.id === id)?.name ?? "项目助手"
}

export function parseAgentMention(text: string, state?: ProjectDataState): { agentId: MeetingAgentId; question: string; memberId?: string } {
  const trimmed = text.trim().replace(/＠/g, "@")
  const handles = [
    ...meetingAgents.map(agent => ({ handle: agent.handle, agentId: agent.id, memberId: undefined as string | undefined })),
    { handle: "资料整理", agentId: "material_organizer" as const, memberId: undefined },
    ...Object.values(state?.members ?? {}).map(member => ({ handle: member.name, agentId: "auto" as const, memberId: member.id })),
  ].sort((a, b) => b.handle.length - a.handle.length)
  for (const match of trimmed.matchAll(/@/g)) {
    const at = match.index!
    // Email addresses are not invitations; Chinese punctuation and adjoining prose are valid.
    if (at > 0 && /[a-zA-Z0-9_.+-]/.test(trimmed[at - 1])) continue
    const found = handles.find(item => trimmed.slice(at + 1).startsWith(item.handle) &&
      (!/^[a-z]+$/i.test(item.handle) || !/[a-z0-9_]/i.test(trimmed[at + item.handle.length + 1] ?? "")))
    if (found) return { agentId: found.agentId, ...(found.memberId ? { memberId: found.memberId } : {}),
      question: `${trimmed.slice(0, at)} ${trimmed.slice(at + found.handle.length + 1)}`.trim() }
  }
  return { agentId: "auto", question: trimmed }
}

export function routeProjectQuestion(question: string): AgentType[] {
  if (/总结|回顾|会议记录/.test(question)) return []
  if (/贡献|完成了什么/.test(question)) return ["contribution_insight"]
  if (/材料|资产|交付物/.test(question)) return ["material_organizer"]
  if (/协作|找谁|参与/.test(question)) return ["collaboration_notification"]
  if (/推进不动|为什么|卡住|阻塞/.test(question)) return ["risk_dependency", "workload_capacity", "project_monitor"]
  if (/拆|并行|规划|任务/.test(question)) return ["task_decomposition", "risk_dependency", "workload_capacity"]
  if (/给谁|负载|容量|工时/.test(question)) return ["workload_capacity", "project_monitor"]
  if (/风险|依赖|延期/.test(question)) return ["risk_dependency", "project_monitor"]
  if (/行动|落地|执行|调整/.test(question)) return ["plan_execution"]
  return ["project_monitor", "risk_dependency"]
}

export interface AgentAnswer {
  agentType: AgentType
  content: string
  evidence: string[]
  rawEvidence: ProposalEvidence[]
  proposal?: AgentProposal
  artifactIds?: string[]
  modelUsed?: boolean
}

function targetStories(state: ProjectDataState, session: MeetingSession): StoryEntity[] {
  return session.targetType === "story"
    ? [state.stories[session.targetId]].filter(Boolean)
    : Object.values(state.stories).filter((story) => story.sprintId === session.targetId)
}

function periodCapacity(state: ProjectDataState, sprintId: string | null, memberId: string) {
  const weekly = state.members[memberId]?.capacityHours ?? 0
  const sprint = sprintId ? state.sprints[sprintId] : null
  if (!sprint) return weekly
  const days = Math.max(1, differenceInBusinessDays(addDays(parseISO(sprint.endDate), 1), parseISO(sprint.startDate)))
  return Math.round(weekly * days / 5)
}

function existingLoads(state: ProjectDataState, sprintId: string | null) {
  const loads: Record<string, number> = Object.fromEntries(Object.keys(state.members).map((id) => [id, 0]))
  for (const task of Object.values(state.tasks)) {
    if (state.stories[task.storyId]?.sprintId !== sprintId || task.status === "done") continue
    const leaves = task.subtaskIds.length ? task.subtaskIds.map((id) => state.subtasks[id]).filter(Boolean) : [task]
    for (const leaf of leaves) loads[leaf.assigneeId] = (loads[leaf.assigneeId] ?? 0) + leaf.estimate
  }
  return loads
}

function proposalForActions(base: AgentProposal, agentType: AgentType, actions: ProposalAction[], summary: string): AgentProposal | undefined {
  if (!actions.length) return undefined
  const picked = structuredClone(actions)
  return {
    ...base, id: `proposal-${crypto.randomUUID()}`, agentType, summary,
    originalActions: structuredClone(picked), actions: picked,
  }
}

function actionTitle(action: ProposalAction) {
  return String(action.proposedValue.title ?? action.targetId)
}

function analysisBase(state: ProjectDataState, session: MeetingSession) {
  if (session.targetType === "project") throw new Error("项目会议需要先选择具体 Story 或 Sprint")
  return runPlanningMeeting(state, session.targetType, session.targetId).proposal
}

function taskAnswer(state: ProjectDataState, session: MeetingSession, question: string): AgentAnswer {
  const stories = targetStories(state, session)
  const request = analyzeMeetingRequest(question)
  if (request.deniesProposal || !/拆|新增|添加|创建|补充|细化/.test(request.commandText)) {
    const tasks = stories.flatMap(story => story.taskIds.map(id => state.tasks[id]).filter(Boolean))
    return { agentType: "task_decomposition", content: `当前有 ${tasks.length} 个任务。${tasks.map(task => `\n- ${task.id.toUpperCase()}「${task.title}」：${task.status}`).join("")}\n本轮仅核对现有工作。`, evidence: [], rawEvidence: [] }
  }
  question = request.commandText
  const base = analysisBase(state, session)
  const closed = stories.some((story) => story.sprintId && state.sprints[story.sprintId]?.status === "closed")
  const wantsParallel = /并行|三个人|3个人|三位|三人/.test(question)
  const normalActions = base.actions.filter((item) => ["CREATE_TASK", "CREATE_SUBTASK", "ADD_DEPENDENCY"].includes(item.actionType))
  const parallel = session.targetType === "story" && (wantsParallel || (!normalActions.length && /拆|任务/.test(question)))
    ? buildParallelTaskProposal(state, session.targetId, wantsParallel ? 3 : 3)
    : null
  const knownTitles = new Set([
    ...stories.flatMap((story) => story.taskIds.map((id) => state.tasks[id]?.title).filter(Boolean)),
    ...session.proposalIds.flatMap((id) => {
      const proposal = state.proposals[id]
      return proposal && ["draft", "reviewed"].includes(proposal.status)
        ? proposal.actions.filter((item) => item.actionType === "CREATE_TASK" && item.decision !== "rejected").map(actionTitle) : []
    }),
  ])
  const newParallelTaskIds = new Set(parallel?.actions.filter((item) => item.actionType === "CREATE_TASK" && !knownTitles.has(actionTitle(item))).map((item) => item.id))
  const parallelActions = parallel?.actions.filter((item) =>
    (item.actionType === "CREATE_TASK" && newParallelTaskIds.has(item.id)) ||
    (item.actionType === "CREATE_SUBTASK" && item.dependsOnActionIds.some((id) => newParallelTaskIds.has(id)))) ?? []
  const proposal = closed ? undefined : parallel
    ? proposalForActions(parallel, "task_decomposition", parallelActions, parallel.summary)
    : proposalForActions(base, "task_decomposition", normalActions, `${session.title}：任务拆分建议`)
  const taskActions = proposal?.actions.filter((item) => item.actionType === "CREATE_TASK") ?? []
  const existing = stories.reduce((sum, story) => sum + story.taskIds.length, 0)
  const criteria = stories.reduce((sum, story) => sum + story.acceptanceCriteriaIds.length, 0)
  const content = closed
    ? "这个 Story 所在的 Sprint 已关闭。现在创建任务会被项目规则阻止，建议先在 Sprint 管理中确定后续迭代，再回来拆分。"
    : taskActions.length
      ? `我看了现有的 ${existing} 个任务和 ${criteria} 条验收标准，建议${wantsParallel ? "按独立工作流并行安排" : "补充"} ${taskActions.length} 个任务：${taskActions.map((item) => `「${actionTitle(item)}」由 ${state.members[String(item.proposedValue.assigneeId)]?.name ?? "待定成员"} 负责，预计 ${item.proposedValue.estimate} 小时`).join("；")}。${criteria ? "每项都能对应当前验收目标。" : "目前没有验收标准，这是一版讨论草案，审核前请补齐验收边界。"}`
      : `现有及待审核的 ${existing + session.proposalIds.flatMap((id) => state.proposals[id]?.actions.filter((item) => item.actionType === "CREATE_TASK" && item.decision !== "rejected") ?? []).length} 个任务已覆盖这次拆分，我不会重复建议同名任务。可以告诉我哪一部分尚未覆盖，或先补充验收标准。`
  return {
    agentType: "task_decomposition", content,
    evidence: stories.map((story) => `${story.id.toUpperCase()}：${story.taskIds.length} 个现有任务，${story.acceptanceCriteriaIds.length} 条验收标准，计划 ${story.startDate} 至 ${story.dueDate}`),
    rawEvidence: base.evidence.filter((item) => item.agentType === "task_decomposition"),
    ...(proposal ? { proposal } : {}),
  }
}

function riskAnswer(state: ProjectDataState, session: MeetingSession, question: string): AgentAnswer {
  const stories = targetStories(state, session)
  const taskIds = stories.flatMap((story) => story.taskIds)
  const blocked = taskIds.map((id) => state.tasks[id]).filter((task) => task?.status === "blocked")
  const dependencies = Object.values(state.dependencies).filter((item) => taskIds.includes(item.sourceTaskId) || taskIds.includes(item.targetTaskId))
  const late = stories.filter((story) => story.sprintId && state.sprints[story.sprintId] && story.dueDate > state.sprints[story.sprintId].endDate)
  const affected = [...new Set(blocked.flatMap((task) => dependencies.filter((item) => item.sourceTaskId === task.id).map((item) => item.targetTaskId)))]
  const pendingActions = session.proposalIds.flatMap((id) => {
    const proposal = state.proposals[id]
    return proposal && ["draft", "reviewed"].includes(proposal.status)
      ? proposal.actions.filter((item) => item.decision !== "rejected") : []
  })
  const suggestedTasks = pendingActions.filter((item) => item.actionType === "CREATE_TASK")
  const suggestedDependencies = pendingActions.filter((item) => item.actionType === "ADD_DEPENDENCY")
  const sprint = session.targetType === "sprint" ? state.sprints[session.targetId] : stories[0]?.sprintId ? state.sprints[stories[0].sprintId] : null
  const suggestedLate = sprint ? suggestedTasks.filter((item) => String(item.proposedValue.endDate ?? "") > sprint.endDate) : []
  const relatedRisks = Object.values(state.risks).filter((risk) => risk.status !== "resolved" && (
    (risk.targetType === "story" && stories.some((story) => story.id === risk.targetId)) ||
    (risk.targetType === "task" && taskIds.includes(risk.targetId)) ||
    (risk.targetType === "sprint" && risk.targetId === sprint?.id)
  ))
  const missingCriteria = stories.filter((story) => story.acceptanceCriteriaIds.length === 0)
  const base = analysisBase(state, session)
  const riskActions = base.actions.filter((item) => item.actionType === "CREATE_RISK" || item.actionType === "UPDATE_RISK")
  const request = analyzeMeetingRequest(question)
  const propose = !request.deniesProposal && /添加|新增|登记|调整|处理|生成行动/.test(request.commandText)
  const findings = [
    suggestedTasks.length ? `刚才的方案包含 ${suggestedTasks.length} 个待确认任务${suggestedDependencies.length ? `和 ${suggestedDependencies.length} 条建议依赖` : "，尚未设置任务之间的先后依赖"}` : "",
    relatedRisks.length ? `项目已登记 ${relatedRisks.length} 项相关风险` : "",
    blocked.length ? `${blocked.length} 个现有任务被阻塞${affected.length ? `，影响 ${affected.length} 个后续任务` : ""}` : "",
    late.length || suggestedLate.length ? `${late.length} 个 Story 和 ${suggestedLate.length} 个建议任务的截止日期超出 Sprint` : "",
    missingCriteria.length ? `${missingCriteria.length} 个 Story 缺少验收标准，建议在执行前明确完成边界` : "",
  ].filter(Boolean)
  const content = findings.length
    ? `我核对了现有计划和这次会议的建议：${findings.join("；")}。${suggestedTasks.length && !suggestedDependencies.length ? "如果这些任务有必须先完成的输入，请在审核时确认依赖关系。" : "建议先处理会影响交付的风险，再确认是否调整计划。"}`
    : `目前没有发现已登记风险、阻塞或超出 Sprint 的截止日期。现有 ${dependencies.length} 条依赖仍需在执行中关注。`
  return {
    agentType: "risk_dependency", content,
    evidence: [
      `阻塞任务：${blocked.map((task) => task.title).join("、") || "无"}`,
      `受影响任务：${affected.map((id) => state.tasks[id]?.title ?? id).join("、") || "无"}`,
      `关联依赖：${dependencies.length} 条；超出 Sprint 日期的 Story：${late.map((story) => story.title).join("、") || "无"}`,
      `会议待确认任务：${suggestedTasks.map(actionTitle).join("、") || "无"}；建议依赖：${suggestedDependencies.length} 条`,
      `现有风险：${relatedRisks.map((risk) => risk.title).join("、") || "无"}；缺少验收标准：${missingCriteria.map((story) => story.title).join("、") || "无"}`,
    ],
    rawEvidence: base.evidence.filter((item) => item.agentType === "risk_dependency"),
    ...(propose ? { proposal: proposalForActions(base, "risk_dependency", riskActions, "风险与依赖调整建议") } : {}),
  }
}

function workloadAnswer(state: ProjectDataState, session: MeetingSession, question: string): AgentAnswer {
  const stories = targetStories(state, session)
  const sprintId = session.targetType === "sprint" ? session.targetId : stories[0]?.sprintId ?? null
  const loads = existingLoads(state, sprintId)
  const pending = session.proposalIds.map((id) => state.proposals[id]).filter((proposal) => proposal && ["draft", "reviewed"].includes(proposal.status))
  const pendingTasks = pending.flatMap((proposal) => proposal.actions.filter((item) => item.actionType === "CREATE_TASK" && item.decision !== "rejected"))
  const suggestedLoads = { ...loads }
  const assignments = pendingTasks.map((item) => {
    const candidate = Object.values(state.members).sort((a, b) =>
      (suggestedLoads[a.id] ?? 0) / Math.max(1, periodCapacity(state, sprintId, a.id)) -
      (suggestedLoads[b.id] ?? 0) / Math.max(1, periodCapacity(state, sprintId, b.id)))[0]
    if (candidate) suggestedLoads[candidate.id] = (suggestedLoads[candidate.id] ?? 0) + Number(item.proposedValue.estimate ?? 0)
    return { title: actionTitle(item), candidate: candidate?.name ?? "待确认", current: state.members[String(item.proposedValue.assigneeId)]?.name ?? "待确认" }
  })
  for (const proposal of pending) {
    for (const item of proposal.actions) {
      if (item.actionType !== "CREATE_TASK" || item.decision === "rejected") continue
      const memberId = String(item.proposedValue.assigneeId)
      loads[memberId] = (loads[memberId] ?? 0) + Number(item.proposedValue.estimate ?? 0)
    }
  }
  const ranked = Object.values(state.members)
    .map((member) => ({ member, hours: loads[member.id] ?? 0, capacity: periodCapacity(state, sprintId, member.id) }))
    .sort((a, b) => (a.hours / Math.max(1, a.capacity)) - (b.hours / Math.max(1, b.capacity)))
  const lightest = ranked[0]
  const heaviest = ranked.at(-1)
  const overloaded = ranked.filter((item) => item.hours > item.capacity)
  const base = analysisBase(state, session)
  const actions = base.actions.filter((item) => item.actionType === "UPDATE_TASK")
  return {
    agentType: "workload_capacity",
    content: lightest
      ? `${assignments.length ? `按现有未完成工时和本轮容量，把待确认任务依次分配给负载较低的成员，可考虑：${assignments.map((item) => `「${item.title}」由${item.candidate}负责${item.current !== item.candidate ? `（当前建议是${item.current}）` : ""}`).join("；")}。右侧建议不会自动改动，你可以逐项修改负责人。` : `${lightest.member.name} 当前承担的工作相对最少（${lightest.hours} 小时），适合优先讨论新增任务。`}${heaviest && heaviest.member.id !== lightest.member.id ? `${heaviest.member.name} 已有 ${heaviest.hours} 小时未完成工作，继续分配前应核对容量。` : ""}${overloaded.length ? `其中 ${overloaded.map((item) => item.member.name).join("、")} 已超过本轮可用容量。` : "目前没有成员超过按 Sprint 工作日折算的容量。"}`
      : "当前项目没有可用成员，先补充成员后才能建议负责人。",
    evidence: ranked.map((item) => `${item.member.name}：未完成及待确认任务 ${item.hours}h / 本轮容量 ${item.capacity}h`),
    rawEvidence: base.evidence.filter((item) => item.agentType === "workload_capacity"),
    ...(!analyzeMeetingRequest(question).deniesProposal && /调整|重新分配|生成行动/.test(analyzeMeetingRequest(question).commandText) ? { proposal: proposalForActions(base, "workload_capacity", actions, "成员负载调整建议") } : {}),
  }
}

function monitorAnswer(state: ProjectDataState, session: MeetingSession): AgentAnswer {
  const stories = targetStories(state, session)
  const tasks = stories.flatMap((story) => story.taskIds.map((id) => state.tasks[id]).filter(Boolean))
  const today = new Date().toISOString().slice(0, 10)
  const overdue = tasks.filter((task) => task.status !== "done" && task.endDate < today)
  const blocked = tasks.filter((task) => task.status === "blocked")
  const lowProgress = tasks.filter((task) => task.status !== "done" && task.progress < 30 && task.endDate <= today)
  const sprint = session.targetType === "sprint" ? state.sprints[session.targetId] : stories[0]?.sprintId ? state.sprints[stories[0].sprintId] : null
  const accepted = stories.filter((story) => story.deliveryStatus === "accepted").length
  return {
    agentType: "project_monitor",
    content: overdue.length || blocked.length
      ? `当前有 ${overdue.length} 个任务已超过计划结束日、${blocked.length} 个任务仍处于阻塞。${sprint ? `本轮 ${stories.length} 个 Story 中已验收 ${accepted} 个，Sprint 目标需要关注这些未完成项。` : "建议先处理阻塞项，再确认剩余排期。"}`
      : `当前没有发现逾期或阻塞任务。${sprint ? `本轮已有 ${accepted}/${stories.length} 个 Story 验收完成。` : "可以继续按现有计划推进。"}`,
    evidence: [
      `逾期任务：${overdue.map((task) => `${task.title}（${task.endDate}）`).join("、") || "无"}`,
      `阻塞任务：${blocked.map((task) => task.title).join("、") || "无"}`,
      `截止日前进度低于 30% 的任务：${lowProgress.map((task) => task.title).join("、") || "无"}`,
      ...(sprint ? [`${sprint.name}：${accepted}/${stories.length} 个 Story 已验收；目标是“${sprint.goal || "未填写"}”`] : []),
    ],
    rawEvidence: [],
  }
}

function collaborationAnswer(state: ProjectDataState, session: MeetingSession): AgentAnswer {
  const stories = targetStories(state, session)
  const ids = [...new Set(stories.flatMap((story) => [story.assigneeId, ...story.collaboratorIds, ...story.taskIds.map((id) => state.tasks[id]?.assigneeId).filter(Boolean)]))]
  const names = ids.map((id) => state.members[id]?.name).filter(Boolean)
  const discussions = Object.values(state.discussions).filter((item) => stories.some((story) => item.storyId === story.id || (item.targetType === "task" && story.taskIds.includes(item.targetId))))
  return {
    agentType: "collaboration_notification",
    content: names.length
      ? `这次讨论最相关的是 ${names.slice(0, 4).join("、")}。建议先由 Story 负责人确认验收边界，再请任务负责人说明排期和阻塞。这里只生成协作建议，不会自动通知任何人。`
      : "当前 Story 还没有明确的负责人。建议先指定负责人，再确定参与讨论的成员。",
    evidence: [`关联负责人和协作者：${names.join("、") || "无"}`, `现有相关讨论：${discussions.length} 条`],
    rawEvidence: [],
  }
}

function materialAnswer(state: ProjectDataState, session: MeetingSession): AgentAnswer {
  const stories = targetStories(state, session)
  const taskIds = stories.flatMap((story) => story.taskIds)
  const assets = Object.values(state.assets).filter((asset) => asset.links.some((link) =>
    (link.targetType === "story" && stories.some((story) => story.id === link.targetId)) ||
    (link.targetType === "task" && taskIds.includes(link.targetId)) ||
    (link.targetType === "sprint" && session.targetType === "sprint" && link.targetId === session.targetId)))
  const submitted = taskIds.map((id) => state.tasks[id]).filter((task) => task?.resultSummary || task?.resultLinks.length)
  return {
    agentType: "material_organizer",
    content: assets.length || submitted.length
      ? `我找到了 ${assets.length} 份关联资料和 ${submitted.length} 项任务交付记录。可以优先核对它们是否覆盖验收标准，缺失内容再到设计资产或任务结果中补齐。`
      : "当前讨论对象还没有关联资料或任务交付记录。建议在明确验收标准后，补充设计资产和交付结果，方便后续复盘。",
    evidence: [`关联资料：${assets.map((asset) => asset.name).join("、") || "无"}`, `已有交付记录：${submitted.map((task) => task.title).join("、") || "无"}`],
    rawEvidence: [],
  }
}

function contributionAnswer(state: ProjectDataState, session: MeetingSession): AgentAnswer {
  const stories = targetStories(state, session)
  const taskIds = stories.flatMap((story) => story.taskIds)
  const tasks = taskIds.map((id) => state.tasks[id]).filter(Boolean)
  const relatedDiscussions = Object.values(state.discussions).filter((item) => stories.some((story) => item.storyId === story.id) || taskIds.includes(item.targetId))
  const rows = Object.values(state.members).map((member) => ({
    member, completed: tasks.filter((task) => task.assigneeId === member.id && task.status === "done").length,
    discussed: relatedDiscussions.filter((item) => item.authorId === member.id).length,
  })).filter((item) => item.completed || item.discussed)
  return {
    agentType: "contribution_insight",
    content: rows.length
      ? `本次范围内可以确认的贡献包括已完成任务和相关讨论。我会按事实列出，不用单一分数评价成员：${rows.map((item) => `${item.member.name}完成 ${item.completed} 个任务、参与 ${item.discussed} 条讨论`).join("；")}。`
      : "这次范围内还没有已完成任务或可关联的讨论记录，暂时不适合判断个人贡献。",
    evidence: rows.map((item) => `${item.member.name}：已完成任务 ${item.completed} 个；相关讨论 ${item.discussed} 条`),
    rawEvidence: [],
  }
}

function executionAnswer(state: ProjectDataState, session: MeetingSession): AgentAnswer {
  const existing = [...session.proposalIds].reverse().map((id) => state.proposals[id]).find((item) => item && ["draft", "reviewed"].includes(item.status))
  if (existing) return {
    agentType: "plan_execution",
    content: `会议已经有 ${existing.actions.length} 项待审核建议。请在右侧逐项采纳、修改或驳回；确认后再应用到项目。`,
    evidence: [`待审核建议：${existing.actions.filter((item) => item.decision === "pending").length} 项`], rawEvidence: existing.evidence,
  }
  const base = analysisBase(state, session)
  return {
    agentType: "plan_execution",
    content: base.actions.length
      ? `我把当前讨论对象整理成 ${base.actions.length} 项可审核行动。它们还不会修改项目，你可以先在右侧检查每项原因与负责人，再决定是否应用。`
      : "目前没有足够明确的项目变更建议。可以先明确要新增什么任务、调整谁的负责人，或补充验收标准。",
    evidence: [`可执行建议：${base.actions.length} 项`, ...base.evidence.slice(0, 3).map((item) => item.detail)],
    rawEvidence: base.evidence,
    ...(base.actions.length ? { proposal: base } : {}),
  }
}

export function analyzeMeetingAgent(state: ProjectDataState, session: MeetingSession, agentType: AgentType, question: string): AgentAnswer {
  switch (agentType) {
    case "task_decomposition": return taskAnswer(state, session, question)
    case "risk_dependency": return riskAnswer(state, session, question)
    case "workload_capacity": return workloadAnswer(state, session, question)
    case "project_monitor": return monitorAnswer(state, session)
    case "collaboration_notification": return collaborationAnswer(state, session)
    case "material_organizer": return materialAnswer(state, session)
    case "contribution_insight": return contributionAnswer(state, session)
    case "plan_execution": return requestsPlanReview(question) ? executionAnswer(state, session)
      : { agentType, content: summarizeMeeting(state, session), evidence: [], rawEvidence: [] }
    case "project_orchestrator": return {
      agentType, content: summarizeMeeting(state, session), evidence: [], rawEvidence: [],
    }
  }
}

export function summarizeMeeting(state: ProjectDataState, session: MeetingSession) {
  const messages = session.messageIds.map((id) => state.meetingMessages[id]).filter(Boolean)
  const proposals = session.proposalIds.map((id) => state.proposals[id]).filter(Boolean)
  const applied = proposals.flatMap((proposal) => proposal.actions).filter((item) => item.status === "applied")
  const pending = proposals.filter((proposal) => ["draft", "reviewed"].includes(proposal.status))
    .flatMap((proposal) => proposal.actions).filter((item) => item.status === "pending" && item.decision !== "rejected")
  const rejected = proposals.flatMap((proposal) => proposal.actions).filter((item) => item.decision === "rejected")
  const topics = [...new Set(messages.filter((item) => item.senderType === "agent" && item.senderId !== "project_orchestrator").map((item) => agentName(item.senderId)))]
  const missingCriteria = targetStories(state, session).some((story) => story.acceptanceCriteriaIds.length === 0)
  return `这次会议围绕「${session.title}」${topics.length ? `讨论了${topics.join("、")}` : "还没有进行专业分析"}。${proposals.length ? `形成了 ${proposals.length} 份项目行动建议：${applied.length} 项已写入项目，${rejected.length} 项已拒绝${pending.length ? `，还有 ${pending.length} 项待确认` : ""}。` : "目前没有需要写回项目的行动项。"}${applied.length ? `已落地：${applied.slice(0, 3).map(actionTitle).join("、")}。` : ""}${missingCriteria ? "下一步建议补齐验收标准，再核对剩余任务的完成边界。" : pending.length ? "下一步可以在右侧审核剩余建议。" : "后续可根据执行情况继续讨论风险和成员负载。"}`
}

export function hostSynthesis(answers: AgentAnswer[]) {
  const conclusions = answers.map((answer) => {
    const created = answer.proposal?.actions.filter((item) => item.actionType === "CREATE_TASK").length ?? 0
    const detail = created ? `整理了 ${created} 个任务建议，等你在右侧确认` : answer.content.split("。")[0]
    return `${agentName(answer.agentType)}：${detail}`
  }).join("\n")
  return `几位专业助手已经核对了各自负责的项目数据。\n${conclusions}\n先确认影响交付的事项；需要改项目计划的建议，仍由你在右侧决定。`
}
