import CanvasTopBar from "./components/CanvasTopBar";
import Inspector from "./components/planning/Inspector";
import { ToastHost } from "./components/planning/ui";
import UmlSnapshotBackfill from "./components/uml/UmlSnapshotBackfill";
import Gantt from "./pages/Gantt";
import AcceptancePage from "./pages/AcceptancePage";
import ScrumBoard from "./pages/ScrumBoard";
import SprintPage from "./pages/SprintPage";
import StoryMap from "./pages/StoryMap";
import AssetsPage from "./pages/AssetsPage";
import {
  AnalyticsPage,
  OverviewPage,
  RisksPage,
  SettingsPage,
} from "./pages/ManagementPages";
import { useProjectStore } from "./store/projectStore";
import { useEventMonitor } from "./hooks/useEventMonitor";
import LocalSaveStatus from "./components/planning/LocalSaveStatus";

export default function App() {
  useEventMonitor();
  const workspace = useProjectStore((state) => state.workspace);
  const planningPage = ["story-map", "gantt", "board"].includes(workspace.currentPage);
  const hideCollapsedInspector = workspace.currentPage === "story-map" && workspace.backlogFullscreen && !workspace.inspectorOpen;
  const page = workspace.currentPage === "overview" ? <OverviewPage />
    : workspace.currentPage === "story-map" ? <StoryMap />
    : workspace.currentPage === "gantt" ? <Gantt />
      : workspace.currentPage === "board" ? <ScrumBoard />
        : workspace.currentPage === "sprint" ? <SprintPage />
          : workspace.currentPage === "acceptance" ? <AcceptancePage />
            : workspace.currentPage === "risks" ? <RisksPage />
              : workspace.currentPage === "assets" ? <AssetsPage />
                : workspace.currentPage === "workload" ? <AnalyticsPage />
                  : workspace.currentPage === "settings" ? <SettingsPage />
                    : <OverviewPage />;

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
    </div>
  );
}
