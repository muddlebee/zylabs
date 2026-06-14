/**
 * 04 — Report Content: All 8 Required Sections
 *
 * Rubric: Frontend Engineering (15%) + AI Engineering (15%)
 * Covers: Every section the assignment explicitly requires,
 *         sources with tier badges, quality score display
 *
 * Uses the pre-created completed session from global-setup.
 */
import { test, expect } from '@playwright/test'
import { readSession, REQUIRED_SECTIONS } from './helpers'

test.describe('Report sections (assignment requirements)', () => {
  let sessionId: string

  test.beforeAll(() => {
    sessionId = readSession().sessionId
  })

  test.beforeEach(async ({ page }) => {
    await page.goto(`/sessions/${sessionId}`)
    // Ensure the report is visible (session is completed)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 })
  })

  // ── Core assignment: the report MUST include these 8 sections ──
  for (const sectionLabel of REQUIRED_SECTIONS) {
    test(`renders "${sectionLabel}" section`, async ({ page }) => {
      await expect(
        page.getByRole('heading', { name: sectionLabel, exact: false })
          .or(page.getByText(sectionLabel, { exact: false }))
      ).toBeVisible({ timeout: 10_000 })
    })
  }

  test('company name appears as the report title', async ({ page }) => {
    const h1 = page.getByRole('heading', { level: 1 })
    await expect(h1).toBeVisible()
    // Should be non-empty (actual company name)
    const text = await h1.textContent()
    expect(text?.trim().length).toBeGreaterThan(0)
  })

  test('quality score badge is displayed', async ({ page }) => {
    await expect(page.getByText(/\d+% quality/i)).toBeVisible()
  })

  test('quality score is ≥ 60% (AI Engineering rubric)', async ({ page }) => {
    const badge = page.getByText(/(\d+)% quality/i)
    await expect(badge).toBeVisible()
    const text = await badge.textContent()
    const score = parseInt(text?.match(/(\d+)/)?.[1] ?? '0', 10)
    expect(score).toBeGreaterThanOrEqual(60)
  })

  test('sources section is present with source count', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible()
    await expect(page.getByText(/\d+ sources/i)).toBeVisible()
  })

  test('sources have tier badges (Official / News / Web)', async ({ page }) => {
    const tierBadge = page.getByText(/official|news|web/i).first()
    await expect(tierBadge).toBeVisible()
  })

  test('source links are actual external URLs', async ({ page }) => {
    // Find an anchor pointing to an external URL
    const sourceLinks = page.locator('a[href^="http"]')
    const count = await sourceLinks.count()
    expect(count).toBeGreaterThan(0)
  })

  test('section content is non-empty prose (not raw JSON)', async ({ page }) => {
    // Each section should contain sentence-like text, not { "key": "value" }
    const firstSection = page.locator('.report-prose').first()
    await expect(firstSection).toBeVisible()
    const text = await firstSection.textContent()
    expect(text?.trim().length).toBeGreaterThan(50)
    // Should not look like raw JSON
    expect(text).not.toMatch(/^\s*\{/)
  })

  test('confidence pips are shown per section', async ({ page }) => {
    // Each section has 3 small confidence indicator dots
    const pips = page.locator('[title*="confidence"]')
    const count = await pips.count()
    expect(count).toBeGreaterThan(0)
  })

  test('report header shows generated timestamp', async ({ page }) => {
    await expect(page.getByText(/generated/i)).toBeVisible()
  })
})
