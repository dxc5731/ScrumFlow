import { beforeEach, describe, expect, it } from "vitest"
import { dependencyImpact, workloadComparison } from "../agents/meetingAnalysis"
import { memoryFor, understandMeetingTurn } from "../agents/meetingContext"
import { coordinateMeetingTurn } from "../agents/meetingDecision"
import type { MeetingLlm } from "../agents/meetingLlm"
import { createPlanOptions, proposalFromOption } from "../agents/meetingPlanning"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"

const unavailable: MeetingLlm = {
  interpret: async () => { throw new Error("offline") },
  explain: async () => { throw new Error("offline") },
}

function setup() {
  const store = useProjectStore.getState()
  const story = store.createStory({ title: "会议排期", source: "manual", storyPoints: 6 })
  const session = store.createMeeting("story", story.id)
  return { story, session }
}

async function turn(meetingId: string, question: string, agent: "auto" | "task_decomposition" | "plan_execution" = "auto") {
  const store = useProjectStore.getState()
  const session = store.meetingSessions[meetingId]
  store.addMeetingMessage(meetingId, { senderType: "user", senderId: "m1", content: question })
  const result = await coordinateMeetingTurn(useProjectStore.getState(), session, agent, question, unavailable)
  store.setMeetingMemory(meetingId, result.memory)
  store.addMeetingMessage(meetingId, { senderType: "agent", senderId: result.answer.agentType, content: result.answer.content })
  return result
}

describe("continuous meeting decisions", () => {
  beforeEach(() => resetProjectStoreForTests())

  it("answers an existing-task status request even when the LLM hints at planning", async () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("project", store.project.id)
    await turn(session.id, "@AI #US024 为什么推进慢？")
    const question = "#US024 帮我展示他的下级任务和完成的情况"
    let interpreted = 0
    const misleadingLlm: MeetingLlm = {
      interpret: async () => { interpreted++; return { intent: "plan" } },
      explain: async () => null,
    }
    const current = useProjectStore.getState()
    current.addMeetingMessage(session.id, { senderType: "user", senderId: "m1", content: question })
    const result = await coordinateMeetingTurn(useProjectStore.getState(), useProjectStore.getState().meetingSessions[session.id], "auto", question, misleadingLlm)
    expect(interpreted).toBe(1)
    // Interpretation succeeded, but no model answer was available: report the fallback honestly.
    expect(result.llmFallback).toBe(true)
    expect(result.llmReplyUsed).toBe(false)
    expect(result.resolvedIntent).toBe("other")
    expect(result.completedAgents).toEqual(["project_orchestrator"])
    expect(result.answer.content).toContain("US024")
    expect(result.answer.content).toContain("5 个任务，1 个已完成")
    expect(result.answer.content).toContain("FE-024-1")
    expect(result.answer.content).toContain("下级步骤 1/2 已完成")
    expect(result.answer.content).not.toContain("回复“选 A/B/C”")

    const planning = await coordinateMeetingTurn(useProjectStore.getState(), useProjectStore.getState().meetingSessions[session.id], "auto", "#US024 重新拆解任务", unavailable)
    expect(planning.answer.content).toContain("回复“选 A/B/C”")
  })

  it("uses a generated task-status reply when it preserves every project task", async () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("project", store.project.id)
    const question = "#US024 帮我展示他的下级任务和完成的情况"
    const generated = `US024 现有 5 个任务，1 个已完成。${store.stories.us024.taskIds.map((id) => id.toUpperCase()).join("、")} 的状态已逐项核对。`
    let explainCalls = 0
    const online: MeetingLlm = {
      interpret: async () => ({ intent: "diagnose" }),
      explain: async () => { explainCalls++; return generated },
    }
    const result = await coordinateMeetingTurn(store, session, "auto", question, online)
    expect(explainCalls).toBe(1)
    expect(result.llmReplyUsed).toBe(true)
    expect(result.answer.content).toBe(generated)
  })

  it("retains changing constraints and never assigns excluded members", async () => {
    const { session } = setup()
    await turn(session.id, "这个 Story 按三个人并行拆", "task_decomposition")
    const first = memoryFor(useProjectStore.getState().meetingSessions[session.id])
    expect(first.options[0].tasks.length).toBeGreaterThan(1)
    expect(new Set(first.options[0].tasks.map((task) => task.assigneeId)).size).toBe(3)
    const excluded = useProjectStore.getState().members.m3.name
    await turn(session.id, `${excluded}不能参与，工期压到三天`)
    const second = memoryFor(useProjectStore.getState().meetingSessions[session.id])
    expect(second.constraints.excludedMemberIds).toContain("m3")
    expect(second.options.every((option) => option.tasks.every((task) => task.assigneeId !== "m3"))).toBe(true)
    await turn(session.id, "那按两个人做，尽量少改原有任务")
    const third = memoryFor(useProjectStore.getState().meetingSessions[session.id])
    expect(third.constraints).toMatchObject({ maxPeople: 2, maxDays: 3, preserveExisting: true })
    expect(third.constraints.excludedMemberIds).toContain("m3")
  })

  it("resolves ordinal and selected plan references inside the meeting", async () => {
    const { session } = setup()
    await turn(session.id, "拆一下这个 Story", "task_decomposition")
    const state = useProjectStore.getState()
    const current = state.meetingSessions[session.id]
    const tasks = memoryFor(current).options[0].tasks
    expect(understandMeetingTurn(state, current, "第二个任务给谁").referencedTaskKeys).toEqual([tasks[1].key])
    expect(understandMeetingTurn(state, current, "前两个保留").referencedTaskKeys).toEqual(tasks.slice(0, 2).map((task) => task.key))
    expect(understandMeetingTurn(state, current, "选方案 A").selectedOptionId).toBe("A")
    expect(understandMeetingTurn(state, current, "最后一个不要").constraints.removedTaskKeys).toContain(tasks.at(-1)!.key)
  })

  it("reassigns the referenced second task without restarting the plan", async () => {
    const { session } = setup()
    await turn(session.id, "按前后端并行拆", "task_decomposition")
    const before = memoryFor(useProjectStore.getState().meetingSessions[session.id])
    expect(before.options[0].tasks.some((task) => task.type === "frontend")).toBe(true)
    const key = before.options[0].tasks[1].key
    await turn(session.id, "第二个任务换成李娜负责")
    const after = memoryFor(useProjectStore.getState().meetingSessions[session.id])
    expect(after.constraints.frontendBackend).toBe(true)
    expect(after.constraints.assignmentOverrides[key]).toBe("m2")
    expect(after.options[0].tasks.find((task) => task.key === key)?.assigneeId).toBe("m2")
  })

  it("reuses existing tasks and reports infeasible deadlines", async () => {
    const { story, session } = setup()
    useProjectStore.getState().createTask(story.id, { title: "资料与输入准备：会议排期", estimate: 32 })
    await turn(session.id, "按两个人拆，工期最多一天", "task_decomposition")
    const memory = memoryFor(useProjectStore.getState().meetingSessions[session.id])
    expect(memory.options[0].tasks.filter((task) => task.title === "资料与输入准备：会议排期")).toHaveLength(1)
    expect(memory.options[0].feasible).toBe(false)
    expect(memory.options[0].infeasibleReasons.join(" ")).toContain("超过 1 天限制")
  })

  it("propagates delays through direct and indirect dependencies", () => {
    const { story, session } = setup()
    const store = useProjectStore.getState()
    const a = store.createTask(story.id, { title: "接口", endDate: "2026-10-01" })
    const b = store.createTask(story.id, { title: "实现", endDate: "2026-10-02" })
    const c = store.createTask(story.id, { title: "验收", endDate: "2026-10-05" })
    store.addDependency(a.id, b.id)
    store.addDependency(b.id, c.id)
    const state = useProjectStore.getState()
    const finding = dependencyImpact(state, state.meetingSessions[session.id], memoryFor(state.meetingSessions[session.id]), a.id, 2)
    expect(finding.content).toContain("2 项后续工作")
    expect(finding.content).toContain("接口 → 实现 → 验收")
    expect(finding.evidence.join(" ")).toContain("实现、验收")
  })

  it("compares workload options using actual members and estimates", () => {
    const { session } = setup()
    const state = useProjectStore.getState()
    const options = createPlanOptions(state, state.meetingSessions[session.id], memoryFor(state.meetingSessions[session.id]))
    const finding = workloadComparison(state, state.meetingSessions[session.id], options)
    expect(options).toHaveLength(2)
    expect(finding.content).toContain("方案 A")
    expect(finding.content).toMatch(/方案 B|没有必要分成两套方案/)
    expect(finding.evidence.join(" ")).toContain(state.members.m1.name)
  })

  it("turns the selected discussion plan into the existing audited executor path", async () => {
    const { story, session } = setup()
    await turn(session.id, "按三个人并行拆", "task_decomposition")
    await turn(session.id, "选方案 B")
    const execution = await turn(session.id, "按刚才的方案执行", "plan_execution")
    const proposal = execution.answer.proposal!
    expect(proposal).toBeTruthy()
    expect(proposal.originalActions).toEqual(proposal.actions)
    const store = useProjectStore.getState()
    expect(store.saveProposal(proposal).ok).toBe(true)
    expect(store.linkMeetingProposal(session.id, proposal.id).ok).toBe(true)
    const creations = proposal.actions.filter((action) => action.actionType === "CREATE_TASK")
    expect(creations.length).toBeGreaterThan(1)
    for (const action of proposal.actions) store.setProposalDecision(proposal.id, action.id, "accepted")
    store.applyProposal(proposal.id)
    const after = useProjectStore.getState()
    expect(after.proposals[proposal.id].actions.filter((action) => action.actionType === "CREATE_TASK").every((action) => action.status === "applied")).toBe(true)
    expect(after.stories[story.id].taskIds.length).toBe(creations.length)
    expect(after.history.some((entry) => entry.proposalId === proposal.id && entry.source === "agent")).toBe(true)
    expect(after.meetingSessions[session.id].proposalIds).toContain(proposal.id)
  })

  it("marks a changed Story stale before any planned task is created", async () => {
    const { story, session } = setup()
    await turn(session.id, "拆成三个工作项", "task_decomposition")
    const proposal = (await turn(session.id, "按这个方案执行", "plan_execution")).answer.proposal!
    const store = useProjectStore.getState()
    store.saveProposal(proposal)
    for (const action of proposal.actions) store.setProposalDecision(proposal.id, action.id, "accepted")
    store.createTask(story.id, { title: "人工插入的工作" })
    store.applyProposal(proposal.id)
    const after = useProjectStore.getState()
    expect(after.proposals[proposal.id].actions.filter((action) => action.actionType === "CREATE_TASK").every((action) => action.status === "stale")).toBe(true)
    expect(after.stories[story.id].taskIds).toHaveLength(1)
  })

  it("uses message history for the execution decision and avoids duplicate pending proposals", async () => {
    const { session } = setup()
    await turn(session.id, "按三个人并行拆", "task_decomposition")
    const first = await turn(session.id, "按方案 A 执行", "plan_execution")
    expect(first.answer.evidence.join(" ")).toContain("按三个人并行拆")
    const proposal = first.answer.proposal!
    const store = useProjectStore.getState()
    store.saveProposal(proposal)
    store.linkMeetingProposal(session.id, proposal.id)
    const again = await turn(session.id, "按方案 A 执行", "plan_execution")
    expect(again.answer.proposal).toBeUndefined()
    expect(again.answer.content).toContain("已有待审核行动")
  })

  it("coordinates diagnosis, owner what-if, selection, and execution across turns", async () => {
    const { story, session } = setup()
    const store = useProjectStore.getState()
    const firstTask = store.createTask(story.id, { title: "前置接口", assigneeId: "m1", status: "blocked", estimate: 8 })
    const secondTask = store.createTask(story.id, { title: "页面联调", assigneeId: "m1", estimate: 6 })
    store.addDependency(firstTask.id, secondTask.id)
    const diagnosis = await turn(session.id, "为什么这个 Story 推进不动？")
    expect(diagnosis.completedAgents).toEqual(["risk_dependency", "workload_capacity"])
    expect(diagnosis.answer.agentType).toBe("project_orchestrator")
    expect(diagnosis.answer.content).toContain("前置接口 → 页面联调")
    const adjustment = await turn(session.id, "如果第一个任务换成李娜呢？")
    expect(adjustment.memory.constraints.assignmentOverrides[firstTask.id]).toBe("m2")
    expect(adjustment.memory.options[0].tasks.find((task) => task.key === firstTask.id)?.assigneeId).toBe("m2")
    const selection = await turn(session.id, "选方案 A")
    expect(selection.memory.activePlanId).toBe("A")
    const execution = await turn(session.id, "按刚才方案执行", "plan_execution")
    expect(execution.answer.proposal?.actions.some((action) => action.actionType === "UPDATE_TASK" && action.targetId === firstTask.id)).toBe(true)
  })

  it("does not invent a feasible execution for a closed Sprint", async () => {
    const state = useProjectStore.getState()
    const story = Object.values(state.stories).find((item) => item.sprintId && state.sprints[item.sprintId]?.status === "closed")
    expect(story).toBeTruthy()
    const session = state.createMeeting("story", story!.id)
    await turn(session.id, "拆一下这个 Story", "task_decomposition")
    const execution = await turn(session.id, "按这个方案执行", "plan_execution")
    expect(execution.answer.proposal).toBeUndefined()
    expect(execution.answer.content).toContain("还不能")
  })

  it("falls back when the LLM fails and rejects a fabricated owner", async () => {
    const { session } = setup()
    const result = await turn(session.id, "这个 Story 拆一下", "task_decomposition")
    expect(result.answer.content).toContain("工作项")
    const state = useProjectStore.getState()
    const fakeLlm: MeetingLlm = {
      interpret: async () => ({ memberName: "不存在的人", intent: "plan" }),
      explain: async () => null,
    }
    const another = await coordinateMeetingTurn(state, state.meetingSessions[session.id], "task_decomposition", "重新拆一下", fakeLlm)
    expect(another.answer.content).not.toContain("不存在的人")
    expect(another.memory.options.every((option) => option.tasks.every((task) => Boolean(state.members[task.assigneeId])))).toBe(true)
    expect(proposalFromOption(state, state.meetingSessions[session.id], another.memory.options[0])?.actions.length).toBeGreaterThan(0)
  })
})
