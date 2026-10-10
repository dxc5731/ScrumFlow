import { useMemo } from "react"
import {
  type DetectedEvent,
  type EventSeverity,
} from "../utils/eventDetection"
import { useProjectStore } from "../store/projectStore"
import type { ProjectDataState } from "../types"

const severityRank: Record<EventSeverity, number> = { high: 3, medium: 2, low: 1 }

export interface ProjectEventIndex {
  events: DetectedEvent[]
  byTaskId: Record<string, DetectedEvent[]>
  byStoryId: Record<string, DetectedEvent[]>
  byMemberId: Record<string, DetectedEvent[]>
}

/**
 * 把事件按目标对象归位，便于在看板、甘特图等视图上标注。
 * 纯函数，便于单测。
 */
export function buildEventIndex(
  state: Pick<ProjectDataState, "tasks" | "stories">,
  events: DetectedEvent[],
): ProjectEventIndex {
  const byTaskId: Record<string, DetectedEvent[]> = {}
  const byStoryId: Record<string, DetectedEvent[]> = {}
  const byMemberId: Record<string, DetectedEvent[]> = {}
  const seen: Record<string, Set<string>> = {}

  const push = (
    map: Record<string, DetectedEvent[]>,
    key: string,
    event: DetectedEvent,
  ) => {
    const bucket = (seen[key] ??= new Set<string>())
    if (bucket.has(event.id)) return
    bucket.add(event.id)
    ;(map[key] ??= []).push(event)
  }

  events.forEach((event) => {
    if (event.targetType === "task") push(byTaskId, event.targetId, event)
    else if (event.targetType === "story") push(byStoryId, event.targetId, event)
    else if (event.targetType === "member") push(byMemberId, event.targetId, event)

    if (event.kind === "scope") return
    event.relatedIds.forEach((id) => {
      if (state.tasks[id]) push(byTaskId, id, event)
      else if (state.stories[id]) push(byStoryId, id, event)
    })
  })

  return { events, byTaskId, byStoryId, byMemberId }
}

export function highestSeverity(events: DetectedEvent[]): EventSeverity | null {
  return events.reduce<EventSeverity | null>(
    (current, event) =>
      !current || severityRank[event.severity] > severityRank[current]
        ? event.severity
        : current,
    null,
  )
}

export const EVENT_BADGE_STYLE: Record<EventSeverity, { color: string; bg: string }> = {
  high: { color: "#B42318", bg: "#FEF3F2" },
  medium: { color: "#B54708", bg: "#FFFAEB" },
  low: { color: "#067647", bg: "#ECFDF3" },
}

export function eventTooltip(events: DetectedEvent[]) {
  return events.map((event) => `${event.title}：${event.summary}`).join("\n")
}

/** 按需计算当前 Sprint 的事件索引，供各视图复用。 */
export function useProjectEvents(sprintId?: string): ProjectEventIndex {
  const state = useProjectStore()
  const targetSprint = sprintId ?? state.workspace.selectedSprintId
  return useMemo(
    () => buildEventIndex(state, Object.values(state.projectEvents).filter(record => record.sprintId === targetSprint && !["resolved", "ignored"].includes(record.status)).map(record => record.event)),
    [state, targetSprint],
  )
}

/** 扫描全部 Sprint 的事件索引，用于故事地图这类跨 Sprint 的视图。 */
export function useAllSprintsEvents(): ProjectEventIndex {
  const state = useProjectStore()
  const sprintIds = Object.keys(state.sprints)
  const key = sprintIds.join(",")
  return useMemo(() => {
    const byId = new Map<string, DetectedEvent>()
    Object.values(state.projectEvents).filter(record => !["resolved", "ignored"].includes(record.status))
      .forEach(record => byId.set(record.id, record.event))
    return buildEventIndex(state, [...byId.values()])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, key])
}
