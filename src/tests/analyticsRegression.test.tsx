// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { AnalyticsPage } from "../pages/ManagementPages"
import { useProjectStore, resetProjectStoreForTests } from "../store/projectStore"
import { selectDailyActualWorkloadHeatmap, selectDailyWorkloadHeatmap, selectTaskVisualState } from "../store/selectors"

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-23T20:30:00Z"))
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} })
  resetProjectStoreForTests()
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe("analytics facts across project date and fractional hours", () => {
  it("marks the same Shanghai day in both heatmaps and overdue tasks", () => {
    const s = useProjectStore.getState()
    expect(selectDailyWorkloadHeatmap(s).dates.find(x => x.isToday)?.date).toBe("2026-10-24")
    expect(selectDailyActualWorkloadHeatmap(s).dates.find(x => x.isToday)?.date).toBe("2026-10-24")
    expect(selectTaskVisualState({ status: "in_progress", progress: 20, endDate: "2026-10-23", blockedSeverity: "normal" })).toBe("overdue")
  })

  it("records a pulse on the project date during the UTC date boundary", () => {
    render(<AnalyticsPage />)
    fireEvent.change(screen.getByPlaceholderText("今日重点"), { target: { value: "凌晨回归" } })
    fireEvent.click(screen.getByRole("button", { name: "添加记录" }))
    const pulse = Object.values(useProjectStore.getState().sprintPulses).find(x => x.focus === "凌晨回归")
    expect(pulse?.date).toBe("2026-10-24")
  })

  it("shows readable decimal totals after summing fractional member workloads", () => {
    vi.setSystemTime(new Date("2026-10-23T10:00:00+08:00"))
    const s = useProjectStore.getState(), task = s.tasks["fe-024-2"]
    useProjectStore.setState({
      members: { m1: { ...s.members.m1, capacityHours: 0.5 }, m2: { ...s.members.m2, capacityHours: 1 } },
      sprints: { ...s.sprints, s2: { ...s.sprints.s2, startDate: "2026-10-23", endDate: "2026-10-23" } },
      tasks: { a: { ...task, id: "a", assigneeId: "m1", estimate: 0.1, progress: 0, status: "todo", subtaskIds: [] }, b: { ...task, id: "b", assigneeId: "m2", estimate: 0.2, progress: 0, status: "todo", subtaskIds: [] } },
      subtasks: {},
    })
    render(<AnalyticsPage />)
    expect(screen.getByText("剩余时间容量").parentElement?.textContent).toContain("0.3h")
    expect(screen.getByText("未完成工时").parentElement?.textContent).toContain("0.3h")
    expect(screen.queryByText(/0\.30000000000000004h/)).toBeNull()
  })
})
