# 合并说明（给会议侧 review）

本分支 = `origin/main (deaa3ef)` + 事件侧全部工作，`main` 未动。

## 事件侧新增了什么

- 六类事件检测（期限 / 依赖 / 负载 / 范围 / 成果 / 验收），入口在任务详情、Story 详情、Sprint 页的「AI 事件分析」块。
- 建议审批流：生成 Proposal → 顶栏铃铛待确认 → 执行写回。`origin: "event"`，与会议侧建议共用同一个待确认中心。
- 甘特图 / 看板 / 故事地图的 `AI n` 徽标。
- 模型解释复用会议侧 `/api/meeting-llm` 通道（只做措辞，失败降级为规则文案）。
- 详细功能清单见 `docs/EVENT_AGENT_FINAL_REPORT.md`。

## 动了你的哪些文件（请重点看）

| 文件 | 改动 |
|---|---|
| `src/types.ts` | `ProposalActionType` 加 6 种（`CREATE_DISCUSSION`、`BLOCK_TASK`、`REMOVE_DEPENDENCY`、`UPDATE_DEADLINE`、`CHANGE_ASSIGNEE`、`CHANGE_PRIORITY`）；其余冻结字段原样保留，加了 4 个历史别名（`ProposalOrigin` 等，只为兼容事件侧旧 import） |
| `src/store/projectStore.ts` | 执行器以你的实现为唯一实现；移植了 6 种语义动作的校验白名单与执行 case；`UPDATE_TASK/SUBTASK/STORY` 白名单放宽（日期/状态/进度类字段）；风险 `status` 校验只限风险类动作；新增 `createProposal` / `updateProposal` / `deleteProposal` / `setProposalActionDecision`（别名） |
| `MeetingRoom.tsx` / `PlanningMeetingDialog.tsx` | 动作标签表补 6 个中文名，无逻辑改动 |
| `SprintPage.tsx` / `Gantt.tsx` / `Inspector.tsx` / `demoProject.ts` |  import 二选一冲突二者都保留；`CURRENT_SCHEMA_VERSION` 取 16；demo 去掉重复的 `proposals` 键 |
| `src/tests/proposal.test.ts` | 按新校验语义更新（必填字段、前置条件、重复保存拒绝、stale 文案） |

## 验证结果

- `typecheck` 通过，`build` 通过。
- 全量测试 303 个：281 通过，22 失败——与你干净版跑出来的 22 个失败**完全一致**（同一批文件、同一数量，预先存在，非合并引入）。
- 浏览器 6 步人工验证通过（Sprint 扫描 → 建议解读 → 执行写回 → 顶栏列表 → stale 冲突 → 徽标联动）。

## 需要你确认的事

1. `validateProposalValue` 的放宽（上表第 2 行）是否可接受；
2. 在你机器上切到本分支跑一遍，会议室流程走一遍；
3. 没问题就在 PR 里留言，然后一起合进 `main`。
