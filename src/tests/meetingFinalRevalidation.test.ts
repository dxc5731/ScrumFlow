import { usePlanningFixtureClock } from "./planningFixtureClock"

import { beforeEach, describe, expect, it } from "vitest"
import { revalidateReviewedProposal } from "../agents/meetingFinalRevalidation"
import { buildExecutionSummary, describeExecutionForChat } from "../agents/meetingExecutionSummary"
import { memoryFor } from "../agents/meetingContext"
import { createPlanOptions, proposalFromOption } from "../agents/meetingPlanning"
import { buildProjectAnalysisSnapshot, buildProjectAnalysisSnapshotForScope } from "../agents/meetingSnapshot"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"

usePlanningFixtureClock()

describe("reviewed meeting plan", () => {
  beforeEach(() => resetProjectStoreForTests())

  function prepared() {
    const store = useProjectStore.getState()
    const meeting = store.createMeeting("story", "us030")
    const memory = memoryFor(meeting)
    memory.constraints.allowSubtasks = false
    memory.options = createPlanOptions(store, meeting, memory)
    memory.activePlanId = "A"
    store.setMeetingMemory(meeting.id, memory)
    const latest = useProjectStore.getState()
    const proposal = proposalFromOption(latest, latest.meetingSessions[meeting.id], memory.options[0])!
    expect(proposal).toBeTruthy()
    latest.saveProposal(proposal)
    latest.linkMeetingProposal(meeting.id, proposal.id)
    for (const action of proposal.actions) latest.setProposalDecision(proposal.id, action.id, "accepted")
    return { meetingId: meeting.id, proposalId: proposal.id }
  }

  it("recomputes accepted dependency count and schedule after review", () => {
    const { meetingId, proposalId } = prepared()
    const store = useProjectStore.getState()
    const dependency = store.proposals[proposalId].actions.find((action) => action.actionType === "ADD_DEPENDENCY")
    expect(dependency).toBeTruthy()
    const before = revalidateReviewedProposal(store, store.proposals[proposalId], store.meetingSessions[meetingId])
    store.setProposalDecision(proposalId, dependency!.id, "rejected")
    const current = useProjectStore.getState()
    const after = revalidateReviewedProposal(current, current.proposals[proposalId], current.meetingSessions[meetingId])
    expect(after.businessSummary.addedDependencies).toBe(before.businessSummary.addedDependencies - 1)
    expect(after.estimatedDuration).toBeLessThanOrEqual(before.estimatedDuration)
    expect(after.warnings.some((warning) => warning.includes("建议依赖"))).toBe(true)
  })

  it("builds the same focused facts for a meeting and a non-meeting trigger", () => {
    const store = useProjectStore.getState()
    const meeting = store.createMeeting("story", "us030")
    const memory = memoryFor(meeting)
    const fromMeeting = buildProjectAnalysisSnapshot(store, meeting, memory)
    const fromEvent = buildProjectAnalysisSnapshotForScope(store, {
      projectId: store.project.id, scopeId: "event-us030", targetType: "story", targetId: "us030",
    })
    expect(fromEvent.focusedStory).toEqual(fromMeeting.focusedStory)
    expect(fromEvent.focusedSprint).toEqual(fromMeeting.focusedSprint)
    expect(fromEvent.members).toEqual(fromMeeting.members)
  })

  it("blocks a reviewed assignee that violates the meeting role constraint", () => {
    const { meetingId, proposalId } = prepared()
    const store = useProjectStore.getState()
    const memory = structuredClone(store.meetingSessions[meetingId].memory!)
    memory.constraints.testOnlyMemberIds = ["m2"]
    store.setMeetingMemory(meetingId, memory)
    const backend = store.proposals[proposalId].actions.find((action) => action.actionType === "CREATE_TASK" && action.proposedValue.type !== "test")!
    expect(store.updateProposalValue(proposalId, backend.id, { ...backend.proposedValue, assigneeId: "m2" }).ok).toBe(true)
    const latest = useProjectStore.getState()
    const reviewed = revalidateReviewedProposal(latest, latest.proposals[proposalId], latest.meetingSessions[meetingId])
    expect(reviewed.valid).toBe(false)
    expect(reviewed.constraintViolations.some((item) => item.type === "memberRole")).toBe(true)
    expect(latest.applyProposal(proposalId).ok).toBe(false)
    expect(latest.history.some((item) => item.proposalId === proposalId)).toBe(false)
  })

  it("builds execution details only from applied actions with matching history", () => {
    const { meetingId, proposalId } = prepared()
    const store = useProjectStore.getState()
    const dependency = store.proposals[proposalId].actions.find((action) => action.actionType === "ADD_DEPENDENCY")!
    store.setProposalDecision(proposalId, dependency.id, "rejected")
    const outcome = useProjectStore.getState().applyProposal(proposalId)
    expect(outcome.ok).toBe(true)
    const latest = useProjectStore.getState()
    const summary = buildExecutionSummary(latest, [latest.proposals[proposalId]])
    expect(summary.notExecuted).toHaveLength(1)
    expect(summary.notExecuted[0]).toContain("用户拒绝")
    expect(describeExecutionForChat(summary)).toContain("1 条建议依赖按你的决定未执行")
    expect(describeExecutionForChat(summary)).not.toContain("负责人：")
    expect(summary.applied.length).toBeGreaterThan(0)
    expect(summary.discrepancies).toHaveLength(0)
    expect(latest.meetingSessions[meetingId].proposalIds).toContain(proposalId)
  })

  it("counts separate reviewed actions with the same assignee transition", () => {
    const { proposalId } = prepared()
    const source = useProjectStore.getState()
    const state = { ...source, proposals: structuredClone(source.proposals), history: structuredClone(source.history),
      tasks: structuredClone(source.tasks), subtasks: structuredClone(source.subtasks) }
    const proposal = state.proposals[proposalId]
    const taskActions = proposal.actions.filter(action => action.actionType === "CREATE_TASK").slice(0, 2)
    expect(taskActions).toHaveLength(2)
    for (const [index, action] of taskActions.entries()) {
      const original = proposal.originalActions.find(item => item.id === action.id)!
      original.proposedValue.assigneeId = "m2"
      action.proposedValue.assigneeId = "m1"
      action.status = "applied"
      action.resultTargetId = `reviewed-task-${index}`
      const template = Object.values(state.tasks)[0]
      state.tasks[action.resultTargetId] = { ...template, id: action.resultTargetId, title: `审核任务${index + 1}`, assigneeId: "m1" }
      state.history.push({ id: `reviewed-history-${index}`, createdAt: new Date().toISOString(), actorId: "m1", objectType: "task", objectId: action.resultTargetId, field: "assigneeId", before: "m2", after: "m1", source: "agent", proposalId, proposalActionId: action.id })
    }
    const summary = buildExecutionSummary(state, [proposal])
    expect(summary.reviewedChanges).toHaveLength(2)
    expect(summary.reviewedChanges[0]).toContain("审核任务1")
    expect(summary.reviewedChanges[1]).toContain("审核任务2")
    expect(describeExecutionForChat(summary)).toContain("2 项人工调整")
  })
})
