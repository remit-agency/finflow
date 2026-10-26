import { test, expect, type Page } from '@playwright/test'
import { registerViaUi, waitForHydration, waitForShell } from './helpers/app-ui'
import { listDocs, seedDoc } from './helpers/emulator-firestore'
import en from '../../messages/en.json'
import pl from '../../messages/pl.json'
import uk from '../../messages/uk.json'

const ORIGIN = 'http://localhost:3000'
const NEEDS_EMULATORS =
  'Needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"'

// The Playwright default locale is uk-UA (playwright.config.ts), so the unchanged Ukrainian
// specs keep matching. Every text below comes from the catalogs, never retyped.

async function openProfileMenu(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).click()
}

async function expectLoginIn(page: Page, messages: typeof pl, lang: string): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('lang', lang)
  // Scoped to the card title: in English the title and the button read the same.
  await expect(page.locator('[data-slot="card-title"]', { hasText: messages.auth.login.title })).toBeVisible()
  await expect(page.getByRole('button', { name: messages.auth.login.submit, exact: true })).toBeVisible()
}

async function localeCookie(page: Page): Promise<string | undefined> {
  return (await page.context().cookies()).find((c) => c.name === 'NEXT_LOCALE')?.value
}

test.describe('first visit negotiates the language', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test.describe('Accept-Language pl-PL', () => {
    test.use({ locale: 'pl-PL' })

    test('/login is Polish', async ({ page }) => {
      await page.goto('/login')
      await expectLoginIn(page, pl, 'pl')
    })
  })

  test.describe('Accept-Language de-DE', () => {
    test.use({ locale: 'de-DE' })

    test('an unsupported language falls back to Polish', async ({ page }) => {
      await page.goto('/login')
      await expectLoginIn(page, pl, 'pl')
    })
  })
})

test.describe('language switching (emulators)', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test('the switcher on /login changes the language, sets the cookie and survives a reload', async ({ page }) => {
    await page.goto('/login')
    await expectLoginIn(page, uk, 'uk')
    await waitForHydration(page, '[data-testid="language-switcher"]')

    await page.getByTestId('language-switcher').selectOption('en')
    await expectLoginIn(page, en, 'en')
    expect(await localeCookie(page)).toBe('en')

    await page.reload()
    await expectLoginIn(page, en, 'en')

    await waitForHydration(page, '[data-testid="language-switcher"]')
    await page.getByTestId('language-switcher').selectOption('uk')
    await expectLoginIn(page, uk, 'uk')
    expect(await localeCookie(page)).toBe('uk')
  })

  test('the profile menu switches the whole shell without changing the route', async ({ page }) => {
    const user = await registerViaUi(page, 'i18n')
    await waitForShell(page, user.companyName)
    const route = page.url()

    await openProfileMenu(page, uk.shell.profile.label)
    await page.getByRole('menuitem', { name: 'Polski', exact: true }).click()

    const header = pl.shell.header
    await expect(page.getByRole('button', { name: header.income, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: header.expense, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: header.transfer, exact: true })).toBeVisible()
    const modules = page.getByRole('navigation', { name: pl.shell.nav.modules })
    await expect(modules.getByRole('link', { name: pl.shell.modules.transactions, exact: true })).toBeVisible()
    await expect(modules.getByRole('link', { name: pl.shell.modules.analytics, exact: true })).toBeVisible()
    await expect(page.getByText(pl.shell.accounts.mine, { exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl')
    expect(page.url()).toBe(route)

    await page.reload()
    await expect(page.getByRole('button', { name: header.income, exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl')

    await openProfileMenu(page, pl.shell.profile.label)
    await page.getByRole('menuitem', { name: 'English', exact: true }).click()
    await expect(page.getByRole('button', { name: en.shell.header.income, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: en.shell.header.expense, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: en.shell.header.transfer, exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    expect(page.url()).toBe(route)
  })

  test('in Polish "1 234,50" is typed, stored as 1234.5 and shown with the Polish decimal comma', async ({ page, request, context }) => {
    const user = await registerViaUi(page, 'i18namount')
    await waitForShell(page, user.companyName)
    const accountName = `Konto ${Date.now()}`
    await seedDoc(request, `organizations/${user.orgId}/accounts`, 'i18n-acc', {
      name: accountName,
      type: 'bank',
      balance: 0,
      currency: 'UAH',
      color: '#00c896',
      orgId: user.orgId,
      createdAt: new Date(),
    })
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'pl', url: ORIGIN }])
    await page.goto(`/${user.orgId}/transactions`)
    await waitForShell(page, user.companyName)

    const form = pl.forms.transaction
    await page.getByRole('button', { name: pl.shell.header.expense, exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(form.titleNew, { exact: true })).toBeVisible()
    const panel = dialog.getByRole('tabpanel')
    await panel.locator('select').first().selectOption({ label: accountName })
    await panel.getByLabel(form.amount, { exact: true }).fill('1 234,50')
    await panel.getByLabel(form.description, { exact: true }).fill('Czynsz za biuro')
    await dialog.getByRole('button', { name: form.add, exact: true }).click()
    await expect(dialog).toBeHidden()

    const row = page.getByRole('row').filter({ hasText: 'Czynsz za biuro' })
    // pl-PL (CLDR) starts grouping at 5 digits, so 1234,50 has no separator; \s? keeps the check valid if that changes.
    await expect(row).toContainText(/1\s?234,50/)

    await expect
      .poll(async () => {
        const docs = await listDocs(request, `organizations/${user.orgId}/transactions`)
        const stored = docs[0]?.fields.amount
        return stored && 'doubleValue' in stored ? stored.doubleValue : stored && 'integerValue' in stored ? Number(stored.integerValue) : null
      })
      .toBe(1234.5)
  })

  test('the language persists across a sign-out / sign-in cycle', async ({ page, context }) => {
    const user = await registerViaUi(page, 'i18ncycle')
    await waitForShell(page, user.companyName)
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'pl', url: ORIGIN }])
    await page.reload()
    await expect(page.getByRole('button', { name: pl.shell.header.income, exact: true })).toBeVisible()

    await openProfileMenu(page, pl.shell.profile.label)
    await page.getByRole('menuitem', { name: pl.shell.profile.signOut, exact: true }).click()
    await page.waitForURL(/\/login$/)
    await expectLoginIn(page, pl, 'pl')

    await waitForHydration(page, '#email')
    await page.getByLabel(pl.auth.login.email, { exact: true }).fill(user.email)
    await page.getByLabel(pl.auth.login.password, { exact: true }).fill(user.password)
    await page.getByRole('button', { name: pl.auth.login.submit, exact: true }).click()
    await page.waitForURL(/\/[A-Za-z0-9]{20}\/transactions$/)
    await expect(page.getByRole('button', { name: pl.shell.header.income, exact: true })).toBeVisible()
    expect(await localeCookie(page)).toBe('pl')
  })
})
