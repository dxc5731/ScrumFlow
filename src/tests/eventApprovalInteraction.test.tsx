// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import EventInsightPanel from "../components/planning/EventInsightPanel"
import CanvasTopBar from "../components/CanvasTopBar"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"

vi.mock("../utils/eventExplanation", () => ({ explainEvent: async () => null }))
vi.mock("../utils/exportImage", () => ({ exportGanttPng: vi.fn(), exportStoryMapPng: vi.fn() }))

describe("shared event approval interactions", () => {
  beforeEach(() => { resetProjectStoreForTests(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-10T10:00:00+08:00")) })
  afterEach(() => { cleanup(); vi.useRealTimers() })

  const proposalList = () => Object.values(useProjectStore.getState().proposals)
  const panel = () => render(<EventInsightPanel target={{ type: "sprint", id: "s2" }} />)

  async function createFirst() {
    fireEvent.click(screen.getByRole("button", { name: "分析" }))
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "生成建议" })[0]) })
    return proposalList()[0]
  }

  it("keeps an applied event linked after rescan and reopening without creating a duplicate", async () => {
    const view = panel()
    const proposal = await createFirst()
    expect(proposal.targetType).toBe("task")
    expect(proposal.targetId).toBe(proposal.actions[0].targetId)
    fireEvent.click(screen.getByTitle("采纳"))
    fireEvent.click(screen.getByRole("button", { name: "执行" }))
    expect(useProjectStore.getState().proposals[proposal.id].status).toBe("applied")
    fireEvent.click(screen.getByRole("button", { name: "重新分析" }))
    expect(screen.getByText("已写回项目")).toBeTruthy()
    const card = screen.getByText("已写回项目").closest("div.rounded-lg") as HTMLElement
    expect(within(card).queryByRole("button", { name: "生成建议" })).toBeNull()
    view.unmount(); panel()
    fireEvent.click(screen.getByRole("button", { name: "分析" }))
    expect(screen.getByText("已写回项目")).toBeTruthy()
    expect(proposalList()).toHaveLength(1)
    expect(Object.values(useProjectStore.getState().risks).filter(risk => risk.title === proposal.summary)).toHaveLength(1)
  })

  it("recognizes legacy event proposals whose target is the Sprint panel", async () => {
    const view = panel(), proposal = await createFirst()
    act(() => { useProjectStore.getState().updateProposal(proposal.id, { targetType: "sprint", targetId: "s2" }) })
    view.unmount(); panel()
    fireEvent.click(screen.getByRole("button", { name: "分析" }))
    expect(screen.getByText("待确认建议 · 待确认")).toBeTruthy()
    expect(proposalList()).toHaveLength(1)
  })

  it("accepts every pending action without toggling already accepted decisions", () => {
    const store = useProjectStore.getState()
    const proposal = store.createProposal({origin:"meeting",triggerType:"manual",agentType:"task_decomposition",targetType:"story",targetId:"us024",summary:"混合审核状态",reasoning:"",evidence:[],actions:["fe-024-2","data-024"].map(id=>({
      actionType:"UPDATE_TASK",targetType:"task",targetId:id,proposedValue:{title:`更新 ${id}`},reason:"人工审核",preconditions:[{targetType:"task",targetId:id,field:"id",expectedValue:id}],
    }))})
    store.setProposalDecision(proposal.id, proposal.actions[0].id, "accepted")
    render(<CanvasTopBar />)
    fireEvent.click(screen.getByRole("button", { name: "待确认建议" }))
    fireEvent.click(screen.getByRole("button", { name: "全部采纳" }))
    expect(useProjectStore.getState().proposals[proposal.id].actions.map(action=>action.decision)).toEqual(["accepted","accepted"])
    fireEvent.click(screen.getByRole("button", { name: "全部采纳" }))
    expect(useProjectStore.getState().proposals[proposal.id].actions.map(action=>action.decision)).toEqual(["accepted","accepted"])
    fireEvent.click(screen.getByRole("button", { name: "执行" }))
    expect(useProjectStore.getState().tasks["fe-024-2"].title).toBe("更新 fe-024-2")
    expect(useProjectStore.getState().tasks["data-024"].title).toBe("更新 data-024")
  })
})
