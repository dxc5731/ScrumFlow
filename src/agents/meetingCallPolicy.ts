/** Hard facts, merges and arithmetic remain code-owned. Models explain genuinely new reasoning. */
export function requiresComplexMeetingReasoning(question: string): boolean {
  return /权衡|冲突消解|综合.{0,12}(?:策略|方案)|应对|缓解|策略|优化|(?:深入|全面).{0,8}分析|最优|证明|论证/.test(question)
}
export function canComputeMeetingExplanation(intent: string, question: string): boolean {
  // Once a Plan exists, this branch can only render that Plan. Novel work is
  // generated in draft_work before this explanation branch.
  if (["plan","select","execute"].includes(intent)) return true
  return !requiresComplexMeetingReasoning(question) && ["plan", "select", "execute", "risk", "workload", "compare", "diagnose", "summary"].includes(intent)
}
export function canParseMeetingTurnLocally(question: string): boolean {
  // A novel draft still needs a model, but its explicit create command does not
  // need a second model call to classify the same intent.
  if (/新增|添加|生成.*Proposal|实际写入|确认应用/.test(question)) return true
  return !requiresComplexMeetingReasoning(question) && /只(?:读|查询|分析|回答)|状态|进度|新增|添加|生成.*(?:WBS|Proposal)|拆成|按.{0,5}人|改成.{0,5}人|最多.{0,5}人|不(?:要|参与)|别安排|只能|晚\s*[一二两\d]+\s*天|解除.*依赖|确认|按.*方案|真实数据.*假设/.test(question)
}
