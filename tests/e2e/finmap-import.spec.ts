// tests/e2e/finmap-import.spec.ts
// The Finmap «Płatności» import (S14b) through the UI and the routes: the preview of a 30-row synthetic export (the transfers found,
// the categories to create, a typed balance for a new account), the run, the journal and the sidebar balance; the same file again
// (already imported, nothing created); undo from Settings → Imports (the operations go, the categories and accounts stay); a file
// with other headers (unknown_layout); a viewer (no button, 403 from the batch route). The file is built by tests/helpers/finmap-fixture
// (made-up names and amounts). Every test registers its own company.
import { test, expect, type Locator, type Page } from '@playwright/test'
import { planFinmap } from '../../lib/domain/import/finmap/plan'
import { parseFinmapTable } from '../../lib/domain/import/finmap/rows'
import type { FinmapExisting, FinmapPlan } from '../../lib/domain/import/finmap/types'
import { todayDay } from '../../lib/utils/today'
import { buildFinmapTable } from '../helpers/finmap-fixture'
import { makeXlsx } from '../helpers/make-xlsx'
import { registerViaUi, waitForShell, type RegisteredUser } from './helpers/app-ui'
import { dayFromToday } from './helpers/bank-seed'
import { signInEmulatorUser } from './helpers/emulator-auth'
import { seedMember } from './helpers/emulator-firestore'
import { seedLedgerAccount } from './helpers/ledger-seed'
import { seedPlanned } from './helpers/recurring-seed'

const NEEDS_EMULATORS =
  'Needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npx playwright test tests/e2e/finmap-import.spec.ts"'

const FILE_NAME = 'finmap-export.xlsx'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const ORIGIN = { Origin: 'http://localhost:3000' }
const ACCOUNT_ID = 'acc-viewer'
const ACCOUNT_NAME = 'Konto importu'
const TYPED_BALANCE = { whole: '1 000', fraction: '00', text: '1 000,00' }

/** The synthetic export and what planning it gives (the same options as the dialog). The first new account is the one the test types a balance for. */
const TABLE = buildFinmapTable({ rows: 30, accounts: 2, pairEvery: 8, seed: 5, endDay: '2026-10-31', days: 60 })
const FILE_BYTES = Buffer.from(makeXlsx(TABLE))
const EMPTY: FinmapExisting = { companyCurrency: 'PLN', accounts: [], categories: [], counterparties: [], tags: [] }
const EXPECTED: FinmapPlan = planFinmap(parseFinmapTable(TABLE).rows, EMPTY, { includePlanned: true, pairTransfers: true, today: todayDay() })
const [FIRST_ACCOUNT] = EXPECTED.create.accounts
const SUBCATEGORIES = EXPECTED.create.categories.filter((c) => c.child !== null).length
const TOP_CATEGORIES = EXPECTED.create.categories.length - SUBCATEGORIES

const rowsOf = (page: Page): Locator => page.locator('tbody').getByRole('row').filter({ has: page.getByRole('checkbox') })
const accountRow = (page: Page, name: string): Locator =>
  page.getByRole('complementary', { name: 'Рахунки' }).getByRole('listitem').filter({ hasText: name })
const finmapDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Імпорт з Finmap' })
const balanceText = (whole: string, fraction: string): RegExp => new RegExp(`${whole.replace(/\s/g, '\\s')},${fraction}`)
const journalUrl = (orgId: string): string => `/${orgId}/transactions`
const importRow = (page: Page): Locator => page.getByTestId('imports-row')
const LONG = { timeout: 30_000 }

/** A PLN company with nothing in it: the import creates the accounts, categories, counterparties and tags it needs. */
async function setupCompany(page: Page, prefix: string): Promise<RegisteredUser> {
  const user = await registerViaUi(page, prefix, 'PLN')
  await waitForShell(page, user.companyName)
  return user
}

/** Opens the Finmap dialog from the journal, after the source chooser. */
async function openFinmap(page: Page, orgId: string): Promise<Locator> {
  await page.goto(journalUrl(orgId))
  await page.getByTestId('import-open').click()
  await page.getByTestId('import-source-finmap').click()
  return finmapDialog(page)
}

/** Chooses the export in the dialog. */
async function chooseFile(dialog: Locator, bytes: Buffer, name = FILE_NAME): Promise<void> {
  await dialog.getByTestId('finmap-file').setInputFiles({ name, mimeType: XLSX, buffer: bytes })
}

/** The whole first import: the file, the typed balance of the first new account, the run, then the dialog closed. */
async function importExport(page: Page, orgId: string): Promise<void> {
  const dialog = await openFinmap(page, orgId)
  await chooseFile(dialog, FILE_BYTES)
  await dialog.locator('[data-testid="finmap-account-row"]').filter({ hasText: FIRST_ACCOUNT }).getByTestId('finmap-account-balance').fill(TYPED_BALANCE.text)
  await expect(dialog.getByTestId('finmap-run')).toBeEnabled()
  await dialog.getByTestId('finmap-run').click()
  await expect(dialog.getByTestId('finmap-result')).toContainText(`Створено операцій: ${EXPECTED.operations.length}`, LONG)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
}

test.describe('Finmap import (emulators)', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test('an owner imports the export: the preview counts, the new account with its typed balance, the journal and the sidebar balance', async ({ page }) => {
    expect(EXPECTED.counts.transfer).toBeGreaterThan(0)
    const user = await setupCompany(page, 'fin-first')
    const dialog = await openFinmap(page, user.orgId)
    await chooseFile(dialog, FILE_BYTES)

    const preview = dialog.getByTestId('finmap-preview')
    await expect(preview).toContainText(`Рядків у файлі: ${EXPECTED.counts.rows}`)
    await expect(preview).toContainText(`Перекази між рахунками: ${EXPECTED.counts.transfer}`)
    await expect(preview).toContainText(`Рахунків: ${EXPECTED.create.accounts.length}`)
    await expect(preview).toContainText(`Категорій: ${TOP_CATEGORIES}, підкатегорій: ${SUBCATEGORIES}`)

    await dialog.locator('[data-testid="finmap-account-row"]').filter({ hasText: FIRST_ACCOUNT }).getByTestId('finmap-account-balance').fill(TYPED_BALANCE.text)
    await expect(dialog.getByTestId('finmap-run')).toBeEnabled()
    await dialog.getByTestId('finmap-run').click()
    const result = dialog.getByTestId('finmap-result')
    await expect(result).toContainText(`Створено операцій: ${EXPECTED.operations.length}`, LONG)
    await expect(result).toContainText(`Переказів: ${EXPECTED.counts.transfer}`)
    await expect(dialog.getByTestId('finmap-run')).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    await page.goto(journalUrl(user.orgId))
    await expect(rowsOf(page)).toHaveCount(EXPECTED.operations.length, LONG)
    // The opening was empty and the balance was typed: the opening is fitted so the account ends on the typed balance.
    await expect(accountRow(page, FIRST_ACCOUNT)).toContainText(balanceText(TYPED_BALANCE.whole, TYPED_BALANCE.fraction))
  })

  test('the same file again creates nothing: all its operations are already in, and the run skips them', async ({ page }) => {
    const user = await setupCompany(page, 'fin-again')
    await importExport(page, user.orgId)

    const dialog = await openFinmap(page, user.orgId)
    await chooseFile(dialog, FILE_BYTES)
    await expect(dialog.getByTestId('finmap-preview')).toContainText(`Вже імпортовано раніше: ${EXPECTED.operations.length}`, LONG)
    await expect(dialog.locator('[data-testid="finmap-account-row"]')).toHaveCount(0)
    await dialog.getByTestId('finmap-run').click()
    const result = dialog.getByTestId('finmap-result')
    await expect(result).toContainText('Створено операцій: 0', LONG)
    await expect(result).toContainText(`Пропущено, бо вже були: ${EXPECTED.operations.length}`)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    await page.goto(journalUrl(user.orgId))
    await expect(rowsOf(page)).toHaveCount(EXPECTED.operations.length, LONG)
    await expect(accountRow(page, FIRST_ACCOUNT)).toContainText(balanceText(TYPED_BALANCE.whole, TYPED_BALANCE.fraction))
  })

  test('undo from Settings → Imports removes the operations; the categories and the accounts stay', async ({ page }) => {
    const user = await setupCompany(page, 'fin-undo')
    await importExport(page, user.orgId)

    await page.goto(`/${user.orgId}/settings/imports`)
    await expect(importRow(page)).toHaveCount(1)
    await expect(importRow(page)).toContainText(FILE_NAME)
    await expect(importRow(page).getByTestId('import-kind')).toHaveText('Finmap')
    await importRow(page).getByTestId('import-undo').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Скасувати імпорт', exact: true }).click()
    await expect(importRow(page)).toContainText(`видалено ${EXPECTED.operations.length}, залишено 0`, LONG)
    await expect(importRow(page).getByTestId('import-undo')).toHaveCount(0)

    await page.goto(journalUrl(user.orgId))
    await expect(rowsOf(page)).toHaveCount(0)
    await expect(accountRow(page, FIRST_ACCOUNT)).toBeVisible()

    const parent = EXPECTED.create.categories.find((c) => c.child === null)?.parent
    expect(parent).toBeDefined()
    await page.goto(`/${user.orgId}/settings/categories`)
    await expect(page.getByText(parent ?? '', { exact: true }).first()).toBeVisible()
  })

  test('a file with other headers shows the unknown-layout message and writes nothing', async ({ page }) => {
    const user = await setupCompany(page, 'fin-layout')
    const dialog = await openFinmap(page, user.orgId)
    const other = Buffer.from(makeXlsx([['Imię', 'Nazwisko'], ['Ala', 'Kot']]))
    await chooseFile(dialog, other, 'other.xlsx')

    const error = dialog.getByTestId('finmap-error')
    await expect(error).toContainText('Немає колонок:')
    await expect(error).toContainText('Data płatności')
    await expect(dialog.getByTestId('finmap-run')).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    await page.goto(journalUrl(user.orgId))
    await expect(rowsOf(page)).toHaveCount(0)
  })

  test('a viewer sees no import button, and the Finmap batch route answers 403', async ({ page, browser, request }) => {
    const owner = await setupCompany(page, 'fin-owner')
    await seedLedgerAccount(request, owner.orgId, ACCOUNT_ID, { name: ACCOUNT_NAME, balance: 0, currency: 'PLN' })
    // A cash gap in the journal: the viewer's journal has rendered its data when the banner shows (it is for every role).
    await seedPlanned(page, owner.orgId, { type: 'expense', accountId: ACCOUNT_ID, amountMinor: 150_000, paymentDate: dayFromToday(5), description: 'VAT-7' })

    const context = await browser.newContext()
    try {
      const v = await context.newPage()
      const viewer = await registerViaUi(v, 'fin-viewer', 'PLN')
      const { uid: viewerUid } = await signInEmulatorUser(request, viewer.email, viewer.password)
      const { uid: ownerUid } = await signInEmulatorUser(request, owner.email, owner.password)
      await seedMember(request, owner.orgId, viewerUid, 'viewer', ownerUid)

      await v.goto(journalUrl(owner.orgId))
      await waitForShell(v, owner.companyName)
      await expect(v.getByTestId('cash-gap')).toBeVisible()
      await expect(v.getByTestId('import-open')).toHaveCount(0)

      const batch = await v.request.post(`/api/orgs/${owner.orgId}/imports/finmap/batch`, {
        headers: ORIGIN,
        data: { importId: 'none', operations: [] },
      })
      expect(batch.status()).toBe(403)
    } finally {
      await context.close()
    }
  })
})
