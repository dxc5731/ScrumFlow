import { afterEach, describe, expect, it, vi } from "vitest"
import { Readable } from "node:stream"
import type { IncomingMessage, ServerResponse } from "node:http"
import { meetingLlmMiddleware } from "../../server/meetingModelService"

async function invoke(mode: string, question: string, splitUtf8 = false, extraPayload: Record<string, unknown> = {}) {
  const encoded = Buffer.from(JSON.stringify({ mode, payload: { question, ...extraPayload } }), "utf8")
  const offset = encoded.indexOf(Buffer.from("中")) + 1
  const request = Object.assign(Readable.from(splitUtf8 ? [encoded.subarray(0, offset), encoded.subarray(offset)] : [encoded]), { method: "POST", url: "/api/meeting-llm" })
  let body = ""
  const response = { statusCode: 0, setHeader: vi.fn(), end: (value: string) => { body = value } }
  await meetingLlmMiddleware(request as unknown as IncomingMessage, response as unknown as ServerResponse, () => {})
  return { status: response.statusCode, body: JSON.parse(body) }
}

describe("model service boundary", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
  it("keeps Chinese characters intact across network chunks and uses Pro for materials", async () => {
    vi.stubEnv("MEETING_LLM_API_KEY", "test-key")
    vi.stubEnv("MATERIALS_LLM_MODEL", "deepseek-v4-pro")
    let payload: Record<string, any> = {}
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
      payload = JSON.parse(options.body)
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"中文文档"}' }, finish_reason: "stop" }] }), { status: 200 })
    }))
    const result = await invoke("materials", "中文材料请完整生成", true)
    expect(result.status).toBe(200)
    expect(result.body.model).toBe("deepseek-v4-pro")
    expect(JSON.parse(payload.messages[1].content).question).toBe("中文材料请完整生成")
    expect(payload.max_tokens).toBeGreaterThan(8000)
  })
  it("does not return truncated material as a successful file", async () => {
    vi.stubEnv("MEETING_LLM_API_KEY", "test-key")
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: '{"artifacts":[' } }] }), { status: 200 })))
    const result = await invoke("materials", "完整报告")
    expect(result.status).toBe(503)
    expect(result.body.errorCode).toBe("truncated_response")
    expect(result.body.content).toBeUndefined()
  })
  it("rejects an unsupported operation before contacting the model", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    expect((await invoke("__proto__", "错误模式")).status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })
  it("reports insufficient balance accurately without retrying paid generation", async () => {
    vi.stubEnv("MEETING_LLM_API_KEY", "test-key")
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Insufficient Balance" } }), { status: 402 }))
    vi.stubGlobal("fetch", fetch)
    const result = await invoke("materials", "生成项目报告")
    expect(result.body.errorCode).toBe("insufficient_balance")
    expect(result.body.error).toContain("余额不足")
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result.body.retryCount).toBe(0)
    expect(result.body.metrics.attempts).toBe(1)
  })
  it('returns actual usage and context sizes without exposing provider reasoning',async()=>{
    vi.stubEnv('MEETING_LLM_API_KEY','test-key')
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'ok'}}],usage:{prompt_tokens:123,completion_tokens:45,total_tokens:168}}))))
    const result=await invoke('interpret','中文输入',false,{recentMessages:[{content:'之前的对话'}]})
    expect(result.body.usage).toEqual({prompt_tokens:123,completion_tokens:45,total_tokens:168})
    expect(result.body.metrics).toMatchObject({attempts:1})
    expect(result.body.metrics.inputBytes).toBeGreaterThan(result.body.metrics.transcriptBytes)
    expect(result.body.metrics.providerLatencyMs).toBeGreaterThanOrEqual(0)
  })
  it.each([
    ["当前任务进度是多少", "deepseek-flash", "none"],
    ["分析依赖延期影响并给出缓解建议", "deepseek-v4-pro", "high"],
    ["全面分析全项目最优排期方案", "deepseek-v4-pro", "max"],
  ])("sends the selected model and official thinking settings: %s", async (question, model, effort) => {
    vi.stubEnv("MEETING_LLM_API_KEY", "test-key")
    vi.stubEnv("MEETING_LLM_FAST_MODEL", "deepseek-flash")
    vi.stubEnv("MEETING_LLM_EXPLAIN_MODEL", "deepseek-v4-pro")
    let sent: Record<string, any> = {}
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
      sent = JSON.parse(options.body)
      return new Response(JSON.stringify({ choices: [{ message: { content: "最终回答", reasoning_content: "internal reasoning" }, finish_reason: "stop" }] }), { status: 200 })
    }))
    const result = await invoke("explain", question, false, { speaker: "risk_dependency", projectFacts: { tasks: Array.from({ length: 10 }, (_, id) => ({ id })) } })
    expect(sent.model).toBe(model)
    expect(sent.thinking).toEqual({ type: effort === "none" ? "disabled" : "enabled" })
    expect(sent.reasoning_effort).toBe(effort === "none" ? undefined : effort)
    expect(result.body.routing.effort).toBe(effort)
    expect(result.body.content).toBe("最终回答")
    expect(JSON.stringify(result.body)).not.toContain("internal reasoning")
  })
})
