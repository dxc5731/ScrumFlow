import { businessChangeSummary, describeBusinessChanges } from "./meetingBusinessSummary"
import type { AgentProposal, ProjectDataState, ProposalAction } from "../types"

export interface ExecutionSummary {
  headline: string
  applied: string[]
  reviewedChanges: string[]
  notExecuted: string[]
  discrepancies: string[]
}

export function describeExecutionForChat(summary: ExecutionSummary): string {
  const changes = summary.headline.replace(/^实际执行：/, "").replace(/ · /g, "，")
  const existing = summary.notExecuted.filter(item => item.includes("本次未重复写入")).length
  const rejected = summary.notExecuted.length - existing
  const rejectedDependencies = summary.notExecuted.filter((item) => item.startsWith("一条建议依赖")).length
  const reviewed = summary.reviewedChanges.length
  const rejectedText = rejected === rejectedDependencies ? `${rejected} 条建议依赖` : `${rejected} 项建议`
  return `计划已应用。\n${changes}${existing ? `；${existing} 项复用已有结果，未重复写入` : ""}${rejected ? `；${rejectedText}按你的决定未执行` : ""}${reviewed ? `；审核阶段有 ${reviewed} 项人工调整` : ""}。`
}

function taskName(state: ProjectDataState, id: string): string {
  return state.tasks[id]?.title ?? "任务"
}

function actionDescription(state: ProjectDataState, action: ProposalAction): string {
  const resultId = action.resultTargetId ?? action.targetId
  if (action.actionType === "CREATE_TASK" || action.actionType === "UPDATE_TASK") {
    const task = state.tasks[resultId]
    return task ? `${action.actionType === "CREATE_TASK" ? "新建" : "调整"}任务「${task.title}」，负责人：${state.members[task.assigneeId]?.name ?? "待确认"}，预计 ${task.estimate}h` : "任务记录未找到"
  }
  if (action.actionType === "CREATE_SUBTASK" || action.actionType === "UPDATE_SUBTASK") {
    const subtask = state.subtasks[resultId]
    return subtask ? `${action.actionType === "CREATE_SUBTASK" ? "新建" : "调整"}步骤「${subtask.title}」，负责人：${state.members[subtask.assigneeId]?.name ?? "待确认"}` : "步骤记录未找到"
  }
  if (action.actionType === "ADD_DEPENDENCY") {
    const dependency = state.dependencies[resultId]
    return dependency ? `新增依赖：${taskName(state, dependency.sourceTaskId)} → ${taskName(state, dependency.targetTaskId)}` : "依赖记录未找到"
  }
  if (action.actionType === "CREATE_RISK" || action.actionType === "UPDATE_RISK") {
    const risk = state.risks[resultId]
    return risk ? `${action.actionType === "CREATE_RISK" ? "登记" : "调整"}风险「${risk.title}」` : "风险记录未找到"
  }
  return `调整 Story「${state.stories[resultId]?.title ?? "项目安排"}」`
}

export function buildExecutionSummary(state: ProjectDataState, proposals: AgentProposal[]): ExecutionSummary {
  const applied: ProposalAction[] = []
  const discrepancies: string[] = []
  const reviewedChanges: string[] = []
  const notExecuted: string[] = []
  for (const proposal of proposals) for (const action of proposal.actions) {
    if (action.decision === "rejected") {
      const original = proposal.originalActions.find((item) => item.id === action.id)
      const label = action.actionType === "ADD_DEPENDENCY" ? "一条建议依赖" : String(original?.proposedValue.title ?? action.proposedValue.title ?? "一项建议")
      const created = state.history.find(item => item.proposalId === proposal.id && item.proposalActionId === action.id && item.field === "create")
      const withdrawn = created && state.history.some(item => item.objectType === created.objectType && item.objectId === created.objectId && item.field === "delete")
      notExecuted.push(withdrawn ? `${label}曾写入项目，后经撤回；当前正式项目未保留，创建与撤回记录仍可追溯` : `${label}由用户拒绝，未写入项目`)
      continue
    }
    if (action.status !== "applied") continue
    if (action.executionOutcome === "existing") {
      notExecuted.push(`${String(action.proposedValue.title ?? action.targetId)}已有处理结果，本次未重复写入`)
      continue
    }
    const hasHistory = state.history.some((item) => item.proposalId === proposal.id && item.proposalActionId === action.id)
    const resultId = action.resultTargetId ?? action.targetId
    const exists = action.actionType === "CREATE_TASK" || action.actionType === "UPDATE_TASK" ? Boolean(state.tasks[resultId])
      : action.actionType === "CREATE_SUBTASK" || action.actionType === "UPDATE_SUBTASK" ? Boolean(state.subtasks[resultId])
        : action.actionType === "ADD_DEPENDENCY" ? Boolean(state.dependencies[resultId])
          : action.actionType === "CREATE_RISK" || action.actionType === "UPDATE_RISK" ? Boolean(state.risks[resultId])
            : action.actionType === "CREATE_DISCUSSION" ? Boolean(state.discussions[resultId])
              : action.actionType === "BLOCK_TASK" || action.actionType === "UPDATE_DEADLINE" || action.actionType === "CHANGE_ASSIGNEE" ? Boolean(state.tasks[resultId])
                : action.actionType === "REMOVE_DEPENDENCY" ? !state.dependencies[resultId]
            : Boolean(state.stories[resultId])
    if (!hasHistory || !exists) {
      discrepancies.push("一项标记为已执行的变更缺少对应项目记录或变更历史，需要复核")
      continue
    }
    applied.push(action)
    const original = proposal.originalActions.find((item) => item.id === action.id)
    if (original && JSON.stringify(original.proposedValue) !== JSON.stringify(action.proposedValue)) {
      const oldMember = state.members[String(original.proposedValue.assigneeId)]?.name
      const newMember = state.members[String(action.proposedValue.assigneeId)]?.name
      const targetName = String(state.tasks[resultId]?.title ?? state.subtasks[resultId]?.title ?? action.proposedValue.title ?? original.proposedValue.title ?? "项目安排")
      reviewedChanges.push(oldMember && newMember && oldMember !== newMember
        ? `人工调整「${targetName}」负责人：${oldMember} → ${newMember}` : `人工修改了「${targetName}」`)
    }
  }
  return {
    headline: applied.length ? `实际执行：${describeBusinessChanges(businessChangeSummary(applied))}` : "本次尚无实际项目变更",
    applied: applied.map((action) => actionDescription(state, action)),
    reviewedChanges, notExecuted: [...new Set(notExecuted)],
    discrepancies: [...new Set(discrepancies)],
  }
}
