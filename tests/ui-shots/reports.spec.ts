import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { registerViaUi, waitForShell } from '../e2e/helpers/app-ui'
import { seedDoc } from '../e2e/helpers/emulator-firestore'
import { seedLedgerAccount } from '../e2e/helpers/ledger-seed'
import { postOperation } from '../e2e/helpers/report-seed'
import { addDays, monthOf } from '../../lib/domain/ledger/days'
import { todayDay } from '../../lib/utils/today'

// S12: the server reports (Cash Flow with its reconciliation, P&L) at 1440 and 390 px in uk
// and pl, with an EUR account (the NBP stub's rate), a tagged VAT payment excluded from analytics and a subcategory.
// Files: reports-<cashflow|reconciliation|pl>-<desktop|phone>-<uk|pl>.png.
const OUT_DIR = join(process.cwd(), 'ui-shots')
const VIEWPORTS = [
  { form: 'desktop', width: 1440, height: 900 },
  { form: 'phone', width: 390, height: 844 },
] as const
const LOCALES = ['uk', 'pl'] as const

test.describe('reports shots', () => {
  test.skip(
    !process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST,
    'Run with `npm run ui:shots` (it starts the Auth + Firestore emulators)',
  )

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true })
    for (const old of readdirSync(OUT_DIR)) {
      if (old.startsWith('reports-') && old.endsWith('.png')) rmSync(join(OUT_DIR, old), { force: true })
    }
  })

  for (const locale of LOCALES) {
    test(`reports in ${locale}`, async ({ page, request, context }) => {
      test.setTimeout(300_000)
      await page.setViewportSize({ width: 1440, height: 900 })
      const user = await registerViaUi(page, `rpshots${locale}`, 'PLN')
      await waitForShell(page, user.companyName)
      const org = user.orgId
      const day = todayDay()
      const firstOfMonth = `${monthOf(day)}-01`

      await seedLedgerAccount(request, org, 'acc-main', { name: 'Konto główne Millennium', balance: 25000, currency: 'PLN' })
      await seedLedgerAccount(request, org, 'acc-eur', { name: 'Rachunek walutowy EUR', balance: 1250, currency: 'EUR', color: '#6366f1' })
      const createdAt = new Date()
      await seedDoc(request, `organizations/${org}/categories`, 'cat-consult', { name: 'Usługi doradcze', type: 'income', color: '#10b981', orgId: org, createdAt })
      await seedDoc(request, `organizations/${org}/categories`, 'cat-it', { name: 'Oprogramowanie i licencje', type: 'expense', color: '#6366f1', orgId: org, createdAt })
      await seedDoc(request, `organizations/${org}/categories`, 'cat-cloud', { name: 'Chmura', type: 'expense', color: '#818cf8', parentId: 'cat-it', orgId: org, createdAt })
      await seedDoc(request, `organizations/${org}/tags`, 'tag-vat', {
        schemaVersion: 1, name: 'ПДВ', color: 'rose', excludeFromAnalytics: true, archived: false, recalcPending: false, orgId: org, createdAt, createdBy: 'shots', updatedAt: createdAt,
      })
      await postOperation(page, org, { type: 'income', accountId: 'acc-main', amountMinor: 1_240_000, paymentDate: firstOfMonth, categoryId: 'cat-consult', description: 'Faktura 14/11' })
      await postOperation(page, org, { type: 'income', accountId: 'acc-main', amountMinor: 980_000, paymentDate: addDays(firstOfMonth, -5), categoryId: 'cat-consult', description: 'Faktura 9/10' })
      await postOperation(page, org, { type: 'expense', accountId: 'acc-main', amountMinor: 320_000, paymentDate: day, categoryId: 'cat-it', description: 'Licencje roczne' })
      await postOperation(page, org, { type: 'expense', accountId: 'acc-main', amountMinor: 86_000, paymentDate: day, categoryId: 'cat-cloud', description: 'Hosting' })
      await postOperation(page, org, { type: 'expense', accountId: 'acc-main', amountMinor: 230_000, paymentDate: day, tags: ['tag-vat'], description: 'VAT na rachunek VAT' })
      await postOperation(page, org, { type: 'income', accountId: 'acc-eur', amountMinor: 50_000, paymentDate: day, categoryId: 'cat-consult', description: 'Invoice EU 7/11' })
      await postOperation(page, org, { type: 'transfer', accountId: 'acc-main', toAccountId: 'acc-eur', amountMinor: 430_000, toAmountMinor: 100_000, paymentDate: day, description: 'Wymiana walut' })

      if (locale !== 'uk') await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: 'http://localhost:3000' }])

      // The first visit to a route on a cold dev server compiles it: warm the two routes before the timed waits.
      for (const path of ['analytics/cashflow', 'analytics/pl']) await page.request.get(`/${org}/${path}`)

      const noHorizontalScroll = async (what: string): Promise<void> => {
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        expect(over, `${what}: the page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0)
      }
      // Recharts animates in JavaScript (not CSS), so a shot taken on arrival catches the pies and bars at zero: wait for it
      // (the same 1.5 s the analytics shots wait), and move the pointer off the chart so no tooltip is in the picture.
      const settleChart = async (): Promise<void> => {
        await page.mouse.move(0, 0)
        await page.waitForTimeout(1500)
      }

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        const shot = async (state: string): Promise<void> => {
          await page.screenshot({ path: join(OUT_DIR, `reports-${state}-${viewport.form}-${locale}.png`), animations: 'disabled' })
        }

        await page.goto(`/${org}/analytics/cashflow`)
        await waitForShell(page, user.companyName)
        await expect(page.getByTestId('report-source')).toBeVisible()
        await expect(page.getByTestId('reconciliation')).toBeVisible()
        await noHorizontalScroll('cash flow')
        await settleChart()
        await shot('cashflow')
        // The whole reconciliation block, bottom edge on the bottom of the screen (its note is the last line of the page).
        await page.getByTestId('reconciliation').evaluate((el) => el.scrollIntoView({ block: 'end' }))
        await shot('reconciliation')

        await page.goto(`/${org}/analytics/pl`)
        await waitForShell(page, user.companyName)
        await expect(page.getByTestId('report-source')).toBeVisible()
        await noHorizontalScroll('p&l')
        await settleChart()
        await shot('pl')
      }
    })
  }
})
