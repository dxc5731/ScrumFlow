// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"
import { analyzeMeetingAgent } from "../agents/meetingConversation"
import { meetingMaterialMoment } from "../agents/materialRecommendations"
import MeetingRoom from "../components/planning/MeetingRoom"

describe("contextual material recommendations", () => {
  beforeEach(() => { resetProjectStoreForTests(); Element.prototype.scrollIntoView = vi.fn() })
  afterEach(cleanup)
  const plannedMeeting = () => {
    const store = useProjectStore.getState(), session = store.createMeeting("story", "us030")
    const answer = analyzeMeetingAgent(useProjectStore.getState(), session, "task_decomposition", "拆解这个 Story")
    store.saveProposal(answer.proposal!); store.linkMeetingProposal(session.id, answer.proposal!.id)
    store.addMeetingMessage(session.id, { senderType: "agent", senderId: "task_decomposition", content: answer.content, proposalId: answer.proposal!.id })
    return session.id
  }
  it("shows the milestone card, then keeps only a link when the discussion moves on", () => {
    const id = plannedMeeting()
    render(<MeetingRoom initialSessionId={id} onClose={() => {}} />)
    expect(screen.getByRole("region", { name: "AI 推荐会议成果" })).toBeTruthy()
    act(() => { useProjectStore.getState().addMeetingMessage(id, { senderType: "user", senderId: "m1", content: "接着说一下接口范围。" }) })
    expect(screen.queryByRole("region", { name: "AI 推荐会议成果" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "查看建议 →" }))
    expect(screen.getByRole("button", { name: "生成所选成果" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "准备老师汇报" })).toBeTruthy()
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(2)
  })
  it("does not display generation controls in history or duplicate the card in minutes", () => {
    const id = plannedMeeting()
    const view = render(<MeetingRoom initialSessionId={id} initialView="history" onClose={() => {}} />)
    expect(screen.queryByRole("region", { name: "AI 推荐会议成果" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "会议材料" }))
    expect(screen.queryByRole("button", { name: "生成所选成果" })).toBeNull()
    view.unmount()
    render(<MeetingRoom initialSessionId={id} onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: "会议纪要" }))
    expect(screen.queryByRole("region", { name: "AI 推荐会议成果" })).toBeNull()
    expect(screen.getByRole("button", { name: "查看建议 →" })).toBeTruthy()
  })
  it("does not recommend after ordinary small talk", () => {
    const store = useProjectStore.getState(), session = store.createMeeting("project", store.project.id)
    store.addMeetingMessage(session.id, { senderType: "user", senderId: "m1", content: "今天先说到这里。" })
    store.addMeetingMessage(session.id, { senderType: "agent", senderId: "project_orchestrator", content: "下次继续确认。" })
    const state = useProjectStore.getState()
    expect(meetingMaterialMoment(state, state.meetingSessions[session.id])).toBeNull()
  })
  it("offers a new change summary after Apply, without re-showing a stale plan card", () => {
    const id = plannedMeeting(), store = useProjectStore.getState(), session = store.meetingSessions[id]
    const proposalId = session.proposalIds[0]
    const message = store.addMeetingMessage(id, { senderType: "system", senderId: "system", content: "计划已应用。", proposalId })
    const current = useProjectStore.getState(), moment = meetingMaterialMoment(current, current.meetingSessions[id])
    expect(moment?.messageId).toBe(message.id)
    expect(moment?.keys).toContain("changes")
    expect(moment?.expanded).toBe(true)
  })
})
