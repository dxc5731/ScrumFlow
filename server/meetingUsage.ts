import { appendFile, mkdir, readFile } from "node:fs/promises"
import path from "node:path"

export interface ProviderUsage {
  prompt_tokens?: number; completion_tokens?: number; total_tokens?: number
  prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number
  completion_tokens_details?: { reasoning_tokens?: number }
}
export interface UsageEntry {
  requestId?: string; meetingId?: string; mode: string; model: string; at: string
  usage: ProviderUsage; estimatedCny: number; attempt: number
}
const ledger = path.resolve("local-data", "meeting-usage.jsonl")
// Official prices checked 2026-10-07. Peak USD rates and 7.2 CNY/USD form a
// conservative budget estimate; actual holiday/off-peak billing can be lower.
export function estimateMeetingCost(model: string, usage: ProviderUsage): number {
  const pro = /pro/.test(model), hit = usage.prompt_cache_hit_tokens ?? 0
  const miss = usage.prompt_cache_miss_tokens ?? Math.max(0, (usage.prompt_tokens ?? 0) - hit)
  return (hit * (pro ? .044 : .006) + miss * (pro ? 1.32 : .3) + (usage.completion_tokens ?? 0) * (pro ? 3.96 : 1.2)) / 1_000_000 * 7.2
}
export async function recordProviderUsage(entry: Omit<UsageEntry, "estimatedCny">) {
  const record = { ...entry, estimatedCny: estimateMeetingCost(entry.model, entry.usage) }
  await mkdir(path.dirname(ledger), { recursive: true })
  await appendFile(ledger, JSON.stringify(record) + "\n", "utf8")
  return record
}
export async function readMeetingUsage(meetingId?: string) {
  const raw = await readFile(ledger, "utf8").catch(() => "")
  const records = raw.split(/\r?\n/).filter(Boolean).flatMap(line => { try { return [JSON.parse(line) as UsageEntry] } catch { return [] } })
    .filter(entry => !meetingId || entry.meetingId === meetingId)
  return { records, estimatedCny: records.reduce((s, r) => s + r.estimatedCny, 0),
    promptTokens: records.reduce((s, r) => s + (r.usage.prompt_tokens ?? 0), 0),
    completionTokens: records.reduce((s, r) => s + (r.usage.completion_tokens ?? 0), 0),
    cacheHitTokens: records.reduce((s, r) => s + (r.usage.prompt_cache_hit_tokens ?? 0), 0),
    pricingNote: "按官网峰时美元单价、7.2 汇率保守估算；实际账单以 DeepSeek 为准。" }
}
