import { useEffect } from "react"
import { useProjectStore } from "../store/projectStore"

/** Track actual observations across all pages, after persistence restores the real project. */
export function useSprintWorkTracking() {
  useEffect(() => {
    const record = () => {
      if (useProjectStore.persist.hasHydrated())
        useProjectStore.getState().recordSprintWork()
    }
    const unsubscribe = useProjectStore.subscribe((state, previous) => {
      if (
        state.sprintBurndowns !== previous.sprintBurndowns &&
        state.history.at(-1)?.field === "import"
      )
        queueMicrotask(record)
    })
    const finish = useProjectStore.persist.onFinishHydration(record)
    const timer = setInterval(record, 60_000)
    window.addEventListener("focus", record)
    document.addEventListener("visibilitychange", record)
    record()
    return () => {
      unsubscribe()
      finish()
      clearInterval(timer)
      window.removeEventListener("focus", record)
      document.removeEventListener("visibilitychange", record)
    }
  }, [])
}
