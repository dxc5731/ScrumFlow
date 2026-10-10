import { useEffect, useState } from "react"
import {
  AlertTriangle,
  CircleAlert,
  ClipboardCheck,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Target,
  Users,
} from "lucide-react"
import {
  detectProjectEvents,
  type DetectedEvent,
  type EventKind,
} from "../../utils/eventDetection"
import { explainEvent, type EventExplanation } from "../../utils/eventExplanation"
import type { ProposalEvidence } from "../../types"
import { selectStoryTasks } from "../../store/selectors"
import { proposalStatusLabel } from "../../store/selectors"
import {
  useProjectStore,
  type ProposalActionInput,
} from "../../store/projectStore"
import type { AgentType } from "../../types"
import { notify } from "./ui"
import { eventCondition, matchesEventProposal } from "../../utils/eventLifecycle"

type InsightTarget =
  | { type: "task"; id: string }
  | { type: "story"; id: string }
  | { type: "sprint"; id: string }

const kindMeta: Record<
  EventKind,
  { label: string; icon: typeof CircleAlert; color: string; bg: string; agent: AgentType }
> = {
  deadline: { label: "期限风险", icon: CircleAlert, color: "#B54708", bg: "#FFFAEB", agent: "project_monitor" },
  dependency: { label: "阻塞与依赖", icon: ShieldAlert, color: "#B42318", bg: "#FEF3F2", agent: "risk_dependency" },
  workload: { label: "成员负载", icon: Users, color: "#6941C6", bg: "#F4F3FF", agent: "workload_capacity" },
  scope: { label: "范围容量", icon: Target, color: "#175CD3", bg: "#EFF8FF", agent: "plan_execution" },
  artifact: { label: "成果提交", icon: AlertTriangle, color: "#B54708", bg: "#FFFAEB", agent: "project_monitor" },
  acceptance: { label: "验收准备", icon: ClipboardCheck, color: "#5925DC", bg: "#F4F3FF", agent: "project_monitor" },
}

const severityMeta: Record<DetectedEvent["severity"], { label: string; color: string }> = {
  high: { label: "高", color: "#B42318" },
  medium: { label: "中", color: "#B54708" },
  low: { label: "低", color: "#067647" },
}

/** 检测事件的字符串证据转成契约规定的结构化证据。 */
function toProposalEvidence(event: DetectedEvent, agent: AgentType): ProposalEvidence[] {
  return [...event.evidence, `触发规则：${event.rule}`].map((detail) => ({
    agentType: agent,
    targetType: event.targetType,
    targetId: event.targetId,
    detail,
  }))
}

/** 把一条检测事件翻译成一条可审批的 ProposalAction。 */
function buildAction(event: DetectedEvent): ProposalActionInput {
  const state = useProjectStore.getState()
  const task = state.tasks[event.targetId]
  const sprintId = event.sprintId ?? state.workspace.selectedSprintId

  if (event.kind === "dependency" && task) {
    return {
      actionType: "BLOCK_TASK",
      targetType: "task",
      targetId: task.id,
      reason: event.suggestedAction,
      beforeValue: task.status,
      proposedValue: {
        taskId: task.id,
        message: event.summary,
        relatedTaskId: event.relatedIds.find(id => state.tasks[id]) ?? null,
      },
      preconditions: [
        { targetType: "task", targetId: task.id, field: "status", expectedValue: task.status },
      ],
    }
  }

  if (event.kind === "deadline" && task) {
    return {
      actionType: "CREATE_RISK",
      targetType: "task",
      targetId: task.id,
      reason: event.suggestedAction,
      beforeValue: task.status,
      proposedValue: {
        title: event.title,
        targetType: "task",
        targetId: task.id,
        level: event.severity === "high" ? "high" : "medium",
        description: event.summary,
        impact: event.suggestedAction,
        mitigation: "由负责人确认剩余工作并更新排期。",
        ownerId: task.assigneeId,
        status: "open",
      },
      preconditions: [
        { targetType: "task", targetId: task.id, field: "status", expectedValue: task.status },
      ],
    }
  }

  if (event.kind === "artifact" && task) {
    return {
      actionType: "CREATE_DISCUSSION",
      targetType: "task",
      targetId: task.id,
      reason: event.suggestedAction,
      beforeValue: task.status,
      proposedValue: {
        targetType: "task",
        targetId: task.id,
        content: `【AI 提醒】${event.summary}${event.suggestedAction}`,
      },
      preconditions: [
        { targetType: "task", targetId: task.id, field: "status", expectedValue: task.status },
      ],
    }
  }

  if (event.kind === "acceptance") {
    const story = state.stories[event.targetId]
    return {
      actionType: "CREATE_DISCUSSION",
      targetType: "story",
      targetId: event.targetId,
      reason: event.suggestedAction,
      proposedValue: {
        targetType: "story",
        targetId: event.targetId,
        content: `【AI 提醒】${event.summary}${event.suggestedAction}`,
      },
      preconditions: story
        ? [{ targetType: "story", targetId: story.id, field: "maturityStatus", expectedValue: story.maturityStatus }]
        : [],
    }
  }

  return {
    actionType: "CREATE_RISK",
    targetType: "sprint",
    targetId: sprintId,
    reason: event.suggestedAction,
    proposedValue: {
      title: event.title,
      targetType: "sprint",
      targetId: sprintId,
      level: event.severity === "high" ? "high" : "medium",
      description: event.summary,
      impact: event.suggestedAction,
      mitigation: "评估转派、拆分任务或调整本轮 Sprint 范围。",
      ownerId: state.workspace.currentUserId,
      status: "open",
    },
    preconditions: [
      { targetType: "sprint", targetId: sprintId, field: "status", expectedValue: state.sprints[sprintId]?.status },
    ],
  }
}

export function buildEventAction(event: DetectedEvent): ProposalActionInput {
  const state = useProjectStore.getState()
  const action = buildAction(event)
  return { ...action, preconditions: [...(action.preconditions ?? []), eventCondition(state, event, event.sprintId ?? state.workspace.selectedSprintId)] }
}

function relatedTaskIds(
  state: ReturnType<typeof useProjectStore.getState>,
  target: InsightTarget,
): Set<string> {
  if (target.type === "task") return new Set([target.id])
  if (target.type === "story") {
    return new Set(selectStoryTasks(state, target.id).map((task) => task.id))
  }
  return new Set()
}

/**
 * 按需调用的事件型 Agent 入口。
 * 只生成 Proposal，不直接修改项目数据；由用户在面板内逐条采纳后执行。
 */
export default function EventInsightPanel({
  target,
  compact = false,
}: {
  target: InsightTarget
  compact?: boolean
}) {
  const proposals = useProjectStore((state) => state.proposals)
  const createProposal = useProjectStore((state) => state.createProposal)
  const setDecision = useProjectStore((state) => state.setProposalActionDecision)
  const applyProposal = useProjectStore((state) => state.applyProposal)
  const rejectProposal = useProjectStore((state) => state.rejectProposal)
  const records = useProjectStore(state => state.projectEvents)
  const stories = useProjectStore(state => state.stories)
  const tasks = useProjectStore(state => state.tasks)
  const selectedSprintId = useProjectStore(state => state.workspace.selectedSprintId)
  const sprintId = target.type === "sprint" ? target.id : target.type === "story" ? stories[target.id]?.sprintId ?? selectedSprintId
    : stories[tasks[target.id]?.storyId]?.sprintId ?? selectedSprintId

  const [events, setEvents] = useState<DetectedEvent[] | null>(null)
  const [proposalIdByEvent, setProposalIdByEvent] = useState<Record<string, string>>({})
  const [explanations, setExplanations] = useState<Record<string, EventExplanation>>({})
  const [explaining, setExplaining] = useState<Record<string, boolean>>({})
  const [modelStatus, setModelStatus] = useState<"idle" | "ok" | "unavailable">("idle")
  const [hasScanned, setHasScanned] = useState(false)

  useEffect(() => {
    const snapshot = useProjectStore.getState()
    const taskIds = relatedTaskIds(snapshot, target)
    const scoped = Object.values(records).filter(record => record.sprintId === sprintId && (target.type === "sprint" ||
      record.event.kind !== "scope" && (record.event.targetId === target.id || taskIds.has(record.event.targetId) ||
        record.event.relatedIds.some(id => id === target.id || taskIds.has(id)))))
    if (scoped.length || hasScanned) {
      setEvents(scoped.map(record => record.event))
      setProposalIdByEvent(Object.fromEntries(scoped.filter(record => record.proposalId).map(record => [record.event.id, record.proposalId!])))
    }
  }, [records, sprintId, target.type, target.id, hasScanned])

  const runScan = () => {
    const snapshot = useProjectStore.getState()
    snapshot.refreshProjectEvents()
    setHasScanned(true)
    const all = detectProjectEvents(snapshot, sprintId, new Date())
    let scoped = all
    if (target.type === "task") {
      scoped = all.filter(
        (event) =>
          event.kind !== "scope" &&
          (event.targetId === target.id || event.relatedIds.includes(target.id)),
      )
    } else if (target.type === "story") {
      const taskIds = relatedTaskIds(snapshot, target)
      scoped = all.filter(
        (event) =>
          event.kind !== "scope" &&
          (event.targetId === target.id ||
            taskIds.has(event.targetId) ||
            event.relatedIds.some((id) => taskIds.has(id) || id === target.id)),
      )
    }
    const existing = Object.values(snapshot.proposals)
      .filter((proposal) => proposal.origin === "event")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const linked: Record<string, string> = {}
    scoped.forEach((event) => {
      const match = existing.find(
        (proposal) => matchesEventProposal(proposal, event, snapshot),
      )
      if (match) linked[event.id] = match.id
    })
    setEvents(scoped)
    setProposalIdByEvent(linked)
    setExplanations({})
    setExplaining({})
    setModelStatus("idle")
    notify(
      scoped.length ? `AI 分析完成，发现 ${scoped.length} 条事件` : "AI 分析完成，未发现问题",
      scoped.length ? "info" : "success",
    )
  }

  const requestExplanation = async (event: DetectedEvent) => {
    if (explaining[event.id] || explanations[event.id]) return
    setExplaining((current) => ({ ...current, [event.id]: true }))
    const result = await explainEvent(event)
    setExplaining((current) => ({ ...current, [event.id]: false }))
    if (result) {
      setExplanations((current) => ({ ...current, [event.id]: result }))
      setModelStatus("ok")
    } else {
      setModelStatus("unavailable")
    }
  }

  const createFromEvent = (event: DetectedEvent) => {
    const existing = Object.values(useProjectStore.getState().proposals).find(
      (proposal) =>
        matchesEventProposal(proposal, event, useProjectStore.getState()) &&
        proposal.status !== "rejected",
    )
    if (existing) {
      setProposalIdByEvent((current) => ({ ...current, [event.id]: existing.id }))
      notify("该事件已有待处理建议", "info")
      return
    }
    const proposal = createProposal({
      origin: "event",
      triggerType: "manual",
      agentType: kindMeta[event.kind].agent,
      targetType: event.targetType,
      targetId: event.targetId,
      summary: event.title,
      reasoning: event.summary,
      evidence: toProposalEvidence(event, kindMeta[event.kind].agent),
      actions: [buildEventAction(event)],
    })
    setProposalIdByEvent((current) => ({ ...current, [event.id]: proposal.id }))
    useProjectStore.getState().refreshProjectEvents()
    notify("已生成待确认建议", "info")
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#344054]">
          <Sparkles size={12} className="text-[#6941C6]" />
          AI 事件分析
        </div>
        <button className="secondary-button" onClick={runScan}>
          <RefreshCw size={11} />
          {hasScanned ? "重新分析" : "分析"}
        </button>
      </div>

      {events === null && (
        <p className="text-[10px] leading-5 text-[#98A2B3]">
          需要时调用事件型 Agent 检测期限、依赖、负载和范围问题。建议先进入待确认区，人工采纳后才写回项目。
        </p>
      )}

      {events !== null && !events.length && (
        <div className="rounded-md border border-dashed border-[#E2E7EE] bg-[#F9FAFB] px-3 py-2 text-[10px] text-[#667085]">
          当前上下文没有检测到事件。
        </div>
      )}

      {events !== null &&
        events.map((event) => {
          const meta = kindMeta[event.kind]
          const Icon = meta.icon
          const proposalId = proposalIdByEvent[event.id]
          const proposal = proposalId ? proposals[proposalId] : undefined
          const record = records[`${sprintId}:${event.id}`]
          const inactive = record?.status === "resolved" || record?.status === "ignored"

          return (
            <div key={event.id} className="rounded-lg border border-[#E2E7EE] bg-white p-3">
              <div className="flex items-start gap-2">
                <span
                  className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md"
                  style={{ background: meta.bg, color: meta.color }}
                >
                  <Icon size={12} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-[#172033]">{event.title}</span>
                    {record && <span className="text-[9px] text-[#667085]">{{ new: "新发现", pending: "待处理", suggested: "已生成建议 · 问题未解决", resolved: "已解决", ignored: "已忽略" }[record.status]}</span>}
                    <span
                      className="rounded px-1.5 py-0.5 text-[9px] font-semibold"
                      style={{ color: severityMeta[event.severity].color, background: "#F9FAFB" }}
                    >
                      {severityMeta[event.severity].label}风险
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] leading-5 text-[#475467]">{event.summary}</p>
                  {record?.status === "resolved" && <p className="text-[9px] text-[#667085]">以下为最后一次发现时的依据；当前检测条件已消失。</p>}
                  {!compact && (
                    <ul className="mt-1.5 space-y-0.5">
                      {event.evidence.map((item) => (
                        <li key={item} className="text-[10px] text-[#98A2B3]">
                          · {item}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-1.5 text-[10px] text-[#6941C6]">处置方向：{event.suggestedAction}</p>
                  {explaining[event.id] && (
                    <p className="mt-1.5 text-[10px] text-[#98A2B3]">AI 解读生成中…</p>
                  )}
                  {explanations[event.id]?.summary && (
                    <div className="mt-1.5 rounded-md bg-[#F8FAFF] p-2">
                      <div className="text-[10px] font-semibold text-[#344054]">AI 解读</div>
                      <p className="mt-0.5 whitespace-pre-line text-[10px] leading-5 text-[#475467]">
                        {explanations[event.id].summary}
                      </p>
                      {!!(explanations[event.id].impact || explanations[event.id].suggestion) && (
                        <p className="mt-0.5 whitespace-pre-line text-[10px] leading-5 text-[#475467]">
                          {[explanations[event.id].impact, explanations[event.id].suggestion]
                            .filter(Boolean)
                            .join("\n")}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {!proposal && !inactive && (
                <div className="mt-2">
                  <button className="primary-button" onClick={() => { void requestExplanation(event); createFromEvent(event) }}>
                    生成建议
                  </button>
                  <button className="secondary-button ml-2" onClick={() => useProjectStore.getState().ignoreProjectEvent(`${sprintId}:${event.id}`)}>忽略事件</button>
                </div>
              )}

              {proposal && (
                <div className="mt-2 rounded-md border border-[#E9D7FE] bg-[#FCFAFF] p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-[#6941C6]">
                      待确认建议 · {proposalStatusLabel(proposal)}
                    </span>
                    <span className="text-[9px] text-[#98A2B3]">
                      {proposal.actions.filter((action) => action.decision === "accepted").length}/
                      {proposal.actions.length} 已采纳
                    </span>
                  </div>
                  {proposal.actions.map((action) => (
                    <div key={action.id} className="mt-2 flex items-start gap-2">
                      <button
                        className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 rounded border"
                        style={{
                          borderColor: action.decision === "accepted" ? "#6941C6" : "#D0D5DD",
                          background: action.decision === "accepted" ? "#6941C6" : "white",
                        }}
                        title={action.decision === "accepted" ? "取消采纳" : "采纳"}
                        onClick={() =>
                          setDecision(
                            proposal.id,
                            action.id,
                            action.decision === "accepted" ? "pending" : "accepted",
                          )
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-medium text-[#344054]">
                          {action.actionType} · {action.targetType}
                          {action.targetId ? `:${action.targetId}` : ""}
                        </div>
                        <div className="text-[9px] text-[#98A2B3]">{action.reason}</div>
                        {action.status !== "pending" && (
                          <div
                            className="mt-0.5 text-[9px]"
                            style={{ color: action.status === "applied" ? "#067647" : "#B42318" }}
                          >
                            {action.executionOutcome === "existing" ? "复用已有结果，未重复写入" : action.status}
                            {action.error ? ` · ${action.error}` : ""}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {proposal.status !== "applied" && proposal.status !== "rejected" && (
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        className="primary-button"
                        onClick={() => {
                          const result = applyProposal(proposal.id)
                          notify(result.message, result.ok ? "success" : "error")
                        }}
                      >
                        执行
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() => {
                          rejectProposal(proposal.id, "在事件面板中忽略")
                          useProjectStore.getState().ignoreProjectEvent(`${sprintId}:${event.id}`)
                          notify("建议已忽略", "info")
                        }}
                      >
                        忽略
                      </button>
                    </div>
                  )}
                  {proposal.status === "applied" && (
                    <div className="mt-1.5 text-[10px] font-medium text-[#067647]">已写回项目</div>
                  )}
                  {proposal.status === "rejected" && (
                    <div className="mt-1.5 text-[10px] font-medium text-[#667085]">已忽略</div>
                  )}
                  {proposal.status === "failed" && (
                    <div className="mt-1.5 text-[10px] font-medium text-[#B42318]">
                      {proposalStatusLabel(proposal)}：{proposal.applyError || "没有动作执行成功"}
                    </div>
                  )}
                  {proposal.status === "partially_applied" && (
                    <div className="mt-1.5 text-[10px] font-medium text-[#B54708]">
                      部分执行：{proposal.applyError}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
    </div>
  )
}
