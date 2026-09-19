import { useMemo, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  RotateCcw,
  ShieldCheck,
} from "lucide-react"
import { useProjectStore } from "../../store/projectStore"
import {
  selectStoryCriteria,
  selectStoryExecutionLeaves,
  selectRisks,
  selectStoryTasks,
} from "../../store/selectors"
import Modal from "./Modal"
import ResultSubmissionPanel from "./ResultSubmissionPanel"
import { TASK_STATUS_COLORS } from "./statusColors"
import { notify } from "./ui"

const deliveryLabels = {
  backlog: "Product Backlog",
  planned: "已规划",
  in_progress: "进行中",
  pending_acceptance: "待验收",
  accepted: "已验收",
  returned: "已退回",
}

export default function StoryAcceptancePanel({
  storyId,
  compact = false,
}: {
  storyId: string
  compact?: boolean
}) {
  const state = useProjectStore()
  const story = state.stories[storyId]
  const registeredRisks = selectRisks(state, "story", storyId).filter((risk) => risk.status !== "resolved")
  const [dialog, setDialog] = useState<"accept" | "return" | null>(null)
  const [note, setNote] = useState("")
  const [reason, setReason] = useState("")
  const [resetTo, setResetTo] = useState<"in_progress" | "review">("in_progress")
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [openResult, setOpenResult] = useState<string | null>(null)

  const criteria = story ? selectStoryCriteria(state, storyId) : []
  const tasks = story ? selectStoryTasks(state, storyId) : []
  const leaves = story ? selectStoryExecutionLeaves(state, storyId) : []
  const reopenable = leaves.filter((leaf) => leaf.status === "done")
  const unresolved = leaves.flatMap((leaf) =>
    leaf.blockReasons.map((block) => ({ leaf, block })),
  )
  const resultCount = leaves.filter((leaf) => leaf.submittedAt).length
  const warnings = useMemo(() => {
    const items: string[] = []
    if (!criteria.length) items.push("尚未填写验收标准")
    else if (criteria.some((item) => !item.satisfied)) {
      items.push("仍有验收标准未勾选为已满足")
    }
    if (leaves.length && !resultCount) items.push("执行项尚未提交成果")
    if (unresolved.length) items.push("当前仍存在未解决阻塞")
    return items
  }, [criteria, leaves.length, resultCount, unresolved.length])

  if (!story) return null
  const latestReturn = [...story.acceptanceLog]
    .reverse()
    .find((record) => record.result === "returned")
  const canAccept =
    state.workspace.actorMode === "po" &&
    story.deliveryStatus === "pending_acceptance"
  const canReturn =
    state.workspace.actorMode === "po" &&
    (story.deliveryStatus === "pending_acceptance" ||
      story.deliveryStatus === "accepted")

  const openReturn = () => {
    setReason("")
    setPicked(new Set())
    setResetTo("in_progress")
    setDialog("return")
  }

  return (
    <div className="space-y-4">
      <section
        className="rounded-lg border p-3"
        style={{
          borderColor:
            story.deliveryStatus === "pending_acceptance" ? "#FEDF89" : "#E2E7EE",
          background:
            story.deliveryStatus === "pending_acceptance" ? "#FFFCF5" : "#FFFFFF",
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-[#344054]">
            {deliveryLabels[story.deliveryStatus]}
          </span>
          <span className="text-[10px] text-[#667085]">
            执行项 {leaves.filter((leaf) => leaf.status === "done").length}/{leaves.length} 完成
          </span>
          <span className="text-[10px] text-[#667085]">
            成果 {resultCount}/{leaves.length} 已提交
          </span>
          <div className="ml-auto flex gap-1.5">
            <button
              className="primary-button"
              disabled={!canAccept}
              title={canAccept ? "验收通过" : "仅 PO 可验收待验收 Story"}
              onClick={() => {
                setNote("")
                setDialog("accept")
              }}
            >
              <ShieldCheck size={13} /> 验收通过
            </button>
            <button
              className="secondary-button text-[#B42318]"
              disabled={!canReturn}
              title={canReturn ? "退回修改" : "仅待验收或已验收 Story 可退回"}
              onClick={openReturn}
            >
              <RotateCcw size={13} /> 退回修改
            </button>
          </div>
        </div>
        {story.deliveryStatus === "pending_acceptance" && (
          <p className="mt-2 text-[10px] leading-relaxed text-[#B54708]">
            执行项已完成，但 Story 只有经 PO 验收通过后才计为完全完成。
          </p>
        )}
        {latestReturn && story.deliveryStatus === "in_progress" && (
          <div className="mt-2 rounded-md bg-[#FEF3F2] px-2.5 py-2 text-[10px] text-[#912018]">
            最近退回原因：{latestReturn.note}
          </div>
        )}
      </section>

      {!compact && (
        <section className="rounded-lg border border-[#E2E7EE] bg-[#FCFCFD] p-3">
          <div className="text-[10px] font-semibold uppercase text-[#98A2B3]">
            Story 描述与预期目标
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[#475467]">
            作为{story.as || "未填写角色"}，我希望{story.iWant || "未填写需求"}，从而
            {story.soThat || "未填写目标"}。
          </p>
          <p className="mt-2 text-[10px] text-[#667085]">
            预期收益：{story.expectedBenefit || "未填写"}
          </p>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-[10px] font-semibold uppercase text-[#98A2B3]">
            验收标准
          </h3>
          <span className="text-[10px] text-[#667085]">
            {criteria.filter((item) => item.satisfied).length}/{criteria.length}
          </span>
        </div>
        <div className="space-y-1.5">
          {criteria.map((criterion) => (
            <label
              key={criterion.id}
              className="flex items-start gap-2 rounded-md border border-[#E2E7EE] bg-white px-2.5 py-2 text-[11px] text-[#475467]"
            >
              <input
                type="checkbox"
                checked={criterion.satisfied}
                disabled={state.workspace.actorMode !== "po"}
                title={state.workspace.actorMode === "po" ? "更新验收标准检查结果" : "仅 PO 可更新验收检查结果"}
                onChange={(event) =>
                  state.updateAcceptanceCriterion(criterion.id, {
                    satisfied: event.target.checked,
                  })
                }
              />
              <span className="leading-relaxed">{criterion.content}</span>
            </label>
          ))}
          {!criteria.length && (
            <p className="rounded-md border border-dashed border-[#D0D5DD] px-3 py-3 text-[10px] text-[#98A2B3]">
              尚未填写验收标准。验收时会提示，但不作为强制门禁。
            </p>
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-[10px] font-semibold uppercase text-[#98A2B3]">
          Task、Subtask 与成果
        </h3>
        <div className="space-y-2">
          {tasks.map((task) => {
            const taskLeaves = leaves.filter(
              (leaf) => leaf.id === task.id || leaf.parentTaskId === task.id,
            )
            const taskColors = TASK_STATUS_COLORS[task.status]
            return (
              <div key={task.id} className="rounded-lg border border-[#E2E7EE] bg-white">
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[#344054]">
                    {task.title}
                  </span>
                  <span
                    className="rounded px-1.5 py-0.5 text-[9px] font-medium"
                    style={{ background: taskColors.bg, color: taskColors.color }}
                  >
                    {taskStatusLabel(task.status)}
                  </span>
                  <span className="text-[10px] text-[#667085]">
                    {taskLeaves.filter((leaf) => leaf.status === "done").length}/{taskLeaves.length}
                  </span>
                </div>
                <div className="border-t border-[#F2F4F7] p-2">
                  {taskLeaves.map((leaf) => {
                    const colors = TASK_STATUS_COLORS[leaf.status]
                    const resultOpen = openResult === `${leaf.type}:${leaf.id}`
                    return (
                      <div key={`${leaf.type}:${leaf.id}`} className="mb-1.5 last:mb-0">
                        <button
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[#F9FAFB]"
                          onClick={() =>
                            setOpenResult(resultOpen ? null : `${leaf.type}:${leaf.id}`)
                          }
                        >
                          {resultOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          <span className="min-w-0 flex-1 truncate text-[10px] text-[#475467]">
                            {leaf.type === "subtask" ? "Subtask · " : "Task · "}{leaf.title}
                          </span>
                          <span
                            className="rounded px-1.5 py-0.5 text-[9px] font-medium"
                            style={{ background: colors.bg, color: colors.color }}
                          >
                            {taskStatusLabel(leaf.status)}
                          </span>
                          <span className="text-[9px] text-[#98A2B3]">
                            {leaf.submittedAt ? "已提交成果" : "未提交成果"}
                          </span>
                        </button>
                        {resultOpen && (
                          <div className="border-l-2 border-[#D9D6FE] py-2 pl-3">
                            <ResultSubmissionPanel type={leaf.type} id={leaf.id} compact />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-[#E2E7EE] p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[#667085]">
            <AlertTriangle size={12} /> 当前风险
          </div>
          <div className="mt-2 space-y-1 text-[10px] leading-relaxed text-[#475467]">
            {registeredRisks.map((risk) => <p key={risk.id}><b>{risk.level.toUpperCase()} · {risk.title}</b>：{risk.impact || risk.description}</p>)}
            {!registeredRisks.length && <p>{story.risk === "none" ? "无已登记风险" : `${story.risk.toUpperCase()} · ${story.riskNote || "未填写风险说明"}`}</p>}
          </div>
        </div>
        <div className="rounded-lg border border-[#E2E7EE] p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[#667085]">
            <AlertTriangle size={12} /> 未解决问题
          </div>
          {unresolved.length ? (
            <ul className="mt-2 space-y-1 text-[10px] text-[#B42318]">
              {unresolved.map(({ leaf, block }) => (
                <li key={block.id}>{leaf.title}：{block.message}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[10px] text-[#475467]">无未解决阻塞</p>
          )}
        </div>
      </section>

      {story.acceptanceLog.length > 0 && (
        <section>
          <h3 className="mb-2 text-[10px] font-semibold uppercase text-[#98A2B3]">
            验收往返记录
          </h3>
          <div className="space-y-1.5">
            {story.acceptanceLog.map((record) => (
              <div
                key={record.id}
                className="rounded-md border px-2.5 py-2 text-[10px]"
                style={{
                  borderColor: record.result === "accepted" ? "#ABEFC6" : "#FECDCA",
                  background: record.result === "accepted" ? "#F6FEF9" : "#FFFBFA",
                }}
              >
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={11} />
                  <b>{record.result === "accepted" ? "验收通过" : "退回修改"}</b>
                  <span className="text-[#98A2B3]">
                    {new Date(record.at).toLocaleString("zh-CN")} · {state.members[record.byId]?.name ?? record.byId}
                  </span>
                </div>
                {record.note && <p className="mt-1 text-[#475467]">{record.note}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      <Modal
        open={dialog === "accept"}
        title={`验收通过：${story.title}`}
        description="验收记录只追加不覆盖。AC 未完全勾选或成果不完整时会保留提示，但由 PO 作最终判断。"
        onClose={() => setDialog(null)}
        footer={
          <>
            <button className="secondary-button" onClick={() => setDialog(null)}>取消</button>
            <button
              className="primary-button"
              onClick={() => {
                const result = state.acceptStory(story.id, note)
                notify(result.message, result.ok ? "success" : "error")
                if (result.ok) setDialog(null)
              }}
            >
              确认验收通过
            </button>
          </>
        }
      >
        {warnings.length > 0 && (
          <div className="mb-3 rounded-md bg-[#FFFAEB] px-3 py-2 text-[11px] text-[#B54708]">
            {warnings.map((warning) => <p key={warning}>• {warning}</p>)}
          </div>
        )}
        <label className="text-[10px] font-semibold text-[#667085]">验收说明（可选）</label>
        <textarea className="form-input mt-1 min-h-24 resize-y" value={note} onChange={(event) => setNote(event.target.value)} />
      </Modal>

      <Modal
        open={dialog === "return"}
        title={`退回修改：${story.title}`}
        description="必须填写原因并至少重开一个已完成执行项。Story 会立即恢复为进行中，退回结论保留在日志。"
        onClose={() => setDialog(null)}
        footer={
          <>
            <button className="secondary-button" onClick={() => setDialog(null)}>取消</button>
            <button
              className="primary-button bg-[#D92D20]"
              disabled={!reason.trim() || !picked.size}
              onClick={() => {
                const result = state.returnStory(
                  story.id,
                  reason,
                  reopenable
                    .filter((leaf) => picked.has(`${leaf.type}:${leaf.id}`))
                    .map((leaf) => ({ type: leaf.type, id: leaf.id })),
                  resetTo,
                )
                notify(result.message, result.ok ? "success" : "error")
                if (result.ok) setDialog(null)
              }}
            >
              确认退回
            </button>
          </>
        }
      >
        <label className="text-[10px] font-semibold text-[#667085]">退回原因 *</label>
        <textarea className="form-input mt-1 min-h-20 resize-y" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="明确说明需要修改或补充的内容" />
        <div className="mt-4 text-[10px] font-semibold text-[#667085]">重开执行项 *</div>
        <div className="mt-1.5 space-y-1.5">
          {reopenable.map((leaf) => {
            const key = `${leaf.type}:${leaf.id}`
            return (
              <label key={key} className="flex items-center gap-2 rounded-md border border-[#E2E7EE] px-2.5 py-2 text-[11px] text-[#475467]">
                <input
                  type="checkbox"
                  checked={picked.has(key)}
                  onChange={() => setPicked((current) => {
                    const next = new Set(current)
                    if (next.has(key)) next.delete(key)
                    else next.add(key)
                    return next
                  })}
                />
                <span>{leaf.type === "subtask" ? "Subtask" : "Task"} · {leaf.title}</span>
              </label>
            )
          })}
        </div>
        <label className="mt-4 block text-[10px] font-semibold text-[#667085]">重开后的状态</label>
        <select className="form-input mt-1" value={resetTo} onChange={(event) => setResetTo(event.target.value as "in_progress" | "review")}>
          <option value="in_progress">进行中</option>
          <option value="review">评审</option>
        </select>
      </Modal>
    </div>
  )
}

function taskStatusLabel(status: keyof typeof TASK_STATUS_COLORS) {
  if (status === "done") return "已完成"
  if (status === "in_progress") return "进行中"
  if (status === "review") return "评审"
  if (status === "blocked") return "阻塞"
  return "待办"
}
