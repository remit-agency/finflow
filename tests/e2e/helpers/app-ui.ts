import { expect, type Page } from '@playwright/test'

export const UI_PASSWORD = 'ui-pass-123456'

// Filling a controlled input before React hydrates loses the value, so wait for hydration.
export async function waitForHydration(page: Page, selector: string): Promise<void> {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel)
    return !!el && Object.keys(el).some((k) => k.startsWith('__reactProps$'))
  }, selector)
}

export interface RegisteredUser {
  email: string
  password: string
  orgId: string
  companyName: string
}

/** Registers through the real form (Auth user + organization) and lands on /{orgId}/transactions. */
export async function registerViaUi(page: Page, prefix: string): Promise<RegisteredUser> {
  const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const email = `${prefix}-${runId}@finflow.test`
  const companyName = `${prefix} Co ${runId}`
  await page.goto('/register')
  await waitForHydration(page, '#name')
  await page.getByLabel('Ваше ім\'я', { exact: true }).fill('UI Tester')
  await page.getByLabel('Електронна пошта', { exact: true }).fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(UI_PASSWORD)
  await page.getByLabel('Назва компанії', { exact: true }).fill(companyName)
  await page.getByRole('button', { name: 'Спробувати 14 днів безкоштовно' }).click()
  await page.waitForURL(/\/[A-Za-z0-9]{20}\/transactions$/)
  return { email, password: UI_PASSWORD, orgId: new URL(page.url()).pathname.split('/')[1], companyName }
}

/** The header shows the company name only once the shell has the URL's org and the SDK user. */
export async function waitForShell(page: Page, companyName: string): Promise<void> {
  await expect(page.getByTestId('org-switcher-name')).toHaveText(companyName)
}
