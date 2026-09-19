import { useEffect, useRef, useState } from "react"
import { createBlobKey, putBlob } from "../../store/blobStore"
import { useProjectStore } from "../../store/projectStore"
import type { DesignAssetEntity, UmlDiagramKind } from "../../types"
import { parseUmlSource } from "../../utils/uml"
import { notify } from "../planning/ui"
import UmlCanvas, { renderUmlCanvasPng } from "./UmlCanvas"

const UML_KINDS: UmlDiagramKind[] = ["use-case", "sequence", "class"]

function diagramFor(asset: DesignAssetEntity) {
  if (!UML_KINDS.includes(asset.kind as UmlDiagramKind)) return null
  if (asset.umlData?.kind === asset.kind) return asset.umlData
  return parseUmlSource(asset.kind as UmlDiagramKind, asset.sourceText).diagram
}

function waitForRender() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
  })
}

export default function UmlSnapshotBackfill() {
  const assets = useProjectStore((state) => state.assets)
  const updateAsset = useProjectStore((state) => state.updateAsset)
  const captureRef = useRef<HTMLDivElement>(null)
  const failedIds = useRef(new Set<string>())
  const completedCount = useRef(0)
  const notified = useRef(false)
  const [activeId, setActiveId] = useState<string | null>(null)

  const pendingAsset = Object.values(assets).find((asset) =>
    UML_KINDS.includes(asset.kind as UmlDiagramKind) &&
    !asset.contentRef.startsWith("blob-") &&
    !failedIds.current.has(asset.id),
  )
  const activeAsset = activeId ? assets[activeId] : undefined
  const diagram = activeAsset ? diagramFor(activeAsset) : null

  useEffect(() => {
    if (!activeId && pendingAsset) setActiveId(pendingAsset.id)
    if (!activeId && !pendingAsset && completedCount.current > 0 && !notified.current) {
      notified.current = true
      notify(`已补齐 ${completedCount.current} 张 UML 预览图`, "success")
    }
  }, [activeId, pendingAsset])

  useEffect(() => {
    if (!activeAsset || !diagram) return
    if (activeAsset.contentRef.startsWith("blob-")) {
      setActiveId(null)
      return
    }
    let cancelled = false

    void (async () => {
      try {
        await waitForRender()
        if (cancelled) return
        if (!captureRef.current) throw new Error("UML 后台渲染器尚未就绪")
        const snapshot = await renderUmlCanvasPng(captureRef.current)
        const snapshotKey = createBlobKey()
        await putBlob(snapshotKey, snapshot)
        if (cancelled) return
        const result = updateAsset(activeAsset.id, {
          preview: `${diagram.nodes.length} 节点 · ${diagram.edges.length} 连线 · PNG 快照已更新`,
          mimeType: "image/png",
          storage: "local-file",
          contentRef: snapshotKey,
          sizeBytes: snapshot.size,
        }, "system")
        if (!result.ok) throw new Error(result.message)
        completedCount.current += 1
      } catch (error) {
        failedIds.current.add(activeAsset.id)
        console.error(`UML 预览图回填失败：${activeAsset.name}`, error)
      } finally {
        if (!cancelled) setActiveId(null)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeAsset, diagram, updateAsset])

  if (!activeAsset || !diagram) return null
  return (
    <div
      className="pointer-events-none fixed left-[-12000px] top-0 h-[1200px] w-[1800px] overflow-hidden"
      aria-hidden="true"
    >
      <UmlCanvas
        diagram={diagram}
        onChange={() => undefined}
        captureRef={captureRef}
        captureOnly
      />
    </div>
  )
}
