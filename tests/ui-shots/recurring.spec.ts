import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { registerViaUi, waitForShell } from '../e2e/helpers/app-ui'
import { dayFromToday } from '../e2e/helpers/bank-seed'
import { seedLedgerAccount } from '../e2e/helpers/ledger-seed'
import { isoWeekdayOf, seedPlanned, seedSeries } from '../e2e/helpers/recurring-seed'
import { seedBankOperation } from '../e2e/helpers/transfer-seed'
import { todayDay } from '../../lib/utils/today'
import pl from '../../messages/pl.json'
import uk from '../../messages/uk.json'

// S11: planned payments (the page with the strip, the series and the upcoming plans; the ZUS preset editor; the journal
// with the matches banner and an overdue plan; the matches dialog) at 1440 and 390 px in uk and pl.
// Files: recurring-<state>-<desktop|phone>-<uk|pl>.png.
const OUT_DIR = join(process.cwd(), 'ui-shots')
const VIEWPORTS = [
  { form: 'desktop', width: 1440, height: 900 },
  { form: 'phone', width: 390, height: 844 },
] as const
const LOCALES = [
  ['uk', uk],
  ['pl', pl],
] as const

test.describe('recurring shots', () => {
  test.skip(
    !process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST,
    'Run with `npm run ui:shots` (it starts the Auth + Firestore emulators)',
  )

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true })
    for (const old of readdirSync(OUT_DIR)) {
      if (old.startsWith('recurring-') && old.endsWith('.png')) rmSync(join(OUT_DIR, old), { force: true })
    }
  })

  for (const [locale, messages] of LOCALES) {
    test(`planned payments in ${locale}`, async ({ page, request, context }) => {
      test.setTimeout(300_000)
      await page.setViewportSize({ width: 1440, height: 900 })
      const user = await registerViaUi(page, `rcshots${locale}`, 'PLN')
      await waitForShell(page, user.companyName)
      const org = user.orgId
      const day = todayDay()

      await seedLedgerAccount(request, org, 'acc-main', { name: 'Konto główne Millennium', balance: 25000, currency: 'PLN' })
      // ZUS (an estimate), the office rent on today's day (its bank payment came today: a match), a weekly gym, an overdue invoice.
      await seedSeries(page, org, { name: 'ZUS', kind: 'expense', accountId: 'acc-main', amountMinor: 160_000, frequency: 'monthly', startDate: day, preset: 'zus' })
      await seedSeries(page, org, { name: 'Czynsz biuro Gdańsk Wrzeszcz', kind: 'expense', accountId: 'acc-main', amountMinor: 350_000, frequency: 'monthly', dayOfMonth: Number(day.slice(8, 10)), startDate: day })
      await seedSeries(page, org, { name: 'Siłownia', kind: 'expense', accountId: 'acc-main', amountMinor: 15_000, frequency: 'weekly', weekday: isoWeekdayOf(day), startDate: dayFromToday(1) })
      await seedPlanned(page, org, { type: 'expense', accountId: 'acc-main', amountMinor: 42_000, paymentDate: dayFromToday(-4), description: 'Faktura Energa' })
      await seedBankOperation(page, request, org, { key: `${locale}rent00001`, type: 'expense', accountId: 'acc-main', amountMinor: 350_000, paymentDate: day, remittance: 'Czynsz biuro listopad' })

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
          await page.screenshot({ path: join(OUT_DIR, `recurring-${state}-${viewport.form}-${locale}.png`), animations: 'disabled' })
        }
        const dialog = page.getByRole('dialog')

        await page.goto(`/${org}/recurring`)
        await waitForShell(page, user.companyName)
        await expect(page.getByTestId('recurring-strip')).toBeVisible()
        await expect(page.getByTestId('series-row')).toHaveCount(3)
        await noHorizontalScroll('page')
        await shot('page')

        await page.getByTestId('preset-menu').click()
        await page.getByTestId('preset-zus').click()
        await expect(dialog.locator('#series-name')).toHaveValue('ZUS')
        await dialogFits('editor')
        await shot('editor')
        await dialog.getByRole('button', { name: messages.recurring.editor.cancel }).click()
        await expect(dialog).toBeHidden()

        await page.goto(`/${org}/transactions?status=all`)
        await waitForShell(page, user.companyName)
        const banner = page.getByTestId('plan-matches')
        await expect(banner).toBeVisible()
        await expect(page.getByTestId('overdue-chip')).toBeVisible()
        await noHorizontalScroll('journal')
        await shot('journal')

        await banner.getByRole('button', { name: messages.journal.plans.bannerOpen }).click()
        await expect(dialog.getByTestId('plan-match')).toHaveCount(1)
        await dialogFits('matches')
        await shot('matches')
        await dialog.getByRole('button', { name: messages.journal.plans.later }).click()
        await expect(dialog).toBeHidden()
      }
    })
  }
})
