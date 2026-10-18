import type { MeetingSession, ProjectDataState } from "../types"
import { meetingInsights } from "./meetingOutcomes"

export function meetingChartData(state: ProjectDataState, session: MeetingSession) {
  const i = meetingInsights(state, session)
  const roles = [
    { label: "AI 主持人", color: "#6555b3", count: i.messages.filter(m => m.senderType === "agent" && m.senderId === "project_orchestrator").length },
    { label: "专业 Agent", color: "#32769a", count: i.messages.filter(m => m.senderType === "agent" && m.senderId !== "project_orchestrator").length },
    { label: "数字员工", color: "#579a88", count: i.messages.filter(m => m.senderType === "digital_member").length },
    { label: session.demo ? "成员演示发言" : "项目成员", color: "#c89a54", count: i.messages.filter(m => m.senderType === "user").length },
  ]
  const interventions = [
    { label: "流程引导", count: i.counts.guidance }, { label: "风险与跟进", count: i.events.filter(m => ["sprint_blocker", "blocker_followup"].includes(m.hostEvent!.kind)).length },
    { label: "语义纠偏", count: i.counts.deviation }, { label: "时间提醒", count: i.counts.time },
    { label: "收尾与成果", count: i.events.filter(m => ["closing", "outcome", "extended"].includes(m.hostEvent!.kind)).length },
  ]
  const timing = (session.demo?.agendaTiming ?? []).map(t => ({ label: session.topics?.find(topic => topic.id === t.topicId)?.title ?? t.topicId,
    planned: t.plannedMinutes, actual: (Date.parse(t.endedAt) - Date.parse(t.startedAt)) / 60_000 }))
  const reviewed = i.actions.length - i.counts.pending
  const funnel = [{ label: "提出建议", count: i.actions.length }, { label: "人工已审", count: reviewed }, { label: "采纳", count: i.counts.accepted }, { label: "写回成功", count: i.counts.executed }]
  return { roles, interventions, timing, funnel, totalSpeech: roles.reduce((s, r) => s + r.count, 0), acceptanceRate: reviewed ? Math.round(i.counts.accepted / reviewed * 100) : null }
}
