import type { Source } from '../types'
import { TIER_CONFIG } from './constants'

export default function SourceCard({ source }: { source: Source }) {
  const tier = TIER_CONFIG[source.tier] ?? TIER_CONFIG[3]
  let hostname = source.url
  try { hostname = new URL(source.url).hostname } catch { /* keep original */ }

  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`block p-3 border rounded-lg no-underline hover:opacity-80 transition-opacity ${tier.cls}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-ink leading-snug line-clamp-2 flex-1">
          {source.title || hostname}
        </p>
        <span className={`text-xs px-1.5 py-0.5 rounded border shrink-0 ${tier.cls}`}>
          {tier.label}
        </span>
      </div>
      <p className="text-xs text-ink-3 mt-1 break-all">{hostname}</p>
    </a>
  )
}
