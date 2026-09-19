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

AI 能力和员工端模式不属于当前实现范围；每日工作量中的提交与进度明细为展示数据。

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

- 本项目的持久化接口由 Vite 开发服务器插件提供，应通过 `npm run dev` 运行完整功能；直接打开 `index.html` 或只托管 `dist/` 不包含本地写入接口。
- 默认端口为 `8443`。可通过 `PORT` 环境变量覆盖。
- `local-data/` 包含项目状态、上传文件和预览快照，请按需自行备份；删除该目录会使系统在下次启动时恢复默认演示数据。
- 单个上传文件上限为 5 MB。
- XLS/XLSX 预览依赖 npm 发布的 SheetJS `xlsx` 0.18.5；该版本存在尚无 npm 修复版本的安全公告，因此只应预览可信来源的表格文件。
- UML 代码导入支持系统定义的 PlantUML 子集，导入后应在可视化画布中确认布局和关系类型。
- 仓库不会提交构建产物、浏览器测试输出、本地项目数据、上传附件或原始需求资料。
