import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { registerViaUi, waitForShell } from '../e2e/helpers/app-ui'
import { seedDoc } from '../e2e/helpers/emulator-firestore'
import { seedLedgerAccount, seedLedgerOperation } from '../e2e/helpers/ledger-seed'
import en from '../../messages/en.json'
import pl from '../../messages/pl.json'
import uk from '../../messages/uk.json'

// S10: the auto-rules UI (settings/rules, the editor, «Застосувати до наявних», the «за правилом» chip of the journal)
// at 1440 and 390 px for the visual review. Files: rules-<state>-<desktop|phone>-<uk|pl|en>.png.
const OUT_DIR = join(process.cwd(), 'ui-shots')
const VIEWPORTS = [
  { form: 'desktop', width: 1440, height: 900 },
  { form: 'phone', width: 390, height: 844 },
] as const
const LOCALES = [
  ['uk', uk],
  ['pl', pl],
  ['en', en],
] as const

/** The rule document in the exact shape the server stores (lib/domain/rules/doc.ts). */
function ruleDoc(orgId: string, order: number, data: Record<string, unknown>) {
  return { schemaVersion: 1, orgId, order, createdAt: new Date(), createdBy: 'shots', updatedAt: new Date(), ...data }
}

test.describe('rules shots', () => {
  test.skip(
    !process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST,
    'Run with `npm run ui:shots` (it starts the Auth + Firestore emulators)',
  )

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true })
    for (const old of readdirSync(OUT_DIR)) {
      if (old.startsWith('rules-') && old.endsWith('.png')) rmSync(join(OUT_DIR, old), { force: true })
    }
  })

  for (const [locale, messages] of LOCALES) {
    test(`rules in ${locale}`, async ({ page, request, context }) => {
      test.setTimeout(300_000)
      const full = locale === 'uk' // the whole flow in Ukrainian; the list and the editor in the other languages
      await page.setViewportSize({ width: 1440, height: 900 })
      const user = await registerViaUi(page, `rshots${locale}`, 'PLN')
      await waitForShell(page, user.companyName)
      const org = user.orgId
      const m = messages.settings.rules

      await seedLedgerAccount(request, org, 'acc-main', { name: 'Konto główne', balance: 25000, currency: 'PLN' })
      await seedLedgerAccount(request, org, 'acc-cash', { name: 'Kasa', balance: 1500, currency: 'PLN', type: 'cash' })
      for (const [id, name, type] of [
        ['cat-fuel', 'Paliwo', 'expense'],
        ['cat-rent', 'Najem biura', 'expense'],
        ['cat-payroll', 'Wynagrodzenia i składki ubezpieczeniowe pracowników', 'expense'],
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

      // An active rule, an inactive one, and one whose category no longer exists («неробоче»).
      await seedDoc(request, `organizations/${org}/rules`, 'rule-fuel', ruleDoc(org, 0, {
        name: 'Paliwo Orlen',
        type: 'expense',
        active: true,
        conditions: [{ kind: 'text', op: 'contains', values: ['orlen', 'bp-stacja'] }],
        actions: { categoryId: 'cat-fuel' },
      }))
      await seedDoc(request, `organizations/${org}/rules`, 'rule-rent', ruleDoc(org, 1, {
        name: 'Czynsz za biuro',
        type: 'expense',
        active: false,
        conditions: [
          { kind: 'text', op: 'contains', values: ['czynsz'] },
          { kind: 'amount', currency: 'PLN', minMinor: 100000, maxMinor: 450000 },
        ],
        actions: { categoryId: 'cat-rent', counterpartyId: 'cp-acme' },
      }))
      await seedDoc(request, `organizations/${org}/rules`, 'rule-gone', ruleDoc(org, 2, {
        name: 'Wynagrodzenia i składki ubezpieczeniowe pracowników z umów o pracę',
        type: 'expense',
        active: true,
        conditions: [
          { kind: 'account', accountIds: ['acc-main', 'acc-cash'] },
          { kind: 'text', op: 'notContains', values: ['zwrot', 'korekta', 'nadpłata'] },
        ],
        actions: { categoryId: 'cat-deleted', counterpartyId: 'cp-acme' },
      }))

      // Two operations a rule filled already (the chip); the ones the apply dialog fills are seeded per viewport.
      const base = { type: 'expense', accountId: 'acc-main', currency: 'PLN' } as const
      await seedLedgerOperation(request, org, 'op-3', { ...base, amount: 89.99, date: '2026-10-25', description: 'BP-STACJA A1', categoryId: 'cat-fuel', counterpartyId: 'cp-acme', autoRules: [{ id: 'rule-fuel', name: 'Paliwo Orlen' }] })
      await seedLedgerOperation(request, org, 'op-4', {
        ...base,
        amount: 4310,
        date: '2026-10-24',
        description: 'Przelew wynagrodzeń',
        categoryId: 'cat-payroll',
        autoRules: [{ id: 'rule-long', name: 'Wynagrodzenia i składki ubezpieczeniowe pracowników z umów o pracę' }],
      })
      await seedLedgerOperation(request, org, 'op-5', { type: 'income', accountId: 'acc-main', currency: 'PLN', amount: 12300, date: '2026-10-23', description: 'Faktura 10/2026', categoryId: 'cat-sales' })

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
          await page.screenshot({ path: join(OUT_DIR, `rules-${state}-${viewport.form}-${locale}.png`), animations: 'disabled' })
        }
        const dialog = page.getByRole('dialog')
        await seedLedgerOperation(request, org, `fill-${viewport.form}-1`, { ...base, amount: 212.4, date: '2026-10-27', description: 'ORLEN Stacja 1234 Gdańsk' })
        await seedLedgerOperation(request, org, `fill-${viewport.form}-2`, { ...base, amount: 64.1, date: '2026-10-26', description: 'BP-STACJA A1 Tczew' })

        await page.goto(`/${org}/settings/rules`)
        await waitForShell(page, user.companyName)
        await expect(page.getByTestId('rule-row')).toHaveCount(3)
        await noHorizontalScroll('list')
        await shot('list')

        // The editor on a new rule: two conditions, text and amount.
        await page.getByRole('button', { name: m.add }).click()
        await expect(dialog).toBeVisible()
        await dialog.locator('#rule-name').fill('Paliwo i parking')
        await dialog.locator('#rule-cond-0-values').fill('orlen, shell, parking miejski')
        await dialog.getByRole('button', { name: m.editor.addCondition }).click()
        await dialog.locator('#rule-cond-1-kind').selectOption('amount')
        await dialog.locator('#rule-cond-1-min').fill('100')
        await dialog.locator('#rule-cond-1-max').fill('50')
        await dialogFits('editor')
        await shot('editor-two-conditions')

        // Reaches the footer on a phone: the dialog scrolls inside itself.
        await dialog.evaluate((el) => el.scrollTo(0, el.scrollHeight))
        const save = dialog.getByRole('button', { name: messages.common.save, exact: true })
        await expect(save).toBeInViewport()
        await shot('editor-footer')
        await dialog.evaluate((el) => el.scrollTo(0, 0))

        // Not complete yet: no action, so «Зберегти» is off.
        await shot('editor-incomplete')

        // A complete draft the server refuses (min above max): its message shows as a toast.
        await dialog.locator('#rule-category').selectOption({ label: 'Paliwo' })
        await dialog.getByRole('button', { name: messages.common.save, exact: true }).click()
        const refused = page.locator('[data-sonner-toast]').filter({ hasText: m.errors.invalid })
        await expect(refused).toBeVisible()
        await shot('editor-server-error')
        await expect(refused).toBeHidden({ timeout: 10_000 }) // the toast would cover the next shots

        // Fix it and run the check.
        await dialog.locator('#rule-cond-1-max').fill('500')
        await dialog.getByRole('button', { name: m.editor.check }).click()
        await expect(dialog.getByTestId('rule-check-result')).toBeVisible()
        await dialog.evaluate((el) => el.scrollTo(0, el.scrollHeight))
        await shot('editor-checked')

        if (!full) {
          await page.keyboard.press('Escape')
          await expect(dialog).toBeHidden()
          // The rule with the long name and the deleted category in its editor.
          await page.getByRole('button', { name: m.edit.replace('{name}', 'Wynagrodzenia i składki ubezpieczeniowe pracowników z umów o pracę') }).click()
          await expect(dialog).toBeVisible()
          await dialogFits('editor of the unusable rule')
          await shot('editor-edit-unusable')
          await dialog.evaluate((el) => el.scrollTo(0, el.scrollHeight))
          await shot('editor-edit-unusable-bottom')
          await page.keyboard.press('Escape')
          await expect(dialog).toBeHidden()
          continue
        }

        await page.keyboard.press('Escape')
        await expect(dialog).toBeHidden()

        await page.getByRole('button', { name: m.edit.replace('{name}', 'Wynagrodzenia i składki ubezpieczeniowe pracowników z umów o pracę') }).click()
        await expect(dialog).toBeVisible()
        await dialogFits('editor of the unusable rule')
        await shot('editor-edit-unusable')
        await dialog.evaluate((el) => el.scrollTo(0, el.scrollHeight))
        await shot('editor-edit-unusable-bottom')
        await page.keyboard.press('Escape')
        await expect(dialog).toBeHidden()

        // «Застосувати до наявних»: counted first, then applied. The second viewport finds the operations filled already.
        await page.getByRole('button', { name: m.applyOpen }).click()
        await expect(dialog).toBeVisible()
        const state = dialog.getByTestId('rules-apply-state')
        await expect(state).toContainText(/Буде змінено операцій: \d+/)
        await dialogFits('apply')
        await shot('apply-ready')
        await dialog.getByTestId('rules-apply-confirm').click()
        await expect(state).toContainText(/Змінено операцій: \d+/)
        await shot('apply-done')
        await dialog.getByTestId('rules-apply-close').click()
        await expect(dialog).toBeHidden()

        await page.goto(`/${org}/transactions`)
        await waitForShell(page, user.companyName)
        await expect(page.getByTestId(viewport.form === 'phone' ? 'rule-note' : 'rule-chip').first()).toBeVisible()
        await noHorizontalScroll('journal')
        await shot('journal-chip')
      }
    })
  }
})


test('rules: the empty list', async ({ page }) => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, 'Run with `npm run ui:shots`')
  mkdirSync(OUT_DIR, { recursive: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  const user = await registerViaUi(page, 'rshotsempty', 'PLN')
  await waitForShell(page, user.companyName)
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto(`/${user.orgId}/settings/rules`)
    await waitForShell(page, user.companyName)
    await expect(page.getByText(uk.settings.rules.empty)).toBeVisible()
    await page.screenshot({ path: join(OUT_DIR, `rules-empty-${viewport.form}-uk.png`), animations: 'disabled' })
  }
})
