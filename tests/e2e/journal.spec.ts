// tests/e2e/journal.spec.ts
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { registerViaUi, waitForShell, type RegisteredUser } from './helpers/app-ui'
import { listDocs, readDoc, seedDoc } from './helpers/emulator-firestore'
import { seedLedgerAccount, seedLedgerOperation, utcDay } from './helpers/ledger-seed'
import { todayDay } from '../../lib/utils/today'

const NEEDS_EMULATORS =
  'Needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"'

function balanceText(whole: string, fraction: string): RegExp {
  return new RegExp(`${whole.replace(/\s/g, '\\s')},${fraction}`)
}
const accountRow = (page: Page, name: string): Locator =>
  page.getByRole('complementary', { name: 'Рахунки' }).getByRole('listitem').filter({ hasText: name })
const formDialog = (page: Page): Locator => page.getByRole('dialog').filter({ has: page.locator('#tx-amount') })
const toast = (page: Page, text: string): Locator => page.locator('[data-sonner-toast]').filter({ hasText: text })
const daysAgo = (n: number): string => {
  const d = new Date(`${todayDay()}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return utcDay(d)
}
// Operation rows only: the header row also holds a checkbox (select all), and day-group rows hold none.
const rowsOf = (page: Page): Locator => page.locator('tbody').getByRole('row').filter({ has: page.getByRole('checkbox') })
const txs = (request: APIRequestContext, user: RegisteredUser) => listDocs(request, `organizations/${user.orgId}/transactions`)

async function setup(page: Page, request: APIRequestContext, prefix: string): Promise<RegisteredUser> {
  const user = await registerViaUi(page, prefix, 'PLN')
  await waitForShell(page, user.companyName)
  await seedLedgerAccount(request, user.orgId, 'acc-main', { name: 'Konto PLN', balance: 1000, currency: 'PLN' })
  await expect(accountRow(page, 'Konto PLN')).toBeVisible()
  // Only the income categories are seeded by default; the bulk dialog and the fill chip offer expense categories.
  for (const [id, name] of [['cat-exp-1', 'Czynsze'], ['cat-exp-2', 'Paliwo']]) {
    await seedDoc(request, `organizations/${user.orgId}/categories`, id, { name, type: 'expense', color: '#ef4444', orgId: user.orgId, createdAt: new Date() })
  }
  return user
}

async function createExpense(page: Page, amount: string, description: string): Promise<void> {
  await page.getByRole('button', { name: 'Витрата', exact: true }).click()
  const dialog = formDialog(page)
  await dialog.locator('#tx-amount').fill(amount)
  await dialog.locator('#tx-desc').fill(description)
  await dialog.getByRole('button', { name: 'Додати', exact: true }).click()
  await expect(dialog).toBeHidden()
}

test.describe('journal (emulators)', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test('pages load while scrolling', async ({ page, request }) => {
    const user = await setup(page, request, 'jr-paging')
    for (let i = 0; i < 120; i++) {
      await seedLedgerOperation(request, user.orgId, `tx-${String(i).padStart(3, '0')}`, {
        type: 'expense',
        accountId: 'acc-main',
        amount: 10 + i,
        currency: 'PLN',
        date: daysAgo(i % 60),
        description: `Wiersz ${i}`,
      })
    }
    const cursors: (string | null)[] = []
    page.on('request', (r) => r.url().includes('/journal') && cursors.push(new URL(r.url()).searchParams.get('cursor')))
    await page.reload()
    await expect(rowsOf(page)).toHaveCount(50)
    await rowsOf(page).last().scrollIntoViewIfNeeded()
    await expect(rowsOf(page)).toHaveCount(100)
    await rowsOf(page).last().scrollIntoViewIfNeeded()
    await expect(rowsOf(page)).toHaveCount(120)
    expect(cursors.filter(Boolean).length).toBeGreaterThanOrEqual(2)
  })

  test('the balance after each operation is shown and matches', async ({ page, request }) => {
    await setup(page, request, 'jr-balance')
    await createExpense(page, '100', 'Pierwsza')
    await createExpense(page, '50', 'Druga')
    // 1 000 − 100 = 900 after the first, 900 − 50 = 850 after the second (the newest row shows the account balance).
    const first = page.getByRole('row').filter({ hasText: 'Pierwsza' })
    const second = page.getByRole('row').filter({ hasText: 'Druga' })
    await expect(second.getByLabel('Залишок після')).toContainText(balanceText('850', '00'))
    await expect(first.getByLabel('Залишок після')).toContainText(balanceText('900', '00'))
    await expect(accountRow(page, 'Konto PLN')).toContainText(balanceText('850', '00'))
  })

  test('search and type filters live in the address and survive a reload', async ({ page, request }) => {
    const user = await setup(page, request, 'jr-filters')
    await seedLedgerOperation(request, user.orgId, 'tx-a', { type: 'expense', accountId: 'acc-main', amount: 20, currency: 'PLN', date: daysAgo(1), description: 'Dostawa Łódź' })
    await seedLedgerOperation(request, user.orgId, 'tx-b', { type: 'expense', accountId: 'acc-main', amount: 30, currency: 'PLN', date: daysAgo(2), description: 'Czynsz' })
    await seedLedgerOperation(request, user.orgId, 'tx-c', { type: 'income', accountId: 'acc-main', amount: 40, currency: 'PLN', date: daysAgo(3), description: 'Sprzedaż' })
    await page.reload()
    await expect(rowsOf(page)).toHaveCount(3)

    await page.getByLabel('Пошук за рахунками, контрагентами і коментарями').fill('lodz')
    await expect(rowsOf(page)).toHaveCount(1)
    await expect(page).toHaveURL(/q=lodz/)
    await page.reload()
    await expect(rowsOf(page)).toHaveCount(1)
    await expect(page.getByRole('row').filter({ hasText: 'Dostawa Łódź' })).toBeVisible()

    await page.goto(`/${user.orgId}/transactions?types=income`)
    await expect(rowsOf(page)).toHaveCount(1)
    await expect(page.getByRole('row').filter({ hasText: 'Sprzedaż' })).toBeVisible()
  })

  test('a bulk category change can be undone', async ({ page, request }) => {
    const user = await setup(page, request, 'jr-bulk')
    for (let i = 0; i < 5; i++) {
      await seedLedgerOperation(request, user.orgId, `tx-${i}`, { type: 'expense', accountId: 'acc-main', amount: 10 + i, currency: 'PLN', date: daysAgo(i), description: `Op ${i}` })
    }
    await page.reload()
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(5)
    for (const i of [0, 1, 2]) await rows.nth(i).getByRole('checkbox').check()
    const bar = page.getByRole('region', { name: 'Вибрані операції' })
    await bar.getByRole('button', { name: 'Змінити дані' }).click()
    await page.getByRole('menuitem', { name: 'Змінити категорію' }).click()
    const dialog = page.getByRole('dialog')
    expect(await dialog.getByRole('combobox').locator('option').count()).toBeGreaterThan(2)
    await dialog.getByRole('combobox').selectOption({ index: 2 })
    await dialog.getByRole('button', { name: 'Застосувати' }).click()
    await expect(dialog).toBeHidden()

    await expect.poll(async () => (await txs(request, user)).filter((d) => 'categoryId' in d.fields).length).toBe(3)
    await toast(page, 'Змінено').getByRole('button', { name: 'Скасувати' }).click()
    await expect.poll(async () => (await txs(request, user)).filter((d) => 'categoryId' in d.fields).length).toBe(0)
  })

  test('a bulk delete asks first and can be undone', async ({ page, request }) => {
    const user = await setup(page, request, 'jr-delete')
    await createExpense(page, '100', 'Do usunięcia A')
    await createExpense(page, '50', 'Do usunięcia B')
    await expect(accountRow(page, 'Konto PLN')).toContainText(balanceText('850', '00'))
    await page.getByRole('row').filter({ hasText: 'Do usunięcia A' }).getByRole('checkbox').check()
    await page.getByRole('row').filter({ hasText: 'Do usunięcia B' }).getByRole('checkbox').check()
    await page.getByRole('region', { name: 'Вибрані операції' }).getByRole('button', { name: 'Видалити' }).click()
    const confirm = page.getByRole('dialog').filter({ hasText: 'Видалити операцій: 2' })
    await confirm.getByRole('button', { name: 'Видалити', exact: true }).click()
    await expect.poll(async () => (await txs(request, user)).length).toBe(0)
    await expect(accountRow(page, 'Konto PLN')).toContainText(balanceText('1 000', '00'))

    await toast(page, 'Видалено').getByRole('button', { name: 'Скасувати' }).click()
    await expect.poll(async () => (await txs(request, user)).length).toBe(2)
    await expect(accountRow(page, 'Konto PLN')).toContainText(balanceText('850', '00'))
  })

  test('a fill chip sets the category in the row', async ({ page, request }) => {
    const user = await setup(page, request, 'jr-chip')
    await seedLedgerOperation(request, user.orgId, 'tx-chip', { type: 'expense', accountId: 'acc-main', amount: 25, currency: 'PLN', date: daysAgo(1), description: 'Bez kategorii' })
    await page.reload()
    const row = page.getByRole('row').filter({ hasText: 'Bez kategorii' })
    await row.getByRole('button', { name: 'вкажіть' }).first().click()
    await page.getByRole('combobox', { name: 'Оберіть категорію' }).selectOption({ index: 1 })
    await page.getByRole('button', { name: 'Зберегти', exact: true }).click()
    await expect
      .poll(async () => 'categoryId' in ((await readDoc(request, `organizations/${user.orgId}/transactions/tx-chip`)) ?? {}))
      .toBe(true)
  })

  test('export downloads a CSV of the filtered rows', async ({ page, request }) => {
    const user = await setup(page, request, 'jr-export')
    await seedLedgerOperation(request, user.orgId, 'tx-1', { type: 'expense', accountId: 'acc-main', amount: 12.5, currency: 'PLN', date: daysAgo(1), description: 'Eksport jeden' })
    await seedLedgerOperation(request, user.orgId, 'tx-2', { type: 'income', accountId: 'acc-main', amount: 99, currency: 'PLN', date: daysAgo(2), description: '=HYPERLINK("x")' })
    await page.reload()
    await expect(rowsOf(page)).toHaveCount(2)
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Експорт CSV' }).click()])
    const text = await readFile(await download.path(), 'utf8')
    expect(text.startsWith('﻿')).toBe(true)
    const lines = text.slice(1).trim().split('\r\n')
    expect(lines).toHaveLength(3) // header + 2 rows
    expect(lines.join('\n')).toContain('-12,50') // an expense is negative, with the decimal comma of the uk catalog
    expect(lines.join('\n')).toContain("'=HYPERLINK") // the formula is defused
    expect(lines[0].split(';').length).toBeGreaterThanOrEqual(16)
  })

  test('an operation made from the header appears without a reload', async ({ page, request }) => {
    await setup(page, request, 'jr-live')
    await expect(rowsOf(page)).toHaveCount(0)
    await createExpense(page, '75', 'Z nagłówka')
    await expect(page.getByRole('row').filter({ hasText: 'Z nagłówka' })).toBeVisible()
  })

  test('the toolbar renders in Polish and English', async ({ page, request, context }) => {
    const user = await setup(page, request, 'jr-i18n')
    for (const [locale, placeholder, exportLabel] of [
      ['pl', /Szukaj/, 'Eksport CSV'],
      ['en', /Search/, 'Export CSV'],
    ] as const) {
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: 'http://localhost:3000' }])
      await page.goto(`/${user.orgId}/transactions`)
      await expect(page.getByPlaceholder(placeholder)).toBeVisible()
      await expect(page.getByRole('button', { name: exportLabel })).toBeVisible()
    }
  })
})
