import { beforeEach, describe, expect, it } from "vitest"
import {
  resetProjectStoreForTests,
  useProjectStore,
} from "../store/projectStore"
import {
  inheritedDelivery,
  planningStories,
  releaseSummary,
} from "../store/release"
const store = () => useProjectStore.getState()
const release = (name = "V2") =>
  store().createRelease({
    name,
    goal: "交付测试范围",
    plannedDate: "2026-10-20",
  })
const story = (releaseId: string | null = null, extra = {}) =>
  store().createStory({
    title: "测试用户故事",
    source: "manual",
    releaseId,
    maturityStatus: "ready",
    startDate: "2026-10-01",
    dueDate: "2026-10-10",
    ...extra,
  })
const sprint = (releaseId: string) =>
  store().createSprint({
    releaseId,
    name: "后续迭代",
    goal: "完成遗留项",
    startDate: "2026-10-01",
    endDate: "2026-10-14",
    capacity: 20,
  })
const now = new Date("2026-10-15T12:00:00")

describe("Release ownership and delivery", () => {
  beforeEach(() => resetProjectStoreForTests())
  it("creates a Release with validated fields and PO-only writes", () => {
    const r = release()
    expect(r.status).toBe("planning")
    expect(r.publishedAt).toBeNull()
    expect(() =>
      store().createRelease({
        name: "",
        goal: "目标",
        plannedDate: "2026-10-20",
      }),
    ).toThrow()
    expect(store().updateRelease(r.id, { plannedDate: "2026-02-30" }).ok).toBe(
      false,
    )
    store().setWorkspace({ actorMode: "employee" })
    expect(() => release("禁止")).toThrow(/PO/)
    expect(store().updateRelease(r.id, { status: "released" }).ok).toBe(false)
    expect(
      store().assignStoriesToRelease(["us024"], r.id, {
        confirmed: true,
        reason: "测试",
      }).ok,
    ).toBe(false)
  })
  it("requires PO for initial ownership and confirmation for undo", () => {
    const a = release(),
      s = story()
    expect(
      store().assignStoriesToRelease([s.id], a.id, {
        confirmed: true,
        reason: "",
      }).ok,
    ).toBe(true)
    expect(store().undoLastChange().ok).toBe(false)
    expect(store().stories[s.id].releaseId).toBe(a.id)
    store().setWorkspace({ actorMode: "employee" })
    expect(() => story(a.id)).toThrow(/PO/)
    expect(story().releaseId).toBeNull()
  })
  it("allows PO to mark completed Sprint stories as core without editing execution", () => {
    const a = release(),
      sp = sprint(a.id),
      s = story(a.id, { sprintId: sp.id, deliveryStatus: "accepted" })
    useProjectStore.setState({
      sprints: { ...store().sprints, [sp.id]: { ...sp, status: "closed" } },
    })
    expect(store().updateStory(s.id, { isReleaseCore: true }).ok).toBe(true)
    expect(
      store().updateStory(s.id, { isReleaseCore: false, title: "修改执行范围" })
        .ok,
    ).toBe(false)
    expect(store().updateRelease(a.id, { status: "released" }).ok).toBe(true)
  })
  it("rejects malformed Release imports atomically", () => {
    const data = JSON.parse(store().exportProjectJson())
    data.releases["release-demo"].plannedDate = "2026-02-30"
    const before = store().exportProjectJson()
    expect(store().importProjectJson(JSON.stringify(data)).ok).toBe(false)
    expect(store().exportProjectJson()).toBe(before)
  })
  it("requires matching Release at every Sprint entry point", () => {
    const a = release("A"),
      b = release("B"),
      sp = sprint(a.id),
      s = story()
    expect(store().moveStory(s.id, null, sp.id).ok).toBe(false)
    expect(store().addStoriesToSprint(sp.id, [s.id]).ok).toBe(false)
    expect(store().updateStory(s.id, { sprintId: sp.id }).ok).toBe(false)
    expect(() => story(null, { sprintId: sp.id })).toThrow(/Release/)
    expect(
      store().assignStoriesToRelease([s.id], b.id, {
        confirmed: true,
        reason: "",
      }).ok,
    ).toBe(true)
    expect(store().moveStory(s.id, null, sp.id).ok).toBe(false)
    expect(
      store().assignStoriesToRelease([s.id], a.id, {
        confirmed: true,
        reason: "调整交付版本",
      }).ok,
    ).toBe(true)
    expect(store().moveStory(s.id, null, sp.id).ok).toBe(true)
    expect(store().moveStory(s.id, null, "missing").ok).toBe(false)
  })
  it("requires confirmation and reason, clears incompatible Sprint, and inherits both fields", () => {
    const a = release("A"),
      b = release("B"),
      sp = sprint(a.id),
      s = story(a.id, { sprintId: sp.id })
    const task = store().createTask(s.id, { title: "工程任务" }),
      subtask = store().addSubtask(task.id, "子任务")
    expect(
      store().assignStoriesToRelease([s.id], b.id, {
        confirmed: false,
        reason: "延期",
      }).ok,
    ).toBe(false)
    expect(
      store().assignStoriesToRelease([s.id], b.id, {
        confirmed: true,
        reason: "",
      }).ok,
    ).toBe(false)
    expect(store().stories[s.id].sprintId).toBe(sp.id)
    const expected = { [s.id]: { releaseId: a.id, sprintId: sp.id } }
    expect(
      store().assignStoriesToRelease([s.id], b.id, {
        confirmed: true,
        reason: "范围调整",
        expected,
      }).ok,
    ).toBe(true)
    expect(inheritedDelivery(store(), "subtask", subtask.id)).toEqual({
      releaseId: b.id,
      sprintId: null,
    })
    expect(store().tasks[task.id]).not.toHaveProperty("releaseId")
    expect(store().stories[s.id].releaseChanges?.at(-1)).toMatchObject({
      fromReleaseId: a.id,
      toReleaseId: b.id,
      previousSprintId: sp.id,
      reason: "范围调整",
    })
    expect(
      store().assignStoriesToRelease([s.id], a.id, {
        confirmed: true,
        reason: "重试旧请求",
        expected,
      }).ok,
    ).toBe(false)
  })
  it("validates a whole assignment batch before mutation and prevents generic update bypass", () => {
    const a = release(),
      s = story(),
      other = story("release-demo")
    expect(
      store().assignStoriesToRelease([s.id, other.id], a.id, {
        confirmed: true,
        reason: "",
      }).ok,
    ).toBe(false)
    expect(store().stories[s.id].releaseId).toBeNull()
    expect(store().updateStory(s.id, { releaseId: a.id }).ok).toBe(false)
    expect(store().updateStory(s.id, { releaseChanges: [] }).ok).toBe(false)
    expect(store().updateStory(s.id, { isReleaseCore: true }, "agent").ok).toBe(
      false,
    )
    expect(
      store().assignStoriesToRelease([s.id, "missing"], a.id, {
        confirmed: true,
        reason: "测试",
      }).ok,
    ).toBe(false)
  })
  it("does not reparent a Sprint containing Stories", () => {
    const a = release("A"),
      b = release("B"),
      sp = sprint(a.id)
    story(a.id, { sprintId: sp.id })
    expect(store().updateSprint(sp.id, { releaseId: b.id }).ok).toBe(false)
    const empty = sprint(a.id)
    expect(store().updateSprint(empty.id, { releaseId: b.id }).ok).toBe(true)
    expect(store().updateSprint(empty.id, { releaseId: null }).ok).toBe(false)
  })
  it("calculates acceptance progress independently of task completion and surfaces risk", () => {
    const r = release(),
      s = story(r.id, { risk: "high", riskNote: "外部依赖" })
    const task = store().createTask(s.id, {
      title: "任务",
      startDate: "2026-10-01",
      endDate: "2026-10-02",
    })
    useProjectStore.setState({
      tasks: {
        ...store().tasks,
        [task.id]: { ...task, status: "done", progress: 100 },
      },
    })
    const result = releaseSummary(store(), r.id, now)
    expect(result.progress).toBe(0)
    expect(result.overdue.some((item) => item.id === s.id)).toBe(true)
    expect(result.highRiskStories.map((item) => item.id)).toContain(s.id)
    expect(result.canPublish).toBe(false)
  })
  it("publishes only when all core stories are accepted and no severe block exists", () => {
    const r = release(),
      core = story(r.id, { isReleaseCore: true }),
      optional = story(r.id)
    expect(store().updateRelease(r.id, { status: "released" }).ok).toBe(false)
    useProjectStore.setState({
      stories: {
        ...store().stories,
        [core.id]: { ...core, deliveryStatus: "accepted" },
      },
    })
    const task = store().createTask(optional.id, { title: "非核心工作" }),
      subtask = store().addSubtask(task.id, "严重阻塞步骤")
    useProjectStore.setState({
      subtasks: {
        ...store().subtasks,
        [subtask.id]: {
          ...subtask,
          status: "blocked",
          blockedSeverity: "severe",
        },
      },
    })
    expect(
      releaseSummary(store(), r.id, now).severe.map((item) => item.id),
    ).toContain(subtask.id)
    expect(store().updateRelease(r.id, { status: "released" }).ok).toBe(false)
    useProjectStore.setState({
      subtasks: {
        ...store().subtasks,
        [subtask.id]: { ...subtask, status: "todo" },
      },
    })
    expect(store().updateRelease(r.id, { status: "released" }).ok).toBe(true)
    expect(store().releases[r.id].publishedAt).toBeTruthy()
    expect(releaseSummary(store(), r.id, now).progress).toBe(50)
    expect(store().updateStory(core.id, { isReleaseCore: false }).ok).toBe(
      false,
    )
    const followup = sprint(r.id)
    expect(store().moveStory(optional.id, null, followup.id).ok).toBe(true)
    const next = release("下一版本")
    expect(
      store().assignStoriesToRelease([optional.id], next.id, {
        confirmed: true,
        reason: "非核心范围后移",
      }).ok,
    ).toBe(true)
  })
  it("does not publish empty releases and uses all stories if no core is selected", () => {
    const r = release()
    expect(store().updateRelease(r.id, { status: "released" }).ok).toBe(false)
    const s = story(r.id)
    expect(store().updateRelease(r.id, { status: "released" }).ok).toBe(false)
    useProjectStore.setState({
      stories: {
        ...store().stories,
        [s.id]: { ...s, deliveryStatus: "accepted" },
      },
    })
    expect(store().updateRelease(r.id, { status: "released" }).ok).toBe(true)
  })
  it("filters cross-Sprint plans and preserves unassigned stories", () => {
    const a = release("A"),
      b = release("B"),
      s1 = story(a.id, { sprintId: sprint(a.id).id }),
      s2 = story(a.id),
      s3 = story(b.id),
      unassigned = story()
    expect(planningStories(store(), a.id).map((s) => s.id)).toEqual([
      s1.id,
      s2.id,
    ])
    expect(planningStories(store(), "unassigned").map((s) => s.id)).toContain(
      unassigned.id,
    )
    expect(planningStories(store(), a.id).map((s) => s.id)).not.toContain(s3.id)
  })
  it("migrates old JSON while preserving Sprint and execution identities", () => {
    const legacy = JSON.parse(store().exportProjectJson())
    legacy.schemaVersion = 17
    legacy.impactAnalyses = {}
    delete legacy.releases
    Object.values(legacy.sprints).forEach((s: any) => delete s.releaseId)
    Object.values(legacy.stories).forEach((s: any) => delete s.releaseId)
    const count = Object.keys(legacy.tasks).length,
      sprintId = legacy.stories.us024.sprintId
    expect(store().importProjectJson(JSON.stringify(legacy)).ok).toBe(true)
    expect(store().stories.us024.sprintId).toBe(sprintId)
    expect(store().stories.us024.releaseId).toBe("release-legacy")
    expect(store().stories["cand-003"].releaseId).toBeNull()
    expect(Object.keys(store().tasks)).toHaveLength(count)
    expect(store().impactAnalyses).toEqual([])
    expect(store().importProjectJson(store().exportProjectJson()).ok).toBe(true)
  })
  it("rejects imported Release/Sprint mismatch without changing the current project", () => {
    const data = JSON.parse(store().exportProjectJson())
    data.stories.us024.releaseId = null
    const before = store().exportProjectJson()
    expect(store().importProjectJson(JSON.stringify(data)).ok).toBe(false)
    expect(store().exportProjectJson()).toBe(before)
  })
  it("rejects cross-Release carry-over when closing a Sprint", () => {
    const r = release(),
      target = sprint(r.id)
    const unfinished = Object.values(store().stories).filter(
      (s) => s.sprintId === "s2" && s.deliveryStatus !== "accepted",
    )
    expect(
      store().closeSprint("s2", {
        goalAchieved: false,
        retrospective: { mainProblem: "延期", nextImprovement: "调整范围" },
        carryOver: unfinished.map((s) => ({ storyId: s.id, to: target.id })),
      }).ok,
    ).toBe(false)
    expect(store().sprints.s2.status).toBe("active")
  })
})
