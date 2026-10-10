import { usePlanningFixtureClock } from "./planningFixtureClock"

import { beforeEach, describe, expect, it, vi } from "vitest"
import { coordinateMeetingTurn } from "../agents/meetingDecision"
import { buildMeetingContext, focusedMeetingSession, memoryFor, updateMeetingFocus } from "../agents/meetingContext"
import { describeHypothesisImpact, generateMeetingMinutes } from "../agents/meetingMinutes"
import { createPlanOptions, memberLoads, proposalFromOption } from "../agents/meetingPlanning"
import { calculatePlanSchedule } from "../agents/meetingSchedule"
import { buildProjectAnalysisSnapshot } from "../agents/meetingSnapshot"
import { analyzeMeetingAgent } from "../agents/meetingConversation"
import { digitalMemberAnswer } from "../agents/digitalMember"
import type { MeetingLlm } from "../agents/meetingLlm"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"

const offline: MeetingLlm = { interpret: async () => null, explain: async () => null }

usePlanningFixtureClock()

describe("meeting focus and minutes", () => {
  beforeEach(() => resetProjectStoreForTests())

  it("isolates Sprint 2 planning from a Sprint 3 Story and restores it on return", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("project", store.project.id)
    const first = updateMeetingFocus(store, session, memoryFor(session), "先看 #US024")
    first.constraints.maxPeople = 2
    first.constraints.maxDays = 3
    first.constraints.targetSprintId = "s2"
    first.options = createPlanOptions(store, { ...session, targetType: "story", targetId: "us024" }, first)
    const next = updateMeetingFocus(store, session, first, "再看 #US030")
    expect(next.focusStoryIds).toEqual(["us030"])
    expect(next.focusSprintId).toBe("s3")
    expect(next.constraints.maxPeople).toBeNull()
    expect(next.constraints.maxDays).toBeNull()
    expect(next.constraints.targetSprintId).toBeNull()
    expect(next.options).toEqual([])
    const options = createPlanOptions(store, { ...session, targetType: "story", targetId: "us030" }, next)
    expect(options[0].infeasibleReasons.join(" ")).not.toContain("Sprint 2")
    const returned = updateMeetingFocus(store, session, next, "回到 #US024")
    expect(returned.constraints.maxPeople).toBe(2)
    expect(returned.options).toHaveLength(2)
  })

  it("carries only explicit reusable limits to a new focus", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("project", store.project.id)
    const first = updateMeetingFocus(store, session, memoryFor(session), "#US024")
    first.constraints.maxPeople = 2
    first.constraints.targetSprintId = "s2"
    const next = updateMeetingFocus(store, session, first, "#US030 沿用刚才的两人限制")
    expect(next.constraints.maxPeople).toBe(2)
    expect(next.constraints.targetSprintId).toBeNull()
    expect(next.focusSprintId).toBe("s3")
  })

  it("keeps the Story focus when execution mentions its Sprint", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("project", store.project.id)
    const first = updateMeetingFocus(store, session, memoryFor(session), "#US030")
    const next = updateMeetingFocus(store, session, first, "按刚才讨论的 Sprint 3 方案整理行动")
    expect(next.focusStoryIds).toEqual(["us030"])
    expect(next.focusSprintId).toBe("s3")
  })

  it("acknowledges a Sprint return without carrying the previous Story plan", async () => {
    vi.setSystemTime(new Date("2026-10-03T10:00:00+08:00"))
    const store = useProjectStore.getState()
    const session = store.createMeeting("project", store.project.id)
    const focused = updateMeetingFocus(store, session, memoryFor(session), "切到 #US030")
    store.setMeetingMemory(session.id, focused)
    const current = useProjectStore.getState()
    const answer = await coordinateMeetingTurn(current, current.meetingSessions[session.id], "auto", "回到 #Sprint-2 看刚才的安排。", offline)
    expect(answer.memory.focusStoryIds).toEqual([])
    expect(answer.memory.focusSprintId).toBe("s2")
    expect(answer.answer.content).toContain("已切回 Sprint 2")
    expect(answer.answer.content).toContain("US030 的计划属于 Sprint 3")
    expect(answer.answer.content).toContain("无剩余工作日")
    expect(answer.answer.content).not.toContain("当前条件无法同时满足")
  })

  it("puts the Story with applied work into the minutes summary", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("project", store.project.id)
    const focus = updateMeetingFocus(store, session, memoryFor(session), "切到 #US030")
    focus.options = createPlanOptions(store, focusedMeetingSession(store, session, focus)!, focus)
    focus.activePlanId = "A"
    store.setMeetingMemory(session.id, focus)
    const current = useProjectStore.getState()
    const proposal = proposalFromOption(current, focusedMeetingSession(current, session, focus)!, focus.options[0])!
    current.saveProposal(proposal)
    current.linkMeetingProposal(session.id, proposal.id)
    for (const action of proposal.actions) current.setProposalDecision(proposal.id, action.id, "accepted")
    expect(useProjectStore.getState().applyProposal(proposal.id).ok).toBe(true)
    const latest = useProjectStore.getState()
    const minutes = generateMeetingMinutes(latest, latest.meetingSessions[session.id])
    expect(minutes.executiveSummary[0]).toContain("US030 · Sprint 3 执行规划")
  })

  it("resolves Sprint aliases and keeps a named Story above an old Sprint mention", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("project", store.project.id)
    const sprint = updateMeetingFocus(store, session, memoryFor(session), "再看 #Sprint-3")
    expect(sprint.focusSprintId).toBe("s3")
    const story = updateMeetingFocus(store, session, sprint, "再看 #US030，刚才 Sprint 2 的限制不能带过来")
    expect(story.focusStoryIds).toEqual(["us030"])
    expect(story.focusSprintId).toBe("s3")
    expect(story.constraints.targetSprintId).toBeNull()
    const oldSprint = updateMeetingFocus(store, session, story, "回到 #Sprint-2")
    const returned = updateMeetingFocus(store, session, oldSprint, "再看 #US030，刚才 Sprint 2 的限制不能带过来")
    expect(returned.focusStoryIds).toEqual(["us030"])
    expect(returned.focusSprintId).toBe("s3")
  })

  it("keeps global messages but scopes recent LLM context to the latest Story focus", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("project", store.project.id)
    store.addMeetingMessage(session.id, { senderType: "user", senderId: "m1", content: "先看 #US024" })
    store.addMeetingMessage(session.id, { senderType: "user", senderId: "m4", content: "数据模型可能晚一天" })
    store.addMeetingMessage(session.id, { senderType: "user", senderId: "m1", content: "再看 #US030" })
    const current = useProjectStore.getState()
    const focused = updateMeetingFocus(current, current.meetingSessions[session.id], memoryFor(session), "#US030")
    const context = buildMeetingContext(current, { ...current.meetingSessions[session.id], memory: focused })
    expect(context.recentMessages.map((message) => message.content)).toEqual(["再看 #US030"])
    expect(context.global.recentMessages.some((message) => message.content.includes("可能晚一天"))).toBe(true)
  })

  it("records a hypothesis without changing the Project Model and creates readable minutes", async () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("project", store.project.id)
    const before = JSON.stringify({ tasks: store.tasks, stories: store.stories })
    const claim = store.addMeetingMessage(session.id, { senderType: "user", senderId: "m4", content: "DATA-024 可能晚一天。" })
    let current = useProjectStore.getState()
    expect(current.meetingSessions[session.id].facts).toContainEqual(expect.objectContaining({ type: "hypothesis", status: "unverified", sourceMessageId: claim.id }))
    current.addMeetingMessage(session.id, { senderType: "user", senderId: "m1", content: "@风险与依赖 #US024 看看影响" })
    current = useProjectStore.getState()
    const result = await coordinateMeetingTurn(current, current.meetingSessions[session.id], "risk_dependency", "#US024 看看影响", offline)
    current.setMeetingMemory(session.id, result.memory)
    current = useProjectStore.getState()
    expect(current.meetingSessions[session.id].topics?.some((topic) => topic.title.includes("US024"))).toBe(true)
    const minutes = generateMeetingMinutes(current, current.meetingSessions[session.id])
    expect(minutes.openQuestions.join(" ")).toContain("DATA-024")
    expect(JSON.stringify({ ...minutes, agentTypes: undefined })).not.toMatch(/proposalId|actionId|beforeValue|proposedValue|project_orchestrator/)
    expect(JSON.stringify({ tasks: current.tasks, stories: current.stories })).toBe(before)
    current.endMeeting(session.id)
    expect(useProjectStore.getState().meetingSessions[session.id].minutes?.openQuestions.join(" ")).toContain("DATA-024")
    expect(useProjectStore.getState().meetingSessions[session.id].topics?.every((topic) => topic.status !== "active")).toBe(true)
  })

  it("distinguishes a confirmed update from an earlier hypothesis", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("project", store.project.id)
    store.addMeetingMessage(session.id, { senderType: "user", senderId: "m4", content: "DATA-024 可能晚一天" })
    store.addMeetingMessage(session.id, { senderType: "user", senderId: "m4", content: "确认 DATA-024 延期一天" })
    const facts = useProjectStore.getState().meetingSessions[session.id].facts ?? []
    expect(facts.map((fact) => fact.status)).toEqual(["confirmed", "confirmed"])
    expect(facts.map((fact) => fact.type)).toEqual(["hypothesis", "fact"])
  })

  it("gives the host a dependency-backed reminder without changing task dates", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("project", store.project.id)
    const originalDate = store.tasks["data-024"].endDate
    store.addMeetingMessage(session.id, { senderType: "user", senderId: "m4", content: "#DATA-024 可能晚一天" })
    const current = useProjectStore.getState()
    const fact = current.meetingSessions[session.id].facts![0]
    const response = describeHypothesisImpact(current, current.meetingSessions[session.id], fact)
    expect(response).toContain("待核实")
    const downstream = Object.values(current.dependencies).filter((dependency) => dependency.sourceTaskId === "data-024").length
    expect(response).toContain(`${downstream} 项后续工作`)
    expect(current.tasks["data-024"].endDate).toBe(originalDate)
  })

  it("turns acceptance criteria into engineering work without forced steps", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("story", "us030")
    const options = createPlanOptions(store, session, memoryFor(session))
    const criteria = store.stories.us030.acceptanceCriteriaIds.map((id) => store.acceptanceCriteria[id].content)
    const draft = options[0].tasks.filter((task) => !task.sourceTaskId)
    expect(draft.length).toBeGreaterThan(0)
    expect(draft.some((task) => /实现|开发|测试/.test(task.title))).toBe(true)
    expect(draft.every((task) => !criteria.includes(task.title))).toBe(true)
    expect(draft.some((task) => task.subtaskTitles.length === 0)).toBe(true)
  })

  it("compresses a repeated planning answer when a new constraint changes nothing", async () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("story", "us030")
    const first = await coordinateMeetingTurn(store, session, "task_decomposition", "按两个人并行拆解", offline)
    store.setMeetingMemory(session.id, first.memory)
    const current = useProjectStore.getState()
    const second = await coordinateMeetingTurn(current, current.meetingSessions[session.id], "task_decomposition", "不要强行生成子任务，只保留必要步骤", offline)
    expect(second.answer.content).toContain("不需要为了层级再拆步骤")
    expect(second.answer.content).not.toContain("方案 B")
  })

  it("locks the first two tasks and assigns only the third by ordinal", async () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("story", "us030")
    const first = await coordinateMeetingTurn(store, session, "task_decomposition", "两个人并行拆", offline)
    store.setMeetingMemory(session.id, first.memory)
    const nextState = useProjectStore.getState()
    const second = await coordinateMeetingTurn(nextState, nextState.meetingSessions[session.id], "task_decomposition", "李娜只能做测试，最多三天完成", offline)
    const original = second.memory.options[0].tasks.map((task) => task.assigneeId)
    store.setMeetingMemory(session.id, second.memory)
    const latest = useProjectStore.getState()
    const third = await coordinateMeetingTurn(latest, latest.meetingSessions[session.id], "task_decomposition", "改成三个人，前两个任务不要动，第三个任务换给陈林", offline)
    const assigned = third.memory.options[0].tasks.map((task) => task.assigneeId)
    expect(assigned.slice(0, 2)).toEqual(original.slice(0, 2))
    expect(assigned[2]).toBe("m3")
    expect(Object.keys(third.memory.constraints.assignmentOverrides)).toEqual([third.memory.options[0].tasks[2].key])
    expect(third.memory.constraints.maxPeople).toBe(3)
  })

  it("calculates a dependency DAG critical path separately from total hours", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("story", "us030")
    const memory = memoryFor(session)
    const base = createPlanOptions(store, session, memory)[0].tasks[0]
    const tasks = [
      { ...base, key: "A", estimate: 3, assigneeId: "m1", dependsOnKeys: [] },
      { ...base, key: "B", estimate: 3, assigneeId: "m2", dependsOnKeys: [] },
      { ...base, key: "C", estimate: 3, assigneeId: "m3", dependsOnKeys: ["A"] },
      { ...base, key: "D", estimate: 3, assigneeId: "m4", dependsOnKeys: ["B", "C"] },
    ]
    const result = calculatePlanSchedule(tasks, buildProjectAnalysisSnapshot(store, session, memory))
    expect(tasks.reduce((sum, task) => sum + task.estimate, 0)).toBe(12)
    expect(result.criticalPathHours).toBe(9)
    expect(result.criticalPathKeys).toEqual(["A", "C", "D"])
    expect(result.estimatedDurationDays).toBeGreaterThanOrEqual(2)
  })

  it("keeps ended minutes synchronized with later Proposal review and execution", () => {
    const store = useProjectStore.getState()
    const story = store.createStory({ title: "会议行动同步", source: "manual", storyPoints: 3 })
    const session = store.createMeeting("story", story.id)
    const proposal = analyzeMeetingAgent(useProjectStore.getState(), session, "task_decomposition", "拆解任务").proposal!
    store.saveProposal(proposal)
    store.linkMeetingProposal(session.id, proposal.id)
    store.endMeeting(session.id)
    expect(useProjectStore.getState().meetingSessions[session.id].minutes?.actions[0].status).toBe("待审核")
    store.setProposalDecision(proposal.id, proposal.actions[0].id, "accepted")
    expect(useProjectStore.getState().meetingSessions[session.id].minutes?.actions[0].status).toBe("已采纳，待执行")
    store.applyProposal(proposal.id)
    const after = useProjectStore.getState()
    expect(after.meetingSessions[session.id].minutes?.actions[0].status).toBe("已执行")
    expect(after.meetingSessions[session.id].minutes?.executionResults.some((item) => item.includes("新建任务 1 个"))).toBe(true)
    expect(after.history.some((item) => item.proposalId === proposal.id)).toBe(true)
  })

  it("answers a member assignment question from the focused Sprint workload", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("story", "us030")
    const reply = digitalMemberAnswer(store, session, memoryFor(session), "m3", "如果 #DATA-024 转给你可以吗？")
    const sprintHours = memberLoads(store, "s3").m3
    expect(reply.content).toContain(`Sprint 3还有 ${sprintHours}h 未完成工作`)
    expect(reply.evidence.join(" ")).toContain("Sprint 3未完成工作")
  })
})
