import { coordinateMeetingTurn } from "./meetingDecision"
import { parseAgentMention } from "./meetingConversation"
import { describeHypothesisImpact } from "./meetingMinutes"
import type { MeetingLlm } from "./meetingLlm"
import { useProjectStore } from "../store/projectStore"

const offline: MeetingLlm = { interpret: async () => null, explain: async () => null }
export const showcaseV2Marker = "meeting-showcase:2026-09-27-v2-quality"

export function showcaseV2MeetingId() {
  const state = useProjectStore.getState()
  return Object.values(state.meetingSessions).find((session) => session.messageIds.some((id) =>
    state.meetingMessages[id]?.content === showcaseV2Marker))?.id ?? null
}

export async function openShowcaseV2Meeting(): Promise<string> {
  const existing = showcaseV2MeetingId()
  if (existing) return existing
  const store = useProjectStore.getState()
  if (!store.stories.us024 || !store.stories.us030 || !store.tasks["data-024"])
    throw new Error("当前项目缺少 Showcase V2 所需的示例 Story 与任务")
  const meeting = store.createMeeting("project", store.project.id)
  store.addMeetingMessage(meeting.id, { senderType: "system", senderId: "system", content: showcaseV2Marker })

  async function say(senderId: string, input: string, humanOnly = false) {
    const message = useProjectStore.getState().addMeetingMessage(meeting.id, { senderType: "user", senderId, content: input })
    const state = useProjectStore.getState()
    const fact = state.meetingSessions[meeting.id].facts?.at(-1)
    if (humanOnly) {
      if (fact?.sourceMessageId === message.id && fact.type === "hypothesis") state.addMeetingMessage(meeting.id, {
        senderType: "agent", senderId: "project_orchestrator", signal: "reanalyze",
        content: describeHypothesisImpact(state, state.meetingSessions[meeting.id], fact),
      })
      if (/先不改负责人|暂不调整负责人/.test(input)) {
        const memory = structuredClone(state.meetingSessions[meeting.id].memory)
        if (memory) {
          memory.pendingAssignment = null
          memory.decisionSummary = "负责人调整已暂缓；延期仍待核实"
          state.setMeetingMemory(meeting.id, memory)
        }
        state.addMeetingMessage(meeting.id, { senderType: "agent", senderId: "project_orchestrator",
          content: "这项负责人调整先记为暂缓，DATA-024 延期仍是待核实假设。正式任务和日期没有变化；接下来可以讨论 Sprint 3。" })
      }
      return
    }
    const mention = parseAgentMention(input, state)
    const result = await coordinateMeetingTurn(state, state.meetingSessions[meeting.id], mention.agentId,
      mention.question, offline, mention.memberId)
    const current = useProjectStore.getState()
    const saved = current.setMeetingMemory(meeting.id, result.memory)
    if (!saved.ok) throw new Error(saved.message)
    let proposalId: string | undefined
    if (result.answer.proposal) {
      const savedProposal = current.saveProposal(result.answer.proposal)
      if (!savedProposal.ok) throw new Error(savedProposal.message)
      current.linkMeetingProposal(meeting.id, result.answer.proposal.id)
      proposalId = result.answer.proposal.id
    }
    current.addMeetingMessage(meeting.id, {
      senderType: result.digitalMemberId ? "digital_member" : "agent",
      senderId: result.digitalMemberId ?? result.answer.agentType,
      content: result.answer.content, evidence: result.answer.evidence,
      rawEvidence: result.answer.rawEvidence, ...(proposalId ? { proposalId } : {}),
    })
    current.recordMeetingQaTrace(meeting.id, {
      messageId: message.id, input, resolvedIntent: result.resolvedIntent,
      focusStoryIds: result.memory.focusStoryIds, focusSprintId: result.memory.focusSprintId,
      referencedTaskKeys: result.memory.referencedTaskKeys, constraints: result.memory.constraints,
      calledAgents: result.completedAgents, snapshotVersion: result.snapshotVersion,
      selectedOptionId: result.memory.activePlanId, proposalId: proposalId ?? null,
      llmFallback: result.llmFallback, llmReplyUsed: result.llmReplyUsed, warnings: result.warnings,
    })
  }

  await say("m1", "@AI 最近项目最值得关注什么？")
  await say("m1", "@AI 比较 #CAND-003 和 #CAND-005，哪个更值得先处理？")
  await say("m1", "@AI #US024 为什么推进慢？")
  await say("m4", "#DATA-024 数据模型可能晚一天，这个时间还没确认。", true)
  await say("m1", "@风险与依赖 如果 #DATA-024 晚一天，直接和间接影响是什么？")
  await say("m1", "@风险与依赖 如果晚两天呢？")
  await say("m1", "@风险与依赖 如果解除 #DATA-024 到后续接口的依赖呢？")
  await say("m1", "@风险与依赖 哪个前置任务最关键？")
  await say("m1", "@李娜 甘特依赖连接线为什么还没完成？")
  await say("m1", "@李娜 如果 #DATA-024 明天完成，你还需要多久？")
  await say("m1", "@陈林 如果数据模型工作转给你，你的容量允许吗？")
  await say("m1", "@负载与容量 谁最适合接 #DATA-024？")
  await say("m1", "@负载与容量 不要调整已经开始的任务；给我最少调整和最快完成两个方案。")
  await say("m1", "上一轮先不改负责人，延期也先作为待核实假设。", true)
  await say("m1", "再看 #Sprint-3。")
  await say("m1", "再看 #US030，这个 Story 现在有任务吗？")
  await say("m1", "@任务拆解 #US030 两个人并行拆，不要机械照着验收标准拆，也不要生成不必要的 Subtask。")
  await say("m1", "@任务拆解 李娜只能做测试，最多三天完成。")
  await say("m1", "@任务拆解 如果改成三个人呢？前两个任务不要动，第三个任务换给陈林。")
  await say("m1", "回到 #Sprint-2，看一下刚才的限制。")
  await say("m1", "再看 #US030，刚才 Sprint 2 的工期限制不能带过来。")
  await say("m1", "@任务拆解 为审核留缓冲，工期上限放宽到五天；只改必要部分，不需要 Subtask。")
  await say("m1", "@任务拆解 选方案 A。")
  await say("m1", "@计划落地 按刚才确定的方案 A 整理待审核的项目行动。")

  const current = useProjectStore.getState()
  const proposalId = current.meetingSessions[meeting.id].proposalIds.at(-1)
  if (proposalId) {
    const proposal = current.proposals[proposalId]
    const creates = proposal.actions.filter((action) => action.actionType === "CREATE_TASK")
    const dependency = proposal.actions.find((action) => action.actionType === "ADD_DEPENDENCY")
    const testTask = creates.find((action) => action.proposedValue.type === "test" && action.proposedValue.assigneeId !== "m2")
    if (testTask) {
      const value = { ...testTask.proposedValue, assigneeId: "m2" }
      const changed = current.updateProposalValue(proposalId, testTask.id, value)
      if (!changed.ok) throw new Error(changed.message)
    }
    for (const action of proposal.actions) {
      const decision = dependency?.id === action.id ? "rejected" : "accepted"
      const result = current.setProposalDecision(proposalId, action.id, decision)
      if (!result.ok) throw new Error(result.message)
    }
    const applied = current.applyProposal(proposalId)
    const appliedActions = useProjectStore.getState().proposals[proposalId].actions
    const completed = appliedActions.some((action) => action.status === "applied") &&
      appliedActions.every((action) => action.status !== "failed" && action.status !== "stale")
    current.addMeetingMessage(meeting.id, { senderType: "system", senderId: "system",
      content: completed ? "审核完成：测试任务改由李娜负责，拒绝一条依赖；已应用其余采纳项。" : `审核后应用未完成：${applied.message}` })
  }
  const ended = useProjectStore.getState().endMeeting(meeting.id)
  if (!ended.ok) throw new Error(ended.message)
  return meeting.id
}
