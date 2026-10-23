import { addBusinessDays, format } from "date-fns"
import type { AgentType, MeetingHostEventKind, MeetingMessage, MeetingSession, ProjectDataState } from "../types"
import { createProjectStore, projectDataSnapshot, useProjectStore } from "../store/projectStore"
import { buildProjectAnalysisSnapshot } from "./meetingSnapshot"
import { dependencyImpact } from "./meetingDependency"
import { captureMeetingOutcome, meetingInsights, meetingOutcomeState } from "./meetingOutcomes"
import { generateMeetingMinutes } from "./meetingMinutes"
import { buildMeetingContext } from "./meetingContext"
import { createBaseDemoProjectState } from "../data/demoProject"

export const classroomDemoId = "meeting-classroom-sprint-v1"
export const classroomDemoTitle = "Sprint 项目风险与交付决策 · AI 智能会议演示"
export const sortMeetingHistory = (a: MeetingSession, b: MeetingSession) =>
  Number(Boolean(b.pinnedAt)) - Number(Boolean(a.pinnedAt)) ||
  (a.pinnedAt && b.pinnedAt ? b.pinnedAt.localeCompare(a.pinnedAt) : 0) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)

export function projectFingerprint(state: ProjectDataState) {
  const value = JSON.stringify([state.project, state.members, state.sprints, state.stories, state.tasks, state.subtasks, state.risks, state.dependencies, state.acceptanceCriteria])
  let hash = 2166136261
  for (let n = 0; n < value.length; n++) hash = Math.imul(hash ^ value.charCodeAt(n), 16777619)
  return (hash >>> 0).toString(16)
}

/** Recorded dialogue + real deterministic analyses and Store execution, all on a private clone. */
export function buildClassroomDemo(source: ProjectDataState, now = new Date()) {
  // The comprehensive demo has its own task IDs. Keep the recorded classroom
  // scenario on a labelled reference snapshot instead of injecting old tasks.
  const referenceSnapshot = source.project.id === "scrumflow-comprehensive-demo"
  const base = projectDataSnapshot(referenceSnapshot ? createBaseDemoProjectState() : source)
  if (referenceSnapshot) base.project = { ...base.project, id: source.project.id, name: "ScrumFlow 课堂会议独立示例" }
  if (!base.stories.us024 || !base.tasks["data-024"] || !base.risks["risk-us024"] || !base.sprints.s2 || ["m1", "m2", "m3", "m4"].some(id => !base.members[id])) throw new Error("当前项目缺少演示所需的 US024、DATA-024 或成员；未改动原项目。")
  base.meetingSessions = {}; base.meetingMessages = {}; base.proposals = {}; base.history = []; base.assets = {}
  base.workspace.currentUserId = "m1"
  const sandbox = createProjectStore(base), get = sandbox.getState
  const initial = get().createMeeting("project", base.project.id, { meetingType: "planning", sprintId: "s2", demoSpeed: 1, voiceEnabled: false })
  const start = now.getTime() - 32 * 60_000
  const at = (minute: number) => new Date(start + minute * 60_000).toISOString()
  const first = initial.messageIds[0]
  let session: MeetingSession = { ...initial, id: classroomDemoId, title: classroomDemoTitle, createdAt: at(0), pinnedAt: now.toISOString(),
    memory: { ...initial.memory!, focusSprintId: "s2", focusStoryIds: ["us024", "us025"] },
    facilitation: { ...initial.facilitation!, startedAt: at(0), plannedMinutes: 30 },
    topics: [
      { id: "demo-status", title: "交付现状与阻塞", type: "risk", agendaKey: "goal", relatedEntityIds: ["us024", "data-024"], relatedAgentTypes: ["risk_dependency"], status: "discussed", createdFromMessageId: first },
      { id: "demo-options", title: "方案比较与任务拆解", type: "workload", agendaKey: "stories", relatedEntityIds: ["us024"], relatedAgentTypes: ["task_decomposition", "workload_capacity"], status: "decided", createdFromMessageId: first },
      { id: "demo-decisions", title: "人工审核与执行复盘", type: "decision", agendaKey: "capacity", relatedEntityIds: ["us024"], relatedAgentTypes: ["plan_execution", "material_organizer"], status: "recorded", createdFromMessageId: first },
    ] }
  sandbox.setState({ meetingSessions: { [session.id]: session }, meetingMessages: { [first]: { ...get().meetingMessages[first], meetingId: session.id, createdAt: at(0), content: `各位好，我是今天的 AI 主持人。围绕 ${base.project.name}，我们用 30 分钟确定 Sprint 2 的收尾方案。前 8 分钟核对交付与阻塞，14 分钟比较拆解和容量，最后 8 分钟审核、执行和复盘。${Object.values(base.members).map(m => m.name).join("、")}分别补充业务、前端、接口和验证观点。我会主动邀请专业助手；所有变更先审后做。\n\n本场是离线演示记录，成员发言及主持语义事件为预设；分析和审批执行使用现有程序，写回仅发生在独立沙盒。` } } })
  const current = () => get().meetingSessions[session.id]
  const memory = structuredClone(current().memory!)
  const analysis = buildProjectAnalysisSnapshot(get(), current(), memory, now)
  const members = analysis.members
  const sprintTasks = Object.values(base.tasks).filter(t => base.stories[t.storyId]?.sprintId === "s2")
  const done = sprintTasks.filter(t => t.status === "done").length, blocked = sprintTasks.filter(t => t.status === "blocked").length
  const say = (minute: number, senderType: MeetingMessage["senderType"], senderId: string, content: string, extra: Partial<MeetingMessage> = {}) => {
    const m = get().addMeetingMessage(session.id, { senderType, senderId, content, ...extra })
    sandbox.setState(s => ({ meetingMessages: { ...s.meetingMessages, [m.id]: { ...m, createdAt: at(minute) } } }))
    return m.id
  }
  const host = (minute: number, kind: MeetingHostEventKind, content: string, extra: Parameters<typeof say>[4] = {}) => say(minute, "agent", "project_orchestrator", content, { ...extra, hostEvent: { key: `demo:${minute}:${kind}`, kind, ...extra.hostEvent } })
  const specialist = (minute: number, id: AgentType, input: string, content: string, evidence: string[] = []) => {
    const messageId = say(minute, "agent", id, content, { evidence })
    get().recordMeetingQaTrace(session.id, { messageId, input, resolvedIntent: "analysis", focusStoryIds: ["us024", "us025"], focusSprintId: "s2", referencedTaskKeys: ["data-024"], constraints: memory.constraints, calledAgents: [id], snapshotVersion: analysis.version, selectedOptionId: null, proposalId: null, llmFallback: false, llmReplyUsed: false, warnings: ["离线演示：确定性程序分析；未调用实时模型"] })
    return messageId
  }
  const correct = (minute: number, text: string, choice: "return" | "continue" | "incorrect", sourceId: string) => {
    const id = host(minute, "topic_deviation", text, { hostEvent: { key: `demo:correction:${minute}`, kind: "topic_deviation", sourceMessageIds: [sourceId], assessment: { basis: "rules", reason: "预设语义演示事件，不代表实时识别" } } })
    const result = get().respondMeetingHostEvent(session.id, id, choice)
    if (!result.ok) throw new Error(result.message)
    sandbox.setState(s => ({ meetingMessages: { ...s.meetingMessages, [id]: { ...s.meetingMessages[id], hostEvent: { ...s.meetingMessages[id].hostEvent!, resolution: { choice, at: at(minute + .1) } } } } }))
  }

  say(.7, "user", "m1", "今天不追求把所有事情都说成完成。先找真正卡住交付的点，保留正在做的任务负责人。")
  host(1.4, "sprint_blocker", `我先核对项目快照：Sprint 2 共 ${sprintTasks.length} 个任务，${done} 个已完成、${blocked} 个受阻；US024 有 ${base.stories.us024.taskIds.length} 个工程任务。${analysis.focusedSprint?.effectiveStatus === "overdue" ? `原计划结束日 ${base.sprints.s2.endDate} 已过，剩余窗口容量为 0，不能再把新安排包装成本轮按时交付。` : `计划结束日为 ${base.sprints.s2.endDate}。`}请先核实 DATA-024 的契约，再讨论补救。`, { hostEvent: { key: "demo:blocker", kind: "sprint_blocker", taskIds: ["data-024", "be-024-1", "fe-025-1"], riskIds: ["risk-us024"], resolution: { choice: "analyze", at: at(2) } }, handoffTo: "risk_dependency" })
  say(2.3, "digital_member", "m2", `Toolbar 已完成，但「${base.tasks["fe-024-2"].title}」仍在推进。没有稳定契约，我不想用临时字段硬接，再返工一遍。`)
  say(3, "digital_member", "m3", `「${base.tasks["be-024-1"].title}」在项目里是受阻状态。我的观点是先冻结字段和版本号，接口与视图各自验证。`)
  host(3.8, "guide", "两位都指向数据契约。风险与依赖助手，请沿已登记边查清直接和间接影响；不要把口头推测当成依赖。", { handoffTo: "risk_dependency" })
  const impact = dependencyImpact(get(), current(), memory, "data-024", 0, analysis)
  specialist(4.5, "risk_dependency", "核对 DATA-024 的依赖传播", impact.content, impact.evidence)
  say(5.3, "user", "m1", "如果模型再晚一天和两天，分别影响什么？先模拟，别修改日期。")
  const one = dependencyImpact(get(), current(), memory, "data-024", 1, analysis), two = dependencyImpact(get(), current(), memory, "data-024", 2, analysis)
  specialist(6.1, "risk_dependency", "DATA-024 延期一至两天的同基线模拟", `${one.content}\n\n${two.content}`, [...one.evidence, ...two.evidence])
  say(7, "digital_member", "m4", "即使删掉连线，字段还没稳定也测不了。我的验收应同时覆盖两视图一致性和依赖关系，不能只截图证明完成。")
  host(8, "agenda", "依赖风险已明确，进入方案比较。请负载与容量助手先核对李娜、陈林的真实负载；不要把已开始任务再算一遍。", { handoffTo: "workload_capacity" })
  specialist(8.8, "workload_capacity", "比较李娜和陈林的剩余容量", ["m2", "m3"].map(id => `${members[id].name}：本轮未完成负载 ${members[id].currentSprintWorkload}h，名义剩余 ${members[id].remainingCapacity}h；按日历剩余窗口可安排 ${members[id].remainingTimeCapacity}h。`).join("\n\n") + "\n\n名义容量与剩余窗口是两个约束。当前不承诺原 Sprint 内新增交付，不自动搬动已开始任务。", [JSON.stringify({ m2: members.m2, m3: members.m3 })])
  say(9.6, "digital_member", "m3", "我可以协助契约核对，但不建议把整个数据模型交给李娜。方案 A：不换负责人，补契约与回归；方案 B：换人赶工，需要交接，也会打断时间轴工作。")
  say(10.4, "digital_member", "m2", "支持 A，但想先讲清楚字段版本怎么落在连接线上。这不是纯视觉问题，影响验收。")
  correct(11, "这段连接线细节可能偏离人员分配，是否先回到方案选择？", "incorrect", get().meetingSessions[session.id].messageIds.at(-1)!)
  say(11.2, "user", "m1", "刚才误判了，字段版本就是验收风险，请让李娜继续；不要打断。")
  host(11.8, "guide", "收到，撤回纠偏。保留这段与验收直接相关的讨论，给两分钟说清契约边界。")
  say(12.5, "digital_member", "m2", "保留实体 ID、依赖方向和版本号即可。其他配色与动画留到后面；我不会为了演示而伪造完成状态。")
  const continueId = say(13.1, "user", "m1", "继续讨论契约与回归的交接成本，再给一个可审核的最小方案。")
  correct(13.5, "当前议题已接近分配的时间；可以返回方案选择，也可继续讨论交接成本。", "continue", continueId)
  specialist(14.3, "task_decomposition", "围绕 US024 补充最小 WBS，不重复已有工程任务", `保留现有 ${base.stories.us024.taskIds.length} 个任务，补两个交付控制任务：\n\n1. 契约冻结与字段核对：2h，张伟负责；输出字段清单、版本号与例外说明。\n2. 双视图回归与证据归档：3h，王晨负责；依赖契约核对，输出一致性用例与失败证据。\n\n两项都属于尚待审批的恢复计划，原工程任务继续由原负责人推进。这里的 2h / 3h 是演示方案估算，不代表历史实耗。`, [`来源：US024 既有任务与验收标准 ${base.stories.us024.acceptanceCriteriaIds.join("、")}`])
  const off = say(15.2, "digital_member", "m4", "既然要展示，我们顺便换个新主题色、加一段开场动画？")
  correct(15.7, "主题色和动画与交付阻塞无关，先记入停车场；请回到 A / B 方案的风险和成本。", "return", off)
  say(16.4, "user", "m1", "返回议程。我们选 A：不换已开始任务负责人，不删除真实依赖；只新增契约核对、回归和风险跟进。")
  host(17.2, "guide", "我来确认取舍：A 保留责任连续性，但需要明确契约证据；B 可能增加交接负担，容量也不支持盲目塞人。先提交 A，删除依赖和强行换人的建议也保留在审核记录里，便于老师看到拒绝原因。", { handoffTo: "plan_execution" })
  const nextDay = format(addBusinessDays(now, 1), "yyyy-MM-dd"), nextEnd = format(addBusinessDays(now, 2), "yyyy-MM-dd")
  const risk = get().risks["risk-us024"]
  const p = get().createProposal({ origin: "meeting", triggerType: "manual", agentType: "risk_dependency", targetType: "story", targetId: "us024", summary: "方案 A：保留责任与依赖，登记恢复工作和风险跟进", reasoning: "成员比较后选择最小调整。新日期为恢复计划，创建任务可能同步扩展 Story/上级排期，不能视为原 Sprint 按时交付。", evidence: [{ agentType: "risk_dependency", targetType: "story", targetId: "us024", detail: "US024 方案 A 的人工审核记录（离线演示）" }], actions: [
    { actionType: "UPDATE_RISK", targetType: "risk", targetId: risk.id, beforeValue: risk, preconditions: [{ targetType: "risk", targetId: risk.id, field: "mitigation", expectedValue: risk.mitigation }], proposedValue: { mitigation: `${risk.mitigation}\n张伟冻结字段与版本；王晨保留双视图回归证据，下一工作日复核，未通过不关闭风险。` }, reason: "明确责任与验收证据，不直接宣称风险解决" },
    { actionType: "CREATE_TASK", targetType: "story", targetId: "us024", proposedValue: { title: "契约冻结与字段核对", type: "database", estimate: 2, assigneeId: "m1", startDate: nextDay, endDate: nextDay }, reason: "最小 WBS 第一步；恢复计划日期，任务仍为待办" },
    { actionType: "CREATE_TASK", targetType: "story", targetId: "us024", proposedValue: { title: "双视图回归与证据归档", type: "test", estimate: 3, assigneeId: "m4", startDate: nextEnd, endDate: nextEnd }, reason: "最小 WBS 第二步，需先取得契约核对证据" },
    { actionType: "CREATE_DISCUSSION", targetType: "task", targetId: "data-024", proposedValue: { content: `由张伟在 ${nextDay} 核实数据契约与交付日；王晨提供回归证据，未验证前不解除阻塞。` }, reason: "可追踪的责任与复核点" },
    { actionType: "REMOVE_DEPENDENCY", targetType: "dependency", targetId: "dep-1", proposedValue: { dependencyId: "dep-1" }, reason: "备选提议：删除连线缩短表面关键路径；人工拒绝，因为技术依赖仍存在" },
  ] })
  // All new actions use the same executor's required apply-time entity checks.
  for (const action of p.actions) if (!action.preconditions.length) action.preconditions = [{ targetType: action.targetType, targetId: action.targetId, field: "id", expectedValue: action.targetId }]
  get().updateProposal(p.id, { actions: p.actions, originalActions: structuredClone(p.actions) })
  get().linkMeetingProposal(session.id, p.id)
  say(18, "agent", "plan_execution", "方案 A 已形成 5 项待审核建议。4 项用于登记工作和跟进，另 1 项删除依赖建议请明确拒绝。应用前会复验实体、字段和动作依赖；现在还没有写回。", { proposalId: p.id })
  say(19, "user", "m1", `人工审核记录：采纳前四项；拒绝删依赖。认可恢复任务日期 ${nextDay} / ${nextEnd} 及其排期扩展影响，不冒充原 Sprint 的按时交付。`)
  for (const [index, action] of p.actions.entries()) get().setProposalDecision(p.id, action.id, index < 4 ? "accepted" : "rejected")
  const applied = get().applyProposal(p.id, "离线演示的人工审核事件：先核验再执行，仅在沙盒写回")
  if (!applied.ok || get().proposals[p.id].actions.filter(a => a.status === "applied").length !== 4) throw new Error(`沙盒执行未完成：${applied.message}；${get().proposals[p.id].actions.filter(a => a.error).map(a => `${a.actionType}: ${a.error}`).join("；")}`)
  say(20, "system", "system", `沙盒执行成功：${applied.message}。正式项目未参与此次写回。`, { proposalId: p.id })
  host(21, "blocker_followup", "已核验四项写回和逐项审计：新任务还是待办，风险仍未关闭，原依赖仍保留。登记成功与工程完成是两回事。王晨，请确认这些输出是否足够支撑后续验收。", { hostEvent: { key: "demo:followup", kind: "blocker_followup", taskIds: ["data-024"], riskIds: [risk.id], resolution: { choice: "defer", at: at(21.2) } } })
  say(21.8, "digital_member", "m4", "够作为行动清单，但还不是通过证据。下个工作日先核对字段，再做双视图回归；失败用例要进归档，不能只交成功截图。")
  const rejected = get().createProposal({ origin: "meeting", triggerType: "manual", agentType: "workload_capacity", targetType: "task", targetId: "data-024", summary: "备选 B：将已开始的数据模型改由李娜负责", reasoning: "保留被否决方案，供追溯取舍", evidence: [], actions: [{ actionType: "CHANGE_ASSIGNEE", targetType: "task", targetId: "data-024", proposedValue: { assigneeId: "m2" }, reason: "违反保留已开始任务负责人的会议约束，增加交接风险" }] })
  get().linkMeetingProposal(session.id, rejected.id)
  get().rejectProposal(rejected.id, "张伟拒绝：不转移已开始任务；李娜优先完成既有工作")
  say(22.4, "agent", "workload_capacity", "备选 B 已由审核人拒绝并保留原因：不转移已开始任务。DATA-024 的负责人没有因此改变。", { proposalId: rejected.id })
  host(23, "agenda", "进入执行复盘与收尾。仍待确认的交付承诺单独处理，不与已经执行的登记动作混在一起。")
  const pending = get().createProposal({ origin: "meeting", triggerType: "manual", agentType: "project_orchestrator", targetType: "story", targetId: "us024", summary: "待确认：交付恢复日期与 Story 风险说明", reasoning: "需契约复核后才能承诺，今天只保留为待审", evidence: [], actions: [{ actionType: "UPDATE_STORY", targetType: "story", targetId: "us024", proposedValue: { riskNote: "恢复日期须经契约与回归证据复核后确认" }, reason: "待张伟取得证据后审核，当前不执行" }] })
  get().linkMeetingProposal(session.id, pending.id)
  say(24, "agent", "plan_execution", "交付承诺保留 1 项待审。已执行的是工作登记和风险跟进，绝不自动改成 Story 已验收。", { proposalId: pending.id })
  host(27, "time_warning", "黄色时间提醒：30 分钟议程还剩 3 分钟。我们已选择方案 A，接下来只确认未解决问题、负责人和成果，不重新争论人员分配。")
  say(28, "user", "m1", "确认：契约由张伟跟进，回归由王晨负责，李娜和陈林继续原工作。真实交付日等证据复核；主题色和动画留到停车场。")
  host(30.2, "overtime", "红色时间提醒：超过原计划 12 秒。停止扩展新议题，用最后一分钟确认材料和复核点。这里展示的是预设会议时间线，不是实时语音或模型调用。")
  host(30.7, "closing", "收尾确认：方案 A 的四项登记已在沙盒执行，两项高风险建议被拒绝，一项承诺待审。DATA-024 与回归仍需跟进；材料整理助手，请依据执行审计生成正式纪要、WBS、风险清单、依赖图、甘特图与变更摘要。", { handoffTo: "material_organizer" })
  const materialsMessageId = say(31.2, "agent", "material_organizer", "我将从本场冻结快照整理成果，保留审核人、拒绝原因和执行证据；生成本地文档与图表，不请求模型。成果可预览、下载并打包。")
  host(32, "outcome", "会议结束。请按行动清单跟进，待契约和回归证据齐备后再审核交付承诺。现在可查看量化洞察、逐项审批审计和完整成果包。")

  const final = get().meetingSessions[session.id]
  // Store execution happened now; remap its timestamps to the explicitly recorded rehearsal timeline.
  const proposals = Object.fromEntries(Object.entries(get().proposals).map(([id, value]) => [id, { ...value, createdAt: at(id === p.id ? 18 : id === rejected.id ? 22.3 : 24), updatedAt: at(id === p.id ? 20 : id === rejected.id ? 22.4 : 24), reviewedAt: value.reviewedAt ? at(id === p.id ? 19 : 22.4) : null, appliedAt: value.appliedAt ? at(20) : null, actions: value.actions.map(a => ({ ...a, appliedAt: a.appliedAt ? at(20) : null })) }]))
  sandbox.setState({ proposals, history: get().history.map(h => ({ ...h, createdAt: at(20) })) })
  session = { ...final, status: "ended", endedAt: at(32), topics: session.topics, memory,
    facilitation: { ...session.facilitation!, actualDurationMs: 32 * 60_000, actualOvertimeMs: 2 * 60_000 },
    demo: { version: 1, source: referenceSnapshot ? "reference-snapshot" : "project-snapshot", sourceCapturedAt: now.toISOString(), sourceFingerprint: projectFingerprint(referenceSnapshot ? base : source), recordedEvents: true, materialStatus: "pending", agendaTiming: [
      { topicId: "demo-status", plannedMinutes: 8, startedAt: at(0), endedAt: at(8) }, { topicId: "demo-options", plannedMinutes: 14, startedAt: at(8), endedAt: at(23) }, { topicId: "demo-decisions", plannedMinutes: 8, startedAt: at(23), endedAt: at(32) },
    ] } }
  session.outcomeSnapshot = captureMeetingOutcome(get(), session)
  session.minutes = generateMeetingMinutes(get(), session)
  const stats = meetingInsights(get(), session)
  session.narrative = { text: `本场围绕 ${base.stories.us024.title} 的交付阻塞，由 AI 主持依次完成现状核对、延期模拟、容量比较和人工审核。成员选择保留原负责人和真实依赖的方案 A：${stats.counts.executed} 项行动已在独立沙盒执行并留下审计，${stats.counts.rejected} 项建议被拒绝，${stats.counts.pending} 项交付承诺继续待审。新增任务是恢复工作的待办，原始工程阻塞与验收结论没有被虚构为完成。主持人记录了返回议程、继续讨论和误判纠正三种反馈，并在 32 分钟演示时间线结束后形成材料归档。`, references: [], fingerprint: "classroom-v1", generatedAt: at(32), model: "facts-template" }
  return { session, messages: get().meetingMessages, materialsMessageId }
}

let preparing: Promise<void> | undefined
export function ensureClassroomDemo() {
  if (preparing) return preparing
  preparing = (async () => {
    let state = useProjectStore.getState()
    if (!["scrumflow-ai", "scrumflow-comprehensive-demo"].includes(state.project.id)) return
    if (!state.meetingSessions[classroomDemoId]) {
      const built = buildClassroomDemo(state)
      useProjectStore.setState(s => ({ meetingSessions: { ...s.meetingSessions, [classroomDemoId]: built.session }, meetingMessages: { ...s.meetingMessages, ...built.messages } }))
    }
    state = useProjectStore.getState()
    const session = state.meetingSessions[classroomDemoId]
    if (!session?.demo || session.demo.materialStatus === "ready" && session.demo.materialsRevision === 2) return
    const stillCurrent = (value: ProjectDataState) => value.project.id === state.project.id && value.meetingSessions[classroomDemoId]?.demo?.sourceCapturedAt === session.demo!.sourceCapturedAt
    try {
      const { generateMeetingMaterials } = await import("./materialOrganizer")
      for (const question of ["生成正式会议纪要", "生成 Scrum 智能会议报告", "生成 WBS", "生成风险清单", "生成依赖图", "生成当前 Sprint 甘特图", "生成变更摘要"]) {
        const live = useProjectStore.getState()
        if (!stillCurrent(live)) return
        const s = live.meetingSessions[classroomDemoId], frozen = meetingOutcomeState(live, s)
        await generateMeetingMaterials(frozen, s, buildMeetingContext(frozen, s), question)
      }
      useProjectStore.setState(s => {
        if (!stillCurrent(s)) return s
        const ids = Object.values(s.assets).filter(a => { try { return JSON.parse(a.sourceText)?._meeting?.id === classroomDemoId } catch { return false } }).map(a => a.id)
        const message = Object.values(s.meetingMessages).find(m => m.meetingId === classroomDemoId && m.senderId === "material_organizer")
        return { meetingMessages: message ? { ...s.meetingMessages, [message.id]: { ...message, artifactIds: ids, content: "本地材料已归档：正式纪要、会议洞察报告、WBS、风险清单、依赖图、甘特图与变更摘要。依据本场冻结快照生成，保留审批与执行证据；可预览、下载并打包，全程未请求实时模型。" } } : s.meetingMessages,
          meetingSessions: { ...s.meetingSessions, [classroomDemoId]: { ...s.meetingSessions[classroomDemoId], demo: { ...session.demo!, materialStatus: "ready", materialsRevision: 2, materialError: undefined } } } }
      })
    } catch (error) {
      useProjectStore.setState(s => stillCurrent(s) ? ({ meetingSessions: { ...s.meetingSessions, [classroomDemoId]: { ...s.meetingSessions[classroomDemoId], demo: { ...session.demo!, materialStatus: "error", materialError: error instanceof Error ? error.message : "材料整理失败" } } } }) : s)
    }
  })().finally(() => { preparing = undefined })
  return preparing
}
