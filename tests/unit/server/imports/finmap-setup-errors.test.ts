import { describe, expect, it } from 'vitest'
import { unresolvedError } from '@/lib/server/imports/finmap/setup'

// The setup's invariant error (an entity of the request that a pass did not resolve) is not reachable with valid input, so
// its message is pinned here: the kind and the position in the request, never the name (it reaches the server log).
describe('finmap setup errors', () => {
  it('names the kind and the request position of an unresolved entity, not the name', () => {
    const e = unresolvedError('counterparty', 2)
    expect(e).toBeInstanceOf(Error)
    expect(e.message).toBe('finmap setup: counterparty #2 was not resolved')
    expect(e.message).not.toMatch(/acme|dostawca|Konto/i)
  })
})
