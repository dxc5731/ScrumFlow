import { useMemo, useState } from "react"
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Flag,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Square,
  Bot,
  Clock3,
} from "lucide-react"
import Modal from "../components/planning/Modal"
import EventInsightPanel from "../components/planning/EventInsightPanel"
import MeetingRoom from "../components/planning/MeetingRoom"
import { notify } from "../components/planning/ui"
import {
  sprintStartChecks,
  useProjectStore,
} from "../store/projectStore"
import {
  selectSprintMetrics,
  selectSprintStories,
  selectStoryExecutionLeaves,
  selectStoryProgress,
} from "../store/selectors"
import type { SprintEntity } from "../types"

const statusMeta = {
  planning: { label: "规划中", color: "#B54708", bg: "#FFFAEB" },
  active: { label: "进行中", color: "#175CD3", bg: "#EFF8FF" },
  review: { label: "评审中", color: "#6941C6", bg: "#F4F3FF" },
  closed: { label: "已关闭", color: "#667085", bg: "#F2F4F7" },
}

const initialDraft = {
  name: "",
  goal: "",
  startDate: "2026-09-14",
  endDate: "2026-09-25",
  capacity: 24,
}

export default function SprintPage() {
  const state = useProjectStore()
  const selectedId = state.workspace.selectedSprintId
  const sprint = state.sprints[selectedId]
  const recentMeeting = sprint ? Object.values(state.meetingSessions)
    .filter((item) => item.targetType === "sprint" && item.targetId === sprint.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] : null
  const [dialog, setDialog] = useState<"create" | "edit" | "stories" | "close" | null>(null)
  const [draft, setDraft] = useState(initialDraft)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState("")
  const [goalAchieved, setGoalAchieved] = useState<boolean | null>(null)
  const [retro, setRetro] = useState({ mainProblem: "", nextImprovement: "" })
  const [carryOver, setCarryOver] = useState<Record<string, string>>({})
  const [meetingId, setMeetingId] = useState<string | null>(null)
  const isPO = state.workspace.actorMode === "po"

  const sprints = Object.values(state.sprints).sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  )
  const stories = sprint ? selectSprintStories(state, sprint.id) : []
  const metrics = sprint ? selectSprintMetrics(state, sprint.id) : null
  const readyBacklog = Object.values(state.stories).filter(
    (story) =>
      story.sprintId === null &&
      story.maturityStatus === "ready" &&
      `${story.id} ${story.title}`.toLowerCase().includes(search.trim().toLowerCase()),
  )
  const unfinished = stories.filter(
    (story) => story.deliveryStatus !== "accepted",
  )
  const carryTargets = sprints.filter(
    (item) => item.id !== sprint?.id && item.status !== "closed",
  )
  const plannedPoints = stories.reduce(
    (sum, story) => sum + story.storyPoints,
    0,
  )

  const memberLoads = useMemo(() => {
    if (!sprint) return []
    const hours: Record<string, number> = {}
    stories.forEach((story) => {
      selectStoryExecutionLeaves(state, story.id).forEach((leaf) => {
        const estimate =
          leaf.type === "task"
            ? state.tasks[leaf.id]?.estimate ?? 0
            : state.subtasks[leaf.id]?.estimate ?? 0
        hours[leaf.assigneeId] = (hours[leaf.assigneeId] ?? 0) + estimate
      })
    })
    const max = Math.max(1, ...Object.values(hours))
    return Object.entries(hours)
      .map(([memberId, value]) => ({ memberId, value, ratio: value / max }))
      .sort((a, b) => b.value - a.value)
  }, [sprint, stories, state.tasks, state.subtasks])

  const openCreate = () => {
    setDraft(initialDraft)
    setDialog("create")
  }
  const openEdit = () => {
    if (!sprint) return
    setDraft({
      name: sprint.name,
      goal: sprint.goal,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      capacity: sprint.capacity,
    })
    setDialog("edit")
  }
  const saveSprint = () => {
    if (!draft.name.trim() || draft.endDate <= draft.startDate || draft.capacity < 0) {
      return notify("请检查名称、日期和容量", "error")
    }
    if (dialog === "create") {
      const created = state.createSprint(draft)
      state.selectSprint(created.id)
      notify("Sprint 已创建")
    } else if (sprint) {
      const result = state.updateSprint(sprint.id, draft)
      notify(result.message, result.ok ? "success" : "error")
      if (!result.ok) return
    }
    setDialog(null)
  }

  const openClose = () => {
    setGoalAchieved(null)
    setRetro({ mainProblem: "", nextImprovement: "" })
    setCarryOver({})
    setDialog("close")
  }

  return (
    <div className="flex h-full bg-[#F8FAFC]">
      {meetingId && <MeetingRoom key={meetingId} initialSessionId={meetingId} onClose={() => setMeetingId(null)} />}
      <aside className="flex w-[300px] flex-shrink-0 flex-col border-r border-[#E2E7EE] bg-white">
        <div className="flex h-12 items-center border-b border-[#EAECF0] px-3">
          <div>
            <h1 className="text-xs font-semibold text-[#172033]">Sprint 管理</h1>
            <p className="text-[9px] text-[#98A2B3]">规划、执行、关闭与复盘</p>
          </div>
          {isPO && (
            <button className="primary-button ml-auto" onClick={openCreate}>
              <Plus size={12} /> 新建
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
          {(["active", "planning", "closed"] as const).map((status) => {
            const items = sprints.filter((item) => item.status === status)
            return (
              <section key={status}>
                <div className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold text-[#667085]">
                  {statusMeta[status].label}
                  <span className="font-normal text-[#98A2B3]">{items.length}</span>
                </div>
                <div className="space-y-1.5">
                  {items.map((item) => {
                    const itemStories = selectSprintStories(state, item.id)
                    return (
                      <button
                        key={item.id}
                        className="w-full rounded-lg border px-3 py-2.5 text-left"
                        style={{
                          borderColor: item.id === selectedId ? "#A5B4FC" : "#E2E7EE",
                          background: item.id === selectedId ? "#F5F7FF" : "white",
                        }}
                        onClick={() => state.selectSprint(item.id)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[#344054]">{item.name}</span>
                          <span className="rounded px-1.5 py-0.5 text-[9px]" style={{ color: statusMeta[item.status].color, background: statusMeta[item.status].bg }}>
                            {statusMeta[item.status].label}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-[#667085]">{item.goal || "未填写 Sprint Goal"}</p>
                        <p className="mt-1 text-[9px] text-[#98A2B3]">{item.startDate} 至 {item.endDate} · {itemStories.length} Story</p>
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        {!sprint ? (
          <div className="flex h-full items-center justify-center text-xs text-[#98A2B3]">请先创建或选择 Sprint</div>
        ) : (
          <div className="mx-auto max-w-[1180px] p-5">
            <header className="mb-4 flex items-start gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#F4F3FF] text-[#6941C6]">
                <Flag size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-[#172033]">{sprint.name}</h2>
                  <span className="rounded px-2 py-0.5 text-[10px] font-medium" style={{ color: statusMeta[sprint.status].color, background: statusMeta[sprint.status].bg }}>
                    {statusMeta[sprint.status].label}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#475467]">{sprint.goal || "尚未填写 Sprint Goal"}</p>
                <p className="mt-1 flex items-center gap-1 text-[10px] text-[#98A2B3]"><CalendarDays size={11} /> {sprint.startDate} 至 {sprint.endDate}</p>
              </div>
              {!isPO && <span className="rounded bg-[#F2F4F7] px-2 py-1 text-[10px] text-[#667085]">员工只读</span>}
              {isPO && <button className="secondary-button" onClick={() => setMeetingId(state.createMeeting("sprint", sprint.id).id)}><Bot size={12} /> 发起 AI 项目会议</button>}
              {isPO && recentMeeting && <button className="secondary-button" onClick={() => setMeetingId(recentMeeting.id)}><Clock3 size={12} /> {recentMeeting.status === "active" ? "继续会议" : "查看会议记录"}</button>}
              {isPO && <button className="secondary-button" onClick={openEdit}><Pencil size={12} /> 编辑</button>}
              {isPO && sprint.status !== "closed" && (
                <button className="secondary-button" onClick={() => { setPicked(new Set()); setSearch(""); setDialog("stories") }}><Plus size={12} /> 加入 Story</button>
              )}
              {isPO && sprint.status === "planning" && (
                <button className="primary-button" onClick={() => { const result = state.startSprint(sprint.id); notify(result.message, result.ok ? "success" : "error") }}><Play size={12} /> 启动</button>
              )}
              {isPO && sprint.status === "active" && (
                <button className="primary-button" onClick={openClose}><Square size={11} /> 关闭</button>
              )}
              {isPO && sprint.status === "closed" && (
                <button className="secondary-button" onClick={() => { const result = state.reopenSprint(sprint.id); notify(result.message, result.ok ? "success" : "error") }}><RotateCcw size={12} /> 重开</button>
              )}
            </header>

            {sprint.status === "planning" && (
              <section className="mb-4 rounded-lg border border-[#FEDF89] bg-[#FFFCF5] p-3">
                <div className="mb-2 text-[10px] font-semibold text-[#B54708]">启动条件</div>
                <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-5">
                  {sprintStartChecks(state, sprint.id).map((check) => (
                    <div key={check.key} className="flex items-start gap-1.5 text-[10px]" style={{ color: check.passed ? "#067647" : "#B54708" }} title={check.detail}>
                      {check.passed ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                      <span>{check.label}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
              <Metric label="Story" value={metrics?.storyCount ?? 0} />
              <Metric label="已完成任务" value={metrics?.statusCounts.done ?? 0} color="#667085" />
              <Metric label="进行中任务" value={(metrics?.statusCounts.in_progress ?? 0) + (metrics?.statusCounts.review ?? 0)} color="#175CD3" />
              <Metric label="阻塞项" value={metrics?.blockedReasons.length ?? 0} color="#B42318" />
              <Metric label="待验收 Story" value={metrics?.pendingAcceptanceCount ?? 0} color="#B54708" />
            </section>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]">
              <section>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-[11px] font-semibold text-[#475467]">本轮 Story 与任务</h3>
                  <span className="text-[10px] text-[#98A2B3]">{plannedPoints}/{sprint.capacity} Story Point</span>
                </div>
                <div className="overflow-hidden rounded-lg border border-[#E2E7EE] bg-white">
                  {stories.map((story, index) => {
                    const leaves = selectStoryExecutionLeaves(state, story.id)
                    return (
                      <button
                        key={story.id}
                        className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-[#F9FAFB]"
                        style={{ borderTop: index ? "1px solid #F2F4F7" : undefined }}
                        onClick={() => state.requestFocus("story", story.id, "story-map")}
                      >
                        <span className="rounded bg-[#F2F4F7] px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[#344054]">{story.id.toUpperCase()}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-xs font-medium text-[#344054]">{story.title}</span>
                            <span className="text-[9px] text-[#98A2B3]">{story.storyPoints} pt</span>
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-[#EAECF0]"><div className="h-full bg-[#2E90FA]" style={{ width: `${selectStoryProgress(state, story.id)}%` }} /></div>
                            <span className="text-[9px] text-[#98A2B3]">执行项 {leaves.filter((leaf) => leaf.status === "done").length}/{leaves.length}</span>
                          </div>
                        </div>
                        <span className="text-[10px] text-[#667085]">{deliveryLabel(story.deliveryStatus)}</span>
                        {isPO && sprint.status !== "closed" && (
                          <span
                            role="button"
                            className="text-[10px] text-[#B42318]"
                            onClick={(event) => { event.stopPropagation(); const result = state.removeStoryFromSprint(story.id); notify(result.message, result.ok ? "success" : "error") }}
                          >移出</span>
                        )}
                      </button>
                    )
                  })}
                  {!stories.length && <div className="py-12 text-center text-xs text-[#98A2B3]">尚未加入 Story</div>}
                </div>
              </section>

              <div className="space-y-4">
                <section className="rounded-lg border border-[#E9D7FE] bg-[#FCFAFF] p-3">
                  <EventInsightPanel target={{ type: "sprint", id: sprint.id }} />
                </section>
                <section>
                  <h3 className="mb-2 text-[11px] font-semibold text-[#475467]">成员任务负载（工时）</h3>
                  <div className="space-y-2 rounded-lg border border-[#E2E7EE] bg-white p-3">
                    {memberLoads.map((load) => (
                      <div key={load.memberId} className="flex items-center gap-2">
                        <span className="w-14 truncate text-[10px] text-[#475467]">{state.members[load.memberId]?.name ?? load.memberId}</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#EAECF0]"><div className="h-full bg-[#12B76A]" style={{ width: `${load.ratio * 100}%` }} /></div>
                        <span className="w-10 text-right text-[10px] text-[#667085]">{load.value}h</span>
                      </div>
                    ))}
                    {!memberLoads.length && <p className="text-[10px] text-[#98A2B3]">暂无已分配任务</p>}
                  </div>
                </section>
                <section>
                  <h3 className="mb-2 text-[11px] font-semibold text-[#475467]">主要阻塞与延期风险</h3>
                  <div className="space-y-1.5 rounded-lg border border-[#E2E7EE] bg-white p-3">
                    {metrics?.blockedReasons.slice(0, 6).map((item) => (
                      <button key={item.reason.id} className="block w-full text-left text-[10px] leading-relaxed text-[#B42318]" onClick={() => state.requestFocus(item.entityType, item.entityId, "board")}>
                        {item.title}：{item.reason.message}
                      </button>
                    ))}
                    {stories.filter((story) => story.risk !== "none").slice(0, 4).map((story) => (
                      <p key={story.id} className="text-[10px] leading-relaxed text-[#B54708]">{story.title}：{story.riskNote || `${story.risk} 风险`}</p>
                    ))}
                    {!metrics?.blockedReasons.length && !stories.some((story) => story.risk !== "none") && <p className="text-[10px] text-[#98A2B3]">暂无已登记阻塞或风险</p>}
                  </div>
                </section>
                {sprint.status === "closed" && (
                  <section className="rounded-lg border border-[#E2E7EE] bg-white p-3">
                    <div className="text-[10px] font-semibold text-[#475467]">关闭结果</div>
                    <p className="mt-2 text-[10px] text-[#667085]">Sprint Goal：{sprint.goalAchieved ? "已达成" : "未达成"}</p>
                    <p className="mt-2 text-[10px] text-[#667085]">本轮主要问题：{sprint.retrospective.mainProblem || "未填写"}</p>
                    <p className="mt-1 text-[10px] text-[#667085]">下一轮改进事项：{sprint.retrospective.nextImprovement || "未填写"}</p>
                  </section>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      <Modal open={dialog === "create" || dialog === "edit"} title={dialog === "create" ? "新建 Sprint" : `编辑 ${sprint?.name ?? "Sprint"}`} description="Sprint 创建后先处于规划中，满足启动条件后再启动。" onClose={() => setDialog(null)} footer={<><button className="secondary-button" onClick={() => setDialog(null)}>取消</button><button className="primary-button" onClick={saveSprint}>保存</button></>}>
        <SprintForm draft={draft} onChange={setDraft} />
      </Modal>

      <Modal open={dialog === "stories" && Boolean(sprint)} title={`向 ${sprint?.name ?? "Sprint"} 加入 Story`} description="只展示 Ready 且尚未进入其他 Sprint 的 Product Backlog Story。" onClose={() => setDialog(null)} width={680} footer={<><span className="mr-auto text-[10px] text-[#667085]">已选 {picked.size} 个</span><button className="secondary-button" onClick={() => setDialog(null)}>取消</button><button className="primary-button" disabled={!picked.size} onClick={() => { if (!sprint) return; const result = state.addStoriesToSprint(sprint.id, [...picked]); notify(result.message, result.ok ? "success" : "error"); if (result.ok) setDialog(null) }}>加入 Sprint</button></>}>
        <input className="form-input mb-3" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 Story 编号或标题" />
        <div className="space-y-1.5">
          {readyBacklog.map((story) => (
            <label key={story.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#E2E7EE] px-3 py-2.5">
              <input type="checkbox" checked={picked.has(story.id)} onChange={() => setPicked((current) => { const next = new Set(current); if (next.has(story.id)) next.delete(story.id); else next.add(story.id); return next })} />
              <span className="rounded bg-[#F2F4F7] px-1.5 py-0.5 font-mono text-[9px] font-semibold">{story.id.toUpperCase()}</span>
              <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-[#344054]">{story.title}</p><p className="mt-0.5 text-[10px] text-[#98A2B3]">{story.storyPoints} pt · 业务价值 {story.businessValue}/5</p></div>
            </label>
          ))}
          {!readyBacklog.length && <p className="py-10 text-center text-xs text-[#98A2B3]">没有匹配的 Ready Story</p>}
        </div>
      </Modal>

      <Modal open={dialog === "close" && Boolean(sprint)} title={`关闭 ${sprint?.name ?? "Sprint"}`} description="未验收 Story 必须逐个指定返回 Product Backlog 或进入其他未关闭 Sprint。" onClose={() => setDialog(null)} width={720} footer={<><button className="secondary-button" onClick={() => setDialog(null)}>取消</button><button className="primary-button" disabled={goalAchieved === null || !retro.mainProblem.trim() || !retro.nextImprovement.trim() || unfinished.some((story) => !carryOver[story.id])} onClick={() => { if (!sprint || goalAchieved === null) return; const result = state.closeSprint(sprint.id, { goalAchieved, retrospective: retro, carryOver: unfinished.map((story) => ({ storyId: story.id, to: carryOver[story.id] })) }); notify(result.message, result.ok ? "success" : "error"); if (result.ok) setDialog(null) }}>确认关闭</button></>}>
        <div className="space-y-4">
          <section><div className="mb-1.5 text-[10px] font-semibold text-[#667085]">Sprint Goal 是否达成 *</div><div className="flex gap-2"><button className="secondary-button" data-active={goalAchieved === true} onClick={() => setGoalAchieved(true)}>已达成</button><button className="secondary-button" data-active={goalAchieved === false} onClick={() => setGoalAchieved(false)}>未达成</button></div></section>
          <section><div className="mb-1.5 text-[10px] font-semibold text-[#667085]">交付概况</div><div className="rounded-md bg-[#F9FAFB] px-3 py-2 text-[11px] text-[#475467]">已验收 {stories.filter((story) => story.deliveryStatus === "accepted").length} 个，未完成 {unfinished.length} 个，阻塞原因 {metrics?.blockedReasons.length ?? 0} 条。</div></section>
          <section><div className="mb-1.5 text-[10px] font-semibold text-[#667085]">未完成 Story 去向 *</div><div className="space-y-1.5">{unfinished.map((story) => <div key={story.id} className="flex items-center gap-2 rounded-md border border-[#E2E7EE] px-3 py-2"><span className="min-w-0 flex-1 truncate text-[11px] text-[#475467]">{story.title}</span><select className="form-input w-52" value={carryOver[story.id] ?? ""} onChange={(event) => setCarryOver((current) => ({ ...current, [story.id]: event.target.value }))}><option value="">选择去向</option><option value="backlog">返回 Product Backlog</option>{carryTargets.map((target) => <option key={target.id} value={target.id}>进入 {target.name}</option>)}</select></div>)}</div></section>
          <section className="grid gap-3 sm:grid-cols-2"><label className="text-[10px] font-semibold text-[#667085]">本轮主要问题 *<textarea className="form-input mt-1 min-h-24 resize-y font-normal" value={retro.mainProblem} onChange={(event) => setRetro({ ...retro, mainProblem: event.target.value })} /></label><label className="text-[10px] font-semibold text-[#667085]">下一轮改进事项 *<textarea className="form-input mt-1 min-h-24 resize-y font-normal" value={retro.nextImprovement} onChange={(event) => setRetro({ ...retro, nextImprovement: event.target.value })} /></label></section>
        </div>
      </Modal>
    </div>
  )
}

function Metric({ label, value, color = "#172033" }: { label: string; value: number; color?: string }) {
  return <div className="rounded-lg border border-[#E2E7EE] bg-white px-3 py-3"><p className="text-[10px] text-[#667085]">{label}</p><p className="mt-1 text-xl font-semibold" style={{ color }}>{value}</p></div>
}

function SprintForm({ draft, onChange }: { draft: typeof initialDraft; onChange: (next: typeof initialDraft) => void }) {
  return <div className="space-y-3"><label className="block text-[10px] font-semibold text-[#667085]">Sprint 名称 *<input className="form-input mt-1 font-normal" value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></label><label className="block text-[10px] font-semibold text-[#667085]">Sprint Goal<input className="form-input mt-1 font-normal" value={draft.goal} onChange={(event) => onChange({ ...draft, goal: event.target.value })} /></label><div className="grid grid-cols-2 gap-3"><label className="text-[10px] font-semibold text-[#667085]">开始日期 *<input className="form-input mt-1 font-normal" type="date" value={draft.startDate} onChange={(event) => onChange({ ...draft, startDate: event.target.value })} /></label><label className="text-[10px] font-semibold text-[#667085]">结束日期 *<input className="form-input mt-1 font-normal" type="date" value={draft.endDate} onChange={(event) => onChange({ ...draft, endDate: event.target.value })} /></label></div><label className="block text-[10px] font-semibold text-[#667085]">计划容量（Story Point）<input className="form-input mt-1 font-normal" type="number" min={0} value={draft.capacity} onChange={(event) => onChange({ ...draft, capacity: Number(event.target.value) })} /></label></div>
}

function deliveryLabel(status: string) {
  if (status === "accepted") return "已验收"
  if (status === "pending_acceptance") return "待验收"
  if (status === "in_progress" || status === "returned") return "进行中"
  return status === "planned" ? "已规划" : "Backlog"
}
