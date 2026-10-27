import { defineConfig, devices } from '@playwright/test'

const isCI = !!process.env.CI

// Env for the `next dev` server under test. Dummy, public-shaped values for the
// emulator-only demo project "demo-finflow" — none of these are secrets.
// Explicit values here win over .env.local (Next.js never overrides variables that
// are already set in process.env), so a local run can never reach production Firebase.
const E2E_SERVER_ENV: Record<string, string> = {
  NEXT_PUBLIC_USE_EMULATORS: '1',
  NEXT_PUBLIC_FIREBASE_API_KEY: 'demo-api-key',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'demo-finflow.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-finflow',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'demo-finflow.appspot.com',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:000000000000:web:0000000000000000',
  NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: 'G-DEMO000000',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  EB_STATE_SECRET: 'e2e-only-state-secret',
  NEXT_TELEMETRY_DISABLED: '1',
  // The MF white list stub (tests/e2e/helpers/wl-stub.mjs): no e2e test calls the real government API.
  WL_API_BASE: 'http://127.0.0.1:4010',
}

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 1 : 0,
  forbidOnly: isCI,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    // Sends Accept-Language: uk-UA, so the app renders Ukrainian and existing e2e labels keep matching.
    locale: 'uk-UA',
    // The app buckets transactions by the browser's local month; UTC keeps the
    // smoke assertion deterministic on every machine.
    timezoneId: 'UTC',
    navigationTimeout: 90_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:3000',
      env: E2E_SERVER_ENV,
      // Never reuse a server: one started by hand may point at production Firebase.
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'node tests/e2e/helpers/wl-stub.mjs',
      url: 'http://127.0.0.1:4010/health',
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})
