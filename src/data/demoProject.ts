import {
  PROJECT_NAME,
  PROJECT_SUBTITLE,
  epics as legacyEpics,
  members as legacyMembers,
  sprints as legacySprints,
  userActivities as legacyActivities,
  userStories as legacyStories,
  userTasks as legacyUserTasks,
} from "../mockData"
import type {
  AcceptanceCriterion,
  DesignAssetEntity,
  DiscussionMessageEntity,
  EpicEntity,
  ProjectDataState,
  RiskEntity,
  SprintPulseEntity,
  StoryDeliveryStatus,
  StoryEntity,
  StorySource,
  SubtaskEntity,
  TaskEntity,
  TaskStatus,
  UmlDiagramKind,
  UserActivityEntity,
  UserTaskEntity,
} from "../types"
import { generatePlantUml, parseUmlSource } from "../utils/uml"

export const CURRENT_SCHEMA_VERSION = 16
const DEMO_NOW = "2026-09-18T10:00:00+08:00"

const DEMO_PROJECT_SCHEDULE = {
  startDate: "2026-09-01",
  endDate: "2026-10-16",
}

const DEMO_SPRINT_SCHEDULE: Record<string, { startDate: string; endDate: string }> = {
  s1: { startDate: "2026-09-01", endDate: "2026-09-11" },
  s2: { startDate: "2026-09-14", endDate: "2026-09-27" },
  s3: { startDate: "2026-09-28", endDate: "2026-10-11" },
}

const DEMO_STORY_SCHEDULE: Record<string, { startDate: string; dueDate: string }> = {
  us001: { startDate: "2026-09-01", dueDate: "2026-09-04" },
  us002: { startDate: "2026-09-01", dueDate: "2026-09-03" },
  us003: { startDate: "2026-09-02", dueDate: "2026-09-05" },
  us021: { startDate: "2026-09-07", dueDate: "2026-09-11" },
  us022: { startDate: "2026-09-08", dueDate: "2026-09-12" },
  us031: { startDate: "2026-09-14", dueDate: "2026-09-16" },
  us023: { startDate: "2026-09-14", dueDate: "2026-09-16" },
  us028: { startDate: "2026-09-14", dueDate: "2026-09-17" },
  us024: { startDate: "2026-09-15", dueDate: "2026-09-28" },
  us025: { startDate: "2026-09-16", dueDate: "2026-10-02" },
  us026: { startDate: "2026-09-17", dueDate: "2026-09-29" },
  us027: { startDate: "2026-09-14", dueDate: "2026-09-29" },
  us029: { startDate: "2026-09-21", dueDate: "2026-09-30" },
  us030: { startDate: "2026-09-28", dueDate: "2026-10-05" },
  us032: { startDate: "2026-09-30", dueDate: "2026-10-12" },
  us033: { startDate: "2026-09-28", dueDate: "2026-10-09" },
  us034: { startDate: "2026-10-08", dueDate: "2026-10-16" },
}

const DEMO_TASK_SCHEDULE: Record<string, { startDate: string; endDate: string }> = {
  "fe-001-1": { startDate: "2026-09-01", endDate: "2026-09-03" },
  "be-001-1": { startDate: "2026-09-01", endDate: "2026-09-03" },
  "db-001-1": { startDate: "2026-09-01", endDate: "2026-09-02" },
  "test-001-1": { startDate: "2026-09-03", endDate: "2026-09-04" },
  "fe-021-1": { startDate: "2026-09-07", endDate: "2026-09-10" },
  "be-021-1": { startDate: "2026-09-07", endDate: "2026-09-09" },
  "test-021-1": { startDate: "2026-09-10", endDate: "2026-09-11" },
  "fe-024-1": { startDate: "2026-09-14", endDate: "2026-09-15" },
  "data-024": { startDate: "2026-09-15", endDate: "2026-09-18" },
  "fe-024-2": { startDate: "2026-09-16", endDate: "2026-09-23" },
  "be-024-1": { startDate: "2026-09-18", endDate: "2026-09-25" },
  "test-024": { startDate: "2026-09-24", endDate: "2026-09-28" },
  "data-025": { startDate: "2026-09-14", endDate: "2026-09-15" },
  "be-025-1": { startDate: "2026-09-16", endDate: "2026-09-22" },
  "fe-025-1": { startDate: "2026-09-21", endDate: "2026-09-28" },
  "test-025": { startDate: "2026-09-29", endDate: "2026-10-02" },
  "fe-026-1": { startDate: "2026-09-17", endDate: "2026-09-23" },
  "be-026-1": { startDate: "2026-09-18", endDate: "2026-09-25" },
  "test-026-1": { startDate: "2026-09-24", endDate: "2026-09-29" },
  "be-027-1": { startDate: "2026-09-14", endDate: "2026-09-16" },
  "ai-027-1": { startDate: "2026-09-16", endDate: "2026-09-19" },
  "fe-027-1": { startDate: "2026-09-17", endDate: "2026-09-24" },
  "test-027-1": { startDate: "2026-09-25", endDate: "2026-09-29" },
}

const DEMO_SUBTASK_SCHEDULE: Record<string, { startDate: string; endDate: string }> = {
  "subtask-024-1": { startDate: "2026-09-16", endDate: "2026-09-17" },
  "subtask-024-2": { startDate: "2026-09-18", endDate: "2026-09-22" },
  "subtask-024-3": { startDate: "2026-09-15", endDate: "2026-09-18" },
}

const taskStatusMap: Record<string, TaskStatus> = {
  todo: "todo",
  "in-progress": "in_progress",
  review: "review",
  done: "done",
  blocked: "blocked",
}

function toDeliveryStatus(
  status: string,
  sprintId: string | null,
): StoryDeliveryStatus {
  if (!sprintId) return "backlog"
  if (status === "done") return "accepted"
  if (status === "review") return "pending_acceptance"
  if (status === "in-progress" || status === "blocked") return "in_progress"
  return "planned"
}

function recordById<T extends { id: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((item) => [item.id, item]))
}

function createDemoUmlAsset(input: {
  id: string
  name: string
  kind: UmlDiagramKind
  source: string
  links: DesignAssetEntity["links"]
}): DesignAssetEntity {
  const parsed = parseUmlSource(input.kind, input.source)
  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    links: input.links,
    mimeType: "text/vnd.plantuml",
    storage: "inline",
    contentRef: "",
    sourceText: generatePlantUml(parsed.diagram),
    umlData: parsed.diagram,
    preview: `${parsed.diagram.nodes.length} 节点 · ${parsed.diagram.edges.length} 连线`,
    version: "v1.0",
    createdAt: DEMO_NOW,
    updatedAt: DEMO_NOW,
  }
}

function createCandidateStories(): StoryEntity[] {
  const base = {
    assigneeId: "m1",
    collaboratorIds: [] as string[],
    deliveryStatus: "backlog" as const,
    priority: "medium" as const,
    businessValue: 3,
    expectedBenefit: "提升课程项目规划与交付的可视化程度",
    risk: "none" as const,
    riskNote: "",
    startDate: "2026-09-21",
    dueDate: "2026-10-02",
    sprintId: null,
    taskIds: [] as string[],
    acceptanceCriteriaIds: [] as string[],
    acceptanceLog: [],
    discussionIds: [] as string[],
    createdAt: DEMO_NOW,
    updatedAt: DEMO_NOW,
  }

  return [
    {
      ...base,
      id: "cand-001",
      title: "增加关键路径分析能力",
      as: "项目负责人",
      iWant: "查看影响交付日期的最长依赖链",
      soThat: "优先处理关键任务",
      maturityStatus: "candidate",
      storyPoints: 5,
      epicId: "ep4",
      source: "ai",
      order: 0,
    },
    {
      ...base,
      id: "cand-002",
      title: "支持活动图版本管理",
      as: "团队成员",
      iWant: "",
      soThat: "",
      maturityStatus: "draft",
      storyPoints: 3,
      epicId: "ep5",
      source: "meeting",
      order: 1,
    },
    {
      ...base,
      id: "cand-003",
      title: "生成实验材料目录",
      as: "课程项目负责人",
      iWant: "自动汇总本轮实验材料清单",
      soThat: "提交前可以快速核对",
      maturityStatus: "ready",
      storyPoints: 2,
      epicId: "ep9",
      source: "manual",
      order: 2,
    },
    {
      ...base,
      id: "cand-004",
      title: "Gantt 支持 WBS 节点导入",
      as: "项目负责人",
      iWant: "将已有 WBS 节点转换为工程任务",
      soThat: "减少重复录入",
      maturityStatus: "ready",
      storyPoints: 8,
      epicId: "ep4",
      source: "review",
      order: 3,
    },
    {
      ...base,
      id: "cand-005",
      title: "跨 Sprint 依赖告警",
      as: "项目负责人",
      iWant: "",
      soThat: "",
      maturityStatus: "candidate",
      storyPoints: 3,
      epicId: null,
      source: "retro",
      order: 4,
    },
  ]
}

export function createDemoProjectState(): ProjectDataState {
  const sprints = legacySprints.map((sprint) => {
    const schedule = DEMO_SPRINT_SCHEDULE[sprint.id]
    return {
      ...sprint,
      ...schedule,
      memberIds: legacyMembers.map((member) => member.id),
      reviewSummary: "",
      goalAchieved: null,
      retrospective: { mainProblem: "", nextImprovement: "" },
      closedAt: sprint.status === "closed" ? schedule?.endDate ?? sprint.endDate : null,
      createdAt: DEMO_NOW,
      updatedAt: DEMO_NOW,
    }
  })
  const activities: UserActivityEntity[] = legacyActivities.map(
    (activity, index) => ({
      id: activity.id,
      title: activity.title,
      order: index,
      domain:
        ([
          "governance",
          "planning",
          "design",
          "delivery",
          "quality",
          "other",
        ] as const)[index] ?? "other",
    }),
  )

  const userTaskOrder = new Map<string, number>()
  legacyActivities.forEach((activity) =>
    activity.taskIds.forEach((id, index) => userTaskOrder.set(id, index)),
  )
  const userTasks: UserTaskEntity[] = legacyUserTasks.map((task) => ({
    id: task.id,
    title: task.title,
    activityId: task.activityId,
    order: userTaskOrder.get(task.id) ?? 0,
  }))

  const epicOrder = new Map<string, number>()
  legacyEpics.forEach((epic) => {
    const count = [...epicOrder.keys()].filter(
      (id) =>
        legacyEpics.find((item) => item.id === id)?.taskId === epic.taskId,
    ).length
    epicOrder.set(epic.id, count)
  })
  const epics: EpicEntity[] = legacyEpics.map((epic) => ({
    id: epic.id,
    title: epic.title,
    userTaskId: epic.taskId,
    startDate: DEMO_PROJECT_SCHEDULE.startDate,
    endDate: DEMO_PROJECT_SCHEDULE.endDate,
    order: epicOrder.get(epic.id) ?? 0,
  }))

  const tasks: TaskEntity[] = []
  const acceptanceCriteria: AcceptanceCriterion[] = []
  const stories: StoryEntity[] = legacyStories.map((story, storyIndex) => {
    const taskIds: string[] = []
    story.engineeringTasks.forEach((task, taskIndex) => {
      const schedule = DEMO_TASK_SCHEDULE[task.id]
      taskIds.push(task.id)
      tasks.push({
        id: task.id,
        title: task.title,
        type: task.type,
        assigneeId: task.assigneeId,
        status: taskStatusMap[task.status] ?? "todo",
        estimate: task.estimate,
        progress:
          task.status === "done"
            ? 100
            : task.status === "review"
              ? 80
              : task.status === "in-progress"
                ? 45
                : 0,
        startDate: schedule?.startDate ?? task.startDate,
        endDate: schedule?.endDate ?? task.endDate,
        storyId: story.id,
        blockReasons: task.blockerNote
          ? [
              {
                id: `block-manual-${task.id}`,
                source: "manual",
                message: task.blockerNote,
                relatedTaskId: null,
                dependencyId: null,
                createdAt: DEMO_NOW,
              },
            ]
          : [],
        blockedSeverity: task.status === "blocked" ? "normal" : "normal",
        statusBeforeBlocked: task.status === "blocked" ? "todo" : null,
        resultSummary: task.status === "done" ? "已完成并通过当前阶段自测" : "",
        resultUrl: "",
        resultLinks: [],
        resultAssetIds: [],
        submittedAt: task.status === "done" ? DEMO_NOW : null,
        isMilestone: task.id === "test-024",
        qualityStatus: task.status === "done" ? "good" : "pending",
        qualityNote:
          task.status === "done" ? "已完成当前阶段自测并提交成果" : "",
        order: taskIndex,
        subtaskIds: [],
      })
    })

    const acceptanceCriteriaIds = story.acceptanceCriteria.map(
      (content, index) => {
        const id = `${story.id}-ac-${index + 1}`
        acceptanceCriteria.push({
          id,
          storyId: story.id,
          content,
          order: index,
          satisfied:
            story.status === "done" || (story.id === "us024" && index < 2),
        })
        return id
      },
    )

    const schedule = DEMO_STORY_SCHEDULE[story.id]
    return {
      id: story.id,
      title: story.title,
      as: story.as,
      iWant: story.iWant,
      soThat: story.soThat,
      assigneeId: story.assigneeId,
      collaboratorIds: story.collaboratorIds,
      maturityStatus: "ready",
      deliveryStatus: toDeliveryStatus(story.status, story.sprintId),
      priority: story.priority,
      storyPoints: story.storyPoints,
      businessValue:
        story.priority === "critical" ? 5 : story.priority === "high" ? 4 : 3,
      expectedBenefit: story.soThat || "提升对应业务流程的交付质量",
      risk: story.risk,
      riskNote: story.riskNote ?? "",
      startDate: schedule?.startDate ?? story.startDate,
      dueDate: schedule?.dueDate ?? story.dueDate,
      sprintId: story.sprintId,
      epicId: story.epicId || null,
      source: "manual" as StorySource,
      order: storyIndex,
      taskIds,
      acceptanceCriteriaIds,
      discussionIds:
        story.id === "us024"
          ? ["discussion-1", "discussion-2", "discussion-3"]
          : [],
      acceptanceLog: [],
      createdAt: DEMO_NOW,
      updatedAt: DEMO_NOW,
    }
  })

  const subtasks: SubtaskEntity[] = [
    {
      id: "subtask-024-1",
      taskId: "fe-024-2",
      title: "完成周视图日期头",
      done: true,
      status: "done",
      estimate: 2,
      progress: 100,
      ...DEMO_SUBTASK_SCHEDULE["subtask-024-1"],
      blockReasons: [],
      blockedSeverity: "normal",
      statusBeforeBlocked: null,
      resultSummary: "日期头已完成",
      resultUrl: "https://example.local/deliverables/subtask-024-1",
      resultLinks: ["https://example.local/deliverables/subtask-024-1"],
      resultAssetIds: [],
      submittedAt: DEMO_NOW,
      qualityStatus: "good",
      qualityNote: "日期显示与周视图已核对",
      assigneeId: "m2",
      order: 0,
    },
    {
      id: "subtask-024-2",
      taskId: "fe-024-2",
      title: "补充拖动边界校验",
      done: false,
      status: "in_progress",
      estimate: 2,
      progress: 45,
      ...DEMO_SUBTASK_SCHEDULE["subtask-024-2"],
      blockReasons: [],
      blockedSeverity: "normal",
      statusBeforeBlocked: null,
      resultSummary: "",
      resultUrl: "",
      resultLinks: [],
      resultAssetIds: [],
      submittedAt: null,
      qualityStatus: "pending",
      qualityNote: "",
      assigneeId: "m2",
      order: 1,
    },
    {
      id: "subtask-024-3",
      taskId: "data-024",
      title: "确认 Story 与 Task 字段契约",
      done: false,
      status: "review",
      estimate: 3,
      progress: 80,
      ...DEMO_SUBTASK_SCHEDULE["subtask-024-3"],
      blockReasons: [],
      blockedSeverity: "normal",
      statusBeforeBlocked: null,
      resultSummary: "已提交字段契约草案",
      resultUrl: "https://example.local/deliverables/subtask-024-3",
      resultLinks: ["https://example.local/deliverables/subtask-024-3"],
      resultAssetIds: [],
      submittedAt: DEMO_NOW,
      qualityStatus: "attention",
      qualityNote: "字段契约仍待最终评审",
      assigneeId: "m1",
      order: 0,
    },
  ]
  subtasks.forEach((subtask) => {
    const task = tasks.find((item) => item.id === subtask.taskId)
    if (task) task.subtaskIds.push(subtask.id)
  })

  const candidates = createCandidateStories()
  const allStories = [...stories, ...candidates]

  tasks.forEach((task) => {
    const children = subtasks.filter((subtask) => subtask.taskId === task.id)
    if (!children.length) return
    task.startDate = [task.startDate, ...children.map((child) => child.startDate)].sort()[0]
    task.endDate = [task.endDate, ...children.map((child) => child.endDate)].sort().at(-1)!
  })
  allStories.forEach((story) => {
    const children = tasks.filter((task) => task.storyId === story.id)
    if (!children.length) return
    story.startDate = [story.startDate, ...children.map((child) => child.startDate)].sort()[0]
    story.dueDate = [story.dueDate, ...children.map((child) => child.endDate)].sort().at(-1)!
  })
  epics.forEach((epic) => {
    const children = allStories.filter((story) => story.epicId === epic.id)
    if (!children.length) return
    epic.startDate = children.map((child) => child.startDate).sort()[0]
    epic.endDate = children.map((child) => child.dueDate).sort().at(-1)!
  })

  const assets: DesignAssetEntity[] = [
    {
      id: "asset-activity-024",
      name: "Story Map 与 Gantt 切换流程",
      kind: "activity",
      links: [{ targetType: "story", targetId: "us024" }],
      mimeType: "text/mermaid",
      storage: "inline",
      contentRef: "",
      sourceText:
        "flowchart TD; A[选择 Story] --> B[切换视图] --> C[共享同一数据]",
      preview:
        "mermaid:flowchart TD; A[选择 Story] --> B[切换视图] --> C[共享同一数据]",
      version: "v1.2",
      createdAt: DEMO_NOW,
      updatedAt: DEMO_NOW,
    },
    createDemoUmlAsset({
      id: "asset-use-case-planning",
      name: "规划中心用例图",
      kind: "use-case",
      links: [
        { targetType: "story", targetId: "us024" },
        { targetType: "story", targetId: "us026" },
      ],
      source: `@startuml
left to right direction
actor "产品负责人" as PO
actor "团队成员" as Member
usecase "维护 Product Backlog" as Backlog
usecase "编辑 User Story" as Story
usecase "规划 Sprint" as Sprint
usecase "检查甘特排期" as Gantt
usecase "关联设计资产" as Asset
usecase "导出发布范围" as Release
PO --> Backlog
PO --> Sprint
PO --> Gantt
Member --> Story
Member --> Asset
Backlog ..> Story : <<include>>
Sprint ..> Gantt : <<include>>
Release ..> Sprint : <<extend>>
@enduml`,
    }),
    createDemoUmlAsset({
      id: "asset-sequence-story-update",
      name: "Story 更新与资产同步时序图",
      kind: "sequence",
      links: [
        { targetType: "story", targetId: "us024" },
        { targetType: "task", targetId: "be-024-1" },
      ],
      source: `@startuml
participant "PO" as PO
participant "规划界面" as UI
participant "项目 Store" as Store
participant "本地文件服务" as File
participant "甘特视图" as Gantt
PO -> UI : 编辑 Story 排期
UI -> Store : 提交统一数据变更
Store -> File : 持久化项目状态
File --> Store : 保存成功
Store -> Gantt : 发布排期更新
Gantt --> UI : 返回重绘结果
UI --> PO : 展示同步后的计划
@enduml`,
    }),
    createDemoUmlAsset({
      id: "asset-class-project-model",
      name: "统一项目模型类图",
      kind: "class",
      links: [
        { targetType: "story", targetId: "us024" },
        { targetType: "task", targetId: "data-024" },
      ],
      source: `@startuml
class "Project" as Project {
  - name: string
  + save(): void
}
class "Sprint" as Sprint {
  - goal: string
  - status: SprintStatus
}
class "Story" as Story {
  - title: string
  - storyPoints: number
}
class "Task" as Task {
  - estimate: number
  - progress: number
}
class "MilestoneTask" as Milestone {
  - milestoneDate: LocalDate
}
class "DesignAsset" as Asset {
  - version: string
}
class "ProjectRepository" as Repository {
  + save(project): void
}
class "RepositoryPort" as Port {
  + save(project): void
}
class "ProjectService" as Service {
  + updateStory(): void
}
Project *-- Sprint : 组合
Sprint o-- Story : 聚合
Story *-- Task : 组合
Milestone --|> Task : 泛化
Story --> Asset : 关联
Service ..> Project : 依赖
Repository ..|> Port : 实现
@enduml`,
    }),
  ]

  const discussions: DiscussionMessageEntity[] = [
    {
      id: "discussion-1",
      targetType: "story",
      targetId: "us024",
      storyId: "us024",
      authorId: "m1",
      content: "Gantt 修改日期以后，Story 本身的 Sprint 是否允许自动变化？",
      createdAt: "2026-09-13T10:24:00+08:00",
      isAI: false,
    },
    {
      id: "discussion-2",
      targetType: "story",
      targetId: "us024",
      storyId: "us024",
      authorId: "m2",
      content: "建议跨 Sprint Boundary 时提示确认，课程阶段不自动迁移。",
      createdAt: "2026-09-13T10:31:00+08:00",
      isAI: false,
    },
    {
      id: "discussion-3",
      targetType: "story",
      targetId: "us024",
      storyId: "us024",
      authorId: "m3",
      content: "统一 Store 后各视图直接订阅同一实体，不再维护双份数据。",
      createdAt: "2026-09-13T11:05:00+08:00",
      isAI: false,
    },
  ]

  const risks: RiskEntity[] = [
    {
      id: "risk-us024",
      title: "统一数据模型延期风险",
      targetType: "story",
      targetId: "us024",
      level: "high",
      description: "跨视图数据结构调整可能影响本轮交付时间。",
      impact: "可能推迟 Story Map、Gantt 和执行状态联调。",
      mitigation: "先冻结实体契约，再按统一 Action 接入各视图。",
      ownerId: "m1",
      status: "mitigating",
      createdAt: DEMO_NOW,
      updatedAt: DEMO_NOW,
    },
    {
      id: "risk-fe025",
      title: "依赖连线实现受前置数据阻塞",
      targetType: "task",
      targetId: "fe-025-1",
      level: "medium",
      description: "依赖数据尚未完全稳定。",
      impact: "甘特依赖连线和关键路径展示可能延后。",
      mitigation: "优先完成依赖实体与测试，再接入绘制层。",
      ownerId: "m2",
      status: "open",
      createdAt: DEMO_NOW,
      updatedAt: DEMO_NOW,
    },
  ]

  const sprintPulses: SprintPulseEntity[] = [
    {
      id: "pulse-s2-20260913",
      sprintId: "s2",
      date: "2026-09-13",
      focus: "完成统一 Store 联调与甘特排期校验",
      blockers: "依赖数据模型仍有两条前置任务未完成",
      notes: "PO 需确认高风险 Story 的排期缓冲。",
      createdAt: DEMO_NOW,
    },
  ]

  const dependencies = [
    {
      id: "dep-1",
      sourceTaskId: "data-024",
      targetTaskId: "be-024-1",
      type: "FS" as const,
      createdAt: DEMO_NOW,
    },
    {
      id: "dep-2",
      sourceTaskId: "data-024",
      targetTaskId: "fe-025-1",
      type: "FS" as const,
      createdAt: DEMO_NOW,
    },
    {
      id: "dep-3",
      sourceTaskId: "fe-024-2",
      targetTaskId: "test-024",
      type: "FS" as const,
      createdAt: DEMO_NOW,
    },
  ]

  dependencies.forEach((dependency) => {
    const source = tasks.find((task) => task.id === dependency.sourceTaskId)
    const target = tasks.find((task) => task.id === dependency.targetTaskId)
    if (!source || !target || source.status === "done") return
    if (target.status !== "blocked") {
      target.statusBeforeBlocked = target.status
      target.status = "blocked"
    }
    target.blockReasons.push({
      id: `block-${dependency.id}`,
      source: "dependency",
      message: `等待前置任务 ${source.id.toUpperCase()}「${source.title}」完成`,
      relatedTaskId: source.id,
      dependencyId: dependency.id,
      createdAt: dependency.createdAt,
    })
  })

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    project: {
      id: "scrumflow-ai",
      name: PROJECT_NAME,
      subtitle: PROJECT_SUBTITLE,
      goal: "完成可演示的 Scrum 规划、执行、验收与分析闭环",
      requirementBrief: "围绕统一 Project Model 建设 PO 端课程项目管理能力。",
      ...DEMO_PROJECT_SCHEDULE,
    },
    members: recordById(
      legacyMembers.map((member) => ({ ...member, capacityHours: 40 })),
    ),
    activities: recordById(activities),
    userTasks: recordById(userTasks),
    epics: recordById(epics),
    stories: recordById(allStories),
    tasks: recordById(tasks),
    subtasks: recordById(subtasks),
    sprints: recordById(sprints),
    acceptanceCriteria: recordById(acceptanceCriteria),
    dependencies: recordById(dependencies),
    assets: recordById(assets),
    risks: recordById(risks),
    impactAnalyses: [],
    sprintPulses: recordById(sprintPulses),
    discussions: recordById(discussions),
    proposals: {},
    projectEvents: {},
    history: [],
    meetingSessions: {},
    meetingMessages: {},
    workspace: {
      currentPage: "story-map",
      currentView: "story-map",
      selectedSprintId: "s2",
      selectedObjectType: null,
      selectedObjectId: null,
      memberFilterId: null,
      statusFilter: "all",
      riskFilter: "all",
      actorMode: "po",
      currentUserId: "m1",
      inspectorOpen: false,
      inspectorTab: "overview",
      inspectorWidth: 400,
      backlogCollapsed: false,
      backlogWidth: 272,
      backlogFullscreen: false,
      storyMapZoom: 0.9,
      storyMapScrollLeft: 0,
      storyMapScrollTop: 0,
      showEngineeringLayer: false,
      showCompletedStories: false,
      ganttRangeStart: "2026-09-01",
      ganttRangeEnd: "2026-10-18",
      ganttCollapsedIds: [],
      ganttScrollLeft: 0,
      ganttScrollTop: 0,
      ganttCriticalPath: false,
      ganttHeatmapHighlight: null,
      focusRequest: null,
    },
  }
}
