# 最终答辩前精修验收报告

验收时间：2026-10-07。项目保持运行：http://localhost:8443/。

本轮沿用现有 Meeting Room、专业 Agent、数字成员、Proposal、Project Store、ChangeHistory 和材料资产。重点是消息阅读层、员工声音、材料归档和入口关系；没有重做架构。浏览器实测先后跑了 10 轮初测、8 轮新会议复测，再补了范围与顺序查询。没有把第一轮失败当作成功，修复前后的输出均保留在 output/playwright/final-polish/。

## 1. 展开详情为什么重复，怎样修复

原来的呈现函数在替换术语、缩短粗体后，只要展示内容比原文短，就可能把整段原文放进 details。因此默认正文和详情实际是同一份回答。

现在将同一回答分为互不重复的正文块和补充块。默认保留结论、关键发现和下一步；表格、完整链路、后续论据移到详情。没有遗漏正文时只显示“查看依据”，没有依据时不显示空入口。正文和证据统一在一个 disclosure 中，不再并排放两个完整回答。

主持人的长编号列表另做了取舍：保留每个拍板项的标题，折叠该项解释，避免把“需要决定什么”也藏起来。实测风险回复默认正文 235 字，完整依赖链和第二、第三处理优先级位于详情，正文没有被复制进去。

## 2. Agent 消息 renderer 的统一

沿用一个 Markdown renderer，输出后再以 DOMPurify 清理。减少长整句粗体和高层级标题；切分过长自然段；把生成的内部 TASK/SUBTASK 长 ID 从阅读层移除，原消息和证据仍保留。对不同角色设置首屏信息预算，材料结果由资产卡承载。

项目主持：压缩需拍板事项。风险助手：结论、影响、处理优先级。拆解助手：任务顺序与分工。容量助手：当前容量或真实方案差异。员工：短自然段，讲自己遇到的事情。不会再把一份长报告默认全部铺进气泡。

## 3. 首行缩进

普通聊天自然段由统一 CSS 的 text-indent: 2em 控制，没有插入全角空格伪造缩进。列表、引用、表格和独立依赖链不缩进。桌面实测正文 13px，首行缩进 26px。纪要摘要也沿用舒适行高和阅读宽度。

## 4. 字体差异的来源与处理

差异主要来自 Markdown inline code 的默认 monospace 和大段 strong。现在 inline code 继承正文 font-family；真实代码块仍保留代码字体。Story、Task、Sprint、状态和 ID 在普通文字中不会突然切换字体。实测聊天字体为 Inter, system-ui, sans-serif，数字成员和专业 Agent 使用同一字体体系。

## 5. Digital Member Prompt 的真实修改

server/meetingModelService.ts 中增加角色声音规则，并为员工提供独立的 explain system prompt，避免继续套用专业分析报告提示词。

员工默认两个短自然段，通常 100–180 字，尽量不超过 240 字；只谈自己的工作与合理知道的上游，允许确认范围、拒绝不合理工期和表达不确定。不主动列标题、做全局容量分析或讲 Store / Proposal / ChangeHistory。禁止凭空声称正在推进、已搭骨架或新进度。

这不是第二次模型润色。事实、声音规则和回答在同一次调用中处理。输入保留自己的任务、子步骤、相关成员姓名、确实有关的依赖和容量。近期历史优先取该成员最近两组问答，加最近两条会议消息，避免跨成员混入工作，也避免每次重发完整会议。

## 6. 李娜与陈林的区别

李娜：直接、偏执行，回答“现在卡什么、下一步能做什么”，不保证做不到的时间。

真实回复摘录：

> 数据模型今天确认的话，我明天只能先接字段、试渲染甘特依赖连接线，不敢承诺这条 8h 的线一天做完；接口字段如果还有缺项，当天可能只出可跑通的第一版。

陈林：谨慎、先核对接口范围和验收口径，略详细，提醒具体遗漏。

真实跨轮回复摘录：

> 如果只做接口不做校验，我这边就是「实现验收结果记录接口」这一子项，约 2h，另一个 1.5h 的校验子项先不算在我头上。范围收窄后这块我能接下来。

本轮修正了初测中“把别的任务的 DATA-024 阻塞套到 US030 上”的问题：提供按当前工作划定的 dependencyRelations / focusedBlockers，并要求没有登记依赖时只能询问字段边界，不能编造成已有阻塞。

## 7. 材料即时反馈、归档和去重

聊天恢复即时成果卡：预览、下载、加入成果包；同一批资产同步进入“会议材料”。复用 MeetingMaterials 组件，聊天是紧凑卡片，归档是完整图文卡片，没有再实现第二套材料系统。

材料身份由 meetingId + artifactType + scope 形成，文件再按扩展名区分。普通再次生成更新同一资产和版本，只有明确“另存一份”使用独立 copyId。旧文件和聊天历史保留，归档投影只显示最新有效版本。旧 UML 材料元数据也做类型归一。

实际验证：

- 再生成风险材料后，三个格式的资产 ID 未变化，版本变为 v2.0，资产数量未增加。
- “另存一份”才增加独立副本，归档显示两组材料并标识副本。
- 在聊天卡片加入成果包后，归档选择状态同步。
- 预览打开成功，选中材料 ZIP 实际下载，CRC 校验通过；包含 DOCX / Markdown / HTML 三个文件。
- 原答辩会议归档显示 15 个不同材料家族，7 张图形缩略图全部加载，不是空图。

## 8. 历史会议与最近会议

项目概览保留“发起项目会议 / 历史会议 / 查看最近会议”，移除“示范讨论”和 Showcase 入口文案。

历史会议复用现有会议记录列表，显示标题、日期、Sprint、状态、成员和摘要。选择会议或打开最近会议，默认进入会议对话。内部三个入口为：会议对话 / 会议纪要 / 会议材料。结束会议的记录也先进入聊天，不再直接跳到纪要。

浏览器实测历史会议默认：chat=1，minutes=0。纪要只使用保留的 MeetingMinutesView，老师汇报只保留完整材料展示入口。

## 9. Hover Trace 的交互修复

沿用 MeetingSourceTrace，改为共享 anchor/popover hover 状态。进入约 150ms 打开；离开后约 300ms 延迟关闭；浮层重新进入取消关闭定时器。增加 hover bridge，浮层 pointer-events: auto，可选字、滚动。根据实际尺寸自动换边并限制在 viewport 内，关闭带轻微淡出。

来源继续引用真实 message IDs，最多 5 条；没有来源不造聊天。摘要最多挑 3 处短的关键内容加溯源，避免整段都是虚线。

浏览器鼠标跨过 25 个移动步骤进入浮层，停留 700ms 仍显示；选中了 52 个字符，内部滚动正常；移开后关闭。显示 5 个真实来源消息 ID。390px 手机宽度下页面宽度仍为 390px。

## 10. 实际对话验证与事实保护

下表列出这轮真实输入；员工与风险、主持的内容由真实 Flash 返回，容量和既有顺序查询在发现旧方案污染后改为 0 调用事实路径，未硬编码演示答案。

| 顺序 | 输入 | 最终核对结果 | 路径 |
|---|---|---|---|
| 1 | @李娜 你这条甘特依赖连接线为什么还没推进？ | 自己解释字段结构未定与工作未启动，不作全项目报告 | Flash |
| 2 | @李娜 如果 DATA-024 今天解决，你明天能做到什么程度？ | 条件式判断，不承诺 8h 工作一天做完 | Flash |
| 3 | @李娜 那我再把 US030 的一个任务给你呢？ | 先确认哪项工作，保留自己的已有工作范围 | Flash |
| 4 | @陈林 US030 那两个验收任务你能一起接吗？ | 识别接口 2h + 校验 1.5h，问验收口径 | Flash |
| 5 | 如果只让你做接口，不做校验呢？ | 无需重新 @，仍由陈林回答，继承接口 2h 范围 | Flash |
| 6 | @风险与依赖 DATA-024 今天还解决不了，会影响哪里？ | 235 字默认结论与优先级，真实依赖放详情 | Flash |
| 7 | @项目主持 现在会上真正需要我拍板的是哪几件事？ | 默认可见三项需拍板问题，解释折叠 | Flash |
| 8 | @负载与容量 US030 的验收结果记录接口现在谁比较适合接，先不安排李娜？ | 陈林已负责 2h，本轮负载 3.5h、余量约 21h，不重复计入 | 0 |
| 9 | @任务拆解 US030 现有验收任务应该按什么顺序推进？只解释分工与前置关系。 | 起点 → 两项并行 → 测试收口；李娜仍为父任务负责人，子步骤由李娜/陈林承担 | 0 |
| 10 | @陈林 接口范围定下来后，你还需要我先确认什么？ | 隔着风险、主持和容量对话后仍继承只做接口的 2h 范围，询问具体字段口径 | Flash |

容量和顺序两项初测曾错误引用未采纳方案 A，把王晨说成当前负责人。没有靠反复加提示词重试掩盖：现在这些“当前事实”直接读取既有负责人、子步骤、容量和依赖；复杂新方案仍用模型。最终 llmReplyUsed=false、llmFallback=false，未误报模型采用，也未写回项目。

## 模型与成本

- 0 调用：当前项目事实、上述容量/既有顺序、确定性转接、标准材料、Gantt 页面导出、ZIP、缓存复用和版本归档。
- Flash：普通成员对话、简短主持/风险解释、普通格式修改。风格规则加入原请求，没有额外 Humanize pass。
- Pro：保留给复杂新拆解、What-if/容量权衡、创作 UML、深度全场摘要等原有高价值路径。本轮没有调用 Pro，也没有重新生成原有答辩材料。

本轮两个真实浏览器会议共 27 次供应商调用（含发现问题时的复测），输入 145,115 tokens，输出 6,256 tokens，缓存命中 20,224 tokens；全部 deepseek-flash。保守估算 ¥0.3247，实际账单以供应商为准。

费用数据来自 local-data/meeting-usage.jsonl，筛选本轮 meetingId 后汇总到 output/playwright/final-polish/usage-summary.json。会议顶部预算提示及 GET /api/meeting-llm?meetingId=... 继续可观测。没有 meetingId 的测试账本事件不计入真实会议费用。

## 最后检查

- unit tests：261 / 23 文件通过。
- typecheck：通过。
- build：通过；保留已有大 bundle / 无效动态导入提示，本轮未扩大架构改造。
- 20 个本轮代码/测试文件 UTF-8 扫描无替换字符或常见乱码。
- 桌面/390px 手机实查，会议纪要默认简洁、可展开；员工短段落、专业助手分工明显；材料有缩略图、预览和真实下载。
- 保留原正式审核结果：父任务仍由李娜负责；两个已执行子步骤由陈林负责，分别 2h / 1.5h。
- 两个步骤的创建、工时、负责人各有 agent 来源 ChangeHistory，均关联原 proposalId；共核对 6 条真实记录。本轮只读试问未新增项目行动。

尚有的限制：旧聊天历史保留当时的模型回答，包括本轮修复前的不准确回答；不会篡改历史伪装成功。模型不是每句话都能完美，数字员工仍可能稍偏书面；精确当前分工/工时用确定性路径保护。既有项目中 Sprint 2 状态与日期不一致作为真实议题保留，没有为了界面展示偷偷改状态。

## 本轮修改文件

呈现/角色/事实：

- src/agents/meetingPresentation.ts
- src/agents/digitalMember.ts
- src/agents/meetingLlm.ts
- src/agents/meetingModelContext.ts
- src/agents/meetingDecision.ts
- src/agents/meetingAnalysis.ts
- src/agents/projectMeeting.ts
- src/agents/meetingContext.ts
- src/agents/meetingWorkingState.ts
- server/meetingModelService.ts

材料身份：

- src/agents/materialShowcase.ts
- src/agents/materialIdentity.ts（新增）

UI：

- src/components/planning/MeetingRoom.tsx
- src/components/planning/MeetingMinutesView.tsx
- src/components/planning/MeetingSourceTrace.tsx
- src/components/planning/MeetingMaterials.tsx
- src/components/planning/MeetingRoom.css
- src/pages/ManagementPages.tsx

回归：

- src/tests/meetingPresentationPolish.test.ts（新增）
- src/tests/meetingRoomInteraction.test.tsx

## 建议现场展示顺序

先按上表 1–7 展示员工现场情况与专业分析的区别；接 8–9 展示真实数据和明确顺序；展示原会议的人审行动与变更记录；打开会议材料，预览用例图与现有彩色 Gantt，下载成果包；最后在纪要 Hover 决策，移入浮层滚动、选字，完成“讨论 → 决策 → 审核 → 项目变更 → 成果 → 溯源”的闭环。

原完整会议脚本继续复用 FINAL_DEFENSE_DEMO.md。现场不必在 10 分钟内输入全部长脚本，优先展示上述链路和已有历史会议。

## 浏览器证据

目录：output/playwright/final-polish/。

- final-voices.txt：8 轮新会议真实模型回复和 qaTrace。
- last-confirm.txt：接口容量最终 0 调用结果。
- task-order-confirm.txt：既有任务顺序最终 0 调用结果。
- last-two.txt：最后一轮陈林跨角色追问；其中顺序回答的旧方案污染由上述 task-order-confirm 修复。
- remaining-confirm.txt：风险默认/详情分层和 6 条真实变更历史。
- final-surface-check.txt：历史默认聊天、15 个不同资产家族与缩略图加载。
- risk-final.png / host-final.png / final-voice-4.png：角色消息阅读效果。
- teacher-assets-loaded.png / minutes-final.png / source-trace-desktop.png：材料、纪要、Hover。
- 项目材料成果包.zip：实际下载的选中资产包，CRC 已验证。
- usage-summary.json：实际调用统计。
