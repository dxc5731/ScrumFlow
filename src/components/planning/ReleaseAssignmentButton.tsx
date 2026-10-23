import { useState } from "react"
import { createPortal } from "react-dom"
import Modal from "./Modal"
import { notify } from "./ui"
import { useProjectStore } from "../../store/projectStore"

export default function ReleaseAssignmentButton({
  storyIds,
  label = "调整 Release",
  defaultReleaseId,
}: {
  storyIds: string[]
  label?: string
  defaultReleaseId?: string
}) {
  const state = useProjectStore()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState("")
  const [reason, setReason] = useState("")
  const [expected, setExpected] = useState<Record<string, {
    releaseId: string | null
    sprintId: string | null
  }>>({})
  const ids = Object.keys(expected)
  const changed = ids.filter(
    (id) => expected[id].releaseId !== (target || null),
  )
  const affected = changed.filter((id) => expected[id].sprintId)
  const reasonRequired = changed.some(
    (id) => expected[id].releaseId || expected[id].sprintId,
  )
  const save = () => {
    const result = state.assignStoriesToRelease(ids, target || null, {
      confirmed: true,
      reason,
      expected,
    })
    notify(result.message, result.ok ? "success" : "error")
    if (result.ok) setOpen(false)
  }
  return (
    <>
      <button
        type="button"
        className="secondary-button"
        disabled={state.workspace.actorMode !== "po" || !storyIds.length}
        onClick={(event) => {
          event.stopPropagation()
          const selected = storyIds
            .map((id) => state.stories[id])
            .filter(Boolean)
          setExpected(
            Object.fromEntries(
              selected.map((story) => [
                story.id,
                {
                  releaseId: story.releaseId ?? null,
                  sprintId: story.sprintId,
                },
              ]),
            ),
          )
          setTarget(
            defaultReleaseId ??
              (selected.length === 1 ? (selected[0].releaseId ?? "") : ""),
          )
          setReason("")
          setOpen(true)
        }}
      >
        {label}
      </button>
      {open &&
        createPortal(
          <Modal
            open
            title="确认 Release 调整"
            description="调整交付版本不会改变需求层级；任务和子任务会继承 Story 的新归属。"
            onClose={() => setOpen(false)}
            footer={
              <>
                <button
                  className="secondary-button"
                  onClick={() => setOpen(false)}
                >
                  取消
                </button>
                <button
                  className="primary-button"
                  disabled={
                    !changed.length || (reasonRequired && !reason.trim())
                  }
                  onClick={save}
                >
                  确认调整
                </button>
              </>
            }
          >
            <div className="space-y-4">
              <label className="block text-xs">
                目标 Release
                <select
                  aria-label="目标 Release"
                  className="form-input mt-1"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">未分配 Release</option>
                  {Object.values(state.releases)
                    .filter((r) => r.status !== "released")
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
              <div className="max-h-40 space-y-2 overflow-auto text-xs">
                {ids.map((id) => (
                  <div key={id}>
                    <b>{state.stories[id]?.title}</b>
                    <div className="mt-1 text-[#667085]">
                      {state.releases[expected[id].releaseId ?? ""]?.name ??
                        "未分配 Release"}{" "}
                      ·{" "}
                      {state.sprints[expected[id].sprintId ?? ""]?.name ??
                        "尚未安排 Sprint"}
                    </div>
                  </div>
                ))}
              </div>
              <p className="rounded border border-[#FEDF89] bg-[#FFFAEB] p-3 text-xs text-[#B54708]">
                {affected.length
                  ? affected.length +
                    " 个 Story 将移出当前 Sprint，回到新 Release 的 Backlog；执行记录与验收标准保留。"
                  : "当前没有需要移出的 Sprint。分配后只能进入目标 Release 下的 Sprint。"}
              </p>
              <label className="block text-xs">
                调整原因{reasonRequired ? " *" : "（首次分配可选）"}
                <textarea
                  aria-label="调整原因"
                  className="form-input mt-1 min-h-20"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="例如：交付范围缩减，移至下一版本"
                />
              </label>
            </div>
          </Modal>,
          document.body,
        )}
    </>
  )
}
