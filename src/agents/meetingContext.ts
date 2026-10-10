import type {
  AgentType, FocusPlanningContext, MeetingConstraints, MeetingContext, MeetingMemory, MeetingPlanTask,
  MeetingSession, PlanOption, ProjectDataState,
} from "../types"
import { mergeMeetingConstraints } from "./meetingWorkingState"
import { analyzeMeetingRequest } from "./meetingRequest"
import { requestsPlanReview } from "./meetingHandoff"

export type MeetingIntent = "plan" | "risk" | "workload" | "execute" | "compare" | "select" | "diagnose" | "summary" | "other"

export function asksForNewWork(question: string): boolean {
  if (/(?:只|逐条|全部).{0,8}(?:采纳|驳回)|(?:新步骤|子任务).*工时.*(?:还是|口径)|(?:工时|估算).{0,12}新增投入/.test(question)) return false
  const request = analyzeMeetingRequest(question)
  return !request.deniesProposal &&
    /(?:新增|添加|增加|补充|创建|生成|拆解|拆分|拆一下|细化|拆细)[^；]{0,40}(?:任务|工作项|步骤|待办)|(?:任务|工作(?:项)?)[^；]{0,30}(?:拆成|拆开|拆一下|细化|拆细)|再拆细|再细化|拆得更细/i.test(request.commandText)
}

export function asksForExistingTaskStatus(question: string): boolean {
  const commandText = analyzeMeetingRequest(question).commandText
  if (asksForNewWork(question) || /拆成|执行方案|任务总估算/.test(commandText) || /(?:重新拆|规划|安排|指派|分配).{0,12}(?:任务|工作项)/.test(commandText)) return false
  if (/(?:US\d+|Story|这个故事).{0,8}(?:当前|现在)?(?:状态|进度).{0,6}(?:是什么|怎么样|如何|[？?])/i.test(question)) return true
  return /(?:下级|现有|已有|当前|所有|全部).{0,6}(?:任务|工作项)|(?:任务|工作项).{0,12}(?:完成|状态|进度|列表|明细)|(?:完成|未完成).{0,10}(?:任务|工作项)|(?:列出|展示|查看|看看|显示).{0,12}(?:任务|工作项)/.test(question)
}

export interface TurnUnderstanding {
  intent: MeetingIntent
  selectedOptionId: PlanOption["id"] | null
  referencedTaskKeys: string[]
  referencedMemberIds: string[]
  constraints: MeetingConstraints
  changedConstraints: boolean
  delayDays: number | null
  removeDependency: boolean
  mergeAssignmentsFrom: PlanOption["id"] | null
  explicitAgent: AgentType | null
}

export function createMeetingMemory(): MeetingMemory {
  return {
    currentTopic: "",
    constraints: {
      maxPeople: null, requiredPeople: null, maxDays: null, maxHours: null,
      excludedMemberIds: [], preferredAssigneeId: null, assignmentOverrides: {},
      targetSprintId: null, allowSubtasks: true, parallel: false, frontendBackend: false,
      preserveExisting: true, removedTaskKeys: [],
      testOnlyMemberIds: [], allowedMemberIds: [], lockStartedTasks: false, backendOnly: false, lockedTaskKeys: [], lockedTasks: {},
    },
    options: [], activePlanId: null, lastAgentType: null, lastAnalysis: "",
    referencedTaskKeys: [], referencedMemberIds: [],
    discussionSummary: "", decisionSummary: "",
    focusStoryIds: [], focusTaskIds: [], focusSprintId: null, focusMemberIds: [], focusRiskIds: [],
    previousStoryId: null, pendingAssignment: null, planningMode: "normal", planningByFocus: {},
  }
}

export function memoryFor(session: MeetingSession): MeetingMemory {
  const defaults = createMeetingMemory()
  return {
    ...defaults, ...session.memory,
    constraints: { ...defaults.constraints, ...session.memory?.constraints },
    focusStoryIds: session.memory?.focusStoryIds ?? (session.targetType === "story" ? [session.targetId] : []),
    focusTaskIds: session.memory?.focusTaskIds ?? [],
    focusSprintId: session.memory?.focusSprintId ?? (session.targetType === "sprint" ? session.targetId : null),
    focusMemberIds: session.memory?.focusMemberIds ?? [],
    focusRiskIds: session.memory?.focusRiskIds ?? [],
    planningByFocus: session.memory?.planningByFocus ?? {},
  }
}

export function normalizedMeetingMemory(state: ProjectDataState, session: MeetingSession): MeetingMemory {
  const memory = memoryFor(session)
  const storyId = memory.focusStoryIds.length === 1 ? memory.focusStoryIds[0] : null
  if (storyId && !memory.constraints.targetSprintId && state.stories[storyId])
    memory.focusSprintId = state.stories[storyId].sprintId
  return memory
}

function focusKey(session: MeetingSession, memory: MeetingMemory) {
  if (memory.focusStoryIds.length) return `stories:${[...memory.focusStoryIds].sort().join(",")}`
  if (memory.focusSprintId) return `sprint:${memory.focusSprintId}`
  return `project:${session.projectId}`
}

function planningSnapshot(memory: MeetingMemory): FocusPlanningContext {
  return {
    constraints: structuredClone(memory.constraints), options: structuredClone(memory.options), activePlanId: memory.activePlanId,
    referencedTaskKeys: [...memory.referencedTaskKeys], pendingAssignment: memory.pendingAssignment,
    planningMode: memory.planningMode, currentTopic: memory.currentTopic, lastAgentType: memory.lastAgentType,
    lastAnalysis: memory.lastAnalysis, decisionSummary: memory.decisionSummary,
  }
}

export function buildMeetingContext(state: ProjectDataState, session: MeetingSession): MeetingContext {
  const memory = memoryFor(session)
  const activePlan = memory.options.find((option) => option.id === memory.activePlanId) ?? null
  const globalMessages = session.messageIds.slice(-24).map((id) => state.meetingMessages[id]).filter(Boolean)
  const focusId = memory.focusStoryIds.length === 1 ? memory.focusStoryIds[0] : null
  let focusStart = -1
  let discussedStory = session.targetType === "story" ? session.targetId : null
  for (const [index, message] of globalMessages.entries()) {
    if (message.senderType !== "user") continue
    const references = Object.keys(state.stories).filter((id) => message.content.toLowerCase().includes(id.toLowerCase()))
    if (references.length === 1 && references[0] !== discussedStory) {
      discussedStory = references[0]
      if (discussedStory === focusId) focusStart = index
    }
  }
  const recentMessages = (focusStart >= 0 ? globalMessages.slice(focusStart) : globalMessages).slice(-12)
  const activeProposalId = [...session.proposalIds].reverse().find((id) =>
    ["draft", "reviewed"].includes(state.proposals[id]?.status ?? "") &&
    (!focusId || state.proposals[id]?.targetId === focusId)) ?? null
  return {
    meetingId: session.id, targetType: session.targetType, targetId: session.targetId,
    currentTopic: memory.currentTopic,
    recentMessages,
    referencedStoryId: memory.focusStoryIds.at(-1) ?? null,
    referencedTaskKeys: memory.referencedTaskKeys,
    referencedMemberIds: memory.referencedMemberIds,
    lastAgentType: memory.lastAgentType, lastAnalysis: memory.lastAnalysis,
    activePlan, activeProposalId, constraints: memory.constraints,
    focusStoryIds: memory.focusStoryIds, focusTaskIds: memory.focusTaskIds,
    focusSprintId: memory.focusSprintId, focusMemberIds: memory.focusMemberIds, focusRiskIds: memory.focusRiskIds,
    global: { meetingId: session.id, projectId: session.projectId, participantIds: session.participantIds,
      recentMessages: globalMessages, summary: memory.discussionSummary },
    focus: { storyIds: memory.focusStoryIds, taskIds: memory.focusTaskIds, sprintId: memory.focusSprintId,
      memberIds: memory.focusMemberIds, riskIds: memory.focusRiskIds },
    planning: planningSnapshot(memory),
  }
}

export interface EntityReference { type: "story" | "task" | "sprint" | "risk"; id: string; label: string }

export function meetingEntities(state: ProjectDataState): EntityReference[] {
  return [
    ...Object.values(state.stories).map((item) => ({ type: "story" as const, id: item.id, label: item.title })),
    ...Object.values(state.tasks).map((item) => ({ type: "task" as const, id: item.id, label: item.title })),
    ...Object.values(state.sprints).map((item) => ({ type: "sprint" as const, id: item.id, label: item.name })),
    ...Object.values(state.risks).map((item) => ({ type: "risk" as const, id: item.id, label: item.title })),
  ]
}

export function updateMeetingFocus(state: ProjectDataState, session: MeetingSession, memory: MeetingMemory, text: string): MeetingMemory {
  const next = structuredClone(memory)
  const oldKey = focusKey(session, next)
  const oldPlanning = planningSnapshot(next)
  const input = text.toLowerCase()
  const matched = meetingEntities(state).filter((item) => input.includes(item.id.toLowerCase()) ||
    (item.type === "sprint" && input.includes(item.label.toLowerCase())) ||
    (item.type === "sprint" && input.includes(`#${item.label.toLowerCase().replace(/\s+/g, "-")}`)) ||
    (item.label.length >= 4 && input.includes(`#${item.label.toLowerCase()}`)))
  const stories = matched.filter((item) => item.type === "story").map((item) => item.id)
  const tasks = matched.filter((item) => item.type === "task").map((item) => item.id)
  if (!tasks.length) {
    const scope = stories.length ? stories : next.focusStoryIds
    const candidates = Object.values(state.tasks).filter((task) => !scope.length || scope.includes(task.storyId))
    const named = candidates.map((task) => ({ task, match: (task.title.match(/[\u4e00-\u9fff]{3,}/g) ?? [])
      .filter((part) => text.includes(part)).sort((a, b) => b.length - a.length)[0] ?? "" }))
      .filter((item) => item.match).sort((a, b) => b.match.length - a.match.length)
    if (named.length) tasks.push(named[0].task.id)
  }
  const sprint = matched.find((item) => item.type === "sprint")
  const assignsSprint = /(?:目标|安排到|移到|转到|改到|放到|规划到).{0,12}#?Sprint/i.test(text)
  const risks = matched.filter((item) => item.type === "risk").map((item) => item.id)
  if (tasks.length) {
    next.focusTaskIds = tasks
    const taskStories = [...new Set(tasks.map((id) => state.tasks[id]?.storyId).filter(Boolean))]
    if (!stories.length) stories.push(...taskStories)
  }
  if (stories.length) {
    const previous = next.focusStoryIds.at(-1) ?? null
    next.previousStoryId = previous && !stories.includes(previous) ? previous : next.previousStoryId
    const changed = JSON.stringify(next.focusStoryIds) !== JSON.stringify(stories)
    next.focusStoryIds = stories
    if (stories.length === 1 && !assignsSprint) next.focusSprintId = state.stories[stories[0]]?.sprintId ?? null
    if (stories.length === 1) next.focusTaskIds = tasks
    if (changed) next.focusRiskIds = []
  } else if (/这两个|两者|它们/.test(text) && next.previousStoryId && next.focusStoryIds.length === 1) {
    next.focusStoryIds = [next.previousStoryId, next.focusStoryIds[0]]
  }
  if (sprint && (!stories.length || assignsSprint)) next.focusSprintId = sprint.id
  if (risks.length) next.focusRiskIds = risks
  if (sprint && !stories.length && !tasks.length && session.targetType === "project" &&
    (/(?:^|[，。])\s*(?:切换(?:到)?|先看|再看|回到|再回到|讨论)\s*(?:一下)?\s*#?Sprint/i.test(text) || /容量|还能.*接|接.*\d+\s*(?:h|小时)/i.test(text))) {
    next.focusStoryIds = []
    next.focusTaskIds = []
  }
  if (session.targetType === "project" && /整个项目|项目整体/.test(text) && !stories.length && !tasks.length) {
    next.focusStoryIds = []; next.focusTaskIds = []; next.focusSprintId = null
  }
  const mentionedMembers = Object.values(state.members).filter((member) => text.includes(member.name)).map((member) => member.id)
  if (mentionedMembers.length) next.focusMemberIds = mentionedMembers
  if (!next.focusStoryIds.length && session.targetType === "story") next.focusStoryIds = [session.targetId]
  if (!next.focusSprintId && session.targetType === "sprint") next.focusSprintId = session.targetId
  const ordinal = text.match(/第([一二两三四五六七八九十\d]+)个任务/)
  if (ordinal && next.focusStoryIds.length === 1) {
    const index = boundedNumber(`${ordinal[1]}个`, "", 10)
    const id = index ? state.stories[next.focusStoryIds[0]]?.taskIds[index - 1] : null
    if (id) next.focusTaskIds = [id]
  }
  const newKey = focusKey(session, next)
  if (newKey !== oldKey) {
    next.planningByFocus = { ...next.planningByFocus, [oldKey]: oldPlanning }
    const saved = next.planningByFocus[newKey]
    const defaults = createMeetingMemory()
    const carry = /沿用刚才|和刚才一样|保持刚才.{0,8}(限制|条件)/.test(text)
    const constraints = carry ? {
      ...structuredClone(oldPlanning.constraints), targetSprintId: null, assignmentOverrides: {}, removedTaskKeys: [],
    } : defaults.constraints
    const active = saved ?? { ...planningSnapshot(defaults), constraints }
    Object.assign(next, structuredClone(active))
    next.focusMemberIds = mentionedMembers
    if (!tasks.length) next.focusTaskIds = []
    next.referencedMemberIds = mentionedMembers
  }
  return next
}

export function focusedMeetingSession(state: ProjectDataState, session: MeetingSession, memory: MeetingMemory): MeetingSession | null {
  const storyId = memory.focusStoryIds.at(-1)
  if (storyId && state.stories[storyId]) return { ...session, targetType: "story", targetId: storyId }
  if (memory.focusSprintId && state.sprints[memory.focusSprintId]) return { ...session, targetType: "sprint", targetId: memory.focusSprintId }
  return session.targetType === "project" ? null : session
}

function boundedNumber(text: string, suffix: string, max: number): number | null {
  const match = [...text.matchAll(new RegExp(`([一二两三四五六七八九十\\d]+)\\s*(?:个|名|位)?\\s*${suffix}`, "g"))].at(-1)
  if (!match) return null
  const small: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  const value = small[match[1]] ?? Number(match[1])
  return Number.isInteger(value) && value > 0 && value <= max ? value : null
}

function allPlanTasks(memory: MeetingMemory): MeetingPlanTask[] {
  return memory.options.find((option) => option.id === memory.activePlanId)?.tasks ?? memory.options[0]?.tasks ?? []
}

export function understandMeetingTurn(
  state: ProjectDataState,
  session: MeetingSession,
  question: string,
  explicitAgent: AgentType | null = null,
  llmHints?: Partial<{ intent: MeetingIntent; selectedOptionId: string; memberName: string; taskName: string; maxPeople: number; maxDays: number }>,
): TurnUnderstanding {
  const request = analyzeMeetingRequest(question)
  const directives = request.planningText
  const constraintText = request.constraintText
  const memory = memoryFor(session)
  const constraints = structuredClone(memory.constraints)
  const savedTasks = allPlanTasks(memory)
  // Read-only diagnosis need not create a Plan just to resolve an ordinal later.
  const planTasks = savedTasks.length ? savedTasks : memory.focusStoryIds.flatMap(id=>state.stories[id]?.taskIds??[]).map(id=>state.tasks[id]).filter(Boolean).map(task=>({
    key:task.id,storyId:task.storyId,sourceTaskId:task.id,title:task.title,type:task.type,estimate:task.estimate,assigneeId:task.assigneeId,
    phase:'existing',dependsOnKeys:Object.values(state.dependencies).filter(edge=>edge.targetTaskId===task.id).map(edge=>edge.sourceTaskId),
    subtaskTitles:task.subtaskIds.map(id=>state.subtasks[id]?.title).filter(Boolean),startDate:task.startDate,endDate:task.endDate,
  }))
  const referenced = new Set<string>()
  const ordinal = question.match(/第([一二两三四五六七八九十\d]+)(?:个|项)(?:任务|工作项)?/)
  if (ordinal) {
    const index = boundedNumber(`${ordinal[1]}个`, "", 10)
    if (index && planTasks[index - 1]) referenced.add(planTasks[index - 1].key)
  }
  if (/前两个/.test(question)) planTasks.slice(0, 2).forEach((task) => referenced.add(task.key))
  if (/最后一个/.test(question) && planTasks.length) referenced.add(planTasks.at(-1)!.key)
  // A model's inferred task name is not an explicit entity reference.
  for (const task of planTasks) if (question.includes(task.title)) referenced.add(task.key)
  if (!referenced.size && /刚才那个|这个任务|这个依赖|换成.*呢/.test(question)) memory.referencedTaskKeys.forEach((key) => referenced.add(key))
  if (!referenced.size && /这个任务|这个依赖|延期/.test(question) && planTasks.length === 1) referenced.add(planTasks[0].key)
  const referencedTaskKeys = [...referenced]

  const namedMembers = Object.values(state.members).filter(member => question.includes(member.name))
    .sort((a, b) => question.indexOf(a.name) - question.indexOf(b.name))
  const memberIds = (namedMembers.length ? namedMembers : Object.values(state.members).filter(member => llmHints?.memberName === member.name)).map(member => member.id)
  const memberId = memberIds[0] ?? null
  const maxPeople = boundedNumber(directives, "人", 12)
  const maxDays = boundedNumber(directives, "天", 60)
  const maxHours = boundedNumber(directives, "小时", 1000)
  let changedConstraints = false
  for (const member of namedMembers) {
    const escaped = member.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    if (new RegExp(`${escaped}.{0,4}(不能|不准|不要|别).{0,4}(参与|参加|负责|接|做)|(?:先不|暂不|不|不要|别)(?:安排|分配给|让)${escaped}`).test(constraintText)) {
      constraints.excludedMemberIds = [...new Set([...constraints.excludedMemberIds, member.id])]
      changedConstraints = true
    }
  }
  if (maxPeople && /只有|只允许|按|改成|换成|最多|并行|拆|完成/.test(constraintText)) {
    if (/只能|只有|只允许|最多/.test(constraintText)) { constraints.maxPeople = maxPeople; constraints.requiredPeople = /只能|只有|只允许/.test(constraintText) ? maxPeople : null }
    else { constraints.maxPeople = maxPeople; constraints.requiredPeople = maxPeople }
    changedConstraints = true
  }
  if (maxDays && /工期|压到|最多|完成|以内|放宽|上限/.test(constraintText)) { constraints.maxDays = maxDays; changedConstraints = true }
  if (maxHours && /总工时|总共|最多|上限|控制在/.test(constraintText)) { constraints.maxHours = maxHours; changedConstraints = true }
  if (/并行|同步推进/.test(directives)) { constraints.parallel = true; changedConstraints = true }
  if (/前后端|前端.*后端|后端.*前端/.test(directives)) { constraints.frontendBackend = true; constraints.parallel = true; changedConstraints = true }
  if (/(不拆|不要拆|别拆|不需要|不要强行生成).{0,8}(子任务|Subtask)/i.test(constraintText)) { constraints.allowSubtasks = false; changedConstraints = true }
  if (/(可以|继续|需要).{0,8}(拆|保留).{0,8}(子任务|Subtask)/i.test(directives)) { constraints.allowSubtasks = true; changedConstraints = true }
  if (/尽量少改|保留.*已有|保留前两个/.test(constraintText)) { constraints.preserveExisting = true; changedConstraints = true }
  if (/已有任务全部保留|不要动已经开始|不能改正在进行/.test(constraintText)) { constraints.preserveExisting = true; constraints.lockStartedTasks = true; changedConstraints = true }
  if (/不要动.*前两个|前两个.{0,8}不要动|保留前两个|前两个.{0,8}保留/.test(constraintText)) {
    constraints.lockedTaskKeys = [...new Set([...constraints.lockedTaskKeys, ...planTasks.slice(0, 2).map((task) => task.key)])]
    constraints.lockedTasks = { ...constraints.lockedTasks, ...Object.fromEntries(planTasks.slice(0, 2).map((task) => [task.key, structuredClone(task)])) }
    changedConstraints = true
  }
  if (/只拆后端|只要后端工作/.test(constraintText)) { constraints.backendOnly = true; changedConstraints = true }
  if (/恢复全部工作|前后端都要/.test(constraintText)) { constraints.backendOnly = false; changedConstraints = true }
  if (/重新安排所有|不用保留原有/.test(constraintText)) { constraints.preserveExisting = false; changedConstraints = true }
  if (memberId) {
    const name = state.members[memberId].name
    if (new RegExp(`${name}.{0,4}(不能|不准|不要|别).{0,4}(参与|参加|负责|接|做)`).test(constraintText)) {
      constraints.excludedMemberIds = [...new Set([...constraints.excludedMemberIds, memberId])]
      changedConstraints = true
    } else if (new RegExp(`${name}.{0,5}(可以|能).{0,3}(参与|参加|负责|接|做|了)`).test(constraintText)) {
      constraints.excludedMemberIds = constraints.excludedMemberIds.filter((id) => id !== memberId)
      changedConstraints = true
    } else if (/换成|换给|交给|改给|给.*负责|负责人.*改|负责人.*换|第.{0,4}个任务给/.test(directives)) {
      const assignedOrdinal = directives.match(/第([一二两三四五六七八九十\d]+)个(?:任务|工作项)?.{0,8}(?:换给|换成|交给|改给|改成|给)/)
      const assignedIndex = assignedOrdinal ? boundedNumber(`${assignedOrdinal[1]}个`, "", 10) : null
      const assignmentKeys = assignedIndex && planTasks[assignedIndex - 1]
        ? [planTasks[assignedIndex - 1].key]
        : referencedTaskKeys.length ? referencedTaskKeys
          : memory.referencedTaskKeys.length ? memory.referencedTaskKeys.slice(-1) : planTasks.slice(0, 1).map((task) => task.key)
      if (!assignedIndex) constraints.preferredAssigneeId = memberId
      for (const key of assignmentKeys) constraints.assignmentOverrides[key] = memberId
      changedConstraints = true
    }
  }
  if (memberId && /只能做测试|只负责测试/.test(constraintText)) {
    constraints.testOnlyMemberIds = [...new Set([...constraints.testOnlyMemberIds, memberId])]
    changedConstraints = true
  }
  if (/只允许/.test(constraintText) && memberIds.length > 0 && /和|、/.test(constraintText)) {
    constraints.allowedMemberIds = memberIds
    changedConstraints = true
  }
  if (/最后一个不要|第三个不要/.test(constraintText)) {
    const key = /第三个/.test(constraintText) ? planTasks[2]?.key : planTasks.at(-1)?.key
    if (key) { constraints.removedTaskKeys = [...new Set([...constraints.removedTaskKeys, key])]; changedConstraints = true }
  }
  if (/第三个重新拆/.test(constraintText) && planTasks[2]) {
    constraints.removedTaskKeys = [...new Set([...constraints.removedTaskKeys, planTasks[2].key])]
    changedConstraints = true
  }
  const sprint = Object.values(state.sprints).find((item) => question.includes(item.name))
  if (sprint && /(?:目标|安排到|移到|转到|改到|放到|规划到).{0,12}#?Sprint/i.test(directives)) {
    constraints.targetSprintId = sprint.id; changedConstraints = true
  }

  const selected = request.commandText.match(/(?:选|用|按|方案)\s*(?:方案)?\s*([ABC])\b/i)?.[1]?.toUpperCase()
  const selectedOptionId = selected === "A" || selected === "B" || selected === "C" ? selected
    : /选最终方案|确认最终方案|就按最终方案/.test(request.commandText) ? memory.activePlanId : null
  const merge = directives.match(/负责人(?:按|照|用)\s*(?:方案)?\s*([ABC])/i)?.[1]?.toUpperCase()
  const mergeAssignmentsFrom = merge === "A" || merge === "B" || merge === "C" ? merge : null
  const delayDays = /延期|晚|推迟/.test(question) ? boundedNumber(question, "天", 60) : null
  const removeDependency = /依赖.{0,8}(去掉|取消|解除)|(?:去掉|取消|解除).{0,30}依赖/.test(directives)

  let intent: MeetingIntent = "other"
  if (asksForExistingTaskStatus(question)) intent = "other"
  else if (/总结|回顾|会议记录|实际(?:执行|应用)(?:结果|情况)|写入了什么/.test(question)) intent = "summary"
  else if (requestsPlanReview(question)) intent = "execute"
  else if (/比较|区别|哪个方案|还有别的办法|更少的方案/.test(question)) intent = "compare"
  else if (selectedOptionId) intent = "select"
  else if (/[一二三四五六七八九十\d]+\s*天.{0,8}(不可行|做不完|完不成|不够)/.test(question)) intent = "plan"
  else if (/风险|依赖|延期|晚.*天|拖慢|影响哪些/.test(question)) intent = "risk"
  else if (/负载|容量|给谁|平衡|换成|负责人|接这个/.test(question)) intent = "workload"
  else if (/拆|规划|并行|任务|两个人|三个人|工期/.test(question)) intent = "plan"
  else if (/为什么|推进不动|卡住|阻塞/.test(question)) intent = "diagnose"
  if (explicitAgent) {
    const specialistIntent: Partial<Record<AgentType, MeetingIntent>> = {
      task_decomposition: "plan", risk_dependency: "risk", workload_capacity: "workload", plan_execution: "execute",
    }
    intent = specialistIntent[explicitAgent] ?? intent
  } else if (intent === "other" && changedConstraints) intent = memory.currentTopic === "workload" ? "workload" : "plan"
  else if (intent === "other" && !asksForExistingTaskStatus(question) && llmHints?.intent) intent = llmHints.intent
  else if (intent === "other" && !asksForExistingTaskStatus(question) && ["plan", "risk", "workload", "execute", "compare", "select", "diagnose", "summary"].includes(memory.currentTopic)) intent = memory.currentTopic as MeetingIntent

  // 助手选择、上一轮状态和模型推断都不能替本轮用户授权提交行动建议。
  if (intent === "execute" && !requestsPlanReview(question)) {
    intent = /比较|区别|方案/.test(request.topicText) ? "compare"
      : /风险|依赖|影响/.test(request.topicText) ? "risk"
        : /容量|负载/.test(request.topicText) ? "workload" : "other"
  }

  const merged = mergeMeetingConstraints(memory.constraints, question, state, planTasks)
  Object.assign(constraints, { people: merged.people, requiredPeople: merged.requiredPeople, maxPeople: merged.maxPeople,
    maxTotalHours: merged.maxTotalHours, maxHours: merged.maxHours, maxDays: merged.maxDays,
    memberRules: merged.memberRules, testOnlyMemberIds: merged.testOnlyMemberIds,
    excludedMemberIds: merged.excludedMemberIds, assignmentOverrides: merged.assignmentOverrides })
  changedConstraints ||= JSON.stringify(constraints) !== JSON.stringify(memory.constraints)
  return { intent, selectedOptionId, referencedTaskKeys, referencedMemberIds: memberIds,
    constraints, changedConstraints, delayDays, removeDependency, mergeAssignmentsFrom, explicitAgent }
}
