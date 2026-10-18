import { useState } from "react"
import { ArrowUpRight, CheckCircle2, Download, FileText, MessageCircle, Sparkles } from "lucide-react"
import type { MeetingSession, ProjectDataState } from "../../types"
import { hostChoiceLabels, hostEventLabels, meetingAuditDiff, meetingInsights } from "../../agents/meetingOutcomes"
import { formatMeetingTime } from "../../agents/meetingFacilitation"
import { reportTime, reportValue } from "../../agents/meetingReport"
import { generateMeetingMaterials } from "../../agents/materialOrganizer"
import { buildMeetingContext } from "../../agents/meetingContext"
import { useProjectStore } from "../../store/projectStore"
import { downloadAssetFile } from "../assets/AssetFilePreviewDialog"
import { meetingArtifactMetadata } from "../../agents/materialIdentity"
import MaterialSuggestions from "./MaterialSuggestions"
import MeetingMaterials from "./MeetingMaterials"
import MeetingEvidenceCharts from "./MeetingEvidenceCharts"
import "./MeetingInsights.css"

export default function MeetingInsights({ state, session, onLocate, onProposal, onReview, busy = false, onBusyChange }: {
  state: ProjectDataState; session: MeetingSession; onLocate?: (id: string) => void; onProposal?: (id: string) => void
  onReview: () => void; busy?: boolean; onBusyChange?: (busy: boolean) => void
}) {
  const i = meetingInsights(state, session)
  const [exporting, setExporting] = useState(false), [error, setError] = useState("")
  const maxMessages = Math.max(1, ...i.members.map(m => m.total))
  const dist = [ { key: "executed", label: "执行成功", count: i.counts.executed }, { key: "pending", label: "待确认", count: i.counts.pending },
    { key: "accepted", label: "采纳未执行", count: i.counts.acceptedUnexecuted }, { key: "rejected", label: "已拒绝", count: i.counts.rejected },
    { key: "reused", label: "复用结果", count: i.counts.reused } ]
  const files = Object.values(state.assets).filter(a => { const meta = meetingArtifactMetadata(a); return meta?.id === session.id && meta.key === "meeting-report" }).map(a => a.id)
  const exportReport = async () => {
    if (exporting || busy) return
    setExporting(true); onBusyChange?.(true); setError("")
    try {
      const current = useProjectStore.getState(), s = current.meetingSessions[session.id]
      const result = await generateMeetingMaterials(current, s, buildMeetingContext(current, s), "生成 Scrum 智能会议报告")
      const asset = result.artifactIds?.map(id => useProjectStore.getState().assets[id]).find(a => a.name.endsWith(".docx"))
      if (asset) await downloadAssetFile(asset)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "报告导出失败，请重试") }
    finally { setExporting(false); onBusyChange?.(false) }
  }
  const timeline = i.events.flatMap(m => [{ id: m.id, at: m.createdAt, label: hostEventLabels[m.hostEvent!.kind], text: m.content, message: m, feedback: false },
    ...(m.hostEvent!.resolution ? [{ id: `${m.id}-feedback`, at: m.hostEvent!.resolution.at, label: hostChoiceLabels[m.hostEvent!.resolution.choice],
      text: `用户反馈：${hostChoiceLabels[m.hostEvent!.resolution.choice]}`, message: m, feedback: true }] : [])]).sort((a, b) => a.at.localeCompare(b.at))
  return <div className="meeting-insights" data-testid="meeting-insights">
    <div className="insights-heading"><div><h2>会议洞察</h2><p>{i.sprint?.name ?? "未关联 Sprint"} · {session.status === "ended" ? "本次会议成果与执行复盘" : "会议进行中 · 阶段记录"}</p></div>
      <div className="insights-actions"><button type="button" disabled={busy || exporting} onClick={onReview}>查看待处理行动 <ArrowUpRight size={14} /></button><button type="button" className="insights-primary" disabled={busy || exporting} onClick={() => void exportReport()}><Download size={15} />{exporting ? "正在整理报告…" : "导出会议报告"}</button></div></div>
    {error && <p className="meeting-material-error" role="alert">{error}</p>}
    <div className="insights-overview" aria-label="会议成果概览">
      <div><span>{session.demo ? "演示时间线用时" : "实际会议用时"}</span><strong>{i.actualMs === null ? "暂无记录" : formatMeetingTime(i.actualMs)}</strong><small>{i.plannedMs === null ? "计划暂无记录" : `计划 ${formatMeetingTime(i.plannedMs)}（含延期）`}</small></div>
      <div><span>参与成员</span><strong>{i.members.length}<em>人</em></strong><small>按已提交成员消息统计</small></div>
      <div><span>已推进议程</span><strong>{i.progressed}<em>/ {i.agenda.length}</em></strong><small>有讨论或记录的阶段</small></div>
      <div><span>AI 主持干预</span><strong>{i.events.length}<em>次</em></strong><small>{i.counts.deviation} 次纠偏 · {i.blockerIds.length} 项阻塞跟进</small></div>
      <div><span>实际执行行动</span><strong>{i.counts.executed}<em>/ {i.actions.length}</em></strong><small>{i.counts.pending} 条待确认 · {i.counts.accepted} 条已采纳</small></div>
    </div>
    <div className="insights-context"><span>{session.outcomeSnapshot ? `业务事实冻结于 ${reportTime(session.outcomeSnapshot.capturedAt)}` : "历史会议无结束快照，项目对象仅作当前参考"}</span>
      {i.clock.demo ? <span className="insights-demo">演示 ×30 · 演示计时 {formatMeetingTime(session.facilitation?.demoElapsedMs ?? i.clock.elapsedMs)} · 演示超时 +{formatMeetingTime(session.facilitation?.demoOvertimeMs ?? i.clock.overtimeMs)} · 不作真实超时判断</span>
        : i.plannedMs !== null && <span>{i.clock.overtimeMs ? `${session.demo ? "演示时间线超时" : "真实超时"} +${formatMeetingTime(i.clock.overtimeMs)}` : "未超过计划时长"}</span>}
      {i.sprintOverdue && <span>该 Sprint 计划期已过（{i.sprint?.endDate}）</span>}</div>
    <MeetingEvidenceCharts state={state} session={session} />
    <div className="insights-charts">
      <section className="insights-panel"><h3>议程推进</h3><p className="insights-caption">阶段记录 · 不代表验收完成</p><ol className="insights-agenda">{i.agenda.map((t, n) => {
        const done = ["discussed", "recorded", "decided"].includes(t.status)
        return <li key={t.id} className={done ? "is-progressed" : ""}><span>{done ? <CheckCircle2 size={17} /> : n + 1}</span><div><strong>{t.title}</strong><small>{({ discussed: "已讨论", recorded: "已记录", decided: "已决定", pending: "未开始", active: "讨论中", deferred: "已暂缓", unresolved: "待核实" })[t.status]}</small></div>{t.createdFromMessageId && <button type="button" aria-label={`定位议程 ${t.title}`} onClick={() => onLocate?.(t.createdFromMessageId)}><ArrowUpRight size={14} /></button>}</li>
      })}</ol>{!i.agenda.length && <p className="insights-empty">暂无议程记录</p>}<div className="insights-agenda-track" role="img" aria-label={`已推进 ${i.progressed} / ${i.agenda.length}`}><span style={{ width: `${i.agenda.length ? i.progressed / i.agenda.length * 100 : 0}%` }} /></div></section>
      <section className="insights-panel"><h3>成员参与分布</h3><p className="insights-caption">消息条数，语音按转写记录计数</p><div className="insights-member-chart" role="img" aria-label="成员文本、语音及来源未记录消息数量">{i.members.map(m => <div key={m.id} className="insights-member-row"><span>{m.name}</span><div className="insights-member-track"><div style={{ width: `${m.total / maxMessages * 100}%` }}>
        {[{ key: "text", count: m.text }, { key: "voice", count: m.voice }, { key: "unknown", count: m.unknown }].map(v => v.count > 0 && <span key={v.key} className={`insights-bar--${v.key}`} style={{ width: `${v.count / m.total * 100}%` }} />)}</div></div><strong title={`文本 ${m.text}，语音转写 ${m.voice}，来源未记录 ${m.unknown}`}>{m.total}</strong><small>文本 {m.text} · 语音 {m.voice}{m.unknown ? ` · 未记录 ${m.unknown}` : ""}</small></div>)}</div>
        {!i.members.length && <p className="insights-empty">暂无成员发言记录</p>}<div className="insights-legend"><span><i className="insights-bar--text" />文本</span><span><i className="insights-bar--voice" />语音转写</span><span><i className="insights-bar--unknown" />来源未记录</span></div><p className="insights-footnote">不统计 AI 消息，不推算发声时长或成员贡献。</p></section>
      <section className="insights-panel"><h3>决策与行动</h3><p className="insights-caption">{i.actions.length} 条本次产生的建议 · {i.counts.accepted} 条已采纳</p><div className="insights-distribution" role="img" aria-label={dist.map(d => `${d.label} ${d.count}`).join("，")}>{dist.map(d => d.count > 0 && <span key={d.key} className={`insights-status--${d.key}`} style={{ width: `${d.count / i.actions.length * 100}%` }} title={`${d.label} ${d.count}`} />)}</div><dl className="insights-status-list">{dist.map(d => <div key={d.key}><dt><i className={`insights-status--${d.key}`} />{d.label}</dt><dd>{d.count}</dd></div>)}</dl>{i.linkedCount > 0 && <p className="insights-footnote">另关联 {i.linkedCount} 份外部或来源不明建议，未计入本次成果。</p>}<p className="insights-footnote">已采纳不等于已执行；执行成功需有对应审计。</p></section>
    </div>
    <div className="insights-detail-grid"><section className="insights-panel"><div className="insights-section-title"><h3><Sparkles size={17} />AI 主持行动回顾</h3><small>{i.counts.guidance} 次引导 · {i.counts.time} 次时间提醒</small></div><div className="insights-feedback">纠偏反馈：返回议程 {i.counts.returned} · 继续讨论 {i.counts.continued} · 误判 {i.counts.incorrect}</div>
      <ol className="insights-timeline">{timeline.map(row => <li key={row.id}><time dateTime={row.at}>{new Date(row.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</time><div><button type="button" className="insights-trace" onClick={() => onLocate?.(row.message.id)}>{row.label} <ArrowUpRight size={13} /></button><p>{row.text}</p>
        {!row.feedback && <div className="insights-source-links">{(row.message.hostEvent?.sourceMessageIds ?? []).map((id, index) => <button type="button" key={id} onClick={() => onLocate?.(id)}>发言依据 {index + 1}</button>)}{[...(row.message.hostEvent?.taskIds ?? []), ...(row.message.hostEvent?.riskIds ?? [])].map(id => <span key={id}>{id}</span>)}</div>}</div></li>)}</ol>{!timeline.length && <p className="insights-empty">此会议暂无可追溯主持事件</p>}</section>
      <section className="insights-panel"><div className="insights-section-title"><h3><CheckCircle2 size={17} />关键行动成果</h3><small>人工审核 → 实际执行</small></div>{i.actions.map(a => <article className="insights-action" key={`${a.proposalId}-${a.actionId}`}><div><span className={`insights-action-status insights-status--${a.bucket}`}>{a.label}</span>{a.afterMeeting && <small>含会后跟进</small>}</div><h4>{a.title}</h4><small>{a.targetId}</small><p>{a.suggestion}</p><p className="insights-footnote">{a.reason}</p><p className="insights-footnote">审核人：{a.reviewer} · {a.reviewedAt ? reportTime(a.reviewedAt) : "审核时间待确认"}</p>{!a.executed && a.bucket !== "rejected" && <p className="insights-footnote">建议负责人：{a.owner} · 交付日期：{a.deadline}</p>}<button type="button" className="insights-trace" onClick={() => onProposal?.(a.proposalId)}>查看原始 Proposal <ArrowUpRight size={13} /></button>
        {a.history.length > 0 && <details><summary>实际变更 · {a.history.length} 条审计</summary>{a.history.map(h => <div className="insights-audit" key={h.id}><strong>{h.objectType}:{h.objectId} · {h.field}</strong>{meetingAuditDiff(h.before, h.after, h.field).map((d, n) => <p key={n}>{d.field}：{reportValue(d.before)} → {reportValue(d.after)}</p>)}<small>{reportTime(h.createdAt)} · {h.id}</small></div>)}</details>}{a.error && <p className="meeting-material-error">{a.error}</p>}</article>)}{!i.actions.length && <p className="insights-empty">本次尚无明确归属的行动建议。讨论与审批建议均不代表已写回项目。</p>}
        {i.issues.length > 0 && <div className="insights-issues"><h4>阻塞与待跟进对象（结束时记录）</h4>{i.issues.map(v => <p key={`${v.kind}-${v.id}`}><strong>{v.id}</strong> {v.title}<small>{v.status}</small></p>)}</div>}</section></div>
    <section className="insights-retrospective"><h3><MessageCircle size={17} />会议执行复盘</h3><p>{session.narrative?.text ?? i.summary}</p><small>{session.narrative && session.narrative.model !== "facts-template" ? "模型解释 · 以事实统计和审批审计为准" : "根据已记录事实整理"} · 不因打开页面重新调用模型</small><div className="insights-retro-grid"><div><h4>讨论共识与下一步</h4>{(session.minutes?.decisions ?? []).slice(0, 3).map((s, n) => <p key={n}>{s}</p>)}{!session.minutes?.decisions.length && <p>没有明确记录的讨论共识。正式行动以人工审批为准。</p>}{i.actions.filter(a => !["executed", "rejected", "reused"].includes(a.bucket)).map(a => <p key={a.actionId}>{a.title}：{a.label}；建议负责人 {a.owner}，交付日期 {a.deadline}。</p>)}</div><div><h4>AI 主持复盘</h4>{i.improvements.map((s, n) => <p key={n}>{s}</p>)}{!i.improvements.length && <p>暂无足够证据提出具体改进建议。</p>}</div></div></section>
    {session.status === "ended" && <section className="insights-materials"><h3><FileText size={17} />会后成果推荐</h3><MaterialSuggestions state={state} sessionId={session.id} showAssets={false} focusKeys={["meeting-report", "risks", "actions"]} onBusyChange={onBusyChange} />{files.length > 0 && <MeetingMaterials state={state} ids={files} />}</section>}
  </div>
}
