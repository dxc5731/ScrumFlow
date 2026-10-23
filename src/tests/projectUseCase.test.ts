import { beforeEach, describe, expect, it } from "vitest"
import {
  resetProjectStoreForTests,
  useProjectStore,
} from "../store/projectStore"
import {
  goalUseCaseId,
  normalizeProjectUseCase,
  projectUseCaseDiagram,
} from "../utils/projectUseCase"
const store = () => useProjectStore.getState()
const cases = () =>
  projectUseCaseDiagram(store()).nodes.filter(
    (node) => node.kind === "use-case",
  )

describe("project use cases are the same objects as Story Map goals", () => {
  beforeEach(() => resetProjectStoreForTests())
  it("projects exactly one case per goal using stable ids and shared titles", () => {
    const goals = Object.values(store().activities).sort(
      (a, b) => a.order - b.order,
    )
    expect(cases().map((node) => [node.id, node.label])).toEqual(
      goals.map((goal) => [goalUseCaseId(goal.id), goal.title]),
    )
    expect(store().projectUseCase).not.toHaveProperty("nodes")
    expect(
      store().projectUseCase.actors.every((node) => node.kind === "actor"),
    ).toBe(true)
    expect(Object.keys(store().projectUseCase.goalPositions).sort()).toEqual(
      goals.map((goal) => goal.id).sort(),
    )
  })
  it("updates cases immediately when goals are created, renamed and reordered", () => {
    const goal = store().createActivity({
      title: "交付可靠体验",
      domain: "quality",
    })
    const position = store().projectUseCase.goalPositions[goal.id]
    expect(
      cases().filter((node) => node.id === goalUseCaseId(goal.id)),
    ).toHaveLength(1)
    expect(
      store().updateActivity(goal.id, { title: "交付可验收的体验" }).ok,
    ).toBe(true)
    expect(
      cases().find((node) => node.id === goalUseCaseId(goal.id))?.label,
    ).toBe("交付可验收的体验")
    store().moveActivity(goal.id, 0)
    expect(cases()[0].id).toBe(goalUseCaseId(goal.id))
    expect(store().projectUseCase.goalPositions[goal.id]).toEqual(position)
  })
  it("saves case positions, actors and relationships without changing goals or assets", () => {
    const goals = structuredClone(store().activities),
      assets = structuredClone(store().assets)
    expect(store().addProjectUseCaseActor("开发成员").ok).toBe(true)
    const diagram = projectUseCaseDiagram(store()),
      target = diagram.nodes.find((node) => node.kind === "use-case")!
    const actor = diagram.nodes.find(
      (node) => node.kind === "actor" && node.label === "开发成员",
    )!
    const next = {
      ...diagram,
      nodes: diagram.nodes.map((node) =>
        node.id === target.id ? { ...node, x: 820, y: 333 } : node,
      ),
      edges: [
        ...diagram.edges,
        {
          id: "custom-link",
          source: actor.id,
          target: target.id,
          relation: "association" as const,
          label: "参与",
          order: 99,
          sourceHandle: "right" as const,
          targetHandle: "left" as const,
        },
      ],
    }
    expect(store().updateProjectUseCase(next).ok).toBe(true)
    expect(
      projectUseCaseDiagram(store()).nodes.find(
        (node) => node.id === target.id,
      ),
    ).toMatchObject({ x: 820, y: 333 })
    expect(store().projectUseCase.edges.at(-1)).toMatchObject({
      sourceHandle: "right",
      targetHandle: "left",
    })
    expect(store().activities).toEqual(goals)
    expect(store().assets).toEqual(assets)
    expect(store().arrangeProjectUseCase().ok).toBe(true)
    expect(
      store().projectUseCase.actors.some((node) => node.label === "开发成员"),
    ).toBe(true)
    expect(
      store().projectUseCase.edges.some((edge) => edge.id === "custom-link"),
    ).toBe(true)
  })
  it("does not allow canvas edits to detach, rename, duplicate or convert goal cases", () => {
    const diagram = projectUseCaseDiagram(store()),
      node = diagram.nodes.find((node) => node.kind === "use-case")!
    const before = store().exportProjectJson()
    for (const nodes of [
      diagram.nodes.filter((item) => item.id !== node.id),
      [...diagram.nodes, node],
      diagram.nodes.map((item) =>
        item.id === node.id ? { ...item, label: "不通过目标编辑的改名" } : item,
      ),
      diagram.nodes.map((item) =>
        item.id === node.id ? { ...item, kind: "actor" as const } : item,
      ),
    ]) {
      expect(store().updateProjectUseCase({ ...diagram, nodes }).ok).toBe(false)
      expect(store().exportProjectJson()).toBe(before)
    }
  })
  it("allows actor rename and deletion while keeping every goal case", () => {
    const diagram = projectUseCaseDiagram(store()),
      actor = diagram.nodes.find((node) => node.kind === "actor")!
    expect(
      store().updateProjectUseCase({
        ...diagram,
        nodes: diagram.nodes.map((node) =>
          node.id === actor.id ? { ...node, label: "产品负责人" } : node,
        ),
      }).ok,
    ).toBe(true)
    const count = cases().length,
      next = projectUseCaseDiagram(store())
    expect(
      store().updateProjectUseCase({
        ...next,
        nodes: next.nodes.filter((node) => node.id !== actor.id),
        edges: next.edges.filter(
          (edge) => edge.source !== actor.id && edge.target !== actor.id,
        ),
      }).ok,
    ).toBe(true)
    expect(cases()).toHaveLength(count)
    expect(store().projectUseCase.actors).toHaveLength(0)
  })
  it("deletes the same goal subtree and cleans diagram positions and incident edges", () => {
    const goal = store().createActivity({ title: "可删除范围" }),
      epic = store().createEpic(goal.id, { title: "下级史诗" })
    const story = store().createStory({
      title: "下级故事",
      epicId: epic.id,
      source: "manual",
    })
    const task = store().createTask(story.id, { title: "下级任务" })
    store().addSubtask(task.id, "下级步骤")
    const diagram = projectUseCaseDiagram(store()),
      actor = diagram.nodes.find((node) => node.kind === "actor")!
    store().updateProjectUseCase({
      ...diagram,
      edges: [
        ...diagram.edges,
        {
          id: "delete-link",
          source: actor.id,
          target: goalUseCaseId(goal.id),
          relation: "association",
          label: "",
          order: 99,
        },
      ],
    })
    expect(store().deleteActivity(goal.id).ok).toBe(true)
    expect(store().activities[goal.id]).toBeUndefined()
    expect(store().epics[epic.id]).toBeUndefined()
    expect(store().stories[story.id]).toBeUndefined()
    expect(store().tasks[task.id]).toBeUndefined()
    expect(store().projectUseCase.goalPositions[goal.id]).toBeUndefined()
    expect(
      store().projectUseCase.edges.some(
        (edge) =>
          edge.source === goalUseCaseId(goal.id) ||
          edge.target === goalUseCaseId(goal.id),
      ),
    ).toBe(false)
    expect(cases().some((node) => node.id === goalUseCaseId(goal.id))).toBe(
      false,
    )
  })
  it("preserves both the goal and diagram when closed Sprint content prevents deletion", () => {
    const story = Object.values(store().stories).find(
      (story) => story.sprintId && story.epicId,
    )!
    const goalId = store().epics[story.epicId!].goalId
    useProjectStore.setState({
      sprints: {
        ...store().sprints,
        [story.sprintId!]: {
          ...store().sprints[story.sprintId!],
          status: "closed",
        },
      },
    })
    const before = store().exportProjectJson()
    expect(store().deleteActivity(goalId).ok).toBe(false)
    expect(store().exportProjectJson()).toBe(before)
  })
  it("keeps same-name goals distinct rather than matching cases by label", () => {
    const a = store().createActivity({ title: "共同名称" }),
      b = store().createActivity({ title: "共同名称" })
    expect(cases().filter((node) => node.label === "共同名称")).toHaveLength(2)
    store().updateActivity(a.id, { title: "仅修改其中一个" })
    expect(cases().find((node) => node.id === goalUseCaseId(b.id))?.label).toBe(
      "共同名称",
    )
  })
  it("migrates legacy projects without changing Stories, assets or goal names", () => {
    const data = JSON.parse(store().exportProjectJson())
    data.schemaVersion = 19
    delete data.projectUseCase
    const expected = {
      activities: data.activities,
      stories: data.stories,
      assets: data.assets,
    }
    expect(store().importProjectJson(JSON.stringify(data)).ok).toBe(true)
    expect(store().activities).toEqual(expected.activities)
    expect(Object.keys(store().stories)).toEqual(Object.keys(expected.stories))
    expect(store().assets).toEqual(expected.assets)
    expect(cases()).toHaveLength(Object.keys(expected.activities).length)
    const snapshot = structuredClone(store().projectUseCase)
    expect(store().importProjectJson(store().exportProjectJson()).ok).toBe(true)
    expect(store().projectUseCase).toEqual(snapshot)
  })
  it("cleans stale deleted goal links on import, but rejects malformed layout atomically", () => {
    const data = JSON.parse(store().exportProjectJson()),
      id = Object.keys(data.activities)[0]
    delete data.activities[id]
    expect(store().importProjectJson(JSON.stringify(data)).ok).toBe(true)
    expect(store().projectUseCase.goalPositions[id]).toBeUndefined()
    expect(
      projectUseCaseDiagram(store()).edges.some(
        (edge) => edge.target === goalUseCaseId(id),
      ),
    ).toBe(false)
    const invalid = JSON.parse(store().exportProjectJson())
    invalid.projectUseCase.actors[0].kind = "use-case"
    const before = store().exportProjectJson()
    expect(store().importProjectJson(JSON.stringify(invalid)).ok).toBe(false)
    expect(store().exportProjectJson()).toBe(before)
  })
  it("does not connect ordinary UML asset edits to project goals", () => {
    const asset = Object.values(store().assets).find(
      (asset) => asset.umlData?.kind === "use-case",
    )!
    const before = projectUseCaseDiagram(store())
    expect(
      store().updateAsset(asset.id, {
        name: "独立 Story 用例图",
        umlData: {
          ...asset.umlData!,
          nodes: asset.umlData!.nodes.map((node) => ({
            ...node,
            label: "独立资产名称",
          })),
        },
      }).ok,
    ).toBe(true)
    expect(projectUseCaseDiagram(store())).toEqual(before)
  })
  it("rejects invalid node positions and dangling edge writes", () => {
    const diagram = projectUseCaseDiagram(store()),
      before = store().exportProjectJson()
    expect(
      store().updateProjectUseCase({
        ...diagram,
        nodes: diagram.nodes.map((node, index) =>
          index === 0 ? { ...node, x: Number.NaN } : node,
        ),
      }).ok,
    ).toBe(false)
    expect(
      store().updateProjectUseCase({
        ...diagram,
        edges: [
          {
            id: "invalid",
            source: "missing",
            target: diagram.nodes[0].id,
            relation: "association",
            label: "",
            order: 0,
          },
        ],
      }).ok,
    ).toBe(false)
    expect(store().exportProjectJson()).toBe(before)
    expect(normalizeProjectUseCase({}, undefined).goalPositions).toEqual({})
  })
})
