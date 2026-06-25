import type { SessionDetail, WorkflowError } from '../types'
import { WORKFLOW_NODES } from '../constants/workflow'
import { dedupeErrorsForDisplay, isStoppedAtPlanning, mergeWorkflowErrors, nodeLabel, planningStopReason } from '../errorDisplay'
import { getNodeState, latestEventForNode } from '../workflow/state'
import { useWorkflowStream } from '../workflow/useWorkflowStream'

interface Props {
  sessionId: string
  initialStatus: string
  financialsEnriched?: boolean
  initialErrors?: WorkflowError[]
  stoppedAt?: 'plan' | null
  onComplete: (session: SessionDetail) => void
}

export default function WorkflowProgress({
  sessionId,
  initialStatus,
  financialsEnriched,
  initialErrors = [],
  stoppedAt,
  onComplete,
}: Props) {
  const { events, done, failed, revisions } = useWorkflowStream({
    sessionId,
    initialStatus,
    onComplete,
  })

  const lastStatus = events[events.length - 1]?.status ?? ''
  const workflowErrors = dedupeErrorsForDisplay(mergeWorkflowErrors(events, initialErrors))
  const haltedAtPlanning = isStoppedAtPlanning(workflowErrors, stoppedAt)
  const stopReason = planningStopReason(workflowErrors)

  if (haltedAtPlanning) {
    return (
      <div className="space-y-3">
        <h3 className="text-xs font-semibold tracking-widest text-ink-3 uppercase">
          Workflow
        </h3>
        <div className="flex gap-3">
          <NodeDot state="error" />
          <div>
            <p className="text-sm font-medium text-c-red">Planning failed</p>
            <p className="text-xs text-ink-3 mt-0.5">Workflow stopped — no research was run</p>
          </div>
        </div>
        {stopReason && (
          <p className="text-xs text-ink-2 leading-relaxed pt-2 border-t border-c-border-sub">
            {stopReason}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold tracking-widest text-ink-3 uppercase">
          Workflow
        </h3>
        {revisions > 0 && (
          <span className="text-xs text-accent font-medium bg-accent-light px-2 py-0.5 rounded-full">
            {revisions} revision{revisions > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="relative">
        {WORKFLOW_NODES.map((node, idx) => {
          const state = getNodeState(node.key, events, done, failed, financialsEnriched, initialErrors)
          const isLast = idx === WORKFLOW_NODES.length - 1
          return (
            <div key={node.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <NodeDot state={state} />
                {!isLast && (
                  <div
                    className={`w-px flex-1 my-1 min-h-[24px] transition-colors duration-500 ${
                      state === 'done' ? 'bg-c-green' : 'bg-c-border'
                    }`}
                  />
                )}
              </div>

              <div className={`pb-4 flex-1 ${isLast ? 'pb-0' : ''}`}>
                <div className="flex items-baseline gap-2">
                  <span className={`text-sm font-medium leading-none transition-colors ${
                    state === 'done'    ? 'text-ink'
                    : state === 'active' ? 'text-accent'
                    : state === 'error' ? 'text-c-red'
                    : state === 'skipped' ? 'text-ink-3 line-through'
                    : 'text-ink-3'
                  }`}>
                    {node.label}
                  </span>
                  {state === 'done' && (
                    <svg className="w-3.5 h-3.5 text-c-green shrink-0" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                    </svg>
                  )}
                  {state === 'error' && (
                    <svg className="w-3.5 h-3.5 text-c-red shrink-0" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                {state === 'active' && (
                  <p className="text-xs text-ink-3 mt-0.5 animate-pulse">{node.desc}</p>
                )}
                {state === 'error' && (
                  <p className="text-xs text-c-red mt-0.5 leading-snug">
                    {latestEventForNode(events, node.key)?.status}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {workflowErrors.length > 0 && (
        <div className="pt-3 border-t border-c-border-sub space-y-2">
          <p className="text-xs font-semibold text-c-red uppercase tracking-wide">
            Retrieval issues
          </p>
          <ul className="space-y-1.5">
            {workflowErrors.map(err => (
              <li key={`${err.node}:${err.message}`} className="text-xs text-ink-2 leading-snug">
                <span className="font-medium text-ink">{nodeLabel(err.node)}</span>
                {' — '}
                {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {lastStatus && !done && (
        <p className="text-xs text-ink-3 pt-3 border-t border-c-border-sub">
          {lastStatus}
        </p>
      )}

      {done && !failed && workflowErrors.length === 0 && (
        <div className="flex items-center gap-2 pt-3 border-t border-c-border-sub">
          <svg className="w-4 h-4 text-c-green" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
          </svg>
          <span className="text-xs font-medium text-c-green">Research complete</span>
        </div>
      )}

      {done && !failed && workflowErrors.length > 0 && (
        <div className="flex items-center gap-2 pt-3 border-t border-c-border-sub">
          <svg className="w-4 h-4 text-c-red shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 00-.75.75v3.5a.75.75 0 001.5 0v-3.5A.75.75 0 0010 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <span className="text-xs font-medium text-c-red">
            Completed with retrieval errors — report may be incomplete
          </span>
        </div>
      )}

      {failed && (
        <div className="flex items-center gap-2 pt-3 border-t border-c-border-sub">
          <svg className="w-4 h-4 text-c-red" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
          </svg>
          <span className="text-xs font-medium text-c-red">Workflow failed</span>
        </div>
      )}
    </div>
  )
}

function NodeDot({ state }: { state: ReturnType<typeof getNodeState> }) {
  if (state === 'done') {
    return (
      <div className="w-5 h-5 rounded-full bg-c-green flex items-center justify-center shrink-0">
        <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="currentColor">
          <path d="M10 3L4.5 8.5 2 6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </div>
    )
  }
  if (state === 'error') {
    return (
      <div className="w-5 h-5 rounded-full bg-c-red-lt border border-c-red/40 flex items-center justify-center shrink-0">
        <span className="w-2 h-2 rounded-full bg-c-red" />
      </div>
    )
  }
  if (state === 'active') {
    return (
      <div className="relative shrink-0 w-5 h-5">
        <div className="absolute inset-0 rounded-full bg-accent opacity-20 animate-ping" />
        <div className="relative w-5 h-5 rounded-full border-2 border-accent bg-surface flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-accent" />
        </div>
      </div>
    )
  }
  if (state === 'skipped') {
    return (
      <div className="w-5 h-5 rounded-full border border-dashed border-c-border bg-surface shrink-0" />
    )
  }
  return (
    <div className="w-5 h-5 rounded-full border border-c-border bg-surface shrink-0" />
  )
}
