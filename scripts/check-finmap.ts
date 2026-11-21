// Local check of real Finmap «Płatności» exports (S14b). Reads every .xlsx in a folder (argv[2], default .local/finmap-samples),
// reads, parses and plans it as the import does (empty FinFlow names, planned rows on, transfer pairing on) and prints the
// report of lib/check-finmap.ts. Writes nothing; prints no name, comment or amount.
//   npx tsx scripts/check-finmap.ts [folder] [company currency]
// Exit code: 0 the folder was read, 2 the folder is missing.
import fs from 'node:fs'
import path from 'node:path'
import { planFinmap } from '@/lib/domain/import/finmap/plan'
import { parseFinmapTable } from '@/lib/domain/import/finmap/rows'
import { readXlsxTable } from '@/lib/domain/import/finmap/xlsx'
import type { FinmapExisting } from '@/lib/domain/import/finmap/types'
import { todayDay } from '@/lib/utils/today'
import { reportLines, type FinmapCheck } from './lib/check-finmap'

const folder = path.resolve(process.argv[2] ?? '.local/finmap-samples')
const companyCurrency = process.argv[3] ?? 'PLN'

if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
  console.error(`No folder: ${folder}`)
  process.exit(2)
}

const files = fs
  .readdirSync(folder)
  .filter((name) => name.toLowerCase().endsWith('.xlsx') && fs.statSync(path.join(folder, name)).isFile())
  .sort()

if (files.length === 0) console.log(`No .xlsx files in ${folder}`)

const existing: FinmapExisting = { companyCurrency, accounts: [], categories: [], counterparties: [], tags: [] }
const ms = (t0: number): number => Math.round(performance.now() - t0)

for (const name of files) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(folder, name)))
  let t0 = performance.now()
  let table: string[][]
  try {
    table = readXlsxTable(bytes)
  } catch {
    console.log(`== ${name} · not a readable xlsx workbook`)
    console.log('')
    continue
  }
  const readMs = ms(t0)

  t0 = performance.now()
  const parsed = parseFinmapTable(table)
  const parseMs = ms(t0)

  t0 = performance.now()
  const plan = parsed.issues.length === 0 ? planFinmap(parsed.rows, existing, { includePlanned: true, pairTransfers: true, today: todayDay() }) : null
  const planMs = ms(t0)

  const check: FinmapCheck = { name, rowsRead: parsed.rows.length, issues: parsed.issues, plan, timings: { readMs, parseMs, planMs } }
  console.log(reportLines(check).join('\n'))
  console.log('')
}
