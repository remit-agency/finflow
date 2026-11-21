import { test, expect, type Browser, type Page } from '@playwright/test'
import { registerViaUi, waitForHydration, waitForShell, type RegisteredUser } from './helpers/app-ui'
import { signInEmulatorUser } from './helpers/emulator-auth'
import { deleteDoc, listDocs, readDoc, replaceDoc, seedMember, type FirestoreValue } from './helpers/emulator-firestore'
import { LEGAL_VERSIONS, type ConsentDoc } from '../../lib/legal/versions'

const NEEDS_EMULATORS =
  'Needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"'

const DRAFT_BANNER = 'Робоча версія: документ проходить юридичну перевірку і може змінитися.'

// Two section headings of each document, as written in content/legal/<doc>.uk.ts.
const PUBLIC_DOCS = [
  { doc: 'terms', title: 'Умови користування', headings: ['Визначення', 'Сервіс'] },
  { doc: 'privacy', title: 'Політика конфіденційності', headings: ['Контролер даних', 'Мета і правові підстави обробки'] },
  { doc: 'cookies', title: 'Політика cookies', headings: ['Що таке cookies і чому ми використовуємо лише два', 'Перелік cookies'] },
] as const

type Fields = Record<string, FirestoreValue>

/** The accepted version of `doc` in a raw `userConsents/{uid}` document; undefined when missing. */
function acceptedVersion(fields: Fields | null, doc: ConsentDoc): string | undefined {
  const entry = fields?.[doc]
  const version = entry && 'mapValue' in entry ? entry.mapValue.fields.version : undefined
  return version && 'stringValue' in version ? version.stringValue : undefined
}

/** The `source` of every event under `userConsents/{uid}/events` (one entry per document that changed). */
async function eventSources(request: Parameters<typeof listDocs>[0], uid: string): Promise<string[]> {
  const events = await listDocs(request, `userConsents/${uid}/events`)
  return events.map((e) => ('stringValue' in (e.fields.source ?? {}) ? (e.fields.source as { stringValue: string }).stringValue : ''))
}

// The uid of a user created through the UI: sign in over the Auth emulator's REST API.
async function uidOf(request: Parameters<typeof signInEmulatorUser>[0], user: RegisteredUser): Promise<string> {
  return (await signInEmulatorUser(request, user.email, user.password)).uid
}

// Wait until registration has written the consent record, so a later delete or replace cannot be overtaken by it.
async function waitForConsentRecord(request: Parameters<typeof readDoc>[0], uid: string): Promise<void> {
  await expect.poll(async () => (await readDoc(request, `userConsents/${uid}`)) !== null).toBe(true)
}

// «Мої рахунки» is rendered by the accounts sidebar only once the membership has been read and the access is granted.
async function waitForAccess(page: Page): Promise<void> {
  await expect(page.getByRole('complementary', { name: 'Рахунки' }).getByRole('heading', { name: 'Мої рахунки' })).toBeVisible()
}

// A second signed-in user in a separate browser context (own cookies).
async function registerSecondUser(browser: Browser, prefix: string): Promise<{ page: Page; user: RegisteredUser; close: () => Promise<void> }> {
  const context = await browser.newContext()
  const page = await context.newPage()
  const user = await registerViaUi(page, prefix)
  return { page, user, close: () => context.close() }
}

// The legal pages are public and static: no emulators and no signed-in user are needed.
test.describe('legal pages', () => {
  for (const { doc, title, headings } of PUBLIC_DOCS) {
    test(`/legal/${doc} opens without signing in, with the draft banner and its sections`, async ({ page }) => {
      await page.goto(`/legal/${doc}`)

      await expect(page).toHaveURL(new RegExp(`/legal/${doc}$`))
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
      await expect(page.getByText(DRAFT_BANNER)).toBeVisible()
      for (const heading of headings) {
        await expect(page.getByRole('heading', { level: 2, name: heading, exact: true })).toBeVisible()
      }
    })
  }
})

test.describe('consents (emulators)', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test('the registration button stays disabled until the Terms checkbox is ticked', async ({ page }) => {
    await page.goto('/register')
    await waitForHydration(page, '#name')
    const submit = page.getByRole('button', { name: 'Спробувати 14 днів безкоштовно' })
    const accept = page.getByRole('checkbox', { name: /Умови користування/ })

    await expect(submit).toBeDisabled()
    await accept.check()
    await expect(submit).toBeEnabled()
    await accept.uncheck()
    await expect(submit).toBeDisabled()
  })

  test('registering records the current versions of the Terms and the Privacy Policy', async ({ page, request }) => {
    const user = await registerViaUi(page, 'consentreg')
    const uid = await uidOf(request, user)

    await waitForConsentRecord(request, uid)
    const fields = await readDoc(request, `userConsents/${uid}`)
    expect(acceptedVersion(fields, 'terms')).toBe(LEGAL_VERSIONS.terms)
    expect(acceptedVersion(fields, 'privacy')).toBe(LEGAL_VERSIONS.privacy)
    expect(await eventSources(request, uid)).toEqual(['register', 'register'])
  })

  test('a signed-in user without a consent record must accept in the blocking dialog', async ({ page, request }) => {
    const user = await registerViaUi(page, 'consentgate')
    const uid = await uidOf(request, user)
    await waitForConsentRecord(request, uid)
    await deleteDoc(request, `userConsents/${uid}`)

    await page.goto(`/${user.orgId}/transactions`)
    const gate = page.getByTestId('consent-gate')
    await expect(gate).toBeVisible()
    await expect(gate.getByRole('button', { name: 'Вийти' })).toBeVisible()

    await gate.getByRole('button', { name: 'Приймаю' }).click()
    await expect(gate).toBeHidden()

    await expect.poll(async () => acceptedVersion(await readDoc(request, `userConsents/${uid}`), 'terms')).toBe(LEGAL_VERSIONS.terms)
    expect(acceptedVersion(await readDoc(request, `userConsents/${uid}`), 'privacy')).toBe(LEGAL_VERSIONS.privacy)
    // The two events written at registration stay; accepting at the gate adds one per document.
    await expect.poll(async () => (await eventSources(request, uid)).filter((s) => s === 'gate')).toEqual(['gate', 'gate'])
  })

  test('the dialog asks again when the stored version of a document is old', async ({ page, request }) => {
    const user = await registerViaUi(page, 'consentold')
    const uid = await uidOf(request, user)
    await waitForConsentRecord(request, uid)
    const at = new Date().toISOString()
    await replaceDoc(request, `userConsents/${uid}`, {
      terms: { version: '2020-01-01', at, locale: 'uk' },
      privacy: { version: LEGAL_VERSIONS.privacy, at, locale: 'uk' },
    })

    await page.goto(`/${user.orgId}/transactions`)
    const gate = page.getByTestId('consent-gate')
    await expect(gate).toBeVisible()

    await gate.getByRole('button', { name: 'Приймаю' }).click()
    await expect(gate).toBeHidden()
    await expect.poll(async () => acceptedVersion(await readDoc(request, `userConsents/${uid}`), 'terms')).toBe(LEGAL_VERSIONS.terms)
  })

  test('Settings → «Приватність і дані» shows the accepted documents and the export button to the owner', async ({ page }) => {
    const user = await registerViaUi(page, 'privowner')

    await page.goto(`/${user.orgId}/settings/company`)
    await page.getByRole('complementary', { name: 'Налаштування' }).getByRole('link', { name: 'Приватність і дані' }).click()
    await page.waitForURL(/\/settings\/privacy$/)

    const card = page.getByTestId('consent-card')
    await expect(card).toContainText('Прийняті документи')
    await expect(card).toContainText(`версія ${LEGAL_VERSIONS.terms}`)
    await expect(card.getByRole('link', { name: 'Умови користування' })).toBeVisible()
    await expect(card.getByRole('link', { name: 'Політика конфіденційності' })).toBeVisible()
    await expect(page.getByTestId('export-card')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Завантажити всі дані' })).toBeVisible()
  })

  test('an accountant sees the accepted documents but no export button', async ({ page, browser, request }) => {
    const owner = await registerViaUi(page, 'privown')
    const second = await registerSecondUser(browser, 'privacc')
    try {
      const ownerUid = await uidOf(request, owner)
      const accountantUid = await uidOf(request, second.user)
      await seedMember(request, owner.orgId, accountantUid, 'accountant', ownerUid)

      const a = second.page
      await a.goto(`/${owner.orgId}/transactions`)
      await waitForShell(a, owner.companyName)
      await waitForAccess(a)
      await a.goto(`/${owner.orgId}/settings/privacy`)

      await expect(a.getByTestId('consent-card')).toContainText('Прийняті документи')
      await waitForShell(a, owner.companyName)
      await a.waitForTimeout(1_000) // the role comes from a live read: give the owner-only card the time it would need to appear
      await expect(a.getByTestId('export-card')).toHaveCount(0)
      await expect(a.getByRole('button', { name: 'Завантажити всі дані' })).toHaveCount(0)
    } finally {
      await second.close()
    }
  })
})
