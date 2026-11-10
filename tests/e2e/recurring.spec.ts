// tests/e2e/recurring.spec.ts
// Planned payments (S11): a ZUS series from the preset puts its plans in the journal; a suggested match links the bank
// operation to its plan without a duplicate and the undo brings the plan back; an overdue plan has «Прострочено» in the
// journal and in the strip; «Пропустити» and its undo; a new amount of the series updates its future plans.
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { registerViaUi, waitForShell, type RegisteredUser } from './helpers/app-ui'
import { dayFromToday } from './helpers/bank-seed'
import { readDoc } from './helpers/emulator-firestore'
import { seedLedgerAccount } from './helpers/ledger-seed'
import { isoWeekdayOf, seedPlanned, seedSeries } from './helpers/recurring-seed'
import { seedBankOperation } from './helpers/transfer-seed'
import { todayDay } from '../../lib/utils/today'

const NEEDS_EMULATORS =
  'Needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"'

const rowsOf = (page: Page): Locator => page.locator('tbody').getByRole('row').filter({ has: page.getByRole('checkbox') })
const toast = (page: Page, text: string): Locator => page.locator('[data-sonner-toast]').filter({ hasText: text })
const accountRow = (page: Page, name: string): Locator =>
  page.getByRole('complementary', { name: 'Рахунки' }).getByRole('listitem').filter({ hasText: name })

async function balanceMinor(request: APIRequestContext, orgId: string, accountId: string): Promise<number> {
  const raw = (await readDoc(request, `organizations/${orgId}/accounts/${accountId}`))?.balanceMinor as unknown as
    | { doubleValue?: number; integerValue?: string }
    | undefined
  return Number(raw?.doubleValue ?? raw?.integerValue)
}

/** A PLN company with one bank account of 1000 zł. */
async function setup(page: Page, request: APIRequestContext, prefix: string): Promise<RegisteredUser> {
  const user = await registerViaUi(page, prefix, 'PLN')
  await waitForShell(page, user.companyName)
  await seedLedgerAccount(request, user.orgId, 'acc-a', { name: 'Konto A', balance: 1000, currency: 'PLN' })
  await expect(accountRow(page, 'Konto A')).toBeVisible()
  return user
}

/** A monthly rent on today's day of the month: plans for today and the next three months. */
function rentToday(amountMinor: number): Record<string, unknown> {
  const day = todayDay()
  return { name: 'Czynsz', kind: 'expense', accountId: 'acc-a', amountMinor, frequency: 'monthly', dayOfMonth: Number(day.slice(8, 10)), startDate: day }
}

test.describe('planned payments (emulators)', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test('a ZUS series from the preset puts its planned operations in the journal', async ({ page, request }) => {
    const user = await setup(page, request, 'rc-preset')
    await page.goto(`/${user.orgId}/recurring`)
    await expect(page.getByRole('heading', { level: 1, name: 'Планові платежі' })).toBeVisible()
    await expect(page.getByTestId('series-empty')).toBeVisible()

    await page.getByTestId('preset-menu').click()
    await page.getByTestId('preset-zus').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('#series-name')).toHaveValue('ZUS')
    await expect(dialog.locator('#series-day')).toHaveValue('15')
    await expect(dialog.locator('#series-estimated')).toBeChecked()
    await dialog.locator('#series-account').selectOption({ label: 'Konto A' })
    await dialog.locator('#series-amount').fill('1500')
    await dialog.getByTestId('series-save').click()
    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('series-row').filter({ hasText: 'ZUS' })).toHaveCount(1)
    await expect(page.getByTestId('plan-estimated').first()).toBeVisible()

    await page.goto(`/${user.orgId}/transactions`)
    const plans = rowsOf(page).filter({ hasText: 'План' })
    await expect(plans.first()).toBeVisible()
    expect(await plans.count()).toBeGreaterThanOrEqual(3)
    expect(await balanceMinor(request, user.orgId, 'acc-a')).toBe(100_000)
  })

  test('a suggested match links the bank operation to its plan without a duplicate; «Скасувати» brings the plan back', async ({ page, request }) => {
    const user = await setup(page, request, 'rc-match')
    await seedSeries(page, user.orgId, rentToday(50_000))
    await seedBankOperation(page, request, user.orgId, { key: 'e2erent0001', type: 'expense', accountId: 'acc-a', amountMinor: 50_000, paymentDate: todayDay(), remittance: 'Czynsz listopad' })
    await page.goto(`/${user.orgId}/transactions`)
    await expect(rowsOf(page)).toHaveCount(5)

    const banner = page.getByTestId('plan-matches')
    await expect(banner).toContainText('Знайдено збігів із плановими платежами: 1')
    await banner.getByRole('button', { name: 'Переглянути' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('plan-match')).toHaveCount(1)
    await dialog.getByRole('button', { name: 'Підтвердити вибрані' }).click()
    await expect(dialog).toBeHidden()
    const done = toast(page, 'Пов’язано з плановими: 1.')
    await expect(done).toBeVisible()
    await expect(rowsOf(page)).toHaveCount(4)
    await expect(rowsOf(page).filter({ hasText: 'Czynsz listopad' })).toHaveCount(1)
    await expect(banner).toHaveCount(0)
    expect(await balanceMinor(request, user.orgId, 'acc-a')).toBe(50_000)

    await done.getByRole('button', { name: 'Скасувати' }).click()
    await expect(rowsOf(page)).toHaveCount(5)
    expect(await balanceMinor(request, user.orgId, 'acc-a')).toBe(50_000)
  })

  test('an overdue plan has «Прострочено» in the journal and in the strip', async ({ page, request }) => {
    const user = await setup(page, request, 'rc-overdue')
    await seedPlanned(page, user.orgId, { type: 'expense', accountId: 'acc-a', amountMinor: 12_000, paymentDate: dayFromToday(-3), description: 'Faktura prąd' })
    await page.goto(`/${user.orgId}/transactions`)
    await expect(rowsOf(page).filter({ hasText: 'Faktura prąd' }).getByTestId('overdue-chip')).toHaveText('Прострочено')

    await page.goto(`/${user.orgId}/recurring`)
    await expect(page.getByTestId('recurring-overdue')).toHaveText('Прострочено: 1')
    await expect(page.getByTestId('planned-row').filter({ hasText: 'Faktura prąd' }).getByTestId('plan-overdue')).toBeVisible()
  })

  test('«Пропустити» takes one plan off and «Скасувати» brings it back', async ({ page, request }) => {
    const user = await setup(page, request, 'rc-skip')
    const day = todayDay()
    await seedSeries(page, user.orgId, { name: 'Siłownia', kind: 'expense', accountId: 'acc-a', amountMinor: 15_000, frequency: 'weekly', weekday: isoWeekdayOf(day), startDate: day })
    await page.goto(`/${user.orgId}/recurring`)
    const rows = page.getByTestId('planned-row').filter({ hasText: 'Siłownia' })
    await expect(rows.first()).toBeVisible()
    const before = await rows.count()
    await rows.first().getByRole('button', { name: 'Пропустити' }).click()
    const skipped = toast(page, 'Пропущено цей раз')
    await expect(skipped).toBeVisible()
    await expect(rows).toHaveCount(before - 1)
    await skipped.getByRole('button', { name: 'Скасувати' }).click()
    await expect(rows).toHaveCount(before)
  })

  test('a new amount of the series updates its future plans', async ({ page, request }) => {
    const user = await setup(page, request, 'rc-amount')
    await seedSeries(page, user.orgId, rentToday(50_000))
    await page.goto(`/${user.orgId}/recurring`)
    await page.getByTestId('series-row').filter({ hasText: 'Czynsz' }).getByRole('button', { name: 'Змінити' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('#series-amount').fill('600')
    await dialog.getByTestId('series-save').click()
    await expect(dialog).toBeHidden()
    await expect(toast(page, 'Серію змінено')).toBeVisible()

    await page.goto(`/${user.orgId}/transactions`)
    await expect(rowsOf(page)).toHaveCount(4)
    await expect(rowsOf(page).filter({ hasText: '600' })).toHaveCount(4)
  })
})
