import { usePlanningFixtureClock } from "./planningFixtureClock"

import { beforeEach, describe, expect, it, vi } from "vitest"
import { asksForExistingTaskStatus, asksForNewWork, buildMeetingContext } from "../agents/meetingContext"
import { replyViolatesAssignments } from "../agents/meetingReplyValidation"
import { parseAgentMention } from "../agents/meetingConversation"
import { composerTokenAt, insertComposerReference } from "../agents/meetingMentions"
import { coordinateMeetingTurn } from "../agents/meetingDecision"
import type { MeetingLlm } from "../agents/meetingLlm"
import { isMaterialRequest, materialBundleSchema, validateDiagramSource } from "../agents/materialSchema"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"

const offline: MeetingLlm = { interpret: async () => null, explain: async () => null }
usePlanningFixtureClock()

describe("actual meeting requests", () => {
  beforeEach(() => resetProjectStoreForTests())
  it.each([
    "帮我为当前的任务添加合理的新子任务", "当前任务需要补充几个子任务", "请给这个任务增加执行步骤", "帮我创建三个任务", "新增一些工作项",
  ])("creation takes precedence over status: %s", question => {
    expect(asksForNewWork(question)).toBe(true)
    expect(asksForExistingTaskStatus(question)).toBe(false)
  })
  it.each(["不要强行生成子任务，只保留必要步骤", "先不新增任务，看看当前任务", "不用添加任务"])('respects negation: %s', question => expect(asksForNewWork(question)).toBe(false))
  it.each(["先看看这个问题，@计划落地 帮我添加子任务", "请@计划落地帮我增加子任务", "你好\n@计划落地 添加子任务", "你好＠计划落地，增加子任务"])('recognizes mentions anywhere: %s', input => {
    const parsed = parseAgentMention(input)
    expect(parsed.agentId).toBe("plan_execution")
    expect(parsed.question).not.toContain("@计划落地")
    expect(parsed.question).toMatch(/子任务/)
  })
  it("recognizes members and the old materials alias without swallowing prose", () => {
    const state = useProjectStore.getState()
    const member = Object.values(state.members)[0]
    expect(parseAgentMention(`这件事，@${member.name}你怎么看`, state).memberId).toBe(member.id)
    expect(parseAgentMention("先帮忙，@资料整理 导出Word").agentId).toBe("material_organizer")
    expect(parseAgentMention("a@AI.com 是邮箱").agentId).toBe("auto")
  })
  it("inserts a mid-sentence mention at the caret and preserves following text", () => {
    const draft = "请@任务 后面的需求不要丢失"
    const token = composerTokenAt(draft, 4)!
    const result = insertComposerReference(draft, token, "任务拆解")
    expect(result.text).toBe("请@任务拆解  后面的需求不要丢失")
    expect(composerTokenAt("请查看#US", 6)?.kind).toBe("entity")
    expect(composerTokenAt("test@example.com", 16)).toBeNull()
  })
  it("the screenshot request produces reviewable children and blocks new load in an expired Sprint", async () => {
    vi.setSystemTime(new Date("2026-10-03T10:00:00+08:00"))
    const state = useProjectStore.getState()
    const meeting = state.createMeeting("story", "us024")
    const parent = state.tasks["fe-024-2"]
    const initial = parent.subtaskIds.length
    const model: MeetingLlm = { ...offline, draftWork: async () => JSON.stringify({ summary: "补充甘特图缩放边界和键盘访问验证，工时为建议。", items: [
      { parentType: "task", parentId: parent.id, title: "验证甘特图缩放后任务日期边界", estimate: 2, assigneeId: parent.assigneeId },
      { parentType: "task", parentId: parent.id, title: "验证甘特图键盘选择与焦点恢复", estimate: 1, assigneeId: parent.assigneeId },
    ] }) }
    const result = await coordinateMeetingTurn(state, meeting, "plan_execution", "帮我为当前的任务添加合理的新子任务", model)
    expect(result.resolvedIntent).toBe("create_work")
    expect(result.completedAgents).toEqual(["plan_execution"])
    expect(result.answer.content).not.toContain("共有 5 个任务")
    const proposal = result.answer.proposal!
    expect(proposal.actions).toHaveLength(2)
    expect(useProjectStore.getState().tasks[parent.id].subtaskIds).toHaveLength(initial)
    state.setMeetingMemory(meeting.id, result.memory)
    state.saveProposal(proposal); state.linkMeetingProposal(meeting.id, proposal.id)
    for (const action of proposal.actions) state.setProposalDecision(proposal.id, action.id, "accepted")
    const applied = state.applyProposal(proposal.id)
    expect(applied.ok).toBe(false)
    expect(applied.message).toContain("超过剩余时间窗口容量")
    expect(useProjectStore.getState().tasks[parent.id].subtaskIds).toHaveLength(initial)
    expect(useProjectStore.getState().history.some(item => item.proposalId === proposal.id && item.objectType === "subtask")).toBe(false)
    expect(state.applyProposal(proposal.id).ok).toBe(false)
  })
  it("rejects hallucinated parents instead of attaching work to an arbitrary task", async () => {
    const state = useProjectStore.getState(), meeting = state.createMeeting("story", "us024")
    const result = await coordinateMeetingTurn(state, meeting, "plan_execution", "新增子任务", { ...offline, draftWork: async () => JSON.stringify({ summary: "新增工作", items: [{ parentType: "task", parentId: "missing", title: "不应创建的任务", estimate: 2, assigneeId: "m1" }] }) })
    expect(result.answer.proposal).toBeUndefined()
    expect(result.answer.content).toContain("范围外")
  })
  it("creates several new tasks for an existing Story only after review", async () => {
    const state = useProjectStore.getState()
    const story = state.createStory({title: "课程成果管理", source: "manual", storyPoints: 5})
    const meeting = state.createMeeting("story", story.id)
    const model: MeetingLlm = { ...offline, draftWork: async () => JSON.stringify({summary:"按成果管理的边界拆分，均为建议。",items:[
      {parentType:"story",parentId:story.id,title:"实现课程材料按项目筛选",estimate:2,assigneeId:"m1",type:"frontend"},
      {parentType:"story",parentId:story.id,title:"验证材料附件的下载完整性",estimate:2,assigneeId:"m4",type:"test"},
    ]})}
    const result = await coordinateMeetingTurn(useProjectStore.getState(), meeting, "plan_execution", "新增两个任务", model)
    const proposal = result.answer.proposal!
    expect(proposal.actions).toHaveLength(2)
    state.setMeetingMemory(meeting.id, result.memory)
    state.saveProposal(proposal); state.linkMeetingProposal(meeting.id, proposal.id)
    for(const action of proposal.actions) state.setProposalDecision(proposal.id, action.id, "accepted")
    const applied = state.applyProposal(proposal.id)
    expect(applied.ok, applied.message).toBe(true)
    expect(useProjectStore.getState().stories[story.id].taskIds).toHaveLength(2)
  })
  it("shows a model failure explicitly and does not invent a successful plan", async () => {
    const state = useProjectStore.getState(), meeting = state.createMeeting("story", "us024")
    const result = await coordinateMeetingTurn(state, meeting, "plan_execution", "新增子任务", offline)
    expect(result.answer.content).toContain("模型暂时不可用")
    expect(result.answer.proposal).toBeUndefined()
  })
  it("explicit member exclusions override a contradictory model hint and persist through execution", async () => {
    const state = useProjectStore.getState(), meeting = state.createMeeting("story", "us030")
    const first = await coordinateMeetingTurn(state, meeting, "task_decomposition", "按两个人并行拆解", offline)
    state.setMeetingMemory(meeting.id, first.memory)
    const model: MeetingLlm = { ...offline, interpret: async () => ({ memberName: "张伟", intent: "plan" }) }
    const changed = await coordinateMeetingTurn(useProjectStore.getState(), useProjectStore.getState().meetingSessions[meeting.id], "auto", "李娜不能参与，请重新考虑分工", model)
    expect(changed.memory.constraints.excludedMemberIds).toContain("m2")
    expect(changed.memory.options.every(option => option.tasks.every(task => task.assigneeId !== "m2"))).toBe(true)
    state.setMeetingMemory(meeting.id, changed.memory)
    const executed = await coordinateMeetingTurn(useProjectStore.getState(), useProjectStore.getState().meetingSessions[meeting.id], "plan_execution", "就按方案 A 整理执行建议", offline)
    expect(executed.answer.proposal?.actions.every(action => action.proposedValue.assigneeId !== "m2")).toBe(true)
  })
  it("reads the referenced task's own subtasks", async () => {
    const state = useProjectStore.getState(), meeting = state.createMeeting("project", state.project.id)
    const result = await coordinateMeetingTurn(state, meeting, "auto", "#FE-024-2 查看当前任务的子任务和状态", offline)
    expect(result.answer.content).toContain(state.subtasks[state.tasks["fe-024-2"].subtaskIds[0]].title)
    expect(result.answer.content).not.toContain("共有 5 个任务")
  })
  it("accepts a model answer about one task without requiring every other task ID in the Story", async () => {
    const state = useProjectStore.getState(), meeting = state.createMeeting("project", state.project.id)
    const reply = "FE-024-2 的子任务为：" + state.tasks["fe-024-2"].subtaskIds.map(id => state.subtasks[id].title).join("、")
    const result = await coordinateMeetingTurn(state, meeting, "auto", "#FE-024-2 查看当前任务的子任务和状态", { ...offline, explain: async () => reply })
    expect(result.llmReplyUsed).toBe(true)
    expect(result.answer.content).toBe(reply)
  })
  it("rejects the observed three-person model allocation under a two-person limit", async () => {
    const state = useProjectStore.getState(), meeting = state.createMeeting("story", "us030")
    const first = await coordinateMeetingTurn(state, meeting, "task_decomposition", "按两个人并行拆解", offline)
    const context = buildMeetingContext(state, { ...meeting, memory: first.memory })
    context.constraints.excludedMemberIds = ["m2"]
    const observed = "| 任务 | 工时 | 原负责人 | 建议负责人 |\n|---|---|---|---|\n| 状态记录 | 3h | 张伟 | 陈林 |\n| 验收操作 | 3h | 李娜 | 王晨 |\n| 后续排期 | 5h | 张伟 | 张伟 |"
    expect(replyViolatesAssignments(observed, context, state)).toBe(true)
    expect(replyViolatesAssignments("- 张伟：5h\n- 陈林：3h\n- 王晨：8h", context, state)).toBe(true)
    expect(replyViolatesAssignments("李娜不能参与。当前可在张伟、陈林、王晨三人中分配。\n| 任务 | 原负责人 | 建议负责人 |\n|---|---|---|\n| 后端 | 张伟 | 陈林 |\n| 前端 | 李娜 | 王晨 |\n- 陈林：8h\n- 王晨：8h", context, state)).toBe(false)
    expect(replyViolatesAssignments("| 任务 | 负责人 |\n|---|---|\n| 前端 | 李娜 |", context, state)).toBe(true)
  })
  it.each(["risk_dependency", "workload_capacity"] as const)("%s answers at project scope without requiring a Story", async agent => {
    const state = useProjectStore.getState(), meeting = state.createMeeting("project", state.project.id)
    const result = await coordinateMeetingTurn(state, meeting, agent, agent === "risk_dependency" ? "整个项目最需要处理什么风险" : "所有成员谁超载了", offline)
    expect(result.answer.content).not.toContain("先用 #")
    expect(result.completedAgents).toContain(agent)
  })
  it.each(["project_orchestrator", "task_decomposition", "risk_dependency", "workload_capacity", "plan_execution"] as const)("%s consults the model for a contextual answer", async agent => {
    const state = useProjectStore.getState(), meeting = state.createMeeting("story", "us030")
    let calls = 0
    const model = { ...offline, explain: async () => { calls++; return "根据当前需求，我建议先核对验收边界，再处理具体的交付问题。" } }
    const result = await coordinateMeetingTurn(state, meeting, agent, "请说明你对当前工作的建议", model)
    expect(calls).toBe(1)
    expect(result.llmReplyUsed).toBe(true)
  })
})

describe("material routing and validation", () => {
  it.each(["给我画一个用例图", "生成项目管理作业成果包", "整理需求说明书和Excel台账", "展示甘特图", "给我看用户地图", "制作结题报告"])("routes %s to creation", q => expect(isMaterialRequest(q)).toBe(true))
  it.each(["甘特图这个任务为什么卡住", "FE-024-2 有什么风险", "总结刚才的讨论", "当前任务已经完成了几个"])("does not hijack %s", q => expect(isMaterialRequest(q)).toBe(false))
  it("rejects malformed workbook rows and unsafe diagrams", () => {
    expect(materialBundleSchema.safeParse({ title: "报告", summary: "说明", artifacts: [{ kind: "spreadsheet", title: "台账", sheets: [{ name: "任务", columns: ["ID", "工时"], rows: [["a"]] }] }] }).success).toBe(false)
    expect(() => validateDiagramSource('flowchart LR\n A-->B\n click A "https://example.com"')).toThrow()
    expect(validateDiagramSource('classDiagram\n Project --> Task')).toContain("classDiagram")
    expect(() => validateDiagramSource('flowchart LR\n A["用户"] --> B["登录"]', '系统用例图')).toThrow("原生参与者")
    expect(validateDiagramSource('usecase-beta\nactor PO("负责人")\nPO -- Review("审核")', '系统用例图')).toContain('usecase-beta')
    expect(validateDiagramSource('gantt\n dateFormat YYYY-MM-DD\n Gantt 导入 :task1, 2026-09-01, 2d')).toContain("工作项 · Gantt 导入")
  })
})
