import type { Session } from '../types'

const STATUS_CONFIG = {
  pending:   { label: 'Pending',  dot: 'bg-ink-3',                          pill: 'text-ink-3 bg-surface border-c-border' },
  running:   { label: 'Running',  dot: 'bg-accent animate-pulse',           pill: 'text-accent bg-accent-light border-accent/30' },
  completed: { label: 'Complete', dot: 'bg-c-green',                        pill: 'text-c-green bg-c-green-lt border-c-green/30' },
  failed:    { label: 'Failed',   dot: 'bg-c-red',                          pill: 'text-c-red bg-c-red-lt border-c-red/30' },
} as const

type SessionStatus = Session['status']

interface Props {
  status: SessionStatus | string
  variant?: 'compact' | 'pill'
  stoppedAtPlanning?: boolean
}

export default function StatusBadge({
  status,
  variant = 'compact',
  stoppedAtPlanning = false,
}: Props) {
  const effectiveStatus = (stoppedAtPlanning ? 'failed' : status) as SessionStatus
  const cfg = STATUS_CONFIG[effectiveStatus] ?? STATUS_CONFIG.pending

  if (variant === 'pill') {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${cfg.pill}`}>
        {status === 'running' && !stoppedAtPlanning && (
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
        )}
        {cfg.label}
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1.5 text-xs text-ink-3">
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}
