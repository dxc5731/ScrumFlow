import type { DesignAssetEntity, MeetingContext } from "../types"

export interface MeetingArtifactMetadata { id: string; key: string; fingerprint: string; description?: string; scope?: string; artifactId?: string; copyId?: string; inPackage?: boolean }
export function meetingArtifactMetadata(asset: DesignAssetEntity): MeetingArtifactMetadata | null {
  try { return JSON.parse(asset.sourceText)?._meeting ?? null } catch { return null }
}
export function materialIdentityScope(key: string, context: MeetingContext): string {
  if (["minutes", "teacher-overview", "actions", "changes", "zip"].includes(key)) return "meeting"
  if (key === "storymap") return "project"
  if (["gantt", "excel", "risks"].includes(key)) return context.focusSprintId ?? "project"
  return [...context.focusStoryIds].sort().join(",") || context.focusSprintId || "project"
}
export function materialFamilyId(asset: DesignAssetEntity): string {
  const meta = meetingArtifactMetadata(asset)
  if (!meta) return asset.name.replace(/\.[^.]+$/, "")
  const scope = meta.scope ?? (["minutes", "teacher-overview", "actions", "changes", "zip"].includes(meta.key) ? "meeting"
    : meta.key === "storymap" ? "project" : ["gantt", "excel", "risks"].includes(meta.key) ? asset.links.find(l => l.targetType === "sprint")?.targetId ?? "project"
    : asset.links.filter(l => l.targetType === "story").map(l => l.targetId).sort().join(",") || asset.links.find(l => l.targetType === "sprint")?.targetId || "project")
  let key = meta.key
  if (key.startsWith("creative:")) {
    try { const source=JSON.parse(asset.sourceText); const diagram=source.mermaid as string | undefined;
      if (diagram?.startsWith("usecase-beta")) key="uml:usecase"
      else if (diagram?.startsWith("classDiagram")) key="class"
      else if (diagram?.startsWith("sequenceDiagram")) key="sequence"
      else if (/老师汇报|最终答辩/.test(asset.name) && source.kind === "document") key="teacher-overview"
    } catch { /* Legacy files keep their existing identity. */ }
  }
  return meta.artifactId ?? [meta.id, key, key === "teacher-overview" ? "meeting" : scope, meta.copyId ?? ""].join(":")
}
export function materialFileId(asset: DesignAssetEntity): string { return materialFamilyId(asset) + ":" + asset.name.split(".").at(-1)?.toLowerCase() }
/** Old assets remain in history; the archive exposes the latest file of each material family. */
export function latestMeetingFiles(assets: DesignAssetEntity[]): DesignAssetEntity[] {
  const latest = new Map<string, DesignAssetEntity>()
  for (const asset of assets) { const key = materialFileId(asset); if (!latest.has(key) || asset.updatedAt >= latest.get(key)!.updatedAt) latest.set(key, asset) }
  return [...latest.values()]
}
