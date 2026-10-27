// @vitest-environment jsdom
import { Blob as NodeBlob } from "node:buffer"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import * as XLSX from "xlsx"
import AssetFilePreviewDialog from "../components/assets/AssetFilePreviewDialog"
import type { DesignAssetEntity } from "../types"

const blobs = vi.hoisted(() => ({ getBlob: vi.fn() }))
vi.mock("../store/blobStore", () => blobs)
afterEach(() => { cleanup(); vi.clearAllMocks() })

const asset: DesignAssetEntity = {
  id: "csv-regression", name: "回归数据.csv", kind: "attachment", links: [],
  mimeType: "text/csv", storage: "local-file", contentRef: "blob-regression",
  sourceText: "", preview: "", version: "v1", createdAt: "", updatedAt: "",
}

function storedBlob(bytes: Uint8Array, type: string) {
  const blob = new NodeBlob([bytes], { type })
  // SheetJS checks ArrayBuffer identity; use the same realm as the jsdom reader.
  blob.arrayBuffer = async () => Uint8Array.from(bytes).buffer
  return blob
}

describe("real spreadsheet preview encoding", () => {
  it.each(["", "\ufeff"])("renders UTF-8 Chinese CSV with BOM %j", async (bom) => {
    blobs.getBlob.mockResolvedValue(storedBlob(new TextEncoder().encode(bom + "任务,负责人,工时\n中文回归,张伟,0.3\n"), "text/csv"))
    render(<AssetFilePreviewDialog asset={asset} onClose={() => {}} />)
    expect(await screen.findByRole("cell", { name: "中文回归" })).toBeTruthy()
    expect(screen.getByRole("cell", { name: "张伟" })).toBeTruthy()
    expect(screen.getByRole("cell", { name: "0.3" })).toBeTruthy()
  })

  it.each(["xlsx", "xls"] as const)("preserves Chinese and numeric cells in binary %s", async (format) => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["任务", "工时"], ["二进制中文", 0.3]]), "中文工作表")
    const type = format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/vnd.ms-excel"
    blobs.getBlob.mockResolvedValue(storedBlob(XLSX.write(workbook, { type: "buffer", bookType: format === "xls" ? "biff8" : "xlsx" }), type))
    render(<AssetFilePreviewDialog asset={{ ...asset, name: `回归.${format}`, mimeType: type }} onClose={() => {}} />)
    expect(await screen.findByRole("cell", { name: "二进制中文" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "中文工作表" })).toBeTruthy()
    expect(screen.getByRole("cell", { name: "0.3" })).toBeTruthy()
  })
})
