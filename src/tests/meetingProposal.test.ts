import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { runPlanningMeeting } from "../agents/meeting"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"
import { selectStoryTasks, selectTaskSubtasks } from "../store/selectors"
import { buildExecutionSummary } from "../agents/meetingExecutionSummary"

function prepareStory() {
  const store = useProjectStore.getState()
  const story = store.createStory({ title: "会议规划测试 Story", source: "manual", storyPoints: 4 })
  store.addAcceptanceCriterion(story.id, "实现用户列表页面")
  store.addAcceptanceCriterion(story.id, "验证用户列表查询")
  const meeting = runPlanningMeeting(useProjectStore.getState(), "story", story.id)
  expect(store.saveProposal(meeting.proposal).ok).toBe(true)
  return { storyId: story.id, proposalId: meeting.proposal.id, meeting }
}

function acceptAll(proposalId: string) {
  const store = useProjectStore.getState()
  for (const action of store.proposals[proposalId].actions) {
    expect(store.setProposalDecision(proposalId, action.id, "accepted").ok).toBe(true)
  }
}

describe("planning meeting proposal lifecycle", () => {
  beforeEach(() => resetProjectStoreForTests())
  afterEach(() => vi.useRealTimers())

  it("generates structured Task/Subtask suggestions and applies them through the project model", () => {
    const { storyId, proposalId, meeting } = prepareStory()
    expect(meeting.stages.map((stage) => stage.agentType)).toEqual([
      "project_orchestrator", "task_decomposition", "risk_dependency",
      "workload_capacity", "project_orchestrator",
    ])
    expect(meeting.proposal.actions.filter((action) => action.actionType === "CREATE_TASK")).toHaveLength(2)
    expect(meeting.proposal.actions.filter((action) => action.actionType === "CREATE_SUBTASK")).toHaveLength(4)
    expect(selectStoryTasks(useProjectStore.getState(), storyId)).toHaveLength(0)
    acceptAll(proposalId)
    expect(useProjectStore.getState().applyProposal(proposalId).ok).toBe(true)
    const after = useProjectStore.getState()
    expect(after.proposals[proposalId].status).toBe("applied")
    const tasks = selectStoryTasks(after, storyId)
    expect(tasks).toHaveLength(2)
    expect(tasks.every((task) => selectTaskSubtasks(after, task.id).length === 2)).toBe(true)
    expect(after.proposals[proposalId].actions.every((action) => action.status === "applied" && action.resultTargetId)).toBe(true)
    const linked = after.history.filter((entry) => entry.proposalId === proposalId)
    expect(linked.length).toBeGreaterThanOrEqual(6)
    expect(linked.every((entry) => entry.source === "agent" && entry.proposalActionId)).toBe(true)
  })

  it("keeps original AI output after human edits and executes only accepted actions", () => {
    const { storyId, proposalId } = prepareStory()
    const store = useProjectStore.getState()
    const first = store.proposals[proposalId].actions[0]
    const changed = { ...first.proposedValue, title: "人工调整后的任务" }
    expect(store.updateProposalValue(proposalId, first.id, changed).ok).toBe(true)
    expect(useProjectStore.getState().proposals[proposalId].originalActions[0].proposedValue.title).not.toBe(changed.title)
    expect(store.setProposalDecision(proposalId, first.id, "accepted").ok).toBe(true)
    for (const action of store.proposals[proposalId].actions.slice(1)) store.setProposalDecision(proposalId, action.id, "rejected")
    expect(store.applyProposal(proposalId).ok).toBe(true)
    const after = useProjectStore.getState()
    expect(after.proposals[proposalId].status).toBe("applied")
    expect(selectStoryTasks(after, storyId).map((task) => task.title)).toEqual(["人工调整后的任务"])
    expect(Object.values(after.subtasks).filter((item) => item.taskId === after.proposals[proposalId].actions[0].resultTargetId)).toHaveLength(0)
  })

  it("does not create a child when its parent Action was rejected", () => {
    const { storyId, proposalId } = prepareStory()
    const store = useProjectStore.getState()
    const child = store.proposals[proposalId].actions.find((item) => item.actionType === "CREATE_SUBTASK")!
    store.setProposalDecision(proposalId, child.id, "accepted")
    store.setProposalDecision(proposalId, child.dependsOnActionIds[0], "rejected")
    store.applyProposal(proposalId)
    const after = useProjectStore.getState()
    expect(after.proposals[proposalId].actions.find((item) => item.id === child.id)).toMatchObject({ status: "failed" })
    expect(selectStoryTasks(after, storyId)).toHaveLength(0)
    expect(after.history.some((item) => item.proposalId === proposalId)).toBe(false)
  })

  it("rejects a complete proposal without changing project entities or ChangeHistory", () => {
    const { storyId, proposalId } = prepareStory()
    const before = useProjectStore.getState()
    const historyLength = before.history.length
    expect(before.rejectProposal(proposalId, "本轮暂不执行").ok).toBe(true)
    const after = useProjectStore.getState()
    expect(after.proposals[proposalId].status).toBe("rejected")
    expect(selectStoryTasks(after, storyId)).toHaveLength(0)
    expect(after.history).toHaveLength(historyLength)
  })

  it("distinguishes withdrawn work from suggestions that were never applied", () => {
    const { proposalId } = prepareStory()
    acceptAll(proposalId)
    expect(useProjectStore.getState().applyProposal(proposalId).ok).toBe(true)
    const proposal = useProjectStore.getState().proposals[proposalId]
    const child = proposal.actions.find(action => action.actionType === "CREATE_SUBTASK")!
    expect(useProjectStore.getState().deleteSubtask(child.resultTargetId!).ok).toBe(true)
    const reviewed = { ...proposal, actions: proposal.actions.map(action => action.id === child.id ? { ...action, decision: "rejected" as const } : action) }
    const summary = buildExecutionSummary(useProjectStore.getState(), [reviewed])
    expect(summary.notExecuted[0]).toContain("曾写入项目，后经撤回")
    expect(summary.notExecuted[0]).not.toContain("未写入项目")
  })

  it("marks changed source data stale and does not overwrite it", () => {
    const { storyId, proposalId } = prepareStory()
    acceptAll(proposalId)
    expect(useProjectStore.getState().updateStory(storyId, { title: "人工更新 Story" }).ok).toBe(true)
    expect(useProjectStore.getState().applyProposal(proposalId).ok).toBe(false)
    const after = useProjectStore.getState()
    expect(after.proposals[proposalId].actions.filter((action) => action.actionType === "CREATE_TASK").every((action) => action.status === "stale")).toBe(true)
    expect(after.proposals[proposalId].actions.filter((action) => action.actionType === "CREATE_SUBTASK").every((action) => action.status === "failed" && action.error?.includes("依赖"))).toBe(true)
    expect(after.stories[storyId].title).toBe("人工更新 Story")
    expect(selectStoryTasks(after, storyId)).toHaveLength(0)
  })

  it("detects edited acceptance criterion content even when its id is unchanged", () => {
    const { storyId, proposalId } = prepareStory()
    acceptAll(proposalId)
    const criterionId = useProjectStore.getState().stories[storyId].acceptanceCriteriaIds[0]
    useProjectStore.getState().updateAcceptanceCriterion(criterionId, { content: "人工重新定义验收标准" })
    useProjectStore.getState().applyProposal(proposalId)
    const after = useProjectStore.getState()
    expect(after.proposals[proposalId].actions[0].status).toBe("stale")
    expect(selectStoryTasks(after, storyId)).toHaveLength(0)
  })

  it("audits one failed Action alongside successful ones", () => {
    const { storyId, meeting } = prepareStory()
    const bad = structuredClone(meeting.proposal)
    bad.id = "proposal-partial-failure"
    bad.actions[0].proposedValue.assigneeId = "missing-member"
    useProjectStore.getState().saveProposal(bad)
    acceptAll(bad.id)
    expect(useProjectStore.getState().applyProposal(bad.id).ok).toBe(false)
    const after = useProjectStore.getState()
    expect(after.proposals[bad.id].status).toBe("partially_applied")
    expect(after.proposals[bad.id].actions[0]).toMatchObject({ status: "failed", error: "负责人不存在" })
    expect(after.proposals[bad.id].actions[1].status).toBe("failed")
    expect(selectStoryTasks(after, storyId)).toHaveLength(1)
    expect(after.history.some((entry) => entry.proposalId === bad.id && entry.proposalActionId === bad.actions[3].id)).toBe(true)
    expect(after.history.some((entry) => entry.proposalActionId === bad.actions[0].id)).toBe(false)
  })

  it("resolves a proposed dependency between new Tasks and applies a Risk in the same meeting", () => {
    const store = useProjectStore.getState()
    const story = store.createStory({ title: "高风险依赖 Story", source: "manual", risk: "high" })
    store.addAcceptanceCriterion(story.id, "完成接口设计")
    store.addAcceptanceCriterion(story.id, "接口设计完成后验证调用")
    const { proposal } = runPlanningMeeting(useProjectStore.getState(), "story", story.id)
    expect(proposal.actions.some((item) => item.actionType === "ADD_DEPENDENCY")).toBe(true)
    expect(proposal.actions.some((item) => item.actionType === "CREATE_RISK")).toBe(true)
    proposal.actions.reverse()
    store.saveProposal(proposal)
    acceptAll(proposal.id)
    expect(store.applyProposal(proposal.id).ok).toBe(true)
    const after = useProjectStore.getState()
    const dependencyAction = after.proposals[proposal.id].actions.find((item) => item.actionType === "ADD_DEPENDENCY")!
    const sourceId = after.proposals[proposal.id].actions.find((item) => item.id === dependencyAction.proposedValue.sourceTaskId)?.resultTargetId
    const targetId = after.proposals[proposal.id].actions.find((item) => item.id === dependencyAction.proposedValue.targetTaskId)?.resultTargetId
    const dependency = Object.values(after.dependencies).find((item) => item.sourceTaskId === sourceId && item.targetTaskId === targetId)
    expect(dependency).toBeDefined()
    expect(Object.values(after.risks).some((risk) => risk.targetId === story.id && risk.title.includes("交付风险"))).toBe(true)
    expect(after.proposals[proposal.id].actions.every((item) => item.status === "applied")).toBe(true)
  })

  it("uses the Sprint date range to suggest a capacity based reassignment", () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-01T10:00:00+08:00"))
    const store = useProjectStore.getState()
    const sprint = store.createSprint({ name: "短 Sprint", goal: "交付两项任务", startDate: "2026-10-01", endDate: "2026-10-02", capacity: 8 })
    const story = store.createStory({ title: "成员负载 Story", source: "manual", sprintId: sprint.id, startDate: sprint.startDate, dueDate: sprint.endDate })
    store.createTask(story.id, { title: "任务 A", assigneeId: "m1", estimate: 10 })
    store.createTask(story.id, { title: "任务 B", assigneeId: "m1", estimate: 10 })
    const { proposal } = runPlanningMeeting(useProjectStore.getState(), "sprint", sprint.id)
    expect(proposal.evidence.some((item) => item.agentType === "workload_capacity" && item.targetId === "m1" && item.detail.includes("16h"))).toBe(true)
    const reassignment = proposal.actions.find((item) => item.actionType === "UPDATE_TASK")
    expect(reassignment?.proposedValue.assigneeId).not.toBe("m1")
    store.saveProposal(proposal)
    acceptAll(proposal.id)
    expect(store.applyProposal(proposal.id).ok).toBe(true)
    expect(useProjectStore.getState().tasks[reassignment!.targetId].assigneeId).toBe(reassignment!.proposedValue.assigneeId)
  })

  it("raises an existing Risk when the Story deadline exceeds its Sprint", () => {
    const store = useProjectStore.getState()
    const sprint = store.createSprint({ name: "风险 Sprint", goal: "交付", startDate: "2026-10-01", endDate: "2026-10-02", capacity: 8 })
    const story = store.createStory({ title: "延期 Story", source: "manual", sprintId: sprint.id, startDate: sprint.startDate, dueDate: "2026-10-05" })
    const risk = store.createRisk({ title: "原有风险", targetType: "story", targetId: story.id, level: "medium", description: "待观察", impact: "", mitigation: "", ownerId: "m1", status: "open" })
    const { proposal } = runPlanningMeeting(useProjectStore.getState(), "story", story.id)
    const update = proposal.actions.find((item) => item.actionType === "UPDATE_RISK")
    expect(update?.targetId).toBe(risk.id)
    store.saveProposal(proposal)
    store.setProposalDecision(proposal.id, update!.id, "accepted")
    store.applyProposal(proposal.id)
    const after = useProjectStore.getState()
    expect(after.risks[risk.id].level).toBe("high")
    expect(after.history.some((item) => item.proposalId === proposal.id && item.proposalActionId === update!.id && item.objectType === "risk")).toBe(true)
  })

  it("migrates a version 13 project without replacing edited Story and Epic content", () => {
    const old = JSON.parse(useProjectStore.getState().exportProjectJson())
    old.schemaVersion = 13
    old.stories.us024.title = "用户修改的 Story"
    old.epics.ep9.title = "用户修改的 Epic"
    delete old.proposals
    expect(useProjectStore.getState().importProjectJson(JSON.stringify(old)).ok).toBe(true)
    const after = useProjectStore.getState()
    expect(after.stories.us024.title).toBe("用户修改的 Story")
    expect(after.epics.ep9.title).toBe("用户修改的 Epic")
    expect(after.proposals).toEqual({})
  })
})
