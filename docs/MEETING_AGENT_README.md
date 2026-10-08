# AI 会议协作模块说明

> 面向组内开发同学。依据当前仓库代码整理，基线为本地提交 `9962a5d`（2026-10-08）。本文介绍我负责的会议协作部分，包含使用方式、数据边界和维护入口；不把已有 Story Map、Gantt、Scrum Board 等页面算作本模块成果。

## 一、模块定位与开发范围

这一部分围绕一次项目会议组织 AI 能力：读取真实项目状态，在会议中讨论问题、比较方案，形成可审核的行动建议，再把确认后的修改写回项目，最后保存会议纪要和成果材料。

主要开发内容包括：

- Meeting Room、消息输入与对象引用、历史会议、会议结束确认，以及可折叠、拖动宽度的左右面板。
- 项目主持与专业 Agent 的路由、可见转接、多轮讨论范围和约束维护。
- 基于项目成员数据的 AI 模拟员工。
- 依赖、工时、容量和计划分析，以及新增 Task / Subtask 的模型草案。
- AgentProposal、逐项人工审核、最终计划复核、共享 Store 执行器和 ChangeHistory 关联。
- 结构化纪要、自然语言摘要、原始对话 Hover 溯源。
- 会议材料推荐、文档/表格/图形生成、资产归档、预览、版本复用与下载。
- 服务端模型代理、Flash / Pro 路由、调用与用量记录，以及相应测试。

设计上采用“**确定性事实与计算 + 模型理解和创作 + 人工确认后执行**”。已有项目数据作为共同依据，Agent 不各自维护一份项目；聊天建议也不会直接变成正式任务。这样其他页面能够继续使用同一个 Project Store，不需要额外同步一套会议业务数据。

与另一条事件型 Agent 工作线的共享边界见 [AGENT_INTEGRATION_CONTRACT.md](../AGENT_INTEGRATION_CONTRACT.md)：会议侧负责讨论与会议成果；事件扫描、主动通知等属于事件侧。双方可以复用分析服务、Proposal 协议和执行器。

## 二、主要功能与操作

### 2.1 会议室

**发起入口：**

- 项目概览 → **发起项目会议**：讨论全项目，也可以在会中切换到具体 Story。
- Story 详情面板 → **发起 AI 项目会议**：直接带入该 Story。
- Sprint 页面 → **发起 AI 项目会议**：带入该 Sprint；当前入口对 PO 显示。

桌面布局为左侧项目背景、中间会议对话、右侧决策与行动。两侧可收起、拖动分隔线调整宽度，双击分隔线恢复默认宽度；窄屏改为“讨论 / 项目背景 / 待确认”切换。顶部的“会议对话 / 会议纪要 / 会议材料”分别用于讨论、总结和查看成果。

输入与查阅方式：

| 操作 | 用法 |
| --- | --- |
| 发送消息 | Enter 发送，Shift + Enter 换行，也可点击发送按钮；中文输入法组词时不会直接发送 |
| 邀请角色 | 输入 `@` 选择专业 Agent 或成员，例如 `@风险与依赖`、`@李娜`；`@AI` 为自动协调入口 |
| 引用对象 | 输入 `#` 从 Story、Task、Sprint、风险列表中选择，例如 `#US030`；引用会影响后续讨论范围 |
| 连续追问 | 不写 `@` 时可继承上一位 Agent / 员工与当前范围；切换议题时建议显式 `@` 并写清对象 |
| 查看依据 | 回答正文先显示重点，补充数据和技术依据放在“展开详情 / 查看依据”；短回答不强制出现详情 |
| 历史会议 | 项目概览或会议室顶部进入列表；“查看最近会议”直接打开最近一场的聊天记录 |
| 结束会议 | 点击结束后先进入确认界面，检查待处理行动，再明确确认结束；关闭窗口不等于结束会议 |

历史入口以只读聊天状态打开，不会把一个尚未结束的会议直接改为 `ended`。尚未结束的记录可以点击“继续会议”恢复发言和审核；已结束会议不再开放聊天、审核和继续会议。纪要与材料仍可查看。材料卡片的改名、成果包选择目前是独立资产操作，不应把历史视图理解成底层资产被永久锁定。

### 2.2 专业 Agent

这些 Agent 是同一会议流程中的职责划分，并不是分别部署的独立服务；也不是每轮都会让所有 Agent 各调用一次模型。

| Agent | 职责与主要能力 | 典型提问 |
| --- | --- | --- |
| **项目主持** | 梳理当前问题、收束决策；识别明确专业需求并转交，聊天显示“已邀请协作” | `@项目主持 现在最值得会上确认的是哪几件事？` |
| **任务拆解** | 查询现有工作；生成新 Task / Subtask 草案；按人员、工时、职责约束调整方案，组织前置关系并比较修改前后差异 | `@任务拆解 把 US030 尚未覆盖的工作拆细，别重复创建，先按两个人安排。` |
| **风险与依赖** | 读取已登记依赖；分析直接、间接影响及延期 What-if，区分已知阻塞与讨论假设 | `@风险与依赖 DATA-024 晚两个工作日，会影响哪些后续任务？只分析。` |
| **负载与容量** | 根据未完成工作、成员周容量、Sprint 日期和已有方案评估分工；比较方案负载及机会成本 | `@负载与容量 US030 的工作分给谁更稳？李娜暂时不能接测试。` |
| **计划落地** | 将明确的讨论方案转为待审核行动，说明实际修改内容；没有可用方案时要求先确定安排 | `@计划落地 按刚才确认的方案 A 整理待审核行动。` |
| **材料整理** | 结合会议和项目事实整理文档、表格、图形、纪要及成果包 | `@材料整理 生成 US030 WBS。` |

列表中还存在 **项目巡检、协作建议、贡献洞察**。目前它们在 `meetingConversation.ts` 中提供基于现有数据的轻量异常、参与人、完成情况查询，例如“现在有什么异常”“应该找谁一起讨论”“总结本轮贡献”。它们**尚不是完整事件型 Agent**：没有自动后台巡检、消息投递或独立贡献分析流程。

显式 `@专业Agent` 优先。只 `@项目主持` 时，材料、风险、容量、拆解、进入审核等明确请求由规则转接，不额外调用模型做路由。复合请求如“修改三人方案后再进入审核”，先走任务拆解与容量约束复核，形成有效 Proposal 后再显示向计划落地的转接。

### 2.3 AI 模拟员工

员工选项来自 `state.members`，不是固定的两个聊天机器人。当前项目成员包括张伟、李娜、陈林、王晨；添加或更名成员后，`@` 列表会跟随成员数据变化。

- **专业 Agent**从项目管理角度分析方案；**模拟员工**从自己的任务、相关上下游与当前会话出发回答。
- `digitalMemberAnswer` 读取本人负责的 Task、本人参与的 Subtask、相关 Story、阻塞、依赖和当前 Sprint 容量。任务有子任务时，按本人未完成子任务计算，避免把父任务和子任务重复计入。
- 模型上下文还包含当前讨论任务和必要的上游信息，所以是“本人及当前议题范围”，并非严格只发送个人任务的权限隔离。
- 默认用短自然段汇报进展，可以说明不确定性或拒绝不合理工期。李娜的提示词偏直接、重执行；陈林偏谨慎，关注接口范围、校验与验收。其他成员使用通用成员表达规则。

可以这样问：

```text
@李娜 你这条甘特依赖连接线为什么还没推进？
@李娜 如果 DATA-024 今天解决，你明天能做到什么程度？
@陈林 US030 的接口和校验两个步骤能一起接吗？
如果只做接口、不做校验呢？
```

员工不会替别人承诺，也不会直接改任务、负责人或完成状态。它们的回复是 **AI 模拟反馈，不是真人成员承诺**。自然语气通过同一次模型请求中的 persona prompt 实现，没有额外的“人性化重写”调用；标准模式下部分个人事实查询直接返回确定性回答，因此不是每条员工消息都经过模型。

### 2.4 行动建议、审核与写回

任务拆解、规划或正式变更请求可以产生 `AgentProposal`。一个 Proposal 包含多条 `ProposalAction`，每条有原值、建议值、原因、前置条件、审核决定和执行状态。新增工作草案也可能直接形成待审核卡，不必每次再重复请求计划落地。

操作顺序：

1. 在右侧查看行动，逐项 **采纳 / 拒绝**，或使用全部采纳、全部驳回。
2. 需要时点击 **修改** 调整可编辑字段；原始建议保留，人工审核后的内容单独记录。
3. 点击 **重新校验最终计划**，检查审核后的实际组合是否仍满足人员、容量、依赖和工期约束。
4. 校验通过后点击 **确认应用**。只有被采纳且执行检查通过的行动才进入 Project Store。
5. 查看“实际变更”，核对目标对象与 ChangeHistory，而不是仅凭聊天里“已安排”的表述判断。

**例子：为 US030 的现有任务补步骤。**

先用 `#` 选择实际父 Task，再输入：

```text
@任务拆解 给这个任务补两条尚未覆盖的执行步骤：接口记录和字段校验，建议由陈林负责；不要重复创建已有步骤。
```

若确有未覆盖工作，会生成 `CREATE_SUBTASK` 建议。用户可以采纳接口步骤、拒绝校验步骤，或先修改负责人和工时。校验与应用通过后，Store 创建被采纳的 Subtask，返回真实 `resultTargetId`，并为变化写入 `proposalId`、`proposalActionId`。如果部分采纳破坏方案约束，需要先调整或重新规划，不能绕过校验。若相关步骤已经存在，也可能不再生成新增建议。

`Preconditions` 保存提出建议时依赖的字段值，例如原负责人、估算或 Story 的任务列表。真正执行前重新读取这些字段；若其他操作已经改动数据，行动会成为 `stale`，需要重新确认。它解决的是“建议产生后事实过期”，最终计划校验解决的是“人工修改/拒绝之后整个方案是否仍成立”，二者不能互相替代。

执行器会按 `dependsOnActionIds` 处理行动先后关系。它支持部分成功，**不是整份 Proposal 的数据库事务回滚**；失败时应检查每条状态。这样限制模型只输出建议，项目修改仍由可校验的 Store Action 完成。

### 2.5 会议纪要、摘要与溯源

会议消息、议题、事实/假设、方案、Proposal 引用随会议保存。纪要分成两层：

| 层次 | 生成方式与作用 |
| --- | --- |
| 结构化纪要 | `generateMeetingMinutes` 根据消息、议题、Proposal、执行结果整理决策、行动、风险等，不需要模型 |
| 可读展示 | `readableMeeting` 将结构化记录映射成摘要、决策、负责人、行动状态和真实变化，默认只展示重点，可展开完整纪要 |
| 模型摘要 | 点击“整理完整会议摘要 / 更新摘要”，或确认结束会议后触发 `ensureMeetingNarrative`；读取整场有效对话及核对后的执行事实，生成连贯自然段和来源引用 |

模型摘要通过 fingerprint 复用；内容或审核结果变化后可更新，同一会议的并发摘要请求会合并。消息太少或模型失败时保留确定性纪要，不伪造深度摘要。生成标准纪要文件默认导出当前可读纪要；代码中的 `defense` 模式对纪要和汇报材料会先尝试生成模型摘要。

带下划线的关键结论支持 Hover：优先使用摘要中的 `sourceMessageIds`、行动关联消息或已记录事实；没有显式引用时，尝试匹配实体名称/ID 与相邻对话，最多显示 5 条真实消息。找不到相关消息就不显示溯源。**这是相关讨论定位，不是对每句话都做了严格因果证明。**

浮层使用延迟关闭和鼠标安全桥接，可以移入、滚动和选中文字，并按视口位置换边。会议全文仍在“会议对话”中，纪要不替代原始聊天记录。

### 2.6 材料整理与资产归档

聊天中显式 `@材料整理`，或请项目主持转交即可生成。以下为代码中已有的主要分支：

| 材料 | 生成方式 | 文件格式 |
| --- | --- | --- |
| 正式纪要、行动项、变更摘要、风险与阻塞报告 | 项目事实与会议记录的标准模板 | DOCX、Markdown、HTML |
| Sprint 数据附件、WBS | 确定性表格；WBS 区分待审核方案和已进入项目的工作 | XLSX |
| 当前/指定 Sprint 甘特图 | 后台渲染已有 Gantt 组件并截图，沿用其颜色、层级、状态和依赖 | PNG、PDF |
| 用户故事地图 | 复用已有 Story Map 页面导出 | PNG |
| 已登记依赖图 | 从真实依赖边构造 Mermaid | PNG、SVG、MMD |
| Story 验收活动图、验收时序图、Story/Task/Sprint/Member 数据模型类图 | 已有标准 Mermaid 模板 | PNG、SVG、MMD |
| 新用例图、新流程/UML、开放式文档与表格 | 模型生成结构化材料，校验后在浏览器转换为文件 | 图形为 PNG/SVG/MMD；文档和表格同上 |
| “老师汇报材料” | 组合概览、会议相关推荐材料及 Excel；可另提开放式创作要求 | 多份文档/图形/表格，可下载 ZIP |

例如：`@材料整理 根据 US030 画一张用例图。`、`@材料整理 生成 Sprint 3 甘特图。`

“风险清单”标准分支默认是文档；希望得到表格时明确提出 Excel，当前标准 Excel 是范围内的项目记录附件，不能等同于只含风险行的专门报表。标准图也属于流程/结构说明，不代表功能已经实现或测试通过。甘特 PDF 是视图图像导出，不是可编辑排期文件。

生成完成后，聊天中出现成果卡，同时进入该会议“会议材料”和共享资产数据。卡片提供预览、下载、加入成果包、更多格式和改名；图形支持图片与源码查看，HTML 可打印。成果包默认包含当前文件；勾选“加入成果包”后可只下载选中材料。聊天请求 ZIP 还会把 ZIP 本身保存为资产。

资产身份按会议、材料类型、来源范围及文件格式识别。同一范围重复请求时，fingerprint 未变化就复用；需要更新则更新原资产并递增版本，旧 Blob 为历史记录保留。材料中心过滤旧的重复记录，只展示当前版本；明确“另存一份”才创建独立副本。聊天历史的卡片引用资产 ID，因此也可能显示其最新版本，并不是不可变的旧文件快照。

推荐使用确定性规则：产生方案、应用变更或首次讨论某范围的风险/拆分时，聊天展示相关紫色推荐卡；继续讨论或完成生成后收成一行入口。完整勾选与“准备老师汇报”保留在材料页，批量生成合并为一条成果消息，不常驻遮挡输入区。改标题在本地完成，不重新调用 Pro。

## 三、一场会议的最短使用流程

下面是操作示例，具体回答、人数和工时由当前数据与模型决定，不要求生成固定答案。先从项目概览发起会议；确认当前数据中存在 US030、相关依赖及成员。若 Sprint 已过期或关闭，应选用仍有工作窗口的 Sprint，不要把历史日期当成今天还能承诺的工期。

| 步骤 | 可输入的消息 / 操作 | 应检查什么 |
| --- | --- | --- |
| 1. 了解情况 | `@项目主持 看看当前项目情况，今天最需要讨论哪几件事？` | 项目范围、Sprint 时间、未完成工作 |
| 2. 找阻塞 | `@风险与依赖 DATA-024 今天还解决不了，会影响哪些后续任务？只分析，不修改。` | 已登记依赖与假设分开；不产生实际修改 |
| 3. 问成员 | `@李娜 你负责的甘特依赖连接线现在卡在哪里？需要谁先交接？` | 从个人执行情况回答，没有替其他人承诺 |
| 4. 看容量 | `@负载与容量 US030 的工作由谁承担更稳？李娜先不接测试，陈林不能超过未来五个工作日的剩余容量。` | 已有工作是否计入、约束是否保留 |
| 5. 拆解/调整 | `@任务拆解 把 US030 尚未覆盖的工作再拆细一点，保留合理的已有任务，沿用刚才的人员约束，说明调整前后差异。` | 现有/新增工作分清；负责人、工时、前置关系可核对 |
| 6. 进入审核 | `@项目主持 按刚才确认的方案 A 进入审核。`（仅在确有可行方案 A 时使用；已有 Proposal 可直接审核） | 右侧逐条采纳、拒绝或修改，不能只看聊天确认语 |
| 7. 实际应用 | 点击 **重新校验最终计划 → 确认应用**；随后可问 `@项目主持 本次实际写入了哪些变化？` | 目标任务、执行状态和 ChangeHistory 一致 |
| 8. 查看纪要 | `@项目主持 总结一下本次会议决定了什么，还有什么待确认。`，再进入 **会议纪要**，按需整理完整摘要 | 已执行与待审核分开；负责人来自实际结果 |
| 9. 沉淀材料 | `@材料整理 生成 US030 WBS。`，或进入 **会议材料** 勾选纪要、甘特等并生成 | 聊天反馈、资产归档、预览和下载 |
| 10. 回看依据 | 在纪要中 Hover 一条带下划线的行动或结论；需要更多上下文时回到 **会议对话** | 浮层显示本会议真实发言；无需再次向模型提问 |

最后点击结束会议并确认。结束不会自动采纳待处理行动，也不会因摘要生成失败而删除会议记录。

## 四、核心设计与实现

```mermaid
flowchart TD
  U[用户消息：@角色 / #对象] --> R[MeetingRoom 解析与可见转接]
  R --> C[coordinateMeetingTurn]
  S[(共享 Project Store)] --> F[讨论范围 / 项目快照 / 确定性分析]
  C --> F
  F --> L{是否需要模型}
  L -->|需要| API[Vite 模型代理 → Flash / Pro]
  L -->|不需要| A[事实回答 / 方案]
  API --> A
  A --> Chat[保存会议消息与上下文]
  A --> P[AgentProposal]
  P --> H[人工审核 → 最终校验 → Preconditions]
  H --> E[applyProposal → Store Actions]
  E --> S
  E --> CH[ChangeHistory]
  Chat --> M[纪要 / 模型摘要 / 来源引用]
  S --> M
  CH --> M
  M --> G[材料整理与现有视图导出]
  G --> B[Blob + DesignAssetEntity]
  B --> V[聊天卡片 / 会议材料 / 共享资产预览]
```

### 4.1 上下文与多轮约束

`coordinateMeetingTurn` 是主协调入口。它恢复 `MeetingWorkingState`，确定当前 Agent 和讨论对象，再调用相应服务。`MeetingMemory` 保存焦点 Story/Task/Sprint、约束、候选方案、选中方案和待确认分工；`workingState` 保存方案版本、What-if 结果及会议基线。人数、排除成员、指定分工等由代码合并，不只靠历史文字让模型“记住”。

`buildMeetingContext` 将全局会话、当前对象和规划状态分开；常规说明请求通常发送最近 6 条相关消息，员工追问额外选择最近与本人有关的问答。只有完整会议摘要专门读取整场有效对话。模型数据投影包含项目事实，不发送工作区设置或附件二进制。

快照与依赖分析读取同一 Store。容量采用成员每周小时数折算工作日窗口，未完成工作优先按叶子任务/子任务估算求和，不把 Sprint Story Points 当作人时，也不简单按百分比扣减估算。这是计划容量，不是考勤或实际剩余工时测量。

### 4.2 模型边界与结果校验

- **代码负责**：事实读取、依赖遍历、日期与容量运算、约束合并、标准材料、建议校验、写回和版本识别。
- **模型负责**：开放式任务草案、复杂问题解释、新图形/文档内容和全场自然语言摘要。
- 模型草案按约定结构解析；回复会检查人员、方案 ID/版本和部分事实 claims。无法通过校验或模型不可用时，部分回答回退确定性事实；必需创作调用失败则提示失败，不伪造文件或已执行结果。

数字员工单独组装个人事实与 persona；专业 Agent 使用对应职责提示词。二者复用模型接口，但输入范围、语气和是否允许产出 Proposal 不同。当前是本地应用里的业务约束，**不等于服务端多用户数据权限系统**。

### 4.3 会议与材料的数据保存

| 数据 | 主要内容 |
| --- | --- |
| `MeetingSession` | 目标范围、状态、参与人、消息和 Proposal ID、memory、topics、facts、minutes、narrative、qaTrace |
| `MeetingMessage` | 发言身份、内容、时间，以及可选的 proposalId、artifactIds、evidence、handoffTo |
| `MeetingNarrative` | 自然语言摘要、来源消息引用、fingerprint、生成时间和模型 |
| `AgentProposal / ProposalAction` | 原始/审核后行动、约束和方案快照、Preconditions、审核与执行状态 |
| `DesignAssetEntity` | 材料元数据、文件 contentRef、版本、与 Project/Sprint/Story 的 links；sourceText 中保存材料结构和 `_meeting` 标识 |

这些记录与项目实体共同保存在 Zustand Project Store，通过 `localProjectStorage` 串行写入本地接口。项目文件默认是 `local-data/project-state.json`；附件为 `local-data/assets/<blob-id>.bin` 及对应 `.json` 元数据。旧 localStorage / IndexedDB 数据有兼容迁移路径，不应把当前浏览器缓存当作唯一数据来源。

材料生成链路是：确定范围和证据 → 标准模板或模型结构 → 文件转换 → `putBlob` → 创建/更新共享资产 → 消息引用资产 ID。新图形使用 Mermaid 渲染和 SVG 清理，再导出 PNG；当前会议材料链路并非通用 PlantUML 编译服务。甘特、故事地图通过现有页面组件的后台渲染导出，不让模型重新画一张替代图。

### 4.4 模型选择与成本记录

先由 `meetingCallPolicy.ts` 决定是否需要调用，再由服务端 `meetingModelRouting.ts` 选择档位，不能仅凭 Agent 名称判断费用。

| 路径 | 当前默认策略 |
| --- | --- |
| 主持规则转接、标准分析/材料、视图导出、ZIP、标题修改、缓存复用 | 可走 0 调用路径；具体普通回答仍可能请求解释 |
| 语义解析、一般查询/确认、数字员工说明、简单单任务步骤草案 | Flash：`deepseek-flash` |
| 复杂拆解、专业分析解释、新材料创作 | Pro：`deepseek-v4-pro`；思考档位按问题复杂度调整 |
| 全场会议摘要 | Pro，`meeting_summary` 路径 |
| 图形修复 | 简单语法修复 Flash；语义/类型修复或长源码 Pro |

标准模式会跳过一部分模型解释；`presentationMode: "defense"` 是已有演示配置，普通回复更倾向 Flash，高价值分析用 Pro。其普通回复在会议估算费用达到 4 元后会缩短输出，为复杂请求留预算；**这不是所有调用共享的硬性费用上限**。

前端 `meetingTelemetry` 记录请求、模型、耗时、回退及是否采用回复；`qaTrace` 记录每轮意图、焦点、约束和实际调用的 Agent。服务端 `meetingUsage.ts` 将供应商 token usage 写入 `local-data/meeting-usage.jsonl`。金额按代码内价格和汇率估算，真实扣费以供应商为准。

## 五、主要代码与维护入口

以下路径相对仓库根目录。按要修改的功能找入口即可，无需先通读所有 Agent 文件。

| 类别 | 文件或目录 | 主要职责 / 修改入口 |
| --- | --- | --- |
| Agent 组织 | `src/agents/meetingDecision.ts` | 主协调流程、专业能力调用、Proposal 形成；修改处理顺序先看这里 |
| 角色与路由 | `src/agents/meetingConversation.ts`、`meetingHandoff.ts` | Agent 列表、`@` 解析、简单能力、主持人规则转接 |
| 多轮上下文 | `src/agents/meetingContext.ts`、`meetingWorkingState.ts` | `#` 对象、焦点切换、约束合并、方案版本与连续追问 |
| 项目分析 | `src/agents/meetingSnapshot.ts`、`projectDependencyGraph.ts`、`meetingCapacity.ts` | 共享事实快照、跨 Story 依赖图、容量口径 |
| 拆解与计划 | `src/agents/meetingWorkDraft.ts`、`meetingPlanning.ts`、`meetingSchedule.ts` | 新工作草案、方案选择、排期；约束校验见 `meetingConstraintValidator.ts` |
| 模拟员工 | `src/agents/digitalMember.ts`、`meetingModelContext.ts` | 本人事实、成员输入范围；语气修改还需看服务端 `meetingVoicePrompt` |
| 模型客户端 | `src/agents/meetingLlm.ts`、`meetingCallPolicy.ts` | 请求、是否调用、回复采用与回退；不要另加重复润色请求 |
| 服务端 | `server/meetingModelService.ts`、`meetingModelRouting.ts`、`meetingUsage.ts` | 提示词/API 代理、Flash/Pro 策略、用量持久化；`server/meetingLlm.ts` 是导出入口 |
| 会议前端 | `src/components/planning/MeetingRoom.tsx`、`MeetingRoom.css` | 布局、输入、转接、历史入口、右侧审核；普通消息呈现还看 `meetingPresentation.ts` |
| Proposal 与写回 | `src/types.ts`、`src/store/projectStore.ts`、`src/agents/meetingFinalRevalidation.ts` | 共享协议、字段白名单、执行器、最终复核；核对结果看 `meetingExecutionSummary.ts` |
| 纪要与溯源 | `src/agents/meetingMinutes.ts`、`meetingNarrative.ts`、`meetingSource.ts` | 结构化纪要、模型摘要、来源选择；UI 在 `MeetingMinutesView.tsx`、`MeetingSourceTrace.tsx` |
| 材料业务 | `src/agents/materialOrganizer.ts` → `materialShowcase.ts` | 对外入口与实际编排；不要因文件名含 Showcase 误认为只是静态样例 |
| 材料结构 | `src/agents/materialStandards.ts`、`materialSchema.ts`、`materialFiles.ts`、`materialIdentity.ts` | 标准类型、模型结构校验、格式转换、去重；事实范围见 `materialEvidence.ts` |
| 材料 UI/导出 | `MaterialSuggestions.tsx`、`MeetingMaterials.tsx`（位于 planning 组件目录）；`src/utils/exportImage.ts` | 推荐选择、卡片与成果包、既有视图导出；触发时机见 `materialRecommendations.ts` |
| 文件与持久化 | `src/components/assets/AssetFilePreviewDialog.tsx`、`src/store/blobStore.ts`、`localPersistence.ts`、`vite.config.ts` | 共享预览、附件存取、项目保存及本地接口 |
| 相关测试 | `src/tests/meetingRevisionReview.test.ts`、`meetingRoomInteraction.test.tsx`、`materialRecommendationMoment.test.tsx` | 多轮修改转审核、会议交互、推荐卡出现/收起 |
| 其他专项测试 | `src/tests/meetingFinalRevalidation.test.ts`、`meetingMaterialCost.test.ts`、`meetingModelRouting.test.ts`、`meetingProposal.test.ts` | 人工审核后约束、材料成本/字节、模型路由、Proposal 执行 |

`PlanningMeetingDialog.tsx` 和 `meeting.ts` 还保留较早的规划对话/提案逻辑；当前项目概览、Story、Sprint 的会议入口接的是 `MeetingRoom`。修改主流程时不要只改旧组件。

## 六、与其他模块的衔接

| 项目数据 | 会议侧如何使用 | 当前写入边界 |
| --- | --- | --- |
| Project、Activity、UserTask、Epic、Sprint | 项目目标、层次、讨论范围、日期、Sprint Goal 和容量分析 | 会议 Proposal 没有通用修改这些实体的动作 |
| Story、验收标准 | 理解需求、验收边界、任务所属关系、材料事实 | `UPDATE_STORY` 仅支持 risk、riskNote、assigneeId；不是通用 Story 编辑器 |
| Task / Subtask | 工时、状态、阻塞、分工和执行步骤 | 支持创建及更新；更新白名单为标题、估算、负责人，Task 另含 type；创建 Task 可带起止日期 |
| 成员 | 姓名、职责、周容量、数字员工身份 | 不支持通过 Proposal 修改成员档案或容量值 |
| Dependency | 遍历前置/后续关系、What-if、图形生成 | 当前动作是 `ADD_DEPENDENCY`；讨论解除依赖不等于已有删除依赖写回能力 |
| Risk | 风险说明、影响与缓解、材料汇总 | `CREATE_RISK`、`UPDATE_RISK` 经审核执行 |
| ChangeHistory | 确认实际执行和人工修改结果 | Store Action 产生记录，执行器补充 Proposal 来源关联 |
| Asset | 文件元数据、预览、下载、会议成果关联 | 材料生成/改名/成果包选择直接使用资产 Store 操作，不走任务变更 Proposal |

以上写入限制来自 `validateProposalValue`，不是“模型说能修改就能修改”。当前 `UPDATE_TASK` 也不允许直接修改状态、日期；验收和完成状态仍通过已有项目操作管理。普通聊天中的“我完成了”“如果延期”可能成为会议事实/假设，不会自动改变正式实体。

项目写回通过共享 Store Action，因此现有 Story Map、Gantt、执行页面读取同一份结果。会议模块增加了这些页面的会议入口和导出衔接，并未重新实现它们。若另一位同学接入事件建议，应使用 `origin: "event"` 的同一 Proposal 协议与执行器；当前仓库有协议，但没有完整事件侧生产者。

联调时重点保持：实体 ID、Story.taskIds、Task.subtaskIds、成员引用、依赖端点及资产 contentRef 一致。修改字段、枚举或工时口径时，同步检查 `types.ts`、Store 归一化/迁移、快照、约束与执行校验、模型数据投影、材料模板和相应测试，避免页面已更新而 Agent 仍使用旧口径。

## 七、运行、配置与检查

### 7.1 启动

建议 Node.js 24.15+ 或 22.22.2+，以满足当前测试依赖的 engine 要求。在仓库根目录执行：

```bash
npm ci
npm run dev
```

默认入口为 `http://localhost:8443/`。不需要单独启动 Python 服务或数据库，模型代理、项目与附件持久化都通过 `vite.config.ts` 的插件注册；开发和 Vite preview 均注册这些中间件。只把 `dist/` 放到普通静态服务器，或直接打开 HTML，不会获得这些接口。日常联调用 `npm run dev` 即可。

使用 `config/meeting.env.example` 作为模板，复制成根目录 `.env.local`，配置自己的密钥。主要变量：

| 变量 | 用途 |
| --- | --- |
| `DEEPSEEK_API_KEY` / `MEETING_LLM_API_KEY` | 服务端模型密钥；后者优先，也兼容 `LLM_API_KEY` |
| `MEETING_LLM_BASE_URL` | OpenAI 兼容的模型服务地址，默认 DeepSeek `/v1` 地址 |
| `MEETING_LLM_FAST_MODEL` | Flash 模型，默认 `deepseek-flash` |
| `MEETING_LLM_ADVANCED_MODEL` | 高阶模型默认值，默认 `deepseek-v4-pro` |
| `MEETING_LLM_EXPLAIN_MODEL` | 高阶解释/摘要模型覆盖项 |
| `MATERIALS_LLM_MODEL` | 高阶材料创作与修复模型覆盖项 |
| `PORT` | Vite 端口环境变量 |
| `PROJECT_DATA_DIRECTORY` | 项目/附件数据目录环境变量；用量日志仍按 `local-data/meeting-usage.jsonl` 保存 |

`PORT` 和 `PROJECT_DATA_DIRECTORY` 通过进程环境设置。模型服务还保留 `.env`、`SUNNYMIND_ENV_FILE` 及本机 SunnyMind 路径的兼容读取；其他同学不需要那个项目，优先配置本仓库 `.env.local`。不要将真实密钥提交到 Git。

### 7.2 实际接口

| 接口 | 用途 |
| --- | --- |
| `GET /api/meeting-llm` | 是否配置模型、模型名、路由信息与用量；可带 `?meetingId=...` 查看会议统计，不返回密钥 |
| `POST /api/meeting-llm` | `mode` 为 interpret、explain、draft_work、materials、repair_diagram 或 meeting_summary；payload 提供该请求上下文 |
| `GET / PUT / DELETE /api/local-project` | 读取、保存或删除本地项目快照；调试时不要误用 DELETE |
| `GET / PUT / DELETE /api/local-assets/<blob-id>` | 附件内容读写/删除；正常通过 blobStore 调用 |

没有密钥时仍能看历史记录、已有附件并使用部分确定性能力；新模型草案、开放式材料和深度摘要需要在线模型。网络、余额或模型输出异常会影响这些路径，应先看错误提示及调用记录，而不是只判断是否出现聊天气泡。

### 7.3 测试与快速自检

```bash
# 全部现有测试与编译检查
npm test
npm run typecheck
npm run build

# 只跑会议中的几个关键回归
npm test -- src/tests/meetingRevisionReview.test.ts src/tests/meetingRoomInteraction.test.tsx src/tests/materialRecommendationMoment.test.tsx src/tests/meetingFinalRevalidation.test.ts
```

单元测试主要验证确定性行为、模拟模型和 UI 逻辑，不代表已经真实调用了线上模型。浏览器自检可按第三节走一条短链路：核对主持转接、员工追问、Proposal 审核、真实 Task/History、纪要来源、材料预览。调试模型时同时检查供应商 usage、`llmReplyUsed` 和最终展示；一次请求成功不等于其正文最终被采用。

`local-data/`、生成附件、`.env.local` 不随代码推送。同学只克隆仓库会得到默认项目，不会自动获得你本机的历史会议。需要复现同一场会议时另行交接项目快照和全部被引用附件，并保留对方原有数据。

## 八、完成情况与后续维护

**已实现：**项目/Story/Sprint 会议、显式角色选择与主持转接、多轮范围/约束、模拟成员、确定性项目分析、模型新工作草案、Proposal 审核与共享执行、执行历史关联、历史聊天、纪要与摘要、真实消息溯源、材料推荐及资产生成/版本/预览/下载。

**仍需注意：**

- 本地单项目持久化不包含完整服务端身份认证、并发协同和数据库事务；角色选择与员工数据范围不能当成生产级权限体系。
- 自然语言路由包含规则识别，复合指令仍可能有理解偏差。重要变更要看右侧实际行动与最终校验结果。
- 日期随当前时间计算，历史 Sprint 可能已无容量；工作日计算没有完整节假日、请假与实际工时系统。
- 来源 Hover 的后备匹配是相关对话检索；生成文档/UML 也需要人工核对，不能作为已实现功能证明。
- 现有 Proposal 只覆盖上述动作和字段，不能执行任意项目操作；部分失败不会自动回滚整份方案。
- 视图导出依赖浏览器渲染。文件存储当前单文件上限 5 MB，大图或成果包超限可能失败；普通文档 PDF 通过 HTML 打印，未实现所有格式间的通用转换。
- 项目巡检、协作建议、贡献洞察尚未完成事件侧闭环；后续接入时复用共享服务，不另建执行器。

后续扩展优先沿现有入口：新增材料类型扩展标准模板/Schema，新增写操作同时扩展协议、字段校验、执行器和测试，新增角色补充路由、上下文范围及提示词。保持“事实有来源、修改经审核、结果可追踪”这一条链路即可。
