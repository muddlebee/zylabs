import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { SessionDetail, StreamEvent } from '../types'
import { pollSessionUntilReady } from './pollSession'

type SessionStatus = SessionDetail['status']

interface Options {
  sessionId: string
  initialStatus: string
  onComplete: (session: SessionDetail) => void
}

export function useWorkflowStream({ sessionId, initialStatus, onComplete }: Options) {
  const [events, setEvents] = useState<StreamEvent[]>([])
  const [done, setDone] = useState(initialStatus === 'completed' || initialStatus === 'failed')
  const [failed, setFailed] = useState(initialStatus === 'failed')
  const [revisions, setRevisions] = useState(0)

  const esRef = useRef<EventSource | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const completedGracefullyRef = useRef(initialStatus === 'completed')
  const finishingRef = useRef(false)
  const onCompleteRef = useRef(onComplete)

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const finish = useCallback(async (ok: boolean, knownSession?: SessionDetail) => {
    if (finishingRef.current) return
    finishingRef.current = true
    completedGracefullyRef.current = ok
    setDone(true)
    setFailed(!ok)
    esRef.current?.close()
    stopPolling()

    const session = knownSession ?? await pollSessionUntilReady(sessionId)
    if (session) onCompleteRef.current(session)
  }, [sessionId, stopPolling])

  const resolveViaApi = useCallback(async () => {
    try {
      const session = await api.getSession(sessionId)
      const status = session.status as SessionStatus
      if (status === 'completed' || session.report) void finish(true, session)
      else if (status === 'failed') void finish(false, session)
    } catch {
      // Transient network error — don't mark failed yet.
    }
  }, [sessionId, finish])

  const startPolling = useCallback((intervalMs = 5000) => {
    if (pollRef.current) return
    void resolveViaApi()
    pollRef.current = setInterval(() => { void resolveViaApi() }, intervalMs)
  }, [resolveViaApi])

  useEffect(() => {
    if (done) return

    let cancelled = false
    finishingRef.current = false

    const appendEvent = (event: StreamEvent) => {
      setEvents(prev => {
        const lastResearch = prev.findLastIndex(e => e.node === 'research')
        const lastQuality = prev.findLastIndex(e => e.node === 'quality_gate')
        if (event.node === 'research' && lastQuality > lastResearch) {
          setRevisions(r => r + 1)
        }
        return [...prev, event]
      })
      if (event.node === 'generate_report') {
        void resolveViaApi()
        startPolling(500)
      }
    }

    const connectStream = (after: number) => {
      const es = new EventSource(api.streamUrl(sessionId, after))
      esRef.current = es

      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data)
          if (data === null || data.node === 'done') {
            void finish(true)
            return
          }
          if (data.node === 'error' || data.node === 'timeout') {
            void resolveViaApi()
            if (data.node === 'timeout') startPolling()
            return
          }
          appendEvent(data)
        } catch {
          // ignore parse errors
        }
      }

      es.onerror = () => {
        es.close()
        if (completedGracefullyRef.current || finishingRef.current) return
        void resolveViaApi()
        startPolling()
      }
    }

    void (async () => {
      let after = 0
      try {
        const progress = await api.getProgress(sessionId)
        if (cancelled) return

        if (progress.events.length > 0) {
          setEvents(progress.events)
          after = progress.events.length
          if (
            progress.status === 'running' &&
            progress.events.some(e => e.node === 'generate_report')
          ) {
            void resolveViaApi()
            startPolling(500)
          }
        }

        const status = progress.status as SessionStatus
        if (status === 'completed') {
          void finish(true)
          return
        }
        if (status === 'failed') {
          void finish(false)
          return
        }
      } catch {
        // Fall back to live SSE only.
      }

      if (!cancelled) connectStream(after)
    })()

    return () => {
      cancelled = true
      esRef.current?.close()
      stopPolling()
    }
  }, [sessionId, done, finish, resolveViaApi, startPolling, stopPolling])

  return { events, done, failed, revisions }
}
