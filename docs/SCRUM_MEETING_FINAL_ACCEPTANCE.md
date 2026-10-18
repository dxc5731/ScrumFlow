# AI 敏捷会议执行官：最终交付验收

验收日期：2026-10-18（Asia/Shanghai）。结论：**可进入最终人工验收**。文字版完整闭环可录屏；带真实收音和外放的版本须先完成 D 节设备检查。本结论不等同于音频设备验收或团队效能实验结论。

## 验收对象与数据保护

- 基于当前工作区前三阶段成果，Git HEAD 为 `857b58e876002d6735ac745d9309adb033eb53d6`；不是只验收该提交中的旧实现。
- 已阅读 `AGENT_INTEGRATION_CONTRACT.md`、`docs/SCRUM_MEETING_PHASE1.md`、`PHASE2.md`、`PHASE3.md`、`SCRUM_MEETING_VIDEO_PHASE3.md` 及相关实现和测试。仓库内含忽略文件的搜索未找到 **`PROJECT_OVERVIEW_AND_BACKLOG.md`**，因此不声称核对过该文件；需求完成度以本轮明确要求及实际阶段文档为准。
- 正式数据从 `local-data/` 复制至 `output/scrum-final/data/`，验收服务为 **http://127.0.0.1:18446/**。所有新增会议、Proposal、风险写回和材料在此副本中完成。正式端口的数据未用于试写。
- 本轮开始前的 dirty 文件备份见 `output/scrum-final/before/`，初始文件指纹见 `before.json`。保留原有修改；未 reset、clean、强制切换、提交或推送，也未引入依赖。
- 正式 `local-data/project-state.json` SHA-256 前后均为 `4c121ffb3394eaf2adfe3d8428b055b5022774c90d62435d5758f3f03cd5e641`；`.env.local` 指纹也一致，未在报告中暴露凭据。
- 副本中唯一业务实体变化为 `risk-fe025` 的 mitigation，来自本场已审核执行的行动。其他新增内容为验收会议、主持事件、Proposal、摘要、资产及本地事件生命周期记录；额外抽查产生的 event-origin 建议保持待审，未执行。

## A. 原始需求完成度

“完整实现”指本轮列明的业务范围，不代表覆盖所有浏览器、所有自然语言或大型团队场景。验证缩写：B=真实 Chromium 操作及持久状态，R=真实模型响应，T=本轮自动测试，C=代码审查。自动测试中的模型及语音替身不计为真实服务/设备验证。

| 需求项及实现程度 | 当前实现位置 | 验证方式 | 验收结果 | 遗留问题或边界 |
| --- | --- | --- | --- | --- |
| 四类 Scrum 模板、默认时长与主持目标（完整） | `meetingFacilitation.ts`、`MeetingSetup.tsx` | B：四类逐一创建并结束；T | 已通过 | 15/90/60/45 分钟；共享主持配置，不要求每人严格两分钟 |
| Sprint、成员、任务上下文（完整） | `meetingContext.ts`、`meetingManagement.ts`、`MeetingRoom.tsx` | B/R：Sprint 2、FE-025-1、数字李娜；T/C | 已通过 | Sprint 2 状态仍为 active，但计划结束日已过，界面及分析明确提示 |
| 原议题状态、推进与历史（完整） | `session.topics`、Store、HostControls | B/T | 已通过 | “已推进”表示 discussed/recorded/decided，有记录不等于验收完成；结束会记录当时议题，确认结束前后推进数可能随之增加 |
| 实际计时、黄色/红色提醒、延期（完整） | `meetingFacilitation.ts`、`MeetingHostControls.tsx` | B：×30真实等待及刷新；T：普通时间戳边界 | 已通过 | 普通会议未在浏览器空等完整15分钟，长时间边界由时间戳测试覆盖 |
| 演示与真实用时分离（完整） | Facilitation、`meetingOutcomes.ts` | B/T、持久化字段核对 | 已通过 | demoElapsedMs 不能作为实际发声或实际会议耗时；演示真实超时为 null |
| 主动开场、切换、提醒、结束及成果汇报（完整） | `dispatchMeetingHostEvent`、Facilitation、Outcomes | B：无需 @ 即主动出现；T | 已通过 | 固定节点采用事实模板，不虚称每条均由大模型生成 |
| 语义纠偏及当前议程（完整于本阶段） | `useMeetingManagement.ts`、`meetingManagement.ts`、`meetingLlm.ts` | B/R：连续闲聊、当前阻塞；T | 已通过 | 轻量筛选后语义复核；不是任意偏题的完美分类器 |
| 返回/继续/误判、冷却与去重（完整） | host resolution、management 持久状态、Store | B/R：三种选择、重复输入、刷新；T | 已通过 | continue 两分钟、incorrect 五分钟及话题签名；按真实时间，非演示时间 |
| 正常技术讨论与保守降级（完整于所验场景） | `meetingManagement.ts` | B：Gantt/排期/容量不纠偏；B故障模拟；T | 已通过 | 单句“火锅”不触发；模糊话题证据不足不提醒；未据少量样例宣称准确率 |
| 主动 Sprint 阻塞与成员线索（完整） | Management、风险/依赖分析、现有事件检测 | B：进入阻塞、FE-025-1报告；T：模糊任务确认 | 已通过 | 只可靠匹配唯一任务；成员新报告标待核实，不自动变成项目事实 |
| 风险事实、依赖与 What-if 边界（完整） | `meetingConversation.ts`、`projectMeeting.ts`、现有依赖/容量工具 | B/C/T | 已通过 | 主闭环为确定性事实分析，无需模型调用；没有声称“必延期N天” |
| Proposal 人工确认及统一执行器（完整） | `projectStore.ts`、原 Proposal UI/执行器 | B：草稿→采纳→最终校验→应用；T | 已通过 | 草稿和采纳均未改 tasks/risks；确认应用后才有审计 |
| precondition、去重、重试与部分失败（完整于现契约） | 原 `applyProposal` 及校验器 | T：proposal/agentAcceptanceRegression/meetingManagement；C | 已通过 | stale、重复写回、混合操作主要是自动测试；不谎称都逐项浏览器复现 |
| 会议与事件实际入口集成（部分） | App/useEventMonitor、EventInsightPanel、CanvasTopBar | B：事件生成待审建议和统一中心；C/T：生命周期/执行 | 部分通过 | 已共享检测、Proposal、人工审核、执行及审计；不是每项会议风险都双向绑定事件记录，也不是完整通知投递服务 |
| 任务拆解、容量、约束、多 Agent（已有完整核心） | `meetingDecision.ts`、已有 specialists/约束校验 | B/R：Planning数字成员；B：容量；C/T：拆解/What-if/约束 | 已通过 | 本轮没有额外完整浏览器执行任务拆解写回，已有全量回归覆盖；不扩展其他成员模块 |
| 中文识别、实时字幕、说话人、逐句保存（实现完整，设备未验） | `useSpeechTranscription.ts`、MeetingRoom | C/T：final/interim、切成员、权限异常、迟到回调、重启与清理 | 待人工验证 | 真实麦克风及浏览器识别服务必须人工测试；计数称转写记录，未声纹识别 |
| 主持播报、静音、打断和识别互斥（实现完整，设备未验） | `useMeetingHostSpeech.ts`、MeetingRoom | B：开关；C/T：中文voice选择、取消、pagehide、故障降级 | 待人工验证 | 未试听真实中文声音/外放；互斥逻辑不构成声学回声消除保证 |
| 纪要、会议记忆、会后解释（完整） | `meetingMinutes.ts`、Narrative、Store | B/R：摘要与真实执行一致；T | 已通过 | 模型解释需以原文和审计为准；无模型时保留事实模板 |
| 五项概览和三图（完整） | `meetingOutcomes.ts`、`MeetingInsights.tsx` | B/T：原消息/主持/Proposal/审计逐项核对 | 已通过 | 消息条数非工作贡献；无发声时长、质量分、效率提升百分比 |
| AI时间线与原始证据（完整） | Insights、MeetingRoom消息定位 | B：纠偏定位、Proposal定位；T | 已通过 | 老记录没有hostEvent时显示无记录，不补造事件 |
| 采纳/拒绝/执行及本场归属（完整；本轮修复） | Outcomes、Minutes、Presentation、Narrative | B：1条精确审计；T：外部、existing、无审计 | 已通过 | Action条数非Proposal卡片数；只本场明确归属且有审计才计执行 |
| 结束快照及会后本场跟进（完整；本轮补讨论快照） | outcomeSnapshot、`meetingOutcomeState`、types | T：冻结与审计重放；B：刷新恢复 | 已通过 | 旧会议无快照只能展示当前对象参考；缺旧讨论证据时不借今日数据填造 |
| 会议材料推荐与原资产库（完整） | materialRecommendations/Organizer、Insights | B：推荐、Word预览、加入成果包并下载 | 已通过 | 点击后生成，未自动批量造所有材料 |
| 正式会议报告导出（完整于现支持格式） | `meetingReport.ts`、原文档/资产生成器 | B：DOCX/HTML/MD/ZIP；包/文本/8表核对 | 已通过 | 网页图表在Word转换为对应数据表；未验原生Word分页或打印PDF成品 |
| 1440/1024/390布局（完整于所验宽度） | MeetingHost/Room/Insights CSS | B：测量和实际截图审查 | 已通过 | 390px合理换行，侧栏按响应式收纳；不要求窄屏强塞三栏 |
| 历史稀疏数据、切换与刷新（完整） | Store恢复、Outcomes、Room | B：真实10月7日旧会议、切回主会、0额外模型请求；T | 已通过 | 缺开始时间、来源或归属的指标显示暂无记录/未知 |
| 代码分析Agent补全、新声纹/WebRTC/贡献评分/新事件架构（不开发） | 其他成员模块或明确排除项 | 范围核对 | 不在本次范围内 | 不将早期embedding、严格发言限时等建议实现方式当作必须重做的算法 |

## B. 测试与代码审查

### 本轮实际结果

| 检查 | 最新实际结果 | 证据（仓库根目录相对路径） |
| --- | --- | --- |
| 全量测试 | **484/484，42文件通过**，44.53s；原480加本轮4条 | `output/scrum-final/tests-final.log` |
| TypeScript | `npm.cmd run typecheck`，退出0 | `output/scrum-final/typecheck-final.log` |
| 生产构建 | `npm.cmd run build`，退出0 | `output/scrum-final/build-final.log` |
| 真实模型 | host_review 200（deepseek-flash），数字成员explain 200（Flash），Planning meeting_summary 200（deepseek-v4-pro）；主会摘要也已持久化Pro来源 | `flow1-result.log`、`feedback-result.log`、`types-result.log`、`final-view-result.log` |
| 真实浏览器 | 主闭环、四类型、反馈、演示计时、旧会议、3宽度、导出和刷新均成功 | 下方证据索引，均在 `output/scrum-final/` |
| 报告内容 | Word/HTML各8表，含三图数据、真实会议/Proposal/History ID；ZIP含docx/html/md | `verification.json`、`report-extracted.txt`、`preview-result.log` |
| 正式数据与编码 | 正式状态/配置哈希不变；修改代码/文档UTF-8检查通过 | `before.json`、`verification.json` |

本机采用 `npm.cmd test -- --reporter=dot --maxWorkers=2` 作为全量验收命令。最初默认高并发与类型/构建同跑出现11个超时/连锁失败，单独默认并发仍有2个长流程5秒超时；限制两个worker后原480和修复后的484均通过。保留 `tests-baseline.log`、`tests-recheck.log`、`tests-controlled.log`，没有删除断言、屏蔽测试或放宽超时。限制并发是本机资源竞争的执行约束，不能把第一次失败日志抹掉。构建仍有既有大包、静态/动态导入并存警告，未扩大成打包重构。

### 已确认缺陷与最小修复

先以 `meetingDeliveryAudit.test.ts` 复现失败，再局部修复并全量复测。

| 编号/等级 | 根因与影响 | 修复及验证 |
| --- | --- | --- |
| D1 / P0可信度 | 洞察要求审计，但旧纪要/可读展示直接按applied计执行；旧数据缺审计会虚称成功 | Minutes/Presentation复用 `actionOutcome`，缺证据显示待核实；新增无审计回归 |
| D2 / P0可信度 | existing复用也被计作新写回；摘要曾将未执行的复用误说成人工拒绝 | 按实际decision及executionOutcome区分；复用不算新执行、不算拒绝；新增回归 |
| D3 / P0可信度 | 本会链接外部Proposal时，旧纪要/模型输入可把其他会的成果计入本场 | 复用 `meetingOwnedProposals`，外部只作关联建议；模型verifiedActions/执行依据限定本场；新增跨会回归 |
| D4 / P1快照 | CREATE_DISCUSSION缺少结束讨论快照，后来删改讨论会使旧报告解释漂移 | 快照加入discussions及本场审计重放；老快照缺记录不回填当前讨论；新增冻结回归 |
| D5 / P2文档 | 集成契约仍含2026-10-08“无事件producer/统一中心”旧断言 | 保留历史说明并新增实际集成及非核心边界；未改变origin或执行契约 |

本轮主要代码修改：`src/agents/meetingMinutes.ts`、`meetingPresentation.ts`、`meetingNarrative.ts`、`meetingOutcomes.ts`、`src/types.ts`；新增 `src/tests/meetingDeliveryAudit.test.ts`。另修改 `AGENT_INTEGRATION_CONTRACT.md`、本报告及阶段3交付索引。原工作区已有的 `meetingExecutionSummary.ts` 跟进讨论描述保持并回归核对，没有把原有修改重写为另一套实现。

复现日志：`audit-reproduction.log`、`audit-reproduction-valid.log`。第一次讨论测试fixture未带执行器要求的前置条件，后补齐真实契约再确认快照缺陷；没有用无效fixture判定产品失败。

### 可信度与集成审查结论

- 人工边界成立：主会分析、生成Proposal、采纳后均比对tasks/risks未变，只有“确认应用”后增加精确proposalId/actionId审计。状态依次为pending、accepted未执行、applied有证据；不是点击采纳就算完成。
- 原执行器仍负责前置条件、依赖、任务约束、stale和重试/复用。`proposal.test.ts`、`agentAcceptanceRegression.test.ts`、`meetingManagement.test.ts`、`meetingArchitecture.test.ts` 和约束回归均通过。
- 事件不是空壳：App挂载useEventMonitor，恢复后巡检、相关修改250ms合并、每分钟检查日期；`projectEvents`持久化。EventInsightPanel确实生成event-origin、带eventBasis的建议，CanvasTopBar共用待确认中心与执行器。
- 浏览器额外生成 `proposal-1792299292304-4fgke`（event-origin、deadline事件），生命周期记录为suggested并关联Proposal；保持未审未执行、业务/审计未变。另一条事件抽查草稿也留在副本，不计主会成果。
- **集成边界仍为部分**：会议能复用事件检测及匹配的既有Proposal，但所有会议风险没有统一双向事件关联。更新mitigation不是关闭dependency事件，不把尚未解除的阻塞说成已解决。协作通知不是完整送达服务，代码分析Agent不在此验收补全范围。
- 成果统计来自消息、hostEvent、明确归属Action及匹配ChangeHistory。旧记录不推算真实时长/贡献；snapshot冻结结束事实，仅重放本场明确Action的后续审批审计，不引入后来无关项目修改。

### 浏览器证据索引与执行异常记录

每个成功CLI日志必须含 `### Result`，不能仅凭进程退出码判断成功。完整操作脚本与结果均保留；这是一次真实浏览器彩排，未录制视频文件。

| 场景 | 脚本 → 成功结果 |
| --- | --- |
| 主站会前半/后半 | `flow1.js` / `flow2.js` → `flow1-result.log` / `flow2-result.log` |
| 图表、定位、三宽度、导出、刷新 | `qa.js` → `qa-result.log` |
| 原材料预览与ZIP | `preview.js` → `preview-result.log` |
| 四类型及Planning | `types-and-planning.js` → `types-result.log` |
| 误判/继续/故障降级 | `feedback.js` → `feedback-result.log` |
| 演示计时、延期、刷新 | `timer.js` → `timer-result.log` |
| 稀疏旧会议及切回 | `legacy.js` → `legacy-result.log` |
| 事件producer与统一待审中心 | `event-integration.js` → `event-integration-result.log` |
| 最后主会洞察及摘要核对 | `final-view.js` → `final-view-result.log` |
| 数字/文档/正式数据保护复核 | `verify.cjs` → `verification.json`；`evidence-index.json`汇总索引 |

故障模拟：feedback中的两次host_review请求由Playwright主动abort，只用于降级测试，不能写成真实模型服务故障。模糊发言不纠偏、明确连续闲聊才rules降级。真实服务成功响应与此分别保存。

浏览器执行过程保留了可解释的失败日志：一次在验收同时编辑source引发HMR中断，稳定source后完整重跑；脚本曾误将桌面140px目标套到390px、误以为延期5分钟必回绿色、历史菜单初始已开却又关闭、断言标签用错、eventBasis层级和操作后locator假设错误。这些属于验收脚本问题，调整断言以符合真实契约后重跑，未改产品来迎合错误预期。对应 `feedback-interrupted-by-hmr.log`、`timer-*-assumption.log`、`timer-desktop-threshold-on-mobile.log`、`legacy-*-script-assumption.log`、`event-*-script-assumption.log` 保留。未发现未解决的P0/P1产品缺陷。

页面console主要有上述故障模拟ERR_FAILED、过期Sprint一致性警告及开发服务器重连记录，未见主闭环产品崩溃。这里只代表本次场景，不能推导长期服务可用率。

## C. 完整站会彩排

### 本次真实对象与结果

- 主会议：`meeting-1792294772134-qgirf`，2026/10/18 11:39:32开始。
- Sprint 2：`s2`，2026-09-14至09-27；计划期已过，未偷偷修改日期。
- 任务：`fe-025-1` / FE-025-1「甘特依赖连接线渲染」，李娜、blocked、8h；上游 `data-024`「定义 Story 与 Task 数据模型」，张伟；后续 `test-025`。
- 建议：`proposal-1792294819148-2tqim`，Action `action-1792294819148-k9zf2`；审计 `history-1792294875476-a5fmn`。
- 实际只在既有 `risk-fe025` 上补充跟进措施。**没有解除依赖、完成任务、更换负责人或重排工时**，因此讲解只能说“风险跟进措施已写回”。

| 步骤 | 实际操作/输入 | 实际结果 | 验收 |
| --- | --- | --- | --- |
| 1 | 新建每日站会，Sprint2，关闭播报，普通计时 | 15分钟、三议程、隔离会议建立 | 通过 |
| 2 | 点击开始，不@主持 | 项目主持主动欢迎，引用真实任务及负责人；左侧显示计划期已过 | 通过 |
| 3 | 张伟：“昨天我继续核对 Gantt 数据结构、任务延期和前置依赖，今天先确认当前 Sprint 容量与负责人。” | 正常保存，无误纠偏 | 通过 |
| 4 | 连续提交：“我们周末要不要组织一次聚餐？”、“我觉得可以去学校附近吃火锅，大家有什么推荐吗？” | 真实host_review返回持续无关、两条证据ID；一次温和纠偏，项目主持身份 | 通过 |
| 5 | 点击“返回当前议程” | resolution=return持久化，不硬阻止继续发言 | 通过 |
| 6 | 下一议程到今日计划；切发言成员李娜，提交“今天先核对甘特依赖连线与前置接口的交接条件，确认需要谁协助。”；再下一议程到当前阻塞 | 主动议程引导、真实过期Sprint提示；重点列出test-025与be-024-1两项问题 | 通过 |
| 7 | 李娜：“我负责的 #FE-025-1 暂时做不了，因为前置的数据结构还没确定，可能影响后面的测试。” | 唯一真实Task匹配，成员报告标待核实，主动追问 | 通过 |
| 8 | 在该追问点击“查看依赖影响” | 原风险与依赖Agent列上游、后续与依据；明确不是确定延期，未改数据 | 通过 |
| 9 | 点击“加入待确认行动” | 右侧pending Proposal，复用risk-fe025，不另造同风险；业务无变化 | 通过 |
| 10 | 采纳该行动→“最终校验并应用”→检查→“确认应用” | 采纳时仍无写回；最终确认后mitigation变化、精确审计1条、状态执行成功 | 通过 |
| 11 | 完成剩余议程→结束会议→确认结束 | 结束消息、outcome、快照、纪要、真实模型摘要保存 | 通过 |
| 12 | 会议纪要→会议洞察；点击时间线/原始Proposal | 真实三图和执行成果；可回到纠偏原文、依据和已执行建议 | 通过 |
| 13 | 导出会议报告→材料在线预览→加入成果包、下载ZIP | Word/HTML/MD及包结构正确；三图对应数据入文档 | 通过 |
| 14 | 刷新→历史会议打开本场，再开旧会、切回 | 消息ID、摘要generatedAt及快照不变；查看/导出/刷新0额外模型请求 | 通过 |

模型层记录：主会纠偏实际返回200、deepseek-flash、confidence 0.95（这是单次模型自报置信度，不是实测准确率）；事实风险分析使用已有确定性工具，故无模型请求是正常设计。主会摘要保存为deepseek-v4-pro；补充Planning另有直接捕获的meeting_summary 200响应。上述流程没有固定句子返回假的智能结果。

### 主会数字复算

| 指标 | 原始来源 | 核对值 |
| --- | --- | --- |
| 实际用时 | startedAt→endedAt / actualDurationMs | 114,776ms，页面01:54；普通计时，计划15分钟 |
| 成员参与 | senderType=user、非空已提交消息 | 2人、5条text；张伟3、李娜2；不含AI/数字员工 |
| 议程 | topics真实状态 | 3/3已推进，不称“3项验收通过” |
| 主持事件 | hostEvent | 9条；3条流程引导，0时间提醒，1纠偏、1返回反馈 |
| 阻塞跟进 | sprint_blocker/blocker_followup的taskIds集合 | 3项任务，不是3项风险已解决 |
| 建议与执行 | 本场sourceMeetingId、Action、History | 1建议、1采纳、0待确认、0拒绝、1有审计执行成功 |
| 报告表格 | Word XML/HTML | 各8表，含三图对应数据与原始ID |

演示计时独立会议 `meeting-1792298808303-vuzck`：真实43,043ms；demoElapsedMs=1,291,290（×30）；最终预算由15→20→30分钟；actualOvertimeMs=null，demoOvertimeMs=0。原15分钟黄色、红色事件各1次且键唯一，延期20分钟时剩余不足2分钟，因此产生新预算的黄色提醒是正确行为；延期不抹除之前发生过的提醒。已结束且无Proposal的会议也正常显示。

四类型补充：Review60、Retro45、Daily15均创建、欢迎、推进、结束恢复；Planning90完整推进，实际数字李娜回答FE-025-1，容量助手显示剩余工作日0/可新增容量0，并提示Sprint计划已过。Planning没有Proposal或业务写回，证明主持流程不只适用于站会。其他类型只推进部分议程时保留pending，不虚构全完成。

纠偏补充：在“当前阻塞”阶段真实模型同样能纠偏；单句“火锅”和两条正常Gantt/延期/容量讨论不触发。点击“判断有误”或“继续讨论”后重复同话题及刷新均未立即重放，反馈持久化。

### 界面与录制建议

1440×900、1024×900、390×900实测：活动会议专属控制区分别108.5、135、163.5px，桌面达到约100–140px目标；390px合理换行。红黄状态没有新增整行横幅。输入框底边在900px以内，结束操作未裁切。洞察三宽度均无横向溢出，导出按钮可见；宽屏保留原三栏，窄屏按已有规则收纳。截图见 `output/playwright/scrum-final-live-*.png`、`scrum-final-insights-*.png`。

主链路建议用**普通计时**，另外录一段×30展示黄/红/延期，避免主持分析时演示时钟很快到点。两句闲聊分别点击发送，等待纠偏后再点击下一步；不要反复刷入同类内容。有精确Task引用时用 `#FE-025-1`，遇到不可靠匹配先确认，不用编造新Task。模型延迟保留自然等待，可在视频剪辑中压缩等待，但不要配造回复。

当前副本已经执行过risk-fe025跟进，再提交相同措施应正确复用/去重。**重新录完整审批写回必须另建一份正式数据副本并使用新端口**；不要删除正式审计或改回业务实体来制造“再成功一次”。现有副本适合查看已验历史、导出及音频检查；不得据它重复生成同动作失败就认定执行器坏了。

## D. 最终人工验收清单（建议依序）

下列勾选由用户本人完成；本报告不提前代勾。涉及项目写回的步骤仅在新隔离副本操作。

- [ ] **先核对环境**：打开18446隔离服务，项目概览→历史会议→2026/10/18 11:39:32；看到01:54、1项已执行与risk-fe025审计。不要在正式数据页面练习审批。无需音频。
- [ ] **看一遍已验成果**：会议纪要→洞察，核对2人5条、3/3推进、9次主持事件、1项实际执行；点击纠偏时间线回原文、查看原始Proposal及实际变更。无需音频。
- [ ] **检查正式文档**：材料区预览/下载报告，或打开 `output/scrum-final/Scrum-meeting-report.docx`；核对三图数据表、摘要、Proposal/History ID和分页；必要时在Word/打印预览中检查最终分页。无需音频。
- [ ] **完整文字录屏彩排**：使用新隔离副本，依C节14步输入和操作，从新建每日站会到审批写回、结束、洞察、导出、刷新；确认草稿/采纳不改业务、确认应用后才出现审计。无需音频。
- [ ] **演示时钟镜头**：另建每日站会，勾选演示×30，等待约26秒黄色、约30秒红色；更多→延长5/10分钟，结束后核对真实/演示两种用时。无需音频。
- [ ] **误判反馈及非站会抽查**：新会两句闲聊后点判断有误/继续讨论，再输入同话题不立即重复；另建Planning或Retro，核对对应时长和议程。无需音频。
- [ ] **真实中文转写**：支持SpeechRecognition的浏览器进入新隔离会议，选择张伟→语音发言，说“昨天完成接口联调，今天确认依赖数据”；看到实时字幕、最终消息归张伟且只保存final文本；切李娜后说另一句，归属不串。**需要麦克风、权限及可用识别服务**。
- [ ] **停止和权限异常**：录音中停止/切会/关闭，再打开没有残留字幕或迟到写入；拒绝麦克风权限后文字输入仍可用。**需要麦克风/权限交互**。
- [ ] **中文播报音色**：开启主持人语音后点击开始，试听欢迎、切议程及提醒；关闭开关立即静音，新提醒不堆积；浏览器不支持时文字仍完整。**需要外放或耳机**。
- [ ] **识别与播报互斥/回声**：主持播报时启动成员录音，确认播报停止、成员最终文本没有主持人的话；停止录音后新主持事件可播报。再切会、结束、关闭页面，确认没有残留声音。**需要麦克风与音频设备，建议耳机**；自动Mock不替代此项。
- [ ] **最终录制**：文字闭环通过后，音频已验才录带声音版；建议保留7镜头：主动欢迎/紧凑顶栏、真实纠偏及反馈、阻塞事实、风险分析、采纳未执行→确认应用与审计、三图与时间线、报告预览及刷新恢复。

## E. 论文与汇报素材

2026-10-18已在线核验arXiv与Crossref元数据/公开摘要。`output/scrum-final/research.json`及`research-chi.json`保存真实200响应信息；SPACE出版商Queue页面返回403（`space-publisher.json`），其书目信息和摘要依据Crossref，不能声称读到了受限出版页全文。此处未新增论文算法或系统性能实验。

1. **Mo Houtti, Moyan Zhou, Loren Terveen, Stevie Chancellor.** *Observe, Ask, Intervene: Designing AI Agents for More Inclusive Meetings.* Proceedings of the 2025 CHI Conference on Human Factors in Computing Systems, ACM, 2025, pp.1–18. DOI: [10.1145/3706598.3713838](https://doi.org/10.1145/3706598.3713838)；[arXiv:2501.10553](https://arxiv.org/abs/2501.10553)。arXiv日期2025-01-17，Crossref出版日期2025-04-25。研究会议包容性与虚拟协同主持，提出观察、询问、干预的OAI思路；本项目仅借鉴上下文观察、克制建议和用户控制，并未完整复现“先询问再干预”协议、原型或包容性实验。
2. **Beatriz Cabrero-Daniel, Tomas Herda, Victoria Pichler, Martin Eder.** *Exploring Human-AI Collaboration in Agile: Customised LLM Meeting Assistants.* In *Agile Processes in Software Engineering and Extreme Programming* (XP 2024), Lecture Notes in Business Information Processing, Springer Nature Switzerland, 2024, pp.163–178. DOI: [10.1007/978-3-031-61154-4_11](https://doi.org/10.1007/978-3-031-61154-4_11)。工业行动研究聚焦Daily Scrum与feature refinement中的AI助手、协作及部署准备；不是本项目四类模板或Proposal执行器的现成算法。
3. **Nicole Forsgren, Margaret-Anne Storey, Chandra Maddila, Thomas Zimmermann, Brian Houck, Jenna Butler.** *The SPACE of Developer Productivity: There's more to it than you think.* ACM Queue, 19(1), 2021, pp.20–48. DOI: [10.1145/3454122.3454124](https://doi.org/10.1145/3454122.3454124)。Crossref登记主标题为 *The SPACE of Developer Productivity*，后半为常用展示副标题；日期2021-02-28。研究多维开发者生产力衡量，不能单以活动量评价；本项目借鉴多维事实与指标边界，没有实现完整SPACE框架或会议质量评分算法。

| 研究依据 | 实际设计与自己的工程简化 | 代码实现 | 可展示截图位置（仓库相对路径） |
| --- | --- | --- | --- |
| OAI：理解上下文、用户可控的干预 | 已提交成员消息窗口→规则筛选→语义复核；引用证据、温和提醒；误判/继续可推翻；不声称完整OAI协议 | `meetingManagement.ts`、`useMeetingManagement.ts`、`projectStore.dispatchMeetingHostEvent/respondMeetingHostEvent`、MeetingRoom的HostChoices | `output/playwright/scrum-final-deviation.png`、`scrum-final-incorrect.png`、`scrum-final-continue.png` |
| 敏捷会议助手：面向具体会议目标定制 | 四类配置、共享topics、议程及时钟；真实Sprint任务引导；无新多Agent自治框架 | `meetingFacilitation.ts`、`MeetingSetup.tsx`、`MeetingHostControls.tsx`、`meetingContext.ts` | `output/playwright/scrum-final-live-1440.png`、`scrum-final-warning.png`、`scrum-final-overtime.png`；Planning现场可另截 |
| 敏捷协作思路与项目自己的可信执行设计 | 原风险Agent事实分析→Proposal→人工采纳与最终校验→统一执行器→审计；此审批契约是工程安全边界，不声称源于论文算法 | `meetingManagement.ts`、`meetingConversation.ts`、`projectMeeting.ts`、`projectStore.applyProposal`、`meetingExecutionSummary.ts` | `output/playwright/scrum-final-pending.png`、`scrum-final-accepted-not-executed.png`、`scrum-final-executed.png` |
| SPACE：多个维度辅助理解，不等于完整框架 | 流程/成员记录/AI事件/审批/真实写回五维；拒绝贡献排名、单一质量分与效率提升结论 | `meetingOutcomes.ts`、`MeetingInsights.tsx`、`meetingReport.ts` | `output/playwright/scrum-final-insights-1440.png`、`scrum-final-delivery.png`、`scrum-final-report-preview.png` |

规则统计负责可复算数字与对象身份；模型只负责语义判断/解释；人工审批和统一执行器负责业务变更。提醒更多不等于主持更好，消息更多不等于贡献更高，采纳不等于执行，写入一条风险措施也不证明交付效率已提升。课程报告可按“研究问题→借鉴思路→工程设计→原始依据与界面”说明，不把他人的实验结论当成本系统结果，也不声称提出新理论。

## F. 最终交付结论

**可进入最终人工验收。** 本轮自动化、类型检查、构建及可执行浏览器核心闭环均通过；确认的成果可信度缺陷已修复并回归。可开始录制文字版答辩素材。正式带音频录制前，按D节依次完成设备与本人观感确认。

没有已知未解决的P0/P1。保留的边界是：真实收音/中文音色/外放待人工；本机全量测试需受控并发；少量真实模型样例不代表准确率或可用率；事件双向风险关联非全部完成；历史缺失事实不补造；Word包含对应数据表而非网页图截图，原生分页/PDF成品待人工抽看。这些不阻断本轮明确范围的文字演示。

后续只建议按人工清单验收，不再增加功能。最终样例报告为 `output/scrum-final/Scrum-meeting-report.docx`（同目录HTML/MD及ZIP），完整录制台词见C节及原 `docs/SCRUM_MEETING_VIDEO_PHASE3.md`；本轮证据与前阶段 `output/scrum-phase3/` 分开保存，不将旧480结果冒充本次484结果。
