import { describe, expect, it } from "vitest"
import {
  canPreviewAsset,
  getAssetPreviewType,
  inferFileMimeType,
} from "../utils/assetFiles"

const asset = (name: string, mimeType = "application/octet-stream") => ({
  name,
  mimeType,
  kind: "attachment" as const,
})

describe("asset file preview detection", () => {
  it.each([
    ["需求说明.docx", "docx"],
    ["排期.xlsx", "spreadsheet"],
    ["统计.xls", "spreadsheet"],
    ["任务.csv", "spreadsheet"],
    ["README.md", "markdown"],
    ["说明.markdown", "markdown"],
    ["接口.json", "text"],
    ["流程.drawio", "text"],
    ["验收.pdf", "pdf"],
  ] as const)("detects %s as %s", (name, expected) => {
    expect(getAssetPreviewType(asset(name))).toBe(expected)
  })

  it("uses file extensions when the browser omits a MIME type", () => {
    expect(inferFileMimeType("需求说明.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    expect(inferFileMimeType("说明.md")).toBe("text/markdown;charset=utf-8")
  })

  it("marks unsupported binary formats without blocking their download", () => {
    expect(getAssetPreviewType(asset("原型.pptx"))).toBe("unsupported")
    expect(canPreviewAsset(asset("原型.pptx"))).toBe(false)
  })
})
