import { afterEach, describe, expect, it, vi } from "vitest"
import path from "node:path"
const fs = vi.hoisted(() => ({ mkdir: vi.fn(), appendFile: vi.fn(), readFile: vi.fn() }))
vi.mock("node:fs/promises", () => fs)
afterEach(() => { vi.resetModules(); vi.unstubAllEnvs(); vi.clearAllMocks() })

describe("meeting usage data directory", () => {
  it("writes and reads usage in the configured project directory", async () => {
    vi.stubEnv("PROJECT_DATA_DIRECTORY", path.resolve("output", "isolated-usage"))
    const { recordProviderUsage, readMeetingUsage } = await import("../../server/meetingUsage")
    const entry = await recordProviderUsage({ meetingId: "isolated", mode: "explain", model: "deepseek-v4-flash", at: "2026-10-24", attempt: 1, usage: { prompt_tokens: 20, completion_tokens: 10 } })
    const ledger = path.resolve("output", "isolated-usage", "meeting-usage.jsonl")
    expect(fs.appendFile).toHaveBeenCalledWith(ledger, JSON.stringify(entry) + "\n", "utf8")
    fs.readFile.mockResolvedValue(JSON.stringify(entry) + "\ninvalid line\n")
    expect((await readMeetingUsage("isolated")).records).toEqual([entry])
    expect(fs.readFile).toHaveBeenCalledWith(ledger, "utf8")
  })

  it("keeps the existing default location without an override", async () => {
    vi.stubEnv("PROJECT_DATA_DIRECTORY", "")
    const { readMeetingUsage } = await import("../../server/meetingUsage")
    fs.readFile.mockResolvedValue("")
    expect((await readMeetingUsage()).records).toEqual([])
    expect(fs.readFile).toHaveBeenCalledWith(path.resolve("local-data", "meeting-usage.jsonl"), "utf8")
  })
})
