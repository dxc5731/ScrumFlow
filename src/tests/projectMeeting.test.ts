import { usePlanningFixtureClock } from "./planningFixtureClock"

import { beforeEach, describe, expect, it } from "vitest"
import { coordinateMeetingTurn } from "../agents/meetingDecision"
import { meetingEntities, memoryFor, updateMeetingFocus } from "../agents/meetingContext"
import { digitalMemberAnswer } from "../agents/digitalMember"
import { compareProjectStories, crossStoryImpact, projectOverview } from "../agents/projectMeeting"
import { parseAgentMention } from "../agents/meetingConversation"
import { openSampleProjectMeeting, sampleProjectMeetingId } from "../agents/meetingShowcase"
import { createPlanOptions, proposalFromOption } from "../agents/meetingPlanning"
import type { MeetingLlm } from "../agents/meetingLlm"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"

const offline: MeetingLlm = { interpret: async () => null, explain: async () => null }

async function say(meetingId: string, memberId: string, content: string) {
  const store = useProjectStore.getState()
  store.addMeetingMessage(meetingId, { senderType: "user", senderId: memberId, content })
  const now = useProjectStore.getState()
  const mention = parseAgentMention(content, now)
  const result = await coordinateMeetingTurn(now, now.meetingSessions[meetingId], mention.agentId, mention.question, offline, mention.memberId)
  store.setMeetingMemory(meetingId, result.memory)
  store.addMeetingMessage(meetingId, { senderType: result.digitalMemberId ? "digital_member" : "agent", senderId: result.digitalMemberId ?? result.answer.agentType,
    content: result.answer.content, evidence: result.answer.evidence })
  return result
}

usePlanningFixtureClock()

describe("project-wide meeting", () => {
  beforeEach(() => resetProjectStoreForTests())

  it("creates and reopens a project scope with a data-backed welcome", () => {
    const store = useProjectStore.getState()
    const meeting = store.createMeeting("project", store.project.id)
    const state = useProjectStore.getState()
    expect(state.meetingSessions[meeting.id].targetType).toBe("project")
    expect(state.meetingMessages[meeting.messageIds[0]].content).toContain(`${Object.keys(state.stories).length} 个 Story`)
    expect(state.meetingMessages[meeting.messageIds[0]].content).toContain("#")
    store.endMeeting(meeting.id)
    expect(useProjectStore.getState().meetingSessions[meeting.id].messageIds).toHaveLength(1)
  })

  it("resolves # Story/Task and switches focus without losing the previous comparison target", async () => {
    const state = useProjectStore.getState()
    const meeting = state.createMeeting("project", state.project.id)
    expect(meetingEntities(state).some((item) => item.type === "story" && item.id === "cand-003")).toBe(true)
    await say(meeting.id, "m1", "看看 #CAND-003")
    expect(memoryFor(useProjectStore.getState().meetingSessions[meeting.id]).focusStoryIds).toEqual(["cand-003"])
    await say(meeting.id, "m1", "那 #CAND-005 呢？")
    expect(memoryFor(useProjectStore.getState().meetingSessions[meeting.id]).focusStoryIds).toEqual(["cand-005"])
    expect(memoryFor(useProjectStore.getState().meetingSessions[meeting.id]).focusSprintId).toBe(useProjectStore.getState().stories["cand-005"].sprintId)
    const comparison = await say(meeting.id, "m1", "这两个哪个更值得优先做？")
    expect(comparison.memory.focusStoryIds).toEqual(["cand-003", "cand-005"])
    expect(comparison.answer.content).toContain("CAND-003")
    expect(comparison.answer.content).toContain("CAND-005")
    expect(comparison.answer.content).toContain("工时未估算")
  })

  it("uses a named task in the focused Story for an implicit dependency question", async () => {
    const state = useProjectStore.getState()
    const meeting = state.createMeeting("project", state.project.id)
    const answer = await say(meeting.id, "m1", "@AI 先看 #US024，数据模型这条依赖会影响谁？")
    expect(answer.memory.focusTaskIds).toContain("data-024")
    expect(answer.answer.content).toContain("甘特依赖连接线渲染")
  })

  it("routes @ member to the matching digital participant and limits personal facts", async () => {
    const store = useProjectStore.getState()
    const story = store.createStory({ title: "数字成员验证", source: "manual" })
    store.createTask(story.id, { title: "李娜验证工作", assigneeId: "m2", estimate: 6 })
    store.createTask(story.id, { title: "王晨私有工作", assigneeId: "m4", estimate: 9 })
    const meeting = store.createMeeting("story", story.id)
    expect(parseAgentMention("@李娜 你现在在做什么？", useProjectStore.getState()).memberId).toBe("m2")
    const answer = await say(meeting.id, "m1", "@李娜 你现在在做什么？")
    expect(answer.digitalMemberId).toBe("m2")
    expect(answer.answer.content).toContain("李娜验证工作")
    expect(answer.answer.content).not.toContain("王晨私有工作")
    const messages = useProjectStore.getState().meetingSessions[meeting.id].messageIds.map((id) => useProjectStore.getState().meetingMessages[id])
    expect(messages.at(-1)).toMatchObject({ senderType: "digital_member", senderId: "m2" })
  })

  it("updates the digital member's answer when Store Action changes workload", () => {
    const store = useProjectStore.getState()
    const story = store.createStory({ title: "容量跟踪", source: "manual" })
    const first = store.createTask(story.id, { title: "原有验证", assigneeId: "m2", estimate: 6 })
    const meeting = store.createMeeting("story", story.id)
    const before = digitalMemberAnswer(useProjectStore.getState(), meeting, memoryFor(meeting), "m2", "现在做什么")
    expect(before.content).toContain("6h")
    store.updateTask(first.id, { estimate: 11 })
    const after = digitalMemberAnswer(useProjectStore.getState(), useProjectStore.getState().meetingSessions[meeting.id], memoryFor(meeting), "m2", "现在做什么")
    expect(after.content).toContain("11h")
    expect(after.content).not.toContain("昨天")
  })

  it("uses actual Story facts for comparison and follows cross-Story dependencies", () => {
    const store = useProjectStore.getState()
    const first = store.createStory({ title: "接口 Story", source: "manual" })
    const second = store.createStory({ title: "验证 Story", source: "manual" })
    const a = store.createTask(first.id, { title: "接口实现", estimate: 8 })
    const b = store.createTask(second.id, { title: "接口验收", estimate: 4 })
    store.addDependency(a.id, b.id)
    const state = useProjectStore.getState()
    const comparison = compareProjectStories(state, [first.id, second.id])
    expect(comparison.content).toContain("8h")
    expect(comparison.content).toContain("4h")
    const impact = crossStoryImpact(state, a.id, 1)
    expect(impact.content).toContain(second.id.toUpperCase())
    expect(impact.evidence.join(" ")).toContain("接口实现 → 接口验收")
    expect(projectOverview(state).content).toContain(`${Object.keys(state.stories).length} 个 Story`)
  })

  it("turns human, digital member, risk, and workload discussion into audited actions", async () => {
    const store = useProjectStore.getState()
    const story = store.createStory({ title: "团队接口协作", source: "manual", storyPoints: 4 })
    const interfaceTask = store.createTask(story.id, { title: "接口实现", assigneeId: "m4", estimate: 8 })
    const validation = store.createTask(story.id, { title: "接口验证", assigneeId: "m2", estimate: 4 })
    store.addDependency(interfaceTask.id, validation.id)
    const meeting = store.createMeeting("project", store.project.id)
    await say(meeting.id, "m1", `先看 #${story.id.toUpperCase()}`)
    const member = await say(meeting.id, "m1", "@李娜 你负责的验证为什么还没开始？")
    expect(member.answer.content).toContain("接口实现")
    store.addMeetingMessage(meeting.id, { senderType: "user", senderId: "m4", content: "接口可能要晚一天。" })
    const risk = await say(meeting.id, "m1", `@风险与依赖 如果 #${interfaceTask.id.toUpperCase()} 晚一天会怎样？`)
    expect(risk.answer.content).toContain("接口验证")
    expect(risk.answer.evidence.join(" ")).toContain("接口可能要晚一天")
    const load = await say(meeting.id, "m1", "@负载与容量 有别人能接接口吗？")
    expect(load.answer.content).toContain("具体候选如下")
    expect(load.answer.content).not.toContain("方案 A")
    const candidate = await say(meeting.id, "m1", "@陈林 如果接口实现转给你可以吗？")
    expect(candidate.answer.content).toContain("接口实现")
    expect(candidate.memory.pendingAssignment).toEqual({ taskId: interfaceTask.id, memberId: "m3" })
    expect(candidate.memory.constraints.assignmentOverrides[interfaceTask.id]).toBeUndefined()
    const confirmed = await say(meeting.id, "m1", "那就按这个方案。")
    expect(confirmed.memory.constraints.assignmentOverrides[interfaceTask.id]).toBe("m3")
    const execution = await say(meeting.id, "m1", "@计划落地 帮我整理并执行")
    const proposal = execution.answer.proposal!
    expect(proposal.actions.some((action) => action.actionType === "UPDATE_TASK" && action.targetId === interfaceTask.id)).toBe(true)
    store.saveProposal(proposal)
    store.linkMeetingProposal(meeting.id, proposal.id)
    for (const action of proposal.actions) store.setProposalDecision(proposal.id, action.id, "accepted")
    store.applyProposal(proposal.id)
    const after = useProjectStore.getState()
    expect(after.tasks[interfaceTask.id].assigneeId).toBe("m3")
    expect(after.history.some((item) => item.proposalId === proposal.id && item.source === "agent")).toBe(true)
    expect(after.meetingSessions[meeting.id].proposalIds).toContain(proposal.id)
    expect(after.meetingSessions[meeting.id].messageIds.length).toBeGreaterThan(10)
  })

  it("offers directions instead of repeating zero days for a closed Sprint", async () => {
    const store = useProjectStore.getState()
    const story = Object.values(store.stories).find((item) => item.sprintId && store.sprints[item.sprintId]?.status === "closed")!
    const meeting = store.createMeeting("story", story.id)
    const guidance = await say(meeting.id, "m1", "@任务拆解 重新规划一下")
    expect(guidance.answer.content).toContain("A.")
    expect(guidance.answer.content).toContain("B.")
    expect(guidance.answer.content).toContain("C.")
    const choice = await say(meeting.id, "m1", "选 B")
    expect(choice.memory.planningMode).toBe("wbs_only")
    expect(choice.answer.content).toContain("暂不生成项目修改")
  })

  it("does not offer executable tasks dated beyond their Sprint", () => {
    const state = useProjectStore.getState()
    const story = state.stories.us032
    const meeting = state.createMeeting("story", story.id)
    const options = createPlanOptions(useProjectStore.getState(), meeting, memoryFor(meeting))
    expect(options[0].feasible).toBe(false)
    expect(options[0].infeasibleReasons.join(" ")).toContain("计划日期超出")
    expect(proposalFromOption(useProjectStore.getState(), meeting, options[0])).toBeNull()
  })

  it("keeps a reopenable sample discussion with real answers and unapplied decisions", async () => {
    const before = useProjectStore.getState()
    const taskCount = Object.keys(before.tasks).length
    const meetingId = await openSampleProjectMeeting()
    const after = useProjectStore.getState()
    const session = after.meetingSessions[meetingId]
    const messages = session.messageIds.map((id) => after.meetingMessages[id])
    expect(session.targetType).toBe("project")
    expect(messages.some((message) => message.senderType === "digital_member" && message.senderId === "m2")).toBe(true)
    expect(messages.some((message) => message.senderType === "user" && message.senderId === "m4")).toBe(true)
    expect(messages.some((message) => message.senderType === "agent" && message.senderId === "risk_dependency")).toBe(true)
    expect(messages.some((message) => message.proposalId)).toBe(true)
    expect(session.proposalIds.length).toBeGreaterThan(0)
    expect(Object.keys(after.tasks)).toHaveLength(taskCount)
    expect(await openSampleProjectMeeting()).toBe(meetingId)
    expect(sampleProjectMeetingId()).toBe(meetingId)
  })
})
