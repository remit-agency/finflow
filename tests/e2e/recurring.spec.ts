// tests/e2e/recurring.spec.ts
// Planned payments (S11): a ZUS series from the preset puts its plans in the journal; a suggested match links the bank
// operation to its plan without a duplicate and the undo brings the plan back; an overdue plan has «Прострочено» in the
// journal and in the strip; «Пропустити» and its undo; a new amount of the series updates its future plans; pause (with and
// without the future plans) and resume; delete (keeping or removing the future plans); «Перенести»; «Позначити сплаченою»
// from the page; a preset in a company without its S06 records, and in one with its own «ZUS» record (I1).
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { registerViaUi, waitForShell, type RegisteredUser } from './helpers/app-ui'
import { dayFromToday } from './helpers/bank-seed'
import { deleteDoc, readDoc, seedDoc } from './helpers/emulator-firestore'
import { seedLedgerAccount } from './helpers/ledger-seed'
import { isoWeekdayOf, seedPlanned, seedSeries } from './helpers/recurring-seed'
import { seedBankOperation } from './helpers/transfer-seed'
import { addDays } from '../../lib/domain/ledger/days'
import { addMonthsClamped, paymentDayOf } from '../../lib/domain/recurring/schedule'
import { LIST_DAYS } from '../../lib/domain/recurring/types'
import { todayDay } from '../../lib/utils/today'

const NEEDS_EMULATORS =
  'Needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"'

const rowsOf = (page: Page): Locator => page.locator('tbody').getByRole('row').filter({ has: page.getByRole('checkbox') })
const seriesRow = (page: Page, name: string): Locator => page.getByTestId('series-row').filter({ hasText: name })
const seriesActions = (page: Page, name: string): Locator => page.getByRole('group', { name: `Дії з серією ${name}` })
/** `YYYY-MM-DD` as the date field types it: DD.MM.YYYY. */
const dmy = (day: string): string => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`
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

/**
 * The first payment day on or after `today` of the ZUS preset (the 15th, the next business day), by the schedule's own rule.
 * The 15th of the previous month is paid before `today` in every case, so this month's and next month's 15th cover it.
 */
function zusPaymentDayFrom(today: string): string {
  const thisMonth = `${today.slice(0, 8)}15`
  const candidates = [thisMonth, addMonthsClamped(thisMonth, 1)].map((o) => paymentDayOf(o, 'next'))
  return candidates.find((day) => day >= today) ?? candidates[candidates.length - 1]
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
    // The list shows today and the LIST_DAYS - 1 days after it: the first ZUS plan is in it when its payment day is in them.
    // The day moves with the run date, so the expectation comes from the same rule the server uses.
    const today = todayDay()
    if (zusPaymentDayFrom(today) <= addDays(today, LIST_DAYS - 1)) await expect(page.getByTestId('plan-estimated').first()).toBeVisible()
    else await expect(page.getByTestId('plan-estimated')).toHaveCount(0)

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

  test('pausing keeps the future plans unless the box is ticked; resuming brings the series back', async ({ page, request }) => {
    const user = await setup(page, request, 'rc-pause')
    await seedSeries(page, user.orgId, rentToday(50_000))
    await page.goto(`/${user.orgId}/recurring`)
    await expect(seriesRow(page, 'Czynsz')).toBeVisible()
    await seriesActions(page, 'Czynsz').getByRole('button', { name: 'Призупинити' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('pause-confirm')).toBeVisible()
    await expect(dialog.locator('#pause-remove')).not.toBeChecked()
    await dialog.getByTestId('pause-confirm').click()
    await expect(dialog).toBeHidden()
    await expect(toast(page, 'Серію призупинено')).toBeVisible()
    await expect(seriesRow(page, 'Czynsz').getByTestId('series-state')).toHaveText('Призупинена')

    await page.goto(`/${user.orgId}/transactions`)
    await expect(rowsOf(page)).toHaveCount(4)

    await page.goto(`/${user.orgId}/recurring`)
    await expect(seriesActions(page, 'Czynsz').getByRole('button', { name: 'Відновити' })).toBeVisible()
    await seriesActions(page, 'Czynsz').getByRole('button', { name: 'Відновити' }).click()
    await expect(toast(page, 'Серію відновлено')).toBeVisible()
    await expect(seriesRow(page, 'Czynsz').getByTestId('series-state')).toHaveText('Активна')
  })

  test('pausing with «Видалити майбутні неоплачені операції» removes the future unpaid plans', async ({ page, request }) => {
    const user = await setup(page, request, 'rc-pause-rm')
    await seedSeries(page, user.orgId, rentToday(50_000))
    await page.goto(`/${user.orgId}/recurring`)
    await expect(seriesRow(page, 'Czynsz')).toBeVisible()
    await seriesActions(page, 'Czynsz').getByRole('button', { name: 'Призупинити' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('pause-confirm')).toBeVisible()
    await dialog.locator('#pause-remove').check()
    await dialog.getByTestId('pause-confirm').click()
    await expect(dialog).toBeHidden()
    await expect(toast(page, 'Серію призупинено')).toBeVisible()

    await page.goto(`/${user.orgId}/transactions`)
    await expect(accountRow(page, 'Konto A')).toBeVisible()
    await expect(rowsOf(page)).toHaveCount(0)
  })

  test('deleting a series keeps its future plans when the box is cleared, and removes them by default', async ({ page, request }) => {
    const user = await setup(page, request, 'rc-delete')
    await seedSeries(page, user.orgId, rentToday(50_000))
    await page.goto(`/${user.orgId}/recurring`)
    await expect(seriesRow(page, 'Czynsz')).toBeVisible()
    await seriesActions(page, 'Czynsz').getByRole('button', { name: 'Видалити' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('delete-confirm')).toBeVisible()
    await dialog.locator('#delete-future').uncheck()
    await dialog.getByTestId('delete-confirm').click()
    await expect(dialog).toBeHidden()
    await expect(toast(page, 'Серію видалено')).toBeVisible()
    await expect(seriesRow(page, 'Czynsz')).toHaveCount(0)

    await page.goto(`/${user.orgId}/transactions`)
    await expect(rowsOf(page)).toHaveCount(4)

    // A second series, deleted with its future plans (the default of the dialog).
    await seedSeries(page, user.orgId, { ...rentToday(30_000), name: 'Internet' })
    await page.goto(`/${user.orgId}/recurring`)
    await expect(seriesRow(page, 'Internet')).toBeVisible()
    await seriesActions(page, 'Internet').getByRole('button', { name: 'Видалити' }).click()
    const second = page.getByRole('dialog')
    await expect(second.getByTestId('delete-confirm')).toBeVisible()
    await expect(second.locator('#delete-future')).toBeChecked()
    await second.getByTestId('delete-confirm').click()
    await expect(second).toBeHidden()
    await expect(toast(page, 'Серію видалено')).toBeVisible()
    // The first series' four plans stay; the second series' four are gone.
    await page.goto(`/${user.orgId}/transactions`)
    await expect(rowsOf(page)).toHaveCount(4)
  })

  test('«Перенести» gives a planned operation another day and marks it «Змінено вручну»', async ({ page, request }) => {
    const user = await setup(page, request, 'rc-move')
    await seedSeries(page, user.orgId, rentToday(50_000))
    await page.goto(`/${user.orgId}/recurring`)
    const row = page.getByTestId('planned-row').filter({ hasText: 'Czynsz' }).first()
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Перенести' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('#move-date')).toBeVisible()
    await dialog.locator('#move-date').fill(dmy(dayFromToday(2)))
    await dialog.getByRole('button', { name: 'Перенести', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(toast(page, 'Дату перенесено')).toBeVisible()
    await expect(page.getByTestId('planned-row').filter({ hasText: 'Змінено вручну' })).toHaveCount(1)
  })

  test('«Позначити сплаченою» on the page pays the plan once: it is an actual operation and moves the balance', async ({ page, request }) => {
    const user = await setup(page, request, 'rc-paid')
    await seedSeries(page, user.orgId, rentToday(50_000))
    await page.goto(`/${user.orgId}/recurring`)
    const rows = page.getByTestId('planned-row').filter({ hasText: 'Czynsz' })
    await expect(rows.first()).toBeVisible()
    // The next month's plan can be inside the 31 days too (it depends on the day of the month): one row less, not none.
    const before = await rows.count()
    await rows.first().getByRole('button', { name: 'Позначити сплаченою' }).click()
    await expect(toast(page, 'Позначено сплаченою')).toBeVisible()
    await expect(rows).toHaveCount(before - 1)
    await expect.poll(() => balanceMinor(request, user.orgId, 'acc-a')).toBe(50_000)

    await page.goto(`/${user.orgId}/transactions`)
    await expect(rowsOf(page)).toHaveCount(4)
    expect(await balanceMinor(request, user.orgId, 'acc-a')).toBe(50_000)
  })

  test('a preset in a company without its S06 records creates them with the series (I1)', async ({ page, request }) => {
    const user = await setup(page, request, 'rc-cp-none')
    const system = `organizations/${user.orgId}/counterparties/system_zus`
    expect(await readDoc(request, system), 'the S06 record exists at registration').not.toBeNull()
    await deleteDoc(request, system)
    await deleteDoc(request, `organizations/${user.orgId}/counterpartyKeys/name_zus`)

    await page.goto(`/${user.orgId}/recurring`)
    await expect(page.getByTestId('series-empty')).toBeVisible()
    await page.getByTestId('preset-menu').click()
    await page.getByTestId('preset-zus').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('#series-name')).toHaveValue('ZUS')
    await dialog.locator('#series-account').selectOption({ label: 'Konto A' })
    await dialog.locator('#series-amount').fill('1500')
    await dialog.getByTestId('series-save').click()
    await expect(dialog).toBeHidden()
    await expect(seriesRow(page, 'ZUS')).toHaveCount(1)
    expect(await readDoc(request, system), 'the record is created again by the preset').not.toBeNull()
  })

  test('a preset in a company with its own «ZUS» record uses that record (I1)', async ({ page, request }) => {
    const user = await setup(page, request, 'rc-cp-own')
    const org = `organizations/${user.orgId}`
    await deleteDoc(request, `${org}/counterparties/system_zus`)
    await deleteDoc(request, `${org}/counterpartyKeys/name_zus`)
    await seedDoc(request, `${org}/counterparties`, 'my-zus', { schemaVersion: 1, orgId: user.orgId, name: 'ZUS', ibans: [], archived: false })
    await seedDoc(request, `${org}/counterpartyKeys`, 'name_zus', { counterpartyId: 'my-zus' })

    await page.goto(`/${user.orgId}/recurring`)
    await expect(page.getByTestId('series-empty')).toBeVisible()
    await page.getByTestId('preset-menu').click()
    await page.getByTestId('preset-zus').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('#series-name')).toHaveValue('ZUS')
    await dialog.locator('#series-account').selectOption({ label: 'Konto A' })
    await dialog.locator('#series-amount').fill('1500')
    await dialog.getByTestId('series-save').click()
    await expect(dialog).toBeHidden()
    await expect(seriesRow(page, 'ZUS')).toHaveCount(1)
    expect(await readDoc(request, `${org}/counterparties/system_zus`), 'no second ZUS record is created').toBeNull()
  })
})
