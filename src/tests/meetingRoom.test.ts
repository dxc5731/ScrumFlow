import { beforeEach, describe, expect, it } from "vitest"
import {
  analyzeMeetingAgent, parseAgentMention, routeProjectQuestion,
  summarizeMeeting,
} from "../agents/meetingConversation"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"
import { selectStoryTasks } from "../store/selectors"

describe("AI project meeting room data flow", () => {
  beforeEach(() => resetProjectStoreForTests())

  it("creates a persistent room with a project-specific welcome and no automatic proposal", () => {
    const store = useProjectStore.getState()
    const story = store.createStory({ title: "实验材料目录", source: "manual" })
    const historyLength = useProjectStore.getState().history.length
    const session = store.createMeeting("story", story.id)
    const after = useProjectStore.getState()
    expect(after.meetingSessions[session.id].status).toBe("active")
    expect(after.meetingSessions[session.id].messageIds).toHaveLength(1)
    expect(after.meetingMessages[session.messageIds[0]]).toMatchObject({ senderType: "agent", senderId: "project_orchestrator" })
    expect(after.meetingMessages[session.messageIds[0]].content).toContain("实验材料目录")
    expect(Object.keys(after.proposals)).toHaveLength(0)
    expect(after.history).toHaveLength(historyLength)
    expect(store.endMeeting(session.id).ok).toBe(true)
    expect(useProjectStore.getState().meetingSessions[session.id].endedAt).toBeTruthy()
    expect(() => store.addMeetingMessage(session.id, { senderType: "user", senderId: "m1", content: "继续" })).toThrow("会议已结束")
  })

  it("resolves Chinese @ mentions and gives the project host a distinct coordination route", () => {
    expect(parseAgentMention("@任务拆解 帮我按三个人并行拆分")).toEqual({ agentId: "task_decomposition", question: "帮我按三个人并行拆分" })
    expect(parseAgentMention("@AI 为什么一直推进不动")).toEqual({ agentId: "auto", question: "为什么一直推进不动" })
    expect(routeProjectQuestion("为什么一直推进不动")).toEqual(["risk_dependency", "workload_capacity", "project_monitor"])
    expect(routeProjectQuestion("整理一下会议总结")).toEqual([])
  })

  it("turns a three-person discussion into reviewed actions and keeps the old executor path", () => {
    const store = useProjectStore.getState()
    const story = store.createStory({ title: "实验材料目录", source: "manual", storyPoints: 6 })
    store.createTask(story.id, { title: "已有目录结构" })
    const session = store.createMeeting("story", story.id)
    store.addMeetingMessage(session.id, { senderType: "user", senderId: "m1", content: "@任务拆解 按三个人并行开发拆一下" })
    const answer = analyzeMeetingAgent(useProjectStore.getState(), useProjectStore.getState().meetingSessions[session.id], "task_decomposition", "按三个人并行开发拆一下")
    const proposal = answer.proposal!
    expect(answer.content).toContain("验收标准")
    expect(answer.evidence[0]).toContain("1 个现有任务")
    expect(proposal.actions.filter((item) => item.actionType === "CREATE_TASK")).toHaveLength(3)
    expect(new Set(proposal.actions.filter((item) => item.actionType === "CREATE_TASK").map((item) => item.proposedValue.assigneeId)).size).toBe(3)
    expect(store.saveProposal(proposal).ok).toBe(true)
    expect(store.linkMeetingProposal(session.id, proposal.id).ok).toBe(true)
    store.addMeetingMessage(session.id, { senderType: "agent", senderId: "task_decomposition", content: answer.content, proposalId: proposal.id, evidence: answer.evidence })

    const tasks = proposal.actions.filter((item) => item.actionType === "CREATE_TASK")
    const changed = { ...tasks[0].proposedValue, assigneeId: "m4" }
    expect(store.updateProposalValue(proposal.id, tasks[0].id, changed).ok).toBe(true)
    expect(useProjectStore.getState().proposals[proposal.id].originalActions.find((item) => item.id === tasks[0].id)?.proposedValue.assigneeId).not.toBe("m4")
    store.setProposalDecision(proposal.id, tasks[0].id, "accepted")
    store.setProposalDecision(proposal.id, tasks[1].id, "rejected")
    store.setProposalDecision(proposal.id, tasks[2].id, "accepted")
    for (const item of proposal.actions.filter((action) => action.actionType === "CREATE_SUBTASK")) store.setProposalDecision(proposal.id, item.id, "rejected")
    store.applyProposal(proposal.id)
    const after = useProjectStore.getState()
    expect(after.proposals[proposal.id].status).toBe("applied")
    expect(selectStoryTasks(after, story.id)).toHaveLength(3)
    expect(after.tasks[after.proposals[proposal.id].actions.find((item) => item.id === tasks[0].id)!.resultTargetId!].assigneeId).toBe("m4")
    expect(after.history.some((item) => item.proposalId === proposal.id && item.source === "agent")).toBe(true)
    expect(after.meetingSessions[session.id].proposalIds).toContain(proposal.id)
    expect(summarizeMeeting(after, after.meetingSessions[session.id])).toContain("2 项已写入项目")
    expect(summarizeMeeting(after, after.meetingSessions[session.id])).not.toContain("项待确认")
  })

  it("provides distinct risk, workload, monitoring, and contribution answers from project data", () => {
    const store = useProjectStore.getState()
    const session = store.createMeeting("story", "us024")
    const current = useProjectStore.getState()
    const risk = analyzeMeetingAgent(current, current.meetingSessions[session.id], "risk_dependency", "检查一下风险")
    const capacity = analyzeMeetingAgent(current, current.meetingSessions[session.id], "workload_capacity", "谁适合负责")
    const monitor = analyzeMeetingAgent(current, current.meetingSessions[session.id], "project_monitor", "有什么异常")
    const contribution = analyzeMeetingAgent(current, current.meetingSessions[session.id], "contribution_insight", "总结贡献")
    expect(risk.evidence.some((item) => item.includes("依赖"))).toBe(true)
    expect(capacity.evidence.some((item) => item.includes("容量"))).toBe(true)
    expect(monitor.evidence.some((item) => item.includes("逾期任务"))).toBe(true)
    expect(contribution.content).toContain("贡献")
    expect(new Set([risk.content, capacity.content, monitor.content, contribution.content]).size).toBe(4)
  })

  it("checks the pending meeting plan when asked about its risk and assignments", () => {
    const store = useProjectStore.getState()
    const story = store.createStory({ title: "材料目录", source: "manual", storyPoints: 6 })
    const session = store.createMeeting("story", story.id)
    const plan = analyzeMeetingAgent(useProjectStore.getState(), useProjectStore.getState().meetingSessions[session.id], "task_decomposition", "按三个人并行拆分").proposal!
    store.saveProposal(plan)
    store.linkMeetingProposal(session.id, plan.id)
    const current = useProjectStore.getState()
    const risk = analyzeMeetingAgent(current, current.meetingSessions[session.id], "risk_dependency", "检查刚才的方案")
    const capacity = analyzeMeetingAgent(current, current.meetingSessions[session.id], "workload_capacity", "这些任务给谁")
    expect(risk.content).toContain("刚才的方案包含 3 个待确认任务")
    expect(risk.evidence.some((item) => item.includes("会议待确认任务"))).toBe(true)
    expect(capacity.content).toContain("待确认任务")
    expect(capacity.content).toContain("资料与输入准备")
    expect(risk.proposal).toBeUndefined()
    expect(capacity.proposal).toBeUndefined()
    const repeated = analyzeMeetingAgent(current, current.meetingSessions[session.id], "task_decomposition", "再按三个人并行拆分")
    expect(repeated.proposal).toBeUndefined()
    expect(repeated.content).toContain("不会重复建议")
  })

  it("summarizes actual messages and applied actions after the meeting is reopened", () => {
    const store = useProjectStore.getState()
    const story = store.createStory({ title: "会议总结 Story", source: "manual" })
    const session = store.createMeeting("story", story.id)
    store.addMeetingMessage(session.id, { senderType: "user", senderId: "m1", content: "@AI 总结一下" })
    const summary = summarizeMeeting(useProjectStore.getState(), useProjectStore.getState().meetingSessions[session.id])
    expect(summary).toContain("还没有进行专业分析")
    expect(summary).toContain("目前没有需要写回项目的行动项")
    store.endMeeting(session.id)
    expect(useProjectStore.getState().meetingSessions[session.id].messageIds).toHaveLength(2)
  })
})
