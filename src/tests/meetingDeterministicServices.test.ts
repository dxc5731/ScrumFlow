import { beforeEach, describe, expect, it } from "vitest"
import { projectDependencyGraph, simulateDelay, validateDependencyRemoval } from "../agents/projectDependencyGraph"
import { projectPlanCapacity, storyRemainingEstimate } from "../agents/meetingCapacity"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"

describe("project graph and capacity services",()=>{
 beforeEach(()=>resetProjectStoreForTests())
 it("traverses the registered graph across Stories without mutating delay baselines",()=>{
  const state=useProjectStore.getState(), original=JSON.stringify([state.tasks,state.dependencies])
  const baseline={...state,dependencies:{...state.dependencies,'unit-cross-edge':{id:'unit-cross-edge',sourceTaskId:'fe-025-1',targetTaskId:'test-025',type:'FS' as const,createdAt:'2026-10-03T00:00:00Z'}}}
  const graph=projectDependencyGraph(baseline)
  expect(graph.traverseSuccessors('data-024').taskIds).toContain('test-025')
  const one=simulateDelay('data-024',1,state),two=simulateDelay('data-024',2,state)
  expect(one.baselineDate).toBe(two.baselineDate)
  expect(one.affectedTasks.find(t=>t.taskId==='fe-025-1')!.projectedDate).not.toBe(two.affectedTasks.find(t=>t.taskId==='fe-025-1')!.projectedDate)
  expect(JSON.stringify([state.tasks,state.dependencies])).toBe(original)
  expect(validateDependencyRemoval(state,'data-024','incoming')).toMatchObject({valid:false,candidates:[]})
 })
 it("uses a net reassignment delta, with separate units and unknown estimates",()=>{
  const base=useProjectStore.getState(), task={...base.tasks['data-024'],subtaskIds:[]}
  // 转派叶子任务会改变实际执行负载；仅修改 WBS 父任务负责人不会转派子任务。
  const state={...base,tasks:{...base.tasks,[task.id]:task}}
  const plan=[{key:task.id,sourceTaskId:task.id,storyId:task.storyId,title:task.title,type:task.type,estimate:task.estimate,assigneeId:'m3',phase:'test',dependsOnKeys:[],subtaskTitles:[],startDate:task.startDate,endDate:task.endDate}]
  const capacity=projectPlanCapacity(state,'s2',plan,new Date('2026-10-03T12:00:00+08:00'))
  expect(capacity.totalProjectedHours).toBe(capacity.totalCurrentHours)
  expect(capacity.members.m3.delta).toBeGreaterThan(0)
  expect(capacity.sprintCapacity.unit).toBe('story_points')
  expect(capacity.remainingWorkingDays).toBe(0)
  expect(storyRemainingEstimate(state,'cand-005')).toEqual({status:'UNKNOWN',hours:null})
 })
})
