import type { ProjectDataState } from "../types"

export const DEMO_REFERENCE_DATE = "2026-10-15"
const date = (day: number) => "2026-10-" + String(day).padStart(2, "0")
const stories: Record<string, [number, number]> = {
  "us001": [
    10,
    12
  ],
  "us002": [
    12,
    13
  ],
  "project-usecase": [
    15,
    18
  ],
  "us003": [
    10,
    13
  ],
  "us021": [
    13,
    14
  ],
  "us031": [
    15,
    18
  ],
  "us024": [
    15,
    23
  ],
  "us025": [
    24,
    26
  ],
  "cand-001": [
    25,
    29
  ],
  "us026": [
    15,
    20
  ],
  "uml-assets": [
    17,
    22
  ],
  "cand-002": [
    24,
    28
  ],
  "us022": [
    10,
    13
  ],
  "sprint-plan": [
    11,
    14
  ],
  "sprint-burndown": [
    16,
    23
  ],
  "us023": [
    12,
    14
  ],
  "us029": [
    16,
    19
  ],
  "block-track": [
    18,
    23
  ],
  "us028": [
    28,
    30
  ],
  "ai-proposal": [
    29,
    31
  ],
  "us027": [
    28,
    31
  ],
  "ai-risk": [
    28,
    31
  ],
  "us030": [
    17,
    20
  ],
  "us034": [
    20,
    23
  ],
  "release-scope": [
    25,
    27
  ],
  "backup": [
    24,
    27
  ],
  "us032": [
    29,
    31
  ],
  "audit": [
    27,
    30
  ],
  "discovery": [
    26,
    31
  ]
}
const sprints: Record<string, [number, number]> = {
  "s1": [
    10,
    14
  ],
  "s2": [
    15,
    23
  ],
  "s3": [
    24,
    27
  ],
  "s4": [
    28,
    31
  ]
}
const ganttTasks: Record<string, [number, number]> = {
  "task-us024-1": [
    15,
    18
  ],
  "task-us024-2": [
    15,
    17
  ],
  "task-us024-3": [
    19,
    20
  ],
  "task-us024-4": [
    21,
    23
  ]
}

/** Only for fresh demo construction: never overwrite dates in a restored or edited project. */
export function applyDemoSchedule(state: ProjectDataState) {
  for (const story of Object.values(state.stories)) {
    const interval = stories[story.id]
    if (!interval) throw new Error("示例故事缺少排期：" + story.id)
    story.startDate = date(interval[0]); story.dueDate = date(interval[1])
    const tasks = story.taskIds.map(id => state.tasks[id]).filter(Boolean).sort((a, b) => a.order - b.order)
    const length = interval[1] - interval[0] + 1
    tasks.forEach((task, index) => {
      const start = interval[0] + (tasks.length === 1 ? (length > 3 ? 1 : 0) : Math.floor(index * length / tasks.length))
      const finish = tasks.length === 1 ? interval[1] - (length > 3 ? 1 : 0) : Math.min(interval[1], interval[0] + Math.ceil((index + 1) * length / tasks.length) - (index === tasks.length - 1 ? 1 : 0))
      const override = ganttTasks[task.id]
      task.startDate = date(override?.[0] ?? start)
      task.endDate = task.isMilestone ? task.startDate : date(override?.[1] ?? Math.max(start, finish))
      const children = task.subtaskIds.map(id => state.subtasks[id]).filter(Boolean).sort((a, b) => a.order - b.order)
      const first = Number(task.startDate.slice(-2)), last = Number(task.endDate.slice(-2)), span = last - first + 1
      children.forEach((child, i) => {
        child.startDate = date(first + Math.floor(i * span / children.length))
        child.endDate = date(Math.min(last, first + Math.ceil((i + 1) * span / children.length) - 1))
        if (child.endDate < child.startDate) child.endDate = child.startDate
      })
    })
  }
  for (const epic of Object.values(state.epics)) {
    const children = Object.values(state.stories).filter(story => story.epicId === epic.id)
    epic.startDate = children.map(story => story.startDate).sort()[0]
    epic.endDate = children.map(story => story.dueDate).sort().at(-1)!
  }
  for (const sprint of Object.values(state.sprints)) {
    sprint.startDate = date(sprints[sprint.id][0]); sprint.endDate = date(sprints[sprint.id][1])
  }
  state.releases["release-base"].plannedDate = date(14)
  state.releases["release-demo"].plannedDate = date(27)
  state.releases["release-next"].plannedDate = date(31)
  state.project.startDate = date(10); state.project.endDate = date(31)
  state.workspace.ganttRangeStart = "2026-10-07"; state.workspace.ganttRangeEnd = "2026-11-03"
  state.workspace.ganttScrollLeft = 0; state.workspace.ganttScrollTop = 0
  return state
}
