import type { ReactNode } from 'react'
import type { Report, Source } from '../types'

const SECTION_META: Record<string, { label: string; order: number }> = {
  overview:             { label: 'Company Overview',    order: 1 },
  products_services:    { label: 'Products & Services', order: 2 },
  target_customers:     { label: 'Target Customers',    order: 3 },
  business_signals:     { label: 'Business Signals',    order: 4 },
  risks_challenges:     { label: 'Risks & Challenges',  order: 5 },
  discovery_questions:  { label: 'Discovery Questions', order: 6 },
  outreach_strategy:    { label: 'Outreach Strategy',   order: 7 },
  unknowns:             { label: 'Unknowns',            order: 8 },
}

const TIER_CONFIG = {
  1: { label: 'Official',  cls: 'bg-accent-light text-ink-2 border-accent/30' },
  2: { label: 'News',      cls: 'bg-c-blue-lt text-ink-2 border-c-blue/30' },
  3: { label: 'Web',       cls: 'bg-surface text-ink-3 border-c-border' },
} as const

interface Props { report: Report }

export default function ReportView({ report }: Props) {
  const sections = Object.entries(report.sections)
    .map(([key, val]) => ({ key, meta: SECTION_META[key] ?? { label: key, order: 99 }, ...val }))
    .sort((a, b) => a.meta.order - b.meta.order)

  const sourceMap = Object.fromEntries(report.sources.map(s => [s.id, s]))

  return (
    <div className="space-y-10">
      {/* Report header */}
      <div className="pb-6 border-b border-c-border">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-serif text-3xl text-ink leading-tight">
              {report.company_name}
            </h1>
            <p className="text-sm text-ink-3 mt-1">
              Generated {new Date(report.generated_at).toLocaleString()}
              {report.meta.company_type !== 'unknown' && (
                <span className="ml-2 capitalize">· {report.meta.company_type}</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <QualityBadge score={report.meta.quality_score} />
            <span className="text-xs text-ink-3">
              {report.sources.length} sources
            </span>
          </div>
        </div>
      </div>

      {/* Financial Snapshot */}
      {report.financials && Object.keys(report.financials).length > 0 && (
        <FinancialSnapshot financials={report.financials} />
      )}

      {/* Sections */}
      {sections.map(section => (
        <ReportSection
          key={section.key}
          section={section}
          sourceMap={sourceMap}
        />
      ))}

      {/* Sources */}
      {report.sources.length > 0 && (
        <div className="pt-4">
          <SectionHeader title="Sources" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {report.sources.map(source => (
              <SourceCard key={source.id} source={source} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const FINANCIAL_LABELS: Record<string, string> = {
  market_cap:     'Market Cap',
  revenue:        'Revenue',
  funding_total:  'Total Funding',
  valuation:      'Valuation',
  employees:      'Employees',
  founded_year:   'Founded',
  headquarters:   'Headquarters',
  investors:      'Investors',
  sector:         'Sector',
  symbol:         'Ticker',
  description:    'Summary',
  source:         '',
}

function FinancialSnapshot({ financials }: { financials: Record<string, string | number | string[] | null> }) {
  const entries = Object.entries(financials).filter(
    ([k, v]) => k !== 'source' && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)
  )
  if (!entries.length) return null

  return (
    <div className="border border-c-border rounded-xl p-5 bg-surface">
      <SectionHeader
        title="Financial Snapshot"
        trailing={
          <span className="text-xs text-ink-3">
            via Firecrawl web research
          </span>
        }
      />
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
        {entries.map(([key, val]) => {
          const label = FINANCIAL_LABELS[key] ?? key.replace(/_/g, ' ')
          const display = Array.isArray(val) ? val.join(', ') : String(val)
          return (
            <div key={key} className="min-w-0">
              <dt className="text-xs text-ink-3 uppercase tracking-wide">{label}</dt>
              <dd className="text-sm text-ink font-medium mt-0.5 truncate" title={display}>{display}</dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}

function SectionHeader({
  title,
  index,
  trailing,
}: {
  title: string
  index?: number
  trailing?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 mb-4 pb-3 border-b border-c-border">
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

function ReportSection({
  section,
  sourceMap,
}: {
  section: { key: string; meta: { label: string; order: number }; content: string; source_ids: string[]; confidence: number }
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
        {section.content.split('\n').filter(Boolean).map((para, i) => (
          <p key={i}>{para}</p>
        ))}
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

function SourceCard({ source }: { source: Source }) {
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
      <p className="text-xs text-ink-3 mt-1 truncate">{hostname}</p>
    </a>
  )
}

function QualityBadge({ score }: { score: number }) {
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

function ConfidencePip({ confidence }: { confidence: number }) {
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
