import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { registerViaUi, waitForShell } from '../e2e/helpers/app-ui'
import { dayFromToday } from '../e2e/helpers/bank-seed'
import { seedLedgerAccount } from '../e2e/helpers/ledger-seed'
import { seedBankOperation } from '../e2e/helpers/transfer-seed'
import pl from '../../messages/pl.json'
import uk from '../../messages/uk.json'

// S10b: own transfers (the journal with the suggestions banner and a transfer row with its arrival day, the suggestions
// dialog, «Зробити переказом», the form of a bank transfer with «Розділити переказ») at 1440 and 390 px in uk and pl.
// Files: transfers-<state>-<desktop|phone>-<uk|pl>.png.
const OUT_DIR = join(process.cwd(), 'ui-shots')
const VIEWPORTS = [
  { form: 'desktop', width: 1440, height: 900 },
  { form: 'phone', width: 390, height: 844 },
] as const
const LOCALES = [
  ['uk', uk],
  ['pl', pl],
] as const
const ORIGIN = { Origin: 'http://localhost:3000' }

test.describe('transfers shots', () => {
  test.skip(
    !process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST,
    'Run with `npm run ui:shots` (it starts the Auth + Firestore emulators)',
  )

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true })
    for (const old of readdirSync(OUT_DIR)) {
      if (old.startsWith('transfers-') && old.endsWith('.png')) rmSync(join(OUT_DIR, old), { force: true })
    }
  })

  for (const [locale, messages] of LOCALES) {
    test(`transfers in ${locale}`, async ({ page, request, context }) => {
      test.setTimeout(300_000)
      await page.setViewportSize({ width: 1440, height: 900 })
      const user = await registerViaUi(page, `trshots${locale}`, 'PLN')
      await waitForShell(page, user.companyName)
      const org = user.orgId
      const m = messages.journal.transfers

      await seedLedgerAccount(request, org, 'acc-main', { name: 'Konto główne Millennium', balance: 25000, currency: 'PLN' })
      await seedLedgerAccount(request, org, 'acc-mono', { name: 'Monobank firmowy', balance: 4000, currency: 'PLN' })
      await seedLedgerAccount(request, org, 'acc-cash', { name: 'Kasa', balance: 1500, currency: 'PLN', type: 'cash' })
      // A pair the journal suggests (both today), a merged pair of two days, a cash machine withdrawal to convert.
      const op = (key: string, type: 'income' | 'expense', accountId: string, amountMinor: number, days: number, remittance: string) =>
        seedBankOperation(page, request, org, { key: `${locale}${key}`, type, accountId, amountMinor, paymentDate: dayFromToday(days), remittance })
      await op('sugout001', 'expense', 'acc-main', 150_000, 0, 'Przelew własny na Monobank')
      await op('sugin0001', 'income', 'acc-mono', 150_000, 0, 'Przelew z Millennium')
      const out = await op('mrgout001', 'expense', 'acc-main', 300_000, -3, 'Zasilenie konta Monobank')
      const inc = await op('mrgin0001', 'income', 'acc-mono', 300_000, -2, 'Zasilenie z Millennium')
      const merged = await page.request.post(`/api/orgs/${org}/transfers`, { headers: ORIGIN, data: { merge: [out, inc] } })
      expect(merged.status()).toBe(200)
      await op('atm000001', 'expense', 'acc-main', 100_000, -1, 'Bankomat Euronet Gdańsk')

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
        // The frame can fit while its content does not: a nowrap line widens the dialog's grid, and the text and buttons run out.
        const spill = await page.getByRole('dialog').evaluate((el) => {
          const frame = el.getBoundingClientRect()
          let worst = 0
          for (const node of Array.from(el.querySelectorAll('*'))) {
            const r = node.getBoundingClientRect()
            if (r.width === 0 && r.height === 0) continue
            worst = Math.max(worst, r.right - frame.right, frame.left - r.left)
          }
          return worst
        })
        expect(spill, `${what}: content runs ${spill.toFixed(1)}px past the dialog frame`).toBeLessThanOrEqual(0.5)
      }

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        const shot = async (state: string): Promise<void> => {
          await page.screenshot({ path: join(OUT_DIR, `transfers-${state}-${viewport.form}-${locale}.png`), animations: 'disabled' })
        }
        const dialog = page.getByRole('dialog')
        const rows = page.locator('tbody').getByRole('row')

        await page.goto(`/${org}/transactions`)
        await waitForShell(page, user.companyName)
        const banner = page.getByTestId('transfer-suggestions')
        await expect(banner).toBeVisible()
        await expect(page.getByTestId(viewport.form === 'phone' ? 'transfer-arrival-phone' : 'transfer-arrival')).toBeVisible()
        await noHorizontalScroll('journal')
        await shot('journal')
        if (viewport.form === 'phone') {
          // The transfer row is below the first screen on a phone: its arrival day and «з банку» mark, in view.
          await rows.filter({ hasText: 'Zasilenie konta Monobank' }).scrollIntoViewIfNeeded()
          await shot('journal-transfer')
        }

        await banner.getByRole('button', { name: m.bannerOpen }).click()
        await expect(dialog.getByTestId('transfer-suggestion')).toHaveCount(1)
        await dialogFits('suggestions')
        await shot('suggestions')
        await dialog.getByRole('button', { name: m.later }).click()
        await expect(dialog).toBeHidden()

        // The withdrawal: select it, then «Зробити переказом» with the cash box chosen; cancelled, nothing changes.
        await rows.filter({ hasText: 'Bankomat Euronet' }).getByRole('checkbox').check()
        const bar = page.getByRole('region', { name: messages.journal.selection.region })
        await bar.getByRole('button', { name: m.convert }).click()
        await dialog.locator('#transfer-target').selectOption({ label: 'Kasa' })
        await dialogFits('convert')
        await shot('convert')
        await dialog.getByRole('button', { name: m.convertCancel }).click()
        await expect(dialog).toBeHidden()
        await bar.getByRole('button', { name: messages.journal.selection.clear }).click()

        // The merged transfer opens locked, with «Розділити переказ»; closed without a change.
        await rows.filter({ hasText: 'Zasilenie konta Monobank' }).getByRole('button', { name: /Millennium → Monobank/ }).click()
        await expect(dialog.getByTestId('split-transfer')).toBeVisible()
        await dialogFits('form')
        await shot('form')
        await page.keyboard.press('Escape')
        await expect(dialog).toBeHidden()
      }
    })
  }
})
