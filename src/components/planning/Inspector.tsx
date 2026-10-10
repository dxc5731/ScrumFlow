import { useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Diamond,
  GripVertical,
  Link2,
  ListChecks,
  LocateFixed,
  Network,
  Bot,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react"
import { useProjectStore } from "../../store/projectStore"
import {
  byOrder,
  selectCapabilityMatch,
  selectIncomingDependencies,
  selectDiscussions,
  selectImpacts,
  selectMemberWorkload,
  selectOutgoingDependencies,
  selectRisks,
  selectScheduleHealth,
  selectStoryCriteria,
  selectStoryProgress,
  selectStorySummaryDates,
  selectStoryTasks,
  selectTaskSubtasks,
  storyDisplayStatus,
} from "../../store/selectors"
import type {
  AcceptanceCriterion,
  BlockReasonEntity,
  InspectorTab,
  StoryEntity,
  SubtaskEntity,
  TaskEntity,
} from "../../types"
import { TASK_STATUS_COLORS } from "./statusColors"
import ResultSubmissionPanel from "./ResultSubmissionPanel"
import AssetAssociationPicker from "./AssetAssociationPicker"
import StoryAcceptancePanel from "./StoryAcceptancePanel"
import EventInsightPanel from "./EventInsightPanel"
import MeetingRoom from "./MeetingRoom"
import { FieldLabel, MemberAvatar, notify } from "./ui"

const tabs: { id: InspectorTab; label: string }[] = [
  { id: "overview", label: "概览" },
  { id: "engineering", label: "工程" },
  { id: "assets", label: "设计资产" },
  { id: "activity", label: "活动" },
]

export default function Inspector() {
  const workspace = useProjectStore((state) => state.workspace)
  const story = useProjectStore((state) =>
    workspace.selectedObjectType === "story" && workspace.selectedObjectId
      ? state.stories[workspace.selectedObjectId]
      : null,
  )
  const task = useProjectStore((state) =>
    workspace.selectedObjectType === "task" && workspace.selectedObjectId
      ? state.tasks[workspace.selectedObjectId]
      : null,
  )
  const subtask = useProjectStore((state) =>
    workspace.selectedObjectType === "subtask" && workspace.selectedObjectId
      ? state.subtasks[workspace.selectedObjectId]
      : null,
  )
  const setWorkspace = useProjectStore((state) => state.setWorkspace)
  const resizeRef = useRef<{ startX: number; width: number } | null>(null)

  if (!workspace.inspectorOpen || (!story && !task && !subtask)) {
    const hasSelection = Boolean(
      workspace.selectedObjectType && workspace.selectedObjectId,
    )
    return (
      <button
        className="flex w-11 flex-shrink-0 flex-col items-center gap-3 border-l border-[#E2E7EE] bg-white py-4 text-[#98A2B3]"
        onClick={() => hasSelection && setWorkspace({ inspectorOpen: true })}
        title={
          hasSelection
            ? "展开详情编辑栏"
            : "选择 Story、Task 或 Subtask 查看详情"
        }
      >
        <ChevronLeft size={14} />
        <span className="text-[11px] font-medium [writing-mode:vertical-rl]">
          {hasSelection ? "展开详情" : "选择对象"}
        </span>
      </button>
    )
  }

  return (
    <aside
      className="relative flex flex-shrink-0 flex-col border-l border-[#E2E7EE] bg-white"
      style={{ width: workspace.inspectorWidth }}
    >
      <div
        className="absolute bottom-0 left-0 top-0 z-30 w-1 cursor-col-resize hover:bg-[#C7D7FE]"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          resizeRef.current = {
            startX: event.clientX,
            width: workspace.inspectorWidth,
          }
        }}
        onPointerMove={(event) => {
          if (!resizeRef.current) return
          setWorkspace({
            inspectorWidth: Math.min(
              640,
              Math.max(
                340,
                resizeRef.current.width +
                  resizeRef.current.startX -
                  event.clientX,
              ),
            ),
          })
        }}
        onPointerUp={() => {
          resizeRef.current = null
        }}
      />
      {story ? (
        <StoryInspector
          story={story}
          onClose={() => setWorkspace({ inspectorOpen: false })}
        />
      ) : task ? (
        <TaskInspector
          task={task}
          onClose={() => setWorkspace({ inspectorOpen: false })}
        />
      ) : subtask ? (
        <SubtaskInspector
          subtask={subtask}
          onClose={() => setWorkspace({ inspectorOpen: false })}
        />
      ) : null}
    </aside>
  )
}

function StoryInspector({
  story,
  onClose,
}: {
  story: StoryEntity
  onClose: () => void
}) {
  const state = useProjectStore()
  const [meetingId, setMeetingId] = useState<string | null>(null)
  const recentMeeting = Object.values(state.meetingSessions)
    .filter((item) => item.targetType === "story" && item.targetId === story.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const tab = state.workspace.inspectorTab
  const tasks = selectStoryTasks(state, story.id)
  const storyQualityItems: Array<TaskEntity | SubtaskEntity> = []
  tasks.forEach((task) => {
    const children = selectTaskSubtasks(state, task.id)
    storyQualityItems.push(...(children.length ? children : [task]))
  })
  const storyQuality = {
    good: storyQualityItems.filter((item) => item.qualityStatus === "good").length,
    attention: storyQualityItems.filter((item) => item.qualityStatus === "attention").length,
    pending: storyQualityItems.filter((item) => item.qualityStatus === "pending").length,
  }
  const criteria = selectStoryCriteria(state, story.id)
  const summaryDates = selectStorySummaryDates(state, story.id)
  const storyProgress = selectStoryProgress(state, story.id)
  const storySchedule = selectScheduleHealth(story.startDate, story.dueDate, storyProgress)
  const storyWorkload = selectMemberWorkload(state, story.assigneeId)
  const storyRisks = selectRisks(state, "story", story.id)
  const storyImpacts = selectImpacts(state, "story", story.id).slice(0, 3)
  const discussions = selectDiscussions(state, "story", story.id)
  const storyHistory = [...state.history]
    .reverse()
    .filter(
      (item) =>
        item.objectId === story.id ||
        tasks.some((task) => task.id === item.objectId),
    )
    .slice(0, 30)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  )
  const [newAC, setNewAC] = useState("")
  const [newMessage, setNewMessage] = useState("")
  const [relationDepth, setRelationDepth] = useState<0 | 1 | 2>(0)
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [newTask, setNewTask] = useState({
    title: "",
    type: "frontend" as TaskEntity["type"],
  })

  useEffect(() => setSaveState("idle"), [story.id])
  const saveStory = (patch: Partial<StoryEntity>) => {
    setSaveState("saving")
    const result = state.updateStory(story.id, patch)
    if (!result.ok) {
      setSaveState("idle")
      notify(result.message, "error")
      return
    }
    window.setTimeout(() => setSaveState("saved"), 180)
    window.setTimeout(() => setSaveState("idle"), 1600)
  }

  const addCriterion = () => {
    if (!newAC.trim()) return
    state.addAcceptanceCriterion(story.id, newAC)
    setNewAC("")
    notify("验收标准已添加")
  }

  const addTask = () => {
    if (!newTask.title.trim()) return
    const created = state.createTask(story.id, {
      title: newTask.title,
      type: newTask.type,
    })
    setNewTask({ title: "", type: "frontend" })
    setNewTaskOpen(false)
    state.selectObject("task", created.id)
    notify("工程任务已创建")
  }

  return (
    <>
      {meetingId && <MeetingRoom key={meetingId} initialSessionId={meetingId} onClose={() => setMeetingId(null)} />}
      <div className="border-b border-[#EAECF0]">
        <div className="flex items-center gap-2 px-4 pb-2 pt-4">
          <span className="rounded bg-[#F4F3FF] px-2 py-0.5 font-mono text-[10px] font-bold text-[#6941C6]">
            {story.id.toUpperCase()}
          </span>
          <span className="text-[10px] text-[#98A2B3]">User Story</span>
          <span className="ml-auto flex items-center gap-1 text-[10px] text-[#067647]">
            {saveState === "saving" ? (
              <>
                <Save size={11} />
                保存中...
              </>
            ) : saveState === "saved" ? (
              <>
                <Check size={11} />
                已保存
              </>
            ) : (
              "自动保存"
            )}
          </span>
          <button
            className="icon-button text-[#B42318]"
            title="删除 Story"
            onClick={() => {
              if (
                window.confirm(
                  `确定删除 ${story.id.toUpperCase()} 吗？其工程任务和验收标准也会删除。`,
                )
              ) {
                const result = state.deleteStory(story.id)
                notify(result.message, result.ok ? "success" : "error")
              }
            }}
          >
            <Trash2 size={13} />
          </button>
          <button className="icon-button" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="px-4 pb-3">
          <InlineText
            value={story.title}
            className="text-base font-semibold text-[#172033]"
            onSave={(value) => saveStory({ title: value })}
            multiline
          />
        </div>
        {state.workspace.actorMode === "po" && <div className="flex flex-wrap gap-2 px-4 pb-3">
          <button className="secondary-button" onClick={() => setMeetingId(state.createMeeting("story", story.id).id)}><Bot size={13} /> 发起 AI 项目会议</button>
          {recentMeeting && <button className="secondary-button" onClick={() => setMeetingId(recentMeeting.id)}><Clock3 size={13} /> {recentMeeting.status === "active" ? "继续会议" : "查看会议记录"}</button>}
        </div>}
        <div className="flex items-center gap-2 px-4 pb-3">
          <StatusSelect story={story} onChange={saveStory} />
          <PrioritySelect story={story} onChange={saveStory} />
          <MemberAvatar memberId={story.assigneeId} size={22} />
          <span className="ml-auto font-mono text-xs font-bold text-[#5B5CE2]">
            {story.storyPoints} pt
          </span>
        </div>
        <div className="flex px-3">
          {tabs.map((item) => (
            <button
              key={item.id}
              className="px-3 py-2 text-xs font-medium"
              style={{
                color: tab === item.id ? "#5B5CE2" : "#667085",
                borderBottom:
                  tab === item.id
                    ? "2px solid #5B5CE2"
                    : "2px solid transparent",
              }}
              onClick={() => state.setInspectorTab(item.id)}
            >
              {item.label}
              {item.id === "overview" && criteria.length > 0 && (
                <span className="ml-1 text-[9px] text-[#B54708]">
                  {criteria.filter((criterion) => criterion.satisfied).length}/
                  {criteria.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === "overview" && (
          <div className="space-y-5 p-4">
            <section>
              <FieldLabel>进度 团队 风险与价值</FieldLabel>
              <div className="grid grid-cols-2 gap-2 text-[10px]"><div className="rounded-lg border border-[#E2E7EE] bg-[#F9FAFB] p-2">计划 {storySchedule.expectedProgress}% · 实际 {storySchedule.actualProgress}%<div className={storySchedule.variance < -10 ? "mt-1 text-[#B42318]" : "mt-1 text-[#067647]"}>偏差 {storySchedule.variance > 0 ? "+" : ""}{storySchedule.variance}%{storySchedule.overdue ? " · 已逾期" : ""}</div></div><div className="rounded-lg border border-[#E2E7EE] bg-[#F9FAFB] p-2">负责人负载 {storyWorkload.utilization}%<div className="mt-1 text-[#667085]">业务价值 {story.businessValue}/5</div></div></div>
              <div className="mt-2 rounded-lg border border-[#E2E7EE] bg-[#F9FAFB] p-2 text-[10px] text-[#667085]">交付质量：良好 {storyQuality.good} · 待检查 {storyQuality.pending} · 需关注 {storyQuality.attention}</div>
              <div className="mt-2 space-y-1">{storyRisks.map((risk) => <div key={risk.id} className="rounded bg-[#FEF3F2] px-2 py-1.5 text-[10px] text-[#B42318]">{risk.title} · {risk.level}</div>)}{storyImpacts.map((impact) => <div key={impact.id} className="rounded bg-[#FFFAEB] px-2 py-1.5 text-[10px] text-[#B54708]">{impact.summary}</div>)}</div>
            </section>
            <section>
              <FieldLabel>用户故事</FieldLabel>
              <div className="space-y-2 rounded-lg border border-[#E2E7EE] bg-[#F9FAFB] p-3">
                <StorySentence
                  label="作为"
                  value={story.as}
                  onSave={(value) => saveStory({ as: value })}
                />
                <StorySentence
                  label="我希望"
                  value={story.iWant}
                  onSave={(value) => saveStory({ iWant: value })}
                />
                <StorySentence
                  label="从而"
                  value={story.soThat}
                  onSave={(value) => saveStory({ soThat: value })}
                />
              </div>
            </section>
            <section>
              <FieldLabel>预期收益</FieldLabel>
              <InlineText
                value={story.expectedBenefit}
                placeholder="用简短文字说明交付后可获得的收益..."
                className="rounded-lg border border-[#E2E7EE] bg-white p-3 text-xs leading-relaxed text-[#475467]"
                onSave={(expectedBenefit) => saveStory({ expectedBenefit })}
                multiline
              />
            </section>
            <section>
              <FieldLabel>紧凑属性</FieldLabel>
              <div className="grid grid-cols-2 gap-2.5">
                <LabeledSelect
                  label="负责人"
                  value={story.assigneeId}
                  options={Object.values(state.members).map((member) => ({
                    value: member.id,
                    label: member.name,
                  }))}
                  onChange={(assigneeId) => saveStory({ assigneeId })}
                />
                <LabeledSelect
                  label="Sprint"
                  value={story.sprintId ?? ""}
                  options={[
                    { value: "", label: "Product Backlog" },
                    ...Object.values(state.sprints).map((sprint) => ({
                      value: sprint.id,
                      label: sprint.name,
                    })),
                  ]}
                  onChange={(sprintId) => {
                    const result = state.moveStory(
                      story.id,
                      story.epicId,
                      sprintId || null,
                    )
                    notify(result.message, result.ok ? "success" : "error")
                  }}
                />
                <LabeledSelect
                  label="Epic"
                  value={story.epicId ?? ""}
                  options={Object.values(state.epics).map((epic) => ({
                    value: epic.id,
                    label: epic.title,
                  }))}
                  onChange={(epicId) => {
                    const result = state.moveStory(
                      story.id,
                      epicId,
                      story.sprintId,
                    )
                    notify(result.message, result.ok ? "success" : "error")
                  }}
                />
                <LabeledInput
                  label="Story Point"
                  type="number"
                  value={story.storyPoints}
                  onSave={(value) => saveStory({ storyPoints: Number(value) })}
                />
                <LabeledInput
                  label="业务价值"
                  type="number"
                  value={story.businessValue}
                  onSave={(value) =>
                    saveStory({ businessValue: Number(value) })
                  }
                />
                <LabeledSelect
                  label="成熟度"
                  value={story.maturityStatus}
                  options={[
                    { value: "candidate", label: "候选" },
                    { value: "draft", label: "草稿" },
                    { value: "ready", label: "Ready" },
                  ]}
                  onChange={(value) => {
                    const result = state.setStoryMaturity(
                      story.id,
                      value as StoryEntity["maturityStatus"],
                    )
                    notify(result.message, result.ok ? "success" : "error")
                  }}
                />
                <LabeledInput
                  label="开始日期"
                  type="date"
                  value={summaryDates.startDate}
                  onSave={(value) => saveStory({ startDate: value })}
                />
                <LabeledInput
                  label="截止日期"
                  type="date"
                  value={summaryDates.endDate}
                  onSave={(value) => saveStory({ dueDate: value })}
                />
              </div>
            </section>
            <section>
              <div className="mb-2 flex items-center">
                <FieldLabel>验收标准</FieldLabel>
                <span className="ml-auto rounded bg-[#FFFAEB] px-1.5 py-0.5 text-[9px] text-[#B54708]">
                  已满足不等于已验收
                </span>
              </div>
              <div className="space-y-2">
                {criteria.map((criterion, index) => (
                  <CriterionRow
                    key={criterion.id}
                    criterion={criterion}
                    index={index}
                    total={criteria.length}
                  />
                ))}
                <div className="flex gap-1.5">
                  <input
                    className="form-input"
                    value={newAC}
                    onChange={(event) => setNewAC(event.target.value)}
                    onKeyDown={(event) =>
                      event.key === "Enter" && addCriterion()
                    }
                    placeholder="新增验收标准..."
                  />
                  <button
                    className="icon-button border border-[#D9D6FE] text-[#6941C6]"
                    onClick={addCriterion}
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            </section>
            <section>
              <FieldLabel>Story 验收</FieldLabel>
              <StoryAcceptancePanel storyId={story.id} compact />
            </section>
            <section>
              <EventInsightPanel target={{ type: "story", id: story.id }} />
            </section>
            <section>
              <FieldLabel>风险与依赖</FieldLabel>
              <div className="space-y-2">
                <div
                  className="rounded-lg border p-3"
                  style={{
                    borderColor: story.risk === "high" ? "#FEDF89" : "#E2E7EE",
                    background: story.risk === "high" ? "#FFFCF5" : "white",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <CircleAlert size={14} className="text-[#B54708]" />
                    <select
                      className="flex-1 bg-transparent text-xs font-medium outline-none"
                      value={story.risk}
                      onChange={(event) =>
                        saveStory({
                          risk: event.target.value as StoryEntity["risk"],
                        })
                      }
                    >
                      <option value="none">无风险</option>
                      <option value="low">低风险</option>
                      <option value="medium">中风险</option>
                      <option value="high">高风险</option>
                    </select>
                  </div>
                  <InlineText
                    value={story.riskNote}
                    placeholder="补充风险说明..."
                    className="mt-2 text-xs text-[#667085]"
                    onSave={(value) => saveStory({ riskNote: value })}
                    multiline
                  />
                </div>
                <StoryDependencyList story={story} />
              </div>
            </section>
            <section>
              <div className="flex items-center gap-2">
                <FieldLabel>关系管理</FieldLabel>
                <button
                  className="secondary-button ml-auto"
                  onClick={() => setRelationDepth(relationDepth ? 0 : 1)}
                >
                  <Network size={13} />
                  {relationDepth ? "收起关系" : "查看关系"}
                </button>
              </div>
              {relationDepth > 0 && (
                <RelationPanel
                  type="story"
                  id={story.id}
                  depth={relationDepth}
                  onDepthChange={setRelationDepth}
                />
              )}
            </section>
            <div className="grid grid-cols-3 gap-2">
              <button
                className="secondary-button px-2"
                onClick={() =>
                  state.requestFocus("story", story.id, "story-map")
                }
              >
                <LocateFixed size={13} />
                用户地图
              </button>
              <button
                className="secondary-button px-2"
                onClick={() => state.requestFocus("story", story.id, "gantt")}
              >
                <Calendar size={13} />
                甘特图
              </button>
              <button
                className="secondary-button px-2"
                onClick={() => state.requestFocus("story", story.id, "board")}
              >
                <ArrowRight size={13} />
                执行状态
              </button>
            </div>
          </div>
        )}

        {tab === "engineering" && (
          <div className="space-y-4 p-4">
            <div className="flex items-center">
              <div>
                <FieldLabel>工程任务</FieldLabel>
                <p className="text-[10px] text-[#98A2B3]">
                  {tasks.length} 个任务 ·{" "}
                  {tasks.reduce((sum, task) => sum + task.estimate, 0)}h
                </p>
              </div>
              <button
                className="primary-button ml-auto"
                onClick={() => setNewTaskOpen(true)}
              >
                <Plus size={13} />
                新建任务
              </button>
            </div>
            {newTaskOpen && (
              <div className="space-y-2 rounded-lg border border-[#D9D6FE] bg-[#F9F5FF] p-3">
                <input
                  autoFocus
                  className="form-input"
                  placeholder="工程任务名称"
                  value={newTask.title}
                  onChange={(event) =>
                    setNewTask({ ...newTask, title: event.target.value })
                  }
                />
                <select
                  className="form-input"
                  value={newTask.type}
                  onChange={(event) =>
                    setNewTask({
                      ...newTask,
                      type: event.target.value as TaskEntity["type"],
                    })
                  }
                >
                  <option value="frontend">FE</option>
                  <option value="backend">BE</option>
                  <option value="database">DATA</option>
                  <option value="test">TEST</option>
                  <option value="design">UI</option>
                  <option value="devops">OPS</option>
                </select>
                <div className="flex gap-2">
                  <button className="primary-button" onClick={addTask}>
                    创建
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => setNewTaskOpen(false)}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
            <div className="space-y-2">
              {tasks.map((task, index) => (
                <div
                  key={task.id}
                  className="group flex cursor-pointer items-center gap-2 rounded-lg border border-[#E2E7EE] p-2.5 hover:border-[#C7D7FE]"
                  onClick={() => state.selectObject("task", task.id)}
                >
                  <GripVertical size={12} className="text-[#D0D5DD]" />
                  <span className="rounded bg-[#F4F3FF] px-1.5 py-0.5 text-[9px] font-semibold text-[#6941C6]">
                    {task.type.toUpperCase().slice(0, 4)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-[#344054]">
                    {task.title}
                  </span>
                  <span className="font-mono text-[9px] text-[#98A2B3]">
                    {task.estimate}h
                  </span>
                  <button
                    className="icon-button h-5 w-5"
                    disabled={index === 0}
                    onClick={(event) => {
                      event.stopPropagation()
                      state.moveTask(task.id, story.id, index - 1)
                    }}
                  >
                    <ArrowUp size={11} />
                  </button>
                  <button
                    className="icon-button h-5 w-5"
                    disabled={index === tasks.length - 1}
                    onClick={(event) => {
                      event.stopPropagation()
                      state.moveTask(task.id, story.id, index + 1)
                    }}
                  >
                    <ArrowDown size={11} />
                  </button>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-[#D9D6FE] bg-[#F9F5FF] p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#5925DC]">
                <ListChecks size={14} />
                任务分解关系
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-[#6941C6]">
                {story.id.toUpperCase()} →{" "}
                {tasks.map((task) => task.id).join(" → ") || "尚未分解工程任务"}
              </p>
            </div>
          </div>
        )}

        {tab === "assets" && (
          <div className="p-4">
            <AssetAssociationPicker targetType="story" targetId={story.id} />
          </div>
        )}

        {tab === "activity" && (
          <div className="space-y-5 p-4">
            <section>
              <FieldLabel>项目数据检查</FieldLabel>
              <div className="flex flex-wrap gap-1.5">
                <button
                  className="secondary-button"
                  onClick={() => {
                    const missing = [
                      !story.title && "标题",
                      !story.epicId && "Epic",
                      !story.as && "作为",
                      !story.iWant && "我希望",
                      !story.soThat && "从而",
                      !criteria.length && "验收标准",
                    ].filter(Boolean)
                    notify(
                      missing.length
                        ? `完整性检查：缺少 ${missing.join("、")}`
                        : "完整性检查通过，Story 已具备规划所需信息",
                      missing.length ? "info" : "success",
                    )
                  }}
                >
                  检查 Story 完整性
                </button>
                <button
                  className="secondary-button"
                  onClick={() =>
                    notify(
                      `当前 Story 含 ${tasks.length} 个工程任务、${criteria.length} 条 AC、风险等级 ${story.risk}。分析仅供参考，未修改正式数据。`,
                      "info",
                    )
                  }
                >
                  查看范围摘要
                </button>
              </div>
              <p className="mt-2 text-[9px] text-[#98A2B3]">
                检查结果只读取正式项目数据，不自动修改任何字段。
              </p>
            </section>
            <section>
              <FieldLabel>讨论</FieldLabel>
              <div className="space-y-3">
                {discussions.map((message) => (
                  <div key={message.id} className="flex gap-2">
                    <MemberAvatar
                      memberId={
                        message.authorId === "ai" ? "m1" : message.authorId
                      }
                      size={24}
                    />
                    <div className="flex-1 rounded-lg bg-[#F9FAFB] p-2.5">
                      <div className="mb-1 text-[9px] text-[#98A2B3]">
                        {message.isAI
                          ? "AI 助手"
                          : state.members[message.authorId]?.name}{" "}
                        ·{" "}
                        {new Date(message.createdAt).toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                      <p className="text-xs leading-relaxed text-[#475467]">
                        {message.content}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex gap-1.5">
                <input
                  className="form-input"
                  value={newMessage}
                  onChange={(event) => setNewMessage(event.target.value)}
                  placeholder="输入讨论内容..."
                />
                <button
                  className="primary-button"
                  onClick={() => {
                    if (!newMessage.trim()) return
                    state.addDiscussion("story", story.id, newMessage)
                    setNewMessage("")
                  }}
                >
                  发送
                </button>
              </div>
            </section>
            <section>
              <FieldLabel>变更历史</FieldLabel>
              <div className="space-y-2">
                {storyHistory.map((item) => (
                  <div
                    key={item.id}
                    className="flex gap-2 border-l-2 border-[#D9D6FE] pl-2"
                  >
                    <Clock3 size={11} className="mt-0.5 text-[#98A2B3]" />
                    <div className="min-w-0">
                      <p className="text-[10px] text-[#475467]">
                        <b>{item.objectType}</b> · {item.field} 已更新
                      </p>
                      <p className="truncate text-[9px] text-[#98A2B3]">
                        {new Date(item.createdAt).toLocaleString("zh-CN")}
                      </p>
                    </div>
                  </div>
                ))}
                {!storyHistory.length && (
                  <p className="text-xs text-[#98A2B3]">尚无正式修改记录</p>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </>
  )
}

function TaskInspector({
  task,
  onClose,
}: {
  task: TaskEntity
  onClose: () => void
}) {
  const state = useProjectStore()
  const story = state.stories[task.storyId]
  const subtasks = selectTaskSubtasks(state, task.id)
  const incoming = selectIncomingDependencies(state, task.id)
  const outgoing = selectOutgoingDependencies(state, task.id)
  const schedule = selectScheduleHealth(task.startDate, task.endDate, task.progress)
  const workload = selectMemberWorkload(state, task.assigneeId)
  const capability = selectCapabilityMatch(state, task.assigneeId, task.type)
  const taskRisks = selectRisks(state, "task", task.id)
  const impacts = selectImpacts(state).filter((impact) => impact.affectedTaskIds.includes(task.id)).slice(0, 5)
  const discussions = selectDiscussions(state, "task", task.id)
  const [newSubtask, setNewSubtask] = useState("")
  const [newMessage, setNewMessage] = useState("")
  const [relationDepth, setRelationDepth] = useState<0 | 1 | 2>(0)
  const blockSectionRef = useRef<HTMLElement>(null)
  const save = (patch: Partial<TaskEntity>) => {
    const result = state.updateTask(task.id, patch)
    notify(result.message, result.ok ? "success" : "error")
  }
  return (
    <>
      <div className="border-b border-[#EAECF0] p-4">
        <div className="flex items-center gap-2">
          <span className="rounded bg-[#EFF8FF] px-2 py-0.5 font-mono text-[10px] font-bold text-[#175CD3]">
            {task.id.toUpperCase()}
          </span>
          <span className="text-[10px] text-[#98A2B3]">Engineering Task</span>
          <button
            className="icon-button ml-auto text-[#B42318]"
            title="删除工程任务"
            onClick={() => {
              if (window.confirm(`确定删除工程任务 ${task.id} 吗？`)) {
                const result = state.deleteTask(task.id)
                notify(result.message, result.ok ? "success" : "error")
              }
            }}
          >
            <Trash2 size={13} />
          </button>
          <button className="icon-button" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="mt-3">
          <InlineText
            value={task.title}
            className="text-base font-semibold text-[#172033]"
            onSave={(title) => save({ title })}
            multiline
          />
        </div>
        <button
          className="mt-2 flex items-center gap-1 text-[10px] font-medium text-[#6941C6]"
          onClick={() => state.selectObject("story", story.id)}
        >
          <ChevronLeft size={11} />
          返回 {story.id.toUpperCase()}
        </button>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <section>
          <EventInsightPanel target={{ type: "task", id: task.id }} />
        </section>
        <section>
          <FieldLabel>执行属性</FieldLabel>
          <div className="grid grid-cols-2 gap-2.5">
            <LabeledSelect
              label="状态"
              value={task.status}
              style={{
                background: TASK_STATUS_COLORS[task.status].bg,
                borderColor: TASK_STATUS_COLORS[task.status].border,
                color: TASK_STATUS_COLORS[task.status].color,
              }}
              options={[
                { value: "todo", label: "待办" },
                { value: "in_progress", label: "进行中" },
                { value: "review", label: "评审" },
                { value: "done", label: "完成" },
                { value: "blocked", label: "阻塞" },
              ]}
              onChange={(status) => {
                if (status === "blocked" && task.status !== "blocked") {
                  blockSectionRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  })
                  return notify("请在下方添加阻塞原因", "error")
                }
                save({ status: status as TaskEntity["status"] })
              }}
            />
            <LabeledSelect
              label="负责人"
              value={task.assigneeId}
              options={Object.values(state.members).map((member) => ({
                value: member.id,
                label: member.name,
              }))}
              onChange={(assigneeId) => save({ assigneeId })}
            />
            <LabeledInput
              label="开始日期"
              type="date"
              value={task.startDate}
              onSave={(startDate) => save({ startDate })}
            />
            <LabeledInput
              label="结束日期"
              type="date"
              value={task.endDate}
              onSave={(endDate) => save({ endDate })}
            />
            <LabeledInput
              label="预计工时"
              type="number"
              value={task.estimate}
              onSave={(estimate) => save({ estimate: Number(estimate) })}
            />
            <LabeledInput
              label="进度 %"
              type="number"
              value={task.progress}
              onSave={(progress) =>
                save({ progress: Math.min(100, Math.max(0, Number(progress))) })
              }
            />
          </div>
          <label className="mt-3 flex items-center gap-2 rounded-lg border border-[#E2E7EE] px-3 py-2 text-xs text-[#475467]">
            <input
              type="checkbox"
              checked={task.isMilestone}
              onChange={(event) => save({ isMilestone: event.target.checked })}
            />
            <Diamond size={13} className="text-[#7F56D9]" />
            作为里程碑显示
          </label>
        </section>
        <section>
          <FieldLabel>计划偏差与团队负载</FieldLabel>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-[#E2E7EE] bg-[#F9FAFB] p-2.5"><div className="text-[9px] text-[#98A2B3]">计划 / 实际进度</div><div className="mt-1 text-xs font-semibold text-[#344054]">{schedule.expectedProgress}% / {schedule.actualProgress}%</div><div className={`mt-1 text-[9px] ${schedule.variance < -10 ? "text-[#B42318]" : "text-[#067647]"}`}>偏差 {schedule.variance > 0 ? "+" : ""}{schedule.variance}%{schedule.overdue ? " · 已逾期" : ""}</div></div>
            <div className="rounded-lg border border-[#E2E7EE] bg-[#F9FAFB] p-2.5"><div className="text-[9px] text-[#98A2B3]">负责人负载与能力</div><div className="mt-1 text-xs font-semibold text-[#344054]">{workload.plannedHours}h / {workload.capacityHours}h</div><div className={`mt-1 text-[9px] ${workload.utilization > 100 || !capability.matched ? "text-[#B42318]" : "text-[#067647]"}`}>容量 {workload.utilization}% · {capability.label}</div></div>
          </div>
        </section>
        <section>
          <FieldLabel>质量与阻塞等级</FieldLabel>
          <div className="grid grid-cols-2 gap-2">
            <LabeledSelect label="交付质量" value={task.qualityStatus} options={[{ value: "pending", label: "待检查" }, { value: "good", label: "良好" }, { value: "attention", label: "需关注" }]} onChange={(qualityStatus) => save({ qualityStatus: qualityStatus as TaskEntity["qualityStatus"] })} />
            <LabeledSelect label="阻塞等级" value={task.blockedSeverity} options={[{ value: "normal", label: "普通" }, { value: "severe", label: "严重" }]} onChange={(blockedSeverity) => save({ blockedSeverity: blockedSeverity as TaskEntity["blockedSeverity"] })} />
          </div>
          <textarea className="form-input mt-2 min-h-16 resize-y" value={task.qualityNote} placeholder="质量检查说明" onChange={(event) => save({ qualityNote: event.target.value })} />
        </section>
        <section>
          <div className="flex items-center"><FieldLabel>关联风险</FieldLabel><button className="secondary-button ml-auto" onClick={() => state.setWorkspace({ currentPage: "risks" })}><Plus size={12} />风险登记册</button></div>
          <div className="space-y-2">{taskRisks.map((risk) => <div key={risk.id} className="rounded-lg border border-[#FECDCA] bg-[#FEF3F2] p-2 text-[10px] text-[#B42318]"><b>{risk.title}</b><div className="mt-1">{risk.impact || risk.description}</div></div>)}{!taskRisks.length && <p className="text-xs text-[#98A2B3]">当前任务无登记风险</p>}</div>
        </section>
        <section ref={blockSectionRef}>
          <BlockReasonEditor
            entityType="task"
            entityId={task.id}
            reasons={task.blockReasons}
            excludedTaskId={task.id}
          />
        </section>
        <section>
          <FieldLabel>Subtask</FieldLabel>
          <div className="space-y-2">
            {subtasks.map((subtask) => (
              <div
                key={subtask.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#E2E7EE] p-2.5 text-xs text-[#475467] hover:border-[#C7D7FE]"
                onClick={() => state.selectObject("subtask", subtask.id)}
              >
                <input
                  type="checkbox"
                  checked={subtask.done}
                  style={{
                    accentColor: TASK_STATUS_COLORS[subtask.status].accent,
                  }}
                  onClick={(event) => event.stopPropagation()}
                  onChange={() => state.toggleSubtask(subtask.id)}
                />
                <span
                  style={{
                    textDecoration: subtask.done ? "line-through" : "none",
                  }}
                >
                  {subtask.title}
                </span>
                <ChevronRight size={12} className="ml-auto text-[#98A2B3]" />
              </div>
            ))}
            <div className="flex gap-1.5">
              <input
                className="form-input"
                value={newSubtask}
                onChange={(event) => setNewSubtask(event.target.value)}
                placeholder="新增 Subtask..."
              />
              <button
                className="icon-button border border-[#D9D6FE] text-[#6941C6]"
                onClick={() => {
                  if (!newSubtask.trim()) return
                  state.addSubtask(task.id, newSubtask)
                  setNewSubtask("")
                }}
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
        </section>
        <section>
          <FieldLabel>FS 依赖</FieldLabel>
          <div className="space-y-2">
            {incoming.map((dep) => (
              <DependencyRow
                key={dep.id}
                label="Blocked by"
                task={state.tasks[dep.sourceTaskId]}
                onDelete={() => state.deleteDependency(dep.id)}
              />
            ))}
            {outgoing.map((dep) => (
              <DependencyRow
                key={dep.id}
                label="Blocking"
                task={state.tasks[dep.targetTaskId]}
                onDelete={() => state.deleteDependency(dep.id)}
              />
            ))}
            {!incoming.length && !outgoing.length && (
              <p className="text-xs text-[#98A2B3]">
                暂无任务依赖，可在 Gantt 连接点创建。
              </p>
            )}
          </div>
        </section>
        <section>
          <AssetAssociationPicker targetType="task" targetId={task.id} />
        </section>
        <section>
          <ResultSubmissionPanel type="task" id={task.id} />
        </section>
        <section>
          <FieldLabel>变更影响</FieldLabel>
          <div className="space-y-2">{impacts.map((impact) => <div key={impact.id} className="rounded-lg border border-[#FEDF89] bg-[#FFFAEB] p-2 text-[10px] text-[#B54708]">{impact.summary}<div className="mt-1 text-[9px] opacity-70">Release 风险 {impact.releaseRisk}</div></div>)}{!impacts.length && <p className="text-xs text-[#98A2B3]">暂无关联影响记录</p>}</div>
        </section>
        <section>
          <FieldLabel>任务讨论</FieldLabel>
          <div className="space-y-2">{discussions.map((message) => <div key={message.id} className="rounded-lg bg-[#F9FAFB] p-2 text-xs text-[#475467]"><div className="mb-1 text-[9px] text-[#98A2B3]">{state.members[message.authorId]?.name} · {new Date(message.createdAt).toLocaleString("zh-CN")}</div>{message.content}</div>)}</div>
          <div className="mt-2 flex gap-1.5"><input className="form-input" value={newMessage} onChange={(event) => setNewMessage(event.target.value)} placeholder="输入任务讨论内容" /><button className="primary-button" onClick={() => { const result = state.addDiscussion("task", task.id, newMessage); notify(result.message, result.ok ? "success" : "error"); if (result.ok) setNewMessage("") }}>发送</button></div>
        </section>
        <section>
          <div className="flex items-center gap-2">
            <FieldLabel>关系管理</FieldLabel>
            <button
              className="secondary-button ml-auto"
              onClick={() => setRelationDepth(relationDepth ? 0 : 1)}
            >
              <Network size={13} />
              {relationDepth ? "收起关系" : "查看关系"}
            </button>
          </div>
          {relationDepth > 0 && (
            <RelationPanel
              type="task"
              id={task.id}
              depth={relationDepth}
              onDepthChange={setRelationDepth}
            />
          )}
        </section>
        <button
          className="secondary-button w-full"
          onClick={() => state.requestFocus("task", task.id, "story-map")}
        >
          <ArrowLeftRight size={13} />
          在用户地图中定位
        </button>
      </div>
    </>
  )
}

function SubtaskInspector({
  subtask,
  onClose,
}: {
  subtask: SubtaskEntity
  onClose: () => void
}) {
  const state = useProjectStore()
  const task = state.tasks[subtask.taskId]
  const story = task ? state.stories[task.storyId] : null
  const schedule = selectScheduleHealth(subtask.startDate, subtask.endDate, subtask.progress)
  const workload = selectMemberWorkload(state, subtask.assigneeId)
  const [relationDepth, setRelationDepth] = useState<0 | 1 | 2>(0)
  const blockSectionRef = useRef<HTMLElement>(null)
  if (!task || !story) return null
  const capability = selectCapabilityMatch(state, subtask.assigneeId, task.type)
  const inheritedRisks = selectRisks(state, "task", task.id).filter((risk) => risk.status !== "resolved")
  const save = (patch: Partial<SubtaskEntity>) => {
    const result = state.updateSubtask(subtask.id, patch)
    notify(result.message, result.ok ? "success" : "error")
  }
  return (
    <>
      <div className="border-b border-[#EAECF0] p-4">
        <div className="flex items-center gap-2">
          <span className="rounded bg-[#F0F9FF] px-2 py-0.5 font-mono text-[10px] font-bold text-[#026AA2]">
            {subtask.id.toUpperCase()}
          </span>
          <span className="text-[10px] text-[#98A2B3]">Subtask</span>
          <button
            className="icon-button ml-auto text-[#B42318]"
            title="删除 Subtask"
            onClick={() => {
              if (!window.confirm("确定删除这个 Subtask 吗？")) return
              const result = state.deleteSubtask(subtask.id)
              notify(result.message, result.ok ? "success" : "error")
            }}
          >
            <Trash2 size={13} />
          </button>
          <button className="icon-button" onClick={onClose} title="折叠详情栏">
            <X size={15} />
          </button>
        </div>
        <div className="mt-3">
          <InlineText
            value={subtask.title}
            className="text-base font-semibold text-[#172033]"
            onSave={(title) => save({ title })}
            multiline
          />
        </div>
        <div className="mt-2 flex items-center gap-2 text-[10px] font-medium text-[#6941C6]">
          <button className="flex items-center gap-1" onClick={() => state.selectObject("story", story.id)}>
            <ChevronLeft size={11} />{story.id.toUpperCase()}
          </button>
          <span className="text-[#D0D5DD]">/</span>
          <button onClick={() => state.selectObject("task", task.id)}>{task.title}</button>
        </div>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <section>
          <FieldLabel>进度与排期</FieldLabel>
          <div className="grid grid-cols-2 gap-2.5">
            <LabeledSelect
              label="状态"
              value={subtask.status}
              style={{
                background: TASK_STATUS_COLORS[subtask.status].bg,
                borderColor: TASK_STATUS_COLORS[subtask.status].border,
                color: TASK_STATUS_COLORS[subtask.status].color,
              }}
              options={[
                { value: "todo", label: "待办" },
                { value: "in_progress", label: "进行中" },
                { value: "review", label: "评审" },
                { value: "done", label: "完成" },
                { value: "blocked", label: "阻塞" },
              ]}
              onChange={(status) => {
                if (status === "blocked" && subtask.status !== "blocked") {
                  blockSectionRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  })
                  return notify("请在下方添加阻塞原因", "error")
                }
                save({ status: status as SubtaskEntity["status"] })
              }}
            />
            <LabeledSelect
              label="负责人"
              value={subtask.assigneeId}
              options={Object.values(state.members).map((member) => ({ value: member.id, label: member.name }))}
              onChange={(assigneeId) => save({ assigneeId })}
            />
            <LabeledInput label="开始日期" type="date" value={subtask.startDate} onSave={(startDate) => save({ startDate })} />
            <LabeledInput label="结束日期" type="date" value={subtask.endDate} onSave={(endDate) => save({ endDate })} />
            <LabeledInput label="预计工时" type="number" value={subtask.estimate} onSave={(estimate) => save({ estimate: Number(estimate) })} />
            <LabeledInput label="进度 %" type="number" value={subtask.progress} onSave={(progress) => save({ progress: Math.min(100, Math.max(0, Number(progress))) })} />
          </div>
        </section>
        <section>
          <FieldLabel>偏差 负载与质量</FieldLabel>
          <div className="mb-2 grid grid-cols-2 gap-2 text-[10px]"><div className="rounded-lg border border-[#E2E7EE] bg-[#F9FAFB] p-2">计划 {schedule.expectedProgress}% · 实际 {schedule.actualProgress}%<div className={schedule.variance < -10 ? "mt-1 text-[#B42318]" : "mt-1 text-[#067647]"}>偏差 {schedule.variance > 0 ? "+" : ""}{schedule.variance}%{schedule.overdue ? " · 已逾期" : ""}</div></div><div className="rounded-lg border border-[#E2E7EE] bg-[#F9FAFB] p-2">负载 {workload.plannedHours}/{workload.capacityHours}h<div className={workload.utilization > 100 || !capability.matched ? "mt-1 text-[#B42318]" : "mt-1 text-[#067647]"}>利用率 {workload.utilization}% · {capability.label}</div></div></div>
          <div className="grid grid-cols-2 gap-2"><LabeledSelect label="交付质量" value={subtask.qualityStatus} options={[{ value: "pending", label: "待检查" }, { value: "good", label: "良好" }, { value: "attention", label: "需关注" }]} onChange={(qualityStatus) => save({ qualityStatus: qualityStatus as SubtaskEntity["qualityStatus"] })} /><LabeledSelect label="阻塞等级" value={subtask.blockedSeverity} options={[{ value: "normal", label: "普通" }, { value: "severe", label: "严重" }]} onChange={(blockedSeverity) => save({ blockedSeverity: blockedSeverity as SubtaskEntity["blockedSeverity"] })} /></div>
          <textarea className="form-input mt-2 min-h-14 resize-y" value={subtask.qualityNote} placeholder="质量检查说明" onChange={(event) => save({ qualityNote: event.target.value })} />
          {inheritedRisks.map((risk) => <div key={risk.id} className="mt-2 rounded bg-[#FEF3F2] px-2 py-1.5 text-[10px] text-[#B42318]">继承自父任务：{risk.title} · {risk.level}</div>)}
        </section>
        <section ref={blockSectionRef}>
          <BlockReasonEditor
            entityType="subtask"
            entityId={subtask.id}
            reasons={subtask.blockReasons}
          />
        </section>
        <section>
          <ResultSubmissionPanel type="subtask" id={subtask.id} />
        </section>
        <section>
          <div className="flex items-center gap-2">
            <FieldLabel>关系管理</FieldLabel>
            <button className="secondary-button ml-auto" onClick={() => setRelationDepth(relationDepth ? 0 : 1)}>
              <Network size={13} />{relationDepth ? "收起关系" : "查看关系"}
            </button>
          </div>
          {relationDepth > 0 && <RelationPanel type="subtask" id={subtask.id} depth={relationDepth} onDepthChange={setRelationDepth} />}
        </section>
        <div className="grid grid-cols-2 gap-2">
          <button className="secondary-button" onClick={() => state.requestFocus("subtask", subtask.id, "story-map")}><LocateFixed size={13} />用户地图</button>
          <button className="secondary-button" onClick={() => state.requestFocus("subtask", subtask.id, "gantt")}><Calendar size={13} />甘特图</button>
        </div>
      </div>
    </>
  )
}

function BlockReasonEditor({
  entityType,
  entityId,
  reasons,
  excludedTaskId,
}: {
  entityType: "task" | "subtask"
  entityId: string
  reasons: BlockReasonEntity[]
  excludedTaskId?: string
}) {
  const state = useProjectStore()
  const [message, setMessage] = useState("")
  const [query, setQuery] = useState("")
  const [relatedTaskId, setRelatedTaskId] = useState<string | null>(null)
  const normalizedQuery = query.trim().toLowerCase()
  const suggestions = normalizedQuery
    ? Object.values(state.tasks)
        .filter((task) => task.id !== excludedTaskId)
        .filter((task) =>
          `${task.id} ${task.title}`.toLowerCase().includes(normalizedQuery),
        )
        .slice(0, 6)
    : []
  const relatedTask = relatedTaskId ? state.tasks[relatedTaskId] : null

  const addReason = () => {
    const result =
      entityType === "task"
        ? state.addTaskBlockReason(entityId, message, relatedTaskId)
        : state.addSubtaskBlockReason(entityId, message, relatedTaskId)
    notify(result.message, result.ok ? "success" : "error")
    if (!result.ok) return
    setMessage("")
    setQuery("")
    setRelatedTaskId(null)
  }

  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <FieldLabel>阻塞原因</FieldLabel>
        <span className="ml-auto rounded bg-[#FEF3F2] px-1.5 py-0.5 text-[9px] font-medium text-[#B42318]">
          {reasons.length} 项
        </span>
      </div>
      <div className="space-y-2">
        {reasons.map((reason) => {
          const task = reason.relatedTaskId
            ? state.tasks[reason.relatedTaskId]
            : null
          return (
            <div
              key={reason.id}
              className="rounded-lg border p-3"
              style={{
                borderColor:
                  reason.source === "dependency" ? "#FEDF89" : "#FECDCA",
                background:
                  reason.source === "dependency" ? "#FFFCF5" : "#FFF8F7",
              }}
            >
              <div className="flex items-start gap-2">
                <CircleAlert
                  size={13}
                  className={
                    reason.source === "dependency"
                      ? "mt-0.5 text-[#B54708]"
                      : "mt-0.5 text-[#D92D20]"
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-1.5">
                    <span
                      className="rounded px-1.5 py-0.5 text-[8px] font-semibold"
                      style={{
                        background:
                          reason.source === "dependency" ? "#FEF0C7" : "#FEE4E2",
                        color:
                          reason.source === "dependency" ? "#93370D" : "#B42318",
                      }}
                    >
                      {reason.source === "dependency" ? "依赖自动" : "手动"}
                    </span>
                    {reason.source === "dependency" && (
                      <span className="text-[8px] text-[#98A2B3]">
                        删除将同时取消 FS 依赖
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] leading-relaxed text-[#475467]">
                    {reason.message}
                  </p>
                  {task && (
                    <button
                      className="mt-2 flex max-w-full items-center gap-1 rounded border border-[#D9D6FE] bg-white px-2 py-1 text-[9px] font-medium text-[#5925DC] hover:bg-[#F9F5FF]"
                      title={`打开 ${task.id.toUpperCase()} ${task.title}`}
                      onClick={() => state.selectObject("task", task.id)}
                    >
                      <Link2 size={10} />
                      <span className="font-mono">{task.id.toUpperCase()}</span>
                      <span className="truncate">{task.title}</span>
                    </button>
                  )}
                </div>
                <button
                  className="icon-button h-6 w-6 text-[#B42318]"
                  title={
                    reason.source === "dependency"
                      ? "删除原因并取消前置依赖"
                      : "删除阻塞原因"
                  }
                  onClick={() => {
                    const result =
                      entityType === "task"
                        ? state.deleteTaskBlockReason(entityId, reason.id)
                        : state.deleteSubtaskBlockReason(entityId, reason.id)
                    notify(result.message, result.ok ? "success" : "error")
                  }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          )
        })}
        {!reasons.length && (
          <div className="rounded-lg border border-dashed border-[#D0D5DD] px-3 py-2.5 text-[10px] text-[#98A2B3]">
            当前没有阻塞原因。添加第一条后会自动进入阻塞状态。
          </div>
        )}
      </div>

      <div className="mt-3 rounded-lg border border-[#E2E7EE] bg-[#F9FAFB] p-3">
        <textarea
          className="form-input bg-white"
          rows={2}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="说明具体阻塞原因..."
        />
        <div className="relative mt-2">
          {relatedTask ? (
            <div className="flex items-center gap-2 rounded-md border border-[#D9D6FE] bg-white px-2 py-1.5 text-[10px] text-[#5925DC]">
              <Link2 size={11} />
              <span className="font-mono">{relatedTask.id.toUpperCase()}</span>
              <span className="min-w-0 flex-1 truncate">{relatedTask.title}</span>
              <button
                className="icon-button h-5 w-5"
                title="取消引用"
                onClick={() => {
                  setRelatedTaskId(null)
                  setQuery("")
                }}
              >
                <X size={10} />
              </button>
            </div>
          ) : (
            <input
              className="form-input bg-white"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setRelatedTaskId(null)
              }}
              placeholder="可选：输入任务编号或名称进行引用"
            />
          )}
          {!relatedTask && suggestions.length > 0 && (
            <div className="absolute inset-x-0 top-full z-40 mt-1 overflow-hidden rounded-md border border-[#E2E7EE] bg-white shadow-lg">
              {suggestions.map((task) => (
                <button
                  key={task.id}
                  className="flex w-full items-center gap-2 border-b border-[#F2F4F7] px-2.5 py-2 text-left last:border-0 hover:bg-[#F9FAFB]"
                  onClick={() => {
                    setRelatedTaskId(task.id)
                    setQuery(`${task.id.toUpperCase()} ${task.title}`)
                  }}
                >
                  <span className="font-mono text-[9px] font-semibold text-[#6941C6]">
                    {task.id.toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[10px] text-[#475467]">
                    {task.title}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className="primary-button mt-2 w-full"
          disabled={!message.trim()}
          onClick={addReason}
        >
          <Plus size={12} />
          添加阻塞原因
        </button>
      </div>
    </>
  )
}

type RelationNode = {
  key: string
  relation: string
  title: string
  meta: string
  targetType?: "story" | "task" | "subtask"
  targetId?: string
}

function RelationPanel({
  type,
  id,
  depth,
  onDepthChange,
}: {
  type: "story" | "task" | "subtask"
  id: string
  depth: 0 | 1 | 2
  onDepthChange: (depth: 0 | 1 | 2) => void
}) {
  const state = useProjectStore()
  const nodes: RelationNode[] = []
  let centerTitle = id
  const add = (node: RelationNode) => {
    if (!nodes.some((item) => item.key === node.key)) nodes.push(node)
  }

  if (type === "story") {
    const story = state.stories[id]
    if (!story) return null
    centerTitle = story.title
    if (story.epicId && state.epics[story.epicId]) add({ key: "epic-" + story.epicId, relation: "所属 Epic", title: state.epics[story.epicId].title, meta: story.epicId.toUpperCase() })
    add({ key: "owner-" + story.assigneeId, relation: "负责人", title: state.members[story.assigneeId]?.name ?? story.assigneeId, meta: "团队成员" })
    selectStoryTasks(state, story.id).forEach((task) => add({ key: "task-" + task.id, relation: "下属任务", title: task.title, meta: task.id.toUpperCase(), targetType: "task", targetId: task.id }))
    if (depth === 2) {
      selectStoryTasks(state, story.id).forEach((task) => {
        selectTaskSubtasks(state, task.id).forEach((item) => add({ key: "subtask-" + item.id, relation: "二跳 Subtask", title: item.title, meta: task.id.toUpperCase(), targetType: "subtask", targetId: item.id }))
        selectIncomingDependencies(state, task.id).forEach((dep) => { const related = state.tasks[dep.sourceTaskId]; if (related) add({ key: "blocked-" + related.id, relation: "Blocked by", title: related.title, meta: related.id.toUpperCase(), targetType: "task", targetId: related.id }) })
        selectOutgoingDependencies(state, task.id).forEach((dep) => { const related = state.tasks[dep.targetTaskId]; if (related) add({ key: "blocking-" + related.id, relation: "Blocking", title: related.title, meta: related.id.toUpperCase(), targetType: "task", targetId: related.id }) })
      })
    }
  } else {
    const task = type === "task" ? state.tasks[id] : state.tasks[state.subtasks[id]?.taskId]
    const subtask = type === "subtask" ? state.subtasks[id] : null
    if (!task) return null
    centerTitle = subtask?.title ?? task.title
    const story = state.stories[task.storyId]
    if (subtask) add({ key: "task-" + task.id, relation: "所属任务", title: task.title, meta: task.id.toUpperCase(), targetType: "task", targetId: task.id })
    if (story) add({ key: "story-" + story.id, relation: subtask ? "二跳 Story" : "所属 Story", title: story.title, meta: story.id.toUpperCase(), targetType: "story", targetId: story.id })
    add({ key: "owner-" + (subtask?.assigneeId ?? task.assigneeId), relation: "负责人", title: state.members[subtask?.assigneeId ?? task.assigneeId]?.name ?? "未分配", meta: "团队成员" })
    if (!subtask || depth === 2) selectTaskSubtasks(state, task.id).forEach((item) => { if (item.id !== subtask?.id) add({ key: "subtask-" + item.id, relation: subtask ? "Related" : "下属任务", title: item.title, meta: item.id.toUpperCase(), targetType: "subtask", targetId: item.id }) })
    if (!subtask || depth === 2) {
      selectIncomingDependencies(state, task.id).forEach((dep) => { const related = state.tasks[dep.sourceTaskId]; if (related) add({ key: "blocked-" + related.id, relation: "Blocked by", title: related.title, meta: related.id.toUpperCase(), targetType: "task", targetId: related.id }) })
      selectOutgoingDependencies(state, task.id).forEach((dep) => { const related = state.tasks[dep.targetTaskId]; if (related) add({ key: "blocking-" + related.id, relation: "Blocking", title: related.title, meta: related.id.toUpperCase(), targetType: "task", targetId: related.id }) })
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-[#E2E7EE] bg-[#FCFCFD] p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] text-[#667085]">当前节点的 {depth === 1 ? "一跳" : "两跳"}关系</span>
        <div className="flex rounded-md border border-[#E2E7EE] bg-white p-0.5">
          {[1, 2].map((value) => <button key={value} className="rounded px-2 py-1 text-[9px]" style={{ background: depth === value ? "#F4F3FF" : "transparent", color: depth === value ? "#5925DC" : "#667085" }} onClick={() => onDepthChange(value as 1 | 2)}>{value} 跳</button>)}
        </div>
      </div>
      <div className="mx-auto mb-3 max-w-52 rounded-md border-2 border-[#7F56D9] bg-white px-3 py-2 text-center shadow-sm">
        <div className="font-mono text-[9px] text-[#6941C6]">{id.toUpperCase()}</div>
        <div className="truncate text-xs font-semibold text-[#172033]">{centerTitle}</div>
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-dashed border-[#D0D5DD] pt-3">
        {nodes.map((node) => <button key={node.key} className="min-w-0 rounded-md border border-[#E2E7EE] bg-white p-2 text-left hover:border-[#C7D7FE]" disabled={!node.targetType} onClick={() => node.targetType && node.targetId && state.selectObject(node.targetType, node.targetId)}><div className="mb-1 text-[8px] font-semibold uppercase text-[#7F56D9]">{node.relation}</div><div className="truncate text-[10px] font-medium text-[#344054]">{node.title}</div><div className="truncate font-mono text-[8px] text-[#98A2B3]">{node.meta}</div></button>)}
      </div>
    </div>
  )
}

function CriterionRow({
  criterion,
  index,
  total,
}: {
  criterion: AcceptanceCriterion
  index: number
  total: number
}) {
  const state = useProjectStore()
  return (
    <div className="flex items-start gap-2">
      <button
        className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border"
        style={{
          background: criterion.satisfied
            ? TASK_STATUS_COLORS.done.accent
            : "white",
          borderColor: criterion.satisfied
            ? TASK_STATUS_COLORS.done.accent
            : "#D0D5DD",
        }}
        onClick={() =>
          state.updateAcceptanceCriterion(criterion.id, {
            satisfied: !criterion.satisfied,
          })
        }
      >
        {criterion.satisfied && <Check size={10} className="text-white" />}
      </button>
      <InlineText
        value={criterion.content}
        className="min-w-0 flex-1 text-xs leading-relaxed text-[#475467]"
        onSave={(content) =>
          state.updateAcceptanceCriterion(criterion.id, { content })
        }
        multiline
      />
      <button
        className="icon-button h-5 w-5"
        disabled={index === 0}
        onClick={() =>
          state.reorderAcceptanceCriterion(criterion.id, index - 1)
        }
      >
        <ArrowUp size={10} />
      </button>
      <button
        className="icon-button h-5 w-5"
        disabled={index === total - 1}
        onClick={() =>
          state.reorderAcceptanceCriterion(criterion.id, index + 1)
        }
      >
        <ArrowDown size={10} />
      </button>
      <button
        className="icon-button h-5 w-5 text-[#B42318]"
        onClick={() => state.deleteAcceptanceCriterion(criterion.id)}
      >
        <Trash2 size={10} />
      </button>
    </div>
  )
}

function StorySentence({
  label,
  value,
  onSave,
}: {
  label: string
  value: string
  onSave: (value: string) => void
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-10 flex-shrink-0 text-xs font-semibold text-[#6941C6]">
        {label}
      </span>
      <InlineText
        value={value}
        placeholder="点击补充..."
        className="flex-1 text-xs leading-relaxed text-[#475467]"
        onSave={onSave}
        multiline
      />
    </div>
  )
}
function InlineText({
  value,
  onSave,
  className = "",
  placeholder = "",
  multiline = false,
}: {
  value: string
  onSave: (value: string) => void
  className?: string
  placeholder?: string
  multiline?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  if (!editing)
    return (
      <button
        className={`block w-full text-left ${className}`}
        onClick={() => setEditing(true)}
      >
        {value || <span className="text-[#98A2B3]">{placeholder}</span>}
      </button>
    )
  const common = {
    value: draft,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => setDraft(event.target.value),
    onBlur: () => {
      setEditing(false)
      if (draft.trim() !== value) onSave(draft.trim())
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        setDraft(value)
        setEditing(false)
      }
      if (!multiline && event.key === "Enter")
        (event.currentTarget as HTMLElement).blur()
    },
    autoFocus: true,
    className: `form-input ${className}`,
  }
  return multiline ? (
    <textarea {...common} rows={Math.max(2, draft.split("\n").length)} />
  ) : (
    <input {...common} />
  )
}
function LabeledInput({
  label,
  value,
  type,
  onSave,
  disabled = false,
}: {
  label: string
  value: string | number
  type: string
  onSave: (value: string) => void
  disabled?: boolean
}) {
  return (
    <label>
      <span className="mb-1 block text-[9px] text-[#98A2B3]">{label}</span>
      <input
        className="form-input"
        type={type}
        defaultValue={value}
        key={`${label}-${value}`}
        disabled={disabled}
        onBlur={(event) =>
          event.target.value !== String(value) && onSave(event.target.value)
        }
      />
    </label>
  )
}
function LabeledSelect({
  label,
  value,
  options,
  onChange,
  style,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  style?: React.CSSProperties
}) {
  return (
    <label>
      <span className="mb-1 block text-[9px] text-[#98A2B3]">{label}</span>
      <select
        className="form-input"
        style={style}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
function StatusSelect({
  story,
  onChange,
}: {
  story: StoryEntity
  onChange: (patch: Partial<StoryEntity>) => void
}) {
  const status = TASK_STATUS_COLORS[storyDisplayStatus(story)]
  return (
    <select
      className="rounded-full border px-2 py-1 text-[10px] font-medium outline-none"
      style={{
        background: status.bg,
        borderColor: status.border,
        color: status.color,
      }}
      value={story.deliveryStatus}
      onChange={(event) =>
        onChange({
          deliveryStatus: event.target.value as StoryEntity["deliveryStatus"],
        })
      }
    >
      <option value="backlog">Backlog</option>
      <option value="planned">已规划</option>
      <option value="in_progress">进行中</option>
      <option value="pending_acceptance">待验收</option>
      <option value="accepted">已验收</option>
      <option value="returned">已退回</option>
    </select>
  )
}
function PrioritySelect({
  story,
  onChange,
}: {
  story: StoryEntity
  onChange: (patch: Partial<StoryEntity>) => void
}) {
  return (
    <select
      className="rounded-full border border-[#E2E7EE] bg-white px-2 py-1 text-[10px] text-[#475467] outline-none"
      value={story.priority}
      onChange={(event) =>
        onChange({ priority: event.target.value as StoryEntity["priority"] })
      }
    >
      <option value="critical">紧急</option>
      <option value="high">高优先级</option>
      <option value="medium">中优先级</option>
      <option value="low">低优先级</option>
    </select>
  )
}
function StoryDependencyList({ story }: { story: StoryEntity }) {
  const state = useProjectStore()
  const taskIds = new Set(story.taskIds)
  const deps = Object.values(state.dependencies).filter(
    (dep) => taskIds.has(dep.sourceTaskId) || taskIds.has(dep.targetTaskId),
  )
  return (
    <div className="space-y-1.5">
      {deps.map((dep) => (
        <div
          key={dep.id}
          className="flex items-center gap-2 rounded-lg border border-[#E2E7EE] px-2.5 py-2 text-[10px] text-[#475467]"
        >
          <Link2 size={11} className="text-[#7F56D9]" />
          <span className="font-mono">{dep.sourceTaskId}</span>
          <ArrowRight size={10} />
          <span className="font-mono">{dep.targetTaskId}</span>
          <span className="ml-auto rounded bg-[#F2F4F7] px-1 py-0.5 font-semibold">
            FS
          </span>
        </div>
      ))}
      {!deps.length && <p className="text-xs text-[#98A2B3]">暂无关联依赖</p>}
    </div>
  )
}
function DependencyRow({
  label,
  task,
  onDelete,
}: {
  label: string
  task?: TaskEntity
  onDelete: () => void
}) {
  if (!task) return null
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[#E2E7EE] px-2.5 py-2">
      <span className="w-16 text-[9px] text-[#98A2B3]">{label}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-[#475467]">
        {task.title}
      </span>
      <button className="icon-button h-5 w-5 text-[#B42318]" onClick={onDelete}>
        <Trash2 size={10} />
      </button>
    </div>
  )
}
