import fs from 'fs'
import type { Page } from '@playwright/test'
import { SESSION_FILE } from './global-setup'

export function readSession(): { sessionId: string } {
  const raw = fs.readFileSync(SESSION_FILE, 'utf-8')
  return JSON.parse(raw)
}

export const API = 'http://localhost:8001'

/** Workflow node list only — excludes the retrieval-issues panel in the sidebar. */
export function workflowStepper(page: Page) {
  return page.locator('aside div.relative').first()
}

/** Prevent CI from starting the live research pipeline after session creation. */
export async function mockSessionRun(page: Page) {
  await page.route('**/api/sessions/*/run', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ session_id: 'mock', status: 'running' }),
    })
  })
}

const MOCK_ASSISTANT_REPLY =
  'Mock assistant reply for CI. This response is long enough to satisfy chat UI assertions without calling an LLM.'

/** Mock chat POST/GET so send tests verify UI only — no DeepSeek in CI. */
export async function mockChatApi(page: Page, sessionId: string) {
  await page.route(`**/api/sessions/${sessionId}/chat`, async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ role: 'assistant', content: MOCK_ASSISTANT_REPLY }),
    })
  })
}

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
  { key: 'plan',              label: 'Planning' },
  { key: 'enrich_financials', label: 'Financial Data' },
  { key: 'research',          label: 'Research' },
  { key: 'synthesize',        label: 'Synthesis' },
  { key: 'quality_gate',      label: 'Quality Check' },
  { key: 'strategize',        label: 'Strategy' },
  { key: 'generate_report',   label: 'Report' },
] as const
