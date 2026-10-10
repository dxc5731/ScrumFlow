import type { ProjectDataState, ProposalAction } from '../types'

/** Pure simulation; virtual action IDs are resolved in the same way as the executor. */
export function projectReviewedActions(state: ProjectDataState, actions: ProposalAction[]): ProjectDataState {
 const next = { ...state, tasks: structuredClone(state.tasks), subtasks: structuredClone(state.subtasks),
  stories: structuredClone(state.stories), dependencies: structuredClone(state.dependencies) }
 const accepted=actions.filter(action=>action.decision==='accepted'&&action.status==='pending')
 for(const action of accepted){const value=structuredClone(action.proposedValue)
  if(action.actionType==='CREATE_TASK'){
   next.tasks[action.id]={...value,id:action.id,storyId:action.targetId,status:'todo',subtaskIds:[],blockReasons:[]} as unknown as typeof next.tasks[string]
   if(next.stories[action.targetId])next.stories[action.targetId].taskIds.push(action.id)
  }else if(action.actionType==='UPDATE_TASK'&&next.tasks[action.targetId])Object.assign(next.tasks[action.targetId],value)
  else if(action.actionType==='UPDATE_STORY'&&next.stories[action.targetId])Object.assign(next.stories[action.targetId],value)
 }
 for(const action of accepted){const value=structuredClone(action.proposedValue)
  if(action.actionType==='CREATE_SUBTASK'&&next.tasks[action.targetId]){
   next.subtasks[action.id]={...value,id:action.id,taskId:action.targetId,status:'todo'} as unknown as typeof next.subtasks[string]
   next.tasks[action.targetId].subtaskIds.push(action.id)
  }else if(action.actionType==='UPDATE_SUBTASK'&&next.subtasks[action.targetId])Object.assign(next.subtasks[action.targetId],value)
  else if(action.actionType==='ADD_DEPENDENCY')next.dependencies[action.id]={id:action.id,sourceTaskId:String(value.sourceTaskId),targetTaskId:String(value.targetTaskId),type:'FS',createdAt:''}
 }
 return next
}
