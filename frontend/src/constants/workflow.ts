export const WORKFLOW_NODES = [
  { key: 'plan',              label: 'Planning',       desc: 'Decomposing research objective' },
  { key: 'enrich_financials', label: 'Financial Data', desc: 'Searching web for firmographics' },
  { key: 'research',          label: 'Research',       desc: 'Searching & scraping sources' },
  { key: 'synthesize',        label: 'Synthesis',      desc: 'Analysing findings' },
  { key: 'quality_gate',      label: 'Quality Check',  desc: 'Scoring coverage & confidence' },
  { key: 'strategize',        label: 'Strategy',       desc: 'Building sales angles' },
  { key: 'generate_report',   label: 'Report',         desc: 'Assembling final briefing' },
] as const

export const WORKFLOW_NODE_LABELS: Record<string, string> = Object.fromEntries(
  WORKFLOW_NODES.map(n => [n.key, n.label]),
)

/** Labels for tests and docs — same order as the UI stepper. */
export const WORKFLOW_NODE_TEST_LABELS = WORKFLOW_NODES.map(n => ({
  key: n.key,
  label: n.label,
}))

export const PARALLEL_AFTER_PLAN = new Set(['enrich_financials', 'research'])
export const SEQUENTIAL_AFTER_PARALLEL = [
  'synthesize',
  'quality_gate',
  'strategize',
  'generate_report',
] as const

export const COMPLETION_TRIGGERS: Record<string, readonly string[]> = {
  plan: ['enrich_financials', 'research', 'synthesize', 'quality_gate', 'strategize', 'generate_report'],
  enrich_financials: ['synthesize', 'quality_gate', 'strategize', 'generate_report'],
  research: ['synthesize', 'quality_gate', 'strategize', 'generate_report'],
  synthesize: ['quality_gate', 'strategize', 'generate_report'],
  quality_gate: ['strategize', 'generate_report'],
  strategize: ['generate_report'],
}

export const WORKFLOW_NODE_ORDER = WORKFLOW_NODES.map(n => n.key)
