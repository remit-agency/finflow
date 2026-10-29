import { describe, expect, it } from 'vitest'
import { parseLinkRequest } from '@/lib/domain/banking/link-input'

const ok = { connectionId: 's1', ebAccountUid: 'u-1', mode: 'create', importFrom: '2026-07-30' }

describe('parseLinkRequest', () => {
  it('accepts create and existing', () => {
    expect(parseLinkRequest(ok)).toEqual({ ...ok, name: undefined, accountId: undefined })
    expect(parseLinkRequest({ ...ok, mode: 'existing', accountId: 'a1' })).toMatchObject({ mode: 'existing', accountId: 'a1' })
    expect(parseLinkRequest({ ...ok, name: '  Firmowe  ' })).toMatchObject({ name: 'Firmowe' })
  })
  it.each([
    [{ ...ok, mode: 'existing' }, 'accountId'],
    [{ ...ok, mode: 'nope' }, 'mode'],
    [{ ...ok, importFrom: '30.07.2026' }, 'importFrom'],
    [{ ...ok, importFrom: '1999-01-01' }, 'importFrom'],
    [{ ...ok, connectionId: '' }, 'connectionId'],
    [{ ...ok, ebAccountUid: 'x'.repeat(201) }, 'ebAccountUid'],
    [{ ...ok, extra: 1 }, 'extra'],
    [{ ...ok, name: 'x'.repeat(121) }, 'name'],
    ['text', 'body'],
  ])('rejects %j (%s)', (body, field) => {
    try {
      parseLinkRequest(body)
      expect.unreachable()
    } catch (e) {
      expect((e as Error).message).toContain(field)
    }
  })
})
