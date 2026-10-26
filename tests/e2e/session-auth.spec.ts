import { test, expect, type Page } from '@playwright/test'
import { createEmulatorUser, verifyEmailInEmulator } from './helpers/emulator-auth'

const ORIGIN = 'http://localhost:3000'
const PASSWORD = 'session-pass-123'
const NEEDS_EMULATORS =
  'Needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"'

// Filling a controlled input before React hydrates loses the value, so wait for hydration.
async function waitForHydration(page: Page, selector: string): Promise<void> {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel)
    return !!el && Object.keys(el).some((k) => k.startsWith('__reactProps$'))
  }, selector)
}

async function registerViaUi(page: Page): Promise<{ email: string; orgId: string; companyName: string }> {
  const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const email = `session-${runId}@finflow.test`
  const companyName = `Session Co ${runId}`
  await page.goto('/register')
  await waitForHydration(page, '#name')
  await page.getByLabel('Ваше ім\'я', { exact: true }).fill('Session Tester')
  await page.getByLabel('Електронна пошта', { exact: true }).fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Назва компанії', { exact: true }).fill(companyName)
  await page.getByRole('button', { name: 'Спробувати 14 днів безкоштовно' }).click()
  await page.waitForURL(/\/[A-Za-z0-9]{20}\/transactions$/)
  return { email, orgId: new URL(page.url()).pathname.split('/')[1], companyName }
}

/** Fills the login form on the page that is already open (keeps its ?redirect=). */
async function signInViaLoginForm(page: Page, email: string): Promise<void> {
  await waitForHydration(page, '#email')
  await page.getByLabel('Електронна пошта', { exact: true }).fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Увійти', exact: true }).click()
}

/** Sign-out from the header profile menu; the AuthProvider performs the hard redirect to plain /login. */
async function signOutViaProfileMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Профіль' }).click()
  await page.getByRole('menuitem', { name: 'Вийти' }).click()
  await page.waitForURL(/\/login$/)
}

const VICTIM_BODY = { aspspName: 'Bank Millennium', aspspCountry: 'PL', orgId: 'victim-org' }

test.describe('server session (emulators)', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test('a forged __session cookie is rejected by the proxy and cleared', async ({ page, context }) => {
    await context.addCookies([{ name: '__session', value: '1', url: ORIGIN }])

    await page.goto('/some-org/transactions')

    await page.waitForURL(/\/login\?redirect=%2Fsome-org%2Ftransactions$/)
    expect((await context.cookies()).find((c) => c.name === '__session')).toBeUndefined()
  })

  test('API routes reject forged and missing sessions with 401', async ({ request }) => {
    const forged = await request.post('/api/enablebanking/session', {
      headers: { Cookie: '__session=1', Origin: ORIGIN },
      data: VICTIM_BODY,
    })
    expect(forged.status()).toBe(401)
    expect((await request.get('/api/enablebanking/institutions?country=PL', { headers: { Cookie: '__session=1' } })).status()).toBe(401)
    expect((await request.get('/api/enablebanking/institutions?country=PL')).status()).toBe(401)
  })

  test('/api/auth/session refuses a bad Origin, a missing Origin and a garbage token', async ({ request }) => {
    const user = await createEmulatorUser(request)
    expect((await request.post('/api/auth/session', { headers: { Origin: 'https://evil.example' }, data: { idToken: user.idToken } })).status()).toBe(403)
    expect((await request.post('/api/auth/session', { data: { idToken: user.idToken } })).status()).toBe(403)
    expect((await request.post('/api/auth/session', { headers: { Origin: ORIGIN }, data: { idToken: 'garbage' } })).status()).toBe(401)
  })

  test('a live cookie without a Firebase SDK user does not trap the visitor', async ({ page, context }) => {
    // The cookie lands in the browser context, but the browser's Firebase SDK never signed in.
    const user = await createEmulatorUser(context.request, { verified: true })
    const mint = await context.request.post('/api/auth/session', {
      headers: { Origin: ORIGIN },
      data: { idToken: user.idToken },
    })
    expect(mint.status()).toBe(204)
    expect((await context.cookies()).find((c) => c.name === '__session')).toBeDefined()

    // (a) The login page is reachable: the proxy leaves auth pages alone, nothing bounces to `/`.
    await page.goto('/login')
    await waitForHydration(page, '#email')
    await expect(page.getByLabel('Електронна пошта', { exact: true })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/login')

    // (b) An app page: the proxy accepts the cookie, the AuthProvider finds no SDK user, clears the
    // session and sends the visitor to /login with the return path.
    const res = await page.goto('/some-org/transactions')
    // The first response is the app page itself (no proxy redirect): the server accepted the cookie.
    expect(res?.url()).toMatch(/\/some-org\/transactions$/)
    await page.waitForURL(/\/login\?redirect=%2Fsome-org%2Ftransactions$/)
    await expect
      .poll(async () => (await context.cookies()).find((c) => c.name === '__session'))
      .toBeUndefined()
  })

  test('registration sets an HttpOnly session cookie; unverified email gates the bank; verifying lifts the gate; cross-origin POST is refused', async ({ page, request }) => {
    const { email, companyName } = await registerViaUi(page)

    // The cookie is a real, script-invisible session (not the old "1").
    const cookie = (await page.context().cookies()).find((c) => c.name === '__session')
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('Lax')
    expect(cookie?.value).not.toBe('1')
    expect(await page.evaluate(() => document.cookie)).not.toContain('__session')

    // Soft verification: the app is usable, the banner shows, the bank is blocked.
    await expect(page.getByTestId('verify-email-banner')).toBeVisible()
    const gated = await page.context().request.post('/api/enablebanking/session', {
      headers: { Origin: ORIGIN },
      data: VICTIM_BODY,
    })
    expect(gated.status()).toBe(403)
    expect(await gated.json()).toEqual({ error: 'email_not_verified' })

    // A cross-origin POST with the valid cookie is refused before anything else.
    const csrf = await page.context().request.post('/api/enablebanking/session', {
      headers: { Origin: 'https://evil.example' },
      data: VICTIM_BODY,
    })
    expect(csrf.status()).toBe(403)
    expect(await csrf.json()).toEqual({ error: 'forbidden' })

    // The user follows the mail link (emulator), comes back: banner gone, gate lifted
    // (the request now fails later, on membership of the foreign org).
    await verifyEmailInEmulator(request, email)
    await page.reload()
    // The company name renders only once the SDK user AND the org are loaded, so "banner gone"
    // below cannot pass merely because the user has not been restored yet.
    await expect(page.getByTestId('org-switcher-name')).toHaveText(companyName)
    await expect(page.getByTestId('verify-email-banner')).toHaveCount(0)
    const verified = await page.context().request.post('/api/enablebanking/session', {
      headers: { Origin: ORIGIN },
      data: VICTIM_BODY,
    })
    expect(verified.status()).toBe(403)
    expect(await verified.json()).toEqual({ error: 'forbidden' })
  })

  test('signing out revokes the session server-side', async ({ page, request }) => {
    await registerViaUi(page)
    const old = (await page.context().cookies()).find((c) => c.name === '__session')?.value
    expect(old).toBeTruthy()

    // Control: the copied cookie works from another client before sign-out (it gets past the
    // session check and stops at the verification gate), so the 401 below is the revocation.
    const before = await request.post('/api/enablebanking/session', {
      headers: { Cookie: `__session=${old}`, Origin: ORIGIN },
      data: VICTIM_BODY,
    })
    expect(before.status()).toBe(403)
    expect(await before.json()).toEqual({ error: 'email_not_verified' })

    // Revocation is second-granular: make sure it happens after the sign-in second.
    await page.waitForTimeout(1_100)
    await signOutViaProfileMenu(page)
    expect((await page.context().cookies()).find((c) => c.name === '__session')).toBeUndefined()

    // A copied cookie no longer works on the API (the proxy deliberately skips the revocation check,
    // so a revoked cookie could still load pages until it expires; that is not asserted here).
    const replay = await request.post('/api/enablebanking/session', {
      headers: { Cookie: `__session=${old}`, Origin: ORIGIN },
      data: VICTIM_BODY,
    })
    expect(replay.status()).toBe(401)
  })

  // Outcome check only. In emulator mode firebase-admin ALWAYS checks revocation
  // (`if (checkRevoked || isEmulator)` in verifySessionCookie), so here the old
  // verifySessionCookie(cookie, false) behaved like the fix and this test passes either way; the
  // regression guard is tests/unit/api/auth/logout.test.ts.
  test('a revoked cookie posted to logout does not revoke a newer session', async ({ page, request }) => {
    const { email } = await registerViaUi(page)
    const cookie1 = (await page.context().cookies()).find((c) => c.name === '__session')?.value
    expect(cookie1).toBeTruthy()

    // Sign out (revokes everything up to now), then sign in again: cookie2 is minted later.
    await page.waitForTimeout(1_100)
    await signOutViaProfileMenu(page)
    await signInViaLoginForm(page, email)
    await page.waitForURL(/\/[A-Za-z0-9]{20}\/transactions$/)
    const cookie2 = (await page.context().cookies()).find((c) => c.name === '__session')?.value
    expect(cookie2).toBeTruthy()
    expect(cookie2).not.toBe(cookie1)

    // A stale tab/device still holding cookie1 logs out. Revocation is second-granular, so wait a
    // second first: a wrongful revocation would then be strictly newer than cookie2's sign-in.
    await page.waitForTimeout(1_100)
    const staleLogout = await request.post('/api/auth/logout', {
      headers: { Cookie: `__session=${cookie1}`, Origin: ORIGIN },
    })
    expect(staleLogout.status()).toBe(204)

    // cookie2 is still alive: it gets past the session check and stops at the verification gate.
    const alive = await page.context().request.post('/api/enablebanking/session', {
      headers: { Origin: ORIGIN },
      data: VICTIM_BODY,
    })
    expect(alive.status()).toBe(403)
    expect(await alive.json()).toEqual({ error: 'email_not_verified' })
  })

  test('settings ignores an eb_auth link that this tab did not start', async ({ page }) => {
    const { orgId } = await registerViaUi(page)
    const planted = Buffer.from(JSON.stringify({ sessionId: 'attacker-session' })).toString('base64url')

    await page.goto(`/${orgId}/settings/banks?eb_auth=${planted}`)

    await expect(page.getByText('Підключення не підтверджено')).toBeVisible()
    expect(new URL(page.url()).searchParams.has('eb_auth')).toBe(false)
    // Nothing was saved: no connection row (it would be named "Банк" without a pending entry).
    await expect(page.getByText('Банк', { exact: true })).toHaveCount(0)
    await expect(page.getByText(/підключено$/)).toHaveCount(0)
  })

  test('the old settings URL sends a bank return value to the Banks section', async ({ page }) => {
    const { orgId } = await registerViaUi(page)
    const planted = Buffer.from(JSON.stringify({ sessionId: 'attacker-session' })).toString('base64url')

    await page.goto(`/${orgId}/settings?eb_auth=${planted}`)

    await page.waitForURL(new RegExp(`/${orgId}/settings/banks`))
    await expect(page.getByText('Підключення не підтверджено')).toBeVisible()
    expect(new URL(page.url()).searchParams.has('eb_auth')).toBe(false)
  })

  test('login ignores an off-site ?redirect= and honours the app return path after re-login', async ({ page }) => {
    const { email, orgId } = await registerViaUi(page)
    // Same second-granular revocation as above. Every later sign-in mints a NEW cookie whose
    // sign-in time is after the revocation, so it is not revoked.
    await page.waitForTimeout(1_100)
    await signOutViaProfileMenu(page)

    // Open-redirect attempt: the user lands on their own first org, never on the foreign host.
    await page.goto('/login?redirect=https://evil.example')
    await signInViaLoginForm(page, email)
    await page.waitForURL(new RegExp(`/${orgId}/transactions$`))
    const landed = new URL(page.url())
    expect(landed.hostname).toBe('localhost')
    expect(landed.pathname).toBe(`/${orgId}/transactions`)

    // Legit return path: a signed-out visit to the Banks settings goes through /login and comes back.
    await signOutViaProfileMenu(page)
    await page.goto(`/${orgId}/settings/banks`)
    await page.waitForURL(new RegExp(`/login\\?redirect=%2F${orgId}%2Fsettings%2Fbanks$`))
    await signInViaLoginForm(page, email)
    await page.waitForURL(new RegExp(`/${orgId}/settings/banks$`))
    expect(new URL(page.url()).pathname).toBe(`/${orgId}/settings/banks`)
  })
})
