import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  Sparkles,
  MessageCircle,
  Maximize2,
  Activity,
  ClipboardCheck,
  FileStack,
  Clock3,
  Settings2,
  RefreshCw,
  X,
  Loader2,
} from "lucide-react"
import MeetingRoom, { type MeetingRoomSection } from "./MeetingRoom"
import { useProjectStore } from "../../store/projectStore"
import { selectPendingProposals } from "../../store/selectors"
import { notify } from "./ui"
import { useAiLauncherPosition } from "../../hooks/useAiLauncherPosition"
import "./GlobalAiAssistant.css"

type ModelState = "unknown" | "checking" | "configured" | "missing" | "error"
export default function GlobalAiAssistant() {
  const state = useProjectStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [mountedId, setMountedId] = useState<string | null>(null)
  const [minimized, setMinimized] = useState(true)
  const [presentation, setPresentation] = useState<"full" | "compact">(
    "compact",
  )
  const [viewRequest, setViewRequest] = useState<{
    section: MeetingRoomSection
    nonce: number
  }>()
  const [working, setWorking] = useState(false)
  const [modelState, setModelState] = useState<ModelState>("unknown")
  const [showConfig, setShowConfig] = useState(false)
  const requestNumber = useRef(0)
  const sectionNumber = useRef(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const launcher = useAiLauncherPosition(() => setMenuOpen(false))
  const [menuHeight, setMenuHeight] = useState(560)
  useEffect(() => {
    if (!menuOpen || !menuRef.current) return
    const element = menuRef.current
    const measure = () => setMenuHeight(element.getBoundingClientRect().height || 560)
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [menuOpen])
  const session = mountedId ? state.meetingSessions[mountedId] : null
  const validSession = session?.projectId === state.project.id ? session : null
  const pending = selectPendingProposals(state).length
  const sprint =
    state.sprints[state.workspace.selectedSprintId] ??
    Object.values(state.sprints).find((item) => item.status === "active") ??
    Object.values(state.sprints)[0]
  const syncSession = useCallback((id: string) => {
    const current = useProjectStore.getState()
    if (
      current.meetingSessions[id]?.projectId === current.project.id &&
      current.workspace.aiSessionId !== id
    )
      current.setWorkspace({ aiSessionId: id })
  }, [])
  const checkModel = async () => {
    const request = ++requestNumber.current
    setModelState("checking")
    try {
      const response = await fetch("/api/meeting-llm")
      if (!response.ok) throw new Error("读取模型配置失败")
      const value = await response.json()
      if (request === requestNumber.current)
        setModelState(value.configured === true ? "configured" : "missing")
    } catch {
      if (request === requestNumber.current) setModelState("error")
    }
  }
  useEffect(() => {
    setMenuOpen(false)
    setMountedId(null)
    setMinimized(true)
    setWorking(false)
  }, [state.project.id])
  useEffect(() => {
    if (mountedId && !validSession) {
      setMountedId(null)
      setMinimized(true)
      setWorking(false)
    }
  }, [mountedId, validSession?.id])
  useEffect(() => {
    if (menuOpen || !minimized) void checkModel()
  }, [menuOpen, minimized])
  useEffect(() => {
    if (!menuOpen) return
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus()
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false)
    }
    document.addEventListener("keydown", close)
    return () => document.removeEventListener("keydown", close)
  }, [menuOpen])
  useEffect(
    () => () => {
      requestNumber.current++
    },
    [],
  )

  const openRoom = (
    section: MeetingRoomSection,
    size: "full" | "compact",
    newConversation = false,
  ) => {
    const current = useProjectStore.getState()
    const owned = Object.values(current.meetingSessions)
      .filter((item) => item.projectId === current.project.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const saved = current.meetingSessions[current.workspace.aiSessionId ?? ""]
    const reusable =
      saved?.projectId === current.project.id &&
      saved.status === "active" &&
      saved.targetType === "project" &&
      saved.createdBy === current.workspace.currentUserId
        ? saved
        : owned.find(
            (item) =>
              item.status === "active" &&
              item.targetType === "project" &&
              item.createdBy === current.workspace.currentUserId,
          )
    if (working && (newConversation || section !== "chat")) {
      notify("当前助手仍在处理，请完成后再切换会话", "error")
      return
    }
    let selected =
      section === "history" ? owned[0] : newConversation ? undefined : reusable
    if (!selected && section === "history") {
      notify("暂无历史会议，可以先开始一次对话")
      return
    }
    if (!selected)
      selected = current.createMeeting("project", current.project.id)
    current.setWorkspace({ aiSessionId: selected.id })
    setMountedId(selected.id)
    setPresentation(size)
    setMinimized(false)
    setMenuOpen(false)
    setViewRequest({ section, nonce: ++sectionNumber.current })
  }
  const shortcut = (type: "events" | "proposals") => {
    if (type === "events" && !sprint) {
      notify("请先创建 Sprint，再查看迭代事件分析")
      return
    }
    state.setWorkspace({
      ...(type === "events"
        ? {
            currentPage: "sprint" as const,
            sprintTab: "progress" as const,
            selectedSprintId: sprint!.id,
          }
        : {}),
      aiFocusRequest: { type, nonce: Date.now() },
    })
    setMenuOpen(false)
    setMinimized(true)
  }
  const toggleMenu = () => {
    setMenuOpen(!menuOpen)
    if (!menuOpen) setMinimized(true)
  }
  const modelLabel = {
    unknown: "模型状态未检查",
    checking: "正在检查模型配置",
    configured: "在线模型已配置",
    missing: "在线模型待配置",
    error: "模型状态读取失败",
  }[modelState]
  return createPortal(
    <>
      {validSession && (
        <MeetingRoom
          key={validSession.id}
          initialSessionId={validSession.id}
          onClose={() => setMinimized(true)}
          onMinimize={() => setMinimized(true)}
          presentation={presentation}
          floatingStyle={launcher.panelStyle(460, Math.min(launcher.size.width <= 540 ? 650 : 670, launcher.size.height - (launcher.size.width <= 540 ? 102 : 120)))}
          onTogglePresentation={() =>
            setPresentation((value) => (value === "full" ? "compact" : "full"))
          }
          hidden={minimized}
          viewRequest={viewRequest}
          onWorkingChange={setWorking}
          onSessionChange={syncSession}
          modelNotice={
            modelState === "missing"
              ? "在线能力需配置 API Key；可以先使用项目事实查询。"
              : modelState === "error"
                ? "模型服务状态暂时无法读取，可在 AI 菜单中重新检测。"
                : undefined
          }
        />
      )}
      {menuOpen && (
        <>
          <button
            className="ai-launcher-backdrop"
            aria-label="关闭 AI 功能菜单"
            onClick={() => setMenuOpen(false)}
          />
          <div
            ref={menuRef}
            className="ai-launcher-menu"
            style={launcher.panelStyle(355, menuHeight)}
            role="dialog"
            aria-modal="false"
            aria-label="AI 工作台"
          >
            <header>
              <div>
                <span className="ai-launcher-eyebrow">SCRUMFLOW AI</span>
                <h2>有什么可以帮你？</h2>
                <p>随时讨论项目，也能快速进入工作。</p>
              </div>
              <button
                className="ai-launcher-close"
                aria-label="关闭 AI 工作台"
                onClick={() => setMenuOpen(false)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="ai-launcher-primary">
              <button onClick={() => openRoom("chat", "compact")}>
                <MessageCircle size={20} />
                <span>
                  <strong>{validSession ? "继续快捷聊天" : "快捷聊天"}</strong>
                  <small>切换 Agent、提问或生成工作建议</small>
                </span>
              </button>
              <button
                onClick={() => openRoom("chat", "full")}
                aria-label="打开完整 AI 会议室"
                title="打开完整 AI 会议室"
              >
                <Maximize2 size={18} />
              </button>
            </div>
            <div className="ai-launcher-links">
              <button onClick={() => shortcut("events")}>
                <Activity size={17} />
                <span>
                  <strong>AI 事件分析</strong>
                  <small>
                    {sprint?.name ?? "先创建 Sprint，再检查执行风险"}
                  </small>
                </span>
              </button>
              <button onClick={() => shortcut("proposals")}>
                <ClipboardCheck size={17} />
                <span>
                  <strong>待确认建议</strong>
                  <small>查看、审核并执行 Agent 提案</small>
                </span>
                {pending > 0 && <b>{pending}</b>}
              </button>
              <button onClick={() => openRoom("materials", "full")}>
                <FileStack size={17} />
                <span>
                  <strong>材料整理</strong>
                  <small>图表、纪要、Word 与 Excel</small>
                </span>
              </button>
              <button onClick={() => openRoom("history", "full")}>
                <Clock3 size={17} />
                <span>
                  <strong>会议记录与纪要</strong>
                  <small>继续讨论或查看已有成果</small>
                </span>
              </button>
            </div>
            <div className="ai-launcher-session">
              <button
                onClick={() => openRoom("chat", "compact", true)}
                disabled={working}
              >
                新建对话
              </button>
              <span>对话随项目保存，收起后可继续</span>
            </div>
            <footer>
              <span className={"ai-model-state ai-model-state--" + modelState}>
                <i />
                {modelLabel}
              </span>
              <button
                aria-label="模型配置说明"
                title="模型配置说明"
                onClick={() => setShowConfig(!showConfig)}
              >
                <Settings2 size={15} />
              </button>
              <button
                aria-label="重新检测模型配置"
                title="重新检测模型配置"
                disabled={modelState === "checking"}
                onClick={() => void checkModel()}
              >
                <RefreshCw size={14} />
              </button>
            </footer>
            {showConfig && (
              <div className="ai-launcher-config">
                <strong>配置在线模型</strong>
                <p>
                  在项目根目录的 <code>.env.local</code> 中填写{" "}
                  <code>DEEPSEEK_API_KEY</code>
                  ，保存后点击“重新检测模型配置”。密钥只由本地服务端读取。
                </p>
                <p>
                  “已配置”表示已读到配置；实际调用是否成功，还取决于密钥、模型和账户额度。
                </p>
              </div>
            )}
          </div>
        </>
      )}
      <button
        className={"ai-launcher-orb" + (menuOpen ? " is-open" : "") + (launcher.dragging ? " is-dragging" : "")}
        style={{ left: launcher.point.x, top: launcher.point.y, right: "auto", bottom: "auto" }}
        onPointerDown={launcher.onPointerDown}
        onPointerMove={launcher.onPointerMove}
        onPointerUp={launcher.onPointerUp}
        onPointerCancel={launcher.onPointerCancel}
        onLostPointerCapture={launcher.onLostPointerCapture}
        aria-label="AI 助手"
        title="拖动调整位置，点击打开 AI 助手"
        aria-expanded={menuOpen}
        onClick={() => { if (!launcher.consumeDragClick()) toggleMenu() }}
      >
        {working ? (
          <Loader2 size={23} className="ai-launcher-spinning" />
        ) : menuOpen ? (
          <X size={23} />
        ) : (
          <Sparkles size={23} />
        )}
        <span>AI</span>
        {pending > 0 && <b>{pending > 99 ? "99+" : pending}</b>}
      </button>
    </>,
    document.body,
  )
}
