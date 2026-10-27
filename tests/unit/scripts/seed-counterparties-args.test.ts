import { describe, expect, it } from 'vitest'
import { parseSeedArgs } from '@/scripts/lib/seed-counterparties-args'

describe('parseSeedArgs', () => {
  it('defaults to a dry run over every company', () => {
    expect(parseSeedArgs([])).toEqual({ ok: true, args: { apply: false, org: undefined, raw: [] } })
  })

  it('reads --apply, --org and keeps --project for the production flag check', () => {
    const argv = ['--apply', '--org=abc', '--project=finflow-e94b5']
    expect(parseSeedArgs(argv)).toEqual({ ok: true, args: { apply: true, org: 'abc', raw: argv } })
  })

  it.each([['--nope'], ['--org='], ['--org=a/b']])('refuses %s', (arg) => {
    expect(parseSeedArgs([arg]).ok).toBe(false)
  })
})
