import { addDays, format, parseISO } from "date-fns"

/** Fit the dates of visible bars with a three-day lead-in. */
export function fitGanttRange(
  ranges: Array<{ startDate: string; endDate: string }>,
  fallback: { startDate: string; endDate: string },
) {
  const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date))
  const starts = ranges.map(item => item.startDate).filter(valid).sort()
  const ends = ranges.map(item => item.endDate).filter(valid).sort()
  const startDate = starts.length ? format(addDays(parseISO(starts[0]), -3), "yyyy-MM-dd") : fallback.startDate
  const endDate = [fallback.endDate, ends.length ? format(addDays(parseISO(ends.at(-1)!), 3), "yyyy-MM-dd") : "", startDate].sort().at(-1)!
  return { startDate, endDate }
}
