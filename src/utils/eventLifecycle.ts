import type { AgentProposal, ProjectDataState, ProjectEventRecord, ProposalPrecondition } from "../types"
import { detectProjectEvents, type DetectedEvent } from "./eventDetection"
import { taskLeaves } from "./workloadAnalysis"

/** 只保存规则实际依赖的字段；标题、备注等无关编辑不会使建议失效。 */
export function eventFingerprint(state: ProjectDataState, event: DetectedEvent, sprintId: string): string {
  const task = state.tasks[event.targetId], story = state.stories[event.targetId], sprint = state.sprints[sprintId]
  const work = (id: string) => {
    const task = state.tasks[id]
    if (!task) return null
    const leaf = (item: typeof task | ProjectDataState["subtasks"][string]) =>
      [item.id, item.assigneeId, item.status === "done", item.estimate, item.progress]
    return [task.id, task.status === "done", state.stories[task.storyId]?.sprintId,
      task.subtaskIds.length ? task.subtaskIds.map(id => state.subtasks[id]).filter(Boolean).map(leaf) : [leaf(task)]]
  }
  const dependencies = Object.values(state.dependencies)
    .filter(dep => event.id.startsWith("cycle:")
      ? [event.targetId, ...event.relatedIds].includes(dep.sourceTaskId) && [event.targetId, ...event.relatedIds].includes(dep.targetTaskId)
      : dep.targetTaskId === event.targetId)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(dep => [dep.id, dep.sourceTaskId, dep.targetTaskId, state.tasks[dep.sourceTaskId]?.status])
  switch (event.kind) {
    case "deadline": return JSON.stringify([task?.status, task?.endDate, task?.progress, task?.assigneeId, work(event.targetId)])
    case "dependency": return JSON.stringify([task?.status === "done", dependencies])
    case "artifact": return JSON.stringify([task?.status, task?.resultSummary?.trim(), task?.submittedAt])
    case "acceptance": return JSON.stringify([story?.deliveryStatus, Object.values(state.acceptanceCriteria).filter(item => item.storyId === event.targetId).sort((a,b) => a.id.localeCompare(b.id)).map(item => [item.id, item.content])])
    case "scope": return JSON.stringify([sprint?.capacity, Object.values(state.stories).filter(story => story.sprintId === sprintId).sort((a,b) => a.id.localeCompare(b.id)).map(story => [story.id, story.storyPoints])])
    case "workload": return JSON.stringify([
      sprint?.startDate, sprint?.endDate, sprint?.status, state.members[event.targetId]?.capacityHours,
      Object.values(state.tasks).filter(task => state.stories[task.storyId]?.sprintId === sprintId && task.status !== "done" && taskLeaves(state, task).some(leaf => leaf.assigneeId === event.targetId))
        .sort((a,b) => a.id.localeCompare(b.id)).map(task => [task.id, taskLeaves(state, task).filter(leaf => leaf.assigneeId === event.targetId).map(leaf => [leaf.id, leaf.status === "done", leaf.estimate, leaf.progress])]),
    ])
  }
}

export function eventCondition(state: ProjectDataState, event: DetectedEvent, sprintId: string): ProposalPrecondition {
  return { targetType: "sprint", targetId: sprintId, field: "eventBasis", expectedValue: {
    eventId: event.id, fingerprint: eventFingerprint(state, event, sprintId),
  } }
}

export function eventConditionError(state: ProjectDataState, condition: ProposalPrecondition, now = new Date()): string | null {
  if (condition.field !== "eventBasis") return null
  const basis = condition.expectedValue as { eventId: string; fingerprint: string }
  const event = detectProjectEvents(state, condition.targetId, now).find(event => event.id === basis.eventId)
  if (!event) return "原问题已消失，请重新分析；本次未执行"
  if (eventFingerprint(state, event, condition.targetId) !== basis.fingerprint)
    return "事件相关依据已变化，请重新分析；本次未执行"
  return null
}

export function matchesEventProposal(proposal: AgentProposal, event: DetectedEvent, state: ProjectDataState) {
  if (proposal.origin !== "event" || proposal.summary !== event.title) return false
  if (!(proposal.targetType === event.targetType && proposal.targetId === event.targetId ||
    proposal.evidence.some(item => item.targetType === event.targetType && item.targetId === event.targetId))) return false
  if (proposal.actions.some(action => action.status === "stale")) return false
  return proposal.actions.every(action => action.preconditions.filter(condition => condition.field === "eventBasis")
    .every(condition => condition.targetId === event.sprintId &&
      (proposal.status === "applied" || (condition.expectedValue as { fingerprint: string }).fingerprint === eventFingerprint(state, event, condition.targetId))))
}

export function reconcileProjectEvents(state: ProjectDataState, now = new Date()): Record<string, ProjectEventRecord> {
  const records = { ...(state.projectEvents ?? {}) }, detected = new Set<string>()
  const time = now.toISOString()
  for (const sprintId of Object.keys(state.sprints)) {
    for (const event of detectProjectEvents(state, sprintId, now)) {
      const key = `${sprintId}:${event.id}`
      detected.add(key)
      const previous = records[key]
      const fingerprint = eventFingerprint(state, event, sprintId)
      const proposal = Object.values(state.proposals).sort((a,b) => b.createdAt.localeCompare(a.createdAt))
        .find(proposal => matchesEventProposal(proposal, event, state))
      const status = previous?.status === "ignored" || proposal?.status === "rejected" ? "ignored"
        : proposal ? "suggested" : !previous || previous.status === "resolved" || previous.fingerprint !== fingerprint ? "new" : "pending"
      const next: ProjectEventRecord = {
        id: key, sprintId, event, fingerprint, status, proposalId: proposal?.id ?? null,
        firstSeenAt: previous?.firstSeenAt ?? time, updatedAt: previous?.updatedAt ?? time,
      }
      if (!previous || JSON.stringify({ ...previous, updatedAt: "" }) !== JSON.stringify({ ...next, updatedAt: "" })) {
        records[key] = { ...next, updatedAt: time }
      }
    }
  }
  for (const [key, record] of Object.entries(records)) {
    if (!detected.has(key) && record.status !== "resolved" && record.status !== "ignored")
      records[key] = { ...record, status: "resolved", updatedAt: time }
  }
  return Object.keys(records).length === Object.keys(state.projectEvents ?? {}).length &&
    Object.keys(records).every(key => records[key] === state.projectEvents?.[key]) ? state.projectEvents : records
}
