import type {
  ProjectDataState,
  ProjectUseCaseData,
  UmlDiagramData,
  UmlNodeEntity,
  UserActivityEntity,
} from "../types"

export const goalUseCaseId = (goalId: string) => "goal:" + goalId
export const useCaseGoalId = (nodeId: string) =>
  nodeId.startsWith("goal:") ? nodeId.slice(5) : null
const goalsByOrder = (goals: Record<string, UserActivityEntity>) =>
  Object.values(goals).sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  )
const positionFor = (index: number) => ({
  x: 360 + Math.floor(index / 6) * 340,
  y: 48 + (index % 6) * 130,
})
const validPosition = (position: {
  x: number
  y: number
}) =>
  position && Number.isFinite(position.x) && Number.isFinite(position.y)
const relations = new Set([
  "association",
  "dependency",
  "include",
  "extend",
  "generalization",
])

/** The persisted diagram owns presentation only. Use cases and their names are always projected from goals. */
export function normalizeProjectUseCase(
  goals: Record<string, UserActivityEntity>,
  data?: ProjectUseCaseData,
): ProjectUseCaseData {
  const ordered = goalsByOrder(goals)
  if (data === undefined)
    return {
      version: 1,
      actors: [
        {
          id: "actor:po",
          kind: "actor",
          label: "PO",
          x: 64,
          y: Math.max(80, Math.min(5, ordered.length - 1) * 65 + 48),
          details: [],
        },
      ],
      goalPositions: Object.fromEntries(
        ordered.map((goal, index) => [goal.id, positionFor(index)]),
      ),
      edges: ordered.map((goal, index) => ({
        id: "project-link:" + goal.id,
        source: "actor:po",
        target: goalUseCaseId(goal.id),
        relation: "association",
        label: "",
        order: index,
      })),
    }
  if (
    !data ||
    data.version !== 1 ||
    !Array.isArray(data.actors) ||
    !Array.isArray(data.edges) ||
    !data.goalPositions ||
    typeof data.goalPositions !== "object" ||
    Array.isArray(data.goalPositions)
  )
    throw new Error("项目用例图格式无效")
  const ids = new Set<string>()
  for (const actor of data.actors) {
    if (
      !actor ||
      typeof actor.id !== "string" ||
      !actor.id ||
      actor.id.startsWith("goal:") ||
      ids.has(actor.id) ||
      actor.kind !== "actor" ||
      typeof actor.label !== "string" ||
      !actor.label.trim() ||
      !validPosition(actor) ||
      !Array.isArray(actor.details) ||
      actor.details.some((item) => typeof item !== "string")
    )
      throw new Error("项目用例图的参与者无效")
    ids.add(actor.id)
  }
  const goalPositions: ProjectUseCaseData["goalPositions"] = {}
  for (const goal of ordered) {
    if (data.goalPositions[goal.id] !== undefined) {
      if (!validPosition(data.goalPositions[goal.id]))
        throw new Error("项目用例位置无效：" + goal.title)
      goalPositions[goal.id] = {
        x: data.goalPositions[goal.id].x,
        y: data.goalPositions[goal.id].y,
      }
    }
    ids.add(goalUseCaseId(goal.id))
  }
  for (const goal of ordered.filter((goal) => !goalPositions[goal.id])) {
    let index = 0,
      position = positionFor(index)
    while (
      Object.values(goalPositions).some(
        (point) =>
          Math.abs(point.x - position.x) < 220 &&
          Math.abs(point.y - position.y) < 90,
      )
    )
      position = positionFor(++index)
    goalPositions[goal.id] = position
  }
  const edgeIds = new Set<string>()
  const edges = data.edges.filter((edge) => {
    if (
      !edge ||
      typeof edge.id !== "string" ||
      !edge.id ||
      edgeIds.has(edge.id) ||
      typeof edge.source !== "string" ||
      typeof edge.target !== "string" ||
      typeof edge.label !== "string" ||
      !Number.isFinite(edge.order) ||
      !relations.has(edge.relation) ||
      [edge.sourceHandle, edge.targetHandle].some(
        (handle) =>
          handle !== undefined &&
          !["left", "right", "top", "bottom"].includes(handle),
      )
    )
      throw new Error("项目用例图的连线无效")
    edgeIds.add(edge.id)
    return (
      ids.has(edge.source) &&
      ids.has(edge.target) &&
      edge.source !== edge.target
    )
  })
  if (
    JSON.stringify(goalPositions) === JSON.stringify(data.goalPositions) &&
    edges.length === data.edges.length
  )
    return data
  return { version: 1, actors: data.actors, goalPositions, edges }
}

export function projectUseCaseDiagram(
  state: Pick<ProjectDataState, "activities" | "projectUseCase">,
): UmlDiagramData {
  const data = normalizeProjectUseCase(state.activities, state.projectUseCase)
  return {
    version: 1,
    kind: "use-case",
    sourceFormat: "plantuml",
    nodes: [
      ...data.actors,
      ...goalsByOrder(state.activities).map((goal) => ({
        id: goalUseCaseId(goal.id),
        kind: "use-case" as const,
        label: goal.title,
        ...data.goalPositions[goal.id],
        details: [],
      })),
    ],
    edges: data.edges,
  }
}

/** Accept layout, actors and relations, never a competing set of use cases. */
export function projectUseCaseFromCanvas(
  state: Pick<ProjectDataState, "activities" | "projectUseCase">,
  diagram: UmlDiagramData,
): ProjectUseCaseData {
  if (
    diagram.version !== 1 ||
    diagram.kind !== "use-case" ||
    !Array.isArray(diagram.nodes) ||
    !Array.isArray(diagram.edges)
  )
    throw new Error("请选择项目专属用例图")
  const cases = diagram.nodes.filter((node) => node.kind === "use-case")
  const ids = new Set(diagram.nodes.map((node) => node.id))
  if (
    ids.size !== diagram.nodes.length ||
    diagram.nodes.some((node) => !["actor", "use-case"].includes(node.kind)) ||
    cases.length !== Object.keys(state.activities).length ||
    cases.some((node) => {
      const id = useCaseGoalId(node.id)
      return (
        !id ||
        !state.activities[id] ||
        node.label !== state.activities[id].title
      )
    })
  )
    throw new Error(
      "用例必须与项目目标一一对应，请通过目标编辑操作新增、改名或删除",
    )
  if (
    diagram.edges.some(
      (edge) =>
        !ids.has(edge.source) ||
        !ids.has(edge.target) ||
        edge.source === edge.target,
    )
  )
    throw new Error("连线必须关联图中存在的两个节点")
  return normalizeProjectUseCase(state.activities, {
    version: 1,
    actors: diagram.nodes.filter(
      (node): node is UmlNodeEntity => node.kind === "actor",
    ),
    goalPositions: Object.fromEntries(
      cases.map((node) => [useCaseGoalId(node.id)!, { x: node.x, y: node.y }]),
    ),
    edges: diagram.edges,
  })
}

export function goalDeletionImpact(
  state: Pick<ProjectDataState, "epics" | "stories" | "tasks" | "subtasks">,
  goalId: string,
) {
  const epics = new Set(
    Object.values(state.epics)
      .filter((epic) => epic.goalId === goalId)
      .map((epic) => epic.id),
  )
  const stories = new Set(
    Object.values(state.stories)
      .filter((story) => story.epicId && epics.has(story.epicId))
      .map((story) => story.id),
  )
  const tasks = new Set(
    Object.values(state.tasks)
      .filter((task) => stories.has(task.storyId))
      .map((task) => task.id),
  )
  const subtasks = Object.values(state.subtasks).filter((subtask) =>
    tasks.has(subtask.taskId),
  )
  return {
    epics: epics.size,
    stories: stories.size,
    tasks: tasks.size,
    subtasks: subtasks.length,
  }
}
