import {
  differenceInCalendarDays,
  parseISO,
} from "date-fns"
import type { DependencyEntity, ProjectDataState } from "../types"
import { buildWorkloadSnapshot } from "./workloadAnalysis"
import {
  selectCriticalPathTaskIds,
  selectSprintStories,
  selectSprintTasks,
  selectStoryCriteria,
} from "../store/selectors"

export type EventKind =
  | "deadline"
  | "dependency"
  | "workload"
  | "scope"
  | "artifact"
  | "acceptance"
export type EventSeverity = "high" | "medium" | "low"

export interface DetectedEvent {
  sprintId?: string
  id: string
  kind: EventKind
  severity: EventSeverity
  rule: string
  title: string
  summary: string
  evidence: string[]
  targetType: "task" | "story" | "sprint" | "member"
  targetId: string
  relatedIds: string[]
  suggestedAction: string
}

const severityRank: Record<EventSeverity, number> = { high: 3, medium: 2, low: 1 }

function eventId(kind: EventKind, targetId: string) {
  return `${kind}:${targetId}`
}

function taskTitle(state: ProjectDataState, id: string) {
  return state.tasks[id]?.title ?? state.subtasks[id]?.title ?? id
}


/** 在 Sprint 任务集合内查找 FS 依赖环。 */
function findDependencyCycles(
  dependencies: DependencyEntity[],
  taskIds: Set<string>,
): string[][] {
  const adjacency = new Map<string, string[]>()
  dependencies.forEach((dependency) => {
    if (!taskIds.has(dependency.sourceTaskId) || !taskIds.has(dependency.targetTaskId)) return
    const list = adjacency.get(dependency.sourceTaskId) ?? []
    list.push(dependency.targetTaskId)
    adjacency.set(dependency.sourceTaskId, list)
  })

  const state = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  const cycles: string[][] = []
  const seen = new Set<string>()

  const visit = (node: string) => {
    state.set(node, 1)
    stack.push(node)
    for (const next of adjacency.get(node) ?? []) {
      const status = state.get(next) ?? 0
      if (status === 1) {
        const index = stack.indexOf(next)
        const cycle = stack.slice(index)
        const key = [...cycle].sort().join(">")
        if (!seen.has(key)) {
          seen.add(key)
          cycles.push(cycle)
        }
      } else if (status === 0) {
        visit(next)
      }
    }
    stack.pop()
    state.set(node, 2)
  }

  ;[...taskIds].forEach((id) => {
    if ((state.get(id) ?? 0) === 0) visit(id)
  })
  return cycles
}

/** 计算某个任务被阻塞后会连带影响到的后续任务（仅限当前 Sprint）。 */
function downstreamTasks(
  startId: string,
  successors: Map<string, string[]>,
  allowed: Set<string>,
): string[] {
  const seen = new Set<string>()
  const stack = [startId]
  while (stack.length) {
    const current = stack.pop()!
    for (const next of successors.get(current) ?? []) {
      if (seen.has(next) || !allowed.has(next)) continue
      seen.add(next)
      stack.push(next)
    }
  }
  return [...seen]
}

export function detectProjectEvents(
  state: ProjectDataState,
  sprintId = state.workspace.selectedSprintId,
  referenceDate = new Date(),
): DetectedEvent[] {
  const tasks = selectSprintTasks(state, sprintId)
  const stories = selectSprintStories(state, sprintId)
  const sprintTaskIds = new Set(tasks.map((task) => task.id))
  const criticalPath = selectCriticalPathTaskIds(state)
  const events: DetectedEvent[] = []
  const workload = buildWorkloadSnapshot(state, sprintId, referenceDate)

  const successors = new Map<string, string[]>()
  Object.values(state.dependencies).forEach((dependency) => {
    successors.set(dependency.sourceTaskId, [
      ...(successors.get(dependency.sourceTaskId) ?? []),
      dependency.targetTaskId,
    ])
  })

  // 规则 1：截止日期与进度，关键路径上的任务自动升为高风险
  tasks
    .filter((task) => task.status !== "done")
    .forEach((task) => {
      const days = differenceInCalendarDays(parseISO(task.endDate), parseISO(workload.currentDate))
      const remainingHours = workload.tasks[task.id].remainingHours
      if (days < 0 || (days <= 1 && task.progress < 80)) {
        const overdue = days < 0
        const onCriticalPath = criticalPath.has(task.id)
        events.push({
          id: eventId("deadline", task.id),
          kind: "deadline",
          severity: overdue || onCriticalPath ? "high" : "medium",
          rule: onCriticalPath ? "关键路径任务的截止日期对比进度" : "截止日期对比当前进度",
          title: overdue ? `${task.id} 已逾期` : `${task.id} 即将到期`,
          summary: `${taskTitle(state, task.id)} ${overdue ? `已逾期 ${Math.abs(days)} 天` : `剩余 ${Math.max(days, 0)} 天`}，当前进度 ${task.progress}%。`,
          evidence: [
            `截止日期：${task.endDate}`,
            `当前进度：${task.progress}%`,
            `剩余工时：约 ${remainingHours}h / 预估 ${task.estimate}h`,
            ...(onCriticalPath ? ["位于关键路径：是，会直接影响交付日期"] : []),
          ],
          targetType: "task",
          targetId: task.id,
          relatedIds: [task.storyId],
          suggestedAction: overdue
            ? "确认是否拆分剩余工作或调整排期"
            : "安排剩余工作并关注是否会影响 Story 验收",
        })
      }
    })

  // 规则 2：依赖阻塞、跨 Sprint 依赖、阻塞传播链与循环依赖
  const dependenciesByTarget = new Map<string, DependencyEntity[]>()
  Object.values(state.dependencies).forEach((dependency) => {
    if (!sprintTaskIds.has(dependency.targetTaskId)) return
    dependenciesByTarget.set(dependency.targetTaskId, [
      ...(dependenciesByTarget.get(dependency.targetTaskId) ?? []),
      dependency,
    ])
  })

  dependenciesByTarget.forEach((dependencies, targetId) => {
    const target = state.tasks[targetId]
    if (!target || target.status === "done") return

    const blocking = dependencies
      .map((dependency) => ({ dependency, source: state.tasks[dependency.sourceTaskId] }))
      .filter((item) => item.source && item.source.status !== "done")
    if (!blocking.length) return

    const crossSprint = blocking.some((item) => !sprintTaskIds.has(item.source!.id))
    const hasBlockedPredecessor = blocking.some((item) => item.source!.status === "blocked")
    const affected = downstreamTasks(targetId, successors, sprintTaskIds)
    const onCriticalPath = criticalPath.has(targetId) || affected.some((id) => criticalPath.has(id))

    events.push({
      id: eventId("dependency", targetId),
      kind: "dependency",
      severity: hasBlockedPredecessor || crossSprint || onCriticalPath ? "high" : "medium",
      rule: crossSprint ? "跨 Sprint 前置任务未完成" : "前置任务未完成",
      title: crossSprint
        ? `${targetId} 依赖其他 Sprint 的任务`
        : `${targetId} 可能被前置任务阻塞`,
      summary: `${target.title} 依赖 ${blocking.map((item) => item.source!.title).join("、")}，前置任务尚未完成。`,
      evidence: [
        ...blocking.map((item) => `前置任务：${item.source!.id} ${item.source!.title}（${item.source!.status}）`),
        crossSprint ? "前置任务位于其他 Sprint" : "前置任务位于当前 Sprint",
        ...(affected.length
          ? [`连带影响后续任务：${affected.map((id) => `${id} ${taskTitle(state, id)}`).join("、")}`]
          : []),
        ...(onCriticalPath ? ["位于关键路径：是，会直接影响交付日期"] : []),
      ],
      targetType: "task",
      targetId,
      relatedIds: [target.storyId, ...blocking.map((item) => item.source!.id), ...affected],
      suggestedAction: affected.length
        ? "联系前置任务负责人，并评估连带任务的排期影响"
        : "联系前置任务负责人，或提交排期/依赖调整建议",
    })
  })

  findDependencyCycles(Object.values(state.dependencies), sprintTaskIds).forEach((cycle) => {
    events.push({
      id: `cycle:${[...cycle].sort().join(">")}`,
      kind: "dependency",
      severity: "high",
      rule: "FS 依赖出现环路",
      title: `检测到循环依赖（${cycle.length} 个任务）`,
      summary: `依赖链形成闭环，任意任务都无法开始：${cycle.join(" → ")} → ${cycle[0]}。`,
      evidence: cycle.map((id) => `环节：${id} ${taskTitle(state, id)}`),
      targetType: "task",
      targetId: cycle[0],
      relatedIds: cycle.slice(1),
      suggestedAction: "移除其中一条依赖或调整前后置关系，避免任务永久阻塞",
    })
  })

  // 规则 3：成员剩余工时超过周期可用容量
  Object.entries(workload.members).forEach(([memberId, value]) => {
    const entry = { hours: value.currentSprintWorkload, taskIds: tasks.filter(task => workload.tasks[task.id].byMember[memberId] > 0).map(task => task.id) }
    const member = state.members[memberId]
    const available = value.remainingTimeCapacity
    if (entry.hours <= available) return
    const criticalTaskIds = entry.taskIds.filter((id) => criticalPath.has(id))
    events.push({
      id: eventId("workload", memberId),
      kind: "workload",
      severity: entry.hours > available * 1.2 ? "high" : "medium",
      rule: "剩余工时对比周期可用容量",
      title: `${member?.name ?? memberId} 负载异常`,
      summary: `本周期剩余 ${entry.hours}h，超过可用容量 ${available}h。`,
      evidence: [
        `剩余工时：${entry.hours}h`,
        `计算日期：${workload.currentDate}（Asia/Shanghai）`,
        `整轮规划容量：${value.planningCapacity}h；剩余工作日：${workload.remainingWorkingDays}`,
        `周期可用容量：${available}h`,
        `超出：${entry.hours - available}h`,
        `涉及任务：${entry.taskIds.join("、")}`,
        ...(criticalTaskIds.length
          ? [`其中关键路径任务：${criticalTaskIds.join("、")}`]
          : []),
      ],
      targetType: "member",
      targetId: memberId,
      relatedIds: entry.taskIds,
      suggestedAction: "评估转派、拆分任务或调整本轮 Sprint 范围",
    })
  })

  // 规则 4：Sprint 计划 Story Point 超出容量
  const sprint = state.sprints[sprintId]
  if (sprint && sprint.capacity > 0) {
    const plannedPoints = stories.reduce((sum, story) => sum + story.storyPoints, 0)
    if (plannedPoints > sprint.capacity) {
      events.push({
        id: eventId("scope", sprintId),
        kind: "scope",
        severity: plannedPoints > sprint.capacity * 1.2 ? "high" : "medium",
        rule: "计划 Story Point 对比 Sprint 容量",
        title: `${sprint.name} 计划范围超出容量`,
        summary: `已规划 ${plannedPoints} pt，超过容量 ${sprint.capacity} pt。`,
        evidence: [
          `计划 Story Point：${plannedPoints} pt`,
          `Sprint 容量：${sprint.capacity} pt`,
          `超出：${plannedPoints - sprint.capacity} pt`,
        ],
        targetType: "sprint",
        targetId: sprintId,
        relatedIds: stories.map((story) => story.id),
        suggestedAction: "移出低价值 Story 或拆分到下一个 Sprint",
      })
    }
  }

  // 规则 5：执行项已进入评审或完成，但缺少成果提交
  tasks
    .filter((task) => task.status === "review" || task.status === "done")
    .forEach((task) => {
      const hasResult = Boolean(task.resultSummary?.trim()) || Boolean(task.submittedAt)
      if (hasResult) return
      events.push({
        id: eventId("artifact", task.id),
        kind: "artifact",
        severity: task.status === "done" ? "high" : "medium",
        rule: "执行状态与成果提交记录对比",
        title: `${task.id} 缺少成果提交`,
        summary: `${task.title} 状态为“${task.status}”，但没有成果说明或提交时间。`,
        evidence: [
          `状态：${task.status}`,
          `成果说明：${task.resultSummary?.trim() ? "已填写" : "为空"}`,
          `提交时间：${task.submittedAt ?? "无"}`,
        ],
        targetType: "task",
        targetId: task.id,
        relatedIds: [task.storyId],
        suggestedAction: "提醒负责人补充成果说明与链接，或退回继续执行",
      })
    })

  // 规则 6：Sprint 内 Story 缺少验收标准，无法进入验收
  stories.forEach((story) => {
    const criteria = selectStoryCriteria(state, story.id)
    if (criteria.length) return
    events.push({
      id: eventId("acceptance", story.id),
      kind: "acceptance",
      severity: "medium",
      rule: "验收标准数量检查",
      title: `${story.id} 缺少验收标准`,
      summary: `${story.title} 尚未定义验收标准，无法进入成果验收。`,
      evidence: [
        `Story：${story.id} ${story.title}`,
        `验收标准数量：${criteria.length}`,
      ],
      targetType: "story",
      targetId: story.id,
      relatedIds: [],
      suggestedAction: "由 PO 补充验收标准，否则该 Story 无法通过验收",
    })
  })

  return events.sort((a, b) => severityRank[b.severity] - severityRank[a.severity]).map(event => ({ ...event, sprintId }))
}
