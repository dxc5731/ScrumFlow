import type {
  Member, Sprint, UserActivity, UserTask, Epic, UserStory,
  EngineeringTask, ChatMessage, Risk,
} from "./types";

// ─── Project ─────────────────────────────────────────────────────────────────
export const PROJECT_NAME = "ScrumFlow AI 项目管理平台研发";
export const PROJECT_SUBTITLE = "打通需求规划、工程执行与 AI 项目协作的完整 Scrum 工作流";

// ─── Members ─────────────────────────────────────────────────────────────────
export const members: Member[] = [
  { id: "m1", name: "张伟", initials: "ZW", color: "#4F46E5", role: "DRI / Scrum Master", capacityHours: 40 },
  { id: "m2", name: "李娜", initials: "LN", color: "#059669", role: "Frontend Engineer", capacityHours: 40 },
  { id: "m3", name: "陈林", initials: "CL", color: "#D97706", role: "Backend Engineer", capacityHours: 40 },
  { id: "m4", name: "王晨", initials: "WC", color: "#7C3AED", role: "Full Stack Engineer", capacityHours: 40 },
];

export const currentDRI = "m1";
export const nextDRI = "m2";

// ─── Sprints ──────────────────────────────────────────────────────────────────
export const sprints: Sprint[] = [
  {
    id: "s1", name: "Sprint 1",
    startDate: "2026-08-24", endDate: "2026-09-04",
    goal: "搭建项目骨架，完成基础 Story 管理与 Sprint 看板功能",
    status: "closed", velocity: 28, capacity: 28,
  },
  {
    id: "s2", name: "Sprint 2",
    startDate: "2026-09-05", endDate: "2026-09-18",
    goal: "完成用户故事地图、工程任务和甘特图之间的核心数据联动，形成需求规划到工程排期的完整链路",
    status: "active", velocity: 0, capacity: 30,
  },
  {
    id: "s3", name: "Sprint 3",
    startDate: "2026-09-19", endDate: "2026-10-02",
    goal: "完成 AI Project Agent 核心功能，实现项目风险分析、工作量预警与自然语言操作",
    status: "planning", velocity: 0, capacity: 30,
  },
];

// ─── User Activities ──────────────────────────────────────────────────────────
export const userActivities: UserActivity[] = [
  { id: "act1", title: "启动项目", taskIds: ["t1", "t2"], colorClass: "act-1", textColor: "#5B21B6" },
  { id: "act2", title: "规划需求", taskIds: ["t3", "t4", "t5"], colorClass: "act-2", textColor: "#1D4ED8" },
  { id: "act3", title: "制定迭代", taskIds: ["t6", "t7"], colorClass: "act-3", textColor: "#065F46" },
  { id: "act4", title: "执行任务", taskIds: ["t8", "t9"], colorClass: "act-4", textColor: "#92400E" },
  { id: "act5", title: "跟踪与协作", taskIds: ["t10", "t11"], colorClass: "act-1", textColor: "#5B21B6" },
  { id: "act6", title: "验收与交付", taskIds: ["t12"], colorClass: "act-2", textColor: "#1D4ED8" },
];

// ─── User Tasks ───────────────────────────────────────────────────────────────
export const userTasks: UserTask[] = [
  { id: "t1", title: "创建项目与团队", activityId: "act1" },
  { id: "t2", title: "项目愿景与 Use Case", activityId: "act1" },
  { id: "t3", title: "编写 User Story", activityId: "act2" },
  { id: "t4", title: "软件工程设计资产", activityId: "act2" },
  { id: "t5", title: "故事地图与甘特排期", activityId: "act2" },
  { id: "t6", title: "Sprint 计划与工程任务", activityId: "act3" },
  { id: "t7", title: "迭代容量管理", activityId: "act3" },
  { id: "t8", title: "任务执行与状态更新", activityId: "act4" },
  { id: "t9", title: "阻塞处理", activityId: "act4" },
  { id: "t10", title: "项目聊天与 @AI", activityId: "act5" },
  { id: "t11", title: "工作量与风险跟踪", activityId: "act5" },
  { id: "t12", title: "Sprint Review / 实验交付", activityId: "act6" },
];

// ─── Epics ────────────────────────────────────────────────────────────────────
export const epics: Epic[] = [
  { id: "ep1", taskId: "t1", title: "EP-01 项目启动", color: "#EDE9FE", textColor: "#5B21B6" },
  { id: "ep2", taskId: "t2", title: "EP-01 项目启动", color: "#EDE9FE", textColor: "#5B21B6" },
  { id: "ep3", taskId: "t3", title: "EP-02 需求规划", color: "#DBEAFE", textColor: "#1D4ED8" },
  { id: "ep5", taskId: "t4", title: "EP-05 设计资产", color: "#DBEAFE", textColor: "#1D4ED8" },
  { id: "ep4", taskId: "t5", title: "EP-04 甘特排期", color: "#DBEAFE", textColor: "#1D4ED8" },
  { id: "ep3b", taskId: "t6", title: "EP-03 Sprint 执行", color: "#D1FAE5", textColor: "#065F46" },
  { id: "ep3c", taskId: "t7", title: "EP-03 Sprint 执行", color: "#D1FAE5", textColor: "#065F46" },
  { id: "ep3d", taskId: "t8", title: "EP-03 Sprint 执行", color: "#D1FAE5", textColor: "#065F46" },
  { id: "ep3e", taskId: "t9", title: "EP-03 Sprint 执行", color: "#D1FAE5", textColor: "#065F46" },
  { id: "ep6", taskId: "t10", title: "EP-06 协作", color: "#FEF3C7", textColor: "#92400E" },
  { id: "ep8", taskId: "t11", title: "EP-08 分析风险", color: "#FEF3C7", textColor: "#92400E" },
  { id: "ep9", taskId: "t12", title: "EP-09 复盘交付", color: "#F3E8FF", textColor: "#6D28D9" },
];

// ─── Engineering Tasks ────────────────────────────────────────────────────────
const engTasksMap: Record<string, EngineeringTask[]> = {
  "us001": [
    { id: "fe-001-1", title: "项目创建向导 UI", type: "frontend", assigneeId: "m2", status: "done", estimate: 6, startDate: "2026-08-24", endDate: "2026-08-26", storyId: "us001" },
    { id: "be-001-1", title: "项目初始化接口", type: "backend", assigneeId: "m3", status: "done", estimate: 5, startDate: "2026-08-24", endDate: "2026-08-26", storyId: "us001" },
    { id: "db-001-1", title: "项目与成员数据库设计", type: "database", assigneeId: "m3", status: "done", estimate: 4, startDate: "2026-08-24", endDate: "2026-08-25", storyId: "us001" },
    { id: "test-001-1", title: "项目创建流程测试", type: "test", assigneeId: "m4", status: "done", estimate: 3, startDate: "2026-08-27", endDate: "2026-08-28", storyId: "us001" },
  ],
  "us021": [
    { id: "fe-021-1", title: "Story 卡片拖拽实现", type: "frontend", assigneeId: "m2", status: "done", estimate: 8, startDate: "2026-08-28", endDate: "2026-09-01", storyId: "us021" },
    { id: "be-021-1", title: "Story 优先级持久化接口", type: "backend", assigneeId: "m3", status: "done", estimate: 4, startDate: "2026-08-28", endDate: "2026-08-30", storyId: "us021" },
    { id: "test-021-1", title: "拖拽顺序一致性测试", type: "test", assigneeId: "m4", status: "done", estimate: 3, startDate: "2026-09-01", endDate: "2026-09-02", storyId: "us021" },
  ],
  "us024": [
    { id: "fe-024-1", title: "实现视图切换 Toolbar", type: "frontend", assigneeId: "m2", status: "done", estimate: 4, startDate: "2026-09-05", endDate: "2026-09-06", storyId: "us024" },
    { id: "fe-024-2", title: "实现 Gantt 时间轴组件", type: "frontend", assigneeId: "m2", status: "in-progress", estimate: 10, startDate: "2026-09-06", endDate: "2026-09-10", storyId: "us024" },
    { id: "be-024-1", title: "统一 Story/Task 查询接口", type: "backend", assigneeId: "m3", status: "blocked", estimate: 8, startDate: "2026-09-08", endDate: "2026-09-12", storyId: "us024", blocked: true, blockerNote: "等待 Story 与 Task 数据模型最终确认，当前双方结构不一致" },
    { id: "data-024", title: "定义 Story 与 Task 数据模型", type: "database", assigneeId: "m1", status: "in-progress", estimate: 6, startDate: "2026-09-05", endDate: "2026-09-08", storyId: "us024" },
    { id: "test-024", title: "验证两视图数据一致性", type: "test", assigneeId: "m4", status: "todo", estimate: 5, startDate: "2026-09-13", endDate: "2026-09-15", storyId: "us024" },
  ],
  "us025": [
    { id: "fe-025-1", title: "甘特依赖连接线渲染", type: "frontend", assigneeId: "m2", status: "blocked", estimate: 8, startDate: "2026-09-10", endDate: "2026-09-14", storyId: "us025", blocked: true, blockerNote: "依赖 data-024 数据模型确认，当前无法开发" },
    { id: "be-025-1", title: "任务依赖关系 API", type: "backend", assigneeId: "m3", status: "in-progress", estimate: 8, startDate: "2026-09-08", endDate: "2026-09-12", storyId: "us025" },
    { id: "data-025", title: "依赖关系数据模型设计", type: "database", assigneeId: "m1", status: "done", estimate: 4, startDate: "2026-09-05", endDate: "2026-09-06", storyId: "us025" },
    { id: "test-025", title: "依赖关系测试用例", type: "test", assigneeId: "m4", status: "todo", estimate: 5, startDate: "2026-09-15", endDate: "2026-09-17", storyId: "us025" },
  ],
  "us026": [
    { id: "fe-026-1", title: "文件上传组件（拖拽 + 预览）", type: "frontend", assigneeId: "m2", status: "in-progress", estimate: 6, startDate: "2026-09-07", endDate: "2026-09-10", storyId: "us026" },
    { id: "be-026-1", title: "活动图文件存储接口", type: "backend", assigneeId: "m3", status: "blocked", estimate: 8, startDate: "2026-09-08", endDate: "2026-09-12", storyId: "us026", blocked: true, blockerNote: "文件存储服务账号尚未配置，运维侧阻塞中（已阻塞 18h）" },
    { id: "test-026-1", title: "上传与关联功能测试", type: "test", assigneeId: "m4", status: "todo", estimate: 4, startDate: "2026-09-13", endDate: "2026-09-15", storyId: "us026" },
  ],
  "us027": [
    { id: "be-027-1", title: "成员任务工时聚合接口", type: "backend", assigneeId: "m3", status: "done", estimate: 5, startDate: "2026-09-05", endDate: "2026-09-07", storyId: "us027" },
    { id: "ai-027-1", title: "生成负载风险分析报告", type: "backend", assigneeId: "m3", status: "review", estimate: 6, startDate: "2026-09-08", endDate: "2026-09-10", storyId: "us027" },
    { id: "fe-027-1", title: "Workload 可视化组件", type: "frontend", assigneeId: "m2", status: "in-progress", estimate: 6, startDate: "2026-09-09", endDate: "2026-09-12", storyId: "us027" },
    { id: "test-027-1", title: "超负荷告警测试场景", type: "test", assigneeId: "m4", status: "todo", estimate: 4, startDate: "2026-09-13", endDate: "2026-09-15", storyId: "us027" },
  ],
};

// ─── User Stories ─────────────────────────────────────────────────────────────
export const userStories: UserStory[] = [
  // ── Sprint 1 (CLOSED) ──────────────────────────────────────────────────────
  {
    id: "us001", title: "创建项目并设置团队成员",
    as: "项目负责人", iWant: "创建一个新项目并邀请团队成员", soThat: "团队可以在统一工作空间内协作",
    assigneeId: "m1", collaboratorIds: ["m3"], status: "done", priority: "high",
    storyPoints: 8, risk: "none", startDate: "2026-08-24", dueDate: "2026-08-28",
    sprintId: "s1", epicId: "ep1", taskId: "t1",
    acceptanceCriteria: ["支持填写项目名称、目标、起止时间", "邀请成员时支持邮箱搜索", "成员接受邀请后可查看项目"],
    engineeringTasks: engTasksMap["us001"], subtasks: [],
    cost: 1800, completedEngTasks: 4, totalEngTasks: 4,
  },
  {
    id: "us002", title: "定义项目愿景与目标",
    as: "项目负责人", iWant: "填写项目愿景声明和核心用例", soThat: "团队对项目目标形成统一认知",
    assigneeId: "m1", collaboratorIds: [], status: "done", priority: "high",
    storyPoints: 3, risk: "none", startDate: "2026-08-24", dueDate: "2026-08-26",
    sprintId: "s1", epicId: "ep2", taskId: "t2",
    acceptanceCriteria: ["支持富文本格式的愿景描述", "可关联 Use Case 和 User Activity"],
    engineeringTasks: [], subtasks: [],
    cost: 600, completedEngTasks: 2, totalEngTasks: 2,
  },
  {
    id: "us003", title: "编写用户故事三段式描述",
    as: "团队成员", iWant: "用「作为…我希望…从而…」格式编写 User Story", soThat: "需求表达更清晰规范",
    assigneeId: "m2", collaboratorIds: [], status: "done", priority: "medium",
    storyPoints: 3, risk: "none", startDate: "2026-08-25", dueDate: "2026-08-28",
    sprintId: "s1", epicId: "ep3", taskId: "t3",
    acceptanceCriteria: ["Story 表单包含三段式输入字段", "字段校验不可为空", "保存后显示完整语句"],
    engineeringTasks: [], subtasks: [],
    cost: 500, completedEngTasks: 2, totalEngTasks: 2,
  },
  {
    id: "us021", title: "创建和拖拽 User Story",
    as: "项目负责人", iWant: "在故事地图中创建并通过拖拽调整 User Story 优先级", soThat: "快速响应需求变化",
    assigneeId: "m2", collaboratorIds: ["m3"], status: "done", priority: "high",
    storyPoints: 8, risk: "none", startDate: "2026-08-28", dueDate: "2026-09-02",
    sprintId: "s1", epicId: "ep3", taskId: "t3",
    acceptanceCriteria: ["支持卡片拖拽排序", "拖拽后优先级实时持久化", "跨 Sprint 拖拽自动更新归属"],
    engineeringTasks: engTasksMap["us021"], subtasks: [],
    cost: 2000, completedEngTasks: 3, totalEngTasks: 3,
  },
  {
    id: "us022", title: "将 User Story 拆分为工程任务",
    as: "项目负责人", iWant: "在 Story Drawer 中为每个 Story 创建工程任务", soThat: "知道团队具体需要完成什么工作",
    assigneeId: "m1", collaboratorIds: ["m2"], status: "done", priority: "high",
    storyPoints: 5, risk: "none", startDate: "2026-08-29", dueDate: "2026-09-03",
    sprintId: "s1", epicId: "ep3b", taskId: "t6",
    acceptanceCriteria: ["可添加工程任务并指定类型（FE/BE/DB/TEST）", "工程任务关联负责人与工时", "Story 卡片显示任务完成进度"],
    engineeringTasks: [], subtasks: [],
    cost: 1200, completedEngTasks: 3, totalEngTasks: 3,
  },

  // ── Sprint 2 (ACTIVE) ──────────────────────────────────────────────────────
  {
    id: "us031", title: "Story Drawer 属性编辑",
    as: "团队成员", iWant: "在 Story Drawer 中编辑所有属性并实时保存", soThat: "无需跳转页面即可维护需求详情",
    assigneeId: "m1", collaboratorIds: ["m2"], status: "done", priority: "high",
    storyPoints: 5, risk: "none", startDate: "2026-09-05", dueDate: "2026-09-08",
    sprintId: "s2", epicId: "ep3", taskId: "t3",
    acceptanceCriteria: ["支持内联编辑所有字段", "变更记录自动写入历史", "Drawer 关闭时给出保存提示"],
    engineeringTasks: [], subtasks: [],
    cost: 1000, completedEngTasks: 3, totalEngTasks: 3,
  },
  {
    id: "us023", title: "查看个人负责的任务",
    as: "团队成员", iWant: "在看板中快速筛选出自己负责的任务", soThat: "明确当前工作安排",
    assigneeId: "m4", collaboratorIds: [], status: "done", priority: "medium",
    storyPoints: 3, risk: "none", startDate: "2026-09-05", dueDate: "2026-09-07",
    sprintId: "s2", epicId: "ep3d", taskId: "t8",
    acceptanceCriteria: ["顶栏支持按成员头像筛选", "筛选后其他成员卡片淡出", "筛选状态在视图切换后保持"],
    engineeringTasks: [], subtasks: [],
    cost: 600, completedEngTasks: 2, totalEngTasks: 2,
  },
  {
    id: "us028", title: "在项目聊天中 @AI",
    as: "团队成员", iWant: "在聊天输入框中输入 @AI 触发 Project Agent", soThat: "随时获取项目状态分析或执行操作",
    assigneeId: "m2", collaboratorIds: ["m3"], status: "done", priority: "high",
    storyPoints: 5, risk: "none", startDate: "2026-09-05", dueDate: "2026-09-08",
    sprintId: "s2", epicId: "ep6", taskId: "t10",
    acceptanceCriteria: ["@AI 触发 AI 工作模式", "AI 回复显示分析依据", "AI 操作需要用户确认"],
    engineeringTasks: [], subtasks: [],
    cost: 1200, completedEngTasks: 3, totalEngTasks: 3,
  },
  {
    id: "us024", title: "Story Map 与 Gantt 一键切换",
    as: "项目负责人", iWant: "在 Story Map 与 Gantt 视图之间快速切换", soThat: "从需求和时间两个维度检查项目计划",
    assigneeId: "m1", collaboratorIds: ["m2", "m3"], status: "in-progress", priority: "critical",
    storyPoints: 13, risk: "high", riskNote: "Story Map 与 Gantt 当前使用的数据结构尚未完全统一，BE 接口阻塞中，继续分别开发可能产生双份数据和较高返工成本",
    startDate: "2026-09-05", dueDate: "2026-09-16",
    sprintId: "s2", epicId: "ep4", taskId: "t5",
    acceptanceCriteria: ["顶栏视图切换不丢失当前选中的 Sprint", "切换动画流畅", "两个视图中修改数据后另一视图自动更新"],
    engineeringTasks: engTasksMap["us024"], subtasks: [
      { id: "sub024-1", title: "统一数据模型 schema 文档", done: false, assigneeId: "m1" },
      { id: "sub024-2", title: "视图切换动画", done: true, assigneeId: "m2" },
    ],
    cost: 4500, completedEngTasks: 1, totalEngTasks: 5,
  },
  {
    id: "us025", title: "查看任务之间的依赖关系",
    as: "项目负责人", iWant: "在甘特图中看到任务间的依赖连线", soThat: "提前识别关键路径上的延期风险",
    assigneeId: "m3", collaboratorIds: ["m2"], status: "in-progress", priority: "high",
    storyPoints: 8, risk: "high", riskNote: "甘特依赖连接线渲染（fe-025-1）依赖数据模型确认，当前处于阻塞状态，已影响排期约 1 天",
    startDate: "2026-09-08", dueDate: "2026-09-17",
    sprintId: "s2", epicId: "ep4", taskId: "t5",
    acceptanceCriteria: ["FS 依赖用箭头连线表示", "前置任务延期时后续任务高亮警告", "支持拖拽创建依赖关系"],
    engineeringTasks: engTasksMap["us025"], subtasks: [],
    cost: 3000, completedEngTasks: 1, totalEngTasks: 4,
  },
  {
    id: "us026", title: "为 User Story 上传活动图",
    as: "团队成员", iWant: "在 Story 详情中上传活动图等 UML 文档", soThat: "将需求与软件设计过程关联起来",
    assigneeId: "m2", collaboratorIds: [], status: "in-progress", priority: "medium",
    storyPoints: 5, risk: "medium", riskNote: "文件存储接口被运维阻塞，Story 详情目前无法保存设计资产，已等待 18h",
    startDate: "2026-09-07", dueDate: "2026-09-14",
    sprintId: "s2", epicId: "ep5", taskId: "t4",
    acceptanceCriteria: ["支持上传 PNG/PDF/drawio 格式", "上传后在 Story Drawer 资产标签页展示", "可关联多个 Story"],
    engineeringTasks: engTasksMap["us026"], subtasks: [
      { id: "sub026-1", title: "完善 Acceptance Criteria（缺 2 条）", done: false, assigneeId: "m1" },
    ],
    cost: 1800, completedEngTasks: 0, totalEngTasks: 3,
  },
  {
    id: "us027", title: "AI 分析成员工作负载",
    as: "项目负责人", iWant: "让 AI 分析团队成员的工作量分配是否合理", soThat: "及时发现过度分配问题并调整",
    assigneeId: "m3", collaboratorIds: ["m2"], status: "review", priority: "high",
    storyPoints: 8, risk: "none",
    startDate: "2026-09-05", dueDate: "2026-09-12",
    sprintId: "s2", epicId: "ep8", taskId: "t11",
    acceptanceCriteria: ["AI 计算每位成员当前 Sprint 累计工时", "超出容量阈值时产生告警", "提供负载再平衡建议"],
    engineeringTasks: engTasksMap["us027"], subtasks: [],
    cost: 2500, completedEngTasks: 2, totalEngTasks: 4,
  },
  {
    id: "us029", title: "Scrum Board 执行看板",
    as: "团队成员", iWant: "通过看板实时更新工程任务状态", soThat: "项目进度对全团队透明",
    assigneeId: "m4", collaboratorIds: [], status: "todo", priority: "medium",
    storyPoints: 5, risk: "none",
    startDate: "2026-09-12", dueDate: "2026-09-17",
    sprintId: "s2", epicId: "ep3d", taskId: "t8",
    acceptanceCriteria: ["支持拖拽卡片更改状态", "卡片显示负责人和优先级", "列标题显示当前列 Story 点数合计"],
    engineeringTasks: [], subtasks: [],
    cost: 1000, completedEngTasks: 0, totalEngTasks: 3,
  },

  // ── Sprint 3 (PLANNING) ──────────────────────────────────────────────────
  {
    id: "us030", title: "Sprint Review 验收流程",
    as: "DRI", iWant: "在 Sprint 结束时正式验收每个 User Story", soThat: "确保交付物符合验收标准",
    assigneeId: "m1", collaboratorIds: [], status: "todo", priority: "high",
    storyPoints: 5, risk: "none", startDate: "2026-09-19", dueDate: "2026-09-25",
    sprintId: "s3", epicId: "ep9", taskId: "t12",
    acceptanceCriteria: ["逐条检查 Acceptance Criteria", "验收结果记录在 Story 中", "未通过 Story 自动移入下一 Sprint Backlog"],
    engineeringTasks: [], subtasks: [],
    cost: 1000, completedEngTasks: 0, totalEngTasks: 3,
  },
  {
    id: "us032", title: "AI 自动整理实验材料",
    as: "DRI", iWant: "系统在 Sprint 结束时自动整理本轮产出的实验材料", soThat: "快速完成课程实验交付",
    assigneeId: "m1", collaboratorIds: ["m4"], status: "todo", priority: "high",
    storyPoints: 8, risk: "medium", riskNote: "AI 自动汇总需要所有文档在系统内结构化，目前部分资产以文件形式上传，格式统一工作需提前",
    startDate: "2026-09-22", dueDate: "2026-10-01",
    sprintId: "s3", epicId: "ep9", taskId: "t12",
    acceptanceCriteria: ["自动收集会议纪要、故事地图、甘特图导出", "AI 互动记录自动存档", "支持一键导出 ZIP"],
    engineeringTasks: [], subtasks: [],
    cost: 3000, completedEngTasks: 0, totalEngTasks: 5,
  },
  {
    id: "us033", title: "团队贡献洞察",
    as: "项目负责人", iWant: "查看每位成员本 Sprint 的客观贡献行为", soThat: "在课程复盘时有据可查",
    assigneeId: "m3", collaboratorIds: [], status: "todo", priority: "medium",
    storyPoints: 8, risk: "none", startDate: "2026-09-19", dueDate: "2026-09-28",
    sprintId: "s3", epicId: "ep8", taskId: "t11",
    acceptanceCriteria: ["展示：完成任务数、解决阻塞次数、有效讨论记录", "AI 不给成员打分，只展示行为事实", "支持按成员导出报告"],
    engineeringTasks: [], subtasks: [],
    cost: 2500, completedEngTasks: 0, totalEngTasks: 4,
  },
  {
    id: "us034", title: "Release 版本管理",
    as: "DRI", iWant: "定义 Release 范围并生成 Release Notes", soThat: "对外明确每个版本的功能交付边界",
    assigneeId: "m1", collaboratorIds: [], status: "todo", priority: "low",
    storyPoints: 5, risk: "none", startDate: "2026-09-28", dueDate: "2026-10-02",
    sprintId: "s3", epicId: "ep9", taskId: "t12",
    acceptanceCriteria: ["可关联 Sprint 和 Story 定义 Release 范围", "自动生成 Release Notes 草稿", "支持手动编辑与发布"],
    engineeringTasks: [], subtasks: [],
    cost: 1000, completedEngTasks: 0, totalEngTasks: 2,
  },
];

// ─── Chat Messages ────────────────────────────────────────────────────────────
export const chatMessages: ChatMessage[] = [
  {
    id: "msg1", senderId: "m1", senderName: "张伟",
    content: "Sprint 2 第 2 天，数据模型统一的问题有进展吗？BE 接口在等这个解除阻塞。",
    timestamp: "09:02",
  },
  {
    id: "msg2", senderId: "m3", senderName: "陈林",
    content: "后端查询接口逻辑写好了，但 Story 和 Engineering Task 的数据结构前后端对不上，现在在等你那边确认 schema。",
    timestamp: "09:08",
  },
  {
    id: "msg3", senderId: "m2", senderName: "李娜",
    content: "Gantt 时间轴组件基本完成了，依赖连接线 fe-025-1 在等数据模型，动不了。",
    timestamp: "09:11",
  },
  {
    id: "msg4", senderId: "m4", senderName: "王晨",
    content: "@AI 数据模型不统一会影响哪些功能，延期风险有多大？",
    timestamp: "09:14",
  },
  {
    id: "msg5", senderId: "ai", senderName: "AI Project Agent", isAI: true,
    content: "检测到 Story Map 与 Gantt 的数据模型尚未对齐（data-024 状态 in-progress），当前影响范围如下：",
    timestamp: "09:14",
    aiContext: [
      "US-024 Story Map/Gantt 切换（13pt，截止 09/16）— be-024-1 阻塞，延期风险约 2-3 天",
      "US-025 依赖关系显示（8pt）— fe-025-1 连带阻塞，无法并行开发",
      "Sprint 2 当前完成率 43%，若阻塞持续，预计完成率降至 58%（目标 85%）",
    ],
    aiActions: [
      { label: "查看影响范围", action: "view-impact" },
      { label: "调整 Sprint 计划", action: "adjust-plan" },
      { label: "通知相关成员", action: "notify" },
    ],
  },
  {
    id: "msg6", senderId: "m1", senderName: "张伟",
    content: "收到，我把 data-024 数据模型定义列为今天最高优先级，下午给出最终 schema。",
    timestamp: "09:18",
  },
  {
    id: "msg7", senderId: "m3", senderName: "陈林",
    content: "好的，我先用 Mock 接口让前端继续开发不耽误，等 schema 确认后再对接真实数据。",
    timestamp: "09:21",
  },
  {
    id: "msg8", senderId: "m2", senderName: "李娜",
    content: "@AI 张伟当前工作量怎么样？感觉他这个 Sprint 接了很多东西。",
    timestamp: "09:24",
  },
  {
    id: "msg9", senderId: "ai", senderName: "AI Project Agent", isAI: true,
    content: "张伟当前 Sprint 工作量分析：",
    timestamp: "09:24",
    aiContext: [
      "已分配工时：30h（团队约定 Sprint 容量 24h，超出 25%）",
      "当前承担：data-024 数据模型（6h）、data-025 依赖模型（4h）、DRI 项目管理职责（~20h）",
      "建议：将活动图上传（be-026-1）调整给陈林，可释放张伟约 8h",
    ],
    aiActions: [
      { label: "查看工作负载", action: "view-workload" },
      { label: "建议重新分配", action: "reassign" },
    ],
  },
];

// ─── Risks ────────────────────────────────────────────────────────────────────
export const risks: Risk[] = [
  {
    id: "r1", title: "Story Map 与 Gantt 数据模型尚未统一", level: "high",
    storyId: "us024", taskId: "be-024-1",
    description: "Story Map 与 Gantt 当前使用的数据结构不一致，继续分别开发可能导致双份数据，后续双向联动返工成本较高",
    owner: "m1", status: "mitigating",
  },
  {
    id: "r2", title: "活动图上传接口阻塞，Story 设计资产无法保存", level: "high",
    storyId: "us026", taskId: "be-026-1",
    description: "文件存储服务账号配置阻塞于运维侧，be-026-1 无法推进，Story 详情设计资产关联功能整体阻塞，已等待 18h",
    owner: "m3", status: "open",
  },
  {
    id: "r3", title: "张伟当前 Sprint 工作量超出容量 25%", level: "medium",
    description: "张伟已分配 30h，团队约定 Sprint 容量为 24h，持续超载会影响数据模型定义质量及 DRI 职责履行",
    owner: "m1", status: "open",
  },
  {
    id: "r4", title: "Gantt 依赖关系开发比计划晚 1 天", level: "medium",
    storyId: "us025", taskId: "fe-025-1",
    description: "fe-025-1 因数据模型阻塞延迟开始，可能影响后续 AI 排期分析功能（US-027 依赖真实依赖数据）",
    owner: "m3", status: "open",
  },
  {
    id: "r5", title: "US-026 缺少 2 条 Acceptance Criteria", level: "low",
    storyId: "us026",
    description: "US-026「为 User Story 上传活动图」目前仅填写了 3 条验收标准，按照课程要求应补充完整",
    owner: "m1", status: "open",
  },
];

// ─── Workload ─────────────────────────────────────────────────────────────────
export const workload: Record<string, { assigned: number; capacity: number }> = {
  m1: { assigned: 30, capacity: 24 },
  m2: { assigned: 20, capacity: 24 },
  m3: { assigned: 18, capacity: 24 },
  m4: { assigned: 22, capacity: 24 },
};

// ─── Activity Feed ────────────────────────────────────────────────────────────
export interface ActivityItem {
  id: string;
  time: string;
  senderId: string;
  senderName: string;
  isAI?: boolean;
  content: string;
  link?: string;
  linkLabel?: string;
}

export const activityFeed: ActivityItem[] = [
  { id: "a1", time: "09:42", senderId: "m1", senderName: "张伟", content: "完成工程任务：Story Drawer 属性编辑", linkLabel: "查看任务" },
  { id: "a2", time: "09:31", senderId: "ai", senderName: "AI", isAI: true, content: "检测到 Story Drawer 完成，「设计资产关联」(US-026) 前置条件已满足，可以提前开始", linkLabel: "查看依赖" },
  { id: "a3", time: "09:16", senderId: "m2", senderName: "李娜", content: "上传设计文档：用户故事管理活动图.drawio", linkLabel: "预览文件" },
  { id: "a4", time: "昨天 17:30", senderId: "m4", senderName: "王晨", content: "修改 US-024 的 Acceptance Criteria：补充了「切换后数据一致性」验收项", linkLabel: "查看 Story" },
  { id: "a5", time: "昨天 16:05", senderId: "m3", senderName: "陈林", content: "将 be-024-1「统一查询接口」状态更新为 Blocked，原因：数据模型待确认", linkLabel: "查看阻塞" },
  { id: "a6", time: "昨天 14:20", senderId: "ai", senderName: "AI", isAI: true, content: "Sprint 2 第 1 天进度正常，但检测到 2 个潜在数据模型冲突风险，建议今日优先处理", linkLabel: "查看分析" },
];

// ─── Lab Delivery ─────────────────────────────────────────────────────────────
export const labDelivery = [
  { label: "项目启动会议纪要", done: true },
  { label: "项目规划方案", done: true },
  { label: "用户故事地图导出", done: true },
  { label: "甘特图确认并导出", done: false },
  { label: "AI 原始互动记录（持续保存中）", done: true },
  { label: "4+n 自评", done: false },
  { label: "下一任 DRI 寄语", done: false },
];
