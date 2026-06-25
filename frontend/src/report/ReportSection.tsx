import type { Source } from '../types'
import Markdown from '../components/Markdown'
import { TIER_CONFIG } from './constants'
import { ConfidencePip, SectionHeader } from './ReportBadges'

interface SectionData {
  key: string
  meta: { label: string; order: number }
  content: string
  source_ids: string[]
  confidence: number
}

export default function ReportSection({
  section,
  sourceMap,
}: {
  section: SectionData
  sourceMap: Record<string, Source>
}) {
  const citedSources = (section.source_ids ?? [])
    .map(id => sourceMap[id])
    .filter(Boolean)

  return (
    <section>
      <SectionHeader
        title={section.meta.label}
        index={section.meta.order}
        trailing={<ConfidencePip confidence={section.confidence} />}
      />

      <div className="report-prose">
        <Markdown content={section.content} variant="report" />
      </div>

      {citedSources.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {citedSources.map(s => (
            <a
              key={s.id}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              title={s.title}
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs border rounded-full no-underline
                hover:opacity-80 transition-opacity ${TIER_CONFIG[s.tier]?.cls ?? TIER_CONFIG[3].cls}`}
            >
              <span>{TIER_CONFIG[s.tier]?.label ?? 'Web'}</span>
              <span className="truncate max-w-[120px]">{s.title || new URL(s.url).hostname}</span>
            </a>
          ))}
        </div>
      )}
    </section>
  )
}
