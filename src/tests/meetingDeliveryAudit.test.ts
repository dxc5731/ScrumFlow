import { beforeEach, describe, expect, it } from "vitest"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"
import { meetingBlockerProposalInput } from "../agents/meetingManagement"
import { meetingInsights, meetingOutcomeState } from "../agents/meetingOutcomes"
import { readableMeeting } from "../agents/meetingPresentation"
import { generateMeetingMinutes } from "../agents/meetingMinutes"
import { buildExecutionSummary } from "../agents/meetingExecutionSummary"

const store = () => useProjectStore.getState()
const create = () => store().createMeeting("project", store().project.id, { meetingType: "daily", sprintId: "s2", voiceEnabled: false })
function draft() {
  const session = create()
  const p = store().createProposal(meetingBlockerProposalInput(store(), session, "fe-025-1")!)
  store().linkMeetingProposal(session.id, p.id)
  return { session, p }
}

describe("delivery audit: consistent evidence across minutes and insights", () => {
  beforeEach(() => resetProjectStoreForTests())

  it("does not count a legacy applied marker without audit as an executed outcome", () => {
    const { session, p } = draft()
    useProjectStore.setState(s => ({ proposals: { ...s.proposals, [p.id]: { ...s.proposals[p.id],
      actions: p.actions.map(a => ({ ...a, decision: "accepted" as const, status: "applied" as const })) } } }))
    expect(meetingInsights(store(), store().meetingSessions[session.id]).counts.executed).toBe(0)
    expect(readableMeeting(store(), store().meetingSessions[session.id]).applied).toBe(0)
    expect(generateMeetingMinutes(store(), store().meetingSessions[session.id]).actions[0].status).toContain("证据待核实")
  })

  it("keeps a reused result separate from a new executed write in every minutes view", () => {
    const { session, p } = draft()
    useProjectStore.setState(s => ({ proposals: { ...s.proposals, [p.id]: { ...s.proposals[p.id],
      actions: p.actions.map(a => ({ ...a, decision: "accepted" as const, status: "applied" as const, executionOutcome: "existing" as const })) } } }))
    const current = store().meetingSessions[session.id]
    expect(readableMeeting(store(), current).applied).toBe(0)
    expect(readableMeeting(store(), current).actions[0].status).toContain("复用")
    expect(generateMeetingMinutes(store(), current).actions[0].status).toContain("复用")
    expect(generateMeetingMinutes(store(), current).executiveSummary.join(" ")).not.toContain("经人工拒绝")
  })

  it("shows a linked external outcome without claiming that this meeting executed it", () => {
    const { session, p } = draft()
    store().setProposalDecision(p.id, p.actions[0].id, "accepted")
    expect(store().applyProposal(p.id).ok).toBe(true)
    const other = create()
    store().linkMeetingProposal(other.id, p.id)
    expect(readableMeeting(store(), store().meetingSessions[session.id]).applied).toBe(1)
    const view = readableMeeting(store(), store().meetingSessions[other.id])
    expect(view.applied).toBe(0)
    expect(view.actions[0].status).toContain("关联建议")
    expect(generateMeetingMinutes(store(), store().meetingSessions[other.id]).executionResults[0]).toBe("本次尚无实际项目变更")
  })

  it("freezes an audited task discussion even if it is edited after the meeting", () => {
    const session = create()
    const p = store().createProposal({ origin: "meeting", triggerType: "manual", agentType: "risk_dependency",
      targetType: "task", targetId: "fe-025-1", summary: "待核实的依赖跟进", reasoning: "", evidence: [],
      actions: [{ actionType: "CREATE_DISCUSSION", targetType: "task", targetId: "fe-025-1",
        proposedValue: { content: "请确认尚未登记的前置交付条件", targetType: "task", targetId: "fe-025-1" }, reason: "先确认再行动",
        preconditions: [{ targetType: "task", targetId: "fe-025-1", field: "id", expectedValue: "fe-025-1" }] }] })
    store().linkMeetingProposal(session.id, p.id)
    store().setProposalDecision(p.id, p.actions[0].id, "accepted")
    expect(store().applyProposal(p.id).ok).toBe(true)
    store().endMeeting(session.id)
    const id = store().proposals[p.id].actions[0].resultTargetId!
    const before = structuredClone(store().discussions[id])
    useProjectStore.setState({ discussions: {} })
    const frozen = meetingOutcomeState(store(), store().meetingSessions[session.id])
    expect(frozen.discussions[id]).toEqual(before)
    expect(buildExecutionSummary(frozen, [frozen.proposals[p.id]]).discrepancies).toEqual([])
    expect(buildExecutionSummary(frozen, [frozen.proposals[p.id]]).applied[0]).toContain("跟进讨论")
    expect(buildExecutionSummary(frozen, [frozen.proposals[p.id]]).applied[0]).not.toContain("调整 Story")
  })
})
