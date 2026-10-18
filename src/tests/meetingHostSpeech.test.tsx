// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import { useMeetingHostSpeech } from "../hooks/useMeetingHostSpeech"
import type { MeetingMessage } from "../types"

class Utterance {
  text: string
  lang = ""
  rate = 1
  voice: unknown = null
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(text: string) { this.text = text }
}
const chineseVoice = { lang: "zh-CN", name: "Chinese", voiceURI: "chinese" }
const otherVoice = { lang: "zh-CN", name: "Microsoft Yaoyao", voiceURI: "yaoyao" }
const voiceListeners = new Set<() => void>()
const synthesis = { getVoices: vi.fn(() => [{ lang: "en-US", name: "English", voiceURI: "english" }, chineseVoice]),
  addEventListener: vi.fn((_type: string, listener: () => void) => voiceListeners.add(listener)),
  removeEventListener: vi.fn((_type: string, listener: () => void) => voiceListeners.delete(listener)),
  resume: vi.fn(), cancel: vi.fn(), speak: vi.fn((utterance: Utterance) => utterance.onstart?.()) }
const message = (id: string): MeetingMessage => ({ id, meetingId: "meeting", senderType: "agent", senderId: "project_orchestrator", content: "接下来确认当前阻塞", createdAt: new Date().toISOString(), hostEvent: { key: id, kind: "agenda" } })
const initial = { sessionId: "meeting", message: message("welcome"), enabled: true, active: true, recording: false, announceWelcome: true }
type SpeechProps = Parameters<typeof useMeetingHostSpeech>[0]

describe("meeting host speech output", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers(); window.localStorage.clear(); voiceListeners.clear()
    synthesis.getVoices.mockReturnValue([{ lang: "en-US", name: "English", voiceURI: "english" }, chineseVoice])
    vi.stubGlobal("speechSynthesis", synthesis); vi.stubGlobal("SpeechSynthesisUtterance", Utterance)
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

  it("speaks the welcome once in Chinese and interrupts it for a new reminder", () => {
    const { result, rerender } = renderHook((props: SpeechProps) => useMeetingHostSpeech(props), { initialProps: initial })
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    expect(synthesis.speak.mock.calls[0][0]).toMatchObject({ lang: "zh-CN", voice: chineseVoice, rate: 1.03 })
    rerender({ ...initial, message: { ...initial.message } })
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    rerender({ ...initial, message: message("warning") })
    expect(synthesis.cancel).toHaveBeenCalledTimes(1)
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
    expect(result.current.speaking).toBe(true)
  })

  it("cancels and does not accumulate speech while muted or recording", () => {
    const { rerender } = renderHook((props: SpeechProps) => useMeetingHostSpeech(props), { initialProps: initial })
    rerender({ ...initial, recording: true })
    expect(synthesis.cancel).toHaveBeenCalled()
    rerender({ ...initial, message: message("while-recording"), recording: true })
    rerender({ ...initial, message: message("while-recording") })
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    rerender({ ...initial, message: message("muted"), enabled: false })
    rerender({ ...initial, message: message("muted") })
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    rerender({ ...initial, message: message("next-agenda") })
    expect(synthesis.speak).toHaveBeenCalledTimes(2)
  })

  it("does not replay persisted messages on opening or switching a meeting", () => {
    const { rerender, unmount } = renderHook((props: SpeechProps) => useMeetingHostSpeech(props), { initialProps: { ...initial, announceWelcome: false } })
    expect(synthesis.speak).not.toHaveBeenCalled()
    rerender({ ...initial, announceWelcome: false, message: message("new") })
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    rerender({ ...initial, sessionId: "other", message: message("other-history") })
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    expect(synthesis.cancel).toHaveBeenCalled()
    unmount()
  })

  it("stops on meeting end and ignores late callbacks from cancelled speech", () => {
    const { result, rerender } = renderHook((props: SpeechProps) => useMeetingHostSpeech(props), { initialProps: initial })
    const oldError = synthesis.speak.mock.calls[0][0].onerror!
    rerender({ ...initial, active: false })
    act(() => oldError())
    expect(result.current.speaking).toBe(false)
    expect(result.current.error).toBe("")
  })

  it("degrades to text on synthesis failure and releases audio on pagehide", () => {
    synthesis.speak.mockImplementationOnce(() => { throw new Error("not allowed") })
    const { result, rerender } = renderHook((props: SpeechProps) => useMeetingHostSpeech(props), { initialProps: initial })
    expect(result.current.error).toContain("文字")
    rerender({ ...initial, message: message("next") })
    act(() => window.dispatchEvent(new Event("pagehide")))
    expect(result.current.speaking).toBe(false)
  })

  it("falls back to text if the browser never starts speech", () => {
    synthesis.speak.mockImplementationOnce(() => {})
    const { result } = renderHook(() => useMeetingHostSpeech(initial))
    act(() => vi.advanceTimersByTime(3001))
    expect(result.current.error).toContain("浏览器未开始播报")
    expect(result.current.speaking).toBe(false)
  })

  it("continues without a speech API", () => {
    vi.stubGlobal("speechSynthesis", undefined)
    const { result } = renderHook(() => useMeetingHostSpeech(initial))
    expect(result.current.supported).toBe(false)
    expect(result.current.speaking).toBe(false)
  })

  it("persists voice and speed, previews on demand, and never replays a message when settings change", () => {
    synthesis.getVoices.mockReturnValue([chineseVoice, otherVoice])
    const { result, rerender, unmount } = renderHook((props: SpeechProps) => useMeetingHostSpeech(props), { initialProps: initial })
    act(() => { result.current.setVoiceURI("yaoyao"); result.current.setRate(.95) })
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    expect(synthesis.cancel).toHaveBeenCalled()
    act(() => result.current.preview())
    expect(synthesis.speak.mock.calls.at(-1)![0]).toMatchObject({ voice: otherVoice, rate: .95 })
    expect(result.current.previewing).toBe(true)
    rerender({ ...initial, message: message("warning") })
    expect(result.current.previewing).toBe(false)
    expect(synthesis.speak.mock.calls.at(-1)![0]).toMatchObject({ voice: otherVoice, rate: .95, text: "接下来确认当前阻塞" })
    unmount()
    const restored = renderHook(() => useMeetingHostSpeech({ ...initial, announceWelcome: false }))
    expect(restored.result.current.voiceURI).toBe("yaoyao")
    expect(restored.result.current.rate).toBe(.95)
    expect(synthesis.speak).toHaveBeenCalledTimes(3)
  })

  it("refreshes late browser voices without replay and falls back when the saved voice is unavailable", () => {
    window.localStorage.setItem("scrumflow.meeting.hostSpeech.v1", JSON.stringify({ voiceURI: "missing", rate: 1.03 }))
    synthesis.getVoices.mockReturnValue([])
    const { result, rerender, unmount } = renderHook((props: SpeechProps) => useMeetingHostSpeech(props), { initialProps: initial })
    expect(result.current.voices).toEqual([])
    synthesis.getVoices.mockReturnValue([chineseVoice, otherVoice])
    act(() => voiceListeners.forEach(listener => listener()))
    expect(result.current.voices).toHaveLength(2)
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
    rerender({ ...initial, message: message("new-agenda") })
    expect(synthesis.speak.mock.calls.at(-1)![0].voice).toBe(chineseVoice)
    unmount()
    expect(voiceListeners.size).toBe(0)
  })

  it("prevents previews while muted, recording or ended and handles corrupt preferences", () => {
    window.localStorage.setItem("scrumflow.meeting.hostSpeech.v1", "invalid json")
    const { result, rerender } = renderHook((props: SpeechProps) => useMeetingHostSpeech(props), { initialProps: initial })
    expect(result.current.rate).toBe(1.03)
    for (const props of [{ ...initial, enabled: false }, { ...initial, recording: true }, { ...initial, active: false }]) {
      rerender(props)
      expect(result.current.canPreview).toBe(false)
      act(() => result.current.preview())
    }
    expect(synthesis.speak).toHaveBeenCalledTimes(1)
  })
})
