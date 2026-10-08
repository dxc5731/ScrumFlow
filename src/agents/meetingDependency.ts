import { buildProjectAnalysisSnapshot } from "./meetingSnapshot"
import { projectDependencyGraph, simulateDelay, validateDependencyRemoval } from "./projectDependencyGraph"
import type { MeetingMemory, MeetingSession, ProjectDataState } from "../types"

export function dependencyImpact(state:ProjectDataState, session:MeetingSession, memory:MeetingMemory, taskKey:string|null, delayDays:number,
  analysis=buildProjectAnalysisSnapshot(state,session,memory), scenario:{removeDependency?:boolean;earlyDays?:number;targetTitle?:string;direction?:"incoming"|"outgoing"}={}) {
  const graph=projectDependencyGraph(state)
  const root=state.tasks[taskKey??''] ?? Object.values(state.tasks).filter(task=>memory.focusStoryIds.includes(task.storyId) || session.targetId===task.storyId)
    .sort((a,b)=>graph.traverseSuccessors(b.id).taskIds.length-graph.traverseSuccessors(a.id).taskIds.length)[0]
  if (!root) return {content:"当前没有可分析的任务。",evidence:[]}
  if (delayDays>0 && root.status==='done') return {content:`「${root.title}」已完成，不把它作为未发生的延期模拟。`,evidence:[`任务状态：${root.status}`]}
  if (scenario.removeDependency) {
    const direction=scenario.direction??'outgoing'
    const edges=direction==='incoming'?graph.getPredecessors(root.id):graph.getSuccessors(root.id)
    const selected=scenario.targetTitle?edges.find(edge=>state.tasks[direction==='incoming'?edge.sourceTaskId:edge.targetTaskId]?.title.includes(scenario.targetTitle!)):undefined
    const removal=validateDependencyRemoval(state,root.id,direction,selected?.id)
    memory.workingState?.whatIfResults.push({kind:'dependency_removal',taskId:root.id,direction,...removal,writesStore:false})
    return {content:`「${root.title}」${removal.reason}。${removal.valid?'解除该边也不会把前置任务标完成，手工阻塞仍需独立处理。':'不会改成解除相反方向的关系。'}仅模拟，不写入。`,evidence:edges.map(edge=>`${state.tasks[edge.sourceTaskId]?.title} → ${state.tasks[edge.targetTaskId]?.title}`)}
  }
  const working=memory.workingState
  if(working&&!working.whatIfBaselines?.[root.id]){
    working.whatIfBaselines??={}
    const initial=working.storeAtStart?.tasks[root.id]?working.storeAtStart:state
    working.whatIfBaselines[root.id]=structuredClone({tasks:initial.tasks,dependencies:initial.dependencies})
  }
  const baseline=working?.whatIfBaselines?.[root.id]??state
  if (delayDays>0) {
    const simulation=simulateDelay(root.id,delayDays,baseline)
    memory.workingState?.whatIfResults.push({...simulation})
    return {content:`What-if：${root.id.toUpperCase()} 比同一原计划基线晚 ${delayDays} 个工作日，影响 ${simulation.affectedTasks.length-1} 项后续工作；正式日期未变。\n`+
      simulation.affectedTasks.map(task=>`- ${task.taskId.toUpperCase()}「${task.title}」：${task.baselineDate} → ${task.projectedDate}，delta=${task.delta}工作日`).join('\n')+
      `\n已登记传播路径：\n${simulation.dependencyPaths.map(path=>path.map(id=>baseline.tasks[id]?.title??id).join(' → ')).join('\n')}\n以上是日期依赖模拟，不是新的执行承诺；手工阻塞和真实容量不随假设自动解除。`,
      evidence:[`受影响后续：${simulation.affectedTasks.filter(task=>task.taskId!==root.id).map(task=>task.title).join('、')}`,JSON.stringify(simulation)]}
  }
  const successors=graph.traverseSuccessors(root.id)
  const paths=successors.paths.map(path=>path.map(id=>state.tasks[id]?.title??id).join(' → '))
  const plan=memory.options.find(option=>option.id===memory.activePlanId)
  const proposed=plan?.tasks.flatMap(task=>task.dependsOnKeys.filter(source=>!Object.values(state.dependencies).some(edge=>edge.sourceTaskId===source&&edge.targetTaskId===task.key))
    .map(source=>`${plan.tasks.find(other=>other.key===source)?.title??state.tasks[source]?.title??source} → ${task.title}`))??[]
  return {content:`当前登记依赖从「${root.title}」沿全项目图遍历，直接 ${graph.getSuccessors(root.id).length} 项，直接及间接 ${successors.taskIds.length} 项。\n${paths.join('\n')||'没有向后传播的登记依赖。'}\n`+
    `${proposed.length?`当前Plan另有建议关系（未登记）：\n${proposed.join('\n')}\n`:''}阻塞原因：${root.blockReasons.map(reason=>reason.message).join('；')||'该任务未登记阻塞原因'}。以上只分析原因，不重新排计划或写入。`,
    evidence:[`全项目登记边数：${Object.keys(state.dependencies).length}`, ...paths, `起点剩余工时：${analysis.tasks[root.id]?.remainingHours??root.estimate}h`]}
}
