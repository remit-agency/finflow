import { test, expect, type Page } from '@playwright/test'
import { registerViaUi, waitForHydration, waitForShell } from './helpers/app-ui'

const NEEDS_EMULATORS =
  'Needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"'

test.describe('counterparties (emulators)', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  async function openPage(page: Page, orgId: string) {
    await page.goto(`/${orgId}/settings/counterparties`)
    await waitForHydration(page, 'input[type="checkbox"]')
    await expect(page.getByRole('heading', { name: 'Налаштування' })).toBeVisible()
  }

  test('a new company has ZUS and Urząd Skarbowy as system counterparties', async ({ page }) => {
    const user = await registerViaUi(page, 'cp-system')
    await waitForShell(page, user.companyName)
    await openPage(page, user.orgId)
    const rows = page.getByTestId('counterparty-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.filter({ hasText: 'ZUS' })).toContainText('Системний')
    await expect(rows.filter({ hasText: 'Urząd Skarbowy' })).toContainText('Системний')
  })

  test('creates a counterparty by hand, finds it by search, and refuses the same name again', async ({ page }) => {
    const user = await registerViaUi(page, 'cp-manual')
    await waitForShell(page, user.companyName)
    await openPage(page, user.orgId)

    await page.getByRole('button', { name: 'Додати контрагента' }).click()
    await page.getByLabel('Назва', { exact: true }).fill('Acme sp. z o.o.')
    await page.getByRole('button', { name: 'Зберегти' }).click()
    await expect(page.getByTestId('counterparty-row').filter({ hasText: 'Acme sp. z o.o.' })).toBeVisible()

    await page.getByPlaceholder('Пошук за назвою або NIP').fill('acme')
    await expect(page.getByTestId('counterparty-row')).toHaveCount(1)
    await page.getByPlaceholder('Пошук за назвою або NIP').fill('')

    await page.getByRole('button', { name: 'Додати контрагента' }).click()
    await page.getByLabel('Назва', { exact: true }).fill('ACME  SP Z O O')
    await page.getByRole('button', { name: 'Зберегти' }).click()
    await expect(page.getByText('Контрагент з такою назвою уже існує')).toBeVisible()

    await page.getByRole('button', { name: 'Відкрити' }).click()
    await expect(page.getByRole('heading', { name: 'Редагування контрагента' })).toBeVisible()
    await expect(page.getByLabel('Назва', { exact: true })).toHaveValue('Acme sp. z o.o.')
  })

  test('opens an ARCHIVED counterparty from the duplicate error', async ({ page }) => {
    const user = await registerViaUi(page, 'cp-dup-arch')
    await waitForShell(page, user.companyName)
    await openPage(page, user.orgId)

    await page.getByRole('button', { name: 'Додати контрагента' }).click()
    await page.getByLabel('Назва', { exact: true }).fill('Old Partner Ltd')
    await page.getByRole('button', { name: 'Зберегти' }).click()
    const row = page.getByTestId('counterparty-row').filter({ hasText: 'Old Partner Ltd' })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Редагувати Old Partner Ltd' }).click()
    await page.getByRole('button', { name: 'Архівувати' }).click()
    await expect(row).toHaveCount(0)

    await page.getByRole('button', { name: 'Додати контрагента' }).click()
    await page.getByLabel('Назва', { exact: true }).fill('Old Partner Ltd')
    await page.getByRole('button', { name: 'Зберегти' }).click()
    await expect(page.getByText('Контрагент з такою назвою уже існує')).toBeVisible()

    await page.getByRole('button', { name: 'Відкрити' }).click()
    await expect(page.getByRole('heading', { name: 'Редагування контрагента' })).toBeVisible()
    await expect(page.getByLabel('Назва', { exact: true })).toHaveValue('Old Partner Ltd')
    await expect(page.getByRole('button', { name: 'Відновити' })).toBeVisible()
  })

  test('fills the form from the white list by NIP and refuses a second counterparty with that NIP', async ({ page }) => {
    const user = await registerViaUi(page, 'cp-nip')
    await waitForShell(page, user.companyName)
    await openPage(page, user.orgId)

    await page.getByRole('button', { name: 'Додати контрагента' }).click()
    await page.getByLabel('NIP', { exact: true }).fill('774-000-14-54')
    await page.getByRole('button', { name: 'Заповнити з білого списку' }).click()
    await expect(page.getByLabel('Назва', { exact: true })).toHaveValue('ORLEN SPÓŁKA AKCYJNA')
    await expect(page.getByLabel('Адреса', { exact: true })).toHaveValue('CHEMIKÓW 7, 09-411 PŁOCK')
    await expect(page.getByTestId('cp-vat')).toContainText('Платник ПДВ')
    await expect(page.getByLabel('Банківські рахунки')).toHaveValue('61109010140000071219812874')
    await page.getByRole('button', { name: 'Зберегти' }).click()

    const row = page.getByTestId('counterparty-row').filter({ hasText: 'ORLEN' })
    await expect(row).toContainText('NIP 7740001454')
    await expect(row).toContainText('Платник ПДВ')

    await page.getByRole('button', { name: 'Додати контрагента' }).click()
    await page.getByLabel('Назва', { exact: true }).fill('Another name')
    await page.getByLabel('NIP', { exact: true }).fill('7740001454')
    await page.getByRole('button', { name: 'Зберегти' }).click()
    await expect(page.getByText('Контрагент з таким NIP уже існує')).toBeVisible()
  })

  test('a VAT status looked up while editing is saved', async ({ page }) => {
    const user = await registerViaUi(page, 'cp-edit-lookup')
    await waitForShell(page, user.companyName)
    await openPage(page, user.orgId)

    await page.getByRole('button', { name: 'Додати контрагента' }).click()
    await page.getByLabel('Назва', { exact: true }).fill('Fuel Partner')
    await page.getByRole('button', { name: 'Зберегти' }).click()
    const row = page.getByTestId('counterparty-row').filter({ hasText: 'Fuel Partner' })
    await expect(row).toBeVisible()

    await row.getByRole('button', { name: 'Редагувати Fuel Partner' }).click()
    await page.getByLabel('NIP', { exact: true }).fill('774-000-14-54')
    await page.getByRole('button', { name: 'Заповнити з білого списку' }).click()
    await expect(page.getByTestId('cp-vat')).toContainText('Платник ПДВ')
    await page.getByRole('button', { name: 'Зберегти' }).click()

    const saved = page.getByTestId('counterparty-row').filter({ hasText: 'NIP 7740001454' })
    await expect(saved).toBeVisible()
    await expect(saved).toContainText('Платник ПДВ')
  })

  test('saving an edit form without changes closes it without an error', async ({ page }) => {
    const user = await registerViaUi(page, 'cp-edit-same')
    await waitForShell(page, user.companyName)
    await openPage(page, user.orgId)

    await page.getByRole('button', { name: 'Додати контрагента' }).click()
    await page.getByLabel('Назва', { exact: true }).fill('Same NIP Ltd')
    await page.getByLabel('NIP', { exact: true }).fill('5252344078')
    await page.getByRole('button', { name: 'Зберегти' }).click()
    const row = page.getByTestId('counterparty-row').filter({ hasText: 'Same NIP Ltd' })
    await expect(row).toContainText('NIP 5252344078')

    await row.getByRole('button', { name: 'Редагувати Same NIP Ltd' }).click()
    await page.getByRole('button', { name: 'Зберегти' }).click()
    await expect(page.getByRole('heading', { name: 'Редагування контрагента' })).toHaveCount(0)
    await expect(page.getByText('Не вдалося зберегти контрагента')).toHaveCount(0)
  })

  test('a NIP that is not in the register says so and leaves the form for manual entry', async ({ page }) => {
    const user = await registerViaUi(page, 'cp-unknown')
    await waitForShell(page, user.companyName)
    await openPage(page, user.orgId)

    await page.getByRole('button', { name: 'Додати контрагента' }).click()
    await page.getByLabel('NIP', { exact: true }).fill('5252344078')
    await page.getByRole('button', { name: 'Заповнити з білого списку' }).click()
    await expect(page.getByText('Цього NIP немає в реєстрі ПДВ. Заповніть дані вручну.')).toBeVisible()
    await expect(page.getByLabel('Назва', { exact: true })).toHaveValue('')
  })

  test('refuses an invalid NIP and an invalid account number before saving', async ({ page }) => {
    const user = await registerViaUi(page, 'cp-invalid')
    await waitForShell(page, user.companyName)
    await openPage(page, user.orgId)

    await page.getByRole('button', { name: 'Додати контрагента' }).click()
    await page.getByLabel('Назва', { exact: true }).fill('Bad Data Ltd')
    await page.getByLabel('NIP', { exact: true }).fill('1234567890')
    await page.getByRole('button', { name: 'Зберегти' }).click()
    await expect(page.getByText('Вкажіть правильний NIP')).toBeVisible()

    await page.getByLabel('NIP', { exact: true }).fill('')
    await page.getByRole('button', { name: 'Додати рахунок' }).click()
    await page.getByLabel('Банківські рахунки').fill('123')
    await page.getByRole('button', { name: 'Зберегти' }).click()
    await expect(page.getByText('Вкажіть правильний номер рахунку')).toBeVisible()
  })

  test('archives a counterparty, hides it, shows it on request and restores it', async ({ page }) => {
    const user = await registerViaUi(page, 'cp-archive')
    await waitForShell(page, user.companyName)
    await openPage(page, user.orgId)

    await page.getByRole('button', { name: 'Додати контрагента' }).click()
    await page.getByLabel('Назва', { exact: true }).fill('Temporary Ltd')
    await page.getByRole('button', { name: 'Зберегти' }).click()
    const row = page.getByTestId('counterparty-row').filter({ hasText: 'Temporary Ltd' })
    await expect(row).toBeVisible()

    await row.getByRole('button', { name: 'Редагувати Temporary Ltd' }).click()
    await page.getByRole('button', { name: 'Архівувати' }).click()
    await expect(row).toHaveCount(0)

    await page.getByLabel('Показати архівних').check()
    await expect(row).toContainText('В архіві')
    await row.getByRole('button', { name: 'Редагувати Temporary Ltd' }).click()
    await page.getByRole('button', { name: 'Відновити' }).click()
    await page.getByLabel('Показати архівних').uncheck()
    await expect(row).toBeVisible()
    await expect(row).not.toContainText('В архіві')
  })
})
