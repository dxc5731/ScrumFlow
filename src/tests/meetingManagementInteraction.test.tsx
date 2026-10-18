// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import MeetingRoom from "../components/planning/MeetingRoom"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"
import { managementDebounceMs } from "../agents/meetingManagement"

const store = () => useProjectStore.getState()
const events = () => Object.values(store().meetingMessages).filter(message => message.hostEvent?.kind === "topic_deviation")
function create() { return store().createMeeting("project", store().project.id, { meetingType: "daily", sprintId: "s2", voiceEnabled: false }) }
function send(text: string) { fireEvent.change(screen.getByRole("textbox", { name: "会议消息" }), { target: { value: text } }); fireEvent.click(screen.getByRole("button", { name: "发送消息" })) }
function pair() { send("我们周末要不要组织一次聚餐？"); send("我觉得可以去学校附近吃火锅，大家有什么推荐吗？") }
function response(ids: string[]) { return { ok: true, json: async () => ({ content: JSON.stringify({ relevance: "unrelated", sustained: true, confidence: .97, evidenceMessageIds: ids, reason: "连续聚餐闲聊" }) }) } }

describe("active host interaction and lifecycle", () => {
  beforeEach(() => {
    resetProjectStoreForTests(); vi.useFakeTimers()
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

  it("batches committed chat, issues a single semantic review, and honors incorrect feedback", async () => {
    const fetch = vi.fn(async (_url, init) => response(JSON.parse(init.body).payload.recentMessages.map((message: { id: string }) => message.id)))
    vi.stubGlobal("fetch", fetch)
    const session = create(); render(<MeetingRoom initialSessionId={session.id} onClose={() => {}} />)
    pair()
    expect(fetch).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTimeAsync(managementDebounceMs + 100))
    expect(fetch).toHaveBeenCalledOnce()
    expect(events()).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: "判断有误" }))
    pair()
    await act(async () => vi.advanceTimersByTimeAsync(15_000))
    expect(events()).toHaveLength(1)
    expect(fetch).toHaveBeenCalledOnce()
    expect(store().meetingSessions[session.id].qaTrace ?? []).toHaveLength(0)
  })

  it.each(["agenda", "ended", "switch", "unmount"] as const)("drops an in-flight semantic result after %s", async change => {
    let resolve!: (value: unknown) => void
    let ids: string[] = []
    vi.stubGlobal("fetch", vi.fn((_url, init) => { ids = JSON.parse(init.body).payload.recentMessages.map((message: { id: string }) => message.id); return new Promise(done => { resolve = done }) }))
    const session = create(), mounted = render(<MeetingRoom initialSessionId={session.id} onClose={() => {}} />)
    pair()
    await act(async () => vi.advanceTimersByTimeAsync(managementDebounceMs + 100))
    if (change === "agenda") fireEvent.click(screen.getByRole("button", { name: "下一议程" }))
    if (change === "ended") act(() => { store().endMeeting(session.id) })
    if (change === "switch") {
      act(() => { store().createMeeting("project", store().project.id, { meetingType: "review", sprintId: "s2", voiceEnabled: false }) })
      fireEvent.click(screen.getByRole("button", { name: "历史会议" }))
      fireEvent.click(screen.getByRole("button", { name: /^Sprint Review/ }))
    }
    if (change === "unmount") mounted.unmount()
    await act(async () => { resolve(response(ids)); await Promise.resolve() })
    expect(events()).toHaveLength(0)
  })

  it("lets a deadline reminder take priority over a pending topic intervention", async () => {
    let resolve!: (value: unknown) => void
    let ids: string[] = []
    vi.stubGlobal("fetch", vi.fn((_url, init) => { ids = JSON.parse(init.body).payload.recentMessages.map((message: { id: string }) => message.id); return new Promise(done => { resolve = done }) }))
    const session = create(); render(<MeetingRoom initialSessionId={session.id} onClose={() => {}} />)
    pair(); await act(async () => vi.advanceTimersByTimeAsync(managementDebounceMs + 100))
    await act(async () => vi.advanceTimersByTimeAsync(13 * 60_000))
    await act(async () => { resolve(response(ids)); await Promise.resolve() })
    expect(events()).toHaveLength(0)
    expect(Object.values(store().meetingMessages).some(message => message.hostEvent?.kind === "time_warning")).toBe(true)
  })

  it("never replays historical contributions or a claimed batch after room remount", async () => {
    const fetch = vi.fn(async (_url, init) => response(JSON.parse(init.body).payload.recentMessages.map((message: { id: string }) => message.id)))
    vi.stubGlobal("fetch", fetch)
    const session = create(), mounted = render(<MeetingRoom initialSessionId={session.id} onClose={() => {}} />)
    pair(); await act(async () => vi.advanceTimersByTimeAsync(managementDebounceMs + 100))
    mounted.unmount()
    render(<MeetingRoom initialSessionId={session.id} onClose={() => {}} />)
    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    expect(events()).toHaveLength(1)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("confirms an unmatched blocker task before analysis and creates only a pending proposal", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch)
    const session = create(); render(<MeetingRoom initialSessionId={session.id} onClose={() => {}} />)
    send("我负责的甘特图依赖连线暂时做不了，因为前置的数据结构还没确定，可能影响后面的测试。")
    await act(async () => vi.advanceTimersByTimeAsync(managementDebounceMs + 100))
    const analyze = screen.getByRole("button", { name: "查看依赖影响" }) as HTMLButtonElement
    expect(analyze.disabled).toBe(true)
    fireEvent.change(screen.getByRole("combobox", { name: "确认阻塞任务" }), { target: { value: "fe-025-1" } })
    expect(analyze.disabled).toBe(false)
    const risksBefore = structuredClone(store().risks)
    fireEvent.click(analyze)
    fireEvent.click(screen.getByRole("button", { name: "加入待确认行动" }))
    const proposal = store().proposals[store().meetingSessions[session.id].proposalIds[0]]
    expect(proposal).toMatchObject({ origin: "meeting", status: "draft" })
    expect(proposal.actions[0].decision).toBe("pending")
    expect(store().risks).toEqual(risksBefore)
    expect(fetch).not.toHaveBeenCalled()
  })
})
