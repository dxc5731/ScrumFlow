import { usePlanningFixtureClock } from "./planningFixtureClock"

import { beforeEach, describe, expect, it } from "vitest"
import { createMeetingMemory } from "../agents/meetingContext"
import { commitPlanOptions, mergeMeetingConstraints, synchronizeWorkingState } from "../agents/meetingWorkingState"
import { coordinateMeetingTurn } from "../agents/meetingDecision"
import { createPlanOptions } from "../agents/meetingPlanning"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"
import type { MeetingLlm } from "../agents/meetingLlm"
import { openShowcaseV2Meeting } from "../agents/meetingShowcaseV2"

const offline: MeetingLlm = { interpret: async () => ({ intent: "other", maxPeople: 9 }), explain: async () => null }
usePlanningFixtureClock()

describe("canonical meeting state and plan revisions", () => {
 beforeEach(() => resetProjectStoreForTests())
 it("preserves the established reviewed showcase execution", async()=>{
  const id=await openShowcaseV2Meeting(),state=useProjectStore.getState(),meeting=state.meetingSessions[id]
  const systems=meeting.messageIds.map(key=>state.meetingMessages[key]).filter(message=>message.senderType==='system')
  expect(systems.some(message=>message.content.includes('已应用其余采纳项')),JSON.stringify({systems,options:meeting.memory?.options.map(option=>({feasible:option.feasible,reasons:option.infeasibleReasons})),constraints:meeting.memory?.constraints})).toBe(true)
 })
 it("incrementally merges subject-scoped constraints and removes excluded overrides", () => {
  const state = useProjectStore.getState(), memory = createMeetingMemory(), session = state.createMeeting("story", "us030")
  const tasks = createPlanOptions(state, session, memory)[0].tasks
  const first = mergeMeetingConstraints(memory.constraints, "US030 两个人，总工时最多16h。", state, tasks)
  expect(first.people).toEqual({ mode: "exact", count: 2 }); expect(first.maxTotalHours).toBe(16)
  const second = mergeMeetingConstraints(first, "改成三个人。李娜只能负责测试类工作，而且她最多只能投入3天；第三项任务交给陈林。", state, tasks)
  expect(second.people).toEqual({ mode: "exact", count: 3 })
  expect(second.memberRules?.m2).toEqual({ allowedTaskTypes: ["test"], maxDays: 3 })
  expect(second.maxDays).toBeNull(); expect(second.assignmentOverrides[tasks[2].key]).toBe("m3")
  const third = mergeMeetingConstraints(second, "陈林不要参与，其他条件不变。", state, tasks)
  expect(third.excludedMemberIds).toEqual(["m3"]); expect(third.assignmentOverrides[tasks[2].key]).toBeUndefined()
  expect(third.people).toEqual(second.people); expect(third.memberRules).toEqual(second.memberRules); expect(third.maxTotalHours).toBe(16)
  const fourth = mergeMeetingConstraints(third, "不要李娜", state, tasks)
  expect(fourth.excludedMemberIds).toEqual(["m3", "m2"])
 })
 it("distinguishes a maximum headcount and preserves immutable plan history", () => {
  const state = useProjectStore.getState(), session = state.createMeeting("story", "us030"), memory = createMeetingMemory()
  memory.focusStoryIds = ["us030"]; memory.constraints = mergeMeetingConstraints(memory.constraints, "最多两个人，总工时最多16h",state,[])
  expect(memory.constraints.requiredPeople).toBeNull()
  synchronizeWorkingState(memory,state,session); commitPlanOptions(memory,createPlanOptions(state,session,memory),state)
  const first = structuredClone(memory.workingState!.planRevisions[0])
  memory.constraints = mergeMeetingConstraints(memory.constraints,"不要李娜",state,memory.options[0].tasks)
  commitPlanOptions(memory,createPlanOptions(state,session,memory),state)
  expect(memory.workingState!.planRevisions[0]).toEqual(first)
  expect(memory.workingState!.activePlanRevision).toBe(2)
 })
 it("keeps explicit WBS routing and digital identity on follow-up", async () => {
  const state = useProjectStore.getState(), session = state.createMeeting("story","us030")
  const first = await coordinateMeetingTurn(state,session,"task_decomposition","生成WBS，两个人，总工时最多16h，不要陈林",offline)
  expect(first.answer.agentType).toBe("task_decomposition"); expect(first.resolvedIntent).toBe("plan")
  expect(first.memory.workingState!.constraints.excludedMemberIds).toContain("m3")
  expect(first.memory.workingState!.activePlanRevision).toBe(1)
  const member = await coordinateMeetingTurn(state,{...session,memory:first.memory},"auto","你现在还能接8h吗",offline,"m3")
  const follow = await coordinateMeetingTurn(state,{...session,memory:member.memory},"auto","只回答你自己的情况",offline)
  expect(follow.digitalMemberId).toBe("m3"); expect(follow.memory.workingState!.activeAgent).toBe("m3")
 })
})
