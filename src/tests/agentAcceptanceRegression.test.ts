// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"
import { selectMemberWorkload, selectSprintMetrics } from "../store/selectors"
import { buildProjectAnalysisSnapshot, buildProjectAnalysisSnapshotForScope } from "../agents/meetingSnapshot"
import { memoryFor } from "../agents/meetingContext"
import { digitalMemberAnswer } from "../agents/digitalMember"
import { projectPlanCapacity } from "../agents/meetingCapacity"
import { buildEventAction } from "../components/planning/EventInsightPanel"
import { detectProjectEvents, type EventKind } from "../utils/eventDetection"
import { buildWorkloadSnapshot, projectDate } from "../utils/workloadAnalysis"
import { useEventMonitor } from "../hooks/useEventMonitor"

const NOW = new Date("2026-10-10T10:00:00+08:00")
beforeEach(() => { resetProjectStoreForTests(); vi.useFakeTimers(); vi.setSystemTime(NOW); localStorage.clear() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

function proposed(kind: EventKind) {
  const state = useProjectStore.getState()
  const event = detectProjectEvents(state, "s2", NOW).find(event => event.kind === kind)!
  expect(event).toBeTruthy()
  const proposal = state.createProposal({ origin: "event", triggerType: "manual", agentType: "project_monitor",
    targetType: event.targetType, targetId: event.targetId, summary: event.title, reasoning: event.summary, evidence: [], actions: [buildEventAction(event)] })
  state.setProposalDecision(proposal.id, proposal.actions[0].id, "accepted")
  return { event, proposal }
}

describe("shared analysis and reviewed execution", () => {
  it("counts remaining leaf work by actual assignee, excludes completed work, and agrees across all entry points", () => {
    const base = useProjectStore.getState(), template = base.tasks["fe-024-2"]
    const parent = { ...template, id: "parent", estimate: 100, progress: 50, assigneeId: "m1", subtaskIds: ["a", "b", "finished"], status: "in_progress" as const }
    const step = (id: string, estimate: number, progress: number, assigneeId: string, done = false) => ({ ...template, id, taskId: parent.id, estimate, progress, assigneeId, done, status: done ? "done" as const : "in_progress" as const })
    useProjectStore.setState({
      tasks: { parent, solo: { ...template, id: "solo", estimate: 8, progress: 50, subtaskIds: [], assigneeId: "m2" }, completed: { ...template, id: "completed", status: "done", estimate: 100, subtaskIds: [] } },
      subtasks: { a: step("a", 8, 25, "m1"), b: step("b", 10, 50, "m2"), finished: step("finished", 4, 100, "m2", true) },
      stories: { [template.storyId]: { ...base.stories[template.storyId], taskIds: ["parent", "solo", "completed"], sprintId: "s2" } },
    })
    const state = useProjectStore.getState(), meeting = state.createMeeting("sprint", "s2"), memory = memoryFor(meeting)
    const snapshot = buildProjectAnalysisSnapshot(state, meeting, memory, NOW)
    const eventSnapshot = buildProjectAnalysisSnapshotForScope(state, { projectId: state.project.id, scopeId: "event", targetType: "sprint", targetId: "s2" }, NOW)
    expect(snapshot.members).toEqual(eventSnapshot.members)
    expect(snapshot.tasks.parent.remainingHours).toBe(11)
    expect(snapshot.members.m1.currentSprintWorkload).toBe(6)
    expect(snapshot.members.m2.currentSprintWorkload).toBe(9)
    expect(snapshot.members.m2.remainingTimeCapacity).toBe(0)
    expect(snapshot.members.m2.remainingCapacity).toBe(-9)
    expect(snapshot.members.m2.planningCapacity).toBeGreaterThan(0)
    const page = selectMemberWorkload(state, "m2", NOW, "s2")
    expect(page.plannedHours).toBe(9)
    expect(page.capacityHours).toBe(0)
    expect(selectSprintMetrics(state, "s2", NOW).memberHours.m2).toBe(9)
    expect(projectPlanCapacity(state, "s2", [], NOW).members.m2.currentLoad).toBe(9)
    expect(detectProjectEvents(state, "s2", NOW).find(event => event.kind === "workload" && event.targetId === "m2")?.summary).toContain("剩余 9h")
    expect(digitalMemberAnswer(state, meeting, memory, "m2", "还能接 8h 工作吗，不修改", snapshot).content).toContain("9h 未完成工作")
    const transfer = [{ key: parent.id, sourceTaskId: parent.id, storyId: parent.storyId, title: parent.title, type: parent.type, estimate: parent.estimate, assigneeId: "m3", phase: "", dependsOnKeys: [], subtaskTitles: [], startDate: parent.startDate, endDate: parent.endDate }]
    expect(projectPlanCapacity(state, "s2", transfer, NOW).members.m3.delta).toBe(0)
    expect(projectDate(new Date("2026-10-09T16:01:00Z"))).toBe("2026-10-10")
  })

  it("distinguishes inclusive planning and remaining working-day capacity, including an expired Sprint", () => {
    const state = useProjectStore.getState()
    useProjectStore.setState({ sprints: { ...state.sprints, s2: { ...state.sprints.s2, startDate: "2026-10-09", endDate: "2026-10-12" } } })
    const snapshot = buildWorkloadSnapshot(useProjectStore.getState(), "s2", NOW)
    expect(snapshot.planningWorkingDays).toBe(2)
    expect(snapshot.remainingWorkingDays).toBe(1)
    expect(snapshot.members.m2.planningCapacity).toBe(16)
    expect(snapshot.members.m2.remainingTimeCapacity).toBe(8)
    expect(buildWorkloadSnapshot(useProjectStore.getState(), "s2", new Date("2026-10-13T00:00:00+08:00")).members.m2.remainingTimeCapacity).toBe(0)
  })

  it("rejects an old overdue action after its deadline changes, without writing history", () => {
    const { event, proposal } = proposed("deadline"), state = useProjectStore.getState()
    state.updateTask(event.targetId, { endDate: "2027-01-01" })
    expect(state.applyProposal(proposal.id).ok).toBe(false)
    const latest = useProjectStore.getState()
    expect(latest.proposals[proposal.id].actions[0].status).toBe("stale")
    expect(latest.history.some(item => item.proposalId === proposal.id)).toBe(false)
  })

  it("rejects an old acceptance reminder after criteria are added", () => {
    const state = useProjectStore.getState(), story = state.stories.us024
    useProjectStore.setState({ stories: { ...state.stories, [story.id]: { ...story, acceptanceCriteriaIds: [] } }, acceptanceCriteria: Object.fromEntries(Object.entries(state.acceptanceCriteria).filter(([, item]) => item.storyId !== story.id)) })
    const { proposal } = proposed("acceptance")
    useProjectStore.setState({ stories: { ...useProjectStore.getState().stories, [story.id]: story }, acceptanceCriteria: state.acceptanceCriteria })
    expect(state.applyProposal(proposal.id).ok).toBe(false)
    expect(useProjectStore.getState().proposals[proposal.id].actions[0].status).toBe("stale")
  })

  it("rejects blocking after the only predecessor finishes", () => {
    const state = useProjectStore.getState(), target = state.tasks["test-024"], source = state.tasks["fe-024-2"]
    useProjectStore.setState({ dependencies: { only: { id: "only", sourceTaskId: source.id, targetTaskId: target.id, type: "FS", createdAt: NOW.toISOString() } } })
    const { proposal } = proposed("dependency")
    state.updateTask(source.id, { status: "done" })
    expect(state.applyProposal(proposal.id).ok).toBe(false)
    expect(useProjectStore.getState().proposals[proposal.id].actions[0].status).toBe("stale")
  })

  it("allows unrelated edits and reuses existing risk results across repeated submissions and clicks", () => {
    const first = proposed("deadline"), second = proposed("deadline"), state = useProjectStore.getState()
    state.updateProject({ subtitle: "unrelated edit" })
    state.updateTask(first.event.targetId, { qualityNote: "unrelated note" })
    expect(state.applyProposal(first.proposal.id).ok).toBe(true)
    const count = Object.keys(useProjectStore.getState().risks).length
    expect(state.applyProposal(second.proposal.id).ok).toBe(true)
    expect(state.applyProposal(first.proposal.id).ok).toBe(true)
    const latest = useProjectStore.getState()
    expect(Object.keys(latest.risks)).toHaveLength(count)
    expect(latest.proposals[second.proposal.id].actions[0].executionOutcome).toBe("existing")
    expect(latest.history.some(item => item.proposalId === first.proposal.id)).toBe(true)
    expect(latest.history.some(item => item.proposalId === second.proposal.id)).toBe(false)
  })

  it("reports mixed-action outcomes and retries without repeating a successful write", () => {
    const { proposal } = proposed("deadline"), state = useProjectStore.getState()
    const invalid = { ...proposal.actions[0], id: "invalid", decision: "accepted" as const, proposedValue: { ...proposal.actions[0].proposedValue, ownerId: "missing" } }
    state.updateProposal(proposal.id, { actions: [...useProjectStore.getState().proposals[proposal.id].actions, invalid] })
    expect(state.applyProposal(proposal.id).ok).toBe(false)
    const after = useProjectStore.getState(), count = Object.keys(after.risks).length
    expect(after.proposals[proposal.id].status).toBe("partially_applied")
    expect(after.proposals[proposal.id].actions.map(action => action.status)).toEqual(["applied", "failed"])
    state.applyProposal(proposal.id)
    expect(Object.keys(useProjectStore.getState().risks)).toHaveLength(count)
  })
})

describe("local event lifecycle and recovery", () => {
  it("automatically reconciles changed facts and checks the next project date without manual scanning", () => {
    const view = renderHook(() => useEventMonitor())
    act(() => { vi.advanceTimersByTime(250) })
    const state = useProjectStore.getState()
    const record = Object.values(state.projectEvents).find(record => record.sprintId === "s2" && record.event.kind === "deadline")!
    expect(record).toBeTruthy()
    act(() => { state.updateTask(record.event.targetId, { endDate: "2027-01-01" }); vi.advanceTimersByTime(250) })
    expect(useProjectStore.getState().projectEvents[record.id].status).toBe("resolved")
    const count = Object.keys(useProjectStore.getState().projectEvents).length
    act(() => { vi.advanceTimersByTime(60_250) })
    expect(Object.keys(useProjectStore.getState().projectEvents)).toHaveLength(count)
    act(() => { vi.setSystemTime(new Date("2026-10-11T10:00:00+08:00")); vi.advanceTimersByTime(60_250) })
    const workload = Object.values(useProjectStore.getState().projectEvents).find(record => record.sprintId === "s2" && record.event.kind === "workload")!
    expect(workload.event.evidence.some(text => text.includes("2026-10-11"))).toBe(true)
    view.unmount()
  })

  it("retains unresolved issues after risk registration, resolves only when the condition disappears, and restores records and audit", () => {
    const state = useProjectStore.getState()
    state.refreshProjectEvents(NOW)
    const { event, proposal } = proposed("deadline"), key = `s2:${event.id}`
    state.applyProposal(proposal.id)
    state.refreshProjectEvents(NOW)
    const count = Object.keys(useProjectStore.getState().projectEvents).length
    expect(useProjectStore.getState().projectEvents[key].status).toBe("suggested")
    state.refreshProjectEvents(NOW)
    expect(Object.keys(useProjectStore.getState().projectEvents)).toHaveLength(count)
    state.updateTask(event.targetId, { endDate: "2027-01-01" })
    state.refreshProjectEvents(NOW)
    expect(useProjectStore.getState().projectEvents[key].status).toBe("resolved")
    const exported = state.exportProjectJson()
    resetProjectStoreForTests()
    expect(useProjectStore.getState().importProjectJson(exported).ok).toBe(true)
    expect(useProjectStore.getState().projectEvents[key].status).toBe("resolved")
    expect(useProjectStore.getState().history.some(item => item.proposalId === proposal.id)).toBe(true)
  })

  it("preserves deliberate ignore semantics across repeated scans and resolution", () => {
    const state = useProjectStore.getState()
    state.refreshProjectEvents(NOW)
    const record = Object.values(useProjectStore.getState().projectEvents).find(record => record.event.kind === "deadline")!
    state.ignoreProjectEvent(record.id)
    state.updateTask(record.event.targetId, { endDate: "2027-01-01" })
    state.refreshProjectEvents(NOW)
    expect(useProjectStore.getState().projectEvents[record.id].status).toBe("ignored")
  })

  it("keeps a recovery copy after save failure, restores it after refresh, and retries the latest snapshot", async () => {
    vi.resetModules()
    const persistence = await import("../store/localPersistence")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })))
    const value = JSON.stringify({ state: { projectEvents: { event: { status: "pending" } } }, version: 16 })
    await persistence.localProjectStorage.setItem("project", value)
    expect(persistence.getLocalSaveStatus().state).toBe("error")
    expect(localStorage.getItem("scrumflow-pending-project-save")).toBe(value)
    vi.resetModules()
    let persisted = "old snapshot"
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      if (init.method === "PUT") { persisted = init.body; return new Response(null, { status: 204 }) }
      return new Response(JSON.stringify({ state: {} }), { status: 200 })
    }))
    const recovered = await import("../store/localPersistence")
    expect(await recovered.localProjectStorage.getItem("project")).toBe(value)
    await recovered.retryLocalSave()
    expect(persisted).toBe(value)
    expect(recovered.getLocalSaveStatus().state).toBe("saved")
    expect(localStorage.getItem("scrumflow-pending-project-save")).toBeNull()
  })

  it("does not overwrite the real project with default data after a failed initial read", async () => {
    vi.resetModules()
    const persistence = await import("../store/localPersistence")
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 500 }))
    vi.stubGlobal("fetch", fetcher)
    await expect(persistence.localProjectStorage.getItem("project")).rejects.toThrow()
    await persistence.localProjectStorage.setItem("project", JSON.stringify({ state: "default data" }))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem("scrumflow-pending-project-save")).toBeNull()
    expect(persistence.isLocalRestoreBlocked()).toBe(true)
  })
})
