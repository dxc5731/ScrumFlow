import { useSyncExternalStore } from "react"
import { getLocalSaveStatus, isLocalRestoreBlocked, retryLocalSave, subscribeLocalSave } from "../../store/localPersistence"
import { useProjectStore } from "../../store/projectStore"

export default function LocalSaveStatus() {
  const status = useSyncExternalStore(subscribeLocalSave, getLocalSaveStatus)
  if (status.state !== "error") return null
  return <div role="alert" className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
    <span>{status.message}</span><button className="secondary-button" onClick={() => { void (isLocalRestoreBlocked() ? useProjectStore.persist.rehydrate() : retryLocalSave()) }}>重试保存</button>
  </div>
}
