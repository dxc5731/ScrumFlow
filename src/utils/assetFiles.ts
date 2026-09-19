import type { DesignAssetEntity } from "../types"

export type AssetPreviewType =
  | "image"
  | "pdf"
  | "docx"
  | "spreadsheet"
  | "markdown"
  | "text"
  | "unsupported"

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv;charset=utf-8",
  md: "text/markdown;charset=utf-8",
  markdown: "text/markdown;charset=utf-8",
  txt: "text/plain;charset=utf-8",
  json: "application/json;charset=utf-8",
  xml: "application/xml;charset=utf-8",
  drawio: "application/xml;charset=utf-8",
  yaml: "text/yaml;charset=utf-8",
  yml: "text/yaml;charset=utf-8",
}

export function getFileExtension(name: string) {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/)
  return match?.[1] ?? ""
}

export function inferFileMimeType(name: string, currentMimeType = "") {
  if (currentMimeType && currentMimeType !== "application/octet-stream") {
    return currentMimeType
  }
  return MIME_BY_EXTENSION[getFileExtension(name)] ?? (currentMimeType || "application/octet-stream")
}

export function getAssetPreviewType(
  asset: Pick<DesignAssetEntity, "kind" | "mimeType" | "name">,
): AssetPreviewType {
  const extension = getFileExtension(asset.name)
  const mimeType = inferFileMimeType(asset.name, asset.mimeType).toLowerCase()

  if (asset.kind === "image" || mimeType.startsWith("image/")) return "image"
  if (asset.kind === "pdf" || extension === "pdf" || mimeType === "application/pdf") return "pdf"
  if (
    extension === "docx" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) return "docx"
  if (
    ["xls", "xlsx", "csv"].includes(extension) ||
    mimeType.includes("spreadsheet") ||
    mimeType === "application/vnd.ms-excel" ||
    mimeType.startsWith("text/csv")
  ) return "spreadsheet"
  if (["md", "markdown"].includes(extension) || mimeType.startsWith("text/markdown")) {
    return "markdown"
  }
  if (
    ["txt", "json", "xml", "drawio", "yaml", "yml", "log", "puml", "plantuml", "uml"].includes(extension) ||
    mimeType.startsWith("text/") ||
    mimeType.includes("json") ||
    mimeType.includes("xml")
  ) return "text"
  return "unsupported"
}

export function canPreviewAsset(asset: Pick<DesignAssetEntity, "kind" | "mimeType" | "name">) {
  return getAssetPreviewType(asset) !== "unsupported"
}
