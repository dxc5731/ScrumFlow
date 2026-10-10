import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, differenceInCalendarDays, eachDayOfInterval, format, isWeekend, parseISO } from "date-fns";
import { CalendarDays, ChevronDown, ChevronRight, CircleAlert, GitBranch, Link2, Plus, Trash2, Users } from "lucide-react";
import { MemberAvatar, notify } from "../components/planning/ui";
import { TASK_STATUS_COLORS } from "../components/planning/statusColors";
import { planHierarchySchedule, useProjectStore } from "../store/projectStore";
import type { ScheduleChangeMode, ScheduleEntityType, ScheduleRange } from "../store/projectStore";
import { selectBlockedByIncompletePredecessor, selectCriticalPathTaskIds, selectSprintStories, selectStoryTasks, selectTaskSubtasks, selectTaskVisualState, storyDisplayStatus } from "../store/selectors";
import { EVENT_BADGE_STYLE, eventTooltip, highestSeverity, useProjectEvents } from "../hooks/useProjectEvents";
import type { EpicEntity, StoryEntity, SubtaskEntity, TaskEntity } from "../types";
import type { DetectedEvent } from "../utils/eventDetection";

const CELL = 26;
const LABEL_W = 320;
const HEADER_H = 52;
const ROW_H = { epic: 34, story: 40, task: 34, subtask: 28 };
const STATUS = TASK_STATUS_COLORS;
const STATUS_LEGEND = [
  { status: "todo", label: "待办" },
  { status: "in_progress", label: "进行中" },
  { status: "review", label: "待验收" },
  { status: "done", label: "已完成" },
  { status: "blocked", label: "阻塞" },
] as const;
const TYPE = {
  frontend: { label: "FE", color: "#175CD3", bg: "#EFF8FF" },
  backend: { label: "BE", color: "#5925DC", bg: "#F4F3FF" },
  database: { label: "DATA", color: "#B54708", bg: "#FFFAEB" },
  test: { label: "TEST", color: "#067647", bg: "#ECFDF3" },
  design: { label: "UI", color: "#9E165F", bg: "#FDF4FF" },
  devops: { label: "OPS", color: "#B42318", bg: "#FEF3F2" },
};

type Row =
  | { kind: "epic"; id: string; epicId: string; epic: EpicEntity; label: string; depth: 0; height: number }
  | { kind: "story"; id: string; epicId: string; story: StoryEntity; label: string; depth: 1; height: number }
  | { kind: "task"; id: string; epicId: string; story: StoryEntity; task: TaskEntity; label: string; depth: 2; height: number }
  | { kind: "subtask"; id: string; epicId: string; story: StoryEntity; task: TaskEntity; subtask: SubtaskEntity; label: string; depth: 3; height: number };
type DragMode = ScheduleChangeMode | "progress";
type SchedulePreview = ScheduleRange & { progress?: number };
interface DragState { entityType: ScheduleEntityType; entityId: string; mode: DragMode; startX: number; startDate: string; endDate: string; progress: number; }

export default function Gantt({
  captureOnly = false,
  captureRef,
  captureSprintId,
  captureFullScope = false,
}: {
  captureOnly?: boolean;
  captureRef?: React.Ref<HTMLDivElement>;
  captureSprintId?: string;
  captureFullScope?: boolean;
} = {}) {
  const state = useProjectStore();
  const eventIndex = useProjectEvents();
  const captureSprint = captureSprintId ? state.sprints[captureSprintId] : undefined;
  const scopedStories = captureSprint ? Object.values(state.stories).filter(story => story.sprintId === captureSprint.id) : [];
  const scopedTasks = captureSprint ? Object.values(state.tasks).filter(task => state.stories[task.storyId]?.sprintId === captureSprint.id) : [];
  const scopedSubtasks = captureSprint ? Object.values(state.subtasks).filter(subtask => scopedTasks.some(task => task.id === subtask.taskId)) : [];
  const captureRanges = [...scopedStories.map(story => ({ startDate: story.startDate, endDate: story.dueDate })), ...scopedTasks, ...scopedSubtasks];
  const workspace = captureOnly ? { ...state.workspace,
    ...(captureSprint ? { selectedSprintId: captureSprint.id, ganttRangeStart: [captureSprint.startDate, ...captureRanges.map(item => item.startDate)].sort()[0],
      ganttRangeEnd: [captureSprint.endDate, ...captureRanges.map(item => item.endDate)].sort().at(-1)! } : {}),
    ...(captureFullScope ? { memberFilterId: null, ganttCollapsedIds: [], ganttHeatmapHighlight: null } : {}),
  } : state.workspace;
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const exportView = async (format: "png" | "hd" | "pdf") => {
    setExportOpen(false); setExportBusy(true);
    try { await (await import("../utils/exportImage")).downloadGanttView(format); notify("甘特图已导出"); }
    catch (error) { notify(error instanceof Error ? error.message : "导出失败，请重试", "error"); }
    finally { setExportBusy(false); }
  };
  const containerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const dragRef = useRef<DragState | null>(null);
  const dragErrorRef = useRef<string | null>(null);
  const [preview, setPreview] = useState<Record<string, SchedulePreview>>({});
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const [dependencySource, setDependencySource] = useState<string | null>(null);
  const [selectedDependency, setSelectedDependency] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const start = parseISO(workspace.ganttRangeStart);
  const end = parseISO(workspace.ganttRangeEnd);
  const days = useMemo(() => eachDayOfInterval({ start, end }), [workspace.ganttRangeStart, workspace.ganttRangeEnd]);
  const timelineW = days.length * CELL;
  const heatmapHighlight = workspace.ganttHeatmapHighlight;
  const highlightedTaskIds = useMemo(() => new Set(heatmapHighlight?.taskIds ?? []), [heatmapHighlight]);
  const highlightedSubtaskIds = useMemo(() => new Set(heatmapHighlight?.subtaskIds ?? []), [heatmapHighlight]);

  const stories = useMemo(() => {
    const highlightedStoryIds = new Set(
      (heatmapHighlight?.taskIds ?? [])
        .map((taskId) => state.tasks[taskId]?.storyId)
        .filter(Boolean),
    );
    const visible = selectSprintStories(state, workspace.selectedSprintId)
      .filter((story) => !workspace.memberFilterId || story.assigneeId === workspace.memberFilterId);
    const included = new Set(visible.map((story) => story.id));
    Object.values(state.stories)
      .filter((story) => highlightedStoryIds.has(story.id) && !included.has(story.id))
      .sort((a, b) => a.order - b.order)
      .forEach((story) => visible.push(story));
    return visible;
  }, [state.stories, state.tasks, workspace.selectedSprintId, workspace.memberFilterId, heatmapHighlight]);
  const rows = useMemo(() => {
    const result: Row[] = [];
    const epicIds = [...new Set(stories.map((story) => story.epicId).filter(Boolean))] as string[];
    epicIds.forEach((epicId) => {
      const epic = state.epics[epicId];
      if (!epic) return;
      result.push({ kind: "epic", id: epic.id, epicId, epic, label: epic.title, depth: 0, height: ROW_H.epic });
      const epicContainsHighlight = stories.some((story) => story.epicId === epicId && selectStoryTasks(state, story.id).some((task) => highlightedTaskIds.has(task.id)));
      if (workspace.ganttCollapsedIds.includes(epic.id) && !epicContainsHighlight) return;
      stories.filter((story) => story.epicId === epicId).forEach((story) => {
        result.push({ kind: "story", id: story.id, epicId, story, label: story.title, depth: 1, height: ROW_H.story });
        const storyContainsHighlight = selectStoryTasks(state, story.id).some((task) => highlightedTaskIds.has(task.id));
        if (workspace.ganttCollapsedIds.includes(story.id) && !storyContainsHighlight) return;
        selectStoryTasks(state, story.id).forEach((task) => {
          result.push({ kind: "task", id: task.id, epicId, story, task, label: task.title, depth: 2, height: ROW_H.task });
          const taskContainsHighlight = selectTaskSubtasks(state, task.id).some((subtask) => highlightedSubtaskIds.has(subtask.id));
          if (workspace.ganttCollapsedIds.includes(task.id) && !taskContainsHighlight) return;
          selectTaskSubtasks(state, task.id).forEach((subtask) => result.push({ kind: "subtask", id: subtask.id, epicId, story, task, subtask, label: subtask.title, depth: 3, height: ROW_H.subtask }));
        });
      });
    });
    return result;
  }, [stories, state.epics, state.tasks, state.subtasks, workspace.ganttCollapsedIds, highlightedTaskIds, highlightedSubtaskIds]);

  const layout = useMemo(() => {
    let top = 0;
    return rows.map((row) => { const item = { row, top }; top += row.height; return item; });
  }, [rows]);
  const rowTop = useMemo(() => Object.fromEntries(layout.map((item) => [item.row.id, item.top + item.row.height / 2])), [layout]);
  const rowsHeight = layout.reduce((sum, item) => sum + item.row.height, 0);
  const critical = useMemo(() => selectCriticalPathTaskIds(state), [state.tasks, state.dependencies]);
  const sprint = state.sprints[workspace.selectedSprintId];
  const selectedDependencyData = selectedDependency ? state.dependencies[selectedDependency] : null;
  const todayOffset = differenceInCalendarDays(new Date(), start);
  const highlightDateOffset = heatmapHighlight
    ? differenceInCalendarDays(parseISO(heatmapHighlight.date), start)
    : null;

  useEffect(() => {
    if (captureOnly) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollLeft = workspace.ganttScrollLeft;
    el.scrollTop = workspace.ganttScrollTop;
  }, [captureOnly]);

  useEffect(() => {
    if (captureOnly) return;
    const request = workspace.focusRequest;
    if (!request) return;
    const id = request.type === "story" ? request.id : request.id;
    rowRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }, [captureOnly, workspace.focusRequest?.nonce]);

  useEffect(() => {
    if (captureOnly) return;
    if (!heatmapHighlight) return;
    const frame = window.requestAnimationFrame(() => {
      const el = containerRef.current;
      if (!el) return;
      const firstTaskId = heatmapHighlight.taskIds.find((id) => rowRefs.current[id]);
      const targetRow = firstTaskId ? rowRefs.current[firstTaskId] : null;
      const dateOffset = differenceInCalendarDays(parseISO(heatmapHighlight.date), start);
      const top = targetRow
        ? Math.max(0, targetRow.offsetTop - el.clientHeight / 2 + targetRow.offsetHeight / 2)
        : el.scrollTop;
      const left = Math.max(0, LABEL_W + dateOffset * CELL + CELL / 2 - el.clientWidth / 2);
      el.scrollTo({ top, left, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [captureOnly, heatmapHighlight?.nonce, rows, workspace.ganttRangeStart]);

  const offset = (date: string) => differenceInCalendarDays(parseISO(date), start);
  const span = (from: string, to: string) => Math.max(1, differenceInCalendarDays(parseISO(to), parseISO(from)) + 1);
  const toggle = (id: string) => state.setWorkspace({ ganttCollapsedIds: workspace.ganttCollapsedIds.includes(id) ? workspace.ganttCollapsedIds.filter((item) => item !== id) : [...workspace.ganttCollapsedIds, id] });

  const beginDrag = (event: React.MouseEvent, entityType: ScheduleEntityType, entityId: string, range: ScheduleRange & { progress?: number }, mode: DragMode) => {
    event.preventDefault();
    event.stopPropagation();
    const current = preview[entityId] ?? range;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = mode === "move" ? "grabbing" : mode === "left" ? "w-resize" : mode === "right" ? "e-resize" : "col-resize";
    document.body.style.userSelect = "none";
    dragErrorRef.current = null;
    dragRef.current = { entityType, entityId, mode, startX: event.clientX, startDate: current.startDate, endDate: current.endDate, progress: current.progress ?? 0 };
    const onMove = (moveEvent: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      moveEvent.preventDefault();
      const dayDelta = Math.round((moveEvent.clientX - drag.startX) / CELL);
      let next = { startDate: drag.startDate, endDate: drag.endDate, progress: drag.progress };
      if (drag.mode === "move") next = { ...next, startDate: format(addDays(parseISO(drag.startDate), dayDelta), "yyyy-MM-dd"), endDate: format(addDays(parseISO(drag.endDate), dayDelta), "yyyy-MM-dd") };
      if (drag.mode === "left") { const candidate = format(addDays(parseISO(drag.startDate), dayDelta), "yyyy-MM-dd"); if (candidate <= drag.endDate) next.startDate = candidate; }
      if (drag.mode === "right") { const candidate = format(addDays(parseISO(drag.endDate), dayDelta), "yyyy-MM-dd"); if (candidate >= drag.startDate) next.endDate = candidate; }
      if (drag.mode === "progress") {
        next.progress = Math.min(100, Math.max(0, drag.progress + Math.round((moveEvent.clientX - drag.startX) / 1.2)));
        const nextPreview = { [drag.entityId]: next };
        previewRef.current = nextPreview;
        setPreview(nextPreview);
        return;
      }
      const plan = planHierarchySchedule(useProjectStore.getState(), drag.entityType, drag.entityId, next.startDate, next.endDate, drag.mode);
      if (!plan.ok) {
        dragErrorRef.current = plan.message;
        return;
      }
      dragErrorRef.current = null;
      const nextPreview = { ...plan.after.epics, ...plan.after.stories, ...plan.after.tasks, ...plan.after.subtasks };
      previewRef.current = nextPreview;
      setPreview(nextPreview);
    };
    const onUp = () => {
      const drag = dragRef.current;
      if (drag) {
        const next = useProjectStore.getState();
        const value = previewRef.current[drag.entityId];
        if (dragErrorRef.current) {
          notify(dragErrorRef.current, "error");
        } else if (value) {
          const result = drag.mode === "progress"
            ? drag.entityType === "task"
              ? next.updateTask(drag.entityId, { progress: value.progress }, "drag")
              : next.updateSubtask(drag.entityId, { progress: value.progress }, "drag")
            : next.rescheduleItem(drag.entityType, drag.entityId, value.startDate, value.endDate, drag.mode, "drag");
          notify(result.message, result.ok ? "success" : "error", result.ok);
        }
      }
      dragRef.current = null;
      dragErrorRef.current = null;
      previewRef.current = {};
      setPreview({});
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const completeDependency = (targetTaskId: string) => {
    if (!dependencySource || dependencySource === targetTaskId) return;
    const result = state.addDependency(dependencySource, targetTaskId);
    notify(result.message, result.ok ? "success" : "error");
    setDependencySource(null);
  };

  return (
    <div
      ref={captureOnly ? captureRef : undefined}
      className={`relative flex min-w-0 flex-col bg-[#F8FAFC] ${captureOnly ? "planning-export-capture" : "h-full"}`}
      style={captureOnly ? { width: LABEL_W + timelineW } : undefined}
    >
      {captureOnly ? <div className="flex h-16 flex-shrink-0 items-center gap-3 border-b border-[#D0D5DD] bg-white px-5">
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-[#172033]">{state.project.name} · 甘特图</div>
          <div className="mt-1 text-[10px] text-[#667085]">{sprint?.name ?? "未选择 Sprint"} · {workspace.ganttRangeStart} 至 {workspace.ganttRangeEnd} · 当前层级折叠状态</div>
        </div>
        <span className="rounded border border-[#B2CCFF] bg-[#EFF8FF] px-2 py-1 text-[10px] font-medium text-[#175CD3]">{rows.filter((row) => row.kind === "task").length} 个任务</span>
        <span className="rounded border border-[#D9D6FE] bg-[#F4F3FF] px-2 py-1 text-[10px] font-medium text-[#5925DC]">{workspace.ganttCriticalPath ? "显示关键路径" : "普通视图"}</span>
      </div> : <div className="flex h-11 flex-shrink-0 items-center gap-3 border-b border-[#E2E7EE] bg-white px-4">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-[#344054]"><CalendarDays size={14} />紧凑 Gantt</span>
        <div className="flex items-center gap-1"><Users size={13} className="text-[#98A2B3]" />{Object.values(state.members).map((member) => <button key={member.id} style={{ opacity: workspace.memberFilterId && workspace.memberFilterId !== member.id ? .25 : 1, outline: workspace.memberFilterId === member.id ? `2px solid ${member.color}` : "none", outlineOffset: 2, borderRadius: 999 }} onClick={() => state.setWorkspace({ memberFilterId: workspace.memberFilterId === member.id ? null : member.id })}><MemberAvatar memberId={member.id} size={22} /></button>)}</div>
        <button className="toolbar-toggle" data-active={workspace.ganttCriticalPath} onClick={() => state.setWorkspace({ ganttCriticalPath: !workspace.ganttCriticalPath })}><GitBranch size={13} />关键路径</button>
        {heatmapHighlight && <div className="rounded border border-[#B2CCFF] bg-[#EFF4FF] px-2 py-1 text-[10px] font-medium text-[#175CD3]">热力图定位 · {heatmapHighlight.date} · {heatmapHighlight.taskIds.length} 个任务</div>}
        {dependencySource && <div className="flex items-center gap-2 rounded-lg border border-[#D9D6FE] bg-[#F9F5FF] px-2 py-1 text-[10px] text-[#5925DC]"><Link2 size={11} />从 {dependencySource} 选择后置任务<button onClick={() => setDependencySource(null)}>取消</button></div>}
        {selectedDependencyData && <div className="flex items-center gap-2 rounded-lg border border-[#D9D6FE] bg-[#F9F5FF] px-2 py-1 text-[10px] text-[#5925DC]"><span className="max-w-28 truncate">{state.tasks[selectedDependencyData.sourceTaskId]?.title}</span><span>→</span><span className="max-w-28 truncate">{state.tasks[selectedDependencyData.targetTaskId]?.title}</span><b>FS</b><button className="text-[#B42318]" title="删除依赖" onClick={() => { state.deleteDependency(selectedDependencyData.id); setSelectedDependency(null); notify("依赖已删除"); }}><Trash2 size={11} /></button></div>}
        <div className="ml-auto text-[10px] text-[#667085]">{sprint?.name} · {rows.filter((row) => row.kind === "task").length} 个任务</div>
        <div className="relative"><button className="toolbar-toggle" disabled={exportBusy} onClick={() => setExportOpen(!exportOpen)}>{exportBusy ? "正在导出…" : "导出"}<ChevronDown size={13} /></button>
          {exportOpen && <div className="absolute right-0 top-full z-50 mt-2 w-44 rounded-lg border border-[#E2E7EE] bg-white p-1 shadow-lg">{([ ["png", "导出 PNG"], ["hd", "导出高清图片"], ["pdf", "导出 PDF"] ] as const).map(([format, title]) => <button key={format} className="menu-row w-full" onClick={() => void exportView(format)}>{title}</button>)}</div>}
        </div>
      </div>}

      <div ref={captureOnly ? undefined : containerRef} className={captureOnly ? "overflow-visible" : "min-h-0 flex-1 overflow-auto"} onScroll={captureOnly ? undefined : (event) => state.setWorkspace({ ganttScrollLeft: event.currentTarget.scrollLeft, ganttScrollTop: event.currentTarget.scrollTop })}>
        <div className="relative" style={{ minWidth: LABEL_W + timelineW, height: HEADER_H + rowsHeight + 40 }}>
          <div className="sticky top-0 z-30 flex h-[52px] border-b border-[#E2E7EE] bg-white">
            <div className="sticky left-0 z-40 flex w-[320px] flex-shrink-0 items-end border-r border-[#E2E7EE] bg-white px-4 pb-2 text-xs font-semibold text-[#344054]">工作项</div>
            <div className="relative" style={{ width: timelineW }}>
              {highlightDateOffset !== null && highlightDateOffset >= 0 && highlightDateOffset < days.length && <span className="absolute inset-y-0 z-0 border-x border-[#B2CCFF] bg-[#EAF2FF]" style={{ left: highlightDateOffset * CELL, width: CELL }} />}
              <div className="absolute inset-x-0 top-0 flex h-6 border-b border-[#F2F4F7]">{days.filter((_, index) => index % 7 === 0).map((day, index) => <div key={day.toISOString()} className="flex items-center justify-center border-r border-[#F2F4F7] text-[9px] text-[#98A2B3]" style={{ width: Math.min(7, days.length - index * 7) * CELL }}>{format(day, "M/d")}</div>)}</div>
              <div className="absolute inset-x-0 bottom-0 z-[1] flex h-6">{days.map((day) => <div key={day.toISOString()} className="flex flex-shrink-0 items-center justify-center text-[8px]" style={{ width: CELL, color: isWeekend(day) ? "#D0D5DD" : "#98A2B3" }}>{format(day, "d")}</div>)}</div>
              {todayOffset >= 0 && todayOffset < days.length && <span className="absolute bottom-0 z-10 -translate-x-1/2 rounded-t bg-[#F79009] px-1 py-0.5 text-[7px] font-semibold text-white" style={{ left: todayOffset * CELL }}>今天</span>}
            </div>
          </div>

          <svg className="absolute z-[4]" style={{ left: LABEL_W, top: HEADER_H, width: timelineW, height: rowsHeight, overflow: "visible" }}>
            <defs><marker id="dep-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#7F56D9" /></marker></defs>
            {Object.values(state.dependencies).map((dependency, dependencyIndex) => {
              const sourceTask = state.tasks[dependency.sourceTaskId];
              const targetTask = state.tasks[dependency.targetTaskId];
              const y1 = rowTop[sourceTask?.id]; const y2 = rowTop[targetTask?.id];
              if (!sourceTask || !targetTask || y1 === undefined || y2 === undefined) return null;
              const sourceValue = preview[sourceTask.id] ?? sourceTask;
              const targetValue = preview[targetTask.id] ?? targetTask;
              const x1 = (offset(sourceValue.endDate) + 1) * CELL;
              const x2 = offset(targetValue.startDate) * CELL;
              const targetX = x2 - 10;
              const lane = 14 + (dependencyIndex % 4) * 7;
              const middle = x2 > x1 + 28
                ? Math.min(x2 - 18, x1 + Math.max(lane, (x2 - x1) / 2))
                : Math.max(x1, x2) + lane;
              const path = `M ${x1 + 2} ${y1} H ${middle} V ${y2} H ${targetX}`;
              const selected = selectedDependency === dependency.id;
              const touchesSelection = workspace.selectedObjectType === "task" && (workspace.selectedObjectId === dependency.sourceTaskId || workspace.selectedObjectId === dependency.targetTaskId);
              const faded = selectedDependency ? !selected : workspace.selectedObjectType === "task" ? !touchesSelection : false;
              return <g key={dependency.id} onClick={() => setSelectedDependency(selected ? null : dependency.id)} style={{ cursor: "pointer", pointerEvents: "stroke", opacity: faded ? .16 : selected || touchesSelection ? 1 : .56 }}><path d={path} fill="none" stroke="transparent" strokeWidth="12" /><path d={path} fill="none" stroke={selected ? "#5925DC" : touchesSelection ? "#7F56D9" : "#A4A7EC"} strokeWidth={selected ? 2 : touchesSelection ? 1.6 : 1.1} strokeDasharray={selected ? undefined : "4 4"} markerEnd="url(#dep-arrow)" /></g>;
            })}
          </svg>

          {layout.map(({ row }) => <GanttRow key={row.id} row={row} start={start} days={days} preview={preview} critical={workspace.ganttCriticalPath && critical.has(row.id)} dependencySource={dependencySource} selected={workspace.selectedObjectId === row.id} heatmapHighlighted={row.kind === "task" ? highlightedTaskIds.has(row.id) : row.kind === "subtask" ? highlightedSubtaskIds.has(row.id) : false} highlightDateOffset={highlightDateOffset} todayOffset={todayOffset} toggle={toggle} beginDrag={beginDrag} beginDependency={setDependencySource} completeDependency={completeDependency} setRef={(el) => { rowRefs.current[row.id] = el; }} events={row.kind === "task" ? eventIndex.byTaskId[row.id] : undefined} />)}
        </div>
      </div>
      {!captureOnly && <div className="absolute bottom-5 right-4 z-40 overflow-hidden rounded-lg border border-[#E2E7EE] bg-white shadow-sm">
        <button
          className="flex h-8 items-center gap-1.5 px-2.5 text-[10px] font-semibold text-[#475467]"
          onClick={() => setLegendOpen((open) => !open)}
        >
          {legendOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          图例
        </button>
        {legendOpen && (
          <div className="w-56 space-y-2.5 border-t border-[#EAECF0] p-3 text-[9px] text-[#667085]">
            <div className="font-semibold text-[#344054]">执行状态</div>
            <div className="grid grid-cols-2 gap-1.5">
              {STATUS_LEGEND.map(({ status, label }) => (
                <span key={status} className="flex items-center gap-1.5">
                  <i
                    className="h-2.5 w-5 rounded-sm border"
                    style={{
                      background: STATUS[status].strongBg,
                      borderColor: STATUS[status].accent,
                    }}
                  />
                  {label}
                </span>
              ))}
            </div>
            <div className="font-semibold text-[#344054]">工作项与关系</div>
            <div className="space-y-1.5">
              <span className="flex items-center gap-1.5">
                <i
                  className="h-3 w-7"
                  style={{
                    background: STATUS.in_progress.strongBg,
                    clipPath: "polygon(0 50%, 5px 0, calc(100% - 5px) 0, 100% 50%, calc(100% - 5px) 100%, 5px 100%)",
                    boxShadow: "inset 0 0 0 1px #2E90FA",
                  }}
                />
                粗六边形为用户故事
              </span>
              <span className="flex items-center gap-1.5">
                <i className="h-2.5 w-7 rounded-sm border border-[#2E90FA] bg-[#EFF8FF]" />
                中等条为任务
              </span>
              <span className="flex items-center gap-1.5">
                <i className="h-1.5 w-7 rounded-sm border border-[#2E90FA] bg-[#EFF8FF]" />
                细条为子任务
              </span>
              <span className="flex items-center gap-1.5">
                <i className="ml-1 h-2.5 w-2.5 rotate-45 border border-[#2E90FA] bg-[#EFF8FF]" />
                <span className="ml-3">菱形为里程碑</span>
              </span>
              <span className="flex items-center gap-1.5">
                <i className="w-7 border-t border-dashed border-[#7F56D9]" />
                紫色虚线箭头为依赖
              </span>
              <span className="flex items-center gap-1.5">
                <i className="flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border border-[#C7D7FE] text-[#6941C6]"><Plus size={9} /></i>
                <span className="ml-3">条右侧加号用于添加依赖</span>
              </span>
              <span className="flex items-center gap-1.5">
                <i className="h-3 w-7 rounded-sm border-2 border-[#7F56D9]" />
                紫色描边表示选中或关键路径
              </span>
            </div>
          </div>
        )}
      </div>}
    </div>
  );
}

function splitEpicLabel(label: string) {
  const [code, ...title] = label.trim().split(/\s+/);
  return { code, title: title.join(" ") };
}

function GanttRow({ row, start, days, preview, critical, dependencySource, selected, heatmapHighlighted, highlightDateOffset, todayOffset, toggle, beginDrag, beginDependency, completeDependency, setRef, events }: { row: Row; start: Date; days: Date[]; preview: Record<string, SchedulePreview>; critical: boolean; dependencySource: string | null; selected: boolean; heatmapHighlighted: boolean; highlightDateOffset: number | null; todayOffset: number; toggle: (id: string) => void; beginDrag: (event: React.MouseEvent, entityType: ScheduleEntityType, entityId: string, range: ScheduleRange & { progress?: number }, mode: DragMode) => void; beginDependency: (id: string | null) => void; completeDependency: (id: string) => void; setRef: (el: HTMLDivElement | null) => void; events?: DetectedEvent[] }) {
  const state = useProjectStore();
  const collapsed = state.workspace.ganttCollapsedIds.includes(row.id);
  const task = row.kind === "task" ? row.task : null;
  const story = row.kind === "story" ? row.story : row.kind === "task" || row.kind === "subtask" ? row.story : null;
  const storyValue = row.kind === "story" ? preview[row.story.id] ?? { startDate: row.story.startDate, endDate: row.story.dueDate } : null;
  const value = task ? { ...task, ...(preview[task.id] ?? {}) } : null;
  const subtaskValue = row.kind === "subtask" ? { ...row.subtask, ...(preview[row.subtask.id] ?? {}) } : null;
  const subtaskVisualState = row.kind === "subtask" ? selectTaskVisualState(row.subtask) : null;
  const left = (date: string) => differenceInCalendarDays(parseISO(date), start) * CELL;
  const width = (from: string, to: string) => Math.max(1, differenceInCalendarDays(parseISO(to), parseISO(from)) + 1) * CELL;
  const rowBg = row.kind === "epic" ? "#FAFAFA" : heatmapHighlighted ? "#F5F8FF" : selected ? "#FAFAFF" : "white";
  const canCollapse = row.kind !== "subtask" && (row.kind !== "task" || row.task.subtaskIds.length > 0);
  const blockedByDep = task ? selectBlockedByIncompletePredecessor(state, task.id) : false;
  const visualState = task ? selectTaskVisualState(task) : null;
  const taskRisk = task ? Object.values(state.risks).find((risk) => risk.targetType === "task" && risk.targetId === task.id && risk.status !== "resolved") : null;
  const epicLabel = row.kind === "epic" ? splitEpicLabel(row.label) : null;
  const storyStatus = row.kind === "story" ? STATUS[storyDisplayStatus(row.story)] : null;
  const storyOutlineWidth = selected ? 2 : 1;
  const renderDependencyButton = (taskId: string) => (
    <span
      className="absolute top-1/2 z-20 flex h-8 w-9 -translate-y-1/2 items-center justify-end pr-1 opacity-0 transition-opacity duration-100 group-hover:opacity-100 hover:opacity-100 focus-within:opacity-100"
      style={{
        left: "calc(100% + 1px)",
        opacity: dependencySource ? 1 : undefined,
      }}
    >
      <button
        className="flex h-5 w-5 items-center justify-center rounded-[4px] border bg-white text-[#6941C6] shadow-sm transition-colors hover:border-[#7F56D9] hover:bg-[#F9F5FF]"
        style={{
          borderColor: dependencySource === taskId ? "#7F56D9" : "#C7D7FE",
          background: dependencySource === taskId ? "#F4F3FF" : "white",
        }}
        title={dependencySource === taskId ? "取消添加依赖" : dependencySource ? "设为后置任务" : "添加 FS 依赖"}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (!dependencySource) beginDependency(taskId);
          else if (dependencySource === taskId) beginDependency(null);
          else completeDependency(taskId);
        }}
      >
        <Plus size={12} strokeWidth={2.4} />
      </button>
    </span>
  );
  return <div ref={setRef} className="group flex border-b border-[#F2F4F7] transition-colors hover:bg-[#F8FAFF]" style={{ height: row.height, background: rowBg }}>
    <div className="sticky left-0 z-20 flex w-[320px] flex-shrink-0 items-center gap-2 border-r border-[#E2E7EE] px-3 transition-colors group-hover:bg-[#F8FAFF]" style={{ paddingLeft: 12 + row.depth * 16, background: rowBg }}>
      {canCollapse ? <button className="icon-button h-4 w-4" onClick={() => toggle(row.id)}>{collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}</button> : <span className="h-4 w-4" />}
      {epicLabel && <span className="font-mono text-[9px] font-semibold text-[#172033]">{epicLabel.code}</span>}
      {row.kind === "story" && <span className="font-mono text-[8px] font-semibold text-[#172033]">{row.story.id.toUpperCase()}</span>}
      {row.kind === "task" && <span className="rounded px-1 py-0.5 text-[8px] font-semibold" style={{ background: TYPE[row.task.type].bg, color: TYPE[row.task.type].color }}>{TYPE[row.task.type].label}</span>}
      {row.kind === "subtask" && <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS[row.subtask.status].accent }} />}
      <button className="min-w-0 flex-1 truncate text-left" title={row.label} style={{ fontSize: row.kind === "epic" ? 11 : row.kind === "subtask" ? 9 : 10, fontWeight: row.kind === "epic" || row.kind === "story" ? 600 : 400, color: task?.status === "blocked" || (row.kind === "subtask" && row.subtask.status === "blocked") ? "#B42318" : "#344054" }} onClick={() => row.kind === "story" ? state.selectObject("story", row.id) : row.kind === "task" ? state.selectObject("task", row.id) : row.kind === "subtask" ? state.selectObject("subtask", row.id) : undefined}>{epicLabel ? epicLabel.title : row.label}</button>
      {task?.status === "blocked" && <span title={task.blockReasons.map((reason) => reason.message).join("\n")}><CircleAlert size={11} className="text-[#D92D20]" /></span>}
      {task && blockedByDep && task.status !== "blocked" && <span title="前置任务未完成"><CircleAlert size={11} className="text-[#F79009]" /></span>}
      {story && row.kind === "story" && <><MemberAvatar memberId={story.assigneeId} size={18} /><span className="font-mono text-[9px] text-[#98A2B3]">{story.storyPoints}pt</span></>}
      {visualState === "overdue" && <span className="rounded bg-[#FEF3F2] px-1 text-[8px] font-semibold text-[#B42318]">逾期</span>}
      {visualState === "severe-blocked" && <span className="rounded bg-[#B42318] px-1 text-[8px] font-semibold text-white">严重</span>}
      {taskRisk && <span className={`rounded px-1 text-[8px] font-semibold ${taskRisk.level === "high" ? "bg-[#FEF3F2] text-[#B42318]" : "bg-[#FFFAEB] text-[#B54708]"}`}>⚠{taskRisk.level === "high" ? "高" : taskRisk.level === "medium" ? "中" : "低"}</span>}
      {events && events.length > 0 && (
        <span
          className="rounded px-1 text-[8px] font-semibold"
          style={EVENT_BADGE_STYLE[highestSeverity(events) ?? "low"]}
          title={`AI 事件：\n${eventTooltip(events)}`}
        >
          AI {events.length}
        </span>
      )}
      {task && <MemberAvatar memberId={task.assigneeId} size={16} />}
      {row.kind === "subtask" && <MemberAvatar memberId={row.subtask.assigneeId} size={15} />}
    </div>
    <div className="relative transition-colors group-hover:bg-[#F8FAFF]" style={{ width: days.length * CELL }}>
      {days.map((day, index) => isWeekend(day) ? <span key={day.toISOString()} className="absolute inset-y-0 bg-[#FAFBFC] opacity-70" style={{ left: index * CELL, width: CELL }} /> : null)}
      {highlightDateOffset !== null && highlightDateOffset >= 0 && highlightDateOffset < days.length && <span className="pointer-events-none absolute inset-y-0 z-[1] border-x border-[#D1E0FF] bg-[#EEF4FF]/80" style={{ left: highlightDateOffset * CELL, width: CELL }} />}
      {Object.values(state.sprints).map((sprint) => { const line = differenceInCalendarDays(parseISO(sprint.endDate), start) + 1; return line >= 0 && line <= days.length ? <span key={sprint.id} className="absolute inset-y-0 border-l border-dashed border-[#C7D7FE]" style={{ left: line * CELL }} /> : null; })}
      {todayOffset >= 0 && todayOffset < days.length && <span className="absolute inset-y-0 z-[3] w-px bg-[#F79009]" style={{ left: todayOffset * CELL }} />}
      {row.kind === "story" && storyValue && storyStatus && <button className="absolute top-[11px] h-[18px] overflow-hidden shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-shadow hover:shadow-[0_2px_5px_rgba(16,24,40,0.18)]" title={`${row.story.id.toUpperCase()} ${row.story.title}\n${storyValue.startDate} - ${storyValue.endDate}`} style={{ left: left(storyValue.startDate), width: width(storyValue.startDate, storyValue.endDate), background: selected ? "#7F56D9" : storyStatus.accent, clipPath: "polygon(0 50%, 8px 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 8px 100%)", zIndex: 7 }} onClick={() => state.selectObject("story", row.id)}>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={{
            inset: storyOutlineWidth,
            background: selected ? "#D9D6FE" : storyStatus.strongBg,
            clipPath: "polygon(0 50%, 7px 0, calc(100% - 7px) 0, 100% 50%, calc(100% - 7px) 100%, 7px 100%)",
          }}
        />
        <span className="absolute bottom-0 left-[7px] top-0 z-10 w-2 cursor-w-resize opacity-0 group-hover:opacity-100" title="调整用户故事开始日期" onMouseDown={(event) => beginDrag(event, "story", row.story.id, storyValue, "left")} />
        <span className="absolute bottom-0 right-[7px] top-0 z-10 w-2 cursor-e-resize opacity-0 group-hover:opacity-100" title="调整用户故事结束日期" onMouseDown={(event) => beginDrag(event, "story", row.story.id, storyValue, "right")} />
        <span className="absolute inset-y-0 left-4 right-4 z-[9] cursor-move" title="平移用户故事及全部工程任务" onMouseDown={(event) => beginDrag(event, "story", row.story.id, storyValue, "move")} />
      </button>}
      {row.kind === "task" && task && value && task.isMilestone && <div className="absolute top-[9px] h-4 w-4 select-none" style={{ left: left(value.startDate) - 8, zIndex: 10 }}>
        <button className="absolute inset-0 rotate-45 border-2 shadow-sm transition-transform hover:scale-110" style={{ background: STATUS[task.status].bg, borderColor: heatmapHighlighted ? "#2E90FA" : critical || selected ? "#5925DC" : STATUS[task.status].accent, boxShadow: heatmapHighlighted ? "0 0 0 2px rgba(46,144,250,.18)" : undefined }} title={`里程碑：${task.title}\n${value.startDate}`} onClick={() => state.selectObject("task", task.id)} onMouseDown={(event) => beginDrag(event, "task", task.id, value, "move")} />
        {renderDependencyButton(task.id)}
      </div>}
      {row.kind === "task" && task && value && !task.isMilestone && <div className="absolute top-[10px] h-[14px] select-none rounded-[3px] border shadow-[0_1px_2px_rgba(16,24,40,0.08)] transition-shadow group-hover:shadow-[0_2px_5px_rgba(16,24,40,0.14)]" title={`${task.id.toUpperCase()} ${task.title}\n${value.startDate} - ${value.endDate}\n进度 ${value.progress}%${visualState === "overdue" ? "\n已逾期" : ""}${visualState === "severe-blocked" ? "\n严重阻塞" : ""}${task.blockReasons.length ? `\n阻塞：${task.blockReasons.map((reason) => reason.message).join("；")}` : ""}`} style={{ left: left(value.startDate), width: width(value.startDate, value.endDate), background: visualState === "overdue" ? "#FEF3F2" : STATUS[task.status].bg, borderColor: heatmapHighlighted ? "#2E90FA" : critical || selected ? "#5925DC" : visualState === "severe-blocked" ? "#B42318" : visualState === "overdue" ? "#F04438" : STATUS[task.status].accent, borderWidth: heatmapHighlighted || critical || selected || visualState === "severe-blocked" ? 2 : 1, boxShadow: heatmapHighlighted ? "0 0 0 2px rgba(46,144,250,.18), 0 2px 5px rgba(16,24,40,.12)" : undefined, zIndex: 9 }} onClick={() => state.selectObject("task", task.id)}>
        {(task.status === "blocked" || visualState === "overdue") && <span className="absolute -left-px -top-px h-[14px] w-1 rounded-l-[3px]" style={{ background: visualState === "overdue" ? "#7A271A" : "#D92D20" }} />}
        <span className="absolute bottom-0 left-0 top-0 rounded-[2px] opacity-55" style={{ width: `${value.progress}%`, background: STATUS[task.status].accent }} />
        <span className="absolute bottom-[-3px] left-0 top-[-3px] z-10 w-1.5 cursor-w-resize rounded-l opacity-0 group-hover:opacity-100" title="调整开始日期" onMouseDown={(event) => beginDrag(event, "task", task.id, value, "left")} />
        <span className="absolute bottom-[-3px] right-0 top-[-3px] z-10 w-1.5 cursor-e-resize rounded-r opacity-0 group-hover:opacity-100" title="调整结束日期" onMouseDown={(event) => beginDrag(event, "task", task.id, value, "right")} />
        <span className="absolute inset-y-0 left-2 right-2 cursor-move" onMouseDown={(event) => beginDrag(event, "task", task.id, value, "move")} />
        {renderDependencyButton(task.id)}
        <span className="absolute top-1/2 h-2.5 w-1.5 -translate-x-1/2 -translate-y-1/2 cursor-col-resize rounded-sm border border-white bg-[#5925DC] opacity-0 shadow-sm group-hover:opacity-100" style={{ left: `${value.progress}%` }} title="拖动调整进度" onMouseDown={(event) => beginDrag(event, "task", task.id, value, "progress")} />
      </div>}
      {row.kind === "subtask" && subtaskValue && <div className="absolute top-[10px] h-2 select-none rounded-sm border" title={`${row.subtask.id.toUpperCase()} ${row.subtask.title}\n${subtaskValue.startDate} - ${subtaskValue.endDate}\n进度 ${subtaskValue.progress}%${subtaskVisualState === "overdue" ? "\n已逾期" : ""}${subtaskVisualState === "severe-blocked" ? "\n严重阻塞" : ""}`} style={{ left: left(subtaskValue.startDate), width: width(subtaskValue.startDate, subtaskValue.endDate), background: subtaskVisualState === "overdue" ? "#FEF3F2" : STATUS[row.subtask.status].bg, borderColor: heatmapHighlighted ? "#2E90FA" : selected ? "#7F56D9" : subtaskVisualState === "severe-blocked" ? "#B42318" : subtaskVisualState === "overdue" ? "#7A271A" : STATUS[row.subtask.status].accent, borderWidth: heatmapHighlighted || subtaskVisualState === "severe-blocked" ? 2 : 1, boxShadow: heatmapHighlighted ? "0 0 0 2px rgba(46,144,250,.16)" : undefined, zIndex: 8 }} onClick={() => state.selectObject("subtask", row.subtask.id)}>
        <span className="absolute inset-y-0 left-0 opacity-60" style={{ width: `${subtaskValue.progress}%`, background: STATUS[row.subtask.status].accent }} />
        <span className="absolute bottom-[-3px] left-0 top-[-3px] z-10 w-1.5 cursor-w-resize opacity-0 group-hover:opacity-100" onMouseDown={(event) => beginDrag(event, "subtask", row.subtask.id, subtaskValue, "left")} />
        <span className="absolute bottom-[-3px] right-0 top-[-3px] z-10 w-1.5 cursor-e-resize opacity-0 group-hover:opacity-100" onMouseDown={(event) => beginDrag(event, "subtask", row.subtask.id, subtaskValue, "right")} />
        <span className="absolute inset-y-0 left-2 right-2 cursor-move" onMouseDown={(event) => beginDrag(event, "subtask", row.subtask.id, subtaskValue, "move")} />
        <span className="absolute top-1/2 h-2 w-1.5 -translate-x-1/2 -translate-y-1/2 cursor-col-resize rounded-sm border border-white bg-[#5925DC] opacity-0 group-hover:opacity-100" style={{ left: `${subtaskValue.progress}%` }} title="拖动调整进度" onMouseDown={(event) => beginDrag(event, "subtask", row.subtask.id, subtaskValue, "progress")} />
      </div>}
    </div>
  </div>;
}
