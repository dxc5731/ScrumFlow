import { useState } from "react"
import { FileStack, GraduationCap, Sparkles } from "lucide-react"
import type { ProjectDataState } from "../../types"
import { generatedRecommendationKeys, recommendMeetingMaterials } from "../../agents/materialRecommendations"
import { generateMeetingMaterials } from "../../agents/materialOrganizer"
import { buildMeetingContext } from "../../agents/meetingContext"
import { useProjectStore } from "../../store/projectStore"
import MeetingMaterials from "./MeetingMaterials"
import { readableMeeting } from "../../agents/meetingPresentation"

export default function MaterialSuggestions({ state, sessionId, showAssets = true, onBusyChange, focusKeys, reason, onMaterials }: { state: ProjectDataState; sessionId: string; showAssets?: boolean; onBusyChange?: (busy: boolean) => void; focusKeys?: string[]; reason?: string; onMaterials?: () => void }) {
  const session = state.meetingSessions[sessionId]
  const suggestions = recommendMeetingMaterials(state, session).filter(item => !focusKeys || focusKeys.includes(item.key))
  const generated = generatedRecommendationKeys(state, session)
  const [selected, setSelected] = useState<string[] | null>(null)
  const [busy, setBusy] = useState("")
  const [result, setResult] = useState("")
  const [error, setError] = useState("")
  const assetIds = readableMeeting(state, session).assetIds
  const chosen = selected ?? suggestions.map(item => item.key)
  const generate = async (all: boolean, teacher = false) => {
    if (busy) return
    onBusyChange?.(true)
    setError(""); setResult("")
    const items = teacher ? [{ key: "teacher", title: "老师汇报材料", question: "准备一套老师汇报材料" }] : all ? suggestions : suggestions.filter(item => chosen.includes(item.key))
    let count = 0
    const artifactIds = new Set<string>()
    const failures: string[] = []
    for (const item of items) {
      setBusy(`正在整理 ${item.title}…`)
      try {
        const current = useProjectStore.getState(), meeting = current.meetingSessions[sessionId]
        const answer = await generateMeetingMaterials(current, meeting, buildMeetingContext(current, meeting), item.question)
        if (answer.artifactIds?.length) { answer.artifactIds.forEach(id => artifactIds.add(id)); count++ }
        else failures.push(`${item.title}：${answer.content}`)
      } catch (cause) { failures.push(`${item.title}：${cause instanceof Error ? cause.message : "暂未完成"}`) }
    }
    const current = useProjectStore.getState()
    const feedback = teacher ? "老师汇报材料已准备好。可以在这里预览，也已归档到会议材料。" : `${count} 项成果已生成或复用。可以直接预览和下载，完整文件已归档到会议材料。`
    if (artifactIds.size && current.meetingSessions[sessionId].status === "active") current.addMeetingMessage(sessionId, { senderType: "agent", senderId: "material_organizer", content: feedback + (failures.length ? `\n\n还有材料未完成：${failures.join("；")}` : ""), artifactIds: [...artifactIds] })
    setResult(count ? "成果已归档到会议材料，可预览和下载。" : "本次尚未生成成果。"); setError(failures.join("；")); setBusy(""); onBusyChange?.(false)
  }
  if (!suggestions.length) return null
  return <section className="meeting-suggestions" aria-label="AI 推荐会议成果">
    <div className="meeting-suggestions-title"><Sparkles size={18} /><div><h3>{focusKeys ? "这一段讨论，值得留下这些成果" : "根据本次会议，我建议整理这些成果"}</h3><p>{reason ?? "选择需要的成果，已有材料会复用或更新为最新版本。"}</p></div></div>
    <div className="meeting-suggestion-options">{suggestions.map(item => <label key={item.key} title={item.description}><input type="checkbox" disabled={Boolean(busy)} checked={chosen.includes(item.key)} onChange={() => setSelected(chosen.includes(item.key) ? chosen.filter(key => key !== item.key) : [...chosen, item.key])} />{item.title}{generated.has(item.key) && <small>已生成</small>}</label>)}</div>
    <div className="meeting-suggestion-buttons"><button className="meeting-primary" disabled={Boolean(busy) || !chosen.length} onClick={() => void generate(false)}><FileStack size={15} />{busy || "生成所选成果"}</button>{onMaterials ? <button disabled={Boolean(busy)} onClick={onMaterials}>查看全部建议 →</button> : <button disabled={Boolean(busy)} onClick={() => void generate(true, true)}><GraduationCap size={15} />准备老师汇报</button>}</div>
    {result && <p role="status">{result}</p>}{error && <p className="meeting-material-error" role="alert">{error}</p>}{showAssets && assetIds.length > 0 && <MeetingMaterials ids={assetIds} state={state} />}
  </section>
}
