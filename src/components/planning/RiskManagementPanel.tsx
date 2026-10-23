import { useState } from "react"
import { Plus, Pencil, Trash2, ShieldAlert } from "lucide-react"
import type { RiskEntity } from "../../types"
import { useProjectStore } from "../../store/projectStore"
import {
  riskTargetInScope,
  risksInScope,
  type RiskScope,
} from "../../utils/riskScope"
import Modal from "./Modal"
import { MemberAvatar, notify } from "./ui"

type Draft = Omit<RiskEntity, "id" | "createdAt" | "updatedAt">
const levels = { high: "高风险", medium: "中风险", low: "低风险" }
const statuses = { open: "开放", mitigating: "应对中", resolved: "已解决" }
export default function RiskManagementPanel({
  scope,
  initiallyAll = false,
}: {
  scope: RiskScope
  initiallyAll?: boolean
}) {
  const state = useProjectStore()
  const [all, setAll] = useState(initiallyAll)
  const [status, setStatus] = useState("all")
  const [editing, setEditing] = useState<string | null>(null)
  const blank = (): Draft => ({
    title: "",
    targetType: scope.type === "sprint" ? "sprint" : "story",
    targetId:
      scope.type === "sprint"
        ? scope.id
        : (Object.values(state.stories).find(
            (story) => story.releaseId === scope.id,
          )?.id ?? ""),
    level: "medium",
    description: "",
    impact: "",
    mitigation: "",
    ownerId:
      state.members[state.workspace.currentUserId]?.id ??
      Object.keys(state.members)[0] ??
      "",
    status: "open",
  })
  const [draft, setDraft] = useState<Draft>(blank)
  const scoped = risksInScope(state, scope)
  const risks = (all ? Object.values(state.risks) : scoped)
    .filter((risk) => status === "all" || risk.status === status)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const targets = Object.values(
    draft.targetType === "story"
      ? state.stories
      : draft.targetType === "task"
        ? state.tasks
        : state.sprints,
  ).filter(
    (target) =>
      all || riskTargetInScope(state, scope, draft.targetType, target.id),
  )
  const scopeLabel = scope.type === "sprint" ? "本 Sprint" : "本 Release"
  const save = () => {
    try {
      if (editing !== "new") {
        const result = state.updateRisk(editing!, draft)
        notify(result.message, result.ok ? "success" : "error")
        if (!result.ok) return
      } else {
        state.createRisk(draft)
        notify("风险已登记")
      }
      setEditing(null)
    } catch (error) {
      notify(error instanceof Error ? error.message : "保存失败", "error")
    }
  }
  const openTarget = (risk: RiskEntity) => {
    if (risk.targetType === "sprint") {
      state.selectSprint(risk.targetId)
      state.setWorkspace({ currentPage: "sprint", sprintTab: "progress" })
    } else
      state.requestFocus(
        risk.targetType,
        risk.targetId,
        risk.targetType === "story" ? "story-map" : "gantt",
      )
  }
  return (
    <section aria-label="风险管理" className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[#344054]">
            <ShieldAlert size={16} />
            {all ? "全部项目风险" : scopeLabel + " 风险管理"}
          </h2>
          <p className="mt-1 text-[11px] text-[#667085]">
            {all
              ? "跨 Sprint 和 Release 查看与管理所有登记风险。"
              : "包含关联故事、工程任务与迭代的风险，保留负责人、应对措施和处理状态。"}
          </p>
        </div>
        <button className="secondary-button" onClick={() => setAll(!all)}>
          {all
            ? "返回" + scopeLabel
            : "查看全部（" + Object.keys(state.risks).length + "）"}
        </button>
        <button
          className="primary-button"
          onClick={() => {
            setDraft(blank())
            setEditing("new")
          }}
        >
          <Plus size={13} />
          登记风险
        </button>
      </header>
      <div className="flex items-center gap-3 text-xs text-[#667085]">
        <span className="whitespace-nowrap">
          {all ? "全部" : scopeLabel} · {risks.length} 条
        </span>
        <select
          aria-label="风险状态筛选"
          className="form-input ml-auto shrink-0"
          style={{ width: 144 }}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">全部状态</option>
          {Object.entries(statuses).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-3">
        {risks.map((risk) => (
          <article
            key={risk.id}
            className="rounded-lg border border-[#E2E7EE] bg-white p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 flex-1 text-sm font-semibold text-[#344054]">
                {risk.title}
              </h3>
              <span
                className={
                  risk.level === "high"
                    ? "text-xs font-medium text-[#B42318]"
                    : "text-xs text-[#B54708]"
                }
              >
                {levels[risk.level]}
              </span>
              <button
                className="icon-button"
                aria-label={"编辑风险：" + risk.title}
                onClick={() => {
                  setDraft({ ...risk })
                  setEditing(risk.id)
                }}
              >
                <Pencil size={13} />
              </button>
              <button
                className="icon-button text-[#B42318]"
                aria-label={"删除风险：" + risk.title}
                onClick={() => {
                  const result = state.deleteRisk(risk.id)
                  notify(result.message, result.ok ? "success" : "error")
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#667085]">
              {risk.description || "尚未填写风险说明"}
            </p>
            <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-[#98A2B3]">潜在影响</dt>
                <dd className="mt-1 whitespace-pre-wrap leading-5 text-[#475467]">
                  {risk.impact || "待补充"}
                </dd>
              </div>
              <div>
                <dt className="text-[#98A2B3]">应对措施</dt>
                <dd className="mt-1 whitespace-pre-wrap leading-5 text-[#475467]">
                  {risk.mitigation || "待补充"}
                </dd>
              </div>
            </dl>
            <footer className="mt-3 flex flex-wrap items-center gap-3 border-t border-[#F2F4F7] pt-3 text-[11px]">
              <button
                className="text-left text-[#175CD3] hover:underline"
                onClick={() => openTarget(risk)}
              >
                {risk.targetType} ·{" "}
                {risk.targetType === "story"
                  ? state.stories[risk.targetId]?.title
                  : risk.targetType === "task"
                    ? state.tasks[risk.targetId]?.title
                    : state.sprints[risk.targetId]?.name}
              </button>
              <span className="ml-auto flex items-center gap-2">
                <MemberAvatar memberId={risk.ownerId} size={20} />
                {state.members[risk.ownerId]?.name ?? "未分配"}
              </span>
              <select
                aria-label={"处理状态：" + risk.title}
                className="rounded border border-[#D0D5DD] bg-white px-2 py-1"
                value={risk.status}
                onChange={(e) => {
                  const result = state.updateRisk(risk.id, {
                    status: e.target.value as RiskEntity["status"],
                  })
                  if (!result.ok) notify(result.message, "error")
                }}
              >
                {Object.entries(statuses).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </footer>
          </article>
        ))}
        {!risks.length && (
          <div className="rounded-lg border border-dashed border-[#D0D5DD] p-10 text-center text-xs text-[#98A2B3]">
            当前范围没有符合条件的风险
          </div>
        )}
      </div>
      <Modal
        open={editing !== null}
        title={editing === "new" ? "登记风险" : "编辑风险"}
        onClose={() => setEditing(null)}
        footer={
          <>
            <button
              className="secondary-button"
              onClick={() => setEditing(null)}
            >
              取消
            </button>
            <button className="primary-button" onClick={save}>
              保存风险
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block text-xs">
            风险标题
            <input
              aria-label="风险标题"
              className="form-input mt-1"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs">
              关联类型
              <select
                aria-label="风险关联类型"
                className="form-input mt-1"
                value={draft.targetType}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    targetType: e.target.value as Draft["targetType"],
                    targetId: "",
                  })
                }
              >
                <option value="story">Story</option>
                <option value="task">Task</option>
                <option value="sprint">Sprint</option>
              </select>
            </label>
            <label className="text-xs">
              关联对象
              <select
                aria-label="风险关联对象"
                className="form-input mt-1"
                value={draft.targetId}
                onChange={(e) =>
                  setDraft({ ...draft, targetId: e.target.value })
                }
              >
                <option value="">选择关联对象</option>
                {targets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {"title" in target ? target.title : target.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs">
              风险等级
              <select
                aria-label="风险等级"
                className="form-input mt-1"
                value={draft.level}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    level: e.target.value as Draft["level"],
                  })
                }
              >
                {Object.entries(levels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              处理状态
              <select
                aria-label="风险处理状态"
                className="form-input mt-1"
                value={draft.status}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    status: e.target.value as Draft["status"],
                  })
                }
              >
                {Object.entries(statuses).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-xs">
            负责人
            <select
              aria-label="风险负责人"
              className="form-input mt-1"
              value={draft.ownerId}
              onChange={(e) => setDraft({ ...draft, ownerId: e.target.value })}
            >
              {Object.values(state.members).map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} · {member.role}
                </option>
              ))}
            </select>
          </label>
          {([
            ["description", "风险说明"],
            ["impact", "潜在影响"],
            ["mitigation", "应对措施"],
          ] as const).map(([field, label]) => (
            <label key={field} className="block text-xs">
              {label}
              <textarea
                aria-label={label}
                className="form-input mt-1 min-h-20"
                value={draft[field]}
                onChange={(e) =>
                  setDraft({ ...draft, [field]: e.target.value })
                }
              />
            </label>
          ))}
        </div>
      </Modal>
    </section>
  )
}
