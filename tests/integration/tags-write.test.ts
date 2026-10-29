import { beforeEach, describe, expect, it } from 'vitest'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { TagError } from '@/lib/domain/tags/errors'
import { parseTagInput, parseTagPatch } from '@/lib/domain/tags/input'
import { createTransaction } from '@/lib/server/ledger/write'
import { listTags, tagImpact } from '@/lib/server/tags/read'
import { createTag, updateTag } from '@/lib/server/tags/write'
import { ORG, UID, auditActions, clearFirestore, makeDeps, readDoc, seedAccount, seedOrg, testDb } from './helpers'

const db = testDb()
const deps = makeDeps(db)

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof TagError ? `${e.code}:${e.field ?? ''}:${e.existingId ?? ''}` : `other:${String(e)}`
  }
  return 'none'
}

const tagged = (tagId: string) =>
  createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'expense', accountId: 'a1', amountMinor: 100, paymentDate: '2026-10-20', tags: [tagId] }))

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'a1', 'PLN', 0)
})

describe('createTag', () => {
  it('writes the tag, its name key and the audit entry together', async () => {
    const tag = await createTag(deps, ORG, UID, parseTagInput({ name: 'ПДВ', excludeFromAnalytics: true }))
    expect(tag).toEqual({ id: expect.any(String), name: 'ПДВ', color: 'slate', excludeFromAnalytics: true, archived: false, recalcPending: false })
    expect(await readDoc(db, `organizations/${ORG}/tags/${tag.id}`)).toMatchObject({ schemaVersion: 1, name: 'ПДВ', orgId: ORG, createdBy: UID })
    expect(await readDoc(db, `organizations/${ORG}/tagKeys/name_пдв`)).toEqual({ tagId: tag.id })
    expect(await auditActions(db, ORG)).toEqual(['tag.create'])
  })

  it('refuses a name another tag has (case and Latin diacritics ignored) and names that tag', async () => {
    const first = await createTag(deps, ORG, UID, parseTagInput({ name: 'Łódź' }))
    expect(await code(createTag(deps, ORG, UID, parseTagInput({ name: 'lodz' })))).toBe(`duplicate:name:${first.id}`)
    expect((await db.collection(`organizations/${ORG}/tags`).get()).size).toBe(1)
  })

  it('refuses the tag over the limit in the same transaction', async () => {
    const small = { ...deps, maxCount: 2 }
    await createTag(small, ORG, UID, parseTagInput({ name: 'a' }))
    await createTag(small, ORG, UID, parseTagInput({ name: 'b' }))
    expect(await code(createTag(small, ORG, UID, parseTagInput({ name: 'c' })))).toBe('limit_reached::')
  })

  it('refuses an unknown company', async () => {
    expect(await code(createTag(deps, 'ghost', UID, parseTagInput({ name: 'a' })))).toBe('not_found::')
  })
})

describe('updateTag', () => {
  it('a rename moves the name key; the old name is free again', async () => {
    const tag = await createTag(deps, ORG, UID, parseTagInput({ name: 'VAT' }))
    const out = await updateTag(deps, ORG, UID, tag.id, parseTagPatch({ name: 'ПДВ', color: 'rose' }))
    expect(out).toEqual({ tag: { ...tag, name: 'ПДВ', color: 'rose' }, recalc: false })
    expect(await readDoc(db, `organizations/${ORG}/tagKeys/name_vat`)).toBeUndefined()
    expect(await readDoc(db, `organizations/${ORG}/tagKeys/name_пдв`)).toEqual({ tagId: tag.id })
    await createTag(deps, ORG, UID, parseTagInput({ name: 'vat' }))
    expect(await auditActions(db, ORG)).toEqual(['tag.create', 'tag.create', 'tag.update'])
  })

  it('a rename that only changes the case keeps the key', async () => {
    const tag = await createTag(deps, ORG, UID, parseTagInput({ name: 'vat' }))
    await updateTag(deps, ORG, UID, tag.id, parseTagPatch({ name: 'VAT' }))
    expect(await readDoc(db, `organizations/${ORG}/tagKeys/name_vat`)).toEqual({ tagId: tag.id })
    expect((await readDoc(db, `organizations/${ORG}/tags/${tag.id}`))?.name).toBe('VAT')
  })

  it('refuses a rename to the name of another tag', async () => {
    const vat = await createTag(deps, ORG, UID, parseTagInput({ name: 'VAT' }))
    const atm = await createTag(deps, ORG, UID, parseTagInput({ name: 'Bankomat' }))
    expect(await code(updateTag(deps, ORG, UID, atm.id, parseTagPatch({ name: 'vat' })))).toBe(`duplicate:name:${vat.id}`)
    expect((await readDoc(db, `organizations/${ORG}/tags/${atm.id}`))?.name).toBe('Bankomat')
  })

  it('archiving keeps the flag and needs no recalculation, even for a used tag', async () => {
    const tag = await createTag(deps, ORG, UID, parseTagInput({ name: 'ПДВ', excludeFromAnalytics: true }))
    await tagged(tag.id)
    expect(await updateTag(deps, ORG, UID, tag.id, parseTagPatch({ archived: true }))).toEqual({ tag: { ...tag, archived: true }, recalc: false })
  })

  it('a change of the flag of a tag without operations needs no recalculation', async () => {
    const tag = await createTag(deps, ORG, UID, parseTagInput({ name: 'ПДВ' }))
    const out = await updateTag(deps, ORG, UID, tag.id, parseTagPatch({ excludeFromAnalytics: true }))
    expect(out).toEqual({ tag: { ...tag, excludeFromAnalytics: true }, recalc: false })
  })

  it('a change of the flag of a used tag sets recalcPending in the same write and asks for the recalculation', async () => {
    const tag = await createTag(deps, ORG, UID, parseTagInput({ name: 'ПДВ' }))
    await tagged(tag.id)
    const out = await updateTag(deps, ORG, UID, tag.id, parseTagPatch({ excludeFromAnalytics: true }))
    expect(out).toEqual({ tag: { ...tag, excludeFromAnalytics: true, recalcPending: true }, recalc: true })
    expect(await readDoc(db, `organizations/${ORG}/tags/${tag.id}`)).toMatchObject({ excludeFromAnalytics: true, recalcPending: true, orgId: ORG })
  })

  it('an unknown tag is not_found', async () => {
    expect(await code(updateTag(deps, ORG, UID, 'ghost', parseTagPatch({ archived: true })))).toBe('not_found::')
  })
})

describe('listTags and tagImpact', () => {
  it('lists every tag, the archived ones too, by name', async () => {
    await createTag(deps, ORG, UID, parseTagInput({ name: 'Żywność' }))
    const old = await createTag(deps, ORG, UID, parseTagInput({ name: 'Archiwum' }))
    await updateTag(deps, ORG, UID, old.id, parseTagPatch({ archived: true }))
    await createTag(deps, ORG, UID, parseTagInput({ name: 'bank' }))
    expect((await listTags(db, ORG)).map((t) => [t.name, t.archived])).toEqual([
      ['Archiwum', true],
      ['bank', false],
      ['Żywność', false],
    ])
  })

  it('counts the operations that carry the tag; an unknown tag is not_found', async () => {
    const tag = await createTag(deps, ORG, UID, parseTagInput({ name: 'ПДВ' }))
    await tagged(tag.id)
    await tagged(tag.id)
    expect(await tagImpact(db, ORG, tag.id)).toBe(2)
    expect(await code(tagImpact(db, ORG, 'ghost'))).toBe('not_found::')
  })
})
