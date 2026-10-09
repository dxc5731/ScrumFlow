import { CircleAlert, ListTree, Users } from "lucide-react"
import { TASK_STATUS_COLORS } from "../components/planning/statusColors"
import { MemberAvatar, notify } from "../components/planning/ui"
import { useProjectStore } from "../store/projectStore"
import {
  EVENT_BADGE_STYLE,
  eventTooltip,
  highestSeverity,
  useProjectEvents,
} from "../hooks/useProjectEvents"
import {
  selectBlockedByIncompletePredecessor,
  selectSprintTasks,
  selectTaskVisualState,
  selectTaskSubtasks,
} from "../store/selectors"
import type { TaskEntity } from "../types"

const columns: {
  id: TaskEntity["status"]
  label: string
  color: string
  bg: string
}[] = [
  { id: "todo", label: "待开始", color: TASK_STATUS_COLORS.todo.color, bg: TASK_STATUS_COLORS.todo.bg },
  { id: "in_progress", label: "开发中", color: TASK_STATUS_COLORS.in_progress.color, bg: TASK_STATUS_COLORS.in_progress.bg },
  { id: "review", label: "评审中", color: TASK_STATUS_COLORS.review.color, bg: TASK_STATUS_COLORS.review.bg },
  { id: "done", label: "已完成", color: TASK_STATUS_COLORS.done.color, bg: TASK_STATUS_COLORS.done.bg },
  { id: "blocked", label: "已阻塞", color: TASK_STATUS_COLORS.blocked.color, bg: TASK_STATUS_COLORS.blocked.bg },
]

const typeMeta = {
  frontend: { label: "FE", color: "#175CD3", bg: "#EFF8FF" },
  backend: { label: "BE", color: "#5925DC", bg: "#F4F3FF" },
  database: { label: "DATA", color: "#B54708", bg: "#FFFAEB" },
  test: { label: "TEST", color: "#067647", bg: "#ECFDF3" },
  design: { label: "UI", color: "#9E165F", bg: "#FDF4FF" },
  devops: { label: "OPS", color: "#B42318", bg: "#FEF3F2" },
}

export default function ScrumBoard() {
  const state = useProjectStore()
  const eventIndex = useProjectEvents()
  const tasks = selectSprintTasks(state, state.workspace.selectedSprintId).filter(
    (task) =>
      !state.workspace.memberFilterId ||
      task.assigneeId === state.workspace.memberFilterId,
  )

  const moveStatus = (
    event: React.DragEvent,
    status: TaskEntity["status"],
  ) => {
    const id = event.dataTransfer.getData("text/task-id")
    const task = state.tasks[id]
    if (!task) return
    if (status === "blocked" && task.status !== "blocked") {
      state.selectObject("task", task.id)
      notify("请在右侧详情中添加阻塞原因", "error")
      return
    }
    const result = state.updateTask(
      id,
      { status },
      "drag",
    )
    notify(result.message, result.ok ? "success" : "error", result.ok)
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-[#F8FAFC]">
      <div className="flex h-11 items-center gap-3 border-b border-[#E2E7EE] bg-white px-4">
        <span className="text-xs font-semibold text-[#344054]">执行状态</span>
        <span className="rounded bg-[#F2F4F7] px-2 py-0.5 text-[10px] text-[#667085]">
          Task 与 Subtask 共用 Project Model
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Users size={13} className="text-[#98A2B3]" />
          {Object.values(state.members).map((member) => (
            <button
              key={member.id}
              style={{
                opacity:
                  state.workspace.memberFilterId &&
                  state.workspace.memberFilterId !== member.id
                    ? 0.25
                    : 1,
                outline:
                  state.workspace.memberFilterId === member.id
                    ? "2px solid " + member.color
                    : "none",
                outlineOffset: 2,
                borderRadius: 999,
              }}
              onClick={() =>
                state.setWorkspace({
                  memberFilterId:
                    state.workspace.memberFilterId === member.id
                      ? null
                      : member.id,
                })
              }
            >
              <MemberAvatar memberId={member.id} size={22} />
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
        {columns.map((column) => {
          const items = tasks.filter((task) => task.status === column.id)
          return (
            <section
              key={column.id}
              className="scrum-status-column flex w-72 flex-shrink-0 flex-col rounded-lg border"
              style={{
                "--status-column-bg": column.bg,
                "--status-column-border": TASK_STATUS_COLORS[column.id].border,
                "--status-column-color": column.color,
              } as React.CSSProperties}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => moveStatus(event, column.id)}
            >
              <div className="flex items-center gap-2 px-3 py-2.5">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: TASK_STATUS_COLORS[column.id].accent }}
                />
                <b className="text-xs text-[#172033]">{column.label}</b>
                <span
                  className="scrum-status-count ml-auto rounded-full px-1.5 py-0.5 font-mono text-[9px]"
                >
                  {items.length}
                </span>
              </div>
              <div className="space-y-2 overflow-y-auto px-2 pb-2">
                {items.map((task) => {
                  const story = state.stories[task.storyId]
                  const meta = typeMeta[task.type]
                  const subtasks = selectTaskSubtasks(state, task.id)
                  const selected =
                    (state.workspace.selectedObjectType === "task" &&
                      state.workspace.selectedObjectId === task.id) ||
                    (state.workspace.selectedObjectType === "story" &&
                      state.workspace.selectedObjectId === story.id)
                  const dependencyWarning =
                    selectBlockedByIncompletePredecessor(state, task.id)
                  const visualState = selectTaskVisualState(task)
                  const taskRisk = Object.values(state.risks).find((risk) => risk.targetType === "task" && risk.targetId === task.id && risk.status !== "resolved")
                  const taskEvents = eventIndex.byTaskId[task.id] ?? []
                  const taskEventSeverity = highestSeverity(taskEvents)
                  return (
                    <article
                      key={task.id}
                      draggable
                      onDragStart={(event) =>
                        event.dataTransfer.setData("text/task-id", task.id)
                      }
                      onClick={() => state.selectObject("task", task.id)}
                      className="relative cursor-pointer overflow-hidden rounded-lg border bg-white p-3 pl-4 transition hover:shadow-sm"
                      style={{
                        borderColor: selected
                          ? "#7F56D9"
                          : visualState === "severe-blocked"
                            ? "#B42318"
                            : visualState === "overdue"
                              ? "#F04438"
                          : task.status === "blocked"
                            ? "#FECDCA"
                            : TASK_STATUS_COLORS[task.status].border,
                        background: visualState === "overdue" ? "#FFFBFA" : task.status === "done" ? "#F2F4F7" : "white",
                        boxShadow: selected
                          ? "0 0 0 3px rgba(127,86,217,.1)"
                          : "none",
                      }}
                    >
                      <span className="absolute inset-y-0 left-0 w-1" style={{ background: visualState === "severe-blocked" ? "#D92D20" : visualState === "overdue" ? "#7A271A" : TASK_STATUS_COLORS[task.status].accent }} />
                      <div className="mb-1 flex items-center gap-1.5">
                        <button
                          className="rounded bg-[#F4F3FF] px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[#6941C6]"
                          onClick={(event) => {
                            event.stopPropagation()
                            state.selectObject("story", story.id)
                          }}
                        >
                          {story.id.toUpperCase()}
                        </button>
                        <span className="truncate text-[9px] text-[#98A2B3]">
                          {story.title}
                        </span>
                        {taskEventSeverity && (
                          <span
                            className="ml-auto flex-shrink-0 rounded px-1 text-[8px] font-semibold"
                            style={EVENT_BADGE_STYLE[taskEventSeverity]}
                            title={`AI 事件：\n${eventTooltip(taskEvents)}`}
                          >
                            AI {taskEvents.length}
                          </span>
                        )}
                      </div>
                      <h3 className="mb-2 text-xs font-semibold leading-snug text-[#172033]">
                        {task.title}
                      </h3>
                      {(visualState === "overdue" || visualState === "severe-blocked") && <div className="mb-2 inline-flex rounded bg-[#FEF3F2] px-1.5 py-0.5 text-[9px] font-semibold text-[#B42318]">{visualState === "overdue" ? "已逾期" : "严重阻塞"}</div>}
                      <div className="flex items-center gap-1.5">
                        <span
                          className="rounded px-1.5 py-0.5 text-[9px] font-medium"
                          style={{ background: meta.bg, color: meta.color }}
                        >
                          {meta.label}
                        </span>
                        {(task.status === "blocked" || dependencyWarning) && (
                          <CircleAlert
                            size={12}
                            className={
                              task.status === "blocked"
                                ? "text-[#D92D20]"
                                : "text-[#F79009]"
                            }
                          />
                        )}
                        {taskRisk && <span className={`rounded px-1 py-0.5 text-[9px] font-semibold ${taskRisk.level === "high" ? "bg-[#FEF3F2] text-[#B42318]" : "bg-[#FFFAEB] text-[#B54708]"}`}>⚠{taskRisk.level === "high" ? "高" : taskRisk.level === "medium" ? "中" : "低"}</span>}
                        <span className="ml-auto font-mono text-[9px] text-[#98A2B3]">
                          {task.estimate}h
                        </span>
                        <MemberAvatar memberId={task.assigneeId} size={19} />
                      </div>
                      {task.blockReasons.length > 0 && (
                        <div className="mt-2 rounded-md bg-[#FEF3F2] px-2 py-1.5 text-[9px] leading-relaxed text-[#B42318]">
                          <span className="font-semibold">
                            {task.blockReasons.length} 项阻塞：
                          </span>
                          {task.blockReasons[0].message}
                        </div>
                      )}
                      {subtasks.length > 0 && (
                        <div className="mt-2 space-y-1 border-t border-[#F2F4F7] pt-2">
                          <div className="flex items-center gap-1 text-[9px] font-semibold text-[#667085]">
                            <ListTree size={10} />Subtask
                          </div>
                          {subtasks.map((subtask) => (
                            <button
                              key={subtask.id}
                              className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-[9px] text-[#667085] hover:bg-[#F9FAFB]"
                              onClick={(event) => {
                                event.stopPropagation()
                                state.selectObject("subtask", subtask.id)
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={subtask.done}
                                style={{
                                  accentColor:
                                    TASK_STATUS_COLORS[subtask.status].accent,
                                }}
                                onClick={(event) => event.stopPropagation()}
                                onChange={() => state.toggleSubtask(subtask.id)}
                              />
                              <span
                                className="min-w-0 flex-1 truncate"
                                style={{
                                  textDecoration: subtask.done
                                    ? "line-through"
                                    : "none",
                                }}
                              >
                                {subtask.title}
                              </span>
                              <span className="font-mono text-[8px] text-[#98A2B3]">
                                {subtask.progress}%
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </article>
                  )
                })}
                {!items.length && (
                  <div className="flex h-16 items-center justify-center rounded-lg border border-dashed border-[#D0D5DD] text-[10px] text-[#98A2B3]">
                    拖拽至此
                  </div>
                )}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
