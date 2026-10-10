import type { MeetingContext, MeetingSession, ProjectDataState } from "../types"
import { projectPlanCapacity, storyRemainingEstimate } from "./meetingCapacity"
import { projectDependencyGraph } from "./projectDependencyGraph"
import { buildExecutionSummary } from './meetingExecutionSummary'

export function materialScope(state:ProjectDataState, context:MeetingContext, question:string): MeetingContext {
 const compact=question.toLowerCase().replace(/\s+/g,'')
 const explicitSprint=Object.values(state.sprints).find(sprint=>compact.includes(sprint.name.toLowerCase().replace(/\s+/g,'')) || compact.includes('#'+sprint.id))
 const explicitStories=Object.keys(state.stories).filter(id=>new RegExp(`\\b${id}\\b`,'i').test(question))
 const stories=explicitStories.length?explicitStories:explicitSprint?Object.values(state.stories).filter(story=>story.sprintId===explicitSprint.id).map(story=>story.id):context.focusStoryIds
 return {...context,focusStoryIds:stories,focusTaskIds:explicitSprint?[]:context.focusTaskIds,focusSprintId:explicitSprint?.id??context.focusSprintId,
   referencedStoryId:stories.length===1?stories[0]:null,focus:{...context.focus,storyIds:stories,taskIds:explicitSprint?[]:context.focusTaskIds,sprintId:explicitSprint?.id??context.focusSprintId}}
}
export function buildMaterialEvidenceBundle(state:ProjectDataState, session:MeetingSession, context:MeetingContext) {
 const working=session.memory?.workingState
 const proposals=session.proposalIds.map(id=>state.proposals[id]).filter(proposal=>proposal&&(!context.focusStoryIds.length||proposal.actions.some(action=>context.focusStoryIds.includes(action.targetType==='story'?action.targetId:state.tasks[action.resultTargetId??action.targetId]?.storyId??state.tasks[state.subtasks[action.resultTargetId??action.targetId]?.taskId]?.storyId))))
 const hasApply=proposals.some(proposal=>proposal.actions.some(action=>action.status==='applied'))
 const taskIds=hasApply?Object.values(state.tasks).filter(task=>!context.focusStoryIds.length||context.focusStoryIds.includes(task.storyId)).map(task=>task.id):[]
 const history=state.history.filter(item=>proposals.some(proposal=>proposal.id===item.proposalId))
 const name=(id:unknown)=>typeof id==='string'?state.members[id]?.name??`未知成员(${id})`:''
 const execution=proposals.map(proposal=>({proposalId:proposal.id,status:proposal.status,sourcePlanId:proposal.sourcePlanId,sourcePlanRevision:proposal.sourcePlanRevision,
   originalActions:proposal.originalActions,reviewedActions:proposal.reviewedActions??proposal.actions,
   changes:proposal.actions.map(action=>({actionId:action.id,taskId:action.resultTargetId??action.targetId,
     taskTitle:state.tasks[action.resultTargetId??action.targetId]?.title??String(action.proposedValue.title??action.targetId),
     originalAssignee:name(proposal.originalActions.find(item=>item.id===action.id)?.proposedValue.assigneeId),
     reviewedAssignee:name((proposal.reviewedActions??proposal.actions).find(item=>item.id===action.id)?.proposedValue.assigneeId),actualAssignee:action.status==='applied'?name(state.tasks[action.resultTargetId??action.targetId]?.assigneeId??state.subtasks[action.resultTargetId??action.targetId]?.assigneeId):null,
     decision:action.decision,applyStatus:action.status}))}))
 const transcript=session.messageIds.map(id=>state.meetingMessages[id]).filter(Boolean)
 let relevant=!context.focusStoryIds.length
 const relatedTranscript=transcript.filter(message=>{
   if(message.senderType==='user'){
     const trace=session.qaTrace?.find(trace=>trace.messageId===message.id)
     relevant=!context.focusStoryIds.length||Boolean(trace?.focusStoryIds.some(id=>context.focusStoryIds.includes(id)))||context.focusStoryIds.some(id=>message.content.toLowerCase().includes(id.toLowerCase()))
   }
   return relevant&&message.senderId!=='material_organizer'||Boolean(message.proposalId&&proposals.some(proposal=>proposal.id===message.proposalId))
 })
 return {sourcePriority:['Store after Apply','ChangeHistory','reviewedActions','originalActions','Plan','meeting discussion'],
   transcript,relatedTranscript,storeAtMeetingStart:working?.storeAtStart??null,
   deterministicWhatIf:working?.whatIfResults??[],planRevisions:working?.planRevisions??[],proposals:execution,
   historyDelta:history,applyResult:buildExecutionSummary(state,proposals),storeAfterApply:taskIds.map(id=>state.tasks[id]).filter(Boolean),
   storeAfterApplySnapshot:hasApply?structuredClone({stories:state.stories,tasks:state.tasks,subtasks:state.subtasks,dependencies:state.dependencies}):null,scope:context.focus,
   currentFacts:{stories:context.focusStoryIds.map(id=>state.stories[id]).filter(Boolean),
     tasks:Object.values(state.tasks).filter(task=>!context.focusStoryIds.length||context.focusStoryIds.includes(task.storyId)),
     registeredRisks:Object.values(state.risks),dependencies:Object.values(state.dependencies)},asOf:new Date().toLocaleDateString('sv-SE')}
}
export type MaterialEvidenceBundle=ReturnType<typeof buildMaterialEvidenceBundle>

/** Local exports retain the full bundle. Provider input carries one copy of each fact. */
export function materialEvidenceForModel(bundle:MaterialEvidenceBundle) {
 const scopedPlans=bundle.planRevisions.filter(plan=>!bundle.scope.storyIds.length||plan.focus.storyIds.some(id=>bundle.scope.storyIds.includes(id)))
 const referenced=new Set(bundle.proposals.map(proposal=>`${proposal.sourcePlanId}:${proposal.sourcePlanRevision}`))
 const latest=scopedPlans.at(-1)
 return {sourcePriority:bundle.sourcePriority,scope:bundle.scope,asOf:bundle.asOf,
   discussion:bundle.relatedTranscript.slice(-12).map(message=>({role:message.senderType,content:message.content.slice(0,900)})),
   deterministicWhatIf:bundle.deterministicWhatIf,
   plans:scopedPlans.filter(plan=>plan===latest||referenced.has(`${plan.planId}:${plan.revision}`)).map(plan=>({
     planId:plan.planId,revision:plan.revision,focus:plan.focus,tasks:plan.tasks,dependencies:plan.dependencies,
     constraintsSnapshot:plan.constraintsSnapshot,validation:plan.validation})),
   // Older unreviewed discussions stay identifiable without duplicating full options.
   discussionPlans:scopedPlans.filter(plan=>plan!==latest&&!referenced.has(`${plan.planId}:${plan.revision}`)).map(plan=>({
     planId:plan.planId,revision:plan.revision,focus:plan.focus,status:'discussion_only',
     tasks:plan.tasks.map(task=>({key:task.key,title:task.title,assigneeId:task.assigneeId,estimate:task.estimate})),
     constraintsSnapshot:plan.constraintsSnapshot,valid:plan.validation.valid})),
   proposals:bundle.proposals,historyDelta:bundle.historyDelta,applyResult:bundle.applyResult,
   finalStore:bundle.storeAfterApply,currentFacts:bundle.currentFacts}
}

/** The same evidence hierarchy serves the meeting answer and exported material. */
export function describeMeetingEvidence(bundle:MaterialEvidenceBundle,state:ProjectDataState):string {
 const graph=projectDependencyGraph(state)
 const tasks=bundle.currentFacts.tasks
 const ids=new Set(tasks.map(task=>task.id))
 const edges=Object.values(state.dependencies).filter(edge=>ids.has(edge.sourceTaskId)||ids.has(edge.targetTaskId))
 const name=(id:string)=>state.members[id]?.name??`未知成员(${id})`
 const plans=bundle.planRevisions.filter(plan=>!bundle.scope.storyIds.length||plan.focus.storyIds.some(id=>bundle.scope.storyIds.includes(id)))
 const simulations=bundle.deterministicWhatIf.map(result=>result.kind==='what_if'?`- ${String(result.taskId).toUpperCase()} 晚 ${result.workingDays} 个工作日：${(result.affectedTasks as Array<{taskId:string;baselineDate:string;projectedDate:string;delta:number}>).map(task=>`${task.taskId.toUpperCase()} ${task.baselineDate}→${task.projectedDate}（+${task.delta}工作日）`).join('；')}`:`- 依赖解除模拟：${result.reason??'待明确边'}，未写入。`)
 return `项目真实数据（当前 Store）\n${tasks.map(task=>`- ${task.id.toUpperCase()}「${task.title}」：${name(task.assigneeId)}，${task.status}，${task.estimate}h；阻塞原因：${task.blockReasons.map(reason=>reason.message).join('；')||'无已登记阻塞'}`).join('\n')}\n已登记依赖：\n${edges.map(edge=>`${state.tasks[edge.sourceTaskId]?.title??edge.sourceTaskId} → ${state.tasks[edge.targetTaskId]?.title??edge.targetTaskId}`).join('\n')||'本范围没有登记边'}\n\n确定性分析（由登记数据计算）\n${tasks.filter(task=>graph.getSuccessors(task.id).length).map(task=>`- ${task.id.toUpperCase()} 下游直接 ${graph.getSuccessors(task.id).length} 项，直接及间接 ${graph.traverseSuccessors(task.id).taskIds.length} 项（允许跨Story）`).join('\n')}\n\nWhat-if（本次会议假设，未写入正式日期）\n${simulations.join('\n')||'本次没有保存的模拟结果；讨论中的推测不作为事实。'}\n\nPlan（建议，尚不代表执行）\n${plans.map(plan=>`- ${plan.planId} revision ${plan.revision}：${plan.tasks.length}项任务，${plan.tasks.reduce((sum,task)=>sum+task.estimate,0)}h；结构化验证 ${plan.validation.valid?'通过':'未通过'}`).join('\n')||'本次没有保存的Plan revision'}\n\nProposal与实际写入\n${bundle.proposals.length?bundle.proposals.map(proposal=>`- ${proposal.proposalId}：${proposal.status}；已执行 ${proposal.changes.filter(change=>change.applyStatus==='applied').length} 项动作。`).join('\n'):'本次本范围没有已应用Proposal。'}\n实际执行以Store after Apply和ChangeHistory为准；未确认讨论、Plan及What-if都不能当作已执行结果。`
}

export function evidenceMinutes(bundle:MaterialEvidenceBundle, state:ProjectDataState):string {
 const name=(id:string)=>state.members[id]?.name??id
 const facts=bundle.currentFacts
 const tasks=facts.tasks
 const whatIf=bundle.deterministicWhatIf.filter(result=>!result.taskId || tasks.some(task=>task.id===result.taskId))
 const row=(cells:unknown[])=>'| '+cells.map(cell=>String(cell??'').replace(/\|/g,'/').replace(/\n/g,' ')).join(' | ')+' |'
 const applied=bundle.proposals.filter(proposal=>proposal.status==='applied'||proposal.status==='partially_applied')
 const results=applied.flatMap(proposal=>proposal.changes.filter(change=>change.applyStatus==='applied'))
 const loads:Record<string,number>={}
 for(const task of bundle.storeAfterApply) for(const work of task.subtaskIds.length?task.subtaskIds.map(id=>state.subtasks[id]).filter(Boolean):[task]) loads[name(work.assigneeId)]=(loads[name(work.assigneeId)]??0)+work.estimate
 return `# 会议纪要与变更摘要\n\n会议日期：${bundle.asOf}\n\n## 讨论背景\n\n${facts.stories.map(story=>`${story.id.toUpperCase()}「${story.title}」`).join('、')}；以本次会议与项目记录为依据。\n\n## 已确认事实（当前 Store）\n\n`+
   row(['Task','负责人','状态','估算','日期','已登记阻塞原因'])+'\n'+row(['---','---','---','---','---','---'])+'\n'+tasks.map(task=>row([`${task.id.toUpperCase()} ${task.title}`,name(task.assigneeId),task.status,`${task.estimate}h`,`${task.startDate}→${task.endDate}`,task.blockReasons.map(reason=>reason.message).join('；')||'无'])).join('\n')+
   `\n\n## What-if 分析（假设，未写入）\n\n${whatIf.length?whatIf.map(result=>'```json\n'+JSON.stringify(result,null,2)+'\n```').join('\n\n'):'本次没有已保存的确定性模拟结果，不把讨论猜测当作项目事实。'}\n\n## AI 初稿与人工审核\n\n`+
   row(['任务','AI初稿负责人','人工审核负责人','实际Store负责人','审核/执行状态'])+'\n'+row(['---','---','---','---','---'])+'\n'+bundle.proposals.flatMap(proposal=>proposal.changes.map(change=>row([change.taskTitle,change.originalAssignee,change.reviewedAssignee,change.actualAssignee??'未写入',`${change.decision}/${change.applyStatus}`]))).join('\n')+
   `\n\n## 最终确认方案与实际写入\n\n${results.length?`已应用 ${results.length} 项动作。实际任务分工：${Object.entries(loads).map(([member,hours])=>`${member}${hours}h`).join(' + ')}。参与人数 ${Object.keys(loads).length}。\n`:'未发生本次Proposal写入；所有未确认方案仍属于建议。\n'}${bundle.historyDelta.length} 条本次Proposal相关ChangeHistory可追踪。\n\n## 最终结论\n\n${applied.length?'最终执行结果以上表实际Store为准，AI初稿不替代人工修改后的结果。':'会议尚未形成已应用变更，不伪造执行结论。'}\n\n## 待办事项\n\n${bundle.proposals.filter(proposal=>!['applied','rejected'].includes(proposal.status)).map(proposal=>`- 审核待确认Proposal ${proposal.proposalId}（${proposal.status}）。`).join('\n')||'- 未确认新增待办；可继续讨论已登记阻塞的处理。'}\n\n## 未决问题\n\n${tasks.filter(task=>task.status==='blocked').map(task=>`- ${task.title}：${task.blockReasons.map(reason=>reason.message).join('；')}`).join('\n')||'- 本范围没有已登记阻塞项；未记录的信息保持未确认。'}\n\n## 会议讨论记录（不等同执行事实）\n\n${bundle.relatedTranscript.map(message=>`### ${message.senderType} · ${state.members[message.senderId]?.name??message.senderId}\n\n${message.content}`).join('\n\n')}`
}

export function sprintIssueSpreadsheet(state:ProjectDataState, context:MeetingContext) {
 const graph=projectDependencyGraph(state),asOf=new Date().toLocaleDateString('sv-SE')
 const stories=context.focusStoryIds.map(id=>state.stories[id]).filter(Boolean)
 const rows:Array<Array<string|number>>=[]
 for(const story of stories){
   const risks=Object.values(state.risks).filter(risk=>risk.targetId===story.id&&risk.status!=='resolved').map(risk=>risk.title).join('；')
   rows.push(['Story',story.id.toUpperCase()+' '+story.title,state.members[story.assigneeId]?.name??'',story.deliveryStatus,story.dueDate<asOf&&story.deliveryStatus!=='accepted'?'是':'否',story.taskIds.some(id=>state.tasks[id]?.status==='blocked')?'是':'否',risks||'无已登记风险','未评估（非事实）','',storyRemainingEstimate(state,story.id).hours??'UNKNOWN'])
   for(const id of story.taskIds){const task=state.tasks[id];if(!task)continue
     const taskRisks=Object.values(state.risks).filter(risk=>risk.targetId===id&&risk.status!=='resolved').map(risk=>risk.title).join('；')
     rows.push(['Task',id.toUpperCase()+' '+task.title,state.members[task.assigneeId]?.name??'',task.status,task.endDate<asOf&&task.status!=='done'?'是':'否',task.status==='blocked'?'是':'否',taskRisks||'无已登记任务风险','未评估（非事实）',graph.getPredecessors(id).map(edge=>state.tasks[edge.sourceTaskId]?.title??edge.sourceTaskId).join('；'),task.estimate])
   }
 }
 return {kind:'spreadsheet' as const,title:`${state.sprints[context.focusSprintId??'']?.name??'项目'} 问题清单`,
   sheets:[{name:'问题清单',columns:['类型','Story/Task','负责人','状态','是否逾期','是否阻塞','风险（registered fact）','风险分析（inference）','关键依赖','工时h'],rows}],notes:'状态、风险与依赖来自Project Store，未估算保持UNKNOWN；未将推测风险写成登记事实。'}
}
