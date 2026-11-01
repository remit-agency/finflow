// tests/e2e/transfers.spec.ts
// Own transfers (S10b): a suggested pair confirmed (Cash Flow counts neither side), a cash machine withdrawal turned into a
// transfer to the cash box and undone from the toast, two bank operations of different days merged from the selection bar
// and split back from the form.
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { registerViaUi, waitForShell, type RegisteredUser } from './helpers/app-ui'
import { dayFromToday } from './helpers/bank-seed'
import { readDoc } from './helpers/emulator-firestore'
import { seedLedgerAccount } from './helpers/ledger-seed'
import { seedBankOperation } from './helpers/transfer-seed'
import { todayDay } from '../../lib/utils/today'

const NEEDS_EMULATORS =
  'Needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"'

const rowsOf = (page: Page): Locator => page.locator('tbody').getByRole('row').filter({ has: page.getByRole('checkbox') })
const toast = (page: Page, text: string): Locator => page.locator('[data-sonner-toast]').filter({ hasText: text })
const accountRow = (page: Page, name: string): Locator =>
  page.getByRole('complementary', { name: 'Рахунки' }).getByRole('listitem').filter({ hasText: name })

/** The stored balance of an account in minor units (seeded numbers and the ledger's increments are doubles). */
async function balanceMinor(request: APIRequestContext, orgId: string, accountId: string): Promise<number> {
  const raw = (await readDoc(request, `organizations/${orgId}/accounts/${accountId}`))?.balanceMinor as unknown as
    | { doubleValue?: number; integerValue?: string }
    | undefined
  return Number(raw?.doubleValue ?? raw?.integerValue)
}

/** A PLN company with two bank accounts (1000 zł and 0) and a cash box, on the journal. */
async function setup(page: Page, request: APIRequestContext, prefix: string): Promise<RegisteredUser> {
  const user = await registerViaUi(page, prefix, 'PLN')
  await waitForShell(page, user.companyName)
  await seedLedgerAccount(request, user.orgId, 'acc-a', { name: 'Konto A', balance: 1000, currency: 'PLN' })
  await seedLedgerAccount(request, user.orgId, 'acc-b', { name: 'Konto B', balance: 0, currency: 'PLN' })
  await seedLedgerAccount(request, user.orgId, 'acc-cash', { name: 'Kasa', balance: 0, currency: 'PLN', type: 'cash' })
  await expect(accountRow(page, 'Kasa')).toBeVisible()
  return user
}

test.describe('own transfers (emulators)', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test('a suggested pair becomes one transfer: the balances stay and Cash Flow counts neither side', async ({ page, request }) => {
    const user = await setup(page, request, 'tr-pair')
    const day = todayDay()
    await seedBankOperation(page, request, user.orgId, { key: 'e2epairout1', type: 'expense', accountId: 'acc-a', amountMinor: 50_000, paymentDate: day, remittance: 'Przelew własny' })
    await seedBankOperation(page, request, user.orgId, { key: 'e2epairin01', type: 'income', accountId: 'acc-b', amountMinor: 50_000, paymentDate: day, remittance: 'Przelew własny' })
    await seedBankOperation(page, request, user.orgId, { key: 'e2esale0001', type: 'income', accountId: 'acc-a', amountMinor: 10_000, paymentDate: day, remittance: 'Faktura 1/11' })
    await page.goto(`/${user.orgId}/transactions`)
    await expect(rowsOf(page)).toHaveCount(3)

    const banner = page.getByTestId('transfer-suggestions')
    await expect(banner).toContainText('Знайдено можливих переказів між вашими рахунками: 1')
    await banner.getByRole('button', { name: 'Переглянути' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('checkbox', { name: /Konto A → Konto B/ })).toBeChecked()
    await dialog.getByRole('button', { name: 'Підтвердити вибрані' }).click()
    await expect(toast(page, 'Перекази створено: 1.')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(rowsOf(page)).toHaveCount(2)
    await expect(rowsOf(page).filter({ hasText: 'Konto A → Konto B' })).toHaveCount(1)
    await expect(banner).toHaveCount(0)
    expect(await balanceMinor(request, user.orgId, 'acc-a')).toBe(60_000)
    expect(await balanceMinor(request, user.orgId, 'acc-b')).toBe(50_000)

    await page.goto(`/${user.orgId}/analytics/cashflow`)
    await expect(page.getByTestId('cashflow-total-income')).toHaveText('100')
    await expect(page.getByTestId('cashflow-total-expense')).toHaveText('0')
  })

  test('a cash machine withdrawal becomes a transfer to the cash box, and «Скасувати» gives the expense back', async ({ page, request }) => {
    const user = await setup(page, request, 'tr-atm')
    await seedBankOperation(page, request, user.orgId, { key: 'e2eatm00001', type: 'expense', accountId: 'acc-a', amountMinor: 100_000, paymentDate: todayDay(), remittance: 'Bankomat Gdańsk' })
    await page.goto(`/${user.orgId}/transactions`)
    await expect(rowsOf(page)).toHaveCount(1)
    await expect(page.getByTestId('transfer-suggestions')).toHaveCount(0)

    await rowsOf(page).first().getByRole('checkbox').check()
    const bar = page.getByRole('region', { name: 'Вибрані операції' })
    await bar.getByRole('button', { name: 'Зробити переказом' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('#transfer-target').selectOption({ label: 'Kasa' })
    await dialog.getByRole('button', { name: 'Зробити переказом' }).click()
    await expect(dialog).toBeHidden()
    const done = toast(page, 'Перетворено на перекази: 1 з 1.')
    await expect(done).toBeVisible()
    await expect(rowsOf(page).filter({ hasText: 'Konto A → Kasa' })).toHaveCount(1)
    expect(await balanceMinor(request, user.orgId, 'acc-a')).toBe(0)
    await expect.poll(() => balanceMinor(request, user.orgId, 'acc-cash')).toBe(100_000)

    await done.getByRole('button', { name: 'Скасувати' }).click()
    await expect(rowsOf(page).filter({ hasText: 'Konto A → Kasa' })).toHaveCount(0)
    await expect(rowsOf(page)).toHaveCount(1)
    await expect(rowsOf(page).first()).toContainText('Bankomat Gdańsk')
    await expect.poll(() => balanceMinor(request, user.orgId, 'acc-cash')).toBe(0)
    expect(await balanceMinor(request, user.orgId, 'acc-a')).toBe(0)
  })

  test('two bank operations of different days are merged from the selection bar and split back from the form', async ({ page, request }) => {
    const user = await setup(page, request, 'tr-merge')
    await seedBankOperation(page, request, user.orgId, { key: 'e2emergeout', type: 'expense', accountId: 'acc-a', amountMinor: 30_000, paymentDate: dayFromToday(-1), remittance: 'Na Konto B' })
    await seedBankOperation(page, request, user.orgId, { key: 'e2emergein1', type: 'income', accountId: 'acc-b', amountMinor: 30_000, paymentDate: todayDay(), remittance: 'Z Konta A' })
    await page.goto(`/${user.orgId}/transactions`)
    await expect(rowsOf(page)).toHaveCount(2)

    for (const i of [0, 1]) await rowsOf(page).nth(i).getByRole('checkbox').check()
    const bar = page.getByRole('region', { name: 'Вибрані операції' })
    await expect(bar.getByRole('button', { name: 'Зробити переказом' })).toHaveCount(0)
    await bar.getByRole('button', { name: 'Об’єднати в переказ' }).click()
    await expect(toast(page, 'Операції об’єднано в переказ.')).toBeVisible()
    await expect(rowsOf(page)).toHaveCount(1)
    const transfer = rowsOf(page).filter({ hasText: 'Konto A → Konto B' })
    await expect(transfer.getByTestId('transfer-arrival')).toContainText('зарахування')
    await expect(transfer).toContainText('з банку')
    expect(await balanceMinor(request, user.orgId, 'acc-a')).toBe(70_000)
    expect(await balanceMinor(request, user.orgId, 'acc-b')).toBe(30_000)

    await transfer.getByRole('button', { name: /Konto A → Konto B/ }).click()
    const form = page.getByRole('dialog')
    await expect(form.getByTestId('bank-locked-hint')).toBeVisible()
    await expect(form.getByTestId('split-hint')).toBeVisible()
    await form.getByTestId('split-transfer').click()
    await expect(toast(page, 'Переказ розділено')).toBeVisible()
    await expect(form).toBeHidden()
    await expect(rowsOf(page)).toHaveCount(2)
    await expect(rowsOf(page).filter({ hasText: 'Konto A → Konto B' })).toHaveCount(0)
    expect(await balanceMinor(request, user.orgId, 'acc-a')).toBe(70_000)
    expect(await balanceMinor(request, user.orgId, 'acc-b')).toBe(30_000)
  })
})
