// Measures a whole Finmap import on synthetic rows against the emulator (S14b). Gated by FINMAP_PERF=<rows> (skipped otherwise);
// FINMAP_PERF_RUNS=<n> runs the same import n times in this process (run 1 is cold, the next ones warm). Nothing is asserted about
// time. Results go to stdout as `FINMAP_PERF {json}` lines, one per run and phase group, because vitest hides console output in
// the emulator run. The numbers are: emulator, one machine, the runs printed; production latency is not measured here.
import { describe, expect, it, vi } from 'vitest'
import type { Firestore, Transaction } from 'firebase-admin/firestore'
import { normKey } from '@/lib/domain/import/finmap/fold'
import type { FinmapCheckOp, FinmapSetupRequest } from '@/lib/domain/import/finmap/request'
import { resolveOps } from '@/lib/domain/import/finmap/resolve'
import { planFinmap } from '@/lib/domain/import/finmap/plan'
import { parseFinmapTable } from '@/lib/domain/import/finmap/rows'
import { readXlsxTable } from '@/lib/domain/import/finmap/xlsx'
import type { FinmapExisting } from '@/lib/domain/import/finmap/types'
import type { ImportDeps } from '@/lib/server/imports/deps'
import { finmapBatch } from '@/lib/server/imports/finmap/batch'
import { finmapCheck } from '@/lib/server/imports/finmap/check'
import { finmapFinish } from '@/lib/server/imports/finmap/finish'
import { finmapSetup } from '@/lib/server/imports/finmap/setup'
import { undoFinmapStep } from '@/lib/server/imports/finmap/undo'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { buildFinmapTable } from '@/tests/helpers/finmap-fixture'
import { makeXlsx } from '@/tests/helpers/make-xlsx'
import { ORG, UID, clearFirestore, makeDeps, seedOrg, testDb } from './helpers'

const ROWS = Number(process.env.FINMAP_PERF ?? 0)
const RUNS = Math.max(1, Number(process.env.FINMAP_PERF_RUNS ?? 2))
const perf = ROWS > 0 ? it : it.skip

/** The Warsaw day and time of the run: after the synthetic actual rows, before the planned ones. */
const NOW = new Date('2026-11-20T10:00:00Z')
const TODAY = '2026-11-20'
const EXISTING: FinmapExisting = { companyCurrency: 'PLN', accounts: [], categories: [], counterparties: [], tags: [] }
const REQUEST_OPS = 60

interface TxCounter {
  /** runTransaction calls made. */
  started: number
  /** calls whose transaction function completed (committed, not thrown). */
  committed: number
  /** committed transactions whose last attempt read or wrote a step lock (`importLocks/...`). */
  lock: number
}

/**
 * Counts the transactions of an emulator database and which of them touch a step lock. A transaction touches a lock when one of
 * its reads or writes names an `importLocks` document; the rest of the call is unchanged.
 */
function countTransactions(db: Firestore): { counter: TxCounter; restore: () => void } {
  const real = db.runTransaction.bind(db)
  const counter: TxCounter = { started: 0, committed: 0, lock: 0 }
  const spy = vi.spyOn(db, 'runTransaction').mockImplementation(((update: (t: Transaction) => Promise<unknown>, options?: unknown) => {
    counter.started++
    let lastAttemptLock = false
    return real(async (t: Transaction) => {
      lastAttemptLock = false
      const watched = new Proxy(t, {
        get(target, prop) {
          const value: unknown = Reflect.get(target, prop, target)
          if (typeof value !== 'function') return value
          return (...args: unknown[]) => {
            for (const a of args) {
              const path = typeof a === 'object' && a !== null && 'path' in a ? (a as { path: unknown }).path : undefined
              if (typeof path === 'string' && path.includes('/importLocks/')) lastAttemptLock = true
            }
            return (value as (...xs: unknown[]) => unknown).apply(target, args)
          }
        },
      })
      return update(watched)
    }, options as never).then((result) => {
      counter.committed++
      if (lastAttemptLock) counter.lock++
      return result
    })
  }) as unknown as typeof db.runTransaction)
  return { counter, restore: () => spy.mockRestore() }
}

const rssMb = (): number => Math.round(process.memoryUsage().rss / 1048576)
const emit = (line: Record<string, unknown>): void => {
  process.stdout.write(`FINMAP_PERF ${JSON.stringify(line)}\n`)
}

/** One whole import on a fresh company: build, read, parse, plan, setup, resolve, check, batches, finish, verify, undo. */
async function oneRun(run: number, rows: number): Promise<void> {
  const db = testDb()
  await clearFirestore()
  await seedOrg(db, ORG)
  const ledger = makeDeps(db, { now: () => NOW, today: () => TODAY })
  const deps: ImportDeps = { db, ledger, now: ledger.now, today: ledger.today }

  const ms: Record<string, number> = {}
  let t = performance.now()
  const phase = (name: string): void => {
    const at = performance.now()
    ms[name] = Math.round(at - t)
    t = at
  }
  let peakRss = process.memoryUsage().rss
  const sample = (): void => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss)
  }
  const cpu0 = process.cpuUsage()

  const table = buildFinmapTable({ rows, accounts: 6, pairEvery: 200, future: 50, seed: 11, endDay: '2026-10-31', days: 540 })
  const bytes = makeXlsx(table)
  phase('build')
  const readTable = readXlsxTable(bytes)
  phase('read')
  const parsed = parseFinmapTable(readTable)
  phase('parse')
  const plan = planFinmap(parsed.rows, EXISTING, { includePlanned: true, pairTransfers: true, today: TODAY })
  phase('plan')

  const { counter, restore } = countTransactions(db)
  try {
    const setupRequest: FinmapSetupRequest = {
      fileName: 'synthetic.xlsx',
      accounts: plan.create.accounts.map((name) => ({ name, type: 'bank', currency: 'PLN', currentBalanceMinor: null })),
      categories: plan.create.categories,
      counterparties: plan.create.counterparties,
      tags: plan.create.tags,
    }
    const setup = await finmapSetup(deps, ORG, UID, setupRequest)
    phase('setup')
    const resolved = resolveOps(plan.operations, setup, EXISTING)
    phase('resolve')
    sample()

    // The client checks only operations on accounts that existed before the run; a fresh company has none.
    const newAccounts = new Set(plan.create.accounts.map(normKey))
    const checks: FinmapCheckOp[] = plan.operations
      .map((op, i) => ({ op, i }))
      .filter(({ op }) => !newAccounts.has(normKey(op.account)) && (op.toAccount === null || !newAccounts.has(normKey(op.toAccount))))
      .map(({ i }) => {
        const o = resolved.ops[i]
        return { accountId: o.accountId, toAccountId: o.toAccountId, identity: o.identity, ordinal: o.ordinal }
      })
    if (checks.length > 0) await finmapCheck(deps, ORG, checks)
    phase('check')

    const before = { started: counter.started, committed: counter.committed, lock: counter.lock }
    let created = 0
    let refused = 0
    let requests = 0
    for (let i = 0; i < resolved.ops.length; i += REQUEST_OPS) {
      const r = await finmapBatch(deps, ORG, UID, { importId: setup.importId, operations: resolved.ops.slice(i, i + REQUEST_OPS) })
      created += r.created
      refused += r.refused.length
      requests++
      sample()
    }
    phase('batches')
    const inBatches = { started: counter.started - before.started, committed: counter.committed - before.committed, lock: counter.lock - before.lock }

    const finished = await finmapFinish(deps, ORG, UID, setup.importId)
    phase('finish')
    const verified = await verifyLedger(ledger, ORG)
    phase('verify')

    let deleted = 0
    let steps = 0
    let cursor: string | undefined
    for (;;) {
      const r = await undoFinmapStep(deps, ORG, UID, setup.importId, cursor)
      steps++
      deleted += r.deleted
      sample()
      if (r.done) break
      cursor = r.next ?? undefined
    }
    phase('undo')
    const afterUndo = await verifyLedger(ledger, ORG)
    phase('verifyAfterUndo')
    const cpu = process.cpuUsage(cpu0)

    const totalMs = Object.values(ms).reduce((a, b) => a + b, 0)
    const batchMs = ms.batches
    emit({
      kind: 'run', run, rows, planOperations: plan.operations.length, refusedInPlan: Object.values(plan.counts.refused).reduce((a, b) => a + (b ?? 0), 0),
      created, refused, requests, checked: checks.length, setupCreated: setup.created,
      msByPhase: ms, totalMs, cpuMs: Math.round((cpu.user + cpu.system) / 1000),
      opsPerSecondBatches: batchMs > 0 ? Math.round((created / batchMs) * 1000) : null,
      transactions: {
        allStarted: counter.started, allCommitted: counter.committed, allLock: counter.lock,
        lockShareAll: counter.started > 0 ? Number((counter.lock / counter.started).toFixed(3)) : null,
        batchesStarted: inBatches.started, batchesCommitted: inBatches.committed, batchesLock: inBatches.lock,
        lockShareBatches: inBatches.started > 0 ? Number((inBatches.lock / inBatches.started).toFixed(3)) : null,
      },
      ledgerAfterImport: { ok: verified.ok, transactions: verified.transactions, balanceDiffs: verified.balanceDiffs.length, rollupDiffs: verified.rollupDiffs.length },
      finishFitted: finished.fitted.length,
      undo: { steps, deleted, ledgerAfterUndo: { ok: afterUndo.ok, transactions: afterUndo.transactions } },
      peakRssMb: Math.round(peakRss / 1048576), rssNowMb: rssMb(),
      note: 'emulator, one machine; production latency unmeasured; emulator JVM memory not included',
    })
    expect(created).toBe(plan.operations.length)
    expect(verified.ok).toBe(true)
    expect(deleted).toBe(created)
    expect(afterUndo.transactions).toBe(0)
  } finally {
    restore()
  }
}

describe('Finmap import performance', () => {
  perf(`imports ${ROWS} synthetic rows, ${RUNS} run(s) in this process`, async () => {
    for (let run = 1; run <= RUNS; run++) await oneRun(run, ROWS)
  }, 3_600_000)
})
