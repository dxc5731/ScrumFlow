export type MeetingModelMode = "interpret" | "explain" | "draft_work" | "materials" | "repair_diagram" | "meeting_summary"
export type ReasoningEffort = "none" | "low" | "high" | "max"
export interface MeetingModelRoute {
  tier: "flash" | "pro"
  effort: ReasoningEffort
  reason: string
  maxTokens: number
  timeoutMs: number
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
const string = (value: unknown) => typeof value === "string" ? value : ""
const count = (value: unknown) => Array.isArray(value) ? value.length : 0
const analysis = /分析|推演|假设|影响|优化|调整|拆解|细化|新增|添加|设计|验收边界|原因|为什么|建议|能否|可否|可行|权衡|重新|对比|比较|排期|分配|冲突|依赖链|关键路径|赶工|跨(?:\s*Sprint|迭代|项目)|最需要|优先|最严重|风险应对|来得及|能.*(?:按时|完成|交付)|怎么.*(?:排|分|做)|如何.*(?:排|分|做)|接手/i
const lookup = /状态|进度|多少|几个|几项|谁负责|哪些任务|哪些.*风险|列出|清单|剩余.*工时|完成了|超载了|会议纪要|总结刚才|你好|谢谢|连接检查|连接测试|连接成功/
const confirmation = /确认|就按|按.*方案|执行|实际写入|已经执行|已执行|审核结果|应用结果/
const deep = /全面|深入|系统性|最优|最小.*调整|全项目.*(?:优化|推演)|全套|完整.*(?:成果包|作业|报告|说明书)|交作业|可直接.*提交|评分标准|严格.*(?:证明|论证|核对)/

function constraintCount(facts: Record<string, unknown>): number {
  const constraints = object(facts.constraints)
  const limits = [constraints.maxPeople ?? constraints.requiredPeople, constraints.maxDays, constraints.maxHours]
    .filter(value => typeof value === "number" && value > 0).length
  return limits + Number(count(constraints.excludedMemberIds) > 0) + Number(count(constraints.allowedMemberIds) > 0)
    + Number(Object.keys(object(constraints.assignmentOverrides)).length > 0) + Number(constraints.lockStartedTasks === true || constraints.backendOnly === true)
}

function route(mode: MeetingModelMode, tier: "flash" | "pro", effort: ReasoningEffort, reason: string): MeetingModelRoute {
  const maxTokens = mode === "interpret" ? 500 : mode === "materials" ? effort === "max" ? 32000 : 24000
    : mode === "repair_diagram" ? tier === "pro" ? 16000 : 8000
    : effort === "max" ? 18000 : tier === "pro" ? 12000 : effort === "low" ? 6000 : 4000
  const timeoutMs = mode === "interpret" ? 20000 : mode === "materials" ? 180000
    : tier === "pro" ? 120000 : effort === "none" ? 35000 : 60000
  return { tier, effort, reason, maxTokens, timeoutMs }
}

/** First-party request mode, speaker and current question drive routing; old messages do not. */
export function routeMeetingModel(mode: MeetingModelMode, payload: unknown): MeetingModelRoute {
  const input = object(payload)
  const question = string(input.question)
  const speaker = string(input.speaker)
  const facts = object(input.projectFacts)
  const constraints = constraintCount(facts)
  const broadScope = count(facts.tasks) >= 8 || count(facts.stories) >= 3 || count(input.eligibleParents) >= 3
  const analytical = analysis.test(question)
  if (mode === "meeting_summary") return { ...route(mode, "pro", "low", "whole_meeting_summary"), maxTokens: 9000 }
  if (input.presentationMode === "defense" && mode === "explain") {
    const complex = /权衡|方案\s*[AB].*方案\s*[AB]|机会成本|综合|最小.*调整|关键路径|救一个|晚两天|两天.*区别|阻塞传播|重新规划|约束.*继承|多条件|验收边界|优先级.*依据/.test(question)
    return { ...route(mode, complex && !speaker.startsWith("数字成员：") ? "pro" : "flash", complex ? "high" : "none", complex ? "defense_complex_reasoning" : "defense_colleague_reply"), maxTokens: complex ? 6500 : 1800 }
  }
  if (mode === "interpret") return route(mode, "flash", "none", "intent_parsing")
  if (mode === "materials") {
    const formatting = /改名|重命名|改标题|只.*(?:格式|措辞|错别字|摘要)|仅.*(?:格式|措辞|错别字|摘要)|统一.*(?:格式|措辞)/.test(question)
    if (formatting && !/新增|设计|分析|重新生成|完整|全套/.test(question) && count(input.priorArtifacts) > 0)
      return route(mode, "flash", "low", "material_formatting")
    return route(mode, "pro", deep.test(question) ? "max" : "high", "material_creation")
  }
  if (mode === "repair_diagram") {
    const semantic = /原生|系统边界|参与者|图形类型|业务语义|转换.*(?:图|类型)/.test(string(input.error))
    return semantic || string(input.source).length > 12000
      ? route(mode, "pro", "high", "diagram_semantic_repair") : route(mode, "flash", "low", "diagram_syntax_repair")
  }
  if (mode === "draft_work") {
    if (speaker === "plan_execution") return route(mode, "flash", "low", "execution_action_draft")
    const smallLeaf = input.parentType === "task" && count(input.eligibleParents) === 1 && constraints === 0 &&
      /(?:^|[^\d一二三四五六七八九十两])(?:一|两|二|1|2)\s*(?:个|项|条|步)/.test(question) && !deep.test(question)
    return smallLeaf ? route(mode, "flash", "low", "small_subtask_draft")
      : route(mode, "pro", broadScope && (constraints >= 5 || deep.test(question)) ? "max" : "high", "work_decomposition")
  }
  // Role policy precedes keyword optimizations; reasoning/calculation already belongs to services.
  const digitalIdentity = speaker.startsWith("数字成员：") || speaker === "digital_member"
  if (digitalIdentity) return route(mode,"flash",analytical?"low":"none","digital_member_update")
  if (speaker === "plan_execution") return route(mode,"flash","none","execution_confirmation")
  if (/谁.*(?:最多|最少|最忙|最空闲)|(?:比较|对比).*(?:工时|进度|数量)/.test(question) &&
    !/分析|为什么|优化|重新|分配|排期|方案|可行|影响/.test(question)) return route(mode,"flash","none","record_lookup")
  if (!analytical && lookup.test(question)) return route(mode,"flash","none","record_lookup")
  if (["task_decomposition","risk_dependency","workload_capacity"].includes(speaker))
    return route(mode,"pro",deep.test(question)&&broadScope?"max":"high",`${speaker}_analysis`)
  if (speaker === "project_orchestrator") {
    const synthesis=/复盘|跨\s*Agent|跨团队|跨\s*Story|全项目|综合|冲突消解|项目延期原因.*下一轮/.test(question) ||
      broadScope&&constraints>=5&&deep.test(question)
    return synthesis?route(mode,"pro","high","project_synthesis"):route(mode,"flash",analytical?"low":"none","project_fact_or_correction")
  }
  if (speaker === "plan_execution" && /执行建议|行动项|待审核|确认|就按|执行|实际写入/.test(question) &&
    !/新增|添加|重新|调整|优化|比较|可行|能否|冲突|影响|改.*(?:负责人|工时|工期|人数)/.test(question))
    return route(mode, "flash", "none", "execution_confirmation")
  if (/谁.*(?:最多|最少|最忙|最空闲)|(?:比较|对比).*(?:工时|进度|数量)/.test(question) &&
    !/分析|为什么|优化|重新|分配|排期|方案|可行|影响/.test(question)) return route(mode, "flash", "none", "record_lookup")
  // A large stored project or an old difficult discussion must not slow a simple lookup.
  if (!analytical && (lookup.test(question) || confirmation.test(question)))
    return route(mode, "flash", "none", confirmation.test(question) ? "execution_confirmation" : "record_lookup")
  const digital = speaker.startsWith("数字成员：") || speaker === "digital_member"
  if (digital && !analytical) return route(mode, "flash", "none", "digital_member_update")
  const specialist = ["task_decomposition", "risk_dependency", "workload_capacity"].includes(speaker)
  if (analytical || specialist) {
    const max = deep.test(question) && (broadScope || constraints >= 3) ||
      broadScope && constraints >= 5 && /规划|计划|排期|分配|优化|可行|拆解|调整|方案/.test(question)
    return route(mode, "pro", max ? "max" : "high", digital ? "digital_member_planning" : `${speaker || "project_orchestrator"}_analysis`)
  }
  return route(mode, "flash", "low", "general_discussion")
}
