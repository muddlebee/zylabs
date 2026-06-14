import type { Report, Source } from '../types'

const SECTION_META: Record<string, { label: string; icon: string; order: number }> = {
  overview:             { label: 'Company Overview',          icon: '◈', order: 1 },
  products_services:    { label: 'Products & Services',       icon: '◇', order: 2 },
  target_customers:     { label: 'Target Customers',          icon: '◉', order: 3 },
  business_signals:     { label: 'Business Signals',          icon: '△', order: 4 },
  risks_challenges:     { label: 'Risks & Challenges',        icon: '▽', order: 5 },
  discovery_questions:  { label: 'Discovery Questions',       icon: '?', order: 6 },
  outreach_strategy:    { label: 'Outreach Strategy',         icon: '→', order: 7 },
  unknowns:             { label: 'Unknowns',                  icon: '○', order: 8 },
}

const TIER_CONFIG = {
  1: { label: 'Official',  cls: 'bg-accent-light text-ink-2 border-accent/30' },
  2: { label: 'News',      cls: 'bg-c-blue-lt text-ink-2 border-c-blue/30' },
  3: { label: 'Web',       cls: 'bg-surface text-ink-3 border-c-border' },
} as const

interface Props { report: Report }

export default function ReportView({ report }: Props) {
  const sections = Object.entries(report.sections)
    .map(([key, val]) => ({ key, meta: SECTION_META[key] ?? { label: key, icon: '·', order: 99 }, ...val }))
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
        <div className="pt-8 border-t border-c-border">
          <h2 className="font-serif text-xl text-ink mb-4">Sources</h2>
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
  sector:         'Sector',
  pe_ratio:       'P/E Ratio',
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
      <div className="flex items-baseline gap-3 mb-4">
        <span className="text-accent font-serif text-lg w-5 text-center shrink-0 select-none">$</span>
        <h2 className="font-serif text-xl text-ink">Financial Snapshot</h2>
        {financials.source && (
          <span className="ml-auto text-xs text-ink-3 capitalize">
            via {financials.source === 'yfinance' ? 'Yahoo Finance' : 'web research'}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 pl-8">
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

function ReportSection({
  section,
  sourceMap,
}: {
  section: { key: string; meta: { label: string; icon: string }; content: string; source_ids: string[]; confidence: number }
  sourceMap: Record<string, Source>
}) {
  const citedSources = (section.source_ids ?? [])
    .map(id => sourceMap[id])
    .filter(Boolean)

  return (
    <div className="group">
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-accent font-serif text-lg w-5 text-center shrink-0 select-none">
          {section.meta.icon}
        </span>
        <h2 className="font-serif text-xl text-ink">{section.meta.label}</h2>
        <ConfidencePip confidence={section.confidence} />
      </div>

      <div className="pl-8">
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
      </div>
    </div>
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
  const color = confidence >= 0.8 ? 'bg-c-green'
    : confidence >= 0.6 ? 'bg-accent'
    : 'bg-c-red'
  return (
    <div className="flex items-center gap-1 ml-auto" title={`${Math.round(confidence * 100)}% confidence`}>
      {[0.33, 0.66, 1].map((threshold, i) => (
        <div
          key={i}
          className={`w-1.5 h-1.5 rounded-full ${confidence >= threshold ? color : 'bg-c-border'}`}
        />
      ))}
    </div>
  )
}
