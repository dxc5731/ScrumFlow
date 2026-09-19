import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, GripVertical, Maximize2, Minimize2, Plus, Search, Sparkles } from "lucide-react";
import type { AcceptanceCriterion, EpicEntity, Member, Priority, RiskLevel, SprintEntity, StoryEntity, StoryMaturityStatus, StorySource } from "../../types";
import { useProjectStore } from "../../store/projectStore";
import type { ActionResult } from "../../store/projectStore";
import { selectBacklogStories, selectStories, selectStoryRiskLevel, storyReadyIssues } from "../../store/selectors";
import { MemberAvatar, notify } from "./ui";

const SOURCE_META: Record<StorySource, { label: string; bg: string; color: string }> = {
  ai: { label: "AI 建议", bg: "#F4F3FF", color: "#6941C6" },
  meeting: { label: "会议记录", bg: "#EFF8FF", color: "#175CD3" },
  manual: { label: "人工新增", bg: "#F2F4F7", color: "#475467" },
  review: { label: "Sprint Review", bg: "#FFFAEB", color: "#B54708" },
  retro: { label: "复盘", bg: "#FDF4FF", color: "#9E165F" },
};

const MATURITY_META: Record<StoryMaturityStatus, { label: string; bg: string; color: string }> = {
  candidate: { label: "候选", bg: "#F4F3FF", color: "#6941C6" },
  draft: { label: "草稿", bg: "#F2F4F7", color: "#475467" },
  ready: { label: "Ready", bg: "#ECFDF3", color: "#067647" },
};

function BacklogStoryCard({
  story, detailExpanded, canExpand, fullscreen, selected, acceptanceCriteria, epics, sprints,
  members, onToggleSelected, onToggleExpanded, onOpen, onUpdate, onSetMaturity, onReorder,
}: {
  story: StoryEntity
  detailExpanded: boolean
  canExpand: boolean
  fullscreen: boolean
  selected: boolean
  acceptanceCriteria: Record<string, AcceptanceCriterion>
  epics: Record<string, EpicEntity>
  sprints: Record<string, SprintEntity>
  members: Record<string, Member>
  onToggleSelected: () => void
  onToggleExpanded: () => void
  onOpen: () => void
  onUpdate: (patch: Partial<StoryEntity>) => ActionResult
  onSetMaturity: (maturity: StoryMaturityStatus) => ActionResult
  onReorder: (draggedId: string) => ActionResult
}) {
  const [title, setTitle] = useState(story.title)
  useEffect(() => setTitle(story.title), [story.title])
  const sourceMeta = SOURCE_META[story.source]
  const maturityMeta = MATURITY_META[story.maturityStatus]
  const criteria = Object.values(acceptanceCriteria)
    .filter((item) => item.storyId === story.id)
    .sort((a, b) => a.order - b.order)
  const criteriaDone = criteria.filter((item) => item.satisfied).length
  const issues = storyReadyIssues(story)
  const effectiveRisk = selectStoryRiskLevel(useProjectStore.getState(), story.id)
  const stop = (event: React.SyntheticEvent) => event.stopPropagation()
  const update = (patch: Partial<StoryEntity>) => {
    const result = onUpdate(patch)
    if (!result.ok) notify(result.message, "error")
  }
  const commitTitle = () => {
    const next = title.trim()
    if (!next) {
      setTitle(story.title)
      notify("Story 名称不能为空", "error")
      return
    }
    if (next === story.title) return
    const result = onUpdate({ title: next })
    if (!result.ok) {
      setTitle(story.title)
      notify(result.message, "error")
    }
  }

  return (
    <article
      draggable
      onDragStart={(event) => {
        if ((event.target as HTMLElement).closest("input,select,textarea,button")) {
          event.preventDefault()
          return
        }
        writeDragPayload(event, { type: "story", id: story.id })
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.stopPropagation()
        const payload = readDragPayload(event)
        if (payload?.type !== "story") return notify("Backlog 只接受 Story", "error")
        const result = onReorder(payload.id)
        notify(result.message, result.ok ? "success" : result.message.includes("仅供查看") ? "info" : "error", result.ok)
      }}
      className="group w-full rounded-lg border bg-white p-2.5 shadow-[0_1px_2px_rgba(16,24,40,.03)] transition-[border-color,box-shadow] duration-150 hover:border-[#C7D7FE] hover:shadow-sm"
      style={{
        borderColor: selected ? "#7F56D9" : "#E2E7EE",
        gridColumn: detailExpanded ? "span 2" : "span 1",
        opacity: story.sprintId ? .88 : 1,
      }}
      onClick={onOpen}
    >
      <div className="flex items-center gap-2">
        <input type="checkbox" disabled={Boolean(story.sprintId)} checked={selected} onClick={stop} onChange={onToggleSelected} />
        <span className="font-mono text-[9px] text-[#98A2B3]">{story.id.toUpperCase()}</span>
        {story.sprintId && <span className="max-w-24 truncate rounded bg-[#EFF8FF] px-1 py-0.5 text-[8px] font-medium text-[#175CD3]">{sprints[story.sprintId]?.name}</span>}
        <span className="ml-auto font-mono text-[10px] font-semibold text-[#5B5CE2]">{story.storyPoints}pt</span>
        {canExpand && <button type="button" className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[#667085] hover:bg-[#F2F4F7] hover:text-[#344054]" title={detailExpanded ? "收起卡片详情" : "展开卡片详情"} aria-label={detailExpanded ? "收起卡片详情" : "展开卡片详情"} onClick={(event) => { event.stopPropagation(); onToggleExpanded() }}>{detailExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</button>}
      </div>

      {detailExpanded && fullscreen ? <input
        draggable={false}
        className="my-1.5 w-full rounded border border-transparent bg-transparent px-1 py-1 text-xs font-semibold leading-snug text-[#172033] outline-none hover:border-[#D0D5DD] focus:border-[#84ADFF] focus:bg-white"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onClick={stop}
        onBlur={commitTitle}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur()
          if (event.key === "Escape") {
            setTitle(story.title)
            event.currentTarget.blur()
          }
        }}
        aria-label="Story 名称"
      /> : <p className="my-1.5 text-xs font-semibold leading-snug text-[#172033]">{story.title}</p>}

      <div className="flex flex-wrap items-center gap-1">
        <span className="rounded px-1.5 py-0.5 text-[9px] font-medium" style={{ background: sourceMeta.bg, color: sourceMeta.color }}>{sourceMeta.label}</span>
        <span className="rounded px-1.5 py-0.5 text-[9px] font-medium" style={{ background: maturityMeta.bg, color: maturityMeta.color }}>{maturityMeta.label}</span>
        {effectiveRisk !== "none" && <span className="rounded bg-[#FFFAEB] px-1.5 py-0.5 text-[9px] font-medium text-[#B54708]">风险 {effectiveRisk === "high" ? "高" : effectiveRisk === "medium" ? "中" : "低"}</span>}
        <MemberAvatar memberId={story.assigneeId} size={18} />
      </div>

      {detailExpanded && fullscreen && <div className="mt-2 grid grid-cols-2 gap-1.5 border-t border-[#F2F4F7] pt-2" onClick={stop} onDragStart={stop}>
        <label className="text-[8px] text-[#667085]">负责人<select className="mt-0.5 w-full rounded border border-[#D0D5DD] bg-white px-1.5 py-1 text-[9px] text-[#344054] outline-none focus:border-[#84ADFF]" value={story.assigneeId} onChange={(event) => update({ assigneeId: event.target.value })}>{Object.values(members).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        <label className="text-[8px] text-[#667085]">优先级<select className="mt-0.5 w-full rounded border border-[#D0D5DD] bg-white px-1.5 py-1 text-[9px] text-[#344054] outline-none focus:border-[#84ADFF]" value={story.priority} onChange={(event) => update({ priority: event.target.value as Priority })}><option value="critical">紧急</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label>
        <label className="text-[8px] text-[#667085]">Story Points<select className="mt-0.5 w-full rounded border border-[#D0D5DD] bg-white px-1.5 py-1 text-[9px] text-[#344054] outline-none focus:border-[#84ADFF]" value={story.storyPoints} onChange={(event) => update({ storyPoints: Number(event.target.value) })}>{[1, 2, 3, 5, 8, 13, 21].map((value) => <option key={value} value={value}>{value} pt</option>)}</select></label>
        <label className="text-[8px] text-[#667085]">业务价值<select className="mt-0.5 w-full rounded border border-[#D0D5DD] bg-white px-1.5 py-1 text-[9px] text-[#344054] outline-none focus:border-[#84ADFF]" value={story.businessValue} onChange={(event) => update({ businessValue: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></label>
        <label className="text-[8px] text-[#667085]">成熟度<select disabled={Boolean(story.sprintId)} title={story.sprintId ? "Sprint 中的 Story 保持 Ready" : undefined} className="mt-0.5 w-full rounded border border-[#D0D5DD] bg-white px-1.5 py-1 text-[9px] text-[#344054] outline-none focus:border-[#84ADFF] disabled:bg-[#F2F4F7] disabled:text-[#98A2B3]" value={story.maturityStatus} onChange={(event) => { const result = onSetMaturity(event.target.value as StoryMaturityStatus); if (!result.ok) notify(result.message, "error") }}><option value="candidate">候选</option><option value="draft">草稿</option><option value="ready">Ready</option></select></label>
        <label className="text-[8px] text-[#667085]">Epic<select className="mt-0.5 w-full rounded border border-[#D0D5DD] bg-white px-1.5 py-1 text-[9px] text-[#344054] outline-none focus:border-[#84ADFF]" value={story.epicId ?? ""} onChange={(event) => update({ epicId: event.target.value || null })}><option value="">未分配</option>{Object.values(epics).map((epic) => <option key={epic.id} value={epic.id}>{epic.title}</option>)}</select></label>
      </div>}

      {detailExpanded && <div className="mt-2 space-y-2 border-t border-[#F2F4F7] pt-2 text-[9px] text-[#667085]">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1"><span>Epic：{story.epicId ? epics[story.epicId]?.title : "未分配"}</span><span>业务价值：{story.businessValue}/5</span><span>优先级：{story.priority}</span><span>Sprint：{story.sprintId ? sprints[story.sprintId]?.name : "未进入 Sprint"}</span></div>
        <div className="rounded border border-[#EAECF0] bg-[#F9FAFB] p-2 leading-relaxed"><div>作为：{story.as || "未填写"}</div><div>我希望：{story.iWant || "未填写"}</div><div>从而：{story.soThat || "未填写"}</div></div>
        {fullscreen ? <div className="flex items-center gap-3"><span className="min-w-0 flex-1 truncate" title={story.expectedBenefit}><b className="text-[#475467]">收益：</b>{story.expectedBenefit || "未填写"}</span><span className="flex-shrink-0"><b className="text-[#475467]">验收：</b>{criteriaDone}/{criteria.length}</span></div> : <>
          <div><b className="text-[#475467]">预期收益：</b>{story.expectedBenefit || "未填写"}</div>
          <div><b className="text-[#475467]">风险详情：</b>{effectiveRisk === "none" ? "无" : `${effectiveRisk} · ${story.riskNote || "请在风险登记册查看完整说明"}`}</div>
          <div><b className="text-[#475467]">验收标准 {criteriaDone}/{criteria.length}：</b>{criteria.length ? <ul className="mt-1 space-y-1">{criteria.map((item) => <li key={item.id} className="flex gap-1"><span>{item.satisfied ? "✓" : "○"}</span><span>{item.content}</span></li>)}</ul> : "未填写"}</div>
        </>}
      </div>}
      {story.maturityStatus !== "ready" && <button className="mt-2 flex items-center gap-1 text-[10px] font-medium text-[#6941C6]" onClick={(event) => { event.stopPropagation(); const result = onSetMaturity("ready"); notify(result.ok ? "Story 已标记 Ready" : `${result.message}（缺少：${issues.join("、")}）`, result.ok ? "success" : "error") }}>{issues.length ? <Sparkles size={11} /> : <Check size={11} />}标记 Ready</button>}
    </article>
  )
}

export default function BacklogPanel() {
  const stories = useProjectStore((state) => state.stories);
  const epics = useProjectStore((state) => state.epics);
  const sprints = useProjectStore((state) => state.sprints);
  const acceptanceCriteria = useProjectStore((state) => state.acceptanceCriteria);
  const members = useProjectStore((state) => state.members);
  const workspace = useProjectStore((state) => state.workspace);
  const setWorkspace = useProjectStore((state) => state.setWorkspace);
  const createStory = useProjectStore((state) => state.createStory);
  const moveStory = useProjectStore((state) => state.moveStory);
  const reorderBacklog = useProjectStore((state) => state.reorderBacklog);
  const setStoryMaturity = useProjectStore((state) => state.setStoryMaturity);
  const updateStory = useProjectStore((state) => state.updateStory);
  const selectObject = useProjectStore((state) => state.selectObject);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<StorySource | "all">("all");
  const [maturity, setMaturity] = useState<StoryMaturityStatus | "all">("all");
  const [sortBy, setSortBy] = useState<"order" | "priority" | "value" | "points" | "title">("order");
  const [epicFilter, setEpicFilter] = useState("all");
  const [sprintFilter, setSprintFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState<RiskLevel | "all">("all");
  const [groupBy, setGroupBy] = useState<"none" | "epic" | "maturity" | "source" | "sprint">("none");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedStoryIds, setExpandedStoryIds] = useState<string[]>([]);
  const [bulkSprint, setBulkSprint] = useState(workspace.selectedSprintId);
  const [creating, setCreating] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [draft, setDraft] = useState({ title: "", epicId: "", description: "" });
  const asideRef = useRef<HTMLElement | null>(null);
  const resizeRef = useRef<{ startX: number; width: number; parentWidth: number } | null>(null);
  const fullscreen = workspace.backlogFullscreen;
  const widePanel = workspace.backlogWidth >= 360 || fullscreen;
  const canExpandCards = workspace.backlogWidth >= 526 || fullscreen;

  useEffect(() => {
    if (!canExpandCards) setExpandedStoryIds([])
  }, [canExpandCards])

  const backlog = useMemo(() => {
    const priorityRank = { critical: 4, high: 3, medium: 2, low: 1 };
    const sourceStories = widePanel ? selectStories(useProjectStore.getState()) : selectBacklogStories(useProjectStore.getState());
    return sourceStories.filter((story) => {
      if (search && !`${story.id} ${story.title}`.toLowerCase().includes(search.toLowerCase())) return false;
      if (source !== "all" && story.source !== source) return false;
      if (maturity !== "all" && story.maturityStatus !== maturity) return false;
      if (fullscreen && epicFilter !== "all" && (story.epicId ?? "none") !== epicFilter) return false;
      if (fullscreen && sprintFilter !== "all" && (story.sprintId ?? "backlog") !== sprintFilter) return false;
      if (fullscreen && assigneeFilter !== "all" && story.assigneeId !== assigneeFilter) return false;
      if (fullscreen && riskFilter !== "all" && selectStoryRiskLevel(useProjectStore.getState(), story.id) !== riskFilter) return false;
      return true;
    }).sort((a, b) => sortBy === "priority" ? priorityRank[b.priority] - priorityRank[a.priority] : sortBy === "value" ? b.businessValue - a.businessValue : sortBy === "points" ? b.storyPoints - a.storyPoints : sortBy === "title" ? a.title.localeCompare(b.title, "zh-CN") : a.order - b.order);
  }, [stories, search, source, maturity, sortBy, widePanel, fullscreen, epicFilter, sprintFilter, assigneeFilter, riskFilter]);

  const backlogGroups = useMemo(() => {
    if (!fullscreen || groupBy === "none") return [{ key: "all", label: "全部 Story", stories: backlog }];
    const groups = new Map<string, StoryEntity[]>();
    backlog.forEach((story) => {
      const key = groupBy === "epic" ? story.epicId ?? "none" : groupBy === "maturity" ? story.maturityStatus : groupBy === "source" ? story.source : story.sprintId ?? "backlog";
      groups.set(key, [...(groups.get(key) ?? []), story]);
    });
    return [...groups.entries()].map(([key, groupStories]) => ({
      key,
      label: groupBy === "epic" ? epics[key]?.title ?? "未分配 Epic" : groupBy === "maturity" ? MATURITY_META[key as StoryMaturityStatus].label : groupBy === "source" ? SOURCE_META[key as StorySource].label : key === "backlog" ? "Product Backlog" : sprints[key]?.name ?? "未知 Sprint",
      stories: groupStories,
    }));
  }, [backlog, fullscreen, groupBy, epics, sprints]);

  const startResize = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const width = asideRef.current?.getBoundingClientRect().width ?? workspace.backlogWidth;
    const parentWidth = asideRef.current?.parentElement?.getBoundingClientRect().width ?? window.innerWidth;
    resizeRef.current = { startX: event.clientX, width, parentWidth };
    setIsResizing(true)
  };

  const resize = (event: React.PointerEvent) => {
    if (!resizeRef.current) return;
    const nextWidth = Math.min(resizeRef.current.parentWidth, Math.max(272, resizeRef.current.width + event.clientX - resizeRef.current.startX));
    const nextFullscreen = nextWidth > resizeRef.current.parentWidth * .8;
    if (nextFullscreen && !fullscreen) {
      const parentWidth = resizeRef.current.parentWidth
      resizeRef.current = null
      setIsResizing(false)
      event.currentTarget.releasePointerCapture(event.pointerId)
      setWorkspace({
        backlogWidth: Math.round(nextWidth),
        backlogFullscreen: false,
      })
      window.requestAnimationFrame(() => setWorkspace({
        backlogWidth: Math.round(parentWidth),
        backlogFullscreen: true,
      }))
      return
    }
    setWorkspace({
      backlogWidth: Math.round(nextWidth),
      backlogFullscreen: fullscreen && nextFullscreen,
    });
  };

  const finishResize = () => {
    resizeRef.current = null
    setIsResizing(false)
  }

  const toggleFullscreen = () => {
    if (!fullscreen) {
      setWorkspace({ backlogFullscreen: true })
      return
    }
    const parentWidth = asideRef.current?.parentElement?.getBoundingClientRect().width ?? window.innerWidth
    setWorkspace({
      backlogFullscreen: false,
      backlogWidth: Math.round(Math.min(620, Math.max(360, parentWidth * .46))),
    })
  };

  const createManualStory = () => {
    if (!draft.title.trim() || !draft.epicId || !draft.description.trim()) {
      notify("名称、Epic 和简要描述为必填项", "error");
      return;
    }
    const story = createStory({
      title: draft.title,
      epicId: draft.epicId,
      iWant: draft.description,
      source: "manual",
      maturityStatus: "draft",
    });
    setDraft({ title: "", epicId: "", description: "" });
    setCreating(false);
    selectObject("story", story.id);
    notify("Story 草稿已创建，请在 Inspector 中补全三段式描述");
  };

  const bulkAdd = () => {
    let success = 0;
    let failed = 0;
    selectedIds.forEach((id) => {
      const story = stories[id];
      const result = story ? moveStory(id, story.epicId, bulkSprint) : { ok: false };
      result.ok ? success++ : failed++;
    });
    setSelectedIds([]);
    notify(`${success} 个 Story 已加入 Sprint${failed ? `，${failed} 个因未 Ready 被跳过` : ""}`, failed ? "info" : "success");
  };

  if (workspace.backlogCollapsed) {
    return (
      <button className="flex w-11 flex-shrink-0 flex-col items-center gap-3 border-r border-[#E2E7EE] bg-[#FCFCFD] py-4 text-[#667085] hover:bg-[#F9FAFB]" onClick={() => setWorkspace({ backlogCollapsed: false, backlogFullscreen: false })} title="展开 Product Backlog">
        <ChevronRight size={15} /><span className="text-[11px] font-semibold [writing-mode:vertical-rl]">Product Backlog</span><span className="rounded-full bg-[#ECFDF3] px-1.5 font-mono text-[10px] text-[#067647]">{backlog.length}</span>
      </button>
    );
  }

  return (
    <aside ref={asideRef} className={`relative flex max-w-full flex-shrink-0 flex-col border-r border-[#E2E7EE] bg-[#FCFCFD] ${isResizing ? "" : "transition-[width] duration-300 ease-[cubic-bezier(.22,1,.36,1)]"}`} style={{ width: fullscreen ? "100%" : workspace.backlogWidth }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        const payload = readDragPayload(event);
        if (payload?.type === "story") {
          const story = stories[payload.id];
          if (story) {
            const result = moveStory(story.id, story.epicId, null);
            notify(result.message, result.ok ? "success" : "error", result.ok);
          }
        }
      }}>
      <div className="flex h-11 items-center gap-2 border-b border-[#E2E7EE] px-3">
        <GripVertical size={14} className="text-[#98A2B3]" /><span className="text-xs font-semibold text-[#172033]">Product Backlog</span><span className="rounded-full border border-[#ABEFC6] bg-[#ECFDF3] px-1.5 font-mono text-[10px] text-[#067647]">{backlog.length}</span>
        <button className="icon-button ml-auto" onClick={toggleFullscreen} title={fullscreen ? "退出全屏 Backlog" : "全屏 Backlog"}>{fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
        <button className="icon-button" onClick={() => setWorkspace({ backlogCollapsed: true, backlogFullscreen: false })} title="折叠"><ChevronLeft size={14} /></button>
      </div>

      <div className="space-y-2 border-b border-[#F2F4F7] p-3">
        <div className="flex items-center gap-2 rounded-lg bg-[#F2F4F7] px-2.5"><Search size={13} className="text-[#98A2B3]" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none" placeholder="搜索 Story..." /></div>
        <div className="grid grid-cols-3 gap-1.5">
          <select value={source} onChange={(event) => setSource(event.target.value as StorySource | "all")} className="filter-select"><option value="all">全部来源</option>{Object.entries(SOURCE_META).map(([id, meta]) => <option key={id} value={id}>{meta.label}</option>)}</select>
          <select value={maturity} onChange={(event) => setMaturity(event.target.value as StoryMaturityStatus | "all")} className="filter-select"><option value="all">全部成熟度</option><option value="candidate">候选</option><option value="draft">草稿</option><option value="ready">Ready</option></select>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)} className="filter-select"><option value="order">手动排序</option><option value="priority">优先级</option><option value="value">业务价值</option><option value="points">Story Points</option><option value="title">名称</option></select>
        </div>
        {fullscreen && <div className="grid grid-cols-2 gap-1.5 md:grid-cols-5">
          <select value={epicFilter} onChange={(event) => setEpicFilter(event.target.value)} className="filter-select"><option value="all">全部 Epic</option><option value="none">未分配 Epic</option>{Object.values(epics).map((epic) => <option key={epic.id} value={epic.id}>{epic.title}</option>)}</select>
          <select value={sprintFilter} onChange={(event) => setSprintFilter(event.target.value)} className="filter-select"><option value="all">全部 Sprint</option><option value="backlog">未进入 Sprint</option>{Object.values(sprints).map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name}</option>)}</select>
          <select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)} className="filter-select"><option value="all">全部负责人</option>{Object.values(members).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>
          <select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value as typeof riskFilter)} className="filter-select"><option value="all">全部风险</option><option value="high">高风险</option><option value="medium">中风险</option><option value="low">低风险</option><option value="none">无风险</option></select>
          <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as typeof groupBy)} className="filter-select"><option value="none">不分组</option><option value="epic">按 Epic</option><option value="maturity">按成熟度</option><option value="source">按来源</option><option value="sprint">按 Sprint</option></select>
        </div>}
      </div>

      {selectedIds.length > 0 && <div className="flex items-center gap-2 border-b border-[#D9D6FE] bg-[#F4F3FF] px-3 py-2"><span className="text-[10px] font-semibold text-[#5925DC]">已选 {selectedIds.length}</span><select value={bulkSprint} onChange={(event) => setBulkSprint(event.target.value)} className="ml-auto rounded border border-[#D9D6FE] bg-white px-1.5 py-1 text-[10px] outline-none">{Object.values(sprints).map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name}</option>)}</select><button className="rounded bg-[#5B5CE2] px-2 py-1 text-[10px] font-semibold text-white" onClick={bulkAdd}>批量加入</button></div>}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {backlogGroups.map((group) => <section key={group.key} className="mb-4 last:mb-0">
          {fullscreen && groupBy !== "none" && <div className="mb-2 flex items-center gap-2 border-b border-[#E2E7EE] pb-2"><h3 className="text-[11px] font-semibold text-[#344054]">{group.label}</h3><span className="rounded-full bg-[#F2F4F7] px-1.5 py-0.5 font-mono text-[9px] text-[#667085]">{group.stories.length}</span></div>}
          <div className="grid items-start gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, 246px)", gridAutoFlow: "dense" }}>
            {group.stories.map((story) => <BacklogStoryCard
              key={story.id}
              story={story}
              detailExpanded={canExpandCards && expandedStoryIds.includes(story.id)}
              canExpand={canExpandCards}
              fullscreen={fullscreen}
              selected={selectedIds.includes(story.id)}
              acceptanceCriteria={acceptanceCriteria}
              epics={epics}
              sprints={sprints}
              members={members}
              onToggleSelected={() => setSelectedIds((ids) => ids.includes(story.id) ? ids.filter((id) => id !== story.id) : [...ids, story.id])}
              onToggleExpanded={() => setExpandedStoryIds((ids) => ids.includes(story.id) ? ids.filter((id) => id !== story.id) : [...ids, story.id])}
              onOpen={() => selectObject("story", story.id)}
              onUpdate={(patch) => updateStory(story.id, patch)}
              onSetMaturity={(maturityStatus) => setStoryMaturity(story.id, maturityStatus)}
              onReorder={(draggedId) => {
                if (story.sprintId) return { ok: false, message: "已加入 Sprint 的 Story 仅供查看" };
                const targetIndex = selectBacklogStories(useProjectStore.getState()).findIndex((item) => item.id === story.id);
                return reorderBacklog(draggedId, targetIndex);
              }}
            />)}
          </div>
        </section>)}
        {!backlog.length && <div className="rounded-lg border border-dashed border-[#D0D5DD] py-10 text-center text-xs text-[#98A2B3]">当前筛选下没有 Backlog Story</div>}
      </div>

      {creating && <div className="space-y-2 border-t border-[#E2E7EE] bg-white p-3"><input autoFocus className="form-input" placeholder="Story 名称" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /><select className="form-input" value={draft.epicId} onChange={(event) => setDraft({ ...draft, epicId: event.target.value })}><option value="">选择 Epic</option>{Object.values(epics).map((epic) => <option key={epic.id} value={epic.id}>{epic.title}</option>)}</select><textarea className="form-input min-h-14 resize-none" placeholder="简要描述" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /><div className="flex gap-2"><button className="primary-button flex-1" onClick={createManualStory}>创建草稿</button><button className="secondary-button" onClick={() => setCreating(false)}>取消</button></div></div>}
      {!creating && <div className="border-t border-[#E2E7EE] p-3"><button className="primary-button w-full" onClick={() => setCreating(true)}><Plus size={13} />手动新增 Story</button></div>}

      <div className="absolute bottom-0 right-0 top-0 w-1 cursor-col-resize hover:bg-[#C7D7FE]" onPointerDown={startResize} onPointerMove={resize} onPointerUp={finishResize} onPointerCancel={finishResize} />
    </aside>
  );
}

export function writeDragPayload(event: React.DragEvent, payload: { type: "story" | "task" | "activity" | "userTask" | "epic" | "subtask"; id: string }) {
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-scrumflow", JSON.stringify(payload));
}

export function readDragPayload(event: React.DragEvent): { type: string; id: string } | null {
  try { return JSON.parse(event.dataTransfer.getData("application/x-scrumflow")); } catch { return null; }
}
