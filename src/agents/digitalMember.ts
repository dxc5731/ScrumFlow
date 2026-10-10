import { buildProjectAnalysisSnapshot, type ProjectAnalysisSnapshot } from "./meetingSnapshot"
import { requestsDirectMutation } from "./meetingRequest"
import { roundHours, taskContributions } from "../utils/workloadAnalysis"
import type { MeetingMemory, MeetingSession, ProjectDataState, TaskEntity } from "../types"

export interface DigitalMemberAnswer { memberId: string; content: string; evidence: string[]; suggestedTaskId?: string }

const statusName: Record<TaskEntity["status"], string> = {
  todo: "待办", in_progress: "进行中", review: "待验收", done: "已完成", blocked: "受阻",
}

function remaining(state: ProjectDataState, task: TaskEntity, memberId: string) {
  return taskContributions(state, task)[memberId] ?? 0
}

export function digitalMemberAnswer(state: ProjectDataState, session: MeetingSession, memory: MeetingMemory, memberId: string, question: string,
  analysis = buildProjectAnalysisSnapshot(state, session, memory)): DigitalMemberAnswer {
  const member = state.members[memberId]
  if (!member) throw new Error("项目成员不存在")
  const ownTasks = Object.values(state.tasks).filter((task) => task.assigneeId === memberId || task.subtaskIds.some((id) => state.subtasks[id]?.assigneeId === memberId))
  const unfinished = ownTasks.filter((task) => remaining(state, task, memberId) > 0)
  const total = roundHours(unfinished.reduce((sum, task) => sum + remaining(state, task, memberId), 0))
  const focused = unfinished.filter((task) => memory.focusTaskIds.includes(task.id) || memory.focusStoryIds.includes(task.storyId))
  const focusedHours = roundHours(focused.reduce((sum, task) => sum + remaining(state, task, memberId), 0))
  const blocked = unfinished.filter((task) => task.status === "blocked" || task.subtaskIds.some((id) => state.subtasks[id]?.assigneeId === memberId && state.subtasks[id].status === "blocked"))
  const ownStoryIds = new Set([
    ...Object.values(state.stories).filter((story) => story.assigneeId === memberId || story.collaboratorIds.includes(memberId)).map((story) => story.id),
    ...ownTasks.map((task) => task.storyId),
  ])
  const currentSprint = analysis.focusedSprint ? state.sprints[analysis.focusedSprint.id] : null
  const remainingDays = analysis.focusedSprint?.remainingWorkingDays ?? 0
  const capacity = analysis.members[memberId]?.remainingTimeCapacity ?? 0
  const sprintTasks = currentSprint ? unfinished.filter((task) => state.stories[task.storyId]?.sprintId === currentSprint.id) : unfinished
  const sprintHours = analysis.members[memberId]?.currentSprintWorkload ?? sprintTasks.reduce((sum, task) => sum + remaining(state, task, memberId), 0)
  const mentioned = Object.values(state.tasks).find((task) =>
    (memory.focusTaskIds.includes(task.id) || question.toLowerCase().includes(task.id.toLowerCase()) || question.includes(task.title)) && task.assigneeId !== memberId)
    ?? Object.values(state.tasks).find((task) => memory.focusStoryIds.includes(task.storyId) && task.assigneeId !== memberId &&
      (question.includes("测试") ? task.type === "test" : question.includes("接口") ? /接口/.test(task.title) : false))
  const upstream = blocked.flatMap((task) => Object.values(state.dependencies).filter((dep) => dep.targetTaskId === task.id)
    .map((dep) => state.tasks[dep.sourceTaskId]).filter(Boolean))
  const participated = session.messageIds.map((id) => state.meetingMessages[id]).filter((message) => message?.senderId === memberId)
  const relatedProposals = session.proposalIds.map((id) => state.proposals[id]).filter((proposal) => proposal?.actions.some((action) => action.proposedValue.assigneeId === memberId))
  const evidence = [
    `负责或参与的 Story：${[...ownStoryIds].map((id) => state.stories[id]?.title ?? id).join("、") || "无"}`,
    `未完成工作：${unfinished.map((task) => `${task.title} ${remaining(state, task, memberId)}h（${statusName[task.status]}）`).join("、") || "无"}`,
    `${currentSprint?.name ?? "当前范围"}未完成工作：${sprintHours}h`,
    `前置任务：${upstream.map((task) => `${task.title}（${statusName[task.status]}）`).join("、") || "无"}`,
    `${currentSprint?.name ?? "未指定 Sprint"}剩余 ${remainingDays} 个工作日；按成员周容量折算约 ${capacity}h`,
    `本次会议发言 ${participated.length} 条；关联待确认建议 ${relatedProposals.length} 份`,
  ]
  const leading = (focused.length ? focused : unfinished).slice(0, 2).map((task) => `「${task.title}」`).join("、")
  let content: string
  if (requestsDirectMutation(question)) {
    content="你确认一下新的分工或完成情况，我再按确定的安排做。我这里先不替你改。"
  } else if (/接.*(?:\d+\s*h|工作)|容量|再接|只回答.*自己/.test(question)) {
    const incoming=Number(question.match(/(\d+)\s*(?:h|小时)/i)?.[1]??0)
    const canAccept = remainingDays > 0 && sprintHours + incoming <= capacity
    const facts = `我在 ${currentSprint?.name ?? "当前范围"} 还有 ${sprintHours}h 未完成工作，剩余 ${remainingDays} 个工作日，按个人容量折算可安排约 ${capacity}h，扣除已有工作后余量为 ${Math.max(0, capacity - sprintHours)}h。`
    content = facts + "\n\n" + (canAccept ? `这项${incoming ? ` ${incoming}h` : ""}工作我这边有时间接。先把范围和优先级定一下，当前没有修改分工。`
      : `我这边暂时不太适合再接${incoming ? ` ${incoming}h` : "新工作"}。\n\n${remainingDays === 0 ? `${currentSprint?.name ?? "本轮"}已经没有剩余工作窗口，` : "本轮手头的工作已经比较满了，"}我还有约 ${sprintHours}h 没有收口。真要加的话，${remainingDays === 0 ? "得放到后面的安排里，现在接进来我也做不完。" : "先告诉我哪项可以往后放，不然会挤掉已经答应的工作。"}`
    )
  } else if (/已经完成|已完成|做完了什么|完成了哪些|完成了什么/.test(question)) {
    const completed = ownTasks.filter(task => task.status === "done")
    const steps = Object.values(state.subtasks).filter(step => step.assigneeId === memberId && step.status === "done")
    content = `我已经完成 ${completed.length} 个工程任务、${steps.length} 个子任务。\n${completed.map(task => `- ${task.id.toUpperCase()}「${task.title}」：已完成`).join("\n")}\n${steps.map(step => `- 「${step.title}」：已完成子任务`).join("\n")}`
  } else if (/明天.*完成|提前.*完成/.test(question) && blocked.length && upstream.length) {
    const related = blocked.filter((task) => Object.values(state.dependencies).some((dep) => dep.targetTaskId === task.id && upstream.some((source) => source.id === dep.sourceTaskId)))
    const hours = related.reduce((sum, task) => sum + remaining(state, task, memberId), 0)
    content = `如果「${upstream[0].title}」如期完成，我这边受它阻塞的工作还有约 ${hours}h，主要是${related.map((task) => `「${task.title}」`).join("、")}。这几项还没做完，明天能推进多少我不敢拍死，还得看${currentSprint?.name ?? "当前计划"}里其他已承诺工作。`
  } else if (/给你|转给你|接.*任务|可以接|能接|适合你/.test(question) && mentioned) {
    const incoming = analysis.tasks[mentioned.id]?.remainingHours ?? mentioned.estimate
    const alreadyOwned = remaining(state, mentioned, memberId)
    const next = sprintHours + Math.max(0, incoming - alreadyOwned)
    content = `我在${currentSprint?.name ?? "当前计划"}还有 ${sprintHours}h 未完成工作。接下「${mentioned.title}」后约为 ${next}h${total !== sprintHours ? `，全项目另有 ${total - sprintHours}h 未完成工作` : ""}。${remainingDays === 0 ? "当前 Sprint 已没有剩余工作日，这个安排需要放到后续计划中。" : next > capacity ? `这超过本轮剩余约 ${capacity}h 的容量，其他已承诺任务可能被挤压。` : "可以接，不过先确认一下范围和优先级。"}你确认分工后，我按新的安排做。`
  } else if (/为什么|没开始|没完成|卡|阻塞|延期/.test(question)) {
    const related=memory.focusStoryIds.length?ownTasks.filter(task=>memory.focusStoryIds.includes(task.storyId)):ownTasks
    const problems = related.filter(task => task.status === "blocked")
    content = problems.length ? `我这边主要卡在${problems.map(task => `「${task.title}」`).join("、")}。\n\n` +
      problems.slice(0, 3).map(task => `${task.blockReasons.map(reason => reason.message).join("；") || "具体原因还需要确认"}`).join("\n\n") +
      `${upstream.length ? `\n\n我需要先等「${upstream[0].title}」能交接，才能往下做。` : ""}`
      : `我目前在跟进${related.slice(0, 2).map(task => `「${task.title}」`).join("、") || "手里的项目工作"}。\n\n目前没有登记到这些工作的阻塞原因；如果现场有新的情况，我们可以一起补充。`
  } else {
    content = unfinished.length
      ? `我现在主要在跟进${leading}。${focused.length ? `你问的这部分还有约 ${focusedHours}h 没做完。` : `手里还有约 ${total}h 没做完。`}\n\n${blocked.length ? `有 ${blocked.length} 项还卡着，前面没交接的话，我也没法继续往下做。` : "目前这几项没有已知的阻塞，我先按现有顺序推进。"}`
      : `我手里的任务目前都已经收掉了。新工作可以先跟我确认范围，再看时间怎么安排。`
  }
  return { memberId, content, evidence, ...(/给你|转给你|接.*任务|可以接|能接/.test(question) && mentioned ? { suggestedTaskId: mentioned.id } : {}) }
}
