import { beforeEach, describe, expect, it, vi } from "vitest"
import { usePlanningFixtureClock } from "./planningFixtureClock"
import { coordinateMeetingTurn } from "../agents/meetingDecision"
import { memoryFor } from "../agents/meetingContext"
import { buildProjectAnalysisSnapshot } from "../agents/meetingSnapshot"
import { generateMeetingMaterials } from "../agents/materialOrganizer"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"
import type { MeetingLlm } from "../agents/meetingLlm"

vi.mock("../agents/materialOrganizer", () => ({ generateMeetingMaterials: vi.fn(async () => ({
  agentType: "material_organizer", content: "材料已更新", evidence: [], rawEvidence: [],
})) }))

usePlanningFixtureClock()
const offline: MeetingLlm = { interpret: async () => null, explain: async () => null }

describe("read-only member questions and material handoff", () => {
  beforeEach(() => { resetProjectStoreForTests(); vi.clearAllMocks() })

  it.each(["不修改", "不要更新任务", "不用修改分工", "别改成其他负责人"])("answers capacity with a write prohibition: %s", async prohibition => {
    vi.setSystemTime(new Date("2026-10-10T10:00:00+08:00"))
    const store = useProjectStore.getState(), session = store.createMeeting("sprint", "s2")
    const snapshot = buildProjectAnalysisSnapshot(store, session, memoryFor(session))
    const before = JSON.stringify([store.tasks, store.subtasks, store.proposals, store.history])
    const result = await coordinateMeetingTurn(store, session, "auto", `@陈林 你现在 Sprint 2 还能再接 8h 工作吗？只回答你自己的情况，不安排其他成员，${prohibition}。`, offline)
    expect(result.digitalMemberId).toBe("m3")
    expect(result.answer.content).toContain(`${snapshot.members.m3.currentSprintWorkload}h 未完成工作`)
    expect(result.answer.content).toContain("剩余 0 个工作日")
    expect(result.answer.content).toContain("再接 8h")
    expect(result.answer.content).not.toContain("你确认一下新的分工")
    const current = useProjectStore.getState()
    expect(JSON.stringify([current.tasks, current.subtasks, current.proposals, current.history])).toBe(before)
  })

  it("explains available capacity for an upcoming Sprint without changing assignments", async () => {
    const store = useProjectStore.getState(), session = store.createMeeting("sprint", "s3")
    const result = await coordinateMeetingTurn(store, session, "auto", "@张伟 你在 Sprint 3 还能接 8h 吗？不修改。", offline)
    expect(result.answer.content).toContain("有时间接")
    expect(result.answer.content).toContain("余量为")
    expect(result.answer.proposal).toBeUndefined()
  })

  it("still refuses direct status edits while a prohibition appears in another clause", async () => {
    const store = useProjectStore.getState(), session = store.createMeeting("sprint", "s2")
    const result = await coordinateMeetingTurn(store, session, "auto", "@陈林 不要修改负责人，但请把任务标记为完成。", offline)
    expect(result.answer.content).toContain("先不替你改")
    expect(result.answer.proposal).toBeUndefined()
  })

  function afterMaterials() {
    const store = useProjectStore.getState(), session = store.createMeeting("story", "us024")
    const memory = memoryFor(session)
    memory.lastAgentType = "material_organizer"
    memory.workingState!.activeAgent = "material_organizer"
    return { store, session: { ...session, memory } }
  }

  it("returns ordinary discussion to the host after materials instead of producing extra files", async () => {
    const { store, session } = afterMaterials()
    const result = await coordinateMeetingTurn(store, session, "auto", "我们如何协调 #US024 的推进？请结合具体任务给出你的判断，先讨论。", offline)
    expect(generateMeetingMaterials).not.toHaveBeenCalled()
    expect(result.resolvedIntent).not.toBe("materials")
    expect(result.answer.agentType).not.toBe("material_organizer")
  })

  it("retains the material specialist for an explicit artifact follow-up", async () => {
    const { store, session } = afterMaterials()
    const result = await coordinateMeetingTurn(store, session, "auto", "这份文档只修改标题，其他内容保留。", offline)
    expect(generateMeetingMaterials).toHaveBeenCalledOnce()
    expect(result.resolvedIntent).toBe("materials")
  })
})
