import { useState } from "react"
import { Bot, Check, CircleAlert, Play, X } from "lucide-react"
import { runPlanningMeeting, type MeetingStage } from "../../agents/meeting"
import { useProjectStore } from "../../store/projectStore"
import type { ProposalAction } from "../../types"
import Modal from "./Modal"

const statusNames = {
  draft: "待审核", reviewed: "已审核", applying: "执行中", applied: "已应用",
  partially_applied: "部分应用", rejected: "已驳回", failed: "执行失败",
}

const actionNames: Record<ProposalAction["actionType"], string> = {
  CREATE_TASK: "创建 Task", CREATE_SUBTASK: "创建 Subtask", UPDATE_TASK: "调整 Task",
  UPDATE_SUBTASK: "调整 Subtask", UPDATE_STORY: "调整 Story", CREATE_RISK: "创建 Risk",
  UPDATE_RISK: "调整 Risk", ADD_DEPENDENCY: "添加依赖",
  CREATE_DISCUSSION: "发起讨论", BLOCK_TASK: "标记阻塞", REMOVE_DEPENDENCY: "移除依赖",
  UPDATE_DEADLINE: "调整截止日期", CHANGE_ASSIGNEE: "变更负责人", CHANGE_PRIORITY: "变更优先级",
}

function showValue(value: unknown) {
  return value === null ? "无" : JSON.stringify(value, null, 2)
}

export default function PlanningMeetingDialog({
  open, targetType, targetId, onClose, detailOnly = false, selectedProposalId,
}: { open: boolean; targetType: "story" | "sprint"; targetId: string; onClose: () => void; detailOnly?: boolean; selectedProposalId?: string | null }) {
  const state = useProjectStore()
  const [proposalId, setProposalId] = useState<string | null>(null)
  const [stages, setStages] = useState<MeetingStage[]>([])
  const [message, setMessage] = useState("")
  const [reviewNote, setReviewNote] = useState("")
  const proposals = Object.values(state.proposals)
    .filter((item) => item.targetType === targetType && item.targetId === targetId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const activeProposalId = selectedProposalId ?? proposalId
  const proposal = activeProposalId ? proposals.find((item) => item.id === activeProposalId) ?? proposals[0] : proposals[0]
  const editable = !detailOnly && proposal && (proposal.status === "draft" || proposal.status === "reviewed")
  const acceptedCount = proposal?.actions.filter((item) => item.decision === "accepted").length ?? 0
  const visibleStages = detailOnly && open ? runPlanningMeeting(state, targetType, targetId).stages : stages

  const start = () => {
    try {
      const result = runPlanningMeeting(useProjectStore.getState(), targetType, targetId)
      const saved = state.saveProposal(result.proposal)
      if (!saved.ok) return setMessage(saved.message)
      setProposalId(result.proposal.id)
      setStages(result.stages)
      setMessage("会议分析完成，建议等待审核")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "会议分析失败")
    }
  }

  const decideAll = (decision: ProposalAction["decision"]) => {
    if (!proposal) return
    for (const item of proposal.actions) state.setProposalDecision(proposal.id, item.id, decision)
  }

  const updateField = (action: ProposalAction, field: string, value: unknown) => {
    if (!proposal) return
    const result = state.updateProposalValue(proposal.id, action.id, { ...action.proposedValue, [field]: value })
    setMessage(result.ok ? "人工修改已保存" : result.message)
  }

  const apply = () => {
    if (!proposal) return
    const result = state.applyProposal(proposal.id, reviewNote)
    setMessage(result.message)
  }

  return (
    <Modal open={open} onClose={onClose} width={980} title={detailOnly ? "完整 Agent 分析" : "AI Story 规划与风险分析会议"}
      description={detailOnly ? "专业分析依据与行动项原始数据" : "分析结果写入 Proposal；审核后才会通过项目 Action 修改计划。"}
      footer={<>
        {!detailOnly && message && <span className="mr-auto text-[11px] text-[#475467]" role="status">{message}</span>}
        {editable && proposal && <>
          <button className="secondary-button" onClick={() => decideAll("accepted")}><Check size={13} /> 全部采纳</button>
          <button className="secondary-button" onClick={() => { state.rejectProposal(proposal.id, reviewNote); setMessage("Proposal 已驳回") }}><X size={13} /> 全部驳回</button>
          <button className="primary-button" disabled={!acceptedCount} onClick={apply}><Play size={13} /> 应用已采纳建议</button>
        </>}
        <button className="secondary-button" onClick={onClose}>关闭</button>
      </>}
    >
      <div className="space-y-5 text-xs text-[#344054]">
        <div className="flex flex-wrap items-center gap-2">
          {!detailOnly && <button className="primary-button" onClick={start}><Bot size={13} /> 发起新会议</button>}
          {!detailOnly && proposals.length > 0 && <label className="ml-auto flex items-center gap-2 whitespace-nowrap text-[11px] text-[#667085]">
            会议记录
            <select className="form-input max-w-[240px]" value={proposal?.id ?? ""} onChange={(event) => { setProposalId(event.target.value); setStages([]); setMessage("") }}>
              {proposals.map((item) => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString("zh-CN")} · {statusNames[item.status]}</option>)}
            </select>
          </label>}
        </div>

        {visibleStages.length > 0 && <section aria-label="会议分析模块" className="grid gap-2 md:grid-cols-2">
          {visibleStages.map((stage, index) => <div key={`${stage.agentType}-${index}`} className="rounded border border-[#E2E7EE] bg-[#F8FAFC] p-3">
            <div className="mb-1 font-semibold text-[#172033]">{stage.title}</div>
            {stage.findings.map((finding, itemIndex) => <p key={itemIndex} className="mt-1 leading-relaxed text-[#667085]">{finding}</p>)}
          </div>)}
        </section>}

        {proposal && <>
          <section className="border-b border-[#EAECF0] pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-[#172033]">{proposal.summary}</h3>
              <span className="rounded bg-[#EFF8FF] px-2 py-0.5 text-[10px] text-[#175CD3]">{statusNames[proposal.status]}</span>
              <span className="break-all font-mono text-[10px] text-[#98A2B3]">{proposal.id}</span>
            </div>
            <p className="mt-2 leading-relaxed text-[#475467]">{proposal.reasoning}</p>
            <div className="mt-3 text-[11px] font-semibold">依据</div>
            <ul className="mt-1 max-h-36 space-y-1 overflow-y-auto text-[11px] text-[#667085]">
              {proposal.evidence.map((evidence, index) => <li key={index}>{evidence.agentType} · {evidence.targetType} {evidence.targetId}：{evidence.detail}</li>)}
            </ul>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-[#172033]">建议动作 · {proposal.actions.length}</h3>
              <span className="text-[11px] text-[#667085]">已采纳 {acceptedCount} 条</span>
            </div>
            {proposal.actions.length === 0 && <p className="py-6 text-center text-[#667085]">当前计划没有新增建议</p>}
            <div className="space-y-3">
              {proposal.actions.map((action) => <div key={action.id} className="rounded border border-[#E2E7EE] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-[#172033]">{actionNames[action.actionType]}</strong>
                  <span className="break-all font-mono text-[10px] text-[#667085]">{action.targetType} · {action.targetId}</span>
                  <span className="ml-auto text-[10px] text-[#667085]">{action.status === "pending" ? action.decision : action.status}</span>
                </div>
                <p className="mt-1 text-[11px] text-[#475467]">{action.reason}</p>
                {action.dependsOnActionIds.length > 0 && <p className="mt-1 break-all text-[10px] text-[#667085]">依赖 Action：{action.dependsOnActionIds.join(", ")}</p>}
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div><div className="mb-1 text-[10px] font-semibold text-[#667085]">修改前</div><pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-[#F8FAFC] p-2 text-[10px]">{showValue(action.beforeValue)}</pre></div>
                  <div><div className="mb-1 text-[10px] font-semibold text-[#667085]">建议值</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {Object.entries(action.proposedValue).map(([field, value]) => <ProposalField key={field} field={field} value={value} editable={Boolean(editable)} members={state.members} onChange={(next) => updateField(action, field, next)} />)}
                    </div>
                  </div>
                </div>
                {editable && <div className="mt-3 flex gap-2">
                  <button className="secondary-button" data-active={action.decision === "accepted"} onClick={() => state.setProposalDecision(proposal.id, action.id, "accepted")}><Check size={12} /> 采纳</button>
                  <button className="secondary-button" data-active={action.decision === "rejected"} onClick={() => state.setProposalDecision(proposal.id, action.id, "rejected")}><X size={12} /> 驳回</button>
                </div>}
                {action.status !== "pending" && <p className={`mt-2 flex items-center gap-1 text-[11px] ${action.status === "applied" ? "text-[#067647]" : "text-[#B42318]"}`}>
                  {action.status === "applied" ? <Check size={12} /> : <CircleAlert size={12} />}
                  {action.status === "applied" ? `已写入项目 ${action.resultTargetId ?? ""}` : `${action.status}: ${action.error}`}
                </p>}
              </div>)}
            </div>
          </section>
          {editable && <label className="block text-[11px] font-semibold text-[#667085]">审核备注
            <textarea className="form-input mt-1 min-h-16 font-normal" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} />
          </label>}
          {!editable && proposal.applyError && <p className="break-all rounded border border-[#FDA29B] bg-[#FFFBFA] p-3 text-[#B42318]">{proposal.applyError}</p>}
          {!editable && proposal.status !== "rejected" && <p className="text-[11px] text-[#667085]">相关项目修改已写入 ChangeHistory，并可通过 Proposal ID 反查。</p>}
        </>}
      </div>
    </Modal>
  )
}

function ProposalField({ field, value, editable, members, onChange }: {
  field: string; value: unknown; editable: boolean; members: Record<string, { name: string }>;
  onChange: (value: unknown) => void
}) {
  const fixed = ["targetType", "targetId", "sourceTaskId", "targetTaskId"].includes(field)
  const choices = field === "assigneeId" || field === "ownerId" ? Object.entries(members).map(([id, member]) => ({ value: id, label: member.name }))
    : field === "type" ? ["frontend", "backend", "database", "test", "design", "devops"].map((item) => ({ value: item, label: item }))
    : field === "level" || field === "risk" ? ["low", "medium", "high"].map((item) => ({ value: item, label: item }))
    : field === "status" ? ["open", "mitigating", "resolved"].map((item) => ({ value: item, label: item })) : null
  return <label className="min-w-0 text-[10px] text-[#667085]">{field}
    {choices ? <select className="form-input mt-1" value={String(value)} disabled={!editable || fixed} onChange={(event) => onChange(event.target.value)}>
      {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
    </select> : <input className="form-input mt-1" value={String(value ?? "")} disabled={!editable || fixed}
      type={typeof value === "number" ? "number" : field.endsWith("Date") ? "date" : "text"}
      min={typeof value === "number" ? 0 : undefined}
      onChange={(event) => onChange(typeof value === "number" ? Number(event.target.value) : event.target.value)} />}
  </label>
}
