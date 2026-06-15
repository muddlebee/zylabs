/**
 * 02 — Session History List
 *
 * Rubric: Frontend Engineering (15%)
 * Covers: Session History, navigation to detail, status badges
 */
import { test, expect } from '@playwright/test'
import { readSession } from './helpers'

test.describe('Session history', () => {
  test('home page shows "Recent Sessions" heading', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText(/recent sessions/i)).toBeVisible()
  })

  test('session list shows at least one entry', async ({ page }) => {
    await page.goto('/')
    // Wait for list to load (not skeleton)
    await page.waitForSelector('ul li a', { timeout: 10_000 })
    const items = page.locator('ul li a')
    await expect(items.first()).toBeVisible()
  })

  test('each list item shows company name and status badge', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('ul li a', { timeout: 10_000 })

    const firstItem = page.locator('ul li').first()
    // Company name visible
    await expect(firstItem.locator('p').first()).toBeVisible()
    // Status badge (Complete / Running / Pending / Failed)
    await expect(firstItem.getByText(/complete|running|pending|failed/i)).toBeVisible()
  })

  test('shows total session count', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('ul li a', { timeout: 10_000 })
    await expect(page.getByText(/\d+ total/i)).toBeVisible()
  })

  test('clicking a session navigates to its detail page', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('ul li a', { timeout: 10_000 })

    // Click the first session in the list
    await page.locator('ul li a').first().click()
    await page.waitForURL(/\/sessions\//, { timeout: 5_000 })
    expect(page.url()).toMatch(/\/sessions\/[0-9a-f-]{36}/)
  })

  test('completed session shows green "Complete" badge', async ({ page }) => {
    const { sessionId } = readSession()
    await page.goto('/')
    // Find the list item for our completed session
    const link = page.locator(`a[href="/sessions/${sessionId}"]`)
    await expect(link).toBeVisible({ timeout: 10_000 })
    await expect(link.getByText(/complete/i)).toBeVisible()
  })
})
