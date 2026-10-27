import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock3,
  Flag,
  Gauge,
  Plus,
  Save,
  Settings2,
  ShieldAlert,
  Trash2,
  Users,
} from "lucide-react"
import { useProjectStore } from "../store/projectStore"
import {
  selectActiveRisks,
  selectDailyActualWorkloadHeatmap,
  selectDailyWorkloadHeatmap,
  selectScheduleHealth,
  selectSprintAnalytics,
  selectTeamWorkloads,
} from "../store/selectors"
import type { DailyActualWorkloadDetail } from "../store/selectors"
import { MemberAvatar, notify } from "../components/planning/ui"
import { projectDate, roundHours } from "../utils/workloadAnalysis"
import MeetingRoom from "../components/planning/MeetingRoom"
import MeetingSetup from "../components/planning/MeetingSetup"

function PageShell({
  title,
  description,
  icon: Icon,
  actions,
  children,
}: {
  title: string
  description: string
  icon: typeof Gauge
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="h-full overflow-y-auto bg-[#F8FAFC]">
      <div className="mx-auto max-w-[1440px] px-6 py-6">
        <header className="mb-6 flex items-start gap-3 border-b border-[#E2E7EE] pb-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#D0D5DD] bg-white text-[#475467]">
            <Icon size={18} />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-[#172033]">{title}</h1>
            <p className="mt-1 text-xs text-[#667085]">{description}</p>
          </div>
          {actions && <div className="ml-auto flex gap-2">{actions}</div>}
        </header>
        {children}
      </div>
    </div>
  )
}

function Metric({ label, value, detail, tone = "default" }: { label: string; value: string | number; detail?: string; tone?: "default" | "danger" | "success" }) {
  const color = tone === "danger" ? "#B42318" : tone === "success" ? "#067647" : "#172033"
  return (
    <div className="rounded-lg border border-[#E2E7EE] bg-white p-4">
      <div className="text-[11px] font-medium text-[#667085]">{label}</div>
      <div className="mt-2 text-2xl font-semibold" style={{ color }}>{value}</div>
      {detail && <div className="mt-1 text-[10px] text-[#98A2B3]">{detail}</div>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="mb-3 text-sm font-semibold text-[#344054]">{title}</h2>
      {children}
    </section>
  )
}

export function OverviewPage() {
  const state = useProjectStore()
  const [meetingId, setMeetingId] = useState<string | null>(null)
  const [meetingSetup, setMeetingSetup] = useState(false)
  const [announceWelcome, setAnnounceWelcome] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [meetingView, setMeetingView] = useState<"live" | "history">("live")
  const recentMeeting = Object.values(state.meetingSessions).filter(item => item.targetType === "project" && item.targetId === state.project.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]
  const sprint = state.sprints[state.workspace.selectedSprintId]
  const pending = Object.values(state.stories).filter(story => story.sprintId === sprint?.id && story.deliveryStatus === "pending_acceptance")
  const activeRisks = selectActiveRisks(state)
  return <PageShell title={state.project.name} description={state.project.goal || "在基本资料中完善项目目标"} icon={Gauge} actions={<><button className="secondary-button" onClick={()=>{setMeetingSetup(true)}}><Bot size={14}/>发起项目会议</button><button className="secondary-button" disabled={!recentMeeting} onClick={()=>{setAnnounceWelcome(false);setHistoryOpen(true);setMeetingView("history");setMeetingId(recentMeeting!.id)}}><Clock3 size={14}/>历史会议</button></>}>
    {meetingSetup && <MeetingSetup targetType="project" targetId={state.project.id} onClose={() => setMeetingSetup(false)} onStart={id => { setMeetingSetup(false); setHistoryOpen(false); setMeetingView("live"); setAnnounceWelcome(true); setMeetingId(id) }} />}
    {meetingId && <MeetingRoom announceWelcome={announceWelcome} key={meetingId} initialView={meetingView} initialHistoryOpen={historyOpen} initialSessionId={meetingId} onClose={()=>setMeetingId(null)}/>}
    <p className="text-xs text-[#667085]">{state.project.startDate} 至 {state.project.endDate} · {Object.keys(state.members).length} 位成员 · {Object.keys(state.activities).length} 个目标 · {Object.keys(state.releases).length} 个 Release</p>
    <Section title="待处理事项"><div className="divide-y divide-[#EAECF0] rounded-lg border border-[#E2E7EE] bg-white">
      <button className="flex w-full items-center justify-between gap-4 p-4 text-left hover:bg-[#F9FAFB]" onClick={()=>state.setWorkspace({currentPage:"sprint",sprintTab:"acceptance"})}><span><b className="block text-sm text-[#344054]">待验收故事</b><span className="mt-1 block text-xs text-[#667085]">{sprint?.name ?? "尚未选择 Sprint"} · {pending.length ? pending.slice(0,3).map(story=>story.title).join("、") : "暂无待验收故事"}</span></span><span className="shrink-0 text-xs text-[#6941C6]">{pending.length} 项 · 前往验收 →</span></button>
      <button className="flex w-full items-center justify-between gap-4 p-4 text-left hover:bg-[#F9FAFB]" onClick={()=>state.setWorkspace({currentPage:"risks",sprintTab:"risks"})}><span><b className="block text-sm text-[#344054]">风险处理</b><span className="mt-1 block text-xs text-[#667085]">{activeRisks.filter(risk=>risk.level==="high").length} 项高风险；进入风险面板可查看全部项目风险</span></span><span className="shrink-0 text-xs text-[#6941C6]">管理风险 →</span></button>
      <button className="flex w-full items-center justify-between gap-4 p-4 text-left hover:bg-[#F9FAFB]" onClick={()=>state.setWorkspace({currentPage:"release"})}><span><b className="block text-sm text-[#344054]">版本交付</b><span className="mt-1 block text-xs text-[#667085]">核对核心故事验收、阻塞与发布条件</span></span><span className="shrink-0 text-xs text-[#6941C6]">管理 Release →</span></button>
    </div></Section>
  </PageShell>
}

interface HeatmapTaskDetail {
  type: "task" | "subtask"
  id: string
  taskId: string
  title: string
  allocatedHours: number
  startDate: string
  endDate: string
}

function HeatmapCell({
  memberName,
  date,
  hours,
  details,
  background,
  foreground,
  today,
  onOpen,
}: {
  memberName: string
  date: string
  hours: number
  details: HeatmapTaskDetail[]
  background: string
  foreground: string
  today: boolean
  onOpen: () => void
}) {
  const [position, setPosition] = useState<{
    left: number
    top?: number
    bottom?: number
  } | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = null
  }
  const hidePreview = () => {
    cancelHide()
    hideTimer.current = setTimeout(() => setPosition(null), 80)
  }
  const showPreview = (element: HTMLElement) => {
    if (!details.length) return
    cancelHide()
    const rect = element.getBoundingClientRect()
    const left = Math.max(12, Math.min(window.innerWidth - 312, rect.left + rect.width / 2 - 150))
    const previewHeight = Math.min(300, 46 + details.length * 39)
    const placeAbove = rect.bottom + previewHeight + 12 > window.innerHeight && rect.top > previewHeight
    setPosition(placeAbove
      ? { left, bottom: window.innerHeight - rect.top + 8 }
      : { left, top: rect.bottom + 8 })
  }
  const preview = position && typeof document !== "undefined"
    ? createPortal(
        <div
          className="heatmap-preview fixed z-[100] w-[300px] overflow-hidden rounded-lg border border-[#D0D5DD] bg-white shadow-[0_10px_30px_rgba(16,24,40,0.16)]"
          style={position}
          role="tooltip"
          onMouseEnter={cancelHide}
          onMouseLeave={hidePreview}
        >
          <div className="flex items-center border-b border-[#EAECF0] bg-[#F9FAFB] px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-[11px] font-semibold text-[#344054]">{memberName}</div>
              <div className="mt-0.5 text-[9px] text-[#667085]">{date}</div>
            </div>
            <span className="ml-auto rounded bg-[#ECFDF3] px-1.5 py-0.5 text-[10px] font-semibold text-[#067647]">{hours}h</span>
          </div>
          <div className="max-h-64 divide-y divide-[#F2F4F7] overflow-y-auto">
            {details.map((item) => (
              <div key={`${item.type}-${item.id}`} className="flex gap-2 px-3 py-2">
                <span className={`mt-0.5 h-fit rounded px-1 py-0.5 text-[8px] font-semibold ${item.type === "subtask" ? "bg-[#F4F3FF] text-[#5925DC]" : "bg-[#EFF8FF] text-[#175CD3]"}`}>{item.type === "subtask" ? "子任务" : "任务"}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[10px] font-medium text-[#344054]" title={item.title}>{item.title}</div>
                  <div className="mt-0.5 text-[8px] text-[#98A2B3]">{item.startDate} 至 {item.endDate}</div>
                </div>
                <span className="flex-shrink-0 text-[10px] font-semibold tabular-nums text-[#475467]">{item.allocatedHours}h</span>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )
    : null
  return (
    <>
      <button
        type="button"
        className="flex min-h-11 items-center justify-center border-b border-r border-white/80 text-[9px] font-semibold tabular-nums outline-none transition-[filter,box-shadow] duration-100 enabled:hover:brightness-95 enabled:focus-visible:ring-2 enabled:focus-visible:ring-inset enabled:focus-visible:ring-[#175CD3]"
        disabled={!details.length}
        aria-label={details.length ? `${memberName} ${date}，${hours} 小时，${details.length} 项工作` : `${memberName} ${date}，无工作`}
        onMouseEnter={(event) => showPreview(event.currentTarget)}
        onMouseLeave={hidePreview}
        onFocus={(event) => showPreview(event.currentTarget)}
        onBlur={hidePreview}
        onClick={details.length ? onOpen : undefined}
        style={{
          background,
          color: foreground,
          boxShadow: today ? "inset 2px 0 rgba(18,183,106,.55), inset -2px 0 rgba(18,183,106,.55)" : undefined,
        }}
      >
        {hours ? `${hours}` : ""}
      </button>
      {preview}
    </>
  )
}

function ActualWorkloadCell({
  memberName,
  date,
  score,
  details,
  background,
  foreground,
  today,
}: {
  memberName: string
  date: string
  score: number
  details: DailyActualWorkloadDetail[]
  background: string
  foreground: string
  today: boolean
}) {
  const [position, setPosition] = useState<{
    left: number
    top?: number
    bottom?: number
  } | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = null
  }
  const hidePreview = () => {
    cancelHide()
    hideTimer.current = setTimeout(() => setPosition(null), 80)
  }
  const showPreview = (element: HTMLElement) => {
    if (!details.length) return
    cancelHide()
    const rect = element.getBoundingClientRect()
    const left = Math.max(12, Math.min(window.innerWidth - 352, rect.left + rect.width / 2 - 170))
    const previewHeight = Math.min(350, 58 + details.length * 62)
    const placeAbove = rect.bottom + previewHeight + 12 > window.innerHeight && rect.top > previewHeight
    setPosition(placeAbove
      ? { left, bottom: window.innerHeight - rect.top + 8 }
      : { left, top: rect.bottom + 8 })
  }
  const preview = position && typeof document !== "undefined"
    ? createPortal(
        <div
          className="heatmap-preview fixed z-[100] w-[340px] overflow-hidden rounded-lg border border-[#B2CCFF] bg-white shadow-[0_12px_32px_rgba(16,24,40,0.18)]"
          style={position}
          role="tooltip"
          onMouseEnter={cancelHide}
          onMouseLeave={hidePreview}
        >
          <div className="flex items-center border-b border-[#D1E0FF] bg-[#EFF4FF] px-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-[11px] font-semibold text-[#1D2939]">{memberName}</div>
              <div className="mt-0.5 text-[9px] text-[#475467]">{date} · 工作组成</div>
            </div>
            <span className="ml-auto rounded bg-[#D1E0FF] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[#1849A9]">{score.toFixed(2)}</span>
          </div>
          <div className="max-h-72 divide-y divide-[#EAECF0] overflow-y-auto">
            {details.map((item, index) => (
              <div key={`${item.type}-${item.id}-${index}`} className="px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <span className={`mt-0.5 h-fit flex-shrink-0 rounded px-1 py-0.5 text-[8px] font-semibold ${item.type === "submission" ? "bg-[#ECFDF3] text-[#067647]" : "bg-[#EFF8FF] text-[#175CD3]"}`}>{item.type === "submission" ? "成果" : "推进"}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[10px] font-medium text-[#344054]" title={item.title}>{item.title}</div>
                    {item.type === "progress"
                      ? <div className="mt-1 text-[9px] text-[#667085]">进度 +{item.progressDelta}% · 预计 {item.estimate}h · 价值 {item.businessValue}/5</div>
                      : <>
                          <div className="mt-1 line-clamp-2 text-[9px] leading-4 text-[#475467]">{item.resultSummary}</div>
                          {(item.linkCount || item.assetCount) ? <div className="mt-1 text-[8px] text-[#98A2B3]">链接 {item.linkCount ?? 0} · 设计资产 {item.assetCount ?? 0}</div> : null}
                        </>}
                  </div>
                  <span className="flex-shrink-0 text-[9px] font-semibold tabular-nums text-[#1849A9]">+{item.score.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )
    : null
  return (
    <>
      <div
        className={`flex min-h-11 items-center justify-center border-b border-r border-white/80 text-[9px] font-semibold tabular-nums outline-none transition-[filter,box-shadow] duration-100 ${details.length ? "cursor-default hover:brightness-95 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2E90FA]" : ""}`}
        tabIndex={details.length ? 0 : undefined}
        aria-label={details.length ? `${memberName} ${date}，工作量指数 ${score.toFixed(2)}，${details.length} 项组成` : `${memberName} ${date}，无工作记录`}
        onMouseEnter={(event) => showPreview(event.currentTarget)}
        onMouseLeave={hidePreview}
        onFocus={(event) => showPreview(event.currentTarget)}
        onBlur={hidePreview}
        style={{
          background,
          color: foreground,
          boxShadow: today ? "inset 2px 0 rgba(46,144,250,.7), inset -2px 0 rgba(46,144,250,.7)" : undefined,
        }}
      >
        {score ? score.toFixed(score < 10 ? 1 : 0) : ""}
      </div>
      {preview}
    </>
  )
}

export function AnalyticsPage() {
  const state = useProjectStore()
  const workloads = selectTeamWorkloads(state)
  const heatmap = selectDailyWorkloadHeatmap(state)
  const actualHeatmap = selectDailyActualWorkloadHeatmap(state)
  const actualHeatmapScrollRef = useRef<HTMLDivElement>(null)
  const sprints = Object.values(state.sprints).map((sprint) => selectSprintAnalytics(state, sprint.id))
  const selectedSprint = state.sprints[state.workspace.selectedSprintId]
  const [pulse, setPulse] = useState({ focus: "", blockers: "", notes: "" })
  useEffect(() => {
    const element = actualHeatmapScrollRef.current
    if (!element) return
    const scrollToLatest = () => {
      element.scrollLeft = element.scrollWidth
    }
    const frame = window.requestAnimationFrame(scrollToLatest)
    const resizeObserver = new ResizeObserver(scrollToLatest)
    resizeObserver.observe(element)
    return () => {
      window.cancelAnimationFrame(frame)
      resizeObserver.disconnect()
    }
  }, [actualHeatmap.anchorDate, actualHeatmap.dates.length])
  const issueTasks = Object.values(state.tasks).filter((task) => task.status === "blocked" || task.qualityStatus === "attention" || selectScheduleHealth(task.startDate, task.endDate, task.progress).overdue)
  return (
    <PageShell title="团队与 Sprint 分析" description="容量、工时、逾期、阻塞、质量和 Sprint 趋势均从统一项目数据实时计算。" icon={BarChart3}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="剩余时间容量" value={`${roundHours(workloads.reduce((s, x) => s + x.capacityHours, 0))}h`} /><Metric label="未完成工时" value={`${roundHours(workloads.reduce((s, x) => s + x.plannedHours, 0))}h`} /><Metric label="逾期任务" value={workloads.reduce((s, x) => s + x.overdueCount, 0)} tone="danger" /><Metric label="质量待关注" value={workloads.reduce((s, x) => s + x.qualityAttentionCount, 0)} /></div>
      <Section title="成员负载">
        <p className="mb-2 text-[10px] text-[#667085]">{selectedSprint?.name} · 按叶子任务进度估算剩余工作；容量按今天起至 Sprint 结束的工作日计算，整轮规划容量单独列出。</p>
        <div className="overflow-hidden rounded-lg border border-[#E2E7EE] bg-white">
          {workloads.map((item) => <div key={item.memberId} className="grid grid-cols-[180px_1fr_90px_90px_110px] items-center gap-4 border-b border-[#F2F4F7] px-4 py-3 last:border-0"><button className="flex items-center gap-2 text-left hover:underline" onClick={() => state.setWorkspace({ currentPage: "story-map", memberFilterId: item.memberId })}><MemberAvatar memberId={item.memberId} size={26} /><span><span className="block text-xs font-medium text-[#344054]">{item.member.name}</span><span className="block text-[10px] text-[#98A2B3]">{item.member.role}</span></span></button><div><div className="h-2 overflow-hidden rounded bg-[#EAECF0]"><div className="h-full" style={{ width: `${Math.min(item.utilization, 100)}%`, background: item.utilization > 100 ? "#D92D20" : item.utilization > 85 ? "#DC6803" : "#039855" }} /></div><div className="mt-1 text-[10px] text-[#667085]">{item.plannedHours}h / 剩余时间容量 {item.capacityHours}h · 整轮 {item.planningCapacity}h · 余量 {item.remainingCapacity}h</div></div><span className="text-center text-xs">按时 {item.onTimeCount}/{item.completedCount}</span><span className="text-center text-xs text-[#B42318]">逾期 {item.overdueCount} · 停滞 {item.stalledCount}</span><span className="text-center text-xs text-[#B54708]">阻塞 {item.blockedCount} · 返工 {item.reworkCount}</span></div>)}
        </div>
      </Section>
      <Section title="异常任务定位">
        <div className="grid gap-2 lg:grid-cols-2">{issueTasks.map((task) => { const health = selectScheduleHealth(task.startDate, task.endDate, task.progress); return <button key={task.id} className="flex items-center gap-3 rounded-lg border border-[#E2E7EE] bg-white p-3 text-left hover:border-[#98A2B3]" onClick={() => state.requestFocus("task", task.id, "gantt")}><AlertTriangle size={14} className="text-[#D92D20]" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-[#344054]">{task.title}</span><span className="text-[10px] text-[#98A2B3]">{task.id.toUpperCase()} · {health.overdue ? "已逾期" : task.status === "blocked" ? "已阻塞" : "质量需关注"}</span></span><span className="text-[10px] text-[#175CD3]">在甘特图定位</span></button>})}{!issueTasks.length && <div className="rounded-lg border border-dashed border-[#D0D5DD] p-6 text-center text-xs text-[#98A2B3]">暂无异常任务</div>}</div>
      </Section>
      <Section title="分配任务量">
        <div className="overflow-hidden rounded-lg border border-[#E2E7EE] bg-white">
          <div className="flex items-center border-b border-[#E2E7EE] px-4 py-3">
            <div><div className="text-xs font-semibold text-[#344054]">{heatmap.dates[0]?.dateLabel} 至 {heatmap.dates.at(-1)?.dateLabel}</div><div className="mt-0.5 text-[10px] text-[#98A2B3]">任务工时按起止日期逐日均摊</div></div>
            <div className="ml-auto flex items-center gap-1.5 text-[9px] text-[#667085]"><span>低</span>{["#EAF8F3", "#BCEAD9", "#73D3B1", "#2AA77B", "#087454"].map((color) => <span key={color} className="h-3 w-6 first:rounded-l last:rounded-r" style={{ background: color }} />)}<span>高</span></div>
          </div>
          <div className="overflow-x-auto">
            <div className="grid w-max min-w-full" style={{ gridTemplateColumns: `180px repeat(${heatmap.dates.length}, 40px)` }}>
              <div className="sticky left-0 z-20 border-b border-r border-[#E2E7EE] bg-[#F9FAFB] px-3 py-2 text-[10px] font-semibold text-[#667085]">成员 / 分配工时</div>
              {heatmap.dates.map((date) => <div key={date.date} className="border-b border-r border-[#EAECF0] px-0.5 py-1.5 text-center" style={{ background: date.isToday ? "#ECFDF3" : date.isWeekend ? "#F8FAFC" : "#FFFFFF", boxShadow: date.isToday ? "inset 2px 0 #12B76A, inset -2px 0 #12B76A" : undefined }}><div className={`text-[9px] font-semibold ${date.isToday ? "text-[#067647]" : "text-[#475467]"}`}>{date.dateLabel}</div><div className="mt-0.5 text-[8px] text-[#98A2B3]">{date.isToday ? "今天" : date.dayLabel}</div></div>)}
              {heatmap.rows.flatMap((row) => [
                <button key={`${row.member.id}-label`} className="sticky left-0 z-10 flex min-h-11 items-center gap-2 border-b border-r border-[#EAECF0] bg-white px-3 text-left hover:bg-[#F9FAFB]" onClick={() => state.setWorkspace({ currentPage: "story-map", memberFilterId: row.member.id })}><MemberAvatar memberId={row.member.id} size={24} /><span className="min-w-0"><span className="block truncate text-[11px] font-medium text-[#344054]">{row.member.name}</span><span className="block text-[8px] text-[#98A2B3]">{row.totalHours}h</span></span></button>,
                ...row.cells.map((hours, index) => { const date = heatmap.dates[index]; const ratio = heatmap.maxHours ? hours / heatmap.maxHours : 0; const background = hours === 0 ? (date.isWeekend ? "#F4F6F8" : "#FAFBFC") : ratio <= .2 ? "#EAF8F3" : ratio <= .4 ? "#BCEAD9" : ratio <= .65 ? "#73D3B1" : ratio <= .85 ? "#2AA77B" : "#087454"; return <HeatmapCell key={`${row.member.id}-${date.date}`} memberName={row.member.name} date={date.date} hours={hours} details={row.details[index]} background={background} foreground={ratio > .65 ? "#FFFFFF" : hours ? "#175C49" : "transparent"} today={date.isToday} onOpen={() => { const taskIds = [...new Set(row.details[index].map((item) => item.taskId))]; const subtaskIds = row.details[index].filter((item) => item.type === "subtask").map((item) => item.id); state.setWorkspace({ currentPage: "gantt", currentView: "gantt", selectedObjectType: null, selectedObjectId: null, inspectorOpen: false, ganttRangeStart: date.date < state.workspace.ganttRangeStart ? date.date : state.workspace.ganttRangeStart, ganttRangeEnd: date.date > state.workspace.ganttRangeEnd ? date.date : state.workspace.ganttRangeEnd, ganttHeatmapHighlight: { date: date.date, taskIds, subtaskIds, nonce: Date.now() } }) }} /> }),
              ])}
            </div>
          </div>
        </div>
      </Section>
      <Section title="成员每日工作量">
        <div className="overflow-hidden rounded-lg border border-[#D1E0FF] bg-white">
          <div className="flex items-center border-b border-[#D1E0FF] px-4 py-3">
            <div><div className="text-xs font-semibold text-[#344054]">{actualHeatmap.dates[0]?.dateLabel} 至 {actualHeatmap.dates.at(-1)?.dateLabel}</div><div className="mt-0.5 text-[10px] text-[#98A2B3]">基于任务推进、成果提交、预计工时与价值度的展示性评估</div></div>
            <div className="ml-auto flex items-center gap-1.5 text-[9px] text-[#667085]"><span>低</span>{["#EFF6FF", "#DBEAFE", "#93C5FD", "#3B82F6", "#1D4ED8"].map((color) => <span key={color} className="h-3 w-6 first:rounded-l last:rounded-r" style={{ background: color }} />)}<span>高</span></div>
          </div>
          <div ref={actualHeatmapScrollRef} className="overflow-x-auto">
            <div className="grid w-max min-w-full" style={{ gridTemplateColumns: `180px repeat(${actualHeatmap.dates.length}, 40px)` }}>
              <div className="sticky left-0 z-20 border-b border-r border-[#D1E0FF] bg-[#F9FAFB] px-3 py-2 text-[10px] font-semibold text-[#667085]">成员 / 工作量指数</div>
              {actualHeatmap.dates.map((date) => <div key={date.date} className="border-b border-r border-[#EAECF0] px-0.5 py-1.5 text-center" style={{ background: date.isToday ? "#EFF8FF" : date.isWeekend ? "#F8FAFC" : "#FFFFFF", boxShadow: date.isToday ? "inset 2px 0 #2E90FA, inset -2px 0 #2E90FA" : undefined }}><div className={`text-[9px] font-semibold ${date.isToday ? "text-[#175CD3]" : "text-[#475467]"}`}>{date.dateLabel}</div><div className="mt-0.5 text-[8px] text-[#98A2B3]">{date.isToday ? "今天" : date.dayLabel}</div></div>)}
              {actualHeatmap.rows.flatMap((row) => [
                <button key={`${row.member.id}-actual-label`} className="sticky left-0 z-10 flex min-h-11 items-center gap-2 border-b border-r border-[#D1E0FF] bg-white px-3 text-left hover:bg-[#F9FAFB]" onClick={() => state.setWorkspace({ currentPage: "story-map", memberFilterId: row.member.id })}><MemberAvatar memberId={row.member.id} size={24} /><span className="min-w-0"><span className="block truncate text-[11px] font-medium text-[#344054]">{row.member.name}</span><span className="block text-[8px] text-[#98A2B3]">指数 {row.totalScore}</span></span></button>,
                ...row.cells.map((score, index) => { const date = actualHeatmap.dates[index]; const ratio = actualHeatmap.maxScore ? score / actualHeatmap.maxScore : 0; const background = score === 0 ? (date.isWeekend ? "#F4F6F8" : "#FAFBFC") : ratio <= .2 ? "#EFF6FF" : ratio <= .4 ? "#DBEAFE" : ratio <= .65 ? "#93C5FD" : ratio <= .85 ? "#3B82F6" : "#1D4ED8"; return <ActualWorkloadCell key={`${row.member.id}-actual-${date.date}`} memberName={row.member.name} date={date.date} score={score} details={row.details[index]} background={background} foreground={ratio > .65 ? "#FFFFFF" : score ? "#1849A9" : "transparent"} today={date.isToday} /> }),
              ])}
            </div>
          </div>
        </div>
      </Section>
      <Section title="Sprint 对比">
        <div className="grid gap-3 lg:grid-cols-3">{sprints.map((item) => <div key={item.sprint?.id} className="rounded-lg border border-[#E2E7EE] bg-white p-4"><div className="flex items-center"><span className="text-xs font-semibold text-[#344054]">{item.sprint?.name}</span><span className="ml-auto text-[10px] text-[#667085]">{item.sprint?.status}</span></div><div className="mt-4 flex items-center gap-4"><div className="flex h-16 w-16 items-center justify-center rounded-full" style={{ background: `conic-gradient(#12B76A ${item.completionRate}%, #EAECF0 0)` }}><div className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-xs font-semibold text-[#172033]">{item.completionRate}%</div></div><div><div className="text-xs font-medium text-[#344054]">{item.completedEstimate}/{item.totalEstimate}h 已完成</div><div className="mt-1 text-[10px] text-[#98A2B3]">{item.acceptedStoryCount}/{item.storyCount} Story 已验收</div></div></div><div className="mt-3 grid grid-cols-3 text-center text-[10px] text-[#667085]"><span>阻塞 {item.blockedTaskCount}</span><span>逾期 {item.overdueTaskCount}</span><span>风险 {item.activeRiskCount}</span></div></div>)}</div>
        <div className="mt-3 flex h-40 items-end gap-3 rounded-lg border border-[#E2E7EE] bg-white px-5 pb-4 pt-6">{sprints.map((item) => <div key={`trend-${item.sprint?.id}`} className="flex h-full min-w-20 flex-1 flex-col justify-end"><div className="mb-1 text-center text-[10px] font-semibold text-[#344054]">{item.completionRate}%</div><div className="mx-auto w-full max-w-24 rounded-t bg-[#2E90FA]" style={{ height: `${Math.max(4, item.completionRate)}%` }} /><div className="mt-2 truncate text-center text-[9px] text-[#667085]">{item.sprint?.name}</div></div>)}</div>
      </Section>
      {selectedSprint && <Section title="每日 Sprint 态势记录"><div className="rounded-lg border border-[#E2E7EE] bg-white p-4"><div className="grid gap-2 lg:grid-cols-3"><input className="form-input" placeholder="今日重点" value={pulse.focus} onChange={(e) => setPulse({ ...pulse, focus: e.target.value })} /><input className="form-input" placeholder="阻塞情况" value={pulse.blockers} onChange={(e) => setPulse({ ...pulse, blockers: e.target.value })} /><input className="form-input" placeholder="补充记录" value={pulse.notes} onChange={(e) => setPulse({ ...pulse, notes: e.target.value })} /></div><button className="primary-button mt-3" onClick={() => { state.addSprintPulse({ sprintId: selectedSprint.id, date: projectDate(), ...pulse }); setPulse({ focus: "", blockers: "", notes: "" }); notify("Sprint 态势已记录") }}><Plus size={13} />添加记录</button><div className="mt-4 divide-y divide-[#F2F4F7]">{Object.values(state.sprintPulses).filter((x) => x.sprintId === selectedSprint.id).sort((a,b) => b.date.localeCompare(a.date)).map((x) => <div key={x.id} className="grid grid-cols-[90px_1fr_1fr_1fr_30px] gap-3 py-2 text-xs"><span className="text-[#667085]">{x.date}</span><span>{x.focus || "-"}</span><span className="text-[#B42318]">{x.blockers || "-"}</span><span className="text-[#667085]">{x.notes || "-"}</span><button title="删除记录" onClick={() => state.deleteSprintPulse(x.id)}><Trash2 size={12} /></button></div>)}</div></div></Section>}
    </PageShell>
  )
}

export function SettingsPage() {
  const state = useProjectStore()
  const [project, setProject] = useState(state.project)
  const [blank, setBlank] = useState({ name: "", goal: "", requirementBrief: "", startDate: state.project.startDate, endDate: state.project.endDate, members: [{ name: "", role: "PO", capacityHours: 40 }] })
  return (
    <PageShell title="项目设置" description="维护项目基础资料，或创建不含演示数据的空白 PO 项目。" icon={Settings2}>
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-lg border border-[#E2E7EE] bg-white p-5"><h2 className="text-sm font-semibold text-[#344054]">当前项目</h2><div className="mt-4 space-y-3"><input className="form-input" value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} placeholder="项目名称" /><input className="form-input" value={project.goal} onChange={(e) => setProject({ ...project, goal: e.target.value })} placeholder="项目目标" /><textarea className="form-input min-h-28" value={project.requirementBrief} onChange={(e) => setProject({ ...project, requirementBrief: e.target.value })} placeholder="需求说明" /><div className="grid grid-cols-2 gap-2"><input type="date" className="form-input" value={project.startDate} onChange={(e) => setProject({ ...project, startDate: e.target.value })} /><input type="date" className="form-input" value={project.endDate} onChange={(e) => setProject({ ...project, endDate: e.target.value })} /></div><button className="primary-button" onClick={() => { const result = state.updateProject(project); notify(result.message, result.ok ? "success" : "error") }}><Save size={13} />保存项目资料</button></div></div>
        <div className="rounded-lg border border-[#E2E7EE] bg-white p-5"><h2 className="text-sm font-semibold text-[#344054]">创建空白项目</h2><div className="mt-4 space-y-3"><input className="form-input" value={blank.name} onChange={(e) => setBlank({ ...blank, name: e.target.value })} placeholder="项目名称" /><input className="form-input" value={blank.goal} onChange={(e) => setBlank({ ...blank, goal: e.target.value })} placeholder="项目目标" /><textarea className="form-input min-h-20" value={blank.requirementBrief} onChange={(e) => setBlank({ ...blank, requirementBrief: e.target.value })} placeholder="需求说明" /><div className="grid grid-cols-2 gap-2"><input type="date" className="form-input" value={blank.startDate} onChange={(e) => setBlank({ ...blank, startDate: e.target.value })} /><input type="date" className="form-input" value={blank.endDate} onChange={(e) => setBlank({ ...blank, endDate: e.target.value })} /></div>{blank.members.map((member, index) => <div key={index} className="grid grid-cols-[1fr_1fr_80px_28px] gap-2"><input className="form-input" placeholder="成员姓名" value={member.name} onChange={(e) => { const members = [...blank.members]; members[index] = { ...member, name: e.target.value }; setBlank({ ...blank, members }) }} /><input className="form-input" placeholder="角色" value={member.role} onChange={(e) => { const members = [...blank.members]; members[index] = { ...member, role: e.target.value }; setBlank({ ...blank, members }) }} /><input className="form-input" type="number" value={member.capacityHours} onChange={(e) => { const members = [...blank.members]; members[index] = { ...member, capacityHours: Number(e.target.value) }; setBlank({ ...blank, members }) }} /><button className="icon-button" title="删除成员" disabled={blank.members.length === 1} onClick={() => setBlank({ ...blank, members: blank.members.filter((_, i) => i !== index) })}><Trash2 size={13} /></button></div>)}<button className="secondary-button" onClick={() => setBlank({ ...blank, members: [...blank.members, { name: "", role: "项目成员", capacityHours: 40 }] })}><Users size={13} />添加成员</button><button className="primary-button w-full" onClick={() => { if (!window.confirm("创建空白项目会替换当前浏览器中的项目数据，确定继续吗？")) return; const result = state.createBlankProject(blank); notify(result.message, result.ok ? "success" : "error") }}><Plus size={13} />创建空白项目</button></div></div>
      </div>
      {import.meta.env.DEV && <div className="mt-5 border-t border-[#E2E7EE] pt-4"><button className="secondary-button" onClick={() => {
        if (!window.confirm("恢复演示项目会替换当前项目、会议、建议与变更记录。确定重置吗？")) return
        state.resetDemoData()
        notify("演示项目已恢复到初始数据", "success")
      }}>重置演示项目</button></div>}
    </PageShell>
  )
}
