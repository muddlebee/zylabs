import fs from 'fs'
import { SESSION_FILE } from './global-setup'

export function readSession(): { sessionId: string } {
  const raw = fs.readFileSync(SESSION_FILE, 'utf-8')
  return JSON.parse(raw)
}

export const API = 'http://localhost:8001'

export const REQUIRED_SECTIONS = [
  'Company Overview',
  'Products & Services',
  'Target Customers',
  'Business Signals',
  'Risks & Challenges',
  'Discovery Questions',
  'Outreach Strategy',
  'Unknowns',
] as const

export const WORKFLOW_NODES = [
  { key: 'plan',            label: 'Planning' },
  { key: 'research',        label: 'Research' },
  { key: 'synthesize',      label: 'Synthesis' },
  { key: 'quality_gate',    label: 'Quality Check' },
  { key: 'strategize',      label: 'Strategy' },
  { key: 'generate_report', label: 'Report' },
] as const
