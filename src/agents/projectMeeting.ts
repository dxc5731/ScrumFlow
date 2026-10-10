import type { MeetingMemory, MeetingSession, ProjectDataState, StoryEntity, TaskEntity } from "../types"
import { remainingBusinessDays } from "./meetingPlanning"
import { buildProjectAnalysisSnapshot, type ProjectAnalysisSnapshot } from "./meetingSnapshot"
import { projectPlanCapacity } from './meetingCapacity'
import { buildWorkloadSnapshot, projectDate, taskContributions } from "../utils/workloadAnalysis"

export interface ProjectFinding { content: string; evidence: string[] }

function pendingHours(state: ProjectDataState, task: TaskEntity): number {
  return Object.values(taskContributions(state, task)).reduce((a, b) => a + b, 0)
}

function storyFacts(state: ProjectDataState, story: StoryEntity) {
  const tasks = story.taskIds.map((id) => state.tasks[id]).filter(Boolean)
  const taskIds = new Set(tasks.map((task) => task.id))
  const blocked = tasks.filter((task) => task.status === "blocked")
  const dependencies = Object.values(state.dependencies).filter((dep) => taskIds.has(dep.targetTaskId))
  const openRisks = Object.values(state.risks).filter((risk) => risk.status !== "resolved" && (
    risk.targetType === "story" && risk.targetId === story.id || risk.targetType === "task" && taskIds.has(risk.targetId)
  ))
  return { tasks, blocked, dependencies, openRisks, remaining: tasks.reduce((sum, task) => sum + pendingHours(state, task), 0),
    done: tasks.filter((task) => task.status === "done").length,
    sprint: story.sprintId ? state.sprints[story.sprintId] : null }
}

export function projectOverview(state: ProjectDataState, analysis?: ProjectAnalysisSnapshot): ProjectFinding {
  const sprint = analysis?.activeSprint ?? Object.values(state.sprints).find((item) => item.status === "active") ?? Object.values(state.sprints).find((item) => item.status === "planning")
  const unfinished = Object.values(state.tasks).filter((task) => task.status !== "done")
  const blocked = unfinished.filter((task) => task.status === "blocked")
  const overdue = unfinished.filter((task) => task.endDate < (analysis?.currentDate ?? projectDate()))
  const risks = Object.values(state.risks).filter((risk) => risk.status !== "resolved")
  const high = risks.filter((risk) => risk.level === "high")
  const attention = [
    blocked.length ? `${blocked.length} 个任务受阻` : "",
    overdue.length ? `${overdue.length} 个任务超过计划结束日` : "",
    high.length ? `${high.length} 项高风险仍未解决` : "",
  ].filter(Boolean)
  return {
    content: `${sprint ? `${sprint.name}${"effectiveStatus" in sprint && sprint.effectiveStatus === "overdue" ? "在项目中仍标为进行中，但计划结束日已过，应先确认后续迭代" : ` 当前处于${sprint.status === "active" ? "进行" : "规划"}阶段`}。` : "目前没有进行中的 Sprint。"}项目有 ${Object.keys(state.stories).length} 个 Story、${unfinished.length} 个未完成任务和 ${risks.length} 项未解决风险。${attention.length ? `值得先看：${attention.join("；")}。` : "暂未发现明显阻塞或逾期。"}\n可以引用两条 Story 比较优先级，或问我某位成员的工作情况。`,
    evidence: [
      `阻塞任务：${blocked.slice(0, 6).map((task) => `${task.id.toUpperCase()} ${task.title}`).join("、") || "无"}`,
      `逾期任务：${overdue.slice(0, 6).map((task) => `${task.id.toUpperCase()} ${task.title}`).join("、") || "无"}`,
      `开放风险：${risks.slice(0, 6).map((risk) => `${risk.title}（${risk.level}）`).join("、") || "无"}`,
    ],
  }
}

export function projectMemberOverview(state: ProjectDataState, memberId: string): ProjectFinding {
  const member = state.members[memberId]
  if (!member) return { content: "没有找到这位成员。", evidence: [] }
  const tasks = Object.values(state.tasks).filter(task => (taskContributions(state, task)[memberId] ?? 0) > 0)
  const hours = tasks.reduce((sum, task) => sum + (taskContributions(state, task)[memberId] ?? 0), 0)
  const blocked = tasks.filter((task) => task.status === "blocked")
  return {
    content: `${member.name}目前直接负责 ${tasks.length} 个未完成任务，剩余约 ${hours}h。${blocked.length ? `${blocked.length} 个处于阻塞，` : ""}主要工作是${tasks.slice(0, 3).map((task) => `「${task.title}」`).join("、") || "尚无待办任务"}。这是项目记录里的分工，并不代表成员已经确认新的安排。`,
    evidence: tasks.map((task) => `${task.id.toUpperCase()} ${task.title}：${taskContributions(state, task)[memberId] ?? 0}h，${task.status}，截止 ${task.endDate}`),
  }
}

export function projectSprintCapacity(state: ProjectDataState, sprintId: string, analysis?: ProjectAnalysisSnapshot): ProjectFinding {
  const sprint = state.sprints[sprintId]
  if (!sprint) return { content: "没有找到这个 Sprint。", evidence: [] }
  const tasks = Object.values(state.tasks).filter((task) => state.stories[task.storyId]?.sprintId === sprintId && task.status !== "done")
  const remaining = tasks.reduce((sum, task) => sum + pendingHours(state, task), 0)
  const available = analysis?.sprints[sprintId]
    ? sprint.memberIds.reduce((sum, id) => sum + (analysis.members[id]?.dailyHours ?? 0) * analysis.sprints[sprintId].remainingWorkingDays, 0)
    : sprint.memberIds.reduce((sum, id) => sum + (buildWorkloadSnapshot(state, sprintId).members[id]?.remainingTimeCapacity ?? 0), 0)
  return {
    content: `${sprint.name}计划包含 ${tasks.length} 个未完成任务，剩余约 ${remaining}h；按剩余工作日折算，参与成员可用容量约 ${Math.round(available)}h。${analysis?.sprints[sprintId]?.remainingWorkingDays === 0 ? "这一轮已没有剩余工作日，需要确认后续排期。" : "应先扣除已经承诺的工作，再安排新任务。"}`,
    evidence: [`成员：${sprint.memberIds.map((id) => `${state.members[id]?.name ?? id} ${state.members[id]?.capacityHours ?? 0}h/周`).join("、")}`, `Sprint 日期：${sprint.startDate} 至 ${sprint.endDate}`],
  }
}

export function compareProjectStories(state: ProjectDataState, ids: string[]): ProjectFinding {
  const stories = ids.map((id) => state.stories[id]).filter(Boolean).slice(0, 2)
  if (stories.length < 2) return { content: "请先引用两条 Story，我会按剩余工作、阻塞、风险和 Sprint 状态比较。", evidence: [] }
  const [a, b] = stories
  const first = storyFacts(state, a)
  const second = storyFacts(state, b)
  const describe = (story: StoryEntity, facts: ReturnType<typeof storyFacts>) =>
    `${story.id.toUpperCase()}「${story.title}」：${facts.done}/${facts.tasks.length} 个任务已完成，${facts.tasks.length ? `剩余约 ${facts.remaining}h` : "尚未拆任务，工时未估算"}；${facts.blocked.length} 个阻塞、${facts.openRisks.length} 项未解决风险；${facts.sprint?.name ?? "未安排 Sprint"}${facts.sprint?.status === "closed" ? "（已关闭）" : ""}。`
  const chosen = first.sprint?.status === "closed" && second.sprint?.status !== "closed" ? b
    : second.sprint?.status === "closed" && first.sprint?.status !== "closed" ? a
      : first.blocked.length !== second.blocked.length ? first.blocked.length > second.blocked.length ? a : b
        : first.openRisks.length !== second.openRisks.length ? first.openRisks.length > second.openRisks.length ? a : b
          : first.remaining >= second.remaining ? a : b
  const equalEvidence = !first.tasks.length && !second.tasks.length && !first.openRisks.length && !second.openRisks.length && !first.sprint && !second.sprint
  const reason = state.sprints[chosen.sprintId ?? ""]?.status === "closed"
    ? "所属 Sprint 已关闭，应先明确后续迭代" : "需要优先澄清其剩余工作或交付风险"
  const sprintId=a.sprintId??b.sprintId??Object.values(state.sprints).find(sprint=>sprint.status==='active')?.id??null
  const capacity=projectPlanCapacity(state,sprintId,[])
  const capacityText=`团队容量依据：${state.sprints[sprintId??'']?.name??'未指定Sprint'} 剩余 ${capacity.remainingWorkingDays} 个工作日；${Object.values(capacity.members).map(member=>`${member.memberName} 当前 ${member.currentLoad}h / 时间窗口 ${member.timeWindowCapacityHours}h（名义 ${member.nominalWeeklyHours}h/周）`).join('；')}。`
  const costs=stories.map(story=>{const facts=storyFacts(state,story);return facts.tasks.length?`${story.id.toUpperCase()} 的剩余 ${facts.remaining}h 是待兑现承诺${story.sprintId===sprintId?'，已计入当前负载，不能再重复叠加':''}；若优先给它时间，需要挤占其他未完成任务相同工时。`:`${story.id.toUpperCase()} 估算为 UNKNOWN，容量投影和机会成本也为 UNKNOWN，不能按0h插入。`}).join('\n')
  return {
    content: `${describe(a, first)}\n${describe(b, second)}\n${capacityText}\n机会成本：\n${costs}\n${capacity.remainingWorkingDays===0?'当前窗口不支持追加任何新的工时承诺，需先确定后续迭代。':''}${equalEvidence ? "现有任务、风险与迭代信息不足以判断哪条更该优先做；请先确认业务时限或价值，再决定讨论顺序。" : `我建议先讨论 ${chosen.id.toUpperCase()}，因为它${reason}。这只是讨论顺序；实际排期仍由你确认。`}`,
    evidence: stories.flatMap((story) => {
      const facts = storyFacts(state, story)
      return [`${story.id.toUpperCase()}：验收标准 ${story.acceptanceCriteriaIds.length} 条；依赖 ${facts.dependencies.length} 条；负责人 ${state.members[story.assigneeId]?.name ?? "未指定"}`]
    }),
  }
}

export function describeFocusedStory(state: ProjectDataState, id: string): ProjectFinding {
  const story = state.stories[id]
  if (!story) return { content: "没有找到这条 Story，请从 # 菜单重新选择。", evidence: [] }
  const facts = storyFacts(state, story)
  return {
    content: `现在看 ${story.id.toUpperCase()}「${story.title}」。${facts.done}/${facts.tasks.length} 个任务已完成，${facts.tasks.length ? `剩余约 ${facts.remaining}h` : "尚未拆任务，工时未估算"}；${facts.blocked.length} 个任务阻塞，${facts.openRisks.length} 项风险未解决。${facts.sprint?.status === "closed" ? `${facts.sprint.name} 已关闭，后续规划需要先明确新的迭代。` : `所属 ${facts.sprint?.name ?? "Product Backlog"}。`}你可以继续问具体任务、成员负载或让任务拆解助手重新规划。`,
    evidence: [`任务：${facts.tasks.map((task) => `${task.id.toUpperCase()} ${task.title}（${task.status}，剩余 ${pendingHours(state, task)}h）`).join("；") || "无"}`],
  }
}

export function describeStoryTaskStatus(state: ProjectDataState, id: string, analysis: ProjectAnalysisSnapshot): ProjectFinding {
  const story = state.stories[id]
  if (!story) return { content: "没有找到这条 Story，请从 # 菜单重新选择。", evidence: [] }
  const tasks = story.taskIds.map((taskId) => state.tasks[taskId]).filter(Boolean)
  if (!tasks.length) return { content: `${id.toUpperCase()}「${story.title}」目前还没有登记下级任务，因此无法统计任务完成情况。`, evidence: [] }
  const labels = { todo: "待办", in_progress: "进行中", review: "待审核", done: "已完成", blocked: "受阻" }
  const done = tasks.filter((task) => task.status === "done").length
  const lines = tasks.map((task) => {
    const subtasks = task.subtaskIds.map((subtaskId) => state.subtasks[subtaskId]).filter(Boolean)
    const steps = subtasks.length ? `；下级步骤 ${subtasks.filter((subtask) => subtask.status === "done").length}/${subtasks.length} 已完成` : ""
    const progress = task.status === "done" ? 100 : task.progress
    return `- ${task.id.toUpperCase()}「${task.title}」：${labels[task.status]}，登记进度 ${progress}%，负责人${state.members[task.assigneeId]?.name ?? "待确认"}${steps}`
  })
  return {
    content: `${id.toUpperCase()}「${story.title}」共有 ${tasks.length} 个任务，${done} 个已完成、${tasks.length - done} 个未完成。\n${lines.join("\n")}`,
    evidence: [`当前 Story 剩余工时：${analysis.stories[id]?.remainingHours ?? tasks.reduce((sum, task) => sum + pendingHours(state, task), 0)}h`, `任务状态来自当前项目记录`],
  }
}

/** Read the existing DAG; a discussed plan must not replace applied owners. */
export function describeStoryTaskOrder(state: ProjectDataState, id: string): ProjectFinding {
  const story=state.stories[id], tasks=story?.taskIds.map(key=>state.tasks[key]).filter(Boolean) ?? []
  if (!tasks.length) return {content:"这条 Story 还没有现有任务，可以先讨论拆分。",evidence:[]}
  const pending=new Set(tasks.map(task=>task.id)), levels: TaskEntity[][]=[], edges=Object.values(state.dependencies)
  while (pending.size) {
    const layer=tasks.filter(task=>pending.has(task.id) && !edges.some(edge=>edge.targetTaskId===task.id && pending.has(edge.sourceTaskId)))
    if (!layer.length) return {content:"现有依赖中存在环，需要先确认前置关系，暂时不能给出执行顺序。",evidence:tasks.map(task=>task.title)}
    levels.push(layer);layer.forEach(task=>pending.delete(task.id))
  }
  const sections=levels.map((layer,index)=>{
    const label=index===0?"先推进":index===levels.length-1?"最后收口":"随后推进"
    return label+(layer.length>1?"（可并行）":"")+"：\n"+layer.map(task=>{
      const names=[...new Set(task.subtaskIds.map(key=>state.subtasks[key]?.assigneeId).filter(Boolean))].map(key=>state.members[key]?.name).filter(Boolean)
      return "- 「"+task.title+"」 · "+(state.members[task.assigneeId]?.name??"待确认")+" · 约 "+pendingHours(state,task)+"h"+(names.some(name=>name!==state.members[task.assigneeId]?.name)?"；步骤由"+names.join("、")+"承担":"")
    }).join("\n")
  })
  return {content:story.id.toUpperCase()+" 按现有依赖分 "+levels.length+" 步推进，先把起点工作启动。\n\n"+sections.join("\n\n")+"\n\n先确认起点任务的启动时间，当前负责人保持不变。",
    evidence:[...edges.filter(edge=>tasks.some(task=>task.id===edge.targetTaskId)).map(edge=>(state.tasks[edge.sourceTaskId]?.title??edge.sourceTaskId)+" → "+state.tasks[edge.targetTaskId]?.title),
      ...tasks.flatMap(task=>task.subtaskIds.map(key=>state.subtasks[key]).filter(Boolean).map(step=>step.title+" · "+state.members[step.assigneeId]?.name+" · "+step.estimate+"h"))]}
}

/** Compose every explicitly requested fact section before asking for prose. */
export function describeStoryScopeFacts(state: ProjectDataState, id: string, analysis: ProjectAnalysisSnapshot): ProjectFinding {
  const story = state.stories[id]
  if (!story) return { content: '没有找到这条 Story。', evidence: [] }
  const tasks = describeStoryTaskStatus(state, id, analysis)
  const sprint = story.sprintId ? analysis.sprints[story.sprintId] : null
  const criteria = story.acceptanceCriteriaIds.map(key => state.acceptanceCriteria[key]).filter(Boolean)
  const sprintText = sprint ? `${sprint.name}（登记状态 ${sprint.status}），${sprint.startDate}→${sprint.endDate}，剩余 ${sprint.remainingWorkingDays} 个工作日。` : '尚未安排 Sprint。'
  const acceptanceText = criteria.map(item => `- ${item.id}：${item.content}；${item.satisfied ? '已满足' : '尚未满足'}`).join('\n') || '尚未登记验收标准。'
  return { content: `本次 Focus：${id.toUpperCase()}「${story.title}」。仅读取当前项目事实。\n\n当前任务\n${tasks.content}\n\n所属 Sprint\n${sprintText}\n\n验收标准\n${acceptanceText}\n\n本轮没有生成方案或写入项目。`, evidence: [...tasks.evidence, sprintText, acceptanceText] }
}

export function describeTaskSteps(state: ProjectDataState, taskIds: string[]): ProjectFinding {
  const labels = { todo: "待办", in_progress: "进行中", review: "待审核", done: "已完成", blocked: "受阻" }
  const tasks = taskIds.map(id => state.tasks[id]).filter(Boolean)
  return { content: tasks.map(task => {
    const steps = task.subtaskIds.map(id => state.subtasks[id]).filter(Boolean)
    return `${task.id.toUpperCase()}「${task.title}」：${labels[task.status]}，登记进度 ${task.status === "done" ? 100 : task.progress}%。${steps.length ? `下级子任务 ${steps.length} 个：\n${steps.map(step => `- ${step.id}「${step.title}」：${labels[step.status]}，${step.estimate}h，${state.members[step.assigneeId]?.name ?? "待分配"}`).join("\n")}` : "尚无子任务。"}`
  }).join("\n\n"), evidence: ["状态与步骤均来自当前任务记录，未新增或修改工作"] }
}

export function projectRiskOverview(state: ProjectDataState): ProjectFinding {
  const risks = Object.values(state.risks).filter(risk => risk.status !== "resolved")
  const blocked = Object.values(state.tasks).filter(task => task.status === "blocked")
  return { content: `项目目前有 ${risks.length} 项未解决风险、${blocked.length} 个受阻任务。\n${risks.map(risk => `- ${risk.title}：${risk.description}；影响：${risk.impact}；应对：${risk.mitigation || "尚未登记"}`).join("\n")}\n${blocked.map(task => `- ${task.id.toUpperCase()}「${task.title}」受阻，负责人${state.members[task.assigneeId]?.name ?? "待确认"}`).join("\n")}`,
    evidence: risks.map(risk => `${risk.id}：${risk.level}，${risk.status}`) }
}

export function projectWorkloadOverview(snapshot: ProjectAnalysisSnapshot): ProjectFinding {
  const sprint = snapshot.focusedSprint ?? snapshot.activeSprint
  const lines = Object.values(snapshot.members).map(member => `- ${member.name}：本轮未完成 ${member.currentSprintWorkload}h，全项目未完成 ${member.totalWorkload}h；每日容量 ${member.dailyHours}h，本轮剩余可分配容量 ${member.remainingCapacity}h`)
  return { content: `${sprint?.name ?? "当前项目"}成员负载如下。${sprint?.remainingWorkingDays === 0 ? "当前迭代已无剩余工作日，新增工作需要后续排期。" : "容量按剩余工作日和已登记工作计算。"}\n${lines.join("\n")}`, evidence: lines }
}

export function crossStoryImpact(state: ProjectDataState, taskId: string, delayDays: number): ProjectFinding {
  const root = state.tasks[taskId]
  if (!root) return { content: "请先引用要分析的 Task。", evidence: [] }
  const queue = [taskId]
  const visited = new Set(queue)
  const affected: TaskEntity[] = []
  while (queue.length) {
    const sourceId = queue.shift()!
    for (const dep of Object.values(state.dependencies).filter((item) => item.sourceTaskId === sourceId)) {
      if (visited.has(dep.targetTaskId)) continue
      visited.add(dep.targetTaskId)
      const task = state.tasks[dep.targetTaskId]
      if (task) { affected.push(task); queue.push(task.id) }
    }
  }
  const stories = [...new Set(affected.map((task) => task.storyId).filter((id) => id !== root.storyId))]
  return {
    content: `${delayDays > 0 ? `如果「${root.title}」晚 ${delayDays} 个工作日` : `「${root.title}」是当前讨论的前置工作`}，沿已登记依赖会影响 ${affected.length} 个后续任务${affected.length ? `，包括「${affected.slice(0, 3).map((task) => task.title).join("」「")}」` : ""}${stories.length ? `，涉及其他 Story：${stories.map((id) => state.stories[id]?.id.toUpperCase() ?? id).join("、")}` : "，目前没有发现跨 Story 传播"}。${delayDays > 0 ? "这是假设分析，尚未改变项目计划。" : "这些影响来自当前项目登记的依赖。"}`,
    evidence: [`依赖链：${root.title}${affected.length ? ` → ${affected.map((task) => task.title).join(" → ")}` : "（无下游）"}`, `受影响 Story：${stories.map((id) => state.stories[id]?.title ?? id).join("、") || "无"}`],
  }
}

export function closedSprintGuidance(state: ProjectDataState, session: MeetingSession, memory: MeetingMemory,
  analysis = buildProjectAnalysisSnapshot(state, session, memory)): ProjectFinding | null {
  const story = state.stories[memory.focusStoryIds.at(-1) ?? (session.targetType === "story" ? session.targetId : "")]
  const sprint = story?.sprintId ? state.sprints[story.sprintId] : null
  if (!story || !sprint || memory.planningMode !== "normal" ||
    (sprint.status !== "closed" && (analysis.sprints[sprint.id]?.remainingWorkingDays ?? remainingBusinessDays(state, sprint.id)) > 0)) return null
  const next = Object.values(state.sprints).find((item) => item.id !== sprint.id && item.status !== "closed" && item.startDate > sprint.startDate)
  return {
    content: `${story.id.toUpperCase()} 所在的 ${sprint.name}${sprint.status === "closed" ? "已关闭" : "已没有剩余工作日"}，继续压缩这一轮工期没有意义。建议选一个方向：\nA. 以 ${next?.name ?? "下一轮 Sprint"} 为目标重新规划（需要先在项目里调整 Story 归属）\nB. 暂不绑定 Sprint，只讨论任务拆分和工作量\nC. 先诊断现有任务为什么卡住\n回复“选 A/B/C”，我们再继续。`,
    evidence: [`${sprint.name}：${sprint.startDate} 至 ${sprint.endDate}，状态 ${sprint.status}`, `Story 当前任务：${story.taskIds.length} 个`],
  }
}
