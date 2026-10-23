import { useEffect } from "react"
import { ensureClassroomDemo } from "./agents/meetingClassroomDemo"
import GlobalAiAssistant from "./components/planning/GlobalAiAssistant"
import { useSprintWorkTracking } from "./hooks/useSprintWorkTracking"
import ProjectPage from "./pages/ProjectPage"
import ReleasePage from "./pages/ReleasePage"
import CanvasTopBar from "./components/CanvasTopBar"
import Inspector from "./components/planning/Inspector"
import { ToastHost } from "./components/planning/ui"
import UmlSnapshotBackfill from "./components/uml/UmlSnapshotBackfill"
import Gantt from "./pages/Gantt"
import ScrumBoard from "./pages/ScrumBoard"
import SprintPage from "./pages/SprintPage"
import StoryMap from "./pages/StoryMap"
import AssetsPage from "./pages/AssetsPage"
import { AnalyticsPage } from "./pages/ManagementPages"
import { useProjectStore } from "./store/projectStore"
import { useEventMonitor } from "./hooks/useEventMonitor"
import LocalSaveStatus from "./components/planning/LocalSaveStatus"

export default function App() {
  useEffect(() => {
    const prepare = () => { void ensureClassroomDemo().catch(error => console.error("演示会议准备失败", error)) }
    const unsubscribe = useProjectStore.persist.onFinishHydration(prepare)
    if (useProjectStore.persist.hasHydrated()) prepare()
    return unsubscribe
  }, [])

  useEventMonitor()
  useSprintWorkTracking()
  const workspace = useProjectStore((state) => state.workspace)
  const planningPage = ["story-map", "gantt", "board"].includes(
    workspace.currentPage,
  )
  const hideCollapsedInspector =
    workspace.currentPage === "story-map" &&
    workspace.backlogFullscreen &&
    !workspace.inspectorOpen
  const page = ["overview", "project-use-case", "settings"].includes(
    workspace.currentPage,
  ) ? (
    <ProjectPage />
  ) : workspace.currentPage === "release" ? (
    <ReleasePage />
  ) : workspace.currentPage === "story-map" ? (
    <StoryMap />
  ) : workspace.currentPage === "gantt" ? (
    <Gantt />
  ) : workspace.currentPage === "board" ? (
    <ScrumBoard />
  ) : ["sprint", "acceptance", "risks"].includes(workspace.currentPage) ? (
    <SprintPage />
  ) : workspace.currentPage === "assets" ? (
    <AssetsPage />
  ) : workspace.currentPage === "workload" ? (
    <AnalyticsPage />
  ) : (
    <ProjectPage />
  )

  return (
    <div className="flex h-full flex-col bg-[#F8FAFC]">
      <CanvasTopBar />
      <LocalSaveStatus />
      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-hidden">
          <div key={workspace.currentPage} className="page-enter h-full">
            {page}
          </div>
        </main>
        {planningPage && !hideCollapsedInspector && <Inspector />}
      </div>
      <UmlSnapshotBackfill />
      <ToastHost />
      <GlobalAiAssistant />
    </div>
  )
}
