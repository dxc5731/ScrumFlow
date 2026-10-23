import RiskManagementPanel from "../components/planning/RiskManagementPanel"
import { useState } from "react"
import { Plus, Rocket, Pencil, CalendarRange } from "lucide-react"
import { useProjectStore } from "../store/projectStore"
import { RELEASE_STATUS, releaseSummary } from "../store/release"
import type { ReleaseEntity } from "../types"
import Modal from "../components/planning/Modal"
import ReleaseAssignmentButton from "../components/planning/ReleaseAssignmentButton"
import { notify } from "../components/planning/ui"

export default function ReleasePage() {
  const state = useProjectStore()
  const releases = Object.values(state.releases).sort((a, b) =>
    a.plannedDate.localeCompare(b.plannedDate),
  )
  const [contentTab, setContentTab] = useState<"stories" | "risks">("stories")
  const [selectedId, setSelectedId] = useState(releases[0]?.id ?? "unassigned")
  const release = state.releases[selectedId]
  const summary = release ? releaseSummary(state, release.id, new Date()) : null
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState({
    name: "",
    goal: "",
    plannedDate: state.project.endDate,
    status: "planning" as ReleaseEntity["status"],
  })
  const [publishing, setPublishing] = useState(false)
  const [backlog, setBacklog] = useState(false)
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<string[]>([])
  const isPO = state.workspace.actorMode === "po"
  const stories = Object.values(state.stories).filter(
    (story) =>
      (backlog
        ? !story.sprintId && story.releaseId !== selectedId
        : release
          ? story.releaseId === release.id
          : !story.releaseId) &&
      (story.id + story.title).toLowerCase().includes(query.toLowerCase()),
  )
  const selectedStories = selected.filter((id) =>
    stories.some((story) => story.id === id),
  )
  const selectRelease = (id: string) => {
    setContentTab("stories")
    setSelectedId(id)
    setSelected([])
    setBacklog(false)
    setQuery("")
  }
  const openEdit = (value?: ReleaseEntity) => {
    setDraft(
      value
        ? {
            name: value.name,
            goal: value.goal,
            plannedDate: value.plannedDate,
            status: value.status,
          }
        : {
            name: "",
            goal: "",
            plannedDate: state.project.endDate,
            status: "planning",
          },
    )
    setEditing(value?.id ?? "new")
  }
  const save = () => {
    try {
      if (editing === "new") {
        const created = state.createRelease({
          ...draft,
          status: draft.status as "planning" | "active",
        })
        selectRelease(created.id)
        notify("Release 已创建")
      } else {
        const result = state.updateRelease(editing!, draft)
        notify(result.message, result.ok ? "success" : "error")
        if (!result.ok) return
      }
      setEditing(null)
    } catch (error) {
      notify(error instanceof Error ? error.message : "保存失败", "error")
    }
  }
  const openStory = (id: string) => state.requestFocus("story", id, "story-map")
  return (
    <div className="flex h-full bg-[#F8FAFC]">
      <aside className="w-64 shrink-0 overflow-y-auto border-r border-[#E2E7EE] bg-white p-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-sm font-semibold">Release 管理</h1>
          <button
            className="icon-button"
            title="新建 Release"
            disabled={!isPO}
            onClick={() => openEdit()}
          >
            <Plus size={16} />
          </button>
        </div>
        <button
          className="mb-3 w-full rounded-lg border p-3 text-left text-xs"
          onClick={() => selectRelease("unassigned")}
          style={{ borderColor: !release ? "#7F56D9" : "#E2E7EE" }}
        >
          未分配 Release{" "}
          <b className="float-right">
            {Object.values(state.stories).filter((s) => !s.releaseId).length}
          </b>
        </button>
        {releases.map((item) => (
          <button
            key={item.id}
            className="mb-2 w-full rounded-lg border p-3 text-left"
            style={{
              borderColor: selectedId === item.id ? "#7F56D9" : "#E2E7EE",
              background: selectedId === item.id ? "#F9F5FF" : "white",
            }}
            onClick={() => selectRelease(item.id)}
          >
            <b className="block text-xs">{item.name}</b>
            <span className="mt-2 flex justify-between text-[10px] text-[#667085]">
              <span>{RELEASE_STATUS[item.status]}</span>
              <span>{item.plannedDate}</span>
            </span>
          </button>
        ))}
        <p className="mt-4 text-[11px] leading-relaxed text-[#667085]">
          Release 组织共同交付的故事；Sprint
          安排执行周期。版本划分不改变目标和需求层级。
        </p>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto p-6">
        <div className="mb-5 flex items-start gap-3">
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-[#172033]">
              {release?.name ?? "未分配 Release"}
            </h2>
            <p className="mt-2 text-sm text-[#667085]">
              {release?.goal ?? "先确定目标交付版本，再安排 Sprint。"}
            </p>
            {release && (
              <p className="mt-2 text-xs text-[#667085]">
                计划发布 {release.plannedDate} ·{" "}
                {RELEASE_STATUS[release.status]}
                {release.publishedAt &&
                  " · 实际发布 " +
                    new Date(release.publishedAt).toLocaleDateString("zh-CN")}
              </p>
            )}
          </div>
          {release && (
            <>
              <button
                className="secondary-button"
                disabled={!isPO || release.status === "released"}
                onClick={() => openEdit(release)}
              >
                <Pencil size={13} />
                编辑
              </button>
              <button
                className="primary-button"
                disabled={
                  !isPO || release.status === "released" || !summary?.canPublish
                }
                onClick={() => setPublishing(true)}
              >
                <Rocket size={13} />
                标记已发布
              </button>
            </>
          )}
        </div>
        {summary && (
          <>
            <div className="mb-4 grid grid-cols-5 gap-3">
              {[
                ["验收进度", summary.progress + "%"],
                [
                  "已验收故事",
                  summary.accepted.length + " / " + summary.stories.length,
                ],
                [
                  "核心已验收",
                  summary.core.filter((s) => s.deliveryStatus === "accepted")
                    .length +
                    " / " +
                    summary.core.length,
                ],
                ["逾期项", summary.overdue.length],
                ["严重阻塞", summary.severe.length],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-lg border border-[#E2E7EE] bg-white p-4"
                >
                  <div className="text-xs text-[#667085]">{label}</div>
                  <b className="mt-2 block text-xl">{value}</b>
                </div>
              ))}
            </div>
            <div className="mb-4 h-2 overflow-hidden rounded bg-[#EAECF0]">
              <div
                className="h-full bg-[#7F56D9]"
                style={{ width: summary.progress + "%" }}
              />
            </div>
            <p className="mb-4 text-xs text-[#667085]">
              发布条件：核心 Story 全部通过验收且不存在严重阻塞。
              {!summary.core.length &&
                "尚未标记核心 Story，按全部 Story 验收检查。"}
              {summary.gateIncomplete.length > 0 &&
                " 待验收：" +
                  summary.gateIncomplete.map((s) => s.title).join("、")}
            </p>
            <div className="mb-4 flex flex-wrap gap-2">
              {Object.values(state.sprints)
                .filter((s) => s.releaseId === release!.id)
                .map((s) => (
                  <button
                    className="secondary-button"
                    key={s.id}
                    onClick={() => {
                      state.selectSprint(s.id)
                      state.setWorkspace({ currentPage: "sprint" })
                    }}
                  >
                    <CalendarRange size={12} />
                    {s.name}
                  </button>
                ))}
              <button
                className="secondary-button"
                onClick={() =>
                  state.setWorkspace({
                    currentPage: "sprint",
                    releaseFilterId: release!.id,
                  })
                }
              >
                管理 Sprint
              </button>
            </div>
            {(summary.overdue.length > 0 ||
              summary.severe.length > 0 ||
              summary.highRisks.length > 0 ||
              summary.highRiskStories.length > 0) && (
              <details className="mb-5 rounded-lg border border-[#FEDF89] bg-[#FFFAEB] p-3 text-xs">
                <summary className="cursor-pointer font-semibold">
                  交付关注项：{summary.overdue.length} 项逾期 ·{" "}
                  {summary.severe.length} 项严重阻塞 ·{" "}
                  {summary.highRisks.length + summary.highRiskStories.length}{" "}
                  项高风险
                </summary>
                <div className="mt-3 grid gap-2">
                  {summary.overdue.map((item) => (
                    <button
                      key={item.type + item.id}
                      className="text-left"
                      onClick={() =>
                        state.requestFocus(item.type, item.id, "gantt")
                      }
                    >
                      逾期 · {item.title} · {item.date}
                    </button>
                  ))}
                  {summary.severe.map((item) => (
                    <div key={item.id}>
                      严重阻塞 · {item.title} ·{" "}
                      {item.blockReasons.map((r) => r.message).join("；")}
                    </div>
                  ))}
                  {summary.highRisks.map((r) => (
                    <div key={r.id}>
                      高风险 · {r.title} · {r.mitigation}
                    </div>
                  ))}
                  {summary.highRiskStories.map((s) => (
                    <div key={s.id}>
                      高风险 · {s.title} · {s.riskNote}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
        {release && (
          <div
            role="tablist"
            aria-label="Release 内容"
            className="mb-4 flex gap-1 border-b border-[#E2E7EE]"
          >
            {([
              { id: "stories", label: "版本范围" },
              { id: "risks", label: "风险管理" },
            ] as const).map((item) => (
              <button
                role="tab"
                key={item.id}
                aria-selected={contentTab === item.id}
                aria-controls="release-content"
                className={
                  "border-b-2 px-4 py-2.5 text-xs " +
                  (contentTab === item.id
                    ? "border-[#7F56D9] font-semibold text-[#6941C6]"
                    : "border-transparent text-[#667085]")
                }
                onClick={() => setContentTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
        <div id="release-content" role="tabpanel">
          {release && contentTab === "risks" ? (
            <RiskManagementPanel
              key={release.id}
              scope={{ type: "release", id: release.id }}
            />
          ) : (
            <section className="rounded-lg border border-[#E2E7EE] bg-white">
              <div className="flex flex-wrap items-center gap-3 border-b p-4">
                <h3 className="text-sm font-semibold">
                  {backlog
                    ? "可分配的 Backlog"
                    : release
                      ? "版本 Story"
                      : "待分配 Story"}
                </h3>
                <input
                  aria-label="搜索 Release Story"
                  className="form-input w-48"
                  placeholder="搜索 Story"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {release && (
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setBacklog(!backlog)
                      setSelected([])
                    }}
                  >
                    {backlog ? "返回版本范围" : "从 Backlog 分配"}
                  </button>
                )}
                <div className="ml-auto">
                  <ReleaseAssignmentButton
                    storyIds={selectedStories}
                    defaultReleaseId={backlog ? release?.id : undefined}
                    label={
                      "分配 / 调整 Release（" + selectedStories.length + "）"
                    }
                  />
                </div>
              </div>
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F9FAFB] text-[#667085]">
                  <tr>
                    <th className="p-3">
                      <input
                        aria-label="选择本页 Story"
                        type="checkbox"
                        checked={
                          stories.length > 0 &&
                          selectedStories.length === stories.length
                        }
                        onChange={(e) =>
                          setSelected(
                            e.target.checked ? stories.map((s) => s.id) : [],
                          )
                        }
                      />
                    </th>
                    <th>用户故事</th>
                    <th>目标 Release</th>
                    <th>Sprint</th>
                    <th>验收</th>
                    <th>核心</th>
                  </tr>
                </thead>
                <tbody>
                  {stories.map((story) => (
                    <tr key={story.id} className="border-t border-[#E2E7EE]">
                      <td className="p-3">
                        <input
                          aria-label={"选择 " + story.title}
                          type="checkbox"
                          checked={selected.includes(story.id)}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, story.id]
                                : selected.filter((id) => id !== story.id),
                            )
                          }
                        />
                      </td>
                      <td className="max-w-sm py-3 pr-4">
                        <button
                          className="text-left font-medium text-[#344054]"
                          onClick={() => openStory(story.id)}
                        >
                          {story.title}
                        </button>
                        {Boolean(story.releaseChanges?.length) && (
                          <details className="mt-1 text-[10px] text-[#667085]">
                            <summary>归属调整记录</summary>
                            {story.releaseChanges!.map((item, i) => (
                              <div key={i} className="mt-1">
                                {state.releases[item.fromReleaseId ?? ""]
                                  ?.name ?? "未分配"}{" "}
                                →{" "}
                                {state.releases[item.toReleaseId ?? ""]?.name ??
                                  "未分配"}
                                ：{item.reason}（
                                {state.members[item.byId]?.name} ·{" "}
                                {new Date(item.at).toLocaleDateString("zh-CN")}
                                ）
                              </div>
                            ))}
                          </details>
                        )}
                      </td>
                      <td>
                        {state.releases[story.releaseId ?? ""]?.name ??
                          "未分配"}
                      </td>
                      <td>
                        {state.sprints[story.sprintId ?? ""]?.name ?? "Backlog"}
                      </td>
                      <td>
                        {story.deliveryStatus === "accepted"
                          ? "已验收"
                          : "未验收"}
                      </td>
                      <td>
                        <input
                          aria-label={"核心 Story：" + story.title}
                          type="checkbox"
                          disabled={
                            !isPO ||
                            state.releases[story.releaseId ?? ""]?.status ===
                              "released"
                          }
                          checked={Boolean(story.isReleaseCore)}
                          onChange={(e) => {
                            const result = state.updateStory(story.id, {
                              isReleaseCore: e.target.checked,
                            })
                            notify(
                              result.message,
                              result.ok ? "success" : "error",
                            )
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!stories.length && (
                <p className="p-10 text-center text-sm text-[#98A2B3]">
                  当前范围没有 Story
                </p>
              )}
            </section>
          )}
        </div>
      </main>
      <Modal
        open={editing !== null}
        title={editing === "new" ? "新建 Release" : "编辑 Release"}
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
              保存 Release
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block text-xs">
            版本名称 *
            <input
              className="form-input mt-1"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="block text-xs">
            Release Goal *
            <textarea
              className="form-input mt-1 min-h-24"
              value={draft.goal}
              onChange={(e) => setDraft({ ...draft, goal: e.target.value })}
            />
          </label>
          <label className="block text-xs">
            计划发布日期 *
            <input
              type="date"
              className="form-input mt-1"
              value={draft.plannedDate}
              onChange={(e) =>
                setDraft({ ...draft, plannedDate: e.target.value })
              }
            />
          </label>
          <label className="block text-xs">
            状态
            <select
              className="form-input mt-1"
              value={draft.status}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  status: e.target.value as ReleaseEntity["status"],
                })
              }
            >
              <option value="planning">规划中</option>
              <option value="active">进行中</option>
            </select>
          </label>
        </div>
      </Modal>
      <Modal
        open={publishing}
        title="确认发布 Release"
        description="发布时会再次检查最新验收结果与严重阻塞。"
        onClose={() => setPublishing(false)}
        footer={
          <>
            <button
              className="secondary-button"
              onClick={() => setPublishing(false)}
            >
              取消
            </button>
            <button
              className="primary-button"
              onClick={() => {
                if (!release) return
                const result = state.updateRelease(release.id, {
                  status: "released",
                })
                notify(result.message, result.ok ? "success" : "error")
                if (result.ok) setPublishing(false)
              }}
            >
              确认发布
            </button>
          </>
        }
      >
        <p className="text-sm">
          {release?.name}：{summary?.accepted.length}/{summary?.stories.length}{" "}
          个 Story 已验收。
          {summary &&
            summary.accepted.length < summary.stories.length &&
            "非核心未完成项仍需安排后续迭代，或记录原因后移至下一 Release。"}
        </p>
      </Modal>
    </div>
  )
}
