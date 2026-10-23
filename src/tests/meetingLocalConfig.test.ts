import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import path from "node:path"
import { Readable } from "node:stream"
import type { IncomingMessage, ServerResponse } from "node:http"
const { readFile } = vi.hoisted(() => ({ readFile: vi.fn() }))
vi.mock("node:fs/promises", async () => ({
  ...(await vi.importActual<typeof import("node:fs/promises")>(
    "node:fs/promises",
  )),
  readFile,
}))
import {
  meetingModelConfiguration,
  meetingLlmMiddleware,
} from "../../server/meetingModelService"
beforeEach(() => {
  for (const key of [
    "MEETING_LLM_API_KEY",
    "LLM_API_KEY",
    "DEEPSEEK_API_KEY",
    "SCRUMFLOW_ENV_FILE",
    "SUNNYMIND_ENV_FILE",
    "MEETING_LLM_BASE_URL",
    "LLM_BASE_URL",
    "DEEPSEEK_BASE_URL",
    "MEETING_LLM_MODEL",
    "MEETING_LLM_FAST_MODEL",
    "MEETING_LLM_ADVANCED_MODEL",
    "MEETING_LLM_EXPLAIN_MODEL",
    "MATERIALS_LLM_MODEL",
  ])
    vi.stubEnv(key, undefined)
  readFile.mockReset()
  readFile.mockRejectedValue(new Error("ENOENT"))
})
afterEach(() => vi.unstubAllEnvs())
describe("project-local Agent configuration", () => {
  it("reads only this project by default and leaves a blank key unconfigured", async () => {
    readFile.mockImplementation(async (file: string) =>
      file === path.resolve(".env.local")
        ? "# 中文配置说明\nDEEPSEEK_API_KEY=\nMEETING_LLM_FAST_MODEL=project-flash"
        : "",
    )
    const config = await meetingModelConfiguration()
    expect(config.key).toBeFalsy()
    expect(config.model).toBe("project-flash")
    expect(readFile.mock.calls.map((call) => call[0])).toEqual([
      path.resolve(".env"),
      path.resolve(".env.local"),
    ])
  })
  it("lets explicit local settings override an optional external config, with environment overrides retained", async () => {
    const external = path.resolve("test-explicit-model.env")
    vi.stubEnv("SCRUMFLOW_ENV_FILE", external)
    readFile.mockImplementation(async (file: string) =>
      file === external
        ? "DEEPSEEK_API_KEY=fake-external-key\nMEETING_LLM_BASE_URL=https://external.invalid/v1"
        : file === path.resolve(".env.local")
          ? "DEEPSEEK_API_KEY=fake-local-key\nMEETING_LLM_BASE_URL=https://project.invalid/v1/"
          : "",
    )
    expect(await meetingModelConfiguration()).toMatchObject({
      key: "fake-local-key",
      baseUrl: "https://project.invalid/v1",
    })
    vi.stubEnv("MEETING_LLM_API_KEY", "fake-process-key")
    expect((await meetingModelConfiguration()).key).toBe("fake-process-key")
  })
  it("reports configuration status without sending a model request or exposing a key", async () => {
    readFile.mockResolvedValue("DEEPSEEK_API_KEY=fake-private-value")
    const request = Object.assign(Readable.from([]), {
      method: "GET",
      url: "/api/meeting-llm",
    })
    let body = ""
    const response = {
      statusCode: 0,
      setHeader: vi.fn(),
      end: (value: string) => {
        body = value
      },
    }
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    try {
      await meetingLlmMiddleware(
        request as unknown as IncomingMessage,
        response as unknown as ServerResponse,
        () => {},
      )
      expect(JSON.parse(body).configured).toBe(true)
      expect(body).not.toContain("fake-private-value")
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
