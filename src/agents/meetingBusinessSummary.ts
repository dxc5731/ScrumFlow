import type { ProposalAction } from "../types"

export interface BusinessChangeSummary {
  createdTasks: number
  updatedTasks: number
  createdSubtasks: number
  updatedSubtasks: number
  addedDependencies: number
  removedDependencies: number
  changedAssignees: number
  changedDates: number
  addedRisks: number
}

export function businessChangeSummary(actions: ProposalAction[]): BusinessChangeSummary {
  const count = (type: ProposalAction["actionType"]) => actions.filter((item) => item.actionType === type).length
  return {
    createdTasks: count("CREATE_TASK"), updatedTasks: count("UPDATE_TASK"),
    createdSubtasks: count("CREATE_SUBTASK"), updatedSubtasks: count("UPDATE_SUBTASK"),
    addedDependencies: count("ADD_DEPENDENCY"), removedDependencies: 0,
    changedAssignees: actions.filter((item) => /UPDATE_(TASK|SUBTASK)/.test(item.actionType) && "assigneeId" in item.proposedValue).length,
    changedDates: actions.filter((item) => /UPDATE_(TASK|SUBTASK|STORY)/.test(item.actionType) && ("startDate" in item.proposedValue || "endDate" in item.proposedValue || "dueDate" in item.proposedValue)).length,
    addedRisks: count("CREATE_RISK"),
  }
}

export function describeBusinessChanges(summary: BusinessChangeSummary): string {
  const parts = [
    summary.createdTasks && `新建任务 ${summary.createdTasks} 个`,
    summary.updatedTasks && `调整已有任务 ${summary.updatedTasks} 个`,
    summary.createdSubtasks && `新增步骤 ${summary.createdSubtasks} 个`,
    summary.updatedSubtasks && `调整步骤 ${summary.updatedSubtasks} 个`,
    summary.addedDependencies && `新增依赖 ${summary.addedDependencies} 条`,
    summary.removedDependencies && `移除依赖 ${summary.removedDependencies} 条`,
    summary.addedRisks && `登记风险 ${summary.addedRisks} 项`,
  ].filter(Boolean)
  return parts.join(" · ") || "没有需要修改的项目内容"
}
