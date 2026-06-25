import { FINANCIAL_LABELS, sortFinancialEntries } from './constants'
import { SectionHeader } from './ReportBadges'

export default function FinancialSnapshot({
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
