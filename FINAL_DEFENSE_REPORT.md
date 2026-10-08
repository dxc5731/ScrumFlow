# 最终答辩精修与真实彩排报告

2026-10-07 · ScrumFlow · 本地项目 http://localhost:8443/

本轮已经在真实 Edge 浏览器里走完59步会议故事线，并完成审核、正式写回、四类UML、彩色Gantt、老师汇报、ZIP下载与纪要溯源。推荐脚本有59步，实际记录含修正与重试，共63次输入、61条不同输入；没有将模型答案硬编码成示范对话。41轮 qaTrace 标记真正采用了在线模型回复，其余含确定性回答、材料操作与回退，不能把每一轮都称为模型推理。

当前可从“查看最近会议”进入本次已结束会议（meeting-1791358865549-0e6cz）。最终保留2条US030新步骤，陈林负责，分别2h和1.5h；父任务仍由李娜负责。DATA-024与彩排前完全一致，旧会议及旧Proposal均保留。

## 1. 改动文件

| 范围 | 本轮新增/修改的文件 | 用途 |
| --- | --- | --- |
| 会议UI | src/components/planning/MeetingRoom.tsx、MeetingRoom.css | 去掉消息内重复成果区；统一纪要、可见转交、彩排入口 |
| 材料UI | src/components/planning/MaterialSuggestions.tsx、MeetingMaterials.tsx | 唯一材料中心、动态推荐、老师汇报、卡片与版本去重 |
| 纪要UI | src/components/planning/MeetingMinutesView.tsx | 默认重点、完整展开、自然摘要、成果折叠 |
| 新组件 | src/components/planning/MeetingSourceTrace.tsx、MeetingBudgetBadge.tsx | Hover原始对话、预算用量 |
| 纪要数据 | src/agents/meetingNarrative.ts、meetingSource.ts、meetingMinutes.ts、meetingPresentation.ts、meetingExecutionSummary.ts | 摘要缓存、真实引用、已执行/驳回/撤回分开 |
| 会话与表达 | src/agents/meetingDecision.ts、meetingLlm.ts、meetingTelemetry.ts、meetingHandoff.ts | 实际采用受校验模型表达、确定性调度、可观测性 |
| 多轮约束与审核 | src/agents/meetingContext.ts、meetingWorkingState.ts、meetingWorkDraft.ts、meetingFinalRevalidation.ts | 类型排除、五工作日限制、聚焦父项、部分应用 |
| 材料生成 | src/agents/materialShowcase.ts、materialSchema.ts、materialFiles.ts | 复用、只改标题、ZIP最新版本、Mermaid规范化与用例图文字居中 |
| 模型服务 | server/meetingModelRouting.ts、meetingModelService.ts、meetingUsage.ts | Flash/Pro路由、全会摘要、实际provider usage账本 |
| 持久化 | src/types.ts、src/store/projectStore.ts | 保存彩排模式与带来源的摘要 |
| 有限回归 | src/tests/meetingDefense.test.ts、meetingProposal.test.ts、meetingFinalRevalidation.test.ts | 约束、审核、溯源、摘要缓存、撤回口径 |
| 交付 | FINAL_DEFENSE_DEMO.md、FINAL_DEFENSE_REPORT.md、output/final-defense/ | 59步脚本、10分钟重点、前后快照、下载实物、截图与用量 |

这里列本轮相关文件；工作区原有未提交改动没有清理或覆盖。没有另建会议/Proposal/Store平行系统。

## 2. 删除哪些重复UI、纪要前后差异

- 删除聊天消息中重复的大块成果展示，改成轻量“已汇入材料中心”回执。
- 删除推荐区临时老师汇报画廊；老师汇报统一进入现有完整资产卡片。
- 移除旧紫色大摘要/纪要呈现，所有纪要进入同一 MeetingMinutesView。
- 纪要内只有一处资产画廊；推荐区在纪要中只保留推荐与生成按钮。
- 同名文件展示最新版本，ZIP也只收最新版本。重新整理老师概览会保留已修改的标题，避免改名后出现第二份同类入口。

以前：重复总结与资产、连续技术板块、所有内容默认铺满。现在：标题/迭代/日期→2项执行、0项待确认、1项需关注→自然摘要→两条核心决定→关键行动卡。全部讨论、未采用建议、完整变更等通过“展开完整纪要”显示；成果另行折叠。展开/收起、悬浮窗淡入/淡出，并尊重减少动态效果设置。390px实际检查无横向页面溢出。

浏览器终验：1处材料画廊、15张不同成果卡，没有重复标题。重复点“全部生成”新增资产0、新增模型调用0。

## 3. 摘要与source trace

摘要由 deepseek-v4-pro 读取全场真实非系统消息一次，以结构化纪要、实际已应用步骤、父任务/新步骤负责人及执行历史校正讨论中的旧方案。自然表达只在摘要层生成；行动项、状态、人数、工时与变更继续来自确定性数据。

本次最终摘要234字、5处有效引用。全文如下：

> 会议聚焦 Sprint 2/3 状态滞后、US024 数据模型阻塞和 US030 验收链卡点。US030 验收链的根任务未启动导致下游三项全部阻塞，且与 US024 数据模型阻塞非同一条依赖链。比较了方案 A 与方案 B：方案 A 保持少调整风险更低，但最终未采纳负责人变更，仅新增两条子任务（验收结果记录接口与校验），由陈林负责；其他调整被拒绝，US024 维持原样待数据模型契约冻结。下一步优先推动数据模型定稿和验收记录任务启动。会议还生成了多项图表材料用于汇报。

MeetingSession.narrative 保存正文、references、sourceMessageIds、模型、生成时间和指纹。引用先校验消息ID属于同一会议；材料操作不使摘要失效，已存在摘要直接复用。会议行动/决定/负责人优先用proposal和qaTrace源ID，再匹配真实项目对象/会议事实。Hover展示最多5条相关真实消息，含成员/数字员工/Agent身份，内部可滚动，移开自动消失；无来源则不显示假聊天。

注意：这些窗口标为“当时的相关讨论”，是来源窗口和邻近问答，不宣称每一条都是唯一因果证据。当前人工审核决定以Proposal与ChangeHistory为准。

## 4. 表达风格与实际模型策略

答辩模式先给结论，再解释2–4个重点；模型以同事口吻说“我这边”“我建议”。数字员工只讲自身任务、阻塞与职责；底层校验事实放入可展开依据，避免同一事实同时在主回复重复念字段。不能把模型的计划建议或数字员工回答当成真实完成/真人承诺。

| 工作 | 实际策略 |
| --- | --- |
| 主持识别/转接、读取事实、选择方案、审核和Apply | 0调用 |
| 标准纪要排版、行动项、WBS/Excel、风险台账、依赖图、故事地图、Gantt、ZIP、材料复用/改标题 | 0调用 |
| 普通同事回复、数字员工、轻量解释 | Flash；答辩模式通常1800输出token上限 |
| 两天What-if、关键路径/救火、A/B机会成本、多条件重排、验收边界与综合收束 | Pro；通常6500上限 |
| 新工作draft、新用例内容设计、开放式复杂创作 | Pro |
| 完整会议摘要 | Pro low，9000上限，指纹缓存；全历史只在这一步读取 |
| 既有验收活动/时序/数据模型类图 | 现有确定性模板，0调用；并非三次新模型设计 |
| 简单标题修改、已有语法规范化 | 本轮0调用；一条额外图形修复尝试用Flash |

普通回复只携带压缩事实与最近6条相关消息；不每次重发完整会议。约¥4后普通Flash输出收短至1000，为核心Pro高光保留空间。模型provider缓存命中由实际usage记录，不能保证每次命中。

## 5. 主持转接专项结果

| 主持请求 | 可见转交 | 实际结果 |
| --- | --- | --- |
| 根据US030画用例图 | 材料整理 | PNG、SVG、源码资产 |
| 整理整场正式纪要 | 材料整理 | 摘要及DOCX/MD/HTML |
| US030两人执行方案→三人修改 | 任务拆解 | 约束方案与可审核新步骤 |
| DATA-024最大依赖风险 | 风险与依赖 | 登记关系、传播、What-if |
| 谁适合接US030验收工作 | 负载与容量 | 窗口、成员限制、A/B取舍 |
| 按刚才方案进入审核 | 计划落地 | Proposal审核与实际应用 |

持久化消息中存在真实handoffTo，界面显示主持邀请/已转交，后续由专业角色发言。不是只替换后台speaker。

## 6. 材料、UML、Gantt与老师汇报

当前材料入口支持：正式纪要、行动项、变更摘要、风险与阻塞文档、WBS、Sprint Excel、登记依赖图、用户故事地图、原有彩色Gantt、用例/活动/时序/类图、新图形和开放式报告、老师汇报组合、改标题、预览、选材ZIP和全部ZIP。文档DOCX/MD/HTML，表格XLSX，图形PNG/SVG/MMD，Gantt PNG/PDF；其它文档可从打印另存PDF。

| 实测图形 | 成果与限界 | 调用 |
| --- | --- | --- |
| US030用例图 | 真正usecase-beta演员/系统边界/include/extend；PNG/SVG/源码，明确需求态 | 1次Pro内容设计；已有设计的语法规范化和文字居中0调用 |
| Story验收活动图 | 工程完成→待验收→权限→通过/退回分支 | 0 |
| PO验收时序图 | PO/验收页/Store/本地持久化，成功与失败分支；按现有架构 | 0 |
| Story/Task/Sprint/Member类图 | 现有对象、依赖和步骤关系；静态结构图 | 0 |
| 登记依赖图 | 当前讨论范围的正式登记关系，不冒充新增依赖 | 0 |

四类均通过真实浏览器图片预览和下载，下载PNG文件头与尺寸有效。长纵向活动/类图需放大或下载查看，现场优先用例/时序图。

Gantt PNG来自 Gantt View Export，1630×1264；保留原系统彩色Story条、Task/Subtask层级、成员头像、逾期红色、依赖虚线和今天时间轴。可见李娜父任务及陈林两条新步骤，完全没有另画Mermaid甘特图。PDF在成果包中，Sprint 3范围由真实页面导出；里程碑有数据时由原Gantt组件呈现，本次范围未特意造里程碑。

老师汇报自动选择已有推荐中的高价值材料，加项目概览和Excel附件；本轮组合含摘要、成员分工、AI参与与正式变化。汇报概览标题“最终答辩 · AI协作与项目决策”已保留；“全部预览”支持切换，统一15张资产卡。按会议信息选择8项推荐并不意味着再次用模型生成8次。

实际下载的两个成果ZIP均35个文件，CRC检查通过，没有重复名称或旧版本ID前缀。文件在 output/final-defense/downloads/；资产旧版本仍保留作历史，UI和交付ZIP呈现最新版本。

## 7. 完整脚本、现场高光与用量

59步逐条输入、@对象、核心结果和审核交互见 FINAL_DEFENSE_DEMO.md。故事线：开场3步→阻塞风险12步→人员容量9步→连续拆解11步→审核6步→收尾2步→成果16步。该文末已列10个高光及10分钟现场时间表；完整59步用于课前彩排，现场重点演示关键片段与这场已保存的真实成果。

| 模型 | 记录到的provider调用 | 输入token | 输出token（含推理） | 缓存命中输入 | 保守估算 |
| --- | ---: | ---: | ---: | ---: | ---: |
| deepseek-flash | 31 | 169,752 | 16,516 | 18,304 | ¥0.4706 |
| deepseek-v4-pro | 18 | 182,430 | 57,261 | 25,600 | ¥3.1312 |
| 合计 | 49 | 352,182 | 73,777 | 43,904 | ¥3.6019 |

Pro包含11次复杂解释、2次draft、1次新材料设计和4次摘要请求；摘要包含一次截断以及核对旧方案/撤回/负责人后的修正。没有把修正成本隐藏。本次成本低于¥5，Flash/Pro次数没有机械凑配额，因为标准材料直接0调用。

价格按已核对的官网峰时美元单价与7.2汇率保守估算；实际账单以DeepSeek控制台为准。网络错误若未返回usage，无法凭日志证明其计费为零。

可观测入口：会议顶部预算标记；GET /api/meeting-llm?meetingId=meeting-1791358865549-0e6cz；local-data/meeting-usage.jsonl；output/final-defense/cost.json。账本逐次记录model/mode/input/output/cache/attempt/requestId/meetingId，provider返回usage后即记账，输出截断也计入。

## 8. 最终验收与实际限制

- unit tests：22文件、254测试通过；typecheck、build通过。最后图形排版与老师标题复用修改后再次完成typecheck/build，未扩大付费边界测试。
- UI：唯一材料中心、默认简洁、展开/收起、Hover真实消息、手机无横向溢出。
- 材料：选中生成与全部生成成功；再次全部生成0新资产/0新模型；7种预览与单文件下载成功；ZIP CRC通过。
- Meeting/Proposal：会议结束状态保存；两条正确新步骤已经正式存在，实际负责人陈林，总估算3.5h；审核拒绝其它分配，不替成员改历史排期。
- ChangeHistory：两条新步骤各有带proposalId/proposalActionId的创建/估算/负责人记录；之前会议、Proposal保持存在，DATA-024恢复到彩排前值。

彩排并非从第一轮起完全无误：发生网络回退、工时问题误判为创建请求、旧DATA-024焦点串入US030提案。已修正意图和父项范围；错误DATA-024两条步骤曾应用后用现有删除流程撤回，创建/删除历史完整保留，当前正式结果只保留US030两条。没有删除错误轨迹来美化验收。

仍需在现场按实际结果解释的事项：历史Sprint状态和日期不一致，系统会指出；模型可能建议不同负责人，人工审核要读卡片；source trace含邻近真实讨论，不保证每条窗口都是唯一证据；复杂Pro回复和完整摘要需要等待，不适合十分钟里实时重跑59轮；长纵向图与长任务标题适合展开/下载。构建仍有现存大分包与动态导入提示，本轮未做架构重构。

证据：project-before.json、project-after.json、acceptance-state.json、cost.json、download-verification.json、逐轮turn文件、minutes-desktop.png、minutes-mobile.png、source-hover.png、teacher-preview.png、preview-0至6.png及下载原件。没有把单元测试当成真实演示的替代证据。
