import { useEffect, useRef, useState } from "react"
import { currentMeetingAgenda } from "../agents/meetingFacilitation"
import { interventionGapMs, isMeetingWorkContribution, managementDebounceMs, managementWindow, meetingSprintTasks, memberBlockerEvent, reviewMeetingDeviation, shouldReviewDeviation } from "../agents/meetingManagement"
import { useProjectStore } from "../store/projectStore"

/** Observe committed contributions only. No timer-driven AI turns and no transcript fragments. */
export function useMeetingManagement(sessionId: string, enabled: boolean) {
  const state = useProjectStore(), session = state.meetingSessions[sessionId]
  const stage = session && currentMeetingAgenda(session)?.key
  const contributions = session?.messageIds.filter(id => ["user", "digital_member"].includes(state.meetingMessages[id]?.senderType)) ?? []
  const lastId = contributions.at(-1)
  const suppressUntil = session?.facilitation?.management?.deviationSuppressedUntil
  const mountedSession = useRef("")
  const [reviewing, setReviewing] = useState(false)

  useEffect(() => {
    if (mountedSession.current === sessionId) return
    mountedSession.current = sessionId
    // Opening/reloading a room never interprets historical contributions as new events.
    const current = useProjectStore.getState(), meeting = current.meetingSessions[sessionId]
    const last = meeting?.messageIds.filter(id => ["user", "digital_member"].includes(current.meetingMessages[id]?.senderType)).at(-1)
    if (last) current.markMeetingReviewed(sessionId, last)
  }, [sessionId])

  useEffect(() => {
    setReviewing(false)
    if (!enabled || !session?.facilitation || session.status !== "active" || !lastId || !stage) return
    const abort = new AbortController()
    const lastIntervention = Date.parse(session.facilitation.management?.lastInterventionAt ?? "")
    const delay = Math.max(managementDebounceMs, Number.isFinite(lastIntervention) ? interventionGapMs - (Date.now() - lastIntervention) : 0)
    const timer = window.setTimeout(() => {
      const current = useProjectStore.getState(), meeting = current.meetingSessions[sessionId]
      if (!meeting || meeting.status !== "active" || currentMeetingAgenda(meeting)?.key !== stage) return
      const messages = managementWindow(current, meeting)
      if (!messages.length) return
      const blocker = memberBlockerEvent(current, meeting, messages)
      const review = shouldReviewDeviation(current, meeting, messages)
      if (blocker || review || messages.some(message => isMeetingWorkContribution(message.content, meetingSprintTasks(current, meeting))) || messages.filter(message => message.senderType === "user" && message.content.length >= 10).length >= 2) {
        current.markMeetingReviewed(sessionId, messages.at(-1)!.id)
      }
      if (blocker) {
        current.dispatchMeetingHostEvent(sessionId, "blocker_followup", blocker)
        return
      }
      if (!review) {
        if (new Set(messages.filter(message => message.senderType === "user").map(message => message.senderId)).size >= 2) current.reconcileMeetingHost(sessionId, Date.now(), true)
        return
      }
      setReviewing(true)
      const startedAt = Date.now()
      void reviewMeetingDeviation(current, meeting, messages, abort.signal).then(event => {
        if (!event || abort.signal.aborted) return
        const latest = useProjectStore.getState(), active = latest.meetingSessions[sessionId]
        if (active?.status !== "active" || currentMeetingAgenda(active)?.key !== stage || !shouldReviewDeviation(latest, active, messages)) return
        const priorityMessage = active.messageIds.map(id => latest.meetingMessages[id]).find(message =>
          message?.hostEvent && ["time_warning", "overtime", "sprint_blocker", "blocker_followup", "closing"].includes(message.hostEvent.kind) && Date.parse(message.createdAt) >= startedAt)
        if (priorityMessage) return
        latest.dispatchMeetingHostEvent(sessionId, "topic_deviation", event)
      }).catch(() => { /* A failed observer must never prevent members from continuing the meeting. */ })
        .finally(() => { if (!abort.signal.aborted) setReviewing(false) })
    }, delay)
    return () => { window.clearTimeout(timer); abort.abort() }
    // Cursor updates are intentionally excluded: a claimed batch must not abort its own review.
  }, [sessionId, enabled, stage, lastId, suppressUntil, session?.status])
  return reviewing
}
