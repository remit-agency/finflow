import type { Firestore } from 'firebase-admin/firestore'
import { orgRef } from '@/lib/server/ledger/paths'

/** organizations/{org}/bankConnections: written by the server only, owner may read (firestore.rules). */
export const bankConnectionsCol = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('bankConnections')
/** organizations/{org}/bankAccounts: closed to clients. */
export const bankAccountsCol = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('bankAccounts')
/** organizations/{org}/bankSeen: "this bank operation was imported once". Closed to clients. */
export const bankSeenCol = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('bankSeen')
