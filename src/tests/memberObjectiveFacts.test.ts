import { beforeEach, describe, expect, it } from "vitest"
import { selectMemberObjectiveFacts } from "../store/selectors"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"

const REFERENCE = new Date("2026-09-18T10:00:00+08:00")

describe("成员客观事实（教学视图）", () => {
  beforeEach(() => resetProjectStoreForTests())

  it("每个成员一行，字段为纯数字且不含 score/rank", () => {
    const state = useProjectStore.getState()
    const facts = selectMemberObjectiveFacts(state, REFERENCE, "s2")

    expect(facts).toHaveLength(Object.keys(state.members).length)
    const numericKeys = [
      "taskCount", "completedCount", "onTimeCount", "overdueCount", "blockedCount",
      "stalledCount", "reworkCount", "missingArtifactCount", "storyCount", "openRiskCount",
      "meetingSpeechCount",
    ] as const
    for (const fact of facts) {
      expect(fact.memberId).toBeTruthy()
      for (const key of numericKeys) {
        expect(typeof fact[key]).toBe("number")
        expect(fact[key]).toBeGreaterThanOrEqual(0)
      }
      const keys = Object.keys(fact).map((key) => key.toLowerCase())
      expect(keys.some((key) => key.includes("score") || key.includes("rank") || key.includes("total"))).toBe(false)
    }
  })

  it("结果稳定且按成员 ID 排序，不随调用变化", () => {
    const state = useProjectStore.getState()
    const first = selectMemberObjectiveFacts(state, REFERENCE, "s2")
    const second = selectMemberObjectiveFacts(state, REFERENCE, "s2")

    expect(first).toEqual(second)
    const ids = first.map((fact) => fact.memberId)
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
  })

  it("会议发言次数合计等于用户发送的消息数", () => {
    const state = useProjectStore.getState()
    const facts = selectMemberObjectiveFacts(state, REFERENCE, "s2")
    const total = facts.reduce((sum, fact) => sum + fact.meetingSpeechCount, 0)
    const userMessages = Object.values(state.meetingMessages).filter((message) => message.senderType === "user").length
    expect(total).toBe(userMessages)
  })

  it("未决风险只统计名下未解决的风险", () => {
    const state = useProjectStore.getState()
    const facts = selectMemberObjectiveFacts(state, REFERENCE, "s2")
    const totalOpen = facts.reduce((sum, fact) => sum + fact.openRiskCount, 0)
    const openRisks = Object.values(state.risks).filter((risk) => risk.status !== "resolved")
    // 至少不会超过全部未解决风险数量（本 Sprint 范围是子集）。
    expect(totalOpen).toBeLessThanOrEqual(openRisks.length)
  })
})
