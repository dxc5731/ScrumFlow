import { useEffect, useState } from "react"
import { subscribeMeetingTelemetry } from "../../agents/meetingTelemetry"

export default function MeetingBudgetBadge({ meetingId }: { meetingId: string }) {
  const [amount, setAmount] = useState(0)
  useEffect(() => {
    let active = true
    const refresh = () => { void fetch(`/api/meeting-llm?meetingId=${encodeURIComponent(meetingId)}`).then(r => r.json()).then(r => { if (active) setAmount(r.usage?.estimatedCny ?? 0) }).catch(() => {}) }
    refresh()
    const unsubscribe = subscribeMeetingTelemetry(refresh)
    return () => { active = false; unsubscribe() }
  }, [meetingId])
  return <span className="meeting-budget-badge" title="峰时价格与 7.2 汇率的保守估算；实际账单以 DeepSeek 为准">答辩彩排 · 约 ¥{amount.toFixed(2)} / ¥5</span>
}
