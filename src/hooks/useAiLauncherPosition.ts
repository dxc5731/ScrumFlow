import { useEffect, useRef, useState, type PointerEvent } from "react"

const POSITION_KEY = "scrumflow-ai-orb-position"
const EDGE = 12
const viewport = () => ({ width: window.innerWidth, height: window.innerHeight })
const orbSize = (width: number) => width <= 540 ? 52 : 60
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)))
type Point = { x: number; y: number }
const fit = (point: Point, size = viewport()) => ({
  x: clamp(point.x, EDGE, size.width - orbSize(size.width) - EDGE),
  y: clamp(point.y, EDGE, size.height - orbSize(size.width) - EDGE),
})
const save = (point: Point) => { try { localStorage.setItem(POSITION_KEY, JSON.stringify(point)) } catch { /* Position remains usable without storage. */ } }

export function useAiLauncherPosition(onDrag: () => void) {
  const [size, setSize] = useState(viewport)
  const [point, setPoint] = useState<Point>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(POSITION_KEY) ?? "null")
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return fit(saved)
    } catch { /* Ignore invalid layout preferences. */ }
    const v = viewport(), gap = v.width <= 540 ? 16 : 22
    return fit({ x: v.width - orbSize(v.width) - gap, y: v.height - orbSize(v.width) - gap })
  })
  const pointRef = useRef(point)
  pointRef.current = point
  const gesture = useRef<{ pointerId: number; x: number; y: number; origin: Point; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const suppressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    const resize = () => {
      const next = viewport()
      setSize(next)
      setPoint(old => { const fitted = fit(old, next); pointRef.current = fitted; save(fitted); return fitted })
    }
    window.addEventListener("resize", resize)
    return () => { window.removeEventListener("resize", resize); clearTimeout(suppressTimer.current) }
  }, [])
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || event.isPrimary === false) return
    clearTimeout(suppressTimer.current)
    suppressClick.current = false
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin: pointRef.current, moved: false }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = gesture.current
    if (!drag || event.pointerId !== drag.pointerId) return
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) < 5) return
    if (!drag.moved) { drag.moved = true; setDragging(true); onDrag() }
    const next = fit({ x: drag.origin.x + dx, y: drag.origin.y + dy })
    pointRef.current = next
    setPoint(next)
  }
  const finish = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = gesture.current
    if (!drag || event.pointerId !== drag.pointerId) return
    if (drag.moved) {
      save(pointRef.current)
      suppressClick.current = true
      suppressTimer.current = setTimeout(() => { suppressClick.current = false }, 0)
    }
    gesture.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const panelStyle = (width: number, height: number) => {
    const panelWidth = Math.min(width, size.width - EDGE * 2), panelHeight = Math.min(height, size.height - EDGE * 2)
    const above = point.y - panelHeight - 12
    const below = point.y + orbSize(size.width) + 12
    return {
      left: clamp(point.x + orbSize(size.width) - panelWidth, EDGE, size.width - panelWidth - EDGE),
      top: clamp(above >= EDGE ? above : below, EDGE, size.height - panelHeight - EDGE),
      right: "auto" as const, bottom: "auto" as const,
    }
  }
  return { point, size, dragging, panelStyle, onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish, onLostPointerCapture: finish,
    consumeDragClick: () => { const value = suppressClick.current; suppressClick.current = false; return value },
  }
}
