import type { AgentProposal, MeetingHostEventKind, MeetingOutcomeSnapshot, MeetingSession, ProjectDataState, ProposalAction } from "../types"
import { formatMeetingTime, meetingClock, meetingTemplate } from "./meetingFacilitation"

export const hostEventLabels: Record<MeetingHostEventKind, string> = {
  welcome: "主动开场", agenda: "议程切换", guide: "议程引导", time_warning: "临近结束提醒", overtime: "超时提醒",
  extended: "延长会议", closing: "结束前确认", topic_deviation: "话题纠偏", sprint_blocker: "发现 Sprint 阻塞",
  blocker_followup: "阻塞追问与推动", outcome: "会议成果汇报",
}
export const hostChoiceLabels: Record<string, string> = { return: "返回当前议程", continue: "继续讨论", incorrect: "判断有误", analyze: "确认风险分析", defer: "稍后跟进", propose: "生成待审建议" }
const fieldNames: Record<string, string> = { mitigation: "应对措施", assigneeId: "负责人", ownerId: "跟进人", title: "名称", status: "状态", estimate: "预计工时", startDate: "开始日期", endDate: "截止日期", dueDate: "交付日期", content: "讨论内容", description: "说明", impact: "影响", priority: "优先级", sprintId: "Sprint" }
export function meetingAuditDiff(before: unknown, after: unknown, field: string) {
  if (field === "update" && before && after && typeof before === "object" && typeof after === "object") {
    const b = before as Record<string, unknown>, a = after as Record<string, unknown>
    return Object.keys(a).filter(key => key !== "updatedAt" && JSON.stringify(b[key]) !== JSON.stringify(a[key])).map(key => ({ field: fieldNames[key] ?? key, before: b[key], after: a[key] }))
  }
  return [{ field: fieldNames[field] ?? field, before, after }]
}

export function meetingOwnedProposals(state: ProjectDataState, session: MeetingSession): AgentProposal[] {
  return session.proposalIds.map(id => state.proposals[id]).filter(p => p?.origin === "meeting" && p.sourceMeetingId === session.id)
}

export function captureMeetingOutcome(state: ProjectDataState, session: MeetingSession): MeetingOutcomeSnapshot {
  const { project, members, sprints, stories, tasks, subtasks, risks, dependencies, acceptanceCriteria, discussions } = state
  const proposals = Object.fromEntries(session.proposalIds.flatMap(id => state.proposals[id] ? [[id, state.proposals[id]]] : []))
  return structuredClone({ version: 1, capturedAt: session.endedAt!, sourceProposalIds: meetingOwnedProposals(state, session).map(p => p.id),
    context: { project, members, sprints, stories, tasks, subtasks, risks, dependencies, acceptanceCriteria, discussions }, proposals,
    history: state.history.filter(h => h.proposalId && session.proposalIds.includes(h.proposalId)) })
}

/** Reports never read later unrelated entity values back into an ended meeting. */
export function meetingOutcomeState(state: ProjectDataState, session: MeetingSession): ProjectDataState {
  const snapshot = session.outcomeSnapshot
  if (!snapshot) return state
  // Sandboxed execution is deliberately absent from the formal proposal/history maps.
  if (session.demo) return { ...state, ...structuredClone(snapshot.context), proposals: structuredClone(snapshot.proposals), history: structuredClone(snapshot.history) }
  const proposals = { ...snapshot.proposals }
  for (const id of snapshot.sourceProposalIds) {
    const live = state.proposals[id], frozen = proposals[id]
    if (live?.sourceMeetingId !== session.id || !frozen) continue
    const ids = new Set(frozen.actions.map(a => a.id))
    proposals[id] = { ...live, actions: live.actions.filter(a => ids.has(a.id)) }
  }
  const history = new Map(snapshot.history.map(h => [h.id, h]))
  for (const h of state.history) if (h.proposalId && snapshot.sourceProposalIds.includes(h.proposalId) &&
    proposals[h.proposalId]?.actions.some(a => a.id === h.proposalActionId)) history.set(h.id, h)
  const context = structuredClone({ ...snapshot.context, discussions: snapshot.context.discussions ?? {} })
  const capturedIds = new Set(snapshot.history.map(h => h.id))
  const tables: Record<string, string> = { project: "project", member: "members", sprint: "sprints", story: "stories", task: "tasks", subtask: "subtasks", risk: "risks", dependency: "dependencies", acceptance: "acceptanceCriteria", discussion: "discussions" }
  // Replay only this meeting's later audited fields, never today's mutable entity values.
  for (const h of [...history.values()].filter(h => !capturedIds.has(h.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const key = tables[h.objectType]
    if (!key) continue
    const records = context as unknown as Record<string, Record<string, Record<string, unknown>>>
    const target = h.objectType === "project" ? context.project as unknown as Record<string, unknown> : records[key][h.objectId]
    if (h.field === "create" && h.after && typeof h.after === "object" && key !== "project") records[key][h.objectId] = structuredClone(h.after) as Record<string, unknown>
    else if (h.field === "delete" && key !== "project") delete records[key][h.objectId]
    else if (h.field === "update" && target && h.before && h.after && typeof h.before === "object" && typeof h.after === "object") {
      const before = h.before as Record<string, unknown>, after = h.after as Record<string, unknown>
      for (const field of Object.keys(after)) if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) target[field] = structuredClone(after[field])
    }
    else if (target) target[h.field] = structuredClone(h.after)
  }
  return { ...state, ...context, proposals, history: [...history.values()] }
}

export function actionOutcome(state: ProjectDataState, proposal: AgentProposal, action: ProposalAction, closedAt?: string | null) {
  const history = state.history.filter(h => h.proposalId === proposal.id && h.proposalActionId === action.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const executed = action.status === "applied" && action.decision === "accepted" && action.executionOutcome !== "existing" && history.length > 0
  const reused = action.status === "applied" && action.executionOutcome === "existing"
  const bucket = action.decision === "rejected" ? "rejected" : executed ? "executed" : reused ? "reused" : action.decision === "pending" ? "pending" : "accepted"
  const label = bucket === "rejected" ? "已拒绝" : bucket === "executed" ? "已执行成功" : bucket === "reused" ? "复用已有结果，未写入"
    : bucket === "pending" ? "待确认" : action.status === "failed" ? "已采纳 · 执行失败" : action.status === "stale" ? "已采纳 · 已失效"
    : action.status === "applied" ? "已采纳 · 执行证据待核实" : "已采纳 · 待执行"
  const id = action.resultTargetId ?? action.targetId
  const entity = state.tasks[id] ?? state.subtasks[id] ?? state.stories[id] ?? state.risks[id]
  const edge = state.dependencies[action.targetId]
  const title = action.actionType === "CREATE_DISCUSSION" ? `跟进：${state.tasks[action.targetId]?.title ?? state.stories[action.targetId]?.title ?? action.targetId}`
    : action.actionType === "REMOVE_DEPENDENCY" && edge ? `删除依赖：${state.tasks[edge.sourceTaskId]?.title ?? edge.sourceTaskId} → ${state.tasks[edge.targetTaskId]?.title ?? edge.targetTaskId}`
    : String(action.proposedValue.title ?? entity?.title ?? action.targetId)
  const ownerId = String(action.proposedValue.assigneeId ?? action.proposedValue.ownerId ?? state.tasks[id]?.assigneeId ?? state.subtasks[id]?.assigneeId ?? state.stories[id]?.assigneeId ?? state.risks[id]?.ownerId ?? state.tasks[action.targetId]?.assigneeId ?? proposal.reviewedBy ?? "")
  return { proposalId: proposal.id, actionId: action.id, targetId: id, title, reason: action.reason || proposal.summary, label, bucket, executed,
    suggestion: Object.entries(action.proposedValue).map(([key, value]) => `${fieldNames[key] ?? key}：${typeof value === "string" ? value : JSON.stringify(value)}`).join("；"),
    reviewer: state.members[proposal.reviewedBy ?? ""]?.name ?? "暂无审核人记录", reviewedAt: proposal.reviewedAt,
    owner: state.members[ownerId]?.name ?? "待确认", deadline: String(action.proposedValue.endDate ?? action.proposedValue.dueDate ?? "待确认"),
    decision: action.decision, history, error: action.error,
    afterMeeting: !!closedAt && history.some(h => Date.parse(h.createdAt) > Date.parse(closedAt)) }
}

export function meetingInsights(input: ProjectDataState, session: MeetingSession) {
  const state = meetingOutcomeState(input, session)
  const messages = session.messageIds.map(id => state.meetingMessages[id]).filter(m => m?.meetingId === session.id)
  const proposals = meetingOwnedProposals(state, session)
  const actions = proposals.flatMap(p => p.actions.map(a => actionOutcome(state, p, a, session.endedAt)))
  const linkedCount = session.proposalIds.filter(id => state.proposals[id] && !proposals.some(p => p.id === id)).length
  const clock = meetingClock(session)
  const savedActual = session.facilitation?.actualDurationMs
  const hasStart = Number.isFinite(Date.parse(session.facilitation?.startedAt ?? ""))
  const hasEnd = session.status !== "ended" || Number.isFinite(Date.parse(session.endedAt ?? ""))
  const actualMs = typeof savedActual === "number" && Number.isFinite(savedActual) && savedActual >= 0 ? savedActual
    : hasStart && hasEnd ? clock.actualMs : null
  const plannedMs = typeof session.facilitation?.plannedMinutes === "number" && Number.isFinite(session.facilitation.plannedMinutes) && session.facilitation.plannedMinutes > 0 ? clock.budgetMs : null
  const agenda = (session.topics ?? []).filter(t => t.agendaKey || !session.facilitation)
  const progressed = agenda.filter(t => ["discussed", "recorded", "decided"].includes(t.status)).length
  const members = new Map<string, { id: string; name: string; text: number; voice: number; unknown: number; total: number }>()
  for (const m of messages) {
    if (m.senderType !== "user" || !m.content.trim()) continue
    const row = members.get(m.senderId) ?? { id: m.senderId, name: state.members[m.senderId]?.name ?? m.senderId, text: 0, voice: 0, unknown: 0, total: 0 }
    row[m.inputSource ?? "unknown"]++; row.total++; members.set(m.senderId, row)
  }
  const events = messages.filter(m => m.senderType === "agent" && m.senderId === "project_orchestrator" && m.hostEvent)
  const counts = { guidance: events.filter(m => ["welcome", "agenda", "guide"].includes(m.hostEvent!.kind)).length,
    time: events.filter(m => ["time_warning", "overtime"].includes(m.hostEvent!.kind)).length,
    deviation: events.filter(m => m.hostEvent!.kind === "topic_deviation").length,
    returned: events.filter(m => m.hostEvent!.kind === "topic_deviation" && m.hostEvent!.resolution?.choice === "return").length,
    continued: events.filter(m => m.hostEvent!.kind === "topic_deviation" && m.hostEvent!.resolution?.choice === "continue").length,
    incorrect: events.filter(m => m.hostEvent!.kind === "topic_deviation" && m.hostEvent!.resolution?.choice === "incorrect").length,
    executed: actions.filter(a => a.bucket === "executed").length, pending: actions.filter(a => a.bucket === "pending").length,
    accepted: actions.filter(a => a.decision === "accepted").length, acceptedUnexecuted: actions.filter(a => a.bucket === "accepted").length,
    rejected: actions.filter(a => a.bucket === "rejected").length, reused: actions.filter(a => a.bucket === "reused").length }
  const blockerEvents = events.filter(m => ["sprint_blocker", "blocker_followup"].includes(m.hostEvent!.kind))
  const blockerIds = [...new Set(blockerEvents.flatMap(m => m.hostEvent!.taskIds ?? []))]
  const riskIds = [...new Set(blockerEvents.flatMap(m => m.hostEvent!.riskIds ?? []))]
  const issues = [...blockerIds.map(id => ({ id, title: state.tasks[id]?.title ?? id, status: state.tasks[id]?.status ?? "暂无记录", kind: "task" })),
    ...riskIds.map(id => ({ id, title: state.risks[id]?.title ?? id, status: state.risks[id]?.status ?? "暂无记录", kind: "risk" }))]
  const sprintId = session.facilitation?.sprintId ?? session.memory?.focusSprintId ?? (session.targetType === "sprint" ? session.targetId : state.stories[session.targetId]?.sprintId)
  const sprint = state.sprints[sprintId ?? ""]
  const sprintOverdue = !!sprint?.endDate && sprint.status !== "closed" && sprint.endDate < (session.endedAt ?? new Date().toISOString()).slice(0, 10)
  const summary = `本次${(meetingTemplate(session)?.name ?? "会议")}记录了 ${members.size} 位成员的 ${[...members.values()].reduce((s, m) => s + m.total, 0)} 条发言记录，已推进 ${progressed}/${agenda.length} 项议程。项目主持留下 ${events.length} 条主动事件，发现或跟进 ${blockerIds.length} 项任务阻塞，产生 ${actions.length} 条行动建议；其中 ${counts.accepted} 条已采纳，${counts.executed} 条有实际写回审计，${counts.pending} 条待确认。`
  const improvements = [counts.pending ? `仍有 ${counts.pending} 条建议待确认，请有审核权限的成员跟进。` : "",
    counts.acceptedUnexecuted ? `有 ${counts.acceptedUnexecuted} 条建议已采纳但未确认执行成功，请检查执行状态。` : "",
    counts.deviation ? `记录了 ${counts.deviation} 次纠偏，${counts.returned} 次返回议程、${counts.continued} 次继续讨论、${counts.incorrect} 次标记误判；后续可将无关议题留到会后。` : "",
    blockerIds.length ? `已跟进的 ${blockerIds.length} 项任务需继续核实依赖；详细技术方案可另开专项讨论。` : "",
    sprintOverdue ? `${sprint!.name} 的计划结束日为 ${sprint!.endDate}，会议时计划期已过，应核实当前 Sprint 收尾安排。` : "",
    !actions.length ? "本次未产生可归属于会议的正式行动建议，讨论内容不等于实际项目变更。" : ""].filter(Boolean)
  return { state, messages, proposals, actions, linkedCount, clock, actualMs, plannedMs, agenda, progressed, members: [...members.values()], events, counts, blockerIds, issues, sprint, sprintOverdue, summary, improvements }
}

export function meetingOutcomeAnnouncement(state: ProjectDataState, session: MeetingSession) {
  const i = meetingInsights(state, session)
  return `${session.title}已经结束。实际用时${i.actualMs === null ? "暂无记录" : formatMeetingTime(i.actualMs)}${i.clock.demo ? "（演示计时单独展示）" : ""}。已推进 ${i.progressed}/${i.agenda.length} 项议程，发现或跟进 ${i.blockerIds.length} 项任务阻塞，产生 ${i.actions.length} 条行动建议，其中 ${i.counts.executed} 条已执行成功、${i.counts.pending} 条待确认。会议纪要与事实洞察已整理，请查看会议洞察、导出报告，并跟进待处理行动。`
}
