import { describe, expect, it } from 'vitest'
import { parseEraseArgs } from '@/scripts/lib/erase-args'

describe('parseEraseArgs: org', () => {
  it('defaults to a dry run', () => {
    expect(parseEraseArgs('org', ['org1'])).toEqual({ ok: true, args: { target: 'org1', apply: false, skipBankRevoke: false } })
  })

  it('applies only with --confirm equal to the target', () => {
    expect(parseEraseArgs('org', ['org1', '--apply', '--confirm=org1'])).toEqual({ ok: true, args: { target: 'org1', apply: true, skipBankRevoke: false } })
    expect(parseEraseArgs('org', ['--confirm=org1', '--apply', 'org1']).ok).toBe(true)
  })

  it('reads --skip-bank-revoke', () => {
    expect(parseEraseArgs('org', ['org1', '--apply', '--confirm=org1', '--skip-bank-revoke'])).toEqual({ ok: true, args: { target: 'org1', apply: true, skipBankRevoke: true } })
    expect(parseEraseArgs('org', ['org1', '--skip-bank-revoke'])).toEqual({ ok: true, args: { target: 'org1', apply: false, skipBankRevoke: true } })
  })

  it.each([
    ['--apply without --confirm', ['org1', '--apply']],
    ['a mismatching confirm', ['org1', '--apply', '--confirm=org2']],
    ['an empty confirm', ['org1', '--apply', '--confirm=']],
    ['--confirm without --apply', ['org1', '--confirm=org1']],
    ['an unknown flag', ['org1', '--force']],
    ['an unknown flag with a value', ['org1', '--project=finflow-e94b5']],
    ['a missing target', []],
    ['a missing target with flags', ['--apply', '--confirm=org1']],
    ['two targets', ['org1', 'org2']],
    ['a target with a slash', ['org1/members']],
    ['an empty target', ['']],
  ])('refuses %s', (_name, argv) => {
    const parsed = parseEraseArgs('org', argv)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.message.length).toBeGreaterThan(0)
  })
})

describe('parseEraseArgs: user', () => {
  it('takes a uid or an email; dry run by default', () => {
    expect(parseEraseArgs('user', ['u1'])).toEqual({ ok: true, args: { target: 'u1', apply: false, skipBankRevoke: false } })
    expect(parseEraseArgs('user', ['a@b.test', '--apply', '--confirm=a@b.test'])).toEqual({ ok: true, args: { target: 'a@b.test', apply: true, skipBankRevoke: false } })
  })

  it('--skip-bank-revoke is only valid for a company', () => {
    expect(parseEraseArgs('user', ['u1', '--skip-bank-revoke']).ok).toBe(false)
  })

  it.each([
    [['u1', '--apply']],
    [['u1', '--apply', '--confirm=u2']],
    [['--nope', 'u1']],
    [[]],
    [['a/b']],
  ])('refuses %j', (argv) => {
    expect(parseEraseArgs('user', argv).ok).toBe(false)
  })

  it('never echoes the target in a refusal', () => {
    const parsed = parseEraseArgs('user', ['person@example.test', '--apply', '--confirm=other@example.test'])
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.message).not.toContain('example.test')
  })
})

describe('userRef', () => {
  it('an argument with @ is an email, anything else a uid', async () => {
    const { userRef } = await import('@/scripts/lib/erase-args')
    expect(userRef('a@b.test')).toEqual({ email: 'a@b.test' })
    expect(userRef('u1')).toEqual({ uid: 'u1' })
  })
})
