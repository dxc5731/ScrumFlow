import { addBusinessDays, differenceInBusinessDays, format, parseISO } from "date-fns"
import type { ProjectDataState } from "../types"

export type DependencyBaseline = Pick<ProjectDataState, "tasks" | "dependencies">
export function validateProjectDependencyGraph(baseline: DependencyBaseline): string[] {
  const errors: string[] = [], visited = new Set<string>(), visiting = new Set<string>()
  const graph = projectDependencyGraph(baseline)
  for (const edge of Object.values(baseline.dependencies)) if (!baseline.tasks[edge.sourceTaskId] || !baseline.tasks[edge.targetTaskId]) errors.push('依赖端点不存在')
  const visit = (id: string) => {
    if (visiting.has(id)) { errors.push('项目依赖图存在循环'); return }
    if (visited.has(id)) return
    visiting.add(id)
    for (const edge of graph.getSuccessors(id)) visit(edge.targetTaskId)
    visiting.delete(id); visited.add(id)
  }
  for (const id of Object.keys(baseline.tasks)) visit(id)
  return [...new Set(errors)]
}
export function projectDependencyGraph(baseline: DependencyBaseline) {
  const edges = Object.values(baseline.dependencies)
  const getPredecessors = (id: string) => edges.filter(edge => edge.targetTaskId === id)
  const getSuccessors = (id: string) => edges.filter(edge => edge.sourceTaskId === id)
  const traverse = (id: string, backwards: boolean) => {
    const visited = new Set([id]), queue = [id], paths: string[][] = []
    const pathById = new Map([[id,[id]]])
    while (queue.length) {
      const current = queue.shift()!
      for (const edge of backwards ? getPredecessors(current) : getSuccessors(current)) {
        const next = backwards ? edge.sourceTaskId : edge.targetTaskId
        if (visited.has(next)) continue
        const path = [...pathById.get(current)!,next]; paths.push(path)
        pathById.set(next,path); visited.add(next); queue.push(next)
      }
    }
    return { taskIds: [...visited].filter(key => key !== id), paths }
  }
  return { getPredecessors, getSuccessors, traversePredecessors: (id:string) => traverse(id,true),
    traverseSuccessors: (id:string) => traverse(id,false) }
}

export function simulateDelay(taskId: string, workingDays: number, baseline: DependencyBaseline) {
  if (!baseline.tasks[taskId] || !Number.isInteger(workingDays) || workingDays < 0) throw new Error("延期模拟需要有效任务和非负工作日")
  const errors = validateProjectDependencyGraph(baseline)
  if (errors.length) throw new Error(errors.join('；'))
  const graph = projectDependencyGraph(baseline), traversal = graph.traverseSuccessors(taskId)
  const affected = new Set([taskId,...traversal.taskIds]), computed = new Map<string,{startDate:string;endDate:string}>(), visiting = new Set<string>()
  const date = (value:Date) => format(value,"yyyy-MM-dd")
  const calculate = (id:string): {startDate:string;endDate:string} => {
    const old = baseline.tasks[id]
    if (!old) throw new Error(`依赖任务 ${id} 不存在`)
    if (computed.has(id)) return computed.get(id)!
    if (visiting.has(id)) throw new Error("依赖图存在循环，无法模拟延期")
    visiting.add(id)
    let start = old.startDate, end = old.endDate
    if (id === taskId) {
      start = date(addBusinessDays(parseISO(start),workingDays)); end = date(addBusinessDays(parseISO(end),workingDays))
    } else if (affected.has(id) && old.status !== "done") {
      for (const edge of graph.getPredecessors(id)) {
        const upstream = affected.has(edge.sourceTaskId) ? calculate(edge.sourceTaskId) : baseline.tasks[edge.sourceTaskId]
        if (!upstream) throw new Error("前置任务不存在")
        const earliest = date(addBusinessDays(parseISO(upstream.endDate),1))
        if (earliest > start) start = earliest
      }
      const shift = Math.max(0,differenceInBusinessDays(parseISO(start),parseISO(old.startDate)))
      end = date(addBusinessDays(parseISO(old.endDate),shift))
    }
    visiting.delete(id); const result = {startDate:start,endDate:end}; computed.set(id,result); return result
  }
  const affectedTasks = [...affected].map(id => {
    const task = baseline.tasks[id], projected = calculate(id)
    return { taskId:id, title:task.title, storyId:task.storyId, baselineDate:task.endDate, projectedDate:projected.endDate,
      baselineStart:task.startDate, projectedStart:projected.startDate,
      delta: differenceInBusinessDays(parseISO(projected.endDate),parseISO(task.endDate)),
      paths: traversal.paths.filter(path => path.at(-1)===id) }
  })
  return { kind:"what_if" as const, taskId, workingDays, baselineDate:baseline.tasks[taskId].endDate,
    affectedTasks, dependencyPaths:traversal.paths, writesStore:false }
}

export function validateDependencyRemoval(baseline: DependencyBaseline, taskId: string, direction:"incoming"|"outgoing", edgeId?:string) {
  const graph = projectDependencyGraph(baseline)
  const edges = direction === "incoming" ? graph.getPredecessors(taskId) : graph.getSuccessors(taskId)
  const selected = edgeId ? edges.find(edge => edge.id===edgeId) : edges.length===1 ? edges[0] : undefined
  return { valid:Boolean(selected), edge:selected??null, candidates:edges,
    reason:!edges.length ? `没有该${direction==="incoming"?"入边/前置":"出边/后继"}依赖可解除` : !selected ? "请指定现有依赖edgeId" : "仅模拟解除指定依赖，正式数据未变" }
}
