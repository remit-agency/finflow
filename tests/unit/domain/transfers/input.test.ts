import { describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransferRequest } from '@/lib/domain/transfers/input'

const V = '1790000000.000000001'

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : 'other'
  }
  return 'ok'
}

describe('parseTransferRequest', () => {
  it('reads suggested pairs with the versions the person saw, a merge and a conversion', () => {
    expect(parseTransferRequest({ pairs: [{ fromId: 'bk_a1', toId: 'bk_b1', versions: [V, V] }] })).toEqual({
      kind: 'pairs',
      pairs: [{ ids: ['bk_a1', 'bk_b1'], versions: [V, V] }],
    })
    expect(parseTransferRequest({ merge: ['bk_a1', 'bk_b1'] })).toEqual({ kind: 'merge', ids: ['bk_a1', 'bk_b1'] })
    expect(parseTransferRequest({ convert: { ids: ['bk_a1', 'bk_a2'], toAccountId: 'cash' } })).toEqual({ kind: 'convert', ids: ['bk_a1', 'bk_a2'], toAccountId: 'cash' })
  })

  it.each<[string, unknown, string]>([
    ['an empty body', {}, 'invalid_input:body'],
    ['two kinds at once', { merge: ['a', 'b'], convert: { ids: ['a'], toAccountId: 'c' } }, 'invalid_input:body'],
    ['an unknown key', { split: ['a'] }, 'invalid_input:split'],
    ['no pairs', { pairs: [] }, 'invalid_input:pairs'],
    ['51 pairs', { pairs: Array.from({ length: 51 }, (_, i) => ({ fromId: `a${i}`, toId: `b${i}`, versions: [V, V] })) }, 'invalid_input:pairs'],
    ['a pair of one operation', { pairs: [{ fromId: 'a', toId: 'a', versions: [V, V] }] }, 'invalid_input:pairs.0'],
    ['an id that is no document id', { pairs: [{ fromId: 'a/b', toId: 'c', versions: [V, V] }] }, 'invalid_input:pairs.0'],
    ['a broken version', { pairs: [{ fromId: 'a', toId: 'b', versions: [V, '1'] }] }, 'invalid_input:pairs.0.versions'],
    ['an unknown key in a pair', { pairs: [{ fromId: 'a', toId: 'b', versions: [V, V], note: 'x' }] }, 'invalid_input:pairs.0.note'],
    ['one operation in two pairs', { pairs: [{ fromId: 'a', toId: 'b', versions: [V, V] }, { fromId: 'a', toId: 'c', versions: [V, V] }] }, 'invalid_input:pairs'],
    ['a merge of three', { merge: ['a', 'b', 'c'] }, 'invalid_input:merge'],
    ['a merge of one twice', { merge: ['a', 'a'] }, 'invalid_input:merge'],
    ['a conversion of none', { convert: { ids: [], toAccountId: 'cash' } }, 'invalid_input:convert.ids'],
    ['a conversion of 26', { convert: { ids: Array.from({ length: 26 }, (_, i) => `a${i}`), toAccountId: 'cash' } }, 'invalid_input:convert.ids'],
    ['a conversion without a target', { convert: { ids: ['a'] } }, 'invalid_input:convert.toAccountId'],
    ['a body that is a list', [], 'invalid_input:body'],
  ])('refuses %s', (_name, body, expected) => {
    expect(code(() => parseTransferRequest(body))).toBe(expected)
  })
})
