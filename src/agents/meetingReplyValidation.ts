import type { MeetingContext, ProjectDataState } from "../types"

/** Check explicit allocations, including Markdown tables, against the current hard constraints. */
export function replyViolatesAssignments(content: string, context: MeetingContext, state: ProjectDataState): boolean {
  const planning = context.activePlan && ["plan", "select", "execute", "workload"].includes(context.currentTopic)
  if (!planning || context.activePlan?.feasible === false) return false
  const allocated = new Set<string>()
  const members = Object.values(state.members)
  let assigneeColumn = -1
  for (const raw of content.split("\n")) {
    const line = raw.replace(/\*\*|__/g, "").trim()
    if (line.startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map(cell => cell.trim())
      const header = cells.findIndex(cell => /负责人|成员|参与人/.test(cell) && !/原|旧|之前/.test(cell))
      if (header >= 0) { assigneeColumn = header; continue }
      if (cells.some(cell => /原负责人|旧负责人/.test(cell))) { assigneeColumn = -1; continue }
      if (assigneeColumn >= 0) {
        for (const member of members) if (cells[assigneeColumn]?.includes(member.name)) allocated.add(member.id)
      }
      continue
    }
    assigneeColumn = -1
    for (const member of members) {
      const clause = line.split(/。|；/).find(part => part.includes(member.name))
      if (!clause || /排除|不能|不参与|不再|不可用|缺席|不安排|不分配|不包含|原负责|原方案|之前|此前|历史|现有记录|当前记录|候选|可选|可分配成员|可在.*中/.test(clause)) continue
      const tail = clause.slice(clause.indexOf(member.name) + member.name.length)
      if (/^\s*[:：]\s*0\s*(?:h|小时)\b/i.test(tail)) continue
      if (/负责|承担|分配|交给|安排|投入/.test(clause) || /^\s*[:：].*\d+\s*(?:h|小时)/i.test(tail)) allocated.add(member.id)
    }
  }
  if ([...allocated].some(id => context.constraints.excludedMemberIds.includes(id))) return true
  const allowed = context.constraints.allowedMemberIds
  if (allowed.length && [...allocated].some(id => !allowed.includes(id))) return true
  const limits = [context.constraints.maxPeople, context.constraints.requiredPeople].filter((value): value is number => typeof value === "number" && value > 0)
  return limits.length > 0 && allocated.size > Math.min(...limits)
}
