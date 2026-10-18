import type { MeetingHostEventKind, MeetingSession, MeetingStartOptions, MeetingTopic, ProjectDataState, ScrumMeetingType } from "../types"

interface AgendaStep { key: string; title: string; prompt: string; type: MeetingTopic["type"] }
interface MeetingTemplate { name: string; minutes: number; goal: string; wrapUp: string; agenda: AgendaStep[] }

export const scrumMeetingTemplates: Record<ScrumMeetingType, MeetingTemplate> = {
  daily: {
    name: "每日站会", minutes: 15, goal: "简短同步进展、今日计划和阻塞，优先关注 Sprint Goal", wrapUp: "先确认尚未解决的阻塞，技术细节留到会后讨论",
    agenda: [
      { key: "yesterday", title: "昨日进展", type: "general", prompt: "请大家简短说明昨天推进了什么、还有什么未完成。" },
      { key: "today", title: "今日计划", type: "planning", prompt: "接下来同步今天的计划，请说明当前任务和预计交付情况。" },
      { key: "blockers", title: "当前阻塞", type: "risk", prompt: "大家有没有遇到需要其他成员协助解决的问题？请说明阻塞和需要的支持。" },
    ],
  },
  planning: {
    name: "Sprint Planning", minutes: 90, goal: "对齐 Sprint Goal，选择 Story，再核对任务估算与团队容量", wrapUp: "先确认 Sprint Goal、候选 Story 和尚待核对的容量约束",
    agenda: [
      { key: "goal", title: "Sprint Goal", type: "planning", prompt: "先确认本轮 Sprint 最希望达成的目标与交付边界。" },
      { key: "stories", title: "Story 选择", type: "planning", prompt: "请结合目标选择候选 Story，说明优先级和验收边界。" },
      { key: "capacity", title: "任务拆解与容量确认", type: "workload", prompt: "接下来核对任务拆解、工时估算和可用容量；涉及计划变更的建议仍需逐项审核。" },
    ],
  },
  review: {
    name: "Sprint Review", minutes: 60, goal: "展示实际交付成果，收集验收反馈并确认后续调整", wrapUp: "先确认验收结论和仍需跟进的反馈",
    agenda: [
      { key: "demo", title: "成果展示", type: "general", prompt: "请展示已交付的成果与证据，区分已完成工作和仍在推进的工作。" },
      { key: "feedback", title: "验收反馈", type: "decision", prompt: "请对照验收标准给出反馈，说明通过项、待改进项和缺失证据。" },
      { key: "adjustments", title: "后续调整", type: "planning", prompt: "接下来确认后续调整；请明确跟进人和验收方式，正式变更仍通过待确认行动审核。" },
    ],
  },
  retrospective: {
    name: "Sprint Retrospective", minutes: 45, goal: "回顾有依据的事实，分析协作问题并形成可执行的改进措施", wrapUp: "先收束为少量有跟进人、可验证的改进措施",
    agenda: [
      { key: "facts", title: "回顾事实", type: "general", prompt: "先回顾本轮哪些做法有效、哪里遇到了困难，请尽量引用具体记录。" },
      { key: "causes", title: "分析问题", type: "general", prompt: "接下来分析问题原因，区分事实、推测和个人感受，聚焦协作与流程。" },
      { key: "improvements", title: "制定改进措施", type: "planning", prompt: "请提出少量可执行的改进措施，明确跟进人、下一步和检查方式。" },
    ],
  },
}

export function meetingTemplate(session: MeetingSession) {
  return session.meetingType && scrumMeetingTemplates[session.meetingType] || null
}

export function meetingAgenda(session: MeetingSession) {
  const steps = meetingTemplate(session)?.agenda ?? []
  return steps.flatMap(step => {
    const topic = session.topics?.find(item => item.agendaKey === step.key)
    return topic ? [{ ...step, title: topic.title, topic }] : []
  })
}

export function currentMeetingAgenda(session: MeetingSession) {
  return meetingAgenda(session).find(step => step.topic.status === "active") ?? null
}

export function initializeMeetingFacilitation(state: ProjectDataState, session: MeetingSession, options: MeetingStartOptions) {
  const template = scrumMeetingTemplates[options.meetingType]
  if (!template) throw new Error("请选择有效的会议类型")
  const sprintId = session.targetType === "sprint" ? session.targetId : session.targetType === "story"
    ? state.stories[session.targetId]?.sprintId ?? null : options.sprintId ?? null
  if (sprintId && !state.sprints[sprintId]) throw new Error("关联 Sprint 不存在")
  session.meetingType = options.meetingType
  session.title = template.name
  session.facilitation = { startedAt: session.createdAt, plannedMinutes: template.minutes, sprintId,
    demoSpeed: options.demoSpeed === 30 ? 30 : 1, voiceEnabled: options.voiceEnabled ?? true, management: {} }
  session.memory!.focusSprintId = sprintId
  session.topics = template.agenda.map((step, index) => ({
    id: `agenda-${session.id}-${step.key}`, agendaKey: step.key, title: step.title, type: step.type,
    status: index === 0 ? "active" : "pending", relatedEntityIds: sprintId ? [sprintId] : [],
    relatedAgentTypes: ["project_orchestrator"], createdFromMessageId: "",
  }))
}

export function meetingClock(session: MeetingSession, now = Date.now()) {
  const host = session.facilitation
  const start = Date.parse(host?.startedAt ?? session.createdAt)
  const end = session.status === "ended" ? Date.parse(session.endedAt ?? session.createdAt) : now
  const actualMs = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0
  const speed = host?.demoSpeed === 30 ? 30 : 1
  const elapsedMs = actualMs * speed
  const budgetMs = Math.max(1, host?.plannedMinutes ?? meetingTemplate(session)?.minutes ?? 15) * 60_000
  const remainingMs = Math.max(0, budgetMs - elapsedMs)
  const overtimeMs = Math.max(0, elapsedMs - budgetMs)
  return { actualMs, elapsedMs, remainingMs, overtimeMs, budgetMs, demo: speed === 30,
    phase: elapsedMs >= budgetMs ? "overtime" as const : remainingMs <= 120_000 ? "warning" as const : "normal" as const }
}

export function formatMeetingTime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}

export function meetingGuidance(state: ProjectDataState, session: MeetingSession) {
  const host = session.facilitation
  const sprint = state.sprints[host?.sprintId ?? ""]
  const stories = Object.values(state.stories).filter(story => session.targetType === "story" ? story.id === session.targetId : sprint ? story.sprintId === sprint.id : false)
  const tasks = stories.flatMap(story => story.taskIds.map(id => state.tasks[id]).filter(Boolean))
  const stage = currentMeetingAgenda(session)
  const nameTask = (task: typeof tasks[number]) => `「${task.title}」由${state.members[task.assigneeId ?? ""]?.name ?? "待确认成员"}负责，状态为${({ todo: "待办", in_progress: "进行中", blocked: "受阻", done: "已完成" } as Record<string, string>)[task.status] ?? task.status}`
  if (session.meetingType === "daily") {
    const task = stage?.key === "blockers" ? tasks.find(item => item.status === "blocked") : tasks.find(item => item.status !== "done")
    return task ? `${nameTask(task)}。请相关成员补充${stage?.key === "blockers" ? "所需协助" : "进展和下一步"}。` : "请从各自实际工作出发补充，不要求按固定顺序发言。"
  }
  if (session.meetingType === "planning") return stage?.key === "goal" && sprint?.goal ? `项目中记录的目标是：${sprint.goal}。请确认是否需要补充。`
    : stories.length ? `当前关联 ${stories.length} 个 Story，例如「${stories[0].title}」。请结合验收边界核对估算与容量，需要时可邀请任务拆解或负载与容量助手。` : "可以先引用候选 Story，再邀请任务拆解或负载与容量助手核对。"
  if (session.meetingType === "review") {
    const story = stories.find(item => item.deliveryStatus === "accepted" || item.deliveryStatus === "pending_acceptance")
    return story ? `「${story.title}」当前${story.deliveryStatus === "accepted" ? "已验收" : "待验收"}，请结合已关联成果核对验收反馈。` : "请引用实际成果和验收标准，未提供的演示或验收证据先标为待补充。"
  }
  return "请区分已记录事实和原因假设；改进建议要有可执行的下一步，不在这里直接修改正式计划。"
}

function pendingMeetingActions(state: ProjectDataState, session: MeetingSession) {
  return session.proposalIds.flatMap(id => state.proposals[id]?.actions ?? []).filter(action => action.status === "pending" && action.decision !== "rejected").length
}

export function hostEventKey(state: ProjectDataState, session: MeetingSession, kind: MeetingHostEventKind) {
  const stage = currentMeetingAgenda(session)?.key ?? "complete"
  if (kind === "closing") return `closing:${meetingAgenda(session).filter(item => item.topic.status === "discussed").length}:${pendingMeetingActions(state, session)}`
  return kind === "time_warning" || kind === "overtime" || kind === "extended" ? `${kind}:${session.facilitation?.plannedMinutes}`
    : kind === "agenda" || kind === "guide" ? `${kind}:${stage}` : kind
}

export function hostEventContent(state: ProjectDataState, session: MeetingSession, kind: MeetingHostEventKind) {
  const template = meetingTemplate(session)!
  const stage = currentMeetingAgenda(session)
  const agenda = meetingAgenda(session)
  const sprint = state.sprints[session.facilitation?.sprintId ?? ""]
  const intro = `${stage ? `现在进入「${stage.title}」。${stage.prompt}` : "本次议程已经逐项走完，可以确认行动项并查看会议纪要。"}`
  if (kind === "welcome") return `大家好，我是本次${template.name}的项目主持。本次会议预计 ${template.minutes} 分钟${sprint ? `，关联 ${sprint.name}` : ""}，重点是${template.goal}。议程为${template.agenda.map(item => item.title).join(" → ")}。${session.facilitation?.demoSpeed === 30 ? "本次开启演示模式，议程时钟以 30 倍速运行，实际用时单独记录。" : ""}${intro}${meetingGuidance(state, session)}`
  if (kind === "agenda") return `${intro}${stage ? meetingGuidance(state, session) : "涉及计划变更的建议仍需逐项审核后应用。"}`
  if (kind === "guide") return `本项已有多条成员补充。${template.wrapUp}；如果大家没有其他补充，可以选择“下一议程”，也可以继续讨论。`
  if (kind === "time_warning") return `提醒一下，本次${template.name}${session.facilitation?.demoSpeed === 30 ? "的演示计时" : ""}还有两分钟。建议${template.wrapUp}。`
  if (kind === "overtime") return `本次${template.name}${session.facilitation?.demoSpeed === 30 ? "的演示计时" : ""}已经到达预定时间。请收束讨论，确认最终行动项；可以结束会议或延长 5、10 分钟。会议不会自动结束。`
  if (kind === "extended") return `会议总时长已延长至 ${session.facilitation!.plannedMinutes} 分钟${session.facilitation?.demoSpeed === 30 ? "（演示计时）" : ""}。${stage ? `继续「${stage.title}」，` : ""}请优先处理尚未确认的事项。`
  const completed = agenda.filter(item => item.topic.status === "discussed").length
  const pending = pendingMeetingActions(state, session)
  return `结束前确认：本次${template.name}已推进 ${completed}/${agenda.length} 项议程${completed < agenda.length ? "，未完成议程请在纪要中继续跟进" : ""}。${pending ? `仍有 ${pending} 项行动待确认或执行，` : ""}请查看已有会议纪要及右侧决策与行动，核对跟进人和下一步；确认结束后保留全部记录。`
}

export function meetingFacilitationContext(state: ProjectDataState, session: MeetingSession) {
  const template = meetingTemplate(session)
  return template ? { meetingType: session.meetingType!, name: template.name,
    agenda: currentMeetingAgenda(session)?.title ?? "议程已完成", guidance: `${template.goal}。${meetingGuidance(state, session)}` } : undefined
}
