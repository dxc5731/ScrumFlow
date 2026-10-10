import { useEffect } from "react"
import { useProjectStore } from "../store/projectStore"

/** 应用内巡检：等持久化恢复后启动，相关数据变更合并检测，每分钟检查日期变化。 */
export function useEventMonitor() {
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      if (!useProjectStore.persist.hasHydrated()) return
      clearTimeout(timeout)
      timeout = setTimeout(() => useProjectStore.getState().refreshProjectEvents(), 250)
    }
    const unsubscribe = useProjectStore.subscribe((state, previous) => {
      if (["project", "tasks", "subtasks", "stories", "sprints", "members", "dependencies", "acceptanceCriteria", "proposals"].some(
        key => state[key as keyof typeof state] !== previous[key as keyof typeof previous],
      )) schedule()
    })
    const hydrated = useProjectStore.persist.onFinishHydration(schedule)
    const interval = setInterval(schedule, 60_000)
    schedule()
    return () => { unsubscribe(); hydrated(); clearTimeout(timeout); clearInterval(interval) }
  }, [])
}
