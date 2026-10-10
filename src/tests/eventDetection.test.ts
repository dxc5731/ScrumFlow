import { beforeEach, describe, expect, it } from "vitest"
import { detectProjectEvents } from "../utils/eventDetection"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"
import {
  selectCriticalPathTaskIds,
  selectSprintStories,
  selectSprintTasks,
} from "../store/selectors"

const REFERENCE = new Date("2026-09-18T10:00:00+08:00")

describe("event型 Agent 检测规则", () => {
  beforeEach(() => resetProjectStoreForTests())

  it("为每条事件都提供触发规则和数据依据", () => {
    const state = useProjectStore.getState()
    const events = detectProjectEvents(state, "s2", REFERENCE)

    expect(events.length).toBeGreaterThan(0)
    expect(events.every((event) => event.rule.length > 0)).toBe(true)
    expect(events.every((event) => event.evidence.length >= 2)).toBe(true)
  })

  it("识别逾期或即将到期任务", () => {
    const state = useProjectStore.getState()
    const deadlineEvents = detectProjectEvents(state, "s2", REFERENCE).filter(
      (event) => event.kind === "deadline",
    )

    expect(deadlineEvents.length).toBeGreaterThan(0)
    expect(deadlineEvents.every((event) => event.targetType === "task")).toBe(true)
  })

  it("同一后置任务只保留一条最高严重程度的依赖事件", () => {
    const state = useProjectStore.getState()
    const dependencyEvents = detectProjectEvents(state, "s2", REFERENCE).filter(
      (event) => event.kind === "dependency" && !event.id.startsWith("cycle:"),
    )
    const targetIds = dependencyEvents.map((event) => event.targetId)

    expect(dependencyEvents.length).toBeGreaterThan(0)
    expect(new Set(targetIds).size).toBe(targetIds.length)
  })

  it("把前置任务未完成的影响扩散到后续任务", () => {
    const base = useProjectStore.getState()
    const chained = {
      ...base,
      dependencies: {
        ...base.dependencies,
        "dep-extra": {
          id: "dep-extra",
          sourceTaskId: "be-024-1",
          targetTaskId: "fe-025-1",
          type: "FS" as const,
          createdAt: "2026-09-18T10:00:00+08:00",
        },
      },
    }
    const event = detectProjectEvents(chained, "s2", REFERENCE).find(
      (item) => item.kind === "dependency" && item.targetId === "be-024-1",
    )

    expect(event).toBeTruthy()
    expect(event?.evidence.join(" ")).toContain("连带影响后续任务")
    expect(event?.relatedIds).toContain("fe-025-1")
  })

  it("执行项进入评审但没有成果时提示补充成果", () => {
    const base = useProjectStore.getState()
    const target = selectSprintTasks(base, "s2")[0]
    const mutated = {
      ...base,
      tasks: {
        ...base.tasks,
        [target.id]: {
          ...target,
          status: "review" as const,
          resultSummary: "",
          submittedAt: null,
        },
      },
    }
    const event = detectProjectEvents(mutated, "s2", REFERENCE).find(
      (item) => item.kind === "artifact" && item.targetId === target.id,
    )

    expect(event).toBeTruthy()
    expect(event?.targetType).toBe("task")
    expect(event?.evidence.join(" ")).toContain("成果说明")
  })

  it("Story 缺少验收标准时给出验收准备事件", () => {
    const base = useProjectStore.getState()
    const story = selectSprintStories(base, "s2")[0]
    const mutated = {
      ...base,
      acceptanceCriteria: Object.fromEntries(
        Object.entries(base.acceptanceCriteria).filter(
          ([, criterion]) => criterion.storyId !== story.id,
        ),
      ),
    }
    const event = detectProjectEvents(mutated, "s2", REFERENCE).find(
      (item) => item.kind === "acceptance" && item.targetId === story.id,
    )

    expect(event).toBeTruthy()
    expect(event?.targetType).toBe("story")
    expect(event?.rule).toContain("验收标准")
  })

  it("关键路径上的任务风险自动升为高等级", () => {
    const state = useProjectStore.getState()
    const critical = selectCriticalPathTaskIds(state)
    expect(critical.size).toBeGreaterThan(0)
    const events = detectProjectEvents(state, "s2", REFERENCE)
    const criticalDeadline = events.filter(
      (event) => event.kind === "deadline" && critical.has(event.targetId),
    )

    expect(criticalDeadline.every((event) => event.severity === "high")).toBe(true)
    expect(criticalDeadline.every((event) => event.evidence.join(" ").includes("关键路径"))).toBe(true)
  })

  it("识别 FS 依赖环路", () => {    const base = useProjectStore.getState()
    const withCycle = {
      ...base,
      dependencies: {
        ...base.dependencies,
        "dep-cycle": {
          id: "dep-cycle",
          sourceTaskId: "be-024-1",
          targetTaskId: "data-024",
          type: "FS" as const,
          createdAt: "2026-09-18T10:00:00+08:00",
        },
      },
    }
    const cycles = detectProjectEvents(withCycle, "s2", REFERENCE).filter((event) =>
      event.id.startsWith("cycle:"),
    )

    expect(cycles.length).toBeGreaterThan(0)
    expect(cycles[0].severity).toBe("high")
    expect(cycles[0].rule).toContain("环路")
  })

  it("按成员周期可用容量而不是Story Point判断负载", () => {
    const base = useProjectStore.getState()
    const constrained = {
      ...base,
      members: {
        ...base.members,
        m2: { ...base.members.m2, capacityHours: 1 },
      },
    }
    const workloadEvents = detectProjectEvents(constrained, "s2", REFERENCE).filter(
      (event) => event.kind === "workload",
    )
    const target = workloadEvents.find((event) => event.targetId === "m2")

    expect(target).toBeTruthy()
    expect(target?.evidence.join(" ")).toContain("周期可用容量")
  })

  it("计划Story Point超出Sprint容量时给出范围事件", () => {
    const base = useProjectStore.getState()
    const tight = {
      ...base,
      sprints: {
        ...base.sprints,
        s2: { ...base.sprints.s2, capacity: 1 },
      },
    }
    const scopeEvents = detectProjectEvents(tight, "s2", REFERENCE).filter(
      (event) => event.kind === "scope",
    )

    expect(scopeEvents).toHaveLength(1)
    expect(scopeEvents[0].targetType).toBe("sprint")
    expect(scopeEvents[0].targetId).toBe("s2")
  })

  it("同一项目快照下事件结果稳定", () => {
    const state = useProjectStore.getState()
    const first = detectProjectEvents(state, "s2", REFERENCE)
    const second = detectProjectEvents(state, "s2", REFERENCE)

    expect(second.map((event) => event.id)).toEqual(first.map((event) => event.id))
  })
})
