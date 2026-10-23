// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Gantt from "../pages/Gantt"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"
import { fitGanttRange } from "../utils/ganttRange"
const store = () => useProjectStore.getState()
const axis = () => document.querySelector("[data-gantt-start]")!
beforeEach(() => {
  resetProjectStoreForTests()
  Element.prototype.scrollIntoView = vi.fn()
  store().createBlankProject({ name: "排期检查", goal: "动态日期轴", requirementBrief: "", startDate: "2026-10-10", endDate: "2026-10-31", members: [{ name: "PO", role: "PO", capacityHours: 40 }, { name: "开发", role: "开发", capacityHours: 40 }] })
  const goal = store().createActivity({ title: "目标" })
  const epic = store().createEpic(goal.id, { title: "排期 Epic", startDate: "2026-10-15", endDate: "2026-10-23" })
  const story = store().createStory({ title: "排期 Story", source: "manual", epicId: epic.id, startDate: "2026-10-15", dueDate: "2026-10-23", assigneeId: Object.keys(store().members)[0] })
  store().createTask(story.id, { title: "拖动任务", startDate: "2026-10-18", endDate: "2026-10-20" })
  store().setWorkspace({ releaseFilterId: "all", ganttRangeStart: "2026-09-01", ganttRangeEnd: "2026-10-31", ganttScrollLeft: 400 })
})
afterEach(cleanup)
describe("automatic Gantt left boundary", () => {
  it("starts three days before rendered work and synchronizes the persisted range", () => {
    render(<Gantt />)
    expect(axis().getAttribute("data-gantt-start")).toBe("2026-10-12")
    expect(store().workspace.ganttRangeStart).toBe("2026-10-12")
    expect(store().workspace.ganttScrollLeft).toBe(0)
  })
  it("extends the live preview and contracts it when the earliest work moves right", () => {
    render(<Gantt />)
    const task = Object.values(store().tasks)[0]
    const bar = screen.getByText("拖动任务").closest("[data-gantt-row]")?.querySelector("[data-gantt-bar]")
    if (!bar) throw new Error("Missing editable task bar")
    fireEvent.mouseDown(bar, { clientX: 650, button: 0 })
    fireEvent.mouseMove(window, { clientX: 442 })
    // The axis follows before mouseup, and repeating the same pointer position must not drift.
    expect(axis().getAttribute("data-gantt-start")).toBe("2026-10-07")
    fireEvent.mouseMove(window, { clientX: 442 })
    expect(axis().getAttribute("data-gantt-start")).toBe("2026-10-07")
    fireEvent.mouseMove(window, { clientX: 494 })
    expect(axis().getAttribute("data-gantt-start")).toBe("2026-10-09")
    fireEvent.mouseUp(window)
    expect(store().tasks[task.id].startDate).toBe("2026-10-12")
    expect(axis().getAttribute("data-gantt-start")).toBe("2026-10-09")
  })
  it("moves the origin right immediately when the earliest Story moves right, ignoring non-rendered Epic dates", () => {
    render(<Gantt />)
    const handle = screen.getByTitle("平移用户故事及全部工程任务")
    fireEvent.mouseDown(handle, { clientX: 650, button: 0 })
    fireEvent.mouseMove(window, { clientX: 780 })
    expect(axis().getAttribute("data-gantt-start")).toBe("2026-10-17")
    // The underlying model is committed only on mouseup, while the axis already follows its preview.
    expect(Object.values(store().stories)[0].startDate).toBe("2026-10-15")
    fireEvent.mouseUp(window)
    expect(Object.values(store().stories)[0].startDate).toBe("2026-10-20")
    expect(axis().getAttribute("data-gantt-start")).toBe("2026-10-17")
  })
  it("re-fits when filtered work changes and handles an empty scope", () => {
    const members = Object.keys(store().members)
    const goal = Object.values(store().activities)[0]
    const epic = store().createEpic(goal.id, { title: "后续 Epic", startDate: "2026-10-25", endDate: "2026-10-30" })
    store().createStory({ title: "后续 Story", source: "manual", epicId: epic.id, assigneeId: members[1], startDate: "2026-10-25", dueDate: "2026-10-30" })
    render(<Gantt />)
    act(() => store().setWorkspace({ memberFilterId: members[1] }))
    expect(axis().getAttribute("data-gantt-start")).toBe("2026-10-22")
    act(() => store().setWorkspace({ memberFilterId: "missing-member" }))
    expect(axis().getAttribute("data-gantt-start")).toBe("2026-10-22")
  })
  it("uses the same fit for exported charts without mutating workspace", () => {
    render(<Gantt captureOnly />)
    expect(axis().getAttribute("data-gantt-start")).toBe("2026-10-12")
    expect(store().workspace.ganttRangeStart).toBe("2026-09-01")
    expect(fitGanttRange([{startDate:"2026-10-30",endDate:"2026-11-04"}],{startDate:"2026-09-01",endDate:"2026-10-31"})).toEqual({startDate:"2026-10-27",endDate:"2026-11-07"})
  })
})
