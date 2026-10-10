import type { MeetingContext, ProjectDataState } from "../types"

export interface MeetingReplyClaims {
 mutation?: {executed:boolean;proposalId?:string}
 assignments?: Array<{taskKey:string;memberId:string;memberName?:string;estimate?:number}>
 sourcePlanId?:string
 sourcePlanRevision?:number
}
export function validateReplyClaims(claims:MeetingReplyClaims,context:MeetingContext,state:ProjectDataState):string[] {
 const errors:string[]=[]
 if(claims.mutation?.executed && !['applied','partially_applied'].includes(state.proposals[claims.mutation.proposalId??'']?.status??'')) errors.push('unsupported_mutation')
 if(claims.sourcePlanId && claims.sourcePlanId!==context.activePlan?.planId) errors.push('stale_plan')
 if(claims.sourcePlanRevision!==undefined && claims.sourcePlanRevision!==context.activePlan?.revision) errors.push('stale_revision')
 for(const claim of claims.assignments??[]){
   const task=context.activePlan?.tasks.find(task=>task.key===claim.taskKey) ?? context.activePlan?.subtasks?.find(task=>task.key===claim.taskKey)
   if(!state.members[claim.memberId] || claim.memberName&&state.members[claim.memberId].name!==claim.memberName)errors.push('member_identity')
   if(!task || task.assigneeId!==claim.memberId || claim.estimate!==undefined&&task.estimate!==claim.estimate) errors.push('plan_assignment')
 }
 return errors
}
export function assertsCompletedMutation(content:string):boolean {
 for(const line of content.split(/[。；\n]/)){
   for(const match of line.matchAll(/(?:已成功|已经|现已|我已)(?:创建|添加|修改|写入|分配|更新)/g)){
     const prefix=line.slice(Math.max(0,match.index!-32),match.index!)
     if(/不能|不应|不可|没有|尚未|未曾|不要|假设|如果|需要.*审核|无法|未确认|不能声称/.test(prefix))continue
     return true
   }
 }
 return false
}
export function memberIdentityConflicts(content:string,state:ProjectDataState):boolean {
 return Object.values(state.members).some(member=>Object.values(state.members).some(other=>other.id!==member.id &&
   new RegExp(`${other.name}\\s*[（(]${member.id}[）)]`).test(content)))
}
