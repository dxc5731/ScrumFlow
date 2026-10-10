import { describe, expect, it, vi, afterEach } from "vitest"
import { explainEvent } from "../utils/eventExplanation"
import type { DetectedEvent } from "../utils/eventDetection"

const baseEvent: DetectedEvent = {
  id: "deadline:fe-024-2",
  kind: "deadline",
  severity: "high",
  rule: "截止日期对比当前进度",
  title: "fe-024-2 已逾期",
  summary: "前端任务已逾期 3 天，当前进度 45%。",
  evidence: ["截止日期：2026-09-18", "当前进度：45%"],
  targetType: "task",
  targetId: "fe-024-2",
  relatedIds: ["story-1"],
  suggestedAction: "确认是否拆分剩余工作或调整排期",
}

afterEach(() => vi.unstubAllGlobals())

describe("事件模型解释（复用会议通道，失败降级）", () => {
  it("模型返回结构化解释时解析成功", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            content: JSON.stringify({
              summary: "该任务已逾期且剩余工作量偏大。",
              impact: "可能拖延 Story 验收。",
              suggestion: "建议拆分剩余工作或调整排期。",
            }),
          }),
          { status: 200 },
        ),
      ),
    )
    const result = await explainEvent(baseEvent)
    expect(result?.summary).toContain("逾期")
  })

  it("模型返回纯文本时直接采用", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ content: "任务已逾期，请尽快处理。" }), { status: 200 })),
    )
    const result = await explainEvent(baseEvent)
    expect(result?.summary).toContain("逾期")
  })

  it("模型不可用时返回 null，由规则文案兜底", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "no key", errorCode: "not_configured" }), { status: 503 })),
    )
    const result = await explainEvent(baseEvent)
    expect(result).toBeNull()
  })

  it("网络异常时返回 null，不抛错", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network")
      }),
    )
    const result = await explainEvent(baseEvent)
    expect(result).toBeNull()
  })

  it("请求走会议通道的 explain 模式", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: "结论：已逾期。" }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    await explainEvent(baseEvent)
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(options.body as string) as { mode: string }
    expect(body.mode).toBe("explain")
  })
})
