import type { AgentAnswer } from "./meetingConversation"
import type { ProjectAnalysisSnapshot } from "./meetingSnapshot"
import type { MeetingMemory, ProjectDataState } from "../types"

export interface ConsistencyResult { answer: AgentAnswer; warnings: string[] }

export function checkMeetingResponse(state: ProjectDataState, snapshot: ProjectAnalysisSnapshot,
  memory: MeetingMemory, answer: AgentAnswer): ConsistencyResult {
  const warnings: string[] = []
  let content = answer.content
  let proposal = answer.proposal
  const focusedSprint = snapshot.focusedSprint
  if (focusedSprint?.status === "active" && focusedSprint.remainingWorkingDays === 0) {
    warnings.push(`${focusedSprint.name} 仍标为进行中，但计划期已过`)
    content = content.replace(new RegExp(`${focusedSprint.name} 当前处于进行阶段`, "g"),
      `${focusedSprint.name} 在项目中仍标为进行中，但计划结束日已过`)
  }
  // Cross-Story comparisons and evidence summaries may legitimately mention
  // several Sprints. Validate their structured claims, not a name in prose.
  if (snapshot.focusedStory?.status === "accepted" && answer.agentType === "task_decomposition") {
    warnings.push("已验收 Story 仍触发任务拆解")
    content = `${snapshot.focusedStory.id.toUpperCase()} 已验收。若要新增后续工作，请先明确新的需求范围；当前不生成拆解建议。`
    proposal = undefined
  }
  if (proposal?.actions.some((action) => action.actionType === "UPDATE_TASK" && snapshot.tasks[action.targetId]?.status === "done")) {
    warnings.push("Proposal 尝试调整已完成任务")
    content = "方案涉及已完成的任务，我已暂停生成项目行动。请先确认要调整的是哪项未完成工作。"
    proposal = undefined
  }
  if (proposal?.actions.some((action) => typeof action.proposedValue.assigneeId === "string" &&
    memory.constraints.excludedMemberIds.includes(action.proposedValue.assigneeId))) {
    warnings.push("Proposal 仍推荐被排除的成员")
    content = "方案仍包含本轮明确排除的成员，我已暂停生成项目行动，请重新核对负责人约束。"
    proposal = undefined
  }
  const created = proposal?.actions.filter((action) => action.actionType === "CREATE_TASK").length ?? 0
  if (proposal && created > 0 && /整理出\s*\d+\s*项待确认行动/.test(content)) {
    warnings.push("用户回复使用底层行动数描述任务")
    const dependencies = proposal.actions.filter((action) => action.actionType === "ADD_DEPENDENCY").length
    const steps = proposal.actions.filter((action) => action.actionType === "CREATE_SUBTASK").length
    content = content.replace(/整理出\s*\d+\s*项待确认行动/, `整理出 ${created} 个任务${steps ? `、${steps} 个步骤` : ""}${dependencies ? `和 ${dependencies} 条依赖关系` : ""}`)
  }
  if (import.meta.env.DEV && import.meta.env.MODE !== "test" && warnings.length) console.warn("Meeting consistency", { snapshot: snapshot.version, warnings })
  return { answer: { ...answer, content, ...(proposal ? { proposal } : { proposal: undefined }) }, warnings }
}
