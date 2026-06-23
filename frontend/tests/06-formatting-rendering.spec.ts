import { test, expect, type Page } from '@playwright/test'

const MOCK_SESSION_ID = 'formatting-fixture'

const MOCK_SESSION_DETAIL = {
  session_id: MOCK_SESSION_ID,
  company_name: 'Formatting Fixture Co',
  company_url: 'https://fixture.example',
  objective: 'Validate report and chat rendering behavior',
  status: 'completed',
  created_at: '2026-06-23T08:00:00.000Z',
  report: {
    session_id: MOCK_SESSION_ID,
    company_name: 'Formatting Fixture Co',
    generated_at: '2026-06-23T08:05:00.000Z',
    sections: {
      discovery_questions: {
        section: 'discovery_questions',
        content: '1. What is the current procurement timeline?\\n2. Which teams own evaluation criteria?\\n\\n- Validate success metrics\\n- Confirm legal/security blockers',
        source_ids: ['s1'],
        confidence: 0.88,
      },
      outreach_strategy: {
        section: 'outreach_strategy',
        content: 'Lead with the \\"Platform Consolidation\\" angle.\\n\\n- Tie value to tool sprawl reduction\\n- Emphasize stakeholder alignment',
        source_ids: ['s1'],
        confidence: 0.84,
      },
      unknowns: {
        section: 'unknowns',
        content: '- Budget owner is unclear\\n- Renewal date is not publicly available',
        source_ids: [],
        confidence: 0.75,
      },
    },
    sources: [
      {
        id: 's1',
        url: 'https://example.com/source',
        title: 'Fixture Source',
        snippet: 'Fixture snippet',
        tier: 1,
        retrieved_at: '2026-06-23T08:01:00.000Z',
      },
    ],
    financials: {},
    meta: {
      quality_score: 0.82,
      revisions: 0,
      company_type: 'private',
      errors: [],
    },
  },
}

const MOCK_CHAT_HISTORY = [
  {
    role: 'assistant',
    content: 'Here are the priorities:\\n1. Confirm buying committee\\n2. Align on rollout timing\\n\\n- Key risk: security review bottlenecks',
  },
]

async function mockFormattingApis(page: Page) {
  await page.route(`**/api/sessions/${MOCK_SESSION_ID}`, async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SESSION_DETAIL),
    })
  })

  await page.route(`**/api/sessions/${MOCK_SESSION_ID}/chat`, async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_CHAT_HISTORY),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ role: 'assistant', content: 'ok' }),
    })
  })
}

test.describe('Formatting normalization and rendering', () => {
  test.beforeEach(async ({ page }) => {
    await mockFormattingApis(page)
    await page.goto(`/sessions/${MOCK_SESSION_ID}`)
    await expect(page.getByRole('heading', { level: 1, name: 'Formatting Fixture Co' })).toBeVisible()
  })

  test('renders report sections without escaped artifacts and preserves list formatting', async ({ page }) => {
    const discoverySection = page
      .getByRole('heading', { name: /Discovery Questions/i })
      .locator('xpath=ancestor::section[1]')

    await expect(discoverySection).toBeVisible()
    await expect(discoverySection.locator('ol li')).toHaveCount(2)
    await expect(discoverySection.locator('ul li')).toHaveCount(2)
    await expect(discoverySection).toContainText('What is the current procurement timeline?')
    await expect(discoverySection).not.toContainText('\\n')

    const outreachSection = page
      .getByRole('heading', { name: /Outreach Strategy/i })
      .locator('xpath=ancestor::section[1]')
    await expect(outreachSection).toContainText('"Platform Consolidation"')
    await expect(outreachSection).not.toContainText('\\"')
  })

  test('renders chat history markdown without literal escape sequences', async ({ page }) => {
    const assistantBubble = page.locator('.chat-assistant').first()
    await expect(assistantBubble).toBeVisible()
    await expect(assistantBubble.locator('ol li')).toHaveCount(2)
    await expect(assistantBubble.locator('ul li')).toHaveCount(1)
    await expect(assistantBubble).toContainText('Confirm buying committee')
    await expect(assistantBubble).not.toContainText('\\n')
  })
})
