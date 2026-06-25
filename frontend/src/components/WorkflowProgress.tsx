import { useCallback, useEffect, useRef, useState } from 'react'
import type { StreamEvent, WorkflowError } from '../types'
import { api } from '../api'
import { dedupeErrorsForDisplay, isStoppedAtPlanning, mergeWorkflowErrors, nodeLabel, planningStopReason } from '../errorDisplay'

const NODES = [
  { key: 'plan',              label: 'Planning',          desc: 'Decomposing research objective' },
  { key: 'enrich_financials', label: 'Financial Data',    desc: 'Searching web for firmographics' },
  { key: 'research',          label: 'Research',          desc: 'Searching & scraping sources' },
  { key: 'synthesize',        label: 'Synthesis',         desc: 'Analysing findings' },
  { key: 'quality_gate',      label: 'Quality Check',     desc: 'Scoring coverage & confidence' },
  { key: 'strategize',        label: 'Strategy',          desc: 'Building sales angles' },
  { key: 'generate_report',   label: 'Report',            desc: 'Assembling final briefing' },
] as const

const PARALLEL_AFTER_PLAN = new Set(['enrich_financials', 'research'])
const SEQUENTIAL_AFTER_PARALLEL = ['synthesize', 'quality_gate', 'strategize', 'generate_report']

type NodeState = 'pending' | 'active' | 'done' | 'skipped' | 'error'
type SessionStatus = 'pending' | 'running' | 'completed' | 'failed'

const ERROR_STATUS_RE = /\bfailed\b|\bunavailable\b|\bskipped\b|\berror\b/i

function latestEventForNode(events: StreamEvent[], node: string): StreamEvent | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].node === node) return events[i]
  }
  return undefined
}

function nodeHasError(
  node: string,
  events: StreamEvent[],
  persistedErrors: WorkflowError[] = [],
): boolean {
  if (persistedErrors.some(err => err.node === node)) return true
  const latest = latestEventForNode(events, node)
  if (!latest) return false
  if ((latest.errors?.length ?? 0) > 0) return true
  return ERROR_STATUS_RE.test(latest.status)
}

interface Props {
  sessionId: string
  initialStatus: string
  financialsEnriched?: boolean
  initialErrors?: WorkflowError[]
  stoppedAt?: 'plan' | null
  onComplete: () => void
}

/** Later nodes imply earlier ones completed (parallel branches share triggers). */
const COMPLETION_TRIGGERS: Record<string, readonly string[]> = {
  plan: ['enrich_financials', 'research', 'synthesize', 'quality_gate', 'strategize', 'generate_report'],
  enrich_financials: ['synthesize', 'quality_gate', 'strategize', 'generate_report'],
  research: ['synthesize', 'quality_gate', 'strategize', 'generate_report'],
  synthesize: ['quality_gate', 'strategize', 'generate_report'],
  quality_gate: ['strategize', 'generate_report'],
  strategize: ['generate_report'],
}

function inferCompleted(events: StreamEvent[]): Set<string> {
  const seen = new Set(events.map(e => e.node))
  const done = new Set(seen)
  for (const [node, triggers] of Object.entries(COMPLETION_TRIGGERS)) {
    if (triggers.some(t => seen.has(t))) done.add(node)
  }
  return done
}

function getNodeState(
  key: string,
  events: StreamEvent[],
  done: boolean,
  failed: boolean,
  financialsEnriched?: boolean,
  persistedErrors: WorkflowError[] = [],
): NodeState {
  if (nodeHasError(key, events, persistedErrors)) return 'error'

  const completed = inferCompleted(events)
  if (completed.has(key)) return 'done'

  // Revisiting a finished session — SSE history is not persisted.
  if (done && !failed && events.length === 0) {
    if (key === 'enrich_financials' && financialsEnriched === false) {
      return 'skipped'
    }
    return 'done'
  }

  if (done) return 'pending'

  if (!completed.has('plan')) {
    return key === 'plan' ? 'active' : 'pending'
  }

  // enrich_financials and research run in parallel — never mark one skipped
  // just because the other finished first.
  if (PARALLEL_AFTER_PLAN.has(key)) {
    if (!completed.has('synthesize')) {
      return 'active'
    }
    return 'pending'
  }

  if (key === 'synthesize') {
    const parallelDone =
      completed.has('enrich_financials') && completed.has('research')
    return parallelDone ? 'active' : 'pending'
  }

  const firstIncomplete = SEQUENTIAL_AFTER_PARALLEL.find(n => !completed.has(n))
  return key === firstIncomplete ? 'active' : 'pending'
}

export default function WorkflowProgress({
  sessionId,
  initialStatus,
  financialsEnriched,
  initialErrors = [],
  stoppedAt,
  onComplete,
}: Props) {
  const [events, setEvents] = useState<StreamEvent[]>([])
  const [done, setDone]     = useState(initialStatus === 'completed' || initialStatus === 'failed')
  const [failed, setFailed] = useState(initialStatus === 'failed')
  const [revisions, setRevisions] = useState(0)
  const esRef = useRef<EventSource | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const completedGracefullyRef = useRef(initialStatus === 'completed')
  const finishingRef = useRef(false)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const finish = useCallback((ok: boolean) => {
    if (finishingRef.current) return
    finishingRef.current = true
    completedGracefullyRef.current = ok
    setDone(true)
    setFailed(!ok)
    esRef.current?.close()
    stopPolling()
    onComplete()
  }, [onComplete, stopPolling])

  const resolveViaApi = useCallback(async () => {
    try {
      const session = await api.getSession(sessionId)
      const status = session.status as SessionStatus
      if (status === 'completed' || session.report) finish(true)
      else if (status === 'failed') finish(false)
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
        const lastQuality  = prev.findLastIndex(e => e.node === 'quality_gate')
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
            finish(true)
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
          finish(true)
          return
        }
        if (status === 'failed') {
          finish(false)
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

  const lastStatus = events[events.length - 1]?.status ?? ''
  const workflowErrors = dedupeErrorsForDisplay(mergeWorkflowErrors(events, initialErrors))
  const haltedAtPlanning = isStoppedAtPlanning(workflowErrors, stoppedAt)
  const stopReason = planningStopReason(workflowErrors)

  if (haltedAtPlanning) {
    return (
      <div className="space-y-3">
        <h3 className="text-xs font-semibold tracking-widest text-ink-3 uppercase">
          Workflow
        </h3>
        <div className="flex gap-3">
          <NodeDot state="error" />
          <div>
            <p className="text-sm font-medium text-c-red">Planning failed</p>
            <p className="text-xs text-ink-3 mt-0.5">Workflow stopped — no research was run</p>
          </div>
        </div>
        {stopReason && (
          <p className="text-xs text-ink-2 leading-relaxed pt-2 border-t border-c-border-sub">
            {stopReason}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold tracking-widest text-ink-3 uppercase">
          Workflow
        </h3>
        {revisions > 0 && (
          <span className="text-xs text-accent font-medium bg-accent-light px-2 py-0.5 rounded-full">
            {revisions} revision{revisions > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="relative">
        {NODES.map((node, idx) => {
          const state = getNodeState(node.key, events, done, failed, financialsEnriched, initialErrors)
          const isLast = idx === NODES.length - 1
          return (
            <div key={node.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <NodeDot state={state} />
                {!isLast && (
                  <div
                    className={`w-px flex-1 my-1 min-h-[24px] transition-colors duration-500 ${
                      state === 'done' ? 'bg-c-green' : 'bg-c-border'
                    }`}
                  />
                )}
              </div>

              <div className={`pb-4 flex-1 ${isLast ? 'pb-0' : ''}`}>
                <div className="flex items-baseline gap-2">
                  <span className={`text-sm font-medium leading-none transition-colors ${
                    state === 'done'    ? 'text-ink'
                    : state === 'active' ? 'text-accent'
                    : state === 'error' ? 'text-c-red'
                    : state === 'skipped' ? 'text-ink-3 line-through'
                    : 'text-ink-3'
                  }`}>
                    {node.label}
                  </span>
                  {state === 'done' && (
                    <svg className="w-3.5 h-3.5 text-c-green shrink-0" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                    </svg>
                  )}
                  {state === 'error' && (
                    <svg className="w-3.5 h-3.5 text-c-red shrink-0" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                {state === 'active' && (
                  <p className="text-xs text-ink-3 mt-0.5 animate-pulse">{node.desc}</p>
                )}
                {state === 'error' && (
                  <p className="text-xs text-c-red mt-0.5 leading-snug">
                    {latestEventForNode(events, node.key)?.status}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {workflowErrors.length > 0 && (
        <div className="pt-3 border-t border-c-border-sub space-y-2">
          <p className="text-xs font-semibold text-c-red uppercase tracking-wide">
            Retrieval issues
          </p>
          <ul className="space-y-1.5">
            {workflowErrors.map(err => (
              <li key={`${err.node}:${err.message}`} className="text-xs text-ink-2 leading-snug">
                <span className="font-medium text-ink">{nodeLabel(err.node)}</span>
                {' — '}
                {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {lastStatus && !done && (
        <p className="text-xs text-ink-3 pt-3 border-t border-c-border-sub">
          {lastStatus}
        </p>
      )}

      {done && !failed && workflowErrors.length === 0 && (
        <div className="flex items-center gap-2 pt-3 border-t border-c-border-sub">
          <svg className="w-4 h-4 text-c-green" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
          </svg>
          <span className="text-xs font-medium text-c-green">Research complete</span>
        </div>
      )}

      {done && !failed && workflowErrors.length > 0 && (
        <div className="flex items-center gap-2 pt-3 border-t border-c-border-sub">
          <svg className="w-4 h-4 text-c-red shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 00-.75.75v3.5a.75.75 0 001.5 0v-3.5A.75.75 0 0010 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <span className="text-xs font-medium text-c-red">
            Completed with retrieval errors — report may be incomplete
          </span>
        </div>
      )}

      {failed && (
        <div className="flex items-center gap-2 pt-3 border-t border-c-border-sub">
          <svg className="w-4 h-4 text-c-red" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
          </svg>
          <span className="text-xs font-medium text-c-red">Workflow failed</span>
        </div>
      )}
    </div>
  )
}

function NodeDot({ state }: { state: NodeState }) {
  if (state === 'done') {
    return (
      <div className="w-5 h-5 rounded-full bg-c-green flex items-center justify-center shrink-0">
        <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="currentColor">
          <path d="M10 3L4.5 8.5 2 6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </div>
    )
  }
  if (state === 'error') {
    return (
      <div className="w-5 h-5 rounded-full bg-c-red-lt border border-c-red/40 flex items-center justify-center shrink-0">
        <span className="w-2 h-2 rounded-full bg-c-red" />
      </div>
    )
  }
  if (state === 'active') {
    return (
      <div className="relative shrink-0 w-5 h-5">
        <div className="absolute inset-0 rounded-full bg-accent opacity-20 animate-ping" />
        <div className="relative w-5 h-5 rounded-full border-2 border-accent bg-surface flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-accent" />
        </div>
      </div>
    )
  }
  if (state === 'skipped') {
    return (
      <div className="w-5 h-5 rounded-full border border-dashed border-c-border bg-surface shrink-0" />
    )
  }
  return (
    <div className="w-5 h-5 rounded-full border border-c-border bg-surface shrink-0" />
  )
}
