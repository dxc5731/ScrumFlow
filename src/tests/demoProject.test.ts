import { beforeEach, describe, expect, it } from "vitest"
import { createDemoProjectState } from "../data/demoProject"
import {
  resetProjectStoreForTests,
  useProjectStore,
} from "../store/projectStore"
import {
  normalizeSprintBurndowns,
  sprintBurndown,
  sprintWork,
} from "../store/burndown"
import {
  inheritedDelivery,
  releaseSummary,
  storySprintIssue,
} from "../store/release"
import { projectUseCaseDiagram } from "../utils/projectUseCase"
import { getStoredAssetBlob } from "../components/assets/AssetFilePreviewDialog"

const now = new Date("2026-10-15T12:00:00+08:00")
const demo = () => createDemoProjectState(now)
const store = () => useProjectStore.getState()
beforeEach(() => resetProjectStoreForTests())

describe("current comprehensive initialization", () => {
  it("covers real execution, acceptance, future scope and unassigned discovery", () => {
    const data = demo(),
      stories = Object.values(data.stories)
    expect(new Set(stories.map((item) => item.deliveryStatus))).toEqual(
      new Set([
        "accepted",
        "planned",
        "in_progress",
        "pending_acceptance",
        "backlog",
      ]),
    )
    expect(new Set(stories.map((item) => item.maturityStatus))).toEqual(
      new Set(["candidate", "draft", "ready"]),
    )
    expect(new Set(Object.values(data.tasks).map((item) => item.type))).toEqual(
      new Set(["frontend", "backend", "database", "test", "design", "devops"]),
    )
    expect(
      new Set(Object.values(data.tasks).map((item) => item.status)),
    ).toEqual(new Set(["done", "todo", "in_progress", "review", "blocked"]))
    expect(stories.some((story) => !story.releaseId && !story.sprintId)).toBe(
      true,
    )
    expect(
      stories.some(
        (story) =>
          story.releaseId &&
          !story.sprintId &&
          story.maturityStatus === "ready",
      ),
    ).toBe(true)
    expect(
      stories.some(
        (story) => story.acceptanceLog.at(-1)?.result === "returned",
      ),
    ).toBe(true)
    expect(
      stories.some((story) =>
        story.releaseChanges?.some(
          (change) => change.reason && change.previousSprintId,
        ),
      ),
    ).toBe(true)
  })
  it("has an intact hierarchy and valid references across all views", () => {
    const data = demo()
    for (const goal of Object.values(data.activities)) {
      const epics = Object.values(data.epics).filter(
        (epic) => epic.goalId === goal.id,
      )
      expect(epics.length).toBeGreaterThanOrEqual(1)
      expect(epics.length).toBeLessThanOrEqual(3)
      for (const epic of epics) {
        const stories = Object.values(data.stories).filter(
          (story) => story.epicId === epic.id,
        )
        expect(stories.length).toBeGreaterThanOrEqual(1)
        expect(stories.length).toBeLessThanOrEqual(4)
      }
    }
    for (const story of Object.values(data.stories)) {
      expect(storySprintIssue(data, story, story.sprintId)).toBeNull()
      expect(data.members[story.assigneeId]).toBeDefined()
      expect(story.startDate <= story.dueDate).toBe(true)
      for (const id of story.taskIds)
        expect(data.tasks[id].storyId).toBe(story.id)
      for (const id of story.acceptanceCriteriaIds)
        expect(data.acceptanceCriteria[id].storyId).toBe(story.id)
      for (const id of story.discussionIds)
        expect(data.discussions[id].storyId).toBe(story.id)
      if (story.deliveryStatus === "accepted") {
        expect(story.acceptanceLog.at(-1)?.result).toBe("accepted")
        expect(
          story.acceptanceCriteriaIds.every(
            (id) => data.acceptanceCriteria[id].satisfied,
          ),
        ).toBe(true)
        expect(story.taskIds.length).toBeGreaterThan(0)
        expect(
          story.taskIds.every((id) => data.tasks[id].status === "done"),
        ).toBe(true)
      }
    }
    const blockIds = [
      ...Object.values(data.tasks),
      ...Object.values(data.subtasks),
    ].flatMap((item) => item.blockReasons.map((reason) => reason.id))
    expect(new Set(blockIds).size).toBe(blockIds.length)
    for (const task of Object.values(data.tasks)) {
      expect(data.stories[task.storyId].taskIds).toContain(task.id)
      for (const id of task.subtaskIds) {
        expect(data.subtasks[id].taskId).toBe(task.id)
        expect(inheritedDelivery(data, "subtask", id)).toEqual(
          inheritedDelivery(data, "story", task.storyId),
        )
      }
      for (const id of task.resultAssetIds)
        expect(data.assets[id]).toBeDefined()
      if (task.status === "blocked")
        expect(task.blockReasons.length).toBeGreaterThan(0)
      expect(task.startDate <= task.endDate).toBe(true)
    }
    for (const asset of Object.values(data.assets))
      for (const link of asset.links) {
        const targets = {
          project: { [data.project.id]: data.project },
          epic: data.epics,
          story: data.stories,
          task: data.tasks,
          sprint: data.sprints,
        }
        expect(
          targets[link.targetType][link.targetId],
          asset.name,
        ).toBeDefined()
      }
    for (const dep of Object.values(data.dependencies)) {
      expect(data.tasks[dep.sourceTaskId]).toBeDefined()
      expect(
        data.tasks[dep.targetTaskId].blockReasons.some(
          (reason) => reason.dependencyId === dep.id,
        ),
      ).toBe(true)
    }
    for (const risk of Object.values(data.risks))
      expect(
        { story: data.stories, task: data.tasks, sprint: data.sprints }[
          risk.targetType
        ][risk.targetId],
      ).toBeDefined()
  })
  it("keeps one project use case per goal separately from Story UML assets", () => {
    const data = demo(),
      graph = projectUseCaseDiagram(data)
    const cases = graph.nodes.filter((node) => node.kind === "use-case")
    expect(cases.map((node) => node.label).sort()).toEqual(
      Object.values(data.activities)
        .map((goal) => goal.title)
        .sort(),
    )
    expect(new Set(cases.map((node) => node.id)).size).toBe(
      Object.keys(data.activities).length,
    )
    expect(
      data.assets["asset-use-case-planning"].umlData?.nodes.some(
        (node) => node.kind === "use-case",
      ),
    ).toBe(true)
    expect(
      graph.edges.every(
        (edge) =>
          graph.nodes.some((node) => node.id === edge.source) &&
          graph.nodes.some((node) => node.id === edge.target),
      ),
    ).toBe(true)
  })
  it("provides coherent published, blocked active and future Release examples", () => {
    const data = demo(),
      old = releaseSummary(data, "release-base", now),
      current = releaseSummary(data, "release-demo", now)
    expect(old.canPublish).toBe(true)
    expect(old.progress).toBe(100)
    expect(current.canPublish).toBe(false)
    expect(current.gateIncomplete.length).toBeGreaterThan(0)
    expect(current.severe.length).toBeGreaterThan(0)
    expect(current.highRisks.length).toBeGreaterThan(0)
    expect(current.overdue).toHaveLength(0)
    expect(releaseSummary(data, "release-demo", new Date("2026-10-24T12:00:00+08:00")).overdue.length).toBeGreaterThan(0)
    expect(data.sprints.s2.releaseId).toBe(data.sprints.s3.releaseId)
    expect(data.sprints.s4.releaseId).not.toBe(data.sprints.s2.releaseId)
  })
  it("seeds explicit daily records including plateau and scope increase, matching current leaves", () => {
    const data = demo(),
      current = sprintBurndown(data, "s2")
    expect(() =>
      normalizeSprintBurndowns(data.sprintBurndowns, data.sprints),
    ).not.toThrow()
    expect(current.latest).toMatchObject({
      date: "2026-10-15",
      totalHours: sprintWork(data, "s2").totalHours,
      remainingHours: sprintWork(data, "s2").remainingHours,
      itemCount: sprintWork(data, "s2").itemCount,
    })
    expect(Date.parse(current.latest!.capturedAt)).toBeLessThanOrEqual(
      now.getTime(),
    )
    expect(current.delayed).toBe(false)
    expect(current.behind).toBe(false)
    const points = current.snapshots
    expect(
      points.some(
        (point, index) =>
          index && point.remainingHours === points[index - 1].remainingHours,
      ),
    ).toBe(true)
    expect(
      points.some(
        (point, index) =>
          index &&
          point.remainingHours > points[index - 1].remainingHours &&
          point.totalHours > points[index - 1].totalHours,
      ),
    ).toBe(true)
    expect(sprintBurndown(data, "s1").latest?.remainingHours).toBe(0)
    expect(sprintBurndown(data, "s3").snapshots).toHaveLength(0)
    for (const task of Object.values(data.tasks).filter(
      (item) => item.subtaskIds.length,
    )) {
      const currentWork = sprintWork(data, data.stories[task.storyId].sprintId!)
      const altered = structuredClone(data)
      altered.tasks[task.id].estimate += 1000
      expect(sprintWork(altered, data.stories[task.storyId].sprintId!)).toEqual(
        currentWork,
      )
    }
  })
  it("round-trips through the real import and persistence format", () => {
    const data = demo()
    expect(store().importProjectJson(JSON.stringify(data))).toMatchObject({
      ok: true,
    })
    const exported = JSON.parse(store().exportProjectJson())
    for (const field of [
      "stories",
      "tasks",
      "subtasks",
      "releases",
      "sprints",
      "sprintBurndowns",
      "projectUseCase",
      "assets",
    ] as const)
      expect(exported[field]).toEqual(data[field])
    expect(store().importProjectJson(JSON.stringify(exported)).ok).toBe(true)
  })
  it("keeps historic snapshots while progress is updated and applies normal Release guards", () => {
    expect(store().importProjectJson(JSON.stringify(demo())).ok).toBe(true)
    const historical = structuredClone(
      store().sprintBurndowns.s2.days["2026-10-14"],
    )
    expect(store().updateTask("task-us024-3", { progress: 60 }).ok).toBe(true)
    expect(store().sprintBurndowns.s2.days["2026-10-14"]).toEqual(historical)
    expect(
      store().updateRelease("release-demo", { status: "released" }).ok,
    ).toBe(false)
    expect(store().moveStory("discovery", null, "s2").ok).toBe(false)
  })
  it("uses the same staggered October baseline on initialization and reset", () => {
    const initial = demo(), next = createDemoProjectState(new Date("2026-10-20T16:30:00Z"))
    expect(next.sprintBurndowns).toEqual(initial.sprintBurndowns)
    const schedule = (data: typeof initial) => [data.project.startDate, data.project.endDate, ...Object.values(data.stories).flatMap(story => [story.startDate, story.dueDate]), ...Object.values(data.tasks).flatMap(task => [task.startDate, task.endDate])]
    expect(schedule(next)).toEqual(schedule(initial))
    expect(initial.project.startDate).toBe("2026-10-10")
    expect(initial.project.endDate).toBe("2026-10-31")
    expect(new Set(Object.values(initial.tasks).map(task => task.startDate + "/" + task.endDate)).size).toBeGreaterThan(20)
    for (const task of Object.values(initial.tasks)) {
      const story = initial.stories[task.storyId]
      expect(task.startDate >= story.startDate && task.endDate <= story.dueDate).toBe(true)
      for (const id of task.subtaskIds) expect(initial.subtasks[id].startDate >= task.startDate && initial.subtasks[id].endDate <= task.endDate).toBe(true)
    }
    for (const dep of Object.values(initial.dependencies)) expect(initial.tasks[dep.sourceTaskId].endDate < initial.tasks[dep.targetTaskId].startDate).toBe(true)
    store().resetDemoData()
    expect(schedule(store())).toEqual(schedule(initial))
  })
  it("ships readable downloadable inline guides instead of broken placeholder file links", async () => {
    const data = demo()
    for (const id of ["asset-demo-results", "asset-scenario-guide"]) {
      const blob = await getStoredAssetBlob(data.assets[id])
      expect(blob.type).toContain("text/markdown")
      expect(await blob.text()).toBe(data.assets[id].sourceText)
      expect(data.assets[id].sourceText).toContain("\n")
    }
    expect(JSON.stringify(data)).not.toContain("example.local")
  })
})
