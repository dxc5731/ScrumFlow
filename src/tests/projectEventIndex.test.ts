import { beforeEach, describe, expect, it } from "vitest"
import { detectProjectEvents } from "../utils/eventDetection"
import { buildEventIndex, highestSeverity } from "../hooks/useProjectEvents"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"

const REFERENCE = new Date("2026-09-18T10:00:00+08:00")

describe("事件索引与严重程度", () => {
  beforeEach(() => resetProjectStoreForTests())

  it("按任务、Story 与成员归位事件", () => {
    const state = useProjectStore.getState()
    const events = detectProjectEvents(state, "s2", REFERENCE)
    const index = buildEventIndex(state, events)

    const taskTargeted = events.filter((event) => event.targetType === "task")
    expect(taskTargeted.length).toBeGreaterThan(0)
    taskTargeted.forEach((event) => {
      expect(index.byTaskId[event.targetId]?.map((item) => item.id)).toContain(event.id)
    })

    const workload = events.find((event) => event.kind === "workload")
    if (workload) {
      expect(index.byMemberId[workload.targetId]?.map((item) => item.id)).toContain(workload.id)
    }
  })

  it("同一个事件不会在同一目标上重复计数", () => {
    const state = useProjectStore.getState()
    const events = detectProjectEvents(state, "s2", REFERENCE)
    const index = buildEventIndex(state, events)

    Object.entries(index.byTaskId).forEach(([taskId, list]) => {
      const ids = list.map((event) => event.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(taskId.length).toBeGreaterThan(0)
    })
  })

  it("范围容量事件不挂到每条 Story 上，避免重复刷屏", () => {
    const base = useProjectStore.getState()
    const tight = {
      ...base,
      sprints: { ...base.sprints, s2: { ...base.sprints.s2, capacity: 1 } },
    }
    const events = detectProjectEvents(tight, "s2", REFERENCE)
    expect(events.some((event) => event.kind === "scope")).toBe(true)

    const index = buildEventIndex(tight, events)
    Object.values(index.byStoryId).forEach((list) => {
      expect(list.some((event) => event.kind === "scope")).toBe(false)
    })
  })

  it("highestSeverity 返回最高等级", () => {
    const state = useProjectStore.getState()
    const events = detectProjectEvents(state, "s2", REFERENCE)
    const high = events.find((event) => event.severity === "high")
    const medium = events.find((event) => event.severity === "medium")

    expect(highestSeverity([])).toBeNull()
    if (high) expect(highestSeverity([high])).toBe("high")
    if (high && medium) expect(highestSeverity([medium, high])).toBe("high")
  })
})
