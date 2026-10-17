import { useCallback, useEffect, useRef, useState } from "react"

// Web Speech API 在 TS 的 DOM lib 中没有完整类型，这里只声明用到的部分。
interface RecognitionAlternative { transcript: string }
interface RecognitionResult { isFinal: boolean; length: number; [index: number]: RecognitionAlternative }
interface RecognitionEvent { resultIndex: number; results: { length: number; [index: number]: RecognitionResult } }
interface RecognitionErrorEvent { error: string }
interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: RecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
type RecognitionConstructor = new () => Recognition

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null
  const scope = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

const errorMessages: Record<string, string> = {
  "not-allowed": "麦克风权限被拒绝，请在浏览器地址栏允许使用麦克风",
  "service-not-allowed": "浏览器不允许使用语音识别服务（需 HTTPS 或 localhost）",
  network: "语音识别服务连接失败。Chrome 需要访问 Google 服务，可改用 Edge / Safari 或检查网络",
  "audio-capture": "没有检测到可用的麦克风",
  "language-not-supported": "当前浏览器不支持中文语音识别",
}

/**
 * 基于浏览器 Web Speech API 的连续语音转写。
 * 每识别完一句话调用一次 onFinal；识别中的临时文字通过 interim 返回用于实时字幕。
 */
export function useSpeechTranscription(onFinal: (text: string) => void, lang = "zh-CN") {
  const supported = recognitionConstructor() !== null
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState("")
  const [error, setError] = useState("")
  const recognitionRef = useRef<Recognition | null>(null)
  const wantedRef = useRef(false)
  const onFinalRef = useRef(onFinal)
  useEffect(() => { onFinalRef.current = onFinal }, [onFinal])

  const stop = useCallback(() => {
    wantedRef.current = false
    recognitionRef.current?.stop()
    setListening(false)
    setInterim("")
  }, [])

  const start = useCallback(() => {
    const Constructor = recognitionConstructor()
    if (!Constructor) { setError("当前浏览器不支持语音识别，请使用 Chrome、Edge 或 Safari"); return }
    if (wantedRef.current) return
    const recognition = new Constructor()
    recognition.lang = lang
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (event) => {
      let pending = ""
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const text = result[0]?.transcript.trim() ?? ""
        if (!text) continue
        if (result.isFinal) onFinalRef.current(text)
        else pending += text
      }
      setInterim(pending)
    }
    recognition.onerror = (event) => {
      // no-speech / aborted 属于正常情况，onend 会自动重启
      if (event.error === "no-speech" || event.error === "aborted") return
      setError(errorMessages[event.error] ?? `语音识别出错：${event.error}`)
      wantedRef.current = false
    }
    recognition.onend = () => {
      // 浏览器会在静音一段时间后自动结束识别，仍处于录音状态时重新开始
      if (wantedRef.current) {
        try { recognition.start(); return } catch { wantedRef.current = false }
      }
      setListening(false)
      setInterim("")
    }
    recognitionRef.current = recognition
    wantedRef.current = true
    setError("")
    try {
      recognition.start()
      setListening(true)
    } catch {
      wantedRef.current = false
      setError("无法启动语音识别，请重试")
    }
  }, [lang])

  // 组件卸载时停止识别，避免后台继续占用麦克风
  useEffect(() => () => {
    wantedRef.current = false
    recognitionRef.current?.abort()
  }, [])

  return { supported, listening, interim, error, start, stop, clearError: () => setError("") }
}
