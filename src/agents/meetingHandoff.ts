import type { AgentType } from "../types"
import { isMaterialRequest } from "./materialSchema"
import { analyzeMeetingRequest } from "./meetingRequest"

export function requestsPlanReview(question: string): boolean {
  const request = analyzeMeetingRequest(question)
  return !request.deniesProposal && /进入审核|提交审核|待(?:审核|确认)(?:的)?(?:项目)?(?:建议|行动)|(?:整理|生成)(?:项目)?行动|(?:按|把)[^；]*方案[^；]*执行|(?:^|[；\s])(?:请)?执行(?:吧|方案|计划|[。！!\s]|$)|整理并执行|生成执行计划|计划落地|最终方案整理|最终决定|正式变更/.test(request.commandText)
}

export function requestsPlanRevision(question: string): boolean {
  question = analyzeMeetingRequest(question).commandText
  return /(?:方案|安排|分工).{0,10}(?:改成|调整|重排)|(?:改成|换成).{0,8}[一二两三四五六七八九十\d]+个?人|重新(?:拆|规划|安排)|保留.{0,10}(?:拆分|拆解)/.test(question)
}

/** The host delegates from the current request; this classification never calls a model. */
export function meetingHandoff(question: string): AgentType | null {
  const request = analyzeMeetingRequest(question)
  if (/会议纪要|正式纪要|老师.*(?:汇报|材料)|汇报材料|成果包|行动项清单|变更摘要/.test(request.commandText) || isMaterialRequest(question)) return "material_organizer"
  if (requestsPlanReview(question)) return requestsPlanRevision(question) ? "task_decomposition" : "plan_execution"
  question = request.topicText
  if (/收尾|总结今天|决定了什么|把.*边界记|先说最值得讨论|今天.*议程/.test(question)) return null
  if (/风险|依赖|延期|阻塞|卡点/.test(question)) return "risk_dependency"
  if (/负载|容量|谁.*(?:适合|接|承担)|分给谁|接这个任务|成员分工/.test(question)) return "workload_capacity"
  if (/拆|WBS|任务分解|细化|规划.*Story/i.test(question)) return "task_decomposition"
  return null
}

export const handoffReason: Partial<Record<AgentType, string>> = {
  material_organizer: "这项交给材料整理更合适。我把当前项目和会议上下文一起带过去，让它直接准备可预览的成果。",
  task_decomposition: "我请任务拆解把工作边界和验收步骤梳理清楚，再一起确认分工。",
  risk_dependency: "我请风险与依赖检查最上游的卡点，以及它对后续工作的影响。",
  workload_capacity: "我请负载与容量结合成员手头的工作，看看谁更适合承接。",
  plan_execution: "我把刚才的方案交给计划落地，整理成待审核行动。确认后再应用到项目。",
}
