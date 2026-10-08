import { coordinateMeetingTurn } from "./meetingDecision"
import { parseAgentMention } from "./meetingConversation"
import { describeHypothesisImpact } from "./meetingMinutes"
import type { MeetingLlm } from "./meetingLlm"
import { useProjectStore } from "../store/projectStore"

const offline: MeetingLlm = { interpret: async () => null, explain: async () => null }
export const showcaseMarker = "meeting-showcase:2026-09-27-v5"

export function sampleProjectMeetingId() {
  const state = useProjectStore.getState()
  return Object.values(state.meetingSessions).find((session) => session.targetType === "project" &&
    session.messageIds.some((id) => state.meetingMessages[id]?.content === showcaseMarker))?.id ?? null
}

export async function openSampleProjectMeeting(): Promise<string> {
  const existing = sampleProjectMeetingId()
  if (existing) return existing
  const store = useProjectStore.getState()
  const session = store.createMeeting("project", store.project.id)
  store.addMeetingMessage(session.id, { senderType: "system", senderId: "system", content: showcaseMarker })

  async function say(senderId: string, content: string) {
    useProjectStore.getState().addMeetingMessage(session.id, { senderType: "user", senderId, content })
    if (!content.startsWith("@")) {
      const current = useProjectStore.getState()
      const meeting = current.meetingSessions[session.id]
      const fact = meeting.facts?.at(-1)
      if (fact?.type === "hypothesis" && /晚|延期/.test(content)) current.addMeetingMessage(session.id, {
        senderType: "agent", senderId: "project_orchestrator", content: describeHypothesisImpact(current, meeting, fact),
      })
      return
    }
    const state = useProjectStore.getState()
    const mention = parseAgentMention(content, state)
    const result = await coordinateMeetingTurn(state, state.meetingSessions[session.id], mention.agentId,
      mention.question, offline, mention.memberId)
    const current = useProjectStore.getState()
    current.setMeetingMemory(session.id, result.memory)
    if (result.answer.proposal) {
      const saved = current.saveProposal(result.answer.proposal)
      if (saved.ok) current.linkMeetingProposal(session.id, result.answer.proposal.id)
    }
    current.addMeetingMessage(session.id, {
      senderType: result.digitalMemberId ? "digital_member" : "agent",
      senderId: result.digitalMemberId ?? result.answer.agentType,
      content: result.answer.content, evidence: result.answer.evidence,
      rawEvidence: result.answer.rawEvidence,
      ...(result.answer.proposal ? { proposalId: result.answer.proposal.id } : {}),
    })
  }

  await say("m1", "@AI 最近项目有什么值得关注的？")
  await say("m1", "@AI 比较一下 #CAND-003 和 #CAND-005，哪个更值得先处理？")
  await say("m1", "@AI 先看 #US024，数据模型这条依赖会影响谁？")
  await say("m1", "@李娜 甘特依赖连接线现在为什么还没完成？")
  await say("m4", "数据模型确认可能要晚一天，这个时间还需要核实。")
  await say("m1", "@风险与依赖 如果 #DATA-024 晚一天，会影响哪些工作？")
  await say("m1", "@负载与容量 有别人能接数据模型这项工作吗？")
  await say("m1", "@陈林 如果「定义 Story 与 Task 数据模型」转给你，当前工作量允许吗？")
  await say("m1", "上一轮的依赖先留在会议记录里，不直接改负责人。再看 Sprint 3 的 #US030，讨论新的任务安排。")
  await say("m1", "@任务拆解 #US030 按两个人并行拆一下，尽量少改已有任务。")
  await say("m1", "@任务拆解 不要强行生成子任务，只保留必要步骤。")
  await say("m1", "@计划落地 按刚才讨论的 Sprint 3 方案整理成待确认行动。")
  return session.id
}
