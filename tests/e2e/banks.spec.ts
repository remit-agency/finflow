// tests/e2e/banks.spec.ts
// The bank connection (S09) against the local fake bank (tests/e2e/helpers/eb-stub.mjs, EB_API_BASE).
// The server writes bankConnections / bankAccounts, so the specs seed them as admin in the exact shape
// lib/server/banking/link.ts stores them.
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { registerViaUi, waitForShell, type RegisteredUser } from './helpers/app-ui'
import { SESSION, connectionFields, dayFromToday, seedConnection, seedLinkedBankAccount } from './helpers/bank-seed'
import { listDocs, replaceDoc, seedDoc } from './helpers/emulator-firestore'
import { seedLedgerAccount } from './helpers/ledger-seed'

const NEEDS_EMULATORS =
  'Needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npx playwright test"'

const rowsOf = (page: Page): Locator => page.locator('tbody').getByRole('row').filter({ has: page.getByRole('checkbox') })
const accountRow = (page: Page, name: string): Locator =>
  page.getByRole('complementary', { name: 'Рахунки' }).getByRole('listitem').filter({ hasText: name })
const formDialog = (page: Page): Locator => page.getByRole('dialog').filter({ has: page.locator('#tx-amount') })
const toast = (page: Page, text: string): Locator => page.locator('[data-sonner-toast]').filter({ hasText: text })
const balanceText = (whole: string, fraction: string): RegExp => new RegExp(`${whole.replace(/\s/g, '\\s')},${fraction}`)

/** The FinFlow account the bank account is linked to, plus the expense category the locked-row test uses. */
async function seedBankTarget(request: APIRequestContext, orgId: string): Promise<void> {
  await seedLedgerAccount(request, orgId, 'acc-bank', { name: 'Fake Bank PLN', balance: 0, currency: 'PLN' })
  await seedDoc(request, `organizations/${orgId}/categories`, 'cat-exp-fuel', { name: 'Paliwo', type: 'expense', color: '#ef4444', orgId, createdAt: new Date() })
}

async function setupShell(page: Page, prefix: string): Promise<RegisteredUser> {
  const user = await registerViaUi(page, prefix, 'PLN')
  await waitForShell(page, user.companyName)
  return user
}

test.describe('banks (emulators + fake bank)', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test('the expiry banner counts down, shows the expired text, and is absent far from the end', async ({ page, request }) => {
    const user = await setupShell(page, 'bk-banner')
    const cases: Array<{ days: number; text: RegExp }> = [
      { days: 3, text: /Через 3 дні треба оновити банківське підключення/ },
      { days: 2, text: /Через 2 дні треба оновити банківське підключення/ },
      { days: 1, text: /Завтра треба оновити банківське підключення/ },
      { days: 0, text: /Сьогодні закінчується доступ до банку/ },
      { days: -2, text: /Доступ до банку закінчився, нові операції не підтягуються/ },
    ]
    for (const c of cases) {
      await replaceDoc(request, `organizations/${user.orgId}/bankConnections/${SESSION}`, connectionFields(user.orgId, dayFromToday(c.days)))
      await page.reload()
      await expect(page.getByTestId('bank-notice')).toContainText(c.text)
    }

    // The owner's button leads to the settings page.
    await replaceDoc(request, `organizations/${user.orgId}/bankConnections/${SESSION}`, connectionFields(user.orgId, dayFromToday(1)))
    await page.reload()
    await expect(page.getByTestId('bank-notice')).toContainText(/Завтра/)
    await page.getByTestId('bank-notice-reconnect').click()
    await page.waitForURL(new RegExp(`/${user.orgId}/settings/banks$`))

    // Ten days before the end: no banner. The card is the barrier that the status has loaded.
    await replaceDoc(request, `organizations/${user.orgId}/bankConnections/${SESSION}`, connectionFields(user.orgId, dayFromToday(10)))
    await page.goto(`/${user.orgId}/settings/banks`)
    await expect(page.getByTestId('bank-status')).toHaveText('Активне')
    await expect(page.getByTestId('bank-notice')).toHaveCount(0)
  })

  test('linking creates the account, the first sync imports three operations, and a second sync adds none', async ({ page, request }) => {
    const user = await setupShell(page, 'bk-link')
    await seedConnection(request, user.orgId, dayFromToday(60))
    await page.goto(`/${user.orgId}/settings/banks`)
    await expect(page.getByTestId('bank-status')).toHaveText('Активне')

    await page.getByTestId('bank-link-open').click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: 'Створити рахунок у FinFlow' }).click()
    await page.getByTestId('bank-link-submit').click()
    await expect(toast(page, 'Додано 3 операції')).toBeVisible()
    await expect(dialog).toBeHidden()

    await page.goto(`/${user.orgId}/transactions`)
    await expect(rowsOf(page)).toHaveCount(3)
    await expect(rowsOf(page).filter({ hasText: 'з банку' })).toHaveCount(3)
    await expect(accountRow(page, 'Fake Bank PLN')).toContainText(balanceText('1 500', '00'))
    expect(await listDocs(request, `organizations/${user.orgId}/bankSeen`)).toHaveLength(3)

    await page.goto(`/${user.orgId}/settings/banks`)
    await expect(page.getByTestId('bank-sync')).toBeEnabled()
    await page.getByTestId('bank-sync').click()
    await expect(toast(page, 'Нових операцій немає')).toBeVisible()
    expect(await listDocs(request, `organizations/${user.orgId}/transactions`)).toHaveLength(3)
    expect(await listDocs(request, `organizations/${user.orgId}/bankSeen`)).toHaveLength(3)
  })

  test('a bank operation is locked, and deleting it keeps it deleted after the next sync', async ({ page, request }) => {
    const user = await setupShell(page, 'bk-locked')
    await seedBankTarget(request, user.orgId)
    await seedConnection(request, user.orgId, dayFromToday(60))
    await seedLinkedBankAccount(request, user.orgId, 'acc-bank')

    // The journal open runs the auto-sync of the linked account.
    await page.goto(`/${user.orgId}/transactions`)
    await expect(rowsOf(page)).toHaveCount(3)

    const fuel = rowsOf(page).filter({ hasText: 'Paliwo' })
    await fuel.click()
    const dialog = formDialog(page)
    await expect(dialog.locator('#tx-amount')).toBeDisabled()
    await expect(dialog.getByTestId('bank-locked-hint')).toBeVisible()
    await dialog.locator('#tx-category').selectOption({ label: 'Paliwo' })
    await dialog.getByRole('button', { name: 'Зберегти', exact: true }).click()
    await expect(toast(page, 'Зміни збережено')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(fuel).toContainText('200,00')
    await expect(fuel.getByText('з банку')).toBeVisible()

    await fuel.getByRole('checkbox').check()
    const bar = page.getByRole('region', { name: 'Вибрані операції' })
    await bar.getByRole('button', { name: 'Видалити' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Видалити', exact: true }).click()
    await expect(toast(page, 'Видалено')).toBeVisible()
    await expect(rowsOf(page)).toHaveCount(2)

    await page.goto(`/${user.orgId}/settings/banks`)
    await expect(page.getByTestId('bank-sync')).toBeEnabled()
    await page.getByTestId('bank-sync').click()
    await expect(toast(page, 'Нових операцій немає')).toBeVisible()
    await page.goto(`/${user.orgId}/transactions`)
    await expect(rowsOf(page)).toHaveCount(2)
    expect(await listDocs(request, `organizations/${user.orgId}/transactions`)).toHaveLength(2)
  })

  test('an expired connection shows the expired state and the sync says so', async ({ page, request }) => {
    const user = await setupShell(page, 'bk-expired')
    await seedBankTarget(request, user.orgId)
    await seedConnection(request, user.orgId, dayFromToday(30), 'expired')
    await seedLinkedBankAccount(request, user.orgId, 'acc-bank')

    await page.goto(`/${user.orgId}/settings/banks`)
    await expect(page.getByTestId('bank-status')).toHaveText('Доступ закінчився')
    await expect(page.getByTestId('bank-notice')).toContainText('Доступ до банку закінчився, нові операції не підтягуються')
    await expect(page.getByTestId('bank-link-open')).toBeDisabled()
    await page.getByTestId('bank-sync').click()
    await expect(toast(page, 'Доступ до банку закінчився. Оновіть підключення')).toBeVisible()
  })

  test('opening the journal syncs a linked account by itself', async ({ page, request }) => {
    const user = await setupShell(page, 'bk-auto')
    await seedBankTarget(request, user.orgId)
    await seedConnection(request, user.orgId, dayFromToday(60))
    await seedLinkedBankAccount(request, user.orgId, 'acc-bank')

    await page.goto(`/${user.orgId}/transactions`)
    await expect(rowsOf(page)).toHaveCount(3)
    await expect(toast(page, 'З банку додано 3 операції')).toBeVisible()
    await expect(accountRow(page, 'Fake Bank PLN')).toContainText(balanceText('1 500', '00'))
  })
})
