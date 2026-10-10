import type { DetectedEvent } from "./eventDetection"

/**
 * 事件型 Agent 的模型解释层。
 * 复用会议侧的 /api/meeting-llm 通道（mode=explain），失败时返回 null，
 * 调用方必须降级到规则模板文案，保证离线可用。
 */
export interface EventExplanation {
  summary: string
  impact: string
  suggestion: string
}

function buildPrompt(event: DetectedEvent): Record<string, unknown> {
  return {
    speaker: "risk_dependency",
    question: `请用中文解释下面这条项目事件，并给出影响和处理建议。要求：先一句话结论，再2-3个重点，不编造数据，只基于给定证据。事件标题：${event.title}。事件说明：${event.summary}。证据：${event.evidence.join("；")}。触发规则：${event.rule}。已有建议：${event.suggestedAction}。`,
    projectFacts: {
      event: {
        kind: event.kind,
        severity: event.severity,
        title: event.title,
        summary: event.summary,
        evidence: event.evidence,
        rule: event.rule,
        suggestedAction: event.suggestedAction,
        targetType: event.targetType,
        targetId: event.targetId,
        relatedIds: event.relatedIds,
      },
    },
  }
}

function parseExplanation(content: string): EventExplanation | null {
  const stripped = content.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()
  try {
    const parsed = JSON.parse(stripped) as {
      content?: string
      summary?: string
      impact?: string
      suggestion?: string
    }
    if (typeof parsed.content === "string" && parsed.content.trim()) {
      return { summary: parsed.content.trim(), impact: "", suggestion: "" }
    }
    if (parsed.summary || parsed.impact || parsed.suggestion) {
      return {
        summary: String(parsed.summary ?? "").trim(),
        impact: String(parsed.impact ?? "").trim(),
        suggestion: String(parsed.suggestion ?? "").trim(),
      }
    }
    return null
  } catch {
    if (stripped.length >= 10) return { summary: stripped.slice(0, 800), impact: "", suggestion: "" }
    return null
  }
}

/**
 * 请求模型解释一条事件。返回 null 表示不可用，调用方用规则文案兜底。
 * 遵守契约：模型只负责措辞，事实以规则检测为准，不做写回。
 */
export async function explainEvent(
  event: DetectedEvent,
  signal?: AbortSignal,
): Promise<EventExplanation | null> {
  try {
    const response = await fetch("/api/meeting-llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "explain", payload: buildPrompt(event) }),
      signal: signal ?? AbortSignal.timeout(60_000),
    })
    const result = (await response.json()) as {
      content?: string
      errorCode?: string
      error?: string
    }
    if (!response.ok || typeof result.content !== "string") return null
    return parseExplanation(result.content)
  } catch {
    return null
  }
}
