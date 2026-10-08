import { createElement, createRef, type ComponentType, type Ref } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { toCanvas } from "html-to-image"
import Gantt from "../pages/Gantt"
import StoryMap from "../pages/StoryMap"
import type { ProjectDataState } from "../types"

type CapturePageProps = {
  captureOnly?: boolean
  captureRef?: Ref<HTMLDivElement>
  captureSprintId?: string
  captureFullScope?: boolean
}

const TILE_SIZE = 1800
const MAX_OUTPUT_DIMENSION = 16_000
const MAX_OUTPUT_PIXELS = 72_000_000

function nextFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
  })
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error("PNG 图片生成失败"))
    }, "image/png")
  })
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

function outputScale(width: number, height: number) {
  const dimensionScale = Math.min(
    MAX_OUTPUT_DIMENSION / width,
    MAX_OUTPUT_DIMENSION / height,
  )
  const areaScale = Math.sqrt(MAX_OUTPUT_PIXELS / (width * height))
  return Math.max(0.2, Math.min(2, dimensionScale, areaScale))
}

async function captureAndStitch(content: HTMLDivElement, highResolution = true) {
  await document.fonts?.ready
  await nextFrame()

  const rect = content.getBoundingClientRect()
  const width = Math.max(1, Math.ceil(Math.max(content.scrollWidth, rect.width)))
  const height = Math.max(1, Math.ceil(Math.max(content.scrollHeight, rect.height)))
  const scale = Math.min(highResolution ? 2 : 1, outputScale(width, height))
  const output = document.createElement("canvas")
  output.width = Math.max(1, Math.ceil(width * scale))
  output.height = Math.max(1, Math.ceil(height * scale))
  const context = output.getContext("2d")
  if (!context) throw new Error("浏览器无法创建导出画布")
  context.fillStyle = "#F8FAFC"
  context.fillRect(0, 0, output.width, output.height)

  for (let y = 0; y < height; y += TILE_SIZE) {
    const tileHeight = Math.min(TILE_SIZE, height - y)
    for (let x = 0; x < width; x += TILE_SIZE) {
      const tileWidth = Math.min(TILE_SIZE, width - x)
      const destinationX = Math.round(x * scale)
      const destinationY = Math.round(y * scale)
      const destinationWidth = Math.round((x + tileWidth) * scale) - destinationX
      const destinationHeight = Math.round((y + tileHeight) * scale) - destinationY

      const tile = await toCanvas(content, {
          width: tileWidth,
          height: tileHeight,
          canvasWidth: destinationWidth,
          canvasHeight: destinationHeight,
          pixelRatio: 1,
          backgroundColor: "#F8FAFC",
          cacheBust: true,
          style: {
            position: "relative",
            left: "0",
            top: "0",
            margin: "0",
            width: `${width}px`,
            height: `${height}px`,
            maxWidth: "none",
            maxHeight: "none",
            transform: `translate(${-x}px, ${-y}px)`,
            transformOrigin: "top left",
          },
          filter: (node) => !(node instanceof HTMLElement) || node.dataset.exportIgnore !== "true",
        })
      context.drawImage(
        tile,
        0,
        0,
        tile.width,
        tile.height,
        destinationX,
        destinationY,
        destinationWidth,
        destinationHeight,
      )
    }
  }
  return canvasToBlob(output)
}

async function renderPlanningView(
  component: ComponentType<CapturePageProps>,
  options: { sprintId?: string; fullScope?: boolean; highResolution?: boolean } = {},
) {
  const host = document.createElement("div")
  host.setAttribute("aria-hidden", "true")
  host.style.position = "fixed"
  host.style.left = "-30000px"
  host.style.top = "0"
  host.style.zIndex = "-1"
  host.style.background = "#F8FAFC"
  host.style.overflow = "visible"
  document.body.appendChild(host)

  const captureRef = createRef<HTMLDivElement>()
  const root = createRoot(host)
  try {
    flushSync(() => {
      root.render(createElement(component, { captureOnly: true, captureRef, captureSprintId: options.sprintId, captureFullScope: options.fullScope }))
    })
    await nextFrame()
    if (!captureRef.current) throw new Error("导出视图尚未完成后台渲染")
    return await captureAndStitch(captureRef.current, options.highResolution ?? true)
  } finally {
    root.unmount()
    host.remove()
  }
}

export async function exportStoryMapPng(state: ProjectDataState) {
  downloadBlob(await renderPlanningView(StoryMap), `${state.project.name}-故事地图.png`)
}

export async function exportGanttPng(state: ProjectDataState) {
  downloadBlob(await renderPlanningView(Gantt), `${state.project.name}-甘特图.png`)
}

export function captureGanttView(options: { sprintId?: string; fullScope?: boolean; highResolution?: boolean } = {}) { return renderPlanningView(Gantt, options) }
export function captureStoryMapView() { return renderPlanningView(StoryMap) }

export async function planningImagePdf(png: Blob): Promise<Blob> {
  const [{ jsPDF }, bitmap] = await Promise.all([import("jspdf"), createImageBitmap(png)])
  try {
    const width = Math.min(500, bitmap.width * 0.2646), height = width * bitmap.height / bitmap.width
    const pdf = new jsPDF({ orientation: width > height ? "landscape" : "portrait", unit: "mm", format: [width, height], compress: true })
    pdf.addImage(new Uint8Array(await png.arrayBuffer()), "PNG", 0, 0, width, height, undefined, "FAST")
    return pdf.output("blob")
  } finally { bitmap.close() }
}

export async function downloadGanttView(format: "png" | "hd" | "pdf") {
  const state = (await import("../store/projectStore")).useProjectStore.getState()
  const png = await captureGanttView({ highResolution: format !== "png" })
  const name = `${state.project.name}-${state.sprints[state.workspace.selectedSprintId]?.name ?? "当前排期"}-甘特图`
  downloadBlob(format === "pdf" ? await planningImagePdf(png) : png, `${name}${format === "hd" ? "-高清" : ""}.${format === "pdf" ? "pdf" : "png"}`)
}
