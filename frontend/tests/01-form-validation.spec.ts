/**
 * 01 — Session Creation & Form Validation
 *
 * Rubric: Frontend Engineering (15%)
 * Covers: Research Session Creation, Loading States, Error States
 */
import { test, expect } from '@playwright/test'

test.describe('Session creation form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /sales intelligence/i })).toBeVisible()
  })

  test('hero section renders correctly', async ({ page }) => {
    await expect(page.getByText('Sales Intelligence')).toBeVisible()
    await expect(page.getByRole('heading', { name: /sales intelligence/i })).toBeVisible()
    await expect(page.getByText(/researches, analyses, and delivers/i)).toBeVisible()
  })

  test('shows validation errors when form is submitted empty', async ({ page }) => {
    await page.getByLabel('Company Name').clear()
    await page.getByLabel('Company Website').clear()
    await page.getByLabel('Research Objective').clear()
    await page.getByRole('button', { name: /start research/i }).click()
    await expect(page.getByText('Required').first()).toBeVisible()
    const errors = page.getByText('Required')
    await expect(errors).toHaveCount(2)
  })

  test('validates URL format', async ({ page }) => {
    await page.getByLabel('Company Name').fill('Test Corp')
    await page.getByLabel('Company Website').fill('not-a-url')
    await page.getByRole('button', { name: /start research/i }).click()
    await expect(page.getByText(/enter a valid url/i)).toBeVisible()
  })

  test('validates objective minimum length', async ({ page }) => {
    await page.getByLabel('Company Name').fill('Test Corp')
    await page.getByLabel('Company Website').fill('https://test.com')
    await page.getByLabel('Research Objective').fill('short')
    await page.getByRole('button', { name: /start research/i }).click()
    await expect(page.getByText(/at least 10 characters/i)).toBeVisible()
  })

  test('clears validation errors when user corrects a field', async ({ page }) => {
    await page.getByLabel('Company Name').clear()
    await page.getByLabel('Company Website').clear()
    await page.getByLabel('Research Objective').clear()
    // Trigger errors
    await page.getByRole('button', { name: /start research/i }).click()
    await expect(page.getByText('Required').first()).toBeVisible()

    // Fix company name — its error should clear
    await page.getByLabel('Company Name').fill('Stripe')
    await expect(page.getByText('Required').first()).toBeVisible()
    await expect(page.getByText('Required')).toHaveCount(1)
  })

  test('shows loading state on valid submit and redirects to session detail', async ({ page }) => {
    await page.getByLabel('Company Name').fill('Linear')
    await page.getByLabel('Company Website').fill('https://linear.app')
    await page.getByLabel('Research Objective').fill('Understand their PM workflow before pitching our integration')
    await page.getByRole('button', { name: /start research/i }).click()

    // Loading button text appears
    await expect(page.getByText(/starting research/i)).toBeVisible({ timeout: 5_000 })

    // Redirects to session detail page
    await page.waitForURL(/\/sessions\/[0-9a-f-]{36}/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Linear' })).toBeVisible()
  })
})
