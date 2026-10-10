# 两侧 Agent 代码同步与启动指南

更新日期：2026-10-10。

## 本次包含的成果

`main` 整合了会议侧、数字员工、材料整理，以及同学 `merge/event-plus-meeting` 分支截至 `2e2836f` 的事件侧成果。本次通过一次压缩提交发布，原分支保留，不需要再把同一旧分支合入一次。

上轮联调修复保留了共享提案、事件去重、批量采纳及动作目标校验；本轮补齐会议意图边界。双方现有功能均保留。配置模板和依赖锁文件随代码交付，真实密钥与 `local-data/` 不随 Git 同步。

## 从已有仓库更新

在仓库根目录执行：

```bash
git status --short
git fetch origin
git switch main
git pull --ff-only origin main
npm ci
```

先确认工作区干净。有未提交修改时，先在自己的工作分支提交，再切回 `main`；不要用覆盖文件或 `reset --hard` 的方式更新。若 `main` 有自己的未推送提交，`--ff-only` 会停止，保留现场，此时先核对提交差异。

这次是压缩整合，因此旧 `merge/event-plus-meeting` 的提交编号不会成为新 `main` 的完整祖先链，但该分支的代码已包含在 `main`。若该分支停在上述交付点，切回 `main` 拉取即可。若交付点之后还有新工作，只迁移之后的新提交，不重复合并已经交付的旧分支。

## 环境与密钥

完整运行及测试建议使用 **Node.js 24.15+（24.x）或 22.22.2+（22.x）**。当前 Vite、Vitest、jsdom 的依赖要求不同，旧 Node.js 20 不能运行全部测试。

首次配置时，将 `config/meeting.env.example` 复制到仓库根目录，命名为 `.env.local`。已有该文件时直接核对配置，不要覆盖自己的密钥。填写自己的 `DEEPSEEK_API_KEY`；会议侧和事件解释共用同一个服务端通道。

```dotenv
DEEPSEEK_API_KEY=填写自己的密钥
MEETING_LLM_BASE_URL=https://api.deepseek.com/v1
MEETING_LLM_FAST_MODEL=deepseek-flash
MEETING_LLM_ADVANCED_MODEL=deepseek-v4-pro
MEETING_LLM_EXPLAIN_MODEL=deepseek-v4-pro
MATERIALS_LLM_MODEL=deepseek-v4-pro
```

如果已经配置 `MEETING_LLM_API_KEY` 或 `LLM_API_KEY`，它们会优先于 `DEEPSEEK_API_KEY`；避免残留旧密钥造成误判。使用其他兼容服务时，将地址和模型名改成服务实际支持的值。

不需要数据库或单独的 Python 服务。项目模型代理、本地数据和附件接口均由 Vite 插件提供。

## 启动与自检

```bash
npm run dev
```

打开 `http://localhost:8443/`。访问 `http://localhost:8443/api/meeting-llm`，检查 `configured` 为 `true`、模型名正确；该接口不返回密钥。它只能确认配置已读到，实际模型是否可用还要通过一次聊天请求检查。

建议完成以下快速检查：

1. 在 Sprint 或 Story 页面发起会议，输入 `@陈林 你在当前 Sprint 还能再接 8h 工作吗？只回答自己的情况，不修改。`，应回答个人容量，不应生成修改提案。
2. 在任务上请求新增一个 2h 测试子任务并注明“仅生成待审核建议，不应用”，确认出现建议且任务尚未被写入。
3. 请求导出任务清单 Excel，再说“不要重新生成，只查看当前任务状态”，确认没有多生成文件。
4. 在「AI 事件分析」中扫描并生成建议；重复扫描应恢复同一建议，顶栏“全部采纳”重复点击不应撤销采纳。

演示 Sprint 的日期是固定的，容量按运行当天计算。日期已过时回答“不能接工作”是正常行为；需要验证可执行规划时，通过项目界面建立有效排期，不要改生产时钟。

```bash
npm test
npm run typecheck
npm run build
```

此次交付验证为 385 项全部通过，包含原有 303 项及后续回归。已有构建体积和混合导入提示不影响构建完成。完整意图验证见 [意图修复记录](MEETING_INTENT_SAFETY_FIX.md)，共享联调修复见 [合并修复记录](AGENT_MERGE_FIX_REPORT.md)。

## 后续协作与数据边界

双方每次开始新工作，先更新 `main`，再从它创建各自的新分支，例如 `git switch -c feat/meeting-followup` 或 `git switch -c feat/event-followup`。合入后双方再次快进更新 `main`，下一批工作使用新分支。共享 Store、Proposal 协议及审批入口的修改在提交说明中列出，并同时运行会议与事件测试。

`main` 一致表示代码一致。各机器的 `.env.local`、`local-data/project-state.json`、`local-data/assets/`、模型调用日志和测试输出仍是各自的本地文件；拉取不会把你的真实会议和附件复制给同学。需要共享同一组演示数据时，单独交接项目快照和被引用附件，并先保存接收方自己的数据。
