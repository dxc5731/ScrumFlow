import {beforeEach,describe,expect,it,vi} from 'vitest'
import {generateMeetingMaterials} from '../agents/materialOrganizer'
import {buildMeetingContext,memoryFor} from '../agents/meetingContext'
import {buildMaterialEvidenceBundle,materialEvidenceForModel} from '../agents/materialEvidence'
import {createPlanOptions} from '../agents/meetingPlanning'
import {commitPlanOptions} from '../agents/meetingWorkingState'
import {requestMeetingModel} from '../agents/meetingLlm'
import {getBlob,putBlob} from '../store/blobStore'
import {resetProjectStoreForTests,useProjectStore} from '../store/projectStore'
import JSZip from 'jszip'

vi.mock('../agents/meetingLlm',()=>({requestMeetingModel:vi.fn(),getMeetingLlmTelemetry:()=>[],parseModelObject:JSON.parse}))
vi.mock('../agents/materialFiles',()=>({
 documentFiles:vi.fn(async(title:string,source:string)=>[{name:title+'.docx',blob:new Blob([source]),sourceText:source}]),
 spreadsheetFiles:vi.fn(async(artifact:unknown)=>[{name:'问题清单.xlsx',blob:new Blob([JSON.stringify(artifact)]),sourceText:JSON.stringify(artifact)}]),
 renderMaterialDiagram:vi.fn(),
}))
vi.mock('../store/blobStore',()=>({createBlobKey:()=>crypto.randomUUID(),putBlob:vi.fn(async()=>{}),getBlob:vi.fn(),deleteBlob:vi.fn(async()=>{})}))

describe('material provider cost boundary',()=>{
 beforeEach(()=>{resetProjectStoreForTests();vi.clearAllMocks()})
 it('exports Store minutes and a scoped spreadsheet without a paid generation preflight',async()=>{
  const store=useProjectStore.getState(),meeting=store.createMeeting('story','us024'),state=useProjectStore.getState(),session=state.meetingSessions[meeting.id],context=buildMeetingContext(state,session)
  for(const question of ['生成会议纪要','生成 Sprint 2 问题清单 Excel']){
   const answer=await generateMeetingMaterials(state,session,context,question)
   expect(answer.artifactIds?.length).toBeGreaterThan(0)
   expect(answer.modelUsed).toBe(false)
  }
  expect(requestMeetingModel).not.toHaveBeenCalled()
  expect(putBlob).toHaveBeenCalledTimes(2)
 })
 it('packages original bytes, preserves separate assets, and never requests model output',async()=>{
  const store=useProjectStore.getState(),meeting=store.createMeeting('story','us030')
  const input=new Uint8Array([0,255,32,10,128]),asset=store.createAsset({name:'original.bin',kind:'attachment',mimeType:'application/octet-stream',storage:'local-file',contentRef:'original-bytes',sizeBytes:input.length,sourceText:'source',links:[],version:'v1'})
  store.addMeetingMessage(meeting.id,{senderType:'agent',senderId:'material_organizer',content:'saved',artifactIds:[asset.id]})
  vi.mocked(getBlob).mockResolvedValue(new Blob([input]))
  const state=useProjectStore.getState(),session=state.meetingSessions[meeting.id]
  const answer=await generateMeetingMaterials(state,session,buildMeetingContext(state,session),'生成 ZIP 材料包')
  const archive=vi.mocked(putBlob).mock.calls[0][1],zip=await JSZip.loadAsync(await archive.arrayBuffer())
  expect(await zip.file('original.bin')!.async('uint8array')).toEqual(input)
  expect(useProjectStore.getState().assets[asset.id]).toEqual(asset)
  expect(answer.artifactIds).toContain(asset.id)
  expect(requestMeetingModel).not.toHaveBeenCalled()
 })
 it('keeps genuinely new creative materials on the model path',async()=>{
  vi.mocked(requestMeetingModel).mockResolvedValue(JSON.stringify({title:'报告',summary:'新创作报告',artifacts:[{kind:'document',title:'需求报告',markdown:'# 需求报告\n\n这是需要模型创作的新报告，设计假设明确标注。'}]}))
  const store=useProjectStore.getState(),meeting=store.createMeeting('story','us030'),state=useProjectStore.getState(),session=state.meetingSessions[meeting.id]
  const answer=await generateMeetingMaterials(state,session,buildMeetingContext(state,session),'创作需求说明书')
  expect(requestMeetingModel).toHaveBeenCalledOnce()
  const payload=vi.mocked(requestMeetingModel).mock.calls[0][1] as Record<string,unknown>
  expect(payload.recentMessages).toBeUndefined()
  expect((payload.evidenceBundle as Record<string,unknown>).storeAfterApplySnapshot).toBeUndefined()
  expect(answer.modelUsed).toBe(true)
 })
 it('retains the identity and constraints of older unreviewed discussion plans when compacting evidence',()=>{
  const store=useProjectStore.getState(),meeting=store.createMeeting('story','us030'),memory=memoryFor(meeting)
  memory.activePlanId='A';memory.constraints.maxTotalHours=16;memory.constraints.maxHours=16
  commitPlanOptions(memory,createPlanOptions(store,meeting,memory),store)
  memory.constraints.maxTotalHours=18;memory.constraints.maxHours=18
  commitPlanOptions(memory,createPlanOptions(store,meeting,memory),store)
  store.setMeetingMemory(meeting.id,memory)
  const state=useProjectStore.getState(),session=state.meetingSessions[meeting.id],bundle=buildMaterialEvidenceBundle(state,session,buildMeetingContext(state,session)),compact=materialEvidenceForModel(bundle)
  const old=bundle.planRevisions[0]
  expect(compact.discussionPlans).toContainEqual(expect.objectContaining({planId:old.planId,revision:old.revision,status:'discussion_only'}))
  expect(compact.discussionPlans[0].constraintsSnapshot.maxTotalHours).toBe(16)
  expect(compact.plans.at(-1)?.constraintsSnapshot.maxTotalHours).toBe(18)
 })
})
