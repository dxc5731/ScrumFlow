import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { asksForExistingTaskStatus, asksForNewWork, memoryFor } from "../agents/meetingContext"
import { coordinateMeetingTurn } from "../agents/meetingDecision"
import { meetingHandoff } from "../agents/meetingHandoff"
import { createPlanOptions } from "../agents/meetingPlanning"
import { validatePlanAgainstConstraints } from "../agents/meetingConstraintValidator"
import { mergeMeetingConstraints } from "../agents/meetingWorkingState"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"
import type { MeetingLlm } from "../agents/meetingLlm"

const draftQuestion = "看一下 US030 现有任务和子任务，只把尚未覆盖的工作拆细，别重复创建。先按两个人安排，给我工时、负责人和前置关系，暂时不要执行。"
const reviewQuestion = "刚才方案改成三个人参与，但不要让李娜负责测试，陈林也不能超过未来五个工作日的剩余容量。保留合理的已有拆分，说明调整前后的差异，再进入审核。"
const offline: MeetingLlm = { interpret: async () => null, explain: async () => null }

describe("revise a discussed plan before review", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-01T09:00:00+08:00")); resetProjectStoreForTests() })
  afterEach(() => vi.useRealTimers())

  it("answers a direct Story status question without inheriting the previous review intent", async () => {
    const store = useProjectStore.getState()
    store.createTask("us030", { title: "验收记录接口", type: "backend", estimate: 2, assigneeId: "m3" })
    const session = store.createMeeting("story", "us030")
    session.memory = { ...memoryFor(session), currentTopic: "execute" }
    const result = await coordinateMeetingTurn(useProjectStore.getState(), session, "project_orchestrator", "US030 当前状态是什么？先不修改。", offline)
    expect(result.resolvedIntent).not.toBe("execute")
    expect(result.answer.content).toContain("验收记录接口")
    expect(result.answer.proposal).toBeUndefined()
    expect(result.answer.agentType).not.toBe("plan_execution")
  })

  it("treats avoiding duplicate work and postponing execution as constraints, not a status query", async () => {
    expect(asksForNewWork(draftQuestion)).toBe(true)
    expect(asksForExistingTaskStatus(draftQuestion)).toBe(false)
    const store = useProjectStore.getState()
    const task = store.createTask("us030", { title: "验收记录接口", type: "backend", estimate: 2, assigneeId: "m3" })
    const session = store.createMeeting("story", "us030")
    const model = { ...offline, draftWork: vi.fn(async () => JSON.stringify({ summary: "补充尚未覆盖的校验步骤", items: [
      { parentType: "task", parentId: task.id, title: "补充验收结果字段校验", estimate: 1, assigneeId: "m2" },
      { parentType: "task", parentId: task.id, title: "实现验收记录读取接口", estimate: 1, assigneeId: "m3" },
    ] })) }
    const before = structuredClone(useProjectStore.getState().tasks)
    const result = await coordinateMeetingTurn(useProjectStore.getState(), session, "task_decomposition", draftQuestion, model)
    expect(model.draftWork).toHaveBeenCalledOnce()
    expect(result.resolvedIntent).toBe("create_work")
    expect(result.memory.options.length).toBeGreaterThan(0)
    expect(result.answer.proposal?.actions).toHaveLength(2)
    expect(useProjectStore.getState().tasks).toEqual(before)
    expect(result.answer.proposal?.actions.every(action => action.status === "pending")).toBe(true)
    for (const text of ["不要拆细现有任务，只查看进度", "先不新增任务，看看当前任务", "不用添加任务"])
      expect(asksForNewWork(text)).toBe(false)
  })

  it("recovers the missing plan from current work and either submits a valid revision or explains actual constraints", async () => {
    const store = useProjectStore.getState()
    store.createTask("us030", { title: "验收结果记录", type: "backend", estimate: 2, assigneeId: "m3" })
    store.createTask("us030", { title: "验收操作界面", type: "frontend", estimate: 2, assigneeId: "m2" })
    store.createTask("us030", { title: "验收退回测试", type: "test", estimate: 2, assigneeId: "m1" })
    const session = store.createMeeting("story", "us030")
    expect(meetingHandoff(reviewQuestion)).toBe("task_decomposition")
    expect(meetingHandoff("那就按刚才方案进入审核")).toBe("plan_execution")
    const before = structuredClone(useProjectStore.getState().tasks)
    const result = await coordinateMeetingTurn(useProjectStore.getState(), session, "project_orchestrator", reviewQuestion, offline)
    expect(result.answer.content).not.toContain("先讨论一个具体执行方案")
    expect(result.answer.content).toContain("以当前项目任务为基础")
    expect(result.memory.options.length).toBeGreaterThan(0)
    expect(result.memory.constraints.requiredPeople).toBe(3)
    expect(result.memory.constraints.excludedMemberIds).not.toContain("m2")
    expect(result.memory.constraints.memberRules?.m2.allowedTaskTypes).not.toContain("test")
    expect(result.memory.constraints.memberRules?.m3.capacityWindowDays).toBe(5)
    const selected = result.memory.options.find(option => option.id === result.memory.activePlanId)!
    if (selected.feasible) {
      expect(result.completedAgents).toContain("plan_execution")
      expect(result.answer.content).not.toContain("确认方案 A 或 B")
    } else {
      expect(result.answer.proposal).toBeUndefined()
      expect(result.answer.content).toContain(selected.infeasibleReasons[0])
    }
    expect(useProjectStore.getState().tasks).toEqual(before)
  })

  it("inherits the previous draft when revising, without creating duplicate work", async () => {
    const store = useProjectStore.getState(), session = store.createMeeting("story", "us030")
    const state = useProjectStore.getState(), memory = memoryFor(session)
    memory.options = createPlanOptions(state, session, memory)
    memory.activePlanId = "A"
    const keys = memory.options[0].tasks.map(task => task.key)
    const result = await coordinateMeetingTurn(state, { ...session, memory }, "project_orchestrator", reviewQuestion, offline)
    expect(result.memory.options[0].tasks.map(task => task.key)).toEqual(keys)
    expect(result.answer.content).toContain("保留")
    expect(result.answer.content).not.toContain("先讨论一个具体执行方案")
    expect(result.answer.content).not.toContain("上一轮只列出了现有工作")
  })

  it("deducts other commitments from a member's five-day window instead of treating it as five free days", () => {
    const store = useProjectStore.getState()
    store.createTask("us030", { title: "验收结果记录", type: "backend", estimate: 2, assigneeId: "m3" })
    const session = store.createMeeting("story", "us030"), state = useProjectStore.getState(), memory = memoryFor(session)
    const plan = createPlanOptions(state, session, memory)[0]
    plan.tasks.forEach(task => { task.assigneeId = "m3" })
    const constraints = mergeMeetingConstraints(memory.constraints, "陈林不能超过未来五个工作日的剩余容量", state, plan.tasks)
    const occupied = { ...state, tasks: structuredClone(state.tasks) }
    occupied.tasks["be-024-1"].estimate = 80
    const check = validatePlanAgainstConstraints(plan, constraints, occupied)
    expect(check.violations.some(item => item.type === "memberRemainingCapacity")).toBe(true)
  })
})
