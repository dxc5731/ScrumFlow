import { usePlanningFixtureClock } from "./planningFixtureClock"

import { beforeEach, describe, expect, it } from 'vitest'
import { coordinateMeetingTurn } from '../agents/meetingDecision'
import { revalidateReviewedProposal } from '../agents/meetingFinalRevalidation'
import { assertsCompletedMutation } from '../agents/meetingClaims'
import { buildMaterialEvidenceBundle, evidenceMinutes, materialScope, sprintIssueSpreadsheet } from '../agents/materialEvidence'
import { buildMeetingContext } from '../agents/meetingContext'
import { resetProjectStoreForTests, useProjectStore } from '../store/projectStore'
import type { MeetingLlm } from '../agents/meetingLlm'
import { validateReplyClaims } from '../agents/meetingClaims'
import { parseModelObject } from '../agents/meetingLlm'
import { compareProjectStories } from '../agents/projectMeeting'
const offline: MeetingLlm = { interpret: async () => null, explain: async () => null }

usePlanningFixtureClock()

describe('frozen plan, final review and material evidence', () => {
 beforeEach(() => resetProjectStoreForTests())
 it('does not replace an explicit specialist when creation keywords occur',async()=>{
  const state=useProjectStore.getState(),session=state.createMeeting('story','us030')
  const result=await coordinateMeetingTurn(state,session,'risk_dependency','新增一个测试子任务，2h',offline)
  expect(result.answer.agentType).toBe('risk_dependency');expect(result.answer.proposal).toBeUndefined()
  expect(result.memory.workingState!.activeAgent).toBe('risk_dependency')
 })
 it('diagnoses a Sprint scope without inventing a Story plan',async()=>{
  const state=useProjectStore.getState(),session=state.createMeeting('project',state.project.id)
  const diagnosed=await coordinateMeetingTurn(state,session,'project_orchestrator','Sprint 2复盘，最值得讨论的3个问题，先只分析', {...offline,interpret:async()=>({intent:'diagnose'})})
  expect(diagnosed.answer.content).toContain('3 个问题')
  expect(diagnosed.answer.content).toContain('已登记阻塞')
  expect(diagnosed.memory.options).toEqual([])
  expect(diagnosed.answer.proposal).toBeUndefined()
 })
 it('composes a read-only task/Sprint/acceptance query even when the classifier suggests planning',async()=>{
  const state=useProjectStore.getState(),session=state.createMeeting('story','us030')
  const result=await coordinateMeetingTurn(state,session,'project_orchestrator','先核对当前任务、Sprint和验收标准，只读取事实',{...offline,interpret:async()=>({intent:'plan'})})
  expect(result.answer.content).toContain('所属 Sprint')
  expect(result.answer.content).toContain('Sprint 3')
  for(const id of state.stories.us030.acceptanceCriteriaIds)expect(result.answer.content).toContain(state.acceptanceCriteria[id].content)
  expect(result.memory.options).toEqual([])
  expect(result.answer.proposal).toBeUndefined()
 })
 it('keeps an explicit Story graph above an inferred LLM task name',async()=>{
  const state=useProjectStore.getState(),session=state.createMeeting('story','us024')
  const result=await coordinateMeetingTurn(state,session,'risk_dependency','#US024 沿登记依赖查看阻塞链',{...offline,interpret:async()=>({intent:'risk',taskName:'统一 Story/Task 查询接口'})})
  expect(result.answer.content).toContain('定义 Story 与 Task 数据模型 → 甘特依赖连接线渲染')
  expect(result.memory.referencedTaskKeys).toEqual([])
 })
 it('includes time capacity and preserves unknown cost in candidate comparisons',()=>{
  const state=useProjectStore.getState(),result=compareProjectStories(state,['us024','us033'])
  expect(result.content).toContain('时间窗口')
  expect(result.content).toContain('UNKNOWN')
  expect(result.content).toContain('机会成本')
 })
 it('keeps a candidate comparison when its Sprint differs from the previous focus',async()=>{
  const state=useProjectStore.getState(),session=state.createMeeting('story','us030')
  const result=await coordinateMeetingTurn(state,session,'workload_capacity','比较 #CAND-003 和 #CAND-005，考虑剩余工时、风险、当前团队容量和机会成本',offline)
  expect(result.answer.content).toContain('CAND-003')
  expect(result.answer.content).toContain('CAND-005')
  expect(result.answer.content).toContain('UNKNOWN')
  expect(result.answer.content).toContain('机会成本')
  expect(result.answer.content).not.toContain('旧迭代的工期限制没有沿用')
 })
 it('escapes provider line breaks without changing claims or accepting broken syntax',()=>{
  expect(parseModelObject('{"content":"尚未修改\n需要审核","claims":{"mutation":{"executed":false}}}')).toEqual({content:'尚未修改\n需要审核',claims:{mutation:{executed:false}}})
  expect(parseModelObject('{"content":"正常","claims":')).toBeNull()
  expect(parseModelObject('{"content":"不是"没人干活"，尚未修改","claims":{"mutation":{"executed":false}}}')).toEqual({content:'不是"没人干活"，尚未修改',claims:{mutation:{executed:false}}})
 })
 it('blocks an older proposal after the same plan gets newer hard constraints',async()=>{
  const state=useProjectStore.getState(),session=state.createMeeting('story','us030')
  const planned=await coordinateMeetingTurn(state,session,'task_decomposition','两个人，总工时最多16h',offline)
  const executed=await coordinateMeetingTurn(state,{...session,memory:planned.memory},'plan_execution','按刚才方案A转成待审核建议',offline)
  const proposal=executed.answer.proposal!;proposal.actions.forEach(action=>action.decision='accepted');proposal.reviewedActions=structuredClone(proposal.actions)
  const revised=await coordinateMeetingTurn(state,{...session,memory:executed.memory},'task_decomposition','不要李娜，其他条件不变',offline)
  expect(revalidateReviewedProposal(state,proposal,{...session,memory:revised.memory}).errors).toContain('来源Plan已产生新revision，请按最新约束重新生成Proposal；旧建议不能继续Apply')
 })
 it('merges member exclusions into retained child work, with matching rollup hours and immutable originals',async()=>{
  const state=useProjectStore.getState()
  const testTask=state.createTask('us030',{title:'补充验收流程与退回场景测试',type:'test',estimate:5,assigneeId:'m2'})
  const store=useProjectStore.getState(),session=store.createMeeting('story','us030')
  const planned=await coordinateMeetingTurn(store,session,'task_decomposition','三个人，总工时最多16h，不要陈林，李娜只能做测试',offline)
  const drafted=await coordinateMeetingTurn(store,{...session,memory:planned.memory},'task_decomposition','新增一个测试子任务，2h',{
   ...offline,draftWork:async()=>JSON.stringify({summary:'测试建议',items:[{parentType:'task',parentId:testTask.id,title:'验证验收结果状态回显',estimate:2,assigneeId:'m2'}]})
  })
  const original=drafted.answer.proposal!
  expect(original.actions[0].proposedValue.assigneeId).toBe('m2')
  const revised=await coordinateMeetingTurn(store,{...session,memory:drafted.memory},'task_decomposition','按刚才的方案继续，但是不要李娜',offline)
  for(const option of revised.memory.options){
   expect(option.tasks.every(task=>!['m2','m3'].includes(task.assigneeId))).toBe(true)
   expect(option.subtasks?.every(step=>!['m2','m3'].includes(step.assigneeId))).toBe(true)
   expect(option.tasks.find(task=>task.key===testTask.id)?.estimate).toBe(2)
   expect(option.totalHours).toBe(option.tasks.reduce((sum,task)=>sum+task.estimate,0))
   expect(option.feasible).toBe(false)
   expect(option.infeasibleReasons.join()).toContain('要求 3 人参与')
  }
  expect(original.actions[0].proposedValue.assigneeId).toBe('m2')
  expect(useProjectStore.getState().tasks[testTask.id].subtaskIds).toHaveLength(0)
 })
 it('rejects excluded reviewers even without the original session and after focus changes', async () => {
  const state=useProjectStore.getState(),session=state.createMeeting('story','us030')
  const planned=await coordinateMeetingTurn(state,session,'task_decomposition','两个人，总工时最多16h，不要陈林',offline)
  const executed=await coordinateMeetingTurn(state,{...session,memory:planned.memory},'plan_execution','按刚才方案A转成待审核建议',offline)
  const proposal=executed.answer.proposal!
  expect(proposal.sourcePlanId).toBe(planned.memory.workingState!.activePlanId)
  expect(proposal.sourcePlanRevision).toBe(planned.memory.workingState!.activePlanRevision)
  proposal.actions.forEach(action=>{action.decision='accepted'})
  proposal.reviewedActions=structuredClone(proposal.actions)
  const task=proposal.reviewedActions.find(action=>action.actionType==='CREATE_TASK')!
  task.proposedValue.assigneeId='m3'
  const checked=revalidateReviewedProposal(state,proposal)
  expect(checked.valid).toBe(false)
  expect(checked.constraintViolations.some(item=>item.type==='excludedMember')).toBe(true)
  const moved=await coordinateMeetingTurn(state,{...session,memory:executed.memory},'project_orchestrator','先看US024',offline)
  expect(revalidateReviewedProposal(state,proposal,{...session,memory:moved.memory}).constraintViolations).toEqual(checked.constraintViolations)
 })
 it('keeps explicit Sprint material scope above a prior Story focus',()=>{
  const state=useProjectStore.getState(),session=state.createMeeting('story','us024')
  const context=materialScope(state,buildMeetingContext(state,session),'Sprint 2 问题清单 Excel')
  expect(context.focusStoryIds).toContain('us025');expect(context.focusTaskIds).toEqual([])
  const sheet=sprintIssueSpreadsheet(state,context)
  expect(sheet.sheets[0].rows.some(row=>String(row[1]).startsWith('US025'))).toBe(true)
 })
 it('does not treat denials or conditional review as completed writes',()=>{
  for(const text of ['我不能修改项目','尚未修改项目','需要审核后才能修改','不能声称我已修改项目','如果已经修改，请查看历史']) expect(assertsCompletedMutation(text),text).toBe(false)
  expect(assertsCompletedMutation('我已经修改负责人')).toBe(true)
 })
 it('validates structured assignments independently from a negated list of nonparticipants',async()=>{
  const state=useProjectStore.getState(),session=state.createMeeting('story','us030')
  const result=await coordinateMeetingTurn(state,session,'task_decomposition','两个人，总工时最多16h',offline)
  const context=buildMeetingContext(state,{...session,memory:result.memory}),plan=context.activePlan!
  expect(validateReplyClaims({sourcePlanId:plan.planId,sourcePlanRevision:plan.revision,mutation:{executed:false},assignments:plan.tasks.map(task=>({taskKey:task.key,memberId:task.assigneeId,estimate:task.estimate}))},context,state)).toEqual([])
 })
 it('uses Store results above original AI assignments in minutes',()=>{
  const state=useProjectStore.getState(),session=state.createMeeting('story','us030'),bundle=buildMaterialEvidenceBundle(state,session,buildMeetingContext(state,session))
  bundle.storeAfterApply=[{...state.tasks['data-024'],assigneeId:'m2',estimate:3,subtaskIds:[]},{...state.tasks['fe-025-1'],assigneeId:'m1',estimate:13,subtaskIds:[]}]
  bundle.proposals=[{proposalId:'unit-proposal',status:'applied',sourcePlanId:'plan',sourcePlanRevision:1,originalActions:[],reviewedActions:[],changes:[{actionId:'action',taskId:'data-024',taskTitle:'工程任务',originalAssignee:'张伟',reviewedAssignee:'李娜',actualAssignee:'李娜',decision:'accepted',applyStatus:'applied'}]}]
  const minutes=evidenceMinutes(bundle,state)
  expect(minutes).toContain('李娜3h + 张伟13h')
  expect(minutes).toContain('| 工程任务 | 张伟 | 李娜 | 李娜 |')
 })
})
