import { afterEach, beforeEach, vi } from "vitest"

/** 固定演示数据的规划场景日期；只模拟 Date，网络与异步计时器仍正常运行。 */
export function usePlanningFixtureClock() {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-09-21T10:00:00+08:00"))
  })
  afterEach(() => vi.useRealTimers())
}
