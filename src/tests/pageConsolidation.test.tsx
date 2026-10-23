// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import CanvasTopBar from "../components/CanvasTopBar"
import RiskManagementPanel from "../components/planning/RiskManagementPanel"
import ProjectPage from "../pages/ProjectPage"
import SprintPage from "../pages/SprintPage"
import ReleasePage from "../pages/ReleasePage"
import { createDemoProjectState } from "../data/demoProject"
import { useProjectStore } from "../store/projectStore"
import { risksInScope } from "../utils/riskScope"
vi.mock("../pages/ProjectUseCasePage", () => ({
  default: () => <div>项目用例编辑画布</div>,
}))
const state = () => useProjectStore.getState()
beforeEach(() =>
  useProjectStore.setState(
    createDemoProjectState(new Date("2026-10-15T12:00:00+08:00")),
  ),
)
afterEach(cleanup)

describe("consolidated project, acceptance and risk pages", () => {
  it("keeps only the Project entry and removes independent acceptance/risk/settings entries", () => {
    render(<CanvasTopBar />)
    fireEvent.click(screen.getByRole("button", { name: "工作区视图" }))
    expect(
      screen.getByRole("button", { name: "项目" }),
    ).toBeTruthy()
    for (const name of [
      "项目概览",
      "项目用例图",
      "成果验收",
      "风险登记册",
      "项目设置",
    ])
      expect(screen.queryByRole("button", { name })).toBeNull()
    expect(
      screen.getByRole("button", { name: "团队与 Sprint 分析" }),
    ).toBeTruthy()
  })
  it("groups overview, editable project details and special use cases while preserving old entry routes", () => {
    render(<ProjectPage />)
    expect(screen.queryByText("整体交付进度")).toBeNull()
    fireEvent.click(screen.getByRole("tab", { name: "基本资料" }))
    expect(screen.getAllByPlaceholderText("项目名称")[0]).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: "项目用例图" }))
    expect(screen.getByText("项目用例编辑画布")).toBeTruthy()
    act(() => state().setWorkspace({ currentPage: "settings" }))
    expect(
      screen
        .getByRole("tab", { name: "基本资料" })
        .getAttribute("aria-selected"),
    ).toBe("true")
    act(() => state().setWorkspace({ currentPage: "project-use-case" }))
    expect(
      screen
        .getByRole("tab", { name: "项目用例图" })
        .getAttribute("aria-selected"),
    ).toBe("true")
  })
  it("opens acceptance in the chosen Sprint and appends a real acceptance record", () => {
    render(<SprintPage />)
    fireEvent.click(screen.getByRole("tab", { name: /待验收/ }))
    expect(
      screen.getByText("本 Sprint：待验收 2 · 退回修改 1 · 已验收 2"),
    ).toBeTruthy()
    expect(screen.queryByText("项目综合完成度")).toBeNull()
    fireEvent.click(
      screen.getByRole("button", { name: "验收通过" }),
    )
    fireEvent.click(screen.getByRole("button", { name: "确认验收通过" }))
    expect(state().stories.us031.deliveryStatus).toBe("accepted")
    expect(state().stories.us031.acceptanceLog.at(-1)?.result).toBe("accepted")
    act(() => state().selectSprint("s1"))
    expect(
      screen.getByText("本 Sprint：待验收 0 · 退回修改 0 · 已验收 7"),
    ).toBeTruthy()
  })
  it("resolves legacy acceptance and risk entry points inside Sprint", () => {
    state().setWorkspace({ currentPage: "acceptance" })
    const view = render(<SprintPage />)
    expect(
      screen.getByRole("tab", { name: /待验收/ }).getAttribute("aria-selected"),
    ).toBe("true")
    view.unmount()
    state().setWorkspace({ currentPage: "risks" })
    render(<SprintPage />)
    expect(screen.getByRole("heading", { name: "全部项目风险" })).toBeTruthy()
  })
  it("scopes risk association to Sprint or Release and includes unscheduled Release stories", () => {
    const data = state()
    expect(
      risksInScope(data, { type: "sprint", id: "s2" })
        .map((r) => r.id)
        .sort(),
    ).toEqual(["risk-storage", "risk-gantt", "risk-capacity"].sort())
    const added = data.createRisk({
      title: "版本未排期风险",
      targetType: "story",
      targetId: "backup",
      level: "low",
      description: "备份尚未排入迭代",
      impact: "恢复演练遗漏",
      mitigation: "在发布前分配负责人",
      ownerId: "m3",
      status: "open",
    })
    expect(
      risksInScope(state(), { type: "release", id: "release-demo" }).map(
        (r) => r.id,
      ),
    ).toContain(added.id)
    expect(
      risksInScope(state(), { type: "sprint", id: "s2" }).map((r) => r.id),
    ).not.toContain(added.id)
  })
  it("preserves risk editing, creation, state changes and all-project viewing in the embedded panel", () => {
    render(<RiskManagementPanel scope={{ type: "sprint", id: "s2" }} />)
    expect(
      screen.queryByRole("heading", { name: "父子任务工时重复累计" }),
    ).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /查看全部/ }))
    expect(
      screen.getByRole("heading", { name: "父子任务工时重复累计" }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "返回本 Sprint" }))
    fireEvent.click(
      screen.getByRole("button", { name: "编辑风险：附件刷新后无法读取" }),
    )
    fireEvent.change(screen.getByLabelText("应对措施"), {
      target: { value: "先恢复文件读取，再交 QA 复测" },
    })
    fireEvent.click(screen.getByRole("button", { name: "保存风险" }))
    expect(state().risks["risk-storage"].mitigation).toBe(
      "先恢复文件读取，再交 QA 复测",
    )
    fireEvent.change(screen.getByLabelText("处理状态：附件刷新后无法读取"), {
      target: { value: "resolved" },
    })
    expect(state().risks["risk-storage"].status).toBe("resolved")
    fireEvent.click(screen.getByRole("button", { name: "登记风险" }))
    fireEvent.change(screen.getByLabelText("风险标题"), {
      target: { value: "新登记的迭代风险" },
    })
    fireEvent.click(screen.getByRole("button", { name: "保存风险" }))
    const added = Object.values(state().risks).find(
      (r) => r.title === "新登记的迭代风险",
    )!
    expect(added).toMatchObject({ targetType: "sprint", targetId: "s2" })
    fireEvent.click(
      screen.getByRole("button", { name: "删除风险：新登记的迭代风险" }),
    )
    expect(state().risks[added.id]).toBeUndefined()
  })
  it("provides the same risk management panel within a selected Release", () => {
    render(<ReleasePage />)
    fireEvent.click(screen.getByRole("button", { name: /V1\.1 交付闭环/ }))
    fireEvent.click(screen.getByRole("tab", { name: "风险管理" }))
    expect(
      screen.getByRole("heading", { name: "本 Release 风险管理" }),
    ).toBeTruthy()
    expect(
      screen.getByRole("heading", { name: "附件刷新后无法读取" }),
    ).toBeTruthy()
    expect(
      screen.queryByRole("heading", { name: "父子任务工时重复累计" }),
    ).toBeNull()
    fireEvent.click(screen.getByRole("tab", { name: "版本范围" }))
    expect(screen.getByRole("heading", { name: "版本 Story" })).toBeTruthy()
  })
})
