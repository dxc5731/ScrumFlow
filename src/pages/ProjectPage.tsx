import { useProjectStore } from "../store/projectStore"
import { OverviewPage, SettingsPage } from "./ManagementPages"
import ProjectUseCasePage from "./ProjectUseCasePage"

export default function ProjectPage() {
  const state = useProjectStore()
  const tab =
    state.workspace.currentPage === "project-use-case"
      ? "use-case"
      : state.workspace.currentPage === "settings"
        ? "details"
        : (state.workspace.projectTab ?? "overview")
  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav
        aria-label="项目栏目"
        className="flex shrink-0 items-center gap-1 border-b border-[#E2E7EE] bg-white px-5"
      >
        <span className="mr-4 text-sm font-semibold text-[#344054]">项目</span>
        <div role="tablist" aria-label="项目内容" className="flex gap-1">
          {([
            { id: "overview", label: "概况" },
            { id: "details", label: "基本资料" },
            { id: "use-case", label: "项目用例图" },
          ] as const).map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              aria-controls="project-content"
              className={
                "border-b-2 px-4 py-3 text-xs " +
                (tab === item.id
                  ? "border-[#7F56D9] font-semibold text-[#6941C6]"
                  : "border-transparent text-[#667085] hover:text-[#344054]")
              }
              onClick={() =>
                state.setWorkspace({
                  currentPage: "overview",
                  projectTab: item.id,
                })
              }
            >
              {item.label}
            </button>
          ))}
        </div>
      </nav>
      <div id="project-content" role="tabpanel" className="min-h-0 flex-1">
        {tab === "use-case" ? (
          <ProjectUseCasePage />
        ) : tab === "details" ? (
          <SettingsPage />
        ) : (
          <OverviewPage />
        )}
      </div>
    </div>
  )
}
