# Release 管理

在顶部“工作区视图 → Release 管理”进入。PO 可以新建版本，设置名称、Release Goal、计划发布日期和“规划中 / 进行中”状态。

## 规划与执行

- Release 表示共同交付的一批 Story，可以包含多个 Sprint，不改变目标 → Epic → Story → Task → Subtask 的需求层级。
- Story 可以暂不分配 Release；进入 Sprint 前必须先确定 Release，Sprint 选择器只展示同一 Release 下可用的迭代。Task、Subtask 从 Story 动态继承归属，不保存重复字段。
- 在 Release 管理页的“从 Backlog 分配”，或 Backlog 卡片、Story 详情中调整版本。批量调整会先校验全部 Story，确认窗口展示原版本、原 Sprint 和移出影响；取消不写入。
- 已有版本的 Story 调整归属必须填写原因。确认后移出不兼容的 Sprint，保留任务、验收标准、成果和调整记录。已关闭 Sprint 的归属保持不变。
- 关闭 Sprint 时，未完成故事可以进入同一 Release 的后续 Sprint；需要移到下一 Release 时先退回 Backlog，再确认版本调整并填写原因。

## 进度与发布

- 进度 = 已通过 PO 验收的 Story 数 / 版本 Story 总数；完成工程任务或勾选验收标准不会直接算作通过验收。
- 页面展示核心 Story 验收情况、逾期故事及执行项、严重阻塞和未解决的高风险项。
- 核心 Story 全部通过验收且没有严重阻塞时，PO 可以确认发布。未标记任何核心 Story 时按全部 Story 检查；空版本不可发布。
- 发布时再次检查最新数据并记录实际发布时间。已发布版本的核心范围、已验收故事归属和版本信息保持不变；未完成的非核心故事仍可安排同版本后续 Sprint，或记录原因后移至下一版本。

## 视图与兼容

- Product Backlog 支持 Release 筛选，全屏模式支持按 Release 分组。
- 故事地图、甘特图顶部可选择当前 Sprint、全部 Release、指定 Release 或未分配项。按 Release 查看时包含该版本多个 Sprint 和尚未排入 Sprint 的故事。
- 执行看板继续按 Sprint 工作，只增加所属 Release 信息。
- schema 18 自动为旧数据建立“现有计划（迁移）”版本，保留旧 Sprint 和故事的执行归属；旧 Backlog Story 保持未分配。导入会拒绝不存在的 Release 和 Story/Sprint 版本不一致的数据，不覆盖当前项目。
- AI 上下文包含版本信息；本次不新增自动版本划分或延期执行器。未来建议应进入 PO 确认流程，不能直接写入版本归属。

## 验证

自动化覆盖 PO 权限、发布门槛、严重子任务阻塞、旧 JSON 迁移、非法导入原子性、跨版本 Sprint 限制、继承、批量调整、原因及确认快照。浏览器在独立数据目录中验证新建版本、新建 Sprint、取消和确认调整、版本筛选、Story 验收、发布和刷新恢复，测试数据不会写入现有项目。
