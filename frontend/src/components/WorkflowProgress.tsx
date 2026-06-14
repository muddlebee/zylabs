import { useEffect, useRef, useState } from 'react'
import type { StreamEvent } from '../types'
import { api } from '../api'

const NODES = [
  { key: 'plan',              label: 'Planning',          desc: 'Decomposing research objective' },
  { key: 'enrich_financials', label: 'Financial Data',    desc: 'Searching web for firmographics' },
  { key: 'research',          label: 'Research',          desc: 'Searching & scraping sources' },
  { key: 'synthesize',        label: 'Synthesis',         desc: 'Analysing findings' },
  { key: 'quality_gate',      label: 'Quality Check',     desc: 'Scoring coverage & confidence' },
  { key: 'strategize',        label: 'Strategy',          desc: 'Building sales angles' },
  { key: 'generate_report',   label: 'Report',            desc: 'Assembling final briefing' },
]

type NodeState = 'pending' | 'active' | 'done' | 'skipped'

interface Props {
  sessionId: string
  initialStatus: string
  financialsEnriched?: boolean
  onComplete: () => void
}

export default function WorkflowProgress({
  sessionId,
  initialStatus,
  financialsEnriched,
  onComplete,
}: Props) {
  const [events, setEvents] = useState<StreamEvent[]>([])
  const [done, setDone]     = useState(initialStatus === 'completed' || initialStatus === 'failed')
  const [failed, setFailed] = useState(initialStatus === 'failed')
  const [revisions, setRevisions] = useState(0)
  const esRef = useRef<EventSource | null>(null)
  const completedGracefullyRef = useRef(initialStatus === 'completed')

  useEffect(() => {
    if (done) return

    const es = new EventSource(api.streamUrl(sessionId))
    esRef.current = es

    const finish = (ok: boolean) => {
      completedGracefullyRef.current = ok
      setDone(true)
      setFailed(!ok)
      es.close()
      onComplete()
    }

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data)
        if (data === null || data.node === 'done') {
          finish(true)
          return
        }
        if (data.node === 'error' || data.node === 'timeout') {
          finish(false)
          return
        }
        const event: StreamEvent = data
        setEvents(prev => {
          // detect re-research loop
          const lastResearch = prev.findLastIndex(e => e.node === 'research')
          const lastQuality  = prev.findLastIndex(e => e.node === 'quality_gate')
          if (event.node === 'research' && lastQuality > lastResearch) {
            setRevisions(r => r + 1)
          }
          return [...prev, event]
        })
      } catch {
        // ignore parse errors
      }
    }

    es.onerror = () => {
      es.close()
      // Browsers fire onerror when the SSE connection closes — not always a failure.
      if (completedGracefullyRef.current) return
      finish(false)
    }

    return () => { es.close() }
  }, [sessionId, done, onComplete])

  function getNodeState(key: string): NodeState {
    const completed = events.filter(e => e.node === key)
    if (completed.length > 0) return 'done'

    const thisIdx = NODES.findIndex(n => n.key === key)

    // SSE events aren't persisted — revisiting a finished session has no event history.
    if (done && !failed && events.length === 0) {
      if (key === 'enrich_financials' && financialsEnriched === false) {
        return 'skipped'
      }
      return 'done'
    }

    if (done) {
      const hasLaterDone = events.some(e => NODES.findIndex(n => n.key === e.node) > thisIdx)
      if (hasLaterDone) return 'skipped'
      return 'pending'
    }

    const lastEvent = events[events.length - 1]
    if (!lastEvent) {
      return key === 'plan' ? 'active' : 'pending'
    }

    const lastIdx = NODES.findIndex(n => n.key === lastEvent.node)

    // Check if this node was skipped (e.g. enrich_financials on older runs)
    if (thisIdx > 0 && thisIdx < lastIdx) return 'skipped'
    if (thisIdx === lastIdx + 1) return 'active'
    return 'pending'
  }

  const lastStatus = events[events.length - 1]?.status ?? ''

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
          const state = getNodeState(node.key)
          const isLast = idx === NODES.length - 1
          return (
            <div key={node.key} className="flex gap-3">
              {/* Connector column */}
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

              {/* Content */}
              <div className={`pb-4 flex-1 ${isLast ? 'pb-0' : ''}`}>
                <div className="flex items-baseline gap-2">
                  <span className={`text-sm font-medium leading-none transition-colors ${
                    state === 'done'    ? 'text-ink'
                    : state === 'active' ? 'text-accent'
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
                </div>
                {state === 'active' && (
                  <p className="text-xs text-ink-3 mt-0.5 animate-pulse">{node.desc}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Status line */}
      {lastStatus && !done && (
        <p className="text-xs text-ink-3 pt-3 border-t border-c-border-sub">
          {lastStatus}
        </p>
      )}

      {done && !failed && (
        <div className="flex items-center gap-2 pt-3 border-t border-c-border-sub">
          <svg className="w-4 h-4 text-c-green" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
          </svg>
          <span className="text-xs font-medium text-c-green">Research complete</span>
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
