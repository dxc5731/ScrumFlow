import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {coordinateMeetingTurn} from '../agents/meetingDecision'
import {resetProjectStoreForTests,useProjectStore} from '../store/projectStore'

describe('one provider request for an explicit novel draft',()=>{
 beforeEach(()=>resetProjectStoreForTests())
 afterEach(()=>vi.unstubAllGlobals())
 it('skips duplicate intent parsing while retaining model-created work and Proposal review',async()=>{
  const modes:string[]=[]
  vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{
   if(url!=='/api/meeting-llm')return new Response('{}',{status:404})
   const request=JSON.parse(String(options?.body));modes.push(request.mode)
   return new Response(JSON.stringify({model:'deepseek-v4-pro',content:JSON.stringify({summary:'新增校验工作，尚未执行',items:[{parentType:'story',parentId:'us030',title:'验收接口契约校验',estimate:2,assigneeId:'m3',type:'backend'}]})}))
  }))
  const initial=useProjectStore.getState(),meeting=initial.createMeeting('story','us030'),state=useProjectStore.getState(),original=JSON.stringify(state.tasks)
  const result=await coordinateMeetingTurn(state,state.meetingSessions[meeting.id],'task_decomposition','新增一个接口契约校验任务，2h，请论证验收边界，先不要应用。')
  expect(modes).toEqual(['draft_work'])
  expect(result.answer.proposal?.actions).toHaveLength(1)
  expect(result.answer.proposal?.actions[0]).toMatchObject({actionType:'CREATE_TASK',decision:'pending',status:'pending'})
  expect(JSON.stringify(useProjectStore.getState().tasks)).toBe(original)
 })
})
