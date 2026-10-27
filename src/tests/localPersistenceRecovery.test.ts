// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const key = "scrumflow-pending-project-save"
const snapshot = JSON.stringify({ state: { project: { name: "恢复项目" } }, version: 16 })
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); localStorage.clear() })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("local persistence recovery protection", () => {
  it.each(["{broken", "null", "[]"])("blocks writes after an invalid file snapshot %s", async (body) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(body))
    vi.stubGlobal("fetch", fetcher)
    const p = await import("../store/localPersistence")
    await expect(p.localProjectStorage.getItem("project")).rejects.toThrow()
    await p.localProjectStorage.setItem("project", snapshot)
    expect(p.isLocalRestoreBlocked()).toBe(true)
    expect(fetcher.mock.calls.every(([, init]) => init.method === "GET")).toBe(true)
    expect(localStorage.getItem(key)).toBeNull()
  })

  it("preserves corrupt recovery data and blocks writes instead of overwriting it", async () => {
    localStorage.setItem(key, "{unfinished")
    const fetcher = vi.fn().mockResolvedValue(new Response(snapshot))
    vi.stubGlobal("fetch", fetcher)
    const p = await import("../store/localPersistence")
    await expect(p.localProjectStorage.getItem("project")).rejects.toThrow()
    await p.localProjectStorage.setItem("project", snapshot)
    expect(p.isLocalRestoreBlocked()).toBe(true)
    expect(localStorage.getItem(key)).toBe("{unfinished")
    expect(fetcher.mock.calls.every(([, init]) => init.method === "GET")).toBe(true)
  })

  it("restores a valid file when browser storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("storage disabled") })
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("storage disabled") })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(snapshot)))
    const p = await import("../store/localPersistence")
    expect(await p.localProjectStorage.getItem("project")).toBe(snapshot)
    expect(p.isLocalRestoreBlocked()).toBe(false)
    expect(p.getLocalSaveStatus().state).toBe("saved")
  })

  it("clears the restore error after a successful retry and permits saving", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValue(new Response(snapshot))
    vi.stubGlobal("fetch", fetcher)
    const p = await import("../store/localPersistence")
    await expect(p.localProjectStorage.getItem("project")).rejects.toThrow()
    expect(await p.localProjectStorage.getItem("project")).toBe(snapshot)
    expect(p.getLocalSaveStatus()).toEqual({ state: "saved", message: "" })
    await p.localProjectStorage.setItem("project", snapshot)
    expect(fetcher.mock.calls.at(-1)?.[1].method).toBe("PUT")
  })

  it("recovers the latest unsaved snapshot while the server is unavailable", async () => {
    localStorage.setItem(key, snapshot)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })))
    const p = await import("../store/localPersistence")
    expect(await p.localProjectStorage.getItem("project")).toBe(snapshot)
    await p.retryLocalSave()
    expect(p.isLocalRestoreBlocked()).toBe(false)
    expect(localStorage.getItem(key)).toBe(snapshot)
    expect(p.getLocalSaveStatus().state).toBe("error")
  })
})
