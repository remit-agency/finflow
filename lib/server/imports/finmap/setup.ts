import { FieldValue, Timestamp, type DocumentReference } from 'firebase-admin/firestore'
import { CounterpartyError } from '@/lib/domain/counterparties/errors'
import { normKey } from '@/lib/domain/import/finmap/fold'
import type { FinmapSetupRequest } from '@/lib/domain/import/finmap/request'
import type { CategoryRef } from '@/lib/domain/import/finmap/types'
import { ACCOUNT_COLORS } from '@/lib/domain/ledger/account-colors'
import { accountToDoc } from '@/lib/domain/ledger/doc'
import { LedgerError } from '@/lib/domain/ledger/errors'
import type { AccountType, LedgerAccount } from '@/lib/domain/ledger/types'
import { TagError } from '@/lib/domain/tags/errors'
import { TAG_COLORS } from '@/lib/domain/tags/types'
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from '@/lib/firebase/default-categories'
import type { CounterpartyDeps } from '@/lib/server/counterparties/deps'
import { createCounterparty } from '@/lib/server/counterparties/write'
import { auditData } from '@/lib/server/ledger/audit'
import { assertUnlocked } from '@/lib/server/ledger/lock'
import { accountsCol, auditCol, categoriesCol, counterpartiesCol, orgRef, tagsCol } from '@/lib/server/ledger/paths'
import { createTag } from '@/lib/server/tags/write'
import type { ImportDeps } from '../deps'
import { ImportError } from '../errors'
import { importsCol } from '../paths'
import { parseImportDoc, type ImportDoc, type ImportEntityCounts } from '../types'

export interface FinmapSetupResult {
  importId: string
  /** Account ids by `normKey` of the requested name. */
  accounts: Record<string, string>
  /** One entry per requested category: a parent's id, or the child's. */
  categories: Array<{ ref: CategoryRef; id: string }>
  counterparties: Record<string, string>
  tags: Record<string, string>
  /** What this run created (zero for every entity that matched). */
  created: ImportEntityCounts
}

/** Writes per accounts-and-categories transaction. Firestore allows 500; an account is a document and its audit entry. */
const PASS_WRITES = 400

const ZERO: ImportEntityCounts = { accounts: 0, categories: 0, counterparties: 0, tags: 0 }
const CATEGORY_PALETTE = {
  income: DEFAULT_INCOME_CATEGORIES.map((c) => c.color),
  expense: DEFAULT_EXPENSE_CATEGORIES.map((c) => c.color),
} as const

/**
 * Counterparties are looked up by name but never with a NIP, so the white list is never asked. A NIP-less create does not
 * call the lookup; this stops it from being called anyway.
 */
const NO_LOOKUP = async (): Promise<never> => {
  throw new Error('the white list is not asked by a Finmap setup')
}

/**
 * The first palette colour no existing item has. When every colour is taken, the one used least (palette order breaks
 * ties). Colours are compared without case.
 */
function nextColor<T extends string>(palette: readonly T[], used: readonly string[]): T {
  let best = palette[0]
  let bestUses = Infinity
  for (const colour of palette) {
    const uses = used.filter((u) => u.toLowerCase() === colour.toLowerCase()).length
    if (uses < bestUses) {
      best = colour
      bestUses = uses
    }
    if (uses === 0) break
  }
  return best
}

const catKey = (type: 'income' | 'expense', name: string): string => `${type}|${normKey(name)}`

/** The type of a stored category, or null when the document has none that the ledger knows. */
const categoryType = (v: unknown): 'income' | 'expense' | null => (v === 'income' || v === 'expense' ? v : null)

/** The entities a request asks for, once each by key, parents listed before their children. */
interface Wants {
  accounts: Array<{ key: string; name: string; type: AccountType; currency: string; balance: number | null }>
  parents: Array<{ key: string; type: 'income' | 'expense'; name: string }>
  children: Array<{ key: string; parentKey: string; type: 'income' | 'expense'; name: string }>
}

function wantsOf(req: FinmapSetupRequest): Wants {
  const accounts = new Map<string, Wants['accounts'][number]>()
  for (const a of req.accounts) {
    const key = normKey(a.name)
    if (!accounts.has(key)) accounts.set(key, { key, name: a.name, type: a.type, currency: a.currency, balance: a.currentBalanceMinor })
  }
  const parents = new Map<string, Wants['parents'][number]>()
  const children = new Map<string, Wants['children'][number]>()
  for (const c of req.categories) {
    const parentKey = catKey(c.type, c.parent)
    if (!parents.has(parentKey)) parents.set(parentKey, { key: parentKey, type: c.type, name: c.parent })
    if (c.child !== null) {
      const key = `${parentKey}|${normKey(c.child)}`
      if (!children.has(key)) children.set(key, { key, parentKey, type: c.type, name: c.child })
    }
  }
  return { accounts: [...accounts.values()], parents: [...parents.values()], children: [...children.values()] }
}

interface Resolved {
  id: string
  color: string
}

/** The outcome of one accounts-and-categories transaction. `remaining` counts the wanted entities it did not reach. */
interface Pass {
  remaining: number
  created: { accounts: number; categories: number }
  createdAccountKeys: string[]
  accounts: Map<string, string>
  parents: Map<string, Resolved>
  children: Map<string, string>
}

/**
 * One transaction: re-reads the company's accounts and categories, matches what is there, and creates the missing ones in
 * request order (parents before children), up to PASS_WRITES writes. Because it re-reads, a second run, or a run racing
 * this one, matches what was written. Two concurrent runs that both see a name missing are serialised by the transaction,
 * which retries the loser on the re-read (Firestore checks the documents it read; a document inserted into a query it
 * read is covered only by that check, so the emulator run is the evidence, not a proof).
 */
async function accountsAndCategoriesPass(deps: ImportDeps, orgId: string, uid: string, wants: Wants): Promise<Pass> {
  const db = deps.db
  return db.runTransaction(async (t) => {
    await assertUnlocked(t, deps.ledger, orgId)
    if (!(await t.get(orgRef(db, orgId))).exists) throw new LedgerError('not_found', 'org')
    const accountDocs = await t.get(accountsCol(db, orgId))
    const categoryDocs = await t.get(categoriesCol(db, orgId))

    const existingAccounts = new Map<string, Resolved>()
    const accountColors: string[] = []
    for (const d of accountDocs.docs) {
      const name = d.get('name')
      const color = typeof d.get('color') === 'string' ? (d.get('color') as string) : ''
      if (typeof name !== 'string') continue
      if (color !== '') accountColors.push(color)
      if (!existingAccounts.has(normKey(name))) existingAccounts.set(normKey(name), { id: d.id, color })
    }

    const existingParents = new Map<string, Resolved>()
    const existingChildren = new Map<string, Resolved>()
    const usedByType: Record<'income' | 'expense', string[]> = { income: [], expense: [] }
    for (const d of categoryDocs.docs) {
      const name = d.get('name')
      const type = categoryType(d.get('type'))
      if (typeof name !== 'string' || type === null) continue
      const color = typeof d.get('color') === 'string' ? (d.get('color') as string) : ''
      if (color !== '') usedByType[type].push(color)
      const parentId = d.get('parentId')
      if (typeof parentId === 'string') {
        const key = `${parentId}|${normKey(name)}`
        if (!existingChildren.has(key)) existingChildren.set(key, { id: d.id, color })
      } else {
        const key = catKey(type, name)
        if (!existingParents.has(key)) existingParents.set(key, { id: d.id, color })
      }
    }

    const ts = Timestamp.fromDate(deps.now())
    let budget = PASS_WRITES
    let remaining = 0
    const created = { accounts: 0, categories: 0 }
    const createdAccountKeys: string[] = []
    const accounts = new Map<string, string>()
    const parents = new Map<string, Resolved>()
    const children = new Map<string, string>()

    for (const a of wants.accounts) {
      const hit = existingAccounts.get(a.key)
      if (hit !== undefined) {
        accounts.set(a.key, hit.id)
        continue
      }
      if (budget < 2) {
        remaining++
        continue
      }
      const ref = accountsCol(db, orgId).doc()
      const color = nextColor(ACCOUNT_COLORS, accountColors)
      const account: LedgerAccount = { id: ref.id, name: a.name, type: a.type, currency: a.currency, color, openingMinor: 0, balanceMinor: 0 }
      t.create(ref, { ...accountToDoc(account), orgId, createdAt: ts, updatedAt: ts })
      t.create(auditCol(db, orgId).doc(), auditData(deps.ledger, 'account.create', uid, ref.id, null, accountToDoc(account)))
      budget -= 2
      accountColors.push(color)
      existingAccounts.set(a.key, { id: ref.id, color })
      accounts.set(a.key, ref.id)
      createdAccountKeys.push(a.key)
      created.accounts++
    }

    for (const p of wants.parents) {
      const hit = existingParents.get(p.key)
      if (hit !== undefined) {
        parents.set(p.key, hit)
        continue
      }
      if (budget < 1) {
        remaining++
        continue
      }
      const ref = categoriesCol(db, orgId).doc()
      const color = nextColor(CATEGORY_PALETTE[p.type], usedByType[p.type])
      t.create(ref, { name: p.name, type: p.type, color, orgId, createdAt: ts })
      budget -= 1
      usedByType[p.type].push(color)
      const resolved = { id: ref.id, color }
      existingParents.set(p.key, resolved)
      parents.set(p.key, resolved)
      created.categories++
    }

    for (const c of wants.children) {
      const parent = parents.get(c.parentKey)
      if (parent === undefined) {
        remaining++
        continue
      }
      const key = `${parent.id}|${normKey(c.name)}`
      const hit = existingChildren.get(key)
      if (hit !== undefined) {
        children.set(c.key, hit.id)
        continue
      }
      if (budget < 1) {
        remaining++
        continue
      }
      const ref = categoriesCol(db, orgId).doc()
      // A child takes its parent's colour.
      t.create(ref, { name: c.name, type: c.type, color: parent.color, orgId, createdAt: ts, parentId: parent.id })
      budget -= 1
      existingChildren.set(key, { id: ref.id, color: parent.color })
      children.set(c.key, ref.id)
      created.categories++
    }

    return { remaining, created, createdAccountKeys, accounts, parents, children }
  })
}

/**
 * The import document a setup run writes into: a new one (`kind: 'finmap'`, applied), or the one a retry names. A retry
 * must name an applied Finmap import of this company; anything else is `not_found`.
 */
async function openImport(deps: ImportDeps, orgId: string, uid: string, req: FinmapSetupRequest): Promise<{ ref: DocumentReference; importId: string }> {
  if (req.importId !== undefined) {
    const ref = importsCol(deps.db, orgId).doc(req.importId)
    const doc = parseImportDoc((await ref.get()).data())
    if (doc === null || doc.kind !== 'finmap' || doc.status !== 'applied') throw new ImportError('not_found')
    return { ref, importId: ref.id }
  }
  const ref = importsCol(deps.db, orgId).doc()
  const doc: ImportDoc = {
    schemaVersion: 1,
    kind: 'finmap',
    fileName: req.fileName,
    accountIds: [],
    createdAt: Timestamp.fromDate(deps.now()),
    createdBy: uid,
    period: { from: null, to: null },
    counts: { created: 0, skipped: 0, refused: 0 },
    statements: [],
    fit: {},
    fitTargets: {},
    entities: { ...ZERO },
    status: 'applied',
    undo: { deleted: 0, kept: 0 },
  }
  await ref.set(doc)
  return { ref, importId: ref.id }
}

/** A value a pass must have resolved: every wanted entity is either matched or created before the last pass returns. */
function resolvedId<V>(value: V | undefined, what: string): V {
  if (value === undefined) throw new Error(`finmap setup: ${what} was not resolved`)
  return value
}

/**
 * Creates the categories, accounts, counterparties and tags of a Finmap import that FinFlow does not have yet, and
 * matches the rest by `normKey` within the company. Idempotent: a second run with the same body creates nothing and
 * returns the same ids. Accounts and categories are written in transactions that re-read; counterparties and tags go
 * through their own writers, whose unique name keys make a concurrent duplicate fail and be read back.
 */
export async function finmapSetup(deps: ImportDeps, orgId: string, uid: string, req: FinmapSetupRequest): Promise<FinmapSetupResult> {
  const { ref, importId } = await openImport(deps, orgId, uid, req)
  const wants = wantsOf(req)
  const created: ImportEntityCounts = { ...ZERO }
  const createdAccountKeys = new Set<string>()

  let pass: Pass
  do {
    pass = await accountsAndCategoriesPass(deps, orgId, uid, wants)
    created.accounts += pass.created.accounts
    created.categories += pass.created.categories
    for (const key of pass.createdAccountKeys) createdAccountKeys.add(key)
    // Every pass creates the first missing entity (parents and accounts come first), so this cannot loop.
    if (pass.remaining > 0 && pass.created.accounts + pass.created.categories === 0) throw new Error('finmap setup: no progress')
  } while (pass.remaining > 0)

  // Counterparties: matched by name in the company; a name another spelling already owns (its name key) is read back.
  const counterparties = new Map<string, string>()
  for (const d of (await counterpartiesCol(deps.db, orgId).get()).docs) {
    const name = d.get('name')
    if (typeof name === 'string' && !counterparties.has(normKey(name))) counterparties.set(normKey(name), d.id)
  }
  const cpDeps: CounterpartyDeps = { db: deps.db, now: deps.now, today: deps.today, lookup: NO_LOOKUP }
  for (const name of req.counterparties) {
    const key = normKey(name)
    if (counterparties.has(key)) continue
    try {
      const c = await createCounterparty(cpDeps, orgId, uid, { name, ibans: [] })
      counterparties.set(key, c.id)
      created.counterparties++
    } catch (e) {
      if (!(e instanceof CounterpartyError) || e.code !== 'duplicate' || e.existingId === undefined) throw e
      counterparties.set(key, e.existingId)
    }
  }

  // Tags: the first unused colour for a new one.
  const tags = new Map<string, string>()
  const tagColors: string[] = []
  for (const d of (await tagsCol(deps.db, orgId).get()).docs) {
    const name = d.get('name')
    const color = d.get('color')
    if (typeof color === 'string') tagColors.push(color)
    if (typeof name === 'string' && !tags.has(normKey(name))) tags.set(normKey(name), d.id)
  }
  for (const name of req.tags) {
    const key = normKey(name)
    if (tags.has(key)) continue
    const color = nextColor(TAG_COLORS, tagColors)
    try {
      const tag = await createTag({ db: deps.db, now: deps.now }, orgId, uid, { name, color, excludeFromAnalytics: false })
      tags.set(key, tag.id)
      tagColors.push(color)
      created.tags++
    } catch (e) {
      if (!(e instanceof TagError) || e.code !== 'duplicate' || e.existingId === undefined) throw e
      tags.set(key, e.existingId)
    }
  }

  const accounts: Record<string, string> = {}
  for (const a of wants.accounts) accounts[a.key] = resolvedId(pass.accounts.get(a.key), `account ${a.key}`)
  const categories = req.categories.map((ref) => ({
    ref,
    id:
      ref.child === null
        ? resolvedId(pass.parents.get(catKey(ref.type, ref.parent)), `category ${ref.parent}`).id
        : resolvedId(pass.children.get(`${catKey(ref.type, ref.parent)}|${normKey(ref.child)}`), `subcategory ${ref.child}`),
  }))

  // The import document: the accounts used, the balance to fit for each NEW account that was given one, the counts created.
  const update: Record<string, unknown> = {}
  const usedAccountIds = [...new Set(Object.values(accounts))]
  if (usedAccountIds.length > 0) update.accountIds = FieldValue.arrayUnion(...usedAccountIds)
  for (const a of wants.accounts) {
    if (a.balance !== null && createdAccountKeys.has(a.key)) update[`fitTargets.${accounts[a.key]}`] = a.balance
  }
  for (const [field, n] of Object.entries(created)) {
    if (n > 0) update[`entities.${field}`] = FieldValue.increment(n)
  }
  if (Object.keys(update).length > 0) await ref.update(update)

  return {
    importId,
    accounts,
    categories,
    counterparties: Object.fromEntries(req.counterparties.map((name) => [normKey(name), resolvedId(counterparties.get(normKey(name)), `counterparty ${name}`)])),
    tags: Object.fromEntries(req.tags.map((name) => [normKey(name), resolvedId(tags.get(normKey(name)), `tag ${name}`)])),
    created,
  }
}
