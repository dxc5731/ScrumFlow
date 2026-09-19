import { useEffect, useMemo, useState } from "react"
import {
  Check,
  ExternalLink,
  FileCode2,
  FileImage,
  FileText,
  Search,
  ZoomIn,
} from "lucide-react"
import AssetFilePreviewDialog from "../assets/AssetFilePreviewDialog"
import { getBlob } from "../../store/blobStore"
import { useProjectStore } from "../../store/projectStore"
import type { DesignAssetEntity } from "../../types"
import { canPreviewAsset } from "../../utils/assetFiles"
import { notify } from "./ui"

const UML_KINDS = ["use-case", "sequence", "class"] as const

const kindLabels: Record<DesignAssetEntity["kind"], string> = {
  activity: "活动图",
  "use-case": "用例图",
  sequence: "时序图",
  class: "类图",
  wbs: "WBS",
  image: "图片",
  pdf: "PDF",
  drawio: "Draw.io",
  attachment: "附件",
}

function useAssetPreviewSource(asset?: DesignAssetEntity) {
  const [source, setSource] = useState("")

  useEffect(() => {
    if (!asset) {
      setSource("")
      return
    }
    let active = true
    let objectUrl = ""
    const setObjectUrl = (blob: Blob) => {
      objectUrl = URL.createObjectURL(blob)
      if (active) setSource(objectUrl)
    }

    if (UML_KINDS.includes(asset.kind as (typeof UML_KINDS)[number])) {
      void (async () => {
        try {
          if (asset.contentRef) {
            const snapshot = await getBlob(asset.contentRef)
            if (snapshot && active) {
              setObjectUrl(snapshot)
            }
          }
        } catch {
          if (active) setSource("")
        }
      })()
    } else if (asset.kind === "image" && (asset.storage === "local-file" || asset.storage === "indexeddb")) {
      void getBlob(asset.contentRef)
        .then((blob) => {
          if (blob && active) setObjectUrl(blob)
        })
        .catch(() => active && setSource(""))
    } else {
      setSource("")
    }

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [asset])

  return source
}

function AssetThumbnail({ asset }: { asset: DesignAssetEntity }) {
  const source = useAssetPreviewSource(asset)

  if (source) {
    return (
      <img
        src={source}
        alt=""
        className={`h-full w-full ${asset.kind === "image" ? "object-cover" : "object-contain p-1"}`}
      />
    )
  }

  const Icon = asset.kind === "image" ? FileImage : asset.kind === "pdf" ? FileText : FileCode2
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-[#F8FAFC] px-2 text-[#667085]">
      <Icon size={19} />
      <span className="line-clamp-2 text-center text-[8px] leading-3">
        {asset.preview || kindLabels[asset.kind]}
      </span>
    </div>
  )
}

export default function AssetAssociationPicker({
  targetType,
  targetId,
}: {
  targetType: "story" | "task"
  targetId: string
}) {
  const state = useProjectStore()
  const [query, setQuery] = useState("")
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null)
  const normalizedQuery = query.trim().toLowerCase()
  const assets = useMemo(() => {
    const linked = (asset: DesignAssetEntity) => asset.links.some(
      (link) => link.targetType === targetType && link.targetId === targetId,
    )
    return Object.values(state.assets)
      .filter((asset) => !normalizedQuery || `${asset.name} ${asset.kind} ${asset.preview}`.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => Number(linked(b)) - Number(linked(a)) || b.updatedAt.localeCompare(a.updatedAt))
  }, [normalizedQuery, state.assets, targetId, targetType])

  const toggle = (asset: DesignAssetEntity) => {
    const isLinked = asset.links.some(
      (link) => link.targetType === targetType && link.targetId === targetId,
    )
    const result = isLinked
      ? state.unlinkAsset(asset.id, targetType, targetId)
      : state.linkAsset(asset.id, targetType, targetId)
    notify(
      result.ok ? (isLinked ? "已解除设计资产关联" : "设计资产已关联") : result.message,
      result.ok ? "success" : "error",
    )
  }

  const linkedCount = Object.values(state.assets).filter((asset) =>
    asset.links.some((link) => link.targetType === targetType && link.targetId === targetId),
  ).length

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase text-[#98A2B3]">关联设计资产</div>
          <div className="mt-0.5 text-[9px] text-[#667085]">已关联 {linkedCount} 项，通过卡片右上角选择框切换</div>
        </div>
        <button
          className="secondary-button ml-auto"
          onClick={() => state.setWorkspace({ currentPage: "assets" })}
        >
          <ExternalLink size={12} />资产中心
        </button>
      </div>

      <label className="relative block">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#98A2B3]" size={12} />
        <input
          className="form-input pl-7"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索名称或类型"
        />
      </label>

      <div className="max-h-[430px] space-y-2 overflow-y-auto pr-1">
        {assets.map((asset) => {
          const isLinked = asset.links.some(
            (link) => link.targetType === targetType && link.targetId === targetId,
          )
          const diagram = asset.umlData
          const isPreviewable =
            (asset.storage === "local-file" || asset.storage === "indexeddb") &&
            canPreviewAsset(asset)
          return (
            <div
              key={asset.id}
              className={`flex w-full overflow-hidden rounded-md border text-left transition-colors ${
                isLinked
                  ? "border-[#84ADFF] bg-[#EFF8FF]"
                  : "border-[#E2E7EE] bg-white hover:border-[#B2CCFF] hover:bg-[#F8FAFC]"
              }`}
            >
              <button type="button" disabled={!isPreviewable} className={`relative h-[84px] w-[116px] flex-shrink-0 border-r border-[#E2E7EE] bg-white ${isPreviewable ? "group cursor-zoom-in" : "cursor-default"}`} onClick={() => isPreviewable && setPreviewAssetId(asset.id)} aria-label={isPreviewable ? `放大预览 ${asset.name}` : undefined}>
                <AssetThumbnail asset={asset} />
                {isPreviewable && <span className="absolute inset-0 flex items-center justify-center bg-[#101828]/0 text-transparent transition-colors group-hover:bg-[#101828]/20 group-hover:text-white"><ZoomIn size={18} /></span>}
              </button>
              <span className="min-w-0 flex-1 px-2.5 py-2">
                <span className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[#344054]">{asset.name}</span>
                  <button type="button" aria-pressed={isLinked} aria-label={isLinked ? `解除关联 ${asset.name}` : `关联 ${asset.name}`} title={isLinked ? "点击解除关联" : "点击关联"} className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${isLinked ? "border-[#1570EF] bg-[#1570EF] text-white" : "border-[#D0D5DD] bg-white text-transparent hover:border-[#84ADFF]"}`} onClick={() => toggle(asset)}>
                    <Check size={10} strokeWidth={3} />
                  </button>
                </span>
                <span className="mt-1 block text-[9px] text-[#667085]">
                  {kindLabels[asset.kind]} · {asset.version}
                  {diagram ? ` · ${diagram.nodes.length} 节点 / ${diagram.edges.length} 连线` : ""}
                </span>
                <span className="mt-1 line-clamp-2 block text-[9px] leading-3 text-[#98A2B3]">
                  {asset.preview || asset.mimeType}
                </span>
                <button type="button" className="mt-1.5 flex items-center gap-1 text-[9px] font-medium text-[#175CD3] hover:underline" onClick={() => state.setWorkspace({ currentPage: "assets", selectedObjectType: null, selectedObjectId: asset.id, inspectorOpen: false })}><ExternalLink size={10} />前往资产中心</button>
              </span>
            </div>
          )
        })}
        {!assets.length && (
          <div className="rounded-md border border-dashed border-[#D0D5DD] px-3 py-8 text-center text-[10px] text-[#98A2B3]">
            {normalizedQuery ? "没有匹配的设计资产" : "资产中心中尚无可关联内容"}
          </div>
        )}
      </div>
      {previewAssetId && state.assets[previewAssetId] && <AssetFilePreviewDialog asset={state.assets[previewAssetId]} onClose={() => setPreviewAssetId(null)} />}
    </div>
  )
}
