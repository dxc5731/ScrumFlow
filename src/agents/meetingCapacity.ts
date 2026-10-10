import { buildWorkloadSnapshot, remainingWork, roundHours, taskContributions } from "../utils/workloadAnalysis"
export { taskContributions } from "../utils/workloadAnalysis"
import type { MeetingPlanTask, PlanOption, ProjectDataState } from "../types"

export function storyRemainingEstimate(state: ProjectDataState, storyId: string): { status:"KNOWN"|"UNKNOWN"; hours:number|null } {
 const tasks = state.stories[storyId]?.taskIds.map(id=>state.tasks[id]).filter(Boolean) ?? []
 return tasks.length ? {status:"KNOWN",hours:tasks.reduce((sum,task)=>sum+Object.values(taskContributions(state,task)).reduce((a,b)=>a+b,0),0)} : {status:"UNKNOWN",hours:null}
}
export function projectPlanCapacity(state: ProjectDataState, sprintId: string|null, tasks:MeetingPlanTask[], today = new Date(), steps: PlanOption['subtasks'] = []) {
 const sprint = sprintId ? state.sprints[sprintId] : null
 const snapshot = buildWorkloadSnapshot(state, sprintId, today)
 const { currentDate: asOf, remainingWorkingDays: days } = snapshot
 const current = Object.fromEntries(Object.entries(snapshot.members).map(([id, member]) => [id, member.currentSprintWorkload]))
 const projected = {...current}, touched=new Set<string>()
 for (const task of tasks) {
   if (touched.has(task.key)) throw new Error("方案重复包含同一任务")
   touched.add(task.key)
   const old = task.sourceTaskId ? state.tasks[task.sourceTaskId] : undefined
   const contribution = old ? taskContributions(state,old) : {}
   if (old && state.stories[old.storyId]?.sprintId===sprintId)
     for (const [id,hours] of Object.entries(contribution)) projected[id]=(projected[id]??0)-hours
   const proposed = steps?.filter(step => step.parentTaskKey === task.key) ?? []
   if (proposed.length) {
     for (const step of old?.subtaskIds.map(id => state.subtasks[id]).filter(step => step && step.status !== 'done') ?? [])
       projected[step.assigneeId] = (projected[step.assigneeId] ?? 0) + remainingWork(step)
     for (const step of proposed) projected[step.assigneeId] = (projected[step.assigneeId] ?? 0) + step.estimate
   } else {
     if (old?.subtaskIds.length) {
       for (const [id, hours] of Object.entries(contribution)) projected[id] = (projected[id] ?? 0) + hours
     } else {
       const hours = old ? remainingWork({ ...old, estimate: task.estimate }) : task.estimate
       projected[task.assigneeId]=(projected[task.assigneeId]??0)+hours
     }
   }
 }
 for (const id of Object.keys(projected)) projected[id] = roundHours(projected[id])
 return {sprintId,asOf,remainingWorkingDays:days,
   sprintCapacity:{value:sprint?.capacity??null,unit:"story_points" as const},
   members:Object.fromEntries(Object.values(state.members).map(member=>[member.id,{memberId:member.id,memberName:member.name,
     nominalWeeklyHours:member.capacityHours,timeWindowCapacityHours:snapshot.members[member.id].remainingTimeCapacity,
     currentLoad:current[member.id],projectedLoad:projected[member.id],delta:roundHours(projected[member.id]-current[member.id]),
     availableHours:roundHours(snapshot.members[member.id].remainingTimeCapacity-projected[member.id])}])),currentLoad:current,projectedLoad:projected,
   totalCurrentHours:roundHours(Object.values(current).reduce((a,b)=>a+b,0)),totalProjectedHours:roundHours(Object.values(projected).reduce((a,b)=>a+b,0))}
}
