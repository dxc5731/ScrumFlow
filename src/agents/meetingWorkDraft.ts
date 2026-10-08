import { z } from "zod"
import type { AgentProposal, AgentType, MeetingContext, MeetingMemory, MeetingSession, PlanOption, ProjectDataState, ProposalAction } from "../types"
import type { AgentAnswer } from "./meetingConversation"
import type { MeetingLlm } from "./meetingLlm"
import { parseModelObject } from "./meetingLlm"
import { activePlanRevision, commitPlanOptions } from './meetingWorkingState'
import { createPlanOptions } from './meetingPlanning'
import { focusedMeetingSession } from './meetingContext'
import { projectReviewedActions } from './meetingReviewProjection'
import { validatePlanAgainstConstraints } from './meetingConstraintValidator'
import { rollupPlanEstimates } from './meetingPlanWork'

const workSchema = z.object({
  summary: z.string().min(1).max(3000),
  items: z.array(z.object({
    parentType: z.enum(["story", "task"]), parentId: z.string(), title: z.string().trim().min(4).max(180),
    estimate: z.number().min(0.5).max(80), assigneeId: z.string(),
    type: z.enum(["frontend", "backend", "database", "test", "design", "devops"]).optional(),
  })).max(20),
})

export async function draftMeetingWork(state: ProjectDataState, session: MeetingSession, memory: MeetingMemory,
  context: MeetingContext, question: string, speaker: AgentType, llm: MeetingLlm): Promise<{ answer: AgentAnswer; usedModel: boolean }> {
  const answer = (content: string, proposal?: AgentProposal, usedModel = false) => ({
    answer: { agentType: speaker, content, evidence: [], rawEvidence: [], ...(proposal ? { proposal } : {}) } as AgentAnswer, usedModel,
  })
  const subtasks = /子任务|下级步骤|执行步骤|细化|拆细|拆得更细|拆成.*步骤/i.test(question) || memory.focusTaskIds.length > 0
  const storyIds = memory.focusStoryIds.length ? memory.focusStoryIds : session.targetType === "story" ? [session.targetId]
    : Object.values(state.stories).filter(story => story.sprintId === memory.focusSprintId).map(story => story.id)
  const parents = subtasks
    ? Object.values(state.tasks).filter(task => storyIds.includes(task.storyId) && (memory.focusTaskIds.length ? memory.focusTaskIds.includes(task.id) : true) && task.status !== "done")
    : storyIds.map(id => state.stories[id]).filter(story => story && story.deliveryStatus !== "accepted")
  if (!parents.length) return answer(subtasks
    ? "请用 # 引用需要新增子任务的未完成 Task，或引用一条 Story 为其未完成任务补充步骤；已完成任务不重复拆分。"
    : "请用 # 引用要新增任务的 Story，我会结合它的需求和验收标准生成可审核任务。")
  const parentIds = new Set(parents.map(parent => parent.id))
  const parentType = subtasks ? "task" : "story"
  const scopedTasks = Object.values(state.tasks).filter(task => storyIds.includes(task.storyId))
  const scopedIds = new Set(scopedTasks.map(task => task.id))
  const pending = session.proposalIds.map(id => state.proposals[id]).filter(proposal => proposal && ["draft", "reviewed"].includes(proposal.status))
    .flatMap(proposal => proposal.actions).filter(action => parentIds.has(action.targetId) && action.status === "pending" && action.decision !== "rejected")
  const content = await llm.draftWork?.({ question, speaker, meetingId: session.id, presentationMode: session.presentationMode, parentType, eligibleParents: parents.map(parent => ({ id: parent.id, title: parent.title,
    ...("type" in parent ? { type: parent.type, estimate: parent.estimate, assigneeId: parent.assigneeId } : { as: parent.as, iWant: parent.iWant, soThat: parent.soThat }) })),
    pendingItems: pending.map(item => ({ parentId: item.targetId, ...item.proposedValue })),
    projectFacts: { project: { name: state.project.name, goal: state.project.goal }, members: Object.values(state.members),
      constraints: context.constraints, sprint: state.sprints[context.focusSprintId ?? ""],
      stories: storyIds.map(id => state.stories[id]).filter(Boolean).map(story => ({ id: story.id, title: story.title, as: story.as, iWant: story.iWant, soThat: story.soThat,
        acceptanceCriteria: story.acceptanceCriteriaIds.map(id => state.acceptanceCriteria[id]?.content) })),
      tasks: scopedTasks.map(task => ({ id: task.id, title: task.title, assigneeId: task.assigneeId, estimate: task.estimate, type: task.type, status: task.status,
        subtasks: task.subtaskIds.map(id => state.subtasks[id]).filter(Boolean).map(step => ({ title: step.title, estimate: step.estimate, status: step.status })) })),
      dependencies: Object.values(state.dependencies).filter(edge => scopedIds.has(edge.sourceTaskId) || scopedIds.has(edge.targetTaskId)),
      activePlan: context.activePlan ? { planId: context.activePlan.planId, revision: context.activePlan.revision, tasks: context.activePlan.tasks.map(task => ({ key: task.key, title: task.title, assigneeId: task.assigneeId, estimate: task.estimate })) } : null },
    recentMessages: context.recentMessages.filter(item => item.senderType === "user").slice(-4).map(item => ({ role: item.senderType, content: item.content.slice(0,400) })) }).catch(() => null)
  if (!content) return answer("任务生成模型暂时不可用，尚未产生新建议。请重试本条消息；已有项目数据没有改变。")
  const parsed = workSchema.safeParse(parseModelObject(content))
  if (!parsed.success) return answer("模型返回的任务结构不完整，未创建建议。请重试，或明确需要拆分的 Task 和子任务数量。")
  if (!parsed.data.items.length) return answer(parsed.data.summary, undefined, true)
  const seen = new Set<string>()
  const actions: ProposalAction[] = []
  for (const item of parsed.data.items) {
    if (item.parentType !== parentType || !parentIds.has(item.parentId) || !state.members[item.assigneeId] ||
      memory.constraints.excludedMemberIds.includes(item.assigneeId) ||
      memory.constraints.allowedMemberIds.length > 0 && !memory.constraints.allowedMemberIds.includes(item.assigneeId))
      return answer("生成的任务包含范围外对象或不符合人员限制，已停止提交建议。请重试并核对任务范围和负责人。")
    const parent = parents.find(parent => parent.id === item.parentId)!
    const existingTitles = subtasks ? state.tasks[item.parentId].subtaskIds.map(id => state.subtasks[id]?.title)
      : state.stories[item.parentId].taskIds.map(id => state.tasks[id]?.title)
    const key = `${item.parentId}:${item.title.replace(/\s/g, "")}`
    if (seen.has(key) || existingTitles.some(title => title?.replace(/\s/g, "") === item.title.replace(/\s/g, "")) ||
      pending.some(action => action.targetId === item.parentId && action.proposedValue.title === item.title)) continue
    seen.add(key)
    const value = { title: item.title, estimate: item.estimate, assigneeId: item.assigneeId,
      ...(!subtasks ? { type: item.type ?? "backend", startDate: state.stories[item.parentId].startDate, endDate: state.stories[item.parentId].dueDate } : {}) }
    actions.push({ id: `action-${crypto.randomUUID()}`, actionType: subtasks ? "CREATE_SUBTASK" : "CREATE_TASK", targetType: parentType,
      targetId: item.parentId, beforeValue: null, proposedValue: value, reason: parsed.data.summary,
      decision: "pending", status: "pending", dependsOnActionIds: [], resultTargetId: null, appliedAt: null, error: null,
      preconditions: ["title", ...(subtasks ? ["status", "assigneeId"] : ["deliveryStatus", "sprintId"])].map(field => ({
        targetType: parentType, targetId: parent.id, field, expectedValue: (parent as unknown as Record<string, unknown>)[field],
      })),
    })
  }
  if (!actions.length) return answer("这些工作已经存在或已有待审核建议，没有重复添加。可在右侧审核现有建议，或说明需要补充的业务场景。", undefined, true)
  const people = new Set(actions.map(action => action.proposedValue.assigneeId)).size
  const hours = actions.reduce((sum, action) => sum + Number(action.proposedValue.estimate), 0)
  if (memory.constraints.maxPeople && people > memory.constraints.maxPeople || memory.constraints.maxHours && hours > memory.constraints.maxHours)
    return answer("生成的工作超出了本轮人数或总工时限制，尚未提交建议。请重试，我会继续遵守已说明的限制。")
  const now = new Date().toISOString()
  const boundSummary=actions.map(action=>`「${String(action.proposedValue.title)}」：${state.members[String(action.proposedValue.assigneeId)].name}（${String(action.proposedValue.assigneeId)}），${Number(action.proposedValue.estimate)}h，父级「${state.tasks[action.targetId]?.title??state.stories[action.targetId]?.title}」`).join('；')
  for(const action of actions)action.reason=boundSummary
  const proposal: AgentProposal = { schemaVersion: 1, id: `proposal-${crypto.randomUUID()}`, projectId: state.project.id,
    origin: "meeting", triggerType: "manual", agentType: speaker, targetType: session.targetType, targetId: session.targetId,
    summary: `新增 ${actions.length} 个${subtasks ? "子任务" : "任务"}`, reasoning: boundSummary,
    evidence: parents.map(parent => ({ agentType: speaker, targetType: parentType, targetId: parent.id, detail: `根据「${parent.title}」及现有工作补充，工时为建议估算` })),
    actions, originalActions: structuredClone(actions), status: "draft", createdBy: state.workspace.currentUserId,
    createdAt: now, updatedAt: now, reviewedBy: null, reviewedAt: null, reviewNote: "", appliedAt: null, applyError: null }
  const scoped = focusedMeetingSession(state, session, memory)
  if (scoped) {
    const base = memory.options.find(option=>option.id===memory.activePlanId) ?? createPlanOptions(state,scoped,memory)[0]
    if (base) {
      const option: PlanOption = structuredClone(base)
      for(const action of actions) {
        const value=action.proposedValue
        if(action.actionType==='CREATE_TASK') option.tasks.push({key:action.id,sourceTaskId:null,storyId:action.targetId,title:String(value.title),type:value.type as 'backend',estimate:Number(value.estimate),assigneeId:String(value.assigneeId),phase:'新增工作',dependsOnKeys:[],subtaskTitles:[],startDate:String(value.startDate),endDate:String(value.endDate)})
        else option.subtasks=[...(option.subtasks??[]),{key:action.id,parentTaskKey:action.targetId,title:String(value.title),estimate:Number(value.estimate),assigneeId:String(value.assigneeId)}]
      }
      const projected=projectReviewedActions(state,actions.map(action=>({...action,decision:'accepted'})))
      const effective=option.tasks.flatMap(task=>{const current=projected.tasks[task.sourceTaskId??task.key];return current?.subtaskIds.length?current.subtaskIds.map(id=>projected.subtasks[id]).filter(step=>step&&step.status!=='done').map(step=>({...task,sourceTaskId:null,key:step.id,title:step.title,estimate:step.estimate,assigneeId:step.assigneeId,subtaskTitles:[]})):[task]})
      option.totalHours=effective.reduce((sum,task)=>sum+task.estimate,0)
      rollupPlanEstimates(option, state)
      const validation=validatePlanAgainstConstraints({...option,tasks:effective},memory.constraints,state)
      option.feasible=validation.valid;option.infeasibleReasons=validation.violations.map(item=>item.message)
      memory.activePlanId=option.id
      commitPlanOptions(memory,[option],state)
      const plan=activePlanRevision(memory)!
      Object.assign(proposal,{sourcePlanId:plan.planId,sourcePlanRevision:plan.revision,planSnapshot:structuredClone(plan),constraintsSnapshot:structuredClone(plan.constraintsSnapshot),reviewedActions:structuredClone(actions),preconditions:actions.flatMap(action=>action.preconditions)})
    }
  }
  const lines = actions.map(action => `- ${state.tasks[action.targetId]?.title ?? state.stories[action.targetId]?.title} → ${action.proposedValue.title}（建议 ${action.proposedValue.estimate}h，${state.members[String(action.proposedValue.assigneeId)].name}）`)
  const summary = boundSummary
  return answer(`已为 ${new Set(actions.map(action => action.targetId)).size} 个${subtasks ? "未完成任务" : "Story"}拟定 ${actions.length} 个${subtasks ? "子任务" : "任务"}：\n${lines.join("\n")}\n${summary}\n工时与分工是建议，尚未写入项目；请在右侧审核后应用。`, proposal, true)
}
