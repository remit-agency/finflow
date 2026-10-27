import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { registerViaUi, waitForShell } from '../e2e/helpers/app-ui'
import { seedDoc } from '../e2e/helpers/emulator-firestore'
import { seedLedgerAccount, seedLedgerOperation } from '../e2e/helpers/ledger-seed'
import { formatDayLongUtc } from '../../lib/utils/calendar-grid'
import en from '../../messages/en.json'
import pl from '../../messages/pl.json'

const OUT_DIR = join(process.cwd(), 'ui-shots')
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const
const DAY_MS = 24 * 60 * 60 * 1000
const SETTINGS = ['company', 'categories', 'banks', 'subscription'] as const
const ANALYTICS = [
  { path: 'cashflow', heading: 'Cash Flow', charts: true },
  { path: 'pl', heading: 'P&L — Прибутки та збитки', charts: true },
  { path: 'balance', heading: 'Баланс', charts: false },
  { path: 'calendar', heading: 'Календар', charts: false },
] as const

async function seedDemoData(request: APIRequestContext, orgId: string): Promise<void> {
  const base = `organizations/${orgId}`
  const now = Date.now()
  const accounts = [
    { id: 'demo-main', name: 'Основний рахунок', balance: 48250.4, currency: 'UAH', color: '#00c896' },
    { id: 'demo-cash', name: 'Каса', balance: 3200, currency: 'UAH', color: '#f59e0b' },
    { id: 'demo-eur', name: 'Рахунок EUR', balance: 1250, currency: 'EUR', color: '#6366f1' },
  ]
  for (const a of accounts) {
    await seedLedgerAccount(request, orgId, a.id, { name: a.name, balance: a.balance, currency: a.currency, color: a.color })
  }
  await seedDoc(request, `${base}/categories`, 'demo-rent', {
    name: 'Оренда офісу (демо)',
    type: 'expense',
    color: '#ef4444',
    orgId,
    createdAt: new Date(now),
  })
  await seedDoc(request, `${base}/categories`, 'demo-sales', {
    name: 'Послуги клієнтам',
    type: 'income',
    color: '#22c55e',
    orgId,
    createdAt: new Date(now),
  })
  const txs: { id: string; type: 'income' | 'expense' | 'transfer'; accountId: string; amount: number; daysAgo: number; description: string; categoryId?: string; toAccountId?: string }[] = [
    { id: 'demo-t1', type: 'income', accountId: 'demo-main', amount: 18500, daysAgo: 0, description: 'Оплата рахунку №112', categoryId: 'demo-sales' },
    { id: 'demo-t2', type: 'expense', accountId: 'demo-main', amount: 12000, daysAgo: 0, description: 'Оренда офісу', categoryId: 'demo-rent' },
    { id: 'demo-t3', type: 'expense', accountId: 'demo-cash', amount: 640.5, daysAgo: 1, description: 'Канцелярія' },
    { id: 'demo-t4', type: 'income', accountId: 'demo-main', amount: 7300, daysAgo: 2, description: 'Консультація', categoryId: 'demo-sales' },
    { id: 'demo-t5', type: 'transfer', accountId: 'demo-main', amount: 2000, daysAgo: 2, description: 'Поповнення каси', toAccountId: 'demo-cash' },
  ]
  for (const t of txs) {
    await seedLedgerOperation(request, orgId, t.id, {
      type: t.type,
      accountId: t.accountId,
      amount: t.amount,
      currency: 'UAH',
      date: new Date(now - t.daysAgo * DAY_MS),
      description: t.description,
      categoryId: t.categoryId,
      // Both accounts are in UAH: the received amount is the sent one.
      ...(t.toAccountId ? { toAccountId: t.toAccountId, toAmount: t.amount, toCurrency: 'UAH' } : {}),
    })
  }
}

// next-themes leaves `dark` on <html> (the landing default); the app shell must stay light.
async function assertLightShellUnderDarkRoot(page: Page): Promise<void> {
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/)
  const background = await page.locator('.app-shell').evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(background).toBe('rgb(244, 246, 245)')
}

test.describe('ui shots', () => {
  test.skip(
    !process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST,
    'Run with `npm run ui:shots` (it starts the Auth + Firestore emulators)',
  )

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true })
    // Start from an empty folder: no stale images from an older list of screens. Removing also
    // avoids a Windows quirk where overwriting a PNG that an image viewer holds open fails.
    for (const old of readdirSync(OUT_DIR)) {
      if (old.endsWith('.png')) rmSync(join(OUT_DIR, old), { force: true })
    }
  })

  test('key screens at 1440x900 and 390x844 with a dark <html>', async ({ page, request }) => {
    test.setTimeout(300_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    const user = await registerViaUi(page, 'shots')
    await waitForShell(page, user.companyName)
    await seedDemoData(request, user.orgId)

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      let index = 0
      const shot = async (name: string) => {
        await assertLightShellUnderDarkRoot(page)
        index += 1
        const file = `${viewport.name}-${String(index).padStart(2, '0')}-${name}.png`
        await page.screenshot({ path: join(OUT_DIR, file), animations: 'disabled' })
      }
      const open = async (path: string) => {
        await page.goto(`/${user.orgId}/${path}`)
        await waitForShell(page, user.companyName)
      }

      await open('transactions')
      await expect(page.getByRole('row').filter({ hasText: 'Оренда офісу' }).first()).toBeVisible()
      await shot('payments')

      await page.getByRole('button', { name: 'Дохід', exact: true }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await shot('transaction-form')
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toBeHidden()

      if (viewport.name === 'mobile') {
        await page.getByRole('button', { name: 'Відкрити рахунки' }).click()
        await expect(page.getByTestId('accounts-drawer')).toBeVisible()
        await shot('accounts-drawer')
        await page.keyboard.press('Escape')
        await expect(page.getByTestId('accounts-drawer')).toBeHidden()
      } else {
        await page.getByRole('button', { name: 'Згорнути сайдбар' }).click()
        await shot('sidebar-collapsed')
        await page.getByRole('button', { name: 'Розгорнути сайдбар' }).click()
      }

      // Recharts animates in JavaScript (not CSS), so the chart pages wait for the animation.
      for (const report of ANALYTICS) {
        await open(`analytics/${report.path}`)
        await expect(page.getByRole('heading', { name: report.heading })).toBeVisible()
        await expect(page.getByRole('navigation', { name: 'Розділи аналітики' })).toBeVisible()
        if (report.charts) await page.waitForTimeout(1500)
        await shot(`analytics-${report.path}`)

        if (report.path === 'cashflow') {
          // The report period filter: the open menu, then the date range picker with a range.
          const pill = page.getByRole('button', { name: /^Період:/ })
          await pill.click()
          await expect(page.getByRole('menuitemradio', { name: 'На поточний рік' })).toBeVisible()
          await shot('analytics-cashflow-period-menu')
          await page.getByRole('menuitemradio', { name: 'Обрати дати' }).click()
          const picker = page.getByRole('dialog', { name: 'Обрати дати' })
          await expect(picker).toBeVisible()
          const today = new Date()
          const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
          await picker.getByRole('button', { name: formatDayLongUtc(first, 'uk'), exact: true }).click()
          await picker.getByRole('button', { name: formatDayLongUtc(today, 'uk'), exact: true }).click()
          await shot('analytics-cashflow-period-picker')
          await page.keyboard.press('Escape')
          await expect(picker).toBeHidden()
        }
      }

      // The way into settings: the profile menu, then the settings screen with its own menu.
      await open('transactions')
      await page.getByRole('button', { name: 'Профіль' }).click()
      await expect(page.getByRole('menuitem', { name: 'Налаштування' })).toBeVisible()
      await shot('profile-menu')
      await page.getByRole('menuitem', { name: 'Налаштування' }).click()
      await page.waitForURL(new RegExp(`/${user.orgId}/settings/company$`))
      await expect(page.getByRole('navigation', { name: 'Розділи налаштувань' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'До платежів' })).toBeVisible()
      await shot('settings-menu')

      for (const section of SETTINGS) {
        await open(`settings/${section}`)
        await expect(page.getByRole('navigation', { name: 'Розділи налаштувань' })).toBeVisible()
        await shot(`settings-${section}`)
      }
    }
  })

  // S03: the same shell in Polish and English, to look for truncated or overflowing labels.
  // The user is registered in Ukrainian (the helpers match Ukrainian labels), then the NEXT_LOCALE cookie
  // switches the UI. Files: <screen>-<desktop|phone>-<pl|en>.png.
  for (const [locale, messages] of [['pl', pl], ['en', en]] as const) {
    test(`key screens in ${locale}`, async ({ page, request, context }) => {
      test.setTimeout(300_000)
      await page.setViewportSize({ width: 1440, height: 900 })
      const user = await registerViaUi(page, `shots${locale}`)
      await waitForShell(page, user.companyName)
      await seedDemoData(request, user.orgId)
      await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: 'http://localhost:3000' }])

      const shot = async (name: string, form: 'desktop' | 'phone') => {
        await assertLightShellUnderDarkRoot(page)
        await page.screenshot({ path: join(OUT_DIR, `${name}-${form}-${locale}.png`), animations: 'disabled' })
      }
      const open = async (path: string) => {
        await page.goto(`/${user.orgId}/${path}`)
        await waitForShell(page, user.companyName)
      }

      await page.setViewportSize({ width: 1440, height: 900 })
      await open('transactions')
      await expect(page.getByRole('row').filter({ hasText: 'Оренда офісу' }).first()).toBeVisible()
      await shot('payments', 'desktop')

      await page.getByRole('button', { name: messages.shell.header.expense, exact: true }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await shot('expense-form', 'desktop')
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toBeHidden()

      await open('settings/company')
      await expect(page.getByRole('navigation', { name: messages.shell.nav.settings })).toBeVisible()
      await shot('settings-company', 'desktop')

      await open('analytics/pl')
      await expect(page.getByRole('navigation', { name: messages.shell.nav.analytics })).toBeVisible()
      await page.waitForTimeout(1500)
      await shot('analytics-pnl', 'desktop')

      await page.setViewportSize({ width: 390, height: 844 })
      await open('transactions')
      await expect(page.getByRole('row').filter({ hasText: 'Оренда офісу' }).first()).toBeVisible()
      await shot('payments', 'phone')

      await page.getByRole('button', { name: messages.shell.header.openAccounts }).click()
      await expect(page.getByTestId('accounts-drawer')).toBeVisible()
      await shot('accounts-drawer', 'phone')
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('accounts-drawer')).toBeHidden()

      await page.getByRole('button', { name: messages.shell.header.income, exact: true }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await shot('income-form', 'phone')
      await page.keyboard.press('Escape')

      await open('analytics/pl')
      await expect(page.getByRole('navigation', { name: messages.shell.nav.analytics })).toBeVisible()
      await page.waitForTimeout(1500)
      await shot('analytics-pnl', 'phone')
    })
  }
})
