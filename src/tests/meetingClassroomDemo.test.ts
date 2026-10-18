import { describe, expect, it } from "vitest"
import { createProjectStore, projectDataSnapshot, useProjectStore } from "../store/projectStore"
import { buildClassroomDemo, projectFingerprint, sortMeetingHistory } from "../agents/meetingClassroomDemo"
import { meetingInsights, meetingOutcomeState } from "../agents/meetingOutcomes"
import { readableMeeting } from "../agents/meetingPresentation"
import { standardMaterial } from "../agents/materialStandards"
import { buildMeetingContext } from "../agents/meetingContext"
import { meetingChartData } from "../agents/meetingChartData"
import { scrumMeetingReport } from "../agents/meetingReport"

describe("classroom rehearsal isolation and saved evidence", () => {
  it("executes the real executor in a private store and restores consistent outcomes after JSON reload", () => {
    const source = projectDataSnapshot(useProjectStore.getState()), before = JSON.stringify(source)
    const formal = projectFingerprint(source)
    const demo = buildClassroomDemo(source, new Date("2026-10-18T08:00:00Z"))
    expect(JSON.stringify(source)).toBe(before)
    expect(projectFingerprint(useProjectStore.getState())).toBe(formal)
    const loaded = JSON.parse(JSON.stringify({ ...source, meetingSessions: { [demo.session.id]: demo.session }, meetingMessages: demo.messages }))
    const session = loaded.meetingSessions[demo.session.id], i = meetingInsights(loaded, session)
    expect(i.messages.length).toBeGreaterThanOrEqual(35)
    expect(i.messages.length).toBeLessThanOrEqual(45)
    expect(i.counts).toMatchObject({ executed: 4, rejected: 2, pending: 1, accepted: 4, returned: 1, continued: 1, incorrect: 1, time: 2 })
    expect(i.actions.filter(a => a.executed).every(a => a.history.length > 0)).toBe(true)
    expect(Object.keys(loaded.proposals)).not.toContain(session.proposalIds[0])
    expect(i.state.tasks["data-024"].assigneeId).toBe(source.tasks["data-024"].assigneeId)
    expect(i.state.dependencies["dep-1"]).toEqual(source.dependencies["dep-1"])
    expect(Object.keys(i.state.tasks).length).toBe(Object.keys(source.tasks).length + 2)
    expect(readableMeeting(loaded, session).applied).toBe(4)
    const charts = meetingChartData(loaded, session)
    expect(charts.totalSpeech).toBe(i.messages.filter(m => m.senderType !== "system").length)
    expect(charts.interventions.reduce((n, v) => n + v.count, 0)).toBe(i.events.length)
    expect(charts.funnel.map(v => v.count)).toEqual([7, 6, 4, 4])
    expect(scrumMeetingReport(loaded, session)).toContain("离线演示归档")
    expect(scrumMeetingReport(loaded, session)).toContain("67%")
    expect(session.demo.agendaTiming.reduce((s: number, t: { startedAt: string; endedAt: string }) => s + Date.parse(t.endedAt) - Date.parse(t.startedAt), 0)).toBe(32 * 60_000)
    loaded.tasks["data-024"].title = "later unrelated project change"
    loaded.members.m2.name = "changed name"
    expect(meetingOutcomeState(loaded, session).tasks["data-024"].title).toBe(source.tasks["data-024"].title)
    expect(meetingOutcomeState(loaded, session).members.m2.name).toBe("李娜")
    const frozen = meetingOutcomeState(loaded, session)
    const gantt = standardMaterial("gantt", frozen, session, buildMeetingContext(frozen, session))
    expect(gantt.kind).toBe("diagram")
    expect(JSON.stringify(gantt)).toContain("契约冻结与字段核对")
  })
  it("resolves dependency and discussion results from the sandbox, never the global store", () => {
    const original = projectDataSnapshot(useProjectStore.getState()), formal = JSON.stringify(original)
    const sandbox = createProjectStore(original), get = sandbox.getState
    const p = get().createProposal({ origin: "meeting", triggerType: "manual", agentType: "risk_dependency", targetType: "task", targetId: "data-024", summary: "isolated executor", reasoning: "test fixture", evidence: [], actions: [
      { actionType: "ADD_DEPENDENCY", targetType: "dependency", targetId: "sandbox-new-edge", proposedValue: { sourceTaskId: "data-024", targetTaskId: "test-024" }, reason: "fixture", preconditions: [{ targetType: "task", targetId: "data-024", field: "id", expectedValue: "data-024" }] },
    ] })
    get().setProposalDecision(p.id, p.actions[0].id, "accepted")
    const result = get().applyProposal(p.id)
    expect(result.ok, JSON.stringify(get().proposals[p.id])).toBe(true)
    const action = get().proposals[p.id].actions[0]
    expect(get().dependencies[action.resultTargetId!]).toMatchObject({ sourceTaskId: "data-024", targetTaskId: "test-024" })
    expect(JSON.stringify(projectDataSnapshot(useProjectStore.getState()))).toBe(formal)
  })
  it("sorts multiple pins by newest pin time and preserves unpin through serialization", () => {
    const { session } = buildClassroomDemo(projectDataSnapshot(useProjectStore.getState()))
    const ordinary = { ...session, id: "ordinary", createdAt: "2030-01-01", pinnedAt: null }
    const second = { ...session, id: "second", pinnedAt: "2030-01-01" }
    expect([ordinary, session, second].sort(sortMeetingHistory).map(s => s.id)).toEqual(["second", session.id, "ordinary"])
    const sandbox = createProjectStore(projectDataSnapshot(useProjectStore.getState()))
    sandbox.setState({ meetingSessions: { [session.id]: session } })
    sandbox.getState().setMeetingPresentation(session.id, { pinnedAt: null })
    expect(JSON.parse(sandbox.getState().exportProjectJson()).meetingSessions[session.id].pinnedAt).toBeNull()
  })
})
