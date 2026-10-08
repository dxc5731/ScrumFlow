import type { MeetingContext, ProjectDataState } from "../types"
import { projectPlanCapacity, storyRemainingEstimate } from "./meetingCapacity"

/** Only send project facts and the current discussion; never workspace settings or file bytes. */
export function projectFactsForModel(state: ProjectDataState, context: MeetingContext) {
  const focusedIds = context.focusStoryIds.length ? context.focusStoryIds : context.focusSprintId
    ? Object.values(state.stories).filter(story => story.sprintId === context.focusSprintId).map(story => story.id) : []
  const stories = Object.values(state.stories).filter(story => !focusedIds.length || focusedIds.includes(story.id)).slice(0, 120)
  const storyIds = new Set(stories.map(story => story.id))
  const tasks = Object.values(state.tasks).filter(task => storyIds.has(task.storyId)).slice(0, 240)
  const taskIds = new Set(tasks.map(task => task.id))
  if (context.digitalMemberId) {
    const memberId=context.digitalMemberId
    const own=Object.values(state.tasks).filter(task=>task.assigneeId===memberId||task.subtaskIds.some(id=>state.subtasks[id]?.assigneeId===memberId))
    const relatedIds=new Set([...own.map(task=>task.id),...tasks.map(task=>task.id)])
    const dependencies=Object.values(state.dependencies).filter(edge=>relatedIds.has(edge.targetTaskId))
    const upstream=new Set(dependencies.map(edge=>edge.sourceTaskId))
    return {project:{id:state.project.id,name:state.project.name},asOf:new Date().toLocaleDateString('sv-SE'),
      relatedMembers:Object.values(state.members).map(member=>({id:member.id,name:member.name,role:member.role})),
      digitalMember:state.members[memberId],identity:{memberId,memberName:state.members[memberId]?.name,writePermission:false},
      ownTasks:own,ownSprintTasks:own.filter(task=>state.stories[task.storyId]?.sprintId===context.focusSprintId),
      ownOtherSprintTasks:own.filter(task=>state.stories[task.storyId]?.sprintId!==context.focusSprintId),focusTasks:tasks,upstreamTasks:Object.values(state.tasks).filter(task=>upstream.has(task.id)),dependencies,
      dependencyRelations:dependencies.map(edge=>({source:state.tasks[edge.sourceTaskId]?.title,target:state.tasks[edge.targetTaskId]?.title,targetStoryId:state.tasks[edge.targetTaskId]?.storyId})),
      focusedBlockers:dependencies.filter(edge=>context.focusStoryIds.includes(state.tasks[edge.targetTaskId]?.storyId)).map(edge=>({source:state.tasks[edge.sourceTaskId]?.title,target:state.tasks[edge.targetTaskId]?.title})),
      subtasks:Object.values(state.subtasks).filter(step=>step.assigneeId===memberId),sprints:Object.values(state.sprints),
      capacity:projectPlanCapacity(state,context.focusSprintId,[]).members[memberId],scope:context.focus,
      coverage:{type:'self_and_focus',completeProjectGraph:false}}
  }
  return {
    project: state.project, asOf: new Date().toLocaleDateString("sv-SE"),
    scope: focusedIds.length ? { storyIds: focusedIds } : { projectId: state.project.id },
    members: Object.values(state.members), sprints: Object.values(state.sprints),
    activities: Object.values(state.activities), userTasks: Object.values(state.userTasks), epics: Object.values(state.epics),
    stories, tasks, subtasks: Object.values(state.subtasks).filter(item => taskIds.has(item.taskId)),
    acceptanceCriteria: Object.values(state.acceptanceCriteria).filter(item => storyIds.has(item.storyId)),
    dependencies: Object.values(state.dependencies),
    dependencyTasks: Object.values(state.tasks).map(task=>({id:task.id,title:task.title,storyId:task.storyId,startDate:task.startDate,endDate:task.endDate,status:task.status})),
    storyEstimates: stories.map(story=>({storyId:story.id,...storyRemainingEstimate(state,story.id)})),
    capacity: projectPlanCapacity(state,context.focusSprintId,context.activePlan?.tasks??[],new Date(),context.activePlan?.subtasks),
    risks: Object.values(state.risks).filter(item => !focusedIds.length || storyIds.has(item.targetId) || taskIds.has(item.targetId)),
    assets: Object.values(state.assets).map(item => ({ id: item.id, name: item.name, links: item.links })).slice(-20),
    constraints: context.constraints, activePlan: context.activePlan,
    planOptions: context.planning.options.map(option=>({id:option.id,title:option.title})),
    pendingProposal: context.activeProposalId ? state.proposals[context.activeProposalId] : null,
    coverage: { totalStories: Object.keys(state.stories).length, includedStories: stories.length, includedTasks: tasks.length },
  }
}
