import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { registerViaUi, waitForShell, type RegisteredUser } from './helpers/app-ui'
import { listDocs, readDoc, type FirestoreValue } from './helpers/emulator-firestore'
import { seedLedgerAccount } from './helpers/ledger-seed'
import { todayDay } from '../../lib/utils/today'
import en from '../../messages/en.json'
import pl from '../../messages/pl.json'

const NEEDS_EMULATORS =
  'Needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"'

type Fields = Record<string, FirestoreValue>

/** `2 234,60` as the app prints it: the uk-UA group separator is a no-break space, so any whitespace matches. */
function balanceText(whole: string, fraction: string): RegExp {
  return new RegExp(`${whole.replace(/\s/g, '\\s')},${fraction}`)
}

function accountRow(page: Page, name: string): Locator {
  return page.getByRole('complementary', { name: 'Рахунки' }).getByRole('listitem').filter({ hasText: name })
}

/** The transaction form, not a confirmation or the counterparty dialog opened over it. */
function formDialog(page: Page): Locator {
  return page.getByRole('dialog').filter({ has: page.locator('#tx-amount') })
}

function confirmDialog(page: Page, title: string): Locator {
  return page.getByRole('dialog').filter({ hasText: title })
}

function toast(page: Page, text: string): Locator {
  return page.locator('[data-sonner-toast]').filter({ hasText: text })
}

function plusDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function str(field: FirestoreValue | undefined): string | undefined {
  return field && 'stringValue' in field ? field.stringValue : undefined
}

/** The server stores integers: the REST read gives { integerValue }, which `FirestoreValue` does not list. */
function minorOf(fields: Fields): number {
  const value = fields.amountMinor as { integerValue?: string; doubleValue?: number }
  return Number(value.integerValue ?? value.doubleValue)
}

function transactions(request: APIRequestContext, user: RegisteredUser) {
  return listDocs(request, `organizations/${user.orgId}/transactions`)
}

/** A company in PLN with accounts; the sidebar shows them before the test goes on. */
async function setup(
  page: Page,
  request: APIRequestContext,
  prefix: string,
  accounts: { id: string; name: string; balance: number; currency: string }[] = [
    { id: 'acc-main', name: 'Konto PLN', balance: 1000, currency: 'PLN' },
  ],
): Promise<RegisteredUser> {
  const user = await registerViaUi(page, prefix, 'PLN')
  await waitForShell(page, user.companyName)
  for (const account of accounts) {
    await seedLedgerAccount(request, user.orgId, account.id, account)
  }
  for (const account of accounts) {
    await expect(accountRow(page, account.name)).toBeVisible()
  }
  return user
}

async function openNewForm(page: Page, kind: 'Дохід' | 'Витрата' | 'Переказ'): Promise<Locator> {
  await page.getByRole('button', { name: kind, exact: true }).click()
  const dialog = formDialog(page)
  await expect(dialog.getByText('Нова транзакція', { exact: true })).toBeVisible()
  return dialog
}

/** Creates an expense through the form; `date` is the payment day when given. */
async function createExpense(page: Page, amount: string, description: string, date?: string): Promise<void> {
  const dialog = await openNewForm(page, 'Витрата')
  await dialog.locator('#tx-amount').fill(amount)
  await dialog.locator('#tx-desc').fill(description)
  if (date) await dialog.locator('#tx-date').fill(date)
  await dialog.getByRole('button', { name: 'Додати', exact: true }).click()
  await expect(dialog).toBeHidden()
}

async function openRow(page: Page, description: string): Promise<Locator> {
  await page.getByRole('row').filter({ hasText: description }).click()
  const dialog = formDialog(page)
  await expect(dialog.getByText('Редагувати транзакцію', { exact: true })).toBeVisible()
  return dialog
}

test.describe('transaction form (emulators)', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test('dates can be typed by hand as DD.MM.YYYY', async ({ page, request }) => {
    const user = await setup(page, request, 'txf-typed-dates')
    const dialog = await openNewForm(page, 'Витрата')

    await dialog.locator('#tx-amount').fill('50')
    await dialog.getByRole('checkbox', { name: 'Дата транзакції інша' }).check()
    // Digits only: the dots appear by themselves, and a click selects the prefilled date so typing replaces it.
    const accrual = dialog.locator('#tx-accrual-date')
    await accrual.click()
    await accrual.pressSequentially('01102026')
    await expect(accrual).toHaveValue('01.10.2026')
    // A date that does not exist is refused instead of being guessed.
    await accrual.fill('')
    await accrual.pressSequentially('31022026')
    await dialog.getByRole('button', { name: 'Додати', exact: true }).click()
    await expect(dialog).toBeVisible()
    expect(await transactions(request, user)).toHaveLength(0)

    await accrual.fill('')
    await accrual.pressSequentially('01102026')
    await dialog.getByRole('button', { name: 'Додати', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await transactions(request, user)).length).toBe(1)
  })

  test('an expense with a period and a new counterparty', async ({ page, request }) => {
    const user = await setup(page, request, 'txf-period')
    const dialog = await openNewForm(page, 'Витрата')

    await dialog.locator('#tx-amount').fill('250')
    await dialog.getByRole('checkbox', { name: 'Дата транзакції інша' }).check()
    await dialog.getByRole('radiogroup', { name: 'Тип дати транзакції' }).getByRole('radio', { name: 'Період' }).click()
    await dialog.locator('#tx-accrual-from').fill('2026-10-01')
    await dialog.locator('#tx-accrual-to').fill('2026-12-31')

    const picker = dialog.getByRole('combobox', { name: 'Контрагент', exact: true })
    await picker.fill('Orange')
    await page.getByRole('option', { name: 'Додати контрагента' }).click()

    const counterpartyDialog = confirmDialog(page, 'Новий контрагент')
    await expect(counterpartyDialog.getByLabel('Назва', { exact: true })).toHaveValue('Orange')
    await counterpartyDialog.getByRole('button', { name: 'Зберегти', exact: true }).click()
    await expect(counterpartyDialog).toBeHidden()
    // Focus returns to the picker and opens its list, which shows the new counterparty as the chosen option.
    await expect(page.getByRole('option', { name: 'Orange' })).toHaveAttribute('aria-selected', 'true')
    await dialog.locator('#tx-desc').click()
    await expect(picker).toHaveValue('Orange')

    await dialog.getByRole('button', { name: 'Додати', exact: true }).click()
    await expect(dialog).toBeHidden()

    await expect.poll(async () => (await transactions(request, user)).length).toBe(1)
    const counterparties = await listDocs(request, `organizations/${user.orgId}/counterparties`)
    const orange = counterparties.find((c) => str(c.fields.name) === 'Orange')
    expect(orange, 'the new counterparty is stored').toBeDefined()
    const [doc] = await transactions(request, user)
    expect(doc.fields.counterpartyId).toEqual({ stringValue: orange!.id })
    expect(doc.fields.accrual).toEqual({
      mapValue: {
        fields: {
          mode: { stringValue: 'period' },
          from: { stringValue: '2026-10-01' },
          to: { stringValue: '2026-12-31' },
        },
      },
    })
    expect(minorOf(doc.fields)).toBe(25000)
    await expect(accountRow(page, 'Konto PLN')).toContainText(balanceText('750', '00'))
  })

  test('a future date makes the operation planned and does not touch the balance', async ({ page, request }) => {
    const user = await setup(page, request, 'txf-future')
    const dialog = await openNewForm(page, 'Витрата')

    await dialog.locator('#tx-date').fill(plusDays(todayDay(), 30))
    const status = dialog.getByRole('radiogroup', { name: 'Статус' })
    await expect(status.getByRole('radio', { name: 'Факт' })).toBeDisabled()
    await expect(status.getByRole('radio', { name: 'План' })).toHaveAttribute('aria-checked', 'true')
    await expect(dialog.getByText('Платіж у майбутньому записується як плановий')).toBeVisible()

    await dialog.locator('#tx-amount').fill('100')
    await dialog.locator('#tx-desc').fill('Przyszły wydatek')
    await dialog.getByRole('button', { name: 'Додати', exact: true }).click()
    await expect(dialog).toBeHidden()

    await expect.poll(async () => (await transactions(request, user)).length).toBe(1)
    const [doc] = await transactions(request, user)
    expect(doc.fields.status).toEqual({ stringValue: 'planned' })
    await expect(accountRow(page, 'Konto PLN')).toContainText(balanceText('1 000', '00'))

    // The journal lists it as planned (chip, dimmed row) and keeps it out of the day sum: the day's header has no amount.
    const row = page.getByRole('row').filter({ hasText: 'Przyszły wydatek' })
    await expect(row).toHaveAttribute('data-status', 'planned')
    await expect(row.getByText('План', { exact: true })).toBeVisible()
    const dayHeader = row.locator('xpath=ancestor::tbody').locator('th[scope="rowgroup"]')
    await expect(dayHeader).toHaveCount(1)
    await expect(dayHeader).not.toContainText(/\d,\d\d/)
  })

  test('a planned operation can be marked as paid', async ({ page, request }) => {
    const user = await setup(page, request, 'txf-paid')
    await createExpense(page, '100', 'Plan do zapłaty', plusDays(todayDay(), 30))
    await expect.poll(async () => (await transactions(request, user)).length).toBe(1)
    await expect(accountRow(page, 'Konto PLN')).toContainText(balanceText('1 000', '00'))

    const dialog = await openRow(page, 'Plan do zapłaty')
    await dialog.getByRole('button', { name: 'Позначити сплаченою', exact: true }).click()
    await expect(dialog.getByRole('radiogroup', { name: 'Статус' }).getByRole('radio', { name: 'Факт' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    const today = todayDay()
    await expect(dialog.locator('#tx-date')).toHaveValue(today.split('-').reverse().join('.'))
    await dialog.getByRole('button', { name: 'Зберегти', exact: true }).click()
    await expect(dialog).toBeHidden()

    await expect(accountRow(page, 'Konto PLN')).toContainText(balanceText('900', '00'))
    const [doc] = await transactions(request, user)
    expect(doc.fields.status).toEqual({ stringValue: 'actual' })
    expect(doc.fields.paymentDate).toEqual({ stringValue: today })
  })

  test('delete asks first and can be undone', async ({ page, request }) => {
    const user = await setup(page, request, 'txf-delete')
    await createExpense(page, '100', 'Do usunięcia')
    const row = page.getByRole('row').filter({ hasText: 'Do usunięcia' })
    await expect(row).toBeVisible()
    await expect(accountRow(page, 'Konto PLN')).toContainText(balanceText('900', '00'))
    const [stored] = await transactions(request, user)

    const dialog = await openRow(page, 'Do usunięcia')
    await dialog.getByRole('button', { name: 'Видалити', exact: true }).click()
    const ask = confirmDialog(page, 'Видалити операцію?')
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: 'Скасувати', exact: true }).click()
    await expect(ask).toBeHidden()
    // The form stays where it was.
    await expect(page.locator('#tx-amount')).toBeVisible()
    expect(await transactions(request, user)).toHaveLength(1)

    await dialog.getByRole('button', { name: 'Видалити', exact: true }).click()
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: 'Видалити', exact: true }).click()
    await expect(page.locator('#tx-amount')).toHaveCount(0)
    await expect(row).toHaveCount(0)
    await expect(accountRow(page, 'Konto PLN')).toContainText(balanceText('1 000', '00'))

    const deleted = toast(page, 'Операцію видалено')
    await expect(deleted).toBeVisible()
    await deleted.getByRole('button', { name: 'Скасувати', exact: true }).click()
    await expect(row).toBeVisible()
    await expect(accountRow(page, 'Konto PLN')).toContainText(balanceText('900', '00'))
    const restored = await readDoc(request, `organizations/${user.orgId}/transactions/${stored.id}`)
    expect(restored, 'the same document is back').not.toBeNull()
    expect(str(restored!.description)).toBe('Do usunięcia')
  })

  test('an edit can be undone', async ({ page, request }) => {
    const user = await setup(page, request, 'txf-undo-edit')
    await createExpense(page, '100', 'Do zmiany')
    const row = page.getByRole('row').filter({ hasText: 'Do zmiany' })
    await expect(row).toContainText(/100,00/)
    await expect(accountRow(page, 'Konto PLN')).toContainText(balanceText('900', '00'))

    const dialog = await openRow(page, 'Do zmiany')
    await dialog.locator('#tx-amount').fill('40')
    await dialog.getByRole('button', { name: 'Зберегти', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(row).toContainText(/40,00/)
    await expect(accountRow(page, 'Konto PLN')).toContainText(balanceText('960', '00'))

    const saved = toast(page, 'Зміни збережено')
    await expect(saved).toBeVisible()
    await saved.getByRole('button', { name: 'Скасувати', exact: true }).click()
    await expect(row).toContainText(/100,00/)
    await expect(accountRow(page, 'Konto PLN')).toContainText(balanceText('900', '00'))
    const [doc] = await transactions(request, user)
    expect(minorOf(doc.fields)).toBe(10000)
  })

  test('closing a changed form asks first', async ({ page, request }) => {
    const user = await setup(page, request, 'txf-guard')
    const dialog = await openNewForm(page, 'Витрата')
    await dialog.locator('#tx-amount').fill('77')
    await dialog.locator('#tx-amount').press('Escape')

    const ask = confirmDialog(page, 'Закрити без збереження?')
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: 'Залишитись', exact: true }).click()
    await expect(ask).toBeHidden()
    await expect(page.locator('#tx-amount')).toHaveValue('77')

    await page.locator('#tx-amount').press('Escape')
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: 'Закрити', exact: true }).click()
    await expect(page.locator('#tx-amount')).toHaveCount(0)
    expect(await transactions(request, user)).toHaveLength(0)

    // An untouched form closes at once, without a question.
    const fresh = await openNewForm(page, 'Витрата')
    await fresh.locator('#tx-amount').press('Escape')
    await expect(page.locator('#tx-amount')).toHaveCount(0)
    await expect(ask).toHaveCount(0)
  })

  test('add and create similar keeps the account and clears the amount', async ({ page, request }) => {
    const user = await setup(page, request, 'txf-similar', [
      { id: 'acc-a', name: 'Konto A', balance: 500, currency: 'PLN' },
      { id: 'acc-b', name: 'Konto B', balance: 500, currency: 'PLN' },
    ])
    const dialog = await openNewForm(page, 'Витрата')
    await dialog.locator('#tx-account').selectOption({ label: 'Konto B' })
    await dialog.locator('#tx-amount').fill('10')
    await dialog.locator('#tx-desc').fill('x')
    await dialog.getByRole('button', { name: 'Додати та створити подібний', exact: true }).click()

    await expect.poll(async () => (await transactions(request, user)).length).toBe(1)
    await expect(dialog.locator('#tx-amount')).toHaveValue('')
    await expect(dialog.locator('#tx-desc')).toHaveValue('')
    await expect(dialog.locator('#tx-account')).toHaveValue('acc-b')

    await dialog.locator('#tx-amount').fill('20')
    await dialog.getByRole('button', { name: 'Додати', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await transactions(request, user)).length).toBe(2)
    const accountIds = (await transactions(request, user)).map((d) => str(d.fields.accountId))
    expect(accountIds).toEqual(['acc-b', 'acc-b'])
    await expect(accountRow(page, 'Konto B')).toContainText(balanceText('470', '00'))
  })

  test('a transfer across currencies shows the implied rate', async ({ page, request }) => {
    await setup(page, request, 'txf-rate', [
      { id: 'acc-pln', name: 'Konto PLN', balance: 1000, currency: 'PLN' },
      { id: 'acc-eur', name: 'Konto EUR', balance: 50, currency: 'EUR' },
    ])
    const dialog = await openNewForm(page, 'Переказ')
    await dialog.locator('#tx-account').selectOption({ label: 'Konto PLN' })
    await dialog.locator('#tx-account-to').selectOption({ label: 'Konto EUR' })
    await dialog.locator('#tx-amount').fill('440')
    await dialog.locator('#tx-amount-to').fill('100')
    await expect(dialog.getByText('Курс: 1 EUR = 4,4000 PLN', { exact: true })).toBeVisible()
  })

  test('a foreign amount shows an NBP hint', async ({ page, request }) => {
    const today = todayDay()
    await page.route('**/api/rates?**', (route) =>
      route.fulfill({
        json: { rate: 4.25, from: 'EUR', to: 'PLN', requestedDate: today, rateDate: plusDays(today, -1), tableNo: 'x', source: 'NBP_A' },
      }),
    )
    await setup(page, request, 'txf-nbp', [{ id: 'acc-eur', name: 'Konto EUR', balance: 50, currency: 'EUR' }])
    const dialog = await openNewForm(page, 'Витрата')
    await dialog.locator('#tx-amount').fill('100')
    const hint = dialog.getByText(/≈/)
    await expect(hint).toContainText(/425,00/)
    await expect(hint).toContainText('PLN')

    // Saving in EUR would ask the server for a real NBP rate, so the form is closed without saving.
    await dialog.locator('#tx-amount').press('Escape')
    await confirmDialog(page, 'Закрити без збереження?').getByRole('button', { name: 'Закрити', exact: true }).click()
    await expect(page.locator('#tx-amount')).toHaveCount(0)
  })

  test('the counterparty picker works in the form', async ({ page, request }) => {
    const user = await setup(page, request, 'txf-picker')
    await page.goto(`/${user.orgId}/settings/counterparties`)
    await expect(page.getByRole('heading', { name: 'Налаштування' })).toBeVisible()
    await page.getByRole('button', { name: 'Додати контрагента' }).click()
    await page.getByLabel('Назва', { exact: true }).fill('Alfa')
    await page.getByRole('button', { name: 'Зберегти' }).click()
    await expect(page.getByTestId('counterparty-row').filter({ hasText: 'Alfa' })).toBeVisible()

    await page.goto(`/${user.orgId}/transactions`)
    await waitForShell(page, user.companyName)
    await expect(accountRow(page, 'Konto PLN')).toBeVisible()
    const dialog = await openNewForm(page, 'Витрата')
    const picker = dialog.getByRole('combobox', { name: 'Контрагент', exact: true })
    await dialog.locator('#tx-amount').fill('5')

    await picker.click()
    await picker.fill('alf')
    // Typing highlights the first match; the arrows move the highlight (down: «add», up: back to Alfa).
    await picker.press('ArrowDown')
    await picker.press('ArrowUp')
    await picker.press('Enter')
    await expect(picker).toHaveAttribute('aria-expanded', 'false')
    await expect(picker).toHaveValue('Alfa')
    // Enter chose the counterparty and did not submit the form.
    await expect(dialog).toBeVisible()
    expect(await transactions(request, user)).toHaveLength(0)

    // «No counterparty» clears the choice.
    await dialog.locator('#tx-desc').click()
    await picker.click()
    await page.getByRole('option', { name: 'Без контрагента' }).click()
    await expect(picker).toHaveAttribute('aria-expanded', 'false')
    await expect(picker).toHaveValue('')
  })

  /** A company with one expense «Z kontrahentem» of 100 that has the counterparty «Alfa»; the journal is open. */
  async function setupWithCounterpartyExpense(page: Page, request: APIRequestContext, prefix: string): Promise<RegisteredUser> {
    const user = await setup(page, request, prefix)
    await page.goto(`/${user.orgId}/settings/counterparties`)
    await expect(page.getByRole('heading', { name: 'Налаштування' })).toBeVisible()
    await page.getByRole('button', { name: 'Додати контрагента' }).click()
    await page.getByLabel('Назва', { exact: true }).fill('Alfa')
    await page.getByRole('button', { name: 'Зберегти' }).click()
    await expect(page.getByTestId('counterparty-row').filter({ hasText: 'Alfa' })).toBeVisible()

    await page.goto(`/${user.orgId}/transactions`)
    await waitForShell(page, user.companyName)
    await expect(accountRow(page, 'Konto PLN')).toBeVisible()
    const dialog = await openNewForm(page, 'Витрата')
    await dialog.locator('#tx-amount').fill('100')
    await dialog.locator('#tx-desc').fill('Z kontrahentem')
    await dialog.getByRole('combobox', { name: 'Контрагент', exact: true }).click()
    await page.getByRole('option', { name: 'Alfa' }).click()
    await dialog.getByRole('button', { name: 'Додати', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('row').filter({ hasText: 'Z kontrahentem' })).toBeVisible()
    return user
  }

  test('Enter on a picker reached with Tab keeps the chosen counterparty', async ({ page, request }) => {
    await setupWithCounterpartyExpense(page, request, 'txf-picker-enter')
    const dialog = await openRow(page, 'Z kontrahentem')
    const picker = dialog.getByRole('combobox', { name: 'Контрагент', exact: true })

    await dialog.locator('#tx-category').focus()
    await page.keyboard.press('Tab')
    await expect(picker).toBeFocused()
    await expect(picker).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Enter')

    await expect(picker).toHaveAttribute('aria-expanded', 'false')
    await expect(picker).toHaveValue('Alfa')
    // Enter chose the highlighted (already chosen) counterparty; it neither cleared it nor submitted the form.
    await expect(dialog).toBeVisible()
  })

  test('a list that opens under a resting pointer keeps the highlight on the chosen counterparty', async ({ page, request }) => {
    await setupWithCounterpartyExpense(page, request, 'txf-picker-pointer')
    const dialog = await openRow(page, 'Z kontrahentem')
    const picker = dialog.getByRole('combobox', { name: 'Контрагент', exact: true })
    const none = page.getByRole('option', { name: 'Без контрагента' })

    // Leave the pointer where «none» opens, with the list closed (a click on the journal row can leave it there:
    // the CI runner's wider toolbar put the row exactly under it).
    await picker.focus()
    const box = await none.boundingBox()
    if (!box) throw new Error('the «none» option has no box')
    await page.keyboard.press('Escape')
    await expect(none).toHaveCount(0)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)

    await dialog.locator('#tx-category').focus()
    await page.keyboard.press('Tab')
    // The browser reports the pointer over «none» once the list is under it; two frames let the page react to that.
    await expect(page.locator('[role="option"]:hover')).toHaveText('Без контрагента')
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.keyboard.press('Enter')

    await expect(picker).toHaveAttribute('aria-expanded', 'false')
    await expect(picker).toHaveValue('Alfa')
  })

  test('Escape while the picker list is open closes only the list', async ({ page, request }) => {
    await setupWithCounterpartyExpense(page, request, 'txf-picker-esc')
    const dialog = await openRow(page, 'Z kontrahentem')
    const picker = dialog.getByRole('combobox', { name: 'Контрагент', exact: true })

    await picker.focus()
    await expect(picker).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(picker).toHaveAttribute('aria-expanded', 'false')
    // The form is untouched, so had Escape reached the dialog it would have closed at once.
    await expect(dialog).toBeVisible()
    await expect(picker).toHaveValue('Alfa')

    // With the list closed, Escape closes the form as usual.
    await page.keyboard.press('Escape')
    await expect(page.locator('#tx-amount')).toHaveCount(0)
  })

  test('Escape on the delete question closes only the question', async ({ page, request }) => {
    const user = await setup(page, request, 'txf-delete-esc')
    await createExpense(page, '100', 'Nie usuwać')
    const dialog = await openRow(page, 'Nie usuwać')

    await dialog.getByRole('button', { name: 'Видалити', exact: true }).click()
    const ask = confirmDialog(page, 'Видалити операцію?')
    await expect(ask).toBeVisible()
    // The question names the operation.
    await expect(ask).toContainText('Nie usuwać · ')
    await page.keyboard.press('Escape')
    await expect(ask).toBeHidden()
    await expect(dialog).toBeVisible()
    expect(await transactions(request, user)).toHaveLength(1)
  })

  test('a second edit of the same operation replaces the first undo toast', async ({ page, request }) => {
    await setup(page, request, 'txf-toast')
    await createExpense(page, '100', 'Dwie zmiany')
    const row = page.getByRole('row').filter({ hasText: 'Dwie zmiany' })

    const first = await openRow(page, 'Dwie zmiany')
    await first.locator('#tx-amount').fill('40')
    await first.getByRole('button', { name: 'Зберегти', exact: true }).click()
    await expect(first).toBeHidden()
    await expect(row).toContainText(/40,00/)
    await expect(toast(page, 'Зміни збережено')).toHaveCount(1)

    const second = await openRow(page, 'Dwie zmiany')
    await second.locator('#tx-amount').fill('30')
    await second.getByRole('button', { name: 'Зберегти', exact: true }).click()
    await expect(second).toBeHidden()
    await expect(row).toContainText(/30,00/)

    // One toast, and it is the newer one: its «undo» goes back to 40, never straight to 100.
    const saved = toast(page, 'Зміни збережено')
    await expect(saved).toHaveCount(1)
    await saved.getByRole('button', { name: 'Скасувати', exact: true }).click()
    await expect(row).toContainText(/40,00/)
  })

  test('the form renders in Polish and English without raw message keys', async ({ page, request }) => {
    const user = await setup(page, request, 'txf-i18n')
    await page.goto(`/${user.orgId}/settings/language`)
    await expect(page.getByRole('radio', { name: 'Polski', exact: true })).toBeVisible()

    for (const [radio, messages] of [
      ['Polski', pl],
      ['English', en],
    ] as const) {
      await page.getByRole('radio', { name: radio, exact: true }).click()
      await expect(page.getByRole('radio', { name: radio, exact: true })).toHaveAttribute('aria-checked', 'true')
      const form = messages.forms.transaction
      await page.getByRole('button', { name: messages.shell.header.expense, exact: true }).click()
      const dialog = formDialog(page)
      await expect(dialog.getByText(form.titleNew, { exact: true })).toBeVisible()
      await expect(dialog.getByLabel(form.date, { exact: true })).toBeVisible()
      await expect(dialog.getByRole('radiogroup', { name: form.status, exact: true })).toBeVisible()
      await expect(dialog.getByRole('combobox', { name: form.counterparty, exact: true })).toBeVisible()
      await expect(dialog.getByRole('checkbox', { name: form.accrualSwitch })).toBeVisible()
      await expect(dialog).not.toContainText('forms.transaction.')
      // The form is untouched, so Escape closes it without a question.
      await dialog.locator('#tx-amount').press('Escape')
      await expect(page.locator('#tx-amount')).toHaveCount(0)
    }
  })
})
