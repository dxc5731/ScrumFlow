import { usePlanningFixtureClock } from "./planningFixtureClock"

import { beforeEach, describe, expect, it } from "vitest"
import { businessChangeSummary, describeBusinessChanges } from "../agents/meetingBusinessSummary"
import { validatePlanAgainstConstraints } from "../agents/meetingConstraintValidator"
import { memoryFor, understandMeetingTurn, updateMeetingFocus } from "../agents/meetingContext"
import { coordinateMeetingTurn } from "../agents/meetingDecision"
import type { MeetingLlm } from "../agents/meetingLlm"
import { createPlanOptions } from "../agents/meetingPlanning"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"
import type { ProposalAction } from "../types"

usePlanningFixtureClock()

describe("meeting hard constraint regression", () => {
  beforeEach(() => resetProjectStoreForTests())
  const offline: MeetingLlm = { interpret: async () => null, explain: async () => null }

  async function ask(meetingId: string, text: string) {
    const store = useProjectStore.getState()
    store.addMeetingMessage(meetingId, { senderType: "user", senderId: "m1", content: text })
    const current = useProjectStore.getState()
    const answer = await coordinateMeetingTurn(current, current.meetingSessions[meetingId], "auto", text, offline)
    current.setMeetingMemory(meetingId, answer.memory)
    current.addMeetingMessage(meetingId, { senderType: "agent", senderId: answer.answer.agentType, content: answer.answer.content })
    return answer
  }

  function planning() {
    const state = useProjectStore.getState()
    const session = state.createMeeting("story", "us030")
    const memory = memoryFor(session)
    return { state: useProjectStore.getState(), session, memory }
  }

  it("uses exactly three people or marks every option invalid", () => {
    const { state, session, memory } = planning()
    memory.constraints.requiredPeople = 3
    memory.constraints.maxPeople = 3
    memory.constraints.parallel = true
    const options = createPlanOptions(state, session, memory)
    for (const option of options) {
      const count = new Set(option.tasks.map((task) => task.assigneeId)).size
      expect(option.feasible ? count === 3 : option.infeasibleReasons.some((reason) => reason.includes("3 人"))).toBe(true)
    }
  })

  it("keeps test-only assignments and no-subtask rules hard", () => {
    const { state, session, memory } = planning()
    memory.constraints.testOnlyMemberIds = ["m2"]
    memory.constraints.allowSubtasks = false
    for (const option of createPlanOptions(state, session, memory)) {
      expect(option.tasks.filter((task) => task.assigneeId === "m2").every((task) => task.type === "test")).toBe(true)
      expect(option.tasks.every((task) => task.subtaskTitles.length === 0)).toBe(true)
    }
  })

  it("preserves both locked tasks exactly across replanning", () => {
    const { state, session, memory } = planning()
    memory.options = createPlanOptions(state, session, memory)
    memory.activePlanId = "A"
    const first = structuredClone(memory.options[0].tasks.slice(0, 2))
    const locked = understandMeetingTurn(state, { ...session, memory }, "前两个任务不要动")
    memory.constraints = locked.constraints
    memory.constraints.requiredPeople = 3
    memory.constraints.maxPeople = 3
    const replanned = createPlanOptions(state, session, memory)
    expect(replanned[0].tasks.slice(0, 2)).toEqual(first)
    expect(validatePlanAgainstConstraints(replanned[0], memory.constraints, state).violations.some((item) => item.type === "lockedTask")).toBe(false)
  })

  it("keeps computed duration when a five-day cap replaces a three-day cap", () => {
    const { state, session, memory } = planning()
    const first = createPlanOptions(state, session, memory)[0]
    memory.constraints.maxDays = 5
    const second = createPlanOptions(state, session, memory)[0]
    expect(second.estimatedDurationDays).toBe(first.estimatedDurationDays)
    expect(second.estimatedDurationDays).not.toBe(5)
  })

  it("reports excluded members and fixed assignee conflicts as hard violations", () => {
    const { state, session, memory } = planning()
    const option = createPlanOptions(state, session, memory)[0]
    const task = option.tasks[0]
    memory.constraints.excludedMemberIds = [task.assigneeId]
    memory.constraints.assignmentOverrides[task.key] = Object.keys(state.members).find((id) => id !== task.assigneeId)!
    const checked = validatePlanAgainstConstraints(option, memory.constraints, state)
    expect(checked.valid).toBe(false)
    expect(checked.violations.map((item) => item.type)).toEqual(expect.arrayContaining(["excludedMember", "fixedAssignee"]))
  })

  it("does not carry a previous Story deadline into a new focus", () => {
    const state = useProjectStore.getState()
    const session = state.createMeeting("project", state.project.id)
    const first = updateMeetingFocus(state, session, memoryFor(session), "先看 #US024")
    first.constraints.maxDays = 1
    first.constraints.targetSprintId = state.stories.us024.sprintId
    const second = updateMeetingFocus(state, session, first, "切到 #US030")
    expect(second.constraints.maxDays).toBeNull()
    expect(second.constraints.targetSprintId).toBeNull()
    expect(second.focusSprintId).toBe(state.stories.us030.sprintId)
  })

  it("counts created and updated tasks separately from dependencies", () => {
    const actions = ["CREATE_TASK", "CREATE_TASK", "UPDATE_TASK", "UPDATE_TASK", "ADD_DEPENDENCY"]
      .map((actionType) => ({ actionType, proposedValue: {} })) as ProposalAction[]
    const summary = businessChangeSummary(actions)
    expect(summary).toMatchObject({ createdTasks: 2, updatedTasks: 2, addedDependencies: 1 })
    expect(describeBusinessChanges(summary)).toContain("调整已有任务 2 个")
  })

  it("restores the fixed demo model including meetings and proposals", () => {
    const state = useProjectStore.getState()
    const original = { storyCount: Object.keys(state.stories).length, taskCount: Object.keys(state.tasks).length,
      storyIds: Object.keys(state.stories), taskIds: Object.keys(state.tasks), dataEnd: state.tasks["data-024"].endDate,
      stories: structuredClone(state.stories), tasks: structuredClone(state.tasks), dependencies: structuredClone(state.dependencies), risks: structuredClone(state.risks) }
    state.createMeeting("project", state.project.id)
    state.createStory({ title: "QA 临时 Story", source: "manual" })
    state.resetDemoData()
    const restored = useProjectStore.getState()
    expect({ storyCount: Object.keys(restored.stories).length, taskCount: Object.keys(restored.tasks).length,
      storyIds: Object.keys(restored.stories), taskIds: Object.keys(restored.tasks), dataEnd: restored.tasks["data-024"].endDate,
      stories: restored.stories, tasks: restored.tasks, dependencies: restored.dependencies, risks: restored.risks }).toEqual(original)
    expect(Object.keys(restored.sprints)).toEqual(["s1", "s2", "s3"])
    expect(Object.keys(restored.members)).toEqual(["m1", "m2", "m3", "m4"])
    expect(Object.keys(restored.meetingSessions)).toHaveLength(0)
    expect(Object.keys(restored.proposals)).toHaveLength(0)
    const firstReset = structuredClone({ stories: restored.stories, tasks: restored.tasks, subtasks: restored.subtasks,
      sprints: restored.sprints, members: restored.members, dependencies: restored.dependencies, risks: restored.risks,
      meetingSessions: restored.meetingSessions, proposals: restored.proposals, history: restored.history })
    restored.resetDemoData()
    const twice = useProjectStore.getState()
    expect({ stories: twice.stories, tasks: twice.tasks, subtasks: twice.subtasks,
      sprints: twice.sprints, members: twice.members, dependencies: twice.dependencies, risks: twice.risks,
      meetingSessions: twice.meetingSessions, proposals: twice.proposals, history: twice.history }).toEqual(firstReset)
  })

  it("accepts an ordinal assignee while preserving two locked tasks and three people", async () => {
    const { session } = planning()
    await ask(session.id, "#US030 两个人并行拆，不需要 Subtask")
    await ask(session.id, "李娜只能做测试")
    await ask(session.id, "改成三个人")
    const before = await ask(session.id, "前两个任务不要动")
    const locked = structuredClone(before.memory.options[0].tasks.slice(0, 2))
    const after = await ask(session.id, "第三个任务给陈林")
    expect(after.memory.constraints.assignmentOverrides[after.memory.options[0].tasks[2].key]).toBe("m3")
    expect(after.memory.options[0].tasks[2].assigneeId).toBe("m3")
    expect(after.memory.options[0].tasks.slice(0, 2)).toEqual(locked)
    expect(new Set(after.memory.options[0].tasks.map((task) => task.assigneeId)).size).toBe(3)
  })

  it("corrects the false premise, preserves duration, and confirms the current plan", async () => {
    const { session } = planning()
    await ask(session.id, "#US030 两个人并行拆，不需要 Subtask")
    const three = await ask(session.id, "最多三天")
    const duration = three.memory.options[0].estimatedDurationDays
    expect(three.answer.content).toContain(`${duration} 个工作日`)
    const corrected = await ask(session.id, "三天应该做不完吧？")
    expect(corrected.answer.content).toContain("3 天的工期上限可以满足")
    const five = await ask(session.id, "那最多五天")
    expect(five.memory.options[0].estimatedDurationDays).toBe(duration)
    expect(five.answer.content).toContain(`${duration} 个工作日`)
    const selected = await ask(session.id, "选最终方案")
    expect(selected.answer.content).toContain("已选择方案 A")
  })

  it("does not let LLM route a false duration premise away from deterministic correction", async () => {
    const { session } = planning()
    await ask(session.id, "#US030 两个人并行拆")
    const store = useProjectStore.getState()
    const input = "三天应该做不完吧？"
    store.addMeetingMessage(session.id, { senderType: "user", senderId: "m1", content: input })
    const onlineHint: MeetingLlm = { interpret: async () => ({ intent: "risk" }), explain: async () => null }
    const result = await coordinateMeetingTurn(useProjectStore.getState(), useProjectStore.getState().meetingSessions[session.id], "auto", input, onlineHint)
    expect(result.resolvedIntent).toBe("plan")
    expect(result.answer.content).toContain("3 天的工期上限可以满足")
  })

  it("blocks reviewed owner edits that break three-person planning, then applies valid partial review", async () => {
    const { session } = planning()
    await ask(session.id, "#US030 两个人并行拆，不需要 Subtask")
    await ask(session.id, "李娜只能做测试")
    await ask(session.id, "改成三个人")
    await ask(session.id, "前两个任务不要动")
    await ask(session.id, "第三个任务给陈林")
    await ask(session.id, "最多五天")
    await ask(session.id, "选最终方案")
    const result = await ask(session.id, "@计划落地 整理项目行动")
    const proposal = result.answer.proposal!
    expect(proposal).toBeTruthy()
    const store = useProjectStore.getState()
    expect(store.saveProposal(proposal).ok).toBe(true)
    expect(store.linkMeetingProposal(session.id, proposal.id).ok).toBe(true)
    const testTask = proposal.actions.find((action) => action.actionType === "CREATE_TASK" && action.proposedValue.type === "test")!
    const dependency = proposal.actions.find((action) => action.actionType === "ADD_DEPENDENCY")!
    for (const action of proposal.actions) store.setProposalDecision(proposal.id, action.id, action.id === dependency.id ? "rejected" : "accepted")
    store.updateProposalValue(proposal.id, testTask.id, { ...testTask.proposedValue, assigneeId: "m1" })
    expect(store.applyProposal(proposal.id).ok).toBe(false)
    expect(useProjectStore.getState().proposals[proposal.id].status).toBe("reviewed")
    store.updateProposalValue(proposal.id, testTask.id, { ...testTask.proposedValue, assigneeId: "m4" })
    const applied = store.applyProposal(proposal.id)
    expect(applied.ok).toBe(true)
    expect(applied.message).toContain("按你的决定未执行")
    expect(useProjectStore.getState().proposals[proposal.id].status).toBe("applied")
  })
})
