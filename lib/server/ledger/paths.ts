import type { Firestore } from 'firebase-admin/firestore'

export const orgRef = (db: Firestore, orgId: string) => db.collection('organizations').doc(orgId)
export const accountsCol = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('accounts')
export const transactionsCol = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('transactions')
export const categoriesCol = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('categories')
export const rollupsCol = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('rollups')
export const auditCol = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('audit')
export const counterpartiesCol = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('counterparties')
/** Uniqueness keys of the counterparties (NIP and name): closed to clients (firestore.rules). */
export const counterpartyKeysCol = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('counterpartyKeys')
/** organizations/{org}/ledger/lock: closed to clients (firestore.rules). */
export const lockRef = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('ledger').doc('lock')
