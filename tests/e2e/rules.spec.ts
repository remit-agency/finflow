// tests/e2e/rules.spec.ts
// Auto-rules (S10) against the fake bank (tests/e2e/helpers/eb-stub.mjs): its three operations are a "Klient Sp. z o.o."
// income, a "Landlord" expense with the remittance "Czynsz" and an "Orlen" expense with the remittance "Paliwo".
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { registerViaUi, waitForShell, type RegisteredUser } from './helpers/app-ui'
import { dayFromToday, seedConnection, seedLinkedBankAccount } from './helpers/bank-seed'
import { seedDoc } from './helpers/emulator-firestore'
import { seedLedgerAccount } from './helpers/ledger-seed'

const NEEDS_EMULATORS =
  'Needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npx playwright test"'

const rowsOf = (page: Page): Locator => page.locator('tbody').getByRole('row').filter({ has: page.getByRole('checkbox') })
const toast = (page: Page, text: string): Locator => page.locator('[data-sonner-toast]').filter({ hasText: text })

/** A PLN company with the FinFlow account the bank account is linked to and one expense category. */
async function setup(page: Page, request: APIRequestContext, prefix: string, category: { id: string; name: string }): Promise<RegisteredUser> {
  const user = await registerViaUi(page, prefix, 'PLN')
  await waitForShell(page, user.companyName)
  await seedLedgerAccount(request, user.orgId, 'acc-bank', { name: 'Fake Bank PLN', balance: 0, currency: 'PLN' })
  await seedDoc(request, `organizations/${user.orgId}/categories`, category.id, { name: category.name, type: 'expense', color: '#ef4444', orgId: user.orgId, createdAt: new Date() })
  return user
}

/** After this the next app page load imports the fake bank's three operations (the auto-sync of S09). */
async function linkBank(request: APIRequestContext, orgId: string): Promise<void> {
  await seedConnection(request, orgId, dayFromToday(60))
  await seedLinkedBankAccount(request, orgId, 'acc-bank')
}

test.describe('auto-rules (emulators + fake bank)', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test('a rule made in settings gives the imported bank operation its category, and the journal says so', async ({ page, request }) => {
    const user = await setup(page, request, 'rl-import', { id: 'cat-exp-fuel', name: 'Paliwo' })

    await page.goto(`/${user.orgId}/settings/rules`)
    await expect(page.getByText('Правил ще немає')).toBeVisible()
    await page.getByRole('button', { name: 'Додати правило' }).click()
    const editor = page.getByRole('dialog')
    await editor.locator('#rule-name').fill('Паливо Orlen')
    await editor.locator('#rule-cond-0-values').fill('orlen, bp-stacja')
    await editor.locator('#rule-category').selectOption({ label: 'Paliwo' })
    await editor.getByRole('button', { name: 'Зберегти', exact: true }).click()
    await expect(toast(page, 'Правило збережено')).toBeVisible()
    await expect(editor).toBeHidden()
    const row = page.getByTestId('rule-row')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Паливо Orlen')
    await expect(row).toContainText('містить orlen, bp-stacja')

    await linkBank(request, user.orgId)
    await page.goto(`/${user.orgId}/transactions`)
    await expect(rowsOf(page)).toHaveCount(3)
    const fuel = rowsOf(page).filter({ hasText: 'Orlen' })
    await expect(fuel.getByTestId('rule-chip')).toHaveText('за правилом: Паливо Orlen')
    await expect(page.getByTestId('rule-chip')).toHaveCount(1)

    // Below md the category column (and the chip in it) is hidden: a phone gets the same note as a plain line.
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(rowsOf(page).filter({ hasText: 'Orlen' }).getByTestId('rule-note')).toHaveText('за правилом: Паливо Orlen')
  })

  test('«Застосувати до наявних» shows how many operations change, then fills them', async ({ page, request }) => {
    // Not «Czynsz»: that is a default Polish category name and the Ukrainian UI would show it translated.
    const user = await setup(page, request, 'rl-apply', { id: 'cat-exp-rent', name: 'Najem biura' })
    await linkBank(request, user.orgId)
    await page.goto(`/${user.orgId}/transactions`)
    await expect(rowsOf(page)).toHaveCount(3)
    await expect(page.getByTestId('rule-chip')).toHaveCount(0)

    // A rule in the exact shape the server stores (lib/domain/rules/doc.ts), made after the import.
    await seedDoc(request, `organizations/${user.orgId}/rules`, 'rule-rent', {
      schemaVersion: 1,
      orgId: user.orgId,
      name: 'Czynsz',
      type: 'expense',
      active: true,
      order: 0,
      conditions: [{ kind: 'text', op: 'contains', values: ['czynsz'] }],
      actions: { categoryId: 'cat-exp-rent' },
      createdAt: new Date(),
      createdBy: 'e2e',
      updatedAt: new Date(),
    })

    await page.goto(`/${user.orgId}/settings/rules`)
    await expect(page.getByTestId('rule-row')).toContainText('Czynsz')
    await page.getByRole('button', { name: 'Застосувати до наявних' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('rules-apply-state')).toContainText('Буде змінено операцій: 1')
    await dialog.getByTestId('rules-apply-confirm').click()
    await expect(dialog.getByTestId('rules-apply-state')).toContainText('Змінено операцій: 1')
    await dialog.getByTestId('rules-apply-close').click()
    await expect(dialog).toBeHidden()

    await page.goto(`/${user.orgId}/transactions`)
    const rent = rowsOf(page).filter({ hasText: 'Landlord' })
    await expect(rent.getByTestId('rule-chip')).toHaveText('за правилом: Czynsz')
    await expect(rent).toContainText('Najem biura')
    await expect(page.getByTestId('rule-chip')).toHaveCount(1)
  })
})
