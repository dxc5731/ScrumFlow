import { useMemo, useRef, useState } from "react"
import { Download, Map, Network, Wand2 } from "lucide-react"
import UmlCanvas, { renderUmlCanvasPng } from "../components/uml/UmlCanvas"
import Modal from "../components/planning/Modal"
import { notify } from "../components/planning/ui"
import { useProjectStore } from "../store/projectStore"
import {
  goalDeletionImpact,
  projectUseCaseDiagram,
  useCaseGoalId,
} from "../utils/projectUseCase"
import { generatePlantUml } from "../utils/uml"
import type { UmlNodeEntity, UserActivityEntity } from "../types"

type Editor = {
  kind: "goal" | "actor"
  id: string | null
  title: string
  domain: UserActivityEntity["domain"]
}
const domains = {
  governance: "项目治理",
  planning: "规划管理",
  design: "设计与资产",
  delivery: "研发交付",
  quality: "质量保障",
  other: "其他",
} as const
function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a")
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function ProjectUseCasePage() {
  const state = useProjectStore()
  const diagram = useMemo(
    () => projectUseCaseDiagram(state),
    [state.activities, state.projectUseCase],
  )
  const [editor, setEditor] = useState<Editor | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [exporting, setExporting] = useState(false)
  const captureRef = useRef<HTMLDivElement>(null)
  const goalCount = Object.keys(state.activities).length
  const goal = deleting ? state.activities[deleting] : null
  const impact = goal ? goalDeletionImpact(state, goal.id) : null
  const navigateGoal = (nodeId: string) => {
    const id = useCaseGoalId(nodeId)
    if (!id || !state.activities[id]) return
    state.setWorkspace({
      currentPage: "story-map",
      currentView: "story-map",
      goalFocusId: id,
      backlogFullscreen: false,
      inspectorOpen: false,
      focusRequest: null,
    })
  }
  const editNode = (node: UmlNodeEntity) => {
    const id = useCaseGoalId(node.id)
    setEditor({
      kind: node.kind === "use-case" ? "goal" : "actor",
      id: id ?? node.id,
      title: node.label,
      domain: id ? state.activities[id].domain : "other",
    })
  }
  const save = () => {
    if (!editor?.title.trim()) return notify("名称不能为空", "error")
    let result = { ok: true, message: "" }
    if (editor.kind === "goal") {
      if (editor.id)
        result = state.updateActivity(editor.id, {
          title: editor.title,
          domain: editor.domain,
        })
      else {
        state.createActivity({ title: editor.title, domain: editor.domain })
        result.message = "用例和对应目标已创建"
      }
    } else if (!editor.id) result = state.addProjectUseCaseActor(editor.title)
    else
      result = state.updateProjectUseCase({
        ...diagram,
        nodes: diagram.nodes.map((node) =>
          node.id === editor.id
            ? { ...node, label: editor.title.trim() }
            : node,
        ),
      })
    notify(result.message, result.ok ? "success" : "error")
    if (result.ok) setEditor(null)
  }
  const exportPng = async () => {
    if (!captureRef.current) return
    setExporting(true)
    try {
      download(
        state.project.name + "-项目用例图.png",
        await renderUmlCanvasPng(captureRef.current),
      )
      notify("项目用例图已导出")
    } catch (error) {
      notify(error instanceof Error ? error.message : "导出失败", "error")
    } finally {
      setExporting(false)
    }
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#F8FAFC]">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[#E2E7EE] bg-white px-5 py-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#F4F3FF] text-[#6941C6]">
          <Network size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold text-[#172033]">项目用例图</h1>
          <p className="mt-1 text-[11px] text-[#667085]">
            {state.project.name} · 项目专属 · 与用户故事地图顶层目标双向同步
          </p>
        </div>
        <span className="rounded-full border border-[#ABEFC6] bg-[#ECFDF3] px-3 py-1 text-[11px] text-[#067647]">
          {goalCount} 个目标 ↔ {goalCount} 个用例
        </span>
        <button
          className="secondary-button"
          onClick={() =>
            state.setWorkspace({
              currentPage: "story-map",
              currentView: "story-map",
            })
          }
        >
          <Map size={13} />
          用户地图
        </button>
        <button
          className="secondary-button"
          onClick={() => {
            const result = state.arrangeProjectUseCase()
            notify(result.message, result.ok ? "success" : "error")
            if (result.ok) setRevision((value) => value + 1)
          }}
        >
          <Wand2 size={13} />
          整理布局
        </button>
        <button
          className="secondary-button"
          disabled={exporting || !diagram.nodes.length}
          onClick={exportPng}
        >
          <Download size={13} />
          {exporting ? "正在导出…" : "导出 PNG"}
        </button>
        <button
          className="secondary-button"
          onClick={() =>
            download(
              state.project.name + "-项目用例图.puml",
              new Blob([generatePlantUml(diagram)], {
                type: "text/plain;charset=utf-8",
              }),
            )
          }
        >
          PlantUML
        </button>
      </header>
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-b border-[#E2E7EE] bg-[#F9FAFB] px-5 py-2 text-[10px] text-[#667085]">
        <span>用例即目标：新增、改名与删除在两处同时生效。</span>
        <span>参与者、连线和布局独立保存，不占用 Story 设计资产。</span>
        {goalCount === 0 && (
          <span className="text-[#6941C6]">
            点击“新增用例 / 目标”开始建立项目范围。
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <UmlCanvas
          key={state.project.id + ":" + goalCount + ":" + revision}
          diagram={diagram}
          captureRef={captureRef}
          onChange={(next) => {
            const result = state.updateProjectUseCase(next)
            if (!result.ok) notify(result.message, "error")
          }}
          projectGoalControls={{
            onCreateGoal: () =>
              setEditor({ kind: "goal", id: null, title: "", domain: "other" }),
            onCreateActor: () =>
              setEditor({
                kind: "actor",
                id: null,
                title: "",
                domain: "other",
              }),
            onEditNode: editNode,
            onDeleteGoal: (nodeId) => setDeleting(useCaseGoalId(nodeId)),
            onLocateGoal: navigateGoal,
          }}
        />
      </div>
      <Modal
        open={editor !== null}
        title={
          editor?.kind === "goal"
            ? editor.id
              ? "编辑用例 / 目标"
              : "新增用例 / 目标"
            : editor?.id
              ? "编辑参与者"
              : "新增参与者"
        }
        description={
          editor?.kind === "goal"
            ? "保存后同时更新用户故事地图中的同一目标；已有需求归属保持关联。"
            : "参与者属于项目用例图，可以连接到一个或多个用例。"
        }
        onClose={() => setEditor(null)}
        footer={
          <>
            <button
              className="secondary-button"
              onClick={() => setEditor(null)}
            >
              取消
            </button>
            <button className="primary-button" onClick={save}>
              保存
            </button>
          </>
        }
      >
        {editor && (
          <div className="space-y-4">
            <label className="block text-xs text-[#475467]">
              {editor.kind === "goal" ? "目标 / 用例名称" : "参与者名称"} *
              <input
                autoFocus
                className="form-input mt-2"
                value={editor.title}
                onChange={(e) =>
                  setEditor({ ...editor, title: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    save()
                  }
                }}
              />
            </label>
            {editor.kind === "goal" && (
              <label className="block text-xs text-[#475467]">
                目标领域
                <select
                  className="form-input mt-2"
                  value={editor.domain}
                  onChange={(e) =>
                    setEditor({
                      ...editor,
                      domain: e.target.value as UserActivityEntity["domain"],
                    })
                  }
                >
                  {Object.entries(domains).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
      </Modal>
      <Modal
        open={Boolean(goal)}
        title="删除用例及对应目标"
        description="用例与目标是同一业务对象，不能只删除其中一个。"
        onClose={() => setDeleting(null)}
        footer={
          <>
            <button
              className="secondary-button"
              onClick={() => setDeleting(null)}
            >
              取消
            </button>
            <button
              className="primary-button bg-[#D92D20]"
              onClick={() => {
                if (!goal) return
                const result = state.deleteActivity(goal.id)
                notify(result.message, result.ok ? "success" : "error")
                if (result.ok) setDeleting(null)
              }}
            >
              确认删除用例和目标
            </button>
          </>
        }
      >
        {goal && impact && (
          <div className="space-y-3 text-xs leading-relaxed">
            <p>
              将删除“<b>{goal.title}</b>
              ”及其对应目标，并清理项目用例图中的相关连线。
            </p>
            <p className="rounded-lg border border-[#FECDCA] bg-[#FEF3F2] p-3 text-[#B42318]">
              同时删除：{impact.epics} 个 Epic、{impact.stories} 个 Story、
              {impact.tasks} 个 Task、{impact.subtasks} 个
              Subtask。相关依赖和资产关联按现有目标删除规则清理。
            </p>
            <p className="text-[#667085]">
              如果包含已关闭 Sprint 的
              Story，系统会阻止删除。取消不会修改目标、用例或连线。
            </p>
          </div>
        )}
      </Modal>
    </div>
  )
}
