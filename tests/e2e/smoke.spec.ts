import { test, expect, type Page } from '@playwright/test'
import { createEmulatorUser } from './helpers/emulator-auth'

// Month labels exactly as lib/utils/analytics.ts renders them: UA_MONTHS + 2-digit year.
const UA_MONTHS = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру']

const NEEDS_EMULATORS =
  'Smoke needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"'

// React attaches __reactProps$<id> to DOM nodes when it hydrates them. Filling a
// controlled input before that loses the value (the old tests worked around this with
// the /test-login backdoor), so wait for it explicitly.
async function waitForHydration(page: Page, selector: string): Promise<void> {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel)
    return !!el && Object.keys(el).some((k) => k.startsWith('__reactProps$'))
  }, selector)
}

test.describe('smoke on emulators', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test('GET /api/health reads Firestore through firebase-admin', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.status()).toBe(200)
    expect(await res.json()).toEqual({ ok: true, region: 'local', firestore: 'ok' })
  })

  test('Enable Banking session from a verified non-member -> 403 (criterion 4)', async ({ request }) => {
    // A real Auth-emulator user with a verified email who belongs to no organization. The route
    // runs requireVerifiedUser and requireOrgRole (owner only) before createJwt, so it answers 403 without
    // calling Enable Banking.
    const user = await createEmulatorUser(request, { verified: true })
    const mint = await request.post('/api/auth/session', {
      headers: { Origin: 'http://localhost:3000' },
      data: { idToken: user.idToken },
    })
    expect(mint.status()).toBe(204)

    const res = await request.post('/api/enablebanking/session', {
      headers: { Origin: 'http://localhost:3000' },
      data: { aspspName: 'Bank Millennium', aspspCountry: 'PL', orgId: 'victim-org' },
    })
    expect(res.status()).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
  })

  test('register -> company -> account -> income -> Cash Flow shows it', async ({ page }) => {
    const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    const email = `smoke-${runId}@finflow.test`
    const orgName = `Smoke Co ${runId}`
    const accountName = `Smoke Bank ${runId}`
    const amount = '777' // < 1000, so uk-UA formatting adds no group separator

    // 1. Register: one submit creates the Auth user and organizations/{orgId}.
    await page.goto('/register')
    await waitForHydration(page, '#name')
    await page.getByLabel('Ваше ім\'я', { exact: true }).fill('Smoke Tester')
    await page.getByLabel('Електронна пошта', { exact: true }).fill(email)
    await page.getByLabel('Пароль', { exact: true }).fill('smoke-pass-123')
    await page.getByLabel('Назва компанії', { exact: true }).fill(orgName)
    await page.getByRole('button', { name: 'Спробувати 14 днів безкоштовно' }).click()

    // 2. Redirect to /{orgId}/transactions. The header shows the org name only after
    //    useOrg loaded it, which exercises the organizations get/list security rules.
    await page.waitForURL(/\/[A-Za-z0-9]{20}\/transactions$/)
    const orgId = new URL(page.url()).pathname.split('/')[1]
    await expect(page.getByRole('heading', { name: 'Платежі' })).toBeVisible()
    await expect(page.getByTestId('org-switcher-name')).toHaveText(orgName)

    // 3. Add an account from the sidebar (components/forms/AccountForm.tsx).
    await page.getByRole('button', { name: 'Додати рахунок', exact: true }).click()
    const accountDialog = page.getByRole('dialog')
    await expect(accountDialog.getByText('Новий рахунок', { exact: true })).toBeVisible()
    await accountDialog.getByLabel('Назва', { exact: true }).fill(accountName)
    await accountDialog.getByRole('button', { name: 'Створити', exact: true }).click()
    await expect(accountDialog).toBeHidden()
    // Scoped to the accounts sidebar: the account filter <select> also gets an <option> with this name.
    await expect(page.getByRole('complementary', { name: 'Рахунки' }).getByText(accountName, { exact: true })).toBeVisible()

    // 4. Add an income transaction on that account (components/forms/TransactionForm.tsx).
    await page.getByRole('button', { name: 'Дохід', exact: true }).click()
    const txDialog = page.getByRole('dialog')
    await expect(txDialog.getByText('Нова транзакція', { exact: true })).toBeVisible()
    const incomePanel = txDialog.getByRole('tabpanel')
    // The "Рахунок" <select> has no label association; it is the first native select in the panel.
    await incomePanel.locator('select').first().selectOption({ label: accountName })
    await incomePanel.getByLabel('Сума', { exact: true }).fill(amount)
    await txDialog.getByRole('button', { name: 'Додати', exact: true }).click()
    await expect(txDialog).toBeHidden()

    // 5. Cash Flow (module tab «Аналітика» -> /{orgId}/analytics/cashflow) shows the income
    //    in the current month row and in the "Доходи" summary card.
    await page.getByRole('navigation', { name: 'Модулі' }).getByRole('link', { name: 'Аналітика' }).click()
    await page.waitForURL(`**/${orgId}/analytics/cashflow`)
    await expect(page.getByRole('heading', { name: 'Cash Flow' })).toBeVisible()
    const now = new Date()
    const monthLabel = `${UA_MONTHS[now.getUTCMonth()]} ${String(now.getUTCFullYear()).slice(2)}`
    const monthRow = page.getByRole('row').filter({ hasText: monthLabel })
    await expect(monthRow.getByRole('cell').nth(1)).toHaveText(`+${amount}`)
    await expect(page.getByText('Доходи', { exact: true }).locator('..')).toContainText(amount)
  })
})
