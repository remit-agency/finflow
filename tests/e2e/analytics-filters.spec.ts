// tests/e2e/analytics-filters.spec.ts
// Report filters (S10f): the VAT pair tagged «ПДВ» (excluded from analytics) stays out of the totals until the tag is
// chosen, then comes in with the hint (the CSV follows); the choice travels between the report tabs; «Без тегів»; an
// account filter on Cash Flow and on the Balance; «Скинути фільтри».
import { readFileSync } from 'node:fs'
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { registerViaUi, waitForShell, type RegisteredUser } from './helpers/app-ui'
import { seedDoc } from './helpers/emulator-firestore'
import { seedLedgerAccount, seedLedgerOperation } from './helpers/ledger-seed'
import { todayDay } from '../../lib/utils/today'

const NEEDS_EMULATORS =
  'Needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"'

const income = (page: Page): Locator => page.getByTestId('cashflow-total-income')
const expense = (page: Page): Locator => page.getByTestId('cashflow-total-expense')
const hint = (page: Page): Locator => page.getByTestId('analytics-excluded-hint')
const tab = (page: Page, name: string): Locator =>
  page.getByRole('navigation', { name: 'Розділи аналітики' }).getByRole('link', { name, exact: true })

/** A tag in the exact shape the server stores (lib/domain/tags/doc.ts). */
async function seedTag(request: APIRequestContext, orgId: string, id: string, name: string, excludeFromAnalytics: boolean): Promise<void> {
  await seedDoc(request, `organizations/${orgId}/tags`, id, {
    schemaVersion: 1,
    name,
    color: excludeFromAnalytics ? 'rose' : 'amber',
    excludeFromAnalytics,
    archived: false,
    recalcPending: false,
    orgId,
    createdAt: new Date(),
    createdBy: 'e2e',
    updatedAt: new Date(),
  })
}

/**
 * A PLN company, all today: on «Konto główne» a sale of 500, rent of 120, fuel of 40 tagged «Паливо» and the VAT 230 out
 * tagged «ПДВ» (excluded from analytics); on «Rachunek VAT» the VAT 230 in (the same tag) and a bank fee of 15. Without
 * filters Cash Flow shows 500 / 175 (tests/unit/utils/analytics.test.ts checks the same numbers).
 */
async function setup(page: Page, request: APIRequestContext, prefix: string): Promise<RegisteredUser> {
  const user = await registerViaUi(page, prefix, 'PLN')
  await waitForShell(page, user.companyName)
  const org = user.orgId
  await seedLedgerAccount(request, org, 'acc-main', { name: 'Konto główne', balance: 5000, currency: 'PLN' })
  await seedLedgerAccount(request, org, 'acc-vat', { name: 'Rachunek VAT', balance: 1000, currency: 'PLN' })
  await seedTag(request, org, 'tag-vat', 'ПДВ', true)
  await seedTag(request, org, 'tag-fuel', 'Паливо', false)
  const day = todayDay()
  const main = { accountId: 'acc-main', currency: 'PLN', date: day }
  const vat = { accountId: 'acc-vat', currency: 'PLN', date: day }
  await seedLedgerOperation(request, org, 'op-sale', { ...main, type: 'income', amount: 500, description: 'Faktura 7/11' })
  await seedLedgerOperation(request, org, 'op-rent', { ...main, type: 'expense', amount: 120, description: 'Czynsz' })
  await seedLedgerOperation(request, org, 'op-fuel', { ...main, type: 'expense', amount: 40, description: 'Orlen', tags: ['tag-fuel'] })
  await seedLedgerOperation(request, org, 'op-vat-out', { ...main, type: 'expense', amount: 230, description: 'VAT na rachunek VAT', tags: ['tag-vat'], excluded: true })
  await seedLedgerOperation(request, org, 'op-vat-in', { ...vat, type: 'income', amount: 230, description: 'VAT z konta głównego', tags: ['tag-vat'], excluded: true })
  await seedLedgerOperation(request, org, 'op-fee', { ...vat, type: 'expense', amount: 15, description: 'Opłata bankowa' })
  return user
}

/**
 * The tree of «Види платежів і категорії» (S10f, Finmap): an income category «Консалтинг» with the child «Консультації», and an
 * income operation of 300 in the child. With `setup` the Cash Flow shows income 800 (500 uncategorised + 300) and expense 175
 * (all uncategorised).
 */
async function seedTree(request: APIRequestContext, orgId: string): Promise<void> {
  const createdAt = new Date()
  await seedDoc(request, `organizations/${orgId}/categories`, 'cat-services', { name: 'Консалтинг', type: 'income', color: '#6366f1', orgId, createdAt })
  await seedDoc(request, `organizations/${orgId}/categories`, 'cat-consult', {
    name: 'Консультації',
    type: 'income',
    color: '#10b981',
    parentId: 'cat-services',
    orgId,
    createdAt,
  })
  await seedLedgerOperation(request, orgId, 'op-consult', {
    accountId: 'acc-main',
    currency: 'PLN',
    date: todayDay(),
    type: 'income',
    amount: 300,
    description: 'Konsultacja',
    categoryId: 'cat-consult',
  })
}

/** Opens «Фільтри» on the current report; `active` is the number the button shows (0: none). */
/** A parent with 31 children: ticking the parent is 32 ids, more than the address keeps. */
async function seedWideParent(request: APIRequestContext, orgId: string): Promise<void> {
  const createdAt = new Date()
  const base = { type: 'expense', color: '#64748b', orgId, createdAt } as const
  await seedDoc(request, `organizations/${orgId}/categories`, 'cat-wide', { ...base, name: 'Велика категорія' })
  await Promise.all(
    Array.from({ length: 31 }, (_, i) =>
      seedDoc(request, `organizations/${orgId}/categories`, `cat-wide-${i + 1}`, {
        ...base,
        name: `Підкатегорія ${String(i + 1).padStart(2, '0')}`,
        parentId: 'cat-wide',
      }),
    ),
  )
}

/** More expense categories than the tree's rows the old list kept (100): the last rows must still show. */
async function seedLongList(request: APIRequestContext, orgId: string): Promise<void> {
  const createdAt = new Date()
  await Promise.all(
    Array.from({ length: 105 }, (_, i) =>
      seedDoc(request, `organizations/${orgId}/categories`, `cat-long-${i + 1}`, {
        name: `Категорія ${String(i + 1).padStart(3, '0')}`,
        type: 'expense',
        color: '#64748b',
        orgId,
        createdAt,
      }),
    ),
  )
}

async function openFilters(page: Page, active = 0): Promise<Locator> {
  await page.getByRole('button', { name: active > 0 ? `Фільтри (активних: ${active})` : 'Фільтри', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Фільтри' })
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('report filters (emulators)', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test('«ПДВ» brings the excluded VAT pair into the totals with a hint, the CSV follows, the tabs keep the choice', async ({ page, request }) => {
    const user = await setup(page, request, 'af-tag')
    await page.goto(`/${user.orgId}/analytics/cashflow`)
    await waitForShell(page, user.companyName)
    await expect(income(page)).toHaveText('500')
    await expect(expense(page)).toHaveText('175')
    await expect(hint(page)).toHaveCount(0)

    const dialog = await openFilters(page)
    await dialog.getByRole('button', { name: 'Теги', exact: true }).click()
    // The field opens a listbox (the search and the rows are its popup).
    await expect(dialog.getByRole('button', { name: 'Теги', exact: true })).toHaveAttribute('aria-haspopup', 'listbox')
    const search = dialog.getByRole('combobox', { name: 'Пошук тегів' })
    await expect(search).toBeFocused()
    await expect(dialog.getByRole('option', { name: 'Усі теги' })).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.getByRole('option', { name: 'Без тегів' })).toBeVisible()
    // Nothing is highlighted before typing: Enter ticks nothing (the S10t rule).
    await search.press('Enter')
    await expect(dialog.getByRole('option', { name: 'Усі теги' })).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.getByRole('option', { name: /^ПДВ/ })).toHaveAttribute('aria-selected', 'false')
    // Typing highlights the first match; Enter ticks it.
    await search.fill('пдв')
    await search.press('Enter')
    await expect(dialog.getByRole('option', { name: /^ПДВ/ })).toHaveAttribute('aria-selected', 'true')
    // Esc closes only the list; the tick stays in the dialog's draft.
    await search.press('Escape')
    await expect(search).toBeHidden()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Теги (1)' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Готово' }).click()
    await expect(dialog).toBeHidden()

    await expect(page).toHaveURL(/\/analytics\/cashflow\?tg=tag-vat$/)
    await expect(income(page)).toHaveText('230')
    await expect(expense(page)).toHaveText('230')
    await expect(hint(page)).toHaveText('Показано також операції, виключені з аналітики')
    await expect(page.getByTestId('analytics-filters-count')).toHaveText('1')

    // The CSV is the filtered report: this month 230 in, 230 out, nothing else.
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Експорт CSV', exact: true }).click()
    const csv = readFileSync(await (await download).path(), 'utf8')
    expect(csv).toContain(',230,230,0,')
    expect(csv).not.toContain(',500,')

    // The report tabs keep the choice.
    for (const [name, path] of [['P&L', 'pl'], ['Календар', 'calendar']] as const) {
      await tab(page, name).click()
      await expect(page).toHaveURL(new RegExp(`/analytics/${path}\\?tg=tag-vat$`))
      await expect(hint(page)).toBeVisible()
    }
    await tab(page, 'Баланс').click()
    await expect(page).toHaveURL(/\/analytics\/balance\?tg=tag-vat$/)
    // The Balance is made of accounts: the tag does not apply there and is not counted.
    await expect(page.getByRole('button', { name: 'Фільтри', exact: true })).toBeVisible()
    await tab(page, 'Cash Flow').click()
    await expect(page).toHaveURL(/\/analytics\/cashflow\?tg=tag-vat$/)
    await expect(income(page)).toHaveText('230')
  })

  test('«Без тегів», an account on Cash Flow and on the Balance, then «Скинути фільтри»', async ({ page, request }) => {
    const user = await setup(page, request, 'af-acc')
    await page.goto(`/${user.orgId}/analytics/cashflow`)
    await waitForShell(page, user.companyName)
    await expect(income(page)).toHaveText('500')

    let dialog = await openFilters(page)
    await dialog.getByRole('button', { name: 'Теги', exact: true }).click()
    await dialog.getByRole('option', { name: 'Без тегів' }).click()
    await expect(dialog.getByRole('option', { name: 'Усі теги' })).toHaveAttribute('aria-selected', 'false')
    await dialog.getByRole('button', { name: 'Вибрати' }).click()
    await expect(dialog.getByRole('button', { name: 'Теги (1)' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Готово' }).click()
    await expect(page).toHaveURL(/\?tg=_none$/)
    await expect(income(page)).toHaveText('500')
    await expect(expense(page)).toHaveText('135')
    await expect(hint(page)).toHaveCount(0)

    dialog = await openFilters(page, 1)
    await dialog.getByRole('button', { name: 'Теги (1)' }).click()
    await dialog.getByRole('option', { name: 'Усі теги' }).click()
    await expect(dialog.getByRole('option', { name: 'Без тегів' })).toHaveAttribute('aria-selected', 'false')
    await dialog.getByRole('button', { name: 'Вибрати' }).click()
    await dialog.getByRole('button', { name: 'Рахунки', exact: true }).click()
    await dialog.getByRole('option', { name: 'Rachunek VAT' }).click()
    await dialog.getByRole('button', { name: 'Вибрати' }).click()
    await expect(dialog.getByRole('button', { name: 'Рахунки (1)' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Готово' }).click()
    await expect(page).toHaveURL(/\?accounts=acc-vat$/)
    // The VAT account: the bank fee only (its VAT income is excluded from analytics and no tag is chosen).
    await expect(income(page)).toHaveText('0')
    await expect(expense(page)).toHaveText('15')

    await tab(page, 'Баланс').click()
    await expect(page).toHaveURL(/\/analytics\/balance\?accounts=acc-vat$/)
    const main = page.getByRole('main')
    await expect(main.getByText('Rachunek VAT')).toBeVisible()
    await expect(main.getByText('Konto główne')).toHaveCount(0)
    await expect(page.getByTestId('analytics-filters-count')).toHaveText('1')

    await tab(page, 'Cash Flow').click()
    // Wait for the new page: the Balance has a «Фільтри (активних: 1)» button too, and a click on it before the navigation
    // lands would open a dialog that the Cash Flow page then unmounts.
    await expect(page).toHaveURL(/\/analytics\/cashflow\?accounts=acc-vat$/)
    dialog = await openFilters(page, 1)
    await dialog.getByRole('button', { name: 'Скинути фільтри' }).click()
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`/${user.orgId}/analytics/cashflow$`))
    await expect(income(page)).toHaveText('500')
    await expect(expense(page)).toHaveText('175')
    await expect(page.getByRole('button', { name: 'Фільтри', exact: true })).toBeVisible()
  })

  test('an id of a deleted account, tag or category in the address is ignored: the report and the field show no choice', async ({ page, request }) => {
    const user = await setup(page, request, 'af-gone')
    await page.goto(`/${user.orgId}/analytics/cashflow?accounts=acc-deleted&tg=tag-deleted&cat=cat-deleted&cp=cp-deleted`)
    await waitForShell(page, user.companyName)
    await expect(income(page)).toHaveText('500')
    await expect(expense(page)).toHaveText('175')
    await expect(hint(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Фільтри', exact: true })).toBeVisible()

    await page.goto(`/${user.orgId}/analytics/balance?accounts=acc-deleted`)
    await waitForShell(page, user.companyName)
    await expect(page.getByRole('main').getByText('Konto główne')).toBeVisible()
    await expect(page.getByRole('main').getByText('Rachunek VAT')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Фільтри', exact: true })).toBeVisible()
  })

  test('the tree: a whole group takes all its operations and no other group; the group is stored as its type', async ({ page, request }) => {
    const user = await setup(page, request, 'af-grp')
    await seedTree(request, user.orgId)
    await page.goto(`/${user.orgId}/analytics/cashflow`)
    await waitForShell(page, user.companyName)
    await expect(income(page)).toHaveText('800')
    await expect(expense(page)).toHaveText('175')

    const dialog = await openFilters(page)
    await dialog.getByRole('button', { name: 'Усі види і категорії', exact: true }).click()
    await expect(dialog.getByRole('treeitem', { name: /^Усі види платежів і категорії/ })).toHaveAttribute('data-state', 'checked')
    await dialog.getByRole('treeitem', { name: /^Усі надходження/ }).click()
    // The whole income group is ticked; the root is dashed (some of the types are chosen).
    await expect(dialog.getByRole('treeitem', { name: /^Усі надходження/ })).toHaveAttribute('data-state', 'checked')
    await expect(dialog.getByRole('treeitem', { name: /^Консультації/ })).toHaveAttribute('data-state', 'checked')
    await expect(dialog.getByRole('treeitem', { name: /^Усі види платежів і категорії/ })).toHaveAttribute('data-state', 'mixed')
    await dialog.getByRole('button', { name: 'Вибрати' }).click()
    await expect(dialog.getByRole('button', { name: 'Усі надходження', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Готово' }).click()

    await expect(page).toHaveURL(/\/analytics\/cashflow\?types=income$/)
    await expect(income(page)).toHaveText('800')
    await expect(expense(page)).toHaveText('0')
    await expect(page.getByTestId('analytics-filters-count')).toHaveText('1')
  })

  test('the tree: one subcategory alone, its parent dashed; the uncategorised row of expenses added to it', async ({ page, request }) => {
    const user = await setup(page, request, 'af-sub')
    await seedTree(request, user.orgId)
    await page.goto(`/${user.orgId}/analytics/cashflow`)
    await waitForShell(page, user.companyName)

    let dialog = await openFilters(page)
    await dialog.getByRole('button', { name: 'Усі види і категорії', exact: true }).click()
    await dialog.getByRole('treeitem', { name: /^Консультації/ }).click()
    await expect(dialog.getByRole('treeitem', { name: /^Консультації/ })).toHaveAttribute('data-state', 'checked')
    await expect(dialog.getByRole('treeitem', { name: /^Консалтинг/ })).toHaveAttribute('data-state', 'mixed')
    await expect(dialog.getByRole('treeitem', { name: /^Усі надходження/ })).toHaveAttribute('data-state', 'mixed')
    await dialog.getByRole('button', { name: 'Вибрати' }).click()
    await dialog.getByRole('button', { name: 'Готово' }).click()
    await expect(page).toHaveURL(/\/analytics\/cashflow\?cat=cat-consult$/)
    await expect(income(page)).toHaveText('300')
    await expect(expense(page)).toHaveText('0')

    dialog = await openFilters(page, 1)
    await dialog.getByRole('button', { name: 'Консультації', exact: true }).click()
    await dialog.getByRole('treeitem', { name: /^Без категорії витрат/ }).click()
    await expect(dialog.getByRole('treeitem', { name: /^Без категорії витрат/ })).toHaveAttribute('data-state', 'checked')
    await dialog.getByRole('button', { name: 'Вибрати' }).click()
    await expect(dialog.getByRole('button', { name: 'Вибрано: 2', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Готово' }).click()
    await expect(income(page)).toHaveText('300')
    await expect(expense(page)).toHaveText('175')
  })

  test('the tree: a parent ticked takes its child; unticking the child leaves the parent dashed', async ({ page, request }) => {
    const user = await setup(page, request, 'af-par')
    await seedTree(request, user.orgId)
    await page.goto(`/${user.orgId}/analytics/cashflow`)
    await waitForShell(page, user.companyName)

    const dialog = await openFilters(page)
    await dialog.getByRole('button', { name: 'Усі види і категорії', exact: true }).click()
    await dialog.getByRole('treeitem', { name: /^Консалтинг/ }).click()
    await expect(dialog.getByRole('treeitem', { name: /^Консультації/ })).toHaveAttribute('data-state', 'checked')
    await expect(dialog.getByRole('treeitem', { name: /^Консалтинг/ })).toHaveAttribute('data-state', 'checked')
    await dialog.getByRole('button', { name: 'Вибрати' }).click()
    await dialog.getByRole('button', { name: 'Готово' }).click()
    await expect(income(page)).toHaveText('300')
    await expect(expense(page)).toHaveText('0')

    const again = await openFilters(page, 1)
    // Two stored ids, one row the person sees: the parent (its child is covered by its tick), so the field names it.
    await again.getByRole('button', { name: 'Консалтинг', exact: true }).click()
    await again.getByRole('treeitem', { name: /^Консультації/ }).click()
    await expect(again.getByRole('treeitem', { name: /^Консалтинг/ })).toHaveAttribute('data-state', 'mixed')
    await expect(again.getByRole('treeitem', { name: /^Консультації/ })).toHaveAttribute('data-state', 'unchecked')
    await again.getByRole('button', { name: 'Вибрати' }).click()
    await again.getByRole('button', { name: 'Готово' }).click()
    // Only the parent itself stays chosen: the operations of the child are left out, the parent's own are none here.
    await expect(page).toHaveURL(/\/analytics\/cashflow\?cat=cat-services$/)
    await expect(income(page)).toHaveText('0')
    await expect(expense(page)).toHaveText('0')
  })

  test('the tree: a tick the 30-id limit cannot keep is refused, and the list says so on every refused tick until a tick is kept', async ({ page, request }) => {
    const user = await setup(page, request, 'af-lim')
    await seedWideParent(request, user.orgId)
    await page.goto(`/${user.orgId}/analytics/cashflow`)
    await waitForShell(page, user.companyName)

    const dialog = await openFilters(page)
    await dialog.getByRole('button', { name: 'Усі види і категорії', exact: true }).click()
    const wide = dialog.getByRole('treeitem', { name: /^Велика категорія/ })
    await wide.click()
    await expect(dialog.getByRole('status')).toHaveText('Не більше 30 у списку')
    await expect(wide).toHaveAttribute('data-state', 'unchecked')
    // Refused again: the message stays and the row does not move.
    await wide.click()
    await expect(dialog.getByRole('status')).toHaveText('Не більше 30 у списку')
    await expect(wide).toHaveAttribute('data-state', 'unchecked')
    // A tick that is kept clears the message.
    await dialog.getByRole('treeitem', { name: 'Без категорії витрат', exact: true }).click()
    await expect(dialog.getByRole('status')).toHaveCount(0)
  })

  test('the tree: a list of more than 100 categories keeps its last rows in view', async ({ page, request }) => {
    const user = await setup(page, request, 'af-long')
    await seedLongList(request, user.orgId)
    await page.goto(`/${user.orgId}/analytics/cashflow`)
    await waitForShell(page, user.companyName)

    const dialog = await openFilters(page)
    await dialog.getByRole('button', { name: 'Усі види і категорії', exact: true }).click()
    const lastRow = dialog.getByRole('treeitem', { name: 'Переказ', exact: true })
    await lastRow.scrollIntoViewIfNeeded()
    await expect(lastRow).toBeVisible()
    await expect(dialog.getByRole('treeitem', { name: 'Без категорії витрат', exact: true })).toBeVisible()
  })
})
