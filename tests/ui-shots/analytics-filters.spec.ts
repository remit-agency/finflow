import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { registerViaUi, waitForShell } from '../e2e/helpers/app-ui'
import { seedDoc } from '../e2e/helpers/emulator-firestore'
import { seedLedgerAccount, seedLedgerOperation } from '../e2e/helpers/ledger-seed'
import { todayDay } from '../../lib/utils/today'
import pl from '../../messages/pl.json'
import uk from '../../messages/uk.json'

// S10f: the report filters (Cash Flow with «Фільтри» and the hint, the dialog, the tags and the payment types lists open,
// the Balance with an account filter) at 1440 and 390 px in uk and pl. Files: analytics-filters-<state>-<desktop|phone>-<uk|pl>.png.
const OUT_DIR = join(process.cwd(), 'ui-shots')
const VIEWPORTS = [
  { form: 'desktop', width: 1440, height: 900 },
  { form: 'phone', width: 390, height: 844 },
] as const
const LOCALES = [
  ['uk', uk],
  ['pl', pl],
] as const
const LONG_TAG = 'Koszty reprezentacyjne i delegacje zagraniczne'
const LONG_CATEGORY = 'Usługi księgowe, prawne i doradztwo podatkowe dla spółki'

/** A tag in the exact shape the server stores (lib/domain/tags/doc.ts). */
function tagDoc(orgId: string, name: string, color: string, flags: { excludeFromAnalytics?: boolean; archived?: boolean } = {}) {
  return {
    schemaVersion: 1,
    name,
    color,
    excludeFromAnalytics: flags.excludeFromAnalytics === true,
    archived: flags.archived === true,
    recalcPending: false,
    orgId,
    createdAt: new Date(),
    createdBy: 'shots',
    updatedAt: new Date(),
  }
}

test.describe('analytics filters shots', () => {
  test.skip(
    !process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST,
    'Run with `npm run ui:shots` (it starts the Auth + Firestore emulators)',
  )

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true })
    for (const old of readdirSync(OUT_DIR)) {
      if (old.startsWith('analytics-filters-') && old.endsWith('.png')) rmSync(join(OUT_DIR, old), { force: true })
    }
  })

  for (const [locale, messages] of LOCALES) {
    test(`analytics filters in ${locale}`, async ({ page, request, context }) => {
      test.setTimeout(300_000)
      await page.setViewportSize({ width: 1440, height: 900 })
      const user = await registerViaUi(page, `afshots${locale}`, 'PLN')
      await waitForShell(page, user.companyName)
      const org = user.orgId
      const m = messages.analytics.filters

      await seedLedgerAccount(request, org, 'acc-main', { name: 'Konto główne Millennium', balance: 25000, currency: 'PLN' })
      await seedLedgerAccount(request, org, 'acc-vat', { name: 'Rachunek VAT', balance: 1200, currency: 'PLN' })
      await seedDoc(request, `organizations/${org}/categories`, 'cat-fees', { name: LONG_CATEGORY, type: 'expense', color: '#6366f1', orgId: org, createdAt: new Date() })
      await seedDoc(request, `organizations/${org}/tags`, 'tag-vat', tagDoc(org, 'ПДВ', 'rose', { excludeFromAnalytics: true }))
      await seedDoc(request, `organizations/${org}/tags`, 'tag-long', tagDoc(org, LONG_TAG, 'violet'))
      await seedDoc(request, `organizations/${org}/tags`, 'tag-old', tagDoc(org, 'Stare', 'slate', { archived: true }))
      const day = todayDay()
      const main = { accountId: 'acc-main', currency: 'PLN', date: day }
      await seedLedgerOperation(request, org, 'op-1', { ...main, type: 'income', amount: 4200, description: 'Faktura 12/11' })
      await seedLedgerOperation(request, org, 'op-2', { ...main, type: 'expense', amount: 230, description: 'VAT', tags: ['tag-vat'], excluded: true })
      await seedLedgerOperation(request, org, 'op-3', { type: 'income', accountId: 'acc-vat', currency: 'PLN', date: day, amount: 230, description: 'VAT', tags: ['tag-vat'], excluded: true })
      await seedLedgerOperation(request, org, 'op-4', { ...main, type: 'expense', amount: 650, description: 'Biuro rachunkowe', categoryId: 'cat-fees', tags: ['tag-long'] })

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
          await page.screenshot({ path: join(OUT_DIR, `analytics-filters-${state}-${viewport.form}-${locale}.png`), animations: 'disabled' })
        }
        const dialog = page.getByRole('dialog', { name: m.title })

        await page.goto(`/${org}/analytics/cashflow?tg=tag-vat`)
        await waitForShell(page, user.companyName)
        await expect(page.getByTestId('analytics-excluded-hint')).toBeVisible()
        await noHorizontalScroll('report')
        await shot('report')

        await page.getByRole('button', { name: m.buttonActive.replace('{count}', '1') }).click()
        await expect(dialog).toBeVisible()
        await dialogFits('dialog')
        await shot('dialog')

        // The tags list: search, «Усі теги», the excluded tag with its note, a long name that wraps, an archived tag, «Без тегів».
        await dialog.getByRole('button', { name: `${m.tags.label} (1)` }).click()
        await expect(dialog.getByRole('option', { name: m.tags.untagged })).toBeVisible()
        await dialogFits('tags')
        await shot('tags')
        await dialog.getByRole('button', { name: m.choose }).click()

        // The payment types with their categories (a long category name that wraps).
        await dialog.getByRole('button', { name: m.kinds.label, exact: true }).click()
        // The list scrolls inside its box: bring the long category (under «Витрата» or «Wydatek») into the picture.
        const longCategory = dialog.getByRole('option', { name: LONG_CATEGORY })
        await expect(longCategory).toBeVisible()
        await longCategory.scrollIntoViewIfNeeded()
        await dialogFits('kinds')
        await shot('kinds')
        await page.keyboard.press('Escape')
        await page.keyboard.press('Escape')
        await expect(dialog).toBeHidden()

        await page.goto(`/${org}/analytics/balance?accounts=acc-vat`)
        await waitForShell(page, user.companyName)
        await expect(page.getByTestId('analytics-filters-count')).toHaveText('1')
        await noHorizontalScroll('balance')
        await shot('balance')
      }
    })
  }
})
