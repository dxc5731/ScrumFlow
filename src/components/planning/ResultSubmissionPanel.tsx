import { useEffect, useRef, useState } from "react"
import { Download, ExternalLink, FileUp, Link2, Plus, X } from "lucide-react"
import {
  createBlobKey,
  getBlob,
  isBlobStoreAvailable,
  MAX_FILE_BYTES,
  putBlob,
} from "../../store/blobStore"
import { useProjectStore } from "../../store/projectStore"
import { notify } from "./ui"

export default function ResultSubmissionPanel({
  type,
  id,
  compact = false,
}: {
  type: "task" | "subtask"
  id: string
  compact?: boolean
}) {
  const state = useProjectStore()
  const entity = type === "task" ? state.tasks[id] : state.subtasks[id]
  const [note, setNote] = useState("")
  const [links, setLinks] = useState<string[]>([""])
  const [assetIds, setAssetIds] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!entity) return
    setNote(entity.resultSummary)
    setLinks(entity.resultLinks.length ? [...entity.resultLinks] : [""])
    setAssetIds([...entity.resultAssetIds])
  }, [id, type, entity?.submittedAt])

  if (!entity) return null
  const readOnly =
    state.workspace.actorMode === "employee" &&
    entity.assigneeId !== state.workspace.currentUserId

  const upload = async (file: File) => {
    if (!isBlobStoreAvailable()) {
      notify("当前环境不支持本地附件存储", "error")
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      notify("单个文件不能超过 5MB", "error")
      return
    }
    setUploading(true)
    try {
      const key = createBlobKey()
      await putBlob(key, file)
      const asset = state.createAsset({
        name: file.name,
        kind: file.type.startsWith("image/") ? "image" : file.type === "application/pdf" ? "pdf" : "attachment",
        mimeType: file.type || "application/octet-stream",
        storage: "local-file",
        contentRef: key,
        sizeBytes: file.size,
        links: [{
          targetType: "task",
          targetId: type === "task" ? id : state.subtasks[id].taskId,
        }],
      })
      setAssetIds((current) => [...current, asset.id])
      notify("附件已保存")
    } catch (error) {
      notify(error instanceof Error ? error.message : "附件保存失败", "error")
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const download = async (assetId: string) => {
    const asset = state.assets[assetId]
    if (!asset || (asset.storage !== "local-file" && asset.storage !== "indexeddb")) return
    const blob = await getBlob(asset.contentRef)
    if (!blob) return notify("附件内容不存在", "error")
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = asset.name
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const submit = () => {
    const result = state.submitTaskResult(type, id, {
      note,
      links,
      assetIds,
    })
    notify(result.message, result.ok ? "success" : "error")
  }

  return (
    <section className="space-y-3">
      {!compact && (
        <div>
          <div className="text-[10px] font-semibold uppercase text-[#98A2B3]">
            成果提交
          </div>
          <p className="mt-1 text-[10px] text-[#667085]">
            说明、链接、文件至少填写一项。成果提交与任务完成状态分别保存。
          </p>
        </div>
      )}
      {readOnly && (
        <div className="rounded-md bg-[#F2F4F7] px-2.5 py-2 text-[10px] text-[#667085]">
          员工模式只能编辑自己负责的任务成果。
        </div>
      )}
      <textarea
        className="form-input min-h-20 resize-y"
        value={note}
        readOnly={readOnly}
        onChange={(event) => setNote(event.target.value)}
        placeholder="说明完成了什么，以及 PO 可以在哪里核对"
      />
      <div className="space-y-1.5">
        {links.map((link, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <Link2 size={12} className="flex-shrink-0 text-[#98A2B3]" />
            <input
              className="form-input"
              type="url"
              value={link}
              readOnly={readOnly}
              onChange={(event) =>
                setLinks((current) =>
                  current.map((item, itemIndex) =>
                    itemIndex === index ? event.target.value : item,
                  ),
                )
              }
              placeholder="https://..."
            />
            <button
              className="icon-button"
              disabled={readOnly || links.length === 1}
              onClick={() =>
                setLinks((current) =>
                  current.filter((_, itemIndex) => itemIndex !== index),
                )
              }
              title="删除链接"
            >
              <X size={13} />
            </button>
          </div>
        ))}
        <button
          className="secondary-button"
          disabled={readOnly}
          onClick={() => setLinks((current) => [...current, ""])}
        >
          <Plus size={12} /> 添加链接
        </button>
      </div>
      {assetIds.length > 0 && (
        <div className="space-y-1.5">
          {assetIds.map((assetId) => {
            const asset = state.assets[assetId]
            return (
              <div
                key={assetId}
                className="flex items-center gap-2 rounded-md border border-[#E2E7EE] px-2.5 py-2 text-[10px]"
              >
                <FileUp size={12} className="text-[#667085]" />
                <span className="min-w-0 flex-1 truncate text-[#475467]">
                  {asset?.name ?? assetId}
                </span>
                {asset?.sizeBytes && (
                  <span className="text-[#98A2B3]">
                    {Math.ceil(asset.sizeBytes / 1024)} KB
                  </span>
                )}
                <button className="icon-button" onClick={() => void download(assetId)} title="下载附件">
                  <Download size={12} />
                </button>
                <button
                  className="icon-button"
                  disabled={readOnly}
                  onClick={() =>
                    setAssetIds((current) =>
                      current.filter((item) => item !== assetId),
                    )
                  }
                  title="取消关联"
                >
                  <X size={12} />
                </button>
              </div>
            )
          })}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void upload(file)
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="secondary-button"
          disabled={readOnly || uploading || !isBlobStoreAvailable()}
          onClick={() => fileRef.current?.click()}
        >
          <FileUp size={12} /> {uploading ? "保存中..." : "关联本地文件"}
        </button>
        <button className="primary-button" disabled={readOnly} onClick={submit}>
          提交成果
        </button>
        {entity.submittedAt && (
          <span className="text-[10px] text-[#667085]">
            最近提交 {new Date(entity.submittedAt).toLocaleString("zh-CN")}
          </span>
        )}
        {links.filter(Boolean).map((link) => (
          <a
            key={link}
            href={link}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-[10px] text-[#175CD3]"
          >
            <ExternalLink size={11} /> 打开成果
          </a>
        ))}
      </div>
    </section>
  )
}
