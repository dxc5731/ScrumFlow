import { beforeEach, describe, expect, it } from "vitest"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"
import { asksForExistingTaskStatus, asksForNewWork, createMeetingMemory } from "../agents/meetingContext"
import { mergeMeetingConstraints } from "../agents/meetingWorkingState"
import { meetingSourceIds } from "../agents/meetingSource"
import { narrativeFingerprint } from "../agents/meetingNarrative"
import { estimateMeetingCost } from "../../server/meetingUsage"
import { routeMeetingModel } from "../../server/meetingModelRouting"

describe("defense meeting provenance and cost", () => {
  beforeEach(() => resetProjectStoreForTests())
  it("separates planning, estimate questions and human approval from new work creation", () => {
    expect(asksForExistingTaskStatus("拆成两个人的执行方案，复用现有四项任务")).toBe(false)
    expect(asksForNewWork("新步骤的工时是新增投入还是父任务估算内的分解？")).toBe(false)
    expect(asksForNewWork("只采纳两条新增步骤，其他安排先不应用")).toBe(false)
    expect(asksForNewWork("为 US030 新增两条具体执行步骤")).toBe(true)
  })
  it("inherits a member-specific test exclusion and five-workday limit without excluding the whole member", () => {
    const state = useProjectStore.getState()
    const first = mergeMeetingConstraints(createMeetingMemory().constraints, "改成三个人，但是不要让李娜负责测试。", state, [])
    const next = mergeMeetingConstraints(first, "陈林不要超过未来 5 个工作日的容量。", state, [])
    expect(next.people).toEqual({ mode: "exact", count: 3 })
    expect(next.excludedMemberIds).not.toContain("m2")
    expect(next.memberRules?.m2.allowedTaskTypes).not.toContain("test")
    expect(next.memberRules?.m3.maxDays).toBe(5)
  })
  it("uses only persisted source messages and keeps question/answer together", () => {
    const state = useProjectStore.getState(), session = state.createMeeting("project", state.project.id)
    const question = state.addMeetingMessage(session.id, { senderType: "user", senderId: "m1", content: "DATA-024 晚一天会怎样？" })
    const answer = state.addMeetingMessage(session.id, { senderType: "agent", senderId: "risk_dependency", content: "这是延期假设，正式日期未变。" })
    const live = useProjectStore.getState(), meeting = live.meetingSessions[session.id]
    const ids = meetingSourceIds(live, meeting, "没有项目对象的结论", [answer.id, "fake-id"])
    expect(ids).toContain(question.id); expect(ids).toContain(answer.id); expect(ids).not.toContain("fake-id")
    expect(ids.length).toBeLessThanOrEqual(5)
    expect(meetingSourceIds(live, meeting, "没有来源的新结论")).toEqual([])
  })
  it("does not refresh an already generated summary just because an asset was created", () => {
    const state = useProjectStore.getState(), session = state.createMeeting("project", state.project.id)
    const before = narrativeFingerprint(useProjectStore.getState(), session)
    state.addMeetingMessage(session.id, { senderType: "user", senderId: "m1", content: "@材料整理 生成 Sprint 3 甘特图" })
    state.addMeetingMessage(session.id, { senderType: "agent", senderId: "material_organizer", content: "甘特图已整理。" })
    const live = useProjectStore.getState()
    expect(narrativeFingerprint(live, live.meetingSessions[session.id])).toBe(before)
  })
  it("routes ordinary colleague replies to Flash and complex tradeoffs/whole meeting summary to Pro", () => {
    expect(routeMeetingModel("explain", { presentationMode: "defense", speaker: "risk_dependency", question: "列出当前依赖" }).tier).toBe("flash")
    expect(routeMeetingModel("explain", { presentationMode: "defense", speaker: "workload_capacity", question: "比较方案 A 与方案 B 的机会成本" }).tier).toBe("pro")
    expect(routeMeetingModel("meeting_summary", {}).tier).toBe("pro")
    expect(estimateMeetingCost("deepseek-flash", { prompt_tokens: 1_000_000, prompt_cache_hit_tokens: 1_000_000 })).toBeCloseTo(.0432)
    expect(estimateMeetingCost("deepseek-v4-pro", { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 })).toBeCloseTo(38.016)
  })
})
