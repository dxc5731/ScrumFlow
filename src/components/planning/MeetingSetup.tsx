import { useEffect, useRef, useState } from "react"
import { ArrowRight, Clock3, X } from "lucide-react"
import { scrumMeetingTemplates } from "../../agents/meetingFacilitation"
import { prepareMeetingHostSpeech } from "../../hooks/useMeetingHostSpeech"
import { useProjectStore } from "../../store/projectStore"
import type { ScrumMeetingType } from "../../types"
import "./MeetingHost.css"

export default function MeetingSetup({ targetType, targetId, onStart, onClose }: {
  targetType: "project" | "story" | "sprint"; targetId: string; onStart: (id: string) => void; onClose: () => void
}) {
  const state = useProjectStore()
  const [type, setType] = useState<ScrumMeetingType>("daily")
  const [sprintId, setSprintId] = useState(targetType === "sprint" ? targetId : targetType === "story"
    ? state.stories[targetId]?.sprintId ?? "" : state.workspace.selectedSprintId ?? "")
  const [demo, setDemo] = useState(false)
  const [voice, setVoice] = useState(true)
  const [error, setError] = useState("")
  const dialogRef = useRef<HTMLDialogElement>(null)
  const starting = useRef(false)
  const template = scrumMeetingTemplates[type]
  useEffect(() => { dialogRef.current?.showModal() }, [])
  const start = () => {
    if (starting.current) return
    starting.current = true
    try {
      if (voice) prepareMeetingHostSpeech()
      const session = state.createMeeting(targetType, targetId, { meetingType: type, sprintId: sprintId || null, demoSpeed: demo ? 30 : 1, voiceEnabled: voice })
      onStart(session.id)
    } catch (cause) { starting.current = false; setError(cause instanceof Error ? cause.message : "会议未能创建，请重试") }
  }
  return <dialog ref={dialogRef} className="meeting-setup" aria-labelledby="meeting-setup-title" onCancel={onClose}>
    <div className="meeting-setup-heading"><div><h2 id="meeting-setup-title">开启一场 Scrum 会议</h2><p>选择会议目标，项目主持将带领大家逐项推进。</p></div><button type="button" className="meeting-host-icon" aria-label="取消创建会议" onClick={onClose}><X size={18} /></button></div>
    <div className="meeting-type-options" role="group" aria-label="会议类型">{Object.entries(scrumMeetingTemplates).map(([key, item]) => <button type="button" key={key} aria-pressed={type === key} onClick={() => setType(key as ScrumMeetingType)}><strong>{item.name}</strong><span><Clock3 size={13} />{item.minutes} 分钟</span></button>)}</div>
    <section className="meeting-setup-agenda" aria-label="预设议程"><h3>{template.name}</h3><p>{template.goal}</p><ol>{template.agenda.map(item => <li key={item.key}>{item.title}</li>)}</ol></section>
    <label className="meeting-setup-sprint">关联 Sprint<select aria-label="关联 Sprint" value={sprintId} disabled={targetType !== "project"} onChange={event => setSprintId(event.target.value)}><option value="">不关联 Sprint</option>{Object.values(state.sprints).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <div className="meeting-setup-settings"><label><input type="checkbox" checked={voice} onChange={event => setVoice(event.target.checked)} />主持人语音播报</label><label><input type="checkbox" checked={demo} onChange={event => setDemo(event.target.checked)} />演示模式 · 计时 ×30</label></div>
    {demo && <p className="meeting-demo-note" role="status">{template.minutes} 分钟议程约 {template.minutes * 2} 秒走完。加速仅用于演示，实际会议用时单独保存。</p>}
    {error && <p role="alert" className="meeting-setup-error">{error}</p>}
    <footer><button type="button" onClick={onClose}>取消</button><button type="button" className="meeting-host-primary" onClick={start}>开始会议 <ArrowRight size={15} /></button></footer>
  </dialog>
}
