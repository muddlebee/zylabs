import type { WorkflowError } from '../types'
import { nodeLabel } from '../errorDisplay'

function retrievalWarningHeadline(errors: WorkflowError[], sourceCount: number): string {
  if (errors.some(e => /credit|firecrawl|quota/i.test(e.message))) {
    return 'Firecrawl retrieval failed — this report is not grounded in web evidence'
  }
  if (sourceCount === 0) {
    return 'No sources were retrieved — findings may be unreliable'
  }
  return 'Some retrieval steps failed — review errors before using this report'
}

export default function RetrievalWarning({
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
