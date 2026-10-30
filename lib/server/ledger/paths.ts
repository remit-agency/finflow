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
/** The auto-rules (S10): written by the server, readable by members (firestore.rules). */
export const rulesCol = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('rules')
/** The tags (S10t): written by the server, readable by members (firestore.rules). */
export const tagsCol = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('tags')
/** Uniqueness keys of the tag names (S10t): closed to clients (firestore.rules). */
export const tagKeysCol = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('tagKeys')
/** organizations/{org}/ledger/lock: closed to clients (firestore.rules). */
export const lockRef = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('ledger').doc('lock')
