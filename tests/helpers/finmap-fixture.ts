/**
 * Synthetic Finmap «Płatności» export for tests (S14b). Every name, comment and amount is made up; the header uses the
 * export's Polish names with some Cyrillic look-alike letters (written as escapes), as the real file has them.
 * Deterministic: the same options give the same table.
 */

/** The export's header, in the export's column order (fold to the names of `columns.ts`). */
export const FINMAP_HEADER: readonly string[] = [
  'Dаta płatności', // paymentDate
  'Data zaksięgowania', // bookingDate
  'Okres księgowania (data od)', // periodFrom
  'Okres księgowania (data do)', // periodTo
  'Kwotа w walucie konta', // amountAccount
  'Kwota w walucie firmy', // amountCompany
  'Z konta', // from
  'Na konto', // to
  'Kategoria', // category
  'Podkategoria', // subcategory
  'Kontrahent', // counterparty
  'Podkontrahent', // subcounterparty
  'Projekt', // project
  'Podprojekt', // subproject
  'Tagi', // tags
  'Komentarz', // comment
]

export interface FinmapFixtureOptions {
  /** Data rows (the header is not counted). A transfer pair counts as its two rows. */
  rows: number
  /** Accounts used by the rows (at least 2 when pairs are written). Default 4. */
  accounts?: number
  /** Span of the actual days, counted back from `endDay`. Default 365. */
  days?: number
  /** Every this many rows starts a transfer pair (expense and income, same minute and amount, different accounts, no category or counterparty). 0 writes no pairs. Default 0. */
  pairEvery?: number
  /** Rows dated after today (2026-12-01 onwards), which the planner keeps as planned operations when asked. Default 0. */
  future?: number
  /** Seed of the generator. Default 1. */
  seed?: number
  /** The newest actual day. Default 2026-10-31. */
  endDay?: string
}

const EXCEL_EPOCH_DAYS = 25569
const FUTURE_START = '2026-12-01'

/** Seeded linear congruential generator in [0, 1). */
function generator(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

/** Days since 1970-01-01 of a YYYY-MM-DD string, plus the Excel serial of its midnight. */
function serialOf(day: string, minute: number): number {
  const days = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86400000
  return days + EXCEL_EPOCH_DAYS + minute / 1440
}

function addDaysTo(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
}

function dotted(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`
}

interface Built {
  serial: number
  seq: number
  cells: string[]
}

/** What a synthetic row says; the payment day and minute are given apart. */
interface RowSpec {
  amount: string
  from: string
  to: string
  category: string
  sub: string
  counterparty: string
  tags: string
  comment: string
  accrual: boolean
}

/** A table of `rows` data rows (plus the header), newest first. Rows are synthetic; the header is the export's Polish names. */
export function buildFinmapTable(opts: FinmapFixtureOptions): string[][] {
  const accounts = Math.max(2, opts.accounts ?? 4)
  const days = opts.days ?? 365
  const pairEvery = opts.pairEvery ?? 0
  const future = Math.min(opts.future ?? 0, opts.rows)
  const endDay = opts.endDay ?? '2026-10-31'
  const rand = generator(opts.seed ?? 1)
  const pick = (n: number): number => Math.floor(rand() * n)
  const money = (): string => (1 + pick(50000) / 100).toFixed(2)

  const accountName = (k: number): string => `Konto ${k + 1}`
  const counterparty = (): string => `Kontrahent ${pick(30) + 1}`
  const tagsCell = (): string => {
    const n = pick(10)
    if (n < 7) return ''
    const first = `Tag ${pick(6) + 1}`
    return n < 9 ? first : `${first}, Tag ${pick(6) + 1}`
  }
  const commentCell = (n: number): string => (pick(100) < 3 ? `Komentarz ${n}` : '')
  const expenseCategory = (): { category: string; sub: string } => {
    if (pick(10) < 3) return { category: 'Kategorie wydatków', sub: '' }
    const p = pick(6) + 1
    return { category: `Kategoria wydatku ${p}`, sub: pick(4) === 0 ? '' : `Podkategoria ${p}.${pick(3) + 1}` }
  }

  const built: Built[] = []
  const push = (day: string, minute: number, row: RowSpec): void => {
    const cells = new Array<string>(FINMAP_HEADER.length).fill('')
    cells[0] = String(Number(serialOf(day, minute).toFixed(6)))
    cells[1] = dotted(day)
    if (row.accrual) {
      cells[2] = dotted(addDaysTo(day, -30))
      cells[3] = dotted(day)
    }
    cells[4] = row.amount
    cells[5] = row.amount
    cells[6] = row.from
    cells[7] = row.to
    cells[8] = row.category
    cells[9] = row.sub
    cells[10] = row.counterparty
    cells[14] = row.tags
    cells[15] = row.comment
    built.push({ serial: serialOf(day, minute), seq: built.length, cells })
  }

  let made = 0
  let slot = 0
  while (made < opts.rows) {
    const isFuture = made < future
    const day = isFuture ? addDaysTo(FUTURE_START, pick(60)) : addDaysTo(endDay, -pick(days))
    const minute = pick(1440)
    const accrual = pick(25) === 0
    const comment = commentCell(made)
    if (!isFuture && pairEvery > 0 && slot % pairEvery === 0 && opts.rows - made >= 2) {
      const a = pick(accounts)
      const b = (a + 1 + pick(accounts - 1)) % accounts
      const amount = money()
      push(day, minute, { amount, from: accountName(a), to: '', category: 'Kategorie wydatków', sub: '', counterparty: '', tags: '', comment: '', accrual: false })
      push(day, minute, { amount, from: '', to: accountName(b), category: 'Kategorie dochodów', sub: '', counterparty: '', tags: '', comment: '', accrual: false })
      made += 2
    } else if (slot === 5 && !isFuture) {
      push(day, minute, { amount: '0.00', from: accountName(pick(accounts)), to: '', ...expenseCategory(), counterparty: '', tags: '', comment: '', accrual: false })
      made += 1
    } else if (pick(100) < 7) {
      const p = pick(4) + 1
      push(day, minute, {
        amount: money(), from: '', to: accountName(pick(accounts)),
        category: `Kategoria przychodu ${p}`, sub: pick(2) === 0 ? '' : `Podprzychód ${p}.${pick(2) + 1}`,
        counterparty: pick(3) === 0 ? counterparty() : '', tags: tagsCell(), comment, accrual,
      })
      made += 1
    } else {
      const exp = expenseCategory()
      push(day, minute, {
        amount: money(), from: accountName(pick(accounts)), to: '', ...exp,
        counterparty: pick(5) < 3 ? counterparty() : '', tags: tagsCell(), comment, accrual,
      })
      made += 1
    }
    slot++
  }

  // Newest first; rows of the same moment keep the order they were made in.
  built.sort((x, y) => y.serial - x.serial || x.seq - y.seq)
  return [[...FINMAP_HEADER], ...built.map((b) => b.cells)]
}
