import type { MeetingConstraints, MeetingMemory, MeetingPlanTask, MeetingSession, PlanOption, PlanRevision, ProjectDataState } from "../types"
import { analyzeMeetingRequest } from "./meetingRequest"

/** Compatibility fields are projections. Hard rules are merged from the latest turn only. */
export function normalizeConstraints(input: MeetingConstraints): MeetingConstraints {
  const next = structuredClone(input)
  next.people ??= next.requiredPeople ? { mode: "exact", count: next.requiredPeople }
    : next.maxPeople ? { mode: "max", count: next.maxPeople } : null
  next.maxTotalHours ??= next.maxHours
  next.memberRules ??= {}
  for (const id of next.testOnlyMemberIds) next.memberRules[id] = { ...next.memberRules[id], allowedTaskTypes: ["test"] }
  next.requiredPeople = next.people?.mode === "exact" ? next.people.count : null
  next.maxPeople = next.people?.count ?? null
  next.maxHours = next.maxTotalHours ?? null
  next.testOnlyMemberIds = Object.entries(next.memberRules).filter(([, rule]) => rule.allowedTaskTypes?.length === 1 && rule.allowedTaskTypes[0] === "test").map(([id]) => id)
  for (const [key, id] of Object.entries(next.assignmentOverrides)) if (next.excludedMemberIds.includes(id)) delete next.assignmentOverrides[key]
  if (next.preferredAssigneeId && next.excludedMemberIds.includes(next.preferredAssigneeId)) next.preferredAssigneeId = null
  return next
}

const number = (raw: string): number => ({ 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }[raw] ?? Number(raw))
const esc = (raw: string) => raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export function mergeMeetingConstraints(previous: MeetingConstraints, text: string, state: ProjectDataState, tasks: MeetingPlanTask[]): MeetingConstraints {
  const request = analyzeMeetingRequest(text)
  const directives = request.planningText
  text = request.constraintText
  const next = normalizeConstraints(previous)
  const people = [...directives.matchAll(/(最多|至多|不超过|上限|至少|按|改成|换成|只有|只允许|只能)?\s*([一二两三四五六七八九十\d]+)\s*(?:个|名|位)?\s*人/g)].at(-1)
  if (people) next.people = { mode: /最多|至多|不超过|上限/.test(people[1] ?? "") ? "max" : "exact", count: number(people[2]) }
  const members = Object.values(state.members)
  // A member clause lasts until the next sentence/semicolon; "而且她" retains its subject.
  const memberRanges = members.flatMap(m => [...text.matchAll(new RegExp(esc(m.name), "g"))].map(match => ({ id: m.id, name: m.name, start: match.index! }))).sort((a,b) => a.start-b.start)
  const memberSpans: Array<[number, number]> = []
  for (const [index, member] of memberRanges.entries()) {
    const end = Math.min(memberRanges[index+1]?.start ?? text.length, member.start + (text.slice(member.start).search(/[；。]/) >= 0 ? text.slice(member.start).search(/[；。]/) : text.length))
    const clause = text.slice(member.start, end)
    const prefix = text.slice(Math.max(0, member.start-8), member.start)
    const noTest = /(?:负责|接|做).{0,4}测试/.test(clause) && (/(?:不能|不准|不要|别|不).{0,4}(?:负责|接|做)/.test(clause) || /(?:不要让|不让|不用)\s*$/.test(prefix))
    if (!noTest && (/(?:不能|不准|不要|别).{0,4}(?:参与|参加|负责|接|做)|不参与/.test(clause) || /(?:不要|排除|不含|不让|不用|(?:先不|暂不|不|不要|别)(?:安排|分配给|让))\s*$/.test(prefix))) {
      next.excludedMemberIds = [...new Set([...next.excludedMemberIds, member.id])]
    } else if (/(?:可以|允许|恢复).{0,4}(?:参与|参加|负责|接|做)/.test(clause)) next.excludedMemberIds = next.excludedMemberIds.filter(id => id !== member.id)
    const rule = { ...next.memberRules![member.id] }
    if (noTest) rule.allowedTaskTypes = ["frontend", "backend", "database", "design", "devops"]
    if (/(?:只|仅).{0,10}(?:测试|test)/i.test(clause)) rule.allowedTaskTypes = ["test"]
    if (/(?:只|仅).{0,10}后端/.test(clause)) rule.allowedTaskTypes = ["backend", "database"]
    if (/(?:只|仅).{0,10}前端/.test(clause)) rule.allowedTaskTypes = ["frontend"]
    if (/不限.*(?:类型|工作)|取消.*(?:角色|测试).*限制/.test(clause)) delete rule.allowedTaskTypes
    const days = clause.match(/(?:最多|上限|不超过|投入|只能|未来).{0,10}?([一二两三四五六七八九十\d]+)\s*(?:个工作日|工作日|天)/)
    const hours = clause.match(/(?:最多|上限|不超过|投入).{0,10}?(\d+(?:\.\d+)?)\s*(?:h|小时)/i)
    if (days) rule.maxDays = number(days[1])
    if (days && /未来/.test(clause) && /剩余容量|可用容量/.test(clause)) rule.capacityWindowDays = number(days[1])
    if (hours) rule.maxHours = Number(hours[1])
    if (Object.keys(rule).length) next.memberRules![member.id] = rule
    if (days || hours) memberSpans.push([member.start,end])
  }
  const globalText = [...text].map((char,i) => memberSpans.some(([a,b]) => i>=a && i<b) ? ' ' : char).join('')
  const hours = globalText.match(/(?:总(?:工作量|工时|工作时长)|总共|最多|控制在).{0,16}?(\d+(?:\.\d+)?)\s*(?:h|小时)/i)
  if (hours) next.maxTotalHours = Number(hours[1])
  if (/不设.*工时上限|取消.*总工时.*限制/.test(globalText)) { next.maxTotalHours = null; next.maxHours = null }
  const days = globalText.match(/(?:工期|最多|上限|放宽|压到).{0,10}?([一二两三四五六七八九十\d]+)\s*天/)
  if (days) next.maxDays = number(days[1])
  for (const match of directives.matchAll(/第([一二两三四五六七八九十\d]+)(?:项|个)(?:任务|工作项)?[^；。]{0,16}?(?:交给|换给|换成|改给|给)\s*([^；。，\s]+)/g)) {
    const task = tasks[number(match[1])-1]
    const member = members.find(m => match[2].startsWith(m.name))
    if (task && member) next.assignmentOverrides[task.key] = member.id
  }
  return normalizeConstraints(next)
}

export function synchronizeWorkingState(memory: MeetingMemory, state?: ProjectDataState, session?: MeetingSession): MeetingMemory {
  const focus = { storyIds: [...memory.focusStoryIds], taskIds: [...memory.focusTaskIds], sprintId: memory.focusSprintId }
  memory.constraints = normalizeConstraints(memory.constraints)
  const working = memory.workingState ?? { schemaVersion: 1 as const, focus, activeAgent: memory.lastAgentType,
    activePlanId: null, activePlanRevision: null, constraints: memory.constraints, planRevisions: [], whatIfResults: [] }
  working.focus = focus
  working.constraints = structuredClone(memory.constraints)
  if (!memory.options.length) {
    working.activePlanId = null; working.activePlanRevision = null; memory.activePlanId = null
  }
  if (!working.storeAtStart && state && session) {
    const { project, stories, tasks, subtasks, members, sprints, dependencies, risks, acceptanceCriteria } = state
    working.storeAtStart = structuredClone({ project, stories, tasks, subtasks, members, sprints, dependencies, risks, acceptanceCriteria })
    working.historyAtStart = state.history.map(item => item.id)
  }
  memory.workingState = working
  return memory
}

export function activePlanRevision(memory: MeetingMemory): PlanRevision | null {
  const working = memory.workingState
  return working?.planRevisions.find(item => item.planId === working.activePlanId && item.revision === working.activePlanRevision) ?? null
}

/** At the turn boundary the persisted working state is authoritative; legacy fields are UI projections. */
export function restoreWorkingState(memory: MeetingMemory): MeetingMemory {
  const working = memory.workingState
  if (!working) return memory
  memory.focusStoryIds = [...working.focus.storyIds]
  memory.focusTaskIds = [...working.focus.taskIds]
  memory.focusSprintId = working.focus.sprintId
  memory.constraints = structuredClone(working.constraints)
  const plan = activePlanRevision(memory)
  if (plan) {
    memory.options = working.planRevisions.filter(item => item.focus.storyIds.join(',') === working.focus.storyIds.join(',') && item.focus.sprintId === working.focus.sprintId)
      .filter((item, index, all) => !all.slice(index + 1).some(next => next.planId === item.planId)).map(item => structuredClone(item.option))
    memory.activePlanId = plan.optionId
  }
  return memory
}

/** Immutable revisions; legacy A/B options are read projections for the existing UI. */
export function commitPlanOptions(memory: MeetingMemory, options: PlanOption[], state: ProjectDataState): void {
  synchronizeWorkingState(memory)
  const working = memory.workingState!
  const focusKey = [...working.focus.storyIds].sort().join(',') || working.focus.sprintId || 'project'
  memory.options = options.map(option => {
    const planId = `plan:${focusKey}:${option.id}`
    const old = working.planRevisions.filter(item => item.planId === planId).at(-1)
    const signature = JSON.stringify([option.tasks, option.subtasks ?? [], memory.constraints])
    if (old && JSON.stringify([old.tasks, old.option.subtasks ?? [], old.constraintsSnapshot]) === signature) return structuredClone(old.option)
    const revision = (old?.revision ?? 0) + 1
    const current = { ...structuredClone(option), planId, revision }
    working.planRevisions.push({ planId, revision, optionId: option.id, focus: structuredClone(working.focus), tasks: structuredClone(option.tasks), subtasks: structuredClone(option.subtasks ?? []),
      dependencies: option.tasks.flatMap(task => task.dependsOnKeys.map(source => ({ sourceTaskKey: source, targetTaskKey: task.key,
        source: Object.values(state.dependencies).some(edge => edge.sourceTaskId === source && edge.targetTaskId === task.key) ? "registered" as const : "proposed" as const }))),
      assignments: Object.fromEntries([...option.tasks, ...option.subtasks??[]].map(task => [task.key,task.assigneeId])), estimates: Object.fromEntries([...option.tasks, ...option.subtasks??[]].map(task => [task.key,task.estimate])),
      constraintsSnapshot: structuredClone(memory.constraints), validation: { valid: option.feasible, errors: [...option.infeasibleReasons] }, option: current, createdAt: new Date().toISOString() })
    return current
  })
  const selected = memory.options.find(item => item.id === memory.activePlanId) ?? memory.options[0]
  memory.activePlanId = selected?.id ?? null
  working.activePlanId = selected?.planId ?? null
  working.activePlanRevision = selected?.revision ?? null
}
