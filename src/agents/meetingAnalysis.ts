import { addBusinessDays, format, parseISO } from "date-fns"
import { memberLoads, meetingStories } from "./meetingPlanning"
import { buildProjectAnalysisSnapshot, type ProjectAnalysisSnapshot } from "./meetingSnapshot"
import { remainingWork } from "../utils/workloadAnalysis"
import type { MeetingMemory, MeetingSession, PlanOption, ProjectDataState } from "../types"
import { projectPlanCapacity } from "./meetingCapacity"

export interface MeetingFinding { content: string; evidence: string[] }

export { dependencyImpact } from './meetingDependency'

export function workloadComparison(state: ProjectDataState, session: MeetingSession, options: PlanOption[], analysis?: ProjectAnalysisSnapshot, question = ""): MeetingFinding {
  const sprintId = session.targetType === "sprint" ? session.targetId : meetingStories(state, session)[0]?.sprintId ?? null
  const baseline = analysis?.focusedSprint?.id === sprintId
    ? Object.fromEntries(Object.values(analysis.members).map((member) => [member.id, member.currentSprintWorkload]))
    : memberLoads(state, sprintId)
  const distinct = options.filter((option, index) => options.findIndex((other) =>
    JSON.stringify(other.tasks.map((task) => [task.key, task.assigneeId, task.dependsOnKeys])) ===
    JSON.stringify(option.tasks.map((task) => [task.key, task.assigneeId, task.dependsOnKeys]))) === index)
  const rows = distinct.map((option) => {
    const changes = option.tasks.filter((task) => task.sourceTaskId && state.tasks[task.sourceTaskId]?.assigneeId !== task.assigneeId)
    const drafts=option.tasks.filter(task=>!task.sourceTaskId)
    const capacity=projectPlanCapacity(state,sprintId,option.tasks,new Date(),option.subtasks)
    return `${option.title}：调整 ${changes.length} 个已有任务${changes.length ? `（${changes.map((task) => `${task.title} → ${state.members[task.assigneeId]?.name ?? "待定"}`).join("、")}）` : ""}${drafts.length?`；另有 ${drafts.length} 项尚未登记的拆解建议（${drafts.map(task=>`${task.title} ${task.estimate}h`).join('、')}）`:''}，按负责人容量与依赖预计至少 ${option.estimatedDurationDays} 个工作日。${option.feasible ? option.advantages[0] : `当前限制未满足：${option.infeasibleReasons.join("；")}`}\n该方案投影：${Object.values(capacity.members).map(member=>`${member.memberName} ${member.currentLoad}h→${member.projectedLoad}h`).join('；')}；这是建议，未执行。`
  })
  const fastest = [...options].sort((a, b) => a.estimatedDurationDays - b.estimatedDurationDays)[0]
  const leastChange = [...options].sort((a, b) =>
    a.tasks.filter((task) => task.sourceTaskId && state.tasks[task.sourceTaskId]?.assigneeId !== task.assigneeId).length -
    b.tasks.filter((task) => task.sourceTaskId && state.tasks[task.sourceTaskId]?.assigneeId !== task.assigneeId).length)[0]
  const requestedTradeoff = /最快完成|工期最快|最少调整/.test(question)
    ? `按当前计算，少改动选 ${leastChange?.id ?? "待定"}；最短工期选 ${fastest?.id ?? "待定"}${fastest?.estimatedDurationDays === leastChange?.estimatedDurationDays ? "，两者的预计工期相同" : ""}。` : ""
  const active = options[0]
  const capacity = active ? projectPlanCapacity(state, sprintId, active.tasks,new Date(),active.subtasks) : null
  const capacityText = capacity ? `\n容量净差额（当前负载－旧任务贡献＋新任务贡献）：总计 ${capacity.totalCurrentHours}h → ${capacity.totalProjectedHours}h。${Object.values(capacity.members).filter(member=>member.projectedLoad>0).map(member=>`${member.memberName} ${member.currentLoad}h→${member.projectedLoad}h，剩余窗口容量 ${member.timeWindowCapacityHours}h`).join('；')}。${capacity.remainingWorkingDays===0?'该Sprint已没有剩余工作日。':'现有任务不重复计入。'}` : ''
  return {
    content: rows.length ? distinct.length === 1
      ? `按当前任务、负责人和依赖计算，两种策略得到同一安排，没有必要分成两套方案。${rows[0]}${capacityText}`
      : `我按现有任务和成员容量比较了两种安排。\n${rows.join("\n")}\n${requestedTradeoff || "A 适合少改现有分工；B 更关注负载分布。"}${capacityText}你可以选 A 或 B，也可以指定某项任务的负责人。` : "当前还没有可比较的工作方案，请先讨论任务拆解。",
    evidence: [
      `现有未完成负载：${Object.entries(baseline).map(([id, hours]) => `${state.members[id]?.name ?? id} ${hours}h`).join("、")}`,
      ...options.map((option) => `${option.title}调整后：${Object.entries(option.workloadSummary).map(([id, hours]) => `${state.members[id]?.name ?? id} ${hours}h`).join("、")}`),
    ],
  }
}

export function workloadAdvice(state: ProjectDataState, snapshot: ProjectAnalysisSnapshot, question: string, taskKey: string | null,
  excludedMemberIds: string[] = []): MeetingFinding {
  const parent = taskKey ? snapshot.tasks[taskKey] : null
  const scopedStep = parent && Object.values(state.subtasks).find(step => step.taskId === parent.id &&
    (question.includes(step.title) || question.includes("验收结果记录接口") && step.title.includes("验收结果记录接口")))
  const task = parent && scopedStep ? { ...parent, id: scopedStep.id, title: scopedStep.title, assigneeId: scopedStep.assigneeId,
    remainingHours: remainingWork(scopedStep), status: scopedStep.status, dependentIds: [] } : parent
  if (scopedStep && !excludedMemberIds.includes(scopedStep.assigneeId) && /谁|哪(?:位|个)/.test(question)) {
    const owner = snapshot.members[scopedStep.assigneeId]
    if (owner) return { content: `这项「${scopedStep.title.split(/[:：]/)[0]}」已经由${owner.name}负责，约 ${scopedStep.estimate}h，继续由他推进最省交接成本。

他本轮还有 ${owner.currentSprintWorkload}h 未完成工作，剩余可安排约 ${Math.max(0,owner.remainingCapacity)}h；这项已计入现有负载，不再重复加一次。

${excludedMemberIds.length ? "已排除" + excludedMemberIds.map(id=>state.members[id]?.name).join("、") + "。" : ""}如果要换人，先确认交接与优先级，再审核新的分工。`,
      evidence: [`工作范围：${scopedStep.title}`, `当前负责人：${owner.name}；任务工时：${scopedStep.estimate}h`, `本轮已有负载：${owner.currentSprintWorkload}h；剩余容量：${owner.remainingCapacity}h`] }
  }
  const mentioned = /谁|哪(?:位|个)|其他人|不安排|排除/.test(question) ? undefined : Object.values(snapshot.members).find((member) => !excludedMemberIds.includes(member.id) && question.includes(member.name))
  if (mentioned && !excludedMemberIds.includes(mentioned.id) && !/谁|哪(?:位|个)|其他人|不安排|排除/.test(question) && /接|新增|增加/.test(question)) {
    const incoming = Number(question.match(/(\d+(?:\.\d+)?)\s*(?:h|小时)/i)?.[1] ?? task?.remainingHours ?? 0)
    const days=snapshot.focusedSprint?.remainingWorkingDays??0, window=mentioned.dailyHours*days
    const projected=mentioned.currentSprintWorkload+incoming
    return {content:`${mentioned.name}${days===0||projected>window?'不能':'可以讨论'}在${snapshot.focusedSprint?.name??'当前范围'}接 ${incoming}h 新工作。剩余 ${days} 个工作日、时间窗口容量 ${window}h；已有未完成 ${mentioned.currentSprintWorkload}h，新增后 ${projected}h。${days===0?'Sprint计划结束日已过，不能用名义周容量代替剩余窗口。':'仍需核对依赖与优先级。'}这里只评估，不修改项目。`,evidence:[`周名义容量 ${state.members[mentioned.id].capacityHours}h`,`Sprint ${snapshot.focusedSprint?.startDate}→${snapshot.focusedSprint?.endDate}`,`当前负载 ${mentioned.currentSprintWorkload}h`]}
  }
  const members = Object.values(snapshot.members).filter((member) => !excludedMemberIds.includes(member.id))
  const ranked = members.filter((member) => !task || !/别人|其他人/.test(question) || member.id !== task.assigneeId).map((member) => {
    const added = task && task.assigneeId !== member.id ? task.remainingHours : 0
    return { member, after: member.currentSprintWorkload + added, added }
  }).sort((a, b) => b.member.remainingCapacity - a.member.remainingCapacity)
  const sprintName = snapshot.focusedSprint?.name ?? "当前讨论范围"
  if (!task) {
    const target = /最忙/.test(question) ? [...ranked].reverse()[0] : ranked[0]
    return { content: target ? `${sprintName}里，${target.member.name}${/最忙/.test(question) ? "当前承诺量最高" : "当前可用容量相对最多"}：未完成 ${target.member.currentSprintWorkload}h，按剩余工作日折算还可安排约 ${Math.max(0, target.member.remainingCapacity)}h。若要判断能否接具体任务，请引用该 Task。` : "当前没有可参与的成员，请先检查人员限制。",
      evidence: ranked.map(({ member }) => `${member.name}：本轮 ${member.currentSprintWorkload}h；全项目 ${member.totalWorkload}h；剩余容量 ${member.remainingCapacity}h`) }
  }
  if (task.status === "done") return { content: `「${task.title}」已经完成，不需要重新分配负责人。可以讨论它的后续工作。`, evidence: [`状态：${task.status}`] }
  const candidatePool = ranked.filter((item) => !task || item.member.id !== task.assigneeId)
  const candidates = mentioned ? ranked.filter((item) => item.member.id === mentioned.id) : candidatePool.slice(0, 3)
  const bestCandidate = !mentioned ? candidatePool[0]?.member : null
  const lines = candidates.map(({ member, after }) => {
    const available = Math.max(0, member.remainingCapacity)
    const risk = snapshot.focusedSprint?.remainingWorkingDays === 0 ? "当前 Sprint 已无剩余工作日" : after > member.currentSprintWorkload + available ? "容量偏紧" : "容量可讨论"
    const commitments = Object.values(snapshot.tasks).filter((item) => item.assigneeId === member.id && item.status !== "done" && item.id !== task.id && snapshot.stories[item.storyId]?.sprintId === snapshot.focusedSprint?.id)
      .sort((a, b) => b.dependentIds.length - a.dependentIds.length).slice(0, 2)
    const cost = commitments.length ? `；可能挤压「${commitments.map((item) => item.title).join("」「")}」${commitments.some((item) => item.dependentIds.length > 0) ? "等带有下游依赖的工作" : ""}` : "；当前未登记其他本轮未完成任务"
    return `${member.name}：本轮已有 ${member.currentSprintWorkload}h，接手后约 ${after}h，剩余可安排约 ${available}h；${risk}${cost}`
  })
  const commitment = mentioned ? state.tasks[task.id] && Object.values(state.tasks).filter((item) => item.assigneeId === mentioned.id && item.status !== "done" && item.id !== task.id && state.stories[item.storyId]?.sprintId === snapshot.focusedSprint?.id).slice(0, 2)
    .map((item) => item.title) : []
  const noSprintCapacity = snapshot.focusedSprint?.remainingWorkingDays === 0
  return { content: `${noSprintCapacity ? `${sprintName}已没有剩余工作日，当前没人能承诺在这一轮接手完成。以下只用于讨论后续迭代的分工：\n` : ""}${mentioned ? `如果把「${task.title}」交给${mentioned.name}，需要看他已有的承诺：` : `若要更换「${task.title}」的负责人，${bestCandidate ? `可先找${bestCandidate.name}核对` : "目前没有可比较的人选"}；具体候选如下：`}\n${lines.join("\n")}${commitment?.length ? `\n${mentioned!.name}目前还负责「${commitment.join("」「")}」，新任务优先时可能挤压这些工作。` : ""}\n这是容量建议；改负责人仍需在会议中确认并审核项目行动。`,
    evidence: [`任务：${task.title}，剩余 ${task.remainingHours}h，当前负责人 ${state.members[task.assigneeId]?.name ?? "未指定"}`,
      ...ranked.map(({ member }) => `${member.name}：本轮 ${member.currentSprintWorkload}h；全项目 ${member.totalWorkload}h；本轮剩余容量 ${member.remainingCapacity}h`)] }
}
