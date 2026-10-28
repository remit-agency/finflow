import { describe, expect, it } from 'vitest'
import { assertReadinessTarget, parseCheckJournalArgs } from '@/scripts/lib/check-journal-args'

describe('parseCheckJournalArgs', () => {
  it('defaults to every company', () => {
    expect(parseCheckJournalArgs([])).toEqual({ ok: true, args: { org: undefined, raw: [] } })
  })

  it('reads --org and keeps --project for the production check', () => {
    const argv = ['--org=abc', '--project=finflow-e94b5']
    expect(parseCheckJournalArgs(argv)).toEqual({ ok: true, args: { org: 'abc', raw: argv } })
  })

  it.each([['--apply'], ['--nope'], ['--org='], ['--org=a/b']])('refuses %s (the script has no write mode)', (arg) => {
    expect(parseCheckJournalArgs([arg]).ok).toBe(false)
  })
})

describe('assertReadinessTarget', () => {
  it('refuses production without the explicit project flag', () => {
    expect(assertReadinessTarget({ emulator: false, args: [] }).ok).toBe(false)
    expect(assertReadinessTarget({ emulator: false, args: ['--project=other'] }).ok).toBe(false)
  })

  it('allows production with the flag and the emulator without it', () => {
    expect(assertReadinessTarget({ emulator: false, args: ['--project=finflow-e94b5'] }).ok).toBe(true)
    expect(assertReadinessTarget({ emulator: true, args: [] }).ok).toBe(true)
  })
})
