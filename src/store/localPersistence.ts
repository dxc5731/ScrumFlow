import type { StateStorage } from "zustand/middleware"

const PROJECT_STATE_ENDPOINT = "/api/local-project"
let writeQueue = Promise.resolve()

async function requestState(method: "GET" | "PUT" | "DELETE", value?: string) {
  return fetch(PROJECT_STATE_ENDPOINT, {
    method,
    headers: value === undefined ? undefined : { "Content-Type": "application/json; charset=utf-8" },
    body: value,
  })
}

function enqueueWrite(operation: () => Promise<void>) {
  writeQueue = writeQueue.catch(() => undefined).then(operation)
  return writeQueue
}

export const localProjectStorage: StateStorage = {
  async getItem(name) {
    const response = await requestState("GET")
    if (response.ok) {
      const value = await response.text()
      if (typeof window !== "undefined") window.localStorage.removeItem(name)
      return value
    }
    if (response.status !== 404) throw new Error(`本地项目数据读取失败（${response.status}）`)

    const legacy = typeof window === "undefined" ? null : window.localStorage.getItem(name)
    if (!legacy) return null

    await enqueueWrite(async () => {
      const migration = await requestState("PUT", legacy)
      if (!migration.ok) throw new Error(`旧项目数据迁移失败（${migration.status}）`)
      window.localStorage.removeItem(name)
    })
    return legacy
  },

  setItem(_name, value) {
    return enqueueWrite(async () => {
      const response = await requestState("PUT", value)
      if (!response.ok) throw new Error(`本地项目数据保存失败（${response.status}）`)
    })
  },

  removeItem() {
    return enqueueWrite(async () => {
      const response = await requestState("DELETE")
      if (!response.ok && response.status !== 404)
        throw new Error(`本地项目数据删除失败（${response.status}）`)
    })
  },
}
