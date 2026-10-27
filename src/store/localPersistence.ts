import type { StateStorage } from "zustand/middleware"

const PROJECT_STATE_ENDPOINT = "/api/local-project"
const RECOVERY_KEY = "scrumflow-pending-project-save"
let writeQueue = Promise.resolve()
let pendingValue: string | null = null
let retryTimer: ReturnType<typeof setTimeout> | undefined
let retryCount = 0
let restoreBlocked = false
export const isLocalRestoreBlocked = () => restoreBlocked
let status = { state: "saved" as "saved" | "saving" | "error", message: "" }
const listeners = new Set<() => void>()

export const subscribeLocalSave = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const getLocalSaveStatus = () => status
function publish(state: typeof status.state, message = "") {
  status = { state, message }
  listeners.forEach(listener => listener())
}

async function requestState(method: "GET" | "PUT" | "DELETE", value?: string) {
  return fetch(PROJECT_STATE_ENDPOINT, {
    method,
    headers: value === undefined ? undefined : { "Content-Type": "application/json; charset=utf-8" },
    body: value,
  })
}

function browserValue(name: string) {
  try { return typeof window === "undefined" ? null : window.localStorage.getItem(name) }
  catch { return null }
}

function validateSnapshot(value: string) {
  const parsed = JSON.parse(value)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      !parsed.state || typeof parsed.state !== "object" || Array.isArray(parsed.state)) {
    throw new Error("本地项目数据格式无效")
  }
}

async function savePending() {
  const value = pendingValue
  if (value === null || restoreBlocked) return
  publish("saving")
  try {
    const response = await requestState("PUT", value)
    if (!response.ok) throw new Error(`本地项目数据保存失败（${response.status}）`)
    if (pendingValue === value) {
      pendingValue = null
      try { if (typeof window !== "undefined") window.localStorage.removeItem(RECOVERY_KEY) } catch { /* 文件保存成功，恢复副本可能保留。 */ }
      retryCount = 0
      publish("saved")
    }
  } catch (error) {
    publish("error", `${error instanceof Error ? error.message : "本地保存失败"}；尚未保存的修改已保留，请重试。`)
    if (retryCount++ < 3) {
      clearTimeout(retryTimer)
      retryTimer = setTimeout(() => { void retryLocalSave() }, Math.min(10_000, retryCount * 2_000))
    }
  }
}

export function retryLocalSave(): Promise<void> {
  clearTimeout(retryTimer)
  writeQueue = writeQueue.catch(() => undefined).then(savePending)
  return writeQueue
}

if (typeof window !== "undefined") window.addEventListener("online", () => { void retryLocalSave() })

export const localProjectStorage: StateStorage = {
  async getItem(name) {
    const recovery = browserValue(RECOVERY_KEY)
    try {
      if (recovery !== null) validateSnapshot(recovery)
      const response = await requestState("GET")
      if (!response.ok && response.status !== 404) throw new Error(`本地项目数据读取失败（${response.status}）`)
      const saved = response.ok ? await response.text() : null
      const legacy = response.status === 404 ? browserValue(name) : null
      const restored = recovery ?? (response.status === 404 ? legacy : null)
      const value = restored ?? saved
      if (value !== null) validateSnapshot(value)
      restoreBlocked = false
      if (restored !== null) {
        pendingValue = restored
        void retryLocalSave()
        return restored
      }
      try { if (saved && typeof window !== "undefined") window.localStorage.removeItem(name) } catch { /* 本地文件已恢复，浏览器存储不可用不影响读取。 */ }
      publish("saved")
      return saved
    } catch (error) {
      publish("error", error instanceof Error ? error.message : "本地数据恢复失败")
      if (recovery !== null) {
        try {
          validateSnapshot(recovery)
          restoreBlocked = false
          pendingValue = recovery
          void retryLocalSave()
          return recovery
        } catch { /* 保留损坏的恢复副本，并阻止默认数据覆盖原文件。 */ }
      }
      restoreBlocked = true
      clearTimeout(retryTimer)
      publish("error", "本地数据读取失败，已停止保存以保护原项目；请重试恢复。")
      throw error
    }
  },

  setItem(_name, value) {
    if (restoreBlocked) { publish("error", "本地数据尚未恢复，已停止保存以保护原项目；请重试恢复。"); return Promise.resolve() }
    pendingValue = value
    try { if (typeof window !== "undefined") window.localStorage.setItem(RECOVERY_KEY, value) }
    catch { publish("error", "浏览器恢复副本保存失败；请保持页面打开，等待本地文件保存成功。") }
    return retryLocalSave()
  },

  removeItem(name) {
    clearTimeout(retryTimer)
    pendingValue = null
    return writeQueue = writeQueue.catch(() => undefined).then(async () => {
      const response = await requestState("DELETE")
      if (!response.ok && response.status !== 404) { publish("error", "本地项目数据删除失败，请重试"); return }
      if (typeof window !== "undefined") { window.localStorage.removeItem(RECOVERY_KEY); window.localStorage.removeItem(name) }
      publish("saved")
    })
  },
}
