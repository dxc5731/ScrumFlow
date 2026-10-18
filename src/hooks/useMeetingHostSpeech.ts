import { useCallback, useEffect, useRef, useState } from "react"
import type { MeetingMessage } from "../types"

const preferencesKey = "scrumflow.meeting.hostSpeech.v1"
const defaultPreferences = { voiceURI: "", rate: 1.03 }

function readPreferences() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(preferencesKey) ?? "null")
    return { voiceURI: typeof saved?.voiceURI === "string" ? saved.voiceURI : "",
      rate: typeof saved?.rate === "number" && Number.isFinite(saved.rate) ? Math.max(.8, Math.min(1.2, saved.rate)) : 1.03 }
  } catch { return defaultPreferences }
}

function selectVoice(voices: SpeechSynthesisVoice[], voiceURI: string) {
  const chinese = voices.filter(voice => /^zh/i.test(voice.lang))
  const mandarin = chinese.filter(voice => /^zh[-_]CN$/i.test(voice.lang))
  return chinese.find(voice => voice.voiceURI === voiceURI)
    ?? mandarin.find(voice => /natural|neural|online|自然/i.test(voice.name))
    ?? mandarin[0] ?? chinese[0] ?? null
}

export function prepareMeetingHostSpeech() {
  try { window.speechSynthesis?.getVoices(); window.speechSynthesis?.resume() } catch { /* 语音不可用时继续文字会议。 */ }
}

export function useMeetingHostSpeech({ sessionId, message, enabled, active, recording, announceWelcome = false }: {
  sessionId: string; message?: MeetingMessage; enabled: boolean; active: boolean; recording: boolean; announceWelcome?: boolean
}) {
  const supported = typeof window !== "undefined" && !!window.speechSynthesis && typeof window.SpeechSynthesisUtterance === "function"
  const [speaking, setSpeaking] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState("")
  const [preferences, setPreferences] = useState(readPreferences)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const lastMessage = useRef<string | null>(announceWelcome ? null : message?.id ?? null)
  const lastSession = useRef(sessionId)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const speakingRef = useRef(false)
  const watchdog = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const cancel = useCallback(() => {
    clearTimeout(watchdog.current)
    const utterance = utteranceRef.current
    utteranceRef.current = null
    if (utterance) {
      utterance.onstart = null; utterance.onend = null; utterance.onerror = null
      try { window.speechSynthesis?.cancel() } catch { /* 文字记录继续可用。 */ }
    }
    speakingRef.current = false
    setSpeaking(false)
    setPreviewing(false)
  }, [])

  useEffect(() => {
    if (!supported) return
    const synthesis = window.speechSynthesis
    const refresh = () => {
      try { setVoices(synthesis.getVoices().filter(voice => /^zh/i.test(voice.lang))) } catch { /* 保留文字会议。 */ }
    }
    refresh()
    synthesis.addEventListener?.("voiceschanged", refresh)
    return () => synthesis.removeEventListener?.("voiceschanged", refresh)
  }, [supported])

  useEffect(() => {
    try { window.localStorage.setItem(preferencesKey, JSON.stringify(preferences)) } catch { /* 隐私模式下仍可在本次会议使用。 */ }
  }, [preferences])

  const setVoiceURI = useCallback((voiceURI: string) => {
    cancel()
    setPreferences(current => ({ ...current, voiceURI }))
  }, [cancel])
  const setRate = useCallback((rate: number) => {
    if (!Number.isFinite(rate)) return
    cancel()
    setPreferences(current => ({ ...current, rate: Math.max(.8, Math.min(1.2, rate)) }))
  }, [cancel])

  useEffect(() => {
    if (!active || !enabled || recording) cancel()
  }, [active, enabled, recording, cancel])

  const speak = useCallback((text: string, preview = false) => {
    cancel()
    if (!active || !enabled || recording || !supported) return
    try {
      const synthesis = window.speechSynthesis
      const utterance = new window.SpeechSynthesisUtterance(text)
      utterance.voice = selectVoice(synthesis.getVoices(), preferences.voiceURI)
      utterance.lang = utterance.voice?.lang ?? "zh-CN"
      utterance.rate = preferences.rate
      utteranceRef.current = utterance
      speakingRef.current = true; setSpeaking(true); setPreviewing(preview); setError("")
      const finish = () => {
        if (utteranceRef.current !== utterance) return
        clearTimeout(watchdog.current)
        utteranceRef.current = null; speakingRef.current = false; setSpeaking(false); setPreviewing(false)
      }
      utterance.onstart = () => { if (utteranceRef.current === utterance) clearTimeout(watchdog.current) }
      utterance.onend = finish
      utterance.onerror = () => {
        if (utteranceRef.current !== utterance) return
        finish(); setError("语音暂不可用，主持消息已保留为文字")
      }
      watchdog.current = setTimeout(() => {
        if (utteranceRef.current !== utterance) return
        cancel(); setError("浏览器未开始播报，可关闭后重新开启语音；文字会议可继续")
      }, 3000)
      synthesis.resume()
      synthesis.speak(utterance)
    } catch {
      cancel(); setError("语音暂不可用，主持消息已保留为文字")
    }
  }, [active, enabled, recording, supported, cancel, preferences])

  useEffect(() => {
    if (lastSession.current !== sessionId) {
      lastSession.current = sessionId
      lastMessage.current = message?.id ?? null
      cancel(); setError(""); return
    }
    if (!message || lastMessage.current === message.id) return
    lastMessage.current = message.id
    // 静音、历史记录及成员发言时只保留文字，不积压待播放音频。
    speak(message.content)
  }, [sessionId, message, speak, cancel])

  useEffect(() => {
    window.addEventListener("pagehide", cancel)
    window.addEventListener("beforeunload", cancel)
    return () => { window.removeEventListener("pagehide", cancel); window.removeEventListener("beforeunload", cancel); cancel() }
  }, [cancel])

  return { supported, speaking, error, cancel, isSpeaking: useCallback(() => speakingRef.current, []),
    voices, voiceURI: preferences.voiceURI, rate: preferences.rate, setVoiceURI, setRate, previewing,
    canPreview: supported && active && enabled && !recording,
    preview: () => speak("大家好，我是项目主持。我们先同步进展，再确认当前阻塞和下一步行动。", true) }
}
