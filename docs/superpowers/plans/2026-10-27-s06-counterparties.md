# S06 Counterparties Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every company a counterparty directory (NIP, IBAN, VAT status, MF white list autofill, ZUS and Urząd Skarbowy by default) whose writes go through the server, with unique NIP and name, plus a settings page and a reusable picker.

**Architecture:** Pure rules in `lib/domain/counterparties/` (normalisation, NIP and NRB checksums, input parsing, white list response parsing). Server writes in `lib/server/counterparties/` (one Admin transaction per change: document, uniqueness key documents, audit). The MF white list is called only from the server. The ledger write path (S05) checks that a referenced counterparty exists. Client Firestore reads only; client writes are closed by the rules.

**Tech Stack:** Next.js 16 route handlers, firebase-admin 14 transactions, Firestore rules, Vitest (unit, rules, integration on the emulator), Playwright, next-intl (pl/en/uk).

**Spec:** `docs/superpowers/specs/2026-10-27-s06-counterparties-design.md`.

**Deviations from the spec, decided while planning (Task 18 writes them into the spec):**
1. `vat` is not a client field. The server sets it from the white list lookup done at save time (when `nip` is present and the NIP or the IBAN list changed). The client only sends `name`, `nip`, `ibans`, `address`, and `archived` (patch).
2. `counterparty_not_found` and `counterparty_archived` map to HTTP **422** (like `account_not_found` and `category_not_found`), not 400.
3. The lookup route is allowed for owner and accountant only (it is write preparation).
4. A new error code `conflict` (409) for a concurrent edit of the same counterparty.
5. The rate limit core (`lib/server/rate-limit.ts`, takes a Firestore) is separate from its guard (`lib/server/rate-limit-guard.ts`, uses `getAdmin`), so integration tests do not import `server-only` code.
6. The form fills the IBANs from the white list only when it returns 1 to 20 accounts and the form has none (a large company has hundreds; the user types the account they pay to and the server marks it).

## Ground rules for every task

- Work in `F:\AI\finflow`, branch `s06-counterparties` (Task 0). Run every command from that directory.
- Use the Read, Edit, Write, Grep, Glob tools for files (no sed/heredoc/cat for editing). Never kill processes by image name.
- Emulator commands need Java: prefix with `PATH="$HOME/.jre/temurin-21/bin:$PATH"`.
- TDD: write the test, run it and see it fail, implement, run it and see it pass, commit. Commit message ends with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Tests use ASCII-only identifiers; user-facing strings come from `messages/*.json` (no hard-coded UI text in components).
- Do not touch `TransactionForm` (S07 owns it).

## File structure

Create:

| File | Responsibility |
|---|---|
| `lib/domain/counterparties/errors.ts` | `CounterpartyError` with codes `invalid_input`, `not_found`, `duplicate`, `limit`, `conflict`, `lookup_unavailable` (the rate limit answers `429 rate_limited` through `HttpError`) |
| `lib/domain/counterparties/guards.ts` | `bad`, `asRecord`, `onlyKeys` for this domain |
| `lib/domain/counterparties/normalize.ts` | `cleanName`, `nameKeyText`, `nameKey`, `nipKey`, `normalizeNip`, `normalizeIban`, `tryNormalizeIban` |
| `lib/domain/counterparties/types.ts` | `Counterparty`, `CounterpartyIban`, `Vat`, constants |
| `lib/domain/counterparties/input.ts` | `parseCounterpartyInput`, `parseCounterpartyPatch` |
| `lib/domain/counterparties/doc.ts` | `counterpartyToDoc`, `parseCounterparty` (schema 1) |
| `lib/domain/counterparties/keys.ts` | `keysOf`, `keyField` |
| `lib/domain/counterparties/system.ts` | the two system records |
| `lib/domain/counterparties/whitelist.ts` | `parseWhitelistBody` |
| `lib/domain/counterparties/search.ts` | `filterCounterparties` (client search and picker) |
| `lib/server/rate-limit.ts` | `consumeRateLimit(db, key, windows, now)` |
| `lib/server/rate-limit-guard.ts` | `enforceRateLimit(uid, scope, limits)` and the limit tables |
| `lib/server/counterparties/http.ts` | `toCounterpartyHttpError` |
| `lib/server/counterparties/deps.ts` | `CounterpartyDeps` |
| `lib/server/counterparties/whitelist.ts` | `lookupNip` (MF API client) |
| `lib/server/counterparties/write.ts` | `createCounterparty`, `updateCounterparty` |
| `lib/server/counterparties/seed.ts` | system records for a new company and for existing ones |
| `lib/server/counterparties/index.ts` | server-only wiring `counterparties` object |
| `app/api/orgs/[orgId]/counterparties/route.ts` | POST |
| `app/api/orgs/[orgId]/counterparties/[counterpartyId]/route.ts` | PATCH |
| `app/api/orgs/[orgId]/counterparties/lookup/route.ts` | GET |
| `scripts/seed-counterparties.ts` | add system records to existing companies |
| `lib/firebase/counterparties.ts` | read-only snapshot subscription |
| `lib/hooks/useCounterparties.tsx` | hook |
| `lib/api/counterparty-client.ts` | fetch client |
| `components/counterparties/CounterpartyForm.tsx` | create/edit dialog |
| `components/counterparties/CounterpartyPicker.tsx` | reusable combobox |
| `app/(app)/[orgSlug]/settings/counterparties/page.tsx` | settings page |
| `tests/e2e/helpers/wl-stub.mjs` | stub of the MF white list for Playwright |
| tests under `tests/unit/domain/counterparties/`, `tests/unit/server/counterparties/`, `tests/unit/api/counterparties/`, `tests/integration/counterparties-*.test.ts`, `tests/integration/rate-limit.test.ts`, `tests/e2e/counterparties.spec.ts`, `tests/fixtures/whitelist/*.json` | |

Modify: `lib/server/http-error.ts`, `lib/server/ledger/{audit,paths,http,write,index}.ts`, `lib/domain/ledger/errors.ts`, `lib/server/orgs.ts`, `app/api/rates/route.ts`, `firestore.rules`, `lib/shell/settings-sections.ts`, `lib/api/ledger-client.ts`, `messages/{pl,en,uk}.json`, `tests/unit/helpers/fake-admin.ts`, `playwright.config.ts`, `package.json`, `CLAUDE.md`, `PROGRESS.md`, the spec, and the tests named in the tasks.

---

### Task 0: Branch

- [ ] **Step 1: Create the branch from the docs branch (it carries the spec)**

```bash
cd /f/AI/finflow
git checkout docs-s05-rollout
git checkout -b s06-counterparties
git status --short
```

Expected: branch `s06-counterparties`, clean tree.

---

### Task 1: Domain errors, guards, normalisation

**Files:**
- Create: `lib/domain/counterparties/errors.ts`, `guards.ts`, `normalize.ts`
- Test: `tests/unit/domain/counterparties/normalize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/domain/counterparties/normalize.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CounterpartyError } from '@/lib/domain/counterparties/errors'
import {
  cleanName,
  nameKey,
  nameKeyText,
  nipKey,
  normalizeIban,
  normalizeNip,
  tryNormalizeIban,
} from '@/lib/domain/counterparties/normalize'

function field(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (e) {
    if (e instanceof CounterpartyError && e.code === 'invalid_input') return e.field
    throw e
  }
  return undefined
}

describe('cleanName', () => {
  it('trims and collapses whitespace', () => {
    expect(cleanName('  ACME   sp. z o.o.  ')).toBe('ACME sp. z o.o.')
  })

  it.each([['', 'empty'], ['   ', 'blank'], ['---', 'no letters or digits'], ['x'.repeat(201), 'too long'], [42, 'not a string'], [undefined, 'missing']])(
    'refuses %j (%s)',
    (value) => {
      expect(field(() => cleanName(value))).toBe('name')
    },
  )

  it('accepts exactly 200 characters', () => {
    expect(cleanName('x'.repeat(200))).toHaveLength(200)
  })
})

describe('nameKeyText and nameKey', () => {
  it.each([
    ['Zakład Łączności S.A.', 'zaklad_lacznosci_s_a'],
    ['ŻABKA   Polska', 'zabka_polska'],
    ['Foo  &  Bar', 'foo_bar'],
    ['  acme  ', 'acme'],
    ['Йорк', 'йорк'],
  ])('%s -> %s', (name, expected) => {
    expect(nameKeyText(name)).toBe(expected)
  })

  it('two spellings of one company give one key', () => {
    expect(nameKey('Zakład ŁĄCZNOŚCI')).toBe(nameKey('zaklad lacznosci'))
  })

  it('prefixes keys so they never look like a reserved id', () => {
    expect(nameKey('Acme')).toBe('name_acme')
    expect(nipKey('7740001454')).toBe('nip_7740001454')
  })

  it('keeps distinct Cyrillic letters distinct (й is not и)', () => {
    expect(nameKeyText('й')).not.toBe(nameKeyText('и'))
  })
})

describe('normalizeNip', () => {
  it.each([
    ['7740001454', '7740001454'],
    ['774-000-14-54', '7740001454'],
    ['PL 7740001454', '7740001454'],
    ['pl7740001454', '7740001454'],
    ['5252344078', '5252344078'],
  ])('accepts %s', (raw, expected) => {
    expect(normalizeNip(raw)).toBe(expected)
  })

  it.each([['7740001455'], ['123'], ['12345678901'], ['abcdefghij'], ['1234567890'], [''], [7740001454], [null]])(
    'refuses %j',
    (raw) => {
      expect(field(() => normalizeNip(raw))).toBe('nip')
    },
  )
})

describe('normalizeIban', () => {
  const NRB = '61109010140000071219812874'

  it.each([[NRB], ['PL61 1090 1014 0000 0712 1981 2874'], ['61 1090 1014 0000 0712 1981 2874'], ['pl61109010140000071219812874']])(
    'accepts %s',
    (raw) => {
      expect(normalizeIban(raw)).toBe(NRB)
    },
  )

  it.each([['61109010140000071219812875'], ['6110901014000007121981287'], ['DE89370400440532013000'], ['abc'], [''], [12]])(
    'refuses %j',
    (raw) => {
      expect(field(() => normalizeIban(raw))).toBe('ibans')
    },
  )

  it('tryNormalizeIban returns null instead of throwing', () => {
    expect(tryNormalizeIban('nope')).toBeNull()
    expect(tryNormalizeIban(NRB)).toBe(NRB)
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/unit/domain/counterparties/normalize.test.ts`
Expected: FAIL, cannot resolve `@/lib/domain/counterparties/errors`.

- [ ] **Step 3: Write the implementation**

Create `lib/domain/counterparties/errors.ts`:

```ts
export type CounterpartyErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'duplicate'
  | 'limit'
  | 'conflict'
  | 'lookup_unavailable'

/**
 * An expected failure of a counterparty operation. `field` names the offending input field
 * (`invalid_input`, `duplicate`); `existingId` is the counterparty that already owns the NIP or name.
 */
export class CounterpartyError extends Error {
  public readonly code: CounterpartyErrorCode
  public readonly field?: string
  public readonly existingId?: string

  constructor(code: CounterpartyErrorCode, detail: { field?: string; existingId?: string } = {}) {
    super(detail.field === undefined ? code : `${code}:${detail.field}`)
    this.name = 'CounterpartyError'
    this.code = code
    this.field = detail.field
    this.existingId = detail.existingId
  }
}
```

Create `lib/domain/counterparties/guards.ts`:

```ts
import { CounterpartyError } from './errors'

export function bad(field: string): never {
  throw new CounterpartyError('invalid_input', { field })
}

export function asRecord(v: unknown, field = 'body'): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) bad(field)
  return v as Record<string, unknown>
}

export function onlyKeys(r: Record<string, unknown>, allowed: readonly string[]): void {
  for (const k of Object.keys(r)) if (!allowed.includes(k)) bad(k)
}
```

Create `lib/domain/counterparties/normalize.ts`:

```ts
import { bad } from './guards'

export const NAME_MAX = 200

const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7] as const

/** The display name: trimmed, inner whitespace collapsed. Refuses a name with no letters or digits (it has no key). */
export function cleanName(v: unknown): string {
  if (typeof v !== 'string') bad('name')
  const text = v.replace(/\s+/g, ' ').trim()
  if (text.length < 1 || text.length > NAME_MAX) bad('name')
  if (nameKeyText(text) === '') bad('name')
  return text
}

/**
 * The comparable form of a name: Latin diacritics removed (`ł` counts as `l`), lower case, every run of
 * characters that are not letters or digits becomes one `_`. Other scripts keep their letters (only Latin
 * letters lose their marks, so Cyrillic `й` stays distinct from `и`).
 */
export function nameKeyText(name: string): string {
  return name
    .normalize('NFD')
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
    .normalize('NFC')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/ /g, '_')
}

/** Id of the uniqueness key document for a name. */
export const nameKey = (name: string): string => `name_${nameKeyText(name)}`

/** Id of the uniqueness key document for a (normalised) NIP. */
export const nipKey = (nip: string): string => `nip_${nip}`

function nipChecksumOk(d: string): boolean {
  const sum = NIP_WEIGHTS.reduce((acc, w, i) => acc + w * Number(d[i]), 0) % 11
  return sum === Number(d[9])
}

/** 10 digits with a valid checksum; accepts spaces, hyphens and a `PL` prefix. Throws `invalid_input` on `nip`. */
export function normalizeNip(v: unknown): string {
  if (typeof v !== 'string') bad('nip')
  const digits = v.replace(/[\s-]/g, '').replace(/^PL/i, '')
  if (!/^\d{10}$/.test(digits) || !nipChecksumOk(digits)) bad('nip')
  return digits
}

function nrbChecksumOk(nrb: string): boolean {
  // IBAN rule: move the country code and check digits to the end, letters become numbers (P=25, L=21).
  const rearranged = `${nrb.slice(2)}2521${nrb.slice(0, 2)}`
  let rest = 0
  for (const ch of rearranged) rest = (rest * 10 + Number(ch)) % 97
  return rest === 1
}

/** The Polish account number (NRB): 26 digits without spaces or the `PL` prefix, mod 97 checked. */
export function tryNormalizeIban(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const digits = v.replace(/[\s-]/g, '').replace(/^PL/i, '')
  return /^\d{26}$/.test(digits) && nrbChecksumOk(digits) ? digits : null
}

/** Throws `invalid_input` on `ibans` for anything that is not a valid Polish account number. */
export function normalizeIban(v: unknown): string {
  const nrb = tryNormalizeIban(v)
  if (nrb === null) bad('ibans')
  return nrb
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run tests/unit/domain/counterparties/normalize.test.ts`
Expected: all pass.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/domain/counterparties tests/unit/domain/counterparties
git commit -m "feat(counterparties): domain errors, guards, name/NIP/NRB normalisation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Types, input parsing, documents, keys, system records

**Files:**
- Create: `lib/domain/counterparties/types.ts`, `input.ts`, `doc.ts`, `keys.ts`, `system.ts`
- Test: `tests/unit/domain/counterparties/input.test.ts`, `doc.test.ts`, `keys.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/domain/counterparties/input.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CounterpartyError } from '@/lib/domain/counterparties/errors'
import { parseCounterpartyInput, parseCounterpartyPatch } from '@/lib/domain/counterparties/input'

const NRB = '61109010140000071219812874'

function field(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (e) {
    if (e instanceof CounterpartyError && e.code === 'invalid_input') return e.field
    throw e
  }
  return undefined
}

describe('parseCounterpartyInput', () => {
  it('accepts a bare name', () => {
    expect(parseCounterpartyInput({ name: ' Acme ' })).toEqual({ name: 'Acme', ibans: [] })
  })

  it('normalises the NIP and the IBANs and trims the address', () => {
    expect(
      parseCounterpartyInput({ name: 'Orlen', nip: '774-000-14-54', ibans: ['PL61 1090 1014 0000 0712 1981 2874'], address: '  ul. Chemików 7, Płock ' }),
    ).toEqual({ name: 'Orlen', nip: '7740001454', ibans: [NRB], address: 'ul. Chemików 7, Płock' })
  })

  it('treats an empty address as absent', () => {
    expect(parseCounterpartyInput({ name: 'A', address: '   ' })).toEqual({ name: 'A', ibans: [] })
  })

  it.each([
    [{}, 'name'],
    [{ name: 'A', surprise: 1 }, 'surprise'],
    [{ name: 'A', nip: '123' }, 'nip'],
    [{ name: 'A', nip: null }, 'nip'],
    [{ name: 'A', ibans: 'x' }, 'ibans'],
    [{ name: 'A', ibans: ['nope'] }, 'ibans'],
    [{ name: 'A', ibans: [NRB, NRB] }, 'ibans'],
    [{ name: 'A', address: 5 }, 'address'],
    [{ name: 'A', address: 'x'.repeat(301) }, 'address'],
    [[], 'body'],
    [null, 'body'],
  ])('refuses %j on %s', (body, expected) => {
    expect(field(() => parseCounterpartyInput(body))).toBe(expected)
  })

  it('refuses more than 20 IBANs', () => {
    const many = Array.from({ length: 21 }, () => NRB)
    expect(field(() => parseCounterpartyInput({ name: 'A', ibans: many }))).toBe('ibans')
  })
})

describe('parseCounterpartyPatch', () => {
  it('accepts any subset and normalises it', () => {
    expect(parseCounterpartyPatch({ name: ' B ', archived: true })).toEqual({ name: 'B', archived: true })
    expect(parseCounterpartyPatch({ nip: '5252344078' })).toEqual({ nip: '5252344078' })
    expect(parseCounterpartyPatch({ ibans: [NRB] })).toEqual({ ibans: [NRB] })
  })

  it('null clears the NIP and the address', () => {
    expect(parseCounterpartyPatch({ nip: null, address: null })).toEqual({ nip: null, address: null })
  })

  it.each([
    [{}, 'body'],
    [{ archived: 'yes' }, 'archived'],
    [{ kind: 'zus' }, 'kind'],
    [{ vat: { status: 'active' } }, 'vat'],
    [{ nip: '1234567890' }, 'nip'],
    [{ name: null }, 'name'],
  ])('refuses %j on %s', (body, expected) => {
    expect(field(() => parseCounterpartyPatch(body))).toBe(expected)
  })
})
```

Create `tests/unit/domain/counterparties/doc.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { counterpartyToDoc, parseCounterparty } from '@/lib/domain/counterparties/doc'
import type { Counterparty } from '@/lib/domain/counterparties/types'

const FULL: Counterparty = {
  id: 'c1',
  name: 'Orlen',
  nip: '7740001454',
  ibans: [{ iban: '61109010140000071219812874', onWhitelist: true }, { iban: '15109010140000071219812874', onWhitelist: null }],
  address: 'Płock',
  vat: { status: 'active', checkedOn: '2026-10-27' },
  kind: 'us',
  archived: false,
}

describe('counterpartyToDoc / parseCounterparty', () => {
  it('round-trips a full counterparty', () => {
    expect(parseCounterparty('c1', counterpartyToDoc(FULL))).toEqual(FULL)
  })

  it('round-trips a minimal one and omits absent optional fields', () => {
    const min: Counterparty = { id: 'c2', name: 'A', ibans: [], archived: true }
    const doc = counterpartyToDoc(min)
    expect(doc).toEqual({ schemaVersion: 1, name: 'A', ibans: [], archived: true })
    expect(parseCounterparty('c2', doc)).toEqual(min)
  })

  it.each([
    ['not an object', null],
    ['no name', { schemaVersion: 1, ibans: [], archived: false }],
    ['wrong schema', { schemaVersion: 2, name: 'A', ibans: [], archived: false }],
    ['ibans not an array', { schemaVersion: 1, name: 'A', ibans: 'x', archived: false }],
    ['iban entry malformed', { schemaVersion: 1, name: 'A', ibans: [{ iban: 5, onWhitelist: null }], archived: false }],
    ['archived not boolean', { schemaVersion: 1, name: 'A', ibans: [], archived: 'no' }],
    ['unknown vat status', { schemaVersion: 1, name: 'A', ibans: [], archived: false, vat: { status: 'maybe', checkedOn: '2026-10-27' } }],
    ['bad kind', { schemaVersion: 1, name: 'A', ibans: [], archived: false, kind: 'bank' }],
  ])('returns null for %s', (_label, data) => {
    expect(parseCounterparty('x', data)).toBeNull()
  })
})
```

Create `tests/unit/domain/counterparties/keys.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { keyField, keysOf } from '@/lib/domain/counterparties/keys'
import { SYSTEM_COUNTERPARTIES, systemCounterparty } from '@/lib/domain/counterparties/system'

describe('keysOf', () => {
  it('lists the NIP key first, then the name key', () => {
    expect(keysOf({ name: 'Zakład Łączności', nip: '7740001454' })).toEqual(['nip_7740001454', 'name_zaklad_lacznosci'])
  })

  it('has only the name key without a NIP', () => {
    expect(keysOf({ name: 'Acme' })).toEqual(['name_acme'])
  })
})

describe('keyField', () => {
  it('names the field a key belongs to', () => {
    expect(keyField('nip_7740001454')).toBe('nip')
    expect(keyField('name_acme')).toBe('name')
  })
})

describe('system counterparties', () => {
  it('are ZUS and Urząd Skarbowy with fixed ids and kinds', () => {
    expect(SYSTEM_COUNTERPARTIES.map((s) => [s.id, s.kind, s.name])).toEqual([
      ['system_zus', 'zus', 'ZUS'],
      ['system_us', 'us', 'Urząd Skarbowy'],
    ])
  })

  it('build counterparties without NIP or IBAN', () => {
    expect(systemCounterparty(SYSTEM_COUNTERPARTIES[0])).toEqual({ id: 'system_zus', name: 'ZUS', ibans: [], archived: false, kind: 'zus' })
  })
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/unit/domain/counterparties`
Expected: FAIL, modules missing.

- [ ] **Step 3: Write the implementation**

Create `lib/domain/counterparties/types.ts`:

```ts
export const VAT_STATUSES = ['active', 'exempt', 'unregistered'] as const
export type VatStatus = (typeof VAT_STATUSES)[number]

export const COUNTERPARTY_KINDS = ['zus', 'us'] as const
export type CounterpartyKind = (typeof COUNTERPARTY_KINDS)[number]

export const MAX_COUNTERPARTIES = 5000
export const MAX_IBANS = 20
export const ADDRESS_MAX = 300

export interface CounterpartyIban {
  /** Normalised NRB, 26 digits. */
  iban: string
  /** On the MF white list for this NIP (`null`: not checked). Set by the server. */
  onWhitelist: boolean | null
}

export interface Vat {
  status: VatStatus
  /** The day the white list was asked, `YYYY-MM-DD`. */
  checkedOn: string
}

export interface Counterparty {
  id: string
  name: string
  /** 10 digits, checksum valid. */
  nip?: string
  ibans: CounterpartyIban[]
  address?: string
  vat?: Vat
  /** Only the two system records. */
  kind?: CounterpartyKind
  archived: boolean
}
```

Create `lib/domain/counterparties/input.ts`:

```ts
import { asRecord, bad, onlyKeys } from './guards'
import { cleanName, normalizeIban, normalizeNip } from './normalize'
import { ADDRESS_MAX, MAX_IBANS } from './types'

export interface CounterpartyInput {
  name: string
  nip?: string
  ibans: string[]
  address?: string
}

export interface CounterpartyPatch {
  name?: string
  /** `null` clears it. */
  nip?: string | null
  ibans?: string[]
  /** `null` clears it. */
  address?: string | null
  archived?: boolean
}

function address(v: unknown): string | undefined {
  if (typeof v !== 'string') bad('address')
  const text = v.trim()
  if (text.length > ADDRESS_MAX) bad('address')
  return text === '' ? undefined : text
}

function ibans(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > MAX_IBANS) bad('ibans')
  const out = v.map((x) => normalizeIban(x))
  if (new Set(out).size !== out.length) bad('ibans')
  return out
}

export function parseCounterpartyInput(body: unknown): CounterpartyInput {
  const r = asRecord(body)
  onlyKeys(r, ['name', 'nip', 'ibans', 'address'])
  const out: CounterpartyInput = { name: cleanName(r.name), ibans: r.ibans === undefined ? [] : ibans(r.ibans) }
  if (r.nip !== undefined) out.nip = normalizeNip(r.nip)
  if (r.address !== undefined) {
    const a = address(r.address)
    if (a !== undefined) out.address = a
  }
  return out
}

export function parseCounterpartyPatch(body: unknown): CounterpartyPatch {
  const r = asRecord(body)
  onlyKeys(r, ['name', 'nip', 'ibans', 'address', 'archived'])
  const out: CounterpartyPatch = {}
  if (r.name !== undefined) out.name = cleanName(r.name)
  if (r.nip !== undefined) out.nip = r.nip === null ? null : normalizeNip(r.nip)
  if (r.ibans !== undefined) out.ibans = ibans(r.ibans)
  if (r.address !== undefined) out.address = r.address === null ? null : (address(r.address) ?? null)
  if (r.archived !== undefined) {
    if (typeof r.archived !== 'boolean') bad('archived')
    out.archived = r.archived
  }
  if (Object.keys(out).length === 0) bad('body')
  return out
}
```

Create `lib/domain/counterparties/doc.ts`:

```ts
import { COUNTERPARTY_KINDS, VAT_STATUSES, type Counterparty, type CounterpartyIban, type CounterpartyKind, type Vat, type VatStatus } from './types'

export const SCHEMA_VERSION = 1

/** The Firestore fields of a counterparty (no timestamps, no orgId: the writer adds those). */
export function counterpartyToDoc(c: Counterparty): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    schemaVersion: SCHEMA_VERSION,
    name: c.name,
    ibans: c.ibans.map((i) => ({ iban: i.iban, onWhitelist: i.onWhitelist })),
    archived: c.archived,
  }
  if (c.nip !== undefined) doc.nip = c.nip
  if (c.address !== undefined) doc.address = c.address
  if (c.vat !== undefined) doc.vat = { status: c.vat.status, checkedOn: c.vat.checkedOn }
  if (c.kind !== undefined) doc.kind = c.kind
  return doc
}

function record(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function parseIbans(v: unknown): CounterpartyIban[] | null {
  if (!Array.isArray(v)) return null
  const out: CounterpartyIban[] = []
  for (const item of v) {
    const r = record(item)
    if (!r || typeof r.iban !== 'string' || !(r.onWhitelist === null || typeof r.onWhitelist === 'boolean')) return null
    out.push({ iban: r.iban, onWhitelist: r.onWhitelist })
  }
  return out
}

function parseVat(v: unknown): Vat | null {
  const r = record(v)
  if (!r || typeof r.checkedOn !== 'string' || !(VAT_STATUSES as readonly unknown[]).includes(r.status)) return null
  return { status: r.status as VatStatus, checkedOn: r.checkedOn }
}

/** Strict reader: `null` for a document that is not a schema 1 counterparty. */
export function parseCounterparty(id: string, data: unknown): Counterparty | null {
  const r = record(data)
  if (!r || r.schemaVersion !== SCHEMA_VERSION) return null
  if (typeof r.name !== 'string' || r.name === '' || typeof r.archived !== 'boolean') return null
  const ibans = parseIbans(r.ibans)
  if (ibans === null) return null

  const c: Counterparty = { id, name: r.name, ibans, archived: r.archived }
  if (r.nip !== undefined) {
    if (typeof r.nip !== 'string') return null
    c.nip = r.nip
  }
  if (r.address !== undefined) {
    if (typeof r.address !== 'string') return null
    c.address = r.address
  }
  if (r.vat !== undefined) {
    const vat = parseVat(r.vat)
    if (vat === null) return null
    c.vat = vat
  }
  if (r.kind !== undefined) {
    if (!(COUNTERPARTY_KINDS as readonly unknown[]).includes(r.kind)) return null
    c.kind = r.kind as CounterpartyKind
  }
  return c
}
```

Create `lib/domain/counterparties/keys.ts`:

```ts
import { nameKey, nipKey } from './normalize'

/** The uniqueness key ids of a counterparty: the NIP key (if any) first, then the name key. */
export function keysOf(c: { name: string; nip?: string }): string[] {
  return c.nip === undefined ? [nameKey(c.name)] : [nipKey(c.nip), nameKey(c.name)]
}

/** Which input field a key id protects. */
export function keyField(key: string): 'nip' | 'name' {
  return key.startsWith('nip_') ? 'nip' : 'name'
}
```

Create `lib/domain/counterparties/system.ts`:

```ts
import type { Counterparty, CounterpartyKind } from './types'

export interface SystemCounterpartySpec {
  /** Fixed document id: seeding twice cannot create a second copy. */
  id: string
  kind: CounterpartyKind
  /** Proper names, the same in every language. */
  name: string
}

export const SYSTEM_COUNTERPARTIES: readonly SystemCounterpartySpec[] = [
  { id: 'system_zus', kind: 'zus', name: 'ZUS' },
  { id: 'system_us', kind: 'us', name: 'Urząd Skarbowy' },
]

export function systemCounterparty(spec: SystemCounterpartySpec): Counterparty {
  return { id: spec.id, name: spec.name, ibans: [], archived: false, kind: spec.kind }
}
```

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run tests/unit/domain/counterparties`
Expected: all pass. If the `more than 20 IBANs` test fails for the wrong reason (the generated strings are not valid NRBs, so `normalizeIban` throws on `ibans` before the length check matters), that is still the expected field `ibans`; leave it.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/domain/counterparties tests/unit/domain/counterparties
git commit -m "feat(counterparties): types, input parsing, documents, uniqueness keys, system records

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: White list response parsing

**Files:**
- Create: `lib/domain/counterparties/whitelist.ts`, `tests/fixtures/whitelist/found-active.json`, `found-exempt.json`, `not-found.json`, `unknown-status.json`
- Test: `tests/unit/domain/counterparties/whitelist.test.ts`

The fixtures are trimmed by hand from the live response shape seen on 2026-10-27 (`result.subject` with `name`, `statusVat`, `workingAddress`, `residenceAddress`, `accountNumbers`). They are not recordings.

- [ ] **Step 1: Create the fixtures**

`tests/fixtures/whitelist/found-active.json`:

```json
{
  "result": {
    "subject": {
      "name": "ORLEN SPÓŁKA AKCYJNA",
      "nip": "7740001454",
      "statusVat": "Czynny",
      "regon": "610188201",
      "krs": "0000028860",
      "residenceAddress": "CHEMIKÓW 7, 09-411 PŁOCK",
      "workingAddress": null,
      "accountNumbers": ["61109010140000071219812874", "not-a-valid-number", "15109010140000071219812874"],
      "hasVirtualAccounts": false
    },
    "requestId": "W1rvo-994f1dd"
  }
}
```

`tests/fixtures/whitelist/found-exempt.json`:

```json
{
  "result": {
    "subject": {
      "name": "JAN KOWALSKI USŁUGI",
      "nip": "5252344078",
      "statusVat": "Zwolniony",
      "residenceAddress": "ul. Prosta 1, 00-001 Warszawa",
      "workingAddress": "ul. Robocza 2, 00-002 Warszawa",
      "accountNumbers": [],
      "hasVirtualAccounts": false
    },
    "requestId": "W1rvo-aaaaaaa"
  }
}
```

`tests/fixtures/whitelist/not-found.json`:

```json
{ "result": { "subject": null, "requestId": "W1rvo-bbbbbbb" } }
```

`tests/fixtures/whitelist/unknown-status.json`:

```json
{
  "result": {
    "subject": { "name": "X", "nip": "7740001454", "statusVat": "Wykreślony", "workingAddress": null, "residenceAddress": null, "accountNumbers": [] },
    "requestId": "W1rvo-ccccccc"
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/domain/counterparties/whitelist.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CounterpartyError } from '@/lib/domain/counterparties/errors'
import { parseWhitelistBody } from '@/lib/domain/counterparties/whitelist'

const fixture = (name: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/whitelist', name), 'utf8'))

describe('parseWhitelistBody', () => {
  it('reads a VAT payer: name, address, status and only the valid account numbers', () => {
    expect(parseWhitelistBody(fixture('found-active.json'))).toEqual({
      found: true,
      subject: {
        name: 'ORLEN SPÓŁKA AKCYJNA',
        address: 'CHEMIKÓW 7, 09-411 PŁOCK',
        vatStatus: 'active',
        ibans: ['61109010140000071219812874'],
      },
    })
  })

  it('prefers the working address and maps Zwolniony to exempt', () => {
    const result = parseWhitelistBody(fixture('found-exempt.json'))
    expect(result).toEqual({
      found: true,
      subject: { name: 'JAN KOWALSKI USŁUGI', address: 'ul. Robocza 2, 00-002 Warszawa', vatStatus: 'exempt', ibans: [] },
    })
  })

  it('answers found:false for an unknown NIP', () => {
    expect(parseWhitelistBody(fixture('not-found.json'))).toEqual({ found: false })
  })

  it('maps Niezarejestrowany to unregistered', () => {
    const body = { result: { subject: { name: 'A', statusVat: 'Niezarejestrowany', accountNumbers: [] } } }
    expect(parseWhitelistBody(body)).toEqual({ found: true, subject: { name: 'A', vatStatus: 'unregistered', ibans: [] } })
  })

  it.each([
    ['unknown VAT status', fixture('unknown-status.json')],
    ['no result', {}],
    ['result not an object', { result: 5 }],
    ['subject without a name', { result: { subject: { statusVat: 'Czynny', accountNumbers: [] } } }],
    ['accountNumbers not an array', { result: { subject: { name: 'A', statusVat: 'Czynny', accountNumbers: 'x' } } }],
    ['not an object', 'text'],
  ])('throws lookup_unavailable for %s', (_label, body) => {
    expect(() => parseWhitelistBody(body)).toThrowError(CounterpartyError)
    try {
      parseWhitelistBody(body)
    } catch (e) {
      expect((e as CounterpartyError).code).toBe('lookup_unavailable')
    }
  })
})
```

- [ ] **Step 3: Run it and see it fail**

Run: `npx vitest run tests/unit/domain/counterparties/whitelist.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 4: Write the implementation**

Create `lib/domain/counterparties/whitelist.ts`:

```ts
import { CounterpartyError } from './errors'
import { tryNormalizeIban } from './normalize'
import type { VatStatus } from './types'

export interface WhitelistSubject {
  name: string
  address?: string
  vatStatus: VatStatus
  /** Normalised NRBs; entries that are not valid account numbers are dropped. */
  ibans: string[]
}

export type WhitelistLookup = { found: false } | { found: true; subject: WhitelistSubject }

// A Map: a status text such as `constructor` must not find anything on an object prototype.
const STATUS = new Map<string, VatStatus>([
  ['Czynny', 'active'],
  ['Zwolniony', 'exempt'],
  ['Niezarejestrowany', 'unregistered'],
])

const unavailable = (): never => {
  throw new CounterpartyError('lookup_unavailable')
}

function text(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}

/**
 * The body of `GET /api/search/nip/{nip}` of the MF white list API. A subject of `null` is an unknown NIP
 * (`found: false`). Anything that does not have the expected shape is `lookup_unavailable`: a reply we cannot
 * read must never be mistaken for "not found".
 */
export function parseWhitelistBody(body: unknown): WhitelistLookup {
  if (typeof body !== 'object' || body === null) return unavailable()
  const result = (body as Record<string, unknown>).result
  if (typeof result !== 'object' || result === null) return unavailable()
  const subject = (result as Record<string, unknown>).subject
  if (subject === null) return { found: false }
  if (typeof subject !== 'object' || subject === undefined) return unavailable()

  const s = subject as Record<string, unknown>
  const name = text(s.name)
  const vatStatus = typeof s.statusVat === 'string' ? STATUS.get(s.statusVat) : undefined
  if (name === undefined || vatStatus === undefined || !Array.isArray(s.accountNumbers)) return unavailable()

  const ibans = s.accountNumbers.map((n) => tryNormalizeIban(n)).filter((n): n is string => n !== null)
  const address = text(s.workingAddress) ?? text(s.residenceAddress)
  return { found: true, subject: { name, ...(address === undefined ? {} : { address }), vatStatus, ibans } }
}
```

- [ ] **Step 5: Run and see it pass; typecheck; commit**

```bash
npx vitest run tests/unit/domain/counterparties
npx tsc --noEmit
git add lib/domain/counterparties tests/unit/domain/counterparties tests/fixtures/whitelist
git commit -m "feat(counterparties): parse the MF white list response

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Client-side search helper

**Files:**
- Create: `lib/domain/counterparties/search.ts`
- Test: `tests/unit/domain/counterparties/search.test.ts`

The settings page and the picker both filter the loaded list on the client (no index, up to 5000 records).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { filterCounterparties } from '@/lib/domain/counterparties/search'
import type { Counterparty } from '@/lib/domain/counterparties/types'

const c = (id: string, name: string, extra: Partial<Counterparty> = {}): Counterparty => ({ id, name, ibans: [], archived: false, ...extra })

const LIST = [
  c('1', 'Zakład Łączności', { nip: '7740001454' }),
  c('2', 'ZUS', { kind: 'zus' }),
  c('3', 'Acme', { archived: true }),
  c('4', 'Alfa Beta', { nip: '5252344078' }),
]

describe('filterCounterparties', () => {
  it('returns the active ones, sorted by name, for an empty query', () => {
    expect(filterCounterparties(LIST, '').map((x) => x.id)).toEqual(['4', '1', '2'])
  })

  it('includes archived ones on request', () => {
    expect(filterCounterparties(LIST, '', { includeArchived: true }).map((x) => x.id)).toEqual(['3', '4', '1', '2'])
  })

  it('matches names without regard to case or diacritics', () => {
    expect(filterCounterparties(LIST, 'laczn').map((x) => x.id)).toEqual(['1'])
    expect(filterCounterparties(LIST, 'ALFA').map((x) => x.id)).toEqual(['4'])
  })

  it('matches a NIP typed with separators or a PL prefix', () => {
    expect(filterCounterparties(LIST, '774-000').map((x) => x.id)).toEqual(['1'])
    expect(filterCounterparties(LIST, 'PL5252344078').map((x) => x.id)).toEqual(['4'])
  })

  it('matches every word of a multi-word query', () => {
    expect(filterCounterparties(LIST, 'alfa beta').map((x) => x.id)).toEqual(['4'])
    expect(filterCounterparties(LIST, 'alfa zus')).toEqual([])
  })
})
```

- [ ] **Step 2: Run it, see it fail**

Run: `npx vitest run tests/unit/domain/counterparties/search.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement**

Create `lib/domain/counterparties/search.ts`:

```ts
import { nameKeyText } from './normalize'
import type { Counterparty } from './types'

/**
 * The counterparties matching `query`, sorted by name. Every word of the query must occur in the name
 * (compared like the uniqueness key) or in the NIP (digits only). Archived ones are left out unless asked for.
 */
export function filterCounterparties(
  list: readonly Counterparty[],
  query: string,
  options: { includeArchived?: boolean } = {},
): Counterparty[] {
  const words = nameKeyText(query).split('_').filter(Boolean)
  const digits = query.replace(/[\s-]/g, '').replace(/^PL/i, '')

  return list
    .filter((c) => options.includeArchived === true || !c.archived)
    .filter((c) => {
      if (words.length === 0) return true
      const name = nameKeyText(c.name)
      if (words.every((w) => name.includes(w))) return true
      return c.nip !== undefined && /^\d+$/.test(digits) && c.nip.includes(digits)
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'))
}
```

- [ ] **Step 4: Run, typecheck, commit**

```bash
npx vitest run tests/unit/domain/counterparties
npx tsc --noEmit
git add lib/domain/counterparties/search.ts tests/unit/domain/counterparties/search.test.ts
git commit -m "feat(counterparties): client-side search helper

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: HttpError extra fields and the counterparty error mapping

**Files:**
- Modify: `lib/server/http-error.ts`
- Create: `lib/server/counterparties/http.ts`
- Test: `tests/unit/server/http-error.test.ts` (add), `tests/unit/server/counterparties/http.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/server/http-error.test.ts` (inside the file, as a new `describe`; keep its existing imports and add `HttpError`/`errorResponse` imports only if they are missing):

```ts
describe('HttpError extra fields', () => {
  it('adds them to the JSON body but never lets them replace the error code', async () => {
    const res = errorResponse(new HttpError(409, 'duplicate', { field: 'nip', existingId: 'c1', error: 'hacked' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ field: 'nip', existingId: 'c1', error: 'duplicate' })
  })

  it('leaves the body as before when there are none', async () => {
    expect(await errorResponse(new HttpError(404, 'not_found')).json()).toEqual({ error: 'not_found' })
  })
})
```

Create `tests/unit/server/counterparties/http.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CounterpartyError } from '@/lib/domain/counterparties/errors'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { HttpError } from '@/lib/server/http-error'
import { toCounterpartyHttpError } from '@/lib/server/counterparties/http'

function asHttp(e: unknown): HttpError {
  const out = toCounterpartyHttpError(e)
  expect(out).toBeInstanceOf(HttpError)
  return out as HttpError
}

describe('toCounterpartyHttpError', () => {
  it.each([
    ['invalid_input', 400],
    ['not_found', 404],
    ['duplicate', 409],
    ['limit', 409],
    ['conflict', 409],
    ['lookup_unavailable', 502],
  ] as const)('%s -> %i with the code as the message', (code, status) => {
    const e = asHttp(new CounterpartyError(code))
    expect(e.status).toBe(status)
    expect(e.message).toBe(code)
    expect(e.extra).toBeUndefined()
  })

  it('passes the field and the existing id on', () => {
    const e = asHttp(new CounterpartyError('duplicate', { field: 'nip', existingId: 'c1' }))
    expect(e.extra).toEqual({ field: 'nip', existingId: 'c1' })
    expect(asHttp(new CounterpartyError('invalid_input', { field: 'ibans' })).extra).toEqual({ field: 'ibans' })
  })

  it('hands ledger errors to the ledger mapping', () => {
    const e = asHttp(new LedgerError('account_not_found'))
    expect(e.status).toBe(422)
  })

  it('leaves unknown errors alone', () => {
    const boom = new Error('boom')
    expect(toCounterpartyHttpError(boom)).toBe(boom)
  })
})
```

- [ ] **Step 2: Run, see them fail**

Run: `npx vitest run tests/unit/server/http-error.test.ts tests/unit/server/counterparties/http.test.ts`
Expected: FAIL (`extra` unknown, module missing).

- [ ] **Step 3: Implement**

In `lib/server/http-error.ts` change the class and `errorResponse`:

```ts
export class HttpError extends Error {
  public readonly status: number
  /** Extra JSON fields of the response body (`field`, `existingId`). The `error` code cannot be overridden. */
  public readonly extra?: Record<string, unknown>

  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message)
    this.name = 'HttpError'
    this.status = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500
    this.extra = extra
  }
}
```

and in `errorResponse` replace the `HttpError` branch with:

```ts
  if (e instanceof HttpError) {
    return Response.json({ ...(e.extra ?? {}), error: e.message }, { status: e.status })
  }
```

(Keep the doc comment above `HttpError`; add one sentence about `extra`.)

Create `lib/server/counterparties/http.ts`:

```ts
import { CounterpartyError, type CounterpartyErrorCode } from '@/lib/domain/counterparties/errors'
import { HttpError } from '@/lib/server/http-error'
import { toHttpError } from '@/lib/server/ledger/http'

const STATUS: Record<CounterpartyErrorCode, number> = {
  invalid_input: 400,
  not_found: 404,
  duplicate: 409,
  limit: 409,
  conflict: 409,
  lookup_unavailable: 502,
}

/** A CounterpartyError becomes an HttpError (code, plus `field` and `existingId` when set); others go to the ledger mapping. */
export function toCounterpartyHttpError(e: unknown): unknown {
  if (e instanceof CounterpartyError) {
    const extra: Record<string, unknown> = {}
    if (e.field !== undefined) extra.field = e.field
    if (e.existingId !== undefined) extra.existingId = e.existingId
    return new HttpError(STATUS[e.code], e.code, Object.keys(extra).length > 0 ? extra : undefined)
  }
  return toHttpError(e)
}
```

Also in `lib/domain/counterparties/errors.ts` (Task 1) there is no `rate_limited` code: the rate limit answers with `HttpError(429, 'rate_limited')` directly (Task 6).

- [ ] **Step 4: Run, typecheck, commit**

```bash
npx vitest run tests/unit/server
npx tsc --noEmit
git add lib/server tests/unit/server
git commit -m "feat(counterparties): HttpError extra fields and counterparty error mapping

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Rate limit

**Files:**
- Create: `lib/server/rate-limit.ts`, `lib/server/rate-limit-guard.ts`
- Test: `tests/integration/rate-limit.test.ts`

Counters live in `rateLimits/{key}_{window}_{bucket}` (root collection, closed to clients by the default deny rule; Task 13 adds a test). Each document carries `expiresAt` so a Firestore TTL policy can clean them later (follow-up, not configured here).

- [ ] **Step 1: Write the failing test**

Create `tests/integration/rate-limit.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { consumeRateLimit, type RateWindow } from '@/lib/server/rate-limit'
import { clearFirestore, testDb } from './helpers'

const WINDOWS: readonly RateWindow[] = [
  { name: 'm', seconds: 60, max: 3 },
  { name: 'h', seconds: 3600, max: 5 },
]
const T0 = new Date('2026-10-27T10:00:10Z')
const plus = (seconds: number) => new Date(T0.getTime() + seconds * 1000)

beforeEach(clearFirestore)

describe('consumeRateLimit', () => {
  it('allows up to max in the narrowest window, then refuses', async () => {
    const db = testDb()
    const results = []
    for (let i = 0; i < 5; i++) results.push(await consumeRateLimit(db, 'lookup_u1', WINDOWS, T0))
    expect(results).toEqual([true, true, true, false, false])
  })

  it('a new minute resets the minute counter but not the hour counter', async () => {
    const db = testDb()
    for (let i = 0; i < 3; i++) expect(await consumeRateLimit(db, 'lookup_u1', WINDOWS, T0)).toBe(true)
    expect(await consumeRateLimit(db, 'lookup_u1', WINDOWS, plus(60))).toBe(true) // 4th overall
    expect(await consumeRateLimit(db, 'lookup_u1', WINDOWS, plus(61))).toBe(true) // 5th overall
    expect(await consumeRateLimit(db, 'lookup_u1', WINDOWS, plus(62))).toBe(false) // hour max 5
  })

  it('counts per key', async () => {
    const db = testDb()
    for (let i = 0; i < 3; i++) await consumeRateLimit(db, 'lookup_u1', WINDOWS, T0)
    expect(await consumeRateLimit(db, 'lookup_u1', WINDOWS, T0)).toBe(false)
    expect(await consumeRateLimit(db, 'lookup_u2', WINDOWS, T0)).toBe(true)
  })

  it('a refused call counts nothing', async () => {
    const db = testDb()
    for (let i = 0; i < 6; i++) await consumeRateLimit(db, 'lookup_u1', WINDOWS, T0)
    const minute = await db.doc(`rateLimits/lookup_u1_m_${Math.floor(T0.getTime() / 1000 / 60)}`).get()
    expect(minute.get('count')).toBe(3)
  })

  it('parallel calls never get more than max through', async () => {
    const db = testDb()
    // allSettled: under heavy contention the emulator may abort a few transactions; those are neither allowed nor counted.
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => consumeRateLimit(db, 'lookup_u3', WINDOWS, T0)))
    const allowed = results.filter((r) => r.status === 'fulfilled' && r.value).length
    expect(allowed).toBeLessThanOrEqual(3)
    if (results.every((r) => r.status === 'fulfilled')) expect(allowed).toBe(3)
  })
})
```

- [ ] **Step 2: Run, see it fail**

Run: `PATH="$HOME/.jre/temurin-21/bin:$PATH" npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts tests/integration/rate-limit.test.ts"`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement**

Create `lib/server/rate-limit.ts`:

```ts
import { Timestamp, type Firestore } from 'firebase-admin/firestore'

export interface RateWindow {
  /** Short, id-safe label of the window (`m`, `h`). */
  name: string
  seconds: number
  max: number
}

/**
 * Counts one call against every window of `key` in one transaction. Returns `false`, counting nothing, when any
 * window is already full. The counter documents are `rateLimits/{key}_{name}_{bucket}`; `expiresAt` lets a Firestore
 * TTL policy remove old ones.
 */
export async function consumeRateLimit(db: Firestore, key: string, windows: readonly RateWindow[], now: Date): Promise<boolean> {
  const nowSec = Math.floor(now.getTime() / 1000)
  const slots = windows.map((w) => {
    const bucket = Math.floor(nowSec / w.seconds)
    return { w, ref: db.collection('rateLimits').doc(`${key}_${w.name}_${bucket}`), expiresAtSec: (bucket + 2) * w.seconds }
  })

  return db.runTransaction(async (t) => {
    const snaps = await Promise.all(slots.map((s) => t.get(s.ref)))
    const counts = snaps.map((snap) => (snap.get('count') as number | undefined) ?? 0)
    if (slots.some((s, i) => counts[i] >= s.w.max)) return false
    slots.forEach((s, i) => t.set(s.ref, { count: counts[i] + 1, expiresAt: Timestamp.fromMillis(s.expiresAtSec * 1000) }))
    return true
  })
}
```

Create `lib/server/rate-limit-guard.ts`:

```ts
import 'server-only'
import { getAdmin } from '@/lib/server/firebase-admin'
import { HttpError } from '@/lib/server/http-error'
import { consumeRateLimit, type RateWindow } from './rate-limit'

/** White list lookups: they call a public government API, so they are the narrowest. */
export const LOOKUP_LIMITS: readonly RateWindow[] = [
  { name: 'm', seconds: 60, max: 30 },
  { name: 'h', seconds: 3600, max: 300 },
]

/** NBP rates: the answers are cached for minutes, so a user never needs many. */
export const RATES_LIMITS: readonly RateWindow[] = [
  { name: 'm', seconds: 60, max: 120 },
  { name: 'h', seconds: 3600, max: 1200 },
]

/** Throws `HttpError(429, 'rate_limited')` when the user is over a limit of the scope. */
export async function enforceRateLimit(uid: string, scope: 'lookup' | 'rates', limits: readonly RateWindow[], now: Date = new Date()): Promise<void> {
  const safeUid = uid.replace(/[^A-Za-z0-9_-]/g, '_')
  if (!(await consumeRateLimit(getAdmin().db, `${scope}_${safeUid}`, limits, now))) throw new HttpError(429, 'rate_limited')
}
```

- [ ] **Step 4: Run, see it pass; typecheck; commit**

```bash
PATH="$HOME/.jre/temurin-21/bin:$PATH" npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts tests/integration/rate-limit.test.ts"
npx tsc --noEmit
git add lib/server/rate-limit.ts lib/server/rate-limit-guard.ts tests/integration/rate-limit.test.ts
git commit -m "feat(rate-limit): per-user transactional counters

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: White list client (server)

**Files:**
- Create: `lib/server/counterparties/whitelist.ts`
- Test: `tests/unit/server/counterparties/whitelist.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CounterpartyError } from '@/lib/domain/counterparties/errors'
import { lookupNip } from '@/lib/server/counterparties/whitelist'

const fixtureText = (name: string) => readFileSync(resolve(process.cwd(), 'tests/fixtures/whitelist', name), 'utf8')
const json = (text: string, status = 200) => new Response(text, { status, headers: { 'Content-Type': 'application/json' } })
const code = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return (e as CounterpartyError).code
  }
  return 'resolved'
}

describe('lookupNip', () => {
  it('asks the white list for the NIP and day and parses the answer', async () => {
    const fetchFn = vi.fn(async () => json(fixtureText('found-active.json')))
    const result = await lookupNip('7740001454', '2026-10-27', { fetch: fetchFn as unknown as typeof fetch, baseUrl: 'https://wl.example/' })
    expect(result).toMatchObject({ found: true, subject: { name: 'ORLEN SPÓŁKA AKCYJNA', vatStatus: 'active' } })
    expect(String(fetchFn.mock.calls[0][0])).toBe('https://wl.example/api/search/nip/7740001454?date=2026-10-27')
  })

  it('answers found:false for an unknown NIP', async () => {
    const fetchFn = vi.fn(async () => json(fixtureText('not-found.json')))
    expect(await lookupNip('5252344078', '2026-10-27', { fetch: fetchFn as unknown as typeof fetch })).toEqual({ found: false })
  })

  it('retries once after a network error', async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(json(fixtureText('not-found.json')))
    expect(await lookupNip('5252344078', '2026-10-27', { fetch: fetchFn as unknown as typeof fetch })).toEqual({ found: false })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('gives up after two network errors with lookup_unavailable', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    expect(await code(lookupNip('7740001454', '2026-10-27', { fetch: fetchFn as unknown as typeof fetch }))).toBe('lookup_unavailable')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it.each([500, 429, 400])('does not retry an HTTP %i and reports lookup_unavailable', async (status) => {
    const fetchFn = vi.fn(async () => json('{"message":"x"}', status))
    expect(await code(lookupNip('7740001454', '2026-10-27', { fetch: fetchFn as unknown as typeof fetch }))).toBe('lookup_unavailable')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('reports lookup_unavailable for a body that is not JSON', async () => {
    const fetchFn = vi.fn(async () => new Response('<html>', { status: 200 }))
    expect(await code(lookupNip('7740001454', '2026-10-27', { fetch: fetchFn as unknown as typeof fetch }))).toBe('lookup_unavailable')
  })

  it('takes the base URL from WL_API_BASE when no option is given', async () => {
    vi.stubEnv('WL_API_BASE', 'http://127.0.0.1:4010/')
    const fetchFn = vi.fn(async () => json(fixtureText('not-found.json')))
    await lookupNip('5252344078', '2026-10-27', { fetch: fetchFn as unknown as typeof fetch })
    expect(String(fetchFn.mock.calls[0][0]).startsWith('http://127.0.0.1:4010/api/search/nip/')).toBe(true)
  })
})
```

- [ ] **Step 2: Run, see it fail**

Run: `npx vitest run tests/unit/server/counterparties/whitelist.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement**

Create `lib/server/counterparties/whitelist.ts`:

```ts
import { CounterpartyError } from '@/lib/domain/counterparties/errors'
import { parseWhitelistBody, type WhitelistLookup } from '@/lib/domain/counterparties/whitelist'

const DEFAULT_BASE = 'https://wl-api.mf.gov.pl'
const TIMEOUT_MS = 8000

export interface WhitelistClientOptions {
  fetch?: typeof fetch
  baseUrl?: string
  timeoutMs?: number
}

/**
 * Asks the MF white list (public API, no key) about a NIP on `day` (`YYYY-MM-DD`, the Warsaw day). One retry after
 * a network error or timeout; an HTTP error or an unreadable body is not retried. Every failure is
 * `lookup_unavailable`, and the reply text is never logged or passed on. `WL_API_BASE` exists for tests (a stub).
 */
export async function lookupNip(nip: string, day: string, options: WhitelistClientOptions = {}): Promise<WhitelistLookup> {
  const doFetch = options.fetch ?? fetch
  const base = (options.baseUrl ?? process.env.WL_API_BASE ?? DEFAULT_BASE).replace(/\/+$/, '')
  const url = `${base}/api/search/nip/${encodeURIComponent(nip)}?date=${encodeURIComponent(day)}`

  let res: Response | undefined
  for (let attempt = 0; attempt < 2 && res === undefined; attempt++) {
    try {
      res = await doFetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
        cache: 'no-store',
      })
    } catch {
      // Network error or timeout: try once more.
    }
  }
  if (res === undefined || !res.ok) throw new CounterpartyError('lookup_unavailable')

  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new CounterpartyError('lookup_unavailable')
  }
  return parseWhitelistBody(body)
}
```

- [ ] **Step 4: Run, typecheck, commit**

```bash
npx vitest run tests/unit/server/counterparties
npx tsc --noEmit
git add lib/server/counterparties tests/unit/server/counterparties
git commit -m "feat(counterparties): MF white list client

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Create and update counterparties (Admin transaction)

**Files:**
- Modify: `lib/server/ledger/audit.ts`, `lib/server/ledger/paths.ts`
- Create: `lib/server/counterparties/deps.ts`, `lib/server/counterparties/write.ts`
- Test: `tests/integration/counterparties-write.test.ts`

- [ ] **Step 1: Small edits to existing files**

In `lib/server/ledger/audit.ts`: extend the union and relax the first parameter type of `auditData` (it only calls `deps.now()`):

```ts
export type AuditAction =
  | 'tx.create' | 'tx.update' | 'tx.delete'
  | 'account.create' | 'account.update' | 'account.delete'
  | 'counterparty.create' | 'counterparty.update'
  | 'org.update' | 'ledger.rebuild' | 'migration.v2'

/** The audit entry to `create()` in the same transaction as the change it records. */
export function auditData(
  deps: Pick<LedgerDeps, 'now'>,
  ...
```

(Leave the rest of the function body as it is.)

In `lib/server/ledger/paths.ts` add:

```ts
export const counterpartiesCol = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('counterparties')
/** Uniqueness keys of the counterparties (NIP and name): closed to clients (firestore.rules). */
export const counterpartyKeysCol = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('counterpartyKeys')
```

- [ ] **Step 2: Write the failing integration test**

Create `tests/integration/counterparties-write.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CounterpartyError } from '@/lib/domain/counterparties/errors'
import type { WhitelistLookup } from '@/lib/domain/counterparties/whitelist'
import type { CounterpartyDeps } from '@/lib/server/counterparties/deps'
import { createCounterparty, updateCounterparty } from '@/lib/server/counterparties/write'
import { auditActions, clearFirestore, ORG, readDoc, seedOrg, testDb, TODAY, UID } from './helpers'

const NRB1 = '61109010140000071219812874'
const NRB2 = '15109010140000071219812874'
const FOUND: WhitelistLookup = { found: true, subject: { name: 'ORLEN', vatStatus: 'active', ibans: [NRB1] } }
const NOT_FOUND: WhitelistLookup = { found: false }

function makeCpDeps(over: Partial<CounterpartyDeps> = {}): CounterpartyDeps {
  return { db: testDb(), now: () => new Date('2026-10-27T10:00:00Z'), today: () => TODAY, lookup: async () => NOT_FOUND, ...over }
}

async function ids(path: string): Promise<string[]> {
  return (await testDb().collection(path).get()).docs.map((d) => d.id).sort()
}

async function failure(p: Promise<unknown>): Promise<CounterpartyError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(CounterpartyError)
    return e as CounterpartyError
  }
  throw new Error('expected a CounterpartyError')
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(testDb())
})

describe('createCounterparty', () => {
  it('writes the document, the name key and an audit entry', async () => {
    const c = await createCounterparty(makeCpDeps(), ORG, UID, { name: 'Acme', ibans: [] })
    const doc = await readDoc(testDb(), `organizations/${ORG}/counterparties/${c.id}`)
    expect(doc).toMatchObject({ schemaVersion: 1, name: 'Acme', ibans: [], archived: false, orgId: ORG })
    expect(doc?.createdAt).toBeDefined()
    expect(await ids(`organizations/${ORG}/counterpartyKeys`)).toEqual(['name_acme'])
    expect(await readDoc(testDb(), `organizations/${ORG}/counterpartyKeys/name_acme`)).toEqual({ counterpartyId: c.id })
    expect(await auditActions(testDb(), ORG)).toEqual(['counterparty.create'])
  })

  it('with a NIP found on the white list stores VAT status and marks the IBANs', async () => {
    const lookup = vi.fn(async () => FOUND)
    const c = await createCounterparty(makeCpDeps({ lookup }), ORG, UID, { name: 'Orlen', nip: '7740001454', ibans: [NRB1, NRB2] })
    expect(lookup).toHaveBeenCalledWith('7740001454')
    expect(c.vat).toEqual({ status: 'active', checkedOn: TODAY })
    expect(c.ibans).toEqual([{ iban: NRB1, onWhitelist: true }, { iban: NRB2, onWhitelist: false }])
    expect(await ids(`organizations/${ORG}/counterpartyKeys`)).toEqual(['name_orlen', 'nip_7740001454'])
  })

  it('with the white list unavailable still saves, with nothing marked', async () => {
    const lookup = async () => {
      throw new CounterpartyError('lookup_unavailable')
    }
    const c = await createCounterparty(makeCpDeps({ lookup }), ORG, UID, { name: 'Orlen', nip: '7740001454', ibans: [NRB1] })
    expect(c.vat).toBeUndefined()
    expect(c.ibans).toEqual([{ iban: NRB1, onWhitelist: null }])
  })

  it('with an unknown NIP saves with no VAT status', async () => {
    const c = await createCounterparty(makeCpDeps(), ORG, UID, { name: 'Jan', nip: '5252344078', ibans: [NRB1] })
    expect(c.vat).toBeUndefined()
    expect(c.ibans).toEqual([{ iban: NRB1, onWhitelist: null }])
  })

  it('asks the white list nothing when there is no NIP', async () => {
    const lookup = vi.fn(async () => FOUND)
    await createCounterparty(makeCpDeps({ lookup }), ORG, UID, { name: 'Acme', ibans: [NRB1] })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('refuses a second counterparty with the same name, however it is spelled', async () => {
    const first = await createCounterparty(makeCpDeps(), ORG, UID, { name: 'Zakład Łączności', ibans: [] })
    const e = await failure(createCounterparty(makeCpDeps(), ORG, UID, { name: 'ZAKLAD  laczności', ibans: [] }))
    expect(e).toMatchObject({ code: 'duplicate', field: 'name', existingId: first.id })
    expect(await ids(`organizations/${ORG}/counterparties`)).toEqual([first.id])
  })

  it('refuses a second counterparty with the same NIP and names the field', async () => {
    const first = await createCounterparty(makeCpDeps(), ORG, UID, { name: 'One', nip: '7740001454', ibans: [] })
    const e = await failure(createCounterparty(makeCpDeps(), ORG, UID, { name: 'Two', nip: '7740001454', ibans: [] }))
    expect(e).toMatchObject({ code: 'duplicate', field: 'nip', existingId: first.id })
    expect(await ids(`organizations/${ORG}/counterpartyKeys`)).toEqual(['name_one', 'nip_7740001454'])
  })

  it('lets the same name live in two companies', async () => {
    await seedOrg(testDb(), 'org2')
    await createCounterparty(makeCpDeps(), ORG, UID, { name: 'Acme', ibans: [] })
    await expect(createCounterparty(makeCpDeps(), 'org2', UID, { name: 'Acme', ibans: [] })).resolves.toBeDefined()
  })

  // If the emulator aborts some of the five with a contention error (not a CounterpartyError), lower the count to 3.
  it('five parallel creates of one name leave exactly one', async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => createCounterparty(makeCpDeps(), ORG, UID, { name: 'Race Ltd', ibans: [] })))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'duplicate' })
    expect(await ids(`organizations/${ORG}/counterparties`)).toHaveLength(1)
    expect(await ids(`organizations/${ORG}/counterpartyKeys`)).toEqual(['name_race_ltd'])
  })

  it('refuses beyond the limit', async () => {
    const deps = makeCpDeps({ maxCount: 2 })
    await createCounterparty(deps, ORG, UID, { name: 'A', ibans: [] })
    await createCounterparty(deps, ORG, UID, { name: 'B', ibans: [] })
    expect(await failure(createCounterparty(deps, ORG, UID, { name: 'C', ibans: [] }))).toMatchObject({ code: 'limit' })
  })

  it('answers not_found for a company that does not exist', async () => {
    expect(await failure(createCounterparty(makeCpDeps(), 'nope', UID, { name: 'A', ibans: [] }))).toMatchObject({ code: 'not_found' })
  })
})

describe('updateCounterparty', () => {
  it('renaming moves the name key and frees the old name', async () => {
    const c = await createCounterparty(makeCpDeps(), ORG, UID, { name: 'Old Name', ibans: [] })
    const after = await updateCounterparty(makeCpDeps(), ORG, UID, c.id, { name: 'New Name' })
    expect(after.name).toBe('New Name')
    expect(await ids(`organizations/${ORG}/counterpartyKeys`)).toEqual(['name_new_name'])
    await expect(createCounterparty(makeCpDeps(), ORG, UID, { name: 'old name', ibans: [] })).resolves.toBeDefined()
    expect(await auditActions(testDb(), ORG)).toEqual(['counterparty.create', 'counterparty.create', 'counterparty.update'])
  })

  it('refuses a NIP that another counterparty has and changes nothing', async () => {
    const a = await createCounterparty(makeCpDeps(), ORG, UID, { name: 'A', nip: '7740001454', ibans: [] })
    const b = await createCounterparty(makeCpDeps(), ORG, UID, { name: 'B', ibans: [] })
    const e = await failure(updateCounterparty(makeCpDeps(), ORG, UID, b.id, { nip: '7740001454' }))
    expect(e).toMatchObject({ code: 'duplicate', field: 'nip', existingId: a.id })
    expect((await readDoc(testDb(), `organizations/${ORG}/counterparties/${b.id}`))?.nip).toBeUndefined()
    expect(await ids(`organizations/${ORG}/counterpartyKeys`)).toEqual(['name_a', 'name_b', 'nip_7740001454'])
  })

  it('archiving asks the white list nothing and keeps the keys', async () => {
    const lookup = vi.fn(async () => FOUND)
    const c = await createCounterparty(makeCpDeps({ lookup }), ORG, UID, { name: 'Orlen', nip: '7740001454', ibans: [NRB1] })
    lookup.mockClear()
    const after = await updateCounterparty(makeCpDeps({ lookup }), ORG, UID, c.id, { archived: true })
    expect(after.archived).toBe(true)
    expect(after.vat).toEqual(c.vat)
    expect(lookup).not.toHaveBeenCalled()
    expect(await ids(`organizations/${ORG}/counterpartyKeys`)).toEqual(['name_orlen', 'nip_7740001454'])
  })

  it('changing the IBAN list asks the white list again and re-marks', async () => {
    const lookup = vi.fn(async () => FOUND)
    const c = await createCounterparty(makeCpDeps({ lookup }), ORG, UID, { name: 'Orlen', nip: '7740001454', ibans: [] })
    const after = await updateCounterparty(makeCpDeps({ lookup }), ORG, UID, c.id, { ibans: [NRB1, NRB2] })
    expect(lookup).toHaveBeenCalledTimes(2)
    expect(after.ibans).toEqual([{ iban: NRB1, onWhitelist: true }, { iban: NRB2, onWhitelist: false }])
  })

  it('with the white list unavailable keeps the stored status and marks for the same NIP', async () => {
    const c = await createCounterparty(makeCpDeps({ lookup: async () => FOUND }), ORG, UID, { name: 'Orlen', nip: '7740001454', ibans: [NRB1] })
    const down = async (): Promise<WhitelistLookup> => {
      throw new CounterpartyError('lookup_unavailable')
    }
    const after = await updateCounterparty(makeCpDeps({ lookup: down }), ORG, UID, c.id, { ibans: [NRB1, NRB2] })
    expect(after.vat).toEqual(c.vat)
    expect(after.ibans).toEqual([{ iban: NRB1, onWhitelist: true }, { iban: NRB2, onWhitelist: null }])
  })

  it('clearing the NIP removes the NIP key and the VAT status', async () => {
    const c = await createCounterparty(makeCpDeps({ lookup: async () => FOUND }), ORG, UID, { name: 'Orlen', nip: '7740001454', ibans: [NRB1] })
    const after = await updateCounterparty(makeCpDeps(), ORG, UID, c.id, { nip: null })
    expect(after.nip).toBeUndefined()
    expect(after.vat).toBeUndefined()
    expect(after.ibans).toEqual([{ iban: NRB1, onWhitelist: null }])
    expect(await ids(`organizations/${ORG}/counterpartyKeys`)).toEqual(['name_orlen'])
  })

  it('keeps createdAt, orgId and kind', async () => {
    const c = await createCounterparty(makeCpDeps(), ORG, UID, { name: 'A', ibans: [] })
    const before = await readDoc(testDb(), `organizations/${ORG}/counterparties/${c.id}`)
    await updateCounterparty(makeCpDeps(), ORG, UID, c.id, { address: 'Warszawa' })
    const doc = await readDoc(testDb(), `organizations/${ORG}/counterparties/${c.id}`)
    expect(doc?.createdAt).toEqual(before?.createdAt)
    expect(doc).toMatchObject({ orgId: ORG, address: 'Warszawa' })
  })

  it('answers not_found for an unknown id', async () => {
    expect(await failure(updateCounterparty(makeCpDeps(), ORG, UID, 'nope', { name: 'X' }))).toMatchObject({ code: 'not_found' })
  })
})
```

- [ ] **Step 3: Run, see it fail**

Run: `PATH="$HOME/.jre/temurin-21/bin:$PATH" npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts tests/integration/counterparties-write.test.ts"`
Expected: FAIL, modules missing.

- [ ] **Step 4: Implement**

Create `lib/server/counterparties/deps.ts`:

```ts
import type { Firestore } from 'firebase-admin/firestore'
import type { WhitelistLookup } from '@/lib/domain/counterparties/whitelist'

export interface CounterpartyDeps {
  db: Firestore
  now: () => Date
  /** The Warsaw day, `YYYY-MM-DD`. */
  today: () => string
  /** Asks the MF white list. Throws `lookup_unavailable` when it cannot be asked. */
  lookup: (nip: string) => Promise<WhitelistLookup>
  /** Overrides the per-company limit (tests). */
  maxCount?: number
}
```

Create `lib/server/counterparties/write.ts`:

```ts
import { Timestamp } from 'firebase-admin/firestore'
import { counterpartyToDoc, parseCounterparty } from '@/lib/domain/counterparties/doc'
import { CounterpartyError } from '@/lib/domain/counterparties/errors'
import type { CounterpartyInput, CounterpartyPatch } from '@/lib/domain/counterparties/input'
import { keyField, keysOf } from '@/lib/domain/counterparties/keys'
import { MAX_COUNTERPARTIES, type Counterparty, type CounterpartyIban, type Vat } from '@/lib/domain/counterparties/types'
import type { WhitelistLookup } from '@/lib/domain/counterparties/whitelist'
import { auditData } from '@/lib/server/ledger/audit'
import { auditCol, counterpartiesCol, counterpartyKeysCol, orgRef } from '@/lib/server/ledger/paths'
import type { CounterpartyDeps } from './deps'

interface Marks {
  vat?: Vat
  ibans: CounterpartyIban[]
}

const unmarked = (ibans: string[]): CounterpartyIban[] => ibans.map((iban) => ({ iban, onWhitelist: null }))

/** What the white list says about a NIP, or `null` when it could not be asked (the save goes on without it). */
async function ask(deps: CounterpartyDeps, nip: string): Promise<WhitelistLookup | null> {
  try {
    return await deps.lookup(nip)
  } catch (e) {
    if (e instanceof CounterpartyError && e.code === 'lookup_unavailable') return null
    throw e
  }
}

function marksFrom(found: WhitelistLookup, today: string, ibans: string[]): Marks {
  if (!found.found) return { ibans: unmarked(ibans) }
  return {
    vat: { status: found.subject.vatStatus, checkedOn: today },
    ibans: ibans.map((iban) => ({ iban, onWhitelist: found.subject.ibans.includes(iban) })),
  }
}

function duplicate(key: string, existing: { get: (f: string) => unknown }): CounterpartyError {
  return new CounterpartyError('duplicate', { field: keyField(key), existingId: existing.get('counterpartyId') as string })
}

export async function createCounterparty(deps: CounterpartyDeps, orgId: string, uid: string, input: CounterpartyInput): Promise<Counterparty> {
  const found = input.nip === undefined ? null : await ask(deps, input.nip)
  const marks = found === null ? { ibans: unmarked(input.ibans) } : marksFrom(found, deps.today(), input.ibans)

  const ref = counterpartiesCol(deps.db, orgId).doc()
  const keysCol = counterpartyKeysCol(deps.db, orgId)
  const c: Counterparty = {
    id: ref.id,
    name: input.name,
    ibans: marks.ibans,
    archived: false,
    ...(input.nip === undefined ? {} : { nip: input.nip }),
    ...(input.address === undefined ? {} : { address: input.address }),
    ...(marks.vat === undefined ? {} : { vat: marks.vat }),
  }
  const limit = deps.maxCount ?? MAX_COUNTERPARTIES

  await deps.db.runTransaction(async (t) => {
    // All reads first.
    const count = (await t.get(counterpartiesCol(deps.db, orgId).count())).data().count
    const org = await t.get(orgRef(deps.db, orgId))
    const keys = keysOf(c)
    const taken = await Promise.all(keys.map((k) => t.get(keysCol.doc(k))))

    if (!org.exists) throw new CounterpartyError('not_found')
    taken.forEach((snap, i) => {
      if (snap.exists) throw duplicate(keys[i], snap)
    })
    if (count >= limit) throw new CounterpartyError('limit')

    const ts = Timestamp.fromDate(deps.now())
    t.create(ref, { ...counterpartyToDoc(c), orgId, createdAt: ts, updatedAt: ts })
    for (const k of keys) t.create(keysCol.doc(k), { counterpartyId: ref.id })
    t.create(auditCol(deps.db, orgId).doc(), auditData(deps, 'counterparty.create', uid, ref.id, null, counterpartyToDoc(c)))
  })
  return c
}

export async function updateCounterparty(
  deps: CounterpartyDeps,
  orgId: string,
  uid: string,
  id: string,
  patch: CounterpartyPatch,
): Promise<Counterparty> {
  const ref = counterpartiesCol(deps.db, orgId).doc(id)
  const keysCol = counterpartyKeysCol(deps.db, orgId)

  const pre = await ref.get()
  const prior = pre.exists ? parseCounterparty(pre.id, pre.data()) : null
  if (!prior) throw new CounterpartyError('not_found')

  const nip = patch.nip === undefined ? prior.nip : (patch.nip ?? undefined)
  const address = patch.address === undefined ? prior.address : (patch.address ?? undefined)
  const ibanList = patch.ibans ?? prior.ibans.map((i) => i.iban)
  const nipChanged = nip !== prior.nip
  // The white list is asked again only when the NIP or the IBAN list changed (not for a rename or an archive).
  const recheck = nip !== undefined && (patch.nip !== undefined || patch.ibans !== undefined)
  const found = recheck ? await ask(deps, nip) : null

  let marks: Marks
  if (nip === undefined) marks = { ibans: unmarked(ibanList) }
  else if (found !== null) marks = marksFrom(found, deps.today(), ibanList)
  else if (nipChanged) marks = { ibans: unmarked(ibanList) }
  else {
    // Same NIP and nothing new to learn (no recheck, or the white list is down): keep what is known.
    marks = {
      ...(prior.vat === undefined ? {} : { vat: prior.vat }),
      ibans: ibanList.map((iban) => ({ iban, onWhitelist: prior.ibans.find((p) => p.iban === iban)?.onWhitelist ?? null })),
    }
  }

  const after: Counterparty = {
    id,
    name: patch.name ?? prior.name,
    ibans: marks.ibans,
    archived: patch.archived ?? prior.archived,
    ...(nip === undefined ? {} : { nip }),
    ...(address === undefined ? {} : { address }),
    ...(marks.vat === undefined ? {} : { vat: marks.vat }),
    ...(prior.kind === undefined ? {} : { kind: prior.kind }),
  }
  const oldKeys = keysOf(prior)
  const newKeys = keysOf(after)
  const added = newKeys.filter((k) => !oldKeys.includes(k))
  const removed = oldKeys.filter((k) => !newKeys.includes(k))

  return deps.db.runTransaction(async (t) => {
    const snap = await t.get(ref)
    if (!snap.exists) throw new CounterpartyError('not_found')
    // Someone saved this counterparty between our first read and now: the marks above may be stale.
    if (!pre.updateTime || !snap.updateTime || !snap.updateTime.isEqual(pre.updateTime)) throw new CounterpartyError('conflict')
    const taken = await Promise.all(added.map((k) => t.get(keysCol.doc(k))))
    taken.forEach((s, i) => {
      if (s.exists) throw duplicate(added[i], s)
    })

    const ts = Timestamp.fromDate(deps.now())
    t.set(ref, { ...counterpartyToDoc(after), orgId, createdAt: snap.get('createdAt'), updatedAt: ts })
    for (const k of removed) t.delete(keysCol.doc(k))
    for (const k of added) t.create(keysCol.doc(k), { counterpartyId: id })
    t.create(auditCol(deps.db, orgId).doc(), auditData(deps, 'counterparty.update', uid, id, counterpartyToDoc(prior), counterpartyToDoc(after)))
    return after
  })
}
```

If `t.get(query.count())` is rejected by the emulator or the SDK types, fall back to a non-transactional count before the transaction (`const count = (await counterpartiesCol(...).count().get()).data().count`) and say so in the report; the limit is a soft guard.

- [ ] **Step 5: Run, see it pass; typecheck; lint; commit**

```bash
PATH="$HOME/.jre/temurin-21/bin:$PATH" npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts"
npx tsc --noEmit
npx eslint lib/server lib/domain/counterparties
git add lib tests/integration
git commit -m "feat(counterparties): create and update in one Admin transaction with uniqueness keys

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: the whole integration suite passes (the ledger tests still pass: `auditData` only widened its parameter type).

---

### Task 9: System counterparties: new companies, existing companies, script

**Files:**
- Create: `lib/server/counterparties/seed.ts`, `scripts/lib/seed-counterparties-args.ts`, `scripts/seed-counterparties.ts`
- Modify: `lib/server/orgs.ts`, `tests/unit/helpers/fake-admin.ts`, `package.json`
- Test: `tests/integration/counterparties-seed.test.ts`, `tests/unit/scripts/seed-counterparties-args.test.ts`, `tests/unit/server/orgs.test.ts` (add)

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/counterparties-seed.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { seedExistingOrg, seedSystemCounterparties } from '@/lib/server/counterparties/seed'
import { auditActions, clearFirestore, ORG, readDoc, seedOrg, testDb } from './helpers'

const NOW = new Date('2026-10-27T10:00:00Z')

async function ids(path: string): Promise<string[]> {
  return (await testDb().collection(path).get()).docs.map((d) => d.id).sort()
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(testDb())
})

describe('seedSystemCounterparties (a company being created)', () => {
  it('creates ZUS and Urząd Skarbowy with their name keys inside the caller transaction', async () => {
    const db = testDb()
    await db.runTransaction(async (t) => {
      seedSystemCounterparties(t, db, 'fresh', NOW)
    })
    expect(await ids('organizations/fresh/counterparties')).toEqual(['system_us', 'system_zus'])
    expect(await ids('organizations/fresh/counterpartyKeys')).toEqual(['name_urzad_skarbowy', 'name_zus'])
    expect(await readDoc(db, 'organizations/fresh/counterparties/system_zus')).toMatchObject({ name: 'ZUS', kind: 'zus', archived: false, schemaVersion: 1, orgId: 'fresh' })
  })
})

describe('seedExistingOrg', () => {
  it('a dry run reports what it would create and writes nothing', async () => {
    const result = await seedExistingOrg(testDb(), ORG, NOW, { apply: false })
    expect(result).toEqual({ created: ['system_zus', 'system_us'], skipped: [] })
    expect(await ids(`organizations/${ORG}/counterparties`)).toEqual([])
  })

  it('applies, and a second run creates nothing', async () => {
    expect((await seedExistingOrg(testDb(), ORG, NOW, { apply: true })).created).toEqual(['system_zus', 'system_us'])
    expect(await ids(`organizations/${ORG}/counterparties`)).toEqual(['system_us', 'system_zus'])
    expect(await auditActions(testDb(), ORG)).toEqual(['counterparty.create', 'counterparty.create'])

    const again = await seedExistingOrg(testDb(), ORG, NOW, { apply: true })
    expect(again).toEqual({ created: [], skipped: [{ id: 'system_zus', reason: 'exists' }, { id: 'system_us', reason: 'exists' }] })
    expect(await ids(`organizations/${ORG}/counterparties`)).toHaveLength(2)
  })

  it('does not bring back a system record the owner archived', async () => {
    await seedExistingOrg(testDb(), ORG, NOW, { apply: true })
    await testDb().doc(`organizations/${ORG}/counterparties/system_zus`).update({ archived: true })
    await seedExistingOrg(testDb(), ORG, NOW, { apply: true })
    expect((await readDoc(testDb(), `organizations/${ORG}/counterparties/system_zus`))?.archived).toBe(true)
  })

  it('skips a record whose name a user already took', async () => {
    await testDb().doc(`organizations/${ORG}/counterpartyKeys/name_zus`).set({ counterpartyId: 'user-made' })
    const result = await seedExistingOrg(testDb(), ORG, NOW, { apply: true })
    expect(result).toEqual({ created: ['system_us'], skipped: [{ id: 'system_zus', reason: 'name_taken' }] })
  })

  it('refuses a company that does not exist', async () => {
    await expect(seedExistingOrg(testDb(), 'nope', NOW, { apply: true })).rejects.toMatchObject({ code: 'not_found' })
  })
})
```

- [ ] **Step 2: Run, see it fail**

Run: `PATH="$HOME/.jre/temurin-21/bin:$PATH" npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts tests/integration/counterparties-seed.test.ts"`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement `seed.ts`**

Create `lib/server/counterparties/seed.ts`:

```ts
import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore'
import { counterpartyToDoc } from '@/lib/domain/counterparties/doc'
import { CounterpartyError } from '@/lib/domain/counterparties/errors'
import { nameKey } from '@/lib/domain/counterparties/normalize'
import { SYSTEM_COUNTERPARTIES, systemCounterparty } from '@/lib/domain/counterparties/system'
import { auditData } from '@/lib/server/ledger/audit'
import { auditCol, counterpartiesCol, counterpartyKeysCol, orgRef } from '@/lib/server/ledger/paths'

/** For a company being created: nothing exists yet, so the records and their name keys are simply created. */
export function seedSystemCounterparties(t: Transaction, db: Firestore, orgId: string, now: Date): void {
  const ts = Timestamp.fromDate(now)
  for (const spec of SYSTEM_COUNTERPARTIES) {
    t.create(counterpartiesCol(db, orgId).doc(spec.id), { ...counterpartyToDoc(systemCounterparty(spec)), orgId, createdAt: ts, updatedAt: ts })
    t.create(counterpartyKeysCol(db, orgId).doc(nameKey(spec.name)), { counterpartyId: spec.id })
  }
}

export interface SeedResult {
  created: string[]
  skipped: Array<{ id: string; reason: 'exists' | 'name_taken' }>
}

/**
 * Adds the system records a company does not have yet. Records are found by their fixed id (so an archived one is
 * not brought back and a rename is not mistaken for a missing record); a record whose name a user already took is
 * skipped. With `apply: false` nothing is written.
 */
export async function seedExistingOrg(db: Firestore, orgId: string, now: Date, options: { apply: boolean }): Promise<SeedResult> {
  return db.runTransaction(async (t) => {
    const org = await t.get(orgRef(db, orgId))
    const reads = await Promise.all(
      SYSTEM_COUNTERPARTIES.map(async (spec) => ({
        spec,
        doc: await t.get(counterpartiesCol(db, orgId).doc(spec.id)),
        key: await t.get(counterpartyKeysCol(db, orgId).doc(nameKey(spec.name))),
      })),
    )
    if (!org.exists) throw new CounterpartyError('not_found')

    const result: SeedResult = { created: [], skipped: [] }
    const ts = Timestamp.fromDate(now)
    for (const { spec, doc, key } of reads) {
      if (doc.exists) result.skipped.push({ id: spec.id, reason: 'exists' })
      else if (key.exists) result.skipped.push({ id: spec.id, reason: 'name_taken' })
      else {
        result.created.push(spec.id)
        if (options.apply) {
          const c = systemCounterparty(spec)
          t.create(counterpartiesCol(db, orgId).doc(spec.id), { ...counterpartyToDoc(c), orgId, createdAt: ts, updatedAt: ts })
          t.create(counterpartyKeysCol(db, orgId).doc(nameKey(spec.name)), { counterpartyId: spec.id })
          t.create(auditCol(db, orgId).doc(), auditData({ now: () => now }, 'counterparty.create', 'system', spec.id, null, counterpartyToDoc(c)))
        }
      }
    }
    return result
  })
}
```

- [ ] **Step 4: Run, see it pass**

Run the same emulator command as Step 2. Expected: all pass.

- [ ] **Step 5: Seed new companies (modify `lib/server/orgs.ts`)**

Add the import `import { seedSystemCounterparties } from '@/lib/server/counterparties/seed'` and, inside the `createOrganizationForUser` transaction right after `tx.create(memberRef, ...)`, add:

```ts
    seedSystemCounterparties(tx, db, orgRef.id, now)
```

- [ ] **Step 6: Teach the fake Admin about other documents and test the seeding in `orgs.test.ts`**

In `tests/unit/helpers/fake-admin.ts`: add `export const fakeOtherDocs = new Map<string, Record<string, unknown>>()`; in `readPath` return `fakeOtherDocs.get(path)` for any path that is not an org or a member path; in `writePath` replace the final `else throw ...` with `else fakeOtherDocs.set(path, data)`; clear `fakeOtherDocs` in `resetFakeAdmin()`.

In `tests/unit/server/orgs.test.ts` add (using that file's existing helpers for calling `createOrganizationForUser` with a uid and input; read the file first and match its style):
- a test that a successful create leaves exactly the paths `organizations/<id>/counterparties/system_zus`, `.../system_us`, `.../counterpartyKeys/name_zus`, `.../counterpartyKeys/name_urzad_skarbowy` in `fakeOtherDocs`;
- a test (using `fakeTxFault.failOnCreatePathIncludes = '/counterparties/'`) that when the seeding write fails, neither the organization nor the membership is left behind (the transaction is atomic).

- [ ] **Step 7: Script argument parser (test first)**

Create `tests/unit/scripts/seed-counterparties-args.test.ts`:

```ts
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
```

Create `scripts/lib/seed-counterparties-args.ts`:

```ts
// Argument parsing for scripts/seed-counterparties.ts. Pure: unit-tested in Vitest.

export interface SeedArgs {
  apply: boolean
  /** Limit the run to one company. */
  org?: string
  /** Every argument as given, for the production flag check (`--project=...`). */
  raw: string[]
}

export type ParsedSeedArgs = { ok: true; args: SeedArgs } | { ok: false; message: string }

export function parseSeedArgs(argv: readonly string[]): ParsedSeedArgs {
  const args: SeedArgs = { apply: false, org: undefined, raw: [...argv] }
  for (const arg of argv) {
    if (arg === '--apply') args.apply = true
    else if (arg.startsWith('--project=')) continue
    else if (arg.startsWith('--org=')) {
      const org = arg.slice('--org='.length)
      if (org === '' || org.includes('/')) return { ok: false, message: '--org needs a company id.' }
      args.org = org
    } else return { ok: false, message: `Unknown argument ${arg.split('=')[0]}.` }
  }
  return { ok: true, args }
}
```

If the `@/scripts/...` alias does not resolve in Vitest (the alias `@` is the repo root, so it does), keep it; the existing tests in `tests/unit/scripts/` show the import style, follow them.

- [ ] **Step 8: The script**

Create `scripts/seed-counterparties.ts`:

```ts
// Adds the system counterparties (ZUS, Urząd Skarbowy) to companies that do not have them (S06).
//   npm run seed:counterparties                                         dry run over every company
//   npm run seed:counterparties -- --apply --project=finflow-e94b5      writes (production needs the project flag)
//   --org=<id> limits the run to one company.
// Idempotent: records are found by their fixed ids; archived ones are not brought back. The flag check runs
// before credentials are read or anything is contacted. With FIRESTORE_EMULATOR_HOST set it uses the emulator.
import fs from 'node:fs'
import path from 'node:path'
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { seedExistingOrg } from '@/lib/server/counterparties/seed'
import { assertProductionFlags } from './lib/migration-guard.mjs'
import { parseSeedArgs } from './lib/seed-counterparties-args'

const PROJECT_ID = 'finflow-e94b5'
const EMULATOR_PROJECT_ID = 'demo-finflow'

function fail(message: string, code: number): never {
  console.error(message)
  process.exit(code)
}

function credential() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return applicationDefault()
  const dir = path.resolve('.secrets')
  const file = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => /^finflow-.*-firebase-adminsdk-.*\.json$/.test(f)) : undefined
  if (!file) fail('No credentials: set GOOGLE_APPLICATION_CREDENTIALS or put the service-account JSON in .secrets/.', 2)
  return cert(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')))
}

async function main(): Promise<number> {
  const parsed = parseSeedArgs(process.argv.slice(2))
  if (!parsed.ok) fail(parsed.message, 2)
  const { apply, org, raw } = parsed.args

  const flagCheck = assertProductionFlags({ emulator: !!process.env.FIRESTORE_EMULATOR_HOST, apply, drop: false, args: raw })
  if (!flagCheck.ok) fail(flagCheck.message, flagCheck.exitCode)

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({ projectId: EMULATOR_PROJECT_ID })
    console.log(`target: Firestore EMULATOR (project ${EMULATOR_PROJECT_ID})`)
  } else {
    initializeApp({ credential: credential(), projectId: PROJECT_ID })
    console.log(`target: PRODUCTION (project ${PROJECT_ID})`)
  }
  const db = getFirestore()

  const orgIds = org ? [org] : (await db.collection('organizations').select().get()).docs.map((d) => d.id)
  console.log(`companies: ${orgIds.length}`)

  const failed: string[] = []
  let created = 0
  for (const orgId of orgIds) {
    try {
      const result = await seedExistingOrg(db, orgId, new Date(), { apply })
      created += result.created.length
      const taken = result.skipped.filter((s) => s.reason === 'name_taken').map((s) => s.id)
      if (result.created.length > 0 || taken.length > 0) {
        console.log(`org ${orgId}: ${apply ? 'created' : 'would create'} [${result.created.join(', ')}]${taken.length > 0 ? ` name taken: [${taken.join(', ')}]` : ''}`)
      }
    } catch (e) {
      console.error(`org ${orgId}: FAILED (${e instanceof Error ? e.message : 'error'})`)
      failed.push(orgId)
    }
  }
  console.log(`${apply ? 'created' : 'would create'} ${created} record(s) in ${orgIds.length - failed.length} company(ies)`)
  if (failed.length > 0) {
    console.error(`failed companies (${failed.length}): ${failed.join(', ')}`)
    return 1
  }
  if (!apply) console.log('DRY RUN: nothing written. Re-run with --apply to seed.')
  return 0
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`FAILED (${e instanceof Error ? e.message : 'error'})`)
    process.exit(1)
  },
)
```

In `package.json` scripts add (next to `migrate:ledger`):

```json
    "seed:counterparties": "node --conditions=react-server --import tsx scripts/seed-counterparties.ts",
```

- [ ] **Step 9: Verify the script on the emulator**

```bash
PATH="$HOME/.jre/temurin-21/bin:$PATH" npx firebase emulators:exec --only firestore --project demo-finflow "npm run seed:counterparties"
```

Expected: `target: Firestore EMULATOR`, `companies: 0`, `would create 0 record(s)`, `DRY RUN`, exit 0.

- [ ] **Step 10: Run all unit and integration tests, typecheck, lint, commit**

```bash
npx vitest run
PATH="$HOME/.jre/temurin-21/bin:$PATH" npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts"
npx tsc --noEmit
npx eslint .
git add -A
git commit -m "feat(counterparties): system records for new and existing companies

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Service wiring and the three routes

**Files:**
- Create: `lib/server/counterparties/index.ts`, `app/api/orgs/[orgId]/counterparties/route.ts`, `app/api/orgs/[orgId]/counterparties/[counterpartyId]/route.ts`, `app/api/orgs/[orgId]/counterparties/lookup/route.ts`
- Test: `tests/unit/api/counterparties/routes.test.ts`

- [ ] **Step 1: Write the failing route tests**

Create `tests/unit/api/counterparties/routes.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CounterpartyError } from '@/lib/domain/counterparties/errors'
import { HttpError } from '@/lib/server/http-error'
import { counterparties } from '@/lib/server/counterparties'
import { resetFakeAdmin } from '@/tests/unit/helpers/fake-admin'
import { POST as postCounterparty } from '@/app/api/orgs/[orgId]/counterparties/route'
import { PATCH as patchCounterparty } from '@/app/api/orgs/[orgId]/counterparties/[counterpartyId]/route'
import { GET as lookup } from '@/app/api/orgs/[orgId]/counterparties/lookup/route'

vi.mock('@/lib/server/firebase-admin', async () => {
  const { fakeAdmin: admin } = await import('@/tests/unit/helpers/fake-admin')
  return { getAdmin: () => admin }
})
vi.mock('@/lib/server/counterparties', () => ({
  counterparties: { create: vi.fn(), update: vi.fn(), lookup: vi.fn() },
}))

const NRB = '61109010140000071219812874'
const CP = { id: 'c1', name: 'Acme', ibans: [], archived: false }

function req(method: string, path: string, body?: unknown, token: string | null = 'token-alice'): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }
  if (token) headers.Cookie = `__session=${token}`
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
}
const ctx = <T extends Record<string, string> = Record<never, never>>(extra?: T) => ({
  params: Promise.resolve({ orgId: 'org-acme', ...extra } as { orgId: string } & T),
})

type Call = { name: string; mock: keyof typeof counterparties; call: (token: string | null) => Promise<Response> }

const ROUTES: Call[] = [
  { name: 'post', mock: 'create', call: (t) => postCounterparty(req('POST', '/api/orgs/org-acme/counterparties', { name: 'Acme' }, t), ctx()) },
  { name: 'patch', mock: 'update', call: (t) => patchCounterparty(req('PATCH', '/api/orgs/org-acme/counterparties/c1', { archived: true }, t), ctx({ counterpartyId: 'c1' })) },
  { name: 'lookup', mock: 'lookup', call: (t) => lookup(req('GET', '/api/orgs/org-acme/counterparties/lookup?nip=7740001454', undefined, t), ctx()) },
]

beforeEach(() => {
  resetFakeAdmin()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const fn of Object.values(counterparties)) vi.mocked(fn).mockReset()
})

describe('authorization of every counterparty route', () => {
  describe.each(ROUTES)('$name', ({ mock, call }) => {
    it('answers 401 without a session', async () => {
      expect((await call(null)).status).toBe(401)
      expect(counterparties[mock]).not.toHaveBeenCalled()
    })

    it('answers 403 to a user who is not a member', async () => {
      expect((await call('token-mallory')).status).toBe(403)
      expect(counterparties[mock]).not.toHaveBeenCalled()
    })

    it('answers 403 to a viewer', async () => {
      expect((await call('token-dave')).status).toBe(403)
      expect(counterparties[mock]).not.toHaveBeenCalled()
    })
  })
})

describe('POST /counterparties', () => {
  it.each([
    ['alice', 'user-alice'],
    ['carol', 'user-carol'],
  ])('creates for %s with 201 and passes the parsed input', async (name, uid) => {
    vi.mocked(counterparties.create).mockResolvedValue(CP as never)
    const res = await postCounterparty(
      req('POST', '/api/orgs/org-acme/counterparties', { name: ' Acme ', nip: '774-000-14-54', ibans: ['PL61 1090 1014 0000 0712 1981 2874'] }, `token-${name}`),
      ctx(),
    )
    expect(res.status).toBe(201)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ counterparty: CP })
    expect(counterparties.create).toHaveBeenCalledWith('org-acme', uid, { name: 'Acme', nip: '7740001454', ibans: [NRB] })
  })

  it('answers 400 with the field for an invalid NIP and does not call the service', async () => {
    const res = await postCounterparty(req('POST', '/api/orgs/org-acme/counterparties', { name: 'A', nip: '123' }), ctx())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ field: 'nip', error: 'invalid_input' })
    expect(counterparties.create).not.toHaveBeenCalled()
  })

  it('answers 409 duplicate with the field and the existing id', async () => {
    vi.mocked(counterparties.create).mockRejectedValue(new CounterpartyError('duplicate', { field: 'nip', existingId: 'c9' }))
    const res = await postCounterparty(req('POST', '/api/orgs/org-acme/counterparties', { name: 'A', nip: '7740001454' }), ctx())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ field: 'nip', existingId: 'c9', error: 'duplicate' })
  })

  it('answers 413 for a body over 4 KB and 400 invalid_body for text that is not JSON', async () => {
    expect((await postCounterparty(req('POST', '/api/orgs/org-acme/counterparties', JSON.stringify({ name: 'x'.repeat(5000) })), ctx())).status).toBe(413)
    const res = await postCounterparty(req('POST', '/api/orgs/org-acme/counterparties', '{nope'), ctx())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_body' })
  })
})

describe('PATCH /counterparties/{id}', () => {
  it('passes the parsed patch and answers 200', async () => {
    vi.mocked(counterparties.update).mockResolvedValue({ ...CP, archived: true } as never)
    const res = await patchCounterparty(req('PATCH', '/api/orgs/org-acme/counterparties/c1', { archived: true, nip: null }), ctx({ counterpartyId: 'c1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ counterparty: { ...CP, archived: true } })
    expect(counterparties.update).toHaveBeenCalledWith('org-acme', 'user-alice', 'c1', { archived: true, nip: null })
  })

  it('answers 404 for an id that is not a safe document id', async () => {
    const res = await patchCounterparty(req('PATCH', '/api/orgs/org-acme/counterparties/a.b', { archived: true }), ctx({ counterpartyId: 'a.b' }))
    expect(res.status).toBe(404)
    expect(counterparties.update).not.toHaveBeenCalled()
  })

  it('answers 400 for an empty patch and for a field it does not know', async () => {
    expect((await patchCounterparty(req('PATCH', '/api/orgs/org-acme/counterparties/c1', {}), ctx({ counterpartyId: 'c1' }))).status).toBe(400)
    const res = await patchCounterparty(req('PATCH', '/api/orgs/org-acme/counterparties/c1', { kind: 'zus' }), ctx({ counterpartyId: 'c1' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ field: 'kind', error: 'invalid_input' })
  })

  it('answers 404 when the service says the counterparty is gone', async () => {
    vi.mocked(counterparties.update).mockRejectedValue(new CounterpartyError('not_found'))
    const res = await patchCounterparty(req('PATCH', '/api/orgs/org-acme/counterparties/c1', { archived: true }), ctx({ counterpartyId: 'c1' }))
    expect(res.status).toBe(404)
  })
})

describe('GET /counterparties/lookup', () => {
  const ANSWER = { found: true, name: 'ORLEN', vatStatus: 'active', ibans: [NRB], checkedOn: '2026-10-27' }

  it('looks the normalised NIP up for the caller and answers 200 with no-store', async () => {
    vi.mocked(counterparties.lookup).mockResolvedValue(ANSWER as never)
    const res = await lookup(req('GET', '/api/orgs/org-acme/counterparties/lookup?nip=PL%20774-000-14-54'), ctx())
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual(ANSWER)
    expect(counterparties.lookup).toHaveBeenCalledWith('user-alice', '7740001454')
  })

  it.each([
    ['/api/orgs/org-acme/counterparties/lookup', 'nothing'],
    ['/api/orgs/org-acme/counterparties/lookup?nip=123', 'a bad NIP'],
    ['/api/orgs/org-acme/counterparties/lookup?nip=7740001454&x=1', 'an extra parameter'],
    ['/api/orgs/org-acme/counterparties/lookup?nip=7740001454&nip=7740001454', 'a repeated parameter'],
  ])('answers 400 for %s', async (path) => {
    const res = await lookup(req('GET', path), ctx())
    expect(res.status).toBe(400)
    expect(counterparties.lookup).not.toHaveBeenCalled()
  })

  it('answers 429 when the caller is over the limit', async () => {
    vi.mocked(counterparties.lookup).mockRejectedValue(new HttpError(429, 'rate_limited'))
    const res = await lookup(req('GET', '/api/orgs/org-acme/counterparties/lookup?nip=7740001454'), ctx())
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate_limited' })
  })

  it('answers 502 when the white list cannot be reached', async () => {
    vi.mocked(counterparties.lookup).mockRejectedValue(new CounterpartyError('lookup_unavailable'))
    const res = await lookup(req('GET', '/api/orgs/org-acme/counterparties/lookup?nip=7740001454'), ctx())
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'lookup_unavailable' })
  })
})
```

- [ ] **Step 2: Run, see it fail**

Run: `npx vitest run tests/unit/api/counterparties`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement the service**

Create `lib/server/counterparties/index.ts`:

```ts
import 'server-only'
import type { CounterpartyInput, CounterpartyPatch } from '@/lib/domain/counterparties/input'
import type { VatStatus } from '@/lib/domain/counterparties/types'
import { toDay } from '@/lib/domain/ledger/days'
import { getAdmin } from '@/lib/server/firebase-admin'
import { enforceRateLimit, LOOKUP_LIMITS } from '@/lib/server/rate-limit-guard'
import { todayUtcDay } from '@/lib/utils/today'
import type { CounterpartyDeps } from './deps'
import { lookupNip } from './whitelist'
import { createCounterparty, updateCounterparty } from './write'

export interface LookupAnswer {
  found: boolean
  name?: string
  address?: string
  vatStatus?: VatStatus
  ibans: string[]
  /** The Warsaw day the white list was asked. */
  checkedOn: string
}

function deps(): CounterpartyDeps {
  const today = () => toDay(todayUtcDay())
  return { db: getAdmin().db, now: () => new Date(), today, lookup: (nip) => lookupNip(nip, today()) }
}

/** The counterparties service bound to production Firestore, the MF white list and the Warsaw clock. */
export const counterparties = {
  create: (orgId: string, uid: string, input: CounterpartyInput) => createCounterparty(deps(), orgId, uid, input),
  update: (orgId: string, uid: string, id: string, patch: CounterpartyPatch) => updateCounterparty(deps(), orgId, uid, id, patch),
  /** Counts against the caller's lookup limit, asks the white list and answers what it found (nothing is saved). */
  lookup: async (uid: string, nip: string): Promise<LookupAnswer> => {
    await enforceRateLimit(uid, 'lookup', LOOKUP_LIMITS)
    const d = deps()
    const checkedOn = d.today()
    const result = await d.lookup(nip)
    if (!result.found) return { found: false, ibans: [], checkedOn }
    const { name, address, vatStatus, ibans } = result.subject
    return { found: true, name, ...(address === undefined ? {} : { address }), vatStatus, ibans, checkedOn }
  },
}
```

- [ ] **Step 4: Implement the routes**

Create `app/api/orgs/[orgId]/counterparties/route.ts`:

```ts
import { parseCounterpartyInput } from '@/lib/domain/counterparties/input'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { counterparties } from '@/lib/server/counterparties'
import { toCounterpartyHttpError } from '@/lib/server/counterparties/http'
import { errorResponse } from '@/lib/server/http-error'
import { readJsonBody } from '@/lib/server/request-body'

export const runtime = 'nodejs'

const MAX_BODY_BYTES = 4096
type Ctx = { params: Promise<{ orgId: string }> }

// POST /api/orgs/{orgId}/counterparties  (owner, accountant)
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    const input = parseCounterpartyInput(await readJsonBody(req, MAX_BODY_BYTES))
    const counterparty = await counterparties.create(orgId, uid, input)
    return Response.json({ counterparty }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toCounterpartyHttpError(e))
  }
}
```

Create `app/api/orgs/[orgId]/counterparties/[counterpartyId]/route.ts`:

```ts
import { parseCounterpartyPatch } from '@/lib/domain/counterparties/input'
import { isId } from '@/lib/domain/ledger/guards'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { counterparties } from '@/lib/server/counterparties'
import { toCounterpartyHttpError } from '@/lib/server/counterparties/http'
import { errorResponse, HttpError } from '@/lib/server/http-error'
import { readJsonBody } from '@/lib/server/request-body'

export const runtime = 'nodejs'

const MAX_BODY_BYTES = 4096
type Ctx = { params: Promise<{ orgId: string; counterpartyId: string }> }

// PATCH /api/orgs/{orgId}/counterparties/{counterpartyId}  (owner, accountant)
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId, counterpartyId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    if (!isId(counterpartyId)) throw new HttpError(404, 'not_found')
    const patch = parseCounterpartyPatch(await readJsonBody(req, MAX_BODY_BYTES))
    const counterparty = await counterparties.update(orgId, uid, counterpartyId, patch)
    return Response.json({ counterparty }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toCounterpartyHttpError(e))
  }
}
```

Create `app/api/orgs/[orgId]/counterparties/lookup/route.ts`:

```ts
import { CounterpartyError } from '@/lib/domain/counterparties/errors'
import { normalizeNip } from '@/lib/domain/counterparties/normalize'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { counterparties } from '@/lib/server/counterparties'
import { toCounterpartyHttpError } from '@/lib/server/counterparties/http'
import { errorResponse } from '@/lib/server/http-error'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string }> }

// GET /api/orgs/{orgId}/counterparties/lookup?nip=7740001454  (owner, accountant)
// What the MF white list knows about a NIP, for filling the counterparty form. Saves nothing.
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])

    const query = new URL(req.url).searchParams
    const keys = [...query.keys()]
    if (keys.length !== 1 || keys[0] !== 'nip' || query.getAll('nip').length !== 1) {
      throw new CounterpartyError('invalid_input', { field: 'nip' })
    }
    const nip = normalizeNip(query.get('nip'))

    const answer = await counterparties.lookup(uid, nip)
    return Response.json(answer, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toCounterpartyHttpError(e))
  }
}
```

- [ ] **Step 5: Run, see them pass; also run the route coverage check; typecheck; lint; commit**

```bash
npx vitest run tests/unit/api tests/unit/server
npx tsc --noEmit
npx eslint app lib
git add app lib tests
git commit -m "feat(counterparties): service and routes (create, update, white list lookup)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: `route-auth-coverage` passes (each handler awaits `requireUser(`).

---

### Task 11: Rate limit on `/api/rates`

**Files:**
- Modify: `app/api/rates/route.ts`
- Test: `tests/unit/api/rates.test.ts` (add)

- [ ] **Step 1: Write the failing test**

In `tests/unit/api/rates.test.ts` add a mock next to the existing `vi.mock` calls:

```ts
vi.mock('@/lib/server/rate-limit-guard', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/rate-limit-guard')>('@/lib/server/rate-limit-guard')
  return { ...actual, enforceRateLimit: vi.fn(async () => {}) }
})
```

add the imports `import { HttpError } from '@/lib/server/http-error'` and `import { enforceRateLimit, RATES_LIMITS } from '@/lib/server/rate-limit-guard'`, and inside the existing `describe('GET /api/rates', ...)` add (the file's `beforeEach` already calls `vi.restoreAllMocks`-style resets; add `vi.mocked(enforceRateLimit).mockReset().mockResolvedValue(undefined)` to its `beforeEach`):

```ts
  it('counts a valid request against the caller rates limit', async () => {
    const res = await GET(req('?from=EUR&to=PLN&date=2026-10-27'))
    expect(res.status).toBe(200)
    expect(enforceRateLimit).toHaveBeenCalledWith('user-alice', 'rates', RATES_LIMITS)
  })

  it('answers 429 when the caller is over the limit and asks NBP nothing', async () => {
    vi.mocked(enforceRateLimit).mockRejectedValue(new HttpError(429, 'rate_limited'))
    const res = await GET(req('?from=EUR&to=PLN&date=2026-10-27'))
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate_limited' })
    expect(resolveRate).not.toHaveBeenCalled()
  })

  it('does not count a request with bad parameters', async () => {
    expect((await GET(req('?from=EUR'))).status).toBe(400)
    expect(enforceRateLimit).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run, see it fail**

Run: `npx vitest run tests/unit/api/rates.test.ts`
Expected: FAIL (the guard is never called).

- [ ] **Step 3: Implement**

In `app/api/rates/route.ts`: import `import { enforceRateLimit, RATES_LIMITS } from '@/lib/server/rate-limit-guard'`; change `await requireUser(req)` to `const { uid } = await requireUser(req)`; after the parameter validation (after the `isCurrencyCode ... throw new HttpError(400, 'invalid_params')` block) and before `resolveRate`, add:

```ts
    await enforceRateLimit(uid, 'rates', RATES_LIMITS)
```

(`errorResponse` already turns the `HttpError(429)` into `{ error: 'rate_limited' }`; the `FxError` branch in the `catch` is unchanged.)

- [ ] **Step 4: Run, typecheck, commit**

```bash
npx vitest run tests/unit/api
npx tsc --noEmit
git add app/api/rates tests/unit/api/rates.test.ts
git commit -m "feat(rates): per-user rate limit on /api/rates

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The ledger checks that a counterparty exists

**Files:**
- Modify: `lib/domain/ledger/errors.ts`, `lib/server/ledger/http.ts`, `lib/server/ledger/write.ts`
- Modify (tests): `tests/integration/helpers.ts`, `tests/unit/server/ledger-http.test.ts`
- Test: `tests/integration/ledger-counterparty.test.ts`

- [ ] **Step 1: Add a seeding helper to `tests/integration/helpers.ts`**

Add the import `import { counterpartyToDoc } from '@/lib/domain/counterparties/doc'` and:

```ts
export async function seedCounterparty(db: Firestore, orgId: string, id: string, options: { archived?: boolean } = {}): Promise<void> {
  const doc = counterpartyToDoc({ id, name: id, ibans: [], archived: options.archived === true })
  await db.doc(`organizations/${orgId}/counterparties/${id}`).set({ ...doc, orgId })
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/integration/ledger-counterparty.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransactionInput, parseTransactionPatch } from '@/lib/domain/ledger/input'
import { createTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { ORG, UID, balanceOf, clearFirestore, makeDeps, readDoc, seedAccount, seedCounterparty, seedOrg, testDb } from './helpers'

const db = testDb()
const deps = makeDeps(db)

const expense = (extra: Record<string, unknown> = {}) =>
  parseTransactionInput({ type: 'expense', accountId: 'a1', amountMinor: 1000, paymentDate: '2026-10-20', ...extra })

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : `other:${String(e)}`
  }
  return 'none'
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'a1', 'PLN', 5000)
})

describe('counterparty on an operation', () => {
  it('is stored when the counterparty exists', async () => {
    await seedCounterparty(db, ORG, 'c1')
    const { transaction } = await createTransaction(deps, ORG, UID, expense({ counterpartyId: 'c1' }))
    expect((await readDoc(db, `organizations/${ORG}/transactions/${transaction.id}`))?.counterpartyId).toBe('c1')
  })

  it('an unknown counterparty is refused and nothing is written', async () => {
    expect(await code(createTransaction(deps, ORG, UID, expense({ counterpartyId: 'ghost' })))).toBe('counterparty_not_found:counterpartyId')
    expect((await db.collection(`organizations/${ORG}/transactions`).get()).size).toBe(0)
    expect(await balanceOf(db, ORG, 'a1')).toBe(5000)
  })

  it('an archived counterparty cannot be given to a new operation', async () => {
    await seedCounterparty(db, ORG, 'old', { archived: true })
    expect(await code(createTransaction(deps, ORG, UID, expense({ counterpartyId: 'old' })))).toBe('counterparty_archived:counterpartyId')
  })

  it('an edit that switches to an unknown or archived counterparty is refused and leaves the operation as it was', async () => {
    await seedCounterparty(db, ORG, 'c1')
    await seedCounterparty(db, ORG, 'old', { archived: true })
    const { transaction } = await createTransaction(deps, ORG, UID, expense({ counterpartyId: 'c1' }))
    const current = async () => (await readDoc(db, `organizations/${ORG}/transactions/${transaction.id}`))?.counterpartyId
    expect(await code(updateTransaction(deps, ORG, UID, transaction.id, parseTransactionPatch({ counterpartyId: 'ghost' })))).toBe('counterparty_not_found:counterpartyId')
    expect(await code(updateTransaction(deps, ORG, UID, transaction.id, parseTransactionPatch({ counterpartyId: 'old' })))).toBe('counterparty_archived:counterpartyId')
    expect(await current()).toBe('c1')
  })

  it('an edit of something else does not re-check a counterparty that was archived since', async () => {
    await seedCounterparty(db, ORG, 'c1')
    const { transaction } = await createTransaction(deps, ORG, UID, expense({ counterpartyId: 'c1' }))
    await db.doc(`organizations/${ORG}/counterparties/c1`).update({ archived: true })
    await updateTransaction(deps, ORG, UID, transaction.id, parseTransactionPatch({ description: 'still fine' }))
    expect(await readDoc(db, `organizations/${ORG}/transactions/${transaction.id}`)).toMatchObject({ counterpartyId: 'c1', description: 'still fine' })
  })

  it('an edit may clear the counterparty', async () => {
    await seedCounterparty(db, ORG, 'c1')
    const { transaction } = await createTransaction(deps, ORG, UID, expense({ counterpartyId: 'c1' }))
    await updateTransaction(deps, ORG, UID, transaction.id, parseTransactionPatch({ counterpartyId: null }))
    expect((await readDoc(db, `organizations/${ORG}/transactions/${transaction.id}`))?.counterpartyId).toBeUndefined()
  })
})
```

In `tests/unit/server/ledger-http.test.ts` add (matching that file's style) cases that `LedgerError('counterparty_not_found')` and `LedgerError('counterparty_archived')` map to an `HttpError` with status 422 and the code as the message.

- [ ] **Step 3: Run, see it fail**

Run: `PATH="$HOME/.jre/temurin-21/bin:$PATH" npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts tests/integration/ledger-counterparty.test.ts"`
Expected: FAIL (unknown counterparty is stored; the type of the error code does not exist yet).

- [ ] **Step 4: Implement**

In `lib/domain/ledger/errors.ts` add `| 'counterparty_not_found'` and `| 'counterparty_archived'` to `LedgerErrorCode` (after `'category_not_found'`).

In `lib/server/ledger/http.ts` add to `LEDGER_STATUS`:

```ts
  counterparty_not_found: 422,
  counterparty_archived: 422,
```

In `lib/server/ledger/write.ts`: import `counterpartiesCol` from `./paths` (add to the existing import list). In `commit`, after the `categorySnap` line add:

```ts
    // A counterparty is checked only when this write gives the operation a new one: an edit of something else
    // must not fail because the counterparty was archived after the operation was made.
    const counterpartyId = job.next?.tx.counterpartyId
    const counterpartyIsNew = counterpartyId !== undefined && counterpartyId !== job.prior?.tx.counterpartyId
    const counterpartySnap = counterpartyId !== undefined && counterpartyIsNew ? await t.get(counterpartiesCol(db, orgId).doc(counterpartyId)) : null
```

and after the category check (`if (categorySnap !== null && job.next) { ... }`) add:

```ts
    if (counterpartySnap !== null) {
      if (!counterpartySnap.exists) throw new LedgerError('counterparty_not_found', 'counterpartyId')
      if (counterpartySnap.get('archived') === true) throw new LedgerError('counterparty_archived', 'counterpartyId')
    }
```

(The block of reads stays before every write, as the file's comments require; the replayed-create early return stays before these checks.)

- [ ] **Step 5: Run the whole integration suite and unit tests; typecheck; commit**

```bash
PATH="$HOME/.jre/temurin-21/bin:$PATH" npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts"
npx vitest run
npx tsc --noEmit
git add lib tests
git commit -m "feat(ledger): an operation's counterparty must exist and, when new to it, not be archived

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: all green. If an existing e2e or integration test creates an operation with a `counterpartyId` that has no document, it now fails: fix the test by seeding the counterparty (`seedCounterparty`), do not weaken the check. (A grep before this task found `counterpartyId` only in migration and mapping tests, which write documents directly and are unaffected.)

---

### Task 13: Firestore rules and rules tests

**Files:**
- Modify: `firestore.rules`
- Test: `tests/rules/firestore.rules.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/rules/firestore.rules.test.ts`:

1. Add `'counterparties'` to the three constants (`SERVER_WRITTEN_SUBS`, `MEMBER_READ_SUBS`, `ALL_SUBS`), so the generic tests also cover it: every member reads, nobody writes, outsiders cannot read.
2. In the `does not open other collection groups` list add `'counterparties'` and `'counterpartyKeys'`.
3. Add a new `describe` (in the file's existing style, using its `as`, `anon`, `assertFails`, `assertSucceeds`, `testEnv.withSecurityRulesDisabled`) named `counterparty keys and rate limits are closed to every client`:

```ts
describe('counterparty keys and rate limits are closed to every client', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(fs(ctx), 'organizations/orgA/counterpartyKeys/name_acme'), { counterpartyId: 'c1' })
      await setDoc(doc(fs(ctx), 'rateLimits/lookup_alice_m_1'), { count: 1 })
    })
  })

  it.each(['alice', 'carol', 'dave', 'erin'])('%s cannot read or write a counterparty key', async (uid) => {
    const key = doc(as(uid), 'organizations/orgA/counterpartyKeys/name_acme')
    await assertFails(getDoc(key))
    await assertFails(getDocs(collection(as(uid), 'organizations/orgA/counterpartyKeys')))
    await assertFails(setDoc(doc(as(uid), 'organizations/orgA/counterpartyKeys/name_new'), { counterpartyId: 'c2' }))
    await assertFails(updateDoc(key, { counterpartyId: 'c2' }))
    await assertFails(deleteDoc(key))
  })

  it.each(['alice', 'carol', 'dave', 'erin'])('%s cannot read or write a rate-limit counter', async (uid) => {
    const counter = doc(as(uid), 'rateLimits/lookup_alice_m_1')
    await assertFails(getDoc(counter))
    await assertFails(setDoc(doc(as(uid), 'rateLimits/lookup_alice_m_2'), { count: 0 }))
    await assertFails(updateDoc(counter, { count: 0 }))
    await assertFails(deleteDoc(counter))
  })

  it('an anonymous caller cannot read them either', async () => {
    await assertFails(getDoc(doc(anon(), 'organizations/orgA/counterpartyKeys/name_acme')))
    await assertFails(getDoc(doc(anon(), 'rateLimits/lookup_alice_m_1')))
  })
})
```

- [ ] **Step 2: Run, see the first part fail**

Run: `PATH="$HOME/.jre/temurin-21/bin:$PATH" npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.rules.config.ts"`
Expected: the `counterparties: every member can read` cases FAIL (the rules do not list it yet); the key and rate-limit cases already pass because of the default deny.

- [ ] **Step 3: Update the rules**

In `firestore.rules`:
- In the header comment extend the data shape line to `organizations/{orgId}/{accounts|categories|transactions|rollups|audit|bankConnections|ledger|counterparties|counterpartyKeys}/{docId}` and the sentence below it to `Accounts, transactions, rollups, audit, ledger and counterparties are written by the server only (S05, S06); counterpartyKeys (uniqueness keys) and the root rateLimits are not readable or writable by clients at all.`
- In the subcollection `allow read` rule change the first list to `['accounts', 'categories', 'transactions', 'rollups', 'counterparties']`.
- Do not add any write rule for them (the existing `allow create, update` and `allow delete` already exclude them).

- [ ] **Step 4: Run, see it pass; commit**

```bash
PATH="$HOME/.jre/temurin-21/bin:$PATH" npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.rules.config.ts"
git add firestore.rules tests/rules
git commit -m "feat(rules): counterparties readable by members, written by the server only; keys and rate limits closed

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: all rules tests pass (the earlier count of 96 plus the new cases).

---

### Task 14: Client layer: API client, Firestore read, hook, settings section, messages

**Files:**
- Modify: `lib/api/ledger-client.ts`, `lib/shell/settings-sections.ts`, `messages/{pl,en,uk}.json`, `tests/unit/shell/settings-sections.test.ts`, `tests/unit/api/ledger-client.test.ts`, `tests/e2e/app-shell.spec.ts`
- Create: `lib/api/counterparty-client.ts`, `lib/firebase/counterparties.ts`, `lib/hooks/useCounterparties.tsx`
- Test: `tests/unit/api/counterparty-client.test.ts`

Deviation 6 (written into the spec in Task 18): the lookup fills the IBANs only when the white list returns between 1 and 20 accounts and the form has none (a large company such as Orlen has hundreds; the user types the account they pay to and the server marks it).

- [ ] **Step 1: Let the API client expose the error body**

In `lib/api/ledger-client.ts`:

1. Give `LedgerApiError` an optional third constructor argument:

```ts
export class LedgerApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    /** The whole JSON error body (`field`, `existingId`), when the server sent one. */
    public readonly details?: Record<string, unknown>,
  ) {
    super(code)
    this.name = 'LedgerApiError'
  }
}
```

2. In the private `call` function replace the error branch with:

```ts
  if (!res.ok) {
    let code = 'unknown'
    let details: Record<string, unknown> | undefined
    try {
      const json = (await res.json()) as Record<string, unknown>
      if (typeof json.error === 'string') code = json.error
      details = json
    } catch {
      // Not JSON: keep 'unknown'.
    }
    throw new LedgerApiError(res.status, code, details)
  }
```

3. At the end of the file add `export { call as apiCall }`.

In `tests/unit/api/ledger-client.test.ts` add a test (use the file's `fetchMock`, `json` helper and `vi.stubGlobal('fetch', fetchMock)` style) that a `409` reply `{ error: 'duplicate', field: 'nip', existingId: 'c1' }` makes `createTransaction` (or any exported call) reject with a `LedgerApiError` whose `code` is `duplicate` and whose `details` equal the whole body.

- [ ] **Step 2: Write the failing test for the counterparty client**

Create `tests/unit/api/counterparty-client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LedgerApiError } from '@/lib/api/ledger-client'
import { createCounterparty, duplicateOf, lookupNip, updateCounterparty } from '@/lib/api/counterparty-client'

const fetchMock = vi.fn()

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

describe('createCounterparty', () => {
  it('posts the draft without empty optional fields and returns the counterparty', async () => {
    vi.stubGlobal('fetch', fetchMock)
    const created = { id: 'c1', name: 'Acme', ibans: [], archived: false }
    fetchMock.mockResolvedValue(json(201, { counterparty: created }))
    expect(await createCounterparty('org 1', { name: 'Acme', ibans: [] })).toEqual(created)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/orgs/org%201/counterparties')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ name: 'Acme', ibans: [] })
  })

  it('includes the NIP and the address when given', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(json(201, { counterparty: {} }))
    await createCounterparty('o', { name: 'Acme', nip: '7740001454', ibans: ['61109010140000071219812874'], address: 'Płock' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: 'Acme', nip: '7740001454', ibans: ['61109010140000071219812874'], address: 'Płock' })
  })

  it('exposes which field is a duplicate and of whom', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(json(409, { error: 'duplicate', field: 'nip', existingId: 'c9' }))
    const error = await createCounterparty('o', { name: 'A', nip: '7740001454', ibans: [] }).catch((e) => e)
    expect(error).toBeInstanceOf(LedgerApiError)
    expect(duplicateOf(error)).toEqual({ field: 'nip', existingId: 'c9' })
  })
})

describe('duplicateOf', () => {
  it('is null for other errors', () => {
    expect(duplicateOf(new LedgerApiError(409, 'limit'))).toBeNull()
    expect(duplicateOf(new Error('x'))).toBeNull()
    expect(duplicateOf(new LedgerApiError(409, 'duplicate', { error: 'duplicate', field: 'other' }))).toBeNull()
  })

  it('reads a duplicate without an existing id', () => {
    expect(duplicateOf(new LedgerApiError(409, 'duplicate', { error: 'duplicate', field: 'name' }))).toEqual({ field: 'name', existingId: undefined })
  })
})

describe('updateCounterparty', () => {
  it('patches the given fields only', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(json(200, { counterparty: { id: 'c1' } }))
    await updateCounterparty('o', 'c/1', { archived: true, nip: null })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/orgs/o/counterparties/c%2F1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ archived: true, nip: null })
  })
})

describe('lookupNip', () => {
  it('asks for the NIP and returns the answer', async () => {
    vi.stubGlobal('fetch', fetchMock)
    const answer = { found: true, name: 'ORLEN', vatStatus: 'active', ibans: [], checkedOn: '2026-10-27' }
    fetchMock.mockResolvedValue(json(200, answer))
    expect(await lookupNip('o', '7740001454')).toEqual(answer)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/orgs/o/counterparties/lookup?nip=7740001454')
    expect(fetchMock.mock.calls[0][1].method).toBe('GET')
  })

  it('rejects with the server code', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValue(json(502, { error: 'lookup_unavailable' }))
    await expect(lookupNip('o', '7740001454')).rejects.toMatchObject({ status: 502, code: 'lookup_unavailable' })
  })
})
```

- [ ] **Step 3: Run, see it fail**

Run: `npx vitest run tests/unit/api/counterparty-client.test.ts tests/unit/api/ledger-client.test.ts`
Expected: FAIL (module missing; `details` missing).

- [ ] **Step 4: Implement the client**

Create `lib/api/counterparty-client.ts`:

```ts
import type { Counterparty, VatStatus } from '@/lib/domain/counterparties/types'
import { apiCall, LedgerApiError } from './ledger-client'

export interface CounterpartyDraft {
  name: string
  nip?: string
  /** Account numbers as typed or normalised; the server normalises them. */
  ibans: string[]
  address?: string
}

export interface CounterpartyPatchDraft {
  name?: string
  /** `null` clears it. */
  nip?: string | null
  ibans?: string[]
  /** `null` clears it. */
  address?: string | null
  archived?: boolean
}

export interface LookupResult {
  found: boolean
  name?: string
  address?: string
  vatStatus?: VatStatus
  ibans: string[]
  /** The Warsaw day the white list was asked. */
  checkedOn: string
}

const base = (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}/counterparties`

export async function createCounterparty(orgId: string, draft: CounterpartyDraft): Promise<Counterparty> {
  const body: Record<string, unknown> = { name: draft.name, ibans: draft.ibans }
  if (draft.nip !== undefined) body.nip = draft.nip
  if (draft.address !== undefined) body.address = draft.address
  const out = (await apiCall('POST', base(orgId), body)) as { counterparty: Counterparty }
  return out.counterparty
}

export async function updateCounterparty(orgId: string, id: string, patch: CounterpartyPatchDraft): Promise<Counterparty> {
  const out = (await apiCall('PATCH', `${base(orgId)}/${encodeURIComponent(id)}`, patch)) as { counterparty: Counterparty }
  return out.counterparty
}

/** What the MF white list says about a NIP (nothing is saved). Counts against the caller's lookup limit. */
export async function lookupNip(orgId: string, nip: string): Promise<LookupResult> {
  return (await apiCall('GET', `${base(orgId)}/lookup?nip=${encodeURIComponent(nip)}`)) as LookupResult
}

/** The field and the counterparty behind a `duplicate` answer, or null for any other error. */
export function duplicateOf(e: unknown): { field: 'nip' | 'name'; existingId: string | undefined } | null {
  if (!(e instanceof LedgerApiError) || e.code !== 'duplicate') return null
  const field = e.details?.field
  if (field !== 'nip' && field !== 'name') return null
  const existingId = e.details?.existingId
  return { field, existingId: typeof existingId === 'string' ? existingId : undefined }
}
```

- [ ] **Step 5: Read-only Firestore subscription and the hook**

Create `lib/firebase/counterparties.ts`:

```ts
import { collection, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import { parseCounterparty } from '@/lib/domain/counterparties/doc'
import type { Counterparty } from '@/lib/domain/counterparties/types'
import { db } from './firebase'

/** Counterparties are written by the server only (lib/api/counterparty-client.ts); the browser reads them here. */
export function getCounterparties(orgId: string, callback: (counterparties: Counterparty[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, 'organizations', orgId, 'counterparties'),
    (snap) => {
      const list: Counterparty[] = []
      let skipped = 0
      for (const d of snap.docs) {
        const c = parseCounterparty(d.id, d.data())
        if (c) list.push(c)
        else skipped++
      }
      if (skipped > 0) console.warn(`counterparties: skipped ${skipped} unreadable document(s) in ${orgId}`)
      callback(list)
    },
    (error) => {
      console.warn(`counterparties: cannot read ${orgId} (${error.code})`)
      callback([])
    },
  )
}
```

Create `lib/hooks/useCounterparties.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { getCounterparties } from '@/lib/firebase/counterparties'
import type { Counterparty } from '@/lib/domain/counterparties/types'

const EMPTY: Counterparty[] = []

export interface UseCounterpartiesResult {
  counterparties: Counterparty[]
  loading: boolean
}

export function useCounterparties(orgId: string | null): UseCounterpartiesResult {
  // Stored with its company, so a company switch never shows the previous company's list while the new
  // subscription waits for its first snapshot (same approach as useAccounts).
  const [snapshot, setSnapshot] = useState<{ orgId: string; list: Counterparty[] } | null>(null)

  useEffect(() => {
    if (!orgId) return
    return getCounterparties(orgId, (list) => setSnapshot({ orgId, list }))
  }, [orgId])

  const current = orgId !== null && snapshot?.orgId === orgId
  return { counterparties: current ? snapshot.list : EMPTY, loading: orgId !== null && !current }
}
```

- [ ] **Step 6: Settings section and tests**

In `lib/shell/settings-sections.ts`: `SettingsSection` gets `'counterparties'`, and `SETTINGS_SECTIONS` becomes `company, language, categories, counterparties, banks, subscription` (counterparties right after categories; every member may open it, like categories, so `REQUIRED_ACTION` is unchanged and the comment on `canOpenSection` lists it).

Update the tests that list sections:
- `tests/unit/shell/settings-sections.test.ts`: the order test (`['company', 'language', 'categories', 'counterparties', 'banks', 'subscription']`), add `['/org1/settings/counterparties', 'counterparties']` to the `activeSettingsSection` table, and the role tests (`owner` sees all six; `accountant` and `viewer` see `['company', 'language', 'categories', 'counterparties']`).
- `tests/e2e/app-shell.spec.ts` settings test: the expected link texts become `['Компанія', 'Мова', 'Категорії', 'Контрагенти', 'Банки', 'Підписка']` and the `sections` table gets `{ link: 'Контрагенти', path: 'counterparties', marker: page.getByRole('button', { name: 'Додати контрагента' }) }` between categories and banks; also change the test title "five sections" to "six sections".

- [ ] **Step 7: Messages (all three catalogs, same keys)**

In each of `messages/pl.json`, `en.json`, `uk.json`:

1. Add `"counterparties"` to `shell.settingsSections` (after `"categories"`): pl `"Kontrahenci"`, en `"Counterparties"`, uk `"Контрагенти"`.
2. Add a `counterparties` object to the `settings` namespace (insert it right after `settings.title`).

Polish (`pl.json`):

```json
    "counterparties": {
      "title": "Kontrahenci",
      "description": "Dostawcy, klienci i urzędy, którym płacisz lub od których dostajesz zapłatę",
      "searchPlaceholder": "Szukaj po nazwie lub NIP",
      "add": "Dodaj kontrahenta",
      "showArchived": "Pokaż zarchiwizowanych",
      "empty": "Brak kontrahentów",
      "noMatches": "Brak kontrahentów pasujących do wyszukiwania",
      "archivedBadge": "Zarchiwizowany",
      "systemBadge": "Systemowy",
      "edit": "Edytuj {name}",
      "vat": {
        "active": "Czynny podatnik VAT",
        "exempt": "Zwolniony z VAT",
        "unregistered": "Niezarejestrowany jako podatnik VAT",
        "checkedOn": "sprawdzono {date}"
      },
      "whitelist": {
        "yes": "Na białej liście",
        "no": "Poza białą listą",
        "unknown": "Nie sprawdzono"
      },
      "form": {
        "titleNew": "Nowy kontrahent",
        "titleEdit": "Edycja kontrahenta",
        "name": "Nazwa",
        "nip": "NIP",
        "nipHelp": "10 cyfr, z prefiksem PL i myślnikami lub bez",
        "lookup": "Uzupełnij z białej listy",
        "lookingUp": "Szukanie…",
        "address": "Adres",
        "ibans": "Rachunki bankowe",
        "ibanPlaceholder": "Numer rachunku (26 cyfr)",
        "addIban": "Dodaj rachunek",
        "removeIban": "Usuń rachunek {iban}",
        "save": "Zapisz",
        "saving": "Zapisywanie…",
        "cancel": "Anuluj",
        "archive": "Archiwizuj",
        "restore": "Przywróć"
      },
      "errors": {
        "name": "Podaj nazwę",
        "nip": "Podaj poprawny NIP",
        "iban": "Podaj poprawny numer rachunku",
        "duplicateNip": "Kontrahent z tym NIP już istnieje",
        "duplicateName": "Kontrahent o tej nazwie już istnieje",
        "limit": "Osiągnięto limit kontrahentów",
        "lookupUnavailable": "Biała lista jest teraz niedostępna. Uzupełnij dane ręcznie.",
        "lookupNotFound": "Tego NIP nie ma w rejestrze VAT. Uzupełnij dane ręcznie.",
        "rateLimited": "Zbyt wiele zapytań. Spróbuj za minutę.",
        "save": "Nie udało się zapisać kontrahenta"
      },
      "toast": {
        "created": "Dodano kontrahenta",
        "saved": "Zapisano kontrahenta",
        "archived": "Zarchiwizowano kontrahenta",
        "restored": "Przywrócono kontrahenta",
        "filled": "Uzupełniono dane z białej listy"
      },
      "picker": {
        "label": "Kontrahent",
        "placeholder": "Szukaj kontrahenta",
        "none": "Bez kontrahenta",
        "create": "Dodaj kontrahenta",
        "noMatches": "Nie znaleziono kontrahentów"
      }
    },
```

English (`en.json`): same structure with these values: title "Counterparties"; description "Suppliers, customers and offices you pay or get paid by"; searchPlaceholder "Search by name or NIP"; add "Add counterparty"; showArchived "Show archived"; empty "No counterparties yet"; noMatches "No counterparties match your search"; archivedBadge "Archived"; systemBadge "System"; edit "Edit {name}"; vat: active "VAT payer", exempt "VAT exempt", unregistered "Not VAT-registered", checkedOn "checked {date}"; whitelist: yes "On the white list", no "Not on the white list", unknown "Not checked"; form: titleNew "New counterparty", titleEdit "Edit counterparty", name "Name", nip "NIP", nipHelp "10 digits, with or without PL and dashes", lookup "Fill in from the white list", lookingUp "Looking up…", address "Address", ibans "Bank accounts", ibanPlaceholder "Account number (26 digits)", addIban "Add account", removeIban "Remove account {iban}", save "Save", saving "Saving…", cancel "Cancel", archive "Archive", restore "Restore"; errors: name "Enter a name", nip "Enter a valid NIP", iban "Enter a valid account number", duplicateNip "A counterparty with this NIP already exists", duplicateName "A counterparty with this name already exists", limit "The counterparty limit is reached", lookupUnavailable "The white list is not available now. Fill in the data by hand.", lookupNotFound "This NIP is not in the VAT register. Fill in the data by hand.", rateLimited "Too many lookups. Try again in a minute.", save "Could not save the counterparty"; toast: created "Counterparty added", saved "Counterparty saved", archived "Counterparty archived", restored "Counterparty restored", filled "Data filled in from the white list"; picker: label "Counterparty", placeholder "Search counterparties", none "No counterparty", create "Add counterparty", noMatches "No counterparties found".

Ukrainian (`uk.json`): same structure with these values: title "Контрагенти"; description "Постачальники, клієнти й установи, яким ви платите або від яких отримуєте оплату"; searchPlaceholder "Пошук за назвою або NIP"; add "Додати контрагента"; showArchived "Показати архівних"; empty "Контрагентів ще немає"; noMatches "Немає контрагентів за вашим пошуком"; archivedBadge "В архіві"; systemBadge "Системний"; edit "Редагувати {name}"; vat: active "Платник ПДВ", exempt "Звільнений від ПДВ", unregistered "Не зареєстрований платник ПДВ", checkedOn "перевірено {date}"; whitelist: yes "У білому списку", no "Немає в білому списку", unknown "Не перевірено"; form: titleNew "Новий контрагент", titleEdit "Редагування контрагента", name "Назва", nip "NIP", nipHelp "10 цифр, з префіксом PL і дефісами або без", lookup "Заповнити з білого списку", lookingUp "Пошук…", address "Адреса", ibans "Банківські рахунки", ibanPlaceholder "Номер рахунку (26 цифр)", addIban "Додати рахунок", removeIban "Видалити рахунок {iban}", save "Зберегти", saving "Збереження…", cancel "Скасувати", archive "Архівувати", restore "Відновити"; errors: name "Вкажіть назву", nip "Вкажіть правильний NIP", iban "Вкажіть правильний номер рахунку", duplicateNip "Контрагент з таким NIP уже існує", duplicateName "Контрагент з такою назвою уже існує", limit "Досягнуто ліміт контрагентів", lookupUnavailable "Білий список зараз недоступний. Заповніть дані вручну.", lookupNotFound "Цього NIP немає в реєстрі ПДВ. Заповніть дані вручну.", rateLimited "Забагато запитів. Спробуйте за хвилину.", save "Не вдалося зберегти контрагента"; toast: created "Контрагента додано", saved "Контрагента збережено", archived "Контрагента архівовано", restored "Контрагента відновлено", filled "Дані заповнено з білого списку"; picker: label "Контрагент", placeholder "Пошук контрагента", none "Без контрагента", create "Додати контрагента", noMatches "Контрагентів не знайдено".

- [ ] **Step 8: Run all unit tests, typecheck, lint, commit**

```bash
npx vitest run
npx tsc --noEmit
npx eslint .
git add -A
git commit -m "feat(counterparties): API client, Firestore read, hook, settings section and messages

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: unit tests pass, including the catalog parity test (`pl` and `en` have exactly the keys of `uk`) and the labels test (every settings slug has a label in every language).

---

### Task 15: Settings page and the counterparty form

**Files:**
- Create: `components/counterparties/CounterpartyForm.tsx`, `app/(app)/[orgSlug]/settings/counterparties/page.tsx`

There is no component-test tooling in this repo (Vitest runs in the node environment): the UI is covered by the Playwright test in Task 17. Keep logic out of the components where it can be a pure function in `lib/domain/counterparties` (already done for search, NIP and NRB).

- [ ] **Step 1: The form dialog**

Create `components/counterparties/CounterpartyForm.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  createCounterparty,
  duplicateOf,
  lookupNip,
  updateCounterparty,
  type CounterpartyPatchDraft,
} from '@/lib/api/counterparty-client'
import { LedgerApiError } from '@/lib/api/ledger-client'
import { normalizeNip, tryNormalizeIban } from '@/lib/domain/counterparties/normalize'
import { MAX_IBANS, type Counterparty, type Vat } from '@/lib/domain/counterparties/types'
import { useFormatters } from '@/lib/i18n/useFormatters'

interface Props {
  orgId: string
  /** Absent: a new counterparty. */
  counterparty?: Counterparty
  onClose: () => void
}

/** The NIP as 10 digits, or null when it is empty or not valid. */
function nipOrNull(raw: string): string | null {
  try {
    return normalizeNip(raw)
  } catch {
    return null
  }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

export function CounterpartyForm({ orgId, counterparty, onClose }: Props) {
  const t = useTranslations('settings.counterparties')
  const tCommon = useTranslations('common')
  const { date } = useFormatters()
  const isEdit = counterparty !== undefined

  const [name, setName] = useState(counterparty?.name ?? '')
  const [nip, setNip] = useState(counterparty?.nip ?? '')
  const [address, setAddress] = useState(counterparty?.address ?? '')
  const [ibans, setIbans] = useState<string[]>(counterparty?.ibans.map((i) => i.iban) ?? [])
  const [vat, setVat] = useState<Vat | null>(counterparty?.vat ?? null)
  const [errors, setErrors] = useState<{ name?: string; nip?: string; ibans?: string }>({})
  const [busy, setBusy] = useState<null | 'lookup' | 'save'>(null)

  const nipDigits = nipOrNull(nip)

  /** The white list marks are for the NIP they were stored under; once the NIP is edited they are not shown. */
  const marksApply = counterparty?.nip !== undefined && counterparty.nip === nipDigits

  const whitelistBadge = (raw: string): string | null => {
    if (!marksApply) return null
    const stored = counterparty?.ibans.find((i) => i.iban === tryNormalizeIban(raw))
    if (stored === undefined) return null
    return stored.onWhitelist === null ? t('whitelist.unknown') : stored.onWhitelist ? t('whitelist.yes') : t('whitelist.no')
  }

  const errorText = (e: unknown): string => {
    if (e instanceof LedgerApiError) {
      const duplicate = duplicateOf(e)
      if (duplicate) return duplicate.field === 'nip' ? t('errors.duplicateNip') : t('errors.duplicateName')
      if (e.code === 'limit') return t('errors.limit')
      if (e.code === 'rate_limited') return t('errors.rateLimited')
      if (e.code === 'lookup_unavailable') return t('errors.lookupUnavailable')
      if (e.code === 'invalid_input') {
        const field = e.details?.field
        if (field === 'nip') return t('errors.nip')
        if (field === 'ibans') return t('errors.iban')
        if (field === 'name') return t('errors.name')
      }
    }
    return t('errors.save')
  }

  const handleLookup = async () => {
    if (nipDigits === null) {
      setErrors((prev) => ({ ...prev, nip: t('errors.nip') }))
      return
    }
    setErrors((prev) => ({ ...prev, nip: undefined }))
    setBusy('lookup')
    try {
      const result = await lookupNip(orgId, nipDigits)
      if (!result.found) {
        toast.info(t('errors.lookupNotFound'))
        return
      }
      if (result.name) setName(result.name)
      if (result.address !== undefined) setAddress(result.address)
      if (result.vatStatus) setVat({ status: result.vatStatus, checkedOn: result.checkedOn })
      // A big company has hundreds of accounts: fill them only when the list is short and the form has none.
      if (ibans.length === 0 && result.ibans.length > 0 && result.ibans.length <= MAX_IBANS) setIbans(result.ibans)
      toast.success(t('toast.filled'))
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    const filled = ibans.map((i) => i.trim()).filter((i) => i !== '')
    const normalised = filled.map((i) => tryNormalizeIban(i))
    const next: typeof errors = {}
    if (trimmedName === '') next.name = t('errors.name')
    if (nip.trim() !== '' && nipDigits === null) next.nip = t('errors.nip')
    if (normalised.some((i) => i === null) || new Set(normalised).size !== normalised.length) next.ibans = t('errors.iban')
    setErrors(next)
    if (Object.keys(next).length > 0) return

    const ibanList = normalised as string[]
    const addressText = address.trim()
    setBusy('save')
    try {
      if (counterparty) {
        const patch: CounterpartyPatchDraft = {}
        if (trimmedName !== counterparty.name) patch.name = trimmedName
        if ((nipDigits ?? undefined) !== counterparty.nip) patch.nip = nipDigits
        if (!sameList(ibanList, counterparty.ibans.map((i) => i.iban))) patch.ibans = ibanList
        if ((addressText === '' ? undefined : addressText) !== counterparty.address) patch.address = addressText === '' ? null : addressText
        if (Object.keys(patch).length > 0) await updateCounterparty(orgId, counterparty.id, patch)
        toast.success(t('toast.saved'))
      } else {
        await createCounterparty(orgId, {
          name: trimmedName,
          ibans: ibanList,
          ...(nipDigits === null ? {} : { nip: nipDigits }),
          ...(addressText === '' ? {} : { address: addressText }),
        })
        toast.success(t('toast.created'))
      }
      onClose()
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const handleArchive = async () => {
    if (!counterparty) return
    setBusy('save')
    try {
      await updateCounterparty(orgId, counterparty.id, { archived: !counterparty.archived })
      toast.success(counterparty.archived ? t('toast.restored') : t('toast.archived'))
      onClose()
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('form.titleEdit') : t('form.titleNew')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1">
            <Label htmlFor="cp-name">{t('form.name')}</Label>
            <Input id="cp-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={errors.name !== undefined} />
            {errors.name && <p role="alert" className="text-xs text-red-500">{errors.name}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor="cp-nip">{t('form.nip')}</Label>
            <div className="flex gap-2">
              <Input
                id="cp-nip"
                value={nip}
                onChange={(e) => setNip(e.target.value)}
                inputMode="numeric"
                aria-describedby="cp-nip-help"
                aria-invalid={errors.nip !== undefined}
              />
              <Button type="button" variant="outline" onClick={handleLookup} disabled={busy !== null || nipDigits === null}>
                {busy === 'lookup' ? t('form.lookingUp') : t('form.lookup')}
              </Button>
            </div>
            <p id="cp-nip-help" className="text-xs text-ink-muted">{t('form.nipHelp')}</p>
            {errors.nip && <p role="alert" className="text-xs text-red-500">{errors.nip}</p>}
            {vat && (
              <p data-testid="cp-vat" className="text-xs font-medium text-brand-soft-foreground">
                {t(`vat.${vat.status}`)} · {t('vat.checkedOn', { date: date(new Date(`${vat.checkedOn}T00:00:00Z`)) })}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="cp-address">{t('form.address')}</Label>
            <Input id="cp-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('form.ibans')}</legend>
            {ibans.map((value, index) => {
              const badge = whitelistBadge(value)
              return (
                <div key={index} className="space-y-1">
                  <div className="flex gap-2">
                    <Input
                      value={value}
                      onChange={(e) => setIbans((list) => list.map((x, i) => (i === index ? e.target.value : x)))}
                      placeholder={t('form.ibanPlaceholder')}
                      aria-label={t('form.ibans')}
                      inputMode="numeric"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('form.removeIban', { iban: value })}
                      onClick={() => setIbans((list) => list.filter((_, i) => i !== index))}
                    >
                      <X />
                    </Button>
                  </div>
                  {badge && <p className="text-xs text-ink-muted">{badge}</p>}
                </div>
              )
            })}
            {errors.ibans && <p role="alert" className="text-xs text-red-500">{errors.ibans}</p>}
            <Button type="button" variant="outline" size="sm" disabled={ibans.length >= MAX_IBANS} onClick={() => setIbans((list) => [...list, ''])}>
              <Plus />
              {t('form.addIban')}
            </Button>
          </fieldset>

          <DialogFooter className="gap-2 sm:justify-between">
            {isEdit ? (
              <Button type="button" variant="ghost" onClick={handleArchive} disabled={busy !== null}>
                {counterparty.archived ? t('form.restore') : t('form.archive')}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={busy === 'save'}>
                {tCommon('cancel')}
              </Button>
              <Button type="submit" disabled={busy !== null}>
                {busy === 'save' ? t('form.saving') : t('form.save')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

`common.cancel` exists in all three catalogs. If the `Input` props type rejects `aria-invalid`, drop that attribute.

- [ ] **Step 2: The page**

Create `app/(app)/[orgSlug]/settings/counterparties/page.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Pencil, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { CounterpartyForm } from '@/components/counterparties/CounterpartyForm'
import { filterCounterparties } from '@/lib/domain/counterparties/search'
import type { Counterparty } from '@/lib/domain/counterparties/types'
import { useCounterparties } from '@/lib/hooks/useCounterparties'
import { useShell } from '@/lib/hooks/useShell'

const BADGE = 'rounded-full bg-canvas px-2 py-0.5 text-xs font-medium text-ink-muted'

export default function CounterpartiesSettingsPage() {
  const t = useTranslations('settings.counterparties')
  const { orgId, can } = useShell()
  const canEdit = can('data.write')
  const { counterparties, loading } = useCounterparties(orgId)

  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  // `'new'`: the create form; a counterparty: its edit form.
  const [editing, setEditing] = useState<Counterparty | 'new' | null>(null)

  const rows = useMemo(
    () => filterCounterparties(counterparties, query, { includeArchived: showArchived }),
    [counterparties, query, showArchived],
  )

  return (
    <Card className="ring-line">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold text-ink">{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
        {canEdit && (
          <Button onClick={() => setEditing('new')}>
            <Plus />
            {t('add')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              className="pl-9"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            {t('showArchived')}
          </label>
        </div>

        {loading ? null : rows.length === 0 ? (
          <p className="text-sm text-ink-muted">{counterparties.length === 0 ? t('empty') : t('noMatches')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((c) => (
              <li key={c.id} data-testid="counterparty-row" className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={c.archived ? 'font-medium text-ink-muted' : 'font-medium text-ink'}>{c.name}</span>
                    {c.kind && <span className={BADGE}>{t('systemBadge')}</span>}
                    {c.archived && <span className={BADGE}>{t('archivedBadge')}</span>}
                    {c.vat && <span className={BADGE}>{t(`vat.${c.vat.status}`)}</span>}
                  </div>
                  {(c.nip || c.address) && (
                    <p className="truncate text-xs text-ink-muted">{[c.nip && `NIP ${c.nip}`, c.address].filter(Boolean).join(' · ')}</p>
                  )}
                </div>
                {canEdit && (
                  <Button variant="ghost" size="icon" aria-label={t('edit', { name: c.name })} onClick={() => setEditing(c)}>
                    <Pencil />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {editing !== null && (
        <CounterpartyForm
          key={editing === 'new' ? 'new' : editing.id}
          orgId={orgId}
          counterparty={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  )
}
```

- [ ] **Step 3: Typecheck, lint, build, commit**

```bash
npx tsc --noEmit
npx eslint .
npm run build
git add components app
git commit -m "feat(counterparties): settings page and form

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: no type errors, 0 lint errors (the lint warning count must not grow), build succeeds.

---

### Task 16: `CounterpartyPicker`

**Files:**
- Create: `components/counterparties/CounterpartyPicker.tsx`

The picker is a controlled combobox for S07 to put into the operation form. It receives the list (so the form shares one subscription) and does not know about the form. The filtering is `filterCounterparties` (unit-tested in Task 4); the component itself has no browser test until S07 mounts it (say so in the PR).

- [ ] **Step 1: Write the component**

Create `components/counterparties/CounterpartyPicker.tsx`:

```tsx
'use client'

import { useId, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { filterCounterparties } from '@/lib/domain/counterparties/search'
import type { Counterparty } from '@/lib/domain/counterparties/types'
import { cn } from '@/lib/utils'

const MAX_OPTIONS = 50

type Row = { kind: 'none' } | { kind: 'item'; counterparty: Counterparty } | { kind: 'create' }

interface Props {
  /** The company's counterparties (archived ones may be included: the selected one is shown even then). */
  counterparties: Counterparty[]
  value: string | null
  onChange: (id: string | null) => void
  /** When given, the last option creates a counterparty; the parent opens its form with what was typed. */
  onCreate?: (typed: string) => void
  disabled?: boolean
  id?: string
}

/** A searchable single choice of a counterparty (name or NIP), with «none» and an optional «add» option. */
export function CounterpartyPicker({ counterparties, value, onChange, onCreate, disabled, id }: Props) {
  const t = useTranslations('settings.counterparties.picker')
  const listId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const selected = counterparties.find((c) => c.id === value) ?? null
  const matches = useMemo(() => filterCounterparties(counterparties, query).slice(0, MAX_OPTIONS), [counterparties, query])
  const rows: Row[] = [
    { kind: 'none' },
    ...matches.map((counterparty): Row => ({ kind: 'item', counterparty })),
    ...(onCreate ? [{ kind: 'create' } as Row] : []),
  ]

  const close = () => {
    setOpen(false)
    setQuery('')
    setActive(0)
  }

  const choose = (row: Row) => {
    if (row.kind === 'none') onChange(null)
    else if (row.kind === 'item') onChange(row.counterparty.id)
    else onCreate?.(query)
    close()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(i + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && open) {
      e.preventDefault()
      choose(rows[Math.min(active, rows.length - 1)])
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      close()
    }
  }

  const label = (row: Row): string =>
    row.kind === 'none' ? t('none') : row.kind === 'create' ? t('create') : row.counterparty.name

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-label={t('label')}
        placeholder={t('placeholder')}
        disabled={disabled}
        value={open ? query : (selected?.name ?? '')}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(1)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('label')}
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-control border border-line bg-surface py-1 shadow-panel"
        >
          {rows.map((row, index) => (
            <li
              key={row.kind === 'item' ? row.counterparty.id : row.kind}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={row.kind === 'item' && row.counterparty.id === value}
              // mousedown (not click) so the input's blur does not close the list before the choice is made.
              onMouseDown={(e) => {
                e.preventDefault()
                choose(row)
              }}
              onMouseEnter={() => setActive(index)}
              className={cn('flex cursor-pointer items-center gap-2 px-3 py-2 text-sm', index === active && 'bg-canvas', row.kind === 'none' && 'text-ink-muted')}
            >
              {row.kind === 'create' && <Plus className="size-4" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">{label(row)}</span>
              {row.kind === 'item' && row.counterparty.nip && <span className="text-xs text-ink-muted">{row.counterparty.nip}</span>}
              {row.kind === 'item' && row.counterparty.id === value && <Check className="size-4" aria-hidden />}
            </li>
          ))}
          {matches.length === 0 && <li className="px-3 py-2 text-sm text-ink-muted">{t('noMatches')}</li>}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck, lint, commit**

```bash
npx tsc --noEmit
npx eslint components/counterparties
git add components/counterparties/CounterpartyPicker.tsx
git commit -m "feat(counterparties): reusable counterparty picker for the operation form (S07)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: clean. The `aria-selected` and keyboard handling follow the WAI-ARIA combobox pattern; the listbox has `noMatches` text inside a non-option `li`, which is acceptable here because the «none» option is always present.

---

### Task 17: End-to-end test with a stub of the white list

**Files:**
- Create: `tests/e2e/helpers/wl-stub.mjs`, `tests/e2e/counterparties.spec.ts`
- Modify: `playwright.config.ts`

- [ ] **Step 1: The stub**

Create `tests/e2e/helpers/wl-stub.mjs`:

```js
// A stand-in for the MF white list (wl-api.mf.gov.pl) for the Playwright run: the dev server is started with
// WL_API_BASE pointing here, so no test ever calls the real government API.
//   7740001454 -> a VAT payer with one account    anything else valid-looking -> not in the register (subject null)
import http from 'node:http'

const PORT = 4010

const FOUND = {
  name: 'ORLEN SPÓŁKA AKCYJNA',
  nip: '7740001454',
  statusVat: 'Czynny',
  residenceAddress: 'CHEMIKÓW 7, 09-411 PŁOCK',
  workingAddress: null,
  accountNumbers: ['61109010140000071219812874'],
  hasVirtualAccounts: false,
}

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
    if (url.pathname === '/health') {
      res.end('ok')
      return
    }
    res.setHeader('Content-Type', 'application/json')
    const match = /^\/api\/search\/nip\/(\d{10})$/.exec(url.pathname)
    if (!match) {
      res.statusCode = 404
      res.end('{"message":"not found"}')
      return
    }
    res.end(JSON.stringify({ result: { subject: match[1] === '7740001454' ? FOUND : null, requestId: 'stub' } }))
  })
  .listen(PORT, '127.0.0.1')
```

- [ ] **Step 2: Start it with the dev server**

In `playwright.config.ts`: add `WL_API_BASE: 'http://127.0.0.1:4010',` to `E2E_SERVER_ENV` (with a comment: the white list stub), and change `webServer: { ... }` into an array whose first element is the existing object and whose second is:

```ts
    {
      command: 'node tests/e2e/helpers/wl-stub.mjs',
      url: 'http://127.0.0.1:4010/health',
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
```

- [ ] **Step 3: The test**

Create `tests/e2e/counterparties.spec.ts` (labels are Ukrainian: the e2e browser locale is `uk-UA`):

```ts
import { test, expect, type Page } from '@playwright/test'
import { registerViaUi, waitForHydration, waitForShell } from './helpers/app-ui'

const NEEDS_EMULATORS =
  'Needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"'

test.describe('counterparties (emulators)', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  async function openPage(page: Page, orgId: string) {
    await page.goto(`/${orgId}/settings/counterparties`)
    await waitForHydration(page, 'input[type="checkbox"]')
    await expect(page.getByRole('heading', { name: 'Налаштування' })).toBeVisible()
  }

  test('a new company has ZUS and Urząd Skarbowy as system counterparties', async ({ page }) => {
    const user = await registerViaUi(page, 'cp-system')
    await waitForShell(page, user.companyName)
    await openPage(page, user.orgId)
    const rows = page.getByTestId('counterparty-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.filter({ hasText: 'ZUS' })).toContainText('Системний')
    await expect(rows.filter({ hasText: 'Urząd Skarbowy' })).toContainText('Системний')
  })

  test('creates a counterparty by hand, finds it by search, and refuses the same name again', async ({ page }) => {
    const user = await registerViaUi(page, 'cp-manual')
    await waitForShell(page, user.companyName)
    await openPage(page, user.orgId)

    await page.getByRole('button', { name: 'Додати контрагента' }).click()
    await page.getByLabel('Назва', { exact: true }).fill('Acme sp. z o.o.')
    await page.getByRole('button', { name: 'Зберегти' }).click()
    await expect(page.getByTestId('counterparty-row').filter({ hasText: 'Acme sp. z o.o.' })).toBeVisible()

    await page.getByPlaceholder('Пошук за назвою або NIP').fill('acme')
    await expect(page.getByTestId('counterparty-row')).toHaveCount(1)
    await page.getByPlaceholder('Пошук за назвою або NIP').fill('')

    await page.getByRole('button', { name: 'Додати контрагента' }).click()
    await page.getByLabel('Назва', { exact: true }).fill('ACME  SP Z O O')
    await page.getByRole('button', { name: 'Зберегти' }).click()
    await expect(page.getByText('Контрагент з такою назвою уже існує')).toBeVisible()
  })

  test('fills the form from the white list by NIP and refuses a second counterparty with that NIP', async ({ page }) => {
    const user = await registerViaUi(page, 'cp-nip')
    await waitForShell(page, user.companyName)
    await openPage(page, user.orgId)

    await page.getByRole('button', { name: 'Додати контрагента' }).click()
    await page.getByLabel('NIP', { exact: true }).fill('774-000-14-54')
    await page.getByRole('button', { name: 'Заповнити з білого списку' }).click()
    await expect(page.getByLabel('Назва', { exact: true })).toHaveValue('ORLEN SPÓŁKA AKCYJNA')
    await expect(page.getByLabel('Адреса', { exact: true })).toHaveValue('CHEMIKÓW 7, 09-411 PŁOCK')
    await expect(page.getByTestId('cp-vat')).toContainText('Платник ПДВ')
    await expect(page.getByLabel('Банківські рахунки')).toHaveValue('61109010140000071219812874')
    await page.getByRole('button', { name: 'Зберегти' }).click()

    const row = page.getByTestId('counterparty-row').filter({ hasText: 'ORLEN' })
    await expect(row).toContainText('NIP 7740001454')
    await expect(row).toContainText('Платник ПДВ')

    await page.getByRole('button', { name: 'Додати контрагента' }).click()
    await page.getByLabel('Назва', { exact: true }).fill('Another name')
    await page.getByLabel('NIP', { exact: true }).fill('7740001454')
    await page.getByRole('button', { name: 'Зберегти' }).click()
    await expect(page.getByText('Контрагент з таким NIP уже існує')).toBeVisible()
  })

  test('a NIP that is not in the register says so and leaves the form for manual entry', async ({ page }) => {
    const user = await registerViaUi(page, 'cp-unknown')
    await waitForShell(page, user.companyName)
    await openPage(page, user.orgId)

    await page.getByRole('button', { name: 'Додати контрагента' }).click()
    await page.getByLabel('NIP', { exact: true }).fill('5252344078')
    await page.getByRole('button', { name: 'Заповнити з білого списку' }).click()
    await expect(page.getByText('Цього NIP немає в реєстрі ПДВ. Заповніть дані вручну.')).toBeVisible()
    await expect(page.getByLabel('Назва', { exact: true })).toHaveValue('')
  })

  test('refuses an invalid NIP and an invalid account number before saving', async ({ page }) => {
    const user = await registerViaUi(page, 'cp-invalid')
    await waitForShell(page, user.companyName)
    await openPage(page, user.orgId)

    await page.getByRole('button', { name: 'Додати контрагента' }).click()
    await page.getByLabel('Назва', { exact: true }).fill('Bad Data Ltd')
    await page.getByLabel('NIP', { exact: true }).fill('1234567890')
    await page.getByRole('button', { name: 'Зберегти' }).click()
    await expect(page.getByText('Вкажіть правильний NIP')).toBeVisible()

    await page.getByLabel('NIP', { exact: true }).fill('')
    await page.getByRole('button', { name: 'Додати рахунок' }).click()
    await page.getByLabel('Банківські рахунки').fill('123')
    await page.getByRole('button', { name: 'Зберегти' }).click()
    await expect(page.getByText('Вкажіть правильний номер рахунку')).toBeVisible()
  })

  test('archives a counterparty, hides it, shows it on request and restores it', async ({ page }) => {
    const user = await registerViaUi(page, 'cp-archive')
    await waitForShell(page, user.companyName)
    await openPage(page, user.orgId)

    await page.getByRole('button', { name: 'Додати контрагента' }).click()
    await page.getByLabel('Назва', { exact: true }).fill('Temporary Ltd')
    await page.getByRole('button', { name: 'Зберегти' }).click()
    const row = page.getByTestId('counterparty-row').filter({ hasText: 'Temporary Ltd' })
    await expect(row).toBeVisible()

    await row.getByRole('button', { name: 'Редагувати Temporary Ltd' }).click()
    await page.getByRole('button', { name: 'Архівувати' }).click()
    await expect(row).toHaveCount(0)

    await page.getByLabel('Показати архівних').check()
    await expect(row).toContainText('В архіві')
    await row.getByRole('button', { name: 'Редагувати Temporary Ltd' }).click()
    await page.getByRole('button', { name: 'Відновити' }).click()
    await page.getByLabel('Показати архівних').uncheck()
    await expect(row).toBeVisible()
    await expect(row).not.toContainText('В архіві')
  })
})
```

If a selector is ambiguous (the `Назва` label, or `Банківські рахунки`, which is both a fieldset legend and the aria-label of the account inputs), scope it with `page.getByRole('dialog')` or use the placeholder `Номер рахунку (26 цифр)` for the account input.

- [ ] **Step 4: Run it**

```bash
PATH="$HOME/.jre/temurin-21/bin:$PATH" npx firebase emulators:exec --only auth,firestore --project demo-finflow "npx playwright test tests/e2e/counterparties.spec.ts"
```

Expected: 6 passed. Then run the whole e2e suite once (`npx firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"`): the new settings menu entry must not break `app-shell.spec.ts` (updated in Task 14) or `i18n.spec.ts`. If `account row menu` times out under load and passes on rerun, note it (known flaky), do not change it.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts tests/e2e
git commit -m "test(counterparties): e2e on the emulators with a white list stub

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Documentation

**Files:**
- Modify: `CLAUDE.md`, `PROGRESS.md`, `docs/superpowers/specs/2026-10-27-s06-counterparties-design.md`

- [ ] **Step 1: Bring the spec in line with what was built**

In the spec:
- Status line: `Статус: **реалізовано в гілці `s06-counterparties`, чекає мерджа.**`
- In «Сервер → Роути»: the PATCH field list is `name`, `nip`, `ibans`, `address`, `archived` (no `vat`: the server sets it); the lookup route is allowed for owner and accountant; add error `409 conflict` for a concurrent edit.
- In «Біла ліста»: replace the IBAN fill sentence with: the form fills the IBANs only when the white list returns 1–20 accounts and the form has none.
- In «Зв'язок з операціями»: the HTTP status of `counterparty_not_found` and `counterparty_archived` is 422.
- In «Ліміт запитів»: the counters are `rateLimits/{scope}_{uid}_{window}_{bucket}` with `expiresAt` (a Firestore TTL policy to clean them is a follow-up); `/api/rates` is limited at 120 per minute and 1200 per hour.
- Add to «Відомі наступні кроки»: TTL policy for `rateLimits`; `CounterpartyPicker` has no browser test until S07 mounts it; the concurrent-edit `conflict` path has no automated test.

- [ ] **Step 2: `CLAUDE.md`**

Add a block after `## Ledger (S05)` (same bullet style, one line each):

```markdown
## Counterparties (S06)
- **Split:** `lib/domain/counterparties/` is pure (name/NIP/NRB normalisation and checksums, input parsing, document mapping, uniqueness keys, white list response parsing, search); `lib/server/counterparties/` writes. Every change to `counterparties` and `counterpartyKeys` goes through it in ONE Admin transaction (document + key documents + audit). The browser only reads `counterparties`; the rules close all client writes and all access to `counterpartyKeys` and the root `rateLimits`.
- **Uniqueness:** `counterpartyKeys/nip_{10 digits}` and `counterpartyKeys/name_{normalised name}` are created in the same transaction as the counterparty; an existing key is a `409 duplicate` with `field` and `existingId`. The name key drops Latin diacritics (`ł` is `l`), case and punctuation; Cyrillic letters keep their identity.
- **White list (MF):** `lookupNip` (server only, `WL_API_BASE` overrides the host in tests, 8 s timeout, one retry on network errors). A failure is `502 lookup_unavailable` and never blocks saving: the counterparty is saved with no VAT status and `onWhitelist: null`. `vat` and `onWhitelist` are set by the server, never accepted from the client. The lookup route is rate limited per user (`lib/server/rate-limit-guard.ts`: 30 per minute, 300 per hour); `/api/rates` shares the mechanism.
- **System records:** `system_zus` and `system_us` (`kind: 'zus' | 'us'`) are created with every company and added to existing ones by `npm run seed:counterparties` (dry run by default; `-- --apply --project=finflow-e94b5`; idempotent, found by id). They are ordinary records: editable and archivable, never deletable (there is no delete at all, only `archived`).
- **Operations:** the ledger write path checks a new `counterpartyId` in the same transaction: unknown is `422 counterparty_not_found`, archived is `422 counterparty_archived`; an edit that leaves the counterparty as it was is not re-checked.
- **UI:** settings section «Контрагенти» (`app/(app)/[orgSlug]/settings/counterparties`) and `components/counterparties/CounterpartyPicker.tsx` (controlled combobox for S07; the operation form is not changed yet).
- **Tests:** unit under `tests/unit/{domain,server,api}/counterparties/`, integration `tests/integration/counterparties-*.test.ts` and `rate-limit.test.ts` (Firestore emulator), rules in `tests/rules/`, e2e `tests/e2e/counterparties.spec.ts` (the dev server talks to `tests/e2e/helpers/wl-stub.mjs`, never to the real white list).
```

Also add `counterparties` and `counterpartyKeys` to the data-model line in `## Firestore Data Model` if it lists the subcollections.

- [ ] **Step 3: `PROGRESS.md`**

Add a `## 2026-10-27 — S06: контрагенти` entry in the style of the S05 entry: spec and plan links, status (implemented on `s06-counterparties`, awaiting merge; NOT deployed), what was done (domain, server, routes, rate limit, ledger check, rules, UI, picker, seed script), measured counts (fill them from the real runs: unit, integration, rules, e2e), what is not verified (real MF white list from CI, picker in a browser, `conflict` path, no TTL on `rateLimits`), and the rollout order (merge and Vercel, deploy rules, `seed:counterparties` dry run then `--apply` with the owner's OK). Copy the real numbers from the last full runs of Step 4.

- [ ] **Step 4: Full verification**

```bash
npx tsc --noEmit
npx eslint .
npx vitest run
PATH="$HOME/.jre/temurin-21/bin:$PATH" npm run test:rules
PATH="$HOME/.jre/temurin-21/bin:$PATH" npm run test:integration
PATH="$HOME/.jre/temurin-21/bin:$PATH" npx firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"
npm run build
```

Expected: all green (lint warnings not above the current 13). One live check against the real white list (not in CI): run `curl`-free, with Node: `node -e "fetch('https://wl-api.mf.gov.pl/api/search/nip/7740001454?date='+new Date().toISOString().slice(0,10)).then(r=>r.json()).then(j=>console.log(j.result.subject && j.result.subject.statusVat))"` and expect `Czynny`; report it in the PR (use ctx_execute with node `fetch` if the shell hook redirects curl).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: S06 counterparties (spec amendments, CLAUDE.md, PROGRESS.md)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## After the last task (controller, not an implementer task)

1. Dispatch an opus whole-branch review (`git diff master...s06-counterparties`), fix every real defect with a test, re-run the Step 4 checks.
2. Open the PR (draft first), wait for green CI, mark it ready, and STOP: the owner's explicit OK is needed to merge.
3. Rollout after the OK: merge, wait for Vercel, `firebase deploy --only firestore:rules`, `npm run seed:counterparties -- --project=finflow-e94b5` (dry run, show the output), then `--apply` after a second OK, then a prod smoke (open the page, create and archive a counterparty, a lookup by NIP).
