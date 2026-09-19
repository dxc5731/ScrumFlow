import { useMemo, useRef, useState } from "react"
import {
  Code2,
  Download,
  Eye,
  FileCode2,
  FileImage,
  FileText,
  Link2,
  MousePointer2,
  Plus,
  Save,
  Trash2,
  Upload,
} from "lucide-react"
import UmlCanvas, { renderUmlCanvasPng } from "../components/uml/UmlCanvas"
import AssetFilePreviewDialog, {
  downloadAssetFile,
} from "../components/assets/AssetFilePreviewDialog"
import { notify } from "../components/planning/ui"
import {
  MAX_FILE_BYTES,
  createBlobKey,
  deleteBlob,
  putBlob,
} from "../store/blobStore"
import { useProjectStore } from "../store/projectStore"
import type {
  AssetLinkTargetType,
  DesignAssetEntity,
  UmlDiagramData,
  UmlDiagramKind,
} from "../types"
import {
  UML_PLANTUML_TEMPLATES,
  generatePlantUml,
  parseUmlSource,
} from "../utils/uml"
import { inferFileMimeType } from "../utils/assetFiles"

const UML_KINDS: UmlDiagramKind[] = ["use-case", "sequence", "class"]

function isUmlAsset(asset?: DesignAssetEntity): asset is DesignAssetEntity & { kind: UmlDiagramKind } {
  return Boolean(asset && UML_KINDS.includes(asset.kind as UmlDiagramKind))
}

function diagramFor(asset?: DesignAssetEntity) {
  if (!isUmlAsset(asset)) return null
  if (asset.umlData?.kind === asset.kind) return asset.umlData
  return parseUmlSource(asset.kind, asset.sourceText).diagram
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function AssetsPage() {
  const state = useProjectStore()
  const uploadRef = useRef<HTMLInputElement>(null)
  const codeImportRef = useRef<HTMLInputElement>(null)
  const captureRef = useRef<HTMLDivElement>(null)
  const initialAsset = state.assets[state.workspace.selectedObjectId ?? ""] ?? Object.values(state.assets)[0]
  const [selectedId, setSelectedId] = useState(initialAsset?.id ?? "")
  const selected = state.assets[selectedId]
  const [source, setSource] = useState(initialAsset?.sourceText ?? "")
  const [name, setName] = useState(initialAsset?.name ?? "")
  const [diagram, setDiagram] = useState<UmlDiagramData | null>(() => diagramFor(initialAsset))
  const [mode, setMode] = useState<"visual" | "code">("visual")
  const [sourceDirty, setSourceDirty] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const [linkType, setLinkType] = useState<AssetLinkTargetType>("story")
  const [linkId, setLinkId] = useState("")
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null)

  const assets = useMemo(
    () => Object.values(state.assets).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [state.assets],
  )
  const linkTargets =
    linkType === "project"
      ? [state.project]
      : linkType === "epic"
        ? Object.values(state.epics)
        : linkType === "story"
          ? Object.values(state.stories)
          : linkType === "task"
            ? Object.values(state.tasks)
            : Object.values(state.sprints)

  const select = (asset: DesignAssetEntity) => {
    setSelectedId(asset.id)
    setName(asset.name)
    setSource(asset.sourceText)
    setDiagram(diagramFor(asset))
    setWarnings([])
    setSourceDirty(false)
    setMode("visual")
    state.setWorkspace({ selectedObjectType: null, selectedObjectId: asset.id, inspectorOpen: false })
  }

  const createUml = (kind: UmlDiagramKind) => {
    const parsed = parseUmlSource(kind, UML_PLANTUML_TEMPLATES[kind])
    const asset = state.createAsset({
      name: kind === "use-case" ? "新用例图" : kind === "sequence" ? "新时序图" : "新类图",
      kind,
      sourceText: generatePlantUml(parsed.diagram),
      umlData: parsed.diagram,
      preview: "可拖拽编辑画布 · 保存后生成 PNG 快照",
      mimeType: "image/png",
      storage: "inline",
    })
    select(asset)
    notify("UML 资产已创建")
  }

  const upload = async (file?: File) => {
    if (!file) return
    if (file.size > MAX_FILE_BYTES) return notify("单个文件不能超过 5MB", "error")
    const lower = file.name.toLowerCase()
    const kind: DesignAssetEntity["kind"] = file.type.startsWith("image/")
      ? "image"
      : file.type === "application/pdf"
        ? "pdf"
        : lower.endsWith(".drawio") || lower.endsWith(".xml")
          ? "drawio"
          : "attachment"
    try {
      const key = createBlobKey()
      await putBlob(key, file)
      const asset = state.createAsset({
        name: file.name,
        kind,
        mimeType: inferFileMimeType(file.name, file.type),
        storage: "local-file",
        contentRef: key,
        preview: `${Math.ceil(file.size / 1024)} KB`,
        sizeBytes: file.size,
      })
      select(asset)
      notify("文件已上传并写入资产中心")
    } catch (error) {
      notify(error instanceof Error ? error.message : "上传失败", "error")
    }
    if (uploadRef.current) uploadRef.current.value = ""
  }

  const importCode = async (file?: File) => {
    if (!file || !isUmlAsset(selected)) return
    const text = await file.text()
    const parsed = parseUmlSource(selected.kind, text, diagram ?? undefined)
    setSource(text)
    setDiagram(parsed.diagram)
    setWarnings(parsed.warnings)
    setSourceDirty(true)
    setMode("code")
    notify(parsed.warnings.length ? `已导入，${parsed.warnings.length} 行需要确认` : "PlantUML 已导入并生成画布", parsed.warnings.length ? "info" : "success")
    if (codeImportRef.current) codeImportRef.current.value = ""
  }

  const applyCode = () => {
    if (!isUmlAsset(selected)) return null
    const parsed = parseUmlSource(selected.kind, source, diagram ?? undefined)
    if (!parsed.diagram.nodes.length && source.trim()) {
      setWarnings(parsed.warnings.length ? parsed.warnings : ["没有识别到可生成的 UML 节点"])
      notify("UML 代码未生成有效节点", "error")
      return null
    }
    const canonicalSource = generatePlantUml(parsed.diagram)
    setDiagram(parsed.diagram)
    setSource(canonicalSource)
    setWarnings(parsed.warnings)
    setSourceDirty(false)
    setMode("visual")
    notify(parsed.warnings.length ? `画布已更新，${parsed.warnings.length} 行未识别` : "代码已生成画布", parsed.warnings.length ? "info" : "success")
    return { diagram: parsed.diagram, source: canonicalSource }
  }

  const changeDiagram = (next: UmlDiagramData) => {
    setDiagram(next)
    setSource(generatePlantUml(next))
    setSourceDirty(false)
    setWarnings([])
  }

  const downloadAsset = async (asset: DesignAssetEntity) => {
    try {
      await downloadAssetFile(asset)
      notify("文件下载已开始")
    } catch (error) {
      notify(error instanceof Error ? error.message : "文件下载失败", "error")
    }
  }

  const remove = async (asset: DesignAssetEntity) => {
    if (!window.confirm(`确定删除资产 ${asset.name} 吗？`)) return
    if (asset.storage === "local-file" || asset.storage === "indexeddb")
      await deleteBlob(asset.contentRef).catch(() => undefined)
    state.deleteAsset(asset.id)
    setSelectedId("")
    setDiagram(null)
  }

  const waitForCaptureRender = () => new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
  })

  const saveUml = async () => {
    if (!isUmlAsset(selected)) return
    let nextDiagram = diagram
    let nextSource = source
    if (sourceDirty) {
      const applied = applyCode()
      if (!applied) return
      nextDiagram = applied.diagram
      nextSource = applied.source
    }
    if (!nextDiagram) return notify("UML 图模型为空", "error")
    setDiagram(nextDiagram)
    setMode("visual")
    try {
      await waitForCaptureRender()
      if (!captureRef.current) throw new Error("后台 UML 渲染器尚未就绪")
      const snapshot = await renderUmlCanvasPng(captureRef.current)
      const snapshotKey = selected.contentRef.startsWith("blob-")
        ? selected.contentRef
        : createBlobKey()
      await putBlob(snapshotKey, snapshot)
      const numericVersion = Number(selected.version.replace(/[^0-9.]/g, "")) || 1
      const result = state.updateAsset(selected.id, {
        name: name.trim() || selected.name,
        sourceText: nextSource,
        umlData: nextDiagram,
        preview: `${nextDiagram.nodes.length} 节点 · ${nextDiagram.edges.length} 连线 · PNG 快照已更新`,
        mimeType: "image/png",
        storage: "local-file",
        contentRef: snapshotKey,
        sizeBytes: snapshot.size,
        version: `v${(numericVersion + 0.1).toFixed(1)}`,
      })
      notify(result.ok ? "UML 与 PNG 快照已保存" : result.message, result.ok ? "success" : "error")
    } catch (error) {
      notify(error instanceof Error ? error.message : "UML 快照保存失败", "error")
    }
  }

  const exportUml = async () => {
    if (!isUmlAsset(selected) || !diagram) return
    try {
      await waitForCaptureRender()
      if (!captureRef.current) throw new Error("后台 UML 渲染器尚未就绪")
      const snapshot = await renderUmlCanvasPng(captureRef.current)
      downloadBlob(`${name || selected.name}.png`, snapshot)
      notify("PNG 图片已导出")
    } catch (error) {
      notify(error instanceof Error ? error.message : "PNG 导出失败", "error")
    }
  }

  const isUml = isUmlAsset(selected)
  return (
    <div className="flex h-full min-h-0 bg-[#F8FAFC]">
      <aside className="flex w-80 flex-shrink-0 flex-col border-r border-[#E2E7EE] bg-white">
        <div className="border-b border-[#E2E7EE] p-4">
          <h1 className="text-sm font-semibold text-[#172033]">设计资产与 UML</h1>
          <p className="mt-1 text-[10px] text-[#667085]">可视化建模、代码转可编辑画布和项目对象关联。</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="secondary-button" onClick={() => uploadRef.current?.click()}><Upload size={13} />上传文件</button>
            <button className="secondary-button" onClick={() => createUml("use-case")}><Plus size={13} />用例图</button>
            <button className="secondary-button" onClick={() => createUml("sequence")}><Plus size={13} />时序图</button>
            <button className="secondary-button" onClick={() => createUml("class")}><Plus size={13} />类图</button>
          </div>
          <input ref={uploadRef} type="file" className="hidden" accept="image/*,.pdf,.drawio,.xml,.txt,.md,.markdown,.csv,.json,.yaml,.yml,.doc,.docx,.ppt,.pptx,.xls,.xlsx" onChange={(event) => upload(event.target.files?.[0])} />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {assets.map((asset) => (
            <button key={asset.id} className="mb-1 flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-[#F9FAFB]" style={{ background: selectedId === asset.id ? "#F2F4F7" : undefined }} onClick={() => select(asset)}>
              {asset.kind === "image" ? <FileImage size={15} /> : asset.kind === "pdf" ? <FileText size={15} /> : <FileCode2 size={15} />}
              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-[#344054]">{asset.name}</span><span className="text-[9px] text-[#98A2B3]">{asset.kind} · {asset.version}</span></span>
            </button>
          ))}
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-5">
        {!selected && <div className="flex h-full items-center justify-center text-xs text-[#98A2B3]">选择或创建一个资产</div>}
        {selected && <div className="mx-auto max-w-[1600px]">
          <div className="mb-4 flex items-center gap-2">
            <input className="form-input max-w-md text-sm font-semibold" value={name} onChange={(event) => setName(event.target.value)} disabled={!isUml} />
            <span className="rounded bg-[#F2F4F7] px-2 py-1 text-[10px] text-[#667085]">{selected.kind}</span>
            {isUml && <>
              <div className="ml-3 flex rounded-lg border border-[#D0D5DD] bg-white p-0.5">
                <button className="toolbar-toggle border-0" data-active={mode === "visual"} onClick={() => setMode("visual")}><MousePointer2 size={12} />可视化</button>
                <button className="toolbar-toggle border-0" data-active={mode === "code"} onClick={() => setMode("code")}><Code2 size={12} />代码导入</button>
              </div>
              <button className="secondary-button ml-auto" onClick={() => codeImportRef.current?.click()}><Upload size={12} />导入代码</button>
              <input ref={codeImportRef} type="file" className="hidden" accept=".puml,.plantuml,.uml,.txt,text/plain" onChange={(event) => importCode(event.target.files?.[0])} />
              <button className="secondary-button" onClick={exportUml}><Download size={12} />导出 PNG</button>
              <button className="primary-button" onClick={saveUml}><Save size={12} />保存</button>
            </>}
            {!isUml && <button className="secondary-button ml-auto" onClick={() => void downloadAsset(selected)}><Download size={12} />下载</button>}
            <button className="icon-button" title="删除资产" onClick={() => remove(selected)}><Trash2 size={15} /></button>
          </div>
          {isUml && diagram ? (
            <div className="h-[calc(100vh-190px)] min-h-[540px] overflow-hidden rounded-lg border border-[#E2E7EE] bg-white">
              {mode === "visual" ? <UmlCanvas diagram={diagram} onChange={changeDiagram} /> : <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_300px]">
                <div className="flex min-h-0 flex-col border-r border-[#E2E7EE]">
                  <div className="flex h-12 items-center border-b border-[#E2E7EE] px-3 text-xs font-semibold text-[#344054]">PlantUML<button className="primary-button ml-auto" onClick={applyCode}><MousePointer2 size={12} />转为可编辑画布</button></div>
                  <textarea className="min-h-0 flex-1 resize-none p-4 font-mono text-xs leading-6 text-[#344054] outline-none" spellCheck={false} value={source} onChange={(event) => { setSource(event.target.value); setSourceDirty(true) }} />
                </div>
                <aside className="overflow-y-auto p-4">
                  <div className="grid grid-cols-2 gap-2"><div className="rounded border border-[#E2E7EE] bg-[#F9FAFB] p-3"><div className="text-[10px] text-[#667085]">节点</div><div className="mt-1 text-xl font-semibold text-[#172033]">{diagram.nodes.length}</div></div><div className="rounded border border-[#E2E7EE] bg-[#F9FAFB] p-3"><div className="text-[10px] text-[#667085]">连线</div><div className="mt-1 text-xl font-semibold text-[#172033]">{diagram.edges.length}</div></div></div>
                  <div className="mt-4 text-xs font-semibold text-[#344054]">解析结果</div>
                  {!warnings.length && <div className="mt-2 rounded border border-[#ABEFC6] bg-[#ECFDF3] p-3 text-[11px] text-[#067647]">PlantUML 子集解析正常</div>}
                  {warnings.map((warning) => <div key={warning} className="mt-2 rounded border border-[#FEDF89] bg-[#FFFAEB] p-2 text-[10px] leading-5 text-[#B54708]">{warning}</div>)}
                  <div className="mt-5 text-xs font-semibold text-[#344054]">节点列表</div>
                  <div className="mt-2 divide-y divide-[#F2F4F7] border-y border-[#F2F4F7]">{diagram.nodes.map((node) => <div key={node.id} className="py-2 text-[10px]"><span className="font-medium text-[#344054]">{node.label}</span><span className="ml-2 text-[#98A2B3]">{node.kind}</span></div>)}</div>
                </aside>
              </div>}
            </div>
          ) : isUml ? <div className="rounded-lg border border-dashed border-[#D0D5DD] p-12 text-center text-xs text-[#98A2B3]">无法读取 UML 图模型</div> : <div className="rounded-lg border border-[#E2E7EE] bg-white"><div className="flex items-center border-b border-[#E2E7EE] p-3"><span className="text-xs text-[#667085]">{selected.mimeType} · {selected.preview}</span><div className="ml-auto flex gap-2"><button className="secondary-button" onClick={() => void downloadAsset(selected)}><Download size={13} />下载</button><button className="primary-button" onClick={() => setPreviewAssetId(selected.id)}><Eye size={13} />在线预览</button></div></div><div className="flex h-72 flex-col items-center justify-center gap-3 bg-[#F8FAFC]"><FileText size={48} className="text-[#98A2B3]" /><div className="text-xs font-medium text-[#475467]">点击“在线预览”在系统内查看文件</div><div className="text-[10px] text-[#98A2B3]">支持 PDF、DOCX、XLS/XLSX、Markdown、图片及常见文本格式</div></div></div>}
          <div className="mt-4 rounded-lg border border-[#E2E7EE] bg-white p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#344054]"><Link2 size={14} />关联项目对象</div>
            <div className="mt-3 flex gap-2"><select className="form-input max-w-40" value={linkType} onChange={(event) => { setLinkType(event.target.value as AssetLinkTargetType); setLinkId("") }}><option value="project">项目</option><option value="epic">Epic</option><option value="story">Story</option><option value="task">Task</option><option value="sprint">Sprint</option></select><select className="form-input" value={linkId} onChange={(event) => setLinkId(event.target.value)}><option value="">选择对象</option>{linkTargets.map((target) => <option key={target.id} value={target.id}>{"title" in target ? target.title : target.name}</option>)}</select><button className="primary-button" onClick={() => { const result = state.linkAsset(selected.id, linkType, linkId); notify(result.message, result.ok ? "success" : "error") }}><Link2 size={13} />关联</button></div>
            <div className="mt-3 flex flex-wrap gap-2">{selected.links.map((link) => <button key={`${link.targetType}-${link.targetId}`} className="rounded border border-[#D0D5DD] bg-[#F9FAFB] px-2 py-1 text-[10px] text-[#475467]" onClick={() => state.unlinkAsset(selected.id, link.targetType, link.targetId)} title="点击解除关联">{link.targetType} · {link.targetId} ×</button>)}</div>
          </div>
        </div>}
      </main>
      {previewAssetId && state.assets[previewAssetId] && <AssetFilePreviewDialog asset={state.assets[previewAssetId]} onClose={() => setPreviewAssetId(null)} />}
      {isUml && diagram && <div className="pointer-events-none fixed left-[-12000px] top-0 h-[1200px] w-[1800px] overflow-hidden" aria-hidden="true"><UmlCanvas diagram={diagram} onChange={() => undefined} captureRef={captureRef} captureOnly /></div>}
    </div>
  )
}
