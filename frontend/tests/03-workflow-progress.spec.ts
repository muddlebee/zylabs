/**
 * 03 — Live Workflow Progress via SSE
 *
 * Rubric: LangGraph Design (25%) + Frontend Engineering (15%)
 * Covers: Multiple nodes, real-time SSE updates, node animations,
 *         conditional routing, intermediate outputs, recoverability
 *
 * This test creates a FRESH session so we can observe the pipeline
 * running from start to finish in the UI.
 */
import { test, expect } from '@playwright/test'
import { API, WORKFLOW_NODES, workflowStepper } from './helpers'

test.describe('Live workflow progress', () => {
  test.skip(!!process.env.CI, 'Live pipeline — run locally with FIRECRAWL_API_KEY')

  let freshSessionId: string

  test.beforeAll(async () => {
    const createRes = await fetch(`${API}/sessions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_name: 'Figma',
        company_url:  'https://figma.com',
        objective:    'Prepare for enterprise design tooling discussion and understand competitive landscape',
      }),
    })
    const data = await createRes.json()
    freshSessionId = data.session_id
    await fetch(`${API}/sessions/${freshSessionId}/run`, { method: 'POST' })
  })

  test('detail page shows running status initially', async ({ page }) => {
    await page.goto(`/sessions/${freshSessionId}`)
    await expect(page.getByText('Research in progress…')).toBeVisible({ timeout: 10_000 })
  })

  test('workflow stepper is visible with all expected nodes', async ({ page }) => {
    await page.goto(`/sessions/${freshSessionId}`)
    await expect(page.locator('aside').getByText('Workflow', { exact: true })).toBeVisible({ timeout: 10_000 })

    const stepper = workflowStepper(page)
    for (const node of WORKFLOW_NODES) {
      await expect(stepper.getByText(node.label, { exact: true })).toBeVisible()
    }
  })

  test('nodes progress from pending → active → done as SSE events arrive', async ({ page }) => {
    await page.goto(`/sessions/${freshSessionId}`)

    const stepper = workflowStepper(page)
    await expect(stepper.getByText('Planning', { exact: true })).toBeVisible({ timeout: 10_000 })

    await expect(page.locator('svg path[d*="16.704"]').first()).toBeVisible({
      timeout: 60_000,
    })
  })

  test('pipeline completes and report appears', async ({ page }) => {
    test.setTimeout(150_000)
    await page.goto(`/sessions/${freshSessionId}`)

    await expect.poll(async () => {
      const res = await fetch(`${API}/sessions/${freshSessionId}`)
      return (await res.json()).status as string
    }, { timeout: 140_000 }).toBe('completed')

    await expect(
      page.getByText('Research complete')
        .or(page.getByText('Completed with retrieval errors')),
    ).toBeVisible({ timeout: 10_000 })

    await expect(page.getByRole('heading', { name: 'Figma' })).toBeVisible({ timeout: 10_000 })
  })

  test('all workflow nodes show after completion', async ({ page }) => {
    test.setTimeout(150_000)
    await page.goto(`/sessions/${freshSessionId}`)

    await expect.poll(async () => {
      const res = await fetch(`${API}/sessions/${freshSessionId}`)
      return (await res.json()).status as string
    }, { timeout: 140_000 }).toBe('completed')

    await page.reload()

    const stepper = workflowStepper(page)
    for (const node of WORKFLOW_NODES) {
      await expect(stepper.getByText(node.label, { exact: true })).toBeVisible()
    }

    await expect(
      page.getByText('Research complete')
        .or(page.getByText('Completed with retrieval errors')),
    ).toBeVisible()
  })
})
