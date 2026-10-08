# 提交前检查 · 2026-10-08

## 本轮结论

会议侧核心演示工作流已经实现，可作为会议模块阶段成果提交。不能把整个双人 Agent 项目标记为全部完成：事件触发、通知投递、独立贡献洞察和全局待审核中心尚未在当前仓库形成完整工作流。

本轮只做 UI 小修、分工/代码核对和验收，没有执行 commit、merge 或 push。

## UI 调整与实查

- 所有会议回复自然段统一顶格；会议摘要也取消首行缩进，保留段间距和列表自身层次。
- 共享文件预览关闭按钮从 16px 图标扩大到 24px，点击区域为 44×44px；禁止 SVG 被 flex 挤小，补齐无障碍名称及键盘焦点。图片、PDF、Word、Excel、Markdown 等都复用这一预览组件。
- 通用 Modal 关闭按钮采用相同规格。
- 浏览器打开真实历史会议，检查 372 个消息段落，计算样式 text-indent 全部为 0px。真实 UML 图片加载成功，预览按钮实测 44×44px、图标 24×24px，点击后关闭成功。历史会议仍显示已结束，保留对话/纪要/材料入口。
- 截图：`output/precommit-review/preview-close.png`。

本轮代码文件：

1. `src/components/planning/MeetingRoom.css`
2. `src/components/assets/AssetFilePreviewDialog.tsx`
3. `src/components/planning/Modal.tsx`
4. `src/index.css`

文档：本报告、`AGENT_INTEGRATION_CONTRACT.md` 的现状说明。

## 最初分工与当前差异

2026-09-25/27 的讨论最终按触发方式划分两条工作流，目标是工作量相近，而不是把所有未实现 Agent 都留给同学。

| 范围 | 最初安排 | 当前仓库 |
|---|---|---|
| 项目主持、风险依赖、负载容量、方案落地 | 会议侧 | 已实现会话分析、协作与人工审核链路 |
| Story/Task/Subtask 拆解与连续约束 | 会议侧工程拆解场景 | 已实现草案、多轮约束、审核和正式写回 |
| 数字员工、纪要与真实对话溯源 | 后续会议侧强化 | 已实现 |
| 材料整理 | 最初事件/运营侧；后续明确要求会议侧强化 | 会议内标准材料、UML、页面导出、版本归档、ZIP 已实现，应交接复用 |
| 项目巡检 | 事件侧 | 会议内有逾期/阻塞/低进度规则查询；无完整独立事件扫描工作流 |
| 协作通知 | 事件侧 | 会议内能推荐讨论人选，明确不会自动通知；无通知投递链路 |
| 贡献洞察 | 事件侧 | 会议内按已完成任务/讨论数列事实；无独立事件洞察工作流 |
| 全局待审核建议中心 | 事件侧，复用共享协议 | 有会议内审核区；无独立全局中心 |
| Proposal、执行器、前置条件、变更历史 | 双方共享 | 已实现，类型支持 origin=event；未发现事件侧 Proposal 生产入口 |

所以“别人的 Agent 全都空着”不准确；“另一位同学的整条工作流已经完成”也不准确。现有三类会议内规则回答不会自动构成事件 Agent。通知铃铛中的依赖条数仍有固定提示，不能作为已完成通知系统展示。

核对入口：`src/agents/meetingConversation.ts`、`src/agents/meetingDecision.ts`、`src/types.ts`、`src/store/projectStore.ts`、`src/components/CanvasTopBar.tsx`。当前共享边界见 `AGENT_INTEGRATION_CONTRACT.md`。

## 完成情况与证据边界

会议主链路为：讨论 → 专业分析/数字成员 → 方案 → 逐条审核 → Store 写回 → ChangeHistory → 材料/纪要 → 来源对话。

既有真实验收材料包括：

- `FINAL_DEFENSE_DEMO.md`：59 步完整彩排脚本。
- `FINAL_DEFENSE_REPORT.md`：真实彩排、人工审核与两项正式子任务写回、四类 UML、Gantt 和 ZIP。
- `CLASSROOM_DEMO_REPORT.md`：主持人六类转接、材料类型和导出实测。
- `FINAL_PRESENTATION_POLISH_REPORT.md`：数字员工十轮场景、事实路径保护、材料同步去重、Hover Trace。
- `MEETING_LIFECYCLE_CHECK.md`：历史只读、结束确认、结束后锁定和可伸缩边栏。

这些是此前验收记录，本轮读取核对并运行当前回归，未重新付费跑 59 步模型彩排。不能把报告中的历史通过等同于本轮重新实测全部开放问法。

本轮验证：23 个测试文件、263 项测试通过；typecheck 通过；build 通过。构建仍有既有大包/无效动态导入提示。git diff --check 无空白错误。136 个候选仓库文件的文本检查无非法 UTF-8、替换字符或常见乱码，无匹配到的常见密钥/私钥模式；该扫描不是全面安全审计。

保留限制：模型开放回答仍可能不准确；旧会议保留旧答案与修正轨迹；历史 Sprint 状态和日期不一致；复杂规划与完整摘要需要等待；未实现事件侧全流程。没有必要在此次排版精修中扩建这些能力。

## 远端与提交准备

- 已成功执行 `git fetch origin --prune`。
- 远端：`git@github.com:dxc5731/ScrumFlow.git`。
- 本地分支 main；远端目前只有 origin/main。
- HEAD 与 origin/main 均为 `da5dd95`，提交为 `feat: publish ScrumFlow PO workspace`（2026-09-19）。ahead/behind 为 0/0，无新远端提交。
- 当前会议 Agent 等大量成果仍未被 Git 跟踪；不能只用 `git commit -am`，否则会遗漏 `src/agents/`、`server/`、会议组件与新增测试。
- `.env*`、`local-data/`、`output/` 均被忽略且当前未跟踪。代码推送不会带上真实历史会议、生成资产、模型密钥及截图；同学拉代码后需要配置模型环境，若需复现同一场答辩会议，要单独交接项目数据和附件。
- 当前服务仍兼容从本机 SunnyMind 配置读取模型凭据；README 已说明项目级 `.env.local` 配置。跨机器不要依赖该本机回退路径。

建议按“会议模块收尾”提交，交接时附上本报告说明事件侧待接入边界。提交前重新查看暂存文件清单；不要强制加入本机密钥或整个 local-data。此次没有代为推送。

## 21:02 补充：亲自验收发现的复合指令缺陷

用户实际输入第三步“把尚未覆盖的工作拆细，别重复创建”被误判为现有任务顺序查询，未建立方案；第四步“改三个人……再进入审核”又被审核关键词抢先路由，因此出现主持承诺转交、计划落地要求重新讨论的断链。此前测试通过没有覆盖这组原句，不能据此认定所有组合指令正确。

已修复：去重约束与禁止创建分开识别；补充拆细进入已有模型草案入口；先修改再审核先经任务拆解，继承约束、核对容量，再产生待审核行动。只有实际存在待审核行动才显示拆解到计划落地的第二次转接。未来五工作日剩余容量现在扣除其他已承诺工作，不只比较五天的名义容量。

真实浏览器在 `meeting-1791464049109-ezu5g` 重放第四步原句，生成 `proposal-a7fb212c-e63d-4dc9-8fb5-9376ad234ffa`：3 个已有任务负责人调整，均 pending；项目实际负责人仍未改变，该 Proposal 的 ChangeHistory 为 0。调用轨迹为 task_decomposition / workload_capacity / plan_execution，llmReplyUsed=false、llmFallback=false；未调用模型。缺失的上一轮草案没有伪装成已存在，回复明确以当前项目任务为基础复核。

新增 4 条针对性回归，包含补充拆细、原句复合路由、草案继承与五日净容量校验。最新完整检查：24 个文件、267 项测试通过，typecheck/build 通过。第三步的模型入口本轮使用受控模型结果回归，没有额外在线生成材料或自动应用建议。截图：`output/precommit-review/revision-review.png`。等待用户继续亲自验收，仍未 commit/push。
