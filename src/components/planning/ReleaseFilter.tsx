import { useProjectStore } from "../../store/projectStore"
export default function ReleaseFilter() {
  const state = useProjectStore(),
    filter = state.workspace.releaseFilterId ?? ""
  return (
    <select
      aria-label="Release 筛选"
      className="filter-select max-w-48"
      value={filter}
      onChange={(event) => {
        const releaseFilterId = event.target.value
        const release = state.releases[releaseFilterId]
        const stories = Object.values(state.stories).filter(
          (story) => !release || story.releaseId === release.id,
        )
        state.setWorkspace({
          releaseFilterId,
          ganttHeatmapHighlight: null,
          ...(releaseFilterId
            ? {
                ganttRangeStart: [
                  state.project.startDate,
                  ...stories.map((s) => s.startDate),
                ].sort()[0],
                ganttRangeEnd: [
                  state.project.endDate,
                  release?.plannedDate ?? state.project.endDate,
                  ...stories.map((s) => s.dueDate),
                ]
                  .sort()
                  .at(-1)!,
              }
            : {}),
        })
      }}
    >
      <option value="">当前 Sprint</option>
      <option value="all">全部 Release（跨 Sprint）</option>
      <option value="unassigned">未分配 Release</option>
      {Object.values(state.releases).map((release) => (
        <option key={release.id} value={release.id}>
          {release.name}
        </option>
      ))}
    </select>
  )
}
