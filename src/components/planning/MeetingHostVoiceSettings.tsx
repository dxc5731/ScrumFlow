import { Play, Square } from "lucide-react"
import type { useMeetingHostSpeech } from "../../hooks/useMeetingHostSpeech"

function voiceLabel(voice: SpeechSynthesisVoice) {
  const names: Record<string, string> = { Huihui: "慧慧", Kangkang: "康康", Yaoyao: "瑶瑶" }
  const known = Object.entries(names).find(([name]) => voice.name.includes(`Microsoft ${name}`))
  return known ? `微软${known[1]} · ${voice.lang}` : `${voice.name} · ${voice.lang}`
}

export default function MeetingHostVoiceSettings({ speech }: { speech: ReturnType<typeof useMeetingHostSpeech> }) {
  const unavailable = speech.voiceURI && !speech.voices.some(voice => voice.voiceURI === speech.voiceURI)
  return <fieldset className="meeting-voice-settings">
    <legend>主持人声音</legend>
    <label>音色<select aria-label="主持人音色" value={speech.voiceURI} disabled={!speech.supported} onChange={event => speech.setVoiceURI(event.target.value)}>
      <option value="">自动选择中文音色</option>
      {unavailable && <option value={speech.voiceURI}>已选音色暂不可用（自动回退）</option>}
      {speech.voices.map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voiceLabel(voice)}</option>)}
    </select></label>
    <label className="meeting-voice-rate">语速<output>{speech.rate.toFixed(2)}×</output><input type="range" aria-label="主持人语速" min="0.8" max="1.2" step="0.01" value={speech.rate} disabled={!speech.supported} onChange={event => speech.setRate(Number(event.target.value))} /></label>
    <button type="button" className="meeting-voice-preview" disabled={!speech.canPreview} onClick={speech.previewing ? speech.cancel : speech.preview}>{speech.previewing ? <Square size={12} /> : <Play size={12} />}{speech.previewing ? "停止试听" : "试听声音"}</button>
    <p role={speech.error ? "status" : undefined}>{speech.error || (!speech.supported ? "浏览器不支持播报，文字会议可继续。" : !speech.canPreview ? "开启会议播报并停止录音后可试听。" : "选择会保存在此浏览器；音色由系统提供。")}</p>
  </fieldset>
}
