# ScrumFlow 完整回归测试与缺陷修复报告

测试日期：2026-10-24（Asia/Shanghai）\
基线分支：`main`\
基线提交：`75286e826a0d146c7cefb79231690bec76d59a9a`\
测试对象：本地 `C:/userProgram/项目管理/原型`，包含本报告所列修复后的工作区版本。

## 1. 测试结论

本轮完成了代码与文档梳理、现有测试基线、新缺陷复现、修复、全量自动化复测、真实 HTTP 接口检查和桌面浏览器主要业务链路回归。共确认并修复 **8 项缺陷**，涉及数据恢复保护、浏览器存储异常、恢复提示、上海日期、小数工时、用量账本隔离、弹窗遮挡和中文 CSV 预览。

| 检查层次 | 最终结果 | 说明 |
| --- | --- | --- |
| 原有基线测试 | 52 个文件，571/571 通过 | 证明原有测试没有捕获本轮全部缺陷 |
| 修复后全量测试 | **56 个文件，587/587 通过，0 失败、0 跳过** | 新增 4 个测试文件、16 项用例；单元、Store、组件和模拟服务测试合计 |
| 真实 HTTP 接口 | **22/22 通过** | 项目读写、并发和大小边界、附件、错误方法、模型状态与非法输入 |
| 浏览器业务回归 | 已执行场景全部通过 | 8 个主视图、保存恢复、四类会议、审批写回、验收返工、风险、资产、UML、课堂演示 |
| 导出文件检查 | 4 项附件/报告结构检查通过；UML PNG 另通过 | CSV 字节一致、ZIP CRC、包内 DOCX 和单独 DOCX；PNG 1230×360 |
| TypeScript | 通过 | `tsc --noEmit`，退出码 0 |
| 生产构建 | 通过，有体积及动态导入提示 | 退出码 0；提示详见第 8 节 |
| 补丁空白检查 | 通过 | `git diff --check`，退出码 0 |
| 正式数据保护 | 已核对并清理明确的测试账本记录 | 详见第 7 节，不能笼统理解为测试全过程零写入 |

在本轮已执行的软件测试范围内，8 项缺陷均已复测关闭，没有仍失败的已执行用例。真实麦克风识别、扬声器及中文音色、其他浏览器与移动设备尚未实际验收，不能将本次结果解释为这些场景也已通过。没有采集行/分支覆盖率，本报告中的“覆盖”指功能和测试场景覆盖，不是代码覆盖率百分比。

完整的 587 项用例名称与结果见 [测试用例明细 CSV](../output/regression-20261024/test-cases.csv)，可供逐条核查。主要机器结果见 [summary.json](../output/regression-20261024/summary.json)。

## 2. 项目理解与测试依据

### 2.1 依据和阅读方式

以**当前项目代码**和 [四次实验任务划分](四次实验任务划分.md) 为功能和阶段依据。README、模块说明及既有验收记录用于理解设计、寻找测试线索；既有文档中的完成结论不直接当成本轮实测证据。

对 `src/`、`server/`、`docs/` 建立了文件、导出项、测试标题、文档标题和哈希索引；初始索引包含 221 个文件、51,790 行，包含测试和文档。这是扫描索引规模，不表示对每行都做了人工审查。随后按页面入口 → 统一 Store/selector → Agent/执行器 → 本地接口与文件链路深入阅读，并结合测试结果核对规则。

重点阅读范围包括：`App` 和主导航、项目/地图/甘特/执行/Sprint/Release/分析/资产页面、`projectStore`、`selectors`、燃尽和 Release 规则、本地持久化与 blob 存储、UML 与项目用例图、事件检测和审批、会议路由/规划/约束/执行/材料、主持与语音生命周期、洞察与课堂沙盒、模型服务/路由/用量，以及对应测试。原始索引保存在 `output/regression-20261024/source-index.json`。

### 2.2 实际实现的功能与关键规则

项目是 React 19 + TypeScript + Vite + Zustand 的本地 Scrum 管理原型。Story、Task、Subtask、Sprint、Release、风险、资产、会议和 Proposal 等共享一份状态。项目和附件通过 Vite 中间件保存到本地文件；并非独立数据库服务，纯静态部署不能提供完整本地接口。

| 功能域 | 当前实际能力 | 本轮关注的关键规则 |
| --- | --- | --- |
| 项目与数据 | 基本资料、成员/角色/容量、空白项目、JSON 导入导出、迁移、保存恢复 | 非法导入原子拒绝；恢复失败保护原文件；中文和刷新恢复 |
| 需求规划 | 目标 → Epic → Story → Task → Subtask、Backlog、成熟度、排序与重挂父级 | 保持稳定 ID；跨视图一致；级联删除与封闭迭代约束 |
| 甘特与依赖 | 层级排期、父子日期联动、依赖、阻塞、关键路径、筛选、热力图和 PNG 导出 | 拒绝自依赖、重复和循环；父子排期与撤销成组同步 |
| Sprint 与燃尽 | 创建/启动/关闭、范围容量、结转、复盘、理想/实际/预测燃尽 | 同一时间仅一个活动 Sprint；关闭后执行写入受限；真实叶子工时、不伪造过去快照 |
| Release | 跨 Sprint 交付、版本归属、核心 Story、发布日期、发布检查 | 归属调整确认和原因；按验收而非 Task 完成判发布；拒绝跨版本不一致 |
| 执行与验收 | 状态/进度/负责人/工时/阻塞/成果；PO 验收、退回与重开 | 有 Subtask 时按叶子任务执行；完成不等于验收；验收日志追加保留 |
| 风险与分析 | 风险登记、影响、应对、状态；负载容量、热力图、趋势、每日态势 | 上海项目日；小数汇总可读；模拟历史须与真实数据区分 |
| 资产与 UML | 文件上传/预览/下载/关联；用例、时序、类图代码及画布编辑、快照/PNG | 中文编码；二进制一致；普通 UML 与项目专属用例图边界 |
| 项目专属用例图 | 顶层目标与用例按 ID 一一对应；参与者/布局/关系单独保存 | 同名目标不能误合并；增删改双向同步；无悬空连线 |
| 基础 AI 会议 | 项目/Story/Sprint 会议、多 Agent、数字成员、对象引用、多轮事实 | 查询不擅自变更；事实与假设区分；身份、约束、上下文和去重 |
| 事件与 Proposal | 逾期/阻塞/超载/验收等事件，采纳/拒绝/修改、执行前复验、审计 | **采纳不等于写回**；执行需复验；防止重复执行及过时建议生效 |
| 模型与材料 | 服务端密钥、模型分档、用量；DOCX/表格/图表、预览/版本/ZIP | 拒绝截断或非法输出；失败不伪造下载；密钥不由状态接口返回 |
| 会议扩展 | 四类 Scrum 会议、议程/计时、中文播报、语音转写、主动主持/纠偏/跟进 | 实际时间与 30 倍演示时间分开；切换上下文清理音频；明确确认后结束 |
| 洞察与课堂演示 | 冻结会议成果、图表/溯源/报告；预设离线会议和独立执行沙盒 | 会后跟进与冻结结果区分；演示写回不能污染当前项目 |

阶段归属：传统工具属于实验二；基础会议、多 Agent、事件、审核、材料和模型属于实验三；全局 AI、语音/中文播报、四类模板、主动主持、成果洞察、课堂沙盒及本轮综合回归属于实验四。摄像头/多人视频通话尚未实现，没有把它作为既有成果，也没有在回归中擅自扩建。

## 3. 环境与测试方法

| 项目 | 本轮环境 |
| --- | --- |
| 操作系统 | Windows，本地项目路径含中文 |
| Node | v24.22.1 |
| 测试/构建工具 | 已安装依赖中的 Vitest 5、Vite 8.3.0、TypeScript |
| 浏览器 | Playwright CLI 驱动 Chromium，UA Chrome/155.0.0.0 |
| 页面尺寸 | 主回归桌面 1440×960 |
| 运行方式 | 独立 Vite 服务 `http://127.0.0.1:18452/` |
| HTTP/浏览器数据 | `output/regression-20261024/data/`，由正式数据复制，使用 `PROJECT_DATA_DIRECTORY` |
| 自动化数据 | 默认 `output/vitest-data/`；允许显式环境变量覆盖 |
| 证据目录 | `output/regression-20261024/`；截图在 `output/playwright/regression-20261024/` |

采用四层验证：现有测试基线与新增边界测试；运行真实中间件的 HTTP 检查；浏览器普通点击、输入、刷新、下载；文件哈希、ZIP/OOXML/PNG 完整性检查。模型服务单元测试通常模拟供应商响应；另进行真实模型抽查。故意注入的 503 和损坏 JSON 用于确认恢复逻辑，不记作测试结束时的遗留故障。

## 4. 回归覆盖与执行结果

### 4.1 自动化功能覆盖

| 测试区域 | 已验证的重点 | 验证方式与结果 |
| --- | --- | --- |
| 统一状态/地图/执行 | 各层级增删改/重挂父级、Backlog 身份、状态进度同步、依赖阻塞、成果元数据、讨论、空白项目、JSON 往返 | `projectStore` 53 项通过 |
| Sprint 生命周期/PO 权限 | 启动条件、单活动迭代、关闭冻结、结转决定、非 PO 写入限制 | Store、会议管理等测试通过 |
| Release | 字段和归属、确认/原因、批次原子性、跨 Sprint、发布条件、非法导入和跨版本结转 | `release` 15 项通过 |
| 燃尽 | 叶子工时、启动基线、当日更新、返工/范围变化、缺日、预测、结转前冻结、上海日期 | `burndown` 13 项通过 |
| 日期和数字 | UTC/上海跨日、热力图今日、逾期判断、态势日期、0.1+0.2 汇总 | 新增 `analyticsRegression` 3 项通过 |
| 持久化异常 | 损坏文件/恢复副本、禁写、localStorage 不可用、重试清错、服务离线保留恢复副本 | 新增 `localPersistenceRecovery` 7 项通过 |
| 资产与 UML | 类型识别、默认图、子集解析/反生成、箭头/关系/布局；真实 CSV/XLS/XLSX 解析 | `assetFiles` 11、`uml` 9、新增预览 4 项通过 |
| 项目用例图 | 与目标一一同步、布局/参与者、同名目标、删除冻结、导入原子性、悬空关系 | `projectUseCase` 12 项通过 |
| 页面与全局 AI | 合并页面操作、入口、快捷聊天、放大/收起、资产推荐、甘特自动范围 | 对应组件测试全部通过 |
| 会议/Agent | 上下文、路由、只读意图、多轮方案、角色/时间/容量约束、数字成员、待审方案修改 | 所有对应测试通过；明细见附录 |
| 事件和审核执行 | 事件生成/解释/生命周期、采纳与拒绝、执行前复验、部分执行、幂等、来源/审计 | 对应事件/Proposal/执行测试全部通过 |
| 主持与计时 | 议程、延期、剩余时间/超时、语义纠偏反馈、阻塞跟进、冻结快照 | 主持、管理、成果等测试全部通过 |
| 语音/播报 | 完整句、手动停止末句、切换成员/会议、收起/卸载、迟到回调、权限/重启失败 | 语音 13 项、主持播报 10 项通过，**使用模拟浏览器语音 API** |
| 课堂隔离/洞察 | 沙盒执行、审计、冻结事实、指标和溯源、正式数据隔离 | 课堂与洞察组件/逻辑测试通过 |
| 模型与用量 | 分档/思考参数、中文跨 chunk、非法操作、余额不足、截断、遥测、费用、目录隔离 | 服务/路由/用量测试全部通过；新增隔离 2 项 |

上述是测试主题概括，不能据此推断每一种浏览器手势、所有文件格式或任意业务组合均已人工跑过。第 4.2 节单独列出本轮真实浏览器实际完成的动作。

### 4.2 真实浏览器业务回归

| 编号 | 场景和实际操作 | 核对结果 | 证据日志/截图 |
| --- | --- | --- | --- |
| B01 | 依次打开分析、项目、Release、Sprint、资产、甘特、执行、用户地图 | 8 个主视图正常；落盘工作区路由对应；29 Story/46 Task 未因导航变化；pageerror 为空 | `ui-navigation.log`；8 张主视图截图 |
| B02 | 中文项目名保存→刷新→恢复原名 | UTF-8 正常、刷新数据一致 | `ui-persistence_ui.log` |
| B03 | 拦截 PUT 返回 503，再点击重试 | 恢复副本存在；取消故障后 PUT 204、刷新正确 | 同上；`save-retry.png` |
| B04 | GET 返回损坏 JSON→恢复保护→取消故障→重试 | 显示保护提示，期间 **0 次 PUT**；恢复成功提示消失 | 同上；`restore-protected.png` |
| B05 | 每日站会新建、关闭播报、提交中文发言、推进议程、确认结束 | 会议 ended，成果快照存在，最终关闭可用，无错误提示 | `ui-meeting_status.log`；`daily-meeting.png` |
| B06 | Planning、Review、Retrospective 各创建、推进一次、结束确认 | 3 种会议均 ended 且有冻结快照 | `ui-meeting_templates.log`；**故意注入模型 503，验证离线归档** |
| B07 | 课堂演示→纪要→洞察→下载成果包和会议报告 | 展示 4 执行/2 拒绝/1 待审；当前 46 Task 与沙盒 25 Task 分开；当前项目无课堂任务及 Proposal 混入 | `ui-materials_download.log`；`classroom-insights.png` |
| B08 | PO 对 us029 验收通过 | 待验收 2→1、已验收 2→3，日志追加 accepted | `ui-acceptance_check.log`；`acceptance.png` |
| B09 | 对同一 Story 退回，填写原因，重开一个 Task，再刷新 | Story 回到 in_progress；保留 accepted/returned 日志；指定 Task 进度 60、in_progress | `ui-acceptance_facts.log`、`ui-acceptance_persisted.log` |
| B10 | 新风险登记→保存→改为 resolved→确认删除 | 修复前保存按钮被遮挡；修复后普通点击成功，删除后消失 | `ui-risk_create.log`、`ui-risk_save_fixed.log`；前后截图 |
| B11 | 逾期事件生成 CREATE_RISK 建议→采纳→执行→刷新 | 采纳后风险仍 4、审计 0；执行后风险 5、审计 1；刷新不重复 | `ui-event_approval.log`；`event-approval.png` |
| B12 | 上传无 BOM 中文 CSV→预览→下载→刷新后再预览 | 修复后中文和 0.3 正常；下载与上传逐字节相同；持久化可恢复 | `ui-assets_check.log`；`asset-csv-before.png` / `asset-csv-preview.png` |
| B13 | 打开已有 DOCX、XLSX 在线预览 | DOCX 可读正文 9,563 字符，XLSX 展示 75 个单元格 | `ui-asset_office_open.log`；两张预览截图 |
| B14 | 创建用例图→中文改名→输入 PlantUML→转画布→保存→导出 PNG→刷新 | 2 节点/1 连线、local-file 快照持久化；PNG 可解码，中文与箭头实图确认 | `ui-uml_check.log`；`uml-saved.png`、`uml-export.png` |

风险的正文编辑由已有组件测试覆盖；B10 的浏览器操作验证的是新建、状态变更和删除，没有将其夸大为正文编辑全流程。PO 退回设计使用 `deliveryStatus=in_progress` 并以最新 `acceptanceLog.returned` 分组，不存在必须写成 `deliveryStatus=returned` 的要求。

站会结束时自动摘要曾耗时约两分钟，忙碌期间关闭按钮禁用，完成后恢复；本轮没有把它误报为永久卡死。该观察也不是稳定时延或性能指标。

### 4.3 真实 HTTP 接口检查

22 项全部通过，原始逐条结果见 [http-results.json](../output/regression-20261024/http-results.json)。

| 接口 | 已执行检查 | 结果 |
| --- | --- | --- |
| `/api/local-project` | 非法 JSON 返回 400；拒绝后原文件不变；POST 返回 405 | 通过 |
| 同上 | 8 个并发 PUT 全部 204；最终文件完整且属于其中一份提交 | 通过；不将此等同于多用户版本冲突解决 |
| 同上 | 超过 25 MiB 返回 413；原内容不变 | 通过 |
| `/api/local-assets/:key` | 中文及 0–255 二进制字节写/读一致；MIME 保留 | 通过 |
| 同上 | 超过 5 MiB 返回 413，旧文件不变；编码路径穿越 ID 返回 400 | 通过 |
| 同上 | 缺失 404、错误方法 405、DELETE 后 404 | 通过 |
| `/api/meeting-llm` | GET 状态可读；不返回顶层凭据字段；非法 JSON/未知 mode 返回 400 | 通过；未声称全面安全渗透完成 |
| 项目删除与收尾 | DELETE→404；finally 恢复独立副本原快照 | 通过 |

### 4.4 模型与文件成果检查

真实模型抽查输入：“只分析当前风险，不修改项目，也不要生成行动建议。” `interpret` 返回 HTTP 200、`{"intent":"risk"}`，实际模型 `deepseek-flash`，约 1.28 秒，1 次尝试、0 重试；供应商返回输入 633 / 输出 6 tokens，系统估算费用 ¥0.0008772192。记录见 `live-model-result.json`。这只证明该次调用链路和意图输出成功，不能代表所有 Agent 的真实模型质量、全部复杂规划或材料创作都验收通过。站会摘要和事件解读还可能触发调用，该金额也不是本轮全部费用。

下载的 `项目材料成果包.zip` 实际包含会议报告 **DOCX、Markdown、HTML 共 3 项**，CRC 检查通过；包内 DOCX 和单独下载的 DOCX 均可解析 `word/document.xml`，OOXML 容器完整。独立保存文件名是 `classroom-minutes.docx`，实际内容是“Scrum 智能会议报告”，不能据文件名误称为其他文档。该 ZIP 本次不包含全部 WBS、风险或甘特材料；已有 WBS XLSX 另做了在线预览。文件结构检查不等同于 Microsoft Word 逐页排版验收。

CSV 下载字节完全一致；新导出的 UML PNG 解码通过、1230×360，并已查看图像确认中文参与者、用例和箭头正常。检查记录在 `artifact-results.json`、`materials-manifest.json`、`uml-export-result.json`。

## 5. 缺陷及修复详情

严重度是本轮基于影响作出的判断：高＝可能丢失/污染数据或阻断主要操作；中＝特定环境下功能或业务结果错误；低＝显示质量问题。

### F01 高：损坏的持久化快照未可靠阻止后续覆盖

- **复现**：项目 GET 返回 `{broken`、`null` 或 `[]`，或浏览器恢复键存有损坏 JSON；随后触发默认状态保存。
- **原表现/影响**：服务端读取值缺少有效 envelope 校验；损坏恢复副本在异常分支再次解析时可能提前抛错，未进入完整禁写保护。默认状态存在覆盖原文件/恢复副本的风险。
- **原因**：恢复结果的解析、结构验证、`restoreBlocked` 和写队列没有形成统一保护边界。
- **修复**：在 `src/store/localPersistence.ts` 检查 envelope 与 `state` 均为非数组对象；错误进入禁写状态、取消重试；`savePending` 同样检查保护状态；保留损坏恢复副本。
- **复测**：损坏文件 3 种参数和损坏恢复副本均通过新增测试；浏览器返回损坏 JSON 时观测到保护提示、0 PUT，恢复后正常。**已关闭**。

### F02 中：localStorage 不可用时，有效本地项目也恢复失败

- **复现**：浏览器存储 API 的 getItem/removeItem 抛出异常，但服务端项目文件有效。
- **影响**：把浏览器缓存不可用误当成项目文件不可恢复，阻断正常加载。
- **原因**：旧缓存读取/清理未独立处理异常。
- **修复**：通过安全读取函数和独立 try/catch 处理缓存；有效文件恢复不依赖缓存清理成功。
- **复测**：真实 `Storage` 方法异常桩下，有效文件正常返回、禁写标志为 false、状态 saved。**已关闭**。该环境异常用自动化模拟，未声称在所有浏览器隐私模式实测。

### F03 中：重试恢复成功后错误提示仍残留

- **复现**：首次 GET 503；再次 GET 返回有效快照。
- **影响**：项目已恢复，界面仍提示读取失败，用户难以判断能否继续保存。
- **原因**：成功读取路径没有显式发布 saved 状态清除旧 message。
- **修复**：成功恢复发布 `saved`，清空错误消息并允许后续保存。
- **复测**：新增测试断言状态精确为 `{state:"saved",message:""}`，后续 PUT 可发出；浏览器重试后保护 banner 消失。**已关闭**。

### F04 中：部分业务“今天”仍使用 UTC，上海凌晨错日

- **复现**：固定时钟 `2026-10-23T20:30:00Z`，上海已为 10 月 24 日。
- **原表现**：两张热力图今日锚点、任务逾期、态势记录，以及会议部分日期提示使用 `toISOString().slice(0,10)`，可能仍按 23 日判断。
- **修复**：`selectors.ts`、`ManagementPages.tsx`、`meetingConversation.ts`、`MeetingRoom.tsx` 统一使用已有 `projectDate()`。
- **复测**：新增跨日测试确认两张热力图均标记 24 日、23 日截止任务为逾期、新态势记录日期为 24 日；会议相关改动随全量 Agent/组件测试通过。未篡改历史快照。**已关闭**。

### F05 低：小数工时汇总显示浮点尾数

- **复现**：设置成员/任务工时参与 0.1+0.2 的聚合。
- **原表现**：分析页容量、未完成工时等可能显示 `0.30000000000000004h`；Sprint 汇总也直接暴露浮点累加。
- **修复**：分析指标和 Sprint 总/已完成估算聚合采用已有 `roundHours()`。
- **复测**：页面真实渲染断言显示 `0.3h` 且无长尾，全部分析/燃尽/Store 测试通过。**已关闭**。

### F06 高：模型用量账本忽略隔离目录，测试可能污染正式数据

- **复现**：设置 `PROJECT_DATA_DIRECTORY` 为独立副本，调用 `recordProviderUsage`。
- **原表现**：账本仍固定指向 `local-data/meeting-usage.jsonl`，与项目和附件的隔离目录不一致。
- **实际影响**：首次基线测试的模型服务模拟用量写入了一条正式账本记录，已准确确认并清理，详见第 7 节。
- **修复**：`server/meetingUsage.ts` 的读写都尊重目录环境变量，未设置时保留原默认位置；`vite.config.ts` 为 Vitest 默认设置 `output/vitest-data/`，普通运行测试也具有隔离目录，显式配置可覆盖。
- **复测**：新增 2 项测试覆盖自定义读写目录和默认兼容，fs 为模拟；最终全量测试刻意不由脚本传入目录，验证默认测试配置生效，生成隔离账本且正式账本哈希不变。**已关闭**。

### F07 高：风险弹窗保存按钮被 AI 悬浮球遮挡

- **复现**：桌面 1440×960 打开新建风险，填写内容，点击“保存风险”。
- **原表现**：普通点击等待 30 秒超时，Playwright 明确记录 AI orb 拦截指针；实图可见重叠。已有无浏览器布局的组件测试未捕获该问题。
- **原因**：公共 Modal 位于业务页的父层叠上下文，自己的 z-index 无法越过全局悬浮层。
- **修复**：`src/components/planning/Modal.tsx` 使用 `createPortal(..., document.body)`，让公共弹窗参与根层级。
- **复测**：原坐标 `elementFromPoint` 命中保存按钮，未强制点击即可成功创建；继续完成 resolved 和删除。全量组件测试通过。**已关闭**。

修复前：[遮挡截图](../output/playwright/regression-20261024/modal-overlap-before.png)；修复后：[可操作截图](../output/playwright/regression-20261024/modal-overlap-fixed.png)。

### F08 中：无 BOM 的 UTF-8 中文 CSV 在线预览乱码

- **复现**：上传 UTF-8 无 BOM CSV，内容含“任务、负责人、工时 / 中文回归、张伟、0.3”，打开在线预览。
- **原表现**：中文成为 `ä»»...` 等乱码，数字仍正确；下载文件并未损坏。
- **原因**：`AssetFilePreviewDialog.tsx` 将字节数组交给 SheetJS，CSV 无 BOM 时默认码页不为 UTF-8。
- **修复**：只对 `.csv` 或 `text/csv` 指定 `codepage:65001`，保留 XLS/XLSX 自身格式读取规则。
- **复测**：新增 4 项使用真实 SheetJS 解析的组件测试，覆盖无 BOM CSV、有 BOM CSV、二进制 XLSX、二进制 XLS 的中文/数值；修复前只有无 BOM CSV 失败，修复后 4 项通过。浏览器重新预览中文正确、刷新可恢复、下载字节与原文件一致。**已关闭**。

修复前：[CSV 乱码](../output/playwright/regression-20261024/asset-csv-before.png)；修复后：[CSV 中文正常](../output/playwright/regression-20261024/asset-csv-preview.png)。本次按系统既有 UTF-8 CSV 约定修复，未增加 GBK 等编码自动识别能力。

## 6. 修复验证与变更范围

新增用例采用先复现、再修复方式：

| 证据 | 修复前 | 修复后 |
| --- | --- | --- |
| `defects-red.json` | 持久化/分析 10 项中 9 失败、1 通过 | `defects-green.json` 中这 10 项与原 Agent 回归 12 项共 22 项通过 |
| `usage-red.json` | 自定义账本目录未生效 | 新增隔离 2 项在最终全量中通过 |
| `ui-risk_create.log` | AI 悬浮球拦截，普通保存点击超时 | `ui-risk_save_fixed.log` 保存/状态/删除通过 |
| `csv-red.json` | 无 BOM CSV 失败，另外 3 种表格通过 | `csv-green.json` 4/4 通过；真实浏览器复测通过 |
| `final-tests.json` | 原有基线 571 项 | **最终 587 项通过，包含全部 16 项新增测试** |

产品代码改动为 8 个文件：`localPersistence.ts`、`selectors.ts`、`ManagementPages.tsx`、`meetingConversation.ts`、`MeetingRoom.tsx`、`meetingUsage.ts`、`Modal.tsx`、`AssetFilePreviewDialog.tsx`；另更新 `vite.config.ts` 的测试隔离配置，新增 4 个测试文件。本轮没有调整依赖版本，也没有修改历史业务快照来“通过”测试。

最终一轮检查耗时（本机单次运行，非性能基准）：全量测试约 32.50 秒，类型检查 4.98 秒，构建 1.09 秒，diff 检查 0.09 秒，均退出码 0。机器记录为 `final-checks.json`。

## 7. 数据保护与测试副作用处理

HTTP 和浏览器操作在 `output/regression-20261024/data/` 内完成，包含临时验收、风险、会议、CSV/UML 和审批执行数据，没有把这些演练写回正式项目。该目录保留作复验依据。

必须单独说明首次基线测试的副作用：在修复 F06 前，`meetingModelService.test.ts` 的模拟供应商响应写入了正式 `meeting-usage.jsonl` 一条记录：UTC `2026-10-24T13:10:19.256Z`，interpret/deepseek-flash，输入 123、输出 45、合计 168 tokens，attempt 0。它与测试中的固定模拟值完全一致，时间落在基线运行期间。这是模拟记录，不能算真实模型调用或计费。

处理步骤：完整字节备份到 `formal-meeting-usage-before-cleanup.jsonl`；按时间、mode、model、usage、attempt、估算费用全部字段严格匹配，确认只匹配文件末尾一条后移除；其他历史记录逐字节保留。操作结果和前后 SHA-256 存于 `ledger-cleanup-result.json`。未顺手清除更早的类似历史记录，避免误处理原有数据。

哈希审计分两个阶段记录：

1. 建立隔离副本后至清理前：正式 `local-data/` 共 40 个文件全部与当时基线 SHA-256 一致，见 `data-protection-result.json`。这个基线建立于首次自动化测试之后，因此不能用它声称首次测试也完全没有写入。
2. 清理并运行最终全量测试后：除已明确清理的账本外，正式文件无变化；账本等于清理后的预期哈希；默认测试隔离目录确有生成账本，见 `data-protection-final.json`。正式项目状态与附件未变化。

测试专用浏览器和 18452 服务在收尾时关闭，测试数据、日志、脚本和下载文件保留在输出目录。本轮修复保留在本地工作区，未执行 Git 提交或推送。

## 8. 尚未实际验证和已观察到的限制

| 项目 | 当前结论及后续验收要求 |
| --- | --- |
| 真实语音硬件 | 语音生命周期和错误分支用模拟 API 通过；需在演示设备实际验证麦克风授权、识别准确度、手动停止末句、切人切会、外放/音色/语速与回声 |
| 多浏览器/设备 | 本轮真实浏览器为 Windows Chromium 桌面；Edge/Firefox/Safari、移动触控、系统缩放与窄屏完整流程未逐一实测 |
| 实际拖拽/复杂布局 | Store、排期与组件测试覆盖规则；未人工遍历所有地图/甘特拖拽、所有节点关系、超长图分块及文件格式组合 |
| 模型质量 | 已做真实意图调用及部分 UI 相关调用；大多数服务边界是模拟测试；未对全部模型、所有复杂规划、长材料创作和供应商故障做真实付费矩阵 |
| 性能/并发 | 做了 8 并发项目写入完整性；未做长期压力、数万任务、大附件组合、多人协作冲突、网络中断全矩阵；未宣称性能 SLA |
| 构建提示 | 构建成功，但主 JS 约 1.60 MB、elk 约 1.46 MB（压缩前），存在 >500 kB chunk 和动态导入无法拆包提示；可另做按路由/重型图表加载优化，未通过提高警告阈值掩盖 |
| 浏览器控制台 | 有 React DevTools 信息、开发服务重启连接日志、故意注入的两次 PUT 503，以及 React Flow attribution 警告；未发现被导航检查捕获的未处理页面异常。这些不等同于所有界面控制台永久零警告 |
| 文件和依赖 | 现有 README 已说明 `xlsx` 0.18.5 的已知公告和可信表格使用限制，本轮未进行依赖迁移/恶意文件渗透；CSV 默认 UTF-8，不自动识别所有传统编码 |
| 业务展示口径 | 每日实际工作量部分明细是演示数据；课堂发言是明确预设的沙盒示例；历史日期/模拟燃尽不能当成真实开发记录 |
| 视频能力 | 代码尚未实现摄像头视频通话，不计为本轮已验收功能 |

本轮修复没有发现需要继续保留为未关闭的已确认功能缺陷；上表列的是测试边界、已有设计限制和优化事项，后续验收应补充真实设备及环境矩阵。

## 9. 复验方式与证据索引

在原型目录执行（Windows 使用 `npm.cmd`）：

```powershell
npm.cmd test -- --maxWorkers=2
npm.cmd run typecheck
npm.cmd run build
git diff --check
```

Vitest 现已默认使用 `output/vitest-data/`。运行完整应用仍需 `npm.cmd run dev`；浏览器复验请另设端口和 `PROJECT_DATA_DIRECTORY`，不要将测试验收、删除、重置操作指向正式数据。`http_regression.py` 绑定本轮 18452 测试地址且含删除/超限测试，只能在独立副本服务上复跑。输出脚本 `setup.py` 拒绝覆盖已存在的副本目录，不能在未检查目录时直接重跑。

| 证据 | 位置与用途 |
| --- | --- |
| 初始工作区与提交 | `output/regression-20261024/baseline.json` |
| 原有/最终用例原始结果 | `baseline-tests.json`、`final-tests.json` |
| 最终退出码与完整命令输出 | `final-checks.json`、`final-tests.log`、`final-typecheck.log`、`final-build.log`、`final-diff-check.log` |
| 逐条用例明细 | `test-cases.csv`（UTF-8 BOM，适合 Excel）、本报告附录 |
| 红灯复现与绿灯复测 | `defects-red.json`、`defects-green.json`、`usage-red.json`、`csv-red.json`、`csv-green.json` |
| 接口 | `http_regression.py`、`http-results.json` |
| 浏览器 | `ui-results.json` 和 `ui-*.log`；对应 `.js` 文件为实际操作脚本 |
| 页面与缺陷前后截图 | `output/playwright/regression-20261024/` |
| 导出验证 | `artifact-results.json`、`materials-manifest.json`、`uml-export-result.json`、下载的 DOCX/ZIP/CSV/PNG |
| 真实模型抽查 | `live_model.py`、`live-model-result.json`，不含 API Key |
| 数据保护和账本清理 | `formal-data-before.json`、`formal-data-after.json`、`data-protection-result.json`、`data-protection-final.json`、`ledger-cleanup-result.json` 及原账本备份 |
| 代码扫描 | `source-index.json`；它是扫描时点的索引，最终新增 CSV 测试另见 Git diff 与最终用例结果 |

`output/` 和本地数据按仓库规则被忽略，证据保留在当前机器；以后仅推送代码仓库不会自动包含这些本机证据，交付归档时需连同输出目录按需保存。

## 附录：最终全量测试文件结果

以下由最终 Vitest JSON 自动提取，按文件统计，不使用 JSON 内包含 describe 分组的 suite 数充当文件数。全部 56 个文件、587 项通过。

| 测试文件 | 用例数 | 结果 |
| --- | ---: | --- |
| agentAcceptanceRegression.test.ts | 12 | 通过 |
| analyticsRegression.test.tsx | 3 | 通过 |
| assetFiles.test.ts | 11 | 通过 |
| assetPreviewRegression.test.tsx | 4 | 通过 |
| burndown.test.ts | 13 | 通过 |
| demoProject.test.ts | 9 | 通过 |
| eventApprovalInteraction.test.tsx | 3 | 通过 |
| eventDetection.test.ts | 11 | 通过 |
| eventExplanation.test.ts | 5 | 通过 |
| ganttRange.test.tsx | 5 | 通过 |
| globalAiAssistant.test.tsx | 10 | 通过 |
| localPersistenceRecovery.test.ts | 7 | 通过 |
| materialRecommendationMoment.test.tsx | 4 | 通过 |
| meetingArchitecture.test.ts | 14 | 通过 |
| meetingCallCost.test.ts | 1 | 通过 |
| meetingClassroomDemo.test.ts | 4 | 通过 |
| meetingClassroomInteraction.test.tsx | 2 | 通过 |
| meetingConstraintRegression.test.ts | 12 | 通过 |
| meetingDecision.test.ts | 14 | 通过 |
| meetingDefense.test.ts | 5 | 通过 |
| meetingDeliveryAudit.test.ts | 4 | 通过 |
| meetingDeterministicServices.test.ts | 2 | 通过 |
| meetingFacilitation.test.ts | 13 | 通过 |
| meetingFacilitationInteraction.test.tsx | 4 | 通过 |
| meetingFinalRevalidation.test.ts | 5 | 通过 |
| meetingHostSpeech.test.tsx | 10 | 通过 |
| meetingInsightsInteraction.test.tsx | 2 | 通过 |
| meetingIntentSafety.test.ts | 69 | 通过 |
| meetingLocalConfig.test.ts | 3 | 通过 |
| meetingManagement.test.ts | 24 | 通过 |
| meetingManagementInteraction.test.tsx | 8 | 通过 |
| meetingMaterialCost.test.ts | 4 | 通过 |
| meetingMaturity.test.ts | 16 | 通过 |
| meetingModelRouting.test.ts | 20 | 通过 |
| meetingModelService.test.ts | 8 | 通过 |
| meetingOutcomes.test.ts | 14 | 通过 |
| meetingPresentationPolish.test.ts | 7 | 通过 |
| meetingProposal.test.ts | 12 | 通过 |
| meetingReadOnlyRouting.test.ts | 8 | 通过 |
| meetingRealRequests.test.ts | 40 | 通过 |
| meetingRevisionReview.test.ts | 5 | 通过 |
| meetingRoom.test.ts | 6 | 通过 |
| meetingRoomInteraction.test.tsx | 8 | 通过 |
| meetingShowcaseV2.test.ts | 1 | 通过 |
| meetingTelemetry.test.ts | 3 | 通过 |
| meetingUsageIsolation.test.ts | 2 | 通过 |
| meetingVoice.test.tsx | 13 | 通过 |
| meetingWorkingState.test.ts | 4 | 通过 |
| pageConsolidation.test.tsx | 7 | 通过 |
| projectEventIndex.test.ts | 4 | 通过 |
| projectMeeting.test.ts | 10 | 通过 |
| projectStore.test.ts | 53 | 通过 |
| projectUseCase.test.ts | 12 | 通过 |
| proposal.test.ts | 13 | 通过 |
| release.test.ts | 15 | 通过 |
| uml.test.ts | 9 | 通过 |
