import type { StreamEvent, WorkflowError } from '../types'
import {
  COMPLETION_TRIGGERS,
  PARALLEL_AFTER_PLAN,
  SEQUENTIAL_AFTER_PARALLEL,
} from '../constants/workflow'

export type NodeState = 'pending' | 'active' | 'done' | 'skipped' | 'error'

const ERROR_STATUS_RE = /\bfailed\b|\bunavailable\b|\bskipped\b|\berror\b/i

export function latestEventForNode(events: StreamEvent[], node: string): StreamEvent | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].node === node) return events[i]
  }
  return undefined
}

export function nodeHasError(
  node: string,
  events: StreamEvent[],
  persistedErrors: WorkflowError[] = [],
): boolean {
  if (persistedErrors.some(err => err.node === node)) return true
  const latest = latestEventForNode(events, node)
  if (!latest) return false
  if ((latest.errors?.length ?? 0) > 0) return true
  return ERROR_STATUS_RE.test(latest.status)
}

export function inferCompleted(events: StreamEvent[]): Set<string> {
  const seen = new Set(events.map(e => e.node))
  const done = new Set(seen)
  for (const [node, triggers] of Object.entries(COMPLETION_TRIGGERS)) {
    if (triggers.some(t => seen.has(t))) done.add(node)
  }
  return done
}

export function getNodeState(
  key: string,
  events: StreamEvent[],
  done: boolean,
  failed: boolean,
  financialsEnriched?: boolean,
  persistedErrors: WorkflowError[] = [],
): NodeState {
  if (nodeHasError(key, events, persistedErrors)) return 'error'

  const completed = inferCompleted(events)
  if (completed.has(key)) return 'done'

  if (done && !failed && events.length === 0) {
    if (key === 'enrich_financials' && financialsEnriched === false) {
      return 'skipped'
    }
    return 'done'
  }

  if (done) return 'pending'

  if (!completed.has('plan')) {
    return key === 'plan' ? 'active' : 'pending'
  }

  if (PARALLEL_AFTER_PLAN.has(key)) {
    if (!completed.has('synthesize')) {
      return 'active'
    }
    return 'pending'
  }

  if (key === 'synthesize') {
    const parallelDone =
      completed.has('enrich_financials') && completed.has('research')
    return parallelDone ? 'active' : 'pending'
  }

  const firstIncomplete = SEQUENTIAL_AFTER_PARALLEL.find(n => !completed.has(n))
  return key === firstIncomplete ? 'active' : 'pending'
}
