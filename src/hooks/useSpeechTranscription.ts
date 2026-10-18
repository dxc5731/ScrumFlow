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

function detachRecognition(recognition: Recognition) {
  recognition.onresult = null
  recognition.onerror = null
  recognition.onend = null
}

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

  const release = useCallback(() => {
    wantedRef.current = false
    const recognition = recognitionRef.current
    recognitionRef.current = null
    if (!recognition) return
    detachRecognition(recognition)
    try { recognition.abort() } catch { /* 浏览器可能已经释放识别实例。 */ }
  }, [])

  // 切换会议、发言人或离开对话时取消，丢弃尚未完成的识别结果。
  const cancel = useCallback(() => {
    release()
    setListening(false)
    setInterim("")
  }, [release])

  const stop = useCallback(() => {
    wantedRef.current = false
    setListening(false)
    setInterim("")
    // 手动停止仍接收该实例在 onend 前返回的最后一句完整结果。
    try { recognitionRef.current?.stop() } catch { cancel() }
  }, [cancel])

  const start = useCallback(() => {
    const Constructor = recognitionConstructor()
    if (!Constructor) { setError("当前浏览器不支持语音识别，请使用 Chrome、Edge 或 Safari"); return }
    if (wantedRef.current) return
    release()
    setError("")
    setInterim("")
    try {
      const recognition = new Constructor()
      // 每次录音固定使用开始时的回调，避免最后一句归到新的会议或发言人。
      const onSessionFinal = onFinalRef.current
      recognition.lang = lang
      recognition.continuous = true
      recognition.interimResults = true
      recognition.onresult = (event) => {
        if (recognitionRef.current !== recognition) return
        let pending = ""
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index]
          const text = result[0]?.transcript.trim() ?? ""
          if (!text) continue
          if (result.isFinal) onSessionFinal(text)
          else pending += text
        }
        if (wantedRef.current) setInterim(pending)
      }
      recognition.onerror = (event) => {
        if (recognitionRef.current !== recognition) return
        // no-speech / aborted 属于正常情况，onend 会自动重启
        if (event.error === "no-speech" || event.error === "aborted") return
        setError(errorMessages[event.error] ?? `语音识别出错：${event.error}`)
        cancel()
      }
      recognition.onend = () => {
        if (recognitionRef.current !== recognition) return
        setInterim("")
        // 浏览器会在静音一段时间后自动结束识别，仍处于录音状态时重新开始
        if (wantedRef.current) {
          try { recognition.start(); return } catch {
            cancel()
            setError("语音识别已中断，请重新开始语音记录")
            return
          }
        }
        recognitionRef.current = null
        detachRecognition(recognition)
        setListening(false)
      }
      recognitionRef.current = recognition
      wantedRef.current = true
      recognition.start()
      setListening(true)
    } catch {
      cancel()
      setError("无法启动语音识别，请重试")
    }
  }, [lang, release, cancel])

  // 组件卸载时停止识别，避免后台继续占用麦克风
  useEffect(() => release, [release])

  return { supported, listening, interim, error, start, stop, cancel, clearError: () => setError("") }
}
