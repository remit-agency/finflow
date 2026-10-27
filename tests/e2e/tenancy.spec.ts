import { test, expect, type Browser, type Page } from '@playwright/test'
import { UI_PASSWORD, registerViaUi, waitForHydration, waitForShell, type RegisteredUser } from './helpers/app-ui'
import { EMULATOR_USER_PASSWORD, createEmulatorUser, signInEmulatorUser } from './helpers/emulator-auth'
import { createDocAs, readDoc, seedDoc, seedMember } from './helpers/emulator-firestore'
import { seedLedgerAccount, seedLedgerOperation } from './helpers/ledger-seed'

const NEEDS_EMULATORS =
  'Needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"'

// «Мої рахунки» is rendered by the accounts sidebar only once the membership has been read and the
// access is granted (the header name alone shows up earlier), so waiting for it makes "absent"
// assertions meaningful. Desktop viewport (the default): the sidebar is visible there.
async function waitForAccess(page: Page): Promise<void> {
  await expect(page.getByRole('complementary', { name: 'Рахунки' }).getByRole('heading', { name: 'Мої рахунки' })).toBeVisible()
}

// One account and one operation in the company, written as admin (like app-shell.spec.ts does).
async function seedJournalRow(request: Parameters<typeof seedDoc>[0], orgId: string): Promise<void> {
  await seedLedgerAccount(request, orgId, 'acc-tenancy', { name: 'Alpha', balance: 300, currency: 'UAH' })
  await seedLedgerOperation(request, orgId, 'tx-tenancy', {
    type: 'income',
    accountId: 'acc-tenancy',
    amount: 120,
    currency: 'UAH',
    description: 'Оплата від Alpha',
  })
}

// A second signed-in user in a separate browser context (own cookies).
async function registerSecondUser(browser: Browser, prefix: string): Promise<{ page: Page; user: RegisteredUser; close: () => Promise<void> }> {
  const context = await browser.newContext()
  const page = await context.newPage()
  const user = await registerViaUi(page, prefix)
  return { page, user, close: () => context.close() }
}

test.describe('tenancy (emulators)', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test('registration creates the company and the owner membership on the server', async ({ page, request }) => {
    const user = await registerViaUi(page, 'tenant')
    const { uid } = await signInEmulatorUser(request, user.email, user.password)

    const member = await readDoc(request, `organizations/${user.orgId}/members/${uid}`)
    expect(member).not.toBeNull()
    expect(member).toMatchObject({ uid: { stringValue: uid }, role: { stringValue: 'owner' }, addedBy: { stringValue: uid } })

    const org = await readDoc(request, `organizations/${user.orgId}`)
    expect(org).not.toHaveProperty('members')
    expect(org).toMatchObject({ ownerId: { stringValue: uid }, plan: { stringValue: 'trial' } })
  })

  test("another company's URL shows «Немає доступу» and a way back to the own company", async ({ page, browser }) => {
    const a = await registerViaUi(page, 'noaccessa')
    const b = await registerSecondUser(browser, 'noaccessb')
    try {
      await page.goto(`/${b.user.orgId}/transactions`)

      await expect(page.getByRole('heading', { name: 'Немає доступу до цієї компанії' })).toBeVisible()
      await expect(page.getByTestId('shell-loading')).toHaveCount(0)

      await page.getByRole('button', { name: 'До моєї компанії' }).click()
      await page.waitForURL(new RegExp(`/${a.orgId}/transactions$`))
      await waitForShell(page, a.companyName)
    } finally {
      await b.close()
    }
  })

  test('a viewer sees a read-only interface and the rules reject their writes', async ({ page, browser, request }) => {
    const owner = await registerViaUi(page, 'viewerown')
    const second = await registerSecondUser(browser, 'viewerusr')
    try {
      const { uid: viewerUid, idToken: viewerToken } = await signInEmulatorUser(request, second.user.email, second.user.password)
      await seedMember(request, owner.orgId, viewerUid, 'viewer', (await signInEmulatorUser(request, owner.email, owner.password)).uid)

      // The owner's shell has seeded the default categories; an operation and an account to look at.
      await waitForShell(page, owner.companyName)
      await seedJournalRow(request, owner.orgId)

      const v = second.page
      await v.goto(`/${owner.orgId}/transactions`)
      await waitForShell(v, owner.companyName)
      await waitForAccess(v)
      await expect(v.getByRole('button', { name: 'Дохід' })).toHaveCount(0)
      await expect(v.getByRole('button', { name: 'Витрата' })).toHaveCount(0)
      await expect(v.getByRole('button', { name: 'Додати рахунок' })).toHaveCount(0)
      await expect(v.getByRole('link', { name: 'Підключити банк' })).toHaveCount(0)

      // A journal row is not editable: no edit button, and a click on the row opens no dialog.
      const row = v.getByRole('row').filter({ hasText: 'Alpha' })
      await expect(row).toBeVisible()
      await expect(v.getByRole('button', { name: /редагувати/ })).toHaveCount(0)
      await row.click()
      await v.waitForTimeout(1_000) // the edit form is lazy-loaded: give it the time it would need to appear
      await expect(v.getByRole('dialog')).toHaveCount(0)

      // Settings: no Banks and no Subscription; a direct URL shows the "insufficient rights" card.
      await v.goto(`/${owner.orgId}/settings/company`)
      const menu = v.getByRole('complementary', { name: 'Налаштування' })
      await expect(menu.getByRole('link', { name: 'Категорії' })).toBeVisible()
      await expect(menu.getByRole('link', { name: 'Банки' })).toHaveCount(0)
      await expect(menu.getByRole('link', { name: 'Підписка' })).toHaveCount(0)
      // Company: the name is read-only and there is nothing to save.
      await expect(v.getByLabel('Назва', { exact: true })).toBeDisabled()
      await expect(v.getByRole('button', { name: 'Зберегти' })).toHaveCount(0)

      // Categories: the list is there, but no add form and no delete buttons.
      await menu.getByRole('link', { name: 'Категорії' }).click()
      await v.waitForURL(/\/settings\/categories$/)
      await expect(v.getByText('Продажі', { exact: true })).toBeVisible()
      await expect(v.getByText('Додати категорію', { exact: true })).toHaveCount(0)
      await expect(v.getByLabel('Назва категорії')).toHaveCount(0)
      await expect(v.getByRole('button', { name: /Видалити категорію/ })).toHaveCount(0)

      await v.goto(`/${owner.orgId}/settings/banks`)
      await expect(v.getByTestId('insufficient-rights')).toBeVisible()

      // The protection is the rules, not the UI: the viewer's own token cannot write.
      // Categories are the browser's to write (owner, accountant); accounts and operations are the server's (S05).
      const category = { orgId: owner.orgId, name: 'x', type: 'expense', color: '#ef4444' }
      expect(await createDocAs(request, viewerToken, `organizations/${owner.orgId}/categories`, 'viewer-write', category)).toBe(403)
      expect(await createDocAs(request, viewerToken, `organizations/${owner.orgId}/accounts`, 'viewer-write', { orgId: owner.orgId, name: 'x' })).toBe(403)
      const ownerToken = (await signInEmulatorUser(request, owner.email, owner.password)).idToken
      expect(await createDocAs(request, ownerToken, `organizations/${owner.orgId}/categories`, 'owner-write', category)).toBe(200)
      expect(await createDocAs(request, ownerToken, `organizations/${owner.orgId}/accounts`, 'owner-write', { orgId: owner.orgId, name: 'x' })).toBe(403)
    } finally {
      await second.close()
    }
  })

  test('an accountant works with data but has no banks and no subscription', async ({ page, browser, request }) => {
    const owner = await registerViaUi(page, 'acctown')
    const second = await registerSecondUser(browser, 'acctusr')
    try {
      const { uid, idToken } = await signInEmulatorUser(request, second.user.email, second.user.password)
      await seedMember(request, owner.orgId, uid, 'accountant', (await signInEmulatorUser(request, owner.email, owner.password)).uid)

      await seedJournalRow(request, owner.orgId)

      const a = second.page
      await a.goto(`/${owner.orgId}/transactions`)
      await waitForShell(a, owner.companyName)
      await waitForAccess(a)
      await expect(a.getByRole('button', { name: 'Дохід' })).toBeVisible()
      await expect(a.getByRole('button', { name: 'Додати рахунок' }).first()).toBeVisible()
      await expect(a.getByRole('link', { name: 'Підключити банк' })).toHaveCount(0)

      // Unlike a viewer, an accountant can open a journal row for editing.
      await a.getByRole('row').filter({ hasText: 'Alpha' }).click()
      await expect(a.getByRole('dialog')).toBeVisible()
      await a.keyboard.press('Escape')
      await expect(a.getByRole('dialog')).toBeHidden()

      await a.goto(`/${owner.orgId}/settings/subscription`)
      await expect(a.getByTestId('insufficient-rights')).toBeVisible()

      expect(await createDocAs(request, idToken, `organizations/${owner.orgId}/categories`, 'acct-write', { orgId: owner.orgId, name: 'x', type: 'expense', color: '#ef4444' })).toBe(200)
      expect(await createDocAs(request, idToken, `organizations/${owner.orgId}/accounts`, 'acct-write', { orgId: owner.orgId, name: 'x' })).toBe(403)
      expect(await createDocAs(request, idToken, `organizations/${owner.orgId}/bankConnections`, 'acct-bank', { orgId: owner.orgId })).toBe(403)
    } finally {
      await second.close()
    }
  })

  test('the fourth owned company is refused by the API with 409', async ({ page }) => {
    await registerViaUi(page, 'limit') // company 1 of 3

    const statuses = await page.evaluate(async () => {
      const out: Array<{ status: number; error?: string }> = []
      for (let i = 2; i <= 4; i++) {
        const res = await fetch('/api/orgs', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `Company ${i}`, currency: 'PLN' }),
        })
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        out.push({ status: res.status, error: body.error })
      }
      return out
    })

    expect(statuses.map((s) => s.status)).toEqual([201, 201, 409])
    expect(statuses[2].error).toBe('org_limit_reached')
  })

  test('a user signed in without a company is sent to a company-only form and ends in the new company', async ({ page, request }) => {
    const { email } = await createEmulatorUser(request) // an account that never got a company
    await page.goto('/login')
    await waitForHydration(page, '#email')
    await page.getByLabel('Електронна пошта', { exact: true }).fill(email)
    await page.getByLabel('Пароль', { exact: true }).fill(EMULATOR_USER_PASSWORD)
    await page.getByRole('button', { name: 'Увійти', exact: true }).click()
    await page.waitForURL(/\/register\?step=org$/)

    // Only the company is asked for: no name, email, password or Google button.
    await expect(page.getByRole('button', { name: 'Створити компанію' })).toBeVisible()
    await expect(page.getByLabel('Ваше ім\'я', { exact: true })).toHaveCount(0)
    await expect(page.getByLabel('Електронна пошта', { exact: true })).toHaveCount(0)
    await expect(page.getByLabel('Пароль', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Зареєструватися через Google' })).toHaveCount(0)

    const companyName = `Late Co ${Date.now()}`
    await page.getByLabel('Назва компанії', { exact: true }).fill(companyName)
    await page.getByRole('button', { name: 'Створити компанію' }).click()
    await page.waitForURL(/\/[A-Za-z0-9]{20}\/transactions$/)
    await waitForShell(page, companyName)
  })

  test('a sign-up whose company creation fails can be finished without signing up again', async ({ page }) => {
    // The first POST /api/orgs fails: the account and the session exist, the company does not.
    let failNext = true
    await page.route('**/api/orgs', async (route) => {
      if (route.request().method() === 'POST' && failNext) {
        failNext = false
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'server' }) })
      } else {
        await route.continue()
      }
    })

    const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    const companyName = `Retry Co ${runId}`
    await page.goto('/register')
    await waitForHydration(page, '#name')
    await page.getByLabel('Ваше ім\'я', { exact: true }).fill('UI Tester')
    await page.getByLabel('Електронна пошта', { exact: true }).fill(`retry-${runId}@finflow.test`)
    await page.getByLabel('Пароль', { exact: true }).fill(UI_PASSWORD)
    await page.getByLabel('Назва компанії', { exact: true }).fill(companyName)
    await page.getByRole('button', { name: 'Спробувати 14 днів безкоштовно' }).click()

    // The page switches to the company-only form, keeping what was typed.
    await expect(page.getByRole('button', { name: 'Створити компанію' })).toBeVisible()
    await expect(page.getByLabel('Ваше ім\'я', { exact: true })).toHaveCount(0)
    await expect(page.getByLabel('Назва компанії', { exact: true })).toHaveValue(companyName)

    await page.getByRole('button', { name: 'Створити компанію' }).click()
    await page.waitForURL(/\/[A-Za-z0-9]{20}\/transactions$/)
    await waitForShell(page, companyName)
  })

  test('the browser cannot create a company or a membership directly (rules)', async ({ page, request }) => {
    const user = await registerViaUi(page, 'direct')
    const { idToken } = await signInEmulatorUser(request, user.email, user.password)
    expect(await createDocAs(request, idToken, 'organizations', 'sneaky-org', { name: 'x', currency: 'PLN', ownerId: 'x', plan: 'trial' })).toBe(403)
    expect(await createDocAs(request, idToken, `organizations/${user.orgId}/members`, 'someone-else', { uid: 'someone-else', role: 'owner' })).toBe(403)
  })
})
