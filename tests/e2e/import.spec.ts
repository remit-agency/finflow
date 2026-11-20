// tests/e2e/import.spec.ts
// The MT940 import and its undo (S14) through the UI and the routes: the import of a statement file with the fitted opening
// balance, the duplicate check, undo from Settings → Imports and the re-import, an operation changed after the import (kept by
// the undo), a viewer (no button, 403 from the routes) and a file that is not a statement. Every test registers its own company.
// The statement is tests/fixtures/mt940/tilde.sta (synthetic): two operations, opening 2 000,00 and closing 2 984,00 zł.
import { resolve } from 'node:path'
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { registerViaUi, waitForShell, type RegisteredUser } from './helpers/app-ui'
import { dayFromToday } from './helpers/bank-seed'
import { signInEmulatorUser } from './helpers/emulator-auth'
import { seedDoc, seedMember } from './helpers/emulator-firestore'
import { seedLedgerAccount } from './helpers/ledger-seed'
import { seedPlanned } from './helpers/recurring-seed'

const NEEDS_EMULATORS =
  'Needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npx playwright test tests/e2e/import.spec.ts"'

const FIXTURE = resolve(process.cwd(), 'tests/fixtures/mt940/tilde.sta')
const ORIGIN = { Origin: 'http://localhost:3000' }
/** The FinFlow account the statement is imported into: empty, so its opening balance is fitted. */
const ACCOUNT_ID = 'acc-import'
const ACCOUNT_NAME = 'Konto importu'
const CATEGORY_NAME = 'Usługi testowe'

const rowsOf = (page: Page): Locator => page.locator('tbody').getByRole('row').filter({ has: page.getByRole('checkbox') })
const accountRow = (page: Page, name: string): Locator =>
  page.getByRole('complementary', { name: 'Рахунки' }).getByRole('listitem').filter({ hasText: name })
const importDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Імпорт виписки' })
const formDialog = (page: Page): Locator => page.getByRole('dialog').filter({ has: page.locator('#tx-amount') })
const toast = (page: Page, text: string): Locator => page.locator('[data-sonner-toast]').filter({ hasText: text })
const balanceText = (whole: string, fraction: string): RegExp => new RegExp(`${whole.replace(/\s/g, '\\s')},${fraction}`)
const journalUrl = (orgId: string): string => `/${orgId}/transactions`
const importRow = (page: Page): Locator => page.getByTestId('imports-row')

/** A PLN company with an empty bank account to import into and one expense category for the edit test. */
async function setupShell(page: Page, request: APIRequestContext, prefix: string): Promise<RegisteredUser> {
  const user = await registerViaUi(page, prefix, 'PLN')
  await waitForShell(page, user.companyName)
  await seedLedgerAccount(request, user.orgId, ACCOUNT_ID, { name: ACCOUNT_NAME, balance: 0, currency: 'PLN' })
  await seedDoc(request, `organizations/${user.orgId}/categories`, 'cat-exp-test', {
    name: CATEGORY_NAME,
    type: 'expense',
    color: '#ef4444',
    orgId: user.orgId,
    createdAt: new Date(),
  })
  return user
}

/** Opens the dialog, chooses the file, the account, runs the import and closes the dialog. */
async function importFixture(page: Page, orgId: string): Promise<void> {
  await page.goto(journalUrl(orgId))
  await page.getByTestId('import-open').click()
  const dialog = importDialog(page)
  await dialog.getByTestId('import-file').setInputFiles(FIXTURE)
  await dialog.getByTestId('import-account').selectOption(ACCOUNT_ID)
  await expect(dialog.getByTestId('import-run')).toBeEnabled()
  await dialog.getByTestId('import-run').click()
  await expect(dialog.getByTestId('import-result')).toContainText('Створено: 2')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
}

test.describe('MT940 import and undo (emulators)', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test('an owner imports the statement: two operations, the fitted opening, the closing balance in the sidebar', async ({ page, request }) => {
    const user = await setupShell(page, request, 'imp-first')
    await page.goto(journalUrl(user.orgId))
    await page.getByTestId('import-open').click()

    const dialog = importDialog(page)
    await dialog.getByTestId('import-file').setInputFiles(FIXTURE)
    const preview = dialog.getByTestId('import-preview')
    await expect(preview).toHaveCount(1)
    await expect(preview).toContainText(balanceText('2 984', '00'))

    await dialog.getByTestId('import-account').selectOption(ACCOUNT_ID)
    await expect(preview).toContainText('Нових: 2 · вже є: 0 · з банку: 0 · відхилено: 0')
    await dialog.getByTestId('import-run').click()
    await expect(dialog.getByTestId('import-result')).toContainText('Створено: 2')
    await expect(dialog.getByTestId('import-run')).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    await page.goto(journalUrl(user.orgId))
    await expect(rowsOf(page)).toHaveCount(2)
    const acme = rowsOf(page).filter({ hasText: 'ACME SP Z O O WARSZAWA' })
    const klient = rowsOf(page).filter({ hasText: 'KLIENT JAN KOWALSKI' })
    await expect(acme).toHaveCount(1)
    await expect(acme).toContainText(/246,00/)
    await expect(klient).toHaveCount(1)
    await expect(klient).toContainText(balanceText('1 230', '00'))
    // The opening was empty, so it was fitted: 2 000,00 + (1 230,00 − 246,00) = 2 984,00.
    await expect(accountRow(page, ACCOUNT_NAME)).toContainText(balanceText('2 984', '00'))
  })

  test('the same file again creates nothing: its operations are already in and the run is off', async ({ page, request }) => {
    const user = await setupShell(page, request, 'imp-again')
    await importFixture(page, user.orgId)

    await page.goto(journalUrl(user.orgId))
    await page.getByTestId('import-open').click()
    const dialog = importDialog(page)
    await dialog.getByTestId('import-file').setInputFiles(FIXTURE)
    await dialog.getByTestId('import-account').selectOption(ACCOUNT_ID)
    await expect(dialog.getByTestId('import-preview')).toContainText('Нових: 0 · вже є: 2 · з банку: 0 · відхилено: 0')
    await expect(dialog.getByTestId('import-run')).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    await page.goto(journalUrl(user.orgId))
    await expect(rowsOf(page)).toHaveCount(2)
    await expect(accountRow(page, ACCOUNT_NAME)).toContainText(balanceText('2 984', '00'))
  })

  test('undo from Settings → Imports removes the operations; a re-import brings them back', async ({ page, request }) => {
    const user = await setupShell(page, request, 'imp-undo')
    await importFixture(page, user.orgId)

    await page.goto(`/${user.orgId}/settings/imports`)
    await expect(importRow(page)).toHaveCount(1)
    await expect(importRow(page)).toContainText('tilde.sta')
    await importRow(page).getByTestId('import-undo').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Скасувати імпорт', exact: true }).click()
    await expect(importRow(page)).toContainText(/видалено 2, залишено 0/)
    await expect(importRow(page).getByTestId('import-undo')).toHaveCount(0)

    await page.goto(journalUrl(user.orgId))
    await expect(rowsOf(page)).toHaveCount(0)
    // The fitted opening stays: the account holds its opening balance, no operations.
    await expect(accountRow(page, ACCOUNT_NAME)).toContainText(balanceText('2 000', '00'))

    await importFixture(page, user.orgId)
    await page.goto(journalUrl(user.orgId))
    await expect(rowsOf(page)).toHaveCount(2)
    await expect(accountRow(page, ACCOUNT_NAME)).toContainText(balanceText('2 984', '00'))
  })

  test('an operation changed after the import stays after the undo, and the row says so', async ({ page, request }) => {
    const user = await setupShell(page, request, 'imp-kept')
    await importFixture(page, user.orgId)

    await page.goto(journalUrl(user.orgId))
    const acme = rowsOf(page).filter({ hasText: 'ACME SP Z O O WARSZAWA' })
    await acme.click()
    const dialog = formDialog(page)
    await dialog.locator('#tx-category').selectOption({ label: CATEGORY_NAME })
    await dialog.getByRole('button', { name: 'Зберегти', exact: true }).click()
    await expect(toast(page, 'Зміни збережено')).toBeVisible()
    await expect(dialog).toBeHidden()

    await page.goto(`/${user.orgId}/settings/imports`)
    await importRow(page).getByTestId('import-undo').click()
    await page.getByRole('dialog').getByRole('button', { name: 'Скасувати імпорт', exact: true }).click()
    await expect(importRow(page)).toContainText(/видалено 1, залишено 1/)
    await expect(importRow(page)).toContainText('Залишено, бо змінено після імпорту: 1')

    await page.goto(journalUrl(user.orgId))
    await expect(rowsOf(page)).toHaveCount(1)
    await expect(rowsOf(page).filter({ hasText: 'ACME SP Z O O WARSZAWA' })).toHaveCount(1)
  })

  test('a viewer sees no import button, and the import routes answer 403', async ({ page, browser, request }) => {
    const owner = await setupShell(page, request, 'imp-owner')
    // A cash gap in the journal: the viewer's journal has rendered its data when the banner shows (it is for every role).
    await seedPlanned(page, owner.orgId, { type: 'expense', accountId: ACCOUNT_ID, amountMinor: 150_000, paymentDate: dayFromToday(5), description: 'VAT-7' })

    const context = await browser.newContext()
    try {
      const v = await context.newPage()
      const viewer = await registerViaUi(v, 'imp-viewer', 'PLN')
      const { uid: viewerUid } = await signInEmulatorUser(request, viewer.email, viewer.password)
      const { uid: ownerUid } = await signInEmulatorUser(request, owner.email, owner.password)
      await seedMember(request, owner.orgId, viewerUid, 'viewer', ownerUid)

      await v.goto(journalUrl(owner.orgId))
      await waitForShell(v, owner.companyName)
      await expect(v.getByTestId('cash-gap')).toBeVisible()
      await expect(v.getByTestId('import-open')).toHaveCount(0)

      const step = await v.request.post(`/api/orgs/${owner.orgId}/imports`, { headers: ORIGIN, data: {} })
      expect(step.status()).toBe(403)
      const preview = await v.request.post(`/api/orgs/${owner.orgId}/imports/preview`, {
        headers: ORIGIN,
        data: { fileName: 'tilde.sta', text: ':20:X\n' },
      })
      expect(preview.status()).toBe(403)
    } finally {
      await context.close()
    }
  })

  test('a file that is not an MT940 statement shows the message and writes nothing', async ({ page, request }) => {
    const user = await setupShell(page, request, 'imp-notmt')
    const stepWrites: string[] = []
    page.on('request', (req) => {
      if (req.method() !== 'GET' && new URL(req.url()).pathname === `/api/orgs/${user.orgId}/imports`) stepWrites.push(req.method())
    })

    await page.goto(journalUrl(user.orgId))
    await page.getByTestId('import-open').click()
    const dialog = importDialog(page)
    await dialog.getByTestId('import-file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    await expect(dialog.getByRole('alert')).toContainText('Це не виписка MT940')
    await expect(dialog.getByTestId('import-run')).toBeDisabled()
    expect(stepWrites).toEqual([])
  })
})
