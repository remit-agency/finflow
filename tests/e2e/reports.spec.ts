// tests/e2e/reports.spec.ts
// Server reports (S12): Cash Flow from the rollups with the reconciliation and the «Виключено з аналітики» line; a concrete
// tag counts the excluded operation from the operations; the P&L spreads an accrual period over months; CSV and XLSX come
// from the server; the dashboard «Гроші зараз» values an EUR account at the NBP stub's rate; a refusal of the read limit
// says so; the Balance reads the server balances. Days come from today; expectations from the same rules as the code.
import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { registerViaUi, waitForShell, type RegisteredUser } from './helpers/app-ui'
import { seedDoc } from './helpers/emulator-firestore'
import { seedLedgerAccount } from './helpers/ledger-seed'
import { postOperation } from './helpers/report-seed'
import { monthBounds, monthOf, prevMonth } from '../../lib/domain/ledger/days'
import { allocatePeriod } from '../../lib/domain/ledger/period'
import { formatMoney, formatNumber } from '../../lib/i18n/format'
import { todayDay } from '../../lib/utils/today'

const NEEDS_EMULATORS =
  'Needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"'

/** An amount in złoty as the Ukrainian pages write it (the same formatter as the app). */
const zl = (amount: number): string => formatMoney(amount, 'PLN', 'uk')

/** A tag in the exact shape the server stores (lib/domain/tags/doc.ts). */
async function seedTag(request: APIRequestContext, orgId: string, id: string, name: string, excludeFromAnalytics: boolean): Promise<void> {
  await seedDoc(request, `organizations/${orgId}/tags`, id, {
    schemaVersion: 1, name, color: excludeFromAnalytics ? 'rose' : 'amber', excludeFromAnalytics, archived: false, recalcPending: false,
    orgId, createdAt: new Date(), createdBy: 'e2e', updatedAt: new Date(),
  })
}

async function seedCategory(request: APIRequestContext, orgId: string, id: string, name: string, type: 'income' | 'expense'): Promise<void> {
  await seedDoc(request, `organizations/${orgId}/categories`, id, { name, type, color: '#6366f1', orgId, createdAt: new Date() })
}

/**
 * A PLN company: «Konto A» from 1000 zł, «Konto B» from 0; today a sale of 500 («Faktury e2e»), rent of 120 («Najem e2e»), VAT
 * of 230 tagged «ПДВ» (excluded from analytics) and a transfer of 100 from A to B. The year closes at 1150 zł.
 * The category names are not default names: a stored name equal to a default one («Sprzedaż», «Czynsz») is shown in the
 * active language (lib/i18n/category-name.ts), so the row would read «Продажі» and «Оренда» in Ukrainian.
 */
async function setup(page: Page, request: APIRequestContext, prefix: string): Promise<RegisteredUser> {
  const user = await registerViaUi(page, prefix, 'PLN')
  await waitForShell(page, user.companyName)
  const org = user.orgId
  await seedLedgerAccount(request, org, 'acc-a', { name: 'Konto A', balance: 1000, currency: 'PLN' })
  await seedLedgerAccount(request, org, 'acc-b', { name: 'Konto B', balance: 0, currency: 'PLN' })
  await seedTag(request, org, 'tag-vat', 'ПДВ', true)
  await seedCategory(request, org, 'cat-sales', 'Faktury e2e', 'income')
  await seedCategory(request, org, 'cat-rent', 'Najem e2e', 'expense')
  const day = todayDay()
  await postOperation(page, org, { type: 'income', accountId: 'acc-a', amountMinor: 50_000, paymentDate: day, categoryId: 'cat-sales', description: 'Faktura 1/11' })
  await postOperation(page, org, { type: 'expense', accountId: 'acc-a', amountMinor: 12_000, paymentDate: day, categoryId: 'cat-rent', description: 'Czynsz biuro' })
  await postOperation(page, org, { type: 'expense', accountId: 'acc-a', amountMinor: 23_000, paymentDate: day, tags: ['tag-vat'], description: 'VAT' })
  await postOperation(page, org, { type: 'transfer', accountId: 'acc-a', toAccountId: 'acc-b', amountMinor: 10_000, paymentDate: day, description: 'Do kasy' })
  return user
}

test.describe('server reports (emulators)', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test('Cash Flow comes from the server: the totals, the excluded line and a reconciliation that adds up', async ({ page, request }) => {
    const user = await setup(page, request, 'rp-cf')
    await page.goto(`/${user.orgId}/analytics/cashflow`)
    await waitForShell(page, user.companyName)
    await expect(page.getByTestId('cashflow-total-income')).toHaveText('500')
    await expect(page.getByTestId('cashflow-total-expense')).toHaveText('120')
    await expect(page.getByTestId('report-source')).toHaveAttribute('data-source', 'rollups')
    await expect(page.getByTestId('cashflow-excluded-expense')).toContainText(zl(230))
    await expect(page.getByTestId('cf-account-row')).toHaveCount(2)
    // The row of «Konto A» closes: 1000 + 500 in - 120 out - 100 transferred - 230 excluded = 1050.
    const accountA = page.getByTestId('cf-account-row').filter({ hasText: 'Konto A' })
    await expect(accountA.getByTestId('cf-account-excluded')).toContainText(zl(-230))
    await expect(accountA).toContainText(zl(1050))
    const categories = page.getByTestId('cf-category-row')
    await expect(categories).toHaveCount(2)
    await expect(categories.filter({ hasText: 'Faktury e2e' })).toContainText(zl(500))
    await expect(categories.filter({ hasText: 'Najem e2e' })).toContainText(zl(120))
    const recon = page.getByTestId('reconciliation')
    await expect(recon.getByTestId('recon-opening')).toContainText(zl(1000))
    await expect(recon.getByTestId('recon-net')).toContainText(zl(380))
    await expect(recon.getByTestId('recon-excluded')).toContainText(zl(-230))
    await expect(recon.getByTestId('recon-transfers')).toHaveCount(0)
    await expect(recon.getByTestId('recon-fx')).toHaveCount(0)
    await expect(recon.getByTestId('recon-closing')).toContainText(zl(1150))
    await expect(recon.getByTestId('recon-ok')).toHaveText('Сходиться')
    await expect(recon.getByTestId('recon-discrepancy')).toHaveCount(0)
  })

  test('a concrete tag counts the excluded operation from the operations; the reconciliation says it is included', async ({ page, request }) => {
    const user = await setup(page, request, 'rp-tag')
    await page.goto(`/${user.orgId}/analytics/cashflow?tg=tag-vat`)
    await waitForShell(page, user.companyName)
    await expect(page.getByTestId('cashflow-total-income')).toHaveText('0')
    await expect(page.getByTestId('cashflow-total-expense')).toHaveText('230')
    await expect(page.getByTestId('analytics-excluded-hint')).toBeVisible()
    await expect(page.getByTestId('report-source')).toHaveAttribute('data-source', 'operations')
    await expect(page.getByTestId('cashflow-excluded')).toHaveCount(0)
    const recon = page.getByTestId('reconciliation')
    await expect(recon.getByTestId('recon-included')).toBeVisible()
    await expect(recon.getByTestId('recon-excluded')).toHaveCount(0)
    await expect(recon.getByTestId('recon-outside')).toContainText(zl(380))
    await expect(recon.getByTestId('recon-closing')).toContainText(zl(1150))
    await expect(recon.getByTestId('recon-ok')).toBeVisible()
  })

  test('the P&L counts by recognition date: an accrual period over two months gives each its share', async ({ page, request }) => {
    const user = await registerViaUi(page, 'rp-pl', 'PLN')
    await waitForShell(page, user.companyName)
    const org = user.orgId
    await seedLedgerAccount(request, org, 'acc-a', { name: 'Konto A', balance: 1000, currency: 'PLN' })
    await seedCategory(request, org, 'cat-rent', 'Najem e2e', 'expense')
    const today = todayDay()
    const from = `${prevMonth(monthOf(today))}-01`
    const to = monthBounds(monthOf(today)).last
    await postOperation(page, org, { type: 'expense', accountId: 'acc-a', amountMinor: 90_000, paymentDate: today, categoryId: 'cat-rent', accrual: { mode: 'period', from, to }, description: 'Najem' })
    // The current year's share: both months, or in January only this one (the other month is last year).
    const share = allocatePeriod(90_000, from, to).filter(([month]) => month.startsWith(today.slice(0, 4))).reduce((s, [, v]) => s + v, 0)
    await page.goto(`/${org}/analytics/pl`)
    await waitForShell(page, user.companyName)
    const expenses = page.getByRole('row').filter({ hasText: 'Всього витрати' }).getByRole('cell').last()
    await expect(expenses).toHaveText(formatNumber(share / 100, 'uk', { maximumFractionDigits: 0 }))
    await expect(page.getByTestId('report-source')).toHaveAttribute('data-source', 'rollups')
    await expect(page.getByTestId('reconciliation').getByTestId('recon-ok')).toBeVisible()
  })

  test('CSV and XLSX are built by the server from the same report', async ({ page, request }) => {
    const user = await setup(page, request, 'rp-export')
    await page.goto(`/${user.orgId}/analytics/cashflow`)
    await waitForShell(page, user.companyName)
    await expect(page.getByTestId('cashflow-total-income')).toHaveText('500')

    const csvDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Експорт CSV', exact: true }).click()
    const csvFile = await csvDownload
    expect(csvFile.suggestedFilename()).toBe('cashflow-current-year.csv')
    const csv = readFileSync(await csvFile.path(), 'utf8')
    expect(csv.startsWith('﻿Звіт\r\n')).toBe(true)
    expect(csv).toContain('\r\nРазом;500,00;120,00;380,00;\r\n')
    expect(csv).toContain('\r\nFaktury e2e;Надходження;500,00\r\n')
    expect(csv).toContain('\r\nПочатковий залишок;1000,00\r\n')
    expect(csv).toContain('\r\nКінцевий залишок;1150,00\r\n')

    const xlsxDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Експорт XLSX', exact: true }).click()
    const xlsxFile = await xlsxDownload
    expect(xlsxFile.suggestedFilename()).toBe('cashflow-current-year.xlsx')
    const workbook = strFromU8(unzipSync(new Uint8Array(readFileSync(await xlsxFile.path())))['xl/workbook.xml'])
    for (const name of ['Звіт', 'За категоріями', 'Звірка']) expect(workbook).toContain(`name="${name}"`)
  })

  test('«Гроші зараз»: /<org> opens it; the balances of today and the total in PLN with an EUR account at the NBP rate', async ({ page, request }) => {
    const user = await registerViaUi(page, 'rp-dash', 'PLN')
    await waitForShell(page, user.companyName)
    await seedLedgerAccount(request, user.orgId, 'acc-a', { name: 'Konto A', balance: 1000, currency: 'PLN' })
    await seedLedgerAccount(request, user.orgId, 'acc-eur', { name: 'Konto EUR', balance: 200, currency: 'EUR' })
    await page.goto(`/${user.orgId}`)
    await page.waitForURL(new RegExp(`/${user.orgId}/dashboard$`))
    await waitForShell(page, user.companyName)
    await expect(page.getByRole('heading', { level: 1, name: 'Гроші зараз' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Модулі' }).getByRole('link', { name: 'Гроші зараз' })).toHaveAttribute('aria-current', 'page')
    // The NBP stub (tests/e2e/helpers/nbp-stub.mjs) publishes EUR at 4.30 every weekday: 200 € is 860 zł.
    await expect(page.getByTestId('dashboard-total')).toContainText(zl(1860))
    await expect(page.getByTestId('dashboard-account')).toHaveCount(2)
    await expect(page.getByTestId('dashboard-account').filter({ hasText: 'Konto EUR' })).toContainText(zl(860))
    await expect(page.getByTestId('dashboard-currency').filter({ hasText: 'EUR' })).toContainText('4,3000')
    // A single segment that cannot be a company stays a 404 (no redirect into the shell).
    expect((await page.goto('/not.a.company'))?.status()).toBe(404)
  })

  test('a refusal of the read limit says to narrow the period instead of showing a figure', async ({ page }) => {
    // The server side of the limit is in tests/integration/reports-read.test.ts; here the page's answer to it.
    const user = await registerViaUi(page, 'rp-limit', 'PLN')
    await waitForShell(page, user.companyName)
    await page.route('**/api/orgs/*/reports/cashflow?**', (route) =>
      route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'too_many_operations', cap: 10_000 }) }),
    )
    await page.goto(`/${user.orgId}/analytics/cashflow`)
    await waitForShell(page, user.companyName)
    await expect(page.getByTestId('report-too-large')).toHaveText(`Звіту потрібно більше даних, ніж сервер читає разом (ліміт ${formatNumber(10_000, 'uk')}). Звузьте період або рахунки чи зніміть фільтри.`)
    await expect(page.getByTestId('cashflow-total-income')).toHaveCount(0)
  })

  test('the Balance reads the server balances on the chosen day', async ({ page, request }) => {
    const user = await setup(page, request, 'rp-bal')
    await page.goto(`/${user.orgId}/analytics/balance`)
    await waitForShell(page, user.companyName)
    await expect(page.getByTestId('balance-money-total')).toContainText(zl(1150))
    await page.getByLabel('Станом на').selectOption('prevYearEnd')
    await expect(page.getByTestId('balance-money-total')).toContainText(zl(1000))
  })
})
