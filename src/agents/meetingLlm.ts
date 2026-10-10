import type { MeetingContext, ProjectDataState } from "../types"
import type { MeetingIntent } from "./meetingContext"
import { projectFactsForModel } from "./meetingModelContext"
import { replyViolatesAssignments } from "./meetingReplyValidation"
import { assertsCompletedMutation, memberIdentityConflicts, validateReplyClaims, type MeetingReplyClaims } from "./meetingClaims"
import { getMeetingLlmTelemetry, recordMeetingTelemetry, updateMeetingTelemetry, type MeetingLlmTelemetry } from "./meetingTelemetry"
import { requiresComplexMeetingReasoning } from "./meetingCallPolicy"
export { getMeetingLlmTelemetry, clearMeetingLlmTelemetry, getMeetingTelemetryRuntimeId, subscribeMeetingTelemetry } from "./meetingTelemetry"
export type { MeetingLlmTelemetry } from "./meetingTelemetry"

export interface LlmHints {
  intent?: MeetingIntent
  selectedOptionId?: string
  memberName?: string
  taskName?: string
  maxPeople?: number
  maxDays?: number
}

export interface MeetingLlm {
  interpret(question: string, context: MeetingContext, state: ProjectDataState): Promise<LlmHints | null>
  explain(question: string, baseline: string, facts: string[], context: MeetingContext, state: ProjectDataState): Promise<string | null>
  draftWork?(payload: unknown): Promise<string | null>
}

export async function requestMeetingModel(mode: MeetingLlmTelemetry["requestType"], payload: unknown, required = false, requestId = crypto.randomUUID()): Promise<string | null> {
  const start = performance.now()
  let recorded = false
  const record = (success: boolean, fallbackReason: string | null, model = "unknown", retryCount = 0,
    routing?: { tier: "flash" | "pro"; effort: "none" | "low" | "high" | "max"; reason: string }) => {
    recorded = true
    recordMeetingTelemetry({ requestId, question: (payload as { question?: string })?.question, requestType: mode, model, latencyMs: Math.round(performance.now() - start), success, retryCount, fallbackReason,
      ...(routing ? { routingTier: routing.tier, reasoningEffort: routing.effort, routingReason: routing.reason } : {}) })
  }
  try {
    const response = await fetch("/api/meeting-llm", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, payload, requestId }), signal: AbortSignal.timeout(mode === "materials" || mode === "repair_diagram" ? 370_000 : mode === "interpret" ? 45_000 : 250_000),
    })
    const result = await response.json() as { content?: string; model?: string; retryCount?: number; errorCode?: string; error?: string;
      routing?: { tier: "flash" | "pro"; effort: "none" | "low" | "high" | "max"; reason: string }; usage?: MeetingLlmTelemetry['usage']; estimatedCny?: number; metrics?: Record<string, unknown> }
    if (!response.ok || typeof result.content !== "string") {
      record(false, result.errorCode ?? (response.ok ? "empty_response" : "network_error"), result.model, result.retryCount, result.routing)
      updateMeetingTelemetry(requestId, { metrics: result.metrics })
      if (required) throw new Error(result.error ?? "模型未返回可用内容，请重试")
      return null
    }
    record(true, null, result.model, result.retryCount, result.routing)
    updateMeetingTelemetry(requestId, { usage: result.usage, estimatedCny: result.estimatedCny, metrics: result.metrics })
    return result.content
  } catch (error) {
    if (!recorded)
      record(false, error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network_error")
    if (required) throw error
    return null
  }
}

export function parseModelObject(content: string): Record<string, unknown> | null {
  const stripped = content.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()
  try {
    const result = JSON.parse(stripped)
    return result && typeof result === "object" && !Array.isArray(result) ? result : null
  } catch {
    // Some providers emit literal line breaks inside quoted Markdown. Escape
    // control characters only; never repair claims, IDs, braces or other syntax.
    let quoted=false,escaped=false,repaired=''
    for(const char of stripped){
      if(quoted&&!escaped&&char.charCodeAt(0)<32) repaired+=JSON.stringify(char).slice(1,-1)
      else repaired+=char
      if(char==='"'&&!escaped)quoted=!quoted
      escaped=char==='\\'&&!escaped
    }
    if(repaired!==stripped)try{const result=JSON.parse(repaired);return result&&typeof result==='object'&&!Array.isArray(result)?result:null}catch{ /* check the prose-only envelope below */ }
    // Prose may contain unescaped quotation marks. Isolate the content field;
    // claims must still be strictly valid JSON and pass the semantic guard.
    const prefix=/^\s*\{\s*"content"\s*:\s*"/.exec(stripped)
    const suffix=/"\s*,\s*"claims"\s*:\s*(\{[\s\S]*\})\s*\}\s*$/.exec(stripped)
    if(!prefix||!suffix||suffix.index<prefix[0].length)return null
    try{
      const claims=JSON.parse(suffix[1])
      let prose='',slash=false
      for(const char of stripped.slice(prefix[0].length,suffix.index)){
        prose+=!slash&&char==='"'?'\\"':!slash&&char.charCodeAt(0)<32?JSON.stringify(char).slice(1,-1):char
        slash=char==='\\'&&!slash
      }
      return {content:JSON.parse('"'+prose+'"'),claims}
    }catch{return null}
  }
}

export const meetingLlm: MeetingLlm = {
  async interpret(question, context, state) {
    const requestId = crypto.randomUUID()
    const story = context.referencedStoryId ? state.stories[context.referencedStoryId] : null
    const content = await requestMeetingModel("interpret", {
      question, topic: context.currentTopic,
      recentMessages: context.recentMessages.slice(-6).map((item) => ({ role: item.senderType, content: item.content.slice(0, 450) })),
      story: story ? { title: story.title, id: story.id } : null,
      members: Object.values(state.members).map((member) => member.name),
      planTasks: context.activePlan?.tasks.map((task) => task.title) ?? [],
    }, false, requestId)
    const parsed = content ? parseModelObject(content) : null
    if (!parsed) {
      const last = getMeetingLlmTelemetry().find(record => record.requestId === requestId)
      if (last?.success) updateMeetingTelemetry(requestId, { success: false, fallbackReason: "invalid_json" })
      return null
    }
    const intents = new Set<MeetingIntent>(["plan", "risk", "workload", "execute", "compare", "select", "diagnose", "summary", "other"])
    const hints = {
      ...(typeof parsed.intent === "string" && intents.has(parsed.intent as MeetingIntent) ? { intent: parsed.intent as MeetingIntent } : {}),
      ...(typeof parsed.selectedOptionId === "string" ? { selectedOptionId: parsed.selectedOptionId.slice(0, 1) } : {}),
      ...(typeof parsed.memberName === "string" ? { memberName: parsed.memberName.slice(0, 30) } : {}),
      ...(typeof parsed.taskName === "string" ? { taskName: parsed.taskName.slice(0, 80) } : {}),
      ...(typeof parsed.maxPeople === "number" ? { maxPeople: parsed.maxPeople } : {}),
      ...(typeof parsed.maxDays === "number" ? { maxDays: parsed.maxDays } : {}),
    }
    if (!Object.keys(hints).length) {
      const last = getMeetingLlmTelemetry().find(record => record.requestId === requestId)
      if (last?.success) updateMeetingTelemetry(requestId, { success: false, fallbackReason: "intent_unknown" })
      return null
    }
    return hints
  },
  async explain(question, baseline, facts, context, state) {
    const requestId = crypto.randomUUID()
    const defense = state.meetingSessions[context.meetingId]?.presentationMode === "defense"
    const projectFacts = projectFactsForModel(state, context)
    const compactTask = (task: ProjectDataState["tasks"][string]) => ({ id: task.id, title: task.title, storyId: task.storyId, type: task.type,
      assigneeId: task.assigneeId, status: task.status, estimate: task.estimate, progress: task.progress, startDate: task.startDate, endDate: task.endDate, blockReasons: task.blockReasons.map(r => r.message) })
    const compact = defense ? context.digitalMemberId ? {
      project: projectFacts.project, asOf: projectFacts.asOf, relatedMembers: projectFacts.relatedMembers, digitalMember: projectFacts.digitalMember, identity: projectFacts.identity,
      ownTasks: projectFacts.ownTasks?.map(compactTask), focusTasks: projectFacts.focusTasks?.map(compactTask),
      subtasks: projectFacts.subtasks, dependencyRelations: projectFacts.dependencyRelations, focusedBlockers: projectFacts.focusedBlockers, upstreamTasks: projectFacts.upstreamTasks?.map(compactTask), dependencies: projectFacts.dependencies, capacity: projectFacts.capacity, sprints: projectFacts.sprints,
    } : { project: projectFacts.project, asOf: projectFacts.asOf, scope: projectFacts.scope,
      members: projectFacts.members?.map(m => ({ id: m.id, name: m.name, role: m.role, capacityHours: m.capacityHours })),
      sprints: projectFacts.sprints?.map(s => ({ id: s.id, name: s.name, goal: s.goal, status: s.status, startDate: s.startDate, endDate: s.endDate })),
      stories: projectFacts.stories?.map(s => ({ id: s.id, title: s.title, sprintId: s.sprintId, deliveryStatus: s.deliveryStatus, riskNote: s.riskNote })),
      tasks: projectFacts.tasks?.map(compactTask), dependencies: projectFacts.dependencies?.map(d => ({ sourceTaskId: d.sourceTaskId, targetTaskId: d.targetTaskId, type: d.type })),
      dependencyTasks: projectFacts.dependencyTasks, capacity: projectFacts.capacity, acceptanceCriteria: projectFacts.acceptanceCriteria,
      subtasks: projectFacts.subtasks, constraints: context.constraints, activePlan: context.activePlan, risks: projectFacts.risks,
    } : projectFacts
    let relevantMessages = context.recentMessages.slice(-6)
    if (context.digitalMemberId) {
      const transcript = state.meetingSessions[context.meetingId]?.messageIds.map(id => state.meetingMessages[id]).filter(Boolean) ?? []
      const turns = transcript.map((message,index) => ({message,index})).filter(({message}) => message.senderType === "digital_member" && message.senderId === context.digitalMemberId).slice(-2)
      const related = new Set([...turns.flatMap(({index}) => [transcript[index-1]?.id, transcript[index].id]), ...transcript.slice(-2).map(message => message.id)])
      relevantMessages = transcript.filter(message => related.has(message.id))
    }
    const content = await requestMeetingModel("explain", { question, baseline, facts, intent: context.currentTopic,
      meetingId: context.meetingId, presentationMode: defense ? "defense" : "standard",
      speaker: context.lastAnalysis.startsWith("数字成员：") ? context.lastAnalysis : context.lastAgentType, projectFacts: compact,
      recentMessages: relevantMessages.map(item => ({ role: item.senderType, senderId: item.senderId, content: item.content.slice(0, 700) })) }, false, requestId)
    const reject = (errors:string[]=['response_consistency']) => {
      const last = getMeetingLlmTelemetry().find(record => record.requestId === requestId)
      if (last?.success) updateMeetingTelemetry(requestId, { success: false, fallbackReason: "inconsistent_response", guardErrors: errors })
      return null
    }
    if (!content) return null
    const structured=parseModelObject(content)
    if (/^\s*(?:```json\s*)?\{/.test(content) && !structured) return reject(['invalid_json'])
    if (context.activePlan?.planId && (!structured?.claims || (structured.claims as MeetingReplyClaims).sourcePlanId !== context.activePlan.planId || (structured.claims as MeetingReplyClaims).sourcePlanRevision !== context.activePlan.revision)) return reject()
    const claimErrors=structured?.claims?validateReplyClaims(structured.claims as MeetingReplyClaims,context,state):[]
    if (claimErrors.length) return reject(claimErrors)
    const reply = typeof structured?.content === 'string' ? structured.content : content
    if (reply.length > 16000 || memberIdentityConflicts(reply,state) || !structured?.claims && replyViolatesAssignments(reply, context, state)) return reject()
    // A reply must not turn an unexecuted recommendation into a successful mutation.
    if (assertsCompletedMutation(reply) && !assertsCompletedMutation(baseline)) return reject()
    if (defense || context.digitalMemberId) return reply
    // Numerical plan detail has one source. Language explains it; the UI receives the canonical detail.
    if (context.activePlan?.planId && ['plan','select','execute'].includes(context.currentTopic)) return baseline
    // Dates, load, graph paths and evidence classification are rendered from their
    // deterministic result. A second prose account cannot become a competing source.
    if (['risk','workload','compare','diagnose','summary'].includes(context.currentTopic)) return requiresComplexMeetingReasoning(question) ? reply : baseline
    return reply
  },
  draftWork: payload => requestMeetingModel("draft_work", payload),
}
