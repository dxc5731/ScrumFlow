# ScrumFlow

ScrumFlow 是一个面向 Product Owner 的本地化 Scrum 项目管理原型。系统围绕统一项目模型组织需求、排期、执行、验收、风险、工作量与设计资产，所有业务页面共享同一份状态并保存到项目目录内的本地数据文件。

## 系统架构

项目采用 React 19、TypeScript、Vite 和 Zustand：

- `src/pages`：用户故事地图、甘特图、执行看板、Sprint、验收、风险、工作量分析和资产中心等页面。
- `src/components/planning`：Story、Task、Subtask 的统一详情编辑、资产关联、验收与结果提交组件。
- `src/components/uml`：基于 React Flow 的 UML 可视化编辑器、离屏 PNG 渲染和旧数据快照回填。
- `src/store/projectStore.ts`：统一项目状态、业务操作、变更历史与跨模块同步。
- `src/store/localPersistence.ts`：项目状态持久化适配器。
- `src/store/blobStore.ts`：上传文件和 UML 快照的本地附件存储。
- `vite.config.ts`：开发服务器配置，以及 `/api/local-project`、`/api/local-assets` 本地数据接口。

运行数据默认写入 `local-data/`。该目录已被 Git 忽略，不会将个人项目数据和上传附件提交到仓库。

## 当前功能

- 用户故事地图：Backlog 宽度调整、响应式卡片布局、单卡详情展开、全屏工作模式、拖拽排序与统一详情栏。
- 甘特图：Sprint 和成员筛选、Story/Task/Subtask 排期、依赖关系、关键路径、进度调整、热力图联动高亮及后台分块 PNG 导出。
- 执行状态：Scrum 看板、任务状态流转、阻塞信息和低干扰列悬停配色。
- Sprint 与验收：容量和范围管理、验收标准、Review 流程及结果资产提交。
- 工作量分析：按日展示任务分配量，并提供演示性质的成员每日工作量历史视图。
- 设计资产：文件上传、下载、DOCX/PDF/XLSX/Markdown/图片在线预览，以及 Story/Task 内直接浏览、选择和跳转资产。
- UML：用例图、时序图、类图的节点新增、编辑、拖拽和连线；PlantUML 子集导入后可转为人工编辑；保存和导出自动生成裁边 PNG 快照。
- 本地持久化：刷新或重新打开浏览器后从 `local-data/` 恢复项目状态和附件。
- 演示数据：包含跨模块关联的 Story、工程任务、排期、风险、成员和多种 UML 图。

AI 项目会议室支持项目主持、任务拆解、风险与依赖、负载与容量、计划落地，以及依据真实记录模拟回应的数字成员。`@` 助手或成员、`#` 工作对象可放在消息的任意位置。任务与子任务建议需要在会议决策区审核后应用。

材料整理 Agent 使用服务端配置的 DeepSeek 模型，能够根据项目记录生成 Word 文档、Excel 台账、UML、甘特图、用户故事地图和用户旅程等成果。聊天中可预览、下载单个文件或 ZIP 成果包；所有文件同时保存到设计资产中，并关联本次讨论对象。图表提供 PNG、SVG 与可编辑 Mermaid 源码；文档提供 DOCX、Markdown 和可打印 HTML，可通过“打印 / 存为 PDF”导出 PDF。可继续要求修改上一份材料，修改会生成新版本并保留旧文件。

本轮发现的问题、修复、真实调用证据和待验收项见 [会议 Agent 审查记录](AGENT_REVIEW_2026-09-30.md)。

每日工作量中的提交与进度明细仍为展示数据。

### 模型配置

在项目根目录的 `.env.local` 配置（该文件被 Git 忽略）：

```dotenv
DEEPSEEK_API_KEY=你的服务端API密钥
MEETING_LLM_BASE_URL=https://api.deepseek.com/v1
MEETING_LLM_MODEL=deepseek-flash
MEETING_LLM_FAST_MODEL=deepseek-flash
MEETING_LLM_ADVANCED_MODEL=deepseek-v4-pro
MEETING_LLM_EXPLAIN_MODEL=deepseek-v4-pro
MATERIALS_LLM_MODEL=deepseek-v4-pro
```

各 Agent 根据职责和本轮任务动态选用模型：V4.1 Flash 的官方 API ID 为 `deepseek-flash`，V4 Pro 为 `deepseek-v4-pro`。

| Agent | Flash 用途 | Pro 用途 |
| --- | --- | --- |
| 项目主持 | 项目进度、记录摘要、普通讨论 | 综合诊断、优先级与方案权衡 |
| 任务拆解 | 查询已有任务；单个任务增加一两条无额外约束的步骤 | 新需求拆解、WBS、验收边界与受约束任务生成 |
| 风险与依赖 | 风险清单、已登记状态 | 延期影响、依赖链推演、缓解与优先级分析 |
| 负载与容量 | 工时查询、超载清单、简单数字比较 | 分工优化、容量与工期方案比较 |
| 计划落地 | 确认既定方案、整理审核行动、实际执行结果 | 变更可行性、冲突与重新排期 |
| 数字成员 | 本人任务、完成情况、工作记录 | 接手评估与复杂协作影响 |
| 材料整理 | 现有材料的标题或格式修正；图表语法修复 | 文档、Excel、UML 等创作；图形语义修复 |

即时查询与语义解析关闭思考；Flash 的小型创作使用 `low`，Pro 分析与创作使用 `high`。`max` 只用于完整成果包、明确要求深入分析多个对象的规划，或至少五项同时生效且涉及多个对象的规划约束；普通两人、三天、排除一位成员的讨论仍为 `high`。思考预算另计入输出 token 上限，降低推理耗尽预算导致最终正文截断的风险。历史聊天的难度和项目数据量不会单独把普通查询升级为 Pro。具体策略见 `server/meetingModelRouting.ts`。

`GET /api/meeting-llm` 返回当前两档模型与路由策略。每次响应及前端遥测保留实际模型、路由原因、思考档位和耗时，方便审查；不会返回模型思维链。

密钥仅由服务端读取。也兼容已有的环境变量与 `SUNNYMIND_ENV_FILE` 配置。`GET /api/meeting-llm` 仅返回是否配置和模型名称，不返回密钥。余额不足、模型超时、输出截断及文件生成失败会明确提示；材料生成失败不会伪造下载入口。大型成果包可拆成几次生成。未提供课程评分表、预算、实测结果等信息时，材料会标记缺失事实或设计假设，需要依据实际作业要求补充。

## 启动方式

### 环境要求

- Node.js 20.19 或更高版本
- npm（随 Node.js 安装）

### 命令行启动

```bash
npm install
npm run dev
```

浏览器访问 `http://localhost:8443/`。

Windows 也可以双击 `Start-ScrumFlowAI.bat`。脚本会在首次运行时安装依赖、启动开发服务器并打开浏览器。

### 检查与构建

```bash
npm run typecheck
npm test
npm run build
```

构建结果位于 `dist/`。

## 注意事项

- 同学拉取代码后，可将 `config/meeting.env.example` 复制为根目录 `.env.local` 并填写自己的 API Key。本地会议数据和生成附件保存在 `local-data/`，不随 Git 提交；现有本地数据继续保留。

- 本项目的持久化接口由 Vite 开发服务器插件提供，应通过 `npm run dev` 运行完整功能；直接打开 `index.html` 或只托管 `dist/` 不包含本地写入接口。
- 默认端口为 `8443`。可通过 `PORT` 环境变量覆盖。
- `local-data/` 包含项目状态、上传文件和预览快照，请按需自行备份；删除该目录会使系统在下次启动时恢复默认演示数据。
- 单个上传文件上限为 5 MB。
- XLS/XLSX 预览依赖 npm 发布的 SheetJS `xlsx` 0.18.5；该版本存在尚无 npm 修复版本的安全公告，因此只应预览可信来源的表格文件。
- UML 代码导入支持系统定义的 PlantUML 子集，导入后应在可视化画布中确认布局和关系类型。
- 仓库不会提交构建产物、浏览器测试输出、本地项目数据、上传附件或原始需求资料。
