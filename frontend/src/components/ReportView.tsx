import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Report, Source, WorkflowError } from '../types'
import { dedupeErrorsForDisplay, nodeLabel } from '../errorDisplay'
import { normalizeModelText } from '../utils/text'

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
  const errors = dedupeErrorsForDisplay(report.meta.errors ?? [])
  const hasRetrievalFailure = errors.length > 0 || report.sources.length === 0

  return (
    <div className="space-y-8 sm:space-y-10">
      {hasRetrievalFailure && (
        <RetrievalWarning
          errors={errors}
          sourceCount={report.sources.length}
          qualityScore={report.meta.quality_score}
        />
      )}

      {/* Report header */}
      <div className="pb-6 border-b border-c-border">
        <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
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
          <div className="flex items-center justify-between sm:justify-start gap-3 shrink-0 w-full sm:w-auto">
            <QualityBadge score={report.meta.quality_score} />
            <span className="text-xs text-ink-3">
              {report.sources.length} sources
            </span>
          </div>
        </div>
      </div>

      {/* Financial Snapshot */}
      {report.financials && Object.keys(report.financials).length > 0 && (
        <FinancialSnapshot
          financials={report.financials}
          companyType={report.meta.company_type}
        />
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
  latest_round:   'Latest Round',
  sector:         'Sector',
  symbol:         'Ticker',
  description:    'Summary',
  source:         '',
}

const PUBLIC_FIELD_ORDER = [
  'symbol', 'market_cap', 'revenue', 'employees', 'founded_year',
  'headquarters', 'sector', 'description',
]

const NON_PUBLIC_FIELD_ORDER = [
  'revenue', 'funding_total', 'valuation', 'latest_round', 'investors',
  'employees', 'founded_year', 'headquarters', 'sector', 'description',
]

function sortFinancialEntries(
  entries: [string, string | number | string[] | null][],
  companyType: string,
) {
  const order = companyType === 'public' ? PUBLIC_FIELD_ORDER : NON_PUBLIC_FIELD_ORDER
  return [...entries].sort(([a], [b]) => {
    const aRank = order.indexOf(a)
    const bRank = order.indexOf(b)
    return (aRank === -1 ? 999 : aRank) - (bRank === -1 ? 999 : bRank)
  })
}

function retrievalWarningHeadline(errors: WorkflowError[], sourceCount: number): string {
  if (errors.some(e => /credit|firecrawl|quota/i.test(e.message))) {
    return 'Firecrawl retrieval failed — this report is not grounded in web evidence'
  }
  if (sourceCount === 0) {
    return 'No sources were retrieved — findings may be unreliable'
  }
  return 'Some retrieval steps failed — review errors before using this report'
}

function RetrievalWarning({
  errors,
  sourceCount,
  qualityScore,
}: {
  errors: WorkflowError[]
  sourceCount: number
  qualityScore: number
}) {
  const headline = retrievalWarningHeadline(errors, sourceCount)

  return (
    <div className="rounded-xl border border-c-red/40 bg-c-red-lt p-4 space-y-3">
      <div className="flex items-start gap-3">
        <svg className="w-5 h-5 text-c-red shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 00-.75.75v3.5a.75.75 0 001.5 0v-3.5A.75.75 0 0010 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
        </svg>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-c-red">{headline}</p>
          <p className="text-xs text-ink-2">
            {sourceCount} source{sourceCount === 1 ? '' : 's'} collected
            {qualityScore > 0 && ` · ${Math.round(qualityScore * 100)}% quality score`}
          </p>
        </div>
      </div>
      {errors.length > 0 && (
        <ul className="space-y-1.5 pl-5 sm:pl-8">
          {errors.map(err => (
            <li key={`${err.node}:${err.message}`} className="text-xs text-ink-2 leading-snug">
              <span className="font-medium text-ink">{nodeLabel(err.node)}</span>
              {' — '}
              {err.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FinancialSnapshot({
  financials,
  companyType,
}: {
  financials: Record<string, string | number | string[] | null>
  companyType: string
}) {
  const entries = sortFinancialEntries(
    Object.entries(financials).filter(
      ([k, v]) => k !== 'source' && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)
    ),
    companyType,
  )
  if (!entries.length) return null

  return (
    <div className="border border-c-border rounded-xl p-4 sm:p-5 bg-surface">
      <SectionHeader
        title="Financial Snapshot"
        trailing={
          <span className="text-xs text-ink-3">
            via Firecrawl web research
          </span>
        }
      />
      <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3">
        {entries.map(([key, val]) => {
          const label = FINANCIAL_LABELS[key] ?? key.replace(/_/g, ' ')
          const display = Array.isArray(val) ? val.join(', ') : String(val)
          return (
            <div key={key} className="min-w-0">
              <dt className="text-xs text-ink-3 uppercase tracking-wide">{label}</dt>
              <dd className="text-sm text-ink font-medium mt-0.5 break-words" title={display}>{display}</dd>
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
  const normalizedContent = normalizeModelText(section.content)

  return (
    <section>
      <SectionHeader
        title={section.meta.label}
        index={section.meta.order}
        trailing={<ConfidencePip confidence={section.confidence} />}
      />

      <div className="report-prose">
        <ReactMarkdown
          components={{
            p: ({ children }) => <p>{children}</p>,
            strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
            em: ({ children }) => <em className="italic">{children}</em>,
            ul: ({ children }) => <ul>{children}</ul>,
            ol: ({ children }) => <ol>{children}</ol>,
            li: ({ children }) => <li>{children}</li>,
            code: ({ children }) => (
              <code className="bg-black/10 rounded px-1 py-0.5 text-xs font-mono">{children}</code>
            ),
          }}
        >
          {normalizedContent}
        </ReactMarkdown>
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
      <p className="text-xs text-ink-3 mt-1 break-all">{hostname}</p>
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
