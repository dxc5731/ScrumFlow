import { dependencyImpact, workloadAdvice, workloadComparison } from "./meetingAnalysis"
import { checkMeetingResponse } from "./meetingConsistency"
import { businessChangeSummary, describeBusinessChanges } from "./meetingBusinessSummary"
import { buildProjectAnalysisSnapshot } from "./meetingSnapshot"
import { asksForExistingTaskStatus, asksForNewWork, buildMeetingContext, focusedMeetingSession, memoryFor, understandMeetingTurn, updateMeetingFocus } from "./meetingContext"
import { draftMeetingWork } from "./meetingWorkDraft"
import { isMaterialFollowUp, isMaterialRequest } from "./materialSchema"
import { digitalMemberAnswer } from "./digitalMember"
import { getMeetingLlmTelemetry, meetingLlm, type MeetingLlm } from "./meetingLlm"
import { canComputeMeetingExplanation, canParseMeetingTurnLocally } from "./meetingCallPolicy"
import { recordSkippedModelCall } from "./meetingTelemetry"
import { createPlanOptions, describeOptions, meetingStories, proposalFromOption } from "./meetingPlanning"
import { comparePlans } from "./meetingPlanDiff"
import { agentName, analyzeMeetingAgent, parseAgentMention, summarizeMeeting, type AgentAnswer, type MeetingAgentId } from "./meetingConversation"
import { closedSprintGuidance, compareProjectStories, crossStoryImpact, describeFocusedStory, describeStoryScopeFacts, describeStoryTaskStatus, describeStoryTaskOrder, describeTaskSteps, projectRiskOverview, projectWorkloadOverview, projectMemberOverview, projectOverview, projectSprintCapacity } from "./projectMeeting"
import type { AgentType, MeetingMemory, MeetingSession, ProjectDataState } from "../types"
import { activePlanRevision, commitPlanOptions, restoreWorkingState, synchronizeWorkingState } from "./meetingWorkingState"
import { buildMaterialEvidenceBundle, describeMeetingEvidence } from "./materialEvidence"
import { meetingDiagnosis } from "./meetingDiagnosis"
import { meetingHandoff, requestsPlanReview, requestsPlanRevision } from "./meetingHandoff"
import { analyzeMeetingRequest } from "./meetingRequest"

export interface MeetingTurnResult { answer: AgentAnswer; memory: MeetingMemory; completedAgents: AgentType[]; digitalMemberId?: string; warnings: string[]; snapshotVersion: string; resolvedIntent: string; llmFallback: boolean; llmReplyUsed: boolean }

export async function coordinateMeetingTurn(
  state: ProjectDataState, session: MeetingSession, agentId: MeetingAgentId, question: string,
  llm: MeetingLlm = meetingLlm, memberId?: string,
): Promise<MeetingTurnResult> {
  if (agentId === "auto" && /[@＠]/.test(question)) {
    const mention = parseAgentMention(question, state)
    if (mention.agentId !== "auto" || mention.memberId) { agentId = mention.agentId; question = mention.question; memberId = mention.memberId }
  }
  const memory = synchronizeWorkingState(restoreWorkingState(memoryFor(session)), state, session)
  const activeAgent = memory.workingState!.activeAgent
  const materialRequested = isMaterialRequest(question) || isMaterialFollowUp(question)
  const reviewRequested = requestsPlanReview(question)
  const newWorkRequested = asksForNewWork(question)
  const previous = activeAgent === "material_organizer" && !materialRequested ||
    activeAgent === "plan_execution" && !reviewRequested && !newWorkRequested
    ? null : activeAgent
  if (agentId === "material_organizer" && !materialRequested || agentId === "plan_execution" && !reviewRequested && !newWorkRequested) agentId = "project_orchestrator"
  const resolved = memberId ?? (agentId !== "auto" ? agentId : previous ?? "auto")
  const digital = state.members[resolved] ? resolved : undefined
  const handoff = !digital && (agentId === "project_orchestrator" || agentId === "auto" && resolved === "auto") ? meetingHandoff(question) : null
  const routed = digital ? "auto" : handoff ?? resolved as MeetingAgentId
  memory.workingState!.activeAgent = resolved === "auto" ? null : resolved
  const result = await coordinateResolvedTurn(state, { ...session, memory }, routed, question, llm, digital)
  synchronizeWorkingState(result.memory, state, session)
  result.memory.workingState!.activeAgent = result.digitalMemberId ?? result.answer.agentType
  if (result.memory.options.length) commitPlanOptions(result.memory, result.memory.options, state)
  const plan = activePlanRevision(result.memory)
  if (result.answer.proposal && plan) {
    Object.assign(result.answer.proposal, { sourcePlanId: plan.planId, sourcePlanRevision: plan.revision,
      constraintsSnapshot: structuredClone(plan.constraintsSnapshot), planSnapshot: structuredClone(plan),
      reviewedActions: structuredClone(result.answer.proposal.actions),
      preconditions: result.answer.proposal.actions.flatMap(action => action.preconditions) })
  }
  return result
}

async function coordinateResolvedTurn(
  state: ProjectDataState, session: MeetingSession, agentId: MeetingAgentId, question: string,
  llm: MeetingLlm, memberId?: string,
): Promise<MeetingTurnResult> {
  const previousFocus = memoryFor(session).focusStoryIds
  const previousSprintId = memoryFor(session).focusSprintId
  const memory = updateMeetingFocus(state, session, memoryFor(session), question)
  const request = analyzeMeetingRequest(question)
  if (memory.pendingAssignment && /那就按这个方案|就按这个安排|确认.*转给|按刚才.*方案/.test(request.commandText)) {
    const { taskId, memberId: assigneeId } = memory.pendingAssignment
    memory.constraints.assignmentOverrides[taskId] = assigneeId
    const scoped = focusedMeetingSession(state, session, memory)
    if (scoped) {
      memory.options = createPlanOptions(state, scoped, memory)
      memory.activePlanId = "A"
    }
    memory.decisionSummary = `确认讨论将「${state.tasks[taskId]?.title ?? "当前任务"}」交给${state.members[assigneeId]?.name ?? "待确认成员"}，仍需审核项目行动`
    memory.pendingAssignment = null
  } else if (memory.pendingAssignment && /不直接改负责人|暂不改负责人|先不调整负责人|不换负责人/.test(question)) {
    memory.pendingAssignment = null
  }
  const focusedSession = { ...session, memory }
  const context = buildMeetingContext(state, focusedSession)
  if (agentId === "material_organizer" && (isMaterialRequest(question) || isMaterialFollowUp(question)) || agentId === "auto" && !memberId && isMaterialRequest(question) || agentId === "auto" && !memberId &&
    memory.lastAgentType === "material_organizer" && isMaterialFollowUp(question)) {
    const { generateMeetingMaterials } = await import("./materialOrganizer")
    synchronizeWorkingState(memory)
    const answer = await generateMeetingMaterials(state, { ...session, memory }, context, question)
    memory.currentTopic = "materials"
    memory.lastAgentType = "material_organizer"
    memory.lastAnalysis = answer.content
    return { answer, memory, completedAgents: ["material_organizer"], warnings: [],
      snapshotVersion: buildProjectAnalysisSnapshot(state, session, memory).version, resolvedIntent: "materials", llmFallback: false, llmReplyUsed: answer.modelUsed??false }
  }
  if (memberId) {
    const snapshot = buildProjectAnalysisSnapshot(state, session, memory)
    const reply = digitalMemberAnswer(state, session, memory, memberId, question, snapshot)
    const selfFacts = session.presentationMode !== "defense" && llm === meetingLlm && /Sprint|容量|接|只回答|修改|改成|卡|为什么|完成|自己的/.test(question)
    if (selfFacts) recordSkippedModelCall("explain", question, "digital_member_store_facts")
    const generated = selfFacts ? null : await llm.explain(question, reply.content, reply.evidence,
      { ...context, activePlan: null, digitalMemberId: memberId, lastAgentType: "project_orchestrator", lastAnalysis: `数字成员：${state.members[memberId]?.name}` }, state).catch(() => null)
    const unavailable = llm === meetingLlm && !generated && !selfFacts ? getMeetingLlmTelemetry().filter(call=>call.question===question).at(-1) : null
    const memberContent = `${unavailable && !unavailable.success ? unavailable.fallbackReason === "insufficient_balance"
      ? "DeepSeek 余额不足，以下为已登记的成员工作记录。\n\n" : "暂未获得模型回答，以下为已登记的成员工作记录。\n\n" : ""}${generated ?? reply.content}`
    memory.lastAnalysis = generated ?? reply.content
    memory.focusMemberIds = [memberId]
    if (reply.suggestedTaskId) {
      memory.focusTaskIds = [reply.suggestedTaskId]
      memory.pendingAssignment = { taskId: reply.suggestedTaskId, memberId }
      memory.decisionSummary = `正在评估将「${state.tasks[reply.suggestedTaskId].title}」交给${state.members[memberId].name}；尚待项目负责人确认`
    }
    return { answer: { agentType: "project_orchestrator", content: memberContent, evidence: reply.evidence, rawEvidence: [] },
      memory, completedAgents: [], digitalMemberId: memberId, warnings: [], snapshotVersion: snapshot.version, resolvedIntent: "digital_member", llmFallback: !generated && !selfFacts, llmReplyUsed: Boolean(generated) }
  }
  const explicit = agentId === "auto" || agentId === "project_orchestrator" ? null : agentId
  const interpretationSkipped = llm === meetingLlm && (session.presentationMode === "defense" || Boolean(meetingHandoff(question)) || canParseMeetingTurnLocally(question))
  if (interpretationSkipped) recordSkippedModelCall("interpret", question, "deterministic_command")
  const hints = interpretationSkipped ? {} : await llm.interpret(question, context, state).catch(() => null)
  const turn = understandMeetingTurn(state, focusedSession, question, explicit, hints ?? undefined)
  const analysisSession = focusedMeetingSession(state, session, memory)
  memory.constraints = turn.constraints
  memory.currentTopic = turn.intent
  const factSeparation = /真实数据|项目事实|哪些.*真实/.test(question) && /假设|推测|建议/.test(question)
  if (factSeparation) { turn.intent = "summary"; memory.currentTopic = "summary" }
  const snapshot = buildProjectAnalysisSnapshot(state, session, memory)
  memory.referencedTaskKeys = turn.referencedTaskKeys.length ? turn.referencedTaskKeys : memory.focusTaskIds.length ? memory.focusTaskIds : memory.referencedTaskKeys
  memory.referencedMemberIds = turn.referencedMemberIds.length ? turn.referencedMemberIds : memory.referencedMemberIds
  const newWorkRequested=asksForNewWork(question) && /新增|添加|增加|补充|创建|子任务|下级步骤|执行步骤|拆细|细化|拆得更细/.test(question)
  const reviseThenReview = requestsPlanReview(question) && requestsPlanRevision(question) &&
    (!explicit || explicit === "task_decomposition" || explicit === "plan_execution")
  if (newWorkRequested && (!explicit || explicit==='task_decomposition' || explicit==='plan_execution')) {
    const speaker = agentId === 'plan_execution' ? 'plan_execution' : 'task_decomposition'
    const drafted = await draftMeetingWork(state, session, memory, { ...context, constraints: memory.constraints }, question, speaker, llm)
    memory.lastAgentType = speaker
    memory.lastAnalysis = drafted.answer.content
    memory.currentTopic = "create_work"
    const checked = checkMeetingResponse(state, snapshot, memory, drafted.answer)
    return { answer: agentId==='project_orchestrator'?{...checked.answer,agentType:'project_orchestrator'}:checked.answer, memory, completedAgents: [speaker], warnings: checked.warnings,
      snapshotVersion: snapshot.version, resolvedIntent: "create_work", llmFallback: !drafted.usedModel, llmReplyUsed: drafted.usedModel }
  }
  let completedAgents: AgentType[] = []
  let content = ""
  let evidence: string[] = []
  let rawEvidence: AgentAnswer["rawEvidence"] = []
  let proposal: AgentAnswer["proposal"]
  let llmReplyUsed = false
  let currentWorkloadFacts = false
  let speaker: AgentType = explicit ?? "project_orchestrator"
  const focusChanged = JSON.stringify(previousFocus) !== JSON.stringify(memory.focusStoryIds)
  const switchedSprint = session.targetType === "project" && !explicit && !memory.focusStoryIds.length &&
    memory.focusSprintId !== previousSprintId && /(?:切到|切换到|回到|再看|先看)\s*#?Sprint/i.test(question)
  const closed = closedSprintGuidance(state, session, memory, snapshot)
  if (closed && turn.selectedOptionId) {
    memory.planningMode = turn.selectedOptionId === "A" ? "next_sprint" : turn.selectedOptionId === "B" ? "wbs_only" : "diagnose"
    if (memory.planningMode === "next_sprint") {
      const next = Object.values(state.sprints).find((sprint) => sprint.status !== "closed")
      if (next) memory.constraints.targetSprintId = next.id
    }
    turn.intent = memory.planningMode === "diagnose" ? "diagnose" : "plan"
  }
  const selectedStory = memory.focusStoryIds.at(-1)
  const scopeFacts = selectedStory && /事实|只读|读取|核对/.test(question) && /任务/.test(question) && /Sprint|迭代/i.test(question) && /验收标准|Acceptance\s*Criteria|\bAC\b/i.test(question)
    ? describeStoryScopeFacts(state, selectedStory, snapshot) : null
  const currentTaskOrder = Boolean(selectedStory && /现有|当前|现在/.test(question) && /顺序|前置关系/.test(question) && !newWorkRequested)
  const taskStatusFinding = selectedStory && currentTaskOrder ? describeStoryTaskOrder(state, selectedStory)
    : selectedStory && asksForExistingTaskStatus(question)
    ? memory.focusTaskIds.length || /子任务|执行步骤/.test(question)
      ? describeTaskSteps(state, memory.focusTaskIds.length ? memory.focusTaskIds : state.stories[selectedStory].taskIds)
      : describeStoryTaskStatus(state, selectedStory, snapshot) : null
  const selectedTask = memory.focusTaskIds[0] ?? (selectedStory ? state.stories[selectedStory]?.taskIds[0] : null)
  const projectFinding = memory.focusStoryIds.length >= 2 && (/比较|哪个|这两个|两者|优先|风险更高/.test(question) || !explicit && turn.intent === "compare")
      ? compareProjectStories(state, memory.focusStoryIds)
      : session.targetType !== 'project' ? null
      : turn.intent === "risk" && selectedTask && /延期|晚|推迟|影响/.test(question)
        ? null
        : !explicit && memory.focusMemberIds.length && /忙|哪些任务|工作/.test(question)
          ? projectMemberOverview(state, memory.focusMemberIds[0])
          : !explicit && memory.focusSprintId && /容量|剩余.*工时/.test(question)
            ? projectSprintCapacity(state, memory.focusSprintId, snapshot)
          : !explicit && selectedStory && focusChanged && /先看|再看|看看|怎么样|那.*呢|现在看|有任务吗|切到|切换到|转到/.test(question)
              ? describeFocusedStory(state, selectedStory)
              : !explicit && (!analysisSession || /项目哪里|哪些 Story|最近项目|值得关注/.test(question)) && !["execute", "summary", "risk", "workload"].includes(turn.intent)
                ? projectOverview(state, snapshot) : null

  if (newWorkRequested && explicit && !['task_decomposition','plan_execution'].includes(explicit)) {
    content = `请先邀请任务拆解拟定新增工作，再由风险、容量复核，最后交给计划落地整理待审核建议。本轮尚未新增或修改项目任务。`
    completedAgents = [explicit]
  } else if (factSeparation) {
    content = describeMeetingEvidence(buildMaterialEvidenceBundle(state, { ...session, memory }, context), state)
    completedAgents = ["project_orchestrator"]
  } else if (scopeFacts) {
    turn.intent = 'diagnose'; memory.currentTopic = 'diagnose'
    content = scopeFacts.content; evidence = scopeFacts.evidence
    completedAgents = [explicit ?? 'project_orchestrator']
  } else if (turn.intent === "diagnose" && !explicit) {
    const finding = meetingDiagnosis(state, memory, snapshot)
    content = finding.content; evidence = finding.evidence
    completedAgents = ["risk_dependency", "workload_capacity"]
  } else if (taskStatusFinding) {
    content = taskStatusFinding.content
    evidence = taskStatusFinding.evidence
    completedAgents = [explicit ?? "project_orchestrator"]
  } else if (switchedSprint && snapshot.focusedSprint) {
    const target = snapshot.focusedSprint
    const previousStory = state.stories[previousFocus.at(-1) ?? ""]
    const priorPlan = previousStory && previousStory.sprintId !== target.id
      ? `刚才 ${previousStory.id.toUpperCase()} 的计划属于 ${state.sprints[previousStory.sprintId ?? ""]?.name ?? "另一轮 Sprint"}，不会直接带到这里。` : ""
    content = `${/回到/.test(question) ? "已切回" : "已切换到"} ${target.name}。${priorPlan}${target.remainingWorkingDays === 0
      ? `${target.status === "active" ? "系统中仍标记为进行中，但" : ""}计划窗口已无剩余工作日；如需调整，先决定延期还是转入后续 Sprint。`
      : `当前还有 ${target.remainingWorkingDays} 个计划工作日，可以继续核对本轮安排。`}`
    completedAgents = ["project_orchestrator"]
  } else if (/先不改负责人|暂不调整负责人|负责人暂时不动|上一轮先不改负责人/.test(question)) {
    memory.pendingAssignment = null
    memory.decisionSummary = "负责人调整暂缓，保留原有项目分工"
    content = "负责人先保持原样，这项调整记为暂缓；项目中的负责人没有改变。我们可以继续核对延期影响，或切到下一个议题。"
    completedAgents = ["project_orchestrator"]
  } else if (closed && turn.intent === "plan" && memory.planningMode === "normal") {
    content = closed.content
    evidence = closed.evidence
    speaker = "project_orchestrator"
  } else if (projectFinding) {
    content = projectFinding.content
    evidence = projectFinding.evidence
    if (turn.intent === "risk") {
      const claim = context.recentMessages.slice(0, -1).reverse().find((message) =>
        message.senderType === "user" && /可能.{0,8}(晚|延期)|要晚/.test(message.content))
      if (claim) {
        content = `我把刚才成员提到的延期作为待核实假设来分析，项目日期尚未改变。${content}`
        evidence = [`会议成员提出的待核实信息：${claim.content}`, ...evidence]
      }
    }
    completedAgents = explicit ? [explicit] : []
  } else if (!analysisSession && (turn.intent === "risk" || turn.intent === "workload")) {
    const finding = turn.intent === "risk" ? projectRiskOverview(state) : projectWorkloadOverview(snapshot)
    content = finding.content; evidence = finding.evidence
    completedAgents = [turn.intent === "risk" ? "risk_dependency" : "workload_capacity"]
    speaker = explicit ?? "project_orchestrator"
  } else if (!analysisSession && !["summary", "execute"].includes(turn.intent)) {
    content = "先用 # 选择一条 Story 或一个 Sprint，我就能让专业助手读取对应的任务和依赖。也可以直接问我整个项目的风险和成员分工。"
  } else if (turn.intent === "summary") {
    const applied = session.proposalIds.flatMap((id) => state.proposals[id]?.actions ?? []).filter((action) => action.status === "applied")
    const rejected = session.proposalIds.flatMap((id) => state.proposals[id]?.actions ?? []).filter((action) => action.decision === "rejected")
    content = /真正执行|实际执行|写入了什么/.test(question)
      ? applied.length ? `本次实际写入：${describeBusinessChanges(businessChangeSummary(applied))}。${rejected.length ? `${rejected.length} 项建议由你拒绝，未写入项目。` : ""}这些修改已通过建议审核写入项目，会议中的延期假设仍未改动正式日期。` : "本次会议还没有写入项目的变更；已讨论的假设和方案仍留在会议记录中。"
      : `${summarizeMeeting(state, session)}${memory.decisionSummary ? `\n当前讨论方向：${memory.decisionSummary}` : ""}`
    completedAgents = ["project_orchestrator"]
  } else if (turn.intent === "execute" || reviseThenReview) {
    turn.intent = "execute"
    memory.currentTopic = "execute"
    speaker = "plan_execution"
    completedAgents = ["plan_execution"]
    const previousOption = memory.options.find(option => option.id === memory.activePlanId) ?? memory.options[0]
    if ((turn.changedConstraints && memory.options.length || reviseThenReview) && analysisSession) {
      memory.options = createPlanOptions(state, analysisSession, memory, snapshot)
      memory.activePlanId ??= memory.options[0]?.id ?? null
      if (reviseThenReview) completedAgents = ["task_decomposition", "workload_capacity", "plan_execution"]
    }
    const selected = memory.options.find((option) => option.id === (turn.selectedOptionId ?? memory.activePlanId))
    if (selected) {
      memory.activePlanId = selected.id
      const recentConfirmation = context.global.recentMessages.slice(-5).some((message) => message.senderType === "user" && /选方案|选\s*[ABC]|选最终方案|确认最终方案|按这个方案|按刚才的方案|那就按这个/.test(message.content))
      const confirmed = Boolean(reviseThenReview || turn.selectedOptionId || /按刚才|按这个|最终确定|就按|方案\s*[ABC]/i.test(question) || recentConfirmation)
      const candidate = confirmed && analysisSession ? proposalFromOption(state, analysisSession, selected) : null
      const signature = (actions: NonNullable<typeof candidate>["actions"]) => JSON.stringify(actions.map((action) => [
        action.actionType, action.targetId.startsWith("action-") ? "new-task" : action.targetId,
        action.actionType === "ADD_DEPENDENCY" ? "dependency" : action.proposedValue,
      ]))
      const existing = [...session.proposalIds].reverse().map((id) => state.proposals[id]).find((item) => item && ["draft", "reviewed"].includes(item.status) && candidate && signature(item.actions) === signature(candidate.actions) && JSON.stringify(item.constraintsSnapshot)===JSON.stringify(memory.constraints))
      proposal = existing ? undefined : candidate ?? undefined
      const changed = selected.tasks.filter((task) => !task.sourceTaskId || state.tasks[task.sourceTaskId]?.assigneeId !== task.assigneeId)
      const changes = candidate ? describeBusinessChanges(businessChangeSummary(candidate.actions)) : "没有新的项目变更"
      content = !confirmed
        ? `目前有 ${memory.options.length} 个可选方案，但会议还没有明确选定执行方向。请确认方案 A 或 B；如果负责人调整仍待核实，也可以先保留现状。`
        : !selected.feasible
        ? `现在还不能按${selected.title}执行：${selected.infeasibleReasons.join("；")}。请先调整条件或选择其他方案。`
        : memory.planningMode !== "normal" && !candidate ? `这是一份${memory.planningMode === "wbs_only" ? "不绑定 Sprint 的任务分析" : "面向下一轮的规划分析"}。当前 Story 仍在已关闭的 Sprint，先通过项目界面完成迭代归属调整，再重新生成可执行建议。`
        : existing ? `${selected.title}已有待审核行动。请在右侧继续逐项确认，避免重复创建同一批任务。`
        : proposal ? `按${selected.title}整理了${changes}：${changed.map((task) => `${task.sourceTaskId ? "调整" : "创建"}「${task.title}」（${state.members[task.assigneeId]?.name ?? "待确认"}）`).join("；")}。请在右侧逐项审核后应用。`
          : "这个方案对应的项目安排已存在，没有新的项目变更需要应用。"
      const userDirectives = session.messageIds.map((id) => state.meetingMessages[id]).filter((message) => message?.senderType === "user").slice(-5).map((message) => message.content)
      evidence = [`会议已讨论 ${session.messageIds.length} 条消息`, `最近确认与约束：${userDirectives.join("；")}`, ...selected.tasks.map((task) => `${task.title}：${task.estimate}h，${state.members[task.assigneeId]?.name ?? "待确认"}`)]
      memory.decisionSummary = confirmed && selected.feasible && (proposal || existing)
        ? `${selected.title}；${changed.map((task) => task.title).join("、")}` : "待选方案或执行条件尚未确认"
      if (reviseThenReview) {
        const diff = previousOption ? comparePlans(previousOption, selected) : null
        const changes = diff ? `保留 ${selected.tasks.length - diff.addedTasks.length} 项已有拆分，新增 ${diff.addedTasks.length} 项、调整 ${diff.assigneeChanges.length} 项负责人。` : "上一轮只列出了现有工作，没有保存可执行草案；本轮以当前项目任务为基础重新核对。"
        content = `已按新的人员限制复核安排。${changes}\n\n${content}`
        if (previousOption) evidence.push(...selected.tasks.flatMap(task => {
          const before = previousOption.tasks.find(item => item.key === task.key)
          return before && before.assigneeId !== task.assigneeId ? [`「${task.title}」：${state.members[before.assigneeId]?.name} → ${state.members[task.assigneeId]?.name}`] : []
        }))
        if (!selected.feasible) {
          speaker = "task_decomposition"
          completedAgents = ["task_decomposition", "workload_capacity"]
        }
      }
    } else {
      content = closed ? `当前 Story 位于已结束的 Sprint，还不能执行。${closed.content}` : "先讨论一个具体执行方案，再让我把已确认的安排整理为项目行动。"
    }
  } else if (turn.intent === "plan" || turn.intent === "select" || turn.intent === "compare" && !memory.options.length) {
    completedAgents = ["task_decomposition"]
    const previousOption = memory.options.find((option) => option.id === (turn.selectedOptionId ?? memory.activePlanId))
    const options = createPlanOptions(state, analysisSession!, memory, snapshot)
    memory.options = options
    if (turn.mergeAssignmentsFrom && turn.selectedOptionId) {
      const target = options.find((item) => item.id === turn.selectedOptionId)
      const source = options.find((item) => item.id === turn.mergeAssignmentsFrom)
      if (target && source) {
        const assignments = new Map(source.tasks.map((task) => [task.key, task.assigneeId]))
        for (const task of target.tasks) {
          const assigneeId = assignments.get(task.key)
          if (assigneeId) memory.constraints.assignmentOverrides[task.key] = assigneeId
        }
        memory.options = createPlanOptions(state, analysisSession!, memory, snapshot)
      }
    }
    memory.activePlanId = turn.selectedOptionId ?? memory.activePlanId ?? "A"
    content = `${turn.selectedOptionId ? `已选择方案 ${turn.selectedOptionId}。\n` : ""}${memory.planningMode === "normal" ? "" : memory.planningMode === "wbs_only" ? "先只讨论任务范围与分工，暂不生成项目修改。\n" : "先按下一轮讨论方案；Story 归属仍需在项目中调整。\n"}${describeOptions(state, memory.options)}`
    const updatedOption = memory.options.find((option) => option.id === memory.activePlanId)
    const falsePremiseDays = /([一二三四五六七八九十\d]+)\s*天.{0,8}(不可行|做不完|完不成|不够)/.exec(question)
    if (falsePremiseDays && updatedOption) {
      const numeral: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5 }
      const alleged = numeral[falsePremiseDays[1]] ?? Number(falsePremiseDays[1])
      if (updatedOption.estimatedDurationDays > 0 && updatedOption.estimatedDurationDays <= alleged)
        content = `按当前工时、负责人容量和依赖计算，${alleged} 天的工期上限可以满足，预计约 ${updatedOption.estimatedDurationDays} 个工作日。${updatedOption.feasible ? "" : `不过方案仍有其他限制：${updatedOption.infeasibleReasons.join("；")}。`}${memory.constraints.maxDays ? `目前上限是 ${memory.constraints.maxDays} 天。` : ""}如果还有未登记的限制，请告诉我；当前计算结果不会因这个判断而改变。`
    }
    if (turn.changedConstraints && memory.constraints.maxDays && updatedOption && /最多|放宽|上限/.test(question))
      content = `当前计划预计约 ${updatedOption.estimatedDurationDays} 个工作日，${updatedOption.estimatedDurationDays <= memory.constraints.maxDays ? "可以满足" : "超过"} ${memory.constraints.maxDays} 天上限。${previousOption && comparePlans(previousOption, updatedOption).small ? "任务、负责人和依赖无需整体重排。" : `\n${describeOptions(state, memory.options)}`}`
    if (turn.selectedOptionId && updatedOption) content = `已选择方案 ${updatedOption.id}：${updatedOption.tasks.length} 个工程任务，预计至少 ${updatedOption.estimatedDurationDays} 个工作日。${memory.planningMode === "wbs_only" ? "当前仅讨论 WBS，暂不生成项目修改。" : memory.planningMode === "next_sprint" ? "需先调整 Story 迭代归属，再整理项目行动。" : updatedOption.feasible ? "当前约束可继续交给计划落地整理。" : `仍有约束冲突：${updatedOption.infeasibleReasons.join("；")}。`}`
    if (turn.changedConstraints && previousOption && updatedOption && !/最多|放宽|上限|不可行|做不完/.test(question) &&
      comparePlans(previousOption, updatedOption).small) {
      const diff = comparePlans(previousOption, updatedOption)
      const steps = updatedOption.tasks.reduce((sum, task) => sum + task.subtaskTitles.length, 0)
      content = /子任务|Subtask/i.test(question) && steps === 0
        ? `已复核当前方案：${updatedOption.tasks.length} 项任务都足够独立，目前没有额外子任务，不需要为了层级再拆步骤。负责人和预计工期保持不变。`
        : `已按新限制重新核对${updatedOption.title}。${memory.constraints.requiredPeople ? `当前由 ${new Set(updatedOption.tasks.map((task) => task.assigneeId)).size} 人参与。` : ""}${diff.assigneeChanges.length ? `负责人变化：${diff.assigneeChanges.map((title) => `${title}交给${state.members[[...updatedOption.tasks,...updatedOption.subtasks??[]].find((task) => task.title === title)?.assigneeId ?? ""]?.name ?? "待确认成员"}`).join("、")}。` : "分工不变。"}${diff.dependencyChanges.length ? `依赖变化：${diff.dependencyChanges.join("、")}。` : ""}预计约 ${updatedOption.estimatedDurationDays} 个工作日。${updatedOption.feasible ? "可以继续确认行动项。" : `仍需处理：${updatedOption.infeasibleReasons.join("；")}。`}`
    }
    evidence = meetingStories(state, analysisSession!).flatMap((story) => [
      `${story.title}：${story.taskIds.length} 个现有任务，${story.acceptanceCriteriaIds.length} 条验收标准`,
      `Sprint：${state.sprints[story.sprintId ?? ""]?.name ?? "未安排"}`,
    ])
    speaker = explicit ?? "project_orchestrator"
    memory.decisionSummary = `${memory.options.find((option) => option.id === memory.activePlanId)?.title ?? "待选方案"}，继续核对约束`
  } else if (turn.intent === "compare" || turn.intent === "workload") {
    const compareRequested = /方案|比较(?!适合)|对比|最少调整|最快完成|工期最快|平衡一下|怎么调整/.test(question)
    if (compareRequested && !memory.options.length) memory.options = createPlanOptions(state, analysisSession!, memory, snapshot)
    if (turn.changedConstraints) memory.options = createPlanOptions(state, analysisSession!, memory, snapshot)
    const useComparison = Boolean(compareRequested || memory.options.length && /方案|人员|排得下/.test(question))
    currentWorkloadFacts = turn.intent === "workload" && !useComparison && /现在|当前|谁|哪位/.test(question) && !/如果|假设|未来|工作日|机会成本/.test(question)
    const comparison = useComparison ? workloadComparison(state, analysisSession!, memory.options, snapshot, question)
      : workloadAdvice(state, snapshot, question, turn.referencedTaskKeys[0] ?? selectedTask ?? null, memory.constraints.excludedMemberIds)
    content = comparison.content
    evidence = comparison.evidence
    completedAgents = ["workload_capacity"]
    speaker = explicit ?? "project_orchestrator"
  } else if (turn.intent === "risk" || turn.intent === "diagnose") {
    const whatIfDelay = /(?:如果|假设).*?(?:晚|延期|推迟)|(?:晚|延期|推迟)\s*[一二两三四五六七八九十\d]+\s*天/.test(question)
    const humanClaim = whatIfDelay ? context.recentMessages.slice(0, -1).reverse().find((message) => message.senderType === "user" && /可能.{0,8}(晚|延期)|要晚/.test(message.content)) : null
    const hypothesisAlreadyExplained = context.recentMessages.slice(0, -1).some((message) => message.senderType === "agent" && /假设.*正式日期未变|假设分析.*正式日期未变/.test(message.content))
    const claimedDelay = humanClaim && /晚一天|延迟一天|延期一天/.test(humanClaim.content) ? 1 : humanClaim && /晚两天|延期两天/.test(humanClaim.content) ? 2 : 0
    const risk = dependencyImpact(state, analysisSession!, memory, turn.referencedTaskKeys[0] ?? memory.focusTaskIds[0] ?? null,
      whatIfDelay ? turn.delayDays ?? claimedDelay : 0, snapshot,
      { removeDependency: turn.removeDependency, targetTitle: question.match(/(接口|甘特|验证|测试|后端|前端)/)?.[1],
        direction: /前置依赖|入边/.test(question) ? "incoming" : "outgoing",
        earlyDays: /提前.{0,6}(完成|一天|两天)/.test(question) ? 1 : 0 })
    const baseRisk = analyzeMeetingAgent(state, analysisSession!, "risk_dependency", question)
    evidence = [...risk.evidence, ...baseRisk.evidence]
    if (humanClaim) evidence.unshift(`会议成员提出的待核实信息：${humanClaim.content}`)
    rawEvidence = baseRisk.rawEvidence
    if (turn.intent === "diagnose" && !explicit) {
      if (!memory.options.length) memory.options = createPlanOptions(state, analysisSession!, memory, snapshot)
      const assignee = selectedTask ? snapshot.members[state.tasks[selectedTask]?.assigneeId] : null
      const sprint = snapshot.focusedSprint
      content = `我检查了阻塞链和成员安排。${risk.content}${assignee ? `当前负责人${assignee.name}在${sprint?.name ?? "本轮"}还有 ${assignee.currentSprintWorkload}h 未完成工作。` : ""}${sprint?.remainingWorkingDays === 0 ? ` ${sprint.name}已无剩余工作日，先确认是否转到后续迭代。` : ""}建议先核实前置任务的完成时间，再决定是否调整分工。`
      completedAgents = ["risk_dependency", "workload_capacity"]
      speaker = "project_orchestrator"
    } else {
      content = `${humanClaim && !hypothesisAlreadyExplained ? "我把刚才成员提到的延期作为假设来检查，项目中的任务日期尚未改变。\n" : ""}${risk.content}`
      completedAgents = ["risk_dependency"]
      speaker = explicit ?? "project_orchestrator"
    }
  } else {
    const specialist = explicit ?? "project_monitor"
    const answer = analyzeMeetingAgent(state, analysisSession!, specialist, question)
    content = answer.content
    evidence = answer.evidence
    rawEvidence = answer.rawEvidence
    completedAgents = [specialist]
    speaker = explicit ?? "project_orchestrator"
  }

  memory.lastAgentType = speaker
  memory.lastAnalysis = content
  // Freeze the plan before asking the model to explain it, rather than after its reply.
  if (memory.options.length) commitPlanOptions(memory, memory.options, state)
  const sourcePlan = activePlanRevision(memory)
  if (proposal && sourcePlan) Object.assign(proposal, {
    sourcePlanId: sourcePlan.planId, sourcePlanRevision: sourcePlan.revision,
    constraintsSnapshot: structuredClone(sourcePlan.constraintsSnapshot), planSnapshot: structuredClone(sourcePlan),
    reviewedActions: structuredClone(proposal.actions), preconditions: proposal.actions.flatMap(action => action.preconditions),
  })
  memory.discussionSummary = [memory.discussionSummary, question].filter(Boolean).slice(-2).join("；").slice(-400)
  const meaningful = content && !["project_monitor", "collaboration_notification", "contribution_insight"].includes(speaker)
  const explanationSkipped = llm === meetingLlm && (reviseThenReview || currentWorkloadFacts || currentTaskOrder ||
    (session.presentationMode !== "defense" || ["execute", "select"].includes(memory.currentTopic)) && canComputeMeetingExplanation(memory.currentTopic, question))
  if (meaningful && explanationSkipped) recordSkippedModelCall("explain", question, "canonical_plan_or_computed_facts")
  if (meaningful && !explanationSkipped) {
    const explanation = await llm.explain(question, content, evidence, { ...context, lastAgentType: speaker, currentTopic: memory.currentTopic,
      constraints: memory.constraints, planning: { ...context.planning, constraints: memory.constraints, options: memory.options },
      activeProposalId: proposal?.id ?? context.activeProposalId,
      activePlan: memory.currentTopic === "workload" && /现在|当前|谁|哪位/.test(question) && !/方案|比较/.test(question) ? null : memory.options.find(option => option.id === memory.activePlanId) ?? null },
      proposal ? { ...state, proposals: { ...state.proposals, [proposal.id]: proposal } } : state).catch(() => null)
    const taskIds = taskStatusFinding && selectedStory ? memory.focusTaskIds.length ? memory.focusTaskIds : state.stories[selectedStory].taskIds : []
    if (explanation && taskIds.every((id) => explanation.toLowerCase().includes(id.toLowerCase()) || explanation.includes(state.tasks[id]?.title ?? id))) {
      if (session.presentationMode === "defense") evidence = [...evidence, content]
      content = explanation
      llmReplyUsed = true
    }
  }
  memory.lastAnalysis = content
  const latestModelCall = getMeetingLlmTelemetry().filter(call=>call.question===question && !call.skipped).at(-1)
  if (llm === meetingLlm && !llmReplyUsed && latestModelCall && !latestModelCall.success) {
    const notice = latestModelCall.fallbackReason === "insufficient_balance"
      ? "DeepSeek 余额不足，以下为项目记录与规则计算结果；充值后可重新提问。"
      : "暂未获得可用的模型回答，以下为项目记录与规则计算结果，可稍后重试。"
    content = `${notice}\n\n${content}`
    memory.lastAnalysis = content
  }
  const checked = checkMeetingResponse(state, snapshot, memory,
    { agentType: speaker, content, evidence, rawEvidence, ...(proposal ? { proposal } : {}) })
  return { answer: checked.answer, memory, completedAgents, warnings: checked.warnings,
    snapshotVersion: snapshot.version, resolvedIntent: turn.intent, llmFallback: hints === null || Boolean(meaningful && !llmReplyUsed && !explanationSkipped),
    llmReplyUsed: llmReplyUsed && checked.answer.content === content }
}
