import { useState } from "react"
import { Check, Code2, Download, Eye, FileText, FolderPlus, GraduationCap, Image, Pencil, Printer, Sheet } from "lucide-react"
import type { DesignAssetEntity, ProjectDataState } from "../../types"
import AssetFilePreviewDialog, { downloadAssetFile } from "../assets/AssetFilePreviewDialog"
import { getBlob } from "../../store/blobStore"
import { useProjectStore } from "../../store/projectStore"
import { latestMeetingFiles, materialFamilyId, meetingArtifactMetadata } from "../../agents/materialIdentity"
import { materialMetadata, renameMeetingMaterial } from "../../agents/materialOrganizer"

export default function MeetingMaterials({ ids, state, compact = false }: { ids: string[]; state: ProjectDataState; compact?: boolean }) {
  const [preview, setPreview] = useState<DesignAssetEntity | null>(null)
  const [gallery, setGallery] = useState(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState("")
  const files = latestMeetingFiles([...new Set(ids)].map(id => state.assets[id]).filter(Boolean))
  const selected = files.filter(file => meetingArtifactMetadata(file)?.inPackage).map(file => file.id)
  const selectFiles = (versions: DesignAssetEntity[], included: boolean) => {
    for (const file of versions) { const meta = materialMetadata(file); if (meta) useProjectStore.getState().updateAsset(file.id, { sourceText: JSON.stringify({ ...meta, _meeting: { ...meta._meeting, inPackage: !included } }) }) }
  }
  const groups = new Map<string, DesignAssetEntity[]>()
  for (const file of files) { const key = materialFamilyId(file); groups.set(key, [...(groups.get(key) ?? []), file]) }
  const primaries = [...groups.values()].map(versions => versions.find(file => /\.(?:png|docx|xlsx)$/i.test(file.name)) ?? versions[0])
  const teacher = files.some(file => /老师汇报|最终答辩/.test(file.name))
  const download = async (file: DesignAssetEntity) => {
    try { setError(""); await downloadAssetFile(file) } catch (cause) { setError(cause instanceof Error ? cause.message : "下载失败，请重试") }
  }
  const printDocument = async (file: DesignAssetEntity) => {
    try {
      setError(""); const blob = await getBlob(file.contentRef)
      if (!blob) throw new Error("文档文件不存在，请重新生成")
      const frame = document.createElement("iframe")
      frame.className = "meeting-print-frame"; frame.title = "打印项目材料"; frame.setAttribute("sandbox", "allow-same-origin allow-modals"); frame.srcdoc = await blob.text()
      frame.onload = () => { frame.contentWindow?.focus(); frame.contentWindow?.print(); window.setTimeout(() => frame.remove(), 60_000) }
      document.body.appendChild(frame)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "打印失败，请下载 Word 文件") }
  }
  const downloadBundle = async () => {
    setBusy(true); setError("")
    try {
      const { default: JSZip } = await import("jszip"), zip = new JSZip(), used = new Set<string>()
      const bundleFiles = files.filter(file => !file.name.endsWith(".zip") && (!selected.length || selected.includes(file.id)))
      for (const file of bundleFiles) {
        const blob = await getBlob(file.contentRef)
        if (!blob) throw new Error(`${file.name}暂时无法读取，请重新生成这份材料`)
        const name = used.has(file.name) ? `${file.id}-${file.name}` : file.name
        used.add(name); zip.file(name, await blob.arrayBuffer())
      }
      const url = URL.createObjectURL(await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } })), anchor = document.createElement("a")
      anchor.href = url; anchor.download = teacher ? "老师汇报成果包.zip" : "项目材料成果包.zip"; anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "打包失败，请单独下载文件") } finally { setBusy(false) }
  }
  const rename = async (versions: DesignAssetEntity[]) => {
    setBusy(true); setError("")
    try { await renameMeetingMaterial(state, versions.map(file => file.id), titleDraft); setEditing(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "标题修改失败，请重试") } finally { setBusy(false) }
  }
  return <section className={`meeting-materials ${teacher && !compact ? "meeting-materials--teacher" : ""} ${compact ? "meeting-materials--compact" : ""}`} aria-label="生成的项目材料">
    {!compact && <div className="meeting-materials-heading"><strong>{teacher ? <GraduationCap size={20} /> : <FolderPlus size={18} />}{teacher ? "老师汇报材料" : "本次会议成果"} · {groups.size} 份</strong><div><button type="button" onClick={() => { setGallery(true); setPreview(primaries[0] ?? null) }} disabled={!files.length}><Eye size={14} />全部预览</button><button type="button" disabled={busy || !files.length} onClick={() => void downloadBundle()}><Download size={14} />{busy ? "正在整理…" : selected.length ? "下载已选成果 ZIP" : "一键下载成果包 ZIP"}</button></div></div>}
    <div className="meeting-material-grid">{[...groups].slice(0, compact && !expanded ? 2 : undefined).map(([family, versions]) => {
      const primary = versions.find(file => /\.(?:png|docx|xlsx)$/i.test(file.name)) ?? versions[0]
      const title = primary.name.replace(/\.[^.]+$/, "")
      const printable = versions.find(file => file.name.endsWith(".html")), picture = versions.find(file => file.name.endsWith(".png"))
      const metadata = materialMetadata(primary), included = versions.every(file => selected.includes(file.id))
      const Icon = picture ? Image : primary.name.endsWith(".xlsx") ? Sheet : FileText
      const types = [...new Set(versions.filter(file => !/\.(?:html|md|mmd)$/.test(file.name)).map(file => file.name.split(".").at(-1)?.toUpperCase()))].join(" / ")
      return <article className="meeting-material" key={family}>
        {picture ? <button type="button" className="meeting-material-image" aria-label={`预览${title}`} onClick={() => { setGallery(false); setPreview(picture) }}><img loading="lazy" alt={title} src={`/api/local-assets/${encodeURIComponent(picture.contentRef)}`} /></button>
          : <div className={`meeting-material-cover ${primary.name.endsWith(".xlsx") ? "meeting-material-cover--sheet" : ""}`}><Icon size={38} strokeWidth={1.4} /><span>{types}</span></div>}
        <div className="meeting-material-info"><div className="meeting-material-title"><strong>{title}</strong><span>{types}</span></div>
          <p className="meeting-material-description">{metadata?._meeting?.description ?? primary.preview ?? "本次会议整理的项目成果。"}</p>
          <p className="meeting-material-meta">材料整理 Agent{metadata?._meeting?.copyId ? " · 独立副本" : ""} · {primary.version} · {new Date(primary.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
          <div className="meeting-material-actions"><button type="button" onClick={() => { setGallery(false); setPreview(primary) }}><Eye size={14} />预览</button>
            <button type="button" onClick={() => void download(primary)}><Download size={14} />下载 {primary.name.split(".").at(-1)?.toUpperCase()}</button>
            {!primary.name.endsWith(".zip") && <button type="button" aria-pressed={included} onClick={() => selectFiles(versions, included)}>{included ? <Check size={14} /> : <FolderPlus size={14} />}{included ? "已加入成果包" : "加入成果包"}</button>}
          </div>
          <details className="meeting-material-extra"><summary>更多格式与详情</summary><div className="meeting-material-actions">{versions.filter(file => file.id !== primary.id && !/\.(?:html|mmd)$/.test(file.name)).map(file => <button type="button" key={file.id} onClick={() => void download(file)} aria-label={`下载 ${file.name}`}><Download size={13} />{file.name.split(".").at(-1)?.toUpperCase()}</button>)}
            {printable && <button type="button" onClick={() => void printDocument(printable)}><Printer size={14} />打印 / 存为 PDF</button>}
            <button type="button" onClick={() => { setEditing(primary.id); setTitleDraft(title) }}><Pencil size={13} />修改标题</button></div>
            {metadata?.kind === "diagram" && <details><summary><Code2 size={13} />查看源码</summary><pre>{metadata.mermaid}</pre><button type="button" onClick={() => { const source = versions.find(file => file.name.endsWith(".mmd")); if (source) void download(source) }}>下载 Mermaid 源码</button></details>}
          </details>
          {editing === primary.id && <form className="meeting-material-rename" onSubmit={event => { event.preventDefault(); void rename(versions) }}><input aria-label="材料新标题" value={titleDraft} onChange={event => setTitleDraft(event.target.value)} /><button disabled={busy || !titleDraft.trim()}>保存标题</button><button type="button" onClick={() => setEditing(null)}>取消</button></form>}
        </div>
      </article>
    })}</div>
    {compact && groups.size > 2 && <button type="button" className="meeting-material-more" onClick={() => setExpanded(!expanded)}>{expanded ? "收起" : `查看其余 ${groups.size - 2} 份成果`}</button>}
    {!files.length && <p>这些文件已从资产中心移除，可以请材料整理重新生成。</p>}{error && <p className="meeting-material-error" role="alert">{error}</p>}
    {preview && <AssetFilePreviewDialog asset={preview} onClose={() => { setPreview(null); setGallery(false) }} />}
    {preview && gallery && <nav className="meeting-gallery-nav" aria-label="成果预览切换">{primaries.map((file, index) => <button key={file.id} aria-pressed={preview.id === file.id} onClick={() => setPreview(file)}>{index + 1}. {file.name.replace(/\.[^.]+$/, "")}</button>)}</nav>}
  </section>
}
