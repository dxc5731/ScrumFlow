import { beforeEach, describe, expect, it } from "vitest";
import { planHierarchySchedule, resetProjectStoreForTests, useProjectStore } from "../store/projectStore";
import { parseUmlSource } from "../utils/uml";
import {
  selectBacklogStories,
  selectSprintAssets,
  selectSprintStories,
  selectSprintSubtasks,
  selectSprintTasks,
  selectAcceptanceBuckets,
  selectProjectCompletion,
  selectStoryExecutionLeaves,
  selectStoryAssets,
  selectStoryCriteria,
  selectStoryProgress,
  selectStorySummaryDates,
  selectStoryTasks,
  selectTaskAssets,
  selectDiscussions,
  selectDailyActualWorkloadHeatmap,
  selectDailyWorkloadHeatmap,
  selectImpacts,
  selectRisks,
  selectScheduleHealth,
  selectSprintAnalytics,
  selectTeamWorkloads,
} from "../store/selectors";

describe("course-stage project data chain", () => {
  beforeEach(() => resetProjectStoreForTests());

  it("updates one Story entity and exposes the same value to every selector", () => {
    const result = useProjectStore.getState().updateStory("us024", { title: "统一数据链路 Story" });
    expect(result.ok).toBe(true);
    expect(useProjectStore.getState().stories.us024.title).toBe("统一数据链路 Story");
    expect(useProjectStore.getState().history.at(-1)?.objectId).toBe("us024");
  });

  it("keeps one Story id from backlog to Sprint and rejects unfinished drafts", () => {
    const store = useProjectStore.getState();
    const beforeCount = Object.keys(store.stories).length;
    const moved = store.moveStory("cand-003", "ep9", "s2");
    expect(moved.ok).toBe(true);
    expect(useProjectStore.getState().stories["cand-003"].sprintId).toBe("s2");
    expect(Object.keys(useProjectStore.getState().stories)).toHaveLength(beforeCount);

    const rejected = useProjectStore.getState().moveStory("cand-002", "ep5", "s2");
    expect(rejected.ok).toBe(false);
    expect(useProjectStore.getState().stories["cand-002"].sprintId).toBeNull();
  });

  it("moves one Backlog Story into all Sprint projections without duplicating its id", () => {
    const before = useProjectStore.getState();
    expect(selectBacklogStories(before).some((story) => story.id === "cand-003")).toBe(true);
    expect(before.moveStory("cand-003", "ep9", "s2").ok).toBe(true);

    const after = useProjectStore.getState();
    expect(selectBacklogStories(after).some((story) => story.id === "cand-003")).toBe(false);
    expect(selectSprintStories(after, "s2").some((story) => story.id === "cand-003")).toBe(true);
    expect(Object.values(after.stories).filter((story) => story.id === "cand-003")).toHaveLength(1);
  });

  it("reorders the unified Product Backlog without creating a second copy", () => {
    const beforeCount = Object.keys(useProjectStore.getState().stories).length;
    const result = useProjectStore.getState().reorderBacklog("cand-004", 0);
    expect(result.ok).toBe(true);
    expect(useProjectStore.getState().stories["cand-004"].order).toBe(0);
    expect(Object.keys(useProjectStore.getState().stories)).toHaveLength(beforeCount);
  });

  it("creates, edits, reparents and deletes every user-map hierarchy level", () => {
    const store = useProjectStore.getState();
    const activityA = store.createActivity({ title: "课程分析", domain: "planning" });
    const activityB = store.createActivity({ title: "课程交付", domain: "delivery" });
    const userTaskA = store.createUserTask(activityA.id, { title: "整理场景" });
    const userTaskB = store.createUserTask(activityB.id, { title: "验证成果" });
    const epic = store.createEpic(userTaskA.id, { title: "场景建模" });

    expect(store.updateActivity(activityA.id, { title: "需求分析", domain: "design" }).ok).toBe(true);
    expect(store.updateUserTask(userTaskA.id, { title: "梳理场景", activityId: activityB.id }).ok).toBe(true);
    expect(store.updateEpic(epic.id, { title: "成果建模", userTaskId: userTaskB.id }).ok).toBe(true);

    let state = useProjectStore.getState();
    expect(state.activities[activityA.id]).toMatchObject({ title: "需求分析", domain: "design" });
    expect(state.userTasks[userTaskA.id]).toMatchObject({ title: "梳理场景", activityId: activityB.id });
    expect(state.epics[epic.id]).toMatchObject({ title: "成果建模", userTaskId: userTaskB.id });

    expect(state.deleteEpic(epic.id).ok).toBe(true);
    expect(useProjectStore.getState().epics[epic.id]).toBeUndefined();
    expect(useProjectStore.getState().deleteUserTask(userTaskA.id).ok).toBe(true);
    expect(useProjectStore.getState().userTasks[userTaskA.id]).toBeUndefined();
    expect(useProjectStore.getState().deleteActivity(activityA.id).ok).toBe(true);
    state = useProjectStore.getState();
    expect(state.activities[activityA.id]).toBeUndefined();
    expect(state.activities[activityB.id]).toBeDefined();
  });

  it("cascades hierarchy deletion through stories, execution data and references", () => {
    const store = useProjectStore.getState();
    const activity = store.createActivity({ title: "临时课程链路", domain: "quality" });
    const userTask = store.createUserTask(activity.id, { title: "临时用户任务" });
    const epic = store.createEpic(userTask.id, { title: "临时 Epic" });
    const story = store.createStory({ title: "临时 Story", source: "manual", epicId: epic.id });
    const task = store.createTask(story.id, { title: "临时工程任务" });
    const subtask = store.addSubtask(task.id, "临时 Subtask");
    const criterion = store.addAcceptanceCriterion(story.id, "临时验收标准");
    store.addDiscussion("story", story.id, "临时讨论记录");
    const targetId = "be-025-1";
    const targetStatus = useProjectStore.getState().tasks[targetId].status;
    expect(store.addDependency(task.id, targetId).ok).toBe(true);
    expect(useProjectStore.getState().tasks[targetId].status).toBe("blocked");
    const asset = store.createAsset({
      name: "临时关联资产",
      kind: "activity",
      links: [
        { targetType: "epic", targetId: epic.id },
        { targetType: "story", targetId: story.id },
        { targetType: "task", targetId: task.id },
      ],
    });
    const risk = store.createRisk({
      title: "临时子树风险",
      targetType: "task",
      targetId: task.id,
      level: "medium",
      description: "临时风险",
      impact: "临时影响",
      mitigation: "删除子树时清理",
      ownerId: "m1",
      status: "open",
    });

    expect(store.deleteActivity(activity.id).ok).toBe(true);
    const after = useProjectStore.getState();
    expect(after.activities[activity.id]).toBeUndefined();
    expect(after.userTasks[userTask.id]).toBeUndefined();
    expect(after.epics[epic.id]).toBeUndefined();
    expect(after.stories[story.id]).toBeUndefined();
    expect(after.tasks[task.id]).toBeUndefined();
    expect(after.subtasks[subtask.id]).toBeUndefined();
    expect(after.acceptanceCriteria[criterion.id]).toBeUndefined();
    expect(Object.values(after.discussions).some((item) => item.storyId === story.id)).toBe(false);
    expect(Object.values(after.dependencies).some((item) => item.sourceTaskId === task.id || item.targetTaskId === task.id)).toBe(false);
    expect(after.tasks[targetId].status).toBe(targetStatus);
    expect(after.assets[asset.id].links).toHaveLength(0);
    expect(after.risks[risk.id]).toBeUndefined();
  });

  it("updates Epic ownership and Sprint ownership in one move action", () => {
    const result = useProjectStore.getState().moveStory("us024", "ep5", "s3");
    expect(result.ok).toBe(true);
    const state = useProjectStore.getState();
    const story = state.stories.us024;
    expect(story.epicId).toBe("ep5");
    expect(story.sprintId).toBe("s3");
    expect(state.epics.ep5.startDate <= story.startDate).toBe(true);
    expect(state.epics.ep5.endDate >= story.dueDate).toBe(true);
  });

  it("moves an engineering task between Stories without leaving a duplicate", () => {
    const result = useProjectStore.getState().moveTask("fe-024-2", "us025", 0);
    expect(result.ok).toBe(true);
    const state = useProjectStore.getState();
    expect(state.tasks["fe-024-2"].storyId).toBe("us025");
    expect(selectStoryTasks(state, "us024").some((task) => task.id === "fe-024-2")).toBe(false);
    expect(selectStoryTasks(state, "us025")[0].id).toBe("fe-024-2");
  });

  it("keeps Story summary dates authoritative while expanding ancestors for task scheduling", () => {
    const store = useProjectStore.getState();
    const story = store.stories.us024;
    expect(store.updateTask("fe-024-2", { startDate: "2026-01-01" }).ok).toBe(true);
    const state = useProjectStore.getState();
    expect(state.tasks["fe-024-2"].startDate).toBe("2026-01-01");
    expect(state.stories.us024.startDate).toBe("2026-01-01");
    expect(state.epics[story.epicId!].startDate).toBe("2026-01-01");
    expect(selectStorySummaryDates(state, "us024")).toEqual({
      startDate: state.stories.us024.startDate,
      endDate: state.stories.us024.dueDate,
    });
  });

  it("synchronizes valid Subtask scheduling and progress without changing its Story boundary", () => {
    const store = useProjectStore.getState();
    const parent = store.tasks[store.subtasks["subtask-024-2"].taskId];
    expect(store.updateSubtask("subtask-024-2", { startDate: parent.startDate, endDate: parent.endDate, progress: 75 }, "drag").ok).toBe(true);
    const state = useProjectStore.getState();
    expect(state.subtasks["subtask-024-2"].progress).toBe(75);
    expect(selectStorySummaryDates(state, "us024")).toEqual({ startDate: state.stories.us024.startDate, endDate: state.stories.us024.dueDate });
    expect(selectStoryProgress(state, "us024")).toBeGreaterThan(0);
    expect(selectSprintSubtasks(state, "s2").some((subtask) => subtask.id === "subtask-024-2")).toBe(true);
  });

  it("moves an Epic with every descendant and recursively clips descendants when shortened", () => {
    const store = useProjectStore.getState();
    const epic = store.createEpic("t5", { title: "排期级联 Epic", startDate: "2026-09-01", endDate: "2026-09-30" });
    const story = store.createStory({ title: "排期级联 Story", source: "manual", maturityStatus: "ready", sprintId: "s2", epicId: epic.id, startDate: "2026-09-05", dueDate: "2026-09-25" });
    const task = store.createTask(story.id, { title: "排期级联 Task", startDate: "2026-09-07", endDate: "2026-09-20" });
    const subtask = store.addSubtask(task.id, "排期级联 Subtask");
    expect(store.updateSubtask(subtask.id, { startDate: "2026-09-09", endDate: "2026-09-18" }).ok).toBe(true);

    expect(store.rescheduleItem("epic", epic.id, "2026-09-03", "2026-10-02", "move").ok).toBe(true);
    let state = useProjectStore.getState();
    expect(state.stories[story.id]).toMatchObject({ startDate: "2026-09-07", dueDate: "2026-09-27" });
    expect(state.tasks[task.id]).toMatchObject({ startDate: "2026-09-09", endDate: "2026-09-22" });
    expect(state.subtasks[subtask.id]).toMatchObject({ startDate: "2026-09-11", endDate: "2026-09-20" });

    expect(state.rescheduleItem("epic", epic.id, "2026-09-03", "2026-09-18", "right").ok).toBe(true);
    state = useProjectStore.getState();
    expect(state.stories[story.id].dueDate).toBe("2026-09-18");
    expect(state.tasks[task.id].endDate).toBe("2026-09-18");
    expect(state.subtasks[subtask.id].endDate).toBe("2026-09-18");

    const beforeRejectedChange = JSON.stringify({ epic: state.epics[epic.id], story: state.stories[story.id], task: state.tasks[task.id], subtask: state.subtasks[subtask.id] });
    const rejected = state.rescheduleItem("epic", epic.id, "2026-09-03", "2026-09-08", "right");
    expect(rejected.ok).toBe(false);
    state = useProjectStore.getState();
    expect(JSON.stringify({ epic: state.epics[epic.id], story: state.stories[story.id], task: state.tasks[task.id], subtask: state.subtasks[subtask.id] })).toBe(beforeRejectedChange);

    expect(state.rescheduleItem("epic", epic.id, "2026-09-03", "2026-09-25", "right").ok).toBe(true);
    expect(useProjectStore.getState().tasks[task.id].endDate).toBe("2026-09-18");
  });

  it("applies move and shrink rules at Story and Task levels", () => {
    const store = useProjectStore.getState();
    const epic = store.createEpic("t5", { title: "多层排期 Epic", startDate: "2026-09-01", endDate: "2026-10-05" });
    const story = store.createStory({ title: "多层排期 Story", source: "manual", maturityStatus: "ready", sprintId: "s2", epicId: epic.id, startDate: "2026-09-05", dueDate: "2026-09-25" });
    const task = store.createTask(story.id, { title: "多层排期 Task", startDate: "2026-09-07", endDate: "2026-09-20" });
    const subtask = store.addSubtask(task.id, "多层排期 Subtask");
    expect(store.updateSubtask(subtask.id, { startDate: "2026-09-09", endDate: "2026-09-18" }).ok).toBe(true);

    expect(store.rescheduleItem("story", story.id, "2026-09-07", "2026-09-27", "move").ok).toBe(true);
    let state = useProjectStore.getState();
    expect(state.tasks[task.id]).toMatchObject({ startDate: "2026-09-09", endDate: "2026-09-22" });
    expect(state.subtasks[subtask.id]).toMatchObject({ startDate: "2026-09-11", endDate: "2026-09-20" });

    expect(state.rescheduleItem("task", task.id, "2026-09-10", "2026-09-23", "move").ok).toBe(true);
    state = useProjectStore.getState();
    expect(state.subtasks[subtask.id]).toMatchObject({ startDate: "2026-09-12", endDate: "2026-09-21" });
    expect(state.rescheduleItem("task", task.id, "2026-09-10", "2026-09-20", "right").ok).toBe(true);
    expect(useProjectStore.getState().subtasks[subtask.id].endDate).toBe("2026-09-20");
    expect(useProjectStore.getState().rescheduleItem("task", task.id, "2026-09-10", "2026-09-11", "right").ok).toBe(false);
  });

  it("expands every ancestor while previewing and committing a child schedule outside its parent", () => {
    const store = useProjectStore.getState();
    const epic = store.createEpic("t5", { title: "Ancestor expansion Epic", startDate: "2026-09-01", endDate: "2026-09-30" });
    const story = store.createStory({ title: "Ancestor expansion Story", source: "manual", maturityStatus: "ready", sprintId: "s2", epicId: epic.id, startDate: "2026-09-05", dueDate: "2026-09-25" });
    const task = store.createTask(story.id, { title: "Ancestor expansion Task", startDate: "2026-09-07", endDate: "2026-09-20" });
    const subtask = store.addSubtask(task.id, "Ancestor expansion Subtask");
    expect(store.updateSubtask(subtask.id, { startDate: "2026-09-09", endDate: "2026-09-18" }).ok).toBe(true);

    const preview = planHierarchySchedule(useProjectStore.getState(), "subtask", subtask.id, "2026-08-29", "2026-09-07", "move");
    if (!preview.ok) throw new Error(preview.message);
    expect(preview.after.subtasks[subtask.id]).toEqual({ startDate: "2026-08-29", endDate: "2026-09-07" });
    expect(preview.after.tasks[task.id].startDate).toBe("2026-08-29");
    expect(preview.after.stories[story.id].startDate).toBe("2026-08-29");
    expect(preview.after.epics[epic.id].startDate).toBe("2026-08-29");

    expect(store.rescheduleItem("subtask", subtask.id, "2026-08-29", "2026-09-07", "move").ok).toBe(true);
    let state = useProjectStore.getState();
    expect(state.tasks[task.id].startDate).toBe("2026-08-29");
    expect(state.stories[story.id].startDate).toBe("2026-08-29");
    expect(state.epics[epic.id].startDate).toBe("2026-08-29");

    expect(state.rescheduleItem("task", task.id, state.tasks[task.id].startDate, "2026-10-08", "right").ok).toBe(true);
    state = useProjectStore.getState();
    expect(state.tasks[task.id].endDate).toBe("2026-10-08");
    expect(state.stories[story.id].dueDate).toBe("2026-10-08");
    expect(state.epics[epic.id].endDate).toBe("2026-10-08");
    expect(state.subtasks[subtask.id]).toMatchObject({ startDate: "2026-08-29", endDate: "2026-09-07" });
  });

  it("undoes one hierarchy schedule transaction with all descendant dates", () => {
    const store = useProjectStore.getState();
    const before = {
      story: { startDate: store.stories.us024.startDate, dueDate: store.stories.us024.dueDate },
      task: { startDate: store.tasks["fe-024-2"].startDate, endDate: store.tasks["fe-024-2"].endDate },
      subtask: { startDate: store.subtasks["subtask-024-2"].startDate, endDate: store.subtasks["subtask-024-2"].endDate },
    };
    expect(store.rescheduleItem("story", "us024", "2026-09-15", "2026-09-29", "move").ok).toBe(true);
    expect(useProjectStore.getState().undoLastChange().ok).toBe(true);
    const state = useProjectStore.getState();
    expect({ startDate: state.stories.us024.startDate, dueDate: state.stories.us024.dueDate }).toEqual(before.story);
    expect({ startDate: state.tasks["fe-024-2"].startDate, endDate: state.tasks["fe-024-2"].endDate }).toEqual(before.task);
    expect({ startDate: state.subtasks["subtask-024-2"].startDate, endDate: state.subtasks["subtask-024-2"].endDate }).toEqual(before.subtask);
  });

  it("persists Subtask delivery details for Board and acceptance integration", () => {
    const result = useProjectStore.getState().updateSubtask("subtask-024-2", {
      resultSummary: "已完成边界校验并提交演示结果",
      resultUrl: "https://example.local/deliverables/subtask-024-2",
    });
    expect(result.ok).toBe(true);
    const subtask = useProjectStore.getState().subtasks["subtask-024-2"];
    expect(subtask.resultSummary).toContain("边界校验");
    expect(subtask.resultUrl).toContain("subtask-024-2");
  });

  it("keeps Board task updates visible to Story progress selectors", () => {
    const before = selectStoryProgress(useProjectStore.getState(), "us024");
    expect(useProjectStore.getState().updateTask("fe-024-2", { status: "done", progress: 100 }, "drag").ok).toBe(true);
    expect(useProjectStore.getState().updateTask("test-024", { status: "done", progress: 100 }, "drag").ok).toBe(true);
    expect(selectStoryProgress(useProjectStore.getState(), "us024")).toBeGreaterThanOrEqual(before);
    expect(selectSprintTasks(useProjectStore.getState(), "s2").find((task) => task.id === "test-024")?.status).toBe("done");
  });

  it("keeps Task progress and status synchronized in every update path", () => {
    const store = useProjectStore.getState();
    expect(store.updateTask("fe-024-2", { progress: 100 }, "drag").ok).toBe(true);
    expect(useProjectStore.getState().tasks["fe-024-2"]).toMatchObject({ status: "done", progress: 100 });

    expect(useProjectStore.getState().updateTask("fe-024-2", { progress: 64 }).ok).toBe(true);
    expect(useProjectStore.getState().tasks["fe-024-2"]).toMatchObject({ status: "in_progress", progress: 64 });

    expect(useProjectStore.getState().updateTask("fe-024-2", { progress: 0 }).ok).toBe(true);
    expect(useProjectStore.getState().tasks["fe-024-2"]).toMatchObject({ status: "todo", progress: 0 });

    expect(useProjectStore.getState().updateTask("fe-024-2", { status: "done" }).ok).toBe(true);
    expect(useProjectStore.getState().tasks["fe-024-2"]).toMatchObject({ status: "done", progress: 100 });

    expect(useProjectStore.getState().updateTask("fe-024-2", { status: "in_progress" }).ok).toBe(true);
    expect(useProjectStore.getState().tasks["fe-024-2"]).toMatchObject({ status: "in_progress", progress: 99 });
  });

  it("keeps Subtask progress, status and done synchronized", () => {
    const id = "subtask-024-2";
    expect(useProjectStore.getState().updateSubtask(id, { progress: 100 }).ok).toBe(true);
    expect(useProjectStore.getState().subtasks[id]).toMatchObject({ status: "done", progress: 100, done: true });

    expect(useProjectStore.getState().updateSubtask(id, { progress: 35 }).ok).toBe(true);
    expect(useProjectStore.getState().subtasks[id]).toMatchObject({ status: "in_progress", progress: 35, done: false });

    expect(useProjectStore.getState().updateSubtask(id, { status: "todo" }).ok).toBe(true);
    expect(useProjectStore.getState().subtasks[id]).toMatchObject({ status: "todo", progress: 0, done: false });
  });

  it("recalculates dependency blocking when progress crosses completion", () => {
    expect(useProjectStore.getState().tasks["test-024"].status).toBe("blocked");
    expect(useProjectStore.getState().updateTask("fe-024-2", { progress: 100 }).ok).toBe(true);
    expect(useProjectStore.getState().tasks["test-024"].status).toBe("todo");

    expect(useProjectStore.getState().updateTask("fe-024-2", { progress: 99 }).ok).toBe(true);
    expect(useProjectStore.getState().tasks["test-024"].status).toBe("blocked");
  });

  it("creates valid FS dependencies and rejects duplicate, self and cyclic dependencies", () => {
    const store = useProjectStore.getState();
    expect(store.addDependency("fe-025-1", "be-025-1").ok).toBe(true);
    expect(useProjectStore.getState().addDependency("fe-025-1", "be-025-1").ok).toBe(false);
    expect(useProjectStore.getState().addDependency("fe-025-1", "fe-025-1").ok).toBe(false);
    expect(useProjectStore.getState().addDependency("be-025-1", "data-024").ok).toBe(false);
  });

  it("automatically blocks a target until its predecessor is done", () => {
    const initial = useProjectStore.getState().tasks["test-024"];
    expect(initial.status).toBe("blocked");
    expect(initial.blockReasons.some((reason) => reason.dependencyId === "dep-3")).toBe(true);

    expect(useProjectStore.getState().updateTask("fe-024-2", { status: "done" }).ok).toBe(true);
    const released = useProjectStore.getState().tasks["test-024"];
    expect(released.status).toBe("todo");
    expect(released.blockReasons).toHaveLength(0);

    expect(useProjectStore.getState().updateTask("fe-024-2", { status: "in_progress" }).ok).toBe(true);
    const blockedAgain = useProjectStore.getState().tasks["test-024"];
    expect(blockedAgain.status).toBe("blocked");
    expect(blockedAgain.blockReasons[0].source).toBe("dependency");
  });

  it("recalculates automatic blocking across a dependency chain", () => {
    const store = useProjectStore.getState();
    store.createTask("us025", { id: "chain-a", title: "链路 A", status: "todo" });
    store.createTask("us025", { id: "chain-b", title: "链路 B", status: "done" });
    store.createTask("us025", { id: "chain-c", title: "链路 C", status: "done" });
    expect(store.addDependency("chain-a", "chain-b").ok).toBe(true);
    expect(useProjectStore.getState().addDependency("chain-b", "chain-c").ok).toBe(true);
    expect(useProjectStore.getState().tasks["chain-b"].status).toBe("blocked");
    expect(useProjectStore.getState().tasks["chain-c"].status).toBe("blocked");

    expect(useProjectStore.getState().updateTask("chain-a", { status: "done" }).ok).toBe(true);
    expect(useProjectStore.getState().tasks["chain-b"].status).toBe("done");
    expect(useProjectStore.getState().tasks["chain-c"].status).toBe("done");
  });

  it("keeps multiple manual block reasons and restores the previous status after the last deletion", () => {
    const store = useProjectStore.getState();
    const originalStatus = store.tasks["be-025-1"].status;
    expect(store.addTaskBlockReason("be-025-1", "等待接口字段确认", "data-025").ok).toBe(true);
    expect(useProjectStore.getState().addTaskBlockReason("be-025-1", "本地环境无法启动").ok).toBe(true);
    let task = useProjectStore.getState().tasks["be-025-1"];
    expect(task.status).toBe("blocked");
    expect(task.blockReasons).toHaveLength(2);
    expect(task.blockReasons[0].relatedTaskId).toBe("data-025");

    expect(useProjectStore.getState().deleteTaskBlockReason("be-025-1", task.blockReasons[0].id).ok).toBe(true);
    task = useProjectStore.getState().tasks["be-025-1"];
    expect(task.status).toBe("blocked");
    expect(task.blockReasons).toHaveLength(1);

    expect(useProjectStore.getState().deleteTaskBlockReason("be-025-1", task.blockReasons[0].id).ok).toBe(true);
    task = useProjectStore.getState().tasks["be-025-1"];
    expect(task.status).toBe(originalStatus);
    expect(task.statusBeforeBlocked).toBeNull();
  });

  it("deleting an automatic block reason removes its dependency edge", () => {
    const task = useProjectStore.getState().tasks["test-024"];
    const automatic = task.blockReasons.find((reason) => reason.dependencyId === "dep-3");
    expect(automatic).toBeTruthy();
    expect(useProjectStore.getState().deleteTaskBlockReason(task.id, automatic!.id).ok).toBe(true);
    const state = useProjectStore.getState();
    expect(state.dependencies["dep-3"]).toBeUndefined();
    expect(state.tasks[task.id].blockReasons.some((reason) => reason.dependencyId === "dep-3")).toBe(false);
    expect(state.tasks[task.id].status).toBe("todo");
  });

  it("supports referenced manual block reasons on Subtasks", () => {
    const store = useProjectStore.getState();
    const subtaskId = "subtask-024-2";
    expect(store.addSubtaskBlockReason(subtaskId, "等待后端联调", "be-024-1").ok).toBe(true);
    let subtask = useProjectStore.getState().subtasks[subtaskId];
    expect(subtask.status).toBe("blocked");
    expect(subtask.blockReasons[0].relatedTaskId).toBe("be-024-1");
    expect(useProjectStore.getState().deleteSubtaskBlockReason(subtaskId, subtask.blockReasons[0].id).ok).toBe(true);
    subtask = useProjectStore.getState().subtasks[subtaskId];
    expect(subtask.status).toBe("in_progress");
    expect(subtask.blockReasons).toHaveLength(0);
  });

  it("persists acceptance criteria as independent ordered entities", () => {
    const created = useProjectStore.getState().addAcceptanceCriterion("us024", "跨视图数据立即一致");
    useProjectStore.getState().updateAcceptanceCriterion(created.id, { satisfied: true });
    const criteria = selectStoryCriteria(useProjectStore.getState(), "us024");
    expect(criteria.at(-1)?.content).toBe("跨视图数据立即一致");
    expect(criteria.at(-1)?.satisfied).toBe(true);
  });

  it("deletes a task with its subtasks and dependency edges", () => {
    const store = useProjectStore.getState();
    const taskId = "fe-024-2";
    const subtaskIds = [...store.tasks[taskId].subtaskIds];
    expect(Object.values(store.dependencies).some((dependency) => dependency.sourceTaskId === taskId || dependency.targetTaskId === taskId)).toBe(true);
    const result = store.deleteTask(taskId);
    expect(result.ok).toBe(true);
    const after = useProjectStore.getState();
    expect(after.tasks[taskId]).toBeUndefined();
    expect(subtaskIds.every((id) => after.subtasks[id] === undefined)).toBe(true);
    expect(Object.values(after.dependencies).some((dependency) => dependency.sourceTaskId === taskId || dependency.targetTaskId === taskId)).toBe(false);
  });

  it("round-trips project data through JSON export, reset and import", () => {
    useProjectStore.getState().updateStory("us024", { title: "导出恢复验证" });
    const json = useProjectStore.getState().exportProjectJson();
    useProjectStore.getState().resetDemoData();
    expect(useProjectStore.getState().stories.us024.title).not.toBe("导出恢复验证");
    const result = useProjectStore.getState().importProjectJson(json);
    expect(result.ok).toBe(true);
    expect(useProjectStore.getState().stories.us024.title).toBe("导出恢复验证");
  });

  it("provides Sprint lifecycle actions with a single active Sprint invariant", () => {
    const state = useProjectStore.getState();
    expect(state.selectSprint("s3").ok).toBe(true);
    expect(useProjectStore.getState().workspace.selectedSprintId).toBe("s3");
    expect(state.setSprintStatus("s3", "active").ok).toBe(false);
    expect(state.setSprintStatus("s2", "closed").ok).toBe(true);
    expect(useProjectStore.getState().setSprintStatus("s3", "active").ok).toBe(true);
    expect(Object.values(useProjectStore.getState().sprints).filter((sprint) => sprint.status === "active")).toHaveLength(1);
  });

  it("links one UML asset to Story, Task and Sprint through stable selectors", () => {
    const asset = useProjectStore.getState().createAsset({
      name: "课程用例图",
      kind: "use-case",
      sourceText: "flowchart LR; PO --> Story",
      sizeBytes: 2048,
      links: [{ targetType: "story", targetId: "us024" }],
    });
    expect(useProjectStore.getState().linkAsset(asset.id, "task", "fe-024-2").ok).toBe(true);
    expect(useProjectStore.getState().linkAsset(asset.id, "sprint", "s2").ok).toBe(true);
    const state = useProjectStore.getState();
    expect(selectStoryAssets(state, "us024").map((item) => item.id)).toContain(asset.id);
    expect(selectTaskAssets(state, "fe-024-2").map((item) => item.id)).toContain(asset.id);
    expect(selectSprintAssets(state, "s2").map((item) => item.id)).toContain(asset.id);
    expect(state.assets[asset.id].sizeBytes).toBe(2048);
  });

  it("migrates schema v3 records to expected benefit, blocking lists, milestone and schedulable Subtasks", () => {
    const legacy = JSON.parse(useProjectStore.getState().exportProjectJson());
    legacy.schemaVersion = 3;
    delete legacy.stories.us024.expectedBenefit;
    delete legacy.tasks["fe-024-2"].isMilestone;
    legacy.tasks["fe-024-2"].status = "blocked";
    legacy.tasks["fe-024-2"].blockedReason = "旧版单条阻塞原因";
    delete legacy.tasks["fe-024-2"].blockReasons;
    delete legacy.tasks["fe-024-2"].statusBeforeBlocked;
    delete legacy.subtasks["subtask-024-2"].status;
    delete legacy.subtasks["subtask-024-2"].startDate;
    delete legacy.subtasks["subtask-024-2"].resultUrl;
    delete legacy.workspace.inspectorWidth;
    expect(useProjectStore.getState().importProjectJson(JSON.stringify(legacy)).ok).toBe(true);
    const migrated = useProjectStore.getState();
    expect(migrated.stories.us024.expectedBenefit).toBeTruthy();
    expect(migrated.tasks["fe-024-2"].isMilestone).toBe(false);
    expect(migrated.tasks["fe-024-2"].blockReasons.some((reason) => reason.message === "旧版单条阻塞原因")).toBe(true);
    expect(migrated.subtasks["subtask-024-2"].status).toBeTruthy();
    expect(migrated.subtasks["subtask-024-2"].startDate).toBeTruthy();
    expect(migrated.subtasks["subtask-024-2"].resultUrl).toBe("");
    expect(migrated.workspace.inspectorWidth).toBe(400);
  });

  it("starts a Sprint only after goal, dates, Story and assignee checks pass", () => {
    const store = useProjectStore.getState();
    expect(store.setSprintStatus("s2", "closed").ok).toBe(true);
    const sprint = store.createSprint({
      name: "课程验收 Sprint",
      goal: "走通 B2 和 B3 的完整链路",
      startDate: "2026-09-14",
      endDate: "2026-09-25",
      capacity: 13,
    });
    const story = store.createStory({
      title: "Sprint 启动 Story",
      source: "manual",
      maturityStatus: "ready",
      as: "PO",
      iWant: "启动一次迭代",
      soThat: "验证启动条件",
      epicId: "ep4",
    });
    store.createTask(story.id, { title: "已分配任务", assigneeId: "m2" });
    expect(store.addStoriesToSprint(sprint.id, [story.id]).ok).toBe(true);
    expect(store.startSprint(sprint.id).ok).toBe(true);
    expect(useProjectStore.getState().sprints[sprint.id].status).toBe("active");
    expect(useProjectStore.getState().workspace.selectedSprintId).toBe(sprint.id);

    const another = useProjectStore.getState().createSprint({
      name: "冲突 Sprint",
      goal: "验证唯一 active",
      startDate: "2026-09-15",
      endDate: "2026-09-26",
      capacity: 8,
    });
    expect(useProjectStore.getState().addStoriesToSprint(another.id, ["cand-003"]).ok).toBe(true);
    useProjectStore.getState().createTask("cand-003", { title: "冲突验证任务" });
    expect(useProjectStore.getState().startSprint(another.id).ok).toBe(false);
  });

  it("uses Subtasks as execution leaves before moving a Story to pending acceptance", () => {
    const store = useProjectStore.getState();
    const story = store.createStory({
      title: "叶节点验收 Story",
      source: "manual",
      maturityStatus: "ready",
      deliveryStatus: "planned",
      sprintId: "s2",
      as: "PO",
      iWant: "按 Subtask 判定完成",
      soThat: "避免父任务误报完成",
      epicId: "ep4",
    });
    const task = store.createTask(story.id, { title: "父任务", status: "done" });
    const subtask = useProjectStore.getState().addSubtask(task.id, "仍未完成的子任务");
    expect(useProjectStore.getState().stories[story.id].deliveryStatus).toBe("in_progress");
    expect(selectStoryExecutionLeaves(useProjectStore.getState(), story.id)).toMatchObject([
      { type: "subtask", id: subtask.id },
    ]);
    expect(useProjectStore.getState().updateSubtask(subtask.id, { status: "done" }).ok).toBe(true);
    expect(useProjectStore.getState().stories[story.id].deliveryStatus).toBe("pending_acceptance");
  });

  it("accepts, returns and re-accepts a Story while preserving append-only logs", () => {
    const store = useProjectStore.getState();
    const story = store.createStory({
      title: "验收往返 Story",
      source: "manual",
      maturityStatus: "ready",
      deliveryStatus: "planned",
      sprintId: "s2",
      as: "PO",
      iWant: "记录验收往返",
      soThat: "保留退回原因",
      epicId: "ep4",
    });
    const task = store.createTask(story.id, { title: "验收任务", status: "done" });
    expect(useProjectStore.getState().stories[story.id].deliveryStatus).toBe("pending_acceptance");
    expect(useProjectStore.getState().acceptStory(story.id, "第一次通过").ok).toBe(true);
    expect(useProjectStore.getState().returnStory(story.id, "还需补充演示说明", [], "in_progress").ok).toBe(false);
    expect(useProjectStore.getState().returnStory(story.id, "还需补充演示说明", [{ type: "task", id: task.id }], "in_progress").ok).toBe(true);
    let state = useProjectStore.getState();
    expect(state.stories[story.id].deliveryStatus).toBe("in_progress");
    expect(state.stories[story.id].acceptanceLog.map((item) => item.result)).toEqual(["accepted", "returned"]);
    expect(state.updateTask(task.id, { status: "done" }).ok).toBe(true);
    expect(useProjectStore.getState().acceptStory(story.id, "修正后通过").ok).toBe(true);
    state = useProjectStore.getState();
    expect(state.stories[story.id].acceptanceLog.map((item) => item.result)).toEqual(["accepted", "returned", "accepted"]);
  });

  it("stores multiple links and submission metadata on Task and Subtask", () => {
    const store = useProjectStore.getState();
    expect(store.submitTaskResult("task", "fe-024-2", {
      note: "完成页面与数据链路",
      links: ["https://example.com/demo", "https://example.com/report"],
      assetIds: [],
    }).ok).toBe(true);
    expect(useProjectStore.getState().tasks["fe-024-2"]).toMatchObject({
      resultSummary: "完成页面与数据链路",
      resultLinks: ["https://example.com/demo", "https://example.com/report"],
    });
    expect(useProjectStore.getState().tasks["fe-024-2"].submittedAt).toBeTruthy();
    expect(useProjectStore.getState().submitTaskResult("subtask", "subtask-024-2", {
      note: "子任务成果",
      links: ["https://example.com/subtask"],
      assetIds: [],
    }).ok).toBe(true);
    expect(useProjectStore.getState().subtasks["subtask-024-2"].resultLinks).toEqual(["https://example.com/subtask"]);
  });

  it("requires explicit carry-over decisions when closing a Sprint", () => {
    const store = useProjectStore.getState();
    const unfinished = selectSprintStories(store, "s2").filter((story) => story.deliveryStatus !== "accepted");
    const missing = store.closeSprint("s2", {
      goalAchieved: false,
      retrospective: { mainProblem: "仍有未完成项", nextImprovement: "缩小下轮范围" },
      carryOver: [],
    });
    expect(missing.ok).toBe(unfinished.length === 0);
    if (unfinished.length === 0) return;
    const closed = useProjectStore.getState().closeSprint("s2", {
      goalAchieved: false,
      retrospective: { mainProblem: "仍有未完成项", nextImprovement: "缩小下轮范围" },
      carryOver: unfinished.map((story) => ({ storyId: story.id, to: "backlog" })),
    });
    expect(closed.ok).toBe(true);
    const state = useProjectStore.getState();
    expect(state.sprints.s2.status).toBe("closed");
    expect(unfinished.every((story) => state.stories[story.id].sprintId === null)).toBe(true);
  });

  it("derives returned acceptance grouping and keeps pending work below full completion", () => {
    const store = useProjectStore.getState();
    const story = store.createStory({
      title: "完成度 Story",
      source: "manual",
      maturityStatus: "ready",
      deliveryStatus: "planned",
      sprintId: "s2",
      as: "PO",
      iWant: "查看综合完成度",
      soThat: "待验收不等于完成",
      epicId: "ep4",
      storyPoints: 5,
    });
    const task = store.createTask(story.id, { title: "完成度任务", status: "done" });
    const pendingCompletion = selectProjectCompletion(useProjectStore.getState());
    expect(useProjectStore.getState().stories[story.id].deliveryStatus).toBe("pending_acceptance");
    expect(pendingCompletion.percent).toBeLessThan(100);
    expect(store.returnStory(story.id, "需要补充", [{ type: "task", id: task.id }]).ok).toBe(true);
    const buckets = selectAcceptanceBuckets(useProjectStore.getState(), "s2");
    expect(buckets.returned.map((item) => item.id)).toContain(story.id);
  });

  it("normalizes inconsistent pending acceptance state during JSON import", () => {
    const exported = JSON.parse(useProjectStore.getState().exportProjectJson());
    exported.stories.us027.deliveryStatus = "pending_acceptance";
    const result = useProjectStore.getState().importProjectJson(JSON.stringify(exported));
    expect(result.ok).toBe(true);
    expect(useProjectStore.getState().stories.us027.deliveryStatus).toBe("in_progress");
  });

  it("preserves derived in-progress state when carrying work into another Sprint", () => {
    const before = useProjectStore.getState();
    const unfinished = Object.values(before.stories).filter(
      (story) => story.sprintId === "s2" && story.deliveryStatus !== "accepted",
    );
    const result = before.closeSprint("s2", {
      goalAchieved: false,
      retrospective: {
        mainProblem: "Incomplete execution",
        nextImprovement: "Reduce planned scope",
      },
      carryOver: unfinished.map((story) => ({
        storyId: story.id,
        to: story.id === "us024" ? "s3" : "backlog",
      })),
    });
    expect(result.ok).toBe(true);
    expect(useProjectStore.getState().stories.us024).toMatchObject({
      sprintId: "s3",
      deliveryStatus: "in_progress",
    });
  });

  it("keeps Sprint lifecycle mutations restricted to PO mode", () => {
    useProjectStore.getState().setWorkspace({ actorMode: "employee", currentUserId: "m2" });
    const employee = useProjectStore.getState();
    expect(employee.startSprint("s3").ok).toBe(false);
    expect(employee.updateSprint("s3", { goal: "Unauthorized" }).ok).toBe(false);
    expect(employee.addStoriesToSprint("s3", ["cand-003"]).ok).toBe(false);
    expect(() => employee.createSprint({
      name: "Unauthorized Sprint",
      goal: "Should fail",
      startDate: "2026-10-03",
      endDate: "2026-10-10",
      capacity: 10,
    })).toThrow();
  });

  it("freezes every execution write path for a closed Sprint", () => {
    useProjectStore.setState((state) => ({
      sprints: { ...state.sprints, s2: { ...state.sprints.s2, status: "closed", closedAt: new Date().toISOString() } },
    }));
    const store = useProjectStore.getState();
    expect(store.updateTask("fe-024-2", { progress: 55 }).ok).toBe(false);
    expect(store.rescheduleItem("task", "fe-024-2", "2026-09-08", "2026-09-13", "move").ok).toBe(false);
    expect(store.addTaskBlockReason("fe-024-2", "关闭后不应写入").ok).toBe(false);
    expect(store.deleteTask("fe-024-2").ok).toBe(false);
    expect(store.updateSubtask("subtask-024-2", { progress: 60 }).ok).toBe(false);
    expect(store.addSubtaskBlockReason("subtask-024-2", "关闭后不应写入").ok).toBe(false);
    expect(store.deleteSubtask("subtask-024-2").ok).toBe(false);
    expect(store.submitTaskResult("task", "fe-024-2", { note: "无效", links: [], assetIds: [] }).ok).toBe(false);
    expect(store.updateStory("us024", { title: "无效修改" }).ok).toBe(false);
    expect(() => store.addAcceptanceCriterion("us024", "关闭后无效 AC")).toThrow();
    expect(store.deleteStory("us024").ok).toBe(false);
    expect(store.deleteEpic("ep4").ok).toBe(false);
    expect(() => store.createTask("us024", { title: "无效任务" })).toThrow();
    expect(() => store.addSubtask("fe-024-2", "无效子任务")).toThrow();
  });

  it("keeps risk records synchronized with Story Task and Sprint targets", () => {
    const store = useProjectStore.getState();
    const risk = store.createRisk({
      title: "新增链路风险",
      targetType: "task",
      targetId: "fe-024-2",
      level: "high",
      description: "测试风险说明",
      impact: "影响排期",
      mitigation: "降低范围",
      ownerId: "m1",
      status: "open",
    });
    expect(selectRisks(useProjectStore.getState(), "task", "fe-024-2").map((item) => item.id)).toContain(risk.id);
    expect(store.updateRisk(risk.id, { status: "mitigating", targetType: "story", targetId: "us024" }).ok).toBe(true);
    expect(selectRisks(useProjectStore.getState(), "story", "us024").map((item) => item.id)).toContain(risk.id);
    expect(store.deleteRisk(risk.id).ok).toBe(true);
    expect(useProjectStore.getState().risks[risk.id]).toBeUndefined();
  });

  it("creates non-AI impact records for schedule assignee Sprint and dependency changes", () => {
    const store = useProjectStore.getState();
    const baseline = store.impactAnalyses.length;
    expect(store.rescheduleItem("task", "be-025-1", "2026-09-17", "2026-09-23", "move").ok).toBe(true);
    expect(useProjectStore.getState().updateTask("be-025-1", { assigneeId: "m2" }).ok).toBe(true);
    expect(useProjectStore.getState().updateSubtask("subtask-024-2", { assigneeId: "m3" }).ok).toBe(true);
    expect(useProjectStore.getState().moveStory("cand-003", "ep9", "s3").ok).toBe(true);
    const first = useProjectStore.getState().createTask("cand-003", { title: "影响源任务" });
    const second = useProjectStore.getState().createTask("cand-003", { title: "影响目标任务" });
    expect(useProjectStore.getState().addDependency(first.id, second.id).ok).toBe(true);
    const impacts = selectImpacts(useProjectStore.getState()).slice(0, 10);
    expect(impacts.length).toBeGreaterThanOrEqual(baseline + 5);
    expect(impacts.map((item) => item.changeType)).toEqual(expect.arrayContaining(["schedule", "assignee", "sprint", "dependency"]));
  });

  it("stores project Story and Task discussions in one persisted collection", () => {
    const store = useProjectStore.getState();
    expect(store.addDiscussion("project", store.project.id, "项目讨论").ok).toBe(true);
    expect(store.addDiscussion("story", "us024", "Story 讨论").ok).toBe(true);
    expect(store.addDiscussion("task", "fe-024-2", "Task 讨论").ok).toBe(true);
    const state = useProjectStore.getState();
    expect(selectDiscussions(state, "project", state.project.id).at(-1)?.content).toBe("项目讨论");
    expect(selectDiscussions(state, "story", "us024").at(-1)?.content).toBe("Story 讨论");
    expect(selectDiscussions(state, "task", "fe-024-2").at(-1)?.content).toBe("Task 讨论");
    const imported = JSON.parse(state.exportProjectJson());
    expect(Object.values(imported.discussions)).toHaveLength(Object.keys(state.discussions).length);
  });

  it("creates a manual blank project and keeps every canonical collection empty", () => {
    const result = useProjectStore.getState().createBlankProject({
      name: "课程空白项目",
      goal: "手工完成基础规划",
      requirementBrief: "不使用 AI 初始化",
      startDate: "2026-10-01",
      endDate: "2026-11-01",
      members: [{ name: "产品负责人", role: "PO", capacityHours: 32 }],
    });
    expect(result.ok).toBe(true);
    const state = useProjectStore.getState();
    expect(state.project.name).toBe("课程空白项目");
    expect(state.members.m1.capacityHours).toBe(32);
    expect(Object.keys(state.stories)).toHaveLength(0);
    expect(Object.keys(state.tasks)).toHaveLength(0);
    expect(Object.keys(state.risks)).toHaveLength(0);
    expect(state.workspace.currentPage).toBe("overview");
  });

  it("derives analytics and persists linked UML assets through JSON", () => {
    const store = useProjectStore.getState();
    const umlData = parseUmlSource("sequence", "PO -> 系统: 保存 Story").diagram;
    const asset = store.createAsset({
      name: "课程阶段时序图",
      kind: "sequence",
      sourceText: "PO -> 系统: 保存 Story",
      umlData,
      links: [{ targetType: "story", targetId: "us024" }],
    });
    const analytics = selectSprintAnalytics(useProjectStore.getState(), "s2");
    const workloads = selectTeamWorkloads(useProjectStore.getState());
    const health = selectScheduleHealth("2026-09-01", "2026-09-05", 50, "2026-09-07");
    expect(analytics.taskCount).toBeGreaterThan(0);
    expect(workloads).toHaveLength(Object.keys(store.members).length);
    expect(health.overdue).toBe(true);
    expect(health.variance).toBeLessThan(0);
    const json = useProjectStore.getState().exportProjectJson();
    resetProjectStoreForTests();
    expect(useProjectStore.getState().importProjectJson(json).ok).toBe(true);
    expect(useProjectStore.getState().assets[asset.id]).toMatchObject({ kind: "sequence", sourceText: "PO -> 系统: 保存 Story", umlData: { kind: "sequence", nodes: expect.any(Array), edges: expect.any(Array) } });
  });

  it("allocates execution-leaf estimates across each calendar day in the heatmap", () => {
    const state = useProjectStore.getState();
    const template = Object.values(state.tasks)[0];
    const heatmap = selectDailyWorkloadHeatmap({
      ...state,
      tasks: {
        daily: {
          ...template,
          id: "daily",
          title: "四天工作",
          assigneeId: "m1",
          estimate: 8,
          startDate: "2026-09-17",
          endDate: "2026-09-20",
          subtaskIds: [],
        },
      },
      subtasks: {},
    }, "2026-09-18", 1, 2);
    expect(heatmap.dates.map((item) => item.date)).toEqual([
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
    ]);
    const memberRow = heatmap.rows.find((row) => row.member.id === "m1");
    expect(memberRow?.cells).toEqual([2, 2, 2, 2]);
    expect(memberRow?.totalHours).toBe(8);
    expect(memberRow?.details[1]).toEqual([
      {
        type: "task",
        id: "daily",
        taskId: "daily",
        title: "四天工作",
        allocatedHours: 2,
        startDate: "2026-09-17",
        endDate: "2026-09-20",
      },
    ]);
  });

  it("returns subtask details with their parent task for heatmap navigation", () => {
    const state = useProjectStore.getState();
    const task = Object.values(state.tasks).find((item) => item.subtaskIds.length > 0)!;
    const subtask = state.subtasks[task.subtaskIds[0]];
    const heatmap = selectDailyWorkloadHeatmap(state, subtask.startDate, 0, 0);
    const detail = heatmap.rows
      .find((row) => row.member.id === subtask.assigneeId)
      ?.details[0]
      .find((item) => item.id === subtask.id);
    expect(detail).toMatchObject({
      type: "subtask",
      id: subtask.id,
      taskId: task.id,
      title: subtask.title,
    });
    expect(detail?.allocatedHours).toBeGreaterThan(0);
  });

  it("derives a stable historical daily-work index without future dates", () => {
    const state = useProjectStore.getState();
    const template = Object.values(state.tasks)[0];
    const customState = {
      ...state,
      tasks: {
        actualDaily: {
          ...template,
          id: "actualDaily",
          title: "每日进度与成果展示",
          assigneeId: "m1",
          estimate: 20,
          progress: 60,
          startDate: "2026-09-15",
          endDate: "2026-09-20",
          resultSummary: "提交热力图数据链路自测结果",
          resultUrl: "https://example.com/result",
          resultLinks: ["https://example.com/report"],
          resultAssetIds: ["asset-1"],
          submittedAt: "2026-09-18T09:30:00.000Z",
          subtaskIds: [],
        },
      },
      subtasks: {},
    };
    const heatmap = selectDailyActualWorkloadHeatmap(customState, "2026-09-18", 3);
    expect(heatmap.dates.map((item) => item.date)).toEqual([
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
    ]);
    expect(heatmap.dates.at(-1)).toMatchObject({ date: "2026-09-18", isToday: true });
    expect(heatmap.dates.every((item) => item.date <= "2026-09-18")).toBe(true);
    const row = heatmap.rows.find((item) => item.member.id === "m1")!;
    const progressDetails = row.details.flat().filter((item) => item.type === "progress");
    expect(progressDetails.reduce((sum, item) => sum + (item.progressDelta ?? 0), 0)).toBeCloseTo(60, 0);
    const todayDetails = row.details.at(-1)!;
    expect(todayDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "submission",
        title: "每日进度与成果展示",
        resultSummary: "提交热力图数据链路自测结果",
        linkCount: 2,
        assetCount: 1,
      }),
    ]));
    expect(row.cells.at(-1)).toBeCloseTo(
      todayDetails.reduce((sum, item) => sum + item.score, 0),
      2,
    );
    expect(selectDailyActualWorkloadHeatmap(customState, "2026-09-18", 3)).toEqual(heatmap);
  });

  it("clears heatmap gantt highlights when another work item is selected or focused", () => {
    const store = useProjectStore.getState();
    const task = Object.values(store.tasks)[0];
    const highlight = {
      date: task.startDate,
      taskIds: [task.id],
      subtaskIds: [],
      nonce: 1,
    };
    store.setWorkspace({ ganttHeatmapHighlight: highlight });
    useProjectStore.getState().selectObject("task", task.id);
    expect(useProjectStore.getState().workspace.ganttHeatmapHighlight).toBeNull();

    useProjectStore.getState().setWorkspace({ ganttHeatmapHighlight: highlight });
    useProjectStore.getState().requestFocus("task", task.id, "gantt");
    expect(useProjectStore.getState().workspace.ganttHeatmapHighlight).toBeNull();
  });

  it("keeps the default active plan centered on the demo current date", () => {
    const state = useProjectStore.getState();
    expect(state.sprints.s2).toMatchObject({
      status: "active",
      startDate: "2026-09-14",
      endDate: "2026-09-27",
    });
    const unfinished = Object.values(state.tasks).filter((task) => task.status !== "done");
    expect(unfinished.length).toBeGreaterThan(0);
    expect(unfinished.every((task) => task.endDate >= "2026-09-18")).toBe(true);
    expect(unfinished.some((task) => task.startDate <= "2026-09-18" && task.endDate >= "2026-09-18")).toBe(true);
    expect(unfinished.some((task) => task.startDate > "2026-09-18")).toBe(true);
    expect(state.workspace.ganttRangeStart).toBe("2026-09-01");
    expect(state.workspace.ganttRangeEnd).toBe("2026-10-18");
    expect(state.workspace.backlogFullscreen).toBe(false);
  });
});
