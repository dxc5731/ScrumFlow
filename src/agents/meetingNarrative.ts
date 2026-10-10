import type { MeetingSession, ProjectDataState } from "../types"
import { useProjectStore } from "../store/projectStore"
import { requestMeetingModel, parseModelObject } from "./meetingLlm"
import { generateMeetingMinutes } from "./meetingMinutes"
import { getMeetingLlmTelemetry } from "./meetingTelemetry"
import { agentName } from "./meetingConversation"
import { buildExecutionSummary } from "./meetingExecutionSummary"

const inFlight = new Map<string, Promise<void>>()
// Material-only messages do not invalidate a summary of the meeting's decisions.
export function narrativeFingerprint(state: ProjectDataState, session: MeetingSession) {
  const appliedHistory = state.history.filter(item => item.proposalId && session.proposalIds.includes(item.proposalId))
  const historyIds = new Set(appliedHistory.map(item => item.objectId))
  return JSON.stringify([session.messageIds.filter(id => { const m = state.meetingMessages[id]; return m && m.senderId !== "material_organizer" && !m.handoffTo && !(m.senderType === "user" && /@材料整理|生成.*(?:纪要|图|Excel|材料|WBS)|整理.*纪要|老师.*(?:汇报|材料)|打包|标题.*改/.test(m.content)) }),
    session.proposalIds.map(id => state.proposals[id]?.actions.map(a => [a.id, a.status, a.decision, a.proposedValue])),
    state.history.filter(item => historyIds.has(item.objectId)).map(item => [item.id, item.field])])
}

export async function ensureMeetingNarrative(meetingId: string): Promise<void> {
  const current = useProjectStore.getState(), session = current.meetingSessions[meetingId]
  if (!session) return
  const fingerprint = narrativeFingerprint(current, session)
  if (session.narrative?.fingerprint === fingerprint) return
  if (inFlight.has(meetingId)) return inFlight.get(meetingId)
  const work = (async () => {
    const messages = session.messageIds.map(id => current.meetingMessages[id]).filter(m => m && m.senderType !== "system" && !m.handoffTo)
    if (messages.length < 3) throw new Error("再讨论几个具体问题后，就能整理完整摘要。")
    const proposals = session.proposalIds.map(id => current.proposals[id]).filter(Boolean)
    const verifiedActions = proposals.flatMap(proposal => proposal.actions.filter(action => action.status === "applied" && action.decision !== "rejected").map(action => {
      const actual = current.subtasks[action.resultTargetId ?? action.targetId] ?? current.tasks[action.resultTargetId ?? action.targetId]
      const parent = actual && "taskId" in actual ? current.tasks[actual.taskId] : undefined
      return { title: actual?.title, assignee: current.members[actual?.assigneeId ?? ""]?.name, estimate: actual?.estimate,
        parent: parent && { title: parent.title, assignee: current.members[parent.assigneeId]?.name } }
    }))
    const content = await requestMeetingModel("meeting_summary", {
      meetingId, question: "请完整阅读这场会议，整理自然、可信的会议摘要", title: session.title,
      project: { name: current.project.name, goal: current.project.goal },
      // One complete read at close; ordinary turns continue to use six relevant messages.
      messages: messages.map(m => ({ id: m.id, speaker: current.members[m.senderId]?.name ?? agentName(m.senderId),
        identity: m.senderType, content: m.content })),
      verifiedMinutes: generateMeetingMinutes(current, session),
      verifiedActions, reviewedExecution: buildExecutionSummary(current, proposals),
    }, true)
    const parsed = parseModelObject(content ?? "")
    if (typeof parsed?.summary !== "string" || parsed.summary.length < 40 || parsed.summary.length > 1200)
      throw new Error("摘要暂未整理完整，请重试。")
    const validIds = new Set(messages.map(m => m.id))
    const references = Array.isArray(parsed.references) ? parsed.references.flatMap(ref => {
      if (!ref || typeof ref.text !== "string" || !parsed.summary!.toString().includes(ref.text) || !Array.isArray(ref.sourceMessageIds)) return []
      const ids = ref.sourceMessageIds.filter((id: unknown): id is string => typeof id === "string" && validIds.has(id)).slice(0, 5)
      return ids.length ? [{ text: ref.text, sourceMessageIds: ids }] : []
    }) : []
    const latest = useProjectStore.getState(), latestSession = latest.meetingSessions[meetingId]
    if (narrativeFingerprint(latest, latestSession) !== fingerprint) throw new Error("会议内容已更新，请重新整理摘要。")
    latest.setMeetingPresentation(meetingId, { narrative: { text: parsed.summary, references, fingerprint,
      generatedAt: new Date().toISOString(), model: getMeetingLlmTelemetry().filter(call => call.requestType === "meeting_summary").at(-1)?.model ?? "unknown" } })
  })().finally(() => inFlight.delete(meetingId))
  inFlight.set(meetingId, work)
  return work
}
