import { useEffect, useRef } from "react"

const openedEvent = "scrumflow:popover-open"
/** Only transient popovers opt in; dialogs and editing panels keep their own lifecycle. */
export function useDismissiblePopover(open: boolean, onClose: () => void, includeParent = false) {
  const boundaryRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open) return
    const boundary = includeParent ? boundaryRef.current?.parentElement : boundaryRef.current
    const trigger = boundary?.querySelector<HTMLElement>("[aria-expanded='true'], button")
    const previousFocus = document.activeElement
    const opened = (event: Event) => { if ((event as CustomEvent).detail !== boundary) closeRef.current() }
    const pointer = (event: PointerEvent) => { if (!boundary?.contains(event.target as Node)) closeRef.current() }
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      // Let a nested modal own Escape while it is open above this popover.
      if ((event.target as HTMLElement)?.closest('[role="dialog"]') && !boundary?.closest('[role="dialog"]')) return
      event.preventDefault(); event.stopPropagation(); closeRef.current()
      if (boundary?.contains(document.activeElement) || document.activeElement === previousFocus) trigger?.focus()
    }
    window.dispatchEvent(new CustomEvent(openedEvent, { detail: boundary }))
    window.addEventListener(openedEvent, opened)
    document.addEventListener("pointerdown", pointer, true)
    document.addEventListener("keydown", key)
    return () => { window.removeEventListener(openedEvent, opened); document.removeEventListener("pointerdown", pointer, true); document.removeEventListener("keydown", key) }
  }, [open, includeParent])
  return boundaryRef
}
