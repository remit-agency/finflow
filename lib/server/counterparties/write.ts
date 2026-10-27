import { Timestamp } from 'firebase-admin/firestore'
import { counterpartyToDoc, parseCounterparty } from '@/lib/domain/counterparties/doc'
import { CounterpartyError } from '@/lib/domain/counterparties/errors'
import type { CounterpartyInput, CounterpartyPatch } from '@/lib/domain/counterparties/input'
import { keyField, keysOf } from '@/lib/domain/counterparties/keys'
import { MAX_COUNTERPARTIES, type Counterparty, type CounterpartyIban, type Vat } from '@/lib/domain/counterparties/types'
import type { WhitelistLookup } from '@/lib/domain/counterparties/whitelist'
import { auditData } from '@/lib/server/ledger/audit'
import { auditCol, counterpartiesCol, counterpartyKeysCol, orgRef } from '@/lib/server/ledger/paths'
import type { CounterpartyDeps } from './deps'

interface Marks {
  vat?: Vat
  ibans: CounterpartyIban[]
}

const unmarked = (ibans: string[]): CounterpartyIban[] => ibans.map((iban) => ({ iban, onWhitelist: null }))

/** What the white list says about a NIP, or `null` when it could not be asked (the save goes on without it). */
async function ask(deps: CounterpartyDeps, nip: string): Promise<WhitelistLookup | null> {
  try {
    return await deps.lookup(nip)
  } catch (e) {
    if (e instanceof CounterpartyError && e.code === 'lookup_unavailable') return null
    throw e
  }
}

function marksFrom(found: WhitelistLookup, today: string, ibans: string[]): Marks {
  if (!found.found) return { ibans: unmarked(ibans) }
  return {
    vat: { status: found.subject.vatStatus, checkedOn: today },
    ibans: ibans.map((iban) => ({ iban, onWhitelist: found.subject.ibans.includes(iban) })),
  }
}

function duplicate(key: string, existing: { get: (f: string) => unknown }): CounterpartyError {
  return new CounterpartyError('duplicate', { field: keyField(key), existingId: existing.get('counterpartyId') as string })
}

export async function createCounterparty(deps: CounterpartyDeps, orgId: string, uid: string, input: CounterpartyInput): Promise<Counterparty> {
  const keysCol = counterpartyKeysCol(deps.db, orgId)
  // A duplicate must not cost a white list call. Not a guarantee (the transaction below is), only a cheap early exit.
  const early = keysOf({ name: input.name, nip: input.nip })
  const existing = await Promise.all(early.map((k) => keysCol.doc(k).get()))
  existing.forEach((snap, i) => {
    if (snap.exists) throw duplicate(early[i], snap)
  })

  const found = input.nip === undefined ? null : await ask(deps, input.nip)
  const marks = found === null ? { ibans: unmarked(input.ibans) } : marksFrom(found, deps.today(), input.ibans)

  const ref = counterpartiesCol(deps.db, orgId).doc()
  const c: Counterparty = {
    id: ref.id,
    name: input.name,
    ibans: marks.ibans,
    archived: false,
    ...(input.nip === undefined ? {} : { nip: input.nip }),
    ...(input.address === undefined ? {} : { address: input.address }),
    ...(marks.vat === undefined ? {} : { vat: marks.vat }),
  }
  const limit = deps.maxCount ?? MAX_COUNTERPARTIES

  await deps.db.runTransaction(async (t) => {
    // All reads first.
    const count = (await t.get(counterpartiesCol(deps.db, orgId).count())).data().count
    const org = await t.get(orgRef(deps.db, orgId))
    const keys = keysOf(c)
    const taken = await Promise.all(keys.map((k) => t.get(keysCol.doc(k))))

    if (!org.exists) throw new CounterpartyError('not_found')
    taken.forEach((snap, i) => {
      if (snap.exists) throw duplicate(keys[i], snap)
    })
    if (count >= limit) throw new CounterpartyError('limit')

    const ts = Timestamp.fromDate(deps.now())
    t.create(ref, { ...counterpartyToDoc(c), orgId, createdAt: ts, updatedAt: ts })
    for (const k of keys) t.create(keysCol.doc(k), { counterpartyId: ref.id })
    t.create(auditCol(deps.db, orgId).doc(), auditData(deps, 'counterparty.create', uid, ref.id, null, counterpartyToDoc(c)))
  })
  return c
}

export async function updateCounterparty(
  deps: CounterpartyDeps,
  orgId: string,
  uid: string,
  id: string,
  patch: CounterpartyPatch,
): Promise<Counterparty> {
  const ref = counterpartiesCol(deps.db, orgId).doc(id)
  const keysCol = counterpartyKeysCol(deps.db, orgId)

  const pre = await ref.get()
  const prior = pre.exists ? parseCounterparty(pre.id, pre.data()) : null
  if (!prior) throw new CounterpartyError('not_found')

  const nip = patch.nip === undefined ? prior.nip : (patch.nip ?? undefined)
  const address = patch.address === undefined ? prior.address : (patch.address ?? undefined)
  const ibanList = patch.ibans ?? prior.ibans.map((i) => i.iban)
  const nipChanged = nip !== prior.nip
  // The white list is asked again only when the NIP or the IBAN list changed (not for a rename or an archive).
  const recheck = nip !== undefined && (patch.nip !== undefined || patch.ibans !== undefined)
  const found = recheck ? await ask(deps, nip) : null

  let marks: Marks
  if (nip === undefined) marks = { ibans: unmarked(ibanList) }
  else if (found !== null) marks = marksFrom(found, deps.today(), ibanList)
  else if (nipChanged) marks = { ibans: unmarked(ibanList) }
  else {
    // Same NIP and nothing new to learn (no recheck, or the white list is down): keep what is known.
    marks = {
      ...(prior.vat === undefined ? {} : { vat: prior.vat }),
      ibans: ibanList.map((iban) => ({ iban, onWhitelist: prior.ibans.find((p) => p.iban === iban)?.onWhitelist ?? null })),
    }
  }

  const after: Counterparty = {
    id,
    name: patch.name ?? prior.name,
    ibans: marks.ibans,
    archived: patch.archived ?? prior.archived,
    ...(nip === undefined ? {} : { nip }),
    ...(address === undefined ? {} : { address }),
    ...(marks.vat === undefined ? {} : { vat: marks.vat }),
    ...(prior.kind === undefined ? {} : { kind: prior.kind }),
  }
  const oldKeys = keysOf(prior)
  const newKeys = keysOf(after)
  const added = newKeys.filter((k) => !oldKeys.includes(k))
  const removed = oldKeys.filter((k) => !newKeys.includes(k))

  return deps.db.runTransaction(async (t) => {
    const snap = await t.get(ref)
    if (!snap.exists) throw new CounterpartyError('not_found')
    // Someone saved this counterparty between our first read and now: the marks above may be stale.
    if (!pre.updateTime || !snap.updateTime || !snap.updateTime.isEqual(pre.updateTime)) throw new CounterpartyError('conflict')
    const taken = await Promise.all(added.map((k) => t.get(keysCol.doc(k))))
    taken.forEach((s, i) => {
      if (s.exists) throw duplicate(added[i], s)
    })

    const ts = Timestamp.fromDate(deps.now())
    t.set(ref, { ...counterpartyToDoc(after), orgId, createdAt: snap.get('createdAt'), updatedAt: ts })
    for (const k of removed) t.delete(keysCol.doc(k))
    for (const k of added) t.create(keysCol.doc(k), { counterpartyId: id })
    t.create(auditCol(deps.db, orgId).doc(), auditData(deps, 'counterparty.update', uid, id, counterpartyToDoc(prior), counterpartyToDoc(after)))
    return after
  })
}
