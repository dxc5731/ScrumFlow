import { useState, type ReactNode } from "react"
import { ArrowRight, CheckCircle2, ChevronDown, Clock3, FileStack, MessageCircle, ShieldAlert, Sparkles, Users } from "lucide-react"
import type { ProjectDataState } from "../../types"
import { readableMeeting } from "../../agents/meetingPresentation"
import { ensureMeetingNarrative, narrativeFingerprint } from "../../agents/meetingNarrative"
import { meetingSourceIds } from "../../agents/meetingSource"
import { agentName } from "../../agents/meetingConversation"
import MeetingSourceTrace from "./MeetingSourceTrace"
import MeetingMaterials from "./MeetingMaterials"
import { generatedRecommendationKeys, recommendMeetingMaterials } from "../../agents/materialRecommendations"

export default function MeetingMinutesView({ state, sessionId, onBack, onReview, onEnd, onMaterials, readOnly = false, allowMaterials = !readOnly, closing = false, busy = false, onBusyChange }: {
  state: ProjectDataState; sessionId: string; onBack: () => void; onReview: () => void; onEnd: () => void
  readOnly?: boolean; allowMaterials?: boolean; closing?: boolean; busy?: boolean; onBusyChange?: (busy: boolean) => void; onMaterials?: () => void
}) {
  const [expanded, setExpanded] = useState(false), [summarizing, setSummarizing] = useState(false), [error, setError] = useState("")
  const session = state.meetingSessions[sessionId], view = readableMeeting(state, session)
  const sprint = state.sprints[session.memory?.focusSprintId ?? state.stories[session.targetId]?.sprintId ?? state.workspace.selectedSprintId]
  const trace = (text: string, ids: string[] = []) => <MeetingSourceTrace state={state} ids={meetingSourceIds(state, session, text, ids)}>{text}</MeetingSourceTrace>
  const activeActions = view.actions.filter(a => a.tone !== "rejected")
  const summaryNodes: ReactNode[] = []
  const text = view.summary.join(" "), references = (session.narrative?.references ?? []).filter(ref => ref.text.length <= 50).slice(0, 3)
  let cursor = 0
  for (const ref of [...references].sort((a, b) => text.indexOf(a.text) - text.indexOf(b.text))) {
    const index = text.indexOf(ref.text, cursor)
    if (index < cursor) continue
    summaryNodes.push(text.slice(cursor, index), <MeetingSourceTrace key={`${index}-${ref.text}`} state={state} ids={meetingSourceIds(state, session, ref.text, ref.sourceMessageIds)}>{ref.text}</MeetingSourceTrace>)
    cursor = index + ref.text.length
  }
  summaryNodes.push(text.slice(cursor))
  const generated = generatedRecommendationKeys(state, session)
  const remaining = recommendMeetingMaterials(state, session).filter(item => !generated.has(item.key)).length
  const summarize = async () => {
    if (!allowMaterials || summarizing || busy) return
    setSummarizing(true); onBusyChange?.(true); setError("")
    try { await ensureMeetingNarrative(sessionId) } catch (cause) { setError(cause instanceof Error ? cause.message : "摘要暂未完成") } finally { setSummarizing(false); onBusyChange?.(false) }
  }
  const stale = session.narrative && session.narrative.fingerprint !== narrativeFingerprint(state, session)
  return <main className="meeting-minutes-view meeting-minutes-readable">
    <div className="meeting-minutes-header"><div><h2>{session.title}</h2><p>{sprint?.name ?? state.project.name} · {new Date(session.createdAt).toLocaleDateString("zh-CN", { month: "long", day: "numeric" })} · {session.status === "ended" ? "会议已结束" : readOnly ? "历史记录 · 未结束" : closing ? "结束前确认" : "会议进行中"}</p></div><button type="button" disabled={summarizing || busy} onClick={onBack}>返回讨论 <ArrowRight size={14} /></button></div>
    <div className="meeting-minutes-metrics"><span><CheckCircle2 size={19} /><strong>{view.applied}</strong> 项已执行</span><span><Clock3 size={19} /><strong>{view.pending}</strong> 项待确认</span><span><ShieldAlert size={19} /><strong>{view.attention.length}</strong> 项需关注</span></div>
    <section className="meeting-narrative"><div className="meeting-narrative-heading"><h3><Sparkles size={18} />会议摘要</h3>{allowMaterials && (!session.narrative || stale) && <button type="button" disabled={summarizing || busy} onClick={() => void summarize()}>{summarizing ? "正在阅读整场会议…" : stale ? "更新摘要" : "整理完整会议摘要"}</button>}</div><p>{summaryNodes}</p>{session.narrative && <small>根据真实讨论整理 · 下划线内容可悬停溯源</small>}{error && <p role="alert" className="meeting-material-error">{error}</p>}</section>
    <div className="meeting-minutes-reading-grid"><section><h3><CheckCircle2 size={18} />我们已经决定</h3>{view.decisions.length ? view.decisions.slice(0, 2).map((item, index) => <p className="meeting-minutes-decision" key={index}>{trace(item)}</p>) : <p className="meeting-minutes-empty">还没有确认最终决定，下方工作保留为建议。</p>}</section>
      <section><h3><ShieldAlert size={18} />还需要关注</h3>{view.attention.length ? <ul>{view.attention.slice(0, 2).map((item, index) => <li key={index}>{trace(item)}</li>)}</ul> : <p className="meeting-minutes-empty">本次没有新增待核实信息。</p>}</section></div>
    <section><h3><Users size={18} />接下来谁做什么</h3><div className="meeting-readable-actions">{activeActions.slice(0, 3).map(action => <article key={action.id} className={`meeting-readable-action meeting-readable-action--${action.tone}`}><span className="meeting-readable-action-status">{action.tone === "done" ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}{action.status}</span><h4>{trace(action.title, action.sourceMessageIds)}</h4><p>{trace(action.member, action.sourceMessageIds)}{action.estimate !== null ? ` · 约 ${action.estimate}h` : ""}</p></article>)}</div>{!view.actions.length && <p className="meeting-minutes-empty">本次没有正式行动项。</p>}</section>
    <button type="button" className="meeting-minutes-expand" aria-expanded={expanded} aria-controls="meeting-full-minutes" onClick={() => setExpanded(!expanded)}>{expanded ? "收起完整纪要" : `展开完整纪要${activeActions.length > 3 ? ` · 另有 ${activeActions.length - 3} 项行动` : ""}`}<ChevronDown size={16} /></button>
    <div id="meeting-full-minutes" className={`meeting-minutes-collapse ${expanded ? "is-expanded" : ""}`} inert={!expanded}><div>
      {view.decisions.length > 2 && <section><h3>更多会议结论</h3>{view.decisions.slice(2).map((item, index) => <p key={index}>{trace(item)}</p>)}</section>}
      {view.attention.length > 2 && <section><h3>更多风险与待确认</h3><ul>{view.attention.slice(2).map((item, index) => <li key={index}>{trace(item)}</li>)}</ul></section>}
      {activeActions.length > 3 && <section><h3>其余行动项</h3><div className="meeting-readable-actions">{activeActions.slice(3).map(action => <article key={action.id} className={`meeting-readable-action meeting-readable-action--${action.tone}`}><span className="meeting-readable-action-status">{action.status}</span><h4>{trace(action.title, action.sourceMessageIds)}</h4><p>{trace(action.member, action.sourceMessageIds)}{action.estimate !== null ? ` · 约 ${action.estimate}h` : ""}</p></article>)}</div></section>}
      {view.rejected > 0 && <section className="meeting-rejected-actions"><h3>本次未采用的 {view.rejected} 项建议</h3><div className="meeting-readable-actions">{view.actions.filter(a => a.tone === "rejected").map(a => <article key={a.id} className="meeting-readable-action meeting-readable-action--rejected"><span className="meeting-readable-action-status">本次未采用</span><h4>{trace(a.title, a.sourceMessageIds)}</h4></article>)}</div></section>}
      <section className="meeting-minutes-changes"><h3><CheckCircle2 size={18} />项目实际发生了什么变化</h3>{view.changes.map((item, index) => <p key={index}>{trace(item)}</p>)}<details><summary>查看变更详情</summary><ul>{view.minutes.executionResults.map((item, index) => <li key={index}>{item}</li>)}</ul></details></section>
      <section className="meeting-minutes-discussion"><h3><MessageCircle size={18} />讨论记录</h3><p>{view.participants.join("、")} · {view.agents.join("、")}</p><div className="meeting-discussion-tags">{view.minutes.topics.map((item, index) => <span key={index}>{item}</span>)}</div><details><summary>查看全部原始讨论与依据</summary>{session.messageIds.map(id => state.meetingMessages[id]).filter(m => m && m.senderType !== "system").map(m => <div className="meeting-minutes-transcript" key={m.id}><strong>{state.members[m.senderId]?.name ?? agentName(m.senderId)}</strong><p>{m.content}</p></div>)}</details></section>
    </div></div>
    <section className="meeting-minutes-assets"><details><summary><FileStack size={18} />本次会议成果 · 查看材料与图表</summary>{view.assetIds.length ? <MeetingMaterials ids={view.assetIds} state={state} /> : <p className="meeting-minutes-empty">生成推荐成果后，就能在这里预览和下载。</p>}</details>{allowMaterials && remaining > 0 && onMaterials && <div className="meeting-material-reminder"><Sparkles size={14} /><span>本次会议还有 {remaining} 项成果可整理</span><button type="button" disabled={summarizing || busy} onClick={onMaterials}>查看建议 →</button></div>}</section>
    {view.pending > 0 && <div className="meeting-minutes-pending"><strong>还有 {view.pending} 项行动需要确认</strong>{!readOnly && session.status === "active" && <><button type="button" disabled={summarizing || busy} onClick={onReview}>继续审核</button>{closing && <button type="button" disabled={summarizing || busy} onClick={onEnd}>保留待处理并结束会议</button>}</>}</div>}
    {!readOnly && closing && session.status === "active" && view.pending === 0 && <button className="meeting-minutes-end" type="button" disabled={summarizing || busy} onClick={onEnd}>确认结束会议</button>}
  </main>
}
