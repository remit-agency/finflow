import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { registerViaUi, waitForShell } from '../e2e/helpers/app-ui'
import { replaceDoc, seedDoc } from '../e2e/helpers/emulator-firestore'
import { seedLedgerAccount, seedLedgerOperation } from '../e2e/helpers/ledger-seed'
import pl from '../../messages/pl.json'
import uk from '../../messages/uk.json'

// S10t: the tags UI (settings/tags with the editor, the flag confirmation and the recalculation, the form field, the
// journal chips and the tag filter) at 1440 and 390 px in uk and pl. Files: tags-<state>-<desktop|phone>-<uk|pl>.png.
const OUT_DIR = join(process.cwd(), 'ui-shots')
const VIEWPORTS = [
  { form: 'desktop', width: 1440, height: 900 },
  { form: 'phone', width: 390, height: 844 },
] as const
const LOCALES = [
  ['uk', uk],
  ['pl', pl],
] as const
const LONG = 'Koszty reprezentacyjne i delegacje zagraniczne'

/** A tag in the exact shape the server stores (lib/domain/tags/doc.ts). */
function tagDoc(orgId: string, name: string, color: string, flags: { excludeFromAnalytics?: boolean; archived?: boolean; recalcPending?: boolean } = {}) {
  return {
    schemaVersion: 1,
    name,
    color,
    excludeFromAnalytics: flags.excludeFromAnalytics === true,
    archived: flags.archived === true,
    recalcPending: flags.recalcPending === true,
    orgId,
    createdAt: new Date(),
    createdBy: 'shots',
    updatedAt: new Date(),
  }
}

test.describe('tags shots', () => {
  test.skip(
    !process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST,
    'Run with `npm run ui:shots` (it starts the Auth + Firestore emulators)',
  )

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true })
    for (const old of readdirSync(OUT_DIR)) {
      if (old.startsWith('tags-') && old.endsWith('.png')) rmSync(join(OUT_DIR, old), { force: true })
    }
  })

  for (const [locale, messages] of LOCALES) {
    test(`tags in ${locale}`, async ({ page, request, context }) => {
      test.setTimeout(300_000)
      await page.setViewportSize({ width: 1440, height: 900 })
      const user = await registerViaUi(page, `tgshots${locale}`, 'PLN')
      await waitForShell(page, user.companyName)
      const org = user.orgId
      const m = messages.settings.tags

      await seedLedgerAccount(request, org, 'acc-main', { name: 'Konto główne', balance: 25000, currency: 'PLN' })
      await seedLedgerAccount(request, org, 'acc-cash', { name: 'Kasa', balance: 1500, currency: 'PLN', type: 'cash' })
      await seedDoc(request, `organizations/${org}/categories`, 'cat-fuel', { name: 'Paliwo', type: 'expense', color: '#22c55e', orgId: org, createdAt: new Date() })
      await seedDoc(request, `organizations/${org}/tags`, 'tag-vat', tagDoc(org, 'ПДВ', 'rose', { excludeFromAnalytics: true }))
      await seedDoc(request, `organizations/${org}/tags`, 'tag-atm', tagDoc(org, 'Bankomat', 'amber', { excludeFromAnalytics: true, recalcPending: true }))
      await seedDoc(request, `organizations/${org}/tags`, 'tag-q4', tagDoc(org, 'Q4', 'sky'))
      await seedDoc(request, `organizations/${org}/tags`, 'tag-long', tagDoc(org, LONG, 'violet'))
      await seedDoc(request, `organizations/${org}/tags`, 'tag-old', tagDoc(org, 'Stare', 'slate', { archived: true }))

      const main = { accountId: 'acc-main', currency: 'PLN' } as const
      await seedLedgerOperation(request, org, 'op-1', { ...main, type: 'income', amount: 230, date: '2026-10-27', description: 'Zwrot VAT', tags: ['tag-vat'], excluded: true })
      await seedLedgerOperation(request, org, 'op-2', { ...main, type: 'expense', amount: 230, date: '2026-10-27', description: 'VAT', tags: ['tag-vat'], excluded: true })
      await seedLedgerOperation(request, org, 'op-3', { ...main, type: 'expense', amount: 1000, date: '2026-10-26', description: 'Bankomat', tags: ['tag-atm'], excluded: true })
      await seedLedgerOperation(request, org, 'op-4', { type: 'income', accountId: 'acc-cash', currency: 'PLN', amount: 1000, date: '2026-10-26', description: 'Wpłata do kasy', tags: ['tag-atm'], excluded: true })
      await seedLedgerOperation(request, org, 'op-5', { ...main, type: 'expense', amount: 212.4, date: '2026-10-25', description: 'ORLEN Stacja 1234', categoryId: 'cat-fuel', tags: ['tag-q4', 'tag-long', 'tag-old'] })

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
          await page.screenshot({ path: join(OUT_DIR, `tags-${state}-${viewport.form}-${locale}.png`), animations: 'disabled' })
        }
        const dialog = page.getByRole('dialog')
        // «Перерахунок не завершено» again for this viewport: the previous one finished it.
        await replaceDoc(request, `organizations/${org}/tags/tag-atm`, tagDoc(org, 'Bankomat', 'amber', { excludeFromAnalytics: true, recalcPending: true }))

        await page.goto(`/${org}/settings/tags`)
        await waitForShell(page, user.companyName)
        await expect(page.getByTestId('tag-row')).toHaveCount(5)
        await expect(page.getByTestId('tag-recalc-pending')).toBeVisible()
        await noHorizontalScroll('list')
        await shot('list')

        // The editor of a used tag, then the question a flag change asks.
        await page.getByRole('button', { name: m.edit.replace('{name}', 'Q4') }).click()
        await expect(dialog).toBeVisible()
        await dialogFits('editor')
        await shot('editor')
        await dialog.getByRole('switch', { name: m.editor.exclude }).check()
        await dialog.getByRole('button', { name: messages.common.save, exact: true }).click()
        await expect(page.getByTestId('tag-recalc-count')).toBeVisible()
        await dialogFits('confirm')
        await shot('confirm')
        await dialog.getByRole('button', { name: messages.common.cancel, exact: true }).click()
        await expect(page.locator('#tag-name')).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(dialog).toBeHidden()

        // «Продовжити»: the recalculation dialog runs to the end.
        await page.getByRole('button', { name: m.recalcContinue }).click()
        await expect(page.getByTestId('tag-recalc-state')).toContainText(m.recalc.done.split('{scanned}')[0].trim())
        await dialogFits('recalc')
        await shot('recalc-done')
        await page.getByTestId('tag-recalc-close').click()
        await expect(dialog).toBeHidden()

        // The journal: chips (a phone shows them under the account) and the tag filter.
        await page.goto(`/${org}/transactions`)
        await waitForShell(page, user.companyName)
        await expect(page.getByTestId(viewport.form === 'phone' ? 'tag-chip-phone' : 'tag-chip').first()).toBeVisible()
        await noHorizontalScroll('journal')
        await shot('journal-chips')
        await page.getByRole('button', { name: messages.journal.filters.more }).click()
        await expect(page.getByTestId('journal-tag-filter')).toBeVisible()
        await noHorizontalScroll('journal filter')
        await shot('journal-filter')

        // The operation form with two tags chosen.
        await page.getByRole('button', { name: messages.shell.header.expense }).click()
        const form = page.getByRole('dialog').filter({ has: page.locator('#tx-amount') })
        await form.locator('#tx-amount').fill('89,99')
        await form.locator('#tx-tags').fill('q4')
        await form.getByRole('option', { name: /Q4/ }).click()
        await form.locator('#tx-tags').fill('ban')
        await form.getByRole('option', { name: /Bankomat/ }).click()
        await form.locator('#tx-tags').blur()
        await form.locator('#tx-tags').scrollIntoViewIfNeeded()
        await dialogFits('form')
        await shot('form-tags')
        await page.keyboard.press('Escape')
        const discard = page.getByRole('dialog').filter({ hasText: messages.forms.transaction.discardTitle })
        await discard.getByRole('button', { name: messages.forms.transaction.discardConfirm, exact: true }).click()
        await expect(form).toBeHidden()
      }
    })
  }
})
