import type { MeetingSession, ProjectDataState } from "../types"
import { hostChoiceLabels, hostEventLabels, meetingAuditDiff, meetingInsights } from "./meetingOutcomes"
import { formatMeetingTime, meetingTemplate } from "./meetingFacilitation"
import { meetingChartData } from "./meetingChartData"

export const reportValue = (value: unknown): string => typeof value === "string" ? value : JSON.stringify(value) ?? "暂无记录"
const cell = (value: unknown) => reportValue(value).replace(/\|/g, "／").replace(/[\r\n]+/g, "；")
const table = (head: string[], rows: unknown[][]) => rows.length ? `| ${head.join(" | ")} |\n| ${head.map(() => "---").join(" | ")} |\n${rows.map(row => `| ${row.map(cell).join(" | ")} |`).join("\n")}` : "暂无记录。"
const bullets = (items: string[], empty = "暂无记录。") => items.length ? items.map(s => `- ${s}`).join("\n") : empty
export const reportTime = (at: string) => Number.isFinite(Date.parse(at)) ? new Date(at).toLocaleString("zh-CN", { hour12: false }) : "时间暂无记录"

/** Same facts as the on-screen charts; document formats retain their full data tables. */
export function scrumMeetingReport(state: ProjectDataState, session: MeetingSession): string {
  const i = meetingInsights(state, session), f = session.facilitation
  const charts = meetingChartData(state, session)
  return `# Scrum 智能会议报告

${session.demo ? "离线演示归档：发言、主持语义事件及审核操作为预设记录。确定性分析和 Store 执行在独立沙盒完成，不代表实时模型调用，不修改正式项目。下列时间为演示时间线。" : "根据本场已保存消息、人工审批与执行审计整理。"}

## 会议与 Sprint 背景

${table(["项目 / 会议", "记录"], [
    ["项目", i.state.project.name], ["会议", `${session.title} · ${session.id}`], ["会议类型", meetingTemplate(session)?.name ?? "历史会议（未记录类型）"],
    ["开始", f?.startedAt ? reportTime(f.startedAt) : "实际开始时间暂无记录"], ["结束", session.endedAt ? reportTime(session.endedAt) : session.status === "ended" ? "结束时间暂无记录" : "会议进行中"],
    [session.demo ? "演示时间线用时" : "实际用时", i.actualMs === null ? "暂无记录" : formatMeetingTime(i.actualMs)], ["计划时长（含延期）", i.plannedMs === null ? "暂无记录" : formatMeetingTime(i.plannedMs)],
    [session.demo ? "演示超时" : "真实超时", f && i.plannedMs !== null && i.actualMs !== null ? i.clock.demo ? "演示模式，不作真实超时判断" : formatMeetingTime(f.actualOvertimeMs ?? i.clock.overtimeMs) : "暂无记录"],
    ...(i.clock.demo ? [["演示计时 ×30", `${formatMeetingTime(f?.demoElapsedMs ?? i.clock.elapsedMs)}；演示超时 ${formatMeetingTime(f?.demoOvertimeMs ?? i.clock.overtimeMs)}`]] : []),
    ["Sprint", i.sprint ? `${i.sprint.name} · ${i.sprint.startDate} 至 ${i.sprint.endDate}${i.sprintOverdue ? "（会议时计划期已过）" : ""}` : "暂无关联记录"],
    ["Sprint 目标", i.sprint?.goal ?? "暂无记录"], ["业务事实快照", session.outcomeSnapshot ? reportTime(session.outcomeSnapshot.capturedAt) : "历史会议无结束快照；项目对象仅作当前参考"],
  ])}

## 会议摘要与执行复盘

${session.narrative?.text ?? i.summary}

${session.narrative?.model && session.narrative.model !== "facts-template" ? "以上为模型解释，请结合下列确定性记录核对。" : "以上根据确定性记录组织，未生成质量或贡献评分。"}

${i.summary}

### 关键问题

${table(["真实对象", "问题", "快照状态"], i.issues.map(v => [v.id, v.title, v.status]))}

${bullets(session.minutes?.openQuestions ?? [], "没有记录其他待核实问题。")}

### 讨论共识

${bullets(session.minutes?.decisions ?? [], "没有明确记录的讨论共识；提出建议不代表通过审批。")}

## 议程推进情况

已推进 ${i.progressed}/${i.agenda.length} 项。推进表示议题已讨论或留下记录，不代表验收完成。仅对保存了议程起止的记录展示时长，不推算缺失时段。

${table(["议程", "记录状态", "原始消息"], i.agenda.map(t => [t.title, ({ pending: "未开始", active: "讨论中", discussed: "已讨论", recorded: "已记录", decided: "已决定", deferred: "已暂缓", unresolved: "待核实" })[t.status], t.createdFromMessageId || "暂无记录"]))}

${table(["议程用时（分钟）", "计划", "记录", "差额"], charts.timing.map(t => [t.label, t.planned, t.actual, t.actual - t.planned]))}

## 角色发言与决策漏斗（图表对应数据）

${table(["角色", "消息条数", "占非系统消息比例"], charts.roles.map(r => [r.label, r.count, `${charts.totalSpeech ? Math.round(r.count / charts.totalSpeech * 100) : 0}%`]))}

${table(["决策阶段", "行动项数"], charts.funnel.map(r => [r.label, r.count]))}

采纳率：${charts.acceptanceRate === null ? "暂无已审核行动" : `${charts.acceptanceRate}%（已采纳 / 已审核；待审不计分母）`}。执行为登记写回成功，不等于新增工程任务已经完成。

${table(["主持干预类型", "次数"], charts.interventions.map(r => [r.label, r.count]))}

## 成员参与分布（图表对应数据）

${table(["成员", "文本消息", "语音转写记录", "来源未记录", "合计"], i.members.map(m => [m.name, m.text, m.voice, m.unknown, m.total]))}

统计已提交的成员消息条数，排除 AI、数字员工及系统消息。转写逐句保存，不等于完整发言轮次；未推算真实发声时长或工作贡献。

## 决策与行动状态分布（图表对应数据）

${table(["指标", "条数"], [["本次产生的行动建议", i.actions.length], ["待确认", i.counts.pending], ["已采纳（包含执行成功）", i.counts.accepted], ["已采纳但未确认执行成功", i.counts.acceptedUnexecuted], ["已拒绝", i.counts.rejected], ["实际执行成功（有审计）", i.counts.executed], ["复用已有结果，未重复写入", i.counts.reused]])}

${i.linkedCount ? `另关联 ${i.linkedCount} 份外部或来源不明建议，未计入本次产生的成果。` : "所有统计仅包含明确归属本次会议的建议。"}

## AI 主持行动回顾

${table(["指标", "次数"], [["主动流程引导", i.counts.guidance], ["时间提醒", i.counts.time], ["话题纠偏", i.counts.deviation], ["返回议程 / 继续讨论 / 误判", `${i.counts.returned} / ${i.counts.continued} / ${i.counts.incorrect}`], ["发现或跟进任务阻塞（按任务去重）", i.blockerIds.length]])}

${table(["时间", "行动", "内容与依据"], i.events.flatMap(m => [
    [reportTime(m.createdAt), hostEventLabels[m.hostEvent!.kind], `${m.content}；消息 ${m.id}；依据 ${(m.hostEvent!.sourceMessageIds ?? []).join("、") || "主持流程或项目事实"}；对象 ${[...(m.hostEvent!.taskIds ?? []), ...(m.hostEvent!.riskIds ?? [])].join("、") || "无"}`],
    ...(m.hostEvent!.resolution ? [[reportTime(m.hostEvent!.resolution.at), hostChoiceLabels[m.hostEvent!.resolution.choice], `反馈于 ${m.id}`]] : []),
  ]))}

## 关键行动成果与审计

${i.actions.map(a => `### ${a.title} · ${a.targetId}

AI 建议：${a.suggestion}

依据与边界：${a.reason}

人工审核：${a.decision === "accepted" ? "已采纳" : a.decision === "rejected" ? "已拒绝" : "待确认"}；审核人 ${a.reviewer}${a.reviewedAt ? `；${reportTime(a.reviewedAt)}` : ""}。

执行状态：${a.label}${a.afterMeeting ? "（包含会后跟进写回）" : ""}${a.error ? `；${a.error}` : ""}。Proposal ${a.proposalId} / Action ${a.actionId}。

${table(["对象 / 字段", "变更前", "变更后"], a.history.flatMap(h => meetingAuditDiff(h.before, h.after, h.field).map(d => [`${h.objectId} / ${d.field}`, reportValue(d.before), reportValue(d.after)])))}

${bullets(a.history.map(h => `ChangeHistory ID：${h.id} · ${reportTime(h.createdAt)} · ${h.objectType}:${h.objectId}`), "暂无写回审计。")}

后续跟进：${a.executed || a.bucket === "rejected" ? "保留审计，按实际状态继续核查。" : `建议负责人 ${a.owner}；交付日期 ${a.deadline}。未明确确认的信息保持待确认。`}`).join("\n\n") || "本次没有明确归属的正式行动项。"}

## 下一步与 AI 主持复盘

${bullets(i.improvements, "本次没有足够记录提出具体的流程改进建议。")}

## 指标边界

统计来自原始会议消息、主持事件、Proposal 与逐行动审计。已采纳不等于执行成功；快照后的无关项目变更不计入成果。演示计时不代表真实时长；不评价成员贡献、完整会议质量或团队效率提升幅度。历史记录缺失时只展示有证据的事实。
`
}
