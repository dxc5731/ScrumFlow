import type { MeetingSession, ProjectDataState } from "../types"
import { meetingArtifactMetadata, materialIdentityScope } from "./materialIdentity"
import { buildMeetingContext } from "./meetingContext"

export function generatedRecommendationKeys(state: ProjectDataState, session: MeetingSession): Set<string> {
  const context = buildMeetingContext(state, session)
  return new Set(Object.values(state.assets).flatMap(asset => {
    const meta = meetingArtifactMetadata(asset)
    return meta?.id === session.id && meta.scope === materialIdentityScope(meta.key, context) ? [meta.key] : []
  }))
}

/** A suggestion belongs to a real discussion milestone, never to the composer. */
export function meetingMaterialMoment(state: ProjectDataState, session: MeetingSession) {
  const messages = session.messageIds.map(id => state.meetingMessages[id]).filter(Boolean)
  const seen = new Set<string>()
  let moment: { messageId: string; keys: string[]; reason: string; expanded: boolean } | null = null
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    if (message.artifactIds?.length || message.handoffTo) continue
    let keys: string[] = [], reason = ""
    if (message.proposalId) {
      const event = `${message.proposalId}:${message.senderType === "system" ? "applied" : "plan"}`
      if (seen.has(event)) continue
      seen.add(event)
      keys = message.senderType === "system" ? ["changes", "actions", "gantt"] : ["wbs", "actions", "gantt"]
      reason = message.senderType === "system" ? "项目安排已经更新，适合留下一份变更记录。" : "方案已进入审核，可以把分工和时间安排整理成图。"
    } else if (message.senderType === "agent" && ["risk_dependency", "task_decomposition"].includes(message.senderId)) {
      const user = messages.slice(0, i).reverse().find(m => m.senderType === "user")
      const trace = session.qaTrace?.find(t => t.messageId === user?.id)
      if (!trace || !trace.calledAgents.includes(message.senderId as "risk_dependency" | "task_decomposition")) continue
      const scope = [...trace.focusStoryIds, ...trace.referencedTaskKeys, trace.focusSprintId ?? ""].sort().join(":")
      const event = `${message.senderId}:${scope}`
      const revision = message.senderId === "task_decomposition" && /改成|重新拆|调整方案|再拆|追加/.test(trace.input)
      if (seen.has(event) && !revision) continue
      seen.add(event)
      keys = message.senderId === "risk_dependency" ? ["dependencies", "risks"] : ["wbs", "gantt"]
      reason = message.senderId === "risk_dependency" ? "这条影响链值得画出来，讨论和汇报时更容易讲清楚。" : "任务拆分已有了结果，现在很适合整理 WBS 和时间安排。"
    }
    if (keys.length) {
      // Keep the card below the complete response, including a visible specialist handoff.
      let end = i
      while (end + 1 < messages.length && messages[end + 1].senderType !== "user" && !messages[end + 1].artifactIds?.length) end++
      moment = { messageId: messages[end].id, keys, reason, expanded: end === messages.length - 1 }
    }
  }
  return moment
}

export interface MaterialRecommendation { key: string; title: string; description: string; question: string }
export function recommendMeetingMaterials(state: ProjectDataState, session: MeetingSession): MaterialRecommendation[] {
  const traces = session.qaTrace ?? []
  const topics = session.topics ?? []
  const substantive = session.messageIds.map(id => state.meetingMessages[id]).filter(message => message &&
    (message.proposalId || message.senderType === "agent" && message.senderId !== "material_organizer"))
  if (substantive.length < 2 && !session.proposalIds.length && !topics.length) return []
  const sprintId = session.memory?.focusSprintId ?? (session.targetType === "sprint" ? session.targetId : state.stories[session.targetId]?.sprintId) ?? state.workspace.selectedSprintId
  const sprint = state.sprints[sprintId ?? ""]?.name ?? "当前 Sprint"
  const storyId = session.memory?.focusStoryIds.at(-1) ?? (session.targetType === "story" ? session.targetId : undefined)
  const scope = storyId ? storyId.toUpperCase() : "当前范围"
  const recommendations: MaterialRecommendation[] = [
    { key: "minutes", title: "正式会议纪要", description: "一句话看懂结论，保留分工与待确认事项。", question: "生成正式会议纪要" },
    { key: "storymap", title: "用户故事地图", description: "从用户活动到 Story，一眼看懂产品全貌。", question: "生成用户故事地图" },
  ]
  if (session.memory?.options.length || topics.some(topic => topic.type === "planning") || traces.some(trace => trace.calledAgents.includes("task_decomposition"))) recommendations.push(
    { key: "wbs", title: `${scope} WBS`, description: "把讨论方案与现有工作梳理成任务分解成果。", question: `生成 ${scope} WBS` })
  if (sprintId) recommendations.push({ key: "gantt", title: `${sprint} 彩色甘特图`, description: "直接导出系统页面，保留层级、头像和依赖。", question: `生成 ${sprint} 甘特图` })
  if (topics.some(topic => topic.type === "risk") || traces.some(trace => trace.calledAgents.includes("risk_dependency"))) recommendations.push(
    { key: "dependencies", title: "项目依赖图", description: "呈现已登记的上下游关系，方便讲清卡点。", question: "生成依赖关系图" },
    { key: "risks", title: "风险与阻塞清单", description: "汇总本次讨论的风险、阻塞和待核实信息。", question: `生成 ${sprint} 风险报告` })
  if (session.proposalIds.length) recommendations.push(
    { key: "actions", title: "行动项清单", description: "区分已执行、待审核和本次未采用的工作。", question: "生成行动项清单" },
    { key: "changes", title: "项目变更摘要", description: "只汇总实际执行结果及人工调整。", question: "生成变更摘要" })
  return recommendations.slice(0, 8)
}
