# 会议状态与边栏交互检查

日期：2026-10-07。会议顶部价格提示已移除；内部调用统计仍保留，没有改模型费用记录。

## 原因

历史列表包含 active 和 ended 两类记录。旧 UI 只依据原会议状态显示按钮，未区别“历史查看”和“实时参与”。因此点一条尚未确认结束的历史会议，会出现绿色进行中、输入框和结束按钮；甚至历史待审核建议仍可被操作。

现在增加本地查看模式，不篡改原会议的状态。历史和查看最近会议默认只读，未结束记录显示“历史记录 · 未结束”；只有明确点击“继续会议”才恢复实时操作。

## 各阶段应显示什么

| 阶段 | 发言/审核 | 结束操作 | 纪要/材料 |
|---|---|---|---|
| 发起新会议、正在参与 | 显示输入与当前待审核操作 | 顶部“结束会议” | 可查看；内容足够时整理 |
| 回复、摘要或材料生成中 | 相关操作等待完成 | 不允许切会、关闭或重复结束 | 显示当前生成反馈 |
| 普通纪要预览 | 可返回讨论，待处理行动可继续审核 | 不显示“确认结束” | 摘要、成果可整理 |
| 结束前确认 | 返回讨论或继续审核 | 确认结束；有未处理行动时“保留待处理并结束会议” | 不自动应用未审核行动 |
| 刚确认结束的收尾 | 讨论和项目审核锁定 | 不再显示结束按钮 | 可在纪要/材料页继续沉淀成果 |
| 查看未结束的历史 | 默认只读，明确“继续会议”才恢复 | 默认隐藏 | 查看已有纪要、预览、下载 |
| 查看已结束的历史 | 只读，无重新分析/采纳/修改/应用 | 无继续或结束按钮 | 查看、溯源、预览、下载 |

关闭会议室只退出界面；只有结束前确认才能把 status 改为 ended。没有自动结束旧 active 记录。

## 边栏

两边新增细拖动柄，沿用原界面颜色。鼠标拖动可调整宽度，支持折叠/展开，重新展开恢复调整后的宽度。双击拖动柄恢复默认；焦点放在拖动柄上可用左右方向键调整。尺寸记在本地偏好，受最小宽度与聊天可用空间约束。手机端隐藏拖动柄，沿用分区切换。

真实浏览器数据：左侧 258 → 338px，右侧 330 → 400px；双侧折叠为 38px，展开恢复 338/400px；双击恢复 258/330px。1440px 页面聊天区始终可用；390px 页面无横向溢出。

## 验证

实际走过：最近会议 → 未结束历史 → 明确继续 → 两边拖动/折叠/恢复/重置 → 普通纪要预览 → 结束前确认 → 返回讨论 → 已结束历史 → 纪要 → 材料 → 手机。

另实际发起一场会议并确认结束：新会有输入和结束入口；确认页仅有确认操作；结束后返回讨论仍无输入与结束按钮。该检查没有提交模型问答，未触发摘要 API。

在历史模式中已验证：未结束记录无发送、结束或成果生成按钮；已结束记录无采纳、确认应用、重新校验或继续按钮，并保留 15 个材料预览入口。

验证文件：

- output/playwright/meeting-lifecycle/browser-check.txt
- output/playwright/meeting-lifecycle/new-meeting-check.txt
- output/playwright/meeting-lifecycle/history-desktop.png
- output/playwright/meeting-lifecycle/resized-desktop.png
- output/playwright/meeting-lifecycle/history-mobile.png

回归测试：263 项、23 文件通过；typecheck 和 build 通过。构建仍有已有的大包/动态导入提示，本轮未扩展架构改造。

## 修改文件

- src/components/planning/MeetingRoom.tsx
- src/components/planning/MeetingMinutesView.tsx
- src/components/planning/MaterialSuggestions.tsx
- src/components/planning/MeetingRoom.css
- src/pages/ManagementPages.tsx
- src/tests/meetingRoomInteraction.test.tsx
