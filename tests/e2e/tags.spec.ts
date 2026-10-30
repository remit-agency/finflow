// tests/e2e/tags.spec.ts
// Tags (S10t): the settings section, the form field (inline create too), bulk add and remove, the journal filter, a rule that
// tags what the fake bank imports (tests/e2e/helpers/eb-stub.mjs) and a flag change with its recalculation.
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { registerViaUi, waitForShell, type RegisteredUser } from './helpers/app-ui'
import { dayFromToday, seedConnection, seedLinkedBankAccount } from './helpers/bank-seed'
import { readDoc, seedDoc } from './helpers/emulator-firestore'
import { seedLedgerAccount, seedLedgerOperation } from './helpers/ledger-seed'
import { todayDay } from '../../lib/utils/today'

const NEEDS_EMULATORS =
  'Needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"'
const ORIGIN = { Origin: 'http://localhost:3000' }

const rowsOf = (page: Page): Locator => page.locator('tbody').getByRole('row').filter({ has: page.getByRole('checkbox') })
const toast = (page: Page, text: string): Locator => page.locator('[data-sonner-toast]').filter({ hasText: text })
const formDialog = (page: Page): Locator => page.getByRole('dialog').filter({ has: page.locator('#tx-amount') })
const accountRow = (page: Page, name: string): Locator =>
  page.getByRole('complementary', { name: 'Рахунки' }).getByRole('listitem').filter({ hasText: name })

/** A tag in the exact shape the server stores (lib/domain/tags/doc.ts). No name key: these specs never create a second tag of that name. */
async function seedTag(request: APIRequestContext, orgId: string, id: string, name: string): Promise<void> {
  await seedDoc(request, `organizations/${orgId}/tags`, id, {
    schemaVersion: 1,
    name,
    color: 'sky',
    excludeFromAnalytics: false,
    archived: false,
    recalcPending: false,
    orgId,
    createdAt: new Date(),
    createdBy: 'e2e',
    updatedAt: new Date(),
  })
}

/** The stored balance of an account in minor units (seeded numbers and the ledger's increments are doubles). */
async function balanceMinor(request: APIRequestContext, orgId: string, accountId: string): Promise<number> {
  const raw = (await readDoc(request, `organizations/${orgId}/accounts/${accountId}`))?.balanceMinor as unknown as
    | { doubleValue?: number; integerValue?: string }
    | undefined
  return Number(raw?.doubleValue ?? raw?.integerValue)
}

/** A PLN company with one bank account of 1000 zł, on the journal. */
async function setup(page: Page, request: APIRequestContext, prefix: string): Promise<RegisteredUser> {
  const user = await registerViaUi(page, prefix, 'PLN')
  await waitForShell(page, user.companyName)
  await seedLedgerAccount(request, user.orgId, 'acc-bank', { name: 'Konto PLN', balance: 1000, currency: 'PLN' })
  await expect(accountRow(page, 'Konto PLN')).toBeVisible()
  return user
}

async function addExpense(page: Page, amount: string, description: string): Promise<void> {
  await page.getByRole('button', { name: 'Витрата', exact: true }).click()
  const form = formDialog(page)
  await form.locator('#tx-amount').fill(amount)
  await form.locator('#tx-desc').fill(description)
  await form.getByRole('button', { name: 'Додати', exact: true }).click()
  await expect(form).toBeHidden()
}

test.describe('tags (emulators)', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test('a tag made in settings is given in the form, shows as a chip and filters the journal', async ({ page, request }) => {
    const user = await setup(page, request, 'tg-form')
    await page.goto(`/${user.orgId}/settings/tags`)
    await expect(page.getByText('Тегів ще немає')).toBeVisible()
    await page.getByRole('button', { name: 'Додати тег' }).click()
    const editor = page.getByRole('dialog')
    await editor.locator('#tag-name').fill('ПДВ')
    await editor.getByRole('radio', { name: 'Рожевий' }).click()
    await editor.getByRole('switch', { name: 'Не враховувати в аналітиці' }).check()
    await editor.getByRole('button', { name: 'Зберегти', exact: true }).click()
    await expect(toast(page, 'Тег збережено')).toBeVisible()
    await expect(editor).toBeHidden()
    await expect(page.getByTestId('tag-row')).toContainText('ПДВ')
    await expect(page.getByTestId('tag-row').getByTestId('tag-excluded')).toHaveText('Не враховується в аналітиці')

    await page.goto(`/${user.orgId}/transactions`)
    await expect(accountRow(page, 'Konto PLN')).toBeVisible()
    await page.getByRole('button', { name: 'Витрата', exact: true }).click()
    const form = formDialog(page)
    await form.locator('#tx-amount').fill('230')
    await form.locator('#tx-desc').fill('VAT')
    await form.locator('#tx-tags').fill('пдв')
    await form.getByRole('option', { name: /ПДВ/ }).click()
    await expect(form.getByTestId('tag-picked')).toContainText('ПДВ')
    await form.getByRole('button', { name: 'Додати', exact: true }).click()
    await expect(form).toBeHidden()
    await addExpense(page, '50', 'Kawa')

    await expect(rowsOf(page)).toHaveCount(2)
    await expect(rowsOf(page).filter({ hasText: 'VAT' }).getByTestId('tag-chip')).toContainText('ПДВ')
    await expect(page.getByTestId('tag-chip')).toHaveCount(1)

    await page.getByRole('button', { name: 'Додаткові фільтри' }).click()
    const filter = page.getByTestId('journal-tag-filter')
    await filter.getByRole('checkbox', { name: 'ПДВ' }).check()
    await expect(page).toHaveURL(/[?&]tg=/)
    await expect(rowsOf(page)).toHaveCount(1)
    await expect(rowsOf(page)).toContainText('VAT')
    await filter.getByRole('checkbox', { name: 'ПДВ' }).uncheck()
    await filter.getByRole('checkbox', { name: 'Без тегів' }).check()
    await expect(rowsOf(page)).toHaveCount(1)
    await expect(rowsOf(page)).toContainText('Kawa')
    await filter.getByRole('checkbox', { name: 'Без тегів' }).uncheck()
    await filter.getByRole('checkbox', { name: 'Лише не враховані в аналітиці' }).check()
    await expect(page).toHaveURL(/[?&]ex=1/)
    await expect(rowsOf(page)).toHaveCount(1)
    await expect(rowsOf(page)).toContainText('VAT')
    // The tag keeps the expense out of the analytics, not out of the balance: 1000 − 230 − 50.
    expect(await balanceMinor(request, user.orgId, 'acc-bank')).toBe(72_000)
  })

  test('a new tag can be created right from the form field', async ({ page, request }) => {
    const user = await setup(page, request, 'tg-inline')
    await page.getByRole('button', { name: 'Витрата', exact: true }).click()
    const form = formDialog(page)
    await form.locator('#tx-amount').fill('1000')
    await form.locator('#tx-tags').fill('Bankomat')
    await form.getByRole('option', { name: 'Створити «Bankomat»' }).click()
    await expect(form.getByTestId('tag-picked')).toContainText('Bankomat')
    await form.getByRole('button', { name: 'Додати', exact: true }).click()
    await expect(form).toBeHidden()
    await expect(rowsOf(page).getByTestId('tag-chip')).toContainText('Bankomat')
    await page.goto(`/${user.orgId}/settings/tags`)
    await expect(page.getByTestId('tag-row')).toContainText('Bankomat')
  })

  test('bulk: add a tag to the selected operations, then take it off', async ({ page, request }) => {
    const user = await setup(page, request, 'tg-bulk')
    await seedTag(request, user.orgId, 'tag-q4', 'Q4')
    await seedLedgerOperation(request, user.orgId, 'op-1', { type: 'expense', accountId: 'acc-bank', amount: 10, currency: 'PLN', description: 'Op 1' })
    await seedLedgerOperation(request, user.orgId, 'op-2', { type: 'expense', accountId: 'acc-bank', amount: 20, currency: 'PLN', description: 'Op 2' })
    await page.reload()
    await expect(rowsOf(page)).toHaveCount(2)
    const bar = page.getByRole('region', { name: 'Вибрані операції' })
    const dialog = page.getByRole('dialog')

    for (const i of [0, 1]) await rowsOf(page).nth(i).getByRole('checkbox').check()
    await bar.getByRole('button', { name: 'Змінити дані' }).click()
    await page.getByRole('menuitem', { name: 'Додати тег' }).click()
    await dialog.getByRole('combobox', { name: 'Теги' }).fill('q4')
    await dialog.getByRole('option', { name: /Q4/ }).click()
    await dialog.getByRole('button', { name: 'Застосувати' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('tag-chip')).toHaveCount(2)

    for (const i of [0, 1]) await rowsOf(page).nth(i).getByRole('checkbox').check()
    await bar.getByRole('button', { name: 'Змінити дані' }).click()
    await page.getByRole('menuitem', { name: 'Зняти тег' }).click()
    await dialog.getByRole('combobox', { name: 'Теги' }).click()
    await dialog.getByRole('option', { name: /Q4/ }).click()
    await dialog.getByRole('button', { name: 'Застосувати' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('tag-chip')).toHaveCount(0)
  })

  test('a rule that adds a tag tags what the fake bank imports', async ({ page, request }) => {
    const user = await registerViaUi(page, 'tg-rule', 'PLN')
    await waitForShell(page, user.companyName)
    await seedLedgerAccount(request, user.orgId, 'acc-bank', { name: 'Fake Bank PLN', balance: 0, currency: 'PLN' })
    await seedTag(request, user.orgId, 'tag-fuel', 'Paliwo firmowe')
    // A rule in the exact shape the server stores (lib/domain/rules/doc.ts).
    await seedDoc(request, `organizations/${user.orgId}/rules`, 'rule-fuel', {
      schemaVersion: 1,
      orgId: user.orgId,
      name: 'Orlen',
      type: 'expense',
      active: true,
      order: 0,
      conditions: [{ kind: 'text', op: 'contains', values: ['orlen'] }],
      actions: { tagIds: ['tag-fuel'] },
      createdAt: new Date(),
      createdBy: 'e2e',
      updatedAt: new Date(),
    })
    await seedConnection(request, user.orgId, dayFromToday(60))
    await seedLinkedBankAccount(request, user.orgId, 'acc-bank')
    await page.goto(`/${user.orgId}/transactions`)
    await expect(rowsOf(page)).toHaveCount(3)
    const fuel = rowsOf(page).filter({ hasText: 'Orlen' })
    await expect(fuel.getByTestId('tag-chip')).toContainText('Paliwo firmowe')
    await expect(fuel.getByTestId('rule-chip')).toHaveText('за правилом: Orlen')
    await expect(page.getByTestId('tag-chip')).toHaveCount(1)
  })

  test('switching «Не враховувати» on a used tag asks first, recalculates with progress and leaves the balances alone', async ({ page, request }) => {
    const user = await setup(page, request, 'tg-recalc')
    await seedLedgerAccount(request, user.orgId, 'acc-cash', { name: 'Kasa', balance: 0, currency: 'PLN', type: 'cash' })
    // The real ledger writes these (rollups and audit included): the browser context carries the session cookie.
    const created = await page.request.post(`/api/orgs/${user.orgId}/tags`, { headers: ORIGIN, data: { name: 'Bankomat' } })
    expect(created.status()).toBe(201)
    const { tag } = (await created.json()) as { tag: { id: string } }
    // The cash machine: 1000 out of the bank, 1000 into the cash box, both with the tag.
    for (const [type, accountId] of [['expense', 'acc-bank'], ['income', 'acc-cash']] as const) {
      const res = await page.request.post(`/api/orgs/${user.orgId}/transactions`, {
        headers: ORIGIN,
        data: { type, accountId, amountMinor: 100_000, paymentDate: todayDay(), tags: [tag.id] },
      })
      expect(res.status()).toBe(201)
    }

    await page.goto(`/${user.orgId}/settings/tags`)
    await page.getByRole('button', { name: 'Редагувати «Bankomat»' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('switch', { name: 'Не враховувати в аналітиці' }).check()
    await dialog.getByRole('button', { name: 'Зберегти', exact: true }).click()
    await expect(page.getByTestId('tag-recalc-count')).toHaveText('Буде перераховано операцій: 2. Залишки рахунків не зміняться.')
    await page.getByRole('button', { name: 'Перерахувати' }).click()
    await expect(page.getByTestId('tag-recalc-state')).toHaveText('Готово. Переглянуто операцій: 2')
    await page.getByTestId('tag-recalc-close').click()
    await expect(page.getByTestId('tag-row').getByTestId('tag-excluded')).toBeVisible()
    await expect(page.getByTestId('tag-recalc-pending')).toHaveCount(0)

    // The balances did not move: the bank paid out 1000, the cash box got 1000.
    expect(await balanceMinor(request, user.orgId, 'acc-bank')).toBe(0)
    expect(await balanceMinor(request, user.orgId, 'acc-cash')).toBe(100_000)
    await page.goto(`/${user.orgId}/transactions?ex=1`)
    await expect(rowsOf(page)).toHaveCount(2)
  })
})
