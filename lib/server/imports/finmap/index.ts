import 'server-only'
import type { FinmapBatchRequest, FinmapCheckRequest, FinmapSetupRequest } from '@/lib/domain/import/finmap/request'
import { importDeps } from '../index'
import { finmapBatch } from './batch'
import { finmapCheck } from './check'
import { finmapFinish } from './finish'
import { finmapSetup } from './setup'

/** The Finmap import services bound to production (S14b): entity setup, the duplicate check, the batch writer and the balance fit. Undo comes later. */
export const finmap = {
  setup: (orgId: string, uid: string, req: FinmapSetupRequest) => finmapSetup(importDeps(), orgId, uid, req),
  check: (orgId: string, req: FinmapCheckRequest) => finmapCheck(importDeps(), orgId, req.operations),
  batch: (orgId: string, uid: string, req: FinmapBatchRequest) => finmapBatch(importDeps(), orgId, uid, req),
  finish: (orgId: string, uid: string, importId: string) => finmapFinish(importDeps(), orgId, uid, importId),
}
