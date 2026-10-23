import type { ProjectDataState, RiskEntity } from "../types"
export type RiskScope = {
  type: "sprint" | "release"
  id: string
}
export function riskTargetInScope(
  state: ProjectDataState,
  scope: RiskScope,
  type: RiskEntity["targetType"],
  id: string,
) {
  if (type === "sprint")
    return scope.type === "sprint"
      ? id === scope.id
      : state.sprints[id]?.releaseId === scope.id
  const story = state.stories[type === "story" ? id : state.tasks[id]?.storyId]
  return Boolean(
    story &&
      (scope.type === "sprint"
        ? story.sprintId === scope.id
        : story.releaseId === scope.id),
  )
}
export function risksInScope(state: ProjectDataState, scope: RiskScope) {
  return Object.values(state.risks).filter((risk) =>
    riskTargetInScope(state, scope, risk.targetType, risk.targetId),
  )
}
