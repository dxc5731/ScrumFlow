/**
 * 本轮指令的共同语义边界：被否定、引用、假设或解释的动作不是执行授权。
 * 原问题仍用于事实问答与模型上下文；commandText 只供动作路由和约束修改使用。
 * 不用固定字数窗口跨句寻找“不”，避免把另一句的禁止或肯定指令混在一起。
 */
const actionWords = /进入审核|提交审核|确认应用|重新生成|重新安排|重新规划|重新拆解|重新拆|生成|制作|整理|导出|下载|绘制|展示|准备|完善|补充|修改|更改|更新|删除|写入|改成|改给|换成|换给|交给|标记|调整|安排|分配|指派|新增|添加|增加|创建|登记|处理|拆解|拆分|拆成|拆开|拆一下|拆细|细化|拆得更细|执行|应用|落地|去掉|取消|解除|重排|保留|并行|画|写|拆|给/g
const prohibition = /不需要|不允许|不可以|不应该|不应|不能|不准|不得|不必|不要|不用|无需|请勿|禁止|暂不|先不|不再|先别|别|不|没(?:有)?(?:让|要求|授权)|未(?:让|要求|授权)|并非/
const quoted = /“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"\n]*"|'[^'\n]*'|`[^`]*`/g
// 引用中的动词和人名不能成为授权；保留对象类别以支持“生成‘测试报告’”。
const objectKinds = /UML|甘特图|用户地图|故事地图|旅程图|用例图|类图|时序图|活动图|状态图|部署图|组件图|ER图|WBS|文档|纪要|报告|说明书|章程|成果|材料|Excel|Word|PDF|表格|台账|登记册|RACI|测试计划|验收计划|总结表|预算表|工作量表|任务|工作项|步骤|待办/gi

export interface MeetingRequest {
  commandText: string
  /** 供事实路由使用，保留问句，但去除引用与被禁止的动作。 */
  topicText: string
  /** 方案模拟允许“如果换成李娜”；它不授权生成提案或写入。 */
  planningText: string
  /** 保留约束中的禁止及显式模拟，引用或解释不更新约束。 */
  constraintText: string
  deniesProposal: boolean
}

export function analyzeMeetingRequest(question: string): MeetingRequest {
  const text = question.normalize("NFKC").replace(quoted, value => ` ${value.match(objectKinds)?.join(" ") ?? ""} `)
  const clauses = text.split(/(?<=[,，。;；!！?？\n])|但是|但|不过|而是|然后|(?=只(?:回答|查看|查询|分析|讨论|说明|比较|解释))|(?=并(?:请|生成|导出|创建))/)
  const commands: string[] = [], topics: string[] = [], constraints: string[] = [], planning: string[] = []
  let deniesProposal = false
  let carryDenial: boolean = false
  for (const raw of clauses) {
    const clause = raw.trim()
    if (!clause) continue
    const hypothetical = /如果|假如|假设|设想|要是|前提下/.test(clause)
    const inquiry = /^(?:我(?:只)?(?:想|是)?|请|先|只|仅|帮我)*(?:解释|说明|分析|评估|讨论|比较|查询|查看|看看|核对|问|想知道)/.test(clause) ||
      /为什么|怎么|如何|是否|能否|会不会|是什么意思|了吗|了没/.test(clause) ||
      /什么|多少|哪些|哪项|哪位|可不可以|能不能|[吗么][?？]?$/.test(clause) && !/请把|帮我|替我/.test(clause)
    // 限定范围内识别否定；并列动词共享否定，转折后从新分句重新开始。
    const matches = [...clause.matchAll(new RegExp(actionWords.source, "g"))]
    const continuedList: boolean = carryDenial && new RegExp(`^(?:以及|或者|或|和|并)?(?:${actionWords.source})`).test(clause)
    const postponed = /(?:不要|不用|不必)(?:做|操作|进行)?[。！!？?，,；;]?$/.test(clause)
    let denied: boolean = continuedList || postponed
    let denialStart = denied ? 0 : clause.length
    let lastEnd = 0
    const accepted: string[] = []
    for (const match of matches) {
      const prefix = clause.slice(lastEnd, match.index)
      const negationIndex = prefix.search(prohibition)
      if (!denied && negationIndex >= 0) denialStart = lastEnd + negationIndex
      denied ||= negationIndex >= 0
      if (denied) {
        if (/生成|整理|提交审核|进入审核/.test(match[0]) && /建议|提案|Proposal|审核|行动/i.test(clause.slice(match.index))) deniesProposal = true
      } else accepted.push(match[0])
      lastEnd = match.index! + match[0].length
    }
    carryDenial = denied && /[,，]$/.test(clause)
    // “不安排某成员 / 不拆子任务”是约束；“不要修改工期为五天”不应改写工期。
    const deniedEdit = matches.some(match => /修改|更改|改成|更新|调整|取消|换成/.test(match[0])) && denied
    if (!inquiry || hypothetical) constraints.push(deniedEdit ? clause.slice(0, denialStart) : clause)
    if (!matches.length) {
      topics.push(clause)
      if (!hypothetical && !inquiry && !prohibition.test(clause)) commands.push(clause)
      if (!inquiry || hypothetical) planning.push(clause)
    } else if (accepted.length) {
      // 同句里的禁止动作连同对象一起截断，避免“生成子任务不要导出 Excel”误拼成生成 Excel。
      const cleaned = clause.slice(0, denialStart)
      topics.push(cleaned)
      if (!hypothetical && !inquiry) commands.push(cleaned)
      if (!inquiry || hypothetical) planning.push(cleaned)
    } else {
      // 不丢弃同句里的事实问题，例如“不修改的前提下，你还能接多少工作”。
      topics.push(clause.replace(new RegExp(actionWords.source, "g"), " "))
    }
  }
  return { commandText: commands.join("；"), topicText: topics.join("；"), planningText: planning.join("；"), constraintText: constraints.join(""), deniesProposal }
}

export function requestsDirectMutation(question: string): boolean {
  return /改成|改给|换给|标记|修改|更新|删除|写入|调整|安排|分配|指派/.test(analyzeMeetingRequest(question).commandText)
}
