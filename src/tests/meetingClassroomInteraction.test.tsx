// @vitest-environment jsdom
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useDismissiblePopover } from "../hooks/useDismissiblePopover"

function Popover({ name }: { name: string }) {
  const [open, setOpen] = useState(false)
  const ref = useDismissiblePopover(open, () => setOpen(false))
  return <div ref={ref}><button aria-expanded={open} onClick={() => setOpen(!open)}>{name}</button>{open && <div role="region" aria-label={`${name}内容`}><button onClick={() => setOpen(false)}>完成{name}</button><input aria-label={`${name}设置`} /></div>}</div>
}

describe("shared transient popover interaction", () => {
  afterEach(cleanup)
  it("toggles, preserves inside editing, dismisses outside/Escape and returns keyboard focus", () => {
    render(<><Popover name="历史" /><button>外部空白替身</button></>)
    const trigger = screen.getByRole("button", { name: "历史" })
    fireEvent.click(trigger)
    fireEvent.pointerDown(screen.getByRole("textbox"))
    expect(screen.queryByRole("region")).not.toBeNull()
    fireEvent.pointerDown(screen.getByRole("button", { name: "外部空白替身" }))
    expect(screen.queryByRole("region")).toBeNull()
    fireEvent.click(trigger); screen.getByRole("textbox").focus()
    fireEvent.keyDown(document.activeElement!, { key: "Escape" })
    expect(screen.queryByRole("region")).toBeNull()
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger); fireEvent.click(trigger)
    expect(screen.queryByRole("region")).toBeNull()
  })
  it("keeps only one menu open without dismissing unrelated modal content", () => {
    const action = vi.fn()
    render(<><Popover name="历史" /><Popover name="更多" /><div role="dialog"><button onClick={action}>编辑对话框</button></div></>)
    fireEvent.click(screen.getByRole("button", { name: "历史" }))
    fireEvent.click(screen.getByRole("button", { name: "更多" }))
    expect(screen.queryByRole("region", { name: "历史内容" })).toBeNull()
    expect(screen.queryByRole("region", { name: "更多内容" })).not.toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "完成更多" }))
    expect(screen.queryByRole("region")).toBeNull()
    fireEvent.keyDown(screen.getByRole("button", { name: "编辑对话框" }), { key: "Escape" })
    expect(screen.queryByRole("dialog")).not.toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "编辑对话框" }))
    expect(action).toHaveBeenCalledOnce()
  })
})
