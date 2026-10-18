# 第三阶段：可追溯的 Scrum 会议成果

## 实际实现

在原会议纪要内增加「查看会议洞察」，沿用会议、主持事件、纪要摘要、Proposal、ChangeHistory 和材料整理 Agent。没有新建会议库、审批体系或分析服务，也未引入图表依赖。

页面从上到下展示：实际用时、参与成员、议程推进、AI 主持干预和实际执行五项概览；议程阶段图、成员消息柱状图、行动状态堆叠图；可定位发言依据的主持时间线、人工反馈、关键行动与逐项审计；会议执行复盘、待处理行动和最多三项相关材料推荐。

「导出会议报告」调用已有材料生成链路，产生 Word、Markdown 和可打印 HTML，进入原资产库、预览和材料包。文档包含三张图的完整对应数据表，便于核对和编辑；没有另建 PDF 转换服务，PDF 可使用现有材料的打印功能保存。

## 数据契约与口径

| 项目 | 事实来源与边界 |
| --- | --- |
| 真实会议时长 | facilitation.startedAt / endedAt 的时间戳差；结束保存 actualDurationMs。缺少可靠开始记录的旧会议显示暂无记录，不拿消息间隔估算。 |
| 计划与超时 | plannedMinutes 包含人工延期。普通模式保存真实超时；演示模式分别展示真实用时、×30 议程时钟和演示超时，不作真实超时判断。 |
| 议程推进 | 原 session.topics 的 discussed / recorded / decided 状态。仅表示讨论或记录过，不代表验收完成；不估算各议程时长。 |
| 成员参与 | senderType=user 且有非空已提交内容的消息；按成员 ID 汇总。排除主持、数字员工和系统消息。新消息保存 inputSource=text/voice；旧记录无来源则明确标为未记录。 |
| 语音记录 | 单句转写记录数，不称作完整发言轮次，不推算发声时长或贡献。未增加声纹识别。 |
| 主持行动 | 原 hostEvent 与 resolution 的时间、种类、引用、反馈。时间提醒只计 time_warning / overtime；同一任务多次阻塞跟进按 Task ID 去重。 |
| 行动建议 | 按 ProposalAction 条数，而非 Proposal 卡片数。仅统计 origin=meeting 且 sourceMeetingId 明确等于当前会议的建议。 |
| 采纳与执行 | decision=accepted 为采纳；执行成功还要求 action.status=applied、不是 existing 复用结果，并存在匹配 proposalId + proposalActionId 的 ChangeHistory。失败、失效和证据缺失继续标为未确认执行成功。 |
| 外部建议 | 关联其他会议、event-origin 或历史归属不明的 Proposal 仅作为关联材料，不归功于本次会议。不会追溯填造旧记录的来源。 |
| 真实对象 | 对象名称、Sprint 日期、状态和负责人均来自项目记录；未确认的建议负责人和日期显示待确认。Sprint 2 已过计划结束日，页面与报告如实说明。 |

结束时保存 outcomeSnapshot，冻结业务事实、当时关联建议和对应审计。后续仅追踪明确属于本次会议、原有 Action ID 的审批及对应审计：对快照重放审计中实际改变的字段，标记「含会后跟进」。不会把后来无关的任务改名、负责人变化或风险修改追溯为本次成果。原始快照本身不变。

报告读取为纯投影，不修改 Story、Task、Sprint、风险或审批实体。用户点击生成材料时，只通过现有资产接口写入文件和资产记录。

## 摘要与解释

结束时复用 ensureMeetingNarrative / meeting_summary，向原有模型通道补充确定性 outcomes、执行状态与审计 ID。摘要生成一次并持久化，指纹基于会议记录与关联审批审计，普通打开或刷新不自动重新请求模型。模型不可用时保存事实模板，图表、执行复盘和报告仍可使用。模型摘要明确标为解释，以事实和人工审批为准；结构化复盘中的统计与跟进建议来自规则。

主持人的 outcome 事件也通过原 dispatchMeetingHostEvent 入口保存和去重。会议结束不会继续运行实时纠偏或阻塞检测。原有麦克风转写、播报开关及清理逻辑继续保留；会后回顾以文字为主要验收方式。

## 研究依据与工程简化

以下公开题名、摘要已于 2026-10-18 核对。原论文的研究结果不等于本项目实验结果，本项目没有开展团队效能提升的对照实验。

1. [Observe, Ask, Intervene: Designing AI Agents for More Inclusive Meetings](https://arxiv.org/abs/2501.10553)，CHI 2025。研究视频会议包容性，以及 AI 如何观察、询问、干预，避免完全自主的批评和打断。本项目借鉴「先观察上下文，再给可推翻的温和建议」：已提交消息批处理、语义复核、继续讨论/误判反馈、冷却与证据引用。工程上使用轻量规则与现有模型，没有复现论文原型、参与公平性测量或其完整实验设计。
2. [Exploring Human-AI Collaboration in Agile: Customised LLM Meeting Assistants](https://doi.org/10.1007/978-3-031-61154-4_11)，XP 2024。行动研究聚焦 Daily Scrum 与 feature refinement 等会议中的 AI 助手、团队协作和部署准备。本项目据此按敏捷会议目标配置议程与主持提示，使用真实 Sprint、Story、Task 上下文。四类 Scrum 模板、时间控制、阻塞到 Proposal 的工程闭环是本项目实现，不能声称是论文现成算法或已复现其工业效果。
3. [The SPACE of Developer Productivity: There's more to it than you think](https://doi.org/10.1145/3454122.3454124)，ACM Queue，2021。指出开发者生产力不能用单一活动量或效率指标衡量，提倡多维度理解。这里借鉴指标边界：同时提供流程、参与记录、AI 行动、审批和写回证据，拒绝单一会议质量分、贡献排名和虚构的效率提升幅度。SPACE 不是会议评分算法，本系统没有实现完整 SPACE 框架。

选择「规则统计 + 模型解释 + 人工审批」是因为三者承担不同责任：规则保证数字可复算；模型帮助读懂讨论；人工确认和执行器保障真实项目写回。消息变多不等于贡献变大、提醒变多不等于主持更好、采纳不等于执行、执行一项建议也不证明项目交付已经改善。

## 代码入口

- `src/agents/meetingOutcomes.ts`：快照、会议归属、确定性统计、审计字段重放和结束汇报。
- `src/agents/meetingReport.ts`：同一事实口径的正式报告与图表数据表。
- `src/components/planning/MeetingInsights.tsx` / `.css`：洞察与溯源界面。
- `MeetingMinutesView.tsx` / `MeetingRoom.tsx`：原会议纪要内的入口和导航，语音来源标记。
- `projectStore.ts` / `types.ts`：增量持久化契约与统一主持事件。
- `meetingNarrative.ts` / `meetingMinutes.ts` / `meetingPresentation.ts`：原纪要与摘要的快照适配。
- `materialStandards.ts` / `materialShowcase.ts` / `materialRecommendations.ts` / `materialIdentity.ts`：原材料生成、复用、身份与推荐。

测试、浏览器证据和报告样例见 `output/scrum-phase3/`；录屏剧本见 `SCRUM_MEETING_VIDEO_PHASE3.md`。

## 本轮实际验收（2026-10-18）

- 全量自动化测试 480/480（41 个文件），TypeScript 类型检查和生产构建通过。新增 16 项针对成果归属、快照、采纳/执行边界、离线缓存、旧数据、报表与溯源交互的测试。构建仍有大包及静态/动态导入并存提示，不影响本轮运行。
- 真实 Chromium 在隔离副本跑通：新建站会 → 主动欢迎 → 成员发言 → 真实模型语义纠偏 → 接受反馈 → Sprint 阻塞 → 风险 Agent → Proposal → 人工采纳、最终校验与应用 → 结束 → 洞察 → 持久模型摘要 → 导出、在线预览和 ZIP。
- 主链路会议 `meeting-1792292213894-62fpw`：实际用时 90,252ms，4 条成员文本消息、1 位参与者、3/3 项议程已推进、8 条主持事件、1 次纠偏及返回反馈、3 个去重阻塞任务、1 条已采纳且有审计的执行行动。实际修改的是已有 `risk-fe025` 的应对措施，没有声称任务阻塞已解除。
- Proposal `proposal-1792292231269-4zpkr` 对应审计 `history-1792292280330-d893r`。自然语言摘要使用当时真实模型返回并保存（deepseek-v4-pro）；页面查看、导出及刷新测试中，未产生额外模型请求，原消息 ID 与摘要生成时间不变。
- 另开演示会议 `meeting-1792292831161-o31ry`，真实浏览器等待黄色/红色状态与对应主持消息，延期到 20 分钟后结束。实际用时 31,749ms，演示计时 952,470ms，真实超时为 null；两个成员各 1 条文本消息、无 Proposal，洞察正常。延期后结束时没有演示超时，不抹除此前真实发生的超时提醒事件。
- 1440、1024、390px 宽度检查通过，洞察无横向溢出，导出与待处理行动按钮均在可视宽度内；会议专属顶栏分别约 108.5、135、125px。时间线可跳回纠偏原消息/依据，Proposal 可跳回原决策区。
- 另打开 2026-10-07 的真实旧会议（仅一条历史消息、无主持计时/结束快照）验证空状态，显示暂无记录，未发起模型请求；再切回本轮会议，洞察正常恢复。
- 实际下载 Word 和成果 ZIP，Word 在线预览、XML 与文本提取均验证通过；Word 和 HTML 各含 8 张数据表，包含三个图表的对应数据及真实 Proposal / ChangeHistory ID。样例为 `output/scrum-phase3/Scrum-meeting-report.docx`，同目录提供 `.html`、`.md` 和 `report-bundle.zip`。
- 正式 `local-data/project-state.json` 与 `.env.local` 本轮前后 SHA-256 完全一致；既有工作区修改保留，未提交或推送。

限制：真实麦克风、中文音色及外放按本轮要求未做设备验收；自动测试不能替代该验收。旧会议缺少消息来源、明确 Proposal 归属或开始时间时相应指标收缩/显示暂无记录。文档导出保留图表数据表，未把网页柱状图截图嵌入 Word；没有新增质量分、发言时长推算或效率提升结论。

## 正式交付复核索引

上述480/480及 `output/scrum-phase3/` 是第三阶段当次记录。之后的正式验收以 [SCRUM_MEETING_FINAL_ACCEPTANCE.md](./SCRUM_MEETING_FINAL_ACCEPTANCE.md) 为准：本次484/484，新增4条成果可信度回归；当前证据独立保存在 `output/scrum-final/`。会议归属、缺审计/复用结果的执行口径及跟进讨论快照已作最小修复。

三篇论文经在线书目核验的作者、年份、出处、DOI，以及“研究依据 → 实际设计 → 代码实现 → 可展示截图位置”对应表，见最终报告E节。CHI论文DOI为 `10.1145/3706598.3713838`；SPACE只借鉴多维度与指标边界，不声称完整实现该框架。最终报告D节是仍需用户亲自完成的音频设备和录屏检查表。
