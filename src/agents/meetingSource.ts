import type { MeetingSession, ProjectDataState } from "../types"

/** Related discussion is selected from persisted messages; never manufacture a transcript. */
export function meetingSourceIds(state: ProjectDataState, session: MeetingSession, text: string, explicit: string[] = []): string[] {
  const messages = session.messageIds.map(id => state.meetingMessages[id]).filter(m => m && m.senderType !== "system" && !m.handoffTo && m.senderId !== "material_organizer")
  const known = explicit.filter(id => messages.some(m => m.id === id))
  const facts = (session.facts ?? []).filter(f => text.includes(f.content) || f.content.includes(text)).map(f => f.sourceMessageId)
  const entities = [...Object.values(state.tasks), ...Object.values(state.subtasks), ...Object.values(state.stories), ...Object.values(state.risks)]
    .filter(e => text.toLowerCase().includes(e.id.toLowerCase()) || text.includes(e.title))
  const scores = messages.map((m, index) => ({ index, score: entities.reduce((score, e) => score +
    Number(m.content.toLowerCase().includes(e.id.toLowerCase()) || m.content.includes(e.title)), 0) }))
  const anchors = [...new Set([...known, ...facts])].map(id => messages.findIndex(m => m.id === id)).filter(i => i >= 0)
  if (!anchors.length) {
    const best = scores.filter(s => s.score > 0).sort((a, b) => b.score - a.score || b.index - a.index)[0]
    if (best) anchors.push(best.index)
  }
  if (!anchors.length) return []
  // Keep the question and its answer together, plus the next follow-up when available.
  const indices = new Set<number>()
  for (const anchor of anchors.slice(0, 2)) for (let i = Math.max(0, anchor - 1); i <= Math.min(messages.length - 1, anchor + 2); i++) indices.add(i)
  return [...indices].sort((a, b) => a - b).slice(0, 5).map(i => messages[i].id)
}
