import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, type Locator, type Page } from '@playwright/test'
import { registerViaUi, waitForShell } from '../e2e/helpers/app-ui'
import { seedDoc } from '../e2e/helpers/emulator-firestore'
import { seedLedgerAccount, utcDay } from '../e2e/helpers/ledger-seed'
import { todayDay } from '../../lib/utils/today'

// S08: the journal at 1440 and 390 px, Ukrainian and Polish, for the visual review against
// docs/research/finmap-reverse-engineering.md section 2.1. Files: journal-<state>-<desktop|phone>-<uk|pl>.png.
// The operations go through the real endpoint, so the balances and the day sums are the real ones.
const OUT_DIR = join(process.cwd(), 'ui-shots')
const VIEWPORTS = [
  { form: 'desktop', width: 1440, height: 900 },
  { form: 'phone', width: 390, height: 844 },
] as const

const dayOffset = (n: number): string => {
  const d = new Date(`${todayDay()}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return utcDay(d)
}
const rowsOf = (page: Page): Locator => page.locator('tbody').getByRole('row').filter({ has: page.getByRole('checkbox') })

test.describe('journal shots', () => {
  test.skip(
    !process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST,
    'Run with `npm run ui:shots` (it starts the Auth + Firestore emulators)',
  )

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true })
    for (const old of readdirSync(OUT_DIR)) {
      if (old.startsWith('journal-') && old.endsWith('.png')) rmSync(join(OUT_DIR, old), { force: true })
    }
  })

  for (const locale of ['uk', 'pl'] as const) {
    test(`journal in ${locale}`, async ({ page, request, context }) => {
      test.setTimeout(300_000)
      await page.setViewportSize({ width: 1440, height: 900 })
      const user = await registerViaUi(page, `jshots${locale}`, 'PLN')
      await waitForShell(page, user.companyName)
      const org = user.orgId
      await seedLedgerAccount(request, org, 'acc-main', { name: 'Konto główne', balance: 25000, currency: 'PLN' })
      await seedLedgerAccount(request, org, 'acc-cash', { name: 'Kasa', balance: 1500, currency: 'PLN', type: 'cash' })
      for (const [id, name, type] of [
        ['cat-rent', 'Czynsz biura', 'expense'],
        ['cat-fuel', 'Paliwo', 'expense'],
        ['cat-sales', 'Sprzedaż usług', 'income'],
      ] as const) {
        await seedDoc(request, `organizations/${org}/categories`, id, { name, type, color: '#22c55e', orgId: org, createdAt: new Date() })
      }
      await seedDoc(request, `organizations/${org}/counterparties`, 'cp-acme', {
        name: 'Acme Sp. z o.o.',
        ibans: [],
        archived: false,
        schemaVersion: 1,
        orgId: org,
        createdAt: new Date(),
      })

      // A few dozen operations, oldest first so the order inside a day follows the creation order.
      const post = async (body: Record<string, unknown>): Promise<void> => {
        const res = await page.request.post(`/api/orgs/${org}/transactions`, { data: body, headers: { Origin: 'http://localhost:3000' } })
        expect(res.status(), await res.text()).toBe(201)
      }
      for (let i = 34; i >= 0; i--) {
        const base = { paymentDate: dayOffset(-i), amountMinor: 1500 + ((i * 7919) % 90000) }
        if (i % 7 === 0) await post({ ...base, type: 'income', accountId: 'acc-main', categoryId: 'cat-sales', counterpartyId: 'cp-acme', description: 'Faktura za usługi' })
        else if (i % 7 === 3) await post({ ...base, type: 'transfer', accountId: 'acc-main', toAccountId: 'acc-cash', description: 'Wpłata do kasy' })
        else if (i % 5 === 1) await post({ ...base, type: 'expense', accountId: 'acc-cash', description: 'Drobne wydatki' }) // no category, no counterparty
        else if (i === 12) await post({ ...base, type: 'expense', accountId: 'acc-main', categoryId: 'cat-rent', description: 'Czynsz za kwartał', accrual: { mode: 'period', from: dayOffset(-40), to: dayOffset(50) } })
        else await post({ ...base, type: 'expense', accountId: 'acc-main', categoryId: i % 2 ? 'cat-fuel' : 'cat-rent', counterpartyId: i % 3 ? undefined : 'cp-acme', description: i % 4 ? 'Zakup bieżący' : '' })
      }
      await post({ type: 'expense', status: 'planned', accountId: 'acc-main', paymentDate: dayOffset(6), amountMinor: 45000, categoryId: 'cat-rent', description: 'Planowany czynsz' })

      if (locale !== 'uk') await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: 'http://localhost:3000' }])

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        const shot = async (state: string): Promise<void> => {
          await page.screenshot({ path: join(OUT_DIR, `journal-${state}-${viewport.form}-${locale}.png`), animations: 'disabled' })
        }
        await page.goto(`/${org}/transactions`)
        await waitForShell(page, user.companyName)
        await expect(rowsOf(page).first()).toBeVisible()
        await expect(rowsOf(page)).toHaveCount(36)
        await shot('list')

        // The older part: period operation, transfers, chips.
        await rowsOf(page).nth(14).scrollIntoViewIfNeeded()
        await shot('scrolled')
        await page.evaluate(() => window.scrollTo(0, 0))

        for (const i of [1, 2, 4]) await rowsOf(page).nth(i).getByRole('checkbox').check()
        await expect(page.getByRole('region').filter({ has: page.getByRole('button') }).last()).toBeVisible()
        await shot('selected')
        // The selection bar must stay on screen when the page scrolls.
        await rowsOf(page).nth(20).scrollIntoViewIfNeeded()
        await shot('selected-scrolled')
        for (const i of [1, 2, 4]) await rowsOf(page).nth(i).getByRole('checkbox').uncheck()

        await page.goto(`/${org}/transactions?q=zzzznomatch`)
        await waitForShell(page, user.companyName)
        await expect(rowsOf(page)).toHaveCount(0)
        await page.waitForTimeout(500)
        await shot('empty')
      }
    })
  }
})
