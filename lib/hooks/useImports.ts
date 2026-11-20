'use client'

import { listImports } from '@/lib/api/import-client'
import type { ImportView } from '@/lib/domain/import/view'
import { useRecurringRead, type RecurringRead } from './useRecurringRead'

/**
 * The company's statement imports, newest first. Refetched after any ledger change in this browser: an import or an undo
 * announces it (`notifyLedgerChanged`).
 */
export function useImports(orgId: string): RecurringRead<ImportView[]> {
  return useRecurringRead(orgId, 'imports', (signal) => listImports(orgId, signal))
}
