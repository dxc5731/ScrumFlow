// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import MeetingInsights from "../components/planning/MeetingInsights"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"
import { meetingBlockerProposalInput } from "../agents/meetingManagement"

describe("meeting insights trace navigation", () => {
  beforeEach(() => resetProjectStoreForTests())
  afterEach(cleanup)

  it("shows accurate counts, feedback and click-through evidence after audited execution", () => {
    const store = useProjectStore.getState()
    const s = store.createMeeting("project", store.project.id, { meetingType: "daily", sprintId: "s2", voiceEnabled: false })
    const m = store.addMeetingMessage(s.id, { senderType: "user", senderId: "m2", content: "前置数据模型未确认，需要协助", inputSource: "voice" })
    const host = store.dispatchMeetingHostEvent(s.id, "topic_deviation", { key: "test", content: "请回到当前议程", sourceMessageIds: [m.id] })!
    store.respondMeetingHostEvent(s.id, host.id, "continue")
    const p = useProjectStore.getState().createProposal(meetingBlockerProposalInput(useProjectStore.getState(), useProjectStore.getState().meetingSessions[s.id], "fe-025-1")!)
    useProjectStore.getState().linkMeetingProposal(s.id, p.id)
    useProjectStore.getState().setProposalDecision(p.id, p.actions[0].id, "accepted")
    useProjectStore.getState().applyProposal(p.id)
    useProjectStore.getState().endMeeting(s.id)
    const current = useProjectStore.getState(), onLocate = vi.fn(), onProposal = vi.fn(), onReview = vi.fn()
    render(<MeetingInsights state={current} session={current.meetingSessions[s.id]} onLocate={onLocate} onProposal={onProposal} onReview={onReview} />)
    expect(screen.getByText("文本 0 · 语音 1")).toBeTruthy()
    expect(screen.getByRole("img", { name: /执行成功 1/ })).toBeTruthy()
    expect(screen.getByText(/纠偏反馈：返回议程 0 · 继续讨论 1 · 误判 0/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "话题纠偏" }))
    expect(onLocate).toHaveBeenLastCalledWith(host.id)
    fireEvent.click(screen.getByRole("button", { name: "发言依据 1" }))
    expect(onLocate).toHaveBeenLastCalledWith(m.id)
    fireEvent.click(screen.getByRole("button", { name: "查看原始 Proposal" }))
    expect(onProposal).toHaveBeenCalledWith(p.id)
    fireEvent.click(screen.getByRole("button", { name: "查看待处理行动" }))
    expect(onReview).toHaveBeenCalled()
    fireEvent.click(screen.getByText(/实际变更 · 1 条审计/))
    expect(screen.getByText(/应对措施：[\s\S]* → /)).toBeTruthy()
  })

  it("renders a sparse legacy meeting with honest empty states", () => {
    const store = useProjectStore.getState(), s = store.createMeeting("story", "us024")
    render(<MeetingInsights state={useProjectStore.getState()} session={s} onReview={() => {}} />)
    expect(screen.getByText("暂无成员发言记录")).toBeTruthy()
    expect(screen.getByText("此会议暂无可追溯主持事件")).toBeTruthy()
    expect(screen.getByText(/本次尚无明确归属的行动建议/)).toBeTruthy()
    expect(screen.getAllByText("暂无记录").length).toBeGreaterThan(0)
  })
})
