// Records real NBP table A months into tests/fixtures/nbp/ (trimmed to a few currencies).
// Run by hand when a fixture month is needed: node scripts/record-nbp-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MONTHS = ['2025-04', '2025-10', '2025-11', '2025-12', '2026-01', '2026-10']
const KEEP = new Set(['EUR', 'USD', 'UAH', 'GBP'])
const outDir = resolve(import.meta.dirname, '..', 'tests', 'fixtures', 'nbp')
mkdirSync(outDir, { recursive: true })

for (const month of MONTHS) {
  const [y, m] = month.split('-').map(Number)
  const first = `${month}-01`
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  const to = last < today ? last : today
  const res = await fetch(`https://api.nbp.pl/api/exchangerates/tables/A/${first}/${to}/?format=json`)
  if (!res.ok) throw new Error(`${month}: NBP answered ${res.status}`)
  const tables = (await res.json()).map((t) => ({
    no: t.no,
    effectiveDate: t.effectiveDate,
    rates: Object.fromEntries(t.rates.filter((r) => KEEP.has(r.code)).map((r) => [r.code, r.mid])),
  }))
  writeFileSync(resolve(outDir, `${month}.json`), JSON.stringify(tables, null, 2) + '\n')
  console.log(month, tables.length, 'tables, last', tables.at(-1).effectiveDate)
}
