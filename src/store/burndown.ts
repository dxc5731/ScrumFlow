import { addDays, differenceInCalendarDays, parseISO } from "date-fns"
import type {
  ProjectDataState,
  SprintBurndown,
  SprintWorkSnapshot,
} from "../types"
import { selectStoryExecutionLeaves, selectSprintStories } from "./selectors"
import {
  projectDate,
  remainingWork,
  roundHours,
} from "../utils/workloadAnalysis"

export function sprintWork(state: ProjectDataState, sprintId: string) {
  let totalHours = 0,
    remainingHours = 0,
    itemCount = 0
  for (const story of selectSprintStories(state, sprintId)) {
    for (const leaf of selectStoryExecutionLeaves(state, story.id)) {
      const item =
        leaf.type === "task" ? state.tasks[leaf.id] : state.subtasks[leaf.id]
      if (!item) continue
      totalHours += Math.max(
        0,
        Number.isFinite(item.estimate) ? item.estimate : 0,
      )
      remainingHours += remainingWork({
        ...item,
        estimate: Math.max(
          0,
          Number.isFinite(item.estimate) ? item.estimate : 0,
        ),
      })
      itemCount++
    }
  }
  return {
    totalHours: roundHours(totalHours),
    remainingHours: roundHours(remainingHours),
    itemCount,
  }
}

/** Observation only: never fill unobserved days or alter an earlier daily snapshot. */
export function observeSprintWork(
  state: ProjectDataState,
  now = new Date(),
  previous?: ProjectDataState,
) {
  const date = projectDate(now)
  let records = state.sprintBurndowns
  for (const sprint of Object.values(state.sprints)) {
    const closing = Boolean(
      previous &&
        sprint.status === "closed" &&
        ["active", "review"].includes(previous.sprints[sprint.id]?.status),
    )
    if (!["active", "review"].includes(sprint.status) && !closing) continue
    const source = closing ? previous! : state
    const existing = records[sprint.id]
    if (existing && Object.keys(existing.days).some((day) => day > date))
      continue
    const work = sprintWork(source, sprint.id)
    const last = existing?.days[date]
    if (
      last &&
      last.totalHours === work.totalHours &&
      last.remainingHours === work.remainingHours &&
      last.itemCount === work.itemCount &&
      !closing
    )
      continue
    const snapshot: SprintWorkSnapshot = {
      date,
      capturedAt: now.toISOString(),
      ...work,
    }
    const startedNow = previous?.sprints[sprint.id]?.status === "planning"
    const record: SprintBurndown = existing ?? {
      sprintId: sprint.id,
      baselineHours: work.totalHours,
      baselineDate: date,
      baselineKind: startedNow ? "sprint-start" : "first-observation",
      days: {},
    }
    records = {
      ...records,
      [sprint.id]: { ...record, days: { ...record.days, [date]: snapshot } },
    }
  }
  return records
}

export function captureWorkChanges(
  previous: ProjectDataState,
  next: ProjectDataState,
  now = new Date(),
) {
  // Import/reset already supplies its own history. Hydration also bypasses this transaction wrapper.
  if (
    previous.sprintBurndowns !== next.sprintBurndowns ||
    previous.project.id !== next.project.id
  )
    return next.sprintBurndowns
  if (
    previous.tasks === next.tasks &&
    previous.subtasks === next.subtasks &&
    previous.stories === next.stories &&
    previous.sprints === next.sprints
  )
    return next.sprintBurndowns
  return observeSprintWork(next, now, previous)
}

const offsetDate = (date: string, days: number) =>
  projectDate(addDays(parseISO(date + "T12:00:00+08:00"), days))
export function sprintBurndown(state: ProjectDataState, sprintId: string) {
  const sprint = state.sprints[sprintId]
  const record = state.sprintBurndowns[sprintId]
  const snapshots = Object.values(record?.days ?? {}).sort((a, b) =>
    a.date.localeCompare(b.date),
  )
  const first = snapshots[0],
    latest = snapshots.at(-1)
  const work =
    sprint.status === "closed" && latest ? latest : sprintWork(state, sprintId)
  const baselineHours = record?.baselineHours ?? work.totalHours
  const elapsed =
    first && latest
      ? differenceInCalendarDays(parseISO(latest.date), parseISO(first.date))
      : 0
  const velocity =
    elapsed > 0 ? (first.remainingHours - latest!.remainingHours) / elapsed : 0
  const forecastDays =
    latest && velocity > 0 ? Math.ceil(latest.remainingHours / velocity) : null
  const forecastDate =
    sprint.status !== "closed" && latest
      ? latest.remainingHours === 0
        ? latest.date
        : forecastDays !== null && forecastDays <= 3650
          ? offsetDate(latest.date, forecastDays)
          : null
      : null
  const start = [sprint.startDate, first?.date ?? sprint.startDate].sort()[0]
  const end = [
    sprint.endDate,
    latest?.date ?? sprint.endDate,
    forecastDate ?? sprint.endDate,
  ]
    .sort()
    .at(-1)!
  const count = Math.min(
    3650,
    Math.max(1, differenceInCalendarDays(parseISO(end), parseISO(start))),
  )
  const sprintDuration = Math.max(
    1,
    differenceInCalendarDays(
      parseISO(sprint.endDate),
      parseISO(sprint.startDate),
    ),
  )
  const idealAt = (date: string) =>
    roundHours(
      baselineHours *
        (1 -
          Math.min(
            1,
            Math.max(
              0,
              differenceInCalendarDays(
                parseISO(date),
                parseISO(sprint.startDate),
              ) / sprintDuration,
            ),
          )),
    )
  const points = Array.from({ length: count + 1 }, (_, index) => {
    const date = offsetDate(start, index)
    return {
      date,
      day:
        differenceInCalendarDays(parseISO(date), parseISO(sprint.startDate)) +
        1,
      ideal: idealAt(date),
      actual: record?.days[date]?.remainingHours ?? null,
      forecast:
        latest &&
        forecastDate &&
        date >= latest.date &&
        date <= forecastDate &&
        sprint.status !== "closed"
          ? roundHours(
              Math.max(
                0,
                latest.remainingHours -
                  velocity *
                    differenceInCalendarDays(
                      parseISO(date),
                      parseISO(latest.date),
                    ),
              ),
            )
          : null,
    }
  })
  return {
    work,
    baselineHours,
    record,
    snapshots,
    latest,
    points,
    velocity,
    forecastDate,
    completedPercent: work.totalHours
      ? Math.round(
          ((work.totalHours - work.remainingHours) / work.totalHours) * 100,
        )
      : 0,
    behind: Boolean(
      latest && latest.remainingHours > idealAt(latest.date) + 0.01,
    ),
    delayed: Boolean(
      latest &&
        latest.remainingHours > 0 &&
        sprint.status !== "closed" &&
        (forecastDate
          ? forecastDate > sprint.endDate
          : elapsed > 0 || latest.date >= sprint.endDate),
    ),
    zeroSpeed: elapsed > 0 && velocity <= 0,
  }
}

export function normalizeSprintBurndowns(
  value: ProjectDataState["sprintBurndowns"] | undefined,
  sprints: ProjectDataState["sprints"],
) {
  if (value === undefined) return {}
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("燃尽历史格式无效")
  const validDate = (date: string) =>
    typeof date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date
  for (const [id, record] of Object.entries(value)) {
    if (
      !sprints[id] ||
      !record ||
      record.sprintId !== id ||
      !Number.isFinite(record.baselineHours) ||
      record.baselineHours < 0 ||
      !validDate(record.baselineDate) ||
      !["sprint-start", "first-observation"].includes(record.baselineKind) ||
      !record.days ||
      typeof record.days !== "object" ||
      Array.isArray(record.days)
    )
      throw new Error("燃尽基线无效：" + id)
    for (const [date, point] of Object.entries(record.days)) {
      if (
        !point ||
        !validDate(date) ||
        point.date !== date ||
        date < record.baselineDate ||
        !Number.isFinite(Date.parse(point.capturedAt)) ||
        projectDate(new Date(point.capturedAt)) !== date ||
        !Number.isFinite(point.totalHours) ||
        point.totalHours < 0 ||
        !Number.isFinite(point.remainingHours) ||
        point.remainingHours < 0 ||
        point.remainingHours > point.totalHours + 0.01 ||
        !Number.isInteger(point.itemCount) ||
        point.itemCount < 0
      )
        throw new Error("燃尽快照无效：" + date)
    }
  }
  return value
}
