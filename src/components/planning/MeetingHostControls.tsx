import type { ReactNode } from "react"
import { ArrowRight, Check, Clock3, Sparkles, Volume2, VolumeX } from "lucide-react"
import { currentMeetingAgenda, formatMeetingTime, meetingAgenda, meetingClock, meetingTemplate } from "../../agents/meetingFacilitation"
import { prepareMeetingHostSpeech } from "../../hooks/useMeetingHostSpeech"
import { useProjectStore } from "../../store/projectStore"
import type { MeetingSession } from "../../types"
import "./MeetingHost.css"

export default function MeetingHostControls({ session, now, interactive, closing, busy, speaking, voiceSupported, voiceError, actions, reviewing }: {
  session: MeetingSession; now: number; interactive: boolean; closing?: boolean; busy: boolean; speaking: boolean; voiceSupported: boolean; voiceError: string; actions?: ReactNode; reviewing?: boolean
}) {
  const state = useProjectStore()
  const host = session.facilitation, template = meetingTemplate(session)
  if (!host || !template) return null
  const clock = meetingClock(session, now), agenda = meetingAgenda(session), current = currentMeetingAgenda(session)
  const progressed = (status: string) => ["discussed", "recorded", "decided"].includes(status)
  const completed = agenda.filter(item => progressed(item.topic.status)).length
  const sprint = (session.outcomeSnapshot?.context.sprints ?? state.sprints)[host.sprintId ?? ""]
  const live = interactive && !closing && session.status === "active"
  return <section className={`meeting-host-controls is-${clock.phase}`} aria-label="Scrum 会议主持控制">
    <div className="meeting-host-bar">
      <div className="meeting-host-identity"><Sparkles size={18} /><h1 title={session.title}>{session.title}</h1>{session.title !== template.name && <span className="meeting-type-label">{template.name}</span>}<span className="meeting-host-sprint" title={sprint?.goal}>{sprint?.name ?? "未关联 Sprint"}</span><span className="meeting-host-state"><i />{session.status === "ended" ? "已结束" : !interactive ? "历史记录" : closing ? "结束前确认" : reviewing ? "主持人核对话题" : speaking ? "主持人播报中" : "AI 主持中"}</span></div>
      <div className="meeting-host-clock" role="timer" aria-label="会议时钟" title={`${clock.demo ? "演示计时 ×30；" : ""}实际用时 ${formatMeetingTime(clock.actualMs)}；${clock.phase === "overtime" ? "已到预定时间，可延期或结束" : "已进行 " + formatMeetingTime(clock.elapsedMs)}`}><Clock3 size={15} /><strong>{session.status === "ended" ? "结束时" : ""}{clock.phase === "overtime" ? "超时 +" : "剩余 "}{formatMeetingTime(clock.phase === "overtime" ? clock.overtimeMs : clock.remainingMs)}</strong><small> / {formatMeetingTime(clock.budgetMs)}</small>{clock.demo && <span className="meeting-demo-badge">演示 ×30</span>}</div>
      <div className="meeting-host-tools"><button type="button" role="switch" aria-checked={host.voiceEnabled} aria-label="主持人语音播报" disabled={!interactive || session.status !== "active"} title={!voiceSupported ? "浏览器不支持播报，主持消息仍以文字显示" : voiceError || (host.voiceEnabled ? "关闭主持人语音播报" : "开启主持人语音播报")} onClick={() => { if (!host.voiceEnabled) prepareMeetingHostSpeech(); state.setMeetingHostVoice(session.id, !host.voiceEnabled) }}>{host.voiceEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
        {live && <button type="button" className="meeting-host-next" disabled={busy || !current} onClick={() => state.advanceMeetingAgenda(session.id)}>{!current ? "议程已完成" : agenda.at(-1)?.key === current.key ? "完成议程" : "下一议程"}<ArrowRight size={14} /></button>}
      </div>
      {actions}
    </div>
    <nav className="meeting-host-agenda" aria-label="Scrum 议程"><ol aria-label="议程进度">{agenda.map((item, index) => <li key={item.key} aria-current={item.topic.status === "active" ? "step" : undefined} className={progressed(item.topic.status) ? "is-complete" : ""}><span>{progressed(item.topic.status) ? <Check size={11} /> : index + 1}</span>{item.title}{index < agenda.length - 1 && <ArrowRight size={13} className="meeting-agenda-arrow" />}</li>)}</ol><small>{completed}/{agenda.length} 已推进</small></nav>
  </section>
}
