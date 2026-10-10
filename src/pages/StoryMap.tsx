import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  EyeOff,
  GripVertical,
  Layers3,
  ListTree,
  Minus,
  Pencil,
  Plus,
  Trash2,
  Users,
  X,
  ZoomIn,
} from "lucide-react"
import BacklogPanel, {
  readDragPayload,
  writeDragPayload,
} from "../components/planning/BacklogPanel"
import { TASK_STATUS_COLORS } from "../components/planning/statusColors"
import { MemberAvatar, notify } from "../components/planning/ui"
import { useProjectStore } from "../store/projectStore"
import type { DetectedEvent } from "../utils/eventDetection"
import {
  EVENT_BADGE_STYLE,
  eventTooltip,
  highestSeverity,
  useAllSprintsEvents,
} from "../hooks/useProjectEvents"
import {
  byOrder,
  selectEpics,
  selectSprintStories,
  selectStories,
  selectStoryProgress,
  selectStoryRiskLevel,
  selectTaskVisualState,
  selectTaskSubtasks,
  selectUserTasks,
  storyDisplayStatus,
} from "../store/selectors"
import type {
  EpicEntity,
  RiskLevel,
  StoryEntity,
  TaskEntity,
  UserActivityEntity,
  UserTaskEntity,
} from "../types"

const COL_W = 176
const GAP = 8
const DOMAIN = {
  governance: {
    bg: "#FFF7ED",
    soft: "#FFFAF5",
    border: "#F97316",
    text: "#C2410C",
  },
  planning: {
    bg: "#FAF5FF",
    soft: "#FEFBFF",
    border: "#9333EA",
    text: "#7E22CE",
  },
  design: {
    bg: "#EEF2FF",
    soft: "#F8F9FF",
    border: "#4F46E5",
    text: "#3730A3",
  },
  delivery: {
    bg: "#F0F9FF",
    soft: "#F8FCFF",
    border: "#0284C7",
    text: "#0369A1",
  },
  quality: {
    bg: "#F0FDF9",
    soft: "#F5FEFB",
    border: "#0D9488",
    text: "#115E59",
  },
  other: { bg: "#F8FAFC", soft: "#FAFBFC", border: "#64748B", text: "#475569" },
}
const STATUS = {
  todo: { label: "待办", ...TASK_STATUS_COLORS.todo },
  in_progress: { label: "进行中", ...TASK_STATUS_COLORS.in_progress },
  review: { label: "待验收", ...TASK_STATUS_COLORS.review },
  done: { label: "已验收", ...TASK_STATUS_COLORS.done },
  blocked: { label: "阻塞", ...TASK_STATUS_COLORS.blocked },
}
const TASK_TYPE = {
  frontend: { label: "FE", bg: "#EFF8FF", color: "#175CD3" },
  backend: { label: "BE", bg: "#F4F3FF", color: "#5925DC" },
  database: { label: "DATA", bg: "#FFFAEB", color: "#B54708" },
  test: { label: "TEST", bg: "#ECFDF3", color: "#067647" },
  design: { label: "UI", bg: "#FDF4FF", color: "#9E165F" },
  devops: { label: "OPS", bg: "#FEF3F2", color: "#B42318" },
}
const DOMAIN_OPTIONS: Array<{
  value: UserActivityEntity["domain"]
  label: string
}> = [
  { value: "governance", label: "项目治理" },
  { value: "planning", label: "需求规划" },
  { value: "design", label: "设计" },
  { value: "delivery", label: "研发交付" },
  { value: "quality", label: "质量保障" },
  { value: "other", label: "其他" },
]

type HierarchyKind = "activity" | "userTask" | "epic"
type HierarchyEditorState = {
  kind: HierarchyKind
  mode: "create" | "edit"
  id: string | null
  title: string
  parentId: string
  domain: UserActivityEntity["domain"]
}
type HierarchyDeleteState = {
  kind: HierarchyKind
  id: string
  title: string
  impact: string
}

export default function StoryMap({
  captureOnly = false,
  captureRef,
}: {
  captureOnly?: boolean
  captureRef?: React.Ref<HTMLDivElement>
} = {}) {
  const state = useProjectStore()
  const { workspace } = state
  const eventIndex = useAllSprintsEvents()
  const setWorkspace = state.setWorkspace
  const canvasRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [dragging, setDragging] = useState<{ type: string; id: string } | null>(
    null,
  )
  const [dropKey, setDropKey] = useState<string | null>(null)
  const [panning, setPanning] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)
  const [hierarchyEditor, setHierarchyEditor] =
    useState<HierarchyEditorState | null>(null)
  const [hierarchyDelete, setHierarchyDelete] =
    useState<HierarchyDeleteState | null>(null)
  const pan = useRef({ x: 0, y: 0, left: 0, top: 0 })

  const activities = useMemo(
    () => byOrder(Object.values(state.activities)),
    [state.activities],
  )
  const columns = useMemo(
    () =>
      activities.flatMap((activity) =>
        selectUserTasks(state, activity.id).flatMap((userTask) => {
          const taskEpics = selectEpics(state, userTask.id)
          return (
            taskEpics.length
              ? taskEpics
              : [
                  {
                    id: `empty-${userTask.id}`,
                    title: "未设置 Epic",
                    userTaskId: userTask.id,
                    order: 0,
                  },
                ]
          ).map((epic) => ({ activity, userTask, epic }))
        }),
      ),
    [activities, state.userTasks, state.epics],
  )

  const activityGroups = useMemo(
    () =>
      activities.map((activity) => ({
        activity,
        count: Math.max(
          1,
          columns.filter((column) => column.activity.id === activity.id).length,
        ),
      })),
    [activities, columns],
  )
  const userTaskGroups = useMemo(
    () =>
      activities.flatMap((activity) =>
        selectUserTasks(state, activity.id).map((userTask) => ({
          activity,
          userTask,
          count: Math.max(
            1,
            columns.filter((column) => column.userTask.id === userTask.id)
              .length,
          ),
        })),
      ),
    [activities, columns, state.userTasks],
  )
  const selectedSprint = state.sprints[workspace.selectedSprintId]
  const orderedSprints = selectedSprint ? [selectedSprint] : []
  const canvasWidth = Math.max(1100, columns.length * (COL_W + GAP) + 80)

  useEffect(() => {
    if (captureOnly) return
    const el = canvasRef.current
    if (!el) return
    el.scrollLeft = workspace.storyMapScrollLeft
    el.scrollTop = workspace.storyMapScrollTop
  }, [captureOnly])

  useEffect(() => {
    if (captureOnly) return
    const request = workspace.focusRequest
    if (!request) return
    const taskId =
      request.type === "subtask"
        ? state.subtasks[request.id]?.taskId
        : request.type === "task"
          ? request.id
          : null
    const storyId = taskId ? state.tasks[taskId]?.storyId : request.id
    rowRefs.current[storyId]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
    })
  }, [captureOnly, workspace.focusRequest?.nonce])

  const autoScroll = useCallback((event: React.DragEvent) => {
    const el = canvasRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (event.clientX - rect.left < 70) el.scrollLeft -= 14
    if (rect.right - event.clientX < 70) el.scrollLeft += 14
    if (event.clientY - rect.top < 70) el.scrollTop -= 14
    if (rect.bottom - event.clientY < 70) el.scrollTop += 14
  }, [])

  const beginPan = (event: React.MouseEvent) => {
    if (
      (event.target as HTMLElement).closest(
        "button,input,select,[draggable=true]",
      )
    )
      return
    const el = canvasRef.current
    if (!el) return
    setPanning(true)
    pan.current = {
      x: event.clientX,
      y: event.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
    }
  }
  const movePan = (event: React.MouseEvent) => {
    if (!panning || !canvasRef.current) return
    canvasRef.current.scrollLeft =
      pan.current.left - (event.clientX - pan.current.x)
    canvasRef.current.scrollTop =
      pan.current.top - (event.clientY - pan.current.y)
  }

  const createHierarchyItem = (kind: HierarchyKind, parentId = "") => {
    setHierarchyEditor({
      kind,
      mode: "create",
      id: null,
      title: "",
      parentId,
      domain: "other",
    })
  }

  const editActivity = (activity: UserActivityEntity) => {
    setHierarchyEditor({
      kind: "activity",
      mode: "edit",
      id: activity.id,
      title: activity.title,
      parentId: "",
      domain: activity.domain,
    })
  }

  const editUserTask = (userTask: UserTaskEntity) => {
    setHierarchyEditor({
      kind: "userTask",
      mode: "edit",
      id: userTask.id,
      title: userTask.title,
      parentId: userTask.activityId,
      domain: "other",
    })
  }

  const editEpic = (epic: EpicEntity) => {
    setHierarchyEditor({
      kind: "epic",
      mode: "edit",
      id: epic.id,
      title: epic.title,
      parentId: epic.userTaskId,
      domain: "other",
    })
  }

  const saveHierarchyItem = () => {
    if (!hierarchyEditor) return
    const title = hierarchyEditor.title.trim()
    if (!title) {
      notify("名称不能为空", "error")
      return
    }
    let result = { ok: true, message: "" }
    try {
      if (hierarchyEditor.kind === "activity") {
        if (hierarchyEditor.mode === "create") {
          state.createActivity({ title, domain: hierarchyEditor.domain })
          result.message = "User Activity 已创建"
        } else {
          result = state.updateActivity(hierarchyEditor.id!, {
            title,
            domain: hierarchyEditor.domain,
          })
        }
      }
      if (hierarchyEditor.kind === "userTask") {
        if (!hierarchyEditor.parentId) {
          result = { ok: false, message: "请选择所属 User Activity" }
        } else if (hierarchyEditor.mode === "create") {
          state.createUserTask(hierarchyEditor.parentId, { title })
          result.message = "User Task 已创建"
        } else {
          result = state.updateUserTask(hierarchyEditor.id!, {
            title,
            activityId: hierarchyEditor.parentId,
          })
        }
      }
      if (hierarchyEditor.kind === "epic") {
        if (!hierarchyEditor.parentId) {
          result = { ok: false, message: "请选择所属 User Task" }
        } else if (hierarchyEditor.mode === "create") {
          state.createEpic(hierarchyEditor.parentId, { title })
          result.message = "Epic 已创建"
        } else {
          result = state.updateEpic(hierarchyEditor.id!, {
            title,
            userTaskId: hierarchyEditor.parentId,
          })
        }
      }
    } catch (error) {
      result = {
        ok: false,
        message: error instanceof Error ? error.message : "保存失败",
      }
    }
    notify(result.message, result.ok ? "success" : "error")
    if (result.ok) setHierarchyEditor(null)
  }

  const requestHierarchyDelete = (
    kind: HierarchyKind,
    id: string,
    title: string,
  ) => {
    const userTaskIds = new Set(
      kind === "activity"
        ? Object.values(state.userTasks)
            .filter((task) => task.activityId === id)
            .map((task) => task.id)
        : kind === "userTask"
          ? [id]
          : [],
    )
    const epicIds = new Set(
      kind === "epic"
        ? [id]
        : Object.values(state.epics)
            .filter((epic) => userTaskIds.has(epic.userTaskId))
            .map((epic) => epic.id),
    )
    const storyIds = new Set(
      Object.values(state.stories)
        .filter((story) => story.epicId && epicIds.has(story.epicId))
        .map((story) => story.id),
    )
    const taskIds = new Set(
      Object.values(state.tasks)
        .filter((task) => storyIds.has(task.storyId))
        .map((task) => task.id),
    )
    const subtaskCount = Object.values(state.subtasks).filter((subtask) =>
      taskIds.has(subtask.taskId),
    ).length
    const parts = [
      kind === "activity" && userTaskIds.size
        ? `${userTaskIds.size} 个 User Task`
        : "",
      kind !== "epic" && epicIds.size ? `${epicIds.size} 个 Epic` : "",
      storyIds.size ? `${storyIds.size} 个 Story` : "",
      taskIds.size ? `${taskIds.size} 个工程任务` : "",
      subtaskCount ? `${subtaskCount} 个 Subtask` : "",
    ].filter(Boolean)
    setHierarchyDelete({
      kind,
      id,
      title,
      impact: parts.length
        ? `同时删除：${parts.join("、")}。相关依赖和资产关联会自动清理。`
        : "当前没有下级内容，可直接删除。",
    })
  }

  const confirmHierarchyDelete = () => {
    if (!hierarchyDelete) return
    const result =
      hierarchyDelete.kind === "activity"
        ? state.deleteActivity(hierarchyDelete.id)
        : hierarchyDelete.kind === "userTask"
          ? state.deleteUserTask(hierarchyDelete.id)
          : state.deleteEpic(hierarchyDelete.id)
    notify(result.message, result.ok ? "success" : "error")
    if (result.ok) setHierarchyDelete(null)
  }

  const finishDrop = (message: string, ok = true, undo = true) => {
    setDragging(null)
    setDropKey(null)
    notify(message, ok ? "success" : "error", ok && undo)
  }

  const dropActivity = (event: React.DragEvent, targetId: string) => {
    event.preventDefault()
    const payload = readDragPayload(event)
    if (payload?.type !== "activity")
      return finishDrop("Activity 只能与同层级排序", false, false)
    state.moveActivity(
      payload.id,
      activities.findIndex((item) => item.id === targetId),
    )
    finishDrop("User Activity 及其完整子树已移动")
  }

  const dropUserTask = (event: React.DragEvent, targetId: string) => {
    event.preventDefault()
    event.stopPropagation()
    const payload = readDragPayload(event)
    if (payload?.type !== "userTask")
      return finishDrop("User Task 只能放入 User Activity 层", false, false)
    const target = state.userTasks[targetId]
    const siblings = selectUserTasks(state, target.activityId)
    state.moveUserTask(
      payload.id,
      target.activityId,
      siblings.findIndex((item) => item.id === targetId),
    )
    finishDrop("User Task 及其 Epic 子树已移动")
  }

  const dropEpic = (event: React.DragEvent, targetId: string) => {
    event.preventDefault()
    event.stopPropagation()
    const payload = readDragPayload(event)
    if (payload?.type !== "epic")
      return finishDrop("Epic 只能放入 User Task 层", false, false)
    const target = state.epics[targetId]
    if (!target) return finishDrop("目标 Epic 不可用", false, false)
    const siblings = selectEpics(state, target.userTaskId)
    state.moveEpic(
      payload.id,
      target.userTaskId,
      siblings.findIndex((item) => item.id === targetId),
    )
    finishDrop("Epic 及其 Story 子树已移动")
  }

  const dropCell = (
    event: React.DragEvent,
    epicId: string,
    sprintId: string,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    const payload = readDragPayload(event)
    if (payload?.type !== "story")
      return finishDrop("此区域只接受 User Story", false, false)
    const result = state.moveStory(payload.id, epicId, sprintId)
    finishDrop(result.message, result.ok)
  }

  const dropOnStory = (event: React.DragEvent, targetStory: StoryEntity) => {
    event.preventDefault()
    event.stopPropagation()
    const payload = readDragPayload(event)
    if (!payload) return
    if (payload.type === "story") {
      const siblings = byOrder(
        Object.values(state.stories).filter(
          (story) =>
            story.epicId === targetStory.epicId &&
            story.sprintId === targetStory.sprintId,
        ),
      )
      const result = state.moveStory(
        payload.id,
        targetStory.epicId,
        targetStory.sprintId,
        siblings.findIndex((story) => story.id === targetStory.id),
      )
      return finishDrop(result.message, result.ok)
    }
    if (payload.type === "task") {
      const result = state.moveTask(payload.id, targetStory.id)
      return finishDrop(result.message, result.ok)
    }
    finishDrop("Story 卡只接受 Story 或 Task", false, false)
  }

  const filteredStory = (story: StoryEntity) => {
    if (
      workspace.memberFilterId &&
      story.assigneeId !== workspace.memberFilterId
    )
      return false
    if (
      workspace.statusFilter !== "all" &&
      story.deliveryStatus !== workspace.statusFilter
    )
      return false
    if (workspace.riskFilter !== "all" && selectStoryRiskLevel(state, story.id) !== workspace.riskFilter)
      return false
    if (!workspace.showCompletedStories && story.deliveryStatus === "accepted")
      return false
    return true
  }

  return (
    <div
      ref={captureOnly ? captureRef : undefined}
      className={`flex min-w-0 bg-[#F8FAFC] ${captureOnly ? "planning-export-capture flex-col" : "h-full"}`}
      style={captureOnly ? { width: canvasWidth, minHeight: 420 } : undefined}
    >
      {!captureOnly && <BacklogPanel />}
      {(captureOnly || !workspace.backlogFullscreen) && <section className="flex min-w-0 flex-1 flex-col">
        {captureOnly ? (
          <div className="flex h-16 flex-shrink-0 items-center gap-3 border-b border-[#D0D5DD] bg-white px-8">
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold text-[#172033]">{state.project.name} · 用户故事地图</div>
              <div className="mt-1 text-[10px] text-[#667085]">{selectedSprint?.name ?? "未选择 Sprint"} · {selectedSprint?.startDate ?? "-"} 至 {selectedSprint?.endDate ?? "-"}</div>
            </div>
            <span className="rounded border border-[#B2CCFF] bg-[#EFF8FF] px-2 py-1 text-[10px] font-medium text-[#175CD3]">{workspace.showCompletedStories ? "包含已完成" : "隐藏已完成"}</span>
            <span className="rounded border border-[#D9D6FE] bg-[#F4F3FF] px-2 py-1 text-[10px] font-medium text-[#5925DC]">{workspace.showEngineeringLayer ? "展开任务与子任务" : "仅 Story"}</span>
          </div>
        ) : <div className="flex h-11 flex-shrink-0 items-center gap-2 overflow-x-auto border-b border-[#E2E7EE] bg-white px-4">
          <span className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-[#344054]">
            <Layers3 size={14} />
            综合用户地图
          </span>
          <div className="h-5 w-px flex-shrink-0 bg-[#EAECF0]" />
          <button
            className="secondary-button flex-shrink-0 px-2"
            onClick={() => createHierarchyItem("activity")}
          >
            <Plus size={13} />
            新增 Activity
          </button>
          <button
            className="toolbar-toggle flex-shrink-0"
            data-active={workspace.showEngineeringLayer}
            onClick={() =>
              setWorkspace({
                showEngineeringLayer: !workspace.showEngineeringLayer,
              })
            }
          >
            {workspace.showEngineeringLayer ? (
              <ListTree size={13} />
            ) : (
              <EyeOff size={13} />
            )}
            子任务
          </button>
          <button
            className="toolbar-toggle flex-shrink-0"
            data-active={workspace.showCompletedStories}
            onClick={() =>
              setWorkspace({
                showCompletedStories: !workspace.showCompletedStories,
              })
            }
          >
            {workspace.showCompletedStories ? (
              <CheckCircle2 size={13} />
            ) : (
              <EyeOff size={13} />
            )}
            已完成
          </button>
          <div className="h-5 w-px flex-shrink-0 bg-[#EAECF0]" />
          <div className="flex flex-shrink-0 items-center gap-1">
            <Users size={13} className="text-[#98A2B3]" />
            {Object.values(state.members).map((member) => (
              <button
                key={member.id}
                className="rounded-full"
                style={{
                  opacity:
                    workspace.memberFilterId &&
                    workspace.memberFilterId !== member.id
                      ? 0.25
                      : 1,
                  outline:
                    workspace.memberFilterId === member.id
                      ? `2px solid ${member.color}`
                      : "none",
                  outlineOffset: 2,
                }}
                onClick={() =>
                  setWorkspace({
                    memberFilterId:
                      workspace.memberFilterId === member.id ? null : member.id,
                  })
                }
              >
                <MemberAvatar memberId={member.id} size={22} />
              </button>
            ))}
          </div>
          <select
            className="filter-select ml-1 w-24 flex-shrink-0"
            value={workspace.statusFilter}
            onChange={(event) =>
              setWorkspace({
                statusFilter: event.target
                  .value as typeof workspace.statusFilter,
              })
            }
          >
            <option value="all">全部状态</option>
            <option value="planned">已规划</option>
            <option value="in_progress">进行中</option>
            <option value="pending_acceptance">待验收</option>
            <option value="accepted">已验收</option>
          </select>
          <select
            className="filter-select w-20 flex-shrink-0"
            value={workspace.riskFilter}
            onChange={(event) =>
              setWorkspace({
                riskFilter: event.target.value as RiskLevel | "all",
              })
            }
          >
            <option value="all">全部风险</option>
            <option value="high">高风险</option>
            <option value="medium">中风险</option>
            <option value="low">低风险</option>
            <option value="none">无风险</option>
          </select>
          <div className="ml-auto flex flex-shrink-0 items-center gap-1 text-[10px] text-[#98A2B3]">
            <ZoomIn size={12} />
            <span className="font-mono">
              {Math.round(workspace.storyMapZoom * 100)}%
            </span>
          </div>
        </div>}

        <div className={captureOnly ? "relative flex-1 overflow-visible" : "relative min-h-0 flex-1 overflow-hidden"}>
          <div
            ref={captureOnly ? undefined : canvasRef}
            className={captureOnly ? "relative overflow-visible" : "absolute inset-0 overflow-auto"}
            style={{ cursor: captureOnly ? "default" : panning ? "grabbing" : "grab" }}
            onMouseDown={beginPan}
            onMouseMove={movePan}
            onMouseUp={() => setPanning(false)}
            onMouseLeave={() => setPanning(false)}
            onScroll={(event) =>
              setWorkspace({
                storyMapScrollLeft: event.currentTarget.scrollLeft,
                storyMapScrollTop: event.currentTarget.scrollTop,
              })
            }
            onDragOver={(event) => {
              event.preventDefault()
              autoScroll(event)
            }}
            onDrop={(event) => {
              if (event.target === event.currentTarget)
                finishDrop("该层级不是有效落点", false, false)
            }}
          >
            <div
              className="story-map-grid min-h-full"
              style={{ width: canvasWidth }}
            >
              <div
                className="relative px-8 pb-24 pt-5"
                style={{
                  transform: captureOnly ? undefined : `scale(${workspace.storyMapZoom})`,
                  transformOrigin: "top left",
                  width: captureOnly ? canvasWidth : canvasWidth / workspace.storyMapZoom,
                }}
              >
                <div className="flex gap-2 pb-1">
                  {activityGroups.map(({ activity, count }) => (
                    <ActivityHeader
                      key={activity.id}
                      activity={activity}
                      width={count * (COL_W + GAP) - GAP}
                      active={dropKey === `activity-${activity.id}`}
                      onDragStart={(event) => {
                        setDragging({ type: "activity", id: activity.id })
                        writeDragPayload(event, {
                          type: "activity",
                          id: activity.id,
                        })
                      }}
                      onDragOver={(event) => {
                        event.preventDefault()
                        setDropKey(`activity-${activity.id}`)
                      }}
                      onDrop={(event) => dropActivity(event, activity.id)}
                      onAdd={() => createHierarchyItem("userTask", activity.id)}
                      onEdit={() => editActivity(activity)}
                      onDelete={() =>
                        requestHierarchyDelete(
                          "activity",
                          activity.id,
                          activity.title,
                        )
                      }
                    />
                  ))}
                </div>
                <div className="flex gap-2 pb-1">
                  {userTaskGroups.map(({ activity, userTask, count }) => {
                    const theme = DOMAIN[activity.domain]
                    return (
                      <div
                        key={userTask.id}
                        draggable
                        className="group flex h-8 flex-shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium"
                        style={{
                          width: count * (COL_W + GAP) - GAP,
                          background: theme.soft,
                          borderColor:
                            dropKey === `task-${userTask.id}`
                              ? "#7F56D9"
                              : `${theme.border}45`,
                          color: theme.text,
                        }}
                        onDragStart={(event) => {
                          setDragging({ type: "userTask", id: userTask.id })
                          writeDragPayload(event, {
                            type: "userTask",
                            id: userTask.id,
                          })
                        }}
                        onDragOver={(event) => {
                          event.preventDefault()
                          setDropKey(`task-${userTask.id}`)
                        }}
                        onDrop={(event) => dropUserTask(event, userTask.id)}
                      >
                        <GripVertical size={12} className="opacity-45" />
                        <span className="min-w-0 flex-1 truncate">
                          {userTask.title}
                        </span>
                        <HierarchyHeaderActions
                          addTitle="新增 Epic"
                          onAdd={() => createHierarchyItem("epic", userTask.id)}
                          onEdit={() => editUserTask(userTask)}
                          onDelete={() =>
                            requestHierarchyDelete(
                              "userTask",
                              userTask.id,
                              userTask.title,
                            )
                          }
                        />
                      </div>
                    )
                  })}
                </div>
                <div className="flex gap-2 pb-4">
                  {columns.map(({ activity, userTask, epic }) => {
                    const theme = DOMAIN[activity.domain]
                    const real = state.epics[epic.id]
                    return (
                      <div
                        key={epic.id}
                        draggable={Boolean(real)}
                        className="group flex h-7 flex-shrink-0 items-center gap-1 rounded-md border bg-white px-2 text-[10px] font-medium text-[#344054]"
                        style={{
                          width: COL_W,
                          borderColor:
                            dropKey === `epic-${epic.id}`
                              ? "#7F56D9"
                              : "#E2E7EE",
                          borderLeft: `3px solid ${theme.border}`,
                        }}
                        onDragStart={(event) => {
                          if (!real) return
                          setDragging({ type: "epic", id: epic.id })
                          writeDragPayload(event, { type: "epic", id: epic.id })
                        }}
                        onDragOver={(event) => {
                          if (real) {
                            event.preventDefault()
                            setDropKey(`epic-${epic.id}`)
                          }
                        }}
                        onDrop={(event) => real && dropEpic(event, epic.id)}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {epic.title}
                        </span>
                        {real ? (
                          <HierarchyHeaderActions
                            onEdit={() => editEpic(real)}
                            onDelete={() =>
                              requestHierarchyDelete(
                                "epic",
                                real.id,
                                real.title,
                              )
                            }
                          />
                        ) : (
                          <button
                            draggable={false}
                            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[#667085] hover:bg-[#F2F4F7] hover:text-[#475467]"
                            title="新增 Epic"
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation()
                              createHierarchyItem("epic", userTask.id)
                            }}
                          >
                            <Plus size={11} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>

                {orderedSprints.map((sprint) => {
                  const sprintStories = selectSprintStories(state, sprint.id)
                  const total = sprintStories.reduce(
                    (sum, story) => sum + story.storyPoints,
                    0,
                  )
                  const done = sprintStories
                    .filter((story) => story.deliveryStatus === "accepted")
                    .reduce((sum, story) => sum + story.storyPoints, 0)
                  const selected = sprint.id === workspace.selectedSprintId
                  return (
                    <div
                      key={sprint.id}
                      className="mb-6"
                      style={{ opacity: selected ? 1 : 0.78 }}
                    >
                      <div className="mb-3 flex items-center gap-2">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{
                            background: selected ? "#2E90FA" : "#98A2B3",
                          }}
                        />
                        <b className="text-xs text-[#172033]">{sprint.name}</b>
                        <span className="font-mono text-[10px] text-[#98A2B3]">
                          {sprint.startDate} → {sprint.endDate}
                        </span>
                        <span className="rounded bg-[#EFF8FF] px-1.5 py-0.5 text-[9px] font-medium text-[#175CD3]">
                          {sprint.status === "active"
                            ? "进行中"
                            : sprint.status === "closed"
                              ? "已结束"
                              : "计划中"}
                        </span>
                        <span className="font-mono text-[10px] text-[#98A2B3]">
                          {done}/{total} pt
                        </span>
                        <div className="h-px flex-1 bg-[#E2E7EE]" />
                      </div>
                      <div className="flex gap-2">
                        {columns.map(({ epic }) => {
                          const cellStories = selectStories(state, {
                            epicId: epic.id,
                            sprintId: sprint.id,
                          }).filter(filteredStory)
                          const key = `cell-${sprint.id}-${epic.id}`
                          return (
                            <div
                              key={key}
                              className="min-h-16 flex-shrink-0 rounded-lg border border-dashed p-0.5 transition"
                              style={{
                                width: COL_W,
                                borderColor:
                                  dropKey === key ? "#7F56D9" : "#E4E7EC",
                                background:
                                  dropKey === key ? "#F9F5FF" : "transparent",
                              }}
                              onDragOver={(event) => {
                                event.preventDefault()
                                autoScroll(event)
                                setDropKey(key)
                              }}
                              onDragLeave={() => setDropKey(null)}
                              onDrop={(event) =>
                                dropCell(event, epic.id, sprint.id)
                              }
                            >
                              {cellStories.map((story) => (
                                <StoryCard
                                  key={story.id}
                                  story={story}
                                  events={eventIndex.byStoryId[story.id]}
                                  selected={
                                    workspace.selectedObjectType === "story" &&
                                    workspace.selectedObjectId === story.id
                                  }
                                  dragging={
                                    dragging?.type === "story" &&
                                    dragging.id === story.id
                                  }
                                  onDragStart={(event) => {
                                    setDragging({ type: "story", id: story.id })
                                    writeDragPayload(event, {
                                      type: "story",
                                      id: story.id,
                                    })
                                  }}
                                  onDrop={(event) => dropOnStory(event, story)}
                                  setRef={(el) => {
                                    rowRefs.current[story.id] = el
                                  }}
                                />
                              ))}
                              {!cellStories.length && (
                                <div className="flex h-12 items-center justify-center text-[#D0D5DD]">
                                  <Plus size={14} />
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
            </div>
          </div>

          {!captureOnly && <div className="absolute bottom-5 right-4 z-20 overflow-hidden rounded-lg border border-[#E2E7EE] bg-white shadow-sm">
            <button
              className="zoom-button"
              onClick={() =>
                setWorkspace({
                  storyMapZoom: Math.min(1.35, workspace.storyMapZoom + 0.1),
                })
              }
            >
              <Plus size={14} />
            </button>
            <button
              className="zoom-button border-t border-[#EAECF0]"
              onClick={() =>
                setWorkspace({
                  storyMapZoom: Math.max(0.55, workspace.storyMapZoom - 0.1),
                })
              }
            >
              <Minus size={14} />
            </button>
            <button
              className="zoom-button border-t border-[#EAECF0] text-[9px] font-semibold"
              onClick={() => setWorkspace({ storyMapZoom: 0.9 })}
            >
              Fit
            </button>
          </div>}
          {!captureOnly && <div className="absolute bottom-5 left-4 z-20 overflow-hidden rounded-lg border border-[#E2E7EE] bg-white shadow-sm">
            <button
              className="flex h-8 items-center gap-1.5 px-2.5 text-[10px] font-semibold text-[#475467]"
              onClick={() => setLegendOpen((open) => !open)}
            >
              {legendOpen ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )}
              图例
            </button>
            {legendOpen && (
              <div className="w-52 space-y-2 border-t border-[#EAECF0] p-3 text-[9px] text-[#667085]">
                <div className="font-semibold text-[#344054]">
                  执行状态（左侧竖条）
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.values(STATUS).map((item) => (
                    <span
                      key={item.label}
                      className="flex items-center gap-1.5"
                    >
                      <i
                        className="h-3 w-1 rounded-sm"
                        style={{ background: item.color }}
                      />
                      {item.label}
                    </span>
                  ))}
                </div>
                <div className="font-semibold text-[#344054]">其他标记</div>
                <div className="space-y-1">
                  <span className="flex items-center gap-1.5">
                    <CircleAlert size={10} className="text-[#B54708]" />
                    右上角为风险，不占用状态色
                  </span>
                  <span className="flex items-center gap-1.5">
                    <i className="h-3 w-3 rounded border-2 border-[#7F56D9]" />
                    紫色描边表示当前选中
                  </span>
                </div>
              </div>
            )}
          </div>}
        </div>
      </section>}
      {!captureOnly && hierarchyEditor && (
        <HierarchyEditorDialog
          editor={hierarchyEditor}
          activities={activities}
          userTasks={byOrder(Object.values(state.userTasks))}
          onChange={setHierarchyEditor}
          onClose={() => setHierarchyEditor(null)}
          onSave={saveHierarchyItem}
        />
      )}
      {!captureOnly && hierarchyDelete && (
        <HierarchyDeleteDialog
          target={hierarchyDelete}
          onClose={() => setHierarchyDelete(null)}
          onConfirm={confirmHierarchyDelete}
        />
      )}
    </div>
  )
}

function ActivityHeader({
  activity,
  width,
  active,
  onDragStart,
  onDragOver,
  onDrop,
  onAdd,
  onEdit,
  onDelete,
}: {
  activity: UserActivityEntity
  width: number
  active: boolean
  onDragStart: (event: React.DragEvent) => void
  onDragOver: (event: React.DragEvent) => void
  onDrop: (event: React.DragEvent) => void
  onAdd: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const theme = DOMAIN[activity.domain]
  return (
    <div
      draggable
      className="group flex h-9 flex-shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold"
      style={{
        width,
        background: theme.bg,
        borderColor: active ? "#7F56D9" : theme.border,
        color: theme.text,
      }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <GripVertical size={13} className="opacity-45" />
      <span className="min-w-0 flex-1 truncate">{activity.title}</span>
      <HierarchyHeaderActions
        addTitle="新增 User Task"
        onAdd={onAdd}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </div>
  )
}

function HierarchyHeaderActions({
  addTitle,
  onAdd,
  onEdit,
  onDelete,
}: {
  addTitle?: string
  onAdd?: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const stopMouseDown = (event: React.MouseEvent) => event.stopPropagation()
  const run = (event: React.MouseEvent, action: () => void) => {
    event.stopPropagation()
    action()
  }
  const buttonClass =
    "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-white/55 opacity-0 shadow-sm transition hover:bg-white group-hover:opacity-100 focus:opacity-100"
  return (
    <span className="ml-auto flex flex-shrink-0 items-center gap-0.5">
      {onAdd && (
        <button
          draggable={false}
          className={buttonClass}
          title={addTitle}
          onMouseDown={stopMouseDown}
          onClick={(event) => run(event, onAdd)}
        >
          <Plus size={11} />
        </button>
      )}
      <button
        draggable={false}
        className={buttonClass}
        title="编辑"
        onMouseDown={stopMouseDown}
        onClick={(event) => run(event, onEdit)}
      >
        <Pencil size={10} />
      </button>
      <button
        draggable={false}
        className={`${buttonClass} text-[#B42318]`}
        title="删除"
        onMouseDown={stopMouseDown}
        onClick={(event) => run(event, onDelete)}
      >
        <Trash2 size={10} />
      </button>
    </span>
  )
}

function HierarchyEditorDialog({
  editor,
  activities,
  userTasks,
  onChange,
  onClose,
  onSave,
}: {
  editor: HierarchyEditorState
  activities: UserActivityEntity[]
  userTasks: UserTaskEntity[]
  onChange: (next: HierarchyEditorState) => void
  onClose: () => void
  onSave: () => void
}) {
  const noun =
    editor.kind === "activity"
      ? "User Activity"
      : editor.kind === "userTask"
        ? "User Task"
        : "Epic"
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-[#101828]/25 p-4"
      onMouseDown={onClose}
    >
      <form
        className="w-full max-w-[420px] overflow-hidden rounded-lg border border-[#E2E7EE] bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          onSave()
        }}
      >
        <div className="flex h-11 items-center border-b border-[#EAECF0] px-4">
          <div>
            <div className="text-xs font-semibold text-[#344054]">
              {editor.mode === "create" ? "新增" : "编辑"} {noun}
            </div>
            <div className="text-[9px] text-[#98A2B3]">
              修改会立即同步到用户地图和关联视图
            </div>
          </div>
          <button
            type="button"
            className="icon-button ml-auto"
            title="关闭"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <label className="block space-y-1">
            <span className="text-[10px] font-medium text-[#475467]">名称</span>
            <input
              autoFocus
              className="form-input"
              value={editor.title}
              placeholder={`请输入 ${noun} 名称`}
              onChange={(event) =>
                onChange({ ...editor, title: event.target.value })
              }
            />
          </label>
          {editor.kind === "activity" && (
            <label className="block space-y-1">
              <span className="text-[10px] font-medium text-[#475467]">
                领域颜色
              </span>
              <select
                className="form-input"
                value={editor.domain}
                onChange={(event) =>
                  onChange({
                    ...editor,
                    domain: event.target.value as UserActivityEntity["domain"],
                  })
                }
              >
                {DOMAIN_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {editor.kind === "userTask" && (
            <label className="block space-y-1">
              <span className="text-[10px] font-medium text-[#475467]">
                所属 User Activity
              </span>
              <select
                className="form-input"
                value={editor.parentId}
                onChange={(event) =>
                  onChange({ ...editor, parentId: event.target.value })
                }
              >
                {activities.map((activity) => (
                  <option key={activity.id} value={activity.id}>
                    {activity.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {editor.kind === "epic" && (
            <label className="block space-y-1">
              <span className="text-[10px] font-medium text-[#475467]">
                所属 User Task
              </span>
              <select
                className="form-input"
                value={editor.parentId}
                onChange={(event) =>
                  onChange({ ...editor, parentId: event.target.value })
                }
              >
                {userTasks.map((userTask) => (
                  <option key={userTask.id} value={userTask.id}>
                    {activities.find(
                      (activity) => activity.id === userTask.activityId,
                    )?.title ?? "未知 Activity"}
                    {" / "}
                    {userTask.title}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#EAECF0] bg-[#FCFCFD] px-4 py-3">
          <button type="button" className="secondary-button" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary-button">
            {editor.mode === "create" ? "创建" : "保存"}
          </button>
        </div>
      </form>
    </div>
  )
}

function HierarchyDeleteDialog({
  target,
  onClose,
  onConfirm,
}: {
  target: HierarchyDeleteState
  onClose: () => void
  onConfirm: () => void
}) {
  const noun =
    target.kind === "activity"
      ? "User Activity"
      : target.kind === "userTask"
        ? "User Task"
        : "Epic"
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-[#101828]/25 p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-[430px] overflow-hidden rounded-lg border border-[#E2E7EE] bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center border-b border-[#EAECF0] px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#FEE4E2] text-[#B42318]">
            <Trash2 size={14} />
          </div>
          <div className="ml-3 min-w-0">
            <div className="text-xs font-semibold text-[#344054]">
              删除 {noun}
            </div>
            <div className="truncate text-[10px] text-[#667085]">
              {target.title}
            </div>
          </div>
          <button
            className="icon-button ml-auto"
            title="关闭"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
        <div className="space-y-2 p-4">
          <p className="text-xs leading-5 text-[#344054]">
            删除后无法直接恢复，是否继续？
          </p>
          <p className="rounded-md border border-[#FECDCA] bg-[#FEF3F2] px-3 py-2 text-[10px] leading-4 text-[#B42318]">
            {target.impact}
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#EAECF0] bg-[#FCFCFD] px-4 py-3">
          <button className="secondary-button" onClick={onClose}>
            取消
          </button>
          <button
            className="inline-flex min-h-[30px] items-center gap-1.5 rounded-md border border-[#D92D20] bg-[#D92D20] px-3 text-[11px] font-semibold text-white hover:bg-[#B42318]"
            onClick={onConfirm}
          >
            <Trash2 size={12} />
            确认删除
          </button>
        </div>
      </div>
    </div>
  )
}

function StoryCard({
  story,
  events,
  selected,
  dragging,
  onDragStart,
  onDrop,
  setRef,
}: {
  story: StoryEntity
  events?: DetectedEvent[]
  selected: boolean
  dragging: boolean
  onDragStart: (event: React.DragEvent) => void
  onDrop: (event: React.DragEvent) => void
  setRef: (el: HTMLDivElement | null) => void
}) {
  const state = useProjectStore()
  const tasks = byOrder(
    Object.values(state.tasks).filter((task) => task.storyId === story.id),
  )
  const status = STATUS[storyDisplayStatus(story)]
  const progress = selectStoryProgress(state, story.id)
  const isDone = story.deliveryStatus === "accepted"
  const effectiveRisk = selectStoryRiskLevel(state, story.id)
  const eventSeverity = highestSeverity(events ?? [])
  return (
    <div
      ref={setRef}
      className="mb-2"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <article
        draggable
        onDragStart={onDragStart}
        onClick={() => state.selectObject("story", story.id)}
        className="relative cursor-pointer overflow-hidden rounded-lg border p-2.5 transition"
        style={{
          opacity: dragging ? 0.35 : isDone ? 0.78 : 1,
          background: isDone ? "#F2F4F7" : "white",
          borderColor: selected
            ? "#7F56D9"
            : effectiveRisk === "high"
              ? "#FEDF89"
              : "#E2E7EE",
          boxShadow: selected
            ? "0 0 0 3px rgba(127,86,217,.12)"
            : "0 1px 2px rgba(16,24,40,.04)",
        }}
      >
        <span
          className="absolute bottom-0 left-0 top-0 w-1"
          style={{ background: status.color }}
        />
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[9px] text-[#98A2B3]">
            {story.id.toUpperCase()}
          </span>
          {eventSeverity && (
            <span
              className="rounded px-1 py-0.5 text-[8px] font-semibold"
              style={EVENT_BADGE_STYLE[eventSeverity]}
              title={`AI 事件：\n${eventTooltip(events ?? [])}`}
            >
              AI {events?.length ?? 0}
            </span>
          )}
          {effectiveRisk !== "none" && (
            <span className="ml-auto flex items-center gap-0.5 rounded bg-[#FFFAEB] px-1 py-0.5 text-[8px] font-medium text-[#B54708]">
              <CircleAlert size={9} />
              ⚠{effectiveRisk === "high" ? "高" : effectiveRisk === "medium" ? "中" : "低"}
            </span>
          )}
        </div>
        <h3 className="my-1.5 line-clamp-2 text-xs font-semibold leading-snug text-[#172033]">
          {story.title}
        </h3>
        <div className="flex items-center gap-1.5">
          <MemberAvatar memberId={story.assigneeId} size={19} />
          <span
            className="rounded-full px-1.5 py-0.5 text-[8px] font-medium"
            style={{ background: status.bg, color: status.color }}
          >
            {status.label}
          </span>
          <span className="ml-auto font-mono text-[10px] font-semibold text-[#475467]">
            {story.storyPoints}pt
          </span>
        </div>
        {tasks.length > 0 && (
          <div className="mt-2">
            <div className="mb-1 flex items-center justify-between text-[8px] text-[#98A2B3]">
              <span>工程进度</span>
              <span className="font-mono">{progress}%</span>
            </div>
            <div className="h-0.5 overflow-hidden rounded bg-[#EAECF0]">
              <div
                className="h-full"
                style={{ width: `${progress}%`, background: status.accent }}
              />
            </div>
          </div>
        )}
      </article>
      {state.workspace.showEngineeringLayer &&
        tasks.map((task, index) => (
          <TaskMini key={task.id} task={task} targetIndex={index} />
        ))}
    </div>
  )
}

function TaskMini({
  task,
  targetIndex,
}: {
  task: TaskEntity
  targetIndex: number
}) {
  const state = useProjectStore()
  const meta = TASK_TYPE[task.type]
  const visualState = selectTaskVisualState(task)
  const taskRisk = Object.values(state.risks).find((risk) => risk.targetType === "task" && risk.targetId === task.id && risk.status !== "resolved")
  const subtasks = selectTaskSubtasks(state, task.id)
  const selected =
    state.workspace.selectedObjectType === "task" &&
    state.workspace.selectedObjectId === task.id
  return (
    <div
      draggable
      onDragStart={(event) =>
        writeDragPayload(event, { type: "task", id: task.id })
      }
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.stopPropagation()
        const payload = readDragPayload(event)
        if (payload?.type !== "task")
          return notify("Task 只能在子任务层移动", "error")
        const result = state.moveTask(payload.id, task.storyId, targetIndex)
        notify(result.message, result.ok ? "success" : "error", result.ok)
      }}
      onClick={(event) => {
        event.stopPropagation()
        state.selectObject("task", task.id)
      }}
      className="group relative mt-1 cursor-pointer overflow-hidden rounded-md border bg-white py-1 pl-3 pr-2"
      style={{
        borderColor: selected
          ? "#7F56D9"
          : visualState === "severe-blocked"
            ? "#B42318"
            : visualState === "overdue"
              ? "#F04438"
          : task.status === "blocked"
            ? "#FECDCA"
            : "#E2E7EE",
        background: visualState === "overdue" ? "#FFFBFA" : task.status === "done" ? "#F2F4F7" : "white",
        boxShadow: selected ? "0 0 0 2px rgba(127,86,217,.1)" : "none",
      }}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: visualState === "severe-blocked" ? "#D92D20" : visualState === "overdue" ? "#7A271A" : TASK_STATUS_COLORS[task.status].accent }} />
      <div className="flex items-center gap-1.5">
        <span
          className="rounded px-1 py-0.5 text-[8px] font-semibold"
          style={{ background: meta.bg, color: meta.color }}
        >
          {meta.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-[9px] text-[#344054]">
          {task.title}
        </span>
        {task.status === "blocked" && (
          <CircleAlert size={10} className="text-[#D92D20]" />
        )}
        {visualState === "overdue" && <span className="rounded bg-[#FEF3F2] px-1 text-[8px] font-semibold text-[#B42318]">逾期</span>}
        {visualState === "severe-blocked" && <span className="rounded bg-[#B42318] px-1 text-[8px] font-semibold text-white">严重</span>}
        {taskRisk && <span className={`rounded px-1 text-[8px] font-semibold ${taskRisk.level === "high" ? "bg-[#FEF3F2] text-[#B42318]" : "bg-[#FFFAEB] text-[#B54708]"}`}>⚠{taskRisk.level === "high" ? "高" : taskRisk.level === "medium" ? "中" : "低"}</span>}
        <MemberAvatar memberId={task.assigneeId} size={15} />
      </div>
      {subtasks.length > 0 && (
        <div className="mt-1 space-y-0.5 border-t border-[#F2F4F7] pt-1">
          {subtasks.map((subtask, index) => (
            <div
              key={subtask.id}
              draggable
              onClick={(event) => {
                event.stopPropagation()
                state.selectObject("subtask", subtask.id)
              }}
              onDragStart={(event) => {
                event.stopPropagation()
                writeDragPayload(event, { type: "subtask", id: subtask.id })
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.stopPropagation()
                const payload = readDragPayload(event)
                const source = payload ? state.subtasks[payload.id] : null
                if (payload?.type !== "subtask" || source?.taskId !== task.id)
                  return notify("Subtask 只能在所属工程任务内排序", "error")
                state.reorderSubtask(payload.id, index)
                notify("Subtask 顺序已保存", "success", true)
              }}
              className="flex items-center gap-1 rounded px-1 py-0.5 text-[8px] text-[#667085]"
              style={{
                background:
                  state.workspace.selectedObjectType === "subtask" &&
                  state.workspace.selectedObjectId === subtask.id
                    ? "#F4F3FF"
                    : "transparent",
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background: TASK_STATUS_COLORS[subtask.status].accent,
                }}
              />
              <span className="truncate">{subtask.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
