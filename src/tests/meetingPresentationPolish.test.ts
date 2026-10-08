import { describe, expect, it, vi } from "vitest"
import { presentMeetingReply } from "../agents/meetingPresentation"
import { latestMeetingFiles, materialFamilyId } from "../agents/materialIdentity"
import { mergeMeetingConstraints } from "../agents/meetingWorkingState"
import { memoryFor } from "../agents/meetingContext"
import { coordinateMeetingTurn } from "../agents/meetingDecision"
import { resetProjectStoreForTests, useProjectStore } from "../store/projectStore"
import { meetingVoicePrompt } from "../../server/meetingModelService"
import { createDemoProjectState } from "../data/demoProject"
import type { DesignAssetEntity } from "../types"

describe("meeting presentation polish", () => {
 it("does not create details just because terminology or bold formatting became shorter", () => {
  const shown = presentMeetingReply("当前 Store 中这项工作仍待办。\n\n**要先确认前置字段，再继续接口。**", createDemoProjectState())
  expect(shown.details).toBe(""); expect(shown.main).toContain("项目记录")
 })
 it("keeps evidence and tables only in the complementary disclosure", () => {
  const shown = presentMeetingReply("当前最需要先确认数据模型。\n\n建议先明确交接时间。\n\n详细依据\n\nDATA-024 → 连接线 → 测试\n\n| 工作 | 工时 |\n|---|---|\n| 连接线 | 6h |", createDemoProjectState())
  expect(shown.main).toContain("先确认数据模型"); expect(shown.details).toContain("DATA-024")
  expect(shown.details).not.toContain("建议先明确交接时间"); expect(shown.details).not.toContain("当前最需要")
 })
 it("keeps all three decision headings visible instead of hiding the whole numbered report", () => {
  const intro="会上真正需要你拍板的就三件，其余先放一放。"
  const shown=presentMeetingReply(intro+"\n\n"+["今天确认数据模型","是否继续本轮交付","明确接口阻塞原因"].map((title,i)=>(i+1)+". **"+title+"。** "+"这是相关证据，需要进一步确认具体情况。".repeat(6)).join("\n"),createDemoProjectState(),"project_orchestrator")
  expect(shown.main).toContain("今天确认数据模型"); expect(shown.main).toContain("是否继续本轮交付"); expect(shown.main).toContain("明确接口阻塞原因")
  expect(shown.main).not.toContain("这是相关证据"); expect(shown.details).not.toContain(intro)
 })
 it("archives latest format per identity and retains explicit independent copies", () => {
  const asset = (id: string, key: string, date: string, copyId?: string) => ({id,name:"会议纪要.docx",links:[],kind:"attachment",mimeType:"application/octet-stream",storage:"local-file",contentRef:"blob",preview:"",version:"v1.0",createdAt:date,updatedAt:date,sourceText:JSON.stringify({_meeting:{id:"meeting-a",key,scope:"meeting",copyId}})} as DesignAssetEntity)
  const first=asset("a","minutes","2026-10-01"), latest=asset("b","minutes","2026-10-02"), copy=asset("c","minutes","2026-10-03","copy")
  expect(latestMeetingFiles([first,latest,copy]).map(a=>a.id)).toEqual(["b","c"])
  expect(materialFamilyId(copy)).not.toBe(materialFamilyId(latest))
 })
 it("honors the spoken exclusion when choosing who can take the task", () => {
  resetProjectStoreForTests(); const store=useProjectStore.getState(); const meeting=store.createMeeting("story","us030")
  const constraints=mergeMeetingConstraints(memoryFor(meeting).constraints,"接口谁比较适合接，先不安排李娜？",store,[])
  expect(constraints.excludedMemberIds).toContain("m2")
 })
 it("answers current assigned interface capacity without letting an old plan replace applied facts", async () => {
  resetProjectStoreForTests(); const store=useProjectStore.getState()
  const parent=store.createTask("us030",{title:"实现 Story 验收状态与结果记录",estimate:3.5,assigneeId:"m2"})
  store.updateTask(parent.id,{assigneeId:"m2"})
  const step=store.addSubtask(parent.id,"实现验收结果记录接口")
  store.updateSubtask(step.id,{assigneeId:"m3",estimate:2})
  const validation=store.addSubtask(parent.id,"验收结果校验")
  store.updateSubtask(validation.id,{assigneeId:"m3",estimate:1.5})
  const session={...store.createMeeting("story","us030"),presentationMode:"defense" as const}
  store.addMeetingMessage(session.id,{senderType:"agent",senderId:"workload_capacity",content:"之前讨论的方案A准备把父任务交给王晨，尚未采纳。"})
  const live=useProjectStore.getState(), current={...live.meetingSessions[session.id],presentationMode:"defense" as const}
  const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("read-only capacity must stay local"))
  try {
   const result=await coordinateMeetingTurn(live,current,"workload_capacity","US030 的验收结果记录接口现在谁比较适合接，先不安排李娜？")
   expect(result.answer.content).toContain("已经由陈林负责")
   expect(result.answer.content).toContain("约 2h")
   expect(result.answer.content).toContain("不再重复加一次")
   expect(result.answer.content).not.toContain("交给王晨")
   expect(result.llmReplyUsed).toBe(false); expect(result.llmFallback).toBe(false)
   const order=await coordinateMeetingTurn(live,{...current,memory:result.memory},"task_decomposition","US030 现有验收任务应该按什么顺序推进？只解释分工与前置关系。")
   expect(order.answer.content).toContain("李娜");expect(order.answer.content).toContain("陈林");expect(order.answer.content).not.toContain("王晨")
   expect(order.llmReplyUsed).toBe(false);expect(order.llmFallback).toBe(false)
   expect(network).not.toHaveBeenCalled()
   expect(useProjectStore.getState().tasks[parent.id].assigneeId).toBe("m2")
   expect(useProjectStore.getState().subtasks[step.id].assigneeId).toBe("m3")
  } finally { network.mockRestore() }
 })
 it("injects distinct employees into the original grounded call", () => {
  const lina=meetingVoicePrompt({projectFacts:{digitalMember:{name:"李娜"}}}), chen=meetingVoicePrompt({projectFacts:{digitalMember:{name:"陈林"}}})
  expect(lina).toContain("不拍死"); expect(chen).toContain("接口范围"); expect(lina).toContain("不虚构")
 })
})
