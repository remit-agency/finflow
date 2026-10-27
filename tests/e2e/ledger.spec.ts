import { test, expect, type Locator, type Page } from '@playwright/test'
import { registerViaUi, waitForShell } from './helpers/app-ui'
import { signInEmulatorUser } from './helpers/emulator-auth'
import { createDocAs, listDocs, readDoc, seedDoc } from './helpers/emulator-firestore'
import { seedLedgerAccount, seedLedgerOperation } from './helpers/ledger-seed'

const NEEDS_EMULATORS =
  'Needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"'

function accountsSidebar(page: Page) {
  return page.getByRole('complementary', { name: 'Рахунки' })
}

/** The sidebar row of an account (its name and its balance). */
function accountRow(page: Page, name: string): Locator {
  return accountsSidebar(page).getByRole('listitem').filter({ hasText: name })
}

/** `2 234,60` as the app prints it: the uk-UA group separator is a no-break space, so any whitespace matches. */
function balanceText(whole: string, fraction: string): RegExp {
  return new RegExp(`${whole.replace(/\s/g, '\\s')},${fraction}`)
}

/** Fills and submits the transaction form for a new income or expense on the named account. */
async function addOperation(
  page: Page,
  kind: 'Дохід' | 'Витрата',
  accountName: string,
  amount: string,
  description: string,
): Promise<void> {
  await page.getByRole('button', { name: kind, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Нова транзакція', { exact: true })).toBeVisible()
  const panel = dialog.getByRole('tabpanel')
  // The "Рахунок" <select> has no label association; it is the first native select in the panel.
  await panel.locator('select').first().selectOption({ label: accountName })
  await panel.getByLabel('Сума', { exact: true }).fill(amount)
  await panel.getByLabel('Опис', { exact: true }).fill(description)
  await dialog.getByRole('button', { name: 'Додати', exact: true }).click()
  await expect(dialog).toBeHidden()
}

test.describe('ledger (emulators)', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test('account balance follows every edit of its operations', async ({ page, request }) => {
    // The company is in PLN, like the account: no exchange rate is involved.
    const user = await registerViaUi(page, 'ledgerbal', 'PLN')
    await waitForShell(page, user.companyName)

    // 1. A new account through the dialog: opening balance 1000, PLN.
    await page.getByRole('button', { name: 'Додати рахунок', exact: true }).first().click()
    const accountDialog = page.getByRole('dialog')
    await expect(accountDialog.getByText('Новий рахунок', { exact: true })).toBeVisible()
    await accountDialog.getByLabel('Назва', { exact: true }).fill('Monobank')
    await accountDialog.getByLabel('Початковий залишок', { exact: true }).fill('1000')
    // The currency <select> is the second native select of the dialog (the type is the first).
    await accountDialog.locator('select').nth(1).selectOption('PLN')
    await accountDialog.getByRole('button', { name: 'Створити', exact: true }).click()
    await expect(accountDialog).toBeHidden()
    const row = accountRow(page, 'Monobank')
    await expect(row).toContainText(balanceText('1 000', '00'))

    // 2. Income 1234,60: 1000 + 1234,60.
    await addOperation(page, 'Дохід', 'Monobank', '1234,60', 'Перший дохід')
    await expect(row).toContainText(balanceText('2 234', '60'))

    // 3. Income 10 and expense 10 cancel each other.
    await addOperation(page, 'Дохід', 'Monobank', '10', 'Плюс десять')
    await expect(row).toContainText(balanceText('2 244', '60'))
    await addOperation(page, 'Витрата', 'Monobank', '10', 'Мінус десять')
    await expect(row).toContainText(balanceText('2 234', '60'))

    // 4. The case from the owner's screenshot: 1234,60 edited to 1234,50 moves the balance by exactly 0,10.
    await page.getByRole('row').filter({ hasText: 'Перший дохід' }).getByRole('button', { name: /редагувати$/ }).click()
    const editDialog = page.getByRole('dialog')
    await expect(editDialog.getByText('Редагувати транзакцію', { exact: true })).toBeVisible()
    await editDialog.getByRole('tabpanel').getByLabel('Сума', { exact: true }).fill('1234,50')
    await editDialog.getByRole('button', { name: 'Зберегти', exact: true }).click()
    await expect(editDialog).toBeHidden()
    await expect(row).toContainText(balanceText('2 234', '50'))

    // 5. Deleting that income returns 1234,50, and the 10 + 10 pair is still in the books: 1000,00.
    // The UI has no delete control for an operation yet, so the real API route is called from the page
    // (same origin, with the session cookie), exactly as a future button would.
    const docs = await listDocs(request, `organizations/${user.orgId}/transactions`)
    expect(docs).toHaveLength(3)
    const first = docs.find((d) => {
      const description = d.fields.description
      return !!description && 'stringValue' in description && description.stringValue === 'Перший дохід'
    })
    expect(first, 'the first income is stored').toBeDefined()
    const status = await page.evaluate(
      async ({ orgId, id }) => (await fetch(`/api/orgs/${orgId}/transactions/${id}`, { method: 'DELETE', credentials: 'same-origin' })).status,
      { orgId: user.orgId, id: first!.id },
    )
    expect(status).toBe(204)
    await expect(page.getByRole('row').filter({ hasText: 'Перший дохід' })).toHaveCount(0)
    await expect(row).toContainText(balanceText('1 000', '00'))
    // The income of 10 and the expense of 10 stay in the journal.
    await expect(page.getByRole('row').filter({ hasText: 'Плюс десять' })).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'Мінус десять' })).toBeVisible()
  })

  test('editing only the amount keeps the category, counterparty, tags and accrual period', async ({ page, request }) => {
    const user = await registerViaUi(page, 'ledgeredit', 'PLN')
    await waitForShell(page, user.companyName)
    await seedLedgerAccount(request, user.orgId, 'acc-edit', { name: 'Konto edit', balance: 100, currency: 'PLN' })
    await seedDoc(request, `organizations/${user.orgId}/categories`, 'cat-edit-income', {
      name: 'Retainers',
      type: 'income',
      color: '#22c55e',
      orgId: user.orgId,
      createdAt: new Date(),
    })
    await seedLedgerOperation(request, user.orgId, 'tx-edit', {
      type: 'income',
      accountId: 'acc-edit',
      amount: 100,
      currency: 'PLN',
      date: '2026-10-05',
      description: 'Abonament',
      categoryId: 'cat-edit-income',
      counterpartyId: 'cp-edit',
      tags: ['q4', 'retainer'],
      accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' },
    })
    await page.goto(`/${user.orgId}/transactions`)
    await waitForShell(page, user.companyName)

    await page.getByRole('row').filter({ hasText: 'Abonament' }).getByRole('button', { name: /редагувати$/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Редагувати транзакцію', { exact: true })).toBeVisible()
    const panel = dialog.getByRole('tabpanel')
    // The stored category is still selected when the form opens (it is not reset on mount).
    await expect(panel.locator('select').nth(1)).toHaveValue('cat-edit-income')

    await panel.getByLabel('Сума', { exact: true }).fill('250')
    await dialog.getByRole('button', { name: 'Зберегти', exact: true }).click()
    await expect(dialog).toBeHidden()

    const fields = await readDoc(request, `organizations/${user.orgId}/transactions/tx-edit`)
    expect(fields, 'the operation is still stored').not.toBeNull()
    // The server stores integers: the REST read gives { integerValue: "25000" } (not in FirestoreValue), a seed gives doubles.
    const amountMinor = fields!.amountMinor as { integerValue?: string; doubleValue?: number }
    expect(Number(amountMinor.integerValue ?? amountMinor.doubleValue)).toBe(25000)
    expect(fields!.categoryId).toEqual({ stringValue: 'cat-edit-income' })
    expect(fields!.counterpartyId).toEqual({ stringValue: 'cp-edit' })
    expect(fields!.description).toEqual({ stringValue: 'Abonament' })
    expect(fields!.tags).toEqual({ arrayValue: { values: [{ stringValue: 'q4' }, { stringValue: 'retainer' }] } })
    expect(fields!.accrual).toEqual({
      mapValue: {
        fields: {
          mode: { stringValue: 'period' },
          from: { stringValue: '2026-10-01' },
          to: { stringValue: '2026-12-31' },
        },
      },
    })
  })

  test('a cross-currency transfer asks for both amounts', async ({ page, request }) => {
    const user = await registerViaUi(page, 'ledgerxfer', 'PLN')
    await waitForShell(page, user.companyName)
    await seedLedgerAccount(request, user.orgId, 'acc-pln', { name: 'Konto PLN', balance: 1000, currency: 'PLN' })
    await seedLedgerAccount(request, user.orgId, 'acc-eur', { name: 'Konto EUR', balance: 50, currency: 'EUR', color: '#6366f1' })
    await expect(accountRow(page, 'Konto EUR')).toBeVisible()
    await expect(accountRow(page, 'Konto PLN')).toBeVisible()

    await page.getByRole('button', { name: 'Переказ', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Нова транзакція', { exact: true })).toBeVisible()
    const panel = dialog.getByRole('tabpanel')
    const selects = panel.locator('select')
    await selects.nth(0).selectOption({ label: 'Konto PLN' })
    // Same-currency pairs never ask for the second amount; it appears only once both accounts differ in currency.
    await expect(panel.getByLabel('Сума зарахування', { exact: true })).toHaveCount(0)
    await selects.nth(1).selectOption({ label: 'Konto EUR' })
    const amountTo = panel.getByLabel('Сума зарахування', { exact: true })
    await expect(amountTo).toBeVisible()

    // Saving without it shows its error and writes nothing.
    await panel.getByLabel('Сума', { exact: true }).fill('440')
    await dialog.getByRole('button', { name: 'Додати', exact: true }).click()
    await expect(dialog.getByText('Вкажіть суму зарахування', { exact: true })).toBeVisible()
    await expect(dialog).toBeVisible()
    expect(await listDocs(request, `organizations/${user.orgId}/transactions`)).toHaveLength(0)

    // With both amounts the transfer moves both balances.
    await amountTo.fill('100')
    await dialog.getByRole('button', { name: 'Додати', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(accountRow(page, 'Konto PLN')).toContainText(balanceText('560', '00'))
    await expect(accountRow(page, 'Konto EUR')).toContainText(balanceText('150', '00'))
  })

  test('the browser cannot write operations directly', async ({ page, request }) => {
    const user = await registerViaUi(page, 'ledgerrules', 'PLN')
    await waitForShell(page, user.companyName)
    await seedLedgerAccount(request, user.orgId, 'acc-rules', { name: 'Rules', balance: 0, currency: 'PLN' })
    const { idToken } = await signInEmulatorUser(request, user.email, user.password)

    // The owner's own token, through the same REST surface the Firestore SDK uses: the rules refuse the write.
    const forged = {
      type: 'income',
      status: 'actual',
      accountId: 'acc-rules',
      amountMinor: 100,
      currency: 'PLN',
      paymentDate: '2026-01-01',
      accrual: { mode: 'date', date: '2026-01-01' },
      isRecurring: false,
      tags: [],
      fileUrls: [],
      schemaVersion: 2,
      orgId: user.orgId,
    }
    expect(await createDocAs(request, idToken, `organizations/${user.orgId}/transactions`, 'forged-tx', forged)).toBe(403)
    expect(await createDocAs(request, idToken, `organizations/${user.orgId}/accounts`, 'forged-acc', { name: 'x', orgId: user.orgId })).toBe(403)
    expect(await listDocs(request, `organizations/${user.orgId}/transactions`)).toHaveLength(0)
  })
})
