interface Props {
  companyName: string
  reason: string
}

export default function StoppedAtPlanningView({ companyName, reason }: Props) {
  return (
    <div className="rounded-xl border border-c-red/30 bg-c-red-lt p-8 text-center max-w-lg mx-auto">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-c-red/10 mb-4">
        <svg className="w-6 h-6 text-c-red" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
        </svg>
      </div>
      <h1 className="font-serif text-2xl text-ink mb-2">Research stopped at Planning</h1>
      <p className="text-sm text-ink-2 mb-4">
        Web search for <span className="font-medium text-ink">{companyName}</span> could not
        start, so the workflow was halted before collecting any sources.
      </p>
      <p className="text-sm text-c-red font-medium leading-relaxed">{reason}</p>
      <p className="text-xs text-ink-3 mt-6">
        Fix the issue above and start a new session to run research.
      </p>
    </div>
  )
}
