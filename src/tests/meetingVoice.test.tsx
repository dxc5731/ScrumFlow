// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import MeetingRoom from "../components/planning/MeetingRoom"
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
})
