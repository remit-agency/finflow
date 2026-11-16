// tests/e2e/forecast.spec.ts
// The cash gap signal and the payment calendar (S13): the banner in the journal and on the calendar with its link to the day
// panel; no banner without a gap; the company minimum in Settings that moves the banner; the month grid (a future day's planned
// amount and forecast balance, a past day's real balance, the chart and back, the next month); a planned payment paid from its
// day panel; a viewer who sees the banner. Every test registers its own company.
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { registerViaUi, waitForHydration, waitForShell, type RegisteredUser } from './helpers/app-ui'
import { dayFromToday } from './helpers/bank-seed'
import { signInEmulatorUser } from './helpers/emulator-auth'
import { seedMember } from './helpers/emulator-firestore'
import { seedLedgerAccount } from './helpers/ledger-seed'
import { balanceMinor, seedPlanned } from './helpers/recurring-seed'
import { formatDayShortUtc } from '../../lib/utils/journal'
import { todayDay } from '../../lib/utils/today'

const NEEDS_EMULATORS =
  'Needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"'

const banner = (page: Page): Locator => page.getByTestId('cash-gap')
const cell = (page: Page, day: string): Locator => page.locator(`[data-testid="cal-day"][data-date="${day}"]`)
const toast = (page: Page, text: string): Locator => page.locator('[data-sonner-toast]').filter({ hasText: text })
const monthOf = (day: string): string => day.slice(0, 7)
/** The month after / before a `YYYY-MM` key. */
const shiftKey = (key: string, delta: number): string => {
  const index = Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1 + delta
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}
/** The day the banner names («24 лис»). */
const shortLabel = (day: string): string => formatDayShortUtc(new Date(`${day}T00:00:00Z`), 'uk')

/** A PLN company with one bank account of 1000 zł. */
async function setup(page: Page, request: APIRequestContext, prefix: string): Promise<RegisteredUser> {
  const user = await registerViaUi(page, prefix, 'PLN')
  await waitForShell(page, user.companyName)
  await seedLedgerAccount(request, user.orgId, 'acc-a', { name: 'Konto A', balance: 1000, currency: 'PLN' })
  return user
}

const isForecastRead = (r: { url(): string; ok(): boolean }): boolean => new URL(r.url()).pathname.endsWith('/forecast') && r.ok()

/**
 * Opens a page that reads the forecast and waits for the page's read to answer. The body is not read here: in dev the first
 * fetch of a page is aborted by React's effect cleanup, and an aborted response has no body.
 */
async function openWithForecast(page: Page, url: string): Promise<void> {
  const read = page.waitForResponse(isForecastRead)
  await page.goto(url)
  await read
}

/** The server's cash gap now (`gap` of the forecast read as the signed-in user), so an absent banner is checked against the server. */
async function serverGap(page: Page, orgId: string): Promise<unknown> {
  const res = await page.request.get(`/api/orgs/${encodeURIComponent(orgId)}/forecast`)
  expect(res.ok(), 'the forecast read').toBe(true)
  return ((await res.json()) as { gap: unknown }).gap
}

/**
 * Steps the calendar from the month `from` to the month `to` with cal-prev / cal-next, one month at a time, and waits for each
 * month's read. Returns `to`. The caller names `from` (the chart has no day cells to read it from).
 */
async function clickToMonth(page: Page, from: string, to: string): Promise<string> {
  let shown = from
  for (let i = 0; i < 3 && shown !== to; i++) {
    const forward = to > shown
    const next = shiftKey(shown, forward ? 1 : -1)
    const read = page.waitForResponse((r) => r.url().includes(`/calendar?year=${Number(next.slice(0, 4))}&month=${Number(next.slice(5, 7))}`) && r.ok())
    await page.getByTestId(forward ? 'cal-next' : 'cal-prev').click()
    await read
    shown = next
  }
  expect(shown, 'the calendar shows the wanted month').toBe(to)
  return shown
}

/** Sets the company minimum in Settings > Company (major units, as typed) and waits for the save. */
async function setMinimum(page: Page, orgId: string, amount: string): Promise<void> {
  await page.goto(`/${orgId}/settings/company`)
  await waitForHydration(page, '#cashMinimum')
  await page.getByTestId('cash-minimum').fill(amount)
  const save = page.locator('form').getByRole('button', { name: 'Зберегти', exact: true })
  await expect(save).toBeEnabled()
  await save.click()
  await expect(toast(page, 'Збережено')).toBeVisible()
}

test.describe('payment calendar and cash gap (emulators)', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test('the cash gap is named in the journal and on the calendar; its link opens the day in the panel', async ({ page, request }) => {
    const user = await setup(page, request, 'fc-banner')
    const gapDay = dayFromToday(5)
    await seedPlanned(page, user.orgId, { type: 'expense', accountId: 'acc-a', amountMinor: 150_000, paymentDate: gapDay, description: 'VAT-7' })

    await openWithForecast(page, `/${user.orgId}/transactions`)
    await expect(banner(page)).toBeVisible()
    await expect(page.getByTestId('cash-gap-title')).toContainText(shortLabel(gapDay))
    await expect(page.getByTestId('cash-gap-title')).toContainText(/[-−]500,00/)
    await expect(page.getByTestId('cash-gap-cause')).toContainText('VAT-7')
    await expect(page.getByTestId('cash-gap-cause')).toContainText(/1\s500,00/)

    await page.getByTestId('cash-gap-link').click()
    await page.waitForURL(new RegExp(`/analytics/calendar\\?month=${monthOf(gapDay)}&day=${gapDay}$`))
    await expect(page.getByTestId('day-planned').filter({ hasText: 'VAT-7' })).toBeVisible()

    // The calendar shows the banner too, without a link; the gap day is marked in the grid.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(banner(page)).toBeVisible()
    await expect(page.getByTestId('cash-gap-link')).toHaveCount(0)
    await expect(cell(page, gapDay)).toHaveAttribute('data-gap', 'true')

    // The chart marks the gap in its month, and not in the next month (the gap day is not there).
    await page.getByTestId('cal-view-chart').click()
    await expect(page.getByTestId('cal-chart')).toContainText('Касовий розрив')
    await clickToMonth(page, monthOf(gapDay), shiftKey(monthOf(gapDay), 1))
    await expect(page.getByTestId('cal-chart')).toBeVisible()
    await expect(page.getByTestId('cal-chart')).not.toContainText('Касовий розрив')
  })

  test('no cash gap, no banner', async ({ page, request }) => {
    const user = await setup(page, request, 'fc-nogap')
    await seedPlanned(page, user.orgId, { type: 'expense', accountId: 'acc-a', amountMinor: 10_000, paymentDate: dayFromToday(5), description: 'Kawa' })

    await openWithForecast(page, `/${user.orgId}/transactions`)
    expect(await serverGap(page, user.orgId)).toBeNull()
    await expect(banner(page)).toHaveCount(0)
  })

  test('the company minimum moves the banner: 500 with a balance of 400 names the gap; 0 hides it', async ({ page, request }) => {
    const user = await setup(page, request, 'fc-minimum')
    await seedPlanned(page, user.orgId, { type: 'expense', accountId: 'acc-a', amountMinor: 60_000, paymentDate: dayFromToday(5), description: 'Czynsz' })

    // The balance is 400 zł: above the default minimum of 0.
    await openWithForecast(page, `/${user.orgId}/transactions`)
    expect(await serverGap(page, user.orgId)).toBeNull()
    await expect(banner(page)).toHaveCount(0)

    await setMinimum(page, user.orgId, '500')
    await openWithForecast(page, `/${user.orgId}/transactions`)
    expect(await serverGap(page, user.orgId)).not.toBeNull()
    await expect(banner(page)).toBeVisible()
    await expect(page.getByTestId('cash-gap-title')).toContainText(/400,00/)
    await expect(page.getByTestId('cash-gap-title')).toContainText(/500,00/)

    await setMinimum(page, user.orgId, '0')
    await openWithForecast(page, `/${user.orgId}/transactions`)
    expect(await serverGap(page, user.orgId)).toBeNull()
    await expect(banner(page)).toHaveCount(0)
  })

  test('the grid: a future day shows its planned amount and forecast balance, a past day its real balance; the chart and the next month', async ({ page, request }) => {
    const user = await setup(page, request, 'fc-grid')
    const future = dayFromToday(1)
    await seedPlanned(page, user.orgId, { type: 'expense', accountId: 'acc-a', amountMinor: 30_000, paymentDate: future, description: 'Hosting' })

    // The default month is Warsaw's month; the future day may be in the next one (the last days of a month).
    await page.goto(`/${user.orgId}/analytics/calendar`)
    await expect(page.getByTestId('cal-grid')).toBeVisible()
    let shown = await clickToMonth(page, monthOf(todayDay()), monthOf(future))
    await expect(cell(page, future).getByTestId('cal-planned')).toContainText('300')
    await expect(cell(page, future).getByTestId('cal-balance')).toHaveText('700')

    const past = dayFromToday(-1)
    shown = await clickToMonth(page, shown, monthOf(past))
    await expect(cell(page, past).getByTestId('cal-balance')).toHaveText(/^1\s000$/)

    shown = await clickToMonth(page, shown, monthOf(future))
    await page.getByTestId('cal-view-chart').click()
    await expect(page.getByTestId('cal-chart')).toBeVisible()
    await page.getByTestId('cal-view-calendar').click()
    await expect(page.getByTestId('cal-grid')).toBeVisible()
    await expect(cell(page, future).getByTestId('cal-balance')).toHaveText('700')

    const nextKey = shiftKey(monthOf(future), 1)
    await clickToMonth(page, shown, nextKey)
    await expect(cell(page, `${nextKey}-01`)).toHaveCount(1)
  })

  test('a planned payment is paid from its day panel and the account balance falls', async ({ page, request }) => {
    const user = await setup(page, request, 'fc-pay')
    const day = dayFromToday(1)
    await seedPlanned(page, user.orgId, { type: 'expense', accountId: 'acc-a', amountMinor: 30_000, paymentDate: day, description: 'Faktura gaz' })

    await page.goto(`/${user.orgId}/analytics/calendar?month=${monthOf(day)}&day=${day}`)
    const row = page.getByTestId('day-planned').filter({ hasText: 'Faktura gaz' })
    await expect(row).toBeVisible()
    expect(await balanceMinor(request, user.orgId, 'acc-a')).toBe(100_000)

    await row.getByRole('button', { name: 'Позначити сплаченою' }).click()
    await expect(toast(page, 'Позначено сплаченою')).toBeVisible()
    await expect.poll(() => balanceMinor(request, user.orgId, 'acc-a')).toBe(70_000)
    await expect(row).toHaveCount(0)
  })

  test('a viewer of the company sees the cash gap in the journal', async ({ page, browser, request }) => {
    const owner = await setup(page, request, 'fc-owner')
    await seedPlanned(page, owner.orgId, { type: 'expense', accountId: 'acc-a', amountMinor: 150_000, paymentDate: dayFromToday(5), description: 'VAT-7' })

    const context = await browser.newContext()
    try {
      const v = await context.newPage()
      const viewer = await registerViaUi(v, 'fc-viewer', 'PLN')
      const { uid: viewerUid } = await signInEmulatorUser(request, viewer.email, viewer.password)
      const { uid: ownerUid } = await signInEmulatorUser(request, owner.email, owner.password)
      await seedMember(request, owner.orgId, viewerUid, 'viewer', ownerUid)

      await openWithForecast(v, `/${owner.orgId}/transactions`)
      await waitForShell(v, owner.companyName)
      await expect(banner(v)).toBeVisible()
      await expect(v.getByTestId('cash-gap-title')).toContainText(/[-−]500,00/)
    } finally {
      await context.close()
    }
  })
})
