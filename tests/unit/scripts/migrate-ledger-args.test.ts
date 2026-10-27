import { describe, expect, it } from 'vitest'
import { parseLedgerCliArgs } from '@/scripts/lib/migrate-ledger-args'

describe('parseLedgerCliArgs', () => {
  it('no arguments is a dry run over every company', () => {
    const r = parseLedgerCliArgs([])
    expect(r).toMatchObject({ ok: true, args: { apply: false, dropLegacy: false, raw: [] } })
    expect(r.ok && r.args.org).toBeUndefined()
  })

  it('reads the flags and keeps the raw arguments for the production check', () => {
    const argv = ['--apply', '--project=finflow-e94b5', '--rules-deployed', '--org=o1', '--reset-opening=a, b']
    const r = parseLedgerCliArgs(argv)
    expect(r.ok && r.args.apply).toBe(true)
    expect(r.ok && r.args.org).toBe('o1')
    expect(r.ok && [...r.args.resetOpening]).toEqual(['a', 'b'])
    expect(r.ok && r.args.raw).toEqual(argv)
  })

  it('refuses --apply together with --drop-legacy', () => {
    expect(parseLedgerCliArgs(['--apply', '--drop-legacy'])).toMatchObject({ ok: false })
  })

  it('refuses --reset-opening with --drop-legacy, empty values and unknown arguments without echoing values', () => {
    expect(parseLedgerCliArgs(['--drop-legacy', '--reset-opening=a'])).toMatchObject({ ok: false })
    expect(parseLedgerCliArgs(['--reset-opening='])).toMatchObject({ ok: false })
    expect(parseLedgerCliArgs(['--reset-opening=a,,b'])).toMatchObject({ ok: false })
    expect(parseLedgerCliArgs(['--org='])).toMatchObject({ ok: false })
    expect(parseLedgerCliArgs(['--org=a/b'])).toMatchObject({ ok: false })
    const unknown = parseLedgerCliArgs(['--frobnicate=secret'])
    expect(unknown).toMatchObject({ ok: false })
    expect(!unknown.ok && unknown.message).not.toContain('secret')
  })
})
