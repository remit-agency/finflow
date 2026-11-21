# S15a: Legal Pages, Consents and Data Rights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Public Regulamin / Polityka prywatności / Cookies in PL/EN/UA, a versioned recorded consent (register checkbox + in-app gate), an owner-only full data export in Settings, and tested admin scripts that erase a company or a user.

**Architecture:** Pure domain modules under `lib/legal/` (versions, consent state, operator config) shared by server and browser. The server writes `userConsents/{uid}` (+ append-only `events`) in one transaction through `POST /api/consent`; the browser only reads its own document and shows a blocking `ConsentGate` in `AppShell`. Legal text is typed TS content under `content/legal/` rendered by one component. Export is assembled in the browser from a paged owner-only endpoint (same idea as the CSV export). Erasure is `scripts/erase-*.ts` over pure, injectable `scripts/lib/erase.ts`.

**Tech Stack:** Next.js 16, React 19 (React Compiler: no setState in effect bodies), next-intl (uk/pl/en keys identical; edit JSON by targeted text insertion only), Firebase Auth + Firestore (Admin on the server), Vitest, Playwright (CI only), `fflate` (already a dependency), tsx scripts.

**Spec:** `docs/superpowers/specs/2026-11-21-s15a-legal-consents-design.md` (Ukrainian). Read it first.

## Conventions for every task

- Branch `s15a-legal` (already created, spec committed). Commit after each task with a Conventional Commit subject; end the message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Commands (Windows, run from `F:\AI\finflow`):
  - Unit: `npx vitest run --config vitest.config.ts <path>`
  - Rules / integration (Firestore emulator): `npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.rules.config.ts <path>"` (integration: `vitest.integration.config.ts`). If the quoting fails under cmd.exe, use the `npm run test:rules` / `npm run test:integration` scripts and filter with the `-t` flag set inside the file during development, then remove it.
  - Typecheck: `npm run typecheck` (fallback when memory is low: `node --max-old-space-size=2048 node_modules/typescript/bin/tsc --noEmit`). Lint: `npx eslint <files>`.
- Local RAM is low: do NOT start a dev server or Playwright locally; e2e runs in CI.
- Strings in `app/(app)`, `app/(auth)`, `components`, `lib`, `types` must come from `messages/{uk,pl,en}.json` (guard `tests/unit/i18n/no-hardcoded-text.test.ts`). Legal text lives in `content/legal/` (not scanned) and is the only long prose outside `messages`.
- Server-only code: `lib/server/**` with `export const runtime = 'nodejs'` in routes; map errors with `HttpError` + `errorResponse()`. `npm run check:server-imports` must stay green (domain code never imports `lib/server`).
- Never print personal data or secrets from scripts (counts only).

## File map

Create:
- `lib/legal/versions.ts`, `lib/legal/consent.ts`, `content/legal/operator.ts`, `lib/legal/content-types.ts`
- `content/legal/outline.ts`, `content/legal/{terms,privacy,cookies}.{pl,en,uk}.ts` (9), `content/legal/index.ts`, `content/legal/export-readme.ts`
- `components/legal/LegalDocument.tsx`, `components/legal/LegalLinks.tsx`, `components/legal/DraftBanner.tsx`, `app/legal/[doc]/page.tsx`
- `lib/server/consent/index.ts`, `app/api/consent/route.ts`, `lib/api/consent-client.ts`
- `lib/hooks/useConsent.ts`, `components/consent/ConsentGate.tsx`
- `lib/domain/export/collections.ts`, `lib/server/export/read.ts`, `app/api/orgs/[orgId]/export/data/route.ts`, `app/api/me/export/route.ts`, `lib/api/export-client.ts`, `components/settings/privacy/{ExportCard,ConsentCard}.tsx`, `app/(app)/[orgSlug]/settings/privacy/page.tsx`
- `scripts/lib/erase.ts`, `scripts/erase-org.ts`, `scripts/erase-user.ts`
- Tests: `tests/unit/legal/*.test.ts`, `tests/unit/privacy/no-tracking.test.ts`, `tests/unit/export/*.test.ts`, `tests/rules/` additions, `tests/integration/{consent,export,erase}.test.ts`, `tests/e2e/legal-consent.spec.ts`

Modify: `firestore.rules`, `tests/rules/firestore.rules.test.ts`, `components/shell/AppShell.tsx`, `app/(auth)/register/page.tsx`, `app/(auth)/login/page.tsx`, `app/pricing/page.tsx`, `app/page.tsx`, `app/sitemap.ts`, `lib/shell/settings-sections.ts`, `lib/server/ledger/audit.ts`, `lib/server/banking/eb-api.ts`, `messages/{uk,pl,en}.json`, `tests/e2e/helpers/app-ui.ts`, `tests/e2e/app-shell.spec.ts`, `CLAUDE.md`, `PROGRESS.md`, the spec's status line.

---

## Task 1: Versions, consent state and body parser (pure)

**Files:**
- Create: `lib/legal/versions.ts`, `lib/legal/consent.ts`
- Test: `tests/unit/legal/consent.test.ts`

- [ ] **Step 1: Write the failing test** `tests/unit/legal/consent.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { LEGAL_VERSIONS } from '@/lib/legal/versions'
import { needsConsent, parseConsentBody, parseConsentState } from '@/lib/legal/consent'

const current = { terms: LEGAL_VERSIONS.terms, privacy: LEGAL_VERSIONS.privacy }
const entry = (version: string) => ({ version, at: '2026-11-21T10:00:00.000Z', locale: 'pl' })

describe('needsConsent', () => {
  it('is true without a record', () => expect(needsConsent(null)).toBe(true))
  it('is true when one document is missing', () =>
    expect(needsConsent({ terms: entry(current.terms) })).toBe(true))
  it('is true when a version differs from the current one', () =>
    expect(needsConsent({ terms: entry('2020-01-01'), privacy: entry(current.privacy) })).toBe(true))
  it('is false when both documents are at the current version', () =>
    expect(needsConsent({ terms: entry(current.terms), privacy: entry(current.privacy) })).toBe(false))
})

describe('parseConsentState', () => {
  it('keeps only well-formed entries', () => {
    const state = parseConsentState({
      terms: entry('v1'),
      privacy: { version: 5, at: 'x', locale: 'pl' },
      junk: 1,
    })
    expect(state).toEqual({ terms: entry('v1') })
  })
  it('returns an empty state for non-objects', () => {
    expect(parseConsentState(null)).toEqual({})
    expect(parseConsentState('x')).toEqual({})
  })
})

describe('parseConsentBody', () => {
  it('accepts the current versions with a known source', () => {
    expect(parseConsentBody({ docs: current, source: 'gate' })).toEqual({ ok: true, value: { docs: current, source: 'gate' } })
  })
  it('reports stale when a version is not the current one', () => {
    expect(parseConsentBody({ docs: { ...current, terms: '2020-01-01' }, source: 'register' })).toEqual({ ok: false, reason: 'stale' })
  })
  it('reports invalid for a bad shape or source', () => {
    expect(parseConsentBody(null)).toEqual({ ok: false, reason: 'invalid' })
    expect(parseConsentBody({ docs: current, source: 'hack' })).toEqual({ ok: false, reason: 'invalid' })
    expect(parseConsentBody({ docs: { terms: current.terms }, source: 'gate' })).toEqual({ ok: false, reason: 'invalid' })
  })
})
```

- [ ] **Step 2: Run it, expect FAIL** (modules missing): `npx vitest run --config vitest.config.ts tests/unit/legal/consent.test.ts`

- [ ] **Step 3: Implement** `lib/legal/versions.ts`

```ts
// Versions of the documents a person must accept. Pure: shared by the server and the browser.
// A change to the text that touches rights or duties means a NEW version here (and the gate asks again).
export const CONSENT_DOCS = ['terms', 'privacy'] as const
export type ConsentDoc = (typeof CONSENT_DOCS)[number]

/** Every public legal page. `cookies` is information, not a consent, so it has no version. */
export const PUBLIC_LEGAL_DOCS = ['terms', 'privacy', 'cookies'] as const
export type PublicLegalDoc = (typeof PUBLIC_LEGAL_DOCS)[number]

export const LEGAL_VERSIONS: Readonly<Record<ConsentDoc, string>> = {
  terms: '2026-11-21',
  privacy: '2026-11-21',
}

export function isPublicLegalDoc(value: unknown): value is PublicLegalDoc {
  return typeof value === 'string' && (PUBLIC_LEGAL_DOCS as readonly string[]).includes(value)
}
```

`lib/legal/consent.ts`

```ts
import { CONSENT_DOCS, LEGAL_VERSIONS, type ConsentDoc } from './versions'

export const CONSENT_SOURCES = ['register', 'google', 'gate'] as const
export type ConsentSource = (typeof CONSENT_SOURCES)[number]

/** One accepted document. `at` is an ISO instant (a string in Firestore, never a Timestamp). */
export interface ConsentEntry { version: string; at: string; locale: string }
export type ConsentState = Partial<Record<ConsentDoc, ConsentEntry>>

export interface ConsentInput { docs: Record<ConsentDoc, string>; source: ConsentSource }
export type ConsentParse =
  | { ok: true; value: ConsentInput }
  | { ok: false; reason: 'invalid' | 'stale' }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** True when the person has not accepted the CURRENT version of every document. `null` = no record. */
export function needsConsent(state: ConsentState | null): boolean {
  if (!state) return true
  return CONSENT_DOCS.some((doc) => state[doc]?.version !== LEGAL_VERSIONS[doc])
}

/** Reads a stored `userConsents/{uid}` document; malformed entries are dropped (they then count as missing). */
export function parseConsentState(data: unknown): ConsentState {
  if (!isRecord(data)) return {}
  const out: ConsentState = {}
  for (const doc of CONSENT_DOCS) {
    const e = data[doc]
    if (isRecord(e) && typeof e.version === 'string' && typeof e.at === 'string' && typeof e.locale === 'string') {
      out[doc] = { version: e.version, at: e.at, locale: e.locale }
    }
  }
  return out
}

/** Parses the body of POST /api/consent. A version that is not the current one is `stale` (the bundle is old). */
export function parseConsentBody(body: unknown): ConsentParse {
  if (!isRecord(body) || !isRecord(body.docs)) return { ok: false, reason: 'invalid' }
  const source = body.source
  if (typeof source !== 'string' || !(CONSENT_SOURCES as readonly string[]).includes(source)) return { ok: false, reason: 'invalid' }
  const docs = {} as Record<ConsentDoc, string>
  for (const doc of CONSENT_DOCS) {
    const v = body.docs[doc]
    if (typeof v !== 'string') return { ok: false, reason: 'invalid' }
    docs[doc] = v
  }
  if (CONSENT_DOCS.some((doc) => docs[doc] !== LEGAL_VERSIONS[doc])) return { ok: false, reason: 'stale' }
  return { ok: true, value: { docs, source: source as ConsentSource } }
}
```

- [ ] **Step 4: Run, expect PASS.** Then `npx eslint lib/legal tests/unit/legal`.
- [ ] **Step 5: Commit** `feat(legal): consent versions, state and body parser`

---

## Task 2: Operator config, content types, outline and draft guard (pure)

**Files:**
- Create: `content/legal/operator.ts`, `lib/legal/content-types.ts`, `content/legal/outline.ts`
- Test: `tests/unit/legal/operator.test.ts`

- [ ] **Step 1: Write the failing test** `tests/unit/legal/operator.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { LEGAL_DRAFT, OPERATOR, operatorProblems } from '@/content/legal/operator'

describe('operator config', () => {
  it('lists problems for empty or placeholder fields', () => {
    expect(operatorProblems({ ...OPERATOR, nip: '' })).toContain('nip')
    expect(operatorProblems({ ...OPERATOR, name: 'TODO' })).toContain('name')
  })
  it('lists no problem for a complete operator', () => {
    const complete = { ...OPERATOR, name: 'Remit Sp. z o.o.', legalForm: 'sp. z o.o.', nip: '5840000000', address: 'ul. Długa 1, 80-000 Gdańsk', rodoEmail: 'rodo@example.pl', supportEmail: 'pomoc@example.pl' }
    expect(operatorProblems(complete)).toEqual([])
  })
  it('refuses to publish without the draft marker while a field is missing', () => {
    // When the owner turns the draft marker off, every operator field must be real.
    if (!LEGAL_DRAFT) expect(operatorProblems(OPERATOR)).toEqual([])
    else expect(LEGAL_DRAFT).toBe(true)
  })
  it('names every sub-processor with a purpose and a country', () => {
    for (const p of OPERATOR.processors) {
      expect(p.name).not.toBe('')
      expect(p.purpose.pl).not.toBe('')
      expect(p.country).not.toBe('')
    }
  })
})
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `content/legal/operator.ts`

```ts
// The legal operator of FinFlow and the sub-processors. The OWNER fills the empty fields (see the spec, "Що має
// зробити власник"). While LEGAL_DRAFT is true every legal page shows a "draft, under legal review" banner.
// operatorProblems() is also a unit-test guard: LEGAL_DRAFT may only be false when no field is empty.
export const LEGAL_DRAFT = true

export interface Processor {
  name: string
  /** What the processor does for FinFlow, per language. */
  purpose: { pl: string; en: string; uk: string }
  /** Where the data is processed. */
  country: string
}

export interface Operator {
  name: string
  legalForm: string
  nip: string
  address: string
  rodoEmail: string
  supportEmail: string
  processors: readonly Processor[]
}

export const OPERATOR: Operator = {
  name: '',
  legalForm: '',
  nip: '',
  address: '',
  rodoEmail: '',
  supportEmail: '',
  processors: [
    { name: 'Google Cloud (Firebase Authentication, Cloud Firestore)', purpose: { pl: 'Logowanie i baza danych aplikacji', en: 'Sign-in and the application database', uk: 'Вхід і база даних застосунку' }, country: 'EU / USA (SCC, DPF)' },
    { name: 'Vercel Inc.', purpose: { pl: 'Hosting i uruchamianie aplikacji', en: 'Hosting and running the application', uk: 'Хостинг і запуск застосунку' }, country: 'EU (fra1) / USA (SCC, DPF)' },
    { name: 'Enable Banking Oy', purpose: { pl: 'Odczyt danych rachunków bankowych na polecenie użytkownika (PSD2)', en: 'Reading bank account data on the user instruction (PSD2)', uk: 'Читання даних банківських рахунків за дорученням користувача (PSD2)' }, country: 'Finland (EU)' },
  ],
}

const FIELDS = ['name', 'legalForm', 'nip', 'address', 'rodoEmail', 'supportEmail'] as const
const PLACEHOLDER = /^\s*(todo|tbd|xxx|\?+|-+)?\s*$/i

/** The names of operator fields that are empty or still a placeholder. */
export function operatorProblems(operator: Operator): string[] {
  return FIELDS.filter((key) => PLACEHOLDER.test(operator[key]))
}
```

`lib/legal/content-types.ts`

```ts
// Shape of a legal document (typed content under content/legal/). Text may use the operator tokens
// {name} {legalForm} {nip} {address} {rodoEmail} {supportEmail}; they are filled when the page renders.
export type LegalBlock =
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  /** Renders the OPERATOR.processors list as a table (name, purpose, country). */
  | { kind: 'processors' }

export interface LegalSection { id: string; title: string; blocks: LegalBlock[] }
export interface LegalContent { title: string; intro: string; sections: LegalSection[] }
export const OPERATOR_TOKENS = ['name', 'legalForm', 'nip', 'address', 'rodoEmail', 'supportEmail'] as const
```

`content/legal/outline.ts` (section ids are the contract between the three languages)

```ts
import type { PublicLegalDoc } from '@/lib/legal/versions'

export const OUTLINE: Readonly<Record<PublicLegalDoc, readonly string[]>> = {
  terms: ['definitions', 'service', 'account', 'obligations', 'banking', 'liability', 'ip', 'termination', 'changes', 'law', 'dpa'],
  privacy: ['controller', 'purposes', 'data', 'recipients', 'transfers', 'retention', 'rights', 'cookies', 'automated'],
  cookies: ['what', 'list', 'storage', 'none'],
}
```

- [ ] **Step 4: Run, expect PASS.** `npx eslint lib/legal content tests/unit/legal`.
- [ ] **Step 5: Commit** `feat(legal): operator config, content types and section outline`

---

## Task 3: Firestore rules for `userConsents`

**Files:** Modify `firestore.rules`, `tests/rules/firestore.rules.test.ts`.

- [ ] **Step 1: Read** how an existing closed collection is tested (search `counterparty keys and rate limits are closed to every client` in the rules test, ~line 391) and copy its helpers.
- [ ] **Step 2: Add failing rules tests** (new `describe('user consents (S15a)', ...)`): (a) a signed-in user can `get` `userConsents/<own uid>`; (b) cannot `get` another uid's doc; (c) cannot `list` `userConsents`; (d) cannot `create`/`update`/`delete` their own doc; (e) cannot read or write `userConsents/<uid>/events/<id>`; (f) anonymous cannot read. Use the same `testEnv` contexts the neighbouring tests use.
- [ ] **Step 3: Run** the rules tests, expect FAIL on (a).
- [ ] **Step 4: Edit `firestore.rules`.** Add, next to the `_meta` block, inside `match /databases/{database}/documents`:

```
    // S15a: the record of the legal documents a user accepted. A person may read only their own record (the browser
    // shows the consent gate from it); every write is made by the server (POST /api/consent). The `events`
    // subcollection (proof per version) matches no rule: closed to clients.
    match /userConsents/{uid} {
      allow get: if isSignedIn() && request.auth.uid == uid;
    }
```

Update the header comment list at the top of the file (it lists server-only collections) with one sentence about `userConsents`.
- [ ] **Step 5: Run rules tests, expect PASS.**
- [ ] **Step 6: Commit** `feat(rules): userConsents readable by its owner, written by the server`

---

## Task 4: Server consent write and `POST /api/consent`

**Files:**
- Create: `lib/server/consent/index.ts`, `app/api/consent/route.ts`
- Test: `tests/integration/consent.test.ts`

- [ ] **Step 1: Check** `lib/i18n/negotiate.ts` (`resolveLocale`), `lib/i18n/config.ts` (the locale cookie name constant) and `lib/server/session-cookie.ts` (the cookie reader at line 13; export it if it is private) for the locale. Check `tests/integration/helpers.ts` for `testDb()` and `clearFirestore()`.
- [ ] **Step 2: Write the failing integration test** `tests/integration/consent.test.ts`

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { LEGAL_VERSIONS } from '@/lib/legal/versions'
import { recordConsent } from '@/lib/server/consent'
import { clearFirestore, readDoc, testDb } from './helpers'

const db = testDb()
const UID = 'consent-user'
const NOW = new Date('2026-11-21T10:00:00Z')
const docs = { terms: LEGAL_VERSIONS.terms, privacy: LEGAL_VERSIONS.privacy }

describe('recordConsent', () => {
  beforeEach(async () => { await clearFirestore() })

  it('writes the state and one event per document in one go', async () => {
    const state = await recordConsent(db, UID, { docs, source: 'register' }, 'pl', NOW)
    expect(state.terms).toEqual({ version: docs.terms, at: NOW.toISOString(), locale: 'pl' })
    expect(state.privacy?.version).toBe(docs.privacy)
    expect((await readDoc(`userConsents/${UID}`))?.terms.version).toBe(docs.terms)
    const events = await db.collection(`userConsents/${UID}/events`).get()
    expect(events.docs.map((d) => d.data().doc).sort()).toEqual(['privacy', 'terms'])
    expect(events.docs.every((d) => d.data().source === 'register' && d.data().locale === 'pl')).toBe(true)
  })

  it('is idempotent: the same versions again write nothing new', async () => {
    await recordConsent(db, UID, { docs, source: 'register' }, 'pl', NOW)
    await recordConsent(db, UID, { docs, source: 'gate' }, 'en', new Date('2026-11-22T10:00:00Z'))
    expect((await db.collection(`userConsents/${UID}/events`).get()).size).toBe(2)
    expect((await readDoc(`userConsents/${UID}`))?.terms.locale).toBe('pl')
  })

  it('records only the document whose version changed', async () => {
    await db.doc(`userConsents/${UID}`).set({
      terms: { version: '2020-01-01', at: '2020-01-01T00:00:00.000Z', locale: 'pl' },
      privacy: { version: docs.privacy, at: '2026-01-01T00:00:00.000Z', locale: 'pl' },
    })
    await recordConsent(db, UID, { docs, source: 'gate' }, 'uk', NOW)
    const events = await db.collection(`userConsents/${UID}/events`).get()
    expect(events.docs.map((d) => d.data().doc)).toEqual(['terms'])
    expect((await readDoc(`userConsents/${UID}`))?.privacy.at).toBe('2026-01-01T00:00:00.000Z')
  })
})
```

- [ ] **Step 3: Run (emulator), expect FAIL.**
- [ ] **Step 4: Implement** `lib/server/consent/index.ts`

```ts
import type { Firestore } from 'firebase-admin/firestore'
import { parseConsentState, type ConsentInput, type ConsentState } from '@/lib/legal/consent'
import { CONSENT_DOCS } from '@/lib/legal/versions'

/**
 * Records that `uid` accepted the given versions. One transaction: the state document and one event per CHANGED
 * document. Idempotent: documents already at that version write nothing. `locale` is the language the person saw.
 */
export async function recordConsent(db: Firestore, uid: string, input: ConsentInput, locale: string, now: Date): Promise<ConsentState> {
  const ref = db.doc(`userConsents/${uid}`)
  return db.runTransaction(async (t) => {
    const state = parseConsentState((await t.get(ref)).data())
    const at = now.toISOString()
    const next: ConsentState = { ...state }
    for (const doc of CONSENT_DOCS) {
      if (state[doc]?.version === input.docs[doc]) continue
      next[doc] = { version: input.docs[doc], at, locale }
      t.create(ref.collection('events').doc(), { doc, version: input.docs[doc], at, locale, source: input.source })
    }
    if (CONSENT_DOCS.some((doc) => next[doc] !== state[doc])) t.set(ref, next)
    return next
  })
}
```

`app/api/consent/route.ts`: follow `app/api/orgs/[orgId]/imports/finmap/finish/route.ts` for shape.

```ts
import { requireUser } from '@/lib/server/auth'
import { getAdmin } from '@/lib/server/firebase-admin'
import { HttpError, errorResponse } from '@/lib/server/http-error'
import { readJsonBody } from '@/lib/server/request-body'
import { recordConsent } from '@/lib/server/consent'
import { parseConsentBody } from '@/lib/legal/consent'
import { resolveLocale } from '@/lib/i18n/negotiate'

export const runtime = 'nodejs'
const MAX_BODY = 512

// POST /api/consent  { docs: { terms, privacy }, source }  ->  { state }
// Any signed-in user (a verified email is NOT required: the person accepts before verifying). 409 `stale_version`
// when the browser still has an older bundle (the person reloads), 400 `invalid_input` for a bad body.
export async function POST(req: Request) {
  try {
    const { uid } = await requireUser(req)
    const parsed = parseConsentBody(await readJsonBody(req, MAX_BODY))
    if (!parsed.ok) throw new HttpError(parsed.reason === 'stale' ? 409 : 400, parsed.reason === 'stale' ? 'stale_version' : 'invalid_input')
    const locale = resolveLocale({ cookie: /* the locale cookie value, see Step 1 */ readLocaleCookie(req.headers), acceptLanguage: req.headers.get('accept-language') })
    const state = await recordConsent(getAdmin().db, uid, parsed.value, locale, new Date())
    return Response.json({ state }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(e)
  }
}
```

Define `readLocaleCookie` as a small exported helper next to the other cookie reader (using the locale cookie name constant found in Step 1). Add rate limiting only if `enforceRateLimit` fits a new scope cheaply; otherwise skip it (the body is tiny and writes are idempotent) and note that in the commit body.
- [ ] **Step 5: Run the integration test, expect PASS.** Add one route-level unit test only if an existing route test pattern in `tests/unit/api/` can be copied in under 20 lines (401 without a cookie is already covered by the e2e api-guards test in Task 14).
- [ ] **Step 6: Typecheck + lint, commit** `feat(consent): record accepted document versions on the server`

---

## Task 5: Browser side of consent: client, hook, `ConsentGate`

**Files:**
- Create: `lib/api/consent-client.ts`, `lib/hooks/useConsent.ts`, `components/consent/ConsentGate.tsx`
- Modify: `components/shell/AppShell.tsx`, `messages/{uk,pl,en}.json`
- Test: `tests/unit/consent/gate-state.test.ts`

- [ ] **Step 1: Pure state function + failing test.** In `lib/legal/consent.ts` add and export:

```ts
export type GateStatus = 'loading' | 'ok' | 'needed' | 'unknown'
/** `read` is what the browser got from userConsents/{uid}: undefined while loading, 'error' when the read failed. */
export function gateStatus(read: ConsentState | null | undefined | 'error'): GateStatus {
  if (read === undefined) return 'loading'
  if (read === 'error') return 'unknown'
  return needsConsent(read) ? 'needed' : 'ok'
}
```

Test in `tests/unit/consent/gate-state.test.ts`: `undefined`→`loading`; `'error'`→`unknown` (never blocks: an offline browser must not lock a person out); `null`→`needed`; full current state→`ok`.
- [ ] **Step 2: Client** `lib/api/consent-client.ts`: `export async function acceptLegalDocs(source: ConsentSource): Promise<void>` does `fetch('/api/consent', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ docs: LEGAL_VERSIONS, source }) })` and throws an `Error` carrying `status` on a non-2xx (copy how `lib/firebase/orgs-client.ts` calls its API and reports failures).
- [ ] **Step 3: Hook** `lib/hooks/useConsent.ts`: subscribes with `onSnapshot(doc(db, 'userConsents', uid))` (client Firestore instance exported from `lib/firebase/firebase.ts`; check its export name) while a user is signed in; returns `{ status: GateStatus, state }`. The snapshot callback sets state (never set state synchronously in the effect body: React Compiler). A snapshot error → `'error'`. Unsubscribe on cleanup. No user → `undefined` is NOT used; return `{ status: 'unknown' }` so the gate does nothing without a user.
- [ ] **Step 4: Gate** `components/consent/ConsentGate.tsx`: when `status === 'needed'` render a non-dismissible Dialog (`components/ui/dialog`; no close button, `onOpenChange` ignored, `onEscapeKeyDown`/`onInteractOutside` prevented): title, a sentence, links to `/legal/terms` and `/legal/privacy` (`target="_blank"`), primary button "Akceptuję" (calls `acceptLegalDocs('gate')`; on 409 shows a "reload the page" message; on other errors a toast), secondary "Wyloguj się" (`useAuth().signOut`). After a successful accept the snapshot flips the status to `ok` by itself. Mount `<ConsentGate />` once in `AppShell` (just before the closing root div; the dialog is a portal).
- [ ] **Step 5: Messages.** Add the namespace `consent.gate` with keys `title`, `body`, `terms`, `privacy`, `accept`, `signOut`, `accepting`, `reload`, `failed` in `uk`, `pl`, `en` (insert as text; identical keys). Polish wording for `accept`: `Akceptuję`; `signOut`: `Wyloguj się`. Check parity with `tests/unit/i18n` key-parity test.
- [ ] **Step 6: Run** unit tests (`tests/unit/consent`, `tests/unit/i18n`), typecheck, eslint. Commit `feat(consent): in-app gate that asks again when a document version changes`

---

## Task 6: Legal page infrastructure and the Cookies document

**Files:**
- Create: `content/legal/index.ts`, `content/legal/cookies.{pl,en,uk}.ts`, `components/legal/{LegalDocument,LegalLinks,DraftBanner}.tsx`, `app/legal/[doc]/page.tsx`
- Modify: `app/sitemap.ts`, `messages/{uk,pl,en}.json`
- Test: `tests/unit/legal/content.test.ts`

- [ ] **Step 1: Failing content test** `tests/unit/legal/content.test.ts`. For each doc in `PUBLIC_LEGAL_DOCS` and each locale in `['pl','en','uk']` (import through `content/legal/index.ts`, `getLegalContent(doc, locale)`): section ids equal `OUTLINE[doc]` in order; no section has empty blocks; every `{token}` in any text is one of `OPERATOR_TOKENS`; after `fillOperator(text, OPERATOR)` no `{` remains. Write the test now; it fails until all 9 files exist, so in this task temporarily restrict the loop to `cookies` and extend it in Tasks 7 and 8 (leave a `// extended in Task 7/8` marker the later tasks remove).
- [ ] **Step 2: `content/legal/index.ts`**

```ts
import { OUTLINE } from './outline'
import type { LegalContent } from '@/lib/legal/content-types'
import type { Operator } from '@/content/legal/operator'
import type { PublicLegalDoc } from '@/lib/legal/versions'
import type { Locale } from '@/lib/i18n/config'
import { cookiesPl } from './cookies.pl'
import { cookiesEn } from './cookies.en'
import { cookiesUk } from './cookies.uk'
// terms and privacy are imported in Tasks 7 and 8

const CONTENT: Partial<Record<PublicLegalDoc, Record<Locale, LegalContent>>> = {
  cookies: { pl: cookiesPl, en: cookiesEn, uk: cookiesUk },
}

export function getLegalContent(doc: PublicLegalDoc, locale: Locale): LegalContent {
  const byLocale = CONTENT[doc]
  if (!byLocale) throw new Error(`no legal content for ${doc}`)
  return byLocale[locale]
}

export function fillOperator(text: string, operator: Operator): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in operator ? String((operator as unknown as Record<string, unknown>)[key]) || '[…]' : whole))
}

export { OUTLINE }
```

(Check the actual `Locale` type export in `lib/i18n/config.ts`.) An empty operator field renders as `[…]` so a draft page never shows a raw token.
- [ ] **Step 3: Cookies content (3 languages).** Each file exports a `LegalContent` with sections `what`, `list`, `storage`, `none` and Polish as the authoritative text (EN/UA add one sentence that the Polish version prevails). Requirements:
  - `list`: a table with columns (name, purpose, lifetime, type) and exactly two rows: `__session` (keeps you signed in; HttpOnly, SameSite=Lax, 7 days, strictly necessary) and `NEXT_LOCALE` (remembers the interface language; 1 year, strictly necessary, not HttpOnly).
  - `storage`: first run `grep -rn "localStorage\|sessionStorage" app components lib --include=*.ts --include=*.tsx` (files known: `components/charts/BalanceSheet.tsx`, `lib/domain/transfers/dismissed.ts`, `lib/hooks/useOrg.tsx`, `lib/hooks/useShell.tsx`, `lib/shell/sidebar-store.ts`), read each, and list the exact keys and their purpose (UI preferences stored only in the browser, never sent to the server). The text must match the code you read.
  - `none`: no analytics, advertising or tracking cookies; no third-party scripts; fonts are served by us.
  - `what`: what a cookie is, why only these two are used, how to delete them in the browser.
  - Use tokens only where an operator detail is needed (`{supportEmail}`).
- [ ] **Step 4: Components.**
  - `DraftBanner`: renders only when `LEGAL_DRAFT`; text from `messages` `legal.draft` (role="note").
  - `LegalDocument({ doc, locale })`: server component; `<h1>`, intro, and each section as `<section id>` with `<h2>`; blocks → `<p>`, `<ul>`, `<table>` (with `<th scope>`), `processors` → table from `OPERATOR.processors` localized by locale; a small table of contents with anchors at the top; shows the current version for `terms`/`privacy` (`legal.version` message + `LEGAL_VERSIONS`).
  - `app/legal/[doc]/page.tsx`: `generateStaticParams` over `PUBLIC_LEGAL_DOCS`; `notFound()` when `isPublicLegalDoc` fails; `generateMetadata` with the document title; layout: a simple header with the FinFlow name linking to `/`, the `LanguageSwitcher` (check `components/i18n/LanguageSwitcher`), the draft banner, the document, then `LegalLinks`. Locale from `getLocale()` (next-intl server). Remember the root layout is already dynamic (reads the locale), so "static" here means no per-request data.
  - `LegalLinks`: a row of three links (Regulamin, Polityka prywatności, Cookies) with labels from `legal.links.*`.
- [ ] **Step 5: Sitemap** add the three `/legal/<doc>` URLs (`changeFrequency: 'yearly'`, priority 0.3).
- [ ] **Step 6: Messages** `legal.draft`, `legal.version`, `legal.links.{terms,privacy,cookies}`, `legal.toc`, `legal.processors.{name,purpose,country}`, `legal.tables.{name,purpose,lifetime,type}` in all three languages.
- [ ] **Step 7: Run** content test, i18n tests, typecheck, eslint. Commit `feat(legal): legal page shell and the Cookies document in PL/EN/UA`

---

## Task 7: Polityka prywatności (PL/EN/UA)

**Files:** Create `content/legal/privacy.{pl,en,uk}.ts`; modify `content/legal/index.ts`, `tests/unit/legal/content.test.ts` (remove the Task 6 restriction for `privacy`).

Write Polish first (authoritative), then EN and UA as faithful translations with the "Polish version prevails" sentence in the intro. Sections in the order of `OUTLINE.privacy`. Use operator tokens for the controller details. Required content per section (do not invent facts; everything must be true of the app as built, check the code when unsure):

- `controller`: {name} {legalForm}, {address}, NIP {nip}; contact for data protection {rodoEmail}. States the two roles: controller of sign-in/account data; processor of the company's business data (reference to the processing annex in the terms, section `dpa`).
- `purposes`: table (purpose, data, legal basis): providing the account and the service (art. 6(1)(b)); security, abuse prevention, logs and rate limits (art. 6(1)(f)); legal duties and claims (art. 6(1)(c)/(f)); proof of accepted documents (art. 6(1)(f) and art. 7(1) accountability). No marketing in this version.
- `data`: name, email, password hash held by Firebase Authentication (we never see the password), company name and currency, content the user enters (processed as processor), technical data (IP address and user agent in server logs, request counters for rate limits), consent records (document, version, time, language), bank data read through Enable Banking on the user's instruction (read-only PSD2 access).
- `recipients`: the processors from `OPERATOR.processors` (use the `processors` block), the user's accountants/members of the same company, authorities when the law requires.
- `transfers`: Google and Vercel may process data outside the EEA; safeguards: Standard Contractual Clauses and/or EU–US Data Privacy Framework (state it as "where available", do not claim certifications you cannot verify).
- `retention`: account data while the account exists; company data until the owner deletes the company or asks for erasure; consent records as long as needed to prove consent; logs for a short period (say "no longer than needed for security; the exact period is set in the operations spec S15b" — do not invent a number); erasure on written request within one month.
- `rights`: access, rectification, erasure, restriction, portability (the owner can export company data in Settings → Privacy and data), objection, withdrawal of consent, complaint to the President of UODO (Prezes Urzędu Ochrony Danych Osobowych); how to exercise them ({rodoEmail}, answer within one month).
- `cookies`: one paragraph and a link to `/legal/cookies` (write the path as plain text; the renderer does not parse links).
- `automated`: no automated decision-making or profiling that produces legal effects.
- [ ] Extend the content test to cover `privacy`, run it, run i18n/lint/typecheck. Commit `feat(legal): privacy policy in PL/EN/UA`

---

## Task 8: Regulamin with the processing annex (PL/EN/UA)

**Files:** Create `content/legal/terms.{pl,en,uk}.ts`; modify `content/legal/index.ts`, `tests/unit/legal/content.test.ts`.

Polish authoritative; EN/UA translations with the prevail sentence. Sections in the order of `OUTLINE.terms`. Required content:

- `definitions`: Usługodawca ({name}), Użytkownik, Konto, Firma (organization), Usługa, Dane Firmy.
- `service`: what FinFlow does (cash-flow and management accounting for small businesses: accounts, operations, reports, imports, bank connection); **beta status**: no SLA, features may change, free during the beta, payments arrive later with a separate notice (no billing is implemented).
- `account`: registration, one person one account, email verification, keeping the password safe, roles in a company (owner, accountant, viewer), the owner is responsible for who has access.
- `obligations`: lawful use, no abuse or attempts to break the service, accuracy of entered data is the user's responsibility, the service does not replace bookkeeping or tax advice.
- `banking`: read-only access through Enable Banking under PSD2 on the user's instruction; the user can end the connection at any time; the bank access ends at the date set by the bank (up to 90 days) and must be renewed; FinFlow never moves money.
- `liability`: beta without warranty to the extent the law allows; no liability for data the user entered incorrectly or for bank outages; liability limits only as far as the law allows (state that nothing excludes liability that cannot be excluded). Mark this section "to be confirmed by the lawyer" in an XML comment in the source file (comments are not rendered).
- `ip`: the service and its code belong to the Usługodawca; the user keeps all rights to Dane Firmy and gives a licence only to run the service.
- `termination`: the user may stop at any time; on request the owner can export (Settings → Privacy and data) and the data is erased within one month of a written request to {rodoEmail}; the provider may suspend for abuse.
- `changes`: how the Regulamin changes; a material change gets a new version and the app asks for acceptance again before use.
- `law`: Polish law; consumer rights are not limited (users here are businesses, say so); complaints to {supportEmail}, answered within 14 days; courts by the general rules.
- `dpa` (Annex: powierzenie przetwarzania danych osobowych, art. 28 RODO): subject and duration (while the Firma uses the Service); nature and purpose (storing and processing the Firma's accounting data to provide the Service); categories of data (contact data of counterparties, names and descriptions of operations, bank operation data) and persons (the Firma's counterparties, employees, contractors); processor duties (process only on documented instructions, confidentiality, security measures: TLS, access control by role, Firestore security rules, server-side writes, session cookies HttpOnly; assistance with data subject requests, breach notice without undue delay, return or erasure at the end); **sub-processors** (the `processors` block) and the rule that the Firma is informed of changes; transfers outside the EEA (as in the privacy policy); audit: on request, once a year, with notice.
- [ ] Extend the content test to cover `terms` (all 9 files now), run it, i18n/lint/typecheck. Commit `feat(legal): Regulamin with the processing annex in PL/EN/UA`

---

## Task 9: Consent at registration and links in footers

**Files:** Modify `app/(auth)/register/page.tsx`, `app/(auth)/login/page.tsx`, `app/pricing/page.tsx`, `app/page.tsx`, `messages/{uk,pl,en}.json`, `tests/e2e/helpers/app-ui.ts`.

- [ ] **Step 1: Register form.** Add state `accepted` (boolean). Render a required checkbox (`components/ui` has no checkbox? use a native `<input type="checkbox" id="accept">` styled like neighbours, with `<Label htmlFor>`) after the currency select: label text from `auth.register.accept` with two inline links (`next-intl` rich text: `t.rich('accept', { terms: (c) => <Link href="/legal/terms" target="_blank">{c}</Link>, privacy: ... })`). The two submit paths (email form and Google button, and the company-only form) are disabled until `accepted`; `handleSubmit` and `handleGoogle` return early with a toast `auth.register.acceptRequired` if not accepted (defence in depth). Company-only mode (a signed-in user without a company) shows the checkbox too unless `useConsent` already says `ok`; keep it simple: show it always on this page.
- [ ] **Step 2: Record it.** After `signUp(...)` succeeds (and after `signInGoogle()` creates a company), call `acceptLegalDocs('register')` / `acceptLegalDocs('google')` inside try/catch that only `console.error`s a failure (the gate will ask again on first entry; the account already exists). Do it BEFORE `goToOrg`, awaited, so the gate sees the record. For a Google user who already has a company and arrives at `/register`, skip recording (they pass through the gate if needed).
- [ ] **Step 3: Footers.** Add `<LegalLinks />` to the bottom of the login page, the register page, `app/pricing/page.tsx` and `app/page.tsx` (landing). Landing/pricing are not covered by the Cyrillic guard but `LegalLinks` uses messages anyway.
- [ ] **Step 4: Messages** `auth.register.accept` (rich: `Akceptuję <terms>Regulamin</terms> i zapoznałem/am się z <privacy>Polityką prywatności</privacy>.`; uk/en equivalents), `auth.register.acceptRequired`.
- [ ] **Step 5: e2e helper.** In `registerViaUi` (`tests/e2e/helpers/app-ui.ts`) tick the checkbox before submitting: `await page.getByRole('checkbox', { name: /Регламент|Умови|Regulamin/ }).check()` using the Ukrainian label (e2e runs in `uk`; write the exact uk label from your `uk.json` text into the locator). Then run `grep -rn "createEmulatorUser\|signInEmulatorUser" tests/e2e` and for each spec that signs a created user in through the UI and then looks at the shell, seed their consent first: add a helper `seedConsent(request, uid)` in `tests/e2e/helpers/emulator-firestore.ts` that `seedDoc`s `userConsents/<uid>` with the current `LEGAL_VERSIONS` and call it after the user exists. (API-only specs need nothing.)
- [ ] **Step 6: Run** typecheck, eslint, i18n tests. Commit `feat(auth): required consent checkbox at registration and legal links in footers`

---

## Task 10: Settings → Privacy and data (page, consent card) and the section plumbing

**Files:** Create `components/settings/privacy/ConsentCard.tsx`, `app/(app)/[orgSlug]/settings/privacy/page.tsx`; modify `lib/shell/settings-sections.ts`, `messages/{uk,pl,en}.json`, `tests/e2e/app-shell.spec.ts`, `tests/unit/shell` tests that count sections.

- [ ] **Step 1:** In `lib/shell/settings-sections.ts` add `'privacy'` to `SettingsSection` and to `SETTINGS_SECTIONS` (last but one, before `subscription`). No `REQUIRED_ACTION` entry (every member may open it).
- [ ] **Step 2:** Messages: `shell.settingsSections.privacy` (`Приватність і дані` / `Prywatność i dane` / `Privacy and data`), plus `privacy.page.*` and `privacy.consent.*` keys (title, accepted documents with version and date, links to the three documents, a note that the owner can export company data and how to ask for erasure by email to the operator address — the address itself comes from `OPERATOR.rodoEmail`, shown only when non-empty).
- [ ] **Step 3:** `ConsentCard` (client) reads `useConsent().state` and lists each document: name (link), accepted version, accepted date formatted with `useFormatters`; shows "not accepted yet" when missing.
- [ ] **Step 4:** `page.tsx`: follows the pattern of `settings/language/page.tsx`: heading, `ConsentCard`, and (Task 12) the `ExportCard` for the owner. For now render only the consent card and a placeholder-free empty owner area (nothing).
- [ ] **Step 5: Tests.** Update the unit tests that assert the section list/labels (`tests/unit/shell/labels.test.ts` already loops sections; add any hard-coded count). In `tests/e2e/app-shell.spec.ts` change the test title and its assertions from eight to nine sections (find the list assertion near line 264–300) and add the "Приватність і дані" entry.
- [ ] **Step 6: Run** unit tests for shell and i18n, typecheck, eslint. Commit `feat(settings): Privacy and data section with the accepted documents`

---

## Task 11: Export: collections, paged read, routes (server)

**Files:**
- Create: `lib/domain/export/collections.ts`, `lib/server/export/read.ts`, `app/api/orgs/[orgId]/export/data/route.ts`, `app/api/me/export/route.ts`
- Modify: `lib/server/ledger/audit.ts`
- Test: `tests/unit/export/collections.test.ts`, `tests/integration/export.test.ts`

- [ ] **Step 1: Domain list** `lib/domain/export/collections.ts`

```ts
// The collections a company export contains. A CLOSED list: derived and technical collections (rollups, ledger,
// counterpartyKeys, tagKeys, bankSeen, bankAccounts, recurringDone, importLocks) are rebuilt from these and are not
// exported. `organization` is the company document itself.
export const EXPORT_COLLECTIONS = ['organization', 'members', 'accounts', 'categories', 'counterparties', 'tags', 'transactions', 'rules', 'recurring', 'imports', 'audit', 'bankConnections'] as const
export type ExportCollection = (typeof EXPORT_COLLECTIONS)[number]
export function isExportCollection(v: unknown): v is ExportCollection {
  return typeof v === 'string' && (EXPORT_COLLECTIONS as readonly string[]).includes(v)
}
export const EXPORT_PAGE_DOCS = 500
export const EXPORT_PAGE_BYTES = 900_000
```

Unit test: the list has no duplicates, contains no technical name, `isExportCollection('bankSeen')` is false.
- [ ] **Step 2: Add** `'data.export'` to `AuditAction` in `lib/server/ledger/audit.ts` (comment: one entry per finished company export, `after: { counts }`, no content). Fix any exhaustive switch the typechecker reports.
- [ ] **Step 3: Failing integration test** `tests/integration/export.test.ts` using `testDb()` and `seedOrg` (see `tests/integration/helpers.ts`): seed an org with 1200 small `transactions` docs, a `bankConnections` doc that also carries a fake secret field (`accessToken: 'SECRET'`), a `rollups` doc, and a Timestamp field. Assert: (a) `readExportPage(db, ORG, 'transactions', null)` returns ≤500 docs and a `next` cursor; following `next` until null returns all 1200 exactly once in id order; (b) a `bankConnections` doc comes back WITHOUT `accessToken` and with only the fields of `parseConnection` (`sessionId`, `institutionName`, `institutionCountry`, `psuType`, `connectedAt`, `validUntil`, `status`); (c) Timestamps are ISO strings; (d) `organization` returns the org doc once with `next: null`; (e) a page never exceeds `EXPORT_PAGE_BYTES` serialized (seed a few large docs) yet always makes progress (at least one doc).
- [ ] **Step 4: Implement** `lib/server/export/read.ts`

```ts
import { FieldPath, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { EXPORT_PAGE_BYTES, EXPORT_PAGE_DOCS, type ExportCollection } from '@/lib/domain/export/collections'
import { parseConnection } from '@/lib/server/banking/types'

export interface ExportDoc { id: string; data: Record<string, unknown> }
export interface ExportPage { docs: ExportDoc[]; next: string | null }

/** Firestore Timestamps become ISO strings; everything else is copied as stored (money stays integer minor units). */
export function serializeValue(v: unknown): unknown {
  if (v instanceof Timestamp) return v.toDate().toISOString()
  if (Array.isArray(v)) return v.map(serializeValue)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, serializeValue(x)]))
  return v
}

function shape(collection: ExportCollection, id: string, raw: Record<string, unknown>): ExportDoc | null {
  if (collection === 'bankConnections') {
    const c = parseConnection({ ...raw, sessionId: raw.sessionId ?? id })
    return c ? { id, data: { ...c } } : null // an unreadable connection document is skipped, never exported raw (it may hold secrets)
  }
  return { id, data: serializeValue(raw) as Record<string, unknown> }
}

export async function readExportPage(db: Firestore, orgId: string, collection: ExportCollection, after: string | null): Promise<ExportPage> {
  const orgRef = db.doc(`organizations/${orgId}`)
  if (collection === 'organization') {
    const snap = await orgRef.get()
    return { docs: snap.exists ? [{ id: snap.id, data: serializeValue(snap.data()) as Record<string, unknown> }] : [], next: null }
  }
  let q = orgRef.collection(collection).orderBy(FieldPath.documentId()).limit(EXPORT_PAGE_DOCS + 1)
  if (after !== null) q = q.startAfter(after)
  const snap = await q.get()
  const docs: ExportDoc[] = []
  let bytes = 0
  let consumed = 0
  for (const d of snap.docs.slice(0, EXPORT_PAGE_DOCS)) {
    const shaped = shape(collection, d.id, d.data())
    const size = shaped ? JSON.stringify(shaped).length : 0
    if (docs.length > 0 && bytes + size > EXPORT_PAGE_BYTES) break
    consumed++
    if (shaped) { docs.push(shaped); bytes += size }
  }
  const more = consumed < snap.docs.length
  return { docs, next: more ? snap.docs[consumed - 1].id : null }
}
```

Check `parseConnection` is exported from `lib/server/banking/types.ts` (it is, line 56). Note `next` is the id of the last CONSUMED doc (also when that doc was skipped), so the cursor advances even if the last doc of a page was skipped.
- [ ] **Step 5: Routes.** `app/api/orgs/[orgId]/export/data/route.ts`:
  - `GET ?collection=&after=` → `requireVerifiedUser` (no: use `requireUser`+ owner check is enough; keep `requireVerifiedUser` because data leaves the system), `requireOrgRole(uid, orgId, ['owner'])`, validate `collection` with `isExportCollection` (400 `invalid_input`), `after` string ≤ 200 chars; returns `readExportPage` JSON with `Cache-Control: no-store`. Add rate limiting if `enforceRateLimit` has a suitable scope (`reports` window is a reasonable reuse; check `REPORT_LIMITS` is large enough for ~100 page calls, else add a dedicated `export` scope with ≥ 120 requests per minute).
  - `POST { counts: Record<ExportCollection, number> }` (max body 2 KB; counts validated as non-negative integers for known collections) → writes ONE audit entry `data.export` via `auditData` into `organizations/{org}/audit` (`before: null`, `after: { counts }`, `targetId: orgId`), returns `{ ok: true }`.
  `app/api/me/export/route.ts`: `GET` → `requireUser`; returns `{ uid, email, displayName, createdAt, memberships: [{ orgId, role }], consents: <state doc or null> }` using `getAdmin().auth.getUser(uid)` and the existing server membership lookup (search `lib/server/orgs.ts` for the function that lists a user's memberships; reuse it, do not duplicate the collection-group query).
- [ ] **Step 6: Run** unit + integration tests, typecheck, eslint, `npm run check:server-imports`. Commit `feat(export): paged owner-only company export with an allow-listed bank connection`

---

## Task 12: Export in the browser: ZIP builder and the Settings card

**Files:**
- Create: `content/legal/export-readme.ts`, `lib/api/export-client.ts`, `components/settings/privacy/ExportCard.tsx`
- Modify: `app/(app)/[orgSlug]/settings/privacy/page.tsx`, `messages/{uk,pl,en}.json`
- Test: `tests/unit/export/zip.test.ts`

- [ ] **Step 1: README text** `content/legal/export-readme.ts` exports `exportReadme(orgName: string, dateIso: string): string` returning one text with the same short explanation in Polish, English and Ukrainian (what the ZIP holds: one `.json` per collection, `me.json`; amounts are integers in minor units (grosze) as stored; what is NOT included and why (derived and technical collections are rebuilt from the data; bank access tokens are never exported); date). It lives under `content/` so the Cyrillic guard does not scan it.
- [ ] **Step 2: Failing test** `tests/unit/export/zip.test.ts` for the pure builder `buildExportZip(files: Record<string, string>): Uint8Array` (in `lib/api/export-client.ts` or a pure sibling `lib/domain/export/zip.ts`; prefer the sibling so the test needs no fetch): unzip the result with `unzipSync` from `fflate` and assert the names and the text content round-trip, and that `exportFileName('Acme Sp. z o.o.', '2026-11-21')` returns `finflow-acme-sp-z-o-o-2026-11-21.zip` (lowercase, non-alphanumerics collapsed to `-`; reuse `lib/utils/download.ts#exportFileName` if it already does this, otherwise add it there with this test).
- [ ] **Step 3: Client driver** `lib/api/export-client.ts`: `runExport(orgId, { onProgress, signal }): Promise<{ blob: Blob; counts: Record<ExportCollection, number> }>`: for each collection in `EXPORT_COLLECTIONS` loop `GET /api/orgs/{orgId}/export/data?collection=&after=` until `next === null`, accumulating docs (check `signal.aborted` between pages; throw an `AbortError`), then fetch `/api/me/export`, then build files (`<collection>.json` = `JSON.stringify(docs.map(d => ({ id: d.id, ...d.data })))`, `me.json`, `README.txt`), zip, return the blob. After a successful build call `POST .../export/data` with the counts to write the audit entry (a failure of that call is reported but does not discard the file). One retry per page request on a network error (copy the retry style of `lib/api/finmap-client.ts`).
- [ ] **Step 4: `ExportCard`** (client): visible only when `role === 'owner'` (`useShell().role`); a button "Pobierz wszystkie dane" with progress (`collection N/12` plus docs so far), a Cancel button while running, success toast, error toast with the reason; downloads with `downloadBlob` from `lib/utils/download.ts` (add it if only `downloadText` exists). Messages `privacy.export.*` in three languages. Add the card to the privacy page under the consent card.
- [ ] **Step 5: Measure** (not guess): in `tests/integration/export.test.ts` add an opt-in perf test gated by `EXPORT_PERF=<docs>` like `finmap-perf.test.ts` that seeds N transactions, pages them through `readExportPage`, and writes the elapsed time and page count with `process.stdout.write`. Run it once with 5000 and record the number in the PR text; label 40k as an estimate.
- [ ] **Step 6: Run** unit tests, typecheck, eslint, i18n parity. Commit `feat(export): browser-built ZIP of all company data in Settings`

---

## Task 13: Erasure scripts

**Files:**
- Create: `scripts/lib/erase.ts`, `scripts/erase-org.ts`, `scripts/erase-user.ts`
- Modify: `lib/server/banking/eb-api.ts` (a session delete call), `package.json` (scripts)
- Test: `tests/integration/erase.test.ts`

- [ ] **Step 1: EB client.** Read `lib/server/banking/eb-api.ts` (interface at ~line 38, `getSession` at ~149). Add `deleteSession(sessionId: string): Promise<void>` to the interface and the client: `DELETE /sessions/{id}` through the same authenticated helper the other calls use (add a `del` helper next to `get`); a 404 or an already-closed session counts as success (`consent_expired` classification already exists). Cover it with the stub-based unit test pattern used for the other client calls (`tests/unit/` for eb-api). **Not verified against the real provider; say so in the PR.**
- [ ] **Step 2: Failing integration test** `tests/integration/erase.test.ts` against the emulator Firestore with injected fakes:

```ts
// shape the tests drive (implement to match)
interface EraseAuth { getUserByEmail(email: string): Promise<{ uid: string }>; deleteUser(uid: string): Promise<void> }
interface EraseDeps { db: Firestore; auth: EraseAuth; revokeBankSession(sessionId: string): Promise<void>; now: () => Date }
// planOrgErase(deps, orgId) -> { orgId, collections: Record<string, number>, bankSessions: string[], members: number }
// executeOrgErase(deps, orgId, { skipBankRevoke }) -> { counts, revoked: number }   (throws EraseError('bank_revoke_failed') before deleting anything)
// planUserErase(deps, ref: { uid?: string; email?: string }) -> { uid, memberships: {orgId, role}[], soleOwnerOf: string[] }
// executeUserErase(deps, ref) -> { counts }    (throws EraseError('sole_owner', orgIds) when soleOwnerOf is not empty)
```

Cases: (1) `planOrgErase` counts every subcollection and changes nothing; (2) `executeOrgErase` deletes the org doc and all subcollections (seed accounts, transactions, members, bankConnections, bankSeen, audit) and writes one `_meta/erasures/log/{id}` entry with `kind: 'org'`, `idHash` = sha256 of the orgId, `at`, `counts` and NO org name/email; (3) a failing `revokeBankSession` throws and leaves everything in place; with `skipBankRevoke` it proceeds; (4) `planUserErase` reports `soleOwnerOf` for an org where the user is the only owner; (5) `executeUserErase` refuses when `soleOwnerOf` is non-empty and changes nothing; (6) for a user who is an `accountant` in two orgs it deletes both membership docs, `userConsents/{uid}` and its `events`, calls `auth.deleteUser`, and logs `kind: 'user'`; (7) audit docs of other orgs that name the user are left in place — the test seeds an audit entry containing only `uid` and asserts it still exists; also assert, by seeding an audit entry with `email`, that the executor **removes the `email` and `name` fields** from audit entries written by that uid (find them with `collectionGroup('audit').where('uid', '==', uid)`; first check with `grep -n "email\|name" lib/server/ledger/audit.ts` that normal entries do not carry them — if they never do, keep the test as a safety net and the scrub as a no-op-safe step).
- [ ] **Step 3: Implement** `scripts/lib/erase.ts` with those functions. Rules: counts come from `ref.listCollections()` + `.count().get()`; deletion with `db.recursiveDelete(orgRef)` (Admin SDK); the sole-owner check reads `organizations/{org}/members` where `role == 'owner'` and compares to the uid; the log write is the LAST step and uses a hashed id; every function returns plain counts, never document content. `EraseError` has `code` (`sole_owner`, `bank_revoke_failed`, `not_found`) and `detail` (org ids or session count, never names).
- [ ] **Step 4: Thin CLIs.** `scripts/erase-org.ts <orgId> [--apply --confirm=<orgId>] [--skip-bank-revoke]` and `scripts/erase-user.ts <uid|email> [--apply --confirm=<uid|email>]`: parse args strictly (unknown flag → exit 2), build real deps (`getAdmin()`, the real EB client's `deleteSession`), default to the dry run (print the plan counts), require `--apply` AND `--confirm` equal to the target argument, print only counts. Add npm scripts `erase:org` and `erase:user` (`node --conditions=react-server --import tsx scripts/erase-org.ts`, same form as `check:tags`). Document usage at the top of each file.
- [ ] **Step 5: Run** integration + unit tests, typecheck, eslint. Commit `feat(privacy): dry-run-first scripts that erase a company or a user`

---

## Task 14: Privacy guard test, e2e, docs

**Files:** Create `tests/unit/privacy/no-tracking.test.ts`, `tests/e2e/legal-consent.spec.ts`; modify `tests/e2e/api-guards.spec.ts`, `CLAUDE.md`, `PROGRESS.md`, the spec status line.

- [ ] **Step 1: Guard test** `tests/unit/privacy/no-tracking.test.ts`: walk `app`, `components`, `lib`, `content`, `proxy.ts` and `package.json`. Fail when: a source file imports `firebase/analytics` or mentions `gtag(` / `googletagmanager` / `@vercel/analytics` / `@vercel/speed-insights` / `posthog` / `hotjar`; `package.json` lists any of those packages; a file other than `lib/server/session-cookie.ts` and `lib/i18n/client.ts` writes `document.cookie =` or builds a `Set-Cookie` header. Each exclusion carries a one-line reason, same style as the i18n guard's `ALLOW`. Run it first against the current tree: it must pass.
- [ ] **Step 2: e2e** `tests/e2e/legal-consent.spec.ts` (uk locale like the other specs; use `registerViaUi`, `createEmulatorUser`, `seedDoc`/`readDoc` helpers): (a) `/legal/terms`, `/legal/privacy`, `/legal/cookies` open without signing in, show the draft banner and the section headings; (b) `/register` submit button is disabled until the checkbox is ticked, then registration succeeds and `userConsents/<uid>` holds the current versions (read through the emulator helper); (c) a signed-in user whose `userConsents` doc is deleted sees the blocking dialog on the next app page, accepts, the dialog closes and the record exists with `source: 'gate'` event; (d) after changing the stored `terms.version` to an old value the gate appears again; (e) Settings → Приватність і дані shows the accepted documents; the export button is visible for the owner and absent for an accountant (use `seedMember` for a second role).
- [ ] **Step 3: API guards.** In `tests/e2e/api-guards.spec.ts` add: `POST /api/consent` without a cookie → 401; `GET /api/orgs/<id>/export/data?collection=transactions` without a cookie → 401; `GET /api/me/export` without a cookie → 401.
- [ ] **Step 4: Docs.** `CLAUDE.md`: new section «Legal pages, consents and data rights (S15a)» in English like its neighbours: routes and files, the version rule, the gate and its client-side limit, `userConsents` rules, export collections and what is excluded, the erasure scripts and their safety rules, the operator file and `LEGAL_DRAFT`, the privacy guard, the e2e consent helper rule (every UI registration ticks the checkbox; seeded users need `seedConsent`). Update the intro "Working today" line and the settings sections count/list wherever documented. `PROGRESS.md`: entry «S15a: юридичні сторінки, згоди та права на дані» in Ukrainian (what is done, what is NOT verified, follow-ups: server-side consent enforcement, self-service deletion in S16, lawyer review, native Polish review, real Enable Banking session delete, export time of 40k operations). Spec status line: «реалізовано» with the date and branch.
- [ ] **Step 5: Full local verification.** `npm run test:unit` (expect all green; note the number), `npm run test:rules`, `npm run test:integration`, `npm run typecheck`, `npx eslint .`, `npm run check:server-imports`, `npm run docs:check` if the project has it. Report the counts honestly; e2e is not run locally (CI only).
- [ ] **Step 6: Commit** `feat(privacy): tracking guard, e2e for consents and legal pages, docs`

---

## Task 15: PR and CI

- [ ] **Step 1:** `git push -u origin s15a-legal` and open a **draft** PR `feat(legal): legal pages, consents and data rights (S15a)` with `gh pr create --draft`. Body: problem, what changed, validation that actually ran (counts), NOT verified (real browser, 390 px layout of the new pages, real Enable Banking session delete, export time for 40k rows, lawyer and native Polish review), owner actions (operator details, lawyer, flip `LEGAL_DRAFT`). End with the generated-by line given in the session.
- [ ] **Step 2:** Watch CI (`gh pr checks <n> --watch`). If the e2e job fails with the Google Fonts "queries have exactly one entry" Turbopack error, rerun only the failed job (`gh run rerun <id> --failed`). Any other failure: diagnose and fix.
- [ ] **Step 3:** Mark the PR ready and **merge only with the owner's OK** (`gh pr merge --squash --subject "<title> (#N)" --body ""`), then verify production (`/api/health`, `/legal/terms` 200, `/api/consent` 401 without a cookie), update memory and Obsidian.

---

## Self-review (done while writing)

- **Spec coverage:** pages (T6–T8), operator + draft marker (T2), versions (T1), consent record and rules (T1, T3, T4), register checkbox (T9), gate and its client-side limit (T5, T14 docs), settings section (T10), export incl. allow-list, audit entry, `me.json`, README in 3 languages (T11, T12), erasure scripts with dry-run, sole-owner refusal, erasure log, EB revoke (T13), tracking guard (T14), tests listed in the spec (T1–T14), owner tasks (T15, PR text). The spec's "rate limit" is conditional on a fitting scope (T4, T11).
- **Type names used across tasks:** `ConsentDoc`, `ConsentState`, `ConsentInput`, `ConsentSource`, `needsConsent`, `parseConsentBody`, `gateStatus`, `LEGAL_VERSIONS`, `OPERATOR`, `LEGAL_DRAFT`, `operatorProblems`, `getLegalContent`, `fillOperator`, `EXPORT_COLLECTIONS`, `readExportPage`, `EraseDeps`, `planOrgErase`, `executeOrgErase`, `planUserErase`, `executeUserErase`, `acceptLegalDocs`, `recordConsent`, `buildExportZip`, `runExport` are defined once and reused with the same signatures.
- **Deliberate deviations from the spec:** none; the README text lives in `content/legal/export-readme.ts` (three languages in one file) to stay outside the Cyrillic guard.
