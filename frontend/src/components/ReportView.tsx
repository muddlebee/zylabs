import type { Report } from '../types'
import { dedupeErrorsForDisplay } from '../errorDisplay'
import { SECTION_META } from '../report/constants'
import FinancialSnapshot from '../report/FinancialSnapshot'
import ReportSection from '../report/ReportSection'
import RetrievalWarning from '../report/RetrievalWarning'
import { QualityBadge, SectionHeader } from '../report/ReportBadges'
import SourceCard from '../report/SourceCard'

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

      {report.financials && Object.keys(report.financials).length > 0 && (
        <FinancialSnapshot
          financials={report.financials}
          companyType={report.meta.company_type}
        />
      )}

      {sections.map(section => (
        <ReportSection
          key={section.key}
          section={section}
          sourceMap={sourceMap}
        />
      ))}

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
