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

async function captureAndStitch(content: HTMLDivElement) {
  await document.fonts?.ready
  await nextFrame()

  const rect = content.getBoundingClientRect()
  const width = Math.max(1, Math.ceil(Math.max(content.scrollWidth, rect.width)))
  const height = Math.max(1, Math.ceil(Math.max(content.scrollHeight, rect.height)))
  const scale = outputScale(width, height)
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
  filename: string,
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
      root.render(createElement(component, { captureOnly: true, captureRef }))
    })
    await nextFrame()
    if (!captureRef.current) throw new Error("导出视图尚未完成后台渲染")
    const blob = await captureAndStitch(captureRef.current)
    downloadBlob(blob, filename)
  } finally {
    root.unmount()
    host.remove()
  }
}

export function exportStoryMapPng(state: ProjectDataState) {
  return renderPlanningView(StoryMap, `${state.project.name}-故事地图.png`)
}

export function exportGanttPng(state: ProjectDataState) {
  return renderPlanningView(Gantt, `${state.project.name}-甘特图.png`)
}
