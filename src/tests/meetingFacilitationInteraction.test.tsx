// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import MeetingRoom from "../components/planning/MeetingRoom"
import MeetingSetup from "../components/planning/MeetingSetup"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"

class Recognition {
  static instance: Recognition
  onresult: ((event: unknown) => void) | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn(() => this.onend?.())
  abort = vi.fn()
  constructor() { Recognition.instance = this }
  emit(text: string, isFinal: boolean) { this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] }) }
}
class Utterance {
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public text: string) {}
}
const synthesis = { getVoices: () => [{ voiceURI: "yaoyao", name: "Microsoft Yaoyao", lang: "zh-CN" }], resume: vi.fn(), cancel: vi.fn(), speak: vi.fn((utterance: Utterance) => utterance.onstart?.()) }

describe("Scrum facilitator user flows", () => {
  beforeEach(() => {
    resetProjectStoreForTests(); vi.clearAllMocks(); vi.useFakeTimers()
    Element.prototype.scrollIntoView = vi.fn()
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true })
    vi.stubGlobal("webkitSpeechRecognition", Recognition)
    vi.stubGlobal("speechSynthesis", synthesis)
    vi.stubGlobal("SpeechSynthesisUtterance", Utterance)
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

  it("creates the selected template only after explicit Start, with labelled demo settings", () => {
    const store = useProjectStore.getState(), onStart = vi.fn()
    render(<MeetingSetup targetType="project" targetId={store.project.id} onStart={onStart} onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /Sprint Review/ }))
    fireEvent.click(screen.getByRole("checkbox", { name: /演示模式/ }))
    expect(Object.keys(useProjectStore.getState().meetingSessions)).toHaveLength(0)
    expect(screen.getByRole("status").textContent).toContain("实际会议用时单独保存")
    fireEvent.click(screen.getByRole("button", { name: /开始会议/ }))
    expect(onStart).toHaveBeenCalledOnce()
    expect(useProjectStore.getState().meetingSessions[onStart.mock.calls[0][0]]).toMatchObject({ meetingType: "review", facilitation: { plannedMinutes: 60, demoSpeed: 30 } })
  })

  it("shows yellow/red deadline states once, extends, and advances the agenda", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("project", store.project.id, { meetingType: "daily", demoSpeed: 30, voiceEnabled: false })
    render(<MeetingRoom initialSessionId={session.id} onClose={() => {}} />)
    act(() => vi.advanceTimersByTime(26_000))
    expect(document.querySelector(".meeting-host-controls.is-warning")).toBeTruthy()
    act(() => vi.advanceTimersByTime(5000))
    expect(document.querySelector(".meeting-host-controls.is-overtime")).toBeTruthy()
    const messages = Object.values(useProjectStore.getState().meetingMessages)
    expect(messages.filter(message => message.hostEvent?.kind === "time_warning")).toHaveLength(1)
    expect(messages.filter(message => message.hostEvent?.kind === "overtime")).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: "更多会议操作" }))
    fireEvent.change(screen.getByRole("combobox", { name: "延长会议" }), { target: { value: "5" } })
    expect(document.querySelector(".meeting-host-controls.is-normal")).toBeTruthy()
    expect(screen.getByRole("timer").textContent).toContain("20:00")
    fireEvent.click(screen.getByRole("button", { name: "下一议程" }))
    expect(screen.getByRole("list", { name: "议程进度" }).querySelector('[aria-current="step"]')?.textContent).toContain("今日计划")
  })

  it("preserves transcription and speaker switching without recording the host output", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("project", store.project.id, { meetingType: "daily" })
    render(<MeetingRoom initialSessionId={session.id} announceWelcome onClose={() => {}} />)
    expect(synthesis.speak).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole("button", { name: "语音发言" }))
    expect(synthesis.cancel).toHaveBeenCalled()
    const first = Recognition.instance
    act(() => first.emit("正在同步", false))
    expect(screen.getByText("正在同步")).toBeTruthy()
    act(() => first.emit("我今天继续完成接口联调", true))
    const nextSpeaker = Object.keys(store.members).find(id => id !== store.workspace.currentUserId)!
    fireEvent.change(screen.getByRole("combobox", { name: "发言成员" }), { target: { value: nextSpeaker } })
    expect(first.abort).toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "语音发言" }))
    act(() => Recognition.instance.emit("我来核对验收证据", true))
    fireEvent.click(screen.getByRole("button", { name: "下一议程" }))
    expect(synthesis.speak).toHaveBeenCalledOnce()
    const state = useProjectStore.getState(), meeting = state.meetingSessions[session.id]
    const human = meeting.messageIds.map(id => state.meetingMessages[id]).filter(message => message.senderType === "user")
    expect(human.map(message => message.content)).toEqual(["我今天继续完成接口联调", "我来核对验收证据"])
    expect(human[1].senderId).toBe(nextSpeaker)
    expect(meeting.qaTrace ?? []).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: "结束会议" }))
    fireEvent.click(screen.getByRole("switch", { name: "主持人语音播报" }))
    expect(useProjectStore.getState().meetingSessions[session.id].facilitation?.voiceEnabled).toBe(false)
  })

  it("lets users select and preview a voice without creating meeting messages or enabling audio during recording", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("project", store.project.id, { meetingType: "daily", voiceEnabled: true })
    render(<MeetingRoom initialSessionId={session.id} onClose={() => {}} />)
    const messageIds = [...useProjectStore.getState().meetingSessions[session.id].messageIds]
    fireEvent.click(screen.getByRole("button", { name: "更多会议操作" }))
    fireEvent.change(screen.getByRole("combobox", { name: "主持人音色" }), { target: { value: "yaoyao" } })
    fireEvent.change(screen.getByRole("slider", { name: "主持人语速" }), { target: { value: ".95" } })
    fireEvent.click(screen.getByRole("button", { name: "试听声音" }))
    expect(synthesis.speak).toHaveBeenCalledOnce()
    expect(synthesis.speak.mock.calls[0][0]).toMatchObject({ voice: { voiceURI: "yaoyao" }, rate: .95 })
    expect(useProjectStore.getState().meetingSessions[session.id].messageIds).toEqual(messageIds)
    fireEvent.click(screen.getByRole("button", { name: "语音发言" }))
    expect(synthesis.cancel).toHaveBeenCalled()
    expect((screen.getByRole("button", { name: "试听声音" }) as HTMLButtonElement).disabled).toBe(true)
  })
})
