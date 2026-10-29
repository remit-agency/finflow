import { describe, expect, it } from 'vitest'
import { bearerMatches } from '@/lib/server/cron-auth'

const SECRET = 'a-long-random-secret-of-at-least-32-chars'

describe('bearerMatches', () => {
  it('accepts exactly "Bearer <secret>"', () => {
    expect(bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true)
  })

  it.each([
    ['no header', null],
    ['an empty header', ''],
    ['the secret without the Bearer word', SECRET],
    ['another scheme', `Basic ${SECRET}`],
    ['a wrong secret', 'Bearer something-else'],
    ['the secret with a character more', `Bearer ${SECRET}x`],
    ['the secret with a character less', `Bearer ${SECRET.slice(0, -1)}`],
  ])('refuses %s', (_name, header) => {
    expect(bearerMatches(header, SECRET)).toBe(false)
  })
})
