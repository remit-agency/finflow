import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { registerViaUi, waitForShell } from './helpers/app-ui'
import { signInEmulatorUser } from './helpers/emulator-auth'
import { seedDoc, seedMember } from './helpers/emulator-firestore'
import { seedLedgerAccount, seedLedgerOperation } from './helpers/ledger-seed'
import { formatDayLongUtc } from '../../lib/utils/calendar-grid'
import { formatPeriodLabel } from '../../lib/utils/period'

const NEEDS_EMULATORS =
  'Needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"'

const DAY_MS = 24 * 60 * 60 * 1000

function accountsSidebar(page: Page) {
  return page.getByRole('complementary', { name: 'Рахунки' })
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Schema 2 seeds (tests/e2e/helpers/ledger-seed.ts): the browser cannot write accounts or operations.
const seedAccount = seedLedgerAccount

async function seedIncome(
  request: APIRequestContext,
  orgId: string,
  id: string,
  accountId: string,
  amount: number,
  description: string,
): Promise<void> {
  await seedLedgerOperation(request, orgId, id, { type: 'income', accountId, amount, currency: 'UAH', description })
}

/** Two UAH accounts with one income each, plus a EUR account (left out of the company total). */
async function seedJournal(request: APIRequestContext, orgId: string): Promise<void> {
  await seedAccount(request, orgId, 'acc-alpha', { name: 'Alpha', balance: 300, currency: 'UAH' })
  await seedAccount(request, orgId, 'acc-beta', { name: 'Beta', balance: 450.5, currency: 'UAH', color: '#6366f1' })
  await seedAccount(request, orgId, 'acc-euro', { name: 'Euro', balance: 200, currency: 'EUR', color: '#f59e0b' })
  await seedIncome(request, orgId, 'tx-alpha', 'acc-alpha', 120, 'Оплата від Alpha')
  await seedIncome(request, orgId, 'tx-beta', 'acc-beta', 80, 'Оплата від Beta')
}

/** The select button of an account row in the sidebar (the row also holds the «Дії з рахунком» menu). */
function accountButton(scope: Locator, name: string) {
  return scope.getByRole('listitem').filter({ hasText: name }).getByRole('button').first()
}

test.describe('app shell (emulators)', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test('module tabs follow the path; Tab and Enter navigate between them', async ({ page }) => {
    const user = await registerViaUi(page, 'tabs')
    await waitForShell(page, user.companyName)
    const tabs = page.getByRole('navigation', { name: 'Модулі' })
    const payments = tabs.getByRole('link', { name: 'Платежі' })
    const analytics = tabs.getByRole('link', { name: 'Аналітика' })

    await expect(payments).toHaveAttribute('aria-current', 'page')
    await expect(analytics).not.toHaveAttribute('aria-current', 'page')

    // Keyboard: focus «Платежі», Tab to «Аналітика», Enter follows the link.
    await payments.focus()
    await page.keyboard.press('Tab')
    await expect(analytics).toBeFocused()
    await page.keyboard.press('Enter')
    await page.waitForURL(new RegExp(`/${user.orgId}/analytics/cashflow$`))
    await expect(analytics).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { name: 'Cash Flow' })).toBeVisible()

    // Analytics sub-pages keep the tab active.
    await page.goto(`/${user.orgId}/analytics/pl`)
    await waitForShell(page, user.companyName)
    await expect(analytics).toHaveAttribute('aria-current', 'page')

    await payments.click()
    await page.waitForURL(new RegExp(`/${user.orgId}/transactions$`))
    await expect(payments).toHaveAttribute('aria-current', 'page')

    // Settings is not a module but a separate screen: the module tabs are not shown there.
    await page.goto(`/${user.orgId}/settings/company`)
    await waitForShell(page, user.companyName)
    await expect(page.getByRole('navigation', { name: 'Розділи налаштувань' })).toBeVisible()
    await expect(tabs).toHaveCount(0)
  })

  test('the sidebar collapses and stays collapsed after a reload', async ({ page }) => {
    const user = await registerViaUi(page, 'collapse')
    await waitForShell(page, user.companyName)
    const sidebar = page.getByTestId('accounts-sidebar')

    await expect(sidebar).toHaveAttribute('data-collapsed', 'false')
    await page.getByRole('button', { name: 'Згорнути сайдбар' }).click()
    await expect(sidebar).toHaveAttribute('data-collapsed', 'true')

    await page.reload()
    await waitForShell(page, user.companyName)
    await expect(sidebar).toHaveAttribute('data-collapsed', 'true')

    await page.getByRole('button', { name: 'Розгорнути сайдбар' }).click()
    await expect(sidebar).toHaveAttribute('data-collapsed', 'false')
    await page.reload()
    await waitForShell(page, user.companyName)
    await expect(sidebar).toHaveAttribute('data-collapsed', 'false')
  })

  test('choosing an account in the sidebar filters the journal; the total counts only the company currency', async ({ page, request }) => {
    const user = await registerViaUi(page, 'filter')
    await waitForShell(page, user.companyName)
    await seedJournal(request, user.orgId)

    const sidebar = accountsSidebar(page)
    await expect(sidebar.getByRole('listitem').filter({ hasText: 'Euro' })).toBeVisible()

    // Registration uses UAH. Total = 300 + 450.50; the EUR account is neither added nor mentioned.
    await expect(sidebar.getByText('Разом у UAH', { exact: true })).toBeVisible()
    await expect(page.getByTestId('accounts-total')).toContainText('750,50')
    await expect(page.getByTestId('accounts-summary')).not.toContainText('EUR')

    const rowAlpha = page.getByRole('row').filter({ hasText: 'Оплата від Alpha' })
    const rowBeta = page.getByRole('row').filter({ hasText: 'Оплата від Beta' })
    await expect(rowAlpha).toBeVisible()
    await expect(rowBeta).toBeVisible()

    await accountButton(sidebar, 'Alpha').click()
    await expect(rowAlpha).toBeVisible()
    await expect(rowBeta).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Показати всі рахунки' })).toBeVisible()

    await sidebar.getByRole('button', { name: /^Усі рахунки/ }).click()
    await expect(rowAlpha).toBeVisible()
    await expect(rowBeta).toBeVisible()
  })

  test('the toolbar account select and the sidebar selection are one state', async ({ page, request }) => {
    const user = await registerViaUi(page, 'sync')
    await waitForShell(page, user.companyName)
    await seedJournal(request, user.orgId)

    const sidebar = accountsSidebar(page)
    const select = page.getByRole('combobox', { name: 'Рахунок', exact: true })
    const allAccounts = sidebar.getByRole('button', { name: /^Усі рахунки/ })
    const rowAlpha = page.getByRole('row').filter({ hasText: 'Оплата від Alpha' })
    const rowBeta = page.getByRole('row').filter({ hasText: 'Оплата від Beta' })
    await expect(rowAlpha).toBeVisible()
    await expect(rowBeta).toBeVisible()

    // Sidebar -> select.
    await accountButton(sidebar, 'Alpha').click()
    await expect(select).toHaveValue('acc-alpha')
    await expect(rowBeta).toHaveCount(0)

    // Select -> sidebar.
    await select.selectOption({ label: 'Beta' })
    await expect(accountButton(sidebar, 'Beta')).toHaveAttribute('aria-pressed', 'true')
    await expect(accountButton(sidebar, 'Alpha')).toHaveAttribute('aria-pressed', 'false')
    await expect(rowBeta).toBeVisible()
    await expect(rowAlpha).toHaveCount(0)

    // «Очистити» clears the sidebar selection too.
    await page.getByRole('button', { name: 'Очистити', exact: true }).click()
    await expect(allAccounts).toHaveAttribute('aria-pressed', 'true')
    await expect(accountButton(sidebar, 'Beta')).toHaveAttribute('aria-pressed', 'false')
    await expect(select).toHaveValue('_all')
    await expect(rowAlpha).toBeVisible()
    await expect(rowBeta).toBeVisible()

    // Choosing an account from another module leads to the journal, filtered by it.
    await page.getByRole('navigation', { name: 'Модулі' }).getByRole('link', { name: 'Аналітика' }).click()
    await page.waitForURL(new RegExp(`/${user.orgId}/analytics/cashflow$`))
    await accountButton(sidebar, 'Beta').click()
    await page.waitForURL(new RegExp(`/${user.orgId}/transactions$`))
    await expect(rowBeta).toBeVisible()
    await expect(rowAlpha).toHaveCount(0)
    await expect(select).toHaveValue('acc-beta')
    await expect(page.getByRole('button', { name: 'Показати всі рахунки' })).toBeVisible()
  })

  test('Enter on the button of a journal row opens its edit form; the row itself is not a Tab stop', async ({ page, request }) => {
    const user = await registerViaUi(page, 'rowenter')
    await waitForShell(page, user.companyName)
    await seedJournal(request, user.orgId)

    const rowAlpha = page.getByRole('row').filter({ hasText: 'Оплата від Alpha' })
    await expect(rowAlpha).toBeVisible()
    await expect(rowAlpha).not.toHaveAttribute('tabindex')
    // One real button per row, named by the visible account plus the amount and the date.
    const editButton = rowAlpha.getByRole('button', { name: /^Alpha: \+120,00.*, редагувати$/ })
    await expect(editButton).toHaveCount(1)
    await editButton.focus()
    await page.keyboard.press('Enter')

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Редагувати транзакцію', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('tab', { name: 'Дохід' })).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.getByRole('tabpanel').getByLabel('Сума', { exact: true })).toHaveValue('120')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('header buttons open the operation form on payments, analytics and settings pages', async ({ page }) => {
    const user = await registerViaUi(page, 'header')
    await waitForShell(page, user.companyName)

    const cases = [
      { path: 'transactions', button: 'Дохід' },
      { path: 'analytics/cashflow', button: 'Витрата' },
      { path: 'settings/company', button: 'Переказ' },
    ]
    for (const { path, button } of cases) {
      await page.goto(`/${user.orgId}/${path}`)
      await waitForShell(page, user.companyName)
      await page.getByRole('button', { name: button, exact: true }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByText('Нова транзакція', { exact: true })).toBeVisible()
      await expect(dialog.getByRole('tab', { name: button })).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    }
  })

  test('settings: a separate screen whose left column is the menu of four sections; the old URL redirects to Company with its query', async ({ page }) => {
    const user = await registerViaUi(page, 'settings')
    await waitForShell(page, user.companyName)
    const modules = page.getByRole('navigation', { name: 'Модулі' })
    await expect(accountsSidebar(page)).toBeVisible()
    await expect(modules).toBeVisible()

    await page.goto(`/${user.orgId}/settings?from=e2e`)
    await page.waitForURL(new RegExp(`/${user.orgId}/settings/company\\?from=e2e$`))

    // The settings menu replaces the accounts sidebar, and the module tabs are gone.
    const settingsColumn = page.getByRole('complementary', { name: 'Налаштування' })
    const menu = settingsColumn.getByRole('navigation', { name: 'Розділи налаштувань' })
    await expect(menu.getByRole('link')).toHaveText(['Компанія', 'Категорії', 'Банки', 'Підписка'])
    await expect(page.getByRole('navigation', { name: 'Розділи налаштувань' })).toHaveCount(1)
    await expect(accountsSidebar(page)).toHaveCount(0)
    await expect(modules).toHaveCount(0)
    // The header (company switcher, operation buttons, profile) stays.
    await expect(page.getByRole('button', { name: 'Дохід', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Профіль' })).toBeVisible()

    const sections = [
      { link: 'Компанія', path: 'company', marker: page.getByLabel('Назва', { exact: true }) },
      { link: 'Категорії', path: 'categories', marker: page.getByText('Додати категорію', { exact: true }) },
      { link: 'Банки', path: 'banks', marker: page.getByRole('button', { name: 'Підключити банк' }) },
      { link: 'Підписка', path: 'subscription', marker: page.getByText(/trial plan/i) },
    ]
    for (const { link, path, marker } of sections) {
      await menu.getByRole('link', { name: link }).click()
      await page.waitForURL(new RegExp(`/${user.orgId}/settings/${path}$`))
      await expect(menu.getByRole('link', { name: link })).toHaveAttribute('aria-current', 'page')
      await expect(marker).toBeVisible()
    }

    // «До платежів» leads back to the journal, where the accounts sidebar and the tabs return.
    await settingsColumn.getByRole('link', { name: 'До платежів' }).click()
    await page.waitForURL(new RegExp(`/${user.orgId}/transactions$`))
    await expect(accountsSidebar(page)).toBeVisible()
    await expect(modules.getByRole('link', { name: 'Платежі' })).toHaveAttribute('aria-current', 'page')
    await expect(settingsColumn).toHaveCount(0)

    // Phone: no left column; the sections are a pill row with the same name, plus the way back.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/${user.orgId}/settings/banks`)
    await waitForShell(page, user.companyName)
    const phoneMenu = page.getByRole('navigation', { name: 'Розділи налаштувань' })
    await expect(phoneMenu.getByRole('link', { name: 'Банки' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('complementary', { name: 'Налаштування' })).toBeHidden()
    await expect(modules).toHaveCount(0)
    await page.getByRole('link', { name: 'До платежів' }).click()
    await page.waitForURL(new RegExp(`/${user.orgId}/transactions$`))
    await expect(modules).toBeVisible()
  })

  test('the company switcher lists both organizations and switches between them without flicker', async ({ page, request }) => {
    const user = await registerViaUi(page, 'switch')
    await waitForShell(page, user.companyName)
    const { uid } = await signInEmulatorUser(request, user.email, user.password)

    // A second company owned by the same user (there is no UI to create one before S16).
    const orgBId = `e2eorgb${Date.now()}`
    const orgBName = `Second Co ${Date.now()}`
    await seedDoc(request, 'organizations', orgBId, {
      name: orgBName,
      currency: 'EUR',
      ownerId: uid,
      plan: 'trial',
      trialEndsAt: new Date(Date.now() + 14 * DAY_MS),
      createdAt: new Date(),
    })
    await seedMember(request, orgBId, uid, 'owner')

    // Record every company name the header shows ('' while it shows the loading placeholder), so
    // a switch that bounces back to the previous company (the flicker chooseOrg prevents) is caught.
    // Client-side navigation keeps the window, so the observer survives the switch.
    await page.evaluate(() => {
      const w = window as unknown as { __orgNames: string[] }
      w.__orgNames = []
      const record = () => {
        const name = document.querySelector('[data-testid="org-switcher-name"]')?.textContent ?? ''
        if (w.__orgNames[w.__orgNames.length - 1] !== name) w.__orgNames.push(name)
      }
      record()
      new MutationObserver(record).observe(document.body, { subtree: true, childList: true, characterData: true })
    })
    const shownNames = () => page.evaluate(() => (window as unknown as { __orgNames: string[] }).__orgNames)
    const switcherName = page.getByTestId('org-switcher-name')

    // The flicker needs company B's document to load before the route reaches /<B>/…, which a
    // fast local route usually prevents. Force that order: hold B's journal request until
    // switchOrg has loaded B (it then stores B as the last org). A condition, not a delay.
    let heldUntilLoaded = false
    await page.route(
      (url) => url.pathname === `/${orgBId}/transactions`,
      async (route) => {
        await expect
          .poll(() => page.evaluate((key) => localStorage.getItem(key), `lastOrgId_${uid}`))
          .toBe(orgBId)
        heldUntilLoaded = true
        await route.continue()
      },
    )

    await page.getByTestId('org-switcher').click()
    await expect(page.getByRole('menuitem', { name: new RegExp(escapeRegExp(user.companyName)) })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: new RegExp(escapeRegExp(orgBName)) })).toBeVisible()
    await page.getByRole('menuitem', { name: new RegExp(escapeRegExp(orgBName)) }).click()
    await page.waitForURL(new RegExp(`/${orgBId}/transactions$`))
    await expect(switcherName).toHaveText(orgBName)
    await expect(accountsSidebar(page).getByText('Разом у EUR', { exact: true })).toBeVisible()
    await expect(accountsSidebar(page).getByText('Рахунків ще немає', { exact: true })).toBeVisible()
    // Apart from the placeholder in between, the header shows the old company, then the new one,
    // once each: no bounce back to the old company before or after the new one appears.
    const named = (names: string[]) => names.filter((name) => name !== '')
    expect(named(await shownNames())).toEqual([user.companyName, orgBName])
    expect(heldUntilLoaded).toBe(true)
    await page.unrouteAll()

    await page.getByTestId('org-switcher').click()
    await page.getByRole('menuitem', { name: new RegExp(escapeRegExp(user.companyName)) }).click()
    await page.waitForURL(new RegExp(`/${user.orgId}/transactions$`))
    await expect(switcherName).toHaveText(user.companyName)
    await expect(accountsSidebar(page).getByText('Разом у UAH', { exact: true })).toBeVisible()
    expect(named(await shownNames())).toEqual([user.companyName, orgBName, user.companyName])
  })

  test('the account row menu edits and deletes an account', async ({ page, request }) => {
    const user = await registerViaUi(page, 'rowmenu')
    await waitForShell(page, user.companyName)
    await seedAccount(request, user.orgId, 'acc-edit', { name: 'Old name', balance: 100, currency: 'UAH' })
    const sidebar = accountsSidebar(page)
    await expect(sidebar.getByText('Old name', { exact: true })).toBeVisible()

    await sidebar.getByRole('button', { name: 'Дії з рахунком Old name' }).click()
    await page.getByRole('menuitem', { name: 'Редагувати' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Редагувати рахунок', { exact: true })).toBeVisible()
    await dialog.getByLabel('Назва', { exact: true }).fill('New name')
    await dialog.getByRole('button', { name: 'Зберегти', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(sidebar.getByText('New name', { exact: true })).toBeVisible()

    page.once('dialog', (confirmDialog) => void confirmDialog.accept())
    await sidebar.getByRole('button', { name: 'Дії з рахунком New name' }).click()
    await page.getByRole('menuitem', { name: 'Видалити' }).click()
    await expect(sidebar.getByText('New name', { exact: true })).toHaveCount(0)
  })

  test('on a 390 px phone the accounts open in a drawer: focus inside, Esc and Back close it, a choice closes it', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const user = await registerViaUi(page, 'drawer')
    await waitForShell(page, user.companyName)
    await seedAccount(request, user.orgId, 'acc-phone', { name: 'Phone account', balance: 50, currency: 'UAH' })

    await expect(accountsSidebar(page)).toBeHidden()
    // Header buttons are icon-only here but keep their names.
    await expect(page.getByRole('button', { name: 'Дохід', exact: true })).toBeVisible()

    const openButton = page.getByRole('button', { name: 'Відкрити рахунки' })
    const drawer = page.getByTestId('accounts-drawer')
    const analyticsTab = page.getByRole('navigation', { name: 'Модулі' }).getByRole('link', { name: 'Аналітика' })
    await expect(openButton).toHaveAttribute('aria-expanded', 'false')

    // Keyboard: Enter opens, focus moves inside, Esc closes and gives focus back to ☰.
    await openButton.focus()
    await page.keyboard.press('Enter')
    await expect(drawer.getByRole('button', { name: /^Усі рахунки/ })).toBeVisible()
    // The modal drawer hides the rest of the page from the accessibility tree, so the role
    // locator cannot reach ☰ while it is open; read the attribute through a CSS locator.
    await expect(page.locator('button[aria-label="Відкрити рахунки"]')).toHaveAttribute('aria-expanded', 'true')
    await expect
      .poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-testid="accounts-drawer"]')))
      .toBe(true)

    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    await expect(openButton).toBeFocused()
    await expect(openButton).toHaveAttribute('aria-expanded', 'false')

    // The visible close button (top right) closes it too and also gives focus back to ☰.
    await openButton.click()
    await expect(drawer).toBeVisible()
    await drawer.getByRole('button', { name: 'Закрити', exact: true }).click()
    await expect(drawer).toBeHidden()
    await expect(openButton).toBeFocused()

    // Browser Back (a route change) closes an open drawer.
    await analyticsTab.click()
    await page.waitForURL(new RegExp(`/${user.orgId}/analytics/cashflow$`))
    await openButton.click()
    await expect(drawer).toBeVisible()
    await page.goBack()
    await page.waitForURL(new RegExp(`/${user.orgId}/transactions$`))
    await expect(drawer).toBeHidden()

    // Choosing an account closes the drawer; from Analytics it leads to the filtered journal.
    await analyticsTab.click()
    await page.waitForURL(new RegExp(`/${user.orgId}/analytics/cashflow$`))
    await openButton.click()
    await accountButton(drawer, 'Phone account').click()
    await expect(drawer).toBeHidden()
    await page.waitForURL(new RegExp(`/${user.orgId}/transactions$`))
    await expect(page.getByRole('button', { name: 'Показати всі рахунки' })).toBeVisible()
  })

  test('a dark <html> does not darken the shell or its dialogs', async ({ page }) => {
    const user = await registerViaUi(page, 'dark')
    await waitForShell(page, user.companyName)

    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/)
    const shellBackground = await page.locator('.app-shell').evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(shellBackground).toBe('rgb(244, 246, 245)')

    await page.getByRole('button', { name: 'Дохід', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const dialogColors = await dialog.evaluate((el) => {
      const style = getComputedStyle(el)
      return { background: style.backgroundColor, color: style.color }
    })
    expect(dialogColors).toEqual({ background: 'rgb(255, 255, 255)', color: 'rgb(23, 32, 29)' })
  })

  // Production report: the open profile menu was hidden behind the sticky module tabs (z-10) down to
  // their bottom edge, i.e. painted as if the popup had no z-index of its own. The shell is now an
  // isolated stacking context, so portalled layers stay above it even then (simulated below).
  test('at 1920x920 under a dark <html> the profile menu and the company switcher are readable and on top', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 920 })
    const user = await registerViaUi(page, 'menus')
    await waitForShell(page, user.companyName)
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/)

    const menus = [
      { name: 'profile', trigger: page.getByRole('button', { name: 'Профіль' }), overTabs: true },
      { name: 'company switcher', trigger: page.getByTestId('org-switcher'), overTabs: false },
    ]
    for (const menu of menus) {
      await menu.trigger.click()
      const popup = page.locator('[data-slot="dropdown-menu-content"]')
      await expect(popup).toBeVisible()
      // Fully faded in: visibility never depends on an animation that is still running.
      await expect.poll(() => popup.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
      expect(await popup.evaluate((el) => getComputedStyle(el).colorScheme), `${menu.name}: color-scheme`).toBe('light')

      const before = await popup.evaluate(inspectMenuItems)
      expect(before.length, `${menu.name}: items`).toBeGreaterThanOrEqual(2)
      for (const item of before) {
        expect(item.contrast, `${menu.name}: «${item.text}» contrast`).toBeGreaterThanOrEqual(4.5)
        expect(item.topmost, `${menu.name}: «${item.text}» is covered by ${item.covering}`).toBe(true)
      }
      // The profile menu really overlaps the sticky tabs, so the next check is meaningful there.
      if (menu.overTabs) expect(before.some((item) => item.overTabs), `${menu.name} overlaps the tabs`).toBe(true)

      // The production picture: the popup's own z-index lost. It must still paint above the shell.
      await popup.evaluate((el) => {
        ;(el.parentElement as HTMLElement).style.zIndex = 'auto'
      })
      for (const item of await popup.evaluate(inspectMenuItems)) {
        expect(item.topmost, `${menu.name} without z-index: «${item.text}» is covered by ${item.covering}`).toBe(true)
      }
      await page.keyboard.press('Escape')
      await expect(popup).toHaveCount(0)
    }
  })
})

/**
 * Runs in the page on an open dropdown menu popup: for each item and group label, the WCAG contrast of
 * its text colour against the first opaque background behind it, whether the element at its centre
 * is the item itself (nothing covers it) and whether that centre lies over the sticky module tabs.
 */
function inspectMenuItems(popup: Element) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  // Any CSS colour syntax (rgb, lab, oklch…) to sRGB through the canvas.
  const rgba = (color: string) => {
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#000'
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 1, 1)
    return Array.from(ctx.getImageData(0, 0, 1, 1).data)
  }
  const luminance = ([r, g, b]: number[]) => {
    const lin = (c: number) => {
      const s = c / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  }
  const background = (el: Element | null): number[] => {
    for (let node = el; node; node = node.parentElement) {
      const color = rgba(getComputedStyle(node).backgroundColor)
      if (color[3] === 255) return color
    }
    return [255, 255, 255, 255]
  }
  const tabs = document.querySelector('nav[aria-label="Модулі"]')?.getBoundingClientRect()
  return [...popup.querySelectorAll('[role="menuitem"], [data-slot="dropdown-menu-label"]')].map((el) => {
    const rect = el.getBoundingClientRect()
    const x = rect.x + rect.width / 2
    const y = rect.y + rect.height / 2
    const top = document.elementFromPoint(x, y)
    const [l1, l2] = [luminance(rgba(getComputedStyle(el).color)), luminance(background(el))].sort((a, b) => b - a)
    return {
      text: (el.textContent ?? '').trim(),
      contrast: Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100,
      topmost: !!top && (top === el || el.contains(top)),
      covering: top ? `${top.tagName.toLowerCase()}.${top.getAttribute('class') ?? ''}`.slice(0, 80) : 'nothing',
      overTabs: !!tabs && x >= tabs.left && x <= tabs.right && y >= tabs.top && y <= tabs.bottom,
    }
  })
}

/**
 * Report data relative to the real current date (the app reads the browser clock), in UTC like
 * the reports: 300 today, 500 in the middle of last year, 70 on the 10th of the previous month
 * (last year when this runs in January). Amounts stay below 1000 (no group separator) and their
 * sums are unique, so a total identifies its period.
 */
async function seedReportData(request: APIRequestContext, orgId: string) {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const prevMonthDay = (day: number) => new Date(Date.UTC(y, m - 1, day, 12))
  const txs = [
    { id: 'rep-today', amount: 300, date: now },
    { id: 'rep-last-year', amount: 500, date: new Date(Date.UTC(y - 1, 5, 15, 12)) },
    { id: 'rep-prev-month', amount: 70, date: prevMonthDay(10) },
  ]
  await seedAccount(request, orgId, 'acc-rep', { name: 'Reports', balance: 0, currency: 'UAH' })
  for (const t of txs) {
    await seedLedgerOperation(request, orgId, t.id, {
      type: 'income',
      accountId: 'acc-rep',
      amount: t.amount,
      currency: 'UAH',
      date: t.date,
      description: `Report ${t.id}`,
    })
  }
  const prevMonthInThisYear = prevMonthDay(10).getUTCFullYear() === y
  return {
    currentYear: String(300 + (prevMonthInThisYear ? 70 : 0)),
    prevYear: String(500 + (prevMonthInThisYear ? 0 : 70)),
    /** The 9th-11th of the previous month: only the 70. */
    custom: { start: prevMonthDay(9), end: prevMonthDay(11), total: '70' },
  }
}

const REPORT_MENU = [
  'На поточний рік',
  'За попередній рік',
  'За поточний тиждень',
  'За останній тиждень',
  'За поточний місяць',
  'За останній місяць',
  'Обрати дати',
]

function periodPill(page: Page) {
  return page.getByRole('button', { name: /^Період:/ })
}

test.describe('report period filter', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test('Cash Flow: the current year by default; «За попередній рік» changes the label, the numbers and the CSV name', async ({ page, request }) => {
    const user = await registerViaUi(page, 'period')
    await waitForShell(page, user.companyName)
    const expected = await seedReportData(request, user.orgId)
    await page.goto(`/${user.orgId}/analytics/cashflow`)
    await waitForShell(page, user.companyName)

    // The old month pills are gone; the toolbar has the period pill and the CSV icon button.
    await expect(page.getByRole('button', { name: '12М' })).toHaveCount(0)
    const pill = periodPill(page)
    await expect(pill).toContainText('На поточний рік')
    await expect(pill).toHaveAttribute('aria-haspopup', 'menu')
    await expect(pill).toHaveAttribute('aria-expanded', 'false')
    const income = page.getByTestId('cashflow-total-income')
    await expect(income).toHaveText(expected.currentYear)

    await pill.click()
    const menu = page.getByRole('menu')
    await expect(menu.getByText('ЗА ДАТОЮ ОПЕРАЦІЇ', { exact: true })).toBeVisible()
    await expect(pill).toHaveAttribute('aria-expanded', 'true')
    const items = menu.getByRole('menuitemradio')
    await expect(items).toHaveText(REPORT_MENU)
    await expect(items.filter({ hasText: 'На поточний рік' })).toHaveAttribute('aria-checked', 'true')
    await expect(items.filter({ hasText: 'За попередній рік' })).toHaveAttribute('aria-checked', 'false')

    await items.filter({ hasText: 'За попередній рік' }).click()
    await expect(menu).toBeHidden()
    await expect(pill).toContainText('За попередній рік')
    await expect(income).toHaveText(expected.prevYear)

    // The CSV file name carries the period.
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Експорт CSV', exact: true }).click()
    expect((await download).suggestedFilename()).toBe('cashflow-prev-year.csv')

    // The selection is checked when the menu opens again; Esc closes it and focus returns to the pill.
    await pill.click()
    await expect(menu.getByRole('menuitemradio', { name: 'За попередній рік' })).toHaveAttribute('aria-checked', 'true')
    await expect(menu.getByRole('menuitemradio', { name: 'На поточний рік' })).toHaveAttribute('aria-checked', 'false')
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(pill).toBeFocused()
    await expect(pill).toContainText('За попередній рік')
  })

  test('keyboard: Enter opens the menu, ArrowDown moves, Enter selects; Esc closes', async ({ page, request }) => {
    const user = await registerViaUi(page, 'periodkb')
    await waitForShell(page, user.companyName)
    const expected = await seedReportData(request, user.orgId)
    await page.goto(`/${user.orgId}/analytics/cashflow`)
    await waitForShell(page, user.companyName)
    const pill = periodPill(page)
    const income = page.getByTestId('cashflow-total-income')
    await expect(income).toHaveText(expected.currentYear)

    await pill.focus()
    await page.keyboard.press('Enter')
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitemradio', { name: 'На поточний рік' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(menu.getByRole('menuitemradio', { name: 'За попередній рік' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(menu).toBeHidden()
    await expect(pill).toContainText('За попередній рік')
    await expect(income).toHaveText(expected.prevYear)
    await expect(pill).toBeFocused()

    await page.keyboard.press('Enter')
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(pill).toBeFocused()
  })

  test('«Обрати дати»: a range picked in the calendar becomes the period; Cancel and Esc keep the old one', async ({ page, request }) => {
    const user = await registerViaUi(page, 'periodcal')
    await waitForShell(page, user.companyName)
    const expected = await seedReportData(request, user.orgId)
    await page.goto(`/${user.orgId}/analytics/cashflow`)
    await waitForShell(page, user.companyName)
    const pill = periodPill(page)
    const income = page.getByTestId('cashflow-total-income')
    await expect(income).toHaveText(expected.currentYear)

    // Cancel keeps the period.
    await pill.click()
    await page.getByRole('menuitemradio', { name: 'Обрати дати' }).click()
    const picker = page.getByRole('dialog', { name: 'Обрати дати' })
    await expect(picker).toBeVisible()
    await expect(picker.getByRole('grid')).toBeVisible()
    await expect(picker.getByRole('columnheader')).toHaveText(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'])
    // Focus starts on a day of the grid (today).
    await expect
      .poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="grid"]')))
      .toBe(true)
    await picker.getByRole('button', { name: 'Скасувати', exact: true }).click()
    await expect(picker).toBeHidden()
    await expect(pill).toContainText('На поточний рік')
    await expect(pill).toBeFocused()

    // Pick the 9th-11th of the previous month.
    await pill.click()
    await page.getByRole('menuitemradio', { name: 'Обрати дати' }).click()
    await expect(picker).toBeVisible()
    const apply = picker.getByRole('button', { name: 'Застосувати', exact: true })
    await expect(apply).toBeDisabled()
    await picker.getByRole('button', { name: 'Попередній місяць' }).click()
    await picker.getByRole('button', { name: formatDayLongUtc(expected.custom.start, 'uk'), exact: true }).click()
    await expect(picker).toContainText('Оберіть другу дату')
    await picker.getByRole('button', { name: formatDayLongUtc(expected.custom.end, 'uk'), exact: true }).click()
    const rangeLabel = formatPeriodLabel({ preset: 'custom', start: expected.custom.start, end: expected.custom.end }, 'uk')
    await expect(picker).toContainText(rangeLabel)
    await apply.click()
    await expect(picker).toBeHidden()
    await expect(pill).toContainText(rangeLabel)
    await expect(pill).toBeFocused()
    await expect(income).toHaveText(expected.custom.total)
    // Three days: the table is by day.
    await expect(page.getByRole('heading', { name: 'Деталізація по днях' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'День' })).toBeVisible()

    // The custom entry is checked; Esc in the reopened picker keeps the range.
    await pill.click()
    await expect(page.getByRole('menuitemradio', { name: 'Обрати дати' })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('menuitemradio', { name: 'Обрати дати' }).click()
    await expect(picker).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
    await expect(pill).toContainText(rangeLabel)
    await expect(income).toHaveText(expected.custom.total)
  })

  test('P&L has the same toolbar and period behaviour', async ({ page, request }) => {
    const user = await registerViaUi(page, 'periodpl')
    await waitForShell(page, user.companyName)
    const expected = await seedReportData(request, user.orgId)
    await page.goto(`/${user.orgId}/analytics/pl`)
    await waitForShell(page, user.companyName)

    await expect(page.getByRole('button', { name: '6М' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Експорт CSV', exact: true })).toBeVisible()
    const pill = periodPill(page)
    await expect(pill).toContainText('На поточний рік')
    const incomeTotal = page.getByRole('row').filter({ hasText: 'Всього доходи' }).getByRole('cell').last()
    await expect(incomeTotal).toHaveText(expected.currentYear)

    await pill.click()
    await expect(page.getByRole('menu').getByText('ЗА ДАТОЮ ОПЕРАЦІЇ', { exact: true })).toBeVisible()
    await expect(page.getByRole('menuitemradio')).toHaveText(REPORT_MENU)
    await page.getByRole('menuitemradio', { name: 'За попередній рік' }).click()
    await expect(pill).toContainText('За попередній рік')
    await expect(incomeTotal).toHaveText(expected.prevYear)

    await pill.click()
    await page.getByRole('menuitemradio', { name: 'Обрати дати' }).click()
    const picker = page.getByRole('dialog', { name: 'Обрати дати' })
    await picker.getByRole('button', { name: 'Попередній місяць' }).click()
    await picker.getByRole('button', { name: formatDayLongUtc(expected.custom.start, 'uk'), exact: true }).click()
    await picker.getByRole('button', { name: formatDayLongUtc(expected.custom.end, 'uk'), exact: true }).click()
    await picker.getByRole('button', { name: 'Застосувати', exact: true }).click()
    await expect(pill).toContainText(formatPeriodLabel({ preset: 'custom', ...expected.custom }, 'uk'))
    await expect(incomeTotal).toHaveText(expected.custom.total)
  })

  test('on a 390 px phone the menu and the calendar fit the screen and work', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const user = await registerViaUi(page, 'periodphone')
    await waitForShell(page, user.companyName)
    const expected = await seedReportData(request, user.orgId)
    await page.goto(`/${user.orgId}/analytics/cashflow`)
    await waitForShell(page, user.companyName)
    const pill = periodPill(page)
    const income = page.getByTestId('cashflow-total-income')
    await expect(income).toHaveText(expected.currentYear)
    expect((await pill.boundingBox())!.height).toBeGreaterThanOrEqual(44)

    await pill.click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    const menuBox = (await menu.boundingBox())!
    expect(menuBox.x).toBeGreaterThanOrEqual(0)
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(390)
    for (const item of await menu.getByRole('menuitemradio').all()) {
      expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
    await menu.getByRole('menuitemradio', { name: 'За попередній рік' }).click()
    await expect(pill).toContainText('За попередній рік')
    await expect(income).toHaveText(expected.prevYear)

    await pill.click()
    await page.getByRole('menuitemradio', { name: 'Обрати дати' }).click()
    const picker = page.getByRole('dialog', { name: 'Обрати дати' })
    await expect(picker).toBeVisible()
    const pickerBox = (await picker.boundingBox())!
    expect(pickerBox.x).toBeGreaterThanOrEqual(0)
    expect(pickerBox.x + pickerBox.width).toBeLessThanOrEqual(390)
    const day = picker.getByRole('button', { name: formatDayLongUtc(expected.custom.start, 'uk'), exact: true })
    await picker.getByRole('button', { name: 'Попередній місяць' }).click()
    expect((await day.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await day.click()
    await picker.getByRole('button', { name: formatDayLongUtc(expected.custom.end, 'uk'), exact: true }).click()
    await picker.getByRole('button', { name: 'Застосувати', exact: true }).click()
    await expect(income).toHaveText(expected.custom.total)
  })
})

test.describe('settings pages (emulators)', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test('saving Компанія shows a light success toast and the header shows the new name', async ({ page }) => {
    const user = await registerViaUi(page, 'company')
    await page.goto(`/${user.orgId}/settings/company`)
    await waitForShell(page, user.companyName)
    // next-themes keeps a dark root on the landing default; toasts inside the app stay light.
    await page.evaluate(() => document.documentElement.classList.add('dark'))

    const nameField = page.getByLabel('Назва', { exact: true })
    await expect(nameField).toHaveValue(user.companyName)
    const newName = `Renamed Co ${Date.now()}`
    await nameField.fill(newName)
    await page.getByRole('button', { name: 'Зберегти', exact: true }).click()

    await expect(page.getByText('Збережено', { exact: true })).toBeVisible()
    await expect(page.locator('[data-sonner-toaster]')).toHaveAttribute('data-sonner-theme', 'light')
    await expect(page.getByTestId('org-switcher-name')).toHaveText(newName)
  })

  test('a category is added and then deleted on settings/categories', async ({ page }) => {
    const user = await registerViaUi(page, 'categories')
    await page.goto(`/${user.orgId}/settings/categories`)
    await waitForShell(page, user.companyName)
    const content = page.getByRole('main')
    const name = `Тестова категорія ${Date.now()}`

    await content.getByLabel('Назва категорії', { exact: true }).fill(name)
    await content.getByRole('combobox', { name: 'Тип категорії' }).selectOption('expense')
    await content.getByRole('button', { name: 'Додати', exact: true }).click()
    await expect(page.getByText('Категорію додано', { exact: true })).toBeVisible()
    await expect(content.getByText(name, { exact: true })).toBeVisible()

    await content.getByRole('button', { name: `Видалити категорію ${name}`, exact: true }).click()
    await expect(page.getByText('Видалено', { exact: true })).toBeVisible()
    await expect(content.getByText(name, { exact: true })).toHaveCount(0)
  })

  test('the Підписка card shows the trial plan with its end date', async ({ page }) => {
    const user = await registerViaUi(page, 'subscription')
    await page.goto(`/${user.orgId}/settings/subscription`)
    await waitForShell(page, user.companyName)
    const content = page.getByRole('main')

    await expect(content.getByText(/^trial plan$/i)).toBeVisible()
    await expect(content.getByText(/^Trial до \S+$/)).toBeVisible()
    await expect(content.getByRole('button', { name: 'Upgrade to Pro', exact: true })).toBeVisible()
  })
})
