import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const root = import.meta.dirname

// Server-side ledger tests against the Firestore emulator (Admin SDK). Run through
// `npm run test:integration`, which starts the emulator and sets FIRESTORE_EMULATOR_HOST.
export default defineConfig({
  resolve: {
    alias: {
      '@': root,
      'server-only': resolve(root, 'tests/unit/server-only-stub.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    // All files share one emulator database.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
