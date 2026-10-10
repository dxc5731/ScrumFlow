// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import MeetingRoom from "../components/planning/MeetingRoom"
import { analyzeMeetingAgent } from "../agents/meetingConversation"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"

describe("meeting room actions", () => {
  beforeEach(() => {
    resetProjectStoreForTests()
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => cleanup())

  it("offers an agent after adjoining Chinese prose and preserves the draft on Escape", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("project", store.project.id)
    render(<MeetingRoom initialSessionId={session.id} onClose={() => {}} />)
    const box = screen.getByRole("textbox", { name: "会议消息" })
    fireEvent.change(box, { target: { value: "这个问题请@材料" } })
    expect(screen.getByRole("listbox", { name: "邀请助手或成员" })).toBeTruthy()
    expect(screen.getByRole("option", { name: /材料整理/ })).toBeTruthy()
    fireEvent.keyDown(box, { key: "Escape" })
    expect(screen.queryByRole("listbox")).toBeNull()
    expect((box as HTMLTextAreaElement).value).toBe("这个问题请@材料")
  })

  it("does not send while the Chinese input method is composing", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("project", store.project.id)
    render(<MeetingRoom initialSessionId={session.id} onClose={() => {}} />)
    const box = screen.getByRole("textbox", { name: "会议消息" })
    fireEvent.change(box, { target: { value: "我正在输入汉字" } })
    const before = useProjectStore.getState().meetingSessions[session.id].messageIds.length
    fireEvent.keyDown(box, { key: "Enter", isComposing: true, keyCode: 229 })
    expect(useProjectStore.getState().meetingSessions[session.id].messageIds).toHaveLength(before)
    expect((box as HTMLTextAreaElement).value).toBe("我正在输入汉字")
  })

  it("opens and locates a linked decision even after the right panel was collapsed", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("story", "us030")
    const answer = analyzeMeetingAgent(useProjectStore.getState(), session, "task_decomposition", "拆解这个 Story")
    const proposal = answer.proposal!
    store.saveProposal(proposal)
    store.linkMeetingProposal(session.id, proposal.id)
    store.addMeetingMessage(session.id, { senderType: "agent", senderId: "task_decomposition", content: answer.content, proposalId: proposal.id })
    render(<MeetingRoom initialSessionId={session.id} onClose={() => {}} />)
    const decisionPanel = screen.getByText("待确认决策").closest(".meeting-pane") as HTMLElement
    fireEvent.click(screen.getByRole("button", { name: "收起决策区" }))
    expect(screen.getByRole("button", { name: "展开决策区" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "查看建议并审核" }))
    expect(screen.queryByRole("button", { name: "展开决策区" })).toBeNull()
    expect(screen.getByRole("button", { name: "收起决策区" })).toBeTruthy()
    expect(within(decisionPanel).getByRole("button", { name: /任务拆解的建议/ })).toBeTruthy()
    fireEvent.click(within(decisionPanel).getByRole("button", { name: /任务拆解的建议/ }))
    expect(screen.getByRole("heading", { name: "会议讨论" })).toBeTruthy()
  })

  it("shows a concise applied message and opens the actual changes", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("story", "us030")
    const answer = analyzeMeetingAgent(useProjectStore.getState(), session, "task_decomposition", "拆解这个 Story")
    const proposal = answer.proposal!
    store.saveProposal(proposal)
    store.linkMeetingProposal(session.id, proposal.id)
    for (const action of proposal.actions) store.setProposalDecision(proposal.id, action.id, "accepted")
    render(<MeetingRoom initialSessionId={session.id} onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /重新校验最终计划/ }))
    expect(screen.getByText("最终计划校验通过")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /确认应用/ }))
    expect(screen.getByText(/计划已应用。/)).toBeTruthy()
    const applied = useProjectStore.getState().meetingSessions[session.id].messageIds
      .map((id) => useProjectStore.getState().meetingMessages[id]).at(-1)!
    expect(applied.content).not.toContain("负责人：")
    fireEvent.click(screen.getByRole("button", { name: /查看实际变更/ }))
    expect(screen.getByRole("button", { name: "收起决策区" })).toBeTruthy()
  })

  it("keeps the discussion usable with both side panels collapsed", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("project", store.project.id)
    render(<MeetingRoom initialSessionId={session.id} onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: "收起会议背景" }))
    fireEvent.click(screen.getByRole("button", { name: "收起决策区" }))
    expect(screen.getByRole("textbox", { name: "会议消息" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "展开会议背景" }))
    fireEvent.click(screen.getByRole("button", { name: "展开决策区" }))
    expect(screen.getByText("会议背景")).toBeTruthy()
    expect(screen.getByText("决策与行动")).toBeTruthy()
  })

  it("opens unfinished history read-only until explicitly continuing, without changing the saved status", () => {
    const store=useProjectStore.getState(), session=store.createMeeting("story","us030")
    const answer=analyzeMeetingAgent(useProjectStore.getState(),session,"task_decomposition","拆解这个 Story")
    store.saveProposal(answer.proposal!);store.linkMeetingProposal(session.id,answer.proposal!.id)
    store.addMeetingMessage(session.id,{senderType:"agent",senderId:"task_decomposition",content:answer.content,proposalId:answer.proposal!.id})
    render(<MeetingRoom initialSessionId={session.id} initialView="history" onClose={() => {}} />)
    expect(screen.getByText("历史记录 · 未结束")).toBeTruthy()
    expect(screen.queryByRole("textbox",{name:"会议消息"})).toBeNull()
    expect(screen.queryByRole("button",{name:"结束会议"})).toBeNull()
    expect(screen.queryByRole("button",{name:"全部采纳"})).toBeNull()
    expect(screen.queryByRole("button",{name:/重新校验最终计划/})).toBeNull()
    expect(screen.getByRole("button",{name:"查看建议记录"})).toBeTruthy()
    fireEvent.click(screen.getByRole("button",{name:"会议纪要"}))
    expect(screen.queryByRole("button",{name:"确认结束会议"})).toBeNull()
    expect(screen.queryByRole("button",{name:"整理完整会议摘要"})).toBeNull()
    expect(useProjectStore.getState().meetingSessions[session.id].status).toBe("active")
    fireEvent.click(screen.getByRole("button",{name:/继续会议/}))
    expect(screen.getByRole("textbox",{name:"会议消息"})).toBeTruthy()
    expect(screen.getByRole("button",{name:"结束会议"})).toBeTruthy()
    expect(screen.getByRole("button",{name:"全部采纳"})).toBeTruthy()
    fireEvent.click(screen.getByRole("button",{name:"会议纪要"}))
    expect(screen.queryByRole("button",{name:"确认结束会议"})).toBeNull()
    fireEvent.click(screen.getByRole("button",{name:"结束会议"}))
    expect(screen.getByText("结束前确认")).toBeTruthy()
    expect(screen.getByRole("button",{name:"保留待处理并结束会议"})).toBeTruthy()
  })

  it("keeps stored panel widths when collapsing and supports keyboard resizing", () => {
    localStorage.removeItem("scrumflow:meeting-panel-widths")
    const store=useProjectStore.getState(),session=store.createMeeting("project",store.project.id)
    render(<MeetingRoom initialSessionId={session.id} onClose={()=>{}} />)
    const left=screen.getByRole("separator",{name:"调整会议背景宽度"})
    const before=Number(left.getAttribute("aria-valuenow"))
    fireEvent.keyDown(left,{key:"ArrowRight"})
    expect(Number(left.getAttribute("aria-valuenow"))).toBe(Math.min(before+24,Number(left.getAttribute("aria-valuemax"))))
    const resized=Number(left.getAttribute("aria-valuenow"))
    fireEvent.click(screen.getByRole("button",{name:"收起会议背景"}))
    expect(screen.queryByRole("separator",{name:"调整会议背景宽度"})).toBeNull()
    fireEvent.click(screen.getByRole("button",{name:"展开会议背景"}))
    expect(Number(screen.getByRole("separator",{name:"调整会议背景宽度"}).getAttribute("aria-valuenow"))).toBe(resized)
    const right=screen.getByRole("separator",{name:"调整决策区宽度"})
    const previous=Number(right.getAttribute("aria-valuenow"))
    fireEvent.keyDown(right,{key:"ArrowRight"})
    expect(Number(right.getAttribute("aria-valuenow"))).toBe(previous-24)
  })

  it("previews minutes before ending and reopens history in chat with minutes as a secondary view", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("project", store.project.id)
    render(<MeetingRoom initialSessionId={session.id} onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: "结束会议" }))
    expect(screen.getByRole("heading", { level: 2, name: "AI 项目协作会议" })).toBeTruthy()
    expect(useProjectStore.getState().meetingSessions[session.id].status).toBe("active")
    fireEvent.click(screen.getByRole("button", { name: "确认结束会议" }))
    expect(useProjectStore.getState().meetingSessions[session.id].status).toBe("ended")
    expect(useProjectStore.getState().meetingSessions[session.id].minutes).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "返回讨论" }))
    fireEvent.click(screen.getByRole("button", { name: "历史会议" }))
    fireEvent.click(screen.getByRole("button", { name: /AI 项目协作会议.*已结束/ }))
    expect(screen.queryByRole("textbox", { name: "会议消息" })).toBeNull()
    expect(screen.queryByRole("button", { name: "结束会议" })).toBeNull()
    expect(screen.queryByRole("button", { name: "返回讨论" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "会议纪要" }))
    expect(screen.getByRole("button", { name: "返回讨论" })).toBeTruthy()
  })
})
