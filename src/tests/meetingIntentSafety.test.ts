import { beforeEach, describe, expect, it, vi } from "vitest"
import { usePlanningFixtureClock } from "./planningFixtureClock"
import { coordinateMeetingTurn } from "../agents/meetingDecision"
import { asksForNewWork, memoryFor, understandMeetingTurn } from "../agents/meetingContext"
import { meetingHandoff, requestsPlanReview } from "../agents/meetingHandoff"
import { isMaterialFollowUp, isMaterialRequest } from "../agents/materialSchema"
import { generateMeetingMaterials } from "../agents/materialOrganizer"
import { mergeMeetingConstraints } from "../agents/meetingWorkingState"
import { analyzeMeetingAgent } from "../agents/meetingConversation"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"
import type { MeetingLlm } from "../agents/meetingLlm"

vi.mock("../agents/materialOrganizer", () => ({ generateMeetingMaterials: vi.fn(async () => ({
  agentType: "material_organizer", content: "材料已生成", evidence: [], rawEvidence: [],
})) }))
usePlanningFixtureClock()
const offline: MeetingLlm = { interpret: async () => null, explain: async () => null }
const businessState = () => {
  const s = useProjectStore.getState()
  return JSON.stringify([s.tasks, s.subtasks, s.proposals, s.assets, s.history])
}

describe("request polarity across meeting entry points", () => {
  beforeEach(() => { resetProjectStoreForTests(); vi.clearAllMocks() })

  it.each([
    "你不要对任何任务做修改，只回答还能再接 8h 吗？",
    "你无需再帮我修改任务，只回答还能再接 8h 吗？",
    "你先别把任务状态改成完成，只回答还能再接 8h 吗？",
    "你不能擅自更新任务，只回答还能再接 8h 吗？",
    "你不需要修改任务，只回答还能再接 8h 吗？",
    "你不要修改、更新或删除任务，只回答还能再接 8h 吗？",
    "你不用修改任务, 只回答还能再接 8h 吗?",
    "你能再接 8h 吗？如果把任务修改为完成，会影响统计吗？",
    "刚才有人说“你把任务标记完成”，我只问你还能再接 8h 吗？",
    "你不修改任务的前提下还能再接 8h 吗？",
    "你不得擅自修改任务，只回答还能再接 8h 吗？",
    "你修改了哪些任务？现在还能再接 8h 吗？",
    "我没有要求你修改任务，只问你还能再接 8h 吗？",
    "你不要修改，更新或删除任务，只回答还能再接 8h 吗？",
    "修改任务先不要做，只回答还能再接 8h 吗？",
    "你把任务改成完成了吗？现在还能再接 8h 吗？",
    "帮我看看修改记录，告诉我还能再接 8h 吗？",
  ])("answers the member question without inventing a write request: %s", async input => {
    const s = useProjectStore.getState(), meeting = s.createMeeting("sprint", "s3")
    const before = businessState()
    const result = await coordinateMeetingTurn(s, meeting, "auto", `@陈林 ${input}`, offline)
    expect(result.digitalMemberId).toBe("m3")
    expect(result.answer.content).toContain("未完成工作")
    expect(result.answer.content).not.toContain("先不替你改")
    expect(result.answer.proposal).toBeUndefined()
    expect(businessState()).toBe(before)
  })

  it.each([
    "不要修改负责人但请把任务标记为完成",
    "不要修改负责人，但是请直接更新任务状态",
    "你不需要修改负责人；请把任务标记为完成",
  ])("retains a separate affirmative command: %s", async input => {
    const s = useProjectStore.getState(), meeting = s.createMeeting("sprint", "s3")
    const result = await coordinateMeetingTurn(s, meeting, "auto", `@陈林 ${input}`, offline)
    expect(result.answer.content).toContain("先不替你改")
    expect(result.answer.proposal).toBeUndefined()
  })

  it.each([
    ["不要新增工程任务，但请补充两个子任务", true],
    ["新增两个测试子任务，不要重复创建", true],
    ["先生成两个子任务的待审核建议，不应用", true],
    ["不要对现有工作进行任何新增任务操作", false],
    ["假设新增两个子任务，会增加多少工作量？", false],
    ["请解释‘新增两个任务’是什么意思", false],
    ["先不要生成建议，只讨论新增任务的影响", false],
    ["请生成一个子任务不要导出 Excel", true],
  ] as const)("distinguishes a new-work request from a mention: %s", (input, expected) => {
    expect(asksForNewWork(input)).toBe(expected)
  })

  it.each([
    ["不要导出 Excel，只查看任务进度", false],
    ["无需再帮我生成文档，先分析风险", false],
    ["如果生成报告会包含什么？", false],
    ["解释一下‘生成报告’这个功能", false],
    ["不要生成 Word，但请导出 Excel", true],
    ["不要生成 Word，导出 Excel 或下载报告，只查看状态", false],
    ["生成报告这件事先不要做", false],
    ["可以导出报告吗？", false],
    ["我没有让你生成报告", false],
    ["请生成“测试报告”", true],
    ["请生成一个子任务不要导出 Excel", false],
  ] as const)("requires a current affirmative material request: %s", (input, expected) => {
    expect(isMaterialRequest(input)).toBe(expected)
  })

  it.each(["这份文档不要改标题", "不用再具体", "请勿登记风险", "这张图为什么要重新生成？"])("does not revive negated follow-ups: %s", input => {
    expect(isMaterialFollowUp(input)).toBe(false)
  })

  it.each([
    "不要对刚才的方案执行任何操作，先比较风险",
    "先不执行方案 A，只说明影响",
    "假设按方案 A 执行，会有什么风险？",
    "请解释‘按方案 A 执行’是什么意思",
  ])("does not promote forbidden or hypothetical execution via hints or specialist: %s", input => {
    const s = useProjectStore.getState(), meeting = s.createMeeting("story", "us030")
    expect(requestsPlanReview(input)).toBe(false)
    expect(meetingHandoff(input)).not.toBe("plan_execution")
    const understood = understandMeetingTurn(s, meeting, input, "plan_execution", { intent: "execute", selectedOptionId: "A" })
    expect(understood.intent).not.toBe("execute")
  })

  it("does not negate an affirmative review request merely because Apply is forbidden", () => {
    expect(requestsPlanReview("按方案 A 生成待审核建议，先不应用")).toBe(true)
  })

  it.each(["当前执行情况", "说说已执行结果", "解释执行步骤", "先讨论方案 A，不提交审核"])("does not treat execution terminology as a review command: %s", input => {
    expect(requestsPlanReview(input)).toBe(false)
  })

  it("keeps a negated assignment out of persistent plan constraints", () => {
    const s = useProjectStore.getState(), meeting = s.createMeeting("story", "us024")
    const memory = memoryFor(meeting)
    const understood = understandMeetingTurn(s, meeting, "第一个任务不要交给陈林，只查看任务状态", null)
    expect(understood.constraints.assignmentOverrides).toEqual({})
    const tasks = [{ key: "fe-024-2" }] as Parameters<typeof mergeMeetingConstraints>[3]
    expect(mergeMeetingConstraints(memory.constraints, "第一个任务不要交给陈林", s, tasks).assignmentOverrides).toEqual({})
  })

  it("keeps affirmative constraints before a separate forbidden edit", () => {
    const s = useProjectStore.getState(), meeting = s.createMeeting("story", "us030")
    const result = understandMeetingTurn(s, meeting, "总工时改成 18h 不要调整负责人", null)
    expect(result.constraints.maxTotalHours).toBe(18)
    expect(result.constraints.assignmentOverrides).toEqual({})
  })

  it.each(["不要把人数改成三个人", "请解释‘李娜不能参与’是什么意思", "请解释‘第一个任务换给陈林’是什么意思", "总工时不要改成 18h", "工期不要改成五天", "不要把李娜改成只能做测试"])("preserves constraints when they are forbidden or only quoted: %s", input => {
    const s = useProjectStore.getState(), meeting = s.createMeeting("story", "us030"), memory = memoryFor(meeting)
    const result = understandMeetingTurn(s, meeting, input, null, { intent: "execute", maxPeople: 3, memberName: "陈林" })
    expect(result.constraints.maxPeople).toBe(memory.constraints.maxPeople)
    expect(result.constraints.excludedMemberIds).toEqual(memory.constraints.excludedMemberIds)
    expect(result.constraints.assignmentOverrides).toEqual(memory.constraints.assignmentOverrides)
    expect(result.constraints.maxTotalHours ?? null).toBe(memory.constraints.maxTotalHours ?? null)
    expect(result.constraints.maxDays).toBe(memory.constraints.maxDays)
    expect(result.constraints.testOnlyMemberIds).toEqual(memory.constraints.testOnlyMemberIds)
  })

  it.each(["auto", "plan_execution"] as const)("does not create a proposal from a read-only follow-up through %s", async agent => {
    const s = useProjectStore.getState(), meeting = s.createMeeting("story", "us030")
    const planned = await coordinateMeetingTurn(s, meeting, "task_decomposition", "按两个人并行拆解", offline)
    planned.memory.currentTopic = "execute"
    planned.memory.workingState!.activeAgent = "plan_execution"
    const before = businessState()
    const result = await coordinateMeetingTurn(s, { ...meeting, memory: planned.memory }, agent,
      "不要对方案 A 执行任何操作，只比较风险，不生成建议。", { ...offline, interpret: async () => ({ intent: "execute", selectedOptionId: "A" }) })
    expect(result.resolvedIntent).not.toBe("execute")
    expect(result.answer.proposal).toBeUndefined()
    expect(businessState()).toBe(before)
  })

  it.each(["auto", "material_organizer"] as const)("does not generate files from a prohibition through %s", async agent => {
    const s = useProjectStore.getState(), meeting = s.createMeeting("story", "us024"), memory = memoryFor(meeting)
    memory.workingState!.activeAgent = "material_organizer"
    memory.lastAgentType = "material_organizer"
    const before = businessState()
    const result = await coordinateMeetingTurn(s, { ...meeting, memory }, agent,
      "这份文档不要重新生成，只查看当前任务状态。", offline)
    expect(generateMeetingMaterials).not.toHaveBeenCalled()
    expect(result.resolvedIntent).not.toBe("materials")
    expect(businessState()).toBe(before)
  })

  it.each(["task_decomposition", "risk_dependency", "workload_capacity", "plan_execution"] as const)("also guards the legacy specialist entry point: %s", agent => {
    const s = useProjectStore.getState(), meeting = s.createMeeting("story", "us030")
    const before = businessState()
    const result = analyzeMeetingAgent(s, meeting, agent, "不要新增或调整任务，不生成行动建议，也不要执行方案，只查看现有工作。")
    expect(result.proposal).toBeUndefined()
    expect(businessState()).toBe(before)
  })

  it("does not create a risk proposal merely because risk registration is prohibited", () => {
    const s = useProjectStore.getState(), meeting = s.createMeeting("story", "us024")
    expect(analyzeMeetingAgent(s, meeting, "risk_dependency", "请勿登记或处理风险，只说明现状").proposal).toBeUndefined()
  })
})
