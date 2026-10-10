import type { MeetingMemory, ProjectDataState } from '../types'
import type { ProjectAnalysisSnapshot } from './meetingSnapshot'
import type { ProjectFinding } from './projectMeeting'
import { projectDependencyGraph } from './projectDependencyGraph'

/** Scope-aware, read-only diagnostics. Diagnosing never creates a candidate plan. */
export function meetingDiagnosis(state:ProjectDataState,memory:MeetingMemory,snapshot:ProjectAnalysisSnapshot):ProjectFinding {
 const stories=Object.values(state.stories).filter(story=>memory.focusStoryIds.length?memory.focusStoryIds.includes(story.id):!memory.focusSprintId||story.sprintId===memory.focusSprintId)
 const ids=new Set(stories.map(story=>story.id)),tasks=Object.values(state.tasks).filter(task=>ids.has(task.storyId)),unfinished=tasks.filter(task=>task.status!=='done')
 const blocked=unfinished.filter(task=>task.status==='blocked'),overdue=unfinished.filter(task=>task.endDate<snapshot.currentDate)
 const risks=Object.values(state.risks).filter(risk=>risk.status!=='resolved'&&(ids.has(risk.targetId)||tasks.some(task=>task.id===risk.targetId)))
 const sprint=snapshot.focusedSprint??snapshot.activeSprint,graph=projectDependencyGraph(state)
 const name=(id:string)=>state.members[id]?.name??id
 const blocks=blocked.map(task=>`${task.id.toUpperCase()}「${task.title}」（${name(task.assigneeId)}）：${task.blockReasons.map(reason=>reason.message).join('；')||'原因未登记'}`)
 const paths=tasks.filter(task=>graph.getSuccessors(task.id).length).flatMap(task=>graph.traverseSuccessors(task.id).paths.map(path=>path.map(id=>state.tasks[id]?.title??id).join(' → ')))
 const evidence=[...blocks,...paths, ...risks.map(risk=>`${risk.title}（${risk.level}/${risk.status}）`)]
 if(memory.focusStoryIds.length) return {content:`当前只分析 ${stories.map(story=>story.id.toUpperCase()).join('、')} 推进原因，不重新排计划或写入。\n已登记阻塞：\n${blocks.join('\n')||'无已登记阻塞任务'}\n登记依赖链（允许跨Story）：\n${paths.join('\n')||'没有连接本范围的下游登记链'}\n本范围 ${overdue.length} 个未完成任务超过登记结束日。${sprint?`${sprint.name}计划 ${sprint.startDate}→${sprint.endDate}，剩余 ${sprint.remainingWorkingDays} 个工作日。`:''}\n已登记风险：${risks.map(risk=>risk.title).join('、')||'无'}。缺少的阻塞信息保持待确认，不替成员编造原因。`,evidence}
 return {content:`根据 ${sprint?.name??'全项目'} 当前 Store，最值得讨论的 3 个问题：\n1. 计划窗口与逾期：${sprint?`${sprint.name}登记状态 ${sprint.status}，计划 ${sprint.startDate}→${sprint.endDate}，剩余 ${sprint.remainingWorkingDays} 个工作日；`:''}${unfinished.length} 个任务未完成，其中 ${overdue.length} 个已逾期。需要讨论后续迭代归属与承诺，因为名义容量不能替代已经耗尽的窗口。\n2. 已登记阻塞与依赖传播：${blocked.length} 个任务受阻。${blocks.join('；')||'无登记阻塞'}。${paths.length?`登记路径：${paths.join('；')}。`:''}选择这个问题是因为上游完成前，后继工作不能正常推进。\n3. 未解决风险：${risks.length} 项，${risks.filter(risk=>risk.level==='high').length} 项为 high。${risks.map(risk=>`${risk.title}（${risk.level}/${risk.status}）`).join('；')||'本范围无登记风险'}。需要核对登记的应对与负责人，避免把风险讨论当作已经解决。\n本轮仅读取事实，没有生成新Plan、Proposal或写入项目。`,evidence}
}
