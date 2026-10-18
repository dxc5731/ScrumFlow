import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildMeetingContext } from "../agents/meetingContext"
import { currentMeetingAgenda, meetingAgenda, meetingClock } from "../agents/meetingFacilitation"
import { meetingExplainSystemPrompt } from "../../server/meetingModelService"
import { coordinateMeetingTurn } from "../agents/meetingDecision"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"
import type { ScrumMeetingType } from "../types"

const start = Date.parse("2026-10-18T04:00:00Z")
function create(meetingType: ScrumMeetingType = "daily", demoSpeed: 1 | 30 = 1) {
  const state = useProjectStore.getState()
  return state.createMeeting("project", state.project.id, { meetingType, sprintId: "s2", demoSpeed })
}
function messages(id: string) {
  const state = useProjectStore.getState()
  return state.meetingSessions[id].messageIds.map(key => state.meetingMessages[key])
}

describe("Scrum meeting facilitation", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(start); resetProjectStoreForTests() })
  afterEach(() => vi.useRealTimers())

  it.each([
    ["daily", 15, ["昨日进展", "今日计划", "当前阻塞"]],
    ["planning", 90, ["Sprint Goal", "Story 选择", "任务拆解与容量确认"]],
    ["review", 60, ["成果展示", "验收反馈", "后续调整"]],
    ["retrospective", 45, ["回顾事实", "分析问题", "制定改进措施"]],
  ] as const)("starts %s with its real agenda and duration", (type, minutes, titles) => {
    const session = create(type)
    expect(session.facilitation?.plannedMinutes).toBe(minutes)
    expect(meetingAgenda(session).map(item => item.title)).toEqual(titles)
    expect(currentMeetingAgenda(session)?.title).toBe(titles[0])
    expect(messages(session.id)).toHaveLength(1)
    expect(messages(session.id)[0]).toMatchObject({ senderType: "agent", senderId: "project_orchestrator", hostEvent: { kind: "welcome" } })
    expect(messages(session.id)[0].content).toContain(useProjectStore.getState().sprints.s2.name)
    expect(messages(session.id)[0].content).toContain(titles.join(" → "))
    const context = buildMeetingContext(useProjectStore.getState(), session)
    expect(context.facilitation).toMatchObject({ meetingType: type, agenda: titles[0] })
    expect(meetingExplainSystemPrompt({ facilitation: context.facilitation })).toContain("当前议程")
  })

  it("keeps legacy meetings usable without migration or automatic reminders", () => {
    const state = useProjectStore.getState(), session = state.createMeeting("project", state.project.id)
    const before = JSON.stringify(session)
    state.reconcileMeetingHost(session.id, start + 86400_000)
    state.advanceMeetingAgenda(session.id)
    state.extendMeetingTime(session.id, 5)
    expect(JSON.stringify(useProjectStore.getState().meetingSessions[session.id])).toBe(before)
    expect(state.endMeeting(session.id).ok).toBe(true)
  })

  it("uses a generic welcome when no Sprint is associated", () => {
    const state = useProjectStore.getState()
    const session = state.createMeeting("project", state.project.id, { meetingType: "daily", sprintId: null })
    const text = messages(session.id)[0].content
    expect(text).not.toContain("个任务")
    expect(text).not.toContain("项未解决风险")
    expect(session.facilitation?.sprintId).toBeNull()
  })

  it("advances existing topics without overwriting free discussion or project data", () => {
    const session = create(), store = useProjectStore.getState()
    const projectBefore = JSON.stringify({ tasks: store.tasks, stories: store.stories, proposals: store.proposals, history: store.history })
    store.addMeetingMessage(session.id, { senderType: "user", senderId: "m1", content: "这项任务可能延期" })
    store.setMeetingMemory(session.id, { ...store.meetingSessions[session.id].memory!, currentTopic: "risk" })
    expect(currentMeetingAgenda(useProjectStore.getState().meetingSessions[session.id])?.key).toBe("yesterday")
    store.advanceMeetingAgenda(session.id)
    const updated = useProjectStore.getState().meetingSessions[session.id]
    expect(currentMeetingAgenda(updated)?.key).toBe("today")
    expect(meetingAgenda(updated)[0].topic.status).toBe("discussed")
    expect(updated.topics?.some(topic => !topic.agendaKey)).toBe(true)
    expect(messages(session.id).at(-1)?.hostEvent?.kind).toBe("agenda")
    const after = useProjectStore.getState()
    expect(JSON.stringify({ tasks: after.tasks, stories: after.stories, proposals: after.proposals, history: after.history })).toBe(projectBefore)
  })

  it("suggests a transition once after contributions, without routing an AI turn", () => {
    const session = create(), store = useProjectStore.getState()
    for (const senderId of ["m1", "m2"]) store.addMeetingMessage(session.id, { senderType: "user", senderId, content: "我今天继续核对接口" })
    store.reconcileMeetingHost(session.id)
    store.reconcileMeetingHost(session.id)
    expect(messages(session.id).filter(message => message.hostEvent?.kind === "guide")).toHaveLength(1)
    expect(useProjectStore.getState().meetingSessions[session.id].qaTrace ?? []).toHaveLength(0)
    expect(currentMeetingAgenda(useProjectStore.getState().meetingSessions[session.id])?.key).toBe("yesterday")
  })

  it("deduplicates warning and overtime across reconciliation and persisted restoration", () => {
    const session = create(), store = useProjectStore.getState()
    store.reconcileMeetingHost(session.id, start + 13 * 60_000)
    store.reconcileMeetingHost(session.id, start + 14 * 60_000)
    const state = useProjectStore.getState()
    useProjectStore.setState(JSON.parse(JSON.stringify({ meetingSessions: state.meetingSessions, meetingMessages: state.meetingMessages })))
    store.reconcileMeetingHost(session.id, start + 15 * 60_000)
    store.reconcileMeetingHost(session.id, start + 20 * 60_000)
    expect(messages(session.id).filter(message => message.hostEvent?.kind === "time_warning")).toHaveLength(1)
    expect(messages(session.id).filter(message => message.hostEvent?.kind === "overtime")).toHaveLength(1)
    expect(useProjectStore.getState().meetingSessions[session.id].status).toBe("active")
  })

  it("recalculates a new deadline after extending and preserves ended real statistics", () => {
    const session = create(), store = useProjectStore.getState()
    vi.setSystemTime(start + 16 * 60_000)
    store.reconcileMeetingHost(session.id)
    store.extendMeetingTime(session.id, 5)
    const extended = useProjectStore.getState().meetingSessions[session.id]
    expect(meetingClock(extended).remainingMs).toBe(4 * 60_000)
    expect(meetingClock(extended).phase).toBe("normal")
    vi.setSystemTime(start + 21 * 60_000)
    store.endMeeting(session.id)
    const ended = useProjectStore.getState().meetingSessions[session.id]
    expect(ended.facilitation).toMatchObject({ actualDurationMs: 21 * 60_000, actualOvertimeMs: 60_000 })
    expect(ended.minutes).toBeTruthy()
    expect(meetingClock(ended, start + 60 * 60_000).actualMs).toBe(21 * 60_000)
    const before = messages(session.id).length
    store.reconcileMeetingHost(session.id, start + 60 * 60_000)
    store.extendMeetingTime(session.id, 10)
    expect(messages(session.id)).toHaveLength(before)
    expect(messages(session.id).filter(message => message.hostEvent?.kind === "closing")).toHaveLength(1)
  })

  it("separates accelerated demo time from real meeting duration", () => {
    const session = create("daily", 30), store = useProjectStore.getState()
    vi.setSystemTime(start + 26_000)
    store.reconcileMeetingHost(session.id)
    expect(meetingClock(useProjectStore.getState().meetingSessions[session.id]).phase).toBe("warning")
    vi.setSystemTime(start + 31_000)
    store.reconcileMeetingHost(session.id)
    expect(messages(session.id).at(-1)?.content).toContain("演示计时")
    store.endMeeting(session.id)
    expect(useProjectStore.getState().meetingSessions[session.id].facilitation).toMatchObject({
      actualDurationMs: 31_000, actualOvertimeMs: null, demoElapsedMs: 930_000, demoOvertimeMs: 30_000,
    })
  })

  it("refreshes the closing summary after returning to the agenda without duplicating confirmation", () => {
    const session = create(), store = useProjectStore.getState()
    store.dispatchMeetingHostEvent(session.id, "closing")
    store.dispatchMeetingHostEvent(session.id, "closing")
    store.advanceMeetingAgenda(session.id)
    store.dispatchMeetingHostEvent(session.id, "closing")
    store.endMeeting(session.id)
    const summaries = messages(session.id).filter(message => message.hostEvent?.kind === "closing")
    expect(summaries).toHaveLength(2)
    expect(summaries[0].content).toContain("0/3")
    expect(summaries[1].content).toContain("1/3")
  })

  it("answers Sprint-wide blocker queries from existing scoped facts instead of requiring a task selection", async () => {
    const session = create(), state = useProjectStore.getState()
    const blocked = Object.values(state.tasks).filter(task => task.status === "blocked" && state.stories[task.storyId]?.sprintId === "s2")
    expect(blocked.length).toBeGreaterThan(0)
    const result = await coordinateMeetingTurn(state, session, "project_orchestrator", "当前 Sprint 有哪些阻塞任务？不要生成修改建议。", {
      interpret: async () => ({ intent: "risk" }), explain: async () => null,
    })
    expect(result.answer.content).toContain(`${blocked.length} 个现有任务被阻塞`)
    expect(result.answer.content).not.toContain("当前没有可分析的任务")
    expect(result.answer.proposal).toBeUndefined()
  })
})
