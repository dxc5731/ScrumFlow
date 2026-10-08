import { describe, expect, it } from "vitest"
import { routeMeetingModel } from "../../server/meetingModelRouting"

const constrained = { constraints: { maxPeople: 2, maxDays: 3, excludedMemberIds: ["m2"] }, tasks: Array.from({ length: 30 }, (_, id) => ({ id })) }
describe("agent and current task model selection", () => {
  it.each([
    ["project_orchestrator", "当前项目进度是多少", "flash", "none"],
    ["project_orchestrator", "分析项目延期原因并建议下一轮优先级", "pro", "high"],
    ["task_decomposition", "列出当前任务和子任务状态", "flash", "none"],
    ["task_decomposition", "拆解这条需求，说明每项任务的验收边界", "pro", "high"],
    ["risk_dependency", "列出哪些风险还未关闭", "flash", "none"],
    ["risk_dependency", "接口晚两天会影响哪些依赖，请推演缓解方案", "pro", "high"],
    ["workload_capacity", "王晨还剩多少工时，谁超载了", "flash", "none"],
    ["workload_capacity", "比较成员当前剩余工时，谁最多", "flash", "none"],
    ["workload_capacity", "比较不同分配方案并优化成员负载", "pro", "high"],
    ["plan_execution", "就按方案A整理执行建议和待审核行动项", "flash", "none"],
    ["plan_execution", "调整工期后是否可行，需要重新分配吗", "flash", "none"],
    ["数字成员：张伟", "你现在有哪些任务", "flash", "none"],
    ["数字成员：张伟", "分析接手这项任务会不会影响原有交付", "flash", "low"],
    ["project_orchestrator", "两人三天能按时交付吗", "flash", "low"],
  ])("%s: %s", (speaker, question, tier, effort) => {
    const result = routeMeetingModel("explain", { speaker, question })
    expect(result.tier).toBe(tier)
    expect(result.effort).toBe(effort)
  })
  it("keeps lookups fast despite complex history and a large constrained project", () => {
    const result = routeMeetingModel("explain", { speaker: "workload_capacity", question: "当前剩余多少工时", projectFacts: constrained,
      recentMessages: [{ content: "全面分析全项目最优排期，必须深入论证" }] })
    expect(result).toMatchObject({ tier: "flash", effort: "none" })
  })
  it("reserves max reasoning for genuinely difficult planning", () => {
    expect(routeMeetingModel("explain", { speaker: "workload_capacity", question: "在已说明的人数与工期约束下优化方案", projectFacts: constrained }))
      .toMatchObject({ tier: "pro", effort: "high" })
    expect(routeMeetingModel("explain", { speaker: "workload_capacity", question: "全面分析全项目最优排期方案", projectFacts: constrained }))
      .toMatchObject({ tier: "pro", effort: "max" })
  })
  it("parses intent quickly even when the final task needs Pro", () => {
    expect(routeMeetingModel("interpret", { question: "制作全套课程成果包并全面分析风险" })).toMatchObject({ tier: "flash", effort: "none" })
  })
  it("distinguishes a small leaf addition from a complete WBS", () => {
    expect(routeMeetingModel("draft_work", { speaker: "plan_execution", question: "新增一个测试子任务，2h", parentType: "task", eligibleParents: [{ id: "t1" }] }))
      .toMatchObject({ tier: "flash", effort: "low", reason: "execution_action_draft" })
    expect(routeMeetingModel("draft_work", { question: "新增两条子任务", parentType: "task", eligibleParents: [{ id: "t1" }] }))
      .toMatchObject({ tier: "flash", effort: "low" })
    expect(routeMeetingModel("draft_work", { question: "新增两条子任务", parentType: "task", eligibleParents: [{ id: "t1" }], projectFacts: constrained }))
      .toMatchObject({ tier: "pro", effort: "high" })
    expect(routeMeetingModel("draft_work", { question: "拆解新需求", parentType: "story", eligibleParents: [{ id: "s1" }] }))
      .toMatchObject({ tier: "pro", effort: "high" })
    for (const question of ["新增11个子任务", "新增十二个子任务"]) expect(routeMeetingModel("draft_work", { question, parentType: "task", eligibleParents: [{ id: "t1" }] }))
      .toMatchObject({ tier: "pro", effort: "high" })
  })
  it("creates real materials with Pro and only uses Flash for edits of existing content", () => {
    expect(routeMeetingModel("materials", { question: "画系统用例图" })).toMatchObject({ tier: "pro", effort: "high" })
    expect(routeMeetingModel("materials", { question: "生成完整课程作业成果包" })).toMatchObject({ tier: "pro", effort: "max" })
    expect(routeMeetingModel("materials", { question: "只改标题", priorArtifacts: ["existing report"] })).toMatchObject({ tier: "flash", effort: "low" })
    expect(routeMeetingModel("materials", { question: "只改标题" })).toMatchObject({ tier: "pro" })
  })
  it("distinguishes syntax repair from diagram semantics", () => {
    expect(routeMeetingModel("repair_diagram", { source: "flowchart LR\nA-->B", error: "Unexpected token" })).toMatchObject({ tier: "flash", effort: "low" })
    expect(routeMeetingModel("repair_diagram", { source: "flowchart LR\nA-->B", error: "用例图须使用原生参与者和系统边界" })).toMatchObject({ tier: "pro", effort: "high" })
  })
})
