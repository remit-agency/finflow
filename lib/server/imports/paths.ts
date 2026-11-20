import type { Firestore } from 'firebase-admin/firestore'
import { orgRef } from '@/lib/server/ledger/paths'

/** organizations/{org}/imports: one document per imported file (S14); written by the server only, read through GET /imports. */
export const importsCol = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('imports')
/** organizations/{org}/importLocks/{accountId}: the step lock of one account (S14); closed to clients. */
export const importLocksCol = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('importLocks')
