import { meetingEntities } from "./meetingContext"
import { buildExecutionSummary } from "./meetingExecutionSummary"
import type { AgentType, MeetingFact, MeetingMemory, MeetingMessage, MeetingMinutes, MeetingSession, MeetingTopic, ProjectDataState } from "../types"

const topicNames: Record<string, string> = {
  plan: "任务规划", risk: "延期与依赖", diagnose: "进度阻塞", workload: "成员分工",
  compare: "方案比较", select: "方案选择", execute: "项目行动", summary: "会议回顾",
}

export function recordMeetingTopic(session: MeetingSession, message: MeetingMessage, memory: MeetingMemory): MeetingTopic[] {
  const topics = session.topics ?? []
  const kind = memory.currentTopic
  if (!topicNames[kind] || kind === "summary") return topics
  const scope = memory.focusStoryIds.at(-1) ?? memory.focusTaskIds.at(-1) ?? memory.focusSprintId
  const entityIds = [...new Set([...memory.focusStoryIds, ...memory.focusTaskIds, ...(memory.focusSprintId ? [memory.focusSprintId] : [])])]
  const title = `${scope?.toUpperCase() ?? "项目"} · ${topicNames[kind]}`
  const current = topics.find((topic) => topic.title === title)
  const deferred = /先不改|暂缓|先保留|暂不调整|等.*确认/.test(message.content)
  const previous = topics.map((topic) => topic.status === "active" && topic.id !== current?.id
    ? { ...topic, status: deferred ? "deferred" as const : "recorded" as const } : topic)
  if (current) return previous.map((topic) => topic.id === current.id ? {
    ...topic, status: deferred ? "deferred" as const : kind === "execute" && memory.decisionSummary && !/待选|继续核对|正在评估/.test(memory.decisionSummary)
      ? "decided" as const : "active" as const,
    relatedAgentTypes: [...new Set([...topic.relatedAgentTypes, ...([memory.lastAgentType].filter(Boolean) as AgentType[])])],
  } : topic)
  return [...previous, {
    id: `topic-${message.id}`, title, type: kind === "plan" ? "planning" : kind === "risk" || kind === "diagnose" ? "risk"
      : kind === "workload" ? "workload" : kind === "execute" || kind === "select" ? "decision" : "general",
    status: kind === "execute" && memory.decisionSummary && !/待选|继续核对|正在评估/.test(memory.decisionSummary) ? "decided" : "active", relatedEntityIds: entityIds,
    relatedAgentTypes: memory.lastAgentType ? [memory.lastAgentType] : [], createdFromMessageId: message.id,
  }]
}

export function meetingFactFromMessage(state: ProjectDataState, message: MeetingMessage): MeetingFact | null {
  if (message.senderType !== "user" || /[？?]/.test(message.content)) return null
  const content = message.content.replace(/^@\S+\s*/, "").trim()
  const hypothesis = /可能|也许|预计.*(?:晚|延期)|恐怕|大概/.test(content)
  const commitment = /我确认.*(?:完成|交付)|我会.*(?:完成|交付)|承诺/.test(content)
  const opinion = /我建议|我认为|暂时别改|先不改|暂不调整|先记下来|不直接改|先留在会议记录/.test(content)
  const fact = !/^(?:不要|按|给我|只|先|再|如果)/.test(content) && /已经|已完成|我确认.*(?:延期|晚|完成)|确认.*(?:延期|晚|完成)/.test(content)
  if (!hypothesis && !commitment && !fact && !opinion) return null
  const relatedEntityIds = meetingEntities(state).filter((entity) =>
    content.toLowerCase().includes(entity.id.toLowerCase()) ||
    (entity.label.length >= 4 && content.includes(entity.label))).map((entity) => entity.id)
  return { id: `fact-${message.id}`, type: hypothesis ? "hypothesis" : commitment ? "commitment" : fact ? "fact" : "opinion",
    status: fact && !hypothesis ? "confirmed" : "unverified", content, sourceMessageId: message.id, relatedEntityIds }
}

export function topicFromMeetingFact(session: MeetingSession, fact: MeetingFact): MeetingTopic[] {
  const topics = session.topics ?? []
  if (fact.type !== "hypothesis" || !/晚|延期|阻塞|完不成/.test(fact.content)) return topics
  const scope = fact.relatedEntityIds[0] ?? session.memory?.focusStoryIds.at(-1) ?? "项目"
  const title = `${scope.toUpperCase()} · 排期待核实`
  if (topics.some((topic) => topic.title === title)) return topics
  return [...topics.map((topic) => topic.status === "active" ? { ...topic, status: "recorded" as const } : topic), {
    id: `topic-${fact.sourceMessageId}`, title, type: "risk", status: "unresolved",
    relatedEntityIds: fact.relatedEntityIds, relatedAgentTypes: [], createdFromMessageId: fact.sourceMessageId,
  }]
}

export function describeHypothesisImpact(state: ProjectDataState, session: MeetingSession, fact: MeetingFact): string {
  const taskId = fact.relatedEntityIds.find((id) => Boolean(state.tasks[id])) ?? session.memory?.focusTaskIds[0]
  const task = taskId ? state.tasks[taskId] : null
  const seen = new Set<string>()
  const queue = task ? [task.id] : []
  while (queue.length) {
    const source = queue.shift()!
    for (const dependency of Object.values(state.dependencies)) if (dependency.sourceTaskId === source && !seen.has(dependency.targetTaskId)) {
      seen.add(dependency.targetTaskId)
      queue.push(dependency.targetTaskId)
    }
  }
  return task
    ? `我先把这条发言记为待核实的排期假设，正式日期未变。「${task.title}」当前关联 ${seen.size} 项后续工作。需要现在分析影响，还是等时间确认后再处理？`
    : "我先把这条发言记为待核实的排期假设，正式计划未变。确认涉及的任务后，可以再检查依赖与成员容量。"
}

function actionStatus(status: string, decision: string) {
  if (status === "applied") return "已执行"
  if (status === "failed") return "执行失败"
  if (status === "stale") return "已失效"
  return decision === "accepted" ? "已采纳，待执行" : decision === "rejected" ? "已拒绝" : "待审核"
}

export function generateMeetingMinutes(state: ProjectDataState, session: MeetingSession): MeetingMinutes {
  const messages = session.messageIds.map((id) => state.meetingMessages[id]).filter(Boolean)
  const proposals = session.proposalIds.map((id) => state.proposals[id]).filter(Boolean)
  const execution = buildExecutionSummary(state, proposals)
  const topics = session.topics ?? []
  const facts = session.facts ?? []
  const entityIds = new Set([...topics.flatMap((topic) => topic.relatedEntityIds), ...facts.flatMap((fact) => fact.relatedEntityIds)])
  const focus = session.memory?.focusStoryIds ?? []
  focus.forEach((id) => entityIds.add(id))
  const keyFacts = facts.filter((fact) => fact.status === "confirmed" && fact.type === "fact").map((fact) => fact.content)
  for (const id of entityIds) {
    const story = state.stories[id]
    if (story) keyFacts.push(`${id.toUpperCase()}「${story.title}」现有 ${story.taskIds.length} 个任务，属于 ${state.sprints[story.sprintId ?? ""]?.name ?? "未安排 Sprint"}。`)
  }
  const actions = proposals.flatMap((proposal) => proposal.actions.map((action) => {
    const value = action.proposedValue
    const taskName = (id: string) => state.tasks[id]?.title ?? proposal.actions.find((item) => item.id === id && item.actionType === "CREATE_TASK")?.proposedValue.title ?? "待创建任务"
    const title = action.actionType === "ADD_DEPENDENCY"
      ? `${taskName(String(value.sourceTaskId))} → ${taskName(String(value.targetTaskId))}`
      : typeof value.title === "string" ? value.title : state.tasks[action.targetId]?.title ?? state.stories[action.targetId]?.title ?? "项目安排"
    const verb = action.actionType === "CREATE_TASK" ? "创建任务" : action.actionType === "CREATE_SUBTASK" ? "创建步骤"
      : action.actionType === "ADD_DEPENDENCY" ? "添加依赖" : action.actionType === "CREATE_RISK" ? "登记风险" : "调整安排"
    const owner = typeof value.assigneeId === "string" ? state.members[value.assigneeId]?.name : null
    return { title: `${verb}：${title}`, detail: [owner ? `负责人 ${owner}` : "", typeof value.estimate === "number" ? `预计 ${value.estimate}h` : ""].filter(Boolean).join(" · "),
      status: actionStatus(action.status, action.decision), sourceMessageIds: [...new Set([
        ...messages.filter(message => message.proposalId === proposal.id).map(message => message.id),
        ...(session.qaTrace ?? []).filter(trace => trace.proposalId === proposal.id).map(trace => trace.messageId),
      ])] }
  }))
  const decisions = [session.memory?.decisionSummary, ...Object.values(session.memory?.planningByFocus ?? {}).map((item) => item.decisionSummary),
    ...facts.filter((fact) => fact.type === "opinion" && /暂时别改|不直接改|先留在会议记录/.test(fact.content)).map((fact) => `暂不修改项目安排：${fact.content}`)]
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()) && !/正在评估|继续核对|待选方案/.test(item))
  const openQuestions = facts.filter((fact) => fact.status === "unverified" && (fact.type === "hypothesis" || fact.type === "commitment"))
    .map((fact) => `${fact.content}（待核实）`)
  const hypotheses = facts.filter((fact) => fact.type === "hypothesis").map((fact) =>
    `${fact.content}（${fact.status === "confirmed" ? "已确认" : fact.status === "dismissed" ? "已排除" : "待核实"}）`)
  const deferred = [
    ...topics.filter((topic) => topic.status === "deferred").map((topic) => topic.title),
    ...facts.filter((fact) => fact.type === "opinion" && /先不改|暂缓|先保留|暂不调整|不直接改/.test(fact.content)).map((fact) => fact.content),
  ]
  const executionResults = [execution.headline, ...execution.applied, ...execution.reviewedChanges,
    ...execution.notExecuted, ...execution.discrepancies]
  const risks = facts.filter((fact) => fact.type === "hypothesis" && /晚|延期|阻塞|完不成/.test(fact.content))
    .map((fact) => fact.status === "confirmed"
      ? `会议已确认“${fact.content}”，需检查后续任务和排期。`
      : `如果“${fact.content}”得到确认，需要重新检查后续任务和排期。`)
  const executedStoryIds = [...new Set(proposals.flatMap((proposal) => proposal.actions)
    .filter((action) => action.status === "applied" && ["CREATE_TASK", "UPDATE_TASK", "CREATE_SUBTASK", "UPDATE_SUBTASK"].includes(action.actionType))
    .map((action) => action.targetType === "story" ? action.targetId : state.tasks[action.targetId]?.storyId ?? state.tasks[action.resultTargetId ?? ""]?.storyId)
    .filter((id): id is string => Boolean(id && state.stories[id])))]
  const executedTopics = executedStoryIds.map((id) => {
    const story = state.stories[id]
    const sprint = state.sprints[story.sprintId ?? ""]
    return `${id.toUpperCase()} · ${sprint ? `${sprint.name} ` : ""}执行规划`
  })
  const otherTopics = topics.filter((topic) => !executedStoryIds.some((id) => topic.relatedEntityIds.includes(id)))
    .slice(0, executedTopics.length ? 2 : 3).map((topic) => topic.title)
  const executiveSummary = [
    otherTopics.length || executedTopics.length
      ? `本次会议讨论了${[...otherTopics, ...executedTopics].join("、")}。` : "本次会议尚未形成正式议题。",
    facts.some((fact) => fact.type === "hypothesis" && fact.status === "unverified")
      ? `有 ${facts.filter((fact) => fact.type === "hypothesis" && fact.status === "unverified").length} 项会议假设待核实，未直接改变项目计划。` : "",
    `${execution.headline}。${execution.notExecuted.length ? `${execution.notExecuted.length} 项建议经人工拒绝。` : ""}`,
    execution.discrepancies.length ? "执行记录与项目数据存在待复核差异。" : "",
  ].filter(Boolean)
  return { generatedAt: new Date().toISOString(), executiveSummary, topics: topics.map((topic) => `${topic.title} · ${topic.status === "decided" ? "已决定" : topic.status === "active" ? "讨论中" : topic.status === "unresolved" ? "待核实" : topic.status === "deferred" ? "已暂缓" : "已记录"}`),
    keyFacts: [...new Set(keyFacts)], hypotheses: [...new Set(hypotheses)], decisions: [...new Set(decisions)],
    deferred: [...new Set(deferred)], actions, executionResults, openQuestions, risks,
    relatedEntities: [...entityIds].map((id) => {
      const entity = meetingEntities(state).find((item) => item.id === id)
      return entity ? `${id.toUpperCase()} · ${entity.label}` : id.toUpperCase()
    }), participantIds: session.participantIds,
    agentTypes: [...new Set(messages.filter((message) => message.senderType === "agent").map((message) => message.senderId as AgentType))] }
}
