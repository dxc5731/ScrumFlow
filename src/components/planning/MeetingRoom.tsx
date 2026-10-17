import { Fragment, useEffect, useMemo, useRef, useState, type PointerEvent } from "react"
import DOMPurify from "dompurify"
import { marked } from "marked"
import {
  Activity, ArrowRight, Bot, CalendarDays, Check, CheckCircle2, ChevronDown,
  PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
  ClipboardList, Clock3, FileStack, Flag, GitBranch, ListTree, MessageCircle,
  Mic, MicOff, MoreHorizontal, Send, ShieldAlert, Sparkles, Square, Users, WandSparkles, X,
} from "lucide-react"
import {
  agentName, meetingAgents, parseAgentMention,
  type AgentAnswer, type MeetingAgentId,
} from "../../agents/meetingConversation"
import { coordinateMeetingTurn } from "../../agents/meetingDecision"
import { composerTokenAt, insertComposerReference } from "../../agents/meetingMentions"
import { ensureMeetingNarrative } from "../../agents/meetingNarrative"
import MeetingMinutesView from "./MeetingMinutesView"
import MeetingMaterials from "./MeetingMaterials"
import { readableMeeting } from "../../agents/meetingPresentation"
import MaterialSuggestions from "./MaterialSuggestions"
import { generatedRecommendationKeys, meetingMaterialMoment, recommendMeetingMaterials } from "../../agents/materialRecommendations"
import { materialFamilyId, meetingArtifactMetadata } from "../../agents/materialIdentity"
import { presentMeetingReply } from "../../agents/meetingPresentation"
import { handoffReason, meetingHandoff } from "../../agents/meetingHandoff"
import { businessChangeSummary, describeBusinessChanges } from "../../agents/meetingBusinessSummary"
import { revalidateReviewedProposal } from "../../agents/meetingFinalRevalidation"
import { buildExecutionSummary, describeExecutionForChat } from "../../agents/meetingExecutionSummary"
import { showcaseMarker } from "../../agents/meetingShowcase"
import { showcaseV2Marker } from "../../agents/meetingShowcaseV2"
import { focusedMeetingSession, meetingEntities, memoryFor, normalizedMeetingMemory, type EntityReference } from "../../agents/meetingContext"
import { describeHypothesisImpact } from "../../agents/meetingMinutes"
import { useProjectStore } from "../../store/projectStore"
import { useSpeechTranscription } from "../../hooks/useSpeechTranscription"
import type { AgentProposal, AgentType, MeetingMessage, ProposalAction, ProjectDataState } from "../../types"
import { MemberAvatar } from "./ui"
import PlanningMeetingDialog from "./PlanningMeetingDialog"
import "./MeetingRoom.css"

const agentIcons = {
  auto: Sparkles,
  project_orchestrator: Sparkles,
  task_decomposition: ListTree,
  risk_dependency: ShieldAlert,
  workload_capacity: Activity,
  plan_execution: ClipboardList,
  project_monitor: Flag,
  collaboration_notification: MessageCircle,
  material_organizer: FileStack,
  contribution_insight: Users,
} as const

const actionLabels: Record<ProposalAction["actionType"], string> = {
  CREATE_TASK: "创建任务", CREATE_SUBTASK: "创建执行步骤", UPDATE_TASK: "调整任务",
  UPDATE_SUBTASK: "调整执行步骤", UPDATE_STORY: "调整 Story",
  CREATE_RISK: "登记风险", UPDATE_RISK: "调整风险", ADD_DEPENDENCY: "添加任务依赖",
  CREATE_DISCUSSION: "发起讨论", BLOCK_TASK: "标记阻塞", REMOVE_DEPENDENCY: "移除任务依赖",
  UPDATE_DEADLINE: "调整截止日期", CHANGE_ASSIGNEE: "变更负责人", CHANGE_PRIORITY: "变更优先级",
}

const taskTypeLabels = { frontend: "前端", backend: "后端", database: "数据", test: "测试", design: "设计", devops: "运维" }
const riskLabels = { low: "低", medium: "中", high: "高", none: "无" }
const deliveryLabels = { backlog: "待规划", planned: "已规划", in_progress: "进行中", pending_acceptance: "待验收", accepted: "已验收", returned: "已退回" }
const sprintLabels = { planning: "规划中", active: "进行中", review: "评审中", closed: "已关闭" }
const entityStatusLabels: Record<string, string> = {
  ...deliveryLabels, ...sprintLabels, todo: "待办", done: "已完成", blocked: "受阻",
  open: "待处理", mitigating: "处理中", resolved: "已解决",
}

function AgentAvatar({ id, size = 34 }: { id: string; size?: number }) {
  const key = (id in agentIcons ? id : "auto") as keyof typeof agentIcons
  const Icon = agentIcons[key]
  return <span className={`meeting-agent-avatar meeting-agent-avatar--${key}`} style={{ width: size, height: size }} title={agentName(id)}>
    <Icon size={Math.round(size * 0.48)} strokeWidth={2} />
  </span>
}

function taskTitle(id: string, state: ProjectDataState, proposal?: AgentProposal) {
  return state.tasks[id]?.title ?? proposal?.actions.find((item) => item.id === id && item.actionType === "CREATE_TASK")?.proposedValue.title ?? "待创建任务"
}

function labelForAction(action: ProposalAction, state: ProjectDataState, proposal?: AgentProposal) {
  if (action.actionType === "ADD_DEPENDENCY") return `${taskTitle(String(action.proposedValue.sourceTaskId), state, proposal)} → ${taskTitle(String(action.proposedValue.targetTaskId), state, proposal)}`
  if (typeof action.proposedValue.title === "string") return action.proposedValue.title
  if (action.targetType === "task") return state.tasks[action.targetId]?.title ?? "当前任务"
  if (action.targetType === "story") return state.stories[action.targetId]?.title ?? "当前 Story"
  if (action.targetType === "risk") return state.risks[action.targetId]?.title ?? "当前风险"
  return "任务之间的依赖"
}

function actionFacts(action: ProposalAction, state: ProjectDataState) {
  const value = action.proposedValue
  return [
    typeof value.estimate === "number" ? `预计 ${value.estimate}h` : null,
    typeof value.assigneeId === "string" ? `负责人 ${state.members[value.assigneeId]?.name ?? "待确认"}` : null,
    typeof value.ownerId === "string" ? `跟进人 ${state.members[value.ownerId]?.name ?? "待确认"}` : null,
    typeof value.type === "string" ? taskTypeLabels[value.type as keyof typeof taskTypeLabels] : null,
    typeof value.level === "string" ? `${riskLabels[value.level as keyof typeof riskLabels]}风险` : null,
    typeof value.endDate === "string" ? `计划至 ${value.endDate}` : null,
  ].filter(Boolean)
}

function ReplyBody({ content }: { content: string }) {
  const html = useMemo(() => {
    const renderer = new marked.Renderer()
    renderer.paragraph = function(token) { const chain = /^[^。:：\n]+(?:→|->)[^。:：\n]+$/.test(token.text); return `<p${chain ? ' class="meeting-dependency-chain"' : ""}>${this.parser.parseInline(token.tokens)}</p>` }
    return DOMPurify.sanitize(marked.parse(content, { async: false, breaks: true, gfm: true, renderer }),
    { USE_PROFILES: { html: true }, FORBID_TAGS: ["img", "iframe", "form", "input", "style"], FORBID_ATTR: ["style"] }) }, [content])
  return <div className="meeting-message-bubble meeting-reply-markdown" dangerouslySetInnerHTML={{ __html: html }} />
}

function MessageRow({ message, state, onViewProposal, onReanalyze, readOnly = false }: {
  message: MeetingMessage
  state: ProjectDataState
  onViewProposal: (id: string) => void
  onReanalyze?: (message: MeetingMessage) => void
  readOnly?: boolean
}) {
  if (message.senderType === "system") return <div className="meeting-system-row" role="status">
    <CheckCircle2 size={14} /><span>{message.content}</span>{message.proposalId && <button type="button" onClick={() => onViewProposal(message.proposalId!)}>查看实际变更 <ArrowRight size={12} /></button>}{message.signal === "reanalyze" && onReanalyze && <button type="button" onClick={() => onReanalyze(message)}>重新分析</button>}
  </div>
  const human = message.senderType === "user"
  const digital = message.senderType === "digital_member"
  const name = human || digital ? state.members[message.senderId]?.name ?? "项目成员" : agentName(message.senderId)
  const proposal = message.proposalId ? state.proposals[message.proposalId] : null
  const presentation = presentMeetingReply(message.content, state, digital ? "digital_member" : message.senderId)
  const evidence = [...new Set((message.evidence ?? []).flatMap(item => item.split(/\n+/)))].filter(item => item.trim() && item !== message.content && !presentation.main.includes(item))
   return <article id={`meeting-message-${message.id}`} className={`meeting-message ${human ? "meeting-message--human" : ""}`}>
    <div className="meeting-message-avatar">{human || digital ? <MemberAvatar memberId={message.senderId} size={34} /> : <AgentAvatar id={message.senderId} />}</div>
    <div className="meeting-message-content">
      <div className="meeting-message-byline"><strong>{name}</strong>{digital && <small className="meeting-digital-label">AI 模拟成员</small>}<time>{new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time></div>
       {human ? <div className="meeting-message-bubble">{message.content.split(/\n+/).map((line, index) => <p key={index}>{line}</p>)}</div> : <ReplyBody content={presentation.main} />}
       {message.handoffTo && <div className="meeting-handoff" role="status"><AgentAvatar id={message.senderId} size={25} /><strong>{agentName(message.senderId)}</strong><ArrowRight size={17} /><AgentAvatar id={message.handoffTo} size={25} /><strong>{agentName(message.handoffTo)} Agent</strong><span>已邀请协作</span></div>}
       {!human && (presentation.details || evidence.length > 0) && <details className="meeting-evidence"><summary>{presentation.details ? "展开详情" : "查看依据"} <ChevronDown size={13} /></summary>{presentation.details && <ReplyBody content={presentation.details} />}{evidence.length > 0 && <ul>{evidence.map((item,index) => <li key={index}>{item}</li>)}</ul>}</details>}
       {message.artifactIds?.length ? <MeetingMaterials ids={message.artifactIds} state={state} compact /> : null}
       {message.signal === "reanalyze" && onReanalyze && <button className="meeting-message-reanalyze" type="button" onClick={() => onReanalyze(message)}>重新分析 <ArrowRight size={12} /></button>}
      {proposal && <div className="meeting-proposal-note">
         <div><WandSparkles size={15} /><strong>{describeBusinessChanges(businessChangeSummary(proposal.actions))}</strong></div>
         <p>{proposal.actions.filter((item) => item.actionType === "CREATE_TASK").slice(0, 3).map((item) => labelForAction(item, state, proposal)).join("、") || proposal.summary}</p>
        <button type="button" onClick={() => onViewProposal(proposal.id)}>{readOnly ? "查看建议记录" : "查看建议并审核"} <ArrowRight size={13} /></button>
      </div>}
    </div>
  </article>
}

function ContextPanel({ state, sessionId, onToggle }: { state: ProjectDataState; sessionId: string; onToggle: () => void }) {
  const session = state.meetingSessions[sessionId]
  const memory = normalizedMeetingMemory(state, session)
  const story = memory.focusStoryIds.length === 1 ? state.stories[memory.focusStoryIds[0]] : session.targetType === "story" ? state.stories[session.targetId] : null
  const sprint = memory.focusSprintId ? state.sprints[memory.focusSprintId] : session.targetType === "sprint" ? state.sprints[session.targetId] : story?.sprintId ? state.sprints[story.sprintId] : null
  const stories = story ? [story] : session.targetType === "project" ? memory.focusStoryIds.length ? memory.focusStoryIds.map((id) => state.stories[id]).filter(Boolean) : Object.values(state.stories) : Object.values(state.stories).filter((item) => item.sprintId === session.targetId)
  const taskIds = stories.flatMap((item) => item.taskIds)
  const subtaskCount = taskIds.reduce((sum, id) => sum + (state.tasks[id]?.subtaskIds.length ?? 0), 0)
  const criteria = stories.flatMap((item) => item.acceptanceCriteriaIds.map((id) => state.acceptanceCriteria[id]?.content).filter(Boolean))
  const risks = Object.values(state.risks).filter((risk) => risk.status !== "resolved" && risksForSession(risk.targetType, risk.targetId, stories, taskIds, sprint?.id))
  const dependencies = Object.values(state.dependencies).filter((item) => taskIds.includes(item.sourceTaskId) || taskIds.includes(item.targetTaskId))
  const proposals = session.proposalIds.map((id) => state.proposals[id]).filter((item) => item && (!story || item.targetId === story.id))
  const suggestedDependencies = proposals.flatMap((proposal) => proposal.actions.filter((action) => action.actionType === "ADD_DEPENDENCY" && action.status === "pending" && action.decision === "pending")
    .map((action) => `${taskTitle(String(action.proposedValue.sourceTaskId), state, proposal)} → ${taskTitle(String(action.proposedValue.targetTaskId), state, proposal)}`))
  const unverified = (session.facts ?? []).filter((fact) => fact.type === "hypothesis" && fact.status === "unverified")
  const topics = session.topics ?? []
  const warnings = [
    sprint && sprint.endDate < new Date().toISOString().slice(0, 10) ? "Sprint 计划结束日已过" : "",
    story && criteria.length === 0 ? "尚未填写验收标准" : "",
    risks.length ? `${risks.length} 项未关闭风险` : "",
    proposals.some((proposal) => proposal.actions.some((action) => action.status === "pending" && action.decision === "pending")) ? "当前工作有待审核的项目建议" : "",
    ...unverified.slice(-1).map((fact) => `会议待核实：${fact.content}`),
  ].filter(Boolean)
  return <aside className="meeting-context">
    <div className="meeting-panel-heading">会议背景<button type="button" title="收起会议背景" aria-label="收起会议背景" onClick={onToggle}><PanelLeftClose size={16} /></button></div>
    <div className="meeting-context-target">
      <span>{story ? "当前 Story" : session.targetType === "project" ? "项目会议" : "当前 Sprint"}</span>
      <strong>{story?.id.toUpperCase() ?? (session.targetType === "project" ? state.project.name : sprint?.name)}</strong>
      <h2>{story?.title ?? (memory.focusStoryIds.length > 1 ? `正在比较 ${memory.focusStoryIds.map((id) => id.toUpperCase()).join(" 与 ")}` : session.targetType === "project" ? "讨论整个项目" : sprint?.goal ?? "Sprint 规划")}</h2>
    </div>
    <dl className="meeting-context-facts">
      <div><dt>状态</dt><dd>{story ? deliveryLabels[story.deliveryStatus] : session.targetType === "project" ? "项目范围" : sprint ? sprintLabels[sprint.status] : "待确认"}</dd></div>
       {(story || sprint) && <div><dt>Sprint</dt><dd>{sprint?.name ?? "尚未安排"}{sprint?.status === "closed" ? " · 已关闭" : ""}</dd></div>}
      <div><dt>负责人</dt><dd>{story ? state.members[story.assigneeId]?.name ?? "未指定" : `${session.participantIds.length} 位成员`}</dd></div>
      <div><dt>计划时间</dt><dd>{story ? `${story.startDate} 至 ${story.dueDate}` : sprint ? `${sprint.startDate} 至 ${sprint.endDate}` : `${state.project.startDate} 至 ${state.project.endDate}`}</dd></div>
      <div><dt>已有工作</dt><dd>{taskIds.length} 个任务 · {subtaskCount} 个步骤</dd></div>
       {story && <div><dt>验收标准</dt><dd>{criteria.length} 条</dd></div>}
    </dl>
    <div className="meeting-context-section">
      <h3>当前提醒</h3>
       {warnings.length ? warnings.map((item) => <p key={item} className="meeting-context-warning"><ShieldAlert size={14} /> {item}</p>) : <p className="meeting-context-calm">暂无提醒</p>}
    </div>
    <div className="meeting-context-section">
      <h3>任务依赖</h3>
       {dependencies.slice(0, 3).map((item) => <p className="meeting-context-dependency" key={item.id}>{state.tasks[item.sourceTaskId]?.title ?? "前置任务"} → {state.tasks[item.targetTaskId]?.title ?? "后续任务"}</p>)}
       {!dependencies.length && <p className="meeting-context-muted">当前工作暂无已登记依赖</p>}
       {suggestedDependencies.length > 0 && <><p className="meeting-context-dependency-label">会议建议 · 待审核</p>{suggestedDependencies.slice(0, 3).map((item, index) => <p className="meeting-context-dependency" key={`${item}-${index}`}>{item}</p>)}</>}
    </div>
    <div className="meeting-context-section meeting-agenda">
      <h3>会议议题</h3>
       {topics.length ? topics.map((topic) => <div key={topic.id} className={`meeting-topic meeting-topic--${topic.status}`}>
         <span className={topic.status === "decided" ? "meeting-agenda-done" : "meeting-agenda-dot"}>{topic.status === "decided" ? <Check size={11} /> : null}</span>
         <span>{topic.title}</span><small>{topic.status === "active" ? "讨论中" : topic.status === "decided" ? "已决定" : topic.status === "unresolved" ? "待核实" : topic.status === "deferred" ? "已暂缓" : "已记录"}</small>
       </div>) : <p className="meeting-context-muted">议题会随讨论形成</p>}
    </div>
  </aside>
}

function risksForSession(type: string, id: string, stories: Array<{ id: string }>, taskIds: string[], sprintId?: string) {
  return (type === "story" && stories.some((item) => item.id === id)) || (type === "task" && taskIds.includes(id)) || (type === "sprint" && sprintId === id)
}

function ActionEditor({ action, state, onSave, onCancel }: {
  action: ProposalAction
  state: ProjectDataState
  onSave: (value: Record<string, unknown>) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>(() => ({ ...action.proposedValue }))
  const editableFields = Object.entries(draft).filter(([field]) => !["targetType", "targetId", "sourceTaskId", "targetTaskId"].includes(field))
  return <div className="meeting-action-editor">
    {editableFields.map(([field, value]) => <label key={field}>
      <span>{({ title: "名称", estimate: "预计工时", assigneeId: "负责人", ownerId: "跟进人", type: "任务类型", startDate: "开始日期", endDate: "结束日期", level: "风险等级", description: "风险说明", impact: "影响", mitigation: "应对方式", status: "状态" } as Record<string, string>)[field] ?? field}</span>
      {field === "assigneeId" || field === "ownerId"
        ? <select value={String(value)} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}>{Object.values(state.members).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>
        : field === "type" ? <select value={String(value)} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}>{Object.entries(taskTypeLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
          : field === "level" ? <select value={String(value)} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}>{Object.entries(riskLabels).filter(([id]) => id !== "none").map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
            : <input value={String(value)} type={typeof value === "number" ? "number" : field.endsWith("Date") ? "date" : "text"}
              onChange={(event) => setDraft({ ...draft, [field]: typeof value === "number" ? Number(event.target.value) : event.target.value })} />}
    </label>)}
    <div className="meeting-action-editor-actions"><button type="button" onClick={onCancel}>取消</button><button type="button" onClick={() => onSave(draft)}>保存修改</button></div>
  </div>
}

function DecisionPanel({ state, sessionId, focusedProposalId, onApply, onError, onLocateMessage, onToggle, readOnly = false }: {
  state: ReturnType<typeof useProjectStore.getState>
  sessionId: string
  focusedProposalId: string | null
  onApply: () => void
  onError: (message: string) => void
  onLocateMessage: (proposalId: string) => void
  readOnly?: boolean
  onToggle: () => void
}) {
  const session = state.meetingSessions[sessionId]
  const proposals = session.proposalIds.map((id) => state.proposals[id]).filter(Boolean).reverse()
  const allActions = proposals.flatMap((item) => item.actions)
  const counts = {
    pending: proposals.filter((item) => item.status === "draft" || item.status === "reviewed").flatMap((item) => item.actions).filter((item) => item.decision === "pending" && item.status === "pending").length,
    accepted: allActions.filter((item) => item.decision === "accepted").length,
    rejected: allActions.filter((item) => item.decision === "rejected").length,
    applied: allActions.filter((item) => item.status === "applied").length,
  }
  const [editingId, setEditingId] = useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const editableProposals = readOnly ? [] : proposals.filter((item) => item.status === "draft" || item.status === "reviewed")
  const reviews = editableProposals.filter((item) => item.actions.some((action) => action.decision === "accepted"))
    .map((proposal) => ({ proposal, result: revalidateReviewedProposal(state, proposal, session) }))
  return <aside className="meeting-decisions">
     <div className="meeting-panel-heading meeting-decision-heading"><span>{counts.pending ? "待确认决策" : "决策与行动"}</span><button type="button" title="收起决策区" aria-label="收起决策区" onClick={onToggle}><PanelRightClose size={16} /></button></div>
    <div className="meeting-decision-counts">
      <div><strong>{counts.pending}</strong><span>待确认</span></div>
      <div><strong>{counts.accepted}</strong><span>已采纳</span></div>
      <div><strong>{counts.rejected}</strong><span>已拒绝</span></div>
      <div><strong>{counts.applied}</strong><span>已执行</span></div>
    </div>
    <div className="meeting-decision-scroll">
      {proposals.length === 0 && <div className="meeting-decision-empty"><ClipboardList size={28} /><strong>还没有行动项</strong><p>{readOnly ? "这场会议没有留下项目行动项。" : "先在讨论区提问。需要修改项目时，专业助手会把建议整理到这里，供你逐项确认。"}</p></div>}
       {proposals.map((proposal: AgentProposal) => <section key={proposal.id} id={`meeting-decision-${proposal.id}`} className={`meeting-decision-group ${focusedProposalId === proposal.id ? "meeting-decision-group--focused" : ""}`}>
         <div className="meeting-decision-group-title">{session.messageIds.some((id) => state.meetingMessages[id]?.proposalId === proposal.id)
           ? <button type="button" title="返回相关讨论" onClick={() => onLocateMessage(proposal.id)}>{agentName(proposal.agentType)}的建议 <ArrowRight size={12} /></button>
           : <span>{agentName(proposal.agentType)}的建议</span>}<small>{proposal.status === "applied" ? "已应用" : proposal.status === "partially_applied" ? "部分应用" : proposal.status === "failed" ? "执行失败" : proposal.status === "rejected" ? "已驳回" : "待审核"}</small></div>
         <p className="meeting-decision-summary">{describeBusinessChanges(businessChangeSummary(
           proposal.actions.some((action) => action.decision !== "pending")
             ? proposal.actions.filter((action) => action.decision === "accepted") : proposal.actions,
         ))}{proposal.actions.some((action) => action.decision === "rejected")
           ? ` · ${proposal.actions.filter((action) => action.decision === "rejected").length} 项建议已拒绝` : ""}</p>
        {!readOnly && (proposal.status === "draft" || proposal.status === "reviewed") && <div className="meeting-decision-bulk">
          <button type="button" onClick={() => { setReviewOpen(false); proposal.actions.forEach((action) => state.setProposalDecision(proposal.id, action.id, "accepted")) }}>全部采纳</button>
          <button type="button" onClick={() => { setReviewOpen(false); const result = state.rejectProposal(proposal.id); if (!result.ok) onError(result.message) }}>全部驳回</button>
        </div>}
        {proposal.actions.map((action) => {
          const editable = !readOnly && (proposal.status === "draft" || proposal.status === "reviewed")
          const beforeAssignee = action.beforeValue && typeof action.beforeValue === "object" ? (action.beforeValue as Record<string, unknown>).assigneeId : null
           return <article key={action.id} className={`meeting-action ${action.actionType === "CREATE_SUBTASK" ? "meeting-action--child" : ""} ${action.actionType === "ADD_DEPENDENCY" ? "meeting-action--relation" : ""}`}>
            <div className="meeting-action-head"><span>{actionLabels[action.actionType]}</span><small className={`meeting-action-status meeting-action-status--${action.status === "pending" ? action.decision : action.status}`}>{action.status === "applied" ? "已执行" : action.status === "failed" ? "失败" : action.status === "stale" ? "需重新确认" : action.decision === "accepted" ? "已采纳" : action.decision === "rejected" ? "已拒绝" : action.status === "pending" ? "待确认" : "本次未采纳"}</small></div>
             <h4>{labelForAction(action, state, proposal)}</h4>
             {action.actionType !== "ADD_DEPENDENCY" && <p className="meeting-action-facts">{actionFacts(action, state).join(" · ") || (beforeAssignee ? `负责人 ${state.members[String(beforeAssignee)]?.name ?? "待确认"} → ${state.members[String(action.proposedValue.assigneeId)]?.name ?? "待确认"}` : "项目计划调整")}</p>}
            <p className="meeting-action-reason">{action.reason.length > 150 ? action.actionType === "CREATE_SUBTASK" ? `为「${state.tasks[action.targetId]?.title ?? "当前任务"}」补充执行步骤，分工与工时可在审核时调整。` : "根据本次讨论整理，确认后再进入项目。" : presentMeetingReply(action.reason, state).main.replace(/\*\*/g, "")}</p>
            <details className="meeting-action-evidence"><summary>查看依据 <ChevronDown size={12} /></summary><p>{action.reason}</p><ul>{proposal.evidence.slice(0, 5).map((item, index) => <li key={index}>{item.detail}</li>)}</ul></details>
            {action.error && <p className="meeting-action-error">{action.error}</p>}
            {editingId === action.id && editable ? <ActionEditor key={action.id} action={action} state={state} onCancel={() => setEditingId(null)} onSave={(value) => {
              const result = state.updateProposalValue(proposal.id, action.id, value)
              setReviewOpen(false)
              if (result.ok) setEditingId(null)
              else onError(result.message)
            }} /> : editable && <div className="meeting-action-buttons">
              <button type="button" className={action.decision === "accepted" ? "is-active" : ""} onClick={() => { setReviewOpen(false); state.setProposalDecision(proposal.id, action.id, "accepted") }}><Check size={13} /> 采纳</button>
              <button type="button" onClick={() => setEditingId(action.id)}>修改</button>
              <button type="button" className={action.decision === "rejected" ? "is-rejected" : ""} onClick={() => { setReviewOpen(false); state.setProposalDecision(proposal.id, action.id, "rejected") }}><X size={13} /> 拒绝</button>
            </div>}
          </article>
        })}
      </section>)}
    </div>
     {editableProposals.length > 0 && <div className="meeting-decision-footer">
       {reviewOpen && reviews.map(({ proposal, result }) => <div key={proposal.id} className="meeting-final-review" aria-live="polite">
         <strong>{result.valid ? "最终计划校验通过" : "最终计划需要调整"}</strong>
         <p>{describeBusinessChanges(result.businessSummary)}</p>
         <details><summary>查看排期、依赖与容量依据</summary><p>{result.scheduleSummary}</p><p>{result.dependencySummary}</p>
         {result.criticalPath.length > 0 && <p>关键路径：{result.criticalPath.join(" → ")}</p>}
         {result.workloadSummary.map((line) => <p key={line}>{line}</p>)}</details>
         {result.warnings.map((line) => <p key={line} className="meeting-final-warning">注意：{line}</p>)}
         {result.errors.map((line) => <p key={line} className="meeting-action-error">{line}</p>)}
       </div>)}
       {reviewOpen ? <div className="meeting-final-controls"><button type="button" onClick={() => setReviewOpen(false)}>返回修改</button><button type="button" disabled={reviews.some(({ result }) => !result.valid)} onClick={() => { setReviewOpen(false); onApply() }}>确认应用 <ArrowRight size={14} /></button></div>
         : <button type="button" disabled={!reviews.length} onClick={() => setReviewOpen(true)}>重新校验最终计划 <ArrowRight size={14} /></button>}
     </div>}
  </aside>
}

const panelSizeKey = "scrumflow:meeting-panel-widths"
const defaultPanelWidths = { left: 258, right: 330 }
function loadPanelWidths() {
  try {
    const saved = JSON.parse(localStorage.getItem(panelSizeKey) ?? "null")
    return { left: Math.min(440, Math.max(200, Number(saved?.left) || defaultPanelWidths.left)),
      right: Math.min(520, Math.max(240, Number(saved?.right) || defaultPanelWidths.right)) }
  } catch { return defaultPanelWidths }
}
function PanelResizeHandle({ side, width, max, onResize, onDragging }: {
  side: "left" | "right"; width: number; max: number; onResize: (width: number) => void; onDragging: (active: boolean) => void
}) {
  const gesture = useRef<{ pointerId: number; x: number; width: number } | null>(null)
  const min = side === "left" ? 200 : 240, direction = side === "left" ? 1 : -1
  const resize = (value: number) => onResize(Math.min(max, Math.max(min, value)))
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (gesture.current?.pointerId !== event.pointerId) return
    gesture.current = null; onDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <div className={"meeting-panel-resizer meeting-panel-resizer--" + side} role="separator" tabIndex={0}
    aria-label={side === "left" ? "调整会议背景宽度" : "调整决策区宽度"} aria-orientation="vertical"
    aria-valuemin={min} aria-valuemax={Math.round(max)} aria-valuenow={Math.round(width)}
    title="拖动调整宽度，双击恢复默认" onDoubleClick={() => resize(defaultPanelWidths[side])}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); gesture.current = { pointerId: event.pointerId, x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId); onDragging(true) }}
    onPointerMove={event => { if (gesture.current?.pointerId === event.pointerId) resize(gesture.current.width + (event.clientX - gesture.current.x) * direction) }}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { gesture.current = null; onDragging(false) }}
    onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); resize(width + (event.key === "ArrowRight" ? 24 : -24) * direction) } else if (event.key === "Home") { event.preventDefault(); resize(min) } else if (event.key === "End") { event.preventDefault(); resize(max) } }} />
}

export default function MeetingRoom({ initialSessionId, onClose, initialHistoryOpen = false, initialView = "live" }: {
  initialSessionId: string; onClose: () => void; initialHistoryOpen?: boolean; initialView?: "live" | "history"
}) {
  const state = useProjectStore()
  const [sessionId, setSessionId] = useState(initialSessionId)
  const [viewMode, setViewMode] = useState<"live" | "history">(initialHistoryOpen ? "history" : initialView)
  const [closing, setClosing] = useState(false)
  const [materialBusy, setMaterialBusy] = useState(false)
  const session = state.meetingSessions[sessionId]
  const [draft, setDraft] = useState("")
  const [cursor, setCursor] = useState(0)
  const [pickerDismissed, setPickerDismissed] = useState(false)
  const [retryText, setRetryText] = useState("")
  const [speakerId, setSpeakerId] = useState(state.workspace.currentUserId)
  const [busyAgent, setBusyAgent] = useState<AgentType | null>(null)
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null)
  const [pickerIndex, setPickerIndex] = useState(0)
  const [showHistory, setShowHistory] = useState(initialHistoryOpen)
  const [activeTab, setActiveTab] = useState<"chat" | "context" | "decisions">("chat")
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailProposalId, setDetailProposalId] = useState<string | null>(null)
  const [focusedProposalId, setFocusedProposalId] = useState<string | null>(null)
  const [showMinutes, setShowMinutes] = useState(false)
  const [showMaterials, setShowMaterials] = useState(false)
  const [showTechnicalMenu, setShowTechnicalMenu] = useState(false)
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [error, setError] = useState("")
  const [panelWidths, setPanelWidths] = useState(loadPanelWidths)
  const [layoutWidth, setLayoutWidth] = useState(window.innerWidth)
  const [resizing, setResizing] = useState(false)
  const layoutRef = useRef<HTMLDivElement>(null)
  const canInteract = viewMode === "live" && session?.status === "active"
  const canPrepareMaterials = viewMode === "live"
  const working = Boolean(busyAgent) || materialBusy
  const timelineEnd = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const sendingRef = useRef(false)
  const history = Object.values(state.meetingSessions).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const messages = session?.messageIds.map((id) => state.meetingMessages[id]).filter((item) => item && item.content !== showcaseMarker && item.content !== showcaseV2Marker && !item.content.startsWith("示范讨论：")) ?? []
  const materialMoment = session ? meetingMaterialMoment(state, session) : null
  const materialSuggestions = session ? recommendMeetingMaterials(state, session) : []
  const generatedKeys = session ? generatedRecommendationKeys(state, session) : new Set<string>()
  const remainingMaterials = materialSuggestions.filter(item => !generatedKeys.has(item.key)).length
  const materialCount = new Set(Object.values(state.assets).filter(asset => meetingArtifactMetadata(asset)?.id === sessionId).map(materialFamilyId)).size
  const openMaterials = () => { setShowMaterials(true); setShowMinutes(false); setClosing(false) }
  const token = composerTokenAt(draft, cursor)
  const mentionFragment = token?.kind === "agent" ? token.fragment : ""
  const entityFragment = token?.kind === "entity" ? token.fragment : ""
  const pickerOpen = canInteract && !pickerDismissed && token?.kind === "agent"
  const entityPickerOpen = canInteract && !pickerDismissed && token?.kind === "entity"
  const pickerOptions = pickerOpen ? [
    ...meetingAgents.filter((item) => `${item.name} ${item.handle} ${item.description}`.toLowerCase().includes(mentionFragment.toLowerCase())).map((item) => ({ kind: "agent" as const, item })),
    ...Object.values(state.members).filter((item) => `${item.name} ${item.role}`.toLowerCase().includes(mentionFragment.toLowerCase())).map((item) => ({ kind: "member" as const, item })),
  ] : []
  const entityOptions = entityPickerOpen ? meetingEntities(state).filter((item) => `${item.id} ${item.label}`.toLowerCase().includes(entityFragment.toLowerCase())).slice(0, 12) : []

  useEffect(() => {
    try { localStorage.setItem(panelSizeKey, JSON.stringify(panelWidths)) } catch { /* Layout remains usable without saved preferences. */ }
  }, [panelWidths])
  useEffect(() => {
    const element = layoutRef.current
    if (!element || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(entries => setLayoutWidth(entries[0].contentRect.width))
    observer.observe(element); return () => observer.disconnect()
  }, [showMinutes, showMaterials])
  useEffect(() => { timelineEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" }) }, [sessionId, messages.length, busyAgent])

  // 语音转写：每句识别结果直接记为当前发言人的会议发言，不触发 AI 助手回复，结束会议时统一总结
  const speech = useSpeechTranscription((text) => {
    const current = useProjectStore.getState()
    if (current.meetingSessions[sessionId]?.status !== "active") return
    try { current.addMeetingMessage(sessionId, { senderType: "user", senderId: speakerId, content: text }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "语音记录失败") }
  })
  const { listening, stop: stopListening } = speech
  useEffect(() => { if (!canInteract && listening) stopListening() }, [canInteract, listening, stopListening])

  useEffect(() => {
    if (!focusedProposalId || !rightOpen || showMinutes || showMaterials) return
    document.getElementById(`meeting-decision-${focusedProposalId}`)?.scrollIntoView({ block: "start", behavior: "smooth" })
  }, [focusedProposalId, rightOpen, showMinutes, sessionId])

  if (!session) return null
  const memory = normalizedMeetingMemory(state, session)
  const story = memory.focusStoryIds.length === 1 ? state.stories[memory.focusStoryIds[0]] : session.targetType === "story" ? state.stories[session.targetId] : null
  const sprint = session.targetType === "sprint" ? state.sprints[session.targetId] : story?.sprintId ? state.sprints[story.sprintId] : null
  const detailSession = focusedMeetingSession(state, session, memory)

  const chooseMention = (option: (typeof pickerOptions)[number]) => {
    if (!option || !token) return
    const handle = option.kind === "agent" ? option.item.handle : option.item.name
    const inserted = insertComposerReference(draft, token, handle)
    setDraft(inserted.text)
    setCursor(inserted.cursor)
    setPickerIndex(0)
    composerRef.current?.focus()
    requestAnimationFrame(() => composerRef.current?.setSelectionRange(inserted.cursor, inserted.cursor))
  }

  const chooseEntity = (entity: EntityReference) => {
    if (!entity || !token) return
    const inserted = insertComposerReference(draft, token, entity.id.toUpperCase())
    setDraft(inserted.text)
    setCursor(inserted.cursor)
    setPickerIndex(0)
    composerRef.current?.focus()
    requestAnimationFrame(() => composerRef.current?.setSelectionRange(inserted.cursor, inserted.cursor))
  }

  const storeAnswer = (answer: AgentAnswer, digitalMemberId?: string) => {
    const current = useProjectStore.getState()
    let proposalId: string | undefined
    if (answer.proposal) {
      const saved = current.saveProposal(answer.proposal)
      if (saved.ok) {
        current.linkMeetingProposal(sessionId, answer.proposal.id)
        proposalId = answer.proposal.id
        setFocusedProposalId(proposalId)
      } else setError(saved.message)
    }
    current.addMeetingMessage(sessionId, {
      senderType: digitalMemberId ? "digital_member" : "agent", senderId: digitalMemberId ?? answer.agentType, content: answer.content,
       evidence: answer.evidence, rawEvidence: answer.rawEvidence,
       ...(answer.artifactIds ? { artifactIds: answer.artifactIds } : {}),
      ...(proposalId ? { proposalId } : {}),
    })
  }

  const send = async (override?: string) => {
    const text = (override ?? draft).trim()
    if (!text || sendingRef.current || working || !canInteract) return
    const current = useProjectStore.getState()
    const { agentId, question, memberId } = parseAgentMention(text, current)
    const userMessage = current.addMeetingMessage(sessionId, { senderType: "user", senderId: speakerId, content: text })
    setDraft("")
    setCursor(0)
    setError("")
    setRetryText("")
    if (agentId === "auto" && !memberId && !/[@＠]/.test(text) && /可能.{0,8}(晚|延期)|预计.{0,8}(晚|延期)|要晚|完不成/.test(text) && !/[？?]/.test(text)) {
       const updated = useProjectStore.getState()
       const meeting = updated.meetingSessions[sessionId]
       const fact = meeting.facts?.at(-1)
       current.addMeetingMessage(sessionId, { senderType: "agent", senderId: "project_orchestrator", signal: "reanalyze",
         content: fact ? describeHypothesisImpact(updated, meeting, fact) : "我先把这条发言记为待核实信息，正式计划未变。需要现在检查影响吗？" })
       return
     }
    try {
      sendingRef.current = true
      setBusyMemberId(memberId ?? null)
      const handoff = !memberId && agentId === "project_orchestrator" ? meetingHandoff(question) : null
      if (handoff) current.addMeetingMessage(sessionId, { senderType: "agent", senderId: "project_orchestrator", content: handoffReason[handoff]!, handoffTo: handoff })
      setBusyAgent(handoff ?? (agentId === "material_organizer" ? "material_organizer" : memberId || agentId === "auto" ? "project_orchestrator" : agentId))
       const latest = useProjectStore.getState()
       const previousStory = memoryFor(latest.meetingSessions[sessionId]).focusStoryIds.at(-1)
       const result = await coordinateMeetingTurn(latest, latest.meetingSessions[sessionId], agentId, question, undefined, memberId)
       const saved = useProjectStore.getState().setMeetingMemory(sessionId, result.memory)
       if (!saved.ok) throw new Error(saved.message)
       useProjectStore.getState().recordMeetingQaTrace(sessionId, {
         messageId: userMessage.id, input: text, resolvedIntent: result.resolvedIntent,
         focusStoryIds: result.memory.focusStoryIds, focusSprintId: result.memory.focusSprintId,
         referencedTaskKeys: result.memory.referencedTaskKeys, constraints: result.memory.constraints,
         calledAgents: result.completedAgents, snapshotVersion: result.snapshotVersion,
         selectedOptionId: result.memory.activePlanId, proposalId: result.answer.proposal?.id ?? null,
         llmFallback: result.llmFallback, llmReplyUsed: result.llmReplyUsed, warnings: result.warnings,
       })
       const nextStory = result.memory.focusStoryIds.at(-1)
       if (nextStory && nextStory !== previousStory) useProjectStore.getState().addMeetingMessage(sessionId, {
         senderType: "system", senderId: "system", content: `已切换讨论对象：${nextStory.toUpperCase()} · ${latest.stories[nextStory]?.title ?? "Story"}`,
       })
      if (handoff === "task_decomposition" && result.answer.agentType === "plan_execution" && result.answer.proposal) {
        useProjectStore.getState().addMeetingMessage(sessionId, { senderType: "agent", senderId: "task_decomposition",
          content: "已按新约束调整并核对容量，现在交给计划落地整理待审核行动。", handoffTo: "plan_execution" })
      }
      storeAnswer(result.answer, result.digitalMemberId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "分析暂时没有完成，请重试")
      setRetryText(text)
    } finally {
      sendingRef.current = false
      setBusyAgent(null)
      setBusyMemberId(null)
    }
  }

  const applyAccepted = () => {
    if (!canInteract || working) return
    const current = useProjectStore.getState()
    const active = current.meetingSessions[sessionId].proposalIds.map((id) => current.proposals[id]).filter((item) => item && ["draft", "reviewed"].includes(item.status) && item.actions.some((action) => action.decision === "accepted"))
    let failed = 0
    let stale = 0
    const blocked: string[] = []
    for (const proposal of active) {
      const outcome = current.applyProposal(proposal.id)
      if (!outcome.ok && useProjectStore.getState().proposals[proposal.id].status !== "partially_applied") blocked.push(outcome.message)
      const result = useProjectStore.getState().proposals[proposal.id]
      failed += result.actions.filter((item) => item.status === "failed").length
      stale += result.actions.filter((item) => item.status === "stale").length
    }
    const latest = useProjectStore.getState()
    const summary = buildExecutionSummary(latest, active.map((item) => latest.proposals[item.id]))
    if (latest.meetingSessions[sessionId].status === "active") latest.addMeetingMessage(sessionId, { senderType: "system", senderId: "system",
      content: blocked.length || failed || stale ? `项目行动需要复核：${blocked.join("；")}${failed ? `；${failed} 项执行失败` : ""}${stale ? `；${stale} 项数据已变化` : ""}`
        : describeExecutionForChat(summary), ...(blocked.length || failed || stale ? {} : { proposalId: active.at(-1)?.id }) })
    setError(blocked.join("；") || (stale ? "部分建议对应的项目数据已变化，请重新确认。" : failed ? "部分行动未能执行，原因已显示在右侧。" : ""))
  }

  const openProposal = (id: string) => {
    setFocusedProposalId(id)
    setRightOpen(true)
    setShowMaterials(false); setShowMinutes(false)
    setActiveTab("decisions")
    window.setTimeout(() => document.getElementById(`meeting-decision-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 30)
  }

  const locateProposalMessage = (id: string) => {
    const message = messages.find((item) => item.proposalId === id)
    if (!message) return
    setShowMinutes(false)
    setActiveTab("chat")
    window.setTimeout(() => document.getElementById(`meeting-message-${message.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 30)
  }

  const finishMeeting = async () => {
    if (!canInteract || working || !closing) return
    const result = useProjectStore.getState().endMeeting(sessionId)
    if (!result.ok) { setError(result.message); return }
    setShowMinutes(true)
    setBusyAgent("project_orchestrator")
    setClosing(false)
    try { if (messages.filter(message => message.senderType !== "system").length >= 3) await ensureMeetingNarrative(sessionId) } catch (cause) { setError(cause instanceof Error ? cause.message : "摘要暂未完成，可在纪要中重试") }
    setBusyAgent(null)
  }

  const available = Math.max(440, layoutWidth - 400 - 16)
  const wantedLeft = leftOpen ? panelWidths.left : 38, wantedRight = rightOpen ? panelWidths.right : 38
  const excess = Math.max(0, wantedLeft + wantedRight - available)
  const leftWidth = leftOpen ? Math.max(200, wantedLeft - excess * (wantedLeft / (wantedLeft + wantedRight))) : 38
  const rightWidth = rightOpen ? Math.max(240, Math.min(wantedRight, available - leftWidth)) : 38
  const resizePanel = (side: "left" | "right", width: number) => setPanelWidths(previous => ({ ...previous, [side]: width }))

   return <div className="meeting-room" role="dialog" aria-modal="true" aria-label="AI 项目会议室">
    <header className="meeting-header">
      {canInteract && session.presentationMode !== "defense" && <button className="meeting-defense-mode" type="button" onClick={() => state.setMeetingPresentation(sessionId, { presentationMode: "defense" })}>开启答辩彩排</button>}
      <div className="meeting-header-title"><span className="meeting-header-symbol"><Sparkles size={18} /></span><div><h1>{session.title}</h1><p>{session.targetType === "project" ? `${state.project.name}${story ? ` · 当前讨论 ${story.id.toUpperCase()}` : memory.focusStoryIds.length > 1 ? ` · 比较 ${memory.focusStoryIds.map((id) => id.toUpperCase()).join(" / ")}` : ""}` : story ? `${story.id.toUpperCase()} · ${story.title}` : sprint?.name}{story && sprint ? ` · ${sprint.name}` : ""}</p></div></div>
      <div className="meeting-header-team"><div className="meeting-avatar-stack">{session.participantIds.map((id) => <MemberAvatar key={id} memberId={id} size={29} />)}<AgentAvatar id="project_orchestrator" size={29} /></div><span>{session.participantIds.length} 位成员 · AI 协作团队</span></div>
       <div className="meeting-header-actions"><span className={`meeting-live ${!canInteract ? "meeting-live--ended" : ""}`}><i />{session.status === "ended" ? "会议已结束" : viewMode === "history" ? "历史记录 · 未结束" : closing ? "结束前确认" : "会议进行中"}</span><div className="meeting-history-wrap"><button type="button" title="历史会议" disabled={working} aria-expanded={showHistory} onClick={() => { setShowHistory(!showHistory); setShowTechnicalMenu(false) }}><Clock3 size={15} /> 历史会议</button>{showHistory && <div className="meeting-history-menu"><h3>历史会议</h3>{history.map(item => {
          const scope = state.sprints[item.memory?.focusSprintId ?? state.stories[item.targetId]?.sprintId ?? ""]?.name ?? "项目会议"
          return <button type="button" key={item.id} disabled={working} onClick={() => { setSessionId(item.id); setViewMode("history"); setClosing(false); setDraft(""); setError(""); setRetryText(""); setPickerDismissed(true); setShowTechnicalMenu(false); setDetailOpen(false); setFocusedProposalId(null); setShowHistory(false); setShowMaterials(false); setShowMinutes(false); setActiveTab("chat") }}><strong>{item.title.replace(/Showcase\s*V?\d*|示范讨论|测试会议|Demo/gi, "项目协作会议")}</strong><span>{new Date(item.createdAt).toLocaleString("zh-CN")} · {scope} · {item.status === "ended" ? "已结束" : "未结束"}</span><span>{item.participantIds.map(id => state.members[id]?.name).filter(Boolean).join("、")}</span><p>{(item.narrative?.text ?? "").slice(0, 100) || `${item.topics?.length ?? 0} 个议题 · ${item.messageIds.length} 条讨论`}</p></button>
        })}</div>}</div>{detailSession && <div className="meeting-history-wrap meeting-technical-wrap"><button type="button" title="更多" onClick={() => setShowTechnicalMenu(!showTechnicalMenu)}><MoreHorizontal size={17} /></button>{showTechnicalMenu && <div className="meeting-history-menu meeting-technical-menu"><button type="button" onClick={() => { setDetailProposalId(focusedProposalId); setDetailOpen(true); setShowTechnicalMenu(false) }}>Agent 技术详情</button></div>}</div>}{viewMode === "history" && session.status === "active" && <button type="button" title="继续会议" onClick={() => { setViewMode("live"); setClosing(false); setShowMinutes(false); setShowMaterials(false); setActiveTab("chat") }}>继续会议 <ArrowRight size={14} /></button>}{canInteract && !closing && <button type="button" title="结束会议" disabled={working} onClick={() => { setClosing(true); setShowMaterials(false); setShowMinutes(true) }}><Square size={14} /> 结束会议</button>}<button className="meeting-header-close" type="button" title="关闭会议室" disabled={working} onClick={onClose}><X size={18} /></button></div>
    </header>
     <nav className="meeting-detail-tabs" aria-label="会议详情">{[["chat", "会议对话"], ["minutes", "会议纪要"], ["materials", "会议材料"]].map(([id,label]) => <button type="button" key={id} aria-label={label} disabled={working} aria-current={(id === "minutes" ? showMinutes : id === "materials" ? showMaterials : !showMinutes && !showMaterials) ? "page" : undefined} onClick={() => { setShowMinutes(id === "minutes"); setShowMaterials(id === "materials"); setClosing(false); setShowTechnicalMenu(false) }}>{label}{id === "materials" && <small className="meeting-material-tab-count" aria-live="polite">{materialBusy || busyAgent === "material_organizer" ? " · 正在生成" : materialCount ? ` · ${materialCount} 份` : canPrepareMaterials && remainingMaterials ? ` · ${remainingMaterials} 项建议` : ""}{canInteract && materialMoment?.expanded && remainingMaterials > 0 && !showMaterials && <i aria-label="有新建议" />}</small>}</button>)}</nav>
     {!canInteract && error && <div className="meeting-compose-error" role="alert">{error}<button type="button" title="关闭提示" onClick={() => setError("")}><X size={13} /></button></div>}
     {!showMinutes && !showMaterials && <nav className="meeting-mobile-tabs" aria-label="会议页面">{([ ["chat", "讨论"], ["context", "项目背景"], ["decisions", "待确认"] ] as const).map(([id, label]) => <button key={id} className={activeTab === id ? "is-active" : ""} onClick={() => { setActiveTab(id); if (id === "context") setLeftOpen(true); if (id === "decisions") setRightOpen(true) }}>{label}</button>)}</nav>}
     {showMaterials ? <main className="meeting-materials-page"><h2>会议材料</h2><p>这场会议的成果统一归档在这里，默认展示最新版本。</p>{canPrepareMaterials && <MaterialSuggestions state={state} sessionId={sessionId} showAssets={false} onBusyChange={setMaterialBusy} />}{readableMeeting(state, session).assetIds.length ? <MeetingMaterials ids={readableMeeting(state, session).assetIds} state={state} /> : <p>{canInteract ? "尚未生成材料。可以在会议对话中邀请材料整理。" : "这场会议尚未生成材料。"}</p>}</main> : showMinutes ? <MeetingMinutesView key={sessionId} state={state} sessionId={sessionId} busy={Boolean(busyAgent)} readOnly={!canInteract} allowMaterials={canPrepareMaterials} closing={closing} onBusyChange={setMaterialBusy} onBack={() => { setShowMinutes(false); setClosing(false) }} onReview={() => { setClosing(false); setShowMinutes(false); setRightOpen(true); setActiveTab("decisions") }} onEnd={finishMeeting} onMaterials={openMaterials} /> : <div ref={layoutRef} style={{ gridTemplateColumns: leftWidth + "px " + (leftOpen ? 8 : 0) + "px minmax(0, 1fr) " + (rightOpen ? 8 : 0) + "px " + rightWidth + "px" }} className={"meeting-layout" + (resizing ? " meeting-layout--resizing" : "")}>
       <div className={`meeting-pane meeting-pane--context ${activeTab === "context" ? "is-visible" : ""}`}>{leftOpen ? <ContextPanel state={state} sessionId={sessionId} onToggle={() => setLeftOpen(false)} /> : <button type="button" className="meeting-side-rail" title="展开会议背景" aria-label="展开会议背景" onClick={() => setLeftOpen(true)}><PanelLeftOpen size={16} /></button>}</div>
      {leftOpen && <PanelResizeHandle side="left" width={leftWidth} max={Math.max(200, Math.min(440, layoutWidth - rightWidth - 416))} onResize={width => resizePanel("left", width)} onDragging={setResizing} />}
      <main className={`meeting-pane meeting-pane--chat ${activeTab === "chat" ? "is-visible" : ""}`}>
         <div className="meeting-chat-heading"><div><h2>会议讨论</h2></div><span><MessageCircle size={14} /> {messages.length} 条消息</span></div>
         <div className="meeting-timeline">{messages.map((message) => <Fragment key={message.id}><MessageRow message={message} state={state} readOnly={!canInteract} onViewProposal={openProposal} onReanalyze={canInteract ? (source) => {
           const task = Object.values(state.tasks).find((item) => source.content.includes(item.title))
           void send(`@风险与依赖 如果${task ? ` #${task.id.toUpperCase()}` : "当前任务"}晚一天，会影响哪些后续工作？`)
         } : undefined} />{canInteract && materialMoment?.messageId === message.id && (materialMoment.expanded && !busyAgent || materialBusy ? <MaterialSuggestions key={message.id} state={state} sessionId={sessionId} showAssets={false} focusKeys={materialMoment.keys} reason={materialMoment.reason} onMaterials={openMaterials} onBusyChange={setMaterialBusy} /> : <div className="meeting-material-reminder"><Sparkles size={14} /><span>这段讨论的成果建议已保留</span><button type="button" disabled={working} onClick={openMaterials}>查看建议 →</button></div>)}</Fragment>)}
          {busyAgent && <div className="meeting-typing" role="status">{busyMemberId ? <MemberAvatar memberId={busyMemberId} size={28} /> : <AgentAvatar id={busyAgent} size={28} />}<span><strong>{busyMemberId ? state.members[busyMemberId]?.name : agentName(busyAgent)}</strong>{busyAgent === "material_organizer" ? "正在整理成果，新图形设计可能需要稍等一会儿" : "正在结合项目记录思考回复"}<span className="meeting-typing-dots">...</span></span></div>}
          <div ref={timelineEnd} />
        </div>
        {canInteract ? <div className="meeting-composer">
          {error && <div className="meeting-compose-error" role="alert">{error}{retryText && <button type="button" disabled={Boolean(busyAgent)} onClick={() => void send(retryText)}>重试本条消息</button>}<button type="button" onClick={() => setError("")} title="关闭提示"><X size={13} /></button></div>}
          {pickerOpen && pickerOptions.length > 0 && <div className="meeting-agent-picker" role="listbox" aria-label="邀请助手或成员">
            <div className="meeting-picker-title">专业助手</div>
            {pickerOptions.map((option, index) => <div key={`${option.kind}-${option.item.id}`}>
              {option.kind === "member" && pickerOptions[index - 1]?.kind !== "member" && <div className="meeting-picker-title">项目成员 · AI 模拟回应</div>}
              <button type="button" role="option" aria-selected={index === pickerIndex} className={index === pickerIndex ? "is-active" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseMention(option)}>{option.kind === "agent" ? <AgentAvatar id={option.item.id} size={30} /> : <MemberAvatar memberId={option.item.id} size={30} />}<span><strong>{option.item.name}{option.kind === "agent" && option.item.id === "auto" ? " · @AI" : ""}</strong><small>{option.kind === "agent" ? option.item.description : option.item.role}</small>{option.kind === "agent" && <em>{option.item.prompts[0]}</em>}</span></button>
            </div>)}
          </div>}
          {entityPickerOpen && entityOptions.length > 0 && <div className="meeting-agent-picker" role="listbox" aria-label="引用项目对象"><div className="meeting-picker-title">引用项目对象</div>{entityOptions.map((item, index) => {
            const status = item.type === "task" ? state.tasks[item.id]?.status : item.type === "sprint" ? state.sprints[item.id]?.status : item.type === "risk" ? state.risks[item.id]?.status : state.stories[item.id]?.deliveryStatus
            return <button key={`${item.type}-${item.id}`} type="button" role="option" aria-selected={index === pickerIndex} className={index === pickerIndex ? "is-active" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseEntity(item)}><span className="meeting-entity-icon">#</span><span><strong>{item.id.toUpperCase()} · {item.label}</strong><small>{({ story: "Story", task: "任务", sprint: "Sprint", risk: "风险" } as const)[item.type]} · {entityStatusLabels[status ?? ""] ?? "待确认"}</small></span></button>
          })}</div>}
          {speech.error && <div className="meeting-compose-error" role="alert">{speech.error}<button type="button" onClick={speech.clearError} title="关闭提示"><X size={13} /></button></div>}
          {listening && <div className="meeting-voice-caption" aria-live="polite"><i /><strong>{state.members[speakerId]?.name ?? "发言人"}</strong><span>{speech.interim || "正在聆听，说话内容会自动记入会议…"}</span></div>}
          <div className="meeting-composer-top"><span><Sparkles size={14} /> @ 邀请助手或成员 · # 引用项目工作</span><div className="meeting-composer-tools">{speech.supported && <button type="button" className={`meeting-voice-toggle ${listening ? "is-active" : ""}`} aria-pressed={listening} title={listening ? "停止语音记录" : "开始语音记录：说话内容自动转为会议发言"} onClick={() => listening ? speech.stop() : speech.start()}>{listening ? <MicOff size={13} /> : <Mic size={13} />}{listening ? "停止语音" : "语音发言"}</button>}<label>以 <select aria-label="发言成员" value={speakerId} onChange={(event) => setSpeakerId(event.target.value)}>{Object.values(state.members).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select> 发言</label></div></div>
          <div className="meeting-composer-field"><textarea ref={composerRef} aria-label="会议消息" placeholder={session.status === "active" ? "随时 @ 助手或成员；@材料整理 可生成图表、Word 和 Excel…" : "会议已结束，可查看历史记录"} disabled={!canInteract || working} value={draft} onSelect={(event) => setCursor(event.currentTarget.selectionStart)} onChange={(event) => { setDraft(event.target.value); setCursor(event.target.selectionStart); setPickerDismissed(false); setPickerIndex(0) }} onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            const options = pickerOpen ? pickerOptions : entityPickerOpen ? entityOptions : []
            if (options.length) {
              if (event.key === "ArrowDown") { event.preventDefault(); setPickerIndex((pickerIndex + 1) % options.length); return }
              if (event.key === "ArrowUp") { event.preventDefault(); setPickerIndex((pickerIndex - 1 + options.length) % options.length); return }
              if (event.key === "Enter") { event.preventDefault(); if (pickerOpen) chooseMention(pickerOptions[pickerIndex]); else chooseEntity(entityOptions[pickerIndex]); return }
              if (event.key === "Escape") { event.preventDefault(); setPickerDismissed(true); return }
            }
            if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send() }
          }} /><button type="button" disabled={!draft.trim() || working || !canInteract} onClick={() => void send()} title="发送消息"><Send size={17} /></button></div>
        </div> : <div className="meeting-history-notice"><Clock3 size={14} /><span>{session.status === "ended" ? "会议已结束，讨论、决策与成果已保留。" : "正在查看历史记录，继续会议后才能发言或审核。"}</span></div>}
      </main>
      {rightOpen && <PanelResizeHandle side="right" width={rightWidth} max={Math.max(240, Math.min(520, layoutWidth - leftWidth - 416))} onResize={width => resizePanel("right", width)} onDragging={setResizing} />}
       <div className={`meeting-pane meeting-pane--decisions ${activeTab === "decisions" ? "is-visible" : ""}`}>{rightOpen ? <DecisionPanel key={sessionId + viewMode} readOnly={!canInteract || working} state={state} sessionId={sessionId} focusedProposalId={focusedProposalId} onApply={applyAccepted} onError={setError} onLocateMessage={locateProposalMessage} onToggle={() => setRightOpen(false)} /> : <button type="button" className="meeting-side-rail" title="展开决策区" aria-label="展开决策区" onClick={() => setRightOpen(true)}><PanelRightOpen size={16} /></button>}</div>
     </div>}
    {detailSession && <PlanningMeetingDialog open={detailOpen} targetType={detailSession.targetType as "story" | "sprint"} targetId={detailSession.targetId} selectedProposalId={detailProposalId} detailOnly onClose={() => setDetailOpen(false)} />}
  </div>
}
