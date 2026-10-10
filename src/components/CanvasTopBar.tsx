import { useMemo, useRef, useState } from "react"
import {
  Bell,
  BarChart3,
  CalendarRange,
  ClipboardCheck,
  ChevronDown,
  Columns3,
  Download,
  FileUp,
  GanttChartSquare,
  Grid2X2,
  Map,
  MoreHorizontal,
  RotateCcw,
  Search,
  ShieldCheck,
  Settings2,
  Home,
  Images,
  TimerReset,
  X,
} from "lucide-react"
import { useProjectStore } from "../store/projectStore"
import { selectPendingProposals, proposalStatusLabel } from "../store/selectors"
import { exportGanttPng, exportStoryMapPng } from "../utils/exportImage"
import { MemberAvatar, notify } from "./planning/ui"

const views = [
  { id: "story-map" as const, label: "用户地图", icon: Map },
  { id: "gantt" as const, label: "甘特图", icon: GanttChartSquare },
  { id: "board" as const, label: "执行状态", icon: Columns3 },
]

const workspaceMenuGroups = [
  {
    label: "项目",
    items: [{ id: "overview" as const, label: "项目概览", icon: Home }],
  },
  {
    label: "规划与交付",
    items: [
      ...views,
      { id: "sprint" as const, label: "Sprint 管理", icon: TimerReset },
      { id: "acceptance" as const, label: "成果验收", icon: ClipboardCheck },
    ],
  },
  {
    label: "治理与分析",
    items: [
      { id: "risks" as const, label: "风险登记册", icon: ShieldCheck },

      { id: "workload" as const, label: "团队与 Sprint 分析", icon: BarChart3 },
    ],
  },
  {
    label: "资产与设置",
    items: [
      { id: "assets" as const, label: "设计资产与 UML", icon: Images },
      { id: "settings" as const, label: "项目设置", icon: Settings2 },
    ],
  },
]

export default function CanvasTopBar() {
  const project = useProjectStore((state) => state.project)
  const members = useProjectStore((state) => state.members)
  const sprints = useProjectStore((state) => state.sprints)
  const stories = useProjectStore((state) => state.stories)
  const tasks = useProjectStore((state) => state.tasks)
  const subtasks = useProjectStore((state) => state.subtasks)
  const workspace = useProjectStore((state) => state.workspace)
  const navigateTo = useProjectStore((state) => state.navigateTo)
  const selectSprint = useProjectStore((state) => state.selectSprint)
  const setWorkspace = useProjectStore((state) => state.setWorkspace)
  const requestFocus = useProjectStore((state) => state.requestFocus)
  const exportProjectJson = useProjectStore((state) => state.exportProjectJson)
  const importProjectJson = useProjectStore((state) => state.importProjectJson)
  const resetDemoData = useProjectStore((state) => state.resetDemoData)
  const proposals = useProjectStore((state) => state.proposals)
  const setProposalActionDecision = useProjectStore((state) => state.setProposalActionDecision)
  const applyProposal = useProjectStore((state) => state.applyProposal)
  const rejectProposal = useProjectStore((state) => state.rejectProposal)
  const [menu, setMenu] = useState<"nav" | "tools" | "notice" | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [exportingView, setExportingView] = useState<"story-map" | "gantt" | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const pendingProposals = useMemo(
    () => selectPendingProposals({ proposals }),
    [proposals],
  )

  const results = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return []
    return [
      ...Object.values(stories)
        .filter((story) =>
          `${story.id} ${story.title}`.toLowerCase().includes(value),
        )
        .slice(0, 5)
        .map((story) => ({
          type: "story" as const,
          id: story.id,
          title: story.title,
        })),
      ...Object.values(tasks)
        .filter((task) =>
          `${task.id} ${task.title}`.toLowerCase().includes(value),
        )
        .slice(0, 5)
        .map((task) => ({
          type: "task" as const,
          id: task.id,
          title: task.title,
        })),
      ...Object.values(subtasks)
        .filter((subtask) =>
          `${subtask.id} ${subtask.title}`.toLowerCase().includes(value),
        )
        .slice(0, 5)
        .map((subtask) => ({
          type: "subtask" as const,
          id: subtask.id,
          title: subtask.title,
        })),
    ]
  }, [query, stories, tasks, subtasks])

  const exportJson = () => {
    const url = URL.createObjectURL(
      new Blob([exportProjectJson()], {
        type: "application/json;charset=utf-8",
      }),
    )
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "scrumflow-course-project.json"
    anchor.click()
    URL.revokeObjectURL(url)
    setMenu(null)
    notify("项目 JSON 已导出")
  }

  const importJson = async (file?: File) => {
    if (!file) return
    const result = importProjectJson(await file.text())
    notify(result.message, result.ok ? "success" : "error")
    setMenu(null)
    if (importRef.current) importRef.current.value = ""
  }

  const exportPlanningView = async (view: "story-map" | "gantt") => {
    setMenu(null)
    setExportingView(view)
    notify(`正在后台渲染${view === "story-map" ? "故事地图" : "甘特图"}…`, "info")
    try {
      const state = useProjectStore.getState()
      if (view === "story-map") await exportStoryMapPng(state)
      else await exportGanttPng(state)
      notify(`${view === "story-map" ? "故事地图" : "甘特图"} PNG 已导出`)
    } catch (error) {
      notify(error instanceof Error ? error.message : "图片导出失败", "error")
    } finally {
      setExportingView(null)
    }
  }

  return (
    <header className="relative z-50 flex h-[52px] flex-shrink-0 items-center border-b border-[#E2E7EE] bg-white">
      <div className="flex h-full items-center gap-3 border-r border-[#F2F4F7] px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-sm font-bold text-white">
          S
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-xs">
          <b className="text-[#172033]">ScrumFlow</b>
          <span className="text-[#D0D5DD]">/</span>
          <span className="max-w-44 truncate font-medium text-[#475467]">
            {project.name}
          </span>
        </div>
        <div className="relative">
          <button
            className="icon-button"
            onClick={() => setMenu(menu === "nav" ? null : "nav")}
            title="工作区视图"
          >
            <Grid2X2 size={15} />
          </button>
          {menu === "nav" && (
            <Popup onClose={() => setMenu(null)} width={220}>
              {workspaceMenuGroups.map((group, groupIndex) => <div key={group.label}>
                {groupIndex > 0 && <div className="mx-3 my-1.5 border-t border-[#E4E7EC]" />}
                <div className="px-3 pb-1 pt-1.5 text-[9px] font-semibold uppercase text-[#98A2B3]">{group.label}</div>
                {group.items.map((item) => {
                  const Icon = item.icon
                  const planningView = views.some((view) => view.id === item.id)
                  return <button key={item.id} className="menu-row" onClick={() => {
                    if (planningView) navigateTo(item.id as "story-map" | "gantt" | "board")
                    else setWorkspace({ currentPage: item.id })
                    setMenu(null)
                  }}><Icon size={14} />{item.label}</button>
                })}
              </div>)}
            </Popup>
          )}
        </div>
      </div>

      <div className="flex flex-1 justify-center">
        <div className="flex rounded-lg border border-[#EAECF0] bg-[#F9FAFB] p-1">
          {views.map((view) => {
            const Icon = view.icon
            const active = workspace.currentPage === view.id
            return (
              <button
                key={view.id}
                className="flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-medium transition"
                style={{
                  background: active ? "white" : "transparent",
                  color: active ? "#172033" : "#667085",
                  boxShadow: active ? "0 1px 3px rgba(16,24,40,.1)" : "none",
                }}
                onClick={() => navigateTo(view.id)}
              >
                <Icon size={13} />
                {view.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex h-full items-center gap-2 border-l border-[#F2F4F7] px-3">
        <div className="flex items-center rounded-lg border border-[#E2E7EE] px-2">
          <CalendarRange size={13} className="text-[#667085]" />
          <select
            value={workspace.selectedSprintId}
            onChange={(event) => selectSprint(event.target.value)}
            className="h-8 cursor-pointer bg-transparent px-1.5 text-xs font-medium text-[#344054] outline-none"
          >
            {Object.values(sprints).map((sprint) => (
              <option key={sprint.id} value={sprint.id}>
                {sprint.name}
              </option>
            ))}
          </select>
        </div>
        <div className="hidden items-center gap-1.5 rounded-lg border border-[#E9D7FE] bg-[#F9F5FF] px-2 py-1.5 text-[10px] font-medium text-[#6941C6] xl:flex">
          <ShieldCheck size={12} />
          DRI {members.m1?.name}
        </div>
        <div className="hidden -space-x-1.5 2xl:flex">
          {Object.values(members).map((member) => (
            <MemberAvatar key={member.id} memberId={member.id} size={25} />
          ))}
        </div>
        <button
          className="icon-button"
          onClick={() => setSearchOpen(true)}
          title="搜索"
        >
          <Search size={15} />
        </button>
        <div className="relative">
          <button
            className="icon-button relative"
            onClick={() => setMenu(menu === "notice" ? null : "notice")}
            title="待确认建议"
            aria-label="待确认建议"
          >
            <Bell size={15} />
            {pendingProposals.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[#F04438] px-1 text-[9px] font-semibold text-white">
                {pendingProposals.length}
              </span>
            )}
          </button>
          {menu === "notice" && (
            <Popup onClose={() => setMenu(null)} width={320} align="right">
              <div className="flex items-center justify-between border-b border-[#F2F4F7] px-3 py-2">
                <span className="text-xs font-semibold">待确认建议</span>
                <span className="text-[10px] text-[#98A2B3]">{pendingProposals.length} 条</span>
              </div>
              <div className="max-h-80 overflow-y-auto p-2">
                {!pendingProposals.length && (
                  <div className="py-6 text-center text-[10px] text-[#98A2B3]">
                    暂无待确认建议
                  </div>
                )}
                {pendingProposals.map((proposal) => {
                  const accepted = proposal.actions.filter((action) => action.decision === "accepted").length
                  const finished = proposal.status === "applied" || proposal.status === "rejected"
                  return (
                    <div key={proposal.id} className="mb-2 rounded-lg border border-[#E2E7EE] p-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="rounded bg-[#F4F3FF] px-1.5 py-0.5 text-[9px] font-semibold text-[#6941C6]">
                          {proposal.origin === "meeting" ? "会议" : "事件"}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[#344054]">
                          {proposal.summary}
                        </span>
                      </div>
                      <div className="mt-1 text-[9px] text-[#98A2B3]">
                        {proposal.agentType} · {proposal.actions.length} 个动作 · 已采纳 {accepted} · {proposalStatusLabel(proposal)}
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <button
                          className="secondary-button"
                          disabled={finished}
                          onClick={() =>
                            proposal.actions.filter((action) => action.status === "pending").forEach((action) =>
                              setProposalActionDecision(
                                proposal.id,
                                action.id,
                                "accepted",
                              ),
                            )
                          }
                        >
                          全部采纳
                        </button>
                        <button
                          className="primary-button"
                          disabled={finished}
                          onClick={() => {
                            const result = applyProposal(proposal.id)
                            notify(result.message, result.ok ? "success" : "error")
                          }}
                        >
                          执行
                        </button>
                        <button
                          className="secondary-button"
                          disabled={finished}
                          onClick={() => {
                            rejectProposal(proposal.id, "在待确认列表中忽略")
                            notify("建议已忽略", "info")
                          }}
                        >
                          忽略
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Popup>
          )}
        </div>
        <div className="relative">
          <button
            className="icon-button"
            onClick={() => setMenu(menu === "tools" ? null : "tools")}
            title="项目数据工具"
          >
            <MoreHorizontal size={16} />
          </button>
          {menu === "tools" && (
            <Popup onClose={() => setMenu(null)} width={205} align="right">
              <button className="menu-row" onClick={exportJson}>
                <Download size={14} />
                导出项目 JSON
              </button>
              <button className="menu-row" disabled={exportingView !== null} onClick={() => void exportPlanningView("story-map")}>
                <Download size={14} />
                {exportingView === "story-map" ? "正在渲染故事地图…" : "导出故事地图 PNG"}
              </button>
              <button className="menu-row" disabled={exportingView !== null} onClick={() => void exportPlanningView("gantt")}>
                <Download size={14} />
                {exportingView === "gantt" ? "正在渲染甘特图…" : "导出甘特图 PNG"}
              </button>
              <button
                className="menu-row"
                onClick={() => importRef.current?.click()}
              >
                <FileUp size={14} />
                导入项目 JSON
              </button>
              <button
                className="menu-row text-[#B42318]"
                onClick={() => {
                  if (window.confirm("确定重置为课程演示数据吗？")) {
                    resetDemoData()
                    setMenu(null)
                    notify("演示数据已重置")
                  }
                }}
              >
                <RotateCcw size={14} />
                重置演示数据
              </button>
            </Popup>
          )}
        </div>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => importJson(event.target.files?.[0])}
        />
        <div className="hidden items-center gap-1 xl:flex">
          <MemberAvatar memberId={workspace.currentUserId} size={26} />
          <ChevronDown size={12} className="text-[#98A2B3]" />
        </div>
      </div>

      {searchOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-start justify-center bg-[#101828]/20 pt-[12vh]"
          onMouseDown={() => setSearchOpen(false)}
        >
          <div
            className="w-[520px] overflow-hidden rounded-xl border border-[#E2E7EE] bg-white shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-[#EAECF0] px-4 py-3">
              <Search size={17} className="text-[#667085]" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="flex-1 text-sm outline-none"
                placeholder="搜索 Story ID、标题或工程任务..."
              />
              <button
                className="icon-button"
                onClick={() => setSearchOpen(false)}
              >
                <X size={15} />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {query && !results.length && (
                <div className="py-8 text-center text-xs text-[#98A2B3]">
                  没有匹配结果
                </div>
              )}
              {results.map((result) => (
                <button
                  key={`${result.type}-${result.id}`}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-[#F9FAFB]"
                  onClick={() => {
                    requestFocus(
                      result.type,
                      result.id,
                      result.type === "story" ? "story-map" : "gantt",
                    )
                    setSearchOpen(false)
                    setQuery("")
                  }}
                >
                  <span className="rounded bg-[#F4F3FF] px-1.5 py-1 font-mono text-[10px] font-semibold text-[#6941C6]">
                    {result.id.toUpperCase()}
                  </span>
                  <span className="truncate text-xs font-medium text-[#344054]">
                    {result.title}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </header>
  )
}

function Popup({
  children,
  onClose,
  width,
  align = "left",
}: {
  children: React.ReactNode
  onClose: () => void
  width: number
  align?: "left" | "right"
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="absolute top-full z-50 mt-1.5 overflow-hidden rounded-lg border border-[#E2E7EE] bg-white py-1 shadow-xl"
        style={{ width, [align]: 0 }}
      >
        {children}
      </div>
    </>
  )
}
