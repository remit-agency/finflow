import 'server-only'
import { ledgerDeps } from '@/lib/server/ledger'
import type { PreviewRequest } from '@/lib/domain/import/request'
import type { ImportDeps } from './deps'
import { previewImport } from './preview'
import { importStep } from './step'

/** The import dependencies bound to production: Admin Firestore, the ledger and the Warsaw clock. */
export function importDeps(): ImportDeps {
  const ledger = ledgerDeps()
  return { db: ledger.db, ledger, now: ledger.now, today: ledger.today }
}

/** The statement import (S14). Undo and list join this facade in later steps. */
export const imports = {
  previewImport: (orgId: string, req: PreviewRequest) => previewImport(importDeps(), orgId, req),
  importStep: (orgId: string, uid: string, req: Parameters<typeof importStep>[3]) => importStep(importDeps(), orgId, uid, req),
}
