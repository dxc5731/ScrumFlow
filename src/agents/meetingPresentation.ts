import type { MeetingSession, ProjectDataState } from "../types"
import { generateMeetingMinutes } from "./meetingMinutes"
import { buildExecutionSummary } from "./meetingExecutionSummary"
import { agentName } from "./meetingConversation"

/** A reader's projection of the same reviewed actions and persisted facts. */
export function readableMeeting(state: ProjectDataState, session: MeetingSession) {
  const minutes = generateMeetingMinutes(state, session)
  const proposals = session.proposalIds.map(id => state.proposals[id]).filter(Boolean)
  const execution = buildExecutionSummary(state, proposals)
  const actions = proposals.flatMap(proposal => proposal.actions.map(action => {
    const resultId = action.resultTargetId ?? action.targetId
    const actual = action.status === "applied" ? state.tasks[resultId] ?? state.subtasks[resultId] : undefined
    const title = action.actionType === "ADD_DEPENDENCY" ? "连接前后两项工作"
      : actual?.title ?? String(action.proposedValue.title ?? state.tasks[action.targetId]?.title ?? state.stories[action.targetId]?.title ?? "项目安排")
    const memberId = actual?.assigneeId ?? String(action.proposedValue.assigneeId ?? action.proposedValue.ownerId ?? "")
    const estimate = actual?.estimate ?? action.proposedValue.estimate
    const status = action.status === "applied" ? "已执行" : action.decision === "rejected" ? "本次未采用"
      : action.status === "failed" || action.status === "stale" ? "需要复核" : action.decision === "accepted" ? "已采纳，待执行" : "待审核"
    return { id: action.id, title, member: state.members[memberId]?.name ?? "待确认", estimate: typeof estimate === "number" ? estimate : null,
      sourceMessageIds: [...new Set([...session.messageIds.filter(id => state.meetingMessages[id]?.proposalId === proposal.id), ...(session.qaTrace ?? []).filter(trace => trace.proposalId === proposal.id).map(trace => trace.messageId)])],
      status, tone: status === "已执行" ? "done" : status === "本次未采用" ? "rejected" : "pending" }
  }))
  const focusedStories = [...new Set([...(session.memory?.focusStoryIds ?? []), ...(session.topics ?? []).flatMap(topic => topic.relatedEntityIds.filter(id => state.stories[id]))])]
  const discussedRisks = (session.topics ?? []).some(topic => topic.type === "risk") || (session.qaTrace ?? []).some(trace => trace.calledAgents.includes("risk_dependency"))
  const registered = discussedRisks ? Object.values(state.risks).filter(risk => risk.status !== "resolved" &&
    (focusedStories.includes(risk.targetId) || focusedStories.includes(state.tasks[risk.targetId]?.storyId))) : []
  const attention = [...new Set([...minutes.risks, ...minutes.openQuestions, ...registered.map(risk => risk.title), ...execution.discrepancies])]
  const applied = actions.filter(action => action.tone === "done").length
  const pending = actions.filter(action => action.tone === "pending").length
  const rejected = actions.filter(action => action.tone === "rejected").length
  const subjects = focusedStories.map(id => `「${state.stories[id]?.title ?? id}」`).slice(0, 2)
  const topicLabels = [...new Set((session.topics ?? []).map(topic => topic.type === "planning" ? "任务拆分" : topic.type === "risk" ? "依赖与延期影响" : topic.type === "workload" ? "成员分工" : topic.type === "decision" ? "执行安排" : "项目进展"))]
  const summary = [subjects.length ? `这次会议围绕${subjects.join("和")}，梳理了${topicLabels.join("、") || "当前工作与后续安排"}。`
    : `这次会议围绕${state.project.name}，整理了${topicLabels.join("、") || "当前讨论内容"}。`,
    applied ? `已有 ${applied} 项行动正式进入项目${rejected ? `，其余 ${rejected} 项建议本次未采用` : ""}。${pending ? `另有 ${pending} 项还需要确认。` : ""}`
      : pending ? `形成了 ${pending} 项待确认行动，审核通过后再进入项目。` : "目前仍以讨论和材料整理为主，尚无实际项目变更。",
    minutes.deferred.length ? "暂缓的安排继续保留，等相关信息明确后再推进。" : attention.length ? "还有需要跟进的信息，见下方提醒。" : ""].filter(Boolean)
  const decisions = [...new Set([...(applied ? actions.filter(action => action.tone === "done").map(action => `推进「${action.title}」：已进入项目，由${action.member}负责。`) : minutes.decisions), ...minutes.deferred.map(item => `暂缓：${item}`)])]
  const changes = [execution.headline.replace(/^实际执行：/, "本次会议已").replace(/ · /g, "，"), ...execution.applied, ...execution.reviewedChanges]
  return { minutes, summary: session.narrative?.text ? [session.narrative.text] : summary, decisions, attention, actions, changes, applied, pending, rejected,
    assetIds: [...new Set([...session.messageIds.flatMap(id => state.meetingMessages[id]?.artifactIds ?? []), ...Object.values(state.assets).filter(asset => {
      try { return JSON.parse(asset.sourceText)?._meeting?.id === session.id } catch { return false }
    }).map(asset => asset.id)])].filter(id => state.assets[id]),
    participants: session.participantIds.map(id => state.members[id]?.name ?? "项目成员"), agents: minutes.agentTypes.map(agentName) }
}

export function readableMinutesMarkdown(state: ProjectDataState, session: MeetingSession): string {
  const view = readableMeeting(state, session)
  const list = (items: string[], empty: string) => items.length ? items.map(item => `- ${item}`).join("\n") : empty
  return `# ${session.title}\n\n${new Date(session.createdAt).toLocaleDateString("zh-CN")} · ${view.participants.join("、")}\n\n` +
    `## ✨ 这次会议主要解决了什么\n\n${view.summary.join("\n\n")}\n\n` +
    `## ✅ 我们已经决定\n\n${list(view.decisions, "尚未确认最终决定。已讨论方案保留为建议。\n")}\n\n` +
    `## ⚠️ 还需要关注\n\n${list(view.attention, "本次没有记录新的风险或待核实事项。")}\n\n` +
    `## 👥 接下来谁做什么\n\n${view.actions.filter(action => action.tone !== "rejected").map(action => `### ${action.title}\n\n${action.member}${action.estimate !== null ? ` · 约 ${action.estimate}h` : ""} · ${action.status}`).join("\n\n") || "本次尚未形成待审核行动。"}${view.rejected ? `\n\n### 本次未采用的 ${view.rejected} 项建议\n\n${view.actions.filter(action => action.tone === "rejected").map(action => `- ${action.title}`).join("\n")}` : ""}\n\n` +
    `## 📌 项目实际发生了什么变化\n\n${view.changes.join("\n\n")}\n\n` +
    `## 📦 本次会议成果\n\n${list([...new Set(view.assetIds.map(id => state.assets[id].name.replace(/\.[^.]+$/, "")))], "成果可从会议材料中心预览和下载。")}\n\n` +
    `## 💬 我们还讨论了这些\n\n${list(view.minutes.topics, "暂无其他正式议题。")}`
}

/** Partition one reply: the disclosure contains only material omitted from the first view. */
export function presentMeetingReply(content: string, _state: ProjectDataState, role = ""): { main: string; details: string } {
  const natural = (text: string) => text
    .replace(/当前 Store|当前Store|项目 Store|当前 Project Store/g, "项目记录")
    .replace(/Store after Apply/g, "执行后的项目记录").replace(/ChangeHistory/g, "变更记录")
    .replace(/Plan revisions/g, "讨论方案").replace(/remainingCapacity/g, "剩余容量")
    .replace(/\bStore\b/g, "项目记录").replace(/\bFocus\b/g, "讨论范围")
    .replace(/\bProposal\b/g, "待审核建议").replace(/\bApply\b/g, "应用")
    .replace(/\b(?:TASK|SUBTASK)-\d+-[\w]+\b/gi, "")
    .replace(/\*\*([^*\n]{25,})\*\*/g, "$1")
    .replace(/^[　 ]+/gm, "");
  // The original message remains in the meeting record. This is a display projection.
  const text = natural(content).trim().replace(/(^#{1,6} .+)\n(?!\n)/gm, "$1\n\n");
  const blocks = text.split(/\n\s*\n/).flatMap(block => {
    if (/^(?:[-*]|\d+[.)、]) /.test(block)) return block.split(/\n(?=(?:[-*]|\d+[.)、]) )/);
    if (/^(?:#|[-*] |\d+[.)、]|\||>|\x60\x60\x60)/.test(block) || block.length < 160) return [block];
    const sentences = block.match(/[^。！？]+[。！？]?/g) ?? [block];
    const chunks: string[] = [];
    for (const sentence of sentences) {
      if (chunks.length && chunks[chunks.length - 1].length + sentence.length <= 140) chunks[chunks.length - 1] += sentence;
      else chunks.push(sentence.trim());
    }
    return chunks.filter(Boolean);
  });
  const limit = role === "digital_member" ? 240 : role === "project_orchestrator" ? 240 : role === "risk_dependency" ? 300 : 360;
  if (text.length <= limit && !blocks.some(b => /^(?:\||(?:#+\s*)?(?:详细(?:依据|数据|分析)|数据(?:证据|来源)|完整依赖|判断依据|What-if))/i.test(b))) return { main: blocks.join("\n\n"), details: "" };
  const main: string[] = [], extra: string[] = [];
  let used = 0, supplementary = false;
  const next = blocks.map((b,index) => ({b,index})).filter(({b}) => /^(?:#+\s*)?(?:💡\s*)?(?:下一步|我的建议|建议(?:今天|先|：|:)|接下来|优先级|处理优先级建议|处理建议)/.test(b)).at(-1)?.index ?? -1;
  blocks.forEach((block, index) => {
    if (index === next && /；(?:第二|其次|然后)/.test(block)) {
      const cut = block.search(/；(?:第二|其次|然后)/), lead = block.slice(0, cut).replace(/：第一[，、]/, "：") + "。";
      main.push(lead); used += lead.length; extra.push(block.slice(cut + 1)); return;
    }
    if (role === "risk_dependency" && /^(?:登记因果链|已登记的因果链|完整依赖链|另外.*(?:登记边|无登记边))/.test(block)) { extra.push(block); return; }
    if (/^(?:#+\s*)?(?:详细(?:依据|数据|分析)|数据(?:证据|来源)|完整依赖|判断依据|What-if)/i.test(block)) supplementary = true;
    // Keep the decision itself visible when a model expands every list item into a report.
    const item = /^(\d+[.)、]|[-*])\s+(\*\*[^*]+\*\*)([\s\S]+)$/.exec(block);
    if (!supplementary && role !== "digital_member" && item && block.length > 80) {
      const lead = item[1] + " " + item[2], supporting = item[3].trim();
      if (used + lead.length <= limit) { main.push(lead); used += lead.length; if (supporting) extra.push(item[1] + " " + supporting); return; }
    }
    const table = /^\|/.test(block), code = /^\x60\x60\x60/.test(block);
    const keep = !supplementary && !table && !code && (index === 0 || used + block.length <= (limit));
    if (keep || index === next && block.length < 180) { main.push(block); used += block.length; }
    else extra.push(block);
  });
  return { main: main.join("\n\n"), details: extra.join("\n\n") };
}
