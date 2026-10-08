import type { MeetingContext, MeetingSession, ProjectDataState } from "../types"
import type { MaterialArtifact } from "./materialSchema"
import { activePlanWbs, registeredDependencyDiagram } from "./materialProjectAssets"
import { sprintIssueSpreadsheet } from "./materialEvidence"
import { readableMeeting, readableMinutesMarkdown } from "./meetingPresentation"

export function standardMaterialKind(question: string): string | null {
  if (/老师.*(?:汇报|材料)|汇报材料/.test(question)) return /创作|开放式|全新|独特|故事化/.test(question) ? null : "teacher"
  if (/会议纪要|正式纪要/.test(question)) return "minutes"
  if (/行动项清单/.test(question)) return "actions"
  if (/变更摘要|会议.*未.*确认|未.*确认.*(?:执行|已)/.test(question)) return "changes"
  if (/甘特图|gantt/i.test(question)) return "gantt"
  if (/用户地图|(?:用户)?故事地图/.test(question)) return "storymap"
  if (/依赖.*图|图.*依赖/.test(question)) return "dependencies"
  if (/WBS|工作分解|任务分解/i.test(question)) return "wbs"
  if (/Excel|xlsx|电子表格/i.test(question)) return "excel"
  if (/风险报告|风险清单|阻塞清单/.test(question)) return "risks"
  if (/活动图/.test(question) && /验收/.test(question)) return "activity"
  if (/时序图|顺序图/.test(question) && /验收/.test(question)) return "sequence"
  if (/类图|数据结构关系图/.test(question) && /Story|Task|Sprint|Member|数据模型/i.test(question)) return "class"
  return null
}

export function standardMaterial(kind: string, state: ProjectDataState, session: MeetingSession, context: MeetingContext): MaterialArtifact {
  const view = readableMeeting(state, session)
  const doc = (title: string, markdown: string): MaterialArtifact => ({ kind: "document", title, markdown })
  const scope = context.focusStoryIds.map(id => state.stories[id]).filter(Boolean)
  if (kind === "minutes") return doc("正式会议纪要", readableMinutesMarkdown(state, session))
  if (kind === "changes") return doc("本次会议项目变更摘要", `# 本次会议项目变更摘要\n\n${view.changes.join("\n\n")}\n\n${view.actions.filter(action => action.tone !== "done").map(action => `- ${action.title}：${action.status}`).join("\n") || "本次没有其他待处理建议。"}`)
  if (kind === "actions") return doc("本次会议行动项", `# 接下来谁做什么\n\n${view.actions.map(action => `## ${action.title}\n\n👤 ${action.member}${action.estimate !== null ? ` · 约 ${action.estimate}h` : ""} · ${action.status}`).join("\n\n") || "会议尚未形成可审核行动。"}`)
  if (kind === "risks") return doc("本次会议风险与阻塞", `# 还需要关注\n\n${view.attention.map(item => `- ${item}`).join("\n") || "本次未记录新的风险或待核实事项。"}\n\n## 当前已登记阻塞\n\n${Object.values(state.tasks).filter(task => context.focusStoryIds.includes(task.storyId) && task.status === "blocked").map(task => `- ${task.title}：${task.blockReasons.map(reason => reason.message).join("；") || "具体原因待确认"}`).join("\n") || "当前讨论范围没有已登记阻塞。"}`)
  if (kind === "excel") return sprintIssueSpreadsheet(state, context)
  if (kind === "dependencies") return registeredDependencyDiagram(state, context)
  if (kind === "wbs") {
    const appliedHere = session.proposalIds.flatMap(id => state.proposals[id]?.actions ?? []).some(action => {
      const id = action.resultTargetId ?? action.targetId
      const storyId = state.tasks[id]?.storyId ?? state.tasks[state.subtasks[id]?.taskId]?.storyId
      return action.status === "applied" && scope.some(story => story.id === storyId)
    })
    const plan = appliedHere ? null : context.activePlan
    const rows = plan ? plan.tasks.map(task => [task.title, state.members[task.assigneeId]?.name ?? "待确认", task.estimate, "讨论方案，待审核", task.dependsOnKeys.length])
      : scope.flatMap(story => story.taskIds.map(id => state.tasks[id]).filter(Boolean).flatMap(task => [[task.title, state.members[task.assigneeId]?.name ?? "待确认", task.estimate, "现有项目工作", Object.values(state.dependencies).filter(edge => edge.targetTaskId === task.id).length],
        ...task.subtaskIds.map(id => state.subtasks[id]).filter(Boolean).map(subtask => [`  ↳ ${subtask.title}`, state.members[subtask.assigneeId]?.name ?? "待确认", subtask.estimate, "已进入项目的执行步骤", 0])]))
    const title = `${scope.length === 1 ? scope[0].id.toUpperCase() : "项目"} 任务分解 WBS`
    return { kind: "spreadsheet", title, sheets: [{ name: "任务分解", columns: ["任务", "负责人", "估算h", "性质", "前置数量"], rows },
      ...(plan ? [{ ...activePlanWbs(state, context).sheets[0], name: "技术依据" }] : [])] }
  }
  if (kind === "activity") return { kind: "diagram", title: "Story 验收完整流程活动图", mermaid: `flowchart TD
  Start((开始)) --> Ready{"工程任务都已完成？"}
  Ready -- 否 --> Work["成员继续完成工程任务"]
  Work --> Ready
  Ready -- 是 --> Pending["Story 进入待验收"]
  Pending --> Role{"当前操作者是 PO？"}
  Role -- 否 --> Wait["等待 PO 审核"]
  Wait --> Role
  Role -- 是 --> Review["核对验收标准与交付成果"]
  Review --> Result{"验收通过？"}
  Result -- 是 --> Accept["记录验收意见 · Story 已验收"]
  Result -- 否 --> Return["记录退回原因 · 选择返工任务"]
  Return --> Work
  Accept --> Finish((结束))` }
  if (kind === "sequence") return { kind: "diagram", title: "PO 验收 Story 系统交互时序图", mermaid: `sequenceDiagram
  actor PO as 产品负责人
  participant UI as 验收页面
  participant Store as 项目 Store
  participant Save as 本地持久化服务
  PO->>UI: 查看待验收 Story 和验收标准
  UI->>Store: 读取 Story、任务与当前角色
  Store-->>UI: 返回已登记的交付记录
  PO->>UI: 确认验收并填写意见
  UI->>Store: acceptStory(storyId, note)
  Store->>Store: 校验 PO 权限和待验收状态
  alt 条件满足
    Store->>Store: 更新验收状态、验收记录与变更历史
    Store-->>UI: 刷新为已验收
    Store->>Save: 保存项目快照 /api/local-project
    Save-->>Store: 返回持久化结果
    UI-->>PO: 展示验收结果
  else 条件不满足
    Store-->>UI: 返回不能验收的原因
    UI-->>PO: 提示先处理条件
  end` }
  if (kind === "class") return { kind: "diagram", title: "Story Task Sprint Member 数据模型类图", mermaid: `classDiagram
  class Story {
    string id
    string title
    string sprintId
    string assigneeId
    string deliveryStatus
  }
  class Task {
    string id
    string storyId
    string assigneeId
    number estimate
    string status
  }
  class Sprint {
    string id
    string name
    string startDate
    string endDate
  }
  class Member {
    string id
    string name
    number capacityHours
  }
  class Subtask {
    string id
    string taskId
    number estimate
  }
  class Dependency {
    string sourceTaskId
    string targetTaskId
  }
  Sprint "0..1" o-- "0..*" Story : 迭代归属
  Story "1" *-- "0..*" Task : 工程工作
  Task "1" *-- "0..*" Subtask : 执行步骤
  Member "1" <-- "0..*" Story : 负责人
  Member "1" <-- "0..*" Task : 负责人
  Member "1" <-- "0..*" Subtask : 负责人
  Task "1" <-- "0..*" Dependency : 前置任务
  Task "1" <-- "0..*" Dependency : 后置任务` }
  throw new Error("该材料需要选择具体类型")
}
