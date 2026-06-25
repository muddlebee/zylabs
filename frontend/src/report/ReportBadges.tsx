import type { ReactNode } from 'react'

export function SectionHeader({
  title,
  index,
  trailing,
}: {
  title: string
  index?: number
  trailing?: ReactNode
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between items-start gap-2 sm:gap-4 mb-4 pb-3 border-b border-c-border">
      <div className="flex items-baseline gap-2.5 min-w-0">
        {index != null && (
          <span className="text-[11px] font-semibold text-accent tabular-nums tracking-widest shrink-0 select-none">
            {String(index).padStart(2, '0')}
          </span>
        )}
        <h2 className="font-sans text-[1.0625rem] font-semibold text-ink leading-snug tracking-tight">
          {title}
        </h2>
      </div>
      {trailing && (
        <div className="flex items-center gap-2 shrink-0">
          {trailing}
        </div>
      )}
    </div>
  )
}

export function QualityBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color = score >= 0.8 ? 'text-c-green bg-c-green-lt border-c-green/30'
    : score >= 0.6 ? 'text-accent bg-accent-light border-accent/30'
    : 'text-c-red bg-c-red-lt border-c-red/30'
  return (
    <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${color}`}>
      {pct}% quality
    </span>
  )
}

export function ConfidencePip({ confidence }: { confidence: number }) {
  if (!confidence) return null
  const pct = Math.round(confidence * 100)
  const level = confidence >= 0.8 ? 'High' : confidence >= 0.6 ? 'Med' : 'Low'
  const color = confidence >= 0.8 ? 'bg-c-green'
    : confidence >= 0.6 ? 'bg-accent'
    : 'bg-c-red'
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-2"
      title={`${pct}% confidence`}
    >
      <span className="hidden sm:inline">{level}</span>
      <span className="flex items-center gap-0.5" aria-hidden="true">
        {[0.33, 0.66, 1].map((threshold, i) => (
          <span
            key={i}
            className={`w-1.5 h-1.5 rounded-full ${confidence >= threshold ? color : 'bg-c-border'}`}
          />
        ))}
      </span>
    </span>
  )
}
