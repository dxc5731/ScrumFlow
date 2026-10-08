import { useEffect, useState } from "react"
import { AlertCircle, Download, FileText, Loader2, X } from "lucide-react"
import { notify } from "../planning/ui"
import { getBlob } from "../../store/blobStore"
import type { DesignAssetEntity } from "../../types"
import {
  getAssetPreviewType,
  inferFileMimeType,
  type AssetPreviewType,
} from "../../utils/assetFiles"

type WorkbookSheet = {
  name: string
  rows: string[][]
  truncated: boolean
}

type PreviewContent =
  | { type: "image" | "pdf"; url: string }
  | { type: "html"; html: string; messages: string[] }
  | { type: "workbook"; sheets: WorkbookSheet[] }
  | { type: "text"; text: string }
  | { type: "unsupported"; reason: string }

const MAX_SHEET_ROWS = 500
const MAX_SHEET_COLUMNS = 80

async function getStoredAssetBlob(asset: DesignAssetEntity) {
  if (asset.storage !== "local-file" && asset.storage !== "indexeddb") {
    throw new Error("当前资产没有可读取的本地文件")
  }
  const blob = await getBlob(asset.contentRef)
  if (!blob) throw new Error("文件内容缺失，请重新上传")
  const mimeType = inferFileMimeType(asset.name, asset.mimeType || blob.type)
  if (blob.type === mimeType) return blob
  return new Blob([await blob.arrayBuffer()], { type: mimeType })
}

export async function downloadAssetFile(asset: DesignAssetEntity) {
  if (asset.storage === "external" && asset.contentRef) {
    window.open(asset.contentRef, "_blank", "noopener,noreferrer")
    return
  }
  const blob = await getStoredAssetBlob(asset)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = asset.name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

async function parsePreview(asset: DesignAssetEntity, previewType: AssetPreviewType) {
  const blob = await getStoredAssetBlob(asset)
  if (previewType === "image" || previewType === "pdf") {
    return {
      content: { type: previewType, url: URL.createObjectURL(blob) } as PreviewContent,
      objectUrl: true,
    }
  }
  if (previewType === "docx") {
    const [{ default: DOMPurify }, mammoth] = await Promise.all([
      import("dompurify"),
      import("mammoth"),
    ])
    const result = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() })
    return {
      content: {
        type: "html",
        html: DOMPurify.sanitize(result.value, { USE_PROFILES: { html: true } }),
        messages: result.messages.map((message) => message.message),
      } as PreviewContent,
      objectUrl: false,
    }
  }
  if (previewType === "spreadsheet") {
    const XLSX = await import("xlsx")
    const workbook = XLSX.read(await blob.arrayBuffer(), { type: "array", cellDates: true })
    const sheets = workbook.SheetNames.map((sheetName) => {
      const worksheet = workbook.Sheets[sheetName]
      const sourceRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        raw: false,
        defval: "",
        blankrows: false,
      })
      const truncated = sourceRows.length > MAX_SHEET_ROWS || sourceRows.some((row) => row.length > MAX_SHEET_COLUMNS)
      const rows = sourceRows
        .slice(0, MAX_SHEET_ROWS)
        .map((row) => row.slice(0, MAX_SHEET_COLUMNS).map((cell) => String(cell ?? "")))
      return { name: sheetName, rows, truncated }
    })
    return {
      content: { type: "workbook", sheets } as PreviewContent,
      objectUrl: false,
    }
  }
  if (previewType === "markdown") {
    const [{ default: DOMPurify }, { marked }] = await Promise.all([
      import("dompurify"),
      import("marked"),
    ])
    const rendered = await marked.parse(await blob.text(), {
      breaks: true,
      gfm: true,
    })
    return {
      content: {
        type: "html",
        html: DOMPurify.sanitize(rendered, { USE_PROFILES: { html: true } }),
        messages: [],
      } as PreviewContent,
      objectUrl: false,
    }
  }
  if (previewType === "text") {
    return {
      content: { type: "text", text: await blob.text() } as PreviewContent,
      objectUrl: false,
    }
  }
  return {
    content: {
      type: "unsupported",
      reason: "该文件格式暂不支持在线渲染，可以使用右上角下载按钮在本地打开。",
    } as PreviewContent,
    objectUrl: false,
  }
}

function SpreadsheetPreview({ sheets }: { sheets: WorkbookSheet[] }) {
  const [activeSheet, setActiveSheet] = useState(0)
  const sheet = sheets[activeSheet]

  if (!sheet) {
    return <div className="flex h-full items-center justify-center text-xs text-[#667085]">工作簿中没有可显示的数据</div>
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex min-h-10 flex-shrink-0 items-end gap-1 overflow-x-auto border-b border-[#D0D5DD] bg-[#F8FAFC] px-3 pt-2">
        {sheets.map((item, index) => (
          <button
            key={`${item.name}-${index}`}
            className={`h-8 whitespace-nowrap border-b-2 px-3 text-[11px] font-medium ${index === activeSheet ? "border-[#1570EF] bg-white text-[#175CD3]" : "border-transparent text-[#667085] hover:bg-white"}`}
            onClick={() => setActiveSheet(index)}
          >
            {item.name}
          </button>
        ))}
      </div>
      {sheet.truncated && (
        <div className="flex-shrink-0 border-b border-[#FEDF89] bg-[#FFFAEB] px-4 py-2 text-[10px] text-[#B54708]">
          为保证预览性能，当前工作表最多展示前 {MAX_SHEET_ROWS} 行、{MAX_SHEET_COLUMNS} 列；下载后可查看完整内容。
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-collapse text-[11px] text-[#344054]">
          <tbody>
            {sheet.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className={rowIndex === 0 ? "bg-[#F2F4F7] font-semibold" : "hover:bg-[#F9FAFB]"}>
                <th className="sticky left-0 z-[1] w-12 min-w-12 border-b border-r border-[#E2E7EE] bg-[#F8FAFC] px-2 py-1.5 text-right font-normal text-[#98A2B3]">
                  {rowIndex + 1}
                </th>
                {row.map((cell, columnIndex) => (
                  <td key={columnIndex} className="max-w-[360px] min-w-28 border-b border-r border-[#E2E7EE] px-2 py-1.5 align-top">
                    <div className="max-h-16 overflow-hidden whitespace-pre-wrap break-words">{cell}</div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function AssetFilePreviewDialog({
  asset,
  onClose,
}: {
  asset: DesignAssetEntity
  onClose: () => void
}) {
  const [content, setContent] = useState<PreviewContent | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    let objectUrl = ""
    setContent(null)
    setError("")
    void parsePreview(asset, getAssetPreviewType(asset))
      .then((result) => {
        if (!active) {
          if (result.objectUrl && (result.content.type === "image" || result.content.type === "pdf")) {
            URL.revokeObjectURL(result.content.url)
          }
          return
        }
        if (result.objectUrl && (result.content.type === "image" || result.content.type === "pdf")) {
          objectUrl = result.content.url
        }
        setContent(result.content)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "文件预览失败")
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [asset])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  const download = async () => {
    try {
      await downloadAssetFile(asset)
      notify("文件下载已开始")
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "文件下载失败", "error")
    }
  }

  return (
    <div className="fixed inset-0 z-[180] flex flex-col bg-[#101828]/75 p-4" role="dialog" aria-modal="true" aria-label={`${asset.name} 文件预览`}>
      <div className="mx-auto flex h-full w-full max-w-[1500px] min-h-0 flex-col overflow-hidden rounded-lg border border-[#D0D5DD] bg-white shadow-[0_24px_80px_rgba(16,24,40,0.35)]">
        <header className="flex h-13 flex-shrink-0 items-center gap-3 border-b border-[#D0D5DD] bg-white px-4">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-[#EFF8FF] text-[#175CD3]"><FileText size={16} /></div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-[#172033]">{asset.name}</div>
            <div className="mt-0.5 text-[9px] text-[#98A2B3]">在线只读预览 · {asset.preview || asset.mimeType}</div>
          </div>
          <button className="secondary-button" onClick={download}><Download size={13} />下载</button>
          <button type="button" className="icon-button dialog-close-button" title="关闭预览" aria-label="关闭预览" onClick={onClose}><X size={24} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden bg-[#F2F4F7]">
          {!content && !error && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-xs text-[#667085]"><Loader2 size={22} className="animate-spin text-[#1570EF]" />正在解析文件</div>
          )}
          {error && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"><AlertCircle size={28} className="text-[#D92D20]" /><div className="text-sm font-semibold text-[#344054]">预览加载失败</div><div className="max-w-lg text-xs leading-5 text-[#667085]">{error}</div><button className="secondary-button" onClick={download}><Download size={13} />下载原文件</button></div>
          )}
          {content?.type === "image" && <div className="flex h-full items-center justify-center overflow-auto p-5"><img src={content.url} alt={asset.name} className="max-h-full max-w-full object-contain shadow-sm" /></div>}
          {content?.type === "pdf" && <iframe title={asset.name} src={`${content.url}#toolbar=0&navpanes=0`} className="h-full w-full border-0 bg-white" />}
          {content?.type === "html" && <div className="h-full overflow-auto p-6"><article className="asset-rich-preview mx-auto min-h-full max-w-[980px] bg-white px-12 py-10 shadow-sm" dangerouslySetInnerHTML={{ __html: content.html }} />{content.messages.length > 0 && <div className="mx-auto mt-3 max-w-[980px] rounded border border-[#FEDF89] bg-[#FFFAEB] p-3 text-[10px] leading-5 text-[#B54708]">文档中有 {content.messages.length} 项复杂格式未能完全还原，下载原文件可查看完整排版。</div>}</div>}
          {content?.type === "workbook" && <SpreadsheetPreview sheets={content.sheets} />}
          {content?.type === "text" && <div className="h-full overflow-auto p-5"><pre className="mx-auto min-h-full max-w-[1100px] whitespace-pre-wrap break-words rounded border border-[#E2E7EE] bg-white p-6 font-mono text-xs leading-6 text-[#344054] shadow-sm">{content.text}</pre></div>}
          {content?.type === "unsupported" && <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"><FileText size={34} className="text-[#98A2B3]" /><div className="text-sm font-semibold text-[#344054]">暂无在线渲染器</div><div className="max-w-md text-xs leading-5 text-[#667085]">{content.reason}</div><button className="primary-button" onClick={download}><Download size={13} />下载原文件</button></div>}
        </div>
      </div>
    </div>
  )
}
