export interface MeetingLlmTelemetry {
  requestId: string
  requestType: "interpret" | "explain" | "draft_work" | "materials" | "repair_diagram" | "meeting_summary"
  model: string
  latencyMs: number
  success: boolean
  retryCount: number
  fallbackReason: string | null
  routingTier?: "flash" | "pro"
  reasoningEffort?: "none" | "low" | "high" | "max"
  routingReason?: string
  guardErrors?: string[]
  question?: string
  skipped?: boolean
  skipReason?: string
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number }
  estimatedCny?: number
  metrics?: Record<string, unknown>
}

interface Runtime {
  id: string
  records: MeetingLlmTelemetry[]
  listeners: Set<() => void>
}
const key = Symbol.for("scrumflow.meeting.telemetry.v1")
const host = globalThis as typeof globalThis & { [key]?: Runtime }
const runtime = host[key] ??= { id: crypto.randomUUID(), records: [], listeners: new Set() }
const ownedListeners = new Set<() => void>()
const emit = () => { for (const listener of runtime.listeners) listener() }

export function getMeetingTelemetryRuntimeId(): string { return runtime.id }
export function getMeetingLlmTelemetry(): MeetingLlmTelemetry[] { return runtime.records.map(record => ({ ...record })) }
export function clearMeetingLlmTelemetry(): void { runtime.records.length = 0; emit() }
export function recordMeetingTelemetry(record: MeetingLlmTelemetry): void {
  runtime.records.push(record)
  if (runtime.records.length > 500) runtime.records.shift()
  emit()
}
export function updateMeetingTelemetry(requestId: string, patch: Partial<MeetingLlmTelemetry>): void {
  const index = runtime.records.findIndex(record => record.requestId === requestId)
  if (index >= 0) { runtime.records[index] = { ...runtime.records[index], ...patch }; emit() }
}
export function subscribeMeetingTelemetry(listener: () => void): () => void {
  runtime.listeners.add(listener); ownedListeners.add(listener)
  return () => { runtime.listeners.delete(listener); ownedListeners.delete(listener) }
}
export function recordSkippedModelCall(requestType: MeetingLlmTelemetry["requestType"], question: string, reason: string): void {
  recordMeetingTelemetry({ requestId: crypto.randomUUID(), requestType, question, model: "none", latencyMs: 0,
    success: true, retryCount: 0, fallbackReason: null, skipped: true, skipReason: reason })
}
// Keep in-flight records and identity; only subscriptions created by this module are disposed.
if (import.meta.hot) import.meta.hot.dispose(() => {
  for (const listener of ownedListeners) runtime.listeners.delete(listener)
  ownedListeners.clear()
})
// This module owns a stable runtime and can replace its implementation in place.
// Stop invalidation here so additional diagnostic imports cannot force a page reload.
if (import.meta.hot) import.meta.hot.accept()
