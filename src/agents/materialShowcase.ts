import type { DesignAssetEntity, MeetingContext, MeetingSession, ProjectDataState } from "../types"
import type { AgentAnswer } from "./meetingConversation"
import { agentName } from "./meetingConversation"
import { getMeetingLlmTelemetry, parseModelObject, requestMeetingModel } from "./meetingLlm"
import { projectFactsForModel } from "./meetingModelContext"
import { materialBundleSchema, safeMaterialFilename, validateDiagramSource, type MaterialArtifact } from "./materialSchema"
import { documentFiles, renderMaterialDiagram, spreadsheetFiles, type GeneratedMaterialFile } from "./materialFiles"
import { createBlobKey, deleteBlob, getBlob, putBlob } from "../store/blobStore"
import { useProjectStore } from "../store/projectStore"
import { buildMaterialEvidenceBundle, materialEvidenceForModel, materialScope } from "./materialEvidence"
import { standardMaterial, standardMaterialKind } from "./materialStandards"
import { recommendMeetingMaterials } from "./materialRecommendations"
import { readableMeeting } from "./meetingPresentation"
import { latestMeetingFiles, materialFileId, materialIdentityScope, type MeetingArtifactMetadata } from "./materialIdentity"
import { recordSkippedModelCall } from "./meetingTelemetry"

export function materialMetadata(asset: DesignAssetEntity) {
  try { return JSON.parse(asset.sourceText) as MaterialArtifact & { _meeting?: MeetingArtifactMetadata } }
  catch { return null }
}

function fingerprint(state: ProjectDataState, session: MeetingSession, context: MeetingContext, key: string) {
  const source = JSON.stringify({ key, narrative: ["minutes", "teacher-overview"].includes(key) ? session.narrative?.text : undefined, ...(["minutes", "teacher-overview", "wbs", "gantt"].includes(key) ? { formatVersion: key === "wbs" ? 3 : 2 } : {}), focus: context.focus, project: state.project, stories: state.stories, tasks: state.tasks,
    subtasks: state.subtasks, dependencies: state.dependencies, risks: state.risks, members: state.members, sprints: state.sprints,
    plans: session.memory?.workingState?.planRevisions, proposals: session.proposalIds.map(id => state.proposals[id]), facts: session.facts,
    topics: session.topics?.filter(topic => topic.type !== "general") })
  let hash = 2166136261
  for (let index = 0; index < source.length; index++) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619)
  return String(hash >>> 0)
}

export function rememberMaterialDraft(state: ProjectDataState, session: MeetingSession, context: MeetingContext, question: string, candidate: unknown) {
  context = materialScope(state, context, question)
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem(`meeting-material-draft:${session.id}:${question.trim()}`, JSON.stringify({ fingerprint: fingerprint(state, session, context, `creative:${question.trim()}`), candidate }))
}

async function saveFiles(state: ProjectDataState, context: MeetingContext, files: GeneratedMaterialFile[], description: string) {
  const saved: Array<{ key: string; file: GeneratedMaterialFile }> = []
  try {
    for (const file of files) { const key = createBlobKey(); await putBlob(key, file.blob); saved.push({ key, file }) }
    const store = useProjectStore.getState()
    if (store.project.id !== state.project.id) throw new Error("生成期间项目已切换，请在原项目重新生成材料")
    const links = [{ targetType: "project" as const, targetId: state.project.id },
      ...(context.focusSprintId ? [{ targetType: "sprint" as const, targetId: context.focusSprintId }] : []),
      ...context.focusStoryIds.filter(id => store.stories[id]).map(id => ({ targetType: "story" as const, targetId: id }))]
    return saved.map(({ key, file }) => {
      const input = { name: file.name, kind: file.blob.type.startsWith("image/") ? "image" as const : file.blob.type === "application/pdf" ? "pdf" as const : "attachment" as const,
        mimeType: file.blob.type, storage: "local-file" as const, contentRef: key, sourceText: file.sourceText, preview: description, sizeBytes: file.blob.size, links }
      const candidate = { ...input, id: "", version: "v1.0", createdAt: "", updatedAt: "" }
      const existing = Object.values(useProjectStore.getState().assets).filter(asset => materialFileId(asset) === materialFileId(candidate)).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      if (!existing) return useProjectStore.getState().createAsset({ ...input, version: "v1.0" }).id
      const priorMeta = materialMetadata(existing), newMeta = materialMetadata(candidate)
      if (priorMeta?._meeting?.inPackage && newMeta?._meeting) input.sourceText = JSON.stringify({ ...newMeta, _meeting: { ...newMeta._meeting, inPackage: true } })
      const version = Number(existing.version.match(/\d+/)?.[0] ?? 1) + 1
      const result = useProjectStore.getState().updateAsset(existing.id, { ...input, version: `v${version}.0` })
      if (!result.ok) throw new Error(result.message)
      // The old Blob remains available to the existing ChangeHistory snapshot.
      return existing.id
    })
  } catch (error) { await Promise.allSettled(saved.map(item => deleteBlob(item.key))); throw error }
}

export async function renameMeetingMaterial(state: ProjectDataState, ids: string[], title: string): Promise<string[]> {
  title = safeMaterialFilename(title.trim())
  const assets = ids.map(id => state.assets[id]).filter(Boolean), metadata = assets[0] && materialMetadata(assets[0])
  const generated = metadata?.kind === "document" ? await documentFiles(title, metadata.markdown.replace(/^#\s+[^\n]+/, `# ${title}`)) : []
  for (const asset of assets) {
    const replacement = generated.find(file => file.name.split(".").at(-1) === asset.name.split(".").at(-1))
    if (replacement) await putBlob(asset.contentRef, replacement.blob)
    const source = materialMetadata(asset)
    const result = useProjectStore.getState().updateAsset(asset.id, { name: `${title}.${asset.name.split(".").at(-1)}`,
      sourceText: source ? JSON.stringify({ ...source, title, ...(source.kind === "document" ? { markdown: source.markdown.replace(/^#\s+[^\n]+/, `# ${title}`) } : {}) }) : asset.sourceText,
      ...(replacement ? { sizeBytes: replacement.blob.size } : {}) })
    if (!result.ok) throw new Error(result.message)
  }
  recordSkippedModelCall("materials", `修改标题为${title}`, "local_material_title_edit")
  return assets.map(asset => asset.id)
}

export async function generateMeetingMaterials(state: ProjectDataState, session: MeetingSession, context: MeetingContext, question: string): Promise<AgentAnswer> {
  if (session.presentationMode === "defense" && ["minutes", "teacher"].includes(standardMaterialKind(question) ?? "")) {
    const { ensureMeetingNarrative } = await import("./meetingNarrative")
    await ensureMeetingNarrative(session.id)
    state = useProjectStore.getState(); session = state.meetingSessions[session.id]
  }
  context = materialScope(state, context, question)
  const copyId = /另存(?:一份|为)|保存副本/.test(question) ? crypto.randomUUID() : undefined
  const bundle = buildMaterialEvidenceBundle(state, session, context)
  const allIds = readableMeeting(state, session).assetIds
  const priorIds = [...new Set(context.recentMessages.filter(message => message.senderId === "material_organizer").slice(-2).flatMap(message => message.artifactIds ?? []))]
  const answer = (content: string, artifactIds: string[], modelUsed = false, evidence: string[] = []): AgentAnswer => ({ agentType: "material_organizer", content, artifactIds, modelUsed, evidence, rawEvidence: [] })
  const newTitle = question.match(/(?:标题|名称|名字)[\s\S]{0,12}(?:改为|改成|改到|修改为|为)[：:\s]*[“"「]?([^”"」\n]+)[”"」]?/)?.[1]?.replace(/[。！]+$/, "").trim()
  if (newTitle) {
    const explicitOverview = /汇报.*概览|概览.*标题/.test(question)
    const candidates = explicitOverview ? allIds : priorIds
    const primary = [...candidates].reverse().map(id => state.assets[id]).find(asset => asset && !asset.name.endsWith(".zip") && (!explicitOverview || /概览/.test(asset.name)))
    if (!primary) throw new Error("请先生成一份材料，再告诉我新标题")
    const title = primary.name.replace(/\.[^.]+$/, ""), ids = candidates.filter(id => state.assets[id]?.name.replace(/\.[^.]+$/, "") === title)
    return answer(`标题已经改为「${newTitle}」，可以继续预览或下载。`, await renameMeetingMaterial(state, ids, newTitle))
  }
  if (/ZIP|打包|材料包/i.test(question) && !/老师|汇报/.test(question)) {
    const ids = latestMeetingFiles(allIds.map(id => state.assets[id])).filter(asset => !asset.name.endsWith(".zip")).map(asset => asset.id)
    if (!ids.length) throw new Error("本会议尚无可打包资产，请先生成材料")
    const mark = ids.map(id => `${id}:${state.assets[id].updatedAt}`).join(";")
    const existing = allIds.filter(id => materialMetadata(state.assets[id])?._meeting?.fingerprint === mark)
    if (existing.length) { recordSkippedModelCall("materials", question, "reuse_existing_bundle"); return answer("成果包已经准备好了，直接下载就可以。", [...ids, ...existing]) }
    const { default: JSZip } = await import("jszip"), zip = new JSZip(), names = new Set<string>()
    for (const id of ids) {
      const asset = state.assets[id], blob = await getBlob(asset.contentRef)
      if (!blob) throw new Error(`「${asset.name}」暂时无法读取，请重新生成这份材料`)
      const name = names.has(asset.name) ? `${asset.id}-${asset.name}` : asset.name
      names.add(name); zip.file(name, await blob.arrayBuffer())
    }
    const bytes = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } })
    const created = await saveFiles(state, context, [{ name: "本次会议成果包.zip", blob: bytes, sourceText: JSON.stringify({ assetIds: ids, _meeting: { id: session.id, key: "zip", scope: "meeting", fingerprint: mark, copyId } }) }], "包含本次会议的原始成果文件，适合交作业或汇报。")
    recordSkippedModelCall("materials", question, "archive_original_asset_bytes")
    return answer("本次会议的成果已经打包，可以一键带走。", [...ids, ...created])
  }
  const kind = standardMaterialKind(question)
  if (kind === "teacher") {
    const view = readableMeeting(state, session), recommendations = recommendMeetingMaterials(state, session)
    const selected = recommendations.filter(item => item.key !== "changes" && item.key !== "actions").slice(0, 6)
    if (!selected.some(item => item.key === "minutes")) selected.unshift({ key: "minutes", title: "正式会议纪要", description: "", question: "生成正式会议纪要" })
    selected.push({ key: "excel", title: "Excel 数据附件", description: "", question: `生成 ${state.sprints[context.focusSprintId ?? ""]?.name ?? "当前 Sprint"} Excel` })
    const overview: MaterialArtifact = { kind: "document", title: "老师汇报 · 项目与 AI 协作概览", markdown: `# ${state.project.name} · 课堂汇报\n\n## 项目概况\n\n${state.project.goal || state.project.name}\n\n当前共有 ${Object.keys(state.stories).length} 条用户故事、${Object.keys(state.tasks).length} 个工程任务。\n\n## 本次会议核心结论\n\n${view.summary.join("\n\n")}\n\n## 成员分工\n\n${view.actions.filter(action => action.tone !== "rejected").map(action => `- ${action.title}：${action.member}，${action.status}`).join("\n") || view.participants.join("、")}${view.rejected ? `\n\n另有 ${view.rejected} 项建议本次未采用，保留在纪要中供查阅。` : ""}\n\n## AI Agent 参与记录\n\n${session.qaTrace?.map(trace => `- ${trace.input.replace(/^@\S+\s*/, "")} → ${trace.calledAgents.map(agentName).join("、") || "项目主持"}`).join("\n") || view.agents.join("、")}\n\n## 实际项目变化\n\n${view.changes.join("\n\n")}\n\n## 本次汇报材料\n\n${selected.slice(0, 7).map(item => `- ${item.title}`).join("\n")}` }
    const priorOverview = allIds.map(id => state.assets[id]).filter(asset => materialMetadata(asset)?._meeting?.key === "teacher-overview").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    if (priorOverview) overview.title = priorOverview.name.replace(/\.[^.]+$/, "")
    const overviewIds = await persistArtifacts([overview], state, session, context, "teacher-overview", false)
    const ids = [...overviewIds.ids], failures: string[] = []
    for (const item of selected.slice(0, 7)) {
      try { const current = useProjectStore.getState(); const result = await generateMeetingMaterials(current, current.meetingSessions[session.id], context, item.question); ids.push(...result.artifactIds ?? []) }
      catch (error) { failures.push(`${item.title}：${error instanceof Error ? error.message : "暂未完成"}`) }
    }
    recordSkippedModelCall("materials", question, "standard_teacher_presentation")
    return answer(`🎓 **老师汇报材料已整理好。**\n\n从项目概况、会议结论到图形和数据附件，可以按下方顺序预览，也可以一键下载成果包。${failures.length ? `\n\n需要补充：${failures.join("；")}` : ""}`, [...new Set(ids)])
  }
  const diagramType = /用例图/.test(question) ? "usecase" : /活动图/.test(question) ? "activity" : /时序图/.test(question) ? "sequence" : /类图/.test(question) ? "class" : null
  const key = kind ?? (diagramType ? `uml:${diagramType}` : `creative:${question.trim()}`), mark = fingerprint(state, session, context, key)
  const cached = Object.values(state.assets).filter(asset => { const meta = materialMetadata(asset)?._meeting; return meta?.id === session.id && meta.key === key && !meta.copyId && (meta.scope ?? materialIdentityScope(key, context)) === materialIdentityScope(key, context) && meta.fingerprint === mark })
  if (cached.length && !copyId && !/重新生成|重画/.test(question)) {
    recordSkippedModelCall("materials", question, "reuse_existing_asset")
    return answer("这份成果已经准备好了，我把它拿过来，直接预览或下载即可。", cached.map(asset => asset.id))
  }
  if (kind === "gantt" || kind === "storymap") {
    const { captureGanttView, captureStoryMapView, planningImagePdf } = await import("../utils/exportImage")
    const title = kind === "gantt" ? `${state.sprints[context.focusSprintId ?? ""]?.name ?? "当前 Sprint"} 彩色甘特图` : "项目用户故事地图"
    const png = kind === "gantt" ? await captureGanttView({ sprintId: context.focusSprintId ?? state.workspace.selectedSprintId, fullScope: true }) : await captureStoryMapView()
    const sourceText = JSON.stringify({ kind: "view-export", title, source: kind === "gantt" ? "Gantt View Export" : "StoryMap View Export", _meeting: { id: session.id, key, scope: materialIdentityScope(key, context), fingerprint: mark, copyId } })
    const files = [{ name: `${title}.png`, blob: png, sourceText }, ...(kind === "gantt" ? [{ name: `${title}.pdf`, blob: await planningImagePdf(png), sourceText }] : [])]
    const ids = await saveFiles(state, context, files, kind === "gantt" ? "来自系统彩色甘特图页面，保留真实任务层级、负责人、状态和依赖。" : "来自系统故事地图页面，展示用户活动、用户任务和 Story 的关系。")
    recordSkippedModelCall("materials", question, "existing_planning_view_export")
    return answer(kind === "gantt" ? "彩色甘特图已经导出，和系统页面使用同一套视图。" : "用户故事地图已经整理好，可以直接展示产品全貌。", ids, false, ["模型调用：0", "来源：现有系统页面导出"])
  }
  let artifacts: MaterialArtifact[], summary: string
  if (kind) {
    artifacts = [standardMaterial(kind, state, session, context)]
    summary = `**${artifacts[0].title}已经整理好。**\n\n可以直接预览、下载，或加入本次会议成果包。`
    recordSkippedModelCall("materials", question, "canonical_evidence_export")
  } else {
    const requestId = crypto.randomUUID()
    const cacheKey = `meeting-material-draft:${session.id}:${question.trim()}`
    let staged: { fingerprint: string; candidate: unknown } | null = null
    try { staged = JSON.parse(sessionStorage.getItem(cacheKey) ?? "null") } catch { /* A corrupt draft can be replaced. */ }
    const diagram = /UML|用例图|活动图|时序图|类图|流程图/i.test(question)
    const compactFacts = { project: { name: state.project.name, goal: state.project.goal },
      stories: context.focusStoryIds.map(id => state.stories[id]).filter(Boolean).map(story => ({ id: story.id, title: story.title, as: story.as, iWant: story.iWant, soThat: story.soThat,
        acceptanceCriteria: story.acceptanceCriteriaIds.map(id => state.acceptanceCriteria[id]?.content),
        tasks: story.taskIds.map(id => state.tasks[id]).filter(Boolean).map(task => ({ title: task.title, type: task.type })) })),
      members: Object.values(state.members).map(member => ({ name: member.name, role: member.role })),
      note: "按需求和验收标准形成设计图，需求中描述的能力不自动代表当前实现或已完成。" }
    const reusedDraft = staged?.fingerprint === mark
    let candidate = reusedDraft ? staged!.candidate : null
    if (candidate) recordSkippedModelCall("materials", question, "reuse_generated_design_draft")
    else {
      const content = await requestMeetingModel("materials", { question, meetingId: session.id, projectFacts: diagram ? compactFacts : projectFactsForModel(state, context),
        ...(!diagram ? { evidenceBundle: materialEvidenceForModel(bundle), priorArtifacts: [...new Set(priorIds.map(id => state.assets[id]?.sourceText).filter(Boolean))].slice(-8) } : {}) }, true, requestId)
      candidate = content ? parseModelObject(content) : null
      if (candidate) rememberMaterialDraft(state, session, context, question, candidate)
    }
    const parsed = materialBundleSchema.safeParse(candidate)
    if (!parsed.success) throw new Error("材料还没有生成完整，请重试或一次生成一种材料")
    artifacts = parsed.data.artifacts; summary = parsed.data.summary
    const model = getMeetingLlmTelemetry().find(record => record.requestId === requestId)?.model ?? "Pro"
    const ganttRequested = artifacts.some(artifact => artifact.kind === "diagram" && (/^gantt\b/.test(artifact.mermaid) || /甘特/.test(artifact.title)))
    artifacts = artifacts.filter(artifact => !(artifact.kind === "diagram" && (/^gantt\b/.test(artifact.mermaid) || /甘特/.test(artifact.title))))
    const result = artifacts.length ? await persistArtifacts(artifacts, state, session, context, key, true, copyId) : { ids: [], failures: [], modelUsed: false }
    if (ganttRequested) { const actual = await generateMeetingMaterials(useProjectStore.getState(), session, context, "生成当前 Sprint 甘特图"); result.ids.push(...actual.artifactIds ?? []) }
    return answer(`${summary}${result.failures.length ? `\n需要补充：${result.failures.join("；")}` : ""}`, result.ids, !reusedDraft || result.modelUsed, [`生成模型：${reusedDraft ? "复用已有设计，0 调用" : model}`, "事实依据：项目记录与本次会议；新图形属于设计材料"])
  }
  const result = await persistArtifacts(artifacts, state, session, context, key, false, copyId)
  return answer(summary, result.ids, result.modelUsed, ["模型调用：0", "事实依据：项目记录与本次会议"])
}

async function persistArtifacts(artifacts: MaterialArtifact[], state: ProjectDataState, session: MeetingSession, context: MeetingContext, key: string, allowRepair: boolean, copyId?: string) {
  const mark = fingerprint(state, session, context, key)
  const files: GeneratedMaterialFile[] = [], failures: string[] = []
  let modelUsed = false
  for (const [index, artifact] of artifacts.entries()) {
    try {
      let generated: GeneratedMaterialFile[]
      if (artifact.kind === "document") generated = await documentFiles(artifact.title, artifact.markdown)
      else if (artifact.kind === "spreadsheet") generated = await spreadsheetFiles(artifact)
      else {
        let rendered: Awaited<ReturnType<typeof renderMaterialDiagram>>
        try { artifact.mermaid = validateDiagramSource(artifact.mermaid, artifact.title); rendered = await renderMaterialDiagram(artifact.mermaid) }
        catch (error) {
          if (!allowRepair) throw error
          const repaired = await requestMeetingModel("repair_diagram", { meetingId: session.id, source: artifact.mermaid, error: error instanceof Error ? error.message.slice(0, 1600) : "图表无法解析" }, true)
          modelUsed = true; artifact.mermaid = validateDiagramSource(repaired ?? artifact.mermaid, artifact.title); rendered = await renderMaterialDiagram(artifact.mermaid)
        }
        const name = safeMaterialFilename(artifact.title)
        generated = [{ name: `${name}.png`, blob: rendered.png, sourceText: artifact.mermaid },
          { name: `${name}.svg`, blob: new Blob([rendered.svg], { type: "image/svg+xml;charset=utf-8" }), sourceText: artifact.mermaid },
          { name: `${name}.mmd`, blob: new Blob([artifact.mermaid], { type: "text/plain;charset=utf-8" }), sourceText: artifact.mermaid }]
      }
      const description = artifact.kind === "diagram" ? "用图形讲清角色、流程和关系，适合课堂展示。" : artifact.kind === "spreadsheet" ? `Excel · ${artifact.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0)} 条记录，便于查看分工和项目依据。` : "整理本次会议的结论和后续安排，便于成员跟进与老师阅读。"
      files.push(...generated.map(file => ({ ...file, sourceText: JSON.stringify({ ...artifact, _meeting: { id: session.id, key, scope: materialIdentityScope(key, context), artifactId: [session.id, key, materialIdentityScope(key, context), copyId ?? "", ...(artifacts.length > 1 ? [String(index), artifact.kind] : [])].join(":"), copyId, fingerprint: mark, description } }) })))
    } catch (error) { failures.push(`${artifact.title}：${error instanceof Error ? error.message.slice(0, 240) : "文件生成失败"}`) }
  }
  if (!files.length) throw new Error(`本次材料暂未完成。${failures.join("；")}`)
  return { ids: await saveFiles(state, context, files, "材料整理 Agent 根据本次会议生成的项目成果。"), failures, modelUsed }
}
