import type { MeetingContext, ProjectDataState } from '../types'
import { projectDependencyGraph } from './projectDependencyGraph'

const label=(value:string)=>value.replace(/["<>]/g,' ').replace(/[\r\n]/g,' ')
export function registeredDependencyDiagram(state:ProjectDataState,context:MeetingContext){
 const graph=projectDependencyGraph(state),ids=new Set(context.focusTaskIds.length?context.focusTaskIds:context.focusStoryIds.flatMap(id=>state.stories[id]?.taskIds??[]))
 for(const id of [...ids]){graph.traversePredecessors(id).taskIds.forEach(id=>ids.add(id));graph.traverseSuccessors(id).taskIds.forEach(id=>ids.add(id))}
 const tasks=[...ids].map(id=>state.tasks[id]).filter(Boolean),nodes=new Map(tasks.map((task,index)=>[task.id,'N'+index]))
 return {kind:'diagram' as const,title:'当前任务与已登记依赖关系图',mermaid:'flowchart LR\n'+tasks.map(task=>`  ${nodes.get(task.id)}["${label(task.id.toUpperCase()+' '+task.title)}"]`).join('\n')+'\n'+Object.values(state.dependencies).filter(edge=>nodes.has(edge.sourceTaskId)&&nodes.has(edge.targetTaskId)).map(edge=>`  ${nodes.get(edge.sourceTaskId)} --> ${nodes.get(edge.targetTaskId)}`).join('\n'),notes:'节点和边均来自当前Store，允许跨Story，不把Plan建议关系当作登记依赖。'}
}
export function currentSprintGantt(state:ProjectDataState,context:MeetingContext){
 const sprint=state.sprints[context.focusSprintId??'']??Object.values(state.sprints).find(sprint=>sprint.status==='active')
 const tasks=Object.values(state.tasks).filter(task=>state.stories[task.storyId]?.sprintId===sprint?.id)
 return {kind:'diagram' as const,title:`${sprint?.name??'项目'} 当前排期甘特图`,mermaid:`gantt\n  title ${sprint?.name??'项目'} 当前Store排期\n  dateFormat YYYY-MM-DD\n  axisFormat %m-%d\n`+tasks.map((task,index)=>`  ${label(task.title).replace(/[:,]/g,' ')} :${task.status==='done'?'done, ':''}g${index}, ${task.startDate}, ${task.endDate}`).join('\n'),notes:'完整Sprint范围；日期来自Store，假设日期与Plan未确认日期不覆盖正式排期。'}
}
export function activePlanWbs(state:ProjectDataState,context:MeetingContext){
 const plan=context.activePlan!
 return {kind:'spreadsheet' as const,title:`WBS ${plan.planId} revision ${plan.revision}`,sheets:[{name:'WBS',columns:['Task key','任务','类型','负责人','估算h','前置Task key','Plan ID','revision'],rows:plan.tasks.map(task=>[task.key,task.title,task.type,state.members[task.assigneeId]?.name??'未分配',task.estimate,task.dependsOnKeys.join(', '),plan.planId??'',plan.revision??0])}],notes:'由唯一activePlan revision生成，属于建议，不代表Store已执行。'}
}
