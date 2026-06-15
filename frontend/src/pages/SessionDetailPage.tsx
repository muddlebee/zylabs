import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api'
import type { SessionDetail } from '../types'
import WorkflowProgress from '../components/WorkflowProgress'
import ReportView from '../components/ReportView'
import StoppedAtPlanningView from '../components/StoppedAtPlanningView'
import ChatPanel from '../components/ChatPanel'
import { isStoppedAtPlanning, planningStopReason } from '../errorDisplay'

function DetailSkeleton() {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10 animate-pulse">
      <div className="h-4 skeleton w-32 mb-6 sm:mb-8" />
      <div className="flex flex-col lg:flex-row gap-8">
        <aside className="w-full lg:w-64 lg:shrink-0 space-y-4">
          <div className="h-3 skeleton w-20" />
          {[...Array(7)].map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-5 h-5 skeleton rounded-full" />
              <div className="h-3 skeleton flex-1" />
            </div>
          ))}
        </aside>
        <main className="flex-1 space-y-6">
          <div className="h-8 skeleton w-64" />
          <div className="h-4 skeleton w-48" />
          {[...Array(4)].map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-5 skeleton w-40" />
              <div className="h-4 skeleton w-full" />
              <div className="h-4 skeleton w-5/6" />
              <div className="h-4 skeleton w-4/6" />
            </div>
          ))}
        </main>
      </div>
    </div>
  )
}

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [session, setSession] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  const fetchSession = useCallback(() => {
    if (!id) return
    api.getSession(id)
      .then(setSession)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => { fetchSession() }, [fetchSession])

  const handleWorkflowComplete = useCallback(() => {
    if (!id) return

    const pollForReport = async (attempt = 0) => {
      try {
        const detail = await api.getSession(id)
        if (detail.report || detail.status === 'completed' || detail.status === 'failed' || attempt >= 30) {
          setSession(detail)
          return
        }
      } catch {
        if (attempt >= 30) return
      }
      setTimeout(() => { void pollForReport(attempt + 1) }, 500)
    }

    void pollForReport()
  }, [id])

  if (loading) return <DetailSkeleton />

  if (error || !session) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 text-center">
        <p className="text-c-red text-sm mb-4">{error || 'Session not found'}</p>
        <Link to="/" className="text-sm text-ink-3 underline">← Back to sessions</Link>
      </div>
    )
  }

  const isRunning   = session.status === 'running' || session.status === 'pending'
  const isCompleted = session.status === 'completed'
  const isFailed    = session.status === 'failed'
  const financialFields = Object.keys(session.report?.financials ?? {}).filter(k => k !== 'source')
  const financialsEnriched = financialFields.length > 0
  const reportErrors = session.report?.meta.errors ?? []
  const stoppedAtPlanning = session.report?.meta.stopped_at === 'plan'
    || isStoppedAtPlanning(reportErrors, session.report?.meta.stopped_at)
  const planningReason = planningStopReason(reportErrors) ?? 'Web research is unavailable'

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      {/* Breadcrumb */}
      <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink transition-colors no-underline mb-6 sm:mb-8">
        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
        </svg>
        All Sessions
      </Link>

      <div className="flex flex-col lg:flex-row gap-8 lg:gap-10 items-start">
        {/* Sidebar */}
        <aside className="w-full lg:w-64 lg:shrink-0 lg:sticky lg:top-20">
          <div className="space-y-6">
            {/* Session meta */}
            <div className="pb-5 border-b border-c-border-sub">
              <h2 className="font-serif text-xl text-ink leading-tight mb-1">
                {session.company_name}
              </h2>
              {session.company_url && (
                <a
                  href={session.company_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-accent hover:underline break-all block"
                >
                  {session.company_url.replace(/^https?:\/\//, '')}
                </a>
              )}
              <p className="text-xs text-ink-3 mt-2 leading-relaxed line-clamp-3">
                {session.objective}
              </p>
            </div>

            {/* Status */}
            <StatusBadge status={session.status} stoppedAtPlanning={stoppedAtPlanning} />

            {/* Workflow stepper */}
            {(isRunning || isCompleted || isFailed) && (
              <WorkflowProgress
                sessionId={session.session_id}
                initialStatus={session.status}
                financialsEnriched={isCompleted ? financialsEnriched : undefined}
                initialErrors={reportErrors}
                stoppedAtPlanning={stoppedAtPlanning}
                onComplete={handleWorkflowComplete}
              />
            )}
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0">
          {isRunning && !session.report && (
            <div className="py-16 sm:py-24 text-center">
              <div className="inline-flex items-center gap-3 text-ink-3">
                <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-sm">Research in progress…</span>
              </div>
              <p className="text-xs text-ink-3 mt-3">
                Watch the workflow on the left. The report will appear here when complete.
              </p>
            </div>
          )}

          {isFailed && !session.report && (
            <div className="py-16 sm:py-20 text-center">
              <div className="inline-flex items-center gap-2 text-c-red text-sm mb-3">
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                </svg>
                Workflow failed
              </div>
              <p className="text-xs text-ink-3">Check backend logs for details.</p>
            </div>
          )}

          {session.report && stoppedAtPlanning && (
            <StoppedAtPlanningView
              companyName={session.company_name}
              reason={planningReason}
            />
          )}

          {session.report && !stoppedAtPlanning && (
            <div className="space-y-12">
              <ReportView report={session.report} />

              {/* Chat */}
              <div className="pt-8 border-t border-c-border">
                <h2 className="font-serif text-xl text-ink mb-2">Follow-up Chat</h2>
                <p className="text-sm text-ink-3 mb-6">
                  Ask questions grounded in this research briefing.
                </p>
                <ChatPanel sessionId={session.session_id} />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function StatusBadge({ status, stoppedAtPlanning }: { status: string; stoppedAtPlanning?: boolean }) {
  const configs: Record<string, { label: string; cls: string }> = {
    pending:   { label: 'Pending',   cls: 'text-ink-3 bg-surface border-c-border' },
    running:   { label: 'Running',   cls: 'text-accent bg-accent-light border-accent/30' },
    completed: { label: 'Complete',  cls: 'text-c-green bg-c-green-lt border-c-green/30' },
    failed:    { label: 'Failed',    cls: 'text-c-red bg-c-red-lt border-c-red/30' },
  }
  const effectiveStatus = stoppedAtPlanning ? 'failed' : status
  const cfg = configs[effectiveStatus] ?? configs.pending
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${cfg.cls}`}>
      {status === 'running' && !stoppedAtPlanning && (
        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
      )}
      {cfg.label}
    </span>
  )
}
