import type {
  ProjectDataState,
  StoryEntity,
  TaskEntity,
  SubtaskEntity,
  TaskStatus,
  TaskType,
} from "../types"
import { applyDemoSchedule, DEMO_REFERENCE_DATE } from "./demoSchedule"
import { generatePlantUml, parseUmlSource } from "../utils/uml"
import { normalizeProjectUseCase } from "../utils/projectUseCase"
import {
  remainingWork,
  roundHours,
} from "../utils/workloadAnalysis"

/** An explicitly simulated project, never a reconstruction of real execution history. */
export function buildCurrentDemo(
  base: ProjectDataState,
  _now: Date,
): ProjectDataState {
  const today = DEMO_REFERENCE_DATE
  const date = (offset: number) =>
    new Date(Date.parse(today + "T12:00:00Z") + offset * 86400000)
      .toISOString()
      .slice(0, 10)
  const at = (offset: number) =>
    offset === 0 ? today + "T12:00:00+08:00" : date(offset) + "T18:00:00+08:00"
  const record = <T extends { id: string }>(items: T[]): Record<string, T> =>
    Object.fromEntries(items.map((item) => [item.id, item]))
  const state: ProjectDataState = {
    ...base,
    project: {
      id: "scrumflow-comprehensive-demo",
      name: "ScrumFlow 研发协作示例项目",
      subtitle: "完整演示数据 · 规划、执行、验收与版本交付",
      goal: "先交付稳定的项目规划与执行闭环，再引入需要 PO 确认的 AI 协作能力。",
      requirementBrief:
        "本项目是可编辑的演示场景，所有成员、工时、验收记录和历史快照均为示例。V1.0 已交付基础能力，V1.1 正在补齐排期、资产与版本管理，V1.2 规划 AI 辅助。可从 Sprint 2 查看正常推进、待验收、退回、阻塞与延期，也可在 Release 中检查核心故事与范围调整。默认排期固定在 2026 年 10 月 10 日至 31 日，按实际工作先后错开；历史快照保留调整排期前的模拟观测，不随新计划改写。",
      startDate: date(-39),
      endDate: date(24),
    },
    activities: record([
      {
        id: "act1",
        title: "建立项目共识与协作边界",
        order: 0,
        domain: "governance",
      },
      { id: "act2", title: "让需求与设计可追踪", order: 1, domain: "planning" },
      { id: "act3", title: "让迭代执行可控", order: 2, domain: "delivery" },
      { id: "act5", title: "让 AI 辅助可审查", order: 3, domain: "other" },
      {
        id: "act6",
        title: "按版本完成验收与交付",
        order: 4,
        domain: "quality",
      },
    ]),
    userTasks: {},
    epics: {},
    stories: {},
    tasks: {},
    subtasks: {},
    acceptanceCriteria: {},
    dependencies: {},
    assets: {},
    risks: {},
    discussions: {},
    sprintBurndowns: {},
    sprintPulses: {},
    impactAnalyses: [],
    proposals: {},
    projectEvents: {},
    meetingSessions: {},
    meetingMessages: {},
    history: [],
    releases: record([
      {
        id: "release-base",
        name: "V1.0 基础协作",
        goal: "项目、需求和执行看板形成最小可用闭环",
        plannedDate: date(-12),
        status: "released",
        publishedAt: at(-12),
        createdAt: at(-39),
        updatedAt: at(-12),
      },
      {
        id: "release-demo",
        name: "V1.1 交付闭环",
        goal: "贯通排期、设计资产、燃尽分析与版本验收",
        plannedDate: date(10),
        status: "active",
        publishedAt: null,
        createdAt: at(-20),
        updatedAt: at(-1),
      },
      {
        id: "release-next",
        name: "V1.2 AI 辅助协作",
        goal: "让项目分析与变更建议基于事实，并经 PO 确认后生效",
        plannedDate: date(24),
        status: "planning",
        publishedAt: null,
        createdAt: at(-9),
        updatedAt: at(-1),
      },
    ]),
    sprints: {},
    members: {
      m1: { ...base.members.m1, role: "PO / Scrum Master", capacityHours: 24 },
      m2: { ...base.members.m2, role: "Frontend Engineer", capacityHours: 28 },
      m3: { ...base.members.m3, role: "Backend Engineer", capacityHours: 36 },
      m4: {
        ...base.members.m4,
        role: "QA / Full Stack Engineer",
        capacityHours: 24,
      },
      m5: {
        id: "m5",
        name: "赵悦",
        initials: "ZY",
        color: "#0891B2",
        role: "UX / Design Engineer",
        capacityHours: 16,
      },
    },
    workspace: {
      ...base.workspace,
      currentPage: "sprint",
      currentView: "board",
      selectedSprintId: "s2",
      releaseFilterId: undefined,
      showCompletedStories: true,
      ganttRangeStart: date(-25),
      ganttRangeEnd: date(24),
      storyMapZoom: 0.8,
    },
  }
  const epicRows = [
    ["ep1", "act1", "项目空间与团队"],
    ["ep2", "act1", "目标与项目用例"],
    ["ep3", "act2", "Backlog 与需求澄清"],
    ["ep4", "act2", "排期与依赖"],
    ["ep5", "act2", "设计资产与关联"],
    ["ep3b", "act3", "迭代计划与燃尽"],
    ["ep3d", "act3", "执行与阻塞处理"],
    ["ep6", "act5", "对话与受控变更"],
    ["ep8", "act5", "事实分析与风险建议"],
    ["ep9", "act6", "验收与版本范围"],
    ["ep10", "act6", "材料与可追溯交付"],
  ]
  epicRows.forEach(([id, goalId, title], order) => {
    state.epics[id] = {
      id,
      goalId,
      title,
      order,
      startDate: date(-25),
      endDate: date(24),
    }
  })
  const sprintRows = [
    {
      id: "s1",
      name: "Sprint 1 · 基础协作",
      releaseId: "release-base",
      start: -25,
      end: -12,
      status: "closed" as const,
      capacity: 32,
      goal: "完成项目空间、故事管理与看板最小闭环",
    },
    {
      id: "s2",
      name: "Sprint 2 · 交付闭环",
      releaseId: "release-demo",
      start: -9,
      end: 3,
      status: "active" as const,
      capacity: 44,
      goal: "打通排期、资产与验收；优先消除文件持久化阻塞",
    },
    {
      id: "s3",
      name: "Sprint 3 · 稳定与补齐",
      releaseId: "release-demo",
      start: 4,
      end: 10,
      status: "planning" as const,
      capacity: 22,
      goal: "收尾依赖排期与版本范围校验，处理本版本遗留项",
    },
    {
      id: "s4",
      name: "Sprint 4 · AI 辅助",
      releaseId: "release-next",
      start: 11,
      end: 24,
      status: "planning" as const,
      capacity: 28,
      goal: "接入基于事实的对话、风险建议与确认后执行",
    },
  ]
  for (const row of sprintRows) {
    state.sprints[row.id] = {
      id: row.id,
      name: row.name,
      releaseId: row.releaseId,
      startDate: date(row.start),
      endDate: date(row.end),
      status: row.status,
      capacity: row.capacity,
      velocity: row.id === "s1" ? 31 : 0,
      goal: row.goal,
      memberIds: Object.keys(state.members),
      reviewSummary:
        row.id === "s1"
          ? "示例评审：7 个基础故事通过验收；下一轮优先补齐跨视图一致性和资产持久化。"
          : "",
      goalAchieved: row.id === "s1" ? true : null,
      retrospective:
        row.id === "s1"
          ? {
              mainProblem: "初期先写界面后定实体契约，造成字段重复和联调返工。",
              nextImprovement:
                "先确认统一模型与验收边界，再按故事拆解任务；每日更新剩余工时。",
            }
          : { mainProblem: "", nextImprovement: "" },
      closedAt: row.id === "s1" ? at(-12) : null,
      createdAt: at(Math.min(-1, row.start - 4)),
      updatedAt: row.id === "s1" ? at(-12) : at(-1),
    }
  }
  type Row = [string, string, string, string | null, StoryEntity["deliveryStatus"], string, number, string, string, boolean?]
  // id / epic / title / sprint / delivery / owner / points / user action / observable acceptance / core
  const rows: Row[] = [
    [
      "us001",
      "ep1",
      "创建项目并维护团队",
      "s1",
      "accepted",
      "m1",
      5,
      "设置项目目标、日期与成员容量",
      "项目资料和成员容量保存后刷新仍然存在",
      true,
    ],
    [
      "us002",
      "ep1",
      "切换角色查看负责工作",
      "s1",
      "accepted",
      "m2",
      3,
      "按 PO 和成员身份查看可执行的操作",
      "成员只能执行允许的动作，PO 可以调整计划",
      true,
    ],
    [
      "project-usecase",
      "ep2",
      "同步项目用例与顶层目标",
      "s2",
      "accepted",
      "m5",
      5,
      "编辑项目用例图并同步故事地图的目标",
      "新增、改名和删除保持一一对应，删除先提示影响范围",
      true,
    ],
    [
      "us003",
      "ep3",
      "编写可验收的用户故事",
      "s1",
      "accepted",
      "m1",
      3,
      "填写角色、诉求和收益并补充验收条件",
      "故事描述与验收条件保存完整，草稿不能直接进入迭代",
      true,
    ],
    [
      "us021",
      "ep3",
      "维护 Backlog 顺序",
      "s1",
      "accepted",
      "m2",
      5,
      "拖动故事调整优先级与 Epic 归属",
      "调整顺序后其他视图读取同一故事，不产生副本",
      true,
    ],
    [
      "us031",
      "ep3",
      "统一故事属性编辑",
      "s2",
      "pending_acceptance",
      "m2",
      3,
      "在抽屉中维护负责人、排期和验收条件",
      "保存后地图、甘特和看板展示同一份属性",
    ],
    [
      "us024",
      "ep4",
      "联动故事地图与甘特排期",
      "s2",
      "in_progress",
      "m2",
      8,
      "在两种视图之间切换并调整日期",
      "拖动日期后统一更新故事与任务，并提示依赖冲突",
      true,
    ],
    [
      "us025",
      "ep4",
      "检查前置依赖与影响范围",
      "s3",
      "planned",
      "m3",
      5,
      "维护前置任务并查看延期影响",
      "新增依赖拒绝环路，前置未完成时执行项显示阻塞",
    ],
    [
      "cand-001",
      "ep4",
      "讨论跨迭代关键路径提示",
      null,
      "backlog",
      "m1",
      3,
      "在规划时识别跨迭代的关键依赖链",
      "先明确关键路径计算口径和提示位置",
    ],
    [
      "us026",
      "ep5",
      "上传并关联设计与交付资产",
      "s2",
      "in_progress",
      "m3",
      5,
      "上传文件、预览并关联故事",
      "刷新后文件可读取，错误类型和超大文件有明确反馈",
      true,
    ],
    [
      "uml-assets",
      "ep5",
      "在线编辑 UML 设计资产",
      "s2",
      "in_progress",
      "m5",
      5,
      "编辑用例、时序和类图并保存版本",
      "图形和源码往返编辑不丢失节点关系",
    ],
    [
      "cand-002",
      "ep5",
      "澄清设计资产差异比较",
      null,
      "backlog",
      "m5",
      3,
      "",
      "待确认比较对象与最小交付范围",
    ],
    [
      "us022",
      "ep3b",
      "将故事拆解为工程任务",
      "s1",
      "accepted",
      "m3",
      5,
      "拆分任务与子任务并分配负责人",
      "子任务继承故事交付范围，父子工时不重复统计",
      true,
    ],
    [
      "sprint-plan",
      "ep3b",
      "按容量编制迭代计划",
      "s1",
      "accepted",
      "m1",
      5,
      "选择同一 Release 的就绪故事进入迭代",
      "未分配 Release 的故事不能进入 Sprint，容量超出时有提示",
      true,
    ],
    [
      "sprint-burndown",
      "ep3b",
      "按真实快照查看燃尽趋势",
      "s2",
      "in_progress",
      "m4",
      5,
      "查看理想、实际和预测剩余工时",
      "更新执行叶节点后刷新当天快照，历史日期不被当前进度改写",
      true,
    ],
    [
      "us023",
      "ep3d",
      "查看个人负责的执行项",
      "s1",
      "accepted",
      "m2",
      5,
      "筛选并定位我的任务与子任务",
      "成员筛选与任务定位可用，空结果有清晰反馈",
    ],
    [
      "us029",
      "ep3d",
      "在看板推进任务并提交成果",
      "s2",
      "pending_acceptance",
      "m4",
      5,
      "更新状态、进度并提交可核验的成果",
      "提交包含成果说明，任务完成不会直接视为故事验收通过",
      true,
    ],
    [
      "block-track",
      "ep3d",
      "管理阻塞与恢复执行",
      "s2",
      "in_progress",
      "m3",
      3,
      "记录阻塞等级与原因并在解决后恢复",
      "严重阻塞参与 Release 发布门禁，解除后保留处理记录",
    ],
    [
      "us028",
      "ep6",
      "基于项目事实询问 AI",
      "s4",
      "planned",
      "m3",
      5,
      "让 AI 引用当前项目事实回答问题",
      "回复区分事实与建议，并能定位引用的故事或任务",
      true,
    ],
    [
      "ai-proposal",
      "ep6",
      "确认 AI 变更后再应用",
      "s4",
      "planned",
      "m2",
      8,
      "审查 AI 方案差异后逐项确认执行",
      "未确认不得写入项目，事实变化后旧建议需要重新校验",
      true,
    ],
    [
      "us027",
      "ep8",
      "分析成员剩余工作与容量",
      "s4",
      "planned",
      "m3",
      5,
      "查看基于剩余工时的容量风险",
      "统计只计执行叶节点，建议可追溯到具体执行项",
    ],
    [
      "ai-risk",
      "ep8",
      "评估 Release 延期方案",
      null,
      "backlog",
      "m1",
      5,
      "根据价值、风险与依赖比较延期方案",
      "只生成建议，调整版本必须由 PO 确认并记录原因",
    ],
    [
      "us030",
      "ep9",
      "按验收条件接收或退回故事",
      "s2",
      "accepted",
      "m1",
      5,
      "核对成果与条件后完成验收",
      "接收和退回均保留记录，退回可指定需要返工的任务",
      true,
    ],
    [
      "us034",
      "ep9",
      "按核心故事检查发布条件",
      "s2",
      "in_progress",
      "m1",
      5,
      "查看 Release 核心故事、风险和发布门禁",
      "核心故事均验收且无严重阻塞才允许发布",
      true,
    ],
    [
      "release-scope",
      "ep9",
      "跨迭代维护版本范围",
      "s3",
      "planned",
      "m1",
      3,
      "将未完成故事留在本版本或移到下一版本",
      "改版本时提示 Sprint 影响，确认后更新且保留调整原因",
    ],
    [
      "backup",
      "ep9",
      "导出并恢复完整项目",
      null,
      "backlog",
      "m3",
      3,
      "导出项目 JSON 并验证恢复结果",
      "恢复后 Release、燃尽历史、用例图和资产关联保持一致",
    ],
    [
      "us032",
      "ep10",
      "整理迭代交付材料",
      null,
      "backlog",
      "m4",
      3,
      "按版本汇总已验收故事与成果",
      "材料有真实引用和未完成说明，不把待验收项列为已交付",
    ],
    [
      "audit",
      "ep10",
      "补充变更审查清单",
      null,
      "backlog",
      "m1",
      2,
      "核对关键变更的提出人与确认记录",
      "审查清单列出缺失证据和负责人",
    ],
    [
      "discovery",
      "",
      "调研外部日历同步的必要性",
      null,
      "backlog",
      "m1",
      2,
      "",
      "先访谈团队是否确实需要外部日历集成",
    ],
  ]
  const benefits: Record<string, string> = {
    us001: "团队能在同一个项目空间中对齐范围和人员投入",
    us002: "成员能专注自己的工作，计划调整也有明确责任人",
    "project-usecase": "讨论项目范围时，用例图和故事地图不会各说各话",
    us003: "开发和验收使用同一套明确标准，减少口头理解偏差",
    us021: "需求价值变化后可以调整顺序，而不丢失任务和讨论",
    us031: "修改一次属性即可在各视图一致查看，减少重复维护",
    us024: "计划变化可以直接反馈到工程排期，及时发现交付冲突",
    us025: "团队先解除关键前置阻塞，避免下游无效等待",
    "cand-001": "团队能判断关键路径提示是否值得占用下一轮开发容量",
    us026: "设计和成果材料可以随需求追踪，并在交接后继续读取",
    "uml-assets": "设计讨论可以直接修订模型，图形与源码始终保持一致",
    "cand-002": "先确认比较设计版本的实际用途，避免为演示增加功能",
    us022: "每个需求都能落实到负责人和可执行的小任务",
    "sprint-plan": "迭代承诺与版本目标、团队可用容量保持一致",
    "sprint-burndown": "团队及时发现燃尽速度不足，提前调整范围或投入",
    us023: "成员清楚自己下一步要完成什么，减少反复询问",
    us029: "任务进度与成果证据可查，PO 能判断是否具备验收条件",
    "block-track": "阻塞可以被及时处理，重大问题不会在发布时才暴露",
    us028: "团队能快速了解项目现状，又能追溯 AI 回答的依据",
    "ai-proposal": "团队保留最终决策权，避免 AI 建议直接改坏执行计划",
    us027: "负载讨论基于工作事实，能够形成具体的任务分配方案",
    "ai-risk": "PO 可以在保价值、控风险与按时发布之间做出有依据的取舍",
    us030: "验收结论可追溯，返工内容有明确责任与重新提交路径",
    us034: "发布决定基于核心范围的验收结果和阻塞情况",
    "release-scope": "未完成需求有明确去向，版本范围调整可以追溯",
    backup: "换设备或恢复项目时不丢失执行历史与设计关系",
    us032: "交付材料准确反映本版本成果，不把计划当作已完成工作",
    audit: "关键变更的依据和确认责任能够在复盘时查清",
    discovery: "先验证集成需求的价值，再决定是否投入开发",
  }
  const secondaryCriteria: Record<string, string> = {
    ep1: "PO 和成员可执行的操作符合各自职责",
    ep2: "项目用例与顶层目标按同一 ID 对应，修改不会生成第二份名称",
    ep3: "不完整故事保持候选或草稿，不能直接进入执行迭代",
    ep4: "排期调整保留任务归属，影响范围可定位到具体执行项",
    ep5: "读取、解析或保存失败时保留原内容，并给出可操作的反馈",
    ep3b: "切换迭代后范围同步更新，父子任务工时只计算一次",
    ep3d: "任务执行状态与 Story 验收结果分开记录，不能自动替 PO 验收",
    ep6: "未确认或前提已变化的建议不会写入项目",
    ep8: "结论引用具体任务和统计口径，缺失事实时明确说明",
    ep9: "只有 PO 可以作出验收或版本调整决定，并保留原因记录",
    ep10: "缺失成果和未完成事项明确标注，不能用推测补全",
  }
  rows.forEach(
    (
      [
        id,
        epicId,
        title,
        sprintId,
        deliveryStatus,
        assigneeId,
        storyPoints,
        action,
        criterion,
        core,
      ],
      order,
    ) => {
      const sprint = sprintId ? state.sprints[sprintId] : undefined
      const releaseId =
        sprint?.releaseId ??
        (["ai-risk", "us032"].includes(id)
          ? "release-next"
          : ["backup", "cand-001"].includes(id)
            ? "release-demo"
            : null)
      const maturityStatus = ["discovery", "cand-001", "audit"].includes(id)
        ? "candidate"
        : id === "cand-002"
          ? "draft"
          : "ready"
      const accepted = deliveryStatus === "accepted"
      const story: StoryEntity = {
        id,
        title,
        epicId: epicId || null,
        sprintId,
        releaseId,
        deliveryStatus,
        maturityStatus,
        assigneeId,
        source: id.startsWith("cand-") ? "review" : "manual",
        collaboratorIds: [id === "us026" ? "m5" : "m4"].filter(
          (member) => member !== assigneeId,
        ),
        as: assigneeId === "m1" ? "产品负责人" : "团队成员",
        iWant: action,
        soThat: action ? benefits[id] : "",
        priority: core ? "high" : storyPoints >= 5 ? "medium" : "low",
        storyPoints,
        businessValue: core ? 5 : 3,
        expectedBenefit: criterion,
        risk: "none",
        riskNote: "",
        startDate: sprint?.startDate ?? date(4),
        dueDate: sprint?.endDate ?? date(24),
        isReleaseCore: Boolean(core),
        releaseChanges: [],
        order,
        taskIds: [],
        acceptanceCriteriaIds: [],
        discussionIds: [],
        acceptanceLog: accepted
          ? [
              {
                id: "accept-" + id,
                result: "accepted",
                byId: "m1",
                at: sprintId === "s1" ? at(-12) : at(-2),
                note: "示例验收：已核对验收条件与关联成果，允许交付。",
              },
            ]
          : [],
        createdAt: at(-30),
        updatedAt: at(-1),
      }
      if (id === "us026")
        story.acceptanceLog.push({
          id: "return-us026",
          result: "returned",
          byId: "m1",
          at: at(-2),
          note: "示例退回：刷新后附件引用失效；补齐本地文件持久化与错误恢复后重新提交。",
        })
      for (const [index, content] of [
        criterion,
        secondaryCriteria[epicId] ?? "确认真实使用场景后再补齐验收条件",
      ].entries()) {
        const criterionId = id + "-ac-" + index
        state.acceptanceCriteria[criterionId] = {
          id: criterionId,
          storyId: id,
          content,
          order: index,
          satisfied:
            accepted ||
            (deliveryStatus === "pending_acceptance" && index === 0),
        }
        story.acceptanceCriteriaIds.push(criterionId)
      }
      state.stories[id] = story
    },
  )

  type Work = [string, TaskType, string, number, TaskStatus, number?]
  const plans: Record<string, Work[]> = {
    us001: [
      ["项目资料表单与保存", "frontend", "m2", 4, "done"],
      ["团队资料与容量维护", "backend", "m3", 3, "done"],
    ],
    us002: [["角色切换与动作校验", "backend", "m3", 3, "done"]],
    "project-usecase": [
      ["复用 UML 画布与目标同步", "frontend", "m5", 6, "done"],
      ["目标删除影响确认", "test", "m4", 3, "done"],
    ],
    us003: [["故事表单和验收条件", "frontend", "m2", 4, "done"]],
    us021: [["故事排序与持久化", "frontend", "m2", 5, "done"]],
    us031: [
      ["抽屉属性表单", "frontend", "m2", 4, "done"],
      ["跨视图回归核验", "test", "m4", 2, "done"],
    ],
    us024: [
      ["日期轴与视图切换", "frontend", "m2", 8, "in_progress", 55],
      ["排期数据契约", "database", "m3", 4, "done"],
      ["拖动日期边界校验", "frontend", "m2", 6, "in_progress", 35],
      ["跨视图排期回归", "test", "m4", 4, "blocked", 0],
    ],
    us025: [
      ["依赖实体与环路校验", "backend", "m3", 5, "todo"],
      ["依赖连线与影响提示", "frontend", "m2", 6, "todo"],
    ],
    us026: [
      ["文件上传及预览", "frontend", "m5", 5, "done"],
      ["附件持久化与错误恢复", "backend", "m3", 8, "blocked", 30],
      ["刷新后文件读取回归", "test", "m4", 4, "todo"],
    ],
    "uml-assets": [
      ["画布节点与连线编辑", "design", "m5", 5, "review", 100],
      ["源码与图形往返校验", "test", "m4", 4, "in_progress", 60],
    ],
    us022: [
      ["任务与子任务统一模型", "database", "m3", 5, "done"],
      ["工程拆解编辑器", "frontend", "m2", 5, "done"],
    ],
    "sprint-plan": [
      ["Release 与 Sprint 范围校验", "backend", "m3", 4, "done"],
      ["迭代成员和容量配置", "frontend", "m1", 3, "done"],
    ],
    "sprint-burndown": [
      ["执行叶节点工时与快照", "backend", "m3", 6, "done"],
      ["三条曲线与悬浮提示", "frontend", "m2", 6, "in_progress", 70],
      ["缺失历史与负速度边界", "test", "m4", 4, "review", 100],
    ],
    us023: [["个人任务筛选和定位", "frontend", "m2", 4, "done"]],
    us029: [
      ["状态流转与成果提交", "frontend", "m2", 5, "done"],
      ["父子执行项与验收联动", "test", "m4", 4, "done"],
    ],
    "block-track": [
      ["阻塞等级与恢复状态", "backend", "m3", 4, "in_progress", 50],
      ["严重阻塞发布门禁校验", "test", "m4", 3, "todo"],
    ],
    us028: [
      ["项目事实上下文适配", "backend", "m3", 6, "todo"],
      ["对话引用与事实定位", "frontend", "m2", 5, "todo"],
    ],
    "ai-proposal": [
      ["变更草案与前置条件", "backend", "m3", 8, "todo"],
      ["逐项确认交互", "frontend", "m2", 6, "todo"],
      ["过期方案拒绝测试", "test", "m4", 4, "todo"],
    ],
    us027: [["剩余工时与容量口径", "backend", "m3", 5, "todo"]],
    us030: [
      ["故事验收与退回记录", "backend", "m3", 4, "done"],
      ["验收界面和条件核对", "frontend", "m1", 4, "done"],
    ],
    us034: [
      ["Release 验收进度聚合", "backend", "m3", 5, "done"],
      ["发布前检查与确认", "frontend", "m1", 4, "in_progress", 60],
      ["严重阻塞门禁测试", "test", "m4", 3, "todo"],
    ],
    backup: [["项目 JSON 导出与恢复演练", "devops", "m3", 4, "todo"]],
    "release-scope": [
      ["版本调整确认与原因记录", "frontend", "m1", 4, "todo"],
      ["跨版本清理迭代归属", "backend", "m3", 3, "todo"],
    ],
  }
  for (const [storyId, items] of Object.entries(plans)) {
    const story = state.stories[storyId]
    items.forEach(
      ([title, type, assigneeId, estimate, status, progress], index) => {
        const id = "task-" + storyId + "-" + (index + 1)
        const done = status === "done",
          submitted = done || status === "review"
        const task: TaskEntity = {
          id,
          storyId,
          title,
          type,
          assigneeId,
          estimate,
          status,
          progress: progress ?? (done ? 100 : 0),
          startDate: story.startDate,
          endDate: story.dueDate,
          order: index,
          subtaskIds: [],
          blockReasons: [],
          blockedSeverity: "normal",
          statusBeforeBlocked: status === "blocked" ? "todo" : null,
          resultSummary: submitted
            ? "示例成果：" + title + "已完成，核验说明见关联交付记录。"
            : "",
          resultUrl: "",
          resultLinks: [],
          resultAssetIds: submitted ? ["asset-demo-results"] : [],
          submittedAt: submitted
            ? story.sprintId === "s1"
              ? at(-13)
              : at(-2)
            : null,
          isMilestone:
            (storyId === "us034" || storyId === "us025") &&
            index === items.length - 1,
          qualityStatus: submitted ? "good" : "pending",
          qualityNote: "",
        }
        state.tasks[id] = task
        story.taskIds.push(id)
      },
    )
  }
  // Mixed subtask states demonstrate inherited scope and leaf-only accounting.
  const split = (
    taskId: string,
    children: Array<[string, number, TaskStatus, number, string]>,
  ) => {
    const task = state.tasks[taskId]
    children.forEach(
      ([title, estimate, status, progress, assigneeId], order) => {
        const id = taskId + "-sub-" + (order + 1),
          submitted = ["done", "review"].includes(status)
        state.subtasks[id] = {
          id,
          taskId,
          title,
          estimate,
          status,
          progress,
          assigneeId,
          order,
          done: status === "done",
          startDate: task.startDate,
          endDate: task.endDate,
          blockReasons: [],
          blockedSeverity: "normal",
          statusBeforeBlocked: null,
          resultSummary: submitted ? "示例成果：" + title + "已提交核验。" : "",
          resultUrl: "",
          resultLinks: [],
          resultAssetIds: submitted ? ["asset-demo-results"] : [],
          submittedAt: submitted ? at(-2) : null,
          qualityStatus: submitted ? "good" : "pending",
          qualityNote: "",
        }
        task.subtaskIds.push(id)
      },
    )
    task.estimate = children.reduce((sum, child) => sum + child[1], 0)
    task.progress = Math.round(
      children.reduce((sum, child) => sum + child[1] * child[3], 0) /
        task.estimate,
    )
  }
  split("task-us024-1", [
    ["日期头与缩放", 3, "done", 100, "m2"],
    ["拖动与滚动定位", 5, "in_progress", 40, "m2"],
  ])
  split("task-us026-2", [
    ["文件写入和引用契约", 3, "review", 100, "m3"],
    ["刷新读取与失败恢复", 5, "blocked", 0, "m3"],
  ])
  split("task-uml-assets-2", [
    ["用例图往返", 1, "done", 100, "m5"],
    ["时序图消息保序", 1, "in_progress", 60, "m4"],
    ["类图关系回归", 2, "todo", 0, "m4"],
  ])
  split("task-sprint-burndown-2", [
    ["折线与图例", 3, "done", 100, "m2"],
    ["悬浮详情与预测区间", 3, "in_progress", 40, "m2"],
  ])
  const severe = state.tasks["task-us026-2"]
  severe.blockedSeverity = "severe"
  severe.statusBeforeBlocked = "in_progress"
  severe.blockReasons = [
    {
      id: "block-storage",
      source: "manual",
      message: "演示场景：刷新后附件引用失效，需完成持久化修复后重新验收。",
      relatedTaskId: null,
      dependencyId: null,
      createdAt: at(-2),
    },
  ]
  state.subtasks[severe.subtaskIds[1]].blockedSeverity = "severe"
  state.subtasks[severe.subtaskIds[1]].statusBeforeBlocked = "in_progress"
  state.subtasks[severe.subtaskIds[1]].blockReasons = severe.blockReasons.map(
    (reason) => ({ ...reason, id: reason.id + "-subtask" }),
  )
  severe.qualityStatus = "attention"
  severe.qualityNote = "PO 已退回：刷新读取失败，属于发布前必须修复的问题。"
  const dependency = {
    id: "dep-gantt-test",
    sourceTaskId: "task-us024-3",
    targetTaskId: "task-us024-4",
    type: "FS" as const,
    createdAt: at(-5),
  }
  state.dependencies[dependency.id] = dependency
  state.tasks[dependency.targetTaskId].blockReasons = [
    {
      id: "block-dep-gantt-test",
      source: "dependency",
      message: "等待前置任务 TASK-US024-3「拖动日期边界校验」完成",
      relatedTaskId: dependency.sourceTaskId,
      dependencyId: dependency.id,
      createdAt: at(-5),
    },
  ]
  // An overdue story and an in-progress item past its planned date, within the current Sprint.
  state.stories.us026.dueDate = date(-1)
  for (const taskId of state.stories.us026.taskIds) {
    state.tasks[taskId].endDate = date(-1)
    for (const childId of state.tasks[taskId].subtaskIds)
      state.subtasks[childId].endDate = date(-1)
  }
  state.tasks["task-us024-3"].endDate = date(-1)
  const moved = state.stories["us032"]
  moved.releaseChanges = [
    {
      fromReleaseId: "release-demo",
      toReleaseId: "release-next",
      previousSprintId: "s2",
      reason:
        "示例范围调整：优先修复资产持久化与发布门禁，材料自动整理延至 AI 版本。",
      at: at(-3),
      byId: "m1",
    },
  ]
  state.risks = record([
    {
      id: "risk-storage",
      title: "附件刷新后无法读取",
      targetType: "task",
      targetId: severe.id,
      level: "high",
      ownerId: "m3",
      status: "mitigating",
      description: "示例：文件引用已保存，但读取恢复流程未通过验收。",
      impact: "核心资产故事被退回，V1.1 暂不能发布。",
      mitigation: "先修复刷新读取，再由 QA 回归并交 PO 复验。",
      createdAt: at(-3),
      updatedAt: at(-1),
    },
    {
      id: "risk-gantt",
      title: "排期边界回归可能延期",
      targetType: "story",
      targetId: "us024",
      level: "medium",
      ownerId: "m2",
      status: "open",
      description: "拖动边界校验仍在进行，后置测试尚未启动。",
      impact: "可能影响本迭代核心故事验收。",
      mitigation: "优先完成边界校验，复杂依赖提示留到 Sprint 3。",
      createdAt: at(-3),
      updatedAt: at(-1),
    },
    {
      id: "risk-capacity",
      title: "测试工作在迭代末集中",
      targetType: "sprint",
      targetId: "s2",
      level: "medium",
      ownerId: "m1",
      status: "mitigating",
      description: "多个待验收项和回归项集中由王晨负责。",
      impact: "即使开发完成，验收也可能滞后。",
      mitigation: "李娜协助基础回归，PO 每日优先处理待验收项。",
      createdAt: at(-2),
      updatedAt: at(-1),
    },
    {
      id: "risk-model-resolved",
      title: "父子任务工时重复累计",
      targetType: "story",
      targetId: "us022",
      level: "low",
      ownerId: "m3",
      status: "resolved",
      description: "早期统计同时累计父任务和子任务。",
      impact: "容量和燃尽初始工时偏高。",
      mitigation: "改为只统计执行叶节点，已完成回归并关闭。",
      createdAt: at(-20),
      updatedAt: at(-12),
    },
  ])
  state.discussions = record([
    {
      id: "discussion-scope",
      targetType: "story",
      targetId: "us024",
      storyId: "us024",
      authorId: "m1",
      isAI: false,
      createdAt: at(-3),
      content:
        "本轮先保证日期调整在地图和甘特之间一致，跨迭代关键路径留到下一轮，避免联调范围继续扩大。",
    },
    {
      id: "discussion-return",
      targetType: "task",
      targetId: severe.id,
      storyId: "us026",
      authorId: "m4",
      isAI: false,
      createdAt: at(-2),
      content:
        "上传后当次预览正常，但刷新页面后读取失败。已关联复现记录，请修复恢复流程后重新提交。",
    },
    {
      id: "discussion-move",
      targetType: "story",
      targetId: "us032",
      storyId: "us032",
      authorId: "m1",
      isAI: false,
      createdAt: at(-3),
      content:
        "已确认移至 V1.2；本轮保留手动导出，优先保障核心交付。调整原因已记入版本变更记录。",
    },
    {
      id: "discussion-project",
      targetType: "project",
      targetId: state.project.id,
      authorId: "m1",
      isAI: false,
      createdAt: at(-1),
      content:
        "这是一套完整示例数据。建议先查看 Sprint 2 燃尽与待验收项，再检查 V1.1 核心故事和严重阻塞，最后尝试分配未归属版本的 Backlog。",
    },
  ])
  for (const item of Object.values(state.discussions))
    if (item.storyId) state.stories[item.storyId].discussionIds.push(item.id)

  // Reuse substantive UML examples, but repair every legacy link to the current entities.
  for (const asset of Object.values(base.assets)) {
    state.assets[asset.id] = {
      ...asset,
      links: asset.links.map((link) =>
        link.targetType === "task"
          ? { ...link, targetId: state.stories.us024.taskIds[1] }
          : link,
      ),
      createdAt: at(-6),
      updatedAt: at(-1),
    }
  }
  const classAsset = state.assets["asset-class-project-model"]
  const classSource = classAsset.sourceText
    .replace(
      "Project *-- Sprint : 组合",
      "Project *-- Release : 组合\nRelease o-- Sprint : 迭代\nRelease o-- Story : 版本范围\nProject *-- Goal : 目标\nGoal *-- Epic : 史诗\nEpic *-- Story : 故事",
    )
    .replace(
      "@enduml",
      'class "Release" as Release {\n  - goal: string\n  - plannedDate: LocalDate\n}\nclass "Goal" as Goal {\n  - title: string\n}\nclass "Epic" as Epic {\n  - goalId: string\n}\n@enduml',
    )
  classAsset.umlData = parseUmlSource("class", classSource).diagram
  classAsset.sourceText = generatePlantUml(classAsset.umlData)
  classAsset.preview = "目标、Epic、Story 与 Release / Sprint 的独立交付维度"
  const resultTasks = Object.values(state.tasks).filter(
    (task) => task.submittedAt,
  )
  state.assets["asset-demo-results"] = {
    id: "asset-demo-results",
    name: "示例交付与验收核验记录.md",
    kind: "attachment",
    mimeType: "text/markdown",
    storage: "inline",
    contentRef: "",
    sourceText:
      "# 示例交付与验收核验记录\n\n本文为演示数据，不是本项目真实测试报告。\n\n" +
      resultTasks
        .map(
          (task) =>
            "## " +
            task.title +
            "\n- 所属故事：" +
            state.stories[task.storyId].title +
            "\n- 提交人：" +
            state.members[task.assigneeId].name +
            "\n- 核验：" +
            state.stories[task.storyId].expectedBenefit +
            "\n- 状态：" +
            (state.stories[task.storyId].deliveryStatus === "accepted"
              ? "示例 PO 已验收"
              : "仅任务已提交，故事尚未验收") +
            "\n",
        )
        .join("\n"),
    links: [...new Set(resultTasks.map((task) => task.storyId))].map(
      (targetId) => ({ targetType: "story" as const, targetId }),
    ),
    preview: "示例提交说明、核验边界与 PO 验收状态",
    version: "v1.0",
    createdAt: at(-12),
    updatedAt: at(-1),
  }
  state.assets["asset-scenario-guide"] = {
    id: "asset-scenario-guide",
    name: "示例项目使用指南.md",
    kind: "attachment",
    mimeType: "text/markdown",
    storage: "inline",
    contentRef: "",
    sourceText:
      "# 示例项目使用指南\n\n初始化基准日：" +
      today +
      "（Asia/Shanghai）。本项目的人员与执行记录均为模拟示例。\n\n- Sprint 1：关闭、复盘和已验收成果。\n- Sprint 2：实际执行、待验收、退回、严重阻塞、普通依赖阻塞与燃尽趋势。\n- Sprint 3：同一 Release 的后续迭代，可承接未完成故事。\n- Sprint 4：下一 Release 的计划项。\n- Backlog：候选、草稿、就绪与尚未分配 Release 的故事。\n- V1.0：已发布；V1.1：核心故事尚有阻塞；V1.2：规划中且有带原因的范围迁入。\n- 工时：有子任务时只统计子任务，父任务是汇总节点。\n- 历史：燃尽快照为预设的模拟每日记录，包含持平、范围增加和下降；后续操作沿用正常快照逻辑，不用当前状态倒推过去。\n- 项目用例图：与五个目标一一对应，独立于 Story 设计资产。\n",
    links: [{ targetType: "project", targetId: state.project.id }],
    preview: "场景入口、数据来源及操作说明",
    version: "v1.0",
    createdAt: at(0),
    updatedAt: at(0),
  }
  state.projectUseCase = normalizeProjectUseCase(state.activities)
  state.projectUseCase.actors.push({
    id: "actor-member",
    kind: "actor",
    label: "团队成员",
    x: 60,
    y: 430,
    details: [],
  })
  for (const [index, goalId] of ["act2", "act3", "act5"].entries())
    state.projectUseCase.edges.push({
      id: "member-goal-" + index,
      source: "actor-member",
      target: "goal:" + goalId,
      relation: "association",
      label: "",
      order: 20 + index,
    })
  for (const epic of Object.values(state.epics)) {
    const children = Object.values(state.stories).filter(
      (story) => story.epicId === epic.id,
    )
    epic.startDate = children.map((story) => story.startDate).sort()[0]
    epic.endDate = children
      .map((story) => story.dueDate)
      .sort()
      .at(-1)!
  }
  const work = (sprintId: string) => {
    const leaves = Object.values(state.tasks)
      .filter((task) => state.stories[task.storyId].sprintId === sprintId)
      .flatMap<TaskEntity | SubtaskEntity>((task) =>
        task.subtaskIds.length
          ? task.subtaskIds.map((id) => state.subtasks[id])
          : [task],
      )
    return {
      total: roundHours(leaves.reduce((sum, item) => sum + item.estimate, 0)),
      remaining: roundHours(
        leaves.reduce((sum, item) => sum + remainingWork(item), 0),
      ),
      count: leaves.length,
    }
  }
  // Explicit simulation snapshots, not interpolation of present-day task progress.
  const current = work("s2"),
    closed = work("s1")
  for (const [sprintId, offsets, totals, remaining, counts] of [
    [
      "s1",
      [-25, -23, -20, -18, -15, -12],
      [
        closed.total,
        closed.total,
        closed.total,
        closed.total,
        closed.total,
        closed.total,
      ],
      [
        closed.total,
        closed.total - 4,
        closed.total - 12,
        closed.total - 19,
        5,
        0,
      ],
      Array(6).fill(closed.count),
    ],
    [
      "s2",
      [-9, -8, -7, -6, -5, -4, -3, -2, -1, 0],
      [
        current.total - 8,
        current.total - 8,
        current.total - 8,
        current.total - 8,
        current.total,
        current.total,
        current.total,
        current.total,
        current.total,
        current.total,
      ],
      [
        current.total - 8,
        current.total - 15,
        current.total - 15,
        current.total - 24,
        current.total - 16,
        current.total - 26,
        current.total - 38,
        current.remaining + 12,
        current.remaining + 5,
        current.remaining,
      ],
      [
        current.count - 2,
        current.count - 2,
        current.count - 2,
        current.count - 2,
        current.count,
        current.count,
        current.count,
        current.count,
        current.count,
        current.count,
      ],
    ],
  ] as Array<[string, number[], number[], number[], number[]]>) {
    state.sprintBurndowns[sprintId] = {
      sprintId,
      baselineHours: totals[0],
      baselineDate: date(offsets[0]),
      baselineKind: "sprint-start",
      days: Object.fromEntries(
        offsets.map((offset, index) => [
          date(offset),
          {
            date: date(offset),
            capturedAt: at(offset),
            totalHours: totals[index],
            remainingHours: roundHours(remaining[index]),
            itemCount: counts[index],
          },
        ]),
      ),
    }
  }
  state.history = [
    {
      id: "history-demo-init",
      createdAt: at(0),
      actorId: "m1",
      objectType: "project",
      objectId: state.project.id,
      field: "初始化完整示例数据",
      before: null,
      after: "所有历史记录和成果均为模拟场景，非真实执行凭证",
      source: "system",
    },
  ]
  return applyDemoSchedule(state)
}
