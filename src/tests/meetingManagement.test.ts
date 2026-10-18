import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { analyzeMeetingBlocker, managementWindow, matchMeetingTask, meetingBlockerProposalInput, memberBlockerEvent, reviewMeetingDeviation, shouldReviewDeviation } from "../agents/meetingManagement"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"
import type { MeetingMessage } from "../types"

const start = Date.parse("2026-10-18T04:00:00Z")
const store = () => useProjectStore.getState()
function create() { return store().createMeeting("project", store().project.id, { meetingType: "daily", sprintId: "s2", voiceEnabled: false }) }
function add(id: string, content: string, senderType: MeetingMessage["senderType"] = "user") { return store().addMeetingMessage(id, { senderType, senderId: senderType === "user" ? "m1" : "m2", content }) }
function meeting(id: string) { return store().meetingSessions[id] }
function messages(id: string) { return meeting(id).messageIds.map(key => store().meetingMessages[key]) }
function social(id: string) { return [add(id, "我们周末要不要组织一次聚餐？"), add(id, "我觉得可以去学校附近吃火锅，大家有什么推荐吗？")] }
function online(result: unknown | ((ids: string[]) => unknown)) {
  return vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body)
    const ids = body.payload.recentMessages.map((message: { id: string }) => message.id)
    return { ok: true, json: async () => ({ model: "test", content: JSON.stringify(typeof result === "function" ? result(ids) : result) }) }
  }))
}
function incident(id: string, taskId = "fe-025-1") {
  const message = add(id, `我负责的 #${taskId} 目前做不了，因为前置的数据结构还没确定，可能影响后面的测试。`)
  return store().dispatchMeetingHostEvent(id, "blocker_followup", memberBlockerEvent(store(), meeting(id), [message])!)!
}
function analyze(id: string, taskId = "fe-025-1") {
  const event = incident(id, taskId)
  expect(store().respondMeetingHostEvent(id, event.id, "analyze", taskId).ok).toBe(true)
  return messages(id).find(message => message.hostEvent?.analysisMessageId)!
}

describe("conservative active meeting management", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(start); resetProjectStoreForTests() })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it("waits for multiple real contributions, excluding hosts and short voice fragments", () => {
    const session = create(), [first, second] = social(session.id)
    expect(shouldReviewDeviation(store(), meeting(session.id), [first])).toBe(false)
    expect(shouldReviewDeviation(store(), meeting(session.id), [first, second])).toBe(true)
    expect(shouldReviewDeviation(store(), meeting(session.id), [{ ...first, senderType: "digital_member" }, { ...second, senderType: "digital_member" }])).toBe(false)
    expect(shouldReviewDeviation(store(), meeting(session.id), [add(session.id, "火锅"), add(session.id, "挺好的")])).toBe(false)
  })

  it("detects sustained social chat even when preceded immediately by a legitimate work update", () => {
    const session = create(), work = add(session.id, "昨天完成了 Gantt 时间轴组件的基础结构")
    expect(shouldReviewDeviation(store(), meeting(session.id), [work, ...social(session.id)])).toBe(true)
  })

  it("excludes explicit assistant requests from the contribution window", () => {
    const session = create()
    add(session.id, "@风险与依赖 我这项任务存在阻塞，请核对上游接口是否完成并分析影响")
    expect(managementWindow(store(), meeting(session.id))).toHaveLength(0)
  })

  it.each(["Gantt 依赖连线遇到了数据接口问题", "这个任务为什么延期，我们需要一起确认", "我们接下来排期怎么安排，谁来核对", "这个接口涉及技术细节，需要先确定输入格式"])("does not call topic review for valid work: %s", async content => {
    const session = create(), input = [add(session.id, content), add(session.id, "我来补充一下，接下来继续把这个问题解释清楚")]
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch)
    expect(await reviewMeetingDeviation(store(), meeting(session.id), input)).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("uses structured semantic evidence, one persisted event, and safe agenda-specific wording", async () => {
    const session = create(), input = social(session.id)
    online((ids: string[]) => ({ relevance: "unrelated", sustained: true, confidence: .96, evidenceMessageIds: ids, reason: "两句均讨论聚餐", reminder: "虚构：任务明天延期99天" }))
    const event = await reviewMeetingDeviation(store(), meeting(session.id), input)
    expect(event?.assessment?.basis).toBe("model")
    expect(event?.content).toContain("昨日进展")
    expect(event?.content).not.toContain("99")
    store().markMeetingReviewed(session.id, input[1].id)
    store().dispatchMeetingHostEvent(session.id, "topic_deviation", event!)
    store().dispatchMeetingHostEvent(session.id, "topic_deviation", event!)
    expect(messages(session.id).filter(item => item.hostEvent?.kind === "topic_deviation")).toHaveLength(1)
    expect(managementWindow(store(), meeting(session.id))).toHaveLength(0)
  })

  it.each(["related", "uncertain"])("respects a %s semantic verdict even for social-looking words", async relevance => {
    const session = create(), input = social(session.id)
    online((ids: string[]) => ({ relevance, sustained: true, confidence: .99, evidenceMessageIds: ids }))
    expect(await reviewMeetingDeviation(store(), meeting(session.id), input)).toBeNull()
  })

  it.each([
    { relevance: "unrelated", sustained: true, confidence: .98, evidenceMessageIds: ["forged", "ids"] },
    { relevance: "unrelated", sustained: true, confidence: .4, evidenceMessageIds: [] },
    { relevance: "unrelated", sustained: true, confidence: 8, evidenceMessageIds: [] },
  ])("rejects fabricated or insufficient semantic evidence", async response => {
    const session = create(); online(response)
    expect(await reviewMeetingDeviation(store(), meeting(session.id), social(session.id))).toBeNull()
  })

  it("falls back only for explicit sustained social evidence when the model is offline", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))
    const session = create()
    expect((await reviewMeetingDeviation(store(), meeting(session.id), social(session.id)))?.assessment?.basis).toBe("rules")
    expect(await reviewMeetingDeviation(store(), meeting(session.id), [add(session.id, "我想补充一点与大家有关的具体情况"), add(session.id, "刚才提到的事情还有一些需要说明的地方")])).toBeNull()
  })

  it("records incorrect/continue feedback and preserves it through persisted restoration", async () => {
    const session = create(), input = social(session.id)
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline") }))
    const reviewed = await reviewMeetingDeviation(store(), meeting(session.id), input)
    const event = store().dispatchMeetingHostEvent(session.id, "topic_deviation", reviewed!)!
    expect(store().respondMeetingHostEvent(session.id, event.id, "incorrect").ok).toBe(true)
    const state = store()
    useProjectStore.setState(JSON.parse(JSON.stringify({ meetingSessions: state.meetingSessions, meetingMessages: state.meetingMessages })))
    vi.setSystemTime(start + 600_000)
    expect(shouldReviewDeviation(store(), meeting(session.id), social(session.id))).toBe(false)
    expect(store().respondMeetingHostEvent(session.id, event.id, "return").ok).toBe(false)
  })

  it("suppresses further interruptions for two real minutes after continue, independent of demo speed", () => {
    const session = create()
    const event = store().dispatchMeetingHostEvent(session.id, "topic_deviation", { key: "review-1", content: "请确认议程", topicSignature: "聚餐安排" })!
    store().respondMeetingHostEvent(session.id, event.id, "continue")
    vi.setSystemTime(start + 30_000)
    expect(shouldReviewDeviation(store(), meeting(session.id), social(session.id))).toBe(false)
    vi.setSystemTime(start + 301_000)
    expect(shouldReviewDeviation(store(), meeting(session.id), social(session.id))).toBe(true)
  })

  it("reuses agenda state for one concrete Sprint intervention and discloses the expired plan", () => {
    const session = create()
    store().advanceMeetingAgenda(session.id); store().advanceMeetingAgenda(session.id)
    const event = messages(session.id).at(-1)!
    expect(event.hostEvent?.kind).toBe("sprint_blocker")
    expect(event.hostEvent!.taskIds!.length).toBeLessThanOrEqual(2)
    expect(event.content).toContain("2026-09-27 已过")
    for (const id of event.hostEvent!.taskIds!) expect(event.content).toContain(store().tasks[id].title)
    expect(messages(session.id).filter(item => item.hostEvent?.kind === "agenda")).toHaveLength(1)
    expect(managementWindow(store(), meeting(session.id))).toHaveLength(0)
  })

  it("matches only unique task IDs/full names and leaves ambiguous reports for confirmation", () => {
    const session = create(), task = store().tasks["fe-025-1"]
    expect(matchMeetingTask(store(), meeting(session.id), `#FE-025-1 做不了`)).toEqual(task)
    expect(matchMeetingTask(store(), meeting(session.id), `${task.title} 受阻`)).toEqual(task)
    expect(matchMeetingTask(store(), meeting(session.id), "甘特图依赖连线做不了")).toBeNull()
    const input = [add(session.id, "我这边有一项工作暂时做不了，因为前置的数据结构还没确定，可能影响后面的测试")]
    expect(memberBlockerEvent(store(), meeting(session.id), input)?.taskIds).toEqual([])
    expect(memberBlockerEvent(store(), meeting(session.id), [add(session.id, "目前没有阻塞问题，前置接口已经解决，大家可以继续测试")])).toBeNull()
  })

  it("calls the existing risk agent without mutation and requires a reliable Sprint task", () => {
    const session = create(), before = JSON.stringify({ tasks: store().tasks, risks: store().risks })
    const answer = analyzeMeetingBlocker(store(), meeting(session.id), "fe-025-1")!
    expect(answer.agentType).toBe("risk_dependency")
    expect(answer.content).toContain(store().tasks["fe-025-1"].title)
    expect(answer.content).toContain("What-if")
    expect(JSON.stringify({ tasks: store().tasks, risks: store().risks })).toBe(before)
    expect(analyzeMeetingBlocker(store(), meeting(session.id), "made-up")).toBeNull()
  })

  it("converts analysis to an existing risk update, pending human approval then audited execution", () => {
    const session = create(), count = Object.keys(store().risks).length
    const followup = analyze(session.id), before = structuredClone(store().risks)
    const result = store().respondMeetingHostEvent(session.id, followup.id, "propose")
    expect(result.ok).toBe(true)
    const proposal = store().proposals[result.proposalId!]!
    expect(proposal).toMatchObject({ origin: "meeting", agentType: "risk_dependency", status: "draft" })
    expect(proposal.actions[0]).toMatchObject({ actionType: "UPDATE_RISK", decision: "pending", status: "pending" })
    expect(store().risks).toEqual(before)
    store().applyProposal(proposal.id)
    expect(store().risks).toEqual(before)
    store().setProposalDecision(proposal.id, proposal.actions[0].id, "accepted")
    expect(store().applyProposal(proposal.id).ok).toBe(true)
    expect(Object.keys(store().risks)).toHaveLength(count)
    expect(store().history.some(item => item.proposalId === proposal.id)).toBe(true)
    expect(store().respondMeetingHostEvent(session.id, followup.id, "propose").ok).toBe(false)
    const next = create(), repeated = analyze(next.id)
    expect(store().respondMeetingHostEvent(next.id, repeated.id, "propose").proposalId).toBe(proposal.id)
    expect(Object.keys(store().risks)).toHaveLength(count)
  })

  it("deduplicates the same pending action across event-origin proposals", () => {
    const session = create(), input = meetingBlockerProposalInput(store(), meeting(session.id), "fe-025-1")!
    const eventProposal = store().createProposal({ ...input, origin: "event", triggerType: "data_change" })
    const followup = analyze(session.id)
    expect(store().respondMeetingHostEvent(session.id, followup.id, "propose").proposalId).toBe(eventProposal.id)
    expect(meeting(session.id).proposalIds).toContain(eventProposal.id)
  })

  it("revalidates task facts before execution and never bypasses stale protections", () => {
    const session = create(), followup = analyze(session.id)
    const result = store().respondMeetingHostEvent(session.id, followup.id, "propose")
    const proposal = store().proposals[result.proposalId!]!
    const riskBefore = structuredClone(store().risks)
    const task = store().tasks["fe-025-1"]
    useProjectStore.setState({ tasks: { ...store().tasks, [task.id]: { ...task, endDate: "2026-11-01" } } })
    store().setProposalDecision(proposal.id, proposal.actions[0].id, "accepted")
    expect(store().applyProposal(proposal.id).ok).toBe(false)
    expect(store().risks).toEqual(riskBefore)
  })

  it("uses the existing discussion action when no risk record is reliably associated", () => {
    const session = create()
    useProjectStore.setState({ risks: {} })
    const input = meetingBlockerProposalInput(store(), meeting(session.id), "fe-025-1")!
    expect(input.actions[0].actionType).toBe("CREATE_DISCUSSION")
    expect(input.actions[0].proposedValue.content).toContain("确认阻塞解除条件")
  })

  it("rejects ended/cross-meeting events and cannot recursively observe the host", () => {
    const session = create(), other = create(), event = incident(session.id)
    expect(store().respondMeetingHostEvent(other.id, event.id, "analyze", "fe-025-1").ok).toBe(false)
    store().markMeetingReviewed(session.id, event.id)
    expect(managementWindow(store(), meeting(session.id))).toHaveLength(0)
    store().endMeeting(session.id)
    expect(store().dispatchMeetingHostEvent(session.id, "blocker_followup", { key: "late", content: "late" })).toBeNull()
    expect(store().respondMeetingHostEvent(session.id, event.id, "analyze", "fe-025-1").ok).toBe(false)
  })
})
