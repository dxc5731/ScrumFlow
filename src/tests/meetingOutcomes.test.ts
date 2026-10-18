import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"
import { actionOutcome, meetingInsights } from "../agents/meetingOutcomes"
import { scrumMeetingReport } from "../agents/meetingReport"
import { meetingBlockerProposalInput } from "../agents/meetingManagement"
import { ensureMeetingNarrative, narrativeFingerprint } from "../agents/meetingNarrative"
import { recommendMeetingMaterials } from "../agents/materialRecommendations"
import { standardMaterial } from "../agents/materialStandards"
import { buildMeetingContext } from "../agents/meetingContext"
import type { AgentProposal, MeetingSession } from "../types"

const start = Date.parse("2026-10-18T04:00:00Z")
const store = () => useProjectStore.getState()
const session = (id: string) => store().meetingSessions[id]
function create(demoSpeed: 1 | 30 = 1) { return store().createMeeting("project", store().project.id, { meetingType: "daily", sprintId: "s2", demoSpeed, voiceEnabled: false }) }
function insights(s: MeetingSession) { return meetingInsights(store(), session(s.id)) }
function proposal(s: MeetingSession, origin: "meeting" | "event" = "meeting") {
  const p = store().createProposal({ ...meetingBlockerProposalInput(store(), session(s.id), "fe-025-1")!, origin })
  store().linkMeetingProposal(s.id, p.id)
  return p
}
function apply(p: AgentProposal) { store().setProposalDecision(p.id, p.actions[0].id, "accepted"); return store().applyProposal(p.id) }

describe("traceable meeting outcomes", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(start); resetProjectStoreForTests() })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it("counts member records by explicit source, never hosts, digital staff or speaking duration", () => {
    const s = create()
    for (const inputSource of ["text", "voice", "voice"] as const) store().addMeetingMessage(s.id, { senderType: "user", senderId: "m2", content: "真实进展补充", inputSource })
    store().addMeetingMessage(s.id, { senderType: "digital_member", senderId: "m1", content: "AI 模拟进展" })
    const i = insights(s)
    expect(i.members).toEqual([{ id: "m2", name: "李娜", text: 1, voice: 2, unknown: 0, total: 3 }])
    expect(i).not.toHaveProperty("speakingDuration")
  })

  it("does not infer a legacy input source, plan or actual duration", () => {
    const s = store().createMeeting("story", "us024")
    const message = store().addMeetingMessage(s.id, { senderType: "user", senderId: "m1", content: "旧会议记录" })
    useProjectStore.setState(state => ({ meetingMessages: { ...state.meetingMessages, [message.id]: { ...message, inputSource: undefined } } }))
    expect(insights(s).members[0].unknown).toBe(1)
    expect(insights(s).actualMs).toBeNull()
    expect(insights(s).plannedMs).toBeNull()
    expect(scrumMeetingReport(store(), session(s.id))).toContain("历史会议（未记录类型）")
  })

  it("keeps partial or malformed legacy clock records unknown instead of presenting zero as fact", () => {
    const s = create()
    const partial = { ...session(s.id), status: "ended" as const, endedAt: null,
      facilitation: { ...session(s.id).facilitation!, startedAt: "invalid", plannedMinutes: NaN } }
    const i = meetingInsights(store(), partial)
    expect(i.actualMs).toBeNull()
    expect(i.plannedMs).toBeNull()
    expect(() => scrumMeetingReport(store(), partial)).not.toThrow()
    expect(scrumMeetingReport(store(), partial)).not.toContain("NaN")
    expect(scrumMeetingReport(store(), partial)).toContain("结束时间暂无记录")
  })

  it("separates demo time from real time and stores one outcome announcement", () => {
    const s = create(30)
    vi.setSystemTime(start + 31_000)
    store().reconcileMeetingHost(s.id)
    store().endMeeting(s.id)
    expect(session(s.id).facilitation).toMatchObject({ actualDurationMs: 31_000, actualOvertimeMs: null, demoElapsedMs: 930_000, demoOvertimeMs: 30_000 })
    expect(insights(s).actualMs).toBe(31_000)
    expect(scrumMeetingReport(store(), session(s.id))).toContain("演示模式，不作真实超时判断")
    const count = session(s.id).messageIds.length
    expect(store().endMeeting(s.id).ok).toBe(false)
    expect(session(s.id).messageIds).toHaveLength(count)
    expect(insights(s).events.filter(m => m.hostEvent?.kind === "outcome")).toHaveLength(1)
  })

  it("counts warnings and explicit agenda progression without inventing completion or stage duration", () => {
    const s = create()
    store().advanceMeetingAgenda(s.id)
    expect(insights(s).progressed).toBe(1)
    vi.setSystemTime(start + 13 * 60_000); store().reconcileMeetingHost(s.id)
    store().extendMeetingTime(s.id, 5)
    vi.setSystemTime(start + 21 * 60_000); store().reconcileMeetingHost(s.id)
    store().endMeeting(s.id)
    expect(insights(s).counts.time).toBe(2)
    expect(insights(s).plannedMs).toBe(20 * 60_000)
    expect(session(s.id).facilitation?.actualOvertimeMs).toBe(60_000)
    expect(scrumMeetingReport(store(), session(s.id))).toContain("不代表验收完成")
  })

  it("retains correction feedback and distinct task blocker facts in the timeline", () => {
    const s = create()
    const a = store().addMeetingMessage(s.id, { senderType: "user", senderId: "m1", content: "周末去聚餐吗" })
    const e = store().dispatchMeetingHostEvent(s.id, "topic_deviation", { key: "test", content: "回到议程", sourceMessageIds: [a.id] })!
    store().respondMeetingHostEvent(s.id, e.id, "incorrect")
    store().dispatchMeetingHostEvent(s.id, "sprint_blocker", { key: "b", content: "真实阻塞", taskIds: ["fe-025-1"], riskIds: ["risk-fe025"] })
    store().dispatchMeetingHostEvent(s.id, "blocker_followup", { key: "f", content: "跟进同一任务", taskIds: ["fe-025-1"] })
    store().endMeeting(s.id)
    expect(insights(s).counts).toMatchObject({ deviation: 1, incorrect: 1 })
    expect(insights(s).blockerIds).toEqual(["fe-025-1"])
    const md = scrumMeetingReport(store(), session(s.id))
    expect(md).toContain(a.id); expect(md).toContain("判断有误"); expect(md).toContain("甘特依赖连接线渲染")
  })

  it("attributes a new meeting proposal, separating accepted from audited execution", () => {
    const s = create(), p = proposal(s)
    expect(store().proposals[p.id].sourceMeetingId).toBe(s.id)
    expect(insights(s).counts).toMatchObject({ pending: 1, accepted: 0, executed: 0 })
    store().setProposalDecision(p.id, p.actions[0].id, "accepted")
    expect(insights(s).counts).toMatchObject({ pending: 0, accepted: 1, acceptedUnexecuted: 1, executed: 0 })
    expect(store().applyProposal(p.id).ok).toBe(true)
    expect(insights(s).counts).toMatchObject({ accepted: 1, acceptedUnexecuted: 0, executed: 1 })
    expect(insights(s).actions[0].history.length).toBeGreaterThan(0)
  })

  it("excludes event-origin and another meeting's linked proposals", () => {
    const first = create(), p = proposal(first), second = create(), external = proposal(second, "event")
    store().linkMeetingProposal(second.id, p.id)
    expect(insights(first).actions).toHaveLength(1)
    expect(insights(second).actions).toHaveLength(0)
    expect(insights(second).linkedCount).toBe(2)
    expect(store().proposals[external.id].sourceMeetingId).toBeUndefined()
  })

  it("does not retrospectively attribute a preexisting proposal with missing provenance", () => {
    const old = create(), p = proposal(old)
    useProjectStore.setState(state => ({ proposals: { ...state.proposals, [p.id]: { ...state.proposals[p.id], sourceMeetingId: undefined } } }))
    vi.setSystemTime(start + 20_000)
    const newer = create(); store().linkMeetingProposal(newer.id, p.id)
    expect(insights(newer).actions).toHaveLength(0)
  })

  it("requires write evidence and separates reused, failed and rejected outcomes", () => {
    const s = create(), p = proposal(s), a = p.actions[0]
    expect(actionOutcome(store(), p, { ...a, decision: "accepted", status: "applied" }).executed).toBe(false)
    expect(actionOutcome(store(), p, { ...a, decision: "accepted", status: "applied", executionOutcome: "existing" }).bucket).toBe("reused")
    expect(actionOutcome(store(), p, { ...a, decision: "accepted", status: "failed" }).label).toContain("执行失败")
    expect(actionOutcome(store(), p, { ...a, decision: "rejected" }).bucket).toBe("rejected")
  })

  it("freezes Sprint and entity facts, ignoring unrelated later writes while following its own approval", () => {
    const s = create(), p = proposal(s)
    store().endMeeting(s.id)
    const before = insights(s), fp = narrativeFingerprint(store(), session(s.id))
    expect(before.sprintOverdue).toBe(true)
    store().updateTask("fe-025-1", { title: "会后无关改名" })
    store().updateRisk("risk-fe025", { title: "会后另改风险名" })
    expect(insights(s).state.tasks["fe-025-1"].title).toBe("甘特依赖连接线渲染")
    expect(narrativeFingerprint(store(), session(s.id))).toBe(fp)
    vi.setSystemTime(start + 10_000)
    expect(apply(p).ok).toBe(true)
    expect(insights(s).counts.executed).toBe(1)
    expect(insights(s).actions[0].afterMeeting).toBe(true)
    expect(insights(s).state.risks["risk-fe025"].mitigation).not.toBe(before.state.risks["risk-fe025"].mitigation)
    expect(insights(s).state.risks["risk-fe025"].title).toBe(before.state.risks["risk-fe025"].title)
    expect(scrumMeetingReport(store(), session(s.id))).toContain("会后跟进写回")
  })

  it("serializes the snapshot and source attribution without losing evidence", () => {
    const s = create(), p = proposal(s); apply(p); store().endMeeting(s.id)
    const parsed = JSON.parse(JSON.stringify(store()))
    expect(meetingInsights(parsed, parsed.meetingSessions[s.id]).counts.executed).toBe(1)
    expect(parsed.meetingSessions[s.id].outcomeSnapshot.capturedAt).toBe(session(s.id).endedAt)
  })

  it("saves an offline factual recap once, survives no-action meetings and never polls a model on read", async () => {
    const s = create()
    store().endMeeting(s.id)
    const fetch = vi.fn().mockRejectedValue(new Error("offline")); vi.stubGlobal("fetch", fetch)
    await ensureMeetingNarrative(s.id)
    const calls = fetch.mock.calls.length
    await ensureMeetingNarrative(s.id)
    scrumMeetingReport(store(), session(s.id)); insights(s)
    expect(fetch).toHaveBeenCalledTimes(calls)
    expect(session(s.id).narrative?.model).toBe("facts-template")
    expect(session(s.id).narrative?.text).toContain("0 条行动建议")
    expect(recommendMeetingMaterials(store(), session(s.id)).map(r => r.key)).toEqual(["meeting-report"])
  })

  it("exports chart data, precise changes and original IDs without mutating business data", () => {
    const s = create(), p = proposal(s); apply(p); store().endMeeting(s.id)
    const before = JSON.stringify({ tasks: store().tasks, risks: store().risks, proposals: store().proposals, history: store().history })
    const artifact = standardMaterial("meeting-report", store(), session(s.id), buildMeetingContext(store(), session(s.id)))
    expect(artifact.kind).toBe("document")
    const md = scrumMeetingReport(store(), session(s.id))
    for (const text of ["成员参与分布", "决策与行动状态分布", "AI 主持行动回顾", "ChangeHistory ID", "计划期已过", p.id, store().history.find(h => h.proposalId === p.id)!.id]) expect(md).toContain(text)
    expect(JSON.stringify({ tasks: store().tasks, risks: store().risks, proposals: store().proposals, history: store().history })).toBe(before)
  })
})
