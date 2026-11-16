import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { registerViaUi, waitForShell } from '../e2e/helpers/app-ui'
import { dayFromToday } from '../e2e/helpers/bank-seed'
import { seedLedgerAccount, seedLedgerOperation } from '../e2e/helpers/ledger-seed'
import { seedPlanned } from '../e2e/helpers/recurring-seed'

// S13: the cash gap banner in the journal, the payment calendar (the month grid, the chart and the day panel) at 1440 and 390 px
// in uk and pl. Files: forecast-<state>-<desktop|phone>-<uk|pl>.png. Run with `npm run ui:shots`.
const OUT_DIR = join(process.cwd(), 'ui-shots')
const VIEWPORTS = [
  { form: 'desktop', width: 1440, height: 900 },
  { form: 'phone', width: 390, height: 844 },
] as const
const LOCALES = ['uk', 'pl'] as const

test.describe('forecast shots', () => {
  test.skip(
    !process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST,
    'Run with `npm run ui:shots` (it starts the Auth + Firestore emulators)',
  )

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true })
    for (const old of readdirSync(OUT_DIR)) {
      if (old.startsWith('forecast-') && old.endsWith('.png')) rmSync(join(OUT_DIR, old), { force: true })
    }
  })

  for (const locale of LOCALES) {
    test(`payment calendar in ${locale}`, async ({ page, request, context }) => {
      test.setTimeout(300_000)
      await page.setViewportSize({ width: 1440, height: 900 })
      const user = await registerViaUi(page, `fcshots${locale}`, 'PLN')
      await waitForShell(page, user.companyName)
      const org = user.orgId
      // The gap day is five days ahead; the grid, the chart and the panel show its month, so the gap is in view.
      const gapDay = dayFromToday(5)
      const month = gapDay.slice(0, 7)

      // A bank account that spent 50 yesterday (balance 950), a payment in, the VAT that opens the gap, and a later bill.
      await seedLedgerAccount(request, org, 'acc-main', { name: 'Konto główne', balance: 950, opening: 1000, currency: 'PLN' })
      await seedLedgerOperation(request, org, 'op-yesterday', { type: 'expense', accountId: 'acc-main', amount: 50, currency: 'PLN', date: dayFromToday(-1), description: 'Zakupy biuro' })
      await seedPlanned(page, org, { type: 'income', accountId: 'acc-main', amountMinor: 20_000, paymentDate: dayFromToday(2), description: 'Zwrot od klienta' })
      await seedPlanned(page, org, { type: 'expense', accountId: 'acc-main', amountMinor: 150_000, paymentDate: gapDay, description: 'VAT-7' })
      await seedPlanned(page, org, { type: 'expense', accountId: 'acc-main', amountMinor: 12_000, paymentDate: dayFromToday(9), description: 'Internet' })

      if (locale !== 'uk') await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: 'http://localhost:3000' }])

      const noHorizontalScroll = async (what: string): Promise<void> => {
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        expect(over, `${what}: the page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0)
      }
      const dialogFits = async (what: string): Promise<void> => {
        const box = await page.getByRole('dialog').boundingBox()
        const vp = page.viewportSize()
        expect(box, `${what}: no dialog`).not.toBeNull()
        if (box && vp) {
          expect(box.x, `${what}: dialog left`).toBeGreaterThanOrEqual(0)
          expect(box.y, `${what}: dialog top`).toBeGreaterThanOrEqual(0)
          expect(box.x + box.width, `${what}: dialog right`).toBeLessThanOrEqual(vp.width + 0.5)
          expect(box.y + box.height, `${what}: dialog bottom`).toBeLessThanOrEqual(vp.height + 0.5)
        }
      }

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        const shot = async (state: string): Promise<void> => {
          await page.screenshot({ path: join(OUT_DIR, `forecast-${state}-${viewport.form}-${locale}.png`), animations: 'disabled' })
        }

        await page.goto(`/${org}/transactions`)
        await waitForShell(page, user.companyName)
        await expect(page.getByTestId('cash-gap-title')).toBeVisible()
        await noHorizontalScroll('journal')
        await shot('banner')

        await page.goto(`/${org}/analytics/calendar?month=${month}`)
        await waitForShell(page, user.companyName)
        await expect(page.getByTestId('cal-grid')).toBeVisible()
        await expect(page.locator(`[data-testid="cal-day"][data-date="${gapDay}"][data-gap="true"]`)).toBeVisible()
        await noHorizontalScroll('grid')
        await shot('grid')

        await page.goto(`/${org}/analytics/calendar?month=${month}&view=chart`)
        await waitForShell(page, user.companyName)
        await expect(page.getByTestId('cal-chart')).toBeVisible()
        await expect(page.locator('.recharts-line-curve').first()).toBeVisible()
        // The lines draw in over about 1.5 s; the shot is taken after that, with the pointer off the chart (no tooltip).
        await page.waitForTimeout(1_800)
        await page.mouse.move(0, 0)
        await noHorizontalScroll('chart')
        await shot('chart')

        await page.goto(`/${org}/analytics/calendar?month=${month}&day=${gapDay}`)
        await waitForShell(page, user.companyName)
        await expect(page.getByTestId('day-planned').filter({ hasText: 'VAT-7' })).toBeVisible()
        await dialogFits('day panel')
        await shot('day')
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog')).toBeHidden()
      }
    })
  }
})
