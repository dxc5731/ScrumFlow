import { addBusinessDays, differenceInBusinessDays, format, parseISO, startOfDay } from "date-fns"
import type { MeetingPlanTask, PlanOption, ProjectDataState, TaskEntity } from "../types"

export function taskContributions(state: ProjectDataState, task: TaskEntity): Record<string,number> {
 if (task.status === "done") return {}
 const leaves = task.subtaskIds.length ? task.subtaskIds.map(id=>state.subtasks[id]).filter(Boolean) : [task]
 const result: Record<string,number> = {}
 for (const leaf of leaves) if (leaf.status !== "done") result[leaf.assigneeId]=(result[leaf.assigneeId]??0)+leaf.estimate
 return result
}
export function storyRemainingEstimate(state: ProjectDataState, storyId: string): { status:"KNOWN"|"UNKNOWN"; hours:number|null } {
 const tasks = state.stories[storyId]?.taskIds.map(id=>state.tasks[id]).filter(Boolean) ?? []
 return tasks.length ? {status:"KNOWN",hours:tasks.reduce((sum,task)=>sum+Object.values(taskContributions(state,task)).reduce((a,b)=>a+b,0),0)} : {status:"UNKNOWN",hours:null}
}
export function projectPlanCapacity(state: ProjectDataState, sprintId: string|null, tasks:MeetingPlanTask[], today = new Date(), steps: PlanOption['subtasks'] = []) {
 const sprint = sprintId ? state.sprints[sprintId] : null
 const asOf = format(today,"yyyy-MM-dd")
 const start = sprint && sprint.startDate>asOf ? parseISO(sprint.startDate) : startOfDay(today)
 const days = sprint && sprint.status!=="closed" ? Math.max(0,differenceInBusinessDays(addBusinessDays(parseISO(sprint.endDate),1),start)) : 0
 const current = Object.fromEntries(Object.keys(state.members).map(id=>[id,0])) as Record<string,number>
 for (const task of Object.values(state.tasks)) if (state.stories[task.storyId]?.sprintId === sprintId)
   for (const [id,hours] of Object.entries(taskContributions(state,task))) current[id]=(current[id]??0)+hours
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
       projected[task.assigneeId] = (projected[task.assigneeId] ?? 0) + step.estimate
     for (const step of proposed) projected[step.assigneeId] = (projected[step.assigneeId] ?? 0) + step.estimate
   } else {
     const hours = old?.subtaskIds.length ? Object.values(contribution).reduce((a,b)=>a+b,0) : old?.status==='done' ? 0 : task.estimate
     projected[task.assigneeId]=(projected[task.assigneeId]??0)+hours
   }
 }
 return {sprintId,asOf,remainingWorkingDays:days,
   sprintCapacity:{value:sprint?.capacity??null,unit:"story_points" as const},
   members:Object.fromEntries(Object.values(state.members).map(member=>[member.id,{memberId:member.id,memberName:member.name,
     nominalWeeklyHours:member.capacityHours,timeWindowCapacityHours:member.capacityHours/5*days,
     currentLoad:current[member.id],projectedLoad:projected[member.id],delta:projected[member.id]-current[member.id],
     availableHours:member.capacityHours/5*days-projected[member.id]}])),currentLoad:current,projectedLoad:projected,
   totalCurrentHours:Object.values(current).reduce((a,b)=>a+b,0),totalProjectedHours:Object.values(projected).reduce((a,b)=>a+b,0)}
}
