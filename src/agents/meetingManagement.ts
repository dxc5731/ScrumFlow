import type { MeetingHostEventInput, MeetingMessage, MeetingSession, ProjectDataState, TaskEntity } from "../types"
import type { CreateProposalInput, ProposalActionInput } from "../store/projectStore"
import { currentMeetingAgenda, meetingTemplate } from "./meetingFacilitation"
import { analyzeMeetingAgent } from "./meetingConversation"
import { parseModelObject, requestMeetingModel } from "./meetingLlm"
import { projectDependencyGraph } from "./projectDependencyGraph"
import { detectProjectEvents } from "../utils/eventDetection"

export const managementDebounceMs = 2400
export const interventionGapMs = 8000
const workContext = /任务|工作|进展|进度|推进|计划|方案|延期|排期|交付|验收|估算|工时|容量|接口|数据|测试|依赖|联调|前端|后端|代码|部署|需求|阻塞|负责人|迭代|甘特|看板|架构|权限|缺陷|排查|修复|sprint|story|gantt|bug|api/i
const socialTopics = [
  ["聚餐安排", /聚餐|火锅|吃饭|餐厅|烧烤|点菜|饭店/],
  ["休闲娱乐", /游戏开黑|打游戏|电影|追剧|电视剧|演唱会|球赛|明星/],
  ["出游安排", /旅游|周末.*(?:玩|去哪)|景点|度假|机票/],
] as const
const blockerClue = /阻塞|卡住|受阻|做不了|无法继续|没法继续|无法推进|依赖.{0,16}(?:未|没|等)|(?:前置|接口|数据结构).{0,16}(?:未确定|没确定|没完成|未完成|没提供)|等待.{0,20}(?:确认|接口|数据|完成)|影响.{0,12}(?:测试|交付|后续)/

export function meetingSprintTasks(state: ProjectDataState, session: MeetingSession) {
  const sprintId = session.facilitation?.sprintId
  return Object.values(state.tasks).filter(task => sprintId && state.stories[task.storyId]?.sprintId === sprintId)
}

export function managementWindow(state: ProjectDataState, session: MeetingSession) {
  const stage = currentMeetingAgenda(session)
  const cursor = session.facilitation?.management?.reviewedThroughMessageId
  const after = Math.max(session.messageIds.indexOf(cursor ?? ""), session.messageIds.indexOf(stage?.topic.createdFromMessageId ?? ""))
  return session.messageIds.slice(after + 1).map(id => state.meetingMessages[id])
    .filter(message => message && (message.senderType === "user" || message.senderType === "digital_member") && !message.hostEvent &&
      !(message.senderType === "user" && (/[@＠]/.test(message.content) || session.qaTrace?.some(trace => trace.messageId === message.id)))).slice(-8)
}

export function deviationSignature(messages: MeetingMessage[]) {
  const text = messages.map(message => message.content).join(" ")
  const topic = socialTopics.find(([, pattern]) => pattern.test(text))
  return topic?.[0] ?? text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "").slice(0, 48)
}

export function isMeetingWorkContribution(text: string, tasks: TaskEntity[]) {
  return workContext.test(text) || tasks.some(task => text.toLowerCase().includes(task.id.toLowerCase()) || text.includes(task.title))
}

export function shouldReviewDeviation(state: ProjectDataState, session: MeetingSession, messages: MeetingMessage[], now = Date.now()) {
  if (session.status !== "active" || !session.facilitation || !currentMeetingAgenda(session)) return false
  const management = session.facilitation.management
  if (Date.parse(management?.deviationSuppressedUntil ?? "") > now) return false
  const signature = deviationSignature(messages)
  if (management?.dismissedTopicSignatures?.includes(signature)) return false
  const prior = session.messageIds.map(id => state.meetingMessages[id]).filter(message => message?.hostEvent?.kind === "topic_deviation").at(-1)
  if (prior && (now - Date.parse(prior.createdAt) < 90_000 || prior.hostEvent?.topicSignature === signature && now - Date.parse(prior.createdAt) < 300_000)) return false
  const human = messages.filter(message => message.senderType === "user" && message.content.trim().length >= 10)
  if (human.length < 2 || human.reduce((sum, message) => sum + message.content.length, 0) < 32) return false
  const tasks = meetingSprintTasks(state, session)
  // Judge the latest pair, allowing an earlier work update followed by sustained social chat.
  return !human.slice(-2).some(message => isMeetingWorkContribution(message.content, tasks))
}

export async function reviewMeetingDeviation(state: ProjectDataState, session: MeetingSession, messages: MeetingMessage[], signal?: AbortSignal): Promise<MeetingHostEventInput | null> {
  if (!shouldReviewDeviation(state, session, messages)) return null
  const stage = currentMeetingAgenda(session)!
  const sprint = state.sprints[session.facilitation?.sprintId ?? ""]
  const content = await requestMeetingModel("host_review", {
    meetingId: session.id, meetingType: meetingTemplate(session)?.name, agenda: stage.title, agendaPrompt: stage.prompt,
    sprint: sprint ? { name: sprint.name, goal: sprint.goal } : null,
    tasks: meetingSprintTasks(state, session).map(task => ({ title: task.title, status: task.status })).slice(0, 30),
    recentMessages: messages.map(message => ({ id: message.id, role: message.senderType, content: message.content.slice(0, 800) })),
  }, false, undefined, signal)
  if (signal?.aborted) return null
  const result = content ? parseModelObject(content) : null
  const human = messages.filter(message => message.senderType === "user" && message.content.length >= 10)
  const ids = Array.isArray(result?.evidenceMessageIds) ? [...new Set(result.evidenceMessageIds)].filter(id => typeof id === "string") as string[] : []
  const validIds = ids.every(id => human.slice(-2).some(message => message.id === id))
  const modelConfirmed = result?.relevance === "unrelated" && result.sustained === true && typeof result.confidence === "number" && result.confidence >= .85 && result.confidence <= 1 && ids.length >= 2 && validIds
  // A related/uncertain model verdict always wins. Offline fallback requires two explicit social contributions.
  const ruleConfirmed = !content && human.length >= 2 && human.slice(-2).every(message => socialTopics.some(([, pattern]) => pattern.test(message.content)))
  if (!modelConfirmed && !ruleConfirmed) return null
  const evidenceIds = modelConfirmed ? ids : human.slice(-2).map(message => message.id)
  return {
    key: `topic_deviation:${stage.key}:${messages.at(-1)!.id}`, sourceMessageIds: evidenceIds,
    topicSignature: deviationSignature(messages),
    assessment: { basis: modelConfirmed ? "model" : "rules", reason: modelConfirmed && typeof result?.reason === "string" ? result.reason.slice(0, 240) : "连续两条明确的会外交流，模型暂不可用，采用保守规则" },
    content: `提醒一下，我们当前主要讨论「${stage.title}」。这段交流可能偏离了本次${meetingTemplate(session)?.name}的目标，可以在会后继续。我们先回到${stage.title}，${stage.prompt}如果这与当前工作有关，也可以继续讨论或指出判断有误。`,
    evidence: evidenceIds.map(id => `成员发言：${state.meetingMessages[id]?.content ?? ""}`),
  }
}

export function matchMeetingTask(state: ProjectDataState, session: MeetingSession, text: string) {
  const tasks = meetingSprintTasks(state, session)
  const byId = tasks.filter(task => new RegExp(`(^|[^a-z0-9_-])${task.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9_-])`, "i").test(text))
  if (byId.length === 1) return byId[0]
  if (byId.length > 1) return null
  const byTitle = tasks.filter(task => task.title.length >= 4 && text.includes(task.title))
  // Partial names are suggestions for the user to select, never authoritative task bindings.
  return byTitle.length === 1 ? byTitle[0] : null
}

export function memberBlockerEvent(state: ProjectDataState, session: MeetingSession, messages: MeetingMessage[]): MeetingHostEventInput | null {
  if (!session.facilitation?.sprintId || session.status !== "active") return null
  const message = [...messages].reverse().find(item => item.senderType === "user" && item.content.length >= 24 && blockerClue.test(item.content) && !/没有.{0,4}阻塞|无阻塞|已经解决|已解决/.test(item.content))
  if (!message) return null
  const task = matchMeetingTask(state, session, message.content)
  const key = task ? `blocker_followup:member:${task.id}` : `blocker_followup:member:${deviationSignature([message])}`
  return { key, sourceMessageIds: [message.id], taskIds: task ? [task.id] : [],
    content: `我注意到一条需要跟进的阻塞线索。${task ? `对应「${task.title}」，项目记录的负责人是${state.members[task.assigneeId]?.name ?? "未指定"}。` : "目前还不能可靠对应到某个任务，请先确认涉及的 Sprint 任务。"}这条成员补充仍待核实；需要确认前置条件由谁负责、何时可用。要请风险与依赖助手查看现有依赖和 Sprint 影响吗？`,
    evidence: [`成员报告（待核实）：${message.content}`],
  }
}

export function sprintBlockerEvent(state: ProjectDataState, session: MeetingSession): MeetingHostEventInput | null {
  const sprint = state.sprints[session.facilitation?.sprintId ?? ""]
  if (!sprint || currentMeetingAgenda(session)?.key !== "blockers") return null
  const tasks = meetingSprintTasks(state, session)
  const events = detectProjectEvents(state, sprint.id).filter(event => event.targetType === "task" && ["dependency", "deadline"].includes(event.kind))
  const taskIds = [...new Set([...events.filter(event => event.kind === "dependency" && state.tasks[event.targetId]?.status === "blocked").map(event => event.targetId), ...tasks.filter(task => task.status === "blocked").map(task => task.id), ...events.map(event => event.targetId)])].slice(0, 2)
  if (!taskIds.length) return null
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
  const overdue = sprint.endDate < today
  const riskIds = relatedBlockerRisks(state, session, taskIds).map(risk => risk.id)
  return { key: `sprint_blocker:${sprint.id}`, taskIds, riskIds,
    content: `现在进入「当前阻塞」。${overdue ? `${sprint.name} 的计划结束日 ${sprint.endDate} 已过${sprint.status === "closed" ? "，迭代已关闭" : "，仍有工作需要跟进"}。` : ""}根据现有项目记录，先关注：${taskIds.map(id => {
      const task = state.tasks[id], event = events.find(item => item.targetId === id)
      return `「${task.title}」${task.status === "blocked" ? "已标记受阻" : event?.summary ?? "存在依赖提醒"}，负责人${state.members[task.assigneeId]?.name ?? "未指定"}`
    }).join("；")}。请相关成员补充需要的支持，也可以先查看其中一项的依赖影响。`,
    evidence: events.filter(event => taskIds.includes(event.targetId)).flatMap(event => [event.summary, ...event.evidence]),
  }
}

export function relatedBlockerRisks(state: ProjectDataState, session: MeetingSession, taskIds: string[]) {
  const storyIds = taskIds.map(id => state.tasks[id]?.storyId)
  return Object.values(state.risks).filter(risk => risk.status !== "resolved" && (
    risk.targetType === "task" && taskIds.includes(risk.targetId) || risk.targetType === "story" && storyIds.includes(risk.targetId) ||
    risk.targetType === "sprint" && risk.targetId === session.facilitation?.sprintId))
    .sort((a, b) => (a.targetType === "task" ? 0 : a.targetType === "story" ? 1 : 2) - (b.targetType === "task" ? 0 : b.targetType === "story" ? 1 : 2))
}

export function analyzeMeetingBlocker(state: ProjectDataState, session: MeetingSession, taskId: string) {
  const task = meetingSprintTasks(state, session).find(item => item.id === taskId)
  if (!task) return null
  const scoped = { ...session, targetType: "story" as const, targetId: task.storyId }
  const base = analyzeMeetingAgent(state, scoped, "risk_dependency", `检查 ${task.id} 的现有风险与依赖，不生成修改建议`)
  const graph = projectDependencyGraph(state)
  const upstream = graph.getPredecessors(task.id).map(edge => state.tasks[edge.sourceTaskId]).filter(Boolean)
  const downstream = graph.traverseSuccessors(task.id).taskIds.map(id => state.tasks[id]).filter(Boolean)
  const taskLabel = (item: TaskEntity) => `「${item.title}」（${state.members[item.assigneeId]?.name ?? "未指定负责人"}，${item.status === "done" ? "已完成" : item.status === "blocked" ? "受阻" : "未完成"}）`
  const detail = `本次核对「${task.title}」，负责人${state.members[task.assigneeId]?.name ?? "未指定"}，计划截止 ${task.endDate}。\n\n上游依赖：${upstream.map(taskLabel).join("、") || "未登记，成员提到的前置条件需要确认"}。\n后续关联：${downstream.slice(0, 3).map(taskLabel).join("、") || "未登记后续依赖"}${downstream.length > 3 ? `等 ${downstream.length} 项` : ""}。\n\n建议先确认${upstream.some(item => item.status !== "done") ? "未完成的前置任务交付时间" : "阻塞原因与解除条件"}，再协调负责人和后续验收安排。这里只说明登记的关联关系，不代表确定延期；量化延期需要另做 What-if。`
  return { ...base, content: `${detail}\n\n${base.content}`, proposal: undefined, evidence: [...base.evidence, `任务快照：${task.id} · ${task.status} · ${task.endDate}`, ...upstream.map(item => `已登记上游：${item.id} → ${task.id}`), ...downstream.map(item => `依赖链后续：${item.id}`)] }
}

export function meetingBlockerProposalInput(state: ProjectDataState, session: MeetingSession, taskId: string): CreateProposalInput | null {
  const task = meetingSprintTasks(state, session).find(item => item.id === taskId)
  if (!task) return null
  const upstream = projectDependencyGraph(state).getPredecessors(task.id).map(edge => state.tasks[edge.sourceTaskId]).filter(Boolean)
  const risk = relatedBlockerRisks(state, session, [task.id])[0]
  const followup = `会议跟进「${task.title}」：请${state.members[task.assigneeId]?.name ?? "任务负责人"}确认阻塞解除条件与预计恢复时间${upstream.length ? `，与${upstream.map(item => `「${item.title}」负责人${state.members[item.assigneeId]?.name ?? "待确认"}`).join("、")}核对前置交付` : "，核实尚未登记的前置条件"}；恢复后复核后续测试与验收安排。`
  const action: ProposalActionInput = risk ? {
    actionType: "UPDATE_RISK" as const, targetType: "risk" as const, targetId: risk.id,
    beforeValue: { mitigation: risk.mitigation }, proposedValue: { mitigation: [risk.mitigation, followup].filter(Boolean).join("\n") },
    reason: "复用现有风险，补充待人工确认的跟进措施，不自动调整任务排期或工时",
    preconditions: [{ targetType: "risk" as const, targetId: risk.id, field: "mitigation", expectedValue: risk.mitigation },
      { targetType: "risk" as const, targetId: risk.id, field: "status", expectedValue: risk.status }],
  } : {
    actionType: "CREATE_DISCUSSION" as const, targetType: "task" as const, targetId: task.id,
    proposedValue: { content: followup, targetType: "task", targetId: task.id },
    reason: "先登记任务跟进讨论，成员报告不等于已确认风险，不重复创建风险登记",
    preconditions: [],
  }
  action.preconditions!.push(...(["status", "assigneeId", "endDate"] as const).map(field => ({ targetType: "task" as const, targetId: task.id, field, expectedValue: task[field] })))
  action.preconditions!.push({ targetType: "task", targetId: task.id, field: "storyId", expectedValue: task.storyId },
    { targetType: "story", targetId: task.storyId, field: "sprintId", expectedValue: session.facilitation?.sprintId })
  for (const edge of projectDependencyGraph(state).getPredecessors(task.id)) action.preconditions!.push(
    { targetType: "dependency", targetId: edge.id, field: "sourceTaskId", expectedValue: edge.sourceTaskId },
    { targetType: "dependency", targetId: edge.id, field: "targetTaskId", expectedValue: edge.targetTaskId })
  return { origin: "meeting", triggerType: "manual", agentType: "risk_dependency", targetType: "task", targetId: task.id,
    summary: `阻塞跟进：${task.title}`, reasoning: "风险与依赖助手已核对项目记录；以下措施需由人工逐项采纳、执行。",
    evidence: [{ agentType: "risk_dependency", targetType: "task", targetId: task.id, detail: `任务 ${task.id}；负责人 ${task.assigneeId}；状态 ${task.status}；截止 ${task.endDate}` },
      ...upstream.map(item => ({ agentType: "risk_dependency" as const, targetType: "task" as const, targetId: item.id, detail: `已登记前置任务：${item.title}` }))], actions: [action] }
}
