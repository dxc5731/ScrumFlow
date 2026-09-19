import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, ClipboardCheck, Clock3, RotateCcw } from "lucide-react"
import StoryAcceptancePanel from "../components/planning/StoryAcceptancePanel"
import { useProjectStore } from "../store/projectStore"
import {
  selectAcceptanceBuckets,
  selectProjectCompletion,
  selectStoryExecutionLeaves,
} from "../store/selectors"
import type { StoryEntity } from "../types"

const groups = [
  { key: "pending" as const, label: "待验收", icon: ClipboardCheck, color: "#B54708" },
  { key: "returned" as const, label: "退回修改", icon: RotateCcw, color: "#B42318" },
  { key: "inFlight" as const, label: "进行中", icon: Clock3, color: "#175CD3" },
  { key: "accepted" as const, label: "已验收", icon: CheckCircle2, color: "#667085" },
]

export default function AcceptancePage() {
  const state = useProjectStore()
  const sprintId = state.workspace.selectedSprintId
  const sprint = state.sprints[sprintId]
  const buckets = useMemo(
    () => selectAcceptanceBuckets(state, sprintId),
    [state, sprintId],
  )
  const completion = selectProjectCompletion(state)
  const all = groups.flatMap((group) => buckets[group.key])
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(
    all[0]?.id ?? null,
  )

  useEffect(() => {
    if (selectedStoryId && all.some((story) => story.id === selectedStoryId)) return
    setSelectedStoryId(buckets.pending[0]?.id ?? all[0]?.id ?? null)
  }, [sprintId, all.map((story) => story.id).join("|")])

  const selected = selectedStoryId ? state.stories[selectedStoryId] : null
  const acceptedWidth = completion.totalPoints
    ? (completion.acceptedPoints / completion.totalPoints) * 100
    : 0
  const pendingWidth = completion.totalPoints
    ? (completion.pendingAcceptancePoints / completion.totalPoints) * 100
    : 0

  return (
    <div className="flex h-full bg-[#F8FAFC]">
      <aside className="flex w-[330px] flex-shrink-0 flex-col border-r border-[#E2E7EE] bg-white">
        <header className="border-b border-[#EAECF0] px-4 py-3">
          <div className="flex items-center gap-2">
            <ClipboardCheck size={15} className="text-[#6941C6]" />
            <div className="min-w-0">
              <h1 className="text-xs font-semibold text-[#172033]">成果提交与 Story 验收</h1>
              <p className="truncate text-[9px] text-[#98A2B3]">{sprint?.name ?? "未选择 Sprint"}</p>
            </div>
          </div>
        </header>

        <section className="border-b border-[#EAECF0] px-4 py-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] font-semibold text-[#667085]">项目综合完成度</span>
            <b className="text-sm text-[#172033]">{completion.percent}%</b>
          </div>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-[#EAECF0]">
            <div className="bg-[#98A2B3]" style={{ width: `${acceptedWidth}%` }} />
            <div className="bg-[#FDB022]" style={{ width: `${pendingWidth}%` }} />
          </div>
          <div className="mt-2 flex gap-3 text-[9px] text-[#667085]">
            <span>已验收 {completion.acceptedPoints} pt</span>
            <span className="text-[#B54708]">待验收 {completion.pendingAcceptancePoints} pt</span>
            <span>共 {completion.totalPoints} pt</span>
          </div>
          <p className="mt-1 text-[9px] leading-relaxed text-[#98A2B3]">
            综合执行叶节点进度、阻塞影响和 Story 验收结果；全部任务完成但未验收时不会达到 100%。
          </p>
        </section>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {groups.map((group) => {
            const Icon = group.icon
            return (
              <section key={group.key} className="mb-4 last:mb-0">
                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: group.color }}>
                  <Icon size={12} /> {group.label}
                  <span className="font-normal text-[#98A2B3]">{buckets[group.key].length}</span>
                </div>
                <div className="space-y-1.5">
                  {buckets[group.key].map((story) => (
                    <StoryRow
                      key={story.id}
                      story={story}
                      selected={story.id === selectedStoryId}
                      onSelect={() => setSelectedStoryId(story.id)}
                    />
                  ))}
                  {!buckets[group.key].length && (
                    <div className="rounded-md border border-dashed border-[#E2E7EE] px-2.5 py-2 text-[9px] text-[#98A2B3]">暂无</div>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        {selected ? (
          <div className="mx-auto max-w-[960px] p-5">
            <header className="mb-4 flex items-start gap-3 border-b border-[#EAECF0] pb-4">
              <span className="rounded bg-[#F2F4F7] px-2 py-1 font-mono text-[10px] font-semibold text-[#344054]">{selected.id.toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-[#172033]">{selected.title}</h2>
                <p className="mt-1 text-[10px] text-[#667085]">PO 可在此核对 Story 目标、AC、Task/Subtask、成果、风险与未解决问题。</p>
              </div>
              <button className="secondary-button" onClick={() => state.requestFocus("story", selected.id, "story-map")}>在用户地图打开</button>
            </header>
            <StoryAcceptancePanel storyId={selected.id} />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-[#98A2B3]">当前 Sprint 没有 Story</div>
        )}
      </main>
    </div>
  )
}

function StoryRow({
  story,
  selected,
  onSelect,
}: {
  story: StoryEntity
  selected: boolean
  onSelect: () => void
}) {
  const state = useProjectStore()
  const leaves = selectStoryExecutionLeaves(state, story.id)
  const done = leaves.filter((leaf) => leaf.status === "done").length
  const returnedCount = story.acceptanceLog.filter(
    (record) => record.result === "returned",
  ).length
  return (
    <button
      className="w-full rounded-lg border px-3 py-2.5 text-left"
      style={{
        borderColor: selected ? "#A5B4FC" : "#E2E7EE",
        background: selected ? "#F5F7FF" : "white",
      }}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[#344054]">{story.title}</span>
        <span className="font-mono text-[9px] text-[#98A2B3]">{story.storyPoints} pt</span>
      </div>
      <div className="mt-1 flex gap-2 text-[9px] text-[#98A2B3]">
        <span>执行项 {done}/{leaves.length}</span>
        {returnedCount > 0 && <span className="text-[#B42318]">退回 {returnedCount} 次</span>}
      </div>
    </button>
  )
}
