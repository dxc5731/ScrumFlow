// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import GlobalAiAssistant from "../components/planning/GlobalAiAssistant"
import CanvasTopBar from "../components/CanvasTopBar"
import SprintPage from "../pages/SprintPage"
import {
  resetProjectStoreForTests,
  useProjectStore,
} from "../store/projectStore"
import { coordinateMeetingTurn } from "../agents/meetingDecision"
import { analyzeMeetingAgent } from "../agents/meetingConversation"
import { memoryFor } from "../agents/meetingContext"
vi.mock("../agents/meetingDecision", () => ({ coordinateMeetingTurn: vi.fn() }))
const store = () => useProjectStore.getState()
const menu = () =>
  fireEvent.click(screen.getByRole("button", { name: "AI 助手" }))
const open = () => {
  menu()
  fireEvent.click(screen.getByRole("button", { name: /快捷聊天/ }))
}
beforeEach(() => {
  resetProjectStoreForTests()
  localStorage.removeItem("scrumflow-ai-orb-position")
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ configured: false }), { status: 200 }),
    ),
  )
  vi.mocked(coordinateMeetingTurn).mockImplementation(
    async (state, session, agentId, question) => ({
      answer: {
        agentType: agentId === "auto" ? "project_orchestrator" : agentId,
        content: "已根据项目事实完成分析：" + question,
        evidence: [],
        rawEvidence: [],
      },
      memory: memoryFor(session),
      completedAgents: ["project_orchestrator"],
      warnings: [],
      snapshotVersion: "test",
      resolvedIntent: "other",
      llmFallback: true,
      llmReplyUsed: false,
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("global AI launcher and shared quick chat", () => {
  it("keeps compact mode chat-only when returning from the full materials view", () => {
    render(<GlobalAiAssistant />)
    menu()
    fireEvent.click(screen.getByRole("button", { name: /材料整理/ }))
    expect(screen.getByRole("heading", { name: "会议材料" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "切换为小窗" }))
    expect(screen.queryByRole("heading", { name: "会议材料" })).toBeNull()
    expect(screen.queryByRole("navigation", { name: "快捷聊天内容" })).toBeNull()
    expect(screen.queryByRole("navigation", { name: "会议详情" })).toBeNull()
    expect(screen.getByRole("textbox", { name: "会议消息" })).toBeTruthy()
  })
  it("drags without opening the menu, persists the position and clamps it after resize", () => {
    class TestPointerEvent extends MouseEvent {
      pointerId: number
      constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 }
    }
    vi.stubGlobal("PointerEvent", TestPointerEvent)
    const view = render(<GlobalAiAssistant />)
    const orb = screen.getByRole("button", { name: "AI 助手" })
    fireEvent.pointerDown(orb, { pointerId: 1, button: 0, clientX: 950, clientY: 700 })
    fireEvent.pointerMove(orb, { pointerId: 1, clientX: 450, clientY: 200 })
    fireEvent.pointerUp(orb, { pointerId: 1, clientX: 450, clientY: 200 })
    fireEvent.click(orb)
    expect(screen.queryByRole("dialog", { name: "AI 工作台" })).toBeNull()
    const saved = JSON.parse(localStorage.getItem("scrumflow-ai-orb-position")!)
    expect(saved.x).toBeGreaterThanOrEqual(12)
    expect(saved.y).toBeGreaterThanOrEqual(12)
    expect(orb.style.left).toBe(saved.x + "px")
    view.unmount()
    render(<GlobalAiAssistant />)
    const restored = screen.getByRole("button", { name: "AI 助手" })
    expect(restored.style.left).toBe(saved.x + "px")
    vi.stubGlobal("innerWidth", 390)
    vi.stubGlobal("innerHeight", 400)
    fireEvent(window, new Event("resize"))
    expect(parseFloat(restored.style.left)).toBeLessThanOrEqual(326)
    expect(parseFloat(restored.style.top)).toBeLessThanOrEqual(336)
    fireEvent.click(restored)
    expect(screen.getByRole("dialog", { name: "AI 工作台" })).toBeTruthy()
  })

  it("shows shortcuts and model configuration without creating a session just by opening the menu", async () => {
    render(<GlobalAiAssistant />)
    menu()
    expect(screen.getByRole("button", { name: /AI 事件分析/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /材料整理/ })).toBeTruthy()
    expect(Object.keys(store().meetingSessions)).toHaveLength(0)
    await screen.findByText("在线模型待配置")
    fireEvent.click(screen.getByRole("button", { name: "模型配置说明" }))
    expect(screen.getByText("DEEPSEEK_API_KEY")).toBeTruthy()
  })
  it("keeps the same session and draft through minimize, page navigation and full-room expansion", () => {
    render(<GlobalAiAssistant />)
    open()
    const id = store().workspace.aiSessionId
    const box = screen.getByRole("textbox", { name: "会议消息" })
    fireEvent.change(box, { target: { value: "这段中文草稿不要丢" } })
    fireEvent.click(screen.getByRole("button", { name: "展开完整会议室" }))
    expect(
      (screen.getByRole("textbox", { name: "会议消息" }) as HTMLTextAreaElement)
        .value,
    ).toBe("这段中文草稿不要丢")
    fireEvent.click(screen.getByRole("button", { name: "切换为小窗" }))
    fireEvent.click(screen.getByRole("button", { name: "最小化 AI 聊天" }))
    expect(screen.queryByRole("dialog", { name: "AI 快捷聊天" })).toBeNull()
    act(() => store().setWorkspace({ currentPage: "gantt" }))
    open()
    expect(store().workspace.aiSessionId).toBe(id)
    expect(Object.keys(store().meetingSessions)).toHaveLength(1)
    expect(
      (screen.getByRole("textbox", { name: "会议消息" }) as HTMLTextAreaElement)
        .value,
    ).toBe("这段中文草稿不要丢")
  })
  it("routes the selected Agent through the existing coordinator and saves the actual conversation", async () => {
    render(<GlobalAiAssistant />)
    open()
    fireEvent.change(screen.getByLabelText("快捷聊天 Agent"), {
      target: { value: "risk_dependency" },
    })
    fireEvent.change(screen.getByRole("textbox", { name: "会议消息" }), {
      target: { value: "检查当前延期风险" },
    })
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }))
    await waitFor(() => expect(coordinateMeetingTurn).toHaveBeenCalledTimes(1))
    expect(vi.mocked(coordinateMeetingTurn).mock.calls[0][2]).toBe(
      "risk_dependency",
    )
    expect(vi.mocked(coordinateMeetingTurn).mock.calls[0][3]).toBe(
      "检查当前延期风险",
    )
    await screen.findByText("已根据项目事实完成分析：检查当前延期风险")
    expect(
      Object.values(store().meetingMessages).some(
        (item) =>
          item.senderType === "user" &&
          item.content === "@风险与依赖 检查当前延期风险",
      ),
    ).toBe(true)
    expect(Object.keys(store().proposals)).toHaveLength(0)
  })
  it("honors explicit member mentions instead of overriding them with the Agent dropdown", async () => {
    render(<GlobalAiAssistant />)
    open()
    fireEvent.change(screen.getByLabelText("快捷聊天 Agent"), {
      target: { value: "risk_dependency" },
    })
    fireEvent.change(screen.getByRole("textbox", { name: "会议消息" }), {
      target: { value: "@陈林 只回答自己的工作" },
    })
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }))
    await waitFor(() => expect(coordinateMeetingTurn).toHaveBeenCalledTimes(1))
    expect(vi.mocked(coordinateMeetingTurn).mock.calls[0][5]).toBe("m3")
  })
  it("can minimize while an Agent is working and keeps its reply when reopened", async () => {
    let resolve: (value: any) => void
    vi.mocked(coordinateMeetingTurn).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    render(<GlobalAiAssistant />)
    open()
    fireEvent.change(screen.getByRole("textbox", { name: "会议消息" }), {
      target: { value: "查看项目现状" },
    })
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }))
    const session = store().meetingSessions[store().workspace.aiSessionId!]
    fireEvent.click(screen.getByRole("button", { name: "最小化 AI 聊天" }))
    await act(async () =>
      resolve({
        answer: {
          agentType: "project_orchestrator",
          content: "后台处理完成",
          evidence: [],
          rawEvidence: [],
        },
        memory: memoryFor(session),
        completedAgents: ["project_orchestrator"],
        warnings: [],
        snapshotVersion: "test",
        resolvedIntent: "other",
        llmFallback: false,
        llmReplyUsed: true,
      }),
    )
    open()
    expect(screen.getByText("后台处理完成")).toBeTruthy()
    expect(Object.keys(store().meetingSessions)).toHaveLength(1)
  })
  it("opens original global proposal review and scrolls to the Sprint event panel", async () => {
    render(
      <>
        <CanvasTopBar />
        <SprintPage />
        <GlobalAiAssistant />
      </>,
    )
    menu()
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "AI 工作台" })).getByRole(
        "button",
        { name: /待确认建议/ },
      ),
    )
    expect(screen.getByText("暂无待确认建议")).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", { name: "待确认建议" }),
    )
    menu()
    fireEvent.click(screen.getByRole("button", { name: /AI 事件分析/ }))
    await waitFor(() =>
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled(),
    )
    expect(store().workspace).toMatchObject({
      currentPage: "sprint",
      sprintTab: "progress",
    })
    expect(Object.keys(store().meetingSessions)).toHaveLength(0)
  })
  it("opens the full room from compact chat for proposal review and keeps writes behind confirmation", () => {
    render(<GlobalAiAssistant />)
    open()
    const id = store().workspace.aiSessionId!,
      session = store().meetingSessions[id]
    const answer = analyzeMeetingAgent(
      store(),
      { ...session, targetType: "story", targetId: "us030" },
      "task_decomposition",
      "拆解这个 Story",
    )
    const proposal = answer.proposal!,
      count = Object.keys(store().tasks).length
    act(() => {
      store().saveProposal(proposal)
      store().linkMeetingProposal(id, proposal.id)
      store().addMeetingMessage(id, {
        senderType: "agent",
        senderId: "task_decomposition",
        content: answer.content,
        proposalId: proposal.id,
      })
    })
    expect(screen.queryByRole("navigation", { name: "快捷聊天内容" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "查看建议并审核" }))
    expect(screen.getByRole("dialog", { name: "AI 项目会议室" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "全部采纳" }))
    expect(Object.keys(store().tasks)).toHaveLength(count)
    fireEvent.click(screen.getByRole("button", { name: /重新校验最终计划/ }))
    fireEvent.click(screen.getByRole("button", { name: /确认应用/ }))
    expect(store().proposals[proposal.id].status).toBe("applied")
    expect(Object.keys(store().tasks).length).toBeGreaterThan(count)
    expect(
      store().history.some((item) => item.proposalId === proposal.id),
    ).toBe(true)
  })
  it("does not mix sessions after switching projects or create an empty chat from an empty history", () => {
    render(<GlobalAiAssistant />)
    menu()
    fireEvent.click(screen.getByRole("button", { name: /会议记录与纪要/ }))
    expect(Object.keys(store().meetingSessions)).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: /快捷聊天/ }))
    act(() => {
      store().createBlankProject({
        name: "新项目",
        goal: "新的目标",
        requirementBrief: "",
        startDate: "2026-10-15",
        endDate: "2026-10-30",
        members: [{ name: "新 PO", role: "PO", capacityHours: 40 }],
      })
    })
    expect(screen.queryByRole("dialog", { name: "AI 快捷聊天" })).toBeNull()
    open()
    expect(
      Object.values(store().meetingSessions).every(
        (item) => item.projectId === store().project.id,
      ),
    ).toBe(true)
  })
})
