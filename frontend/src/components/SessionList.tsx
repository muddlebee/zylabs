import { Link } from 'react-router-dom'
import type { Session } from '../types'

const STATUS_CONFIG = {
  pending:   { label: 'Pending',   dot: 'bg-ink-3' },
  running:   { label: 'Running',   dot: 'bg-accent animate-pulse' },
  completed: { label: 'Complete',  dot: 'bg-c-green' },
  failed:    { label: 'Failed',    dot: 'bg-c-red' },
} as const

function formatAge(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function StatusBadge({ status }: { status: Session['status'] }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending
  return (
    <span className="flex items-center gap-1.5 text-xs text-ink-3">
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

interface Props {
  sessions: Session[]
  loading: boolean
}

export default function SessionList({ sessions, loading }: Props) {
  if (loading) {
    return (
      <ul className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <li key={i} className="h-16 rounded-lg skeleton" />
        ))}
      </ul>
    )
  }

  if (!sessions.length) {
    return (
      <div className="py-12 text-center">
        <p className="text-ink-3 text-sm">No research sessions yet.</p>
        <p className="text-ink-3 text-xs mt-1">Create one above to get started.</p>
      </div>
    )
  }

  return (
    <ul className="divide-y divide-c-border-sub">
      {sessions.map(s => (
        <li key={s.session_id}>
          <Link
            to={`/sessions/${s.session_id}`}
            className="flex items-center justify-between py-4 group no-underline"
          >
            <div className="flex-1 min-w-0 pr-4">
              <p className="text-sm font-medium text-ink group-hover:text-accent transition-colors truncate">
                {s.company_name}
              </p>
              <p className="text-xs text-ink-3 mt-0.5 truncate">{s.objective}</p>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <StatusBadge status={s.status} />
              <span className="text-xs text-ink-3 tabular-nums">{formatAge(s.created_at)}</span>
              <svg className="w-4 h-4 text-ink-3 group-hover:text-accent transition-colors" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
              </svg>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
