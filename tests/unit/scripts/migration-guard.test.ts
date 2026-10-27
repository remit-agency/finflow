import { describe, expect, it } from 'vitest'
import { assertDropSkippedAllowed, assertProductionFlags } from '@/scripts/lib/migration-guard.mjs'

const PROJECT = '--project=finflow-e94b5'

describe('assertProductionFlags', () => {
  it('never restricts the emulator', () => {
    for (const mode of [{ apply: true, drop: false }, { apply: false, drop: true }, { apply: false, drop: false }]) {
      expect(assertProductionFlags({ emulator: true, ...mode, args: [] })).toEqual({ ok: true })
    }
  })

  it('allows a production dry run without any flag', () => {
    expect(assertProductionFlags({ emulator: false, apply: false, drop: false, args: [] })).toEqual({ ok: true })
  })

  it('refuses a production --apply without --project, exit code 2', () => {
    const result = assertProductionFlags({ emulator: false, apply: true, drop: false, args: ['--apply'] })
    expect(result).toMatchObject({ ok: false, exitCode: 2 })
    expect(result.ok === false && result.message).toContain(PROJECT)
  })

  it('refuses a production --apply with the wrong project', () => {
    expect(assertProductionFlags({ emulator: false, apply: true, drop: false, args: ['--apply', '--project=demo-finflow'] })).toMatchObject({
      ok: false,
      exitCode: 2,
    })
  })

  it('allows a production --apply with --project', () => {
    expect(assertProductionFlags({ emulator: false, apply: true, drop: false, args: ['--apply', PROJECT] })).toEqual({ ok: true })
  })

  it('refuses a production drop without --project, exit code 2', () => {
    expect(assertProductionFlags({ emulator: false, apply: false, drop: true, args: ['--drop-members-map', '--rules-deployed'] })).toMatchObject({
      ok: false,
      exitCode: 2,
    })
  })

  it('refuses a production drop with --project but without --rules-deployed, exit code 2', () => {
    const result = assertProductionFlags({ emulator: false, apply: false, drop: true, args: ['--drop-members-map', PROJECT] })
    expect(result).toMatchObject({ ok: false, exitCode: 2 })
    expect(result.ok === false && result.message).toContain('--rules-deployed')
  })

  it('allows a production drop with both flags', () => {
    expect(
      assertProductionFlags({ emulator: false, apply: false, drop: true, args: ['--drop-members-map', PROJECT, '--rules-deployed'] }),
    ).toEqual({ ok: true })
  })

  it('does not take --rules-deployed as a replacement for --project, nor the reverse for --apply', () => {
    expect(assertProductionFlags({ emulator: false, apply: true, drop: false, args: ['--apply', '--rules-deployed'] })).toMatchObject({ ok: false })
  })

  it('accepts any iterable of arguments', () => {
    expect(assertProductionFlags({ emulator: false, apply: true, drop: false, args: new Set(['--apply', PROJECT]) })).toEqual({ ok: true })
  })

  it('names the caller own drop flag and rules statement in the refusal (ledger migration)', () => {
    const ledger = { dropFlag: '--drop-legacy', rulesStatement: 'the S05 app is deployed and the new rules are live' }
    const noRules = assertProductionFlags({ emulator: false, apply: false, drop: true, args: ['--drop-legacy', PROJECT], ...ledger })
    expect(noRules).toMatchObject({ ok: false, exitCode: 2 })
    expect(noRules.ok === false && noRules.message).toContain('--drop-legacy')
    expect(noRules.ok === false && noRules.message).toContain('S05 app')
    expect(noRules.ok === false && noRules.message).not.toContain('members')

    const noProject = assertProductionFlags({ emulator: false, apply: false, drop: true, args: ['--drop-legacy', '--rules-deployed'], ...ledger })
    expect(noProject.ok === false && noProject.message).toContain('--drop-legacy')

    expect(
      assertProductionFlags({ emulator: false, apply: false, drop: true, args: ['--drop-legacy', PROJECT, '--rules-deployed'], ...ledger }),
    ).toEqual({ ok: true })
  })
})

describe('assertDropSkippedAllowed', () => {
  const invalidRole = { orgId: 'o1', uid: 'u1', reason: 'invalid_role' }
  const invalidUid = { orgId: 'o2', uid: 'a/b', reason: 'invalid_uid' }
  const noMap = { orgId: 'o3', uid: null, reason: 'no_members_map' }

  it('passes when nothing was skipped, or only organizations without a members map', () => {
    expect(assertDropSkippedAllowed({ args: [], skipped: [] })).toEqual({ ok: true })
    expect(assertDropSkippedAllowed({ args: [], skipped: [noMap] })).toEqual({ ok: true })
  })

  it('refuses with exit code 1 and lists the invalid_role and invalid_uid entries', () => {
    const result = assertDropSkippedAllowed({ args: [], skipped: [invalidRole, noMap, invalidUid] })
    expect(result).toMatchObject({ ok: false, exitCode: 1, ids: [invalidRole, invalidUid] })
  })

  it('passes with --allow-skipped', () => {
    expect(assertDropSkippedAllowed({ args: ['--allow-skipped'], skipped: [invalidRole, invalidUid] })).toEqual({ ok: true })
  })
})
