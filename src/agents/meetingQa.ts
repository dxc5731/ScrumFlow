import { meetingEntities } from "./meetingContext"
import type { MeetingSession, ProjectDataState } from "../types"

export interface MeetingQaIssue {
  severity: "P0" | "P1" | "P2"
  category: string
  message: string
  sourceMessageId?: string
}

export interface MeetingQaReport {
  meetingId: string
  messageCount: number
  fallbackCount: number
  issues: MeetingQaIssue[]
}

function similarity(a: string, b: string) {
  const left = new Set(a.replace(/\s/g, "").match(/.{1,2}/g) ?? [])
  const right = new Set(b.replace(/\s/g, "").match(/.{1,2}/g) ?? [])
  if (!left.size || !right.size) return 0
  return [...left].filter((item) => right.has(item)).length / Math.max(left.size, right.size)
}

export function buildMeetingQaReport(state: ProjectDataState, session: MeetingSession): MeetingQaReport {
  const messages = session.messageIds.map((id) => state.meetingMessages[id]).filter(Boolean)
  const traces = session.qaTrace ?? []
  const issues: MeetingQaIssue[] = []
  const entities = new Set(meetingEntities(state).map((item) => item.id.toLowerCase()))
  for (const trace of traces) {
    for (const warning of trace.warnings) issues.push({ severity: /焦点|排除|已完成/.test(warning) ? "P0" : "P1",
      category: "一致性修正", message: warning, sourceMessageId: trace.messageId })
    if (/刚才那个|第二个|这个任务/.test(trace.input) && !trace.referencedTaskKeys.length) issues.push({
      severity: "P1", category: "低置信度引用", message: `没有可靠定位任务：${trace.input}`, sourceMessageId: trace.messageId })
    if (/谁.*接|最适合.*任务|还能接/.test(trace.input) && trace.resolvedIntent !== "workload" && trace.resolvedIntent !== "digital_member") issues.push({
      severity: "P1", category: "意图未识别", message: `负载问题被识别为 ${trace.resolvedIntent}`, sourceMessageId: trace.messageId })
    if (/延期|晚.*天|解除.*依赖/.test(trace.input) && trace.resolvedIntent !== "risk" && trace.resolvedIntent !== "digital_member") issues.push({
      severity: "P1", category: "意图未识别", message: `风险问题被识别为 ${trace.resolvedIntent}`, sourceMessageId: trace.messageId })
    for (const match of trace.input.matchAll(/#([A-Za-z][A-Za-z0-9-]*)/g)) if (!entities.has(match[1].toLowerCase()) &&
      !meetingEntities(state).some((entity) => entity.type === "sprint" && entity.label.toLowerCase().replace(/\s+/g, "-") === match[1].toLowerCase())) issues.push({
      severity: "P1", category: "实体引用失败", message: `未找到 #${match[1]}`, sourceMessageId: trace.messageId })
    const index = messages.findIndex((item) => item.id === trace.messageId)
    const reply = messages.slice(index + 1).find((item) => item.senderType === "agent" || item.senderType === "digital_member")
    if (/谁.*接|最适合.*任务/.test(trace.input) && reply && !Object.values(state.members).some((member) => reply.content.includes(member.name))) issues.push({
      severity: "P1", category: "答非所问", message: "询问候选负责人，但回复没有成员候选", sourceMessageId: trace.messageId })
    if (reply && /约束无法|限制未满足|无法同时|不能按.*执行/.test(reply.content)) issues.push({
      severity: "P2", category: "约束冲突", message: reply.content.slice(0, 180), sourceMessageId: trace.messageId })
    const story = trace.focusStoryIds.length === 1 ? state.stories[trace.focusStoryIds[0]] : null
    if (story && !story.taskIds.length && /进度|完成了多少/.test(trace.input)) issues.push({
      severity: "P2", category: "项目数据不足", message: `${story.id.toUpperCase()} 尚无 Task，不能估算任务进度`, sourceMessageId: trace.messageId })
  }
  for (let index = 1; index < messages.length; index++) {
    const current = messages[index]
    const previous = messages[index - 1]
    if (current.senderType === "agent" && previous.senderType === "agent" && similarity(current.content, previous.content) > .82) issues.push({
      severity: "P2", category: "重复回复", message: `连续助手消息相似：${current.content.slice(0, 90)}`, sourceMessageId: current.id })
  }
  for (const proposalId of session.proposalIds) for (const action of state.proposals[proposalId]?.actions ?? []) if (action.status === "failed" || action.status === "stale") issues.push({
    severity: "P1", category: "行动执行", message: `${action.status === "failed" ? "执行失败" : "项目数据已变化"}：${action.error ?? action.reason}` })
  return { meetingId: session.id, messageCount: messages.filter((item) => !item.content.startsWith("meeting-showcase:")).length,
    fallbackCount: traces.filter((trace) => trace.llmFallback).length, issues }
}

export function formatMeetingQaReport(report: MeetingQaReport, state: ProjectDataState, session: MeetingSession): string {
  const traces = session.qaTrace ?? []
  const sections = ["一致性修正", "低置信度引用", "意图未识别", "实体引用失败", "答非所问", "约束冲突", "行动执行", "重复回复", "项目数据不足"]
  return [
    `# ${session.title} · QA Report`,
    `消息：${report.messageCount}；分析轮次：${traces.length}；意图解析 fallback：${report.fallbackCount} 次；在线生成回复实际采用：${traces.filter((trace) => trace.llmReplyUsed).length} 次。`,
    ...sections.map((category) => {
      const matches = report.issues.filter((issue) => issue.category === category)
      const unique = [...new Map(matches.map((issue) => [`${issue.severity}:${issue.message}`, issue])).values()]
      return `\n## ${category}\n${unique.length ? unique.map((issue) => `- ${issue.severity} ${issue.message}${matches.filter((item) => item.message === issue.message).length > 1 ? `（出现 ${matches.filter((item) => item.message === issue.message).length} 次）` : ""}`).join("\n") : "- 本次未检测到。"}`
    }),
    `\n## 执行审计\n${session.proposalIds.map((id) => {
      const proposal = state.proposals[id]
      return proposal ? `- ${proposal.summary}：${proposal.actions.filter((action) => action.status === "applied").length} 已执行、${proposal.actions.filter((action) => action.status === "failed").length} 失败、${proposal.actions.filter((action) => action.status === "stale").length} 失效、${proposal.actions.filter((action) => action.decision === "rejected").length} 拒绝。` : ""
    }).filter(Boolean).join("\n") || "- 本次没有正式项目行动。"}`,
  ].join("\n")
}
