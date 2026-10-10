import { usePlanningFixtureClock } from "./planningFixtureClock"

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { agentName } from "../agents/meetingConversation"
import { buildMeetingQaReport, formatMeetingQaReport } from "../agents/meetingQa"
import { openShowcaseV2Meeting, showcaseV2Marker } from "../agents/meetingShowcaseV2"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"

usePlanningFixtureClock()

describe("Showcase V2 long meeting", () => {
  beforeEach(() => resetProjectStoreForTests())

  it("keeps focus and decisions coherent through the full project meeting", async () => {
    const before = useProjectStore.getState()
    const originalTaskCount = Object.keys(before.tasks).length
    const originalDate = before.tasks["data-024"].endDate
    const id = await openShowcaseV2Meeting()
    const state = useProjectStore.getState()
    const session = state.meetingSessions[id]
    const messages = session.messageIds.map((messageId) => state.meetingMessages[messageId])
      .filter((message) => message.content !== showcaseV2Marker)
    const trace = session.qaTrace ?? []
    expect(messages.length).toBeGreaterThanOrEqual(35)
    expect(messages.length).toBeLessThanOrEqual(50)
    expect(session.status).toBe("ended")
    expect(messages.some((message) => message.senderType === "digital_member" && message.senderId === "m2")).toBe(true)
    expect(messages.some((message) => message.senderType === "digital_member" && message.senderId === "m3")).toBe(true)
    expect(messages.some((message) => message.senderType === "system" && message.content.includes("已应用其余采纳项"))).toBe(true)
    expect(trace.some((turn) => turn.focusStoryIds.includes("us024") && turn.focusSprintId === "s2")).toBe(true)
    expect(trace.some((turn) => turn.focusStoryIds.includes("us030") && turn.focusSprintId === "s3")).toBe(true)
    expect(trace.filter((turn) => turn.focusStoryIds.includes("us030")).map((turn) => [turn.input, turn.constraints.targetSprintId])).not.toContainEqual(expect.arrayContaining([expect.any(String), "s2"]))
    expect(state.tasks["data-024"].endDate).toBe(originalDate)
    expect(session.facts?.some((fact) => fact.type === "hypothesis" && fact.status === "unverified")).toBe(true)
    expect(session.proposalIds.length, JSON.stringify({
      last: messages.slice(-6).map((message) => message.content),
      options: session.memory?.options.map((option) => [option.id, option.feasible, option.infeasibleReasons]),
      constraints: session.memory?.constraints,
    })).toBeGreaterThan(0)
    expect(Object.keys(state.tasks).length).toBeGreaterThan(originalTaskCount)
    expect(Object.values(state.tasks).find((task) => task.storyId === "us030" && task.title === "补充验收流程与退回场景测试")?.assigneeId).toBe("m2")
    expect(state.history.some((entry) => session.proposalIds.includes(entry.proposalId ?? ""))).toBe(true)
    expect(session.minutes?.hypotheses.join(" ")).toContain("DATA-024")
    expect(session.minutes?.executionResults.length).toBeGreaterThan(0)
    expect(await openShowcaseV2Meeting()).toBe(id)

    if (process.env.SHOWCASE_EXPORT === "1") {
      const directory = join(process.cwd(), "output", "showcase-v2")
      mkdirSync(directory, { recursive: true })
      const transcript = messages.map((message, index) => {
        const name = message.senderType === "system" ? "会议系统" : message.senderType === "agent" ? agentName(message.senderId)
          : state.members[message.senderId]?.name ?? "项目成员"
        return `## ${index + 1}. ${name}${message.senderType === "digital_member" ? "（AI 模拟成员）" : ""}\n\n${message.content}`
      }).join("\n\n")
      writeFileSync(join(directory, "完整对话.md"), `# Meeting Showcase V2 完整对话\n\n${transcript}\n`, "utf8")
      writeFileSync(join(directory, "QA报告.md"), formatMeetingQaReport(buildMeetingQaReport(state, session), state, session), "utf8")
      writeFileSync(join(directory, "会议纪要.json"), JSON.stringify(session.minutes, null, 2), "utf8")
      const minutes = session.minutes!
      const section = (title: string, lines: string[]) => `## ${title}\n${lines.length ? lines.map((line) => `- ${line}`).join("\n") : "- 无"}`
      const minutesText = [
        `# ${session.title} · 会议纪要`,
        `会议范围：项目；参与成员：${session.participantIds.map((memberId) => state.members[memberId]?.name ?? memberId).join("、")}`,
        section("讨论议题", minutes.topics), section("关键事实", minutes.keyFacts),
        section("待核实假设", minutes.hypotheses), section("已确认决策", minutes.decisions),
        section("暂缓事项", minutes.deferred),
        section("行动项", minutes.actions.map((action) => `${action.title}${action.detail ? `；${action.detail}` : ""}；${action.status}`)),
        section("风险", minutes.risks), section("关联项目对象", minutes.relatedEntities),
        section("执行结果", minutes.executionResults),
      ].join("\n\n")
      writeFileSync(join(directory, "会议纪要.md"), `${minutesText}\n`, "utf8")
    }
  })
})
