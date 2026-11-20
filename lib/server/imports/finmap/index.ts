import 'server-only'
import type { FinmapSetupRequest } from '@/lib/domain/import/finmap/request'
import { importDeps } from '../index'
import { finmapFinish } from './finish'
import { finmapSetup } from './setup'

/** The Finmap import services bound to production (S14b): entity setup and the balance fit. The batch writer and undo come later. */
export const finmap = {
  setup: (orgId: string, uid: string, req: FinmapSetupRequest) => finmapSetup(importDeps(), orgId, uid, req),
  finish: (orgId: string, uid: string, importId: string) => finmapFinish(importDeps(), orgId, uid, importId),
}
