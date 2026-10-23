import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  resetProjectStoreForTests,
  useProjectStore,
} from "../store/projectStore"
import { sprintBurndown, sprintWork } from "../store/burndown"
const store = () => useProjectStore.getState()
const day = (value: string) =>
  vi.setSystemTime(new Date(value + "T10:00:00+08:00"))
function fixture(hours = 40) {
  const sprint = store().createSprint({
    releaseId: "release-demo",
    name: "真实燃尽",
    goal: "交付核心故事",
    startDate: "2026-10-01",
    endDate: "2026-10-10",
    capacity: 40,
  })
  const story = store().createStory({
    releaseId: "release-demo",
    sprintId: sprint.id,
    title: "核心故事",
    source: "manual",
    maturityStatus: "ready",
  })
  const task = store().createTask(story.id, {
    title: "工程任务",
    estimate: hours,
    assigneeId: "m1",
  })
  return { sprint, story, task }
}
describe("real Sprint burndown", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    day("2026-10-01")
    resetProjectStoreForTests()
    useProjectStore.setState({
      sprints: {},
      stories: {},
      tasks: {},
      subtasks: {},
      sprintBurndowns: {},
      history: [],
    })
  })
  afterEach(() => vi.useRealTimers())
  it("counts only leaf hours and reuses remaining-work progress rules", () => {
    const { sprint, task } = fixture(80)
    const a = store().addSubtask(task.id, "步骤A"),
      b = store().addSubtask(task.id, "步骤B")
    store().updateSubtask(a.id, {
      estimate: 8,
      progress: 50,
      status: "in_progress",
    })
    store().updateSubtask(b.id, {
      estimate: 12,
      progress: 25,
      status: "in_progress",
    })
    expect(sprintWork(store(), sprint.id)).toEqual({
      totalHours: 20,
      remainingHours: 13,
      itemCount: 2,
    })
    store().updateSubtask(a.id, { status: "done" })
    expect(sprintWork(store(), sprint.id).remainingHours).toBe(9)
  })
  it("previews planning without history, then freezes the starting baseline", () => {
    const { sprint, task } = fixture()
    expect(store().sprintBurndowns[sprint.id]).toBeUndefined()
    expect(sprintBurndown(store(), sprint.id).points[0].actual).toBeNull()
    expect(store().startSprint(sprint.id).ok).toBe(true)
    expect(store().sprintBurndowns[sprint.id]).toMatchObject({
      baselineHours: 40,
      baselineKind: "sprint-start",
    })
    store().updateTask(task.id, { estimate: 60 })
    expect(store().sprintBurndowns[sprint.id].baselineHours).toBe(40)
    expect(
      store().sprintBurndowns[sprint.id].days["2026-10-01"].remainingHours,
    ).toBe(60)
  })
  it("updates today's observation while preserving earlier days and leaving gaps", () => {
    const { sprint, task } = fixture()
    store().startSprint(sprint.id)
    const first = structuredClone(
      store().sprintBurndowns[sprint.id].days["2026-10-01"],
    )
    day("2026-10-03")
    store().updateTask(task.id, { progress: 25, status: "in_progress" })
    store().updateTask(task.id, { progress: 50 })
    const record = store().sprintBurndowns[sprint.id]
    expect(record.days["2026-10-01"]).toEqual(first)
    expect(record.days["2026-10-02"]).toBeUndefined()
    expect(record.days["2026-10-03"].remainingHours).toBe(20)
    expect(
      sprintBurndown(store(), sprint.id).points.find(
        (p) => p.date === "2026-10-02",
      )?.actual,
    ).toBeNull()
    const stable = store().sprintBurndowns
    store().recordSprintWork()
    expect(store().sprintBurndowns).toBe(stable)
  })
  it("captures progress updates, task additions, reopening and scope removals atomically", () => {
    const { sprint, story, task } = fixture()
    store().startSprint(sprint.id)
    store().updateTask(task.id, { status: "done" })
    expect(
      store().sprintBurndowns[sprint.id].days["2026-10-01"].remainingHours,
    ).toBe(0)
    store().updateTask(task.id, { status: "in_progress", progress: 50 })
    store().createTask(story.id, { title: "新增范围", estimate: 10 })
    expect(
      store().sprintBurndowns[sprint.id].days["2026-10-01"].remainingHours,
    ).toBe(30)
    store().removeStoryFromSprint(story.id)
    expect(
      store().sprintBurndowns[sprint.id].days["2026-10-01"].remainingHours,
    ).toBe(0)
    expect(store().sprintBurndowns[sprint.id].baselineHours).toBe(40)
  })
  it("does not fabricate the past when enabling tracking in an existing Sprint", () => {
    const { sprint } = fixture()
    day("2026-10-06")
    useProjectStore.setState({
      sprints: {
        ...store().sprints,
        [sprint.id]: { ...sprint, status: "active" },
      },
    })
    store().recordSprintWork()
    expect(Object.keys(store().sprintBurndowns[sprint.id].days)).toEqual([
      "2026-10-06",
    ])
    expect(store().sprintBurndowns[sprint.id].baselineKind).toBe(
      "first-observation",
    )
    expect(sprintBurndown(store(), sprint.id).forecastDate).toBeNull()
  })
  it("records flat days on observation and flags no positive velocity without inventing a finish date", () => {
    const { sprint } = fixture()
    store().startSprint(sprint.id)
    day("2026-10-03")
    store().recordSprintWork()
    const model = sprintBurndown(store(), sprint.id)
    expect(model.velocity).toBe(0)
    expect(model.forecastDate).toBeNull()
    expect(model.delayed).toBe(true)
    expect(model.behind).toBe(true)
  })
  it("forecasts from real elapsed dates and extends the chart past the Sprint deadline", () => {
    const { sprint, task } = fixture()
    store().startSprint(sprint.id)
    day("2026-10-03")
    store().updateTask(task.id, { status: "in_progress", progress: 10 })
    const model = sprintBurndown(store(), sprint.id)
    expect(model.velocity).toBe(2)
    expect(model.forecastDate).toBe("2026-10-21")
    expect(model.delayed).toBe(true)
    expect(model.points.at(-1)).toMatchObject({
      date: "2026-10-21",
      forecast: 0,
    })
    expect(model.points[0].ideal).toBe(40)
    expect(model.points.find((p) => p.date === "2026-10-10")?.ideal).toBe(0)
  })
  it("shows on-time forecasts and complete actual work", () => {
    const { sprint, task } = fixture()
    store().startSprint(sprint.id)
    day("2026-10-03")
    store().updateTask(task.id, { status: "in_progress", progress: 50 })
    expect(sprintBurndown(store(), sprint.id)).toMatchObject({
      forecastDate: "2026-10-05",
      delayed: false,
      completedPercent: 50,
    })
    store().updateTask(task.id, { status: "done" })
    expect(sprintBurndown(store(), sprint.id)).toMatchObject({
      forecastDate: "2026-10-03",
      completedPercent: 100,
    })
  })
  it("freezes closing work before carry-over so unfinished scope does not burn to zero", () => {
    const { sprint, story, task } = fixture()
    store().startSprint(sprint.id)
    day("2026-10-04")
    store().updateTask(task.id, { progress: 25, status: "in_progress" })
    expect(
      store().closeSprint(sprint.id, {
        goalAchieved: false,
        retrospective: { mainProblem: "延期", nextImprovement: "缩小范围" },
        carryOver: [{ storyId: story.id, to: "backlog" }],
      }).ok,
    ).toBe(true)
    expect(sprintWork(store(), sprint.id).remainingHours).toBe(0)
    expect(sprintBurndown(store(), sprint.id).work.remainingHours).toBe(30)
    const frozen = structuredClone(store().sprintBurndowns[sprint.id])
    day("2026-10-05")
    store().updateTask(task.id, { progress: 100, status: "done" })
    store().recordSprintWork()
    expect(store().sprintBurndowns[sprint.id]).toEqual(frozen)
  })
  it("persists snapshots through export/import without replacing them with current work", () => {
    const { sprint, task } = fixture()
    store().startSprint(sprint.id)
    day("2026-10-02")
    store().updateTask(task.id, { progress: 25, status: "in_progress" })
    const record = structuredClone(store().sprintBurndowns)
    const json = store().exportProjectJson()
    resetProjectStoreForTests()
    expect(store().importProjectJson(json).ok).toBe(true)
    expect(store().sprintBurndowns).toEqual(record)
    const legacy = JSON.parse(json)
    legacy.schemaVersion = 18
    delete legacy.sprintBurndowns
    expect(store().importProjectJson(JSON.stringify(legacy)).ok).toBe(true)
    expect(store().sprintBurndowns).toEqual({})
  })
  it("rejects invalid history on import without touching the current project", () => {
    const { sprint } = fixture()
    store().startSprint(sprint.id)
    const before = store().exportProjectJson()
    const data = JSON.parse(before)
    data.sprintBurndowns[sprint.id].days["2026-10-01"].remainingHours = -1
    expect(store().importProjectJson(JSON.stringify(data)).ok).toBe(false)
    expect(store().exportProjectJson()).toBe(before)
  })
  it("handles rising work without inventing a negative burn forecast", () => {
    const { sprint, task } = fixture()
    store().startSprint(sprint.id)
    day("2026-10-03")
    store().updateTask(task.id, { estimate: 60 })
    const model = sprintBurndown(store(), sprint.id)
    expect(model.velocity).toBe(-10)
    expect(model.forecastDate).toBeNull()
    expect(model.delayed).toBe(true)
    expect(model.work.remainingHours).toBe(60)
  })
  it("uses Shanghai calendar dates and does not retroactively overwrite old days", () => {
    const { sprint } = fixture()
    store().startSprint(sprint.id)
    vi.setSystemTime(new Date("2026-10-01T16:05:00Z"))
    store().recordSprintWork()
    expect(store().sprintBurndowns[sprint.id].days["2026-10-02"]).toBeDefined()
    const record = store().sprintBurndowns
    day("2026-10-01")
    store().recordSprintWork()
    expect(store().sprintBurndowns).toBe(record)
  })
})
