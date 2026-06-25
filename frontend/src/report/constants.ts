export const SECTION_META: Record<string, { label: string; order: number }> = {
  overview:             { label: 'Company Overview',    order: 1 },
  products_services:    { label: 'Products & Services', order: 2 },
  target_customers:     { label: 'Target Customers',    order: 3 },
  business_signals:     { label: 'Business Signals',    order: 4 },
  risks_challenges:     { label: 'Risks & Challenges',  order: 5 },
  discovery_questions:  { label: 'Discovery Questions', order: 6 },
  outreach_strategy:    { label: 'Outreach Strategy',   order: 7 },
  unknowns:             { label: 'Unknowns',            order: 8 },
}

export const TIER_CONFIG = {
  1: { label: 'Official', cls: 'bg-accent-light text-ink-2 border-accent/30' },
  2: { label: 'News',     cls: 'bg-c-blue-lt text-ink-2 border-c-blue/30' },
  3: { label: 'Web',      cls: 'bg-surface text-ink-3 border-c-border' },
} as const

export const FINANCIAL_LABELS: Record<string, string> = {
  market_cap:    'Market Cap',
  revenue:       'Revenue',
  funding_total: 'Total Funding',
  valuation:     'Valuation',
  employees:     'Employees',
  founded_year:  'Founded',
  headquarters:  'Headquarters',
  investors:     'Investors',
  latest_round:  'Latest Round',
  sector:        'Sector',
  symbol:        'Ticker',
  description:   'Summary',
  source:        '',
}

const PUBLIC_FIELD_ORDER = [
  'symbol', 'market_cap', 'revenue', 'employees', 'founded_year',
  'headquarters', 'sector', 'description',
]

const NON_PUBLIC_FIELD_ORDER = [
  'revenue', 'funding_total', 'valuation', 'latest_round', 'investors',
  'employees', 'founded_year', 'headquarters', 'sector', 'description',
]

export function sortFinancialEntries(
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
