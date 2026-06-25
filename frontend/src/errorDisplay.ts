import type { StreamEvent, WorkflowError } from './types'
import { WORKFLOW_NODE_LABELS, WORKFLOW_NODE_ORDER } from './constants/workflow'

export function nodeLabel(node: string): string {
  return WORKFLOW_NODE_LABELS[node] ?? node
}

export function mergeWorkflowErrors(
  events: StreamEvent[],
  initialErrors: WorkflowError[] = [],
): WorkflowError[] {
  const seen = new Set<string>()
  const merged: WorkflowError[] = []
  for (const err of [...initialErrors, ...events.flatMap(e => e.errors ?? [])]) {
    const key = `${err.node}:${err.message}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(err)
  }
  return merged
}

/** One line per unique message — avoids six identical Firecrawl errors. */
export function dedupeErrorsForDisplay(errors: WorkflowError[]): WorkflowError[] {
  const seen = new Set<string>()
  const sorted = [...errors].sort((a, b) => {
    const ai = WORKFLOW_NODE_ORDER.indexOf(a.node as typeof WORKFLOW_NODE_ORDER[number])
    const bi = WORKFLOW_NODE_ORDER.indexOf(b.node as typeof WORKFLOW_NODE_ORDER[number])
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })
  const out: WorkflowError[] = []
  for (const err of sorted) {
    if (seen.has(err.message)) continue
    seen.add(err.message)
    out.push(err)
  }
  return out
}

export function planningStopReason(errors: WorkflowError[]): string | null {
  const planErr = errors.find(e => e.node === 'plan')
  return planErr?.message ?? null
}

export function isStoppedAtPlanning(
  errors: WorkflowError[],
  stoppedAt?: string | null,
): boolean {
  return stoppedAt === 'plan' || (
    errors.some(e => e.node === 'plan') &&
    !errors.some(e => e.node === 'research')
  )
}
