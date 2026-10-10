import { beforeEach, describe, expect, it } from "vitest"
import { resetProjectStoreForTests, useProjectStore, type CreateProposalInput } from "../store/projectStore"
import { selectPendingActionCount, selectPendingProposals, proposalStatusLabel } from "../store/selectors"

function riskProposalInput(overrides: Partial<CreateProposalInput> = {}): CreateProposalInput {
  const taskStatus = useProjectStore.getState().tasks["fe-024-2"]?.status ?? "todo"
  return {
    origin: "event" as const,
    triggerType: "manual" as const,
    agentType: "risk_dependency" as const,
    targetType: "task" as const,
    targetId: "fe-024-2",
    summary: "期限风险处置建议",
    reasoning: "任务已接近截止但进度不足",
    evidence: [
      {
        agentType: "risk_dependency",
        targetType: "task",
        targetId: "fe-024-2",
        detail: "截止日期：2026-09-18",
      },
      {
        agentType: "risk_dependency",
        targetType: "task",
        targetId: "fe-024-2",
        detail: "当前进度：45%",
      },
    ],
    actions: [
      {
        actionType: "CREATE_RISK" as const,
        targetType: "task" as const,
        targetId: "fe-024-2",
        reason: "登记期限风险",
        proposedValue: {
          title: "fe-024-2 期限风险",
          targetType: "task",
          targetId: "fe-024-2",
          level: "high",
          description: "剩余工作量偏大",
          impact: "可能影响 Story 验收",
          mitigation: "调整排期或拆分任务",
          ownerId: "m2",
          status: "open",
        },
        preconditions: [
          { targetType: "task", targetId: "fe-024-2", field: "status", expectedValue: taskStatus },
        ],
      },
    ],
    ...overrides,
  }
}

describe("Proposal 持久化与执行", () => {
  beforeEach(() => resetProjectStoreForTests())

  it("keeps pending and applied meeting proposals and audit links after more than 50 events", () => {
    const store = useProjectStore.getState()
    const meeting = store.createMeeting("story", "us024")
    const pending = store.createProposal(riskProposalInput({ origin: "meeting" }))
    const applied = store.createProposal(riskProposalInput({ origin: "meeting" }))
    store.linkMeetingProposal(meeting.id, pending.id)
    store.linkMeetingProposal(meeting.id, applied.id)
    store.setProposalDecision(applied.id, applied.actions[0].id, "accepted")
    expect(store.applyProposal(applied.id).ok).toBe(true)
    const originals = structuredClone(useProjectStore.getState().proposals)
    for (let index = 0; index < 60; index++) store.createProposal(riskProposalInput({ summary: `新增事件 ${index}` }))
    const state = useProjectStore.getState()
    expect(state.proposals[pending.id]).toEqual(originals[pending.id])
    expect(state.proposals[applied.id]).toEqual(originals[applied.id])
    expect(Object.keys(state.proposals)).toHaveLength(62)
    expect(state.meetingSessions[meeting.id].proposalIds.every(id => Boolean(state.proposals[id]))).toBe(true)
    expect(state.history.filter(item => item.proposalId === applied.id).length).toBeGreaterThan(0)
    const exported = state.exportProjectJson()
    expect(state.importProjectJson(exported).ok).toBe(true)
    expect(useProjectStore.getState().proposals[pending.id]).toEqual(originals[pending.id])
    expect(useProjectStore.getState().proposals[applied.id]).toEqual(originals[applied.id])
  })

  it("rejects a Story target for task-only semantic actions before executing", () => {
    const store = useProjectStore.getState()
    const proposal = store.createProposal(riskProposalInput({ actions: [{
      actionType: "CHANGE_ASSIGNEE", targetType: "story", targetId: "us024",
      proposedValue: { assigneeId: "m2" }, reason: "变更负责人",
      preconditions: [{ targetType: "story", targetId: "us024", field: "id", expectedValue: "us024" }],
    }] }))
    store.setProposalDecision(proposal.id, proposal.actions[0].id, "accepted")
    expect(store.applyProposal(proposal.id).ok).toBe(false)
    expect(useProjectStore.getState().proposals[proposal.id].actions[0].error).toBe("Action 目标类型无效")
    expect(useProjectStore.getState().history.some(item => item.proposalId === proposal.id)).toBe(false)
  })

  it("创建后保存原始建议与可编辑建议，初始为待确认", () => {
    const proposal = useProjectStore.getState().createProposal(riskProposalInput())
    const stored = useProjectStore.getState().proposals[proposal.id]

    expect(stored.status).toBe("draft")
    expect(stored.originalActions).toHaveLength(1)
    expect(stored.actions).toHaveLength(1)
    expect(stored.actions[0].decision).toBe("pending")
    expect(stored.actions[0].status).toBe("pending")
    expect(stored.actions[0].resultTargetId).toBeNull()
    expect(stored.originalActions[0].id).toBe(stored.actions[0].id)
    expect(stored.projectId).toBe(useProjectStore.getState().project.id)
  })

  it("没有采纳任何动作时拒绝执行", () => {
    const proposal = useProjectStore.getState().createProposal(riskProposalInput())
    const result = useProjectStore.getState().applyProposal(proposal.id, "m1")

    expect(result.ok).toBe(false)
    expect(useProjectStore.getState().proposals[proposal.id].status).toBe("draft")
  })

  it("采纳后执行会写回项目，并留下可追溯的 agent 历史", () => {
    const created = useProjectStore.getState().createProposal(riskProposalInput())
    useProjectStore.getState().setProposalActionDecision(created.id, created.actions[0].id, "accepted")
    const result = useProjectStore.getState().applyProposal(created.id, "m1")

    const state = useProjectStore.getState()
    const stored = state.proposals[created.id]
    expect(result.ok).toBe(true)
    expect(stored.status).toBe("applied")
    expect(stored.actions[0].status).toBe("applied")
    expect(stored.appliedAt).toBeTruthy()

    const linked = state.history.filter((item) => item.proposalId === created.id)
    expect(linked.length).toBeGreaterThan(0)
    expect(linked.every((item) => item.source === "agent")).toBe(true)
    expect(linked[0].proposalActionId).toBe(created.actions[0].id)
  })

  it("执行前数据已变化时把动作标记为 stale", () => {
    const created = useProjectStore.getState().createProposal(
      riskProposalInput({
        actions: [
          {
            actionType: "CREATE_RISK",
            targetType: "task",
            targetId: "fe-024-2",
            reason: "登记期限风险",
            proposedValue: { title: "风险", targetType: "task", targetId: "fe-024-2", level: "high" },
            preconditions: [
              { targetType: "task", targetId: "fe-024-2", field: "status", expectedValue: "done" },
            ],
          },
        ],
      }),
    )
    useProjectStore.getState().setProposalActionDecision(created.id, created.actions[0].id, "accepted")
    const result = useProjectStore.getState().applyProposal(created.id, "m1")

    const stored = useProjectStore.getState().proposals[created.id]
    expect(stored.actions[0].status).toBe("stale")
    expect(stored.actions[0].error).toContain("已变化")
    expect(stored.status).toBe("failed")
    expect(result.ok).toBe(false)
  })

  it("驳回后记录原因与审批人", () => {
    const created = useProjectStore.getState().createProposal(riskProposalInput())
    useProjectStore.getState().rejectProposal(created.id, "当前不需要登记风险")
    const stored = useProjectStore.getState().proposals[created.id]

    expect(stored.status).toBe("rejected")
    expect(stored.reviewNote).toBe("当前不需要登记风险")
    expect(stored.reviewedBy).toBe("m1")
  })

  it("待确认列表只保留未结束的 Proposal", () => {
    const first = useProjectStore.getState().createProposal(riskProposalInput())
    const second = useProjectStore.getState().createProposal(riskProposalInput())
    useProjectStore.getState().rejectProposal(second.id, "忽略")

    const state = useProjectStore.getState()
    const pending = selectPendingProposals(state)
    const pendingIds = pending.map((proposal) => proposal.id)

    expect(pendingIds).toContain(first.id)
    expect(pendingIds).not.toContain(second.id)
    expect(selectPendingActionCount(state)).toBe(
      pending.reduce(
        (sum, proposal) =>
          sum + proposal.actions.filter((action) => action.decision === "pending").length,
        0,
      ),
    )
  })

  it("链式创建：先建任务再建子任务，自动解析真实任务 ID", () => {
    const state = useProjectStore.getState()
    const story = state.createStory({ title: "链式创建验证 Story", source: "manual" })
    const storyId = story.id
    const proposal = state.createProposal({
      origin: "meeting",
      triggerType: "manual",
      agentType: "project_orchestrator",
      targetType: "story",
      targetId: storyId!,
      summary: "链式创建验证",
      reasoning: "先创建任务，再为其创建子任务",
      evidence: [
        {
          agentType: "project_orchestrator",
          targetType: "story",
          targetId: storyId!,
          detail: "测试构造",
        },
      ],
      actions: [
        {
          actionType: "CREATE_TASK",
          targetType: "story",
          targetId: storyId,
          reason: "创建父任务",
          proposedValue: { storyId, title: "链式父任务", type: "frontend", assigneeId: "m1", estimate: 4, startDate: "2026-09-20", endDate: "2026-09-25" },
          preconditions: [
            { targetType: "story", targetId: storyId!, field: "id", expectedValue: storyId! },
          ],
        },
        {
          actionType: "CREATE_SUBTASK",
          targetType: "task",
          targetId: "__PARENT__",
          reason: "为父任务创建子任务",
          proposedValue: { taskId: "__PARENT__", title: "链式子任务", estimate: 2, assigneeId: "m1" },
          preconditions: [
            { targetType: "story", targetId: storyId!, field: "id", expectedValue: storyId! },
          ],
        },
      ],
    })
    const mutable = useProjectStore.getState().proposals[proposal.id]
    const parentId = mutable.actions[0].id
    useProjectStore.setState((current) => ({
      proposals: {
        ...current.proposals,
        [proposal.id]: {
          ...mutable,
          actions: mutable.actions.map((action, index) =>
            index === 1
              ? {
                  ...action,
                  targetId: parentId,
                  dependsOnActionIds: [parentId],
                  proposedValue: { taskId: parentId, title: "链式子任务", estimate: 2, assigneeId: "m1" },
                }
              : action,
          ),
        },
      },
    }))
    const stored = useProjectStore.getState().proposals[proposal.id]
    stored.actions.forEach((action) =>
      useProjectStore.getState().setProposalActionDecision(proposal.id, action.id, "accepted"),
    )
    const result = useProjectStore.getState().applyProposal(proposal.id)
    expect(result.ok).toBe(true)

    const after = useProjectStore.getState().proposals[proposal.id]
    expect(after.status).toBe("applied")
    const parentAction = after.actions[0]
    const childAction = after.actions[1]
    expect(parentAction.resultTargetId).toBeTruthy()
    expect(childAction.resultTargetId).toBeTruthy()
    expect(useProjectStore.getState().subtasks[childAction.resultTargetId ?? ""]?.taskId).toBe(
      parentAction.resultTargetId,
    )
  })

  it("updateProposalValue 只改单个动作并保留原始建议", () => {
    const created = useProjectStore.getState().createProposal(riskProposalInput())
    const actionId = created.actions[0].id
    const changed = {
      ...(created.actions[0].proposedValue as Record<string, unknown>),
      title: "人工调整后的风险标题",
    }
    expect(
      useProjectStore.getState().updateProposalValue(created.id, actionId, changed).ok,
    ).toBe(true)
    expect(
      useProjectStore.getState().setProposalDecision(created.id, actionId, "accepted").ok,
    ).toBe(true)
    const stored = useProjectStore.getState().proposals[created.id]
    expect(stored.actions[0].proposedValue).toMatchObject({ title: "人工调整后的风险标题" })
    expect(stored.originalActions[0].proposedValue).not.toMatchObject({
      title: "人工调整后的风险标题",
    })
    expect(stored.actions[0].decision).toBe("accepted")
  })

  it("saveProposal 拒绝重复保存同一建议", () => {
    const created = useProjectStore.getState().createProposal(riskProposalInput())
    const snapshot = structuredClone(useProjectStore.getState().proposals[created.id])
    expect(useProjectStore.getState().saveProposal(snapshot).ok).toBe(false)
    expect(
      useProjectStore.getState().setProposalDecision(created.id, created.actions[0].id, "accepted").ok,
    ).toBe(true)
    expect(useProjectStore.getState().proposals[created.id].actions[0].decision).toBe("accepted")
    expect(useProjectStore.getState().applyProposal(created.id).ok).toBe(true)
    expect(useProjectStore.getState().proposals[created.id].status).toBe("applied")
  })

  it("整单状态展示：全是 stale 显示已失效，真失败显示失败", () => {
    const failed = useProjectStore.getState().createProposal(riskProposalInput())
    useProjectStore.getState().setProposalActionDecision(failed.id, failed.actions[0].id, "accepted")
    useProjectStore.setState((current) => ({
      proposals: {
        ...current.proposals,
        [failed.id]: {
          ...current.proposals[failed.id],
          actions: current.proposals[failed.id].actions.map((action) => ({
            ...action,
            status: "stale" as const,
            error: "执行前数据已变化",
          })),
          status: "failed" as const,
          applyError: "失败 0 项，失效 1 项",
        },
      },
    }))
    const staleProposal = useProjectStore.getState().proposals[failed.id]
    expect(proposalStatusLabel(staleProposal)).toBe("已失效")
    expect(selectPendingProposals(useProjectStore.getState()).map((item) => item.id)).toContain(
      failed.id,
    )
  })

  it("Proposal 随项目 JSON 一起导出与导入", () => {    const created = useProjectStore.getState().createProposal(riskProposalInput())
    const json = useProjectStore.getState().exportProjectJson()
    expect(json).toContain(created.id)

    resetProjectStoreForTests()
    expect(useProjectStore.getState().proposals[created.id]).toBeUndefined()

    const importResult = useProjectStore.getState().importProjectJson(json)
    expect(importResult.ok).toBe(true)
    expect(useProjectStore.getState().proposals[created.id]).toBeTruthy()
  })
})
