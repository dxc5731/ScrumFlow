import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { MessageCircle, Sparkles } from "lucide-react"
import type { ProjectDataState } from "../../types"
import { agentName } from "../../agents/meetingConversation"
import { MemberAvatar } from "./ui"

type Position = { left: number; top: number; bridge: { left: number; top: number; width: number; height: number } }
export default function MeetingSourceTrace({ children, ids, state }: { children: ReactNode; ids: string[]; state: ProjectDataState }) {
  const trigger = useRef<HTMLSpanElement>(null), popup = useRef<HTMLElement>(null)
  const opening = useRef<ReturnType<typeof setTimeout> | null>(null), closing = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false), [leaving, setLeaving] = useState(false), [position, setPosition] = useState<Position | null>(null)
  const popupId = useId()
  const cancel = () => { if (closing.current) clearTimeout(closing.current); setLeaving(false) }
  const enter = () => { cancel(); if (!open && !opening.current) opening.current = setTimeout(() => { opening.current = null; setOpen(true) }, 150) }
  const leave = () => {
    if (opening.current) { clearTimeout(opening.current); opening.current = null }
    if (closing.current) clearTimeout(closing.current)
    closing.current = setTimeout(() => { setLeaving(true); closing.current = setTimeout(() => { setOpen(false); setPosition(null) }, 120) }, 300)
  }
  useEffect(() => () => { if (opening.current) clearTimeout(opening.current); if (closing.current) clearTimeout(closing.current) }, [])
  useLayoutEffect(() => {
    if (!open || !trigger.current || !popup.current) return
    const place = () => {
      const a = trigger.current!.getBoundingClientRect(), p = popup.current!.getBoundingClientRect(), gap = 8, margin = 12
      let left: number, top: number, bridge: Position["bridge"]
      if (a.right + p.width + gap + margin <= window.innerWidth || a.left - p.width - gap >= margin) {
        const right = a.right + p.width + gap + margin <= window.innerWidth
        left = right ? a.right + gap : a.left - p.width - gap
        top = Math.max(margin, Math.min(a.top, window.innerHeight - p.height - margin))
        bridge = { left: right ? a.right - 2 : left + p.width - 2, top: Math.min(a.top, top), width: gap + 4, height: Math.max(a.bottom, top + p.height) - Math.min(a.top, top) }
      } else {
        left = Math.max(margin, Math.min(a.left, window.innerWidth - p.width - margin))
        const below = a.bottom + p.height + gap + margin <= window.innerHeight || a.top < p.height + gap + margin
        top = Math.max(margin, Math.min(below ? a.bottom + gap : a.top - p.height - gap, window.innerHeight - p.height - margin))
        bridge = { left: Math.min(a.left, left), top: below ? a.bottom - 2 : top + p.height - 2, width: Math.max(a.right, left + p.width) - Math.min(a.left, left), height: gap + 4 }
      }
      setPosition({ left, top, bridge })
    }
    place(); window.addEventListener("resize", place)
    return () => window.removeEventListener("resize", place)
  }, [open])
  const messages = ids.slice(0,5).map(id => state.meetingMessages[id]).filter(Boolean)
  if (!messages.length) return <>{children}</>
  return <><span ref={trigger} className="meeting-source-trigger" tabIndex={0} aria-describedby={open ? popupId : undefined} aria-label="悬停查看相关原始讨论" onMouseEnter={enter} onMouseLeave={leave} onFocus={enter} onBlur={leave} onKeyDown={e => { if (e.key === "Escape") { cancel(); setOpen(false) } }}>{children}</span>
    {open && createPortal(<>
      {position && !leaving && <div className="meeting-source-bridge" style={position.bridge} onMouseEnter={cancel} onMouseLeave={leave} />}
      <aside ref={popup} id={popupId} className={`meeting-source-popover ${leaving ? "is-leaving" : ""}`} style={{ left: position?.left ?? 12, top: position?.top ?? 12, visibility: position ? "visible" : "hidden" }} role="region" aria-label="当时的相关讨论" onMouseEnter={cancel} onMouseLeave={leave} onFocus={cancel} onBlur={leave} onKeyDown={e => { if (e.key === "Escape") setOpen(false) }}>
      <header><MessageCircle size={15} /><strong>当时的相关讨论</strong><small>真实会议记录</small></header>
      <div className="meeting-source-messages" tabIndex={0}>{messages.map(message => {
        const member = state.members[message.senderId], digital = message.senderType === "digital_member"
        return <article key={message.id} data-source-message-id={message.id}><div className="meeting-source-byline">{member ? <MemberAvatar memberId={member.id} size={26} /> : <span className="meeting-source-agent"><Sparkles size={14} /></span>}<strong>{member?.name ?? agentName(message.senderId)}</strong><small>{digital ? "数字员工" : member ? "项目成员" : "专业 Agent"}</small></div><p>{message.content.replace(/^@\S+\s*/, "").replace(/[*#\x60]/g, "")}</p></article>
      })}</div>
    </aside></>, document.body)}</>
}
