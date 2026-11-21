# S14b (part 1): Finmap import with batch writes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner or accountant uploads a Finmap «Płatności» `.xlsx` (about 41 000 rows), sees a preview, approves creating missing accounts/categories/counterparties/tags, and the operations are written in batches of ~60 per Firestore transaction. Transfers (expense+income pairs) become one transfer. The import can be undone; importing the same file again creates 0 new operations.

**Architecture:** Pure code in `lib/domain/import/finmap/` (header folding, xlsx table reader, row parsing, planner with name matching, transfer pairing and key identity). Server module `lib/server/imports/finmap/` (idempotent entity setup, a batch writer that builds operations with the existing `buildTransaction` / `changeSet` and applies one combined balance and rollup change per transaction, fit-at-finish, batched undo). The browser reads the 28 MB file (it cannot be uploaded in one request), plans, and drives the steps. Reuses the S14 `imports/{id}` documents, `bankSeen` marks, `importLocks` and the Settings → Imports page.

**Tech Stack:** Next.js 16, React 19 (React Compiler: no setState in effect bodies), next-intl (uk/pl/en identical keys, edit JSON by targeted text insertion, never parse and re-serialize), Firestore Admin, `fflate` (already a dependency; check it is in `dependencies`), Vitest (does not typecheck: always `npm run typecheck`; if it dies with out-of-memory use `node --max-old-space-size=2048 node_modules/typescript/bin/tsc --noEmit`), Playwright e2e on the emulator. tsconfig targets ES2017.

**Spec:** `docs/superpowers/specs/2026-11-20-s14b-finmap-import-design.md` (read it first, it is in Ukrainian). Branch: `s14b-finmap-import` (created, the spec is committed). S14 (MT940) is merged; read `CLAUDE.md` section "File import: MT940 and undo (S14)" first: this plan reuses its pieces.

## Decisions made while planning (Task 1 writes the ones that touch the spec into the spec)

1. **Operation id `fm_<key>`**, mark `bankSeen/{key}` `{ txId, at, importId, kind: 'finmap' }` (own key namespace `finmap`). Key = `sha256(['finmap', accountId, toAccountId or '', ...identity, ordinal])` first 32 hex, recomputed on the server from the op's fields; the client sends `identity` (strings that do not contain account names) and `ordinal`. `bk_` ids are untouched.
2. **New transaction field `importId`** (stored string, parsed by `parseTransaction`, written by `transactionToDoc`). **`updateTransaction` must carry `importId` from the prior document** (it builds `next` from `toRawInput`, which does not know it); without this an edit would drop the link.
3. **`imports/{id}.kind: 'mt940' | 'finmap'`** (missing = `mt940`, existing documents). `ImportView` gets `kind`.
4. **Audit:** new action `import.batch` and `via: 'import'` (one entry per batch transaction: `before: null`, `after: { importId, created: n }`); undo of Finmap uses `via: 'import-undo'` with action `import.batch`.
5. **Write budget per transaction: 450** (Firestore limit 500). Writes = operations + marks + distinct balance documents + distinct rollup documents + 1 audit. The writer computes this from the pure `changeSet` and splits a request's operations into several transactions greedily; a request has at most 60 operations.
6. **Tags' `excluded` flag** comes from the tag documents: read once outside the transaction (to size the batch) and re-read inside; if a flag differs the batch throws `LedgerError('conflict')` and the client retries the step once.
7. **Foreign accounts:** the amount is the «Kwota w walucie konta» column; FinFlow converts with NBP via `fxPlan` / `attachFx`; rates are resolved once per distinct `(from, to, date)` per request (memoised) outside the transaction. The company-currency column is ignored.
8. **Header language:** only the Polish header names of the «Płatności» export (after folding). A file with other headers is refused with `unknown_layout` and the list of missing columns.
9. **Tags split** on `,` and `;`.
10. **Retry of a run:** `POST /imports/finmap/setup` accepts an optional `importId` of an `applied` finmap import to continue it (entities are matched by name, so repeating setup creates nothing new).

## File structure

Create (domain, pure):
- `lib/domain/import/finmap/types.ts` — constants, `FinmapRow`, `PlannedOp`, `FinmapPlan`, options, reasons.
- `lib/domain/import/finmap/fold.ts` — `foldHeader`, `normName`.
- `lib/domain/import/finmap/columns.ts` — `matchColumns`.
- `lib/domain/import/finmap/rows.ts` — `parseFinmapTable`.
- `lib/domain/import/finmap/xlsx.ts` — `readXlsxTable`.
- `lib/domain/import/finmap/plan.ts` — `planFinmap`, `finmapIdentity`.
- `lib/domain/import/finmap/budget.ts` — `splitByWriteBudget`.
- `lib/domain/import/finmap/request.ts` — parsers for check / setup / batch / finish bodies.
- `lib/domain/import/finmap/state.ts` — the dialog reducer.

Create (server): `lib/server/imports/finmap/{key,setup,batch,check,finish,undo}.ts`, `lib/server/imports/finmap/index.ts`.
Routes: `app/api/orgs/[orgId]/imports/finmap/{check,setup,batch,finish}/route.ts`.
Client: `lib/api/finmap-client.ts`, `components/import/{ImportSourceDialog,FinmapDialog,FinmapAccountRows}.tsx`.
Tools/tests: `scripts/check-finmap.ts`, `scripts/lib/check-finmap.ts`, `tests/helpers/make-xlsx.ts`, tests listed per task, `tests/e2e/finmap-import.spec.ts`.

Modify: `lib/domain/ledger/types.ts`, `lib/domain/ledger/doc.ts`, `lib/server/ledger/{write,audit}.ts`, `lib/server/imports/{types,undo,list,index}.ts`, `lib/domain/import/view.ts`, `components/import/ImportButton.tsx`, `app/(app)/[orgSlug]/settings/imports/page.tsx`, `messages/{uk,pl,en}.json`, `tests/e2e/api-guards.spec.ts`, `CLAUDE.md`, `PROGRESS.md`, `firestore.rules` (comment only), the spec status.

## Conventions every task follows

- TDD: failing test, see it fail, implement, see it pass, commit **early and often** (sessions can be cut). Conventional Commits; every message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Unit: `npx vitest run <file>`. Integration (list files explicitly): `npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts tests/integration/<file>.test.ts"` (Java at `~/.jre/temurin-21/bin` on PATH). e2e: `npx firebase emulators:exec --only auth,firestore --project demo-finflow "npx playwright test tests/e2e/<file>.spec.ts"`. The development machine may have very little free RAM (check with `Get-CimInstance Win32_OperatingSystem`, FreePhysicalMemory): run ONE heavy command at a time; if free RAM is under ~3 GB do not start the dev server or Playwright, leave e2e to CI and say so in the report.
- After each task: typecheck and `npx eslint <changed files>` clean.
- Never kill node processes by image name. Never push to master. Do not push the branch or open a PR (the controller does).
- Real data: the owner's real file is in `.local/finmap-samples/` (git-ignored). Never copy its rows, names (accounts, categories, counterparties, tags, comments) or amounts into the repository, tests, docs, commit messages or reports; only aggregate counts and shapes may be reported. Fixtures are synthetic.

---

### Task 1: `importId` on operations; audit `import.batch`

**Files:** Modify `lib/domain/ledger/types.ts` (`LedgerTransaction`), `lib/domain/ledger/doc.ts` (`transactionToDoc`, `parseTransaction`), `lib/server/ledger/write.ts` (`updateTransaction`), `lib/server/ledger/audit.ts`; test `tests/unit/domain/ledger/import-id.test.ts` and an integration case in `tests/integration/ledger-write.test.ts` (or the nearest existing ledger write integration test; read `ls tests/integration`).

- [ ] **Step 1: failing unit tests.**

```ts
import { describe, expect, it } from 'vitest'
import { parseTransaction, transactionToDoc } from '@/lib/domain/ledger/doc'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

const base: LedgerTransaction = {
  id: 'fm_1', type: 'expense', status: 'actual', accountId: 'a1', amountMinor: 500, currency: 'PLN', paymentDate: '2026-10-02',
  accrual: { mode: 'date', date: '2026-10-02' }, isRecurring: false, tags: [], fileUrls: [],
}

describe('importId', () => {
  it('is stored and read back', () => {
    const doc = transactionToDoc({ ...base, importId: 'imp1' })
    expect(doc.importId).toBe('imp1')
    expect(parseTransaction('fm_1', doc)?.importId).toBe('imp1')
  })
  it('is absent when the operation has none', () => {
    expect('importId' in transactionToDoc(base)).toBe(false)
    expect(parseTransaction('x', transactionToDoc(base))?.importId).toBeUndefined()
  })
  it('a malformed importId makes the document unreadable', () => {
    expect(parseTransaction('x', { ...transactionToDoc(base), importId: 5 })).toBeNull()
  })
})
```

- [ ] **Step 2: implement.** `LedgerTransaction.importId?: string` (doc comment: «the statement or file import (S14) that wrote the operation; never taken from a request»); `transactionToDoc`: `if (tx.importId !== undefined) doc.importId = tx.importId`; `parseTransaction`: `if (data.importId !== undefined) { if (typeof data.importId !== 'string' || data.importId === '') return null; tx.importId = data.importId }` (place next to the `excluded` handling).
- [ ] **Step 3:** in `updateTransaction` (`write.ts`), after `next` is prepared and before `commit`, carry the link: `if (prior.tx.importId !== undefined) next.tx = { ...next.tx, importId: prior.tx.importId }`. Also check `makeTransfer`/`splitTransfer`/`plan-match` paths that rebuild documents (read `lib/server/ledger/transfer.ts`, `plan-match.ts`): they may drop `importId`; this is acceptable for transfers (the operation is then kept by the undo because it changed), but document it in a comment next to the carry. Integration test: create an operation through the batch-independent path with `importId` set directly in the stored document (use the test helper that writes a transaction document, or `createTransaction` then `db.doc(...).update({ importId: 'imp1' })`), then `updateTransaction` with a new category and assert the stored `importId` is still `imp1`.
- [ ] **Step 4:** `audit.ts`: add `'import.batch'` to `AuditAction`, `'import'` to `AuditMeta['via']` (keep `'import-undo'`); update the doc comments.
- [ ] **Step 5:** run the unit tests, `tests/unit/domain/ledger`, the integration test above plus `tests/integration/ledger-write*.test.ts` that exist; typecheck; eslint. Commit `feat(ledger): operations may carry the import that wrote them`.

---

### Task 2: Finmap table reading (folding, columns, rows, xlsx)

**Files:** Create `lib/domain/import/finmap/{types,fold,columns,rows,xlsx}.ts`, `tests/helpers/make-xlsx.ts`; tests `tests/unit/domain/import/finmap/{fold,columns,rows,xlsx}.test.ts`.

- [ ] **Step 1: `types.ts` (start; Task 3 adds the plan types).**

```ts
export const MAX_FINMAP_BYTES = 100 * 1024 * 1024
export const MAX_FINMAP_ROWS = 100_000
/** Operations a batch request carries. */
export const FINMAP_BATCH_OPS = 60
/** Writes one Firestore transaction may hold (the limit is 500). */
export const WRITE_BUDGET = 450
/** Finmap's built-in "no category" names (the Polish export). Matched after `normKey`. */
export const NO_CATEGORY_NAMES = ['kategorie dochodów', 'kategorie wydatków'] as const

export type ColumnKey =
  | 'paymentDate' | 'bookingDate' | 'periodFrom' | 'periodTo' | 'amountAccount' | 'amountCompany'
  | 'from' | 'to' | 'category' | 'subcategory' | 'counterparty' | 'subcounterparty' | 'project' | 'subproject' | 'tags' | 'comment'

/** One data row of the export. Names are whitespace-normalised, never folded. */
export interface FinmapRow {
  /** 1-based row number in the sheet (the header is row 1). */
  line: number
  /** YYYY-MM-DD, or null when the cell is not a date. */
  paymentDay: string | null
  /** The payment date cell exactly as the file has it (an Excel serial with a time, or text): part of the key, never shown. */
  timeText: string
  /** Minutes since midnight of the payment time (0 when the cell has no time). */
  minute: number
  /** «Kwota w walucie konta» in minor units; null when not a number with at most 2 decimals. */
  amountMinor: number | null
  from: string | null
  to: string | null
  category: string | null
  subcategory: string | null
  counterparty: string | null
  hasSubcounterparty: boolean
  hasProject: boolean
  tags: string[]
  comment: string | null
  /** Period «od» and «do» as days; null when either is missing or unreadable. */
  period: { from: string; to: string } | null
}

export type TableIssueCode = 'unknown_layout' | 'empty' | 'too_many_rows'
export interface TableIssue {
  code: TableIssueCode
  /** For `unknown_layout`: the column keys that were not found. */
  missing?: ColumnKey[]
}
```

- [ ] **Step 2: `fold.ts` + test.**

```ts
/** Cyrillic letters that look like Latin ones: the Finmap export mixes them into its header names. */
const LOOKALIKE: Record<string, string> = {
  'А': 'A', 'а': 'a', 'В': 'B', 'Е': 'E', 'е': 'e', 'К': 'K', 'к': 'k', 'М': 'M', 'Н': 'H', 'О': 'O', 'о': 'o',
  'Р': 'P', 'р': 'p', 'С': 'C', 'с': 'c', 'Т': 'T', 'Х': 'X', 'х': 'x', 'У': 'Y', 'у': 'y', 'І': 'I', 'і': 'i',
  'Ѕ': 'S', 'ѕ': 's', 'Ј': 'J', 'ј': 'j',
}

/** A header name as a comparison key: look-alikes to Latin, lower case, no diacritics, only letters and digits. */
export function foldHeader(s: string): string {
  let out = ''
  for (const ch of s) out += LOOKALIKE[ch] ?? ch
  return out.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]/g, '')
}

/** A name from a data cell: whitespace collapsed (including tabs and line breaks), trimmed; null when empty. */
export function normName(s: string | undefined | null): string | null {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t === '' ? null : t
}

/** The key two names are compared by: `normName`, lower case. Not folded: a name in Cyrillic stays Cyrillic. */
export function normKey(s: string): string {
  return (normName(s) ?? '').toLowerCase()
}
```

Tests: the real header strings are NOT to be copied from the owner's file; construct them in the test by replacing letters of the plain Polish names with the look-alikes: `foldHeader('Datа рłаtnоśсi')` equals `foldHeader('Data płatności')` equals `'dataplatnosci'` (write the Cyrillic letters with `а` escapes, e.g. `'Datа płаtności'` with `р`=`р`, `о`=`о`, `с`=`с`); `'\t\nKontrahent'` folds to `kontrahent`; `normName(' a \t b\n')` is `'a b'`; `normKey('Domas  Kasa')` equals `normKey('domas kasa')`.

- [ ] **Step 3: `columns.ts` + test.**

```ts
import { foldHeader } from './fold'
import type { ColumnKey } from './types'

const HEADERS: Record<ColumnKey, string> = {
  paymentDate: 'dataplatnosci', bookingDate: 'datazaksiegowania', periodFrom: 'okresksiegowaniadataod', periodTo: 'okresksiegowaniadatado',
  amountAccount: 'kwotawwaluciekonta', amountCompany: 'kwotawwaluciefirmy', from: 'zkonta', to: 'nakonto',
  category: 'kategoria', subcategory: 'podkategoria', counterparty: 'kontrahent', subcounterparty: 'podkontrahent',
  project: 'projekt', subproject: 'podprojekt', tags: 'tagi', comment: 'komentarz',
}
const REQUIRED: readonly ColumnKey[] = ['paymentDate', 'amountAccount', 'from', 'to']

export type ColumnMap = Partial<Record<ColumnKey, number>>

/** Finds the export's columns in its header row. `missing` lists the required ones that are absent. */
export function matchColumns(header: readonly string[]): { map: ColumnMap; missing: ColumnKey[] } {
  const folded = header.map(foldHeader)
  const map: ColumnMap = {}
  for (const key of Object.keys(HEADERS) as ColumnKey[]) {
    const i = folded.indexOf(HEADERS[key])
    if (i !== -1) map[key] = i
  }
  return { map, missing: REQUIRED.filter((k) => map[k] === undefined) }
}
```

Test with a synthetic header built from the plain Polish names (and a variant with look-alike letters via escapes): all 16 found; a header without «Z konta» gives `missing: ['from']`.

- [ ] **Step 4: `rows.ts`.** Functions (all pure, with tests in `rows.test.ts`):
  - `excelDay(serial: number): string | null` — `new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000)` formatted `YYYY-MM-DD`; reject serial < 1 or > 2958465.
  - `minuteOf(serial: number): number` — `Math.floor(Math.round((serial - Math.floor(serial)) * 86400) / 60)`.
  - `textDay(s: string): string | null` — `dd.mm.yyyy[ hh:mm:ss]` (also accepts `yyyy-mm-dd`), validated with `isDay` from `lib/domain/ledger/days`.
  - `moneyMinor(s: string): number | null` — `/^-?\d+(\.\d{1,2})?$/`, returns `null` for more decimals or non numbers; negative returns `null` (the export has none; a negative is refused as an amount).
  - `parseFinmapTable(table: string[][]): { rows: FinmapRow[]; issues: TableIssue[] }` — `table[0]` is the header; `matchColumns`; if `missing.length > 0` return `{ rows: [], issues: [{ code: 'unknown_layout', missing }] }`; if there are no data rows `empty`; more than `MAX_FINMAP_ROWS` data rows → `too_many_rows` (rows not returned). A row whose cells are all empty is skipped (not counted). For each data row build `FinmapRow`: `paymentDay` from the numeric serial (`Number(cell)` finite and cell matches `/^\d+(\.\d+)?$/`) else `textDay`; `timeText` is the raw cell; `minute` from the serial (0 for text without time, else parsed hh:mm); names via `normName`; `tags` = split on `,`/`;`, `normName` each, drop empties, drop duplicates (by `normKey`); `comment` via `normName` (do NOT cut it here); `period` = both `textDay(periodFrom)` and `textDay(periodTo)` present; `hasSubcounterparty`, `hasProject` = non-empty `subcounterparty` / `project` or `subproject`.
  Tests: a row with serial `46346.959814814814` gives day `2026-11-16`? — compute the expected day in the test with the same epoch formula independently (`new Date(Date.UTC(1899,11,30)+46346*86400000)`), and `minute` 1379 for `.959814814814` (0.9598148148 × 1440 = 1382.1 → check by hand in the test, do not trust this number: compute `Math.floor(0.959814814814 * 1440)`); amount `'22721.08'` → 2272108, `'4000'` → 400000, `'12.345'` → null, `''` → null; a header-only table → `empty`; unknown header → `unknown_layout` with the missing keys; tags `'ATM, Do zwrotu;ATM'` → `['ATM','Do zwrotu']`.

- [ ] **Step 5: `xlsx.ts`** — `readXlsxTable(bytes: Uint8Array): string[][]` (throws `Error('xlsx')` for a file that is not a readable xlsx; the caller shows "not an Excel file").
  Algorithm: `unzipSync(bytes, { filter: (f) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(f.name) })`; read `workbook.xml` (`<sheet name="…" sheetId r:id="rIdN"/>` list; XML-unescape the names), `workbook.xml.rels` (`Id` → `Target`, `xl/` + target without a leading `/`), choose the sheet whose name folds to contain `export` else the first; `sharedStrings.xml` (each `<si>…</si>` → concatenation of its `<t>` texts; unescape) when present; then scan the sheet XML with `/<row\b[^>]*>([\s\S]*?)<\/row>/g` and inside `/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g`; the cell reference column letters give the index (`A`=0, `AA`=26); `t="s"` → shared string by index; `t="inlineStr"` → concatenated `<t>` of `<is>`; `t="str"` and others → `<v>` text; unescape `&amp; &lt; &gt; &quot; &apos; &#N; &#xH;`. Pad missing cells with `''`. Rows keep their order; rows are returned as written (row numbers are their index + 1 only if no row is skipped: preserve the row attribute `r` by inserting empty rows when `r` jumps, so `FinmapRow.line` matches Excel).
  `tests/helpers/make-xlsx.ts`: `makeXlsx(rows: Array<Array<string | number | null>>, opts?: { shared?: boolean; sheetName?: string }): Uint8Array` builds a minimal valid xlsx with `zipSync` (`[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/worksheets/sheet1.xml`, and `xl/sharedStrings.xml` when `shared`), strings as inline strings or shared strings, numbers as `<v>`. Tests: round trip both styles; a cell with `&amp;` and a line break; a sparse row; a rich-text shared string; a sheet named `ExportPL` chosen over another; garbage bytes throw.
- [ ] **Step 6:** run all unit tests of the folder, typecheck, eslint. Commit `feat(import): Finmap table reading (header folding, xlsx, rows)`.

---

### Task 3: The plan: matching, categories, transfers, keys

**Files:** Create `lib/domain/import/finmap/plan.ts` and extend `types.ts`; test `tests/unit/domain/import/finmap/plan.test.ts`.

- [ ] **Step 1: add to `types.ts`.**

```ts
export type FinmapRefusal = 'date' | 'amount' | 'account' | 'planned_off' | 'accrual_after_horizon'
export type OpKind = 'income' | 'expense' | 'transfer'

/** What the import knows of FinFlow before it starts (names only; ids come back from the setup step). */
export interface FinmapExisting {
  companyCurrency: string
  accounts: Array<{ id: string; name: string; currency: string }>
  categories: Array<{ id: string; name: string; type: 'income' | 'expense'; parentId?: string }>
  counterparties: Array<{ id: string; name: string }>
  tags: Array<{ id: string; name: string }>
}
export interface FinmapOptions {
  /** Rows dated after `today` become planned operations when true, and are left out when false. */
  includePlanned: boolean
  pairTransfers: boolean
  /** The Warsaw day. */
  today: string
}

/** A category reference by names; `child` is the subcategory name. */
export interface CategoryRef {
  type: 'income' | 'expense'
  parent: string
  child: string | null
}

/** One operation the import will write, by names (the client resolves ids after the setup step). */
export interface PlannedOp {
  kind: OpKind
  status: 'actual' | 'planned'
  day: string
  amountMinor: number
  /** Account names: `account` is the source (the expense side or the transfer's source), `toAccount` the target. */
  account: string
  toAccount: string | null
  /** The amount that arrives (transfers between accounts of different currencies); null otherwise. */
  toAmountMinor: number | null
  category: CategoryRef | null
  counterparty: string | null
  tags: string[]
  description: string | null
  accrual: { from: string; to: string } | null
  /** The strings that identify the operation in its key besides the account ids and the ordinal. */
  identity: string[]
  ordinal: number
  /** The sheet lines it came from (one, or two for a transfer): for messages only. */
  lines: number[]
}

export interface FinmapCounts {
  rows: number
  income: number
  expense: number
  transfer: number
  planned: number
  /** Pairs not made because a side has a category or counterparty, or the group is not one expense + one income. */
  pairCandidatesLeft: number
  refused: Partial<Record<FinmapRefusal, number>>
  /** Warnings that do not stop a row. */
  warnings: { commentCut: number; subcounterparty: number; project: number; accrualIgnored: number; categoryIgnored: number }
}

export interface FinmapPlan {
  operations: PlannedOp[]
  /** The first and last day of the operations; null when there are none. */
  period: { from: string; to: string } | null
  /** What does not exist in FinFlow yet (by normalised name; categories parents first). */
  create: {
    accounts: string[]
    categories: CategoryRef[]
    counterparties: string[]
    tags: string[]
  }
  /** Names matched to existing FinFlow items (counts for the preview). */
  matched: { accounts: number; categories: number; counterparties: number; tags: number }
  counts: FinmapCounts
}
```

- [ ] **Step 2: behavior of `planFinmap(rows: readonly FinmapRow[], existing: FinmapExisting, options: FinmapOptions): FinmapPlan`** (implement exactly; every rule has a test):
  1. **Per row** (`classify`): refuse `date` (`paymentDay === null`), `amount` (`amountMinor === null || amountMinor <= 0 || amountMinor > MAX_MINOR`), `account` (neither or both of `from`/`to`); day `> today` → `planned` when `includePlanned` else refused `planned_off`. Kind: `from` only → `expense` with `account = from`; `to` only → `income` with `account = to`.
  2. **Category:** `NO_CATEGORY_NAMES` (compare `normKey`) or null → no category (a non-empty subcategory under a built-in is counted `categoryIgnored`); else `CategoryRef { type: kind, parent: category, child: subcategory }`. The name used for matching/creating is the normalised text of the file; matching existing categories is by `(type, normKey(name))` for the parent and `(parentId, normKey(name))` for the child.
  3. **Accrual:** `period` present with `from <= to` and at most 36 months (`monthsBetween(from, to).length <= MAX_PERIOD_MONTHS`) → keep; present but invalid → `accrual: null` and `warnings.accrualIgnored++`. Transfers never carry an accrual or a category or a counterparty.
  4. **Description:** `comment` cut to 500 characters (`warnings.commentCut++` when cut). `hasSubcounterparty` → `warnings.subcounterparty++`; `hasProject` → `warnings.project++`.
  5. **Identity** (`finmapIdentity(row)`): `[timeText, String(amountMinor), kind, normKey(category ?? ''), normKey(subcategory ?? ''), normKey(counterparty ?? ''), normKey(comment ?? ''), tags.map(normKey).sort().join('|')]`. A transfer's identity is the expense row's identity parts followed by `'+'` and the income row's.
  6. **Ordinals:** after pairing, number operations that share the same `(account, toAccount, identity)` in file order from the FIRST data row of the sheet downward (0, 1, 2…). (The sheet is newest-first; ordinal order must follow the sheet order, so the same file always gives the same numbers.)
  7. **Pairing** (only when `options.pairTransfers`; only `actual` rows): group the `expense` and `income` rows with no real category and no counterparty by `(day, minute, amountMinor)`; a group is paired only when it holds **exactly one expense and one income** and their accounts differ and the two accounts have the same currency (`existing.accounts` by name; an account that does not exist yet is assumed to be in the company currency; the preview lets the user change currency, and the plan is recomputed when they do — `planFinmap` takes the currency of each new account from an optional `newAccountCurrency?: Record<string, string>` in `FinmapOptions`, default company currency). The pair becomes `kind: 'transfer'`, `account` = the expense row's account, `toAccount` = the income row's account, `amountMinor` = the expense amount, `toAmountMinor: null` (same currency), tags = union (sorted by first appearance), `description` = the expense comment, else the income comment, `lines` = both. Rows with a real category or counterparty that would have formed a pair (same group rule but not eligible) count in `pairCandidatesLeft` (count PAIRS, i.e. one per group of one expense + one income across different accounts).
  8. **Creations:** names not matching an existing item, de-duplicated by `normKey`, in first-use order; categories as a parent entry (`child: null`) before any of its children; `matched` counts distinct matched names.
  9. **Counts:** `rows` = data rows read; `income/expense/transfer` count operations written (a transfer counts once and removes two rows); `planned` counts planned operations.
  10. `period` = min and max `day` over operations.
  Tests (synthetic rows only, built with a small helper `row(over)`): direction; built-in category = none; category+subcategory refs and creation order; matching existing items case-insensitively with double spaces; refusal reasons; planned on/off; pairing positive case; no pair when a side has a category, when the group has two expenses, when accounts are equal, when currencies differ; `pairTransfers: false`; `pairCandidatesLeft`; ordinals for identical rows are 0,1,2 in sheet order and a paired transfer's identity differs from two single rows; accrual kept/ignored (period over 36 months; `from > to`); comment cut; warnings; a property test with `fast-check` if the repo already uses it (grep `fast-check`), otherwise a loop over 200 seeded random rows: `income + expense + 2 * transfer + refused` equals `rows`.
- [ ] **Step 3:** unit tests, typecheck, eslint. Commit `feat(import): Finmap plan (matching, categories, transfers, keys)`.

---

### Task 4: Server — import kind, entity setup, finish

**Files:** Create `lib/server/imports/finmap/{key,setup,finish,index}.ts`, `lib/domain/import/finmap/request.ts` (setup + finish parsers); modify `lib/server/imports/types.ts` (+ `kind`, `fitTargets`, `entities`), `lib/domain/import/view.ts` (`kind`), `lib/server/imports/list.ts`; tests `tests/unit/domain/import/finmap/request.test.ts`, `tests/integration/finmap-setup.test.ts`.

- [ ] **Step 1: `ImportDoc` additions** (parse defensively, defaults keep old documents valid): `kind: 'mt940' | 'finmap'` (absent → `'mt940'`), `fitTargets: Record<string, number>` (account id → the current balance the user typed; absent → `{}`), `entities: { accounts: number; categories: number; counterparties: number; tags: number }` (absent → zeros). `ImportView` gets `kind`; `listImports` fills it. Add unit tests to the existing `parseImportDoc` tests (find them with `grep -rn parseImportDoc tests`).
- [ ] **Step 2: `key.ts`.**

```ts
import { createHash } from 'node:crypto'

/** The `bankSeen` key of a Finmap operation: its own namespace, the FinFlow account id(s), the identity strings and the ordinal. */
export function finmapKey(accountId: string, toAccountId: string | null, identity: readonly string[], ordinal: number): string {
  return createHash('sha256').update(['finmap', accountId, toAccountId ?? '', ...identity, String(ordinal)].join('\u0001')).digest('hex').slice(0, 32)
}
export const finmapTxId = (key: string) => `fm_${key}`
```
Unit test: same input same key; another account / ordinal / identity → another key; 32 hex characters; differs from `importKey` of the MT940 module for the same strings.
- [ ] **Step 3: request parsers** (`request.ts`, same style as `lib/domain/import/request.ts`, `Parsed<T>` with `field`):
  - `parseFinmapSetup(body)`: `{ importId?, fileName, accounts: Array<{ name; type: 'bank'|'cash'|'card'|'crypto'; currency: /^[A-Z]{3}$/; currentBalanceMinor: number | null }> (≤ 200), categories: CategoryRef[] (≤ 5000, parents first is NOT assumed: the server orders them), counterparties: string[] (≤ 5000, each ≤ 200), tags: string[] (≤ 500, each ≤ 50) }`; names are `normName`d and non-empty.
  - `parseFinmapFinish(body)`: `{ importId }`.
  Tests for each failing field.
- [ ] **Step 4: `setup.ts`** — `finmapSetup(deps, orgId, uid, req): Promise<{ importId; accounts: Record<string,string>; categories: Array<{ ref: CategoryRef; id: string }>; counterparties: Record<string,string>; tags: Record<string,string>; created: {…counts} }>`. Maps are keyed by `normKey(name)`. Steps: (a) open or create the import document (`kind: 'finmap'`, `status: 'applied'`, `fileName`, counts zero, `accountIds: []`, `fit: {}`, `statements: []`, `undo: {0,0}`, `period: {from:null,to:null}`); with `req.importId` it must be an `applied` finmap import of this company, else `not_found`. (b) read the existing accounts, categories, counterparties, tags **once**; match by `normKey` (categories: parent `(type, key)`, child `(parentId, key)`); (c) create the missing ones: accounts with `createAccount` (`openingMinor: 0`, `color` from the next unused colour of the app's account palette — find it in `lib/firebase/default-categories.ts` or the account form `components/forms/AccountForm.tsx`), categories as documents in `categoriesCol` with the same shape as `createCategory` (`{ name, type, color, orgId, createdAt: Timestamp, parentId? }`, parents before children; colour from the default categories palette; a child takes its parent's colour), counterparties with `createCounterparty` (`{ name, ibans: [] }`; a uniqueness conflict means it exists: read it back by key), tags with `createTag` (`{ name, color, excludeFromAnalytics: false }` with the first unused tag colour); (d) store on the import document: `accountIds` union with ALL account ids used, `fitTargets` for NEW accounts whose `currentBalanceMinor` is not null, `entities` counts (increment). Everything idempotent: running setup twice with the same body creates nothing the second time (test it).
  Integration test `finmap-setup.test.ts`: creates what is missing and matches the rest case-insensitively with double spaces; second run creates nothing and returns the same ids; categories get their `parentId`; account types and currencies as asked; the import document has `kind: 'finmap'`, `fitTargets` only for new accounts with a balance; foreign `importId` → `not_found`; another company's entities are not matched.
- [ ] **Step 5: `finish.ts`** — `finmapFinish(deps, orgId, uid, importId)`: for each `fitTargets` entry whose `fit[accountId]` is not `done`: re-read the account; `opening = fittedOpening(target, account.balanceMinor, account.openingMinor)` (from `lib/domain/banking/fit`); when `Math.abs(opening) <= MAX_MINOR` call `updateAccount(...{ openingMinor: opening })` and set `fit.{accountId} = 'done'`; return `{ fitted: [{ accountId, openingMinor }], differences: [{ accountId, differenceMinor }] }` where the difference is `bankDifference(target, balanceAfter)` for every target. An import without targets returns empty arrays. Integration tests (after Task 5 writes operations; here use `createTransaction` for two operations): fit sets the balance to the target; running finish twice changes nothing the second time; a target above `MAX_MINOR` is reported as a difference and not fitted.
- [ ] **Step 6:** `index.ts` exports `finmap = { setup, finish }` (Task 5 and 6 add more). Run unit + `finmap-setup` integration, typecheck, eslint. Commit `feat(import): Finmap entity setup and balance fit`.

---

### Task 5: Server — the batch writer and the duplicate check

**Files:** Create `lib/domain/import/finmap/budget.ts`, `lib/server/imports/finmap/{batch,check}.ts`; extend `lib/domain/import/finmap/request.ts`; tests `tests/unit/domain/import/finmap/budget.test.ts`, `tests/integration/finmap-batch.test.ts`. Read first: `lib/server/ledger/write.ts` (`prepare`, `commit`, `applyChange`, `storedDoc`), `lib/domain/ledger/{build,change,effects,rollups}.ts`, `lib/domain/tags/exclude.ts`, `lib/server/imports/{step,bank-ops}.ts` (locks `acquire`/`release`, `seenKeysOf`), `lib/server/ledger/deps.ts` (`resolveRate`).

- [ ] **Step 1: `budget.ts` (pure) + test.**

```ts
import { WRITE_BUDGET } from './types'

/** What one operation adds to a transaction: its own document and mark, and the documents its change touches. */
export interface OpFootprint {
  /** Ids of the balance documents (`accounts/{id}`) and rollup documents (`rollups/{id}`) the operation changes. */
  docs: readonly string[]
}

/**
 * Splits operations into groups whose Firestore transaction stays within the write budget. Writes of a group =
 * 2 per operation (document + mark) + the distinct documents their changes touch + 1 audit entry.
 * An operation alone never exceeds the budget (it touches a handful of documents), so a group always has at least one.
 */
export function splitByWriteBudget(feet: readonly OpFootprint[], budget: number = WRITE_BUDGET): number[][] {
  const groups: number[][] = []
  let current: number[] = []
  let docs = new Set<string>()
  const cost = () => current.length * 2 + docs.size + 1
  for (let i = 0; i < feet.length; i++) {
    const nextDocs = new Set(docs)
    for (const d of feet[i].docs) nextDocs.add(d)
    if (current.length > 0 && (current.length + 1) * 2 + nextDocs.size + 1 > budget) {
      groups.push(current)
      current = []
      docs = new Set()
    }
    current.push(i)
    for (const d of feet[i].docs) docs.add(d)
    void cost
  }
  if (current.length > 0) groups.push(current)
  return groups
}
```
(Remove the unused `cost` helper when implementing; it is shown only to name the formula.) Tests: 60 operations touching 3 shared docs → one group; operations each touching 10 distinct docs → groups of at most 25 (cost `2n + 10n + 1 ≤ 450` → n = 37? compute: 12n + 1 ≤ 450 → n = 37; assert the exact grouping); every group's cost `≤ budget`; the groups cover all indexes in order; an empty input gives `[]`.
- [ ] **Step 2: request parsers** `parseFinmapCheck` and `parseFinmapBatch` in `request.ts`:
  - batch op wire type `BatchOp { kind, status, day, amountMinor, accountId, toAccountId: string | null, toAmountMinor: number | null, categoryId: string | null, counterpartyId: string | null, tagIds: string[] (≤ 10, ids), description: string | null (≤ 500), accrual: { from, to } | null, identity: string[] (≤ 12 strings, each ≤ 400 chars), ordinal: integer 0..100000 }`; consistency checks: `transfer` needs `toAccountId` ≠ `accountId` and no category/counterparty/accrual; `income`/`expense` need none of `toAccountId`/`toAmountMinor`.
  - `parseFinmapBatch(body)` → `{ importId, operations: BatchOp[] (≤ 60) }`; `parseFinmapCheck(body)` → `{ operations: Array<{ accountId, toAccountId, identity, ordinal }> (≤ 500) }`.
  Tests per field.
- [ ] **Step 3: `check.ts`** — `finmapCheck(deps, orgId, ops): Promise<{ seen: boolean[] }>`: keys via `finmapKey`, marks via `seenKeysOf` (chunks of 300); `seen[i]` true when the mark exists. Read-only.
- [ ] **Step 4: `batch.ts`** — `finmapBatch(deps, orgId, uid, req): Promise<{ created: number; skipped: number; refused: Array<{ index: number; reason: string }> }>`. Algorithm:
  1. `openFinmapImport`: the import document must exist, `kind === 'finmap'`, `status === 'applied'`, else `ImportError('not_found')`.
  2. Take the step lock of every account in the request (`acquire` per account in sorted order, `release` in `finally`; `already_running` propagates).
  3. Read org currency and `today` (`deps.today()`), the accounts of the request (`parseAccount`; missing → refuse the operations on it with reason `account_not_found`), the distinct category ids (type check against the op kind), counterparty ids (exist and not archived), tag ids (exist, not archived; keep their `excludeFromAnalytics` flags via `tagFlagsOf`).
  4. For each op compute `key`, skip when its mark exists (`seenKeysOf`), then build the input with `parseTransactionInput({ clientId: finmapTxId(key), type, status, accountId, amountMinor, paymentDate: day, toAccountId?, toAmountMinor?, accrual: period ? { mode: 'period', from, to } : undefined, categoryId?, counterpartyId?, description?, tags: tagIds }, { internal: true })` (check `parseTransactionInput` accepts a client id with the `fm_` prefix; if its id rule rejects it, extend the rule minimally and test it) and `buildTransaction(txId, input, { today, account, toAccount, category, baseCurrency })`; a `LedgerError` from the build is a refusal with its code (`future_actual`, `category_not_found`, `invalid_input` …), never a thrown error. Set `tx.importId = req.importId`.
  5. FX: `fxPlan(tx, baseCurrency, today)` for every built operation; resolve each distinct `(from, to, date)` once through `deps.resolveRate` (a `Map` memo per request), `attachFx` with `evidenceOf` (from `write.ts`: export it already; it is `export function evidenceOf`).
  6. Excluded flag: `withExcluded(tx, excludedFromTags(tx.tags, flags))`.
  7. Footprint per op: `changeSet(null, tx, baseCurrency)` → the account ids in `balanceDeltas` (as `accounts/<id>`) plus the rollup document ids (`rollups/<id>`); `splitByWriteBudget`.
  8. For each group, one `deps.db.runTransaction`: `assertUnlocked`; read org (currency unchanged); re-read the distinct tag documents and compare their `excludeFromAnalytics` with step 3 — any difference → `throw new LedgerError('conflict')`; re-read the accounts' currency assumptions (as `commit` does) → `conflict` on a change; re-read the marks of the group's keys (`t.getAll`), and drop operations whose mark appeared (concurrent run) from this group; compute `combineChanges(...group.map(changeSet))` (use the one pre-computed per op for the surviving ones); `applyChange(t, db, orgId, combined, ts)`; for each op `t.create(txRef, storedDoc(tx, orgId, uid, ts))` and `t.create(markRef, { txId, at: deps.now().toISOString(), importId, kind: 'finmap', snapshot: { type, accountId, amountMinor, paymentDate } })`; one audit entry `auditData(deps, 'import.batch', uid, importId, null, { importId, created: n }, { via: 'import' })`. A `t.create` on an existing operation document is a `conflict` (Firestore throws ALREADY_EXISTS; map it to `LedgerError('conflict')`).
  9. After all groups: `importRef.update({ 'counts.created': increment(created), 'counts.skipped': increment(skipped), 'counts.refused': increment(refused.length), accountIds: arrayUnion(...) })` (also on abort, like `runStep`'s `recordTotals`).
  The writer must NOT call `createTransaction` per operation.
- [ ] **Step 5: integration tests `finmap-batch.test.ts`** (all against the emulator):
  1. **Equivalence:** the same 30 operations (income, expense, a transfer, planned, an accrual period, two tags one with `excludeFromAnalytics`, two accounts, one category with a child) written through `finmapBatch` produce the same account balances, rollup documents, and `excluded` flags as written one by one with `createTransaction` into a second company (compare `rollups` documents and balances; `verifyLedger` of the batch company reports no differences).
  2. **Idempotent:** the same request again → `created: 0, skipped: 30`; a request after deleting one operation by hand (`deleteTransaction`) does not bring it back (mark stays).
  3. **Budget split:** 200 operations over 200 different days (many distinct rollup documents) → several transactions, all committed, `verifyLedger` clean (spy on `db.runTransaction` count to assert it split, and that no transaction exceeded 450 writes by checking `splitByWriteBudget` of the same footprints).
  4. **Foreign account:** an EUR account (rate stub as the other integration tests do via `makeDeps`) converts through NBP evidence; `fx.payment` is stored.
  5. **Refusals:** a future `actual` day → refused `future_actual` and nothing marked; a category of the wrong type → refused `category_not_found`; an unknown account → refused `account_not_found`; the rest of the batch is written.
  6. **Lock:** the ledger lock held → the request throws `ledger_busy` and writes nothing; an `importLocks` lock held on an account → `already_running`.
  7. **Concurrency of two identical requests** (`Promise.all`): the operations exist once, counts consistent, balances equal one run.
  8. **Foreign import / wrong kind** (`kind: 'mt940'` import id) → `not_found`; another company's `importId` → `not_found`.
  9. **Editing keeps the link:** an imported operation edited via `updateTransaction` still has `importId` (Task 1 behavior, asserted here too).
  And `finmapCheck` marks exactly the written ones.
- [ ] **Step 6:** unit + integration (one emulator command), typecheck, eslint. Commit `feat(import): Finmap batch writer and duplicate check`.

---

### Task 6: Server — batched undo of a Finmap import

**Files:** Create `lib/server/imports/finmap/undo.ts`; modify `lib/server/imports/undo.ts` (dispatch on `kind`), `lib/server/imports/index.ts`; test `tests/integration/finmap-undo.test.ts`. Read `lib/server/imports/undo.ts` (the MT940 undo and its tests `tests/integration/import-undo.test.ts`) first.

- [ ] **Step 1: tests (write first).** (1) Full undo of a 150-operation Finmap import: operations and marks gone, balances and rollups equal the state before the import (compare with `verifyLedger` and the pre-import balances), import `status: 'undone'`, `undo.deleted: 150`; audit entries `import.batch` with `via: 'import-undo'`. (2) An operation edited after the import (category change) is kept (`changed`), its mark stays; a transfer made from imported operations by hand is kept. (3) Steps: `UNDO_STEP` of 60 with a cursor: the first call returns `next`, the second finishes; repeating after a simulated crash (delete only the marks of some operations first) is safe. (4) The footprint split: a step whose 60 operations touch more than the budget is committed in several transactions (spy). (5) A person-deleted operation: its mark is removed at the end (as MT940 item 8); a re-import brings everything back. (6) Locks: the lock of one of the import's accounts held → `already_running`. (7) The accounts, categories and tags created by the import stay. (8) The MT940 undo tests still pass.
- [ ] **Step 2: implement** `undoFinmapStep(deps, orgId, uid, importId, cursor?)` with the same return type `UndoResult` (`deleted`, `kept`, `next`, `done`) and a page size of 60:
  - query `transactionsCol.where('importId', '==', importId).orderBy(FieldPath.documentId()).limit(60)` (+ `startAfter`);
  - snapshots whose `updateTime` differs from `createTime` → kept `changed`; the rest are candidates; parse each with `parseTransaction` (unreadable → kept `unreadable`);
  - group candidates by `splitByWriteBudget` using the footprint of `changeSet(tx, null, baseCurrency)`; per group one transaction: `assertUnlocked`; re-read each candidate document and require `updateTime` equal to the snapshot's (else kept `changed`, not deleted); `combineChanges` of the reverse change sets → `applyChange`; `t.delete` each operation and its mark (`bankSeen/<key>` from the id `fm_<key>`); one audit entry (`import.batch`, `via: 'import-undo'`, `after: { importId, deleted: n }`);
  - when the page is the last: delete the marks left behind by operations a person deleted before (query `bankSeen where importId == importId` in batches of 200, delete when the operation `fm_<key>` does not exist), set `status: 'undone'`, `undoneAt`, and the same `undo` counters as MT940.
  - Locks: acquire the step locks of `accountIds` (sorted) for the duration of each step, as the MT940 undo does (reuse its helper).
  `undoStep` in `undo.ts` reads the import document and calls `undoFinmapStep` when `kind === 'finmap'`.
- [ ] **Step 3:** run the new test with the existing `import-undo.test.ts` (one emulator command); typecheck; eslint. Commit `feat(import): batched undo of a Finmap import`.

---

### Task 7: Routes, client API, 401 guards

**Files:** Create `app/api/orgs/[orgId]/imports/finmap/{check,setup,batch,finish}/route.ts`, `lib/api/finmap-client.ts`; modify `tests/e2e/api-guards.spec.ts`; tests `tests/unit/api/finmap-client.test.ts`. Templates: `app/api/orgs/[orgId]/imports/route.ts`, `lib/api/import-client.ts`.

- [ ] **Step 1: routes.** Each: `runtime = 'nodejs'`, `maxDuration = 60`, `requireUser`, `requireOrgRole(uid, orgId, ['owner', 'accountant'])`, `Cache-Control: no-store`, body through `readJsonBody` with limits (`check` 256 KB, `setup` 2 MB, `batch` 256 KB, `finish` 1 KB) and the matching parser (a parse failure is `ImportError('invalid_input', field)`), errors via `errorResponse(toImportHttpError(e))`. They call `finmap.check|setup|batch|finish` of `lib/server/imports/finmap/index.ts` with `importDeps()`.
- [ ] **Step 2: `finmap-client.ts`** (browser-safe: import only types and pure domain code; no `lib/server/**`): `finmapCheck(orgId, ops, signal)`, `finmapSetup(orgId, body)`, `finmapBatch(orgId, importId, ops)`, `finmapFinish(orgId, importId)`, and the driver:

```ts
export async function runFinmapImport(orgId: string, args: {
  fileName: string
  plan: FinmapPlan
  accounts: Array<{ name: string; type: AccountType; currency: string; currentBalanceMinor: number | null }>  // the NEW accounts
  existing: FinmapExisting
  importId?: string
  onProgress: (done: number, total: number) => void
  signal?: AbortSignal
}): Promise<FinmapResult>
```
  Steps: `finmapSetup` → id maps → `resolveOps(plan.operations, maps, existing)` (pure, in `lib/domain/import/finmap/resolve.ts` with tests: names → ids by `normKey`; a missing name is a bug and throws) → `finmapCheck` in chunks of 500 for operations whose accounts all existed before (new accounts have nothing to check) → batches of `FINMAP_BATCH_OPS` for the not-seen operations → on `conflict`/network error retry the same batch once → `finmapFinish` → totals `{ importId, created, skipped, refused, fitted, differences, entities }`; `notifyLedgerChanged()` at the end (also after an error). A 409 `already_running` returns `busy: true`.
  Unit tests (mock `fetch`): chunking 130 operations into 60+60+10, retry once on a failed batch, `busy` stops, progress callback, `notifyLedgerChanged` called once.
- [ ] **Step 3: 401 guards:** add the four requests to the existing import block of `tests/e2e/api-guards.spec.ts` (without a session → 401). Run it if free RAM allows, else leave to CI and say so.
- [ ] **Step 4:** unit tests, typecheck, eslint. Commit `feat(import): Finmap routes and client driver`.

---

### Task 8: UI — source choice, Finmap dialog, i18n

**Files:** Create `lib/domain/import/finmap/state.ts` (+ test), `components/import/{ImportSourceDialog,FinmapDialog,FinmapAccountRows}.tsx`; modify `components/import/ImportButton.tsx`, `app/(app)/[orgSlug]/settings/imports/page.tsx` (show the kind), `messages/{uk,pl,en}.json`. Read first: `components/import/{ImportButton,ImportDialog,StatementCard}.tsx`, `lib/domain/import/dialog-state.ts` (the MT940 reducer pattern), the hooks `useAccounts`, `useCategories`, `useCounterparties`, `useTags`, `lib/i18n/useFormatters.ts`.

- [ ] **Step 1: reducer `state.ts` (pure, tested first).** Phases: `idle → reading → planning → choosing → running → done | error`. State holds the file name, the read table summary, `plan`, the options (`includePlanned`, `pairTransfers`), the new-account settings (`type`, `currency`, `currentBalanceText`), progress, the result. Events: `fileChosen`, `tableRead(rows)`, `readFailed(code)`, `optionChanged`, `accountChanged`, `runStarted`, `progress`, `finished(result)`, `failed(error)`, `reset`. Pure helpers: `canRun(state)` (a plan with at least one operation to write and every new account's balance text empty or a valid decimal), `parseBalanceText(text, currency)`. Errors: `unknown_layout` (with the missing columns), `empty`, `too_many_rows`, `not_xlsx`, `too_big`, `busy`, `failed`. Tests for every transition and for `canRun`.
- [ ] **Step 2: `ImportSourceDialog`** (opens from the existing «Імпорт» button): two choices `import-source-mt940` and `import-source-finmap`; the MT940 choice opens the existing `ImportDialog`. Keep `data-testid="import-open"` on the button.
- [ ] **Step 3: `FinmapDialog`.** File input `finmap-file` (`accept=".xlsx"`); size check against `MAX_FINMAP_BYTES`; read `new Uint8Array(await file.arrayBuffer())`, `readXlsxTable`, `parseFinmapTable`, `planFinmap` (the plan is recomputed with `useMemo`-free derivation: compute in the event handler after each option change and store in state; do NOT compute in an effect). Preview block `finmap-preview`: period, counts (income / expense / transfers / planned), "will be created" counts (accounts, categories, counterparties, tags), matched counts, refused counts with reasons, warnings (comment cut, subcounterparty ignored, project ignored, accrual ignored), `pairCandidatesLeft`, switches (planned, pair transfers), an «already imported» count after the check (`finmapCheck` chunks run when the file is planned and there are existing accounts; show a progress line). `FinmapAccountRows` (`finmap-account-row` per NEW account): name, type select, currency select (company currency default), current balance input; changing a currency recomputes the plan (transfer pairing depends on it). Button `finmap-run` (disabled by `canRun`), progress «n з N», result block `finmap-result` (created, skipped, refused by reason, transfers, created entities, fitted accounts, balance differences). Roles: same gate as the MT940 button (`canEdit`).
- [ ] **Step 4: Settings → Imports** shows the kind («MT940» / «Finmap») in each row and, for Finmap, the created entities; undo works for both (uses `undoImport` unchanged).
- [ ] **Step 5: i18n.** Add `import.source.*`, `import.finmap.*` (title, pickFile, reading, planning, preview labels, switches, account row labels, run, progress, result lines, every error code incl. `unknown_layout` with `{columns}`, refusal reasons `date amount account planned_off accrual_after_horizon`, warnings), and `settings.imports.kind.{mt940,finmap}` to uk, pl and en by TARGETED TEXT INSERTION (never parse and re-serialize the JSON files; keep their formatting and line endings); identical keys in all three; run the i18n parity test and the no-hardcoded-text test.
- [ ] **Step 6:** `npm run typecheck`, eslint, `npx vitest run tests/unit/domain/import tests/unit/i18n tests/unit/shell tests/unit/api` (add `--no-file-parallelism` if memory is tight). If free RAM allows, open the dialog in the dev server with the synthetic fixture and take screenshots at 1280 px and 390 px (`tests/ui-shots/finmap.spec.ts`, pattern of `tests/ui-shots/import.spec.ts` if it exists); otherwise say so. Commit `feat(import): Finmap import dialog`.

---

### Task 9: Tools, performance measurement, e2e

**Files:** Create `scripts/check-finmap.ts`, `scripts/lib/check-finmap.ts` (+ unit test), `tests/helpers/finmap-fixture.ts` (synthetic file builder), `tests/integration/finmap-perf.test.ts`, `tests/e2e/finmap-import.spec.ts`.

- [ ] **Step 1: `scripts/check-finmap.ts`** (mirror `scripts/check-mt940.ts` and its `scripts/lib` split): reads every `.xlsx` in `argv[2]` (default `.local/finmap-samples`), `readXlsxTable` → `parseFinmapTable` → `planFinmap` with an empty `FinmapExisting` (company currency from `argv[3]`, default `PLN`) and `pairTransfers: true`; prints only: file name, rows read, header match, counts (income / expense / transfer / planned), refused by reason, `pairCandidatesLeft`, warnings, what would be created (COUNTS of accounts, categories with children, counterparties, tags — never names), period, and the time taken. Writes nothing. Unit test the pure report function with a synthetic table.
- [ ] **Step 2: `finmap-fixture.ts`**: `buildFinmapTable(opts: { rows: number; accounts: number; days: number; pairEvery?: number })` returns a `string[][]` table with the Polish header names written WITH look-alike letters (use `\u` escapes), newest first, deterministic (seeded LCG), with some transfer pairs, categories with subcategories, tags, accrual periods; and `makeXlsx` (Task 2 helper) turns it into bytes. Used by the e2e (small), the perf test (large) and the planner/reader round-trip unit test.
- [ ] **Step 3: performance test** `finmap-perf.test.ts`, **skipped unless `FINMAP_PERF=<rows>`** is set (e.g. `FINMAP_PERF=5000`): builds a synthetic table of that many rows, runs `readXlsxTable` + `parseFinmapTable` + `planFinmap` (time each), then `setup` and `finmapBatch` in requests of 60 against the emulator, then `finmapFinish`, then `verifyLedger`; prints (to stdout) rows, operations, transactions committed, elapsed ms per phase, ops/second, process peak RSS (`process.memoryUsage().rss` sampled per request). Also run `undoFinmapStep` to completion and print its time. Run it at 5 000 rows and, if memory allows, at 20 000; **report both numbers as measured on the emulator, cold (first run) and warm (second run in the same process)**, and state that production latency is unmeasured. Do not extrapolate to 41 000 without labelling it an estimate.
- [ ] **Step 4: e2e** `tests/e2e/finmap-import.spec.ts` (≈30-row xlsx built by `makeXlsx` and uploaded with `setInputFiles` `{ name, mimeType, buffer }`): (1) owner imports: preview counts (transfers found, categories to create), new account rows with a typed current balance, run, result; the journal shows the operations; the sidebar total equals the typed balance; (2) the same file again → «already imported» equals all, run creates nothing; (3) undo from Settings → Imports removes the operations, keeps the created categories and accounts; (4) a file with other headers → the `unknown_layout` message; (5) a viewer sees no import button and `POST /imports/finmap/batch` answers 403. Copy sign-in/seed/locale conventions from `tests/e2e/import.spec.ts`. Run when free RAM allows (one at a time), else `npx playwright test --list tests/e2e/finmap-import.spec.ts` only and leave the run to CI, saying so.
- [ ] **Step 5:** run the new unit tests and the perf test at 5 000 rows (emulator), typecheck, eslint. Commit `test(import): Finmap fixture, check script, performance harness and e2e`.

> **Owner gate (not a task for an agent):** the controller runs `npx tsx scripts/check-finmap.ts` on the owner's real file in `.local/finmap-samples/` (counts only), compares the counts with the independent analysis of the file (41 459 data rows; 2 831 incomes; 38 627 expenses; 1 zero-amount row; about 729 pairs with only built-in categories) and reports the differences. Any difference is a bug in the reader or the planner, fixed with a synthetic test. The real import into a real company is the owner's step.

---

### Task 10: Docs, review, PR

- [ ] **Step 1:** `CLAUDE.md` new section «Finmap import and batch writes (S14b)»: the files, the key (`fm_`, `finmap` namespace, identity + ordinal), the `importId` field and that `updateTransaction` carries it, the write budget and how batches split, the conflict-on-tag-flag rule, FX handling, no `bank` block (editable), pairing rule, undo (batched), routes, gotchas (look-alike header letters; sheet newest-first, ordinals follow sheet order; the browser reads the file; Polish headers only; `.local/finmap-samples` is private; filtered reports still stop at 10 000 operations).
- [ ] **Step 2:** `PROGRESS.md` (Ukrainian) «S14b: імпорт Finmap» with verified / not verified (what ran, what only CI ran, no real import into a real company, performance numbers as measured with their label) and follow-ups (S14c mapper and CSV, filtered-report cap of 10 000 for big companies, other header languages, subcounterparty/project, per-run Web Worker for reading, real production latency, `fm_` ids and undo of a delete via the journal «↩»).
- [ ] **Step 3:** `firestore.rules` comment: no change needed (reuses `imports`, `importLocks`, `bankSeen`); `tests/unit` docs check if any. Update the spec status line.
- [ ] **Step 4:** full checks (typecheck, eslint, the unit suites, the integration files of S09/S10/S11/S13/S14 and the new ones, one at a time), then an independent read-only review of the branch (controller), fix findings, push, draft PR, CI, merge only with the owner's OK.

## Self-review against the spec

- Flow and preview (browser reads, plan, counts, new accounts with type/currency/current balance, switches): Tasks 2, 3, 8. Column mapping (dates, period, direction, amount, category + child, counterparty, tags, comment, ignored columns, planned): Tasks 2, 3. Transfer pairing with the strict rule and the leftover count: Task 3.
- Batch writer with the 450 budget, single audit entry per batch, marks, no `bank` block, `importId`, FX, excluded flag: Tasks 1, 5. Setup idempotent by normalised name, fit at finish: Task 4. Undo (batched, changed ones kept, marks, entities stay): Task 6. Routes, roles, 401/403: Task 7. UI test ids `import-source`, `finmap-file`, `finmap-preview`, `finmap-account-row`, `finmap-run`, `finmap-result`: Task 8 (the source buttons carry `import-source-*`; add `data-testid="import-source"` on the dialog root).
- Measurement: Task 9 step 3. Real file check: Task 9 owner gate. Limits (filtered reports cap) in docs: Task 10.
- Names used across tasks: `FinmapRow`, `PlannedOp`, `FinmapPlan`, `FinmapExisting`, `FinmapOptions`, `CategoryRef`, `BatchOp`, `OpFootprint`, `finmapKey`, `finmapTxId`, `finmapSetup`, `finmapBatch`, `finmapCheck`, `finmapFinish`, `undoFinmapStep`, `splitByWriteBudget`, `WRITE_BUDGET`, `FINMAP_BATCH_OPS`, `MAX_FINMAP_ROWS`, `MAX_FINMAP_BYTES`, `NO_CATEGORY_NAMES`, `readXlsxTable`, `parseFinmapTable`, `matchColumns`, `foldHeader`, `normName`, `normKey`, `planFinmap`, `resolveOps`, `runFinmapImport`.
