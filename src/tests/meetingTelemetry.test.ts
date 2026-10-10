import {describe,expect,it,vi} from 'vitest'
import {canComputeMeetingExplanation,canParseMeetingTurnLocally} from '../agents/meetingCallPolicy'

describe('shared meeting telemetry runtime',()=>{
 it('retains one data source across new module instances and attributes concurrent guards by request',async()=>{
  const old=await import('../agents/meetingTelemetry')
  old.clearMeetingLlmTelemetry()
  const record=(id:string)=>({requestId:id,requestType:'explain' as const,model:'deepseek-flash',latencyMs:1,success:true,retryCount:0,fallbackReason:null})
  old.recordMeetingTelemetry(record('first'))
  vi.resetModules()
  const fresh=await import('../agents/meetingTelemetry')
  fresh.recordMeetingTelemetry(record('second'))
  fresh.updateMeetingTelemetry('first',{success:false,fallbackReason:'inconsistent_response'})
  expect(old.getMeetingTelemetryRuntimeId()).toBe(fresh.getMeetingTelemetryRuntimeId())
  expect(old.getMeetingLlmTelemetry()).toEqual(fresh.getMeetingLlmTelemetry())
  expect(old.getMeetingLlmTelemetry()).toMatchObject([{requestId:'first',success:false},{requestId:'second',success:true}])
 })
 it('unsubscribes listeners and makes zero-call decisions observable',async()=>{
  const telemetry=await import('../agents/meetingTelemetry'),listener=vi.fn()
  const unsubscribe=telemetry.subscribeMeetingTelemetry(listener)
  telemetry.recordSkippedModelCall('materials','打包 ZIP','archive_original_asset_bytes')
  expect(listener).toHaveBeenCalledTimes(1)
  unsubscribe();telemetry.clearMeetingLlmTelemetry()
  expect(listener).toHaveBeenCalledTimes(1)
 })
 it('keeps novel reasoning on the provider path',()=>{
  expect(canComputeMeetingExplanation('risk','沿已登记依赖计算晚2天的影响')).toBe(true)
  expect(canComputeMeetingExplanation('risk','深入分析并制定风险缓解策略')).toBe(false)
  expect(canComputeMeetingExplanation('risk','这个风险怎么缓解？')).toBe(false)
  expect(canComputeMeetingExplanation('plan','论证当前已经保存的方案')).toBe(true)
  expect(canParseMeetingTurnLocally('只查询任务状态')).toBe(true)
  expect(canParseMeetingTurnLocally('综合制定冲突消解方案')).toBe(false)
  expect(canParseMeetingTurnLocally('新增一个接口契约校验任务，请论证验收边界')).toBe(true)
 })
})
