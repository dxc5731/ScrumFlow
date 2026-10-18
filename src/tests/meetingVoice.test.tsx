// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react"
import MeetingRoom from "../components/planning/MeetingRoom"
import { useSpeechTranscription } from "../hooks/useSpeechTranscription"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"

class FakeRecognition {
  static instance: FakeRecognition | null = null
  lang = ""
  continuous = false
  interimResults = false
  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn(() => this.onend?.())
  abort = vi.fn()
  constructor() { FakeRecognition.instance = this }
  emit(text: string, isFinal: boolean) {
    const result = Object.assign([{ transcript: text }], { isFinal })
    this.onresult?.({ resultIndex: 0, results: [result] })
  }
}

describe("meeting voice transcription", () => {
  beforeEach(() => {
    resetProjectStoreForTests()
    Element.prototype.scrollIntoView = vi.fn()
    ;(window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = FakeRecognition
  })
  afterEach(() => {
    cleanup()
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
  })

  it("records final speech as messages from the selected speaker without calling agents", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("project", store.project.id)
    const before = session.messageIds.length
    render(<MeetingRoom initialSessionId={session.id} onClose={() => {}} />)

    fireEvent.click(screen.getByRole("button", { name: /语音发言/ }))
    const recognition = FakeRecognition.instance!
    expect(recognition.lang).toBe("zh-CN")
    expect(recognition.continuous).toBe(true)

    act(() => recognition.emit("登录模块", false))
    expect(screen.getByText("登录模块")).toBeTruthy()

    act(() => recognition.emit("登录模块这周可以完成", true))
    const updated = useProjectStore.getState().meetingSessions[session.id]
    expect(updated.messageIds.length).toBe(before + 1)
    const message = useProjectStore.getState().meetingMessages[updated.messageIds.at(-1)!]
    expect(message).toMatchObject({ senderType: "user", senderId: store.workspace.currentUserId, content: "登录模块这周可以完成" })

    fireEvent.click(screen.getByRole("button", { name: /停止语音/ }))
    expect(recognition.stop).toHaveBeenCalled()
    expect(screen.getByRole("button", { name: /语音发言/ })).toBeTruthy()
  })

  it("restarts recognition when the browser ends it while still listening", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("project", store.project.id)
    render(<MeetingRoom initialSessionId={session.id} onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /语音发言/ }))
    const recognition = FakeRecognition.instance!
    act(() => recognition.onend?.())
    expect(recognition.start).toHaveBeenCalledTimes(2)
  })

  it("cancels recording on speaker changes and rejects delayed results", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("project", store.project.id)
    render(<MeetingRoom initialSessionId={session.id} onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /语音发言/ }))
    const recognition = FakeRecognition.instance!
    const delayedResult = recognition.onresult!
    const nextSpeaker = Object.keys(store.members).find(id => id !== store.workspace.currentUserId)!
    fireEvent.change(screen.getByRole("combobox", { name: "发言成员" }), { target: { value: nextSpeaker } })
    const before = useProjectStore.getState().meetingSessions[session.id].messageIds.length
    act(() => delayedResult({ resultIndex: 0, results: [Object.assign([{ transcript: "上一位成员的发言" }], { isFinal: true })] }))
    expect(useProjectStore.getState().meetingSessions[session.id].messageIds).toHaveLength(before)
    expect(recognition.abort).toHaveBeenCalled()
    expect(screen.getByRole("button", { name: /语音发言/ })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /语音发言/ }))
    act(() => FakeRecognition.instance!.emit("下一位成员的发言", true))
    const updated = useProjectStore.getState()
    expect(updated.meetingMessages[updated.meetingSessions[session.id].messageIds.at(-1)!].senderId).toBe(nextSpeaker)
  })

  it.each(["会议纪要", "会议材料", "结束会议"])("releases the microphone when opening %s", (name) => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("project", store.project.id)
    render(<MeetingRoom initialSessionId={session.id} onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /语音发言/ }))
    const recognition = FakeRecognition.instance!
    fireEvent.click(screen.getByRole("button", { name }))
    expect(recognition.abort).toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "会议对话" }))
    expect(screen.getByRole("button", { name: /语音发言/ })).toBeTruthy()
  })

  it("does not append a previous recording to either meeting after opening history", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("project", store.project.id)
    const other = store.createMeeting("story", "us030")
    render(<MeetingRoom initialSessionId={session.id} onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /语音发言/ }))
    const recognition = FakeRecognition.instance!
    const delayedResult = recognition.onresult!
    fireEvent.click(screen.getByRole("button", { name: "历史会议" }))
    fireEvent.click(screen.getByRole("button", { name: /^Story 规划会议/ }))
    const before = useProjectStore.getState()
    act(() => delayedResult({ resultIndex: 0, results: [Object.assign([{ transcript: "来自上一场会议" }], { isFinal: true })] }))
    const after = useProjectStore.getState()
    expect(after.meetingSessions[session.id].messageIds).toEqual(before.meetingSessions[session.id].messageIds)
    expect(after.meetingSessions[other.id].messageIds).toEqual(before.meetingSessions[other.id].messageIds)
    expect(recognition.abort).toHaveBeenCalled()
    expect(screen.queryByRole("textbox", { name: "会议消息" })).toBeNull()
  })

  it("ignores old recognition callbacks after stopping and starting again", () => {
    const onFinal = vi.fn()
    const { result } = renderHook(() => useSpeechTranscription(onFinal))
    act(() => result.current.start())
    const previous = FakeRecognition.instance!
    const delayedResult = previous.onresult!
    const delayedEnd = previous.onend!
    act(() => { result.current.stop(); result.current.start() })
    const current = FakeRecognition.instance!
    act(() => {
      delayedResult({ resultIndex: 0, results: [Object.assign([{ transcript: "旧录音" }], { isFinal: true })] })
      delayedEnd()
    })
    expect(onFinal).not.toHaveBeenCalled()
    expect(previous.start).toHaveBeenCalledTimes(1)
    expect(result.current.listening).toBe(true)
    act(() => current.emit("新录音", true))
    expect(onFinal).toHaveBeenCalledExactlyOnceWith("新录音")
  })

  it("keeps the last finalized sentence when manually stopping", () => {
    const onFinal = vi.fn()
    const { result } = renderHook(() => useSpeechTranscription(onFinal))
    act(() => result.current.start())
    const recognition = FakeRecognition.instance!
    recognition.stop.mockImplementation(() => { recognition.emit("最后一句", true); recognition.onend?.() })
    act(() => result.current.stop())
    expect(onFinal).toHaveBeenCalledExactlyOnceWith("最后一句")
    expect(result.current.listening).toBe(false)
  })

  it("resets recording immediately on permission errors", () => {
    const { result } = renderHook(() => useSpeechTranscription(vi.fn()))
    act(() => result.current.start())
    const recognition = FakeRecognition.instance!
    const delayedEnd = recognition.onend!
    act(() => recognition.onerror?.({ error: "not-allowed" }))
    expect(result.current.listening).toBe(false)
    expect(result.current.error).toContain("麦克风权限被拒绝")
    act(() => delayedEnd())
    expect(recognition.start).toHaveBeenCalledTimes(1)
  })

  it("reports automatic restart failures", () => {
    const { result } = renderHook(() => useSpeechTranscription(vi.fn()))
    act(() => result.current.start())
    const recognition = FakeRecognition.instance!
    recognition.start.mockImplementation(() => { throw new Error("service unavailable") })
    act(() => recognition.onend?.())
    expect(result.current.listening).toBe(false)
    expect(result.current.error).toContain("重新开始")
  })

  it("rejects late results and restarts after unmounting", () => {
    const onFinal = vi.fn()
    const { result, unmount } = renderHook(() => useSpeechTranscription(onFinal))
    act(() => result.current.start())
    const recognition = FakeRecognition.instance!
    const delayedResult = recognition.onresult!
    const delayedEnd = recognition.onend!
    unmount()
    act(() => {
      delayedResult({ resultIndex: 0, results: [Object.assign([{ transcript: "已关闭会议" }], { isFinal: true })] })
      delayedEnd()
    })
    expect(onFinal).not.toHaveBeenCalled()
    expect(recognition.abort).toHaveBeenCalled()
    expect(recognition.start).toHaveBeenCalledTimes(1)
  })
})
