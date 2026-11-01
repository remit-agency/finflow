# S10f: Фільтри аналітики (види і категорії, контрагенти, теги з «Без тегів», рахунки). План реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** На Cash Flow, P&L і Календарі, окрім періоду, з'являється кнопка «Фільтри» з діалогом як у Finmap: «Види платежів і категорії», «Контрагенти», «Теги» (з «Без тегів»), «Рахунки»; на «Балансі» лише «Рахунки». Явно вибраний тег повертає у звіт операції з ним, навіть виключені з аналітики (з підказкою над звітом); без вибору тегу звіти, як і раніше, їх не рахують, і тепер Календар теж. Вибір живе в адресі сторінки, переходить між вкладками звітів і ним можна поділитися.

**Architecture:** Одне правило відбору для журналу і звітів: `matchesSelection` виноситься з `matchesFilters` у `lib/domain/journal/filter.ts`. Чистий модуль `lib/domain/analytics-filter/filter.ts`: `AnalyticsFilters`, розбір і запис адреси (імена журналу `types`, `cat`, `cp`, `tg` і нове `accounts`), лічильник полів, `filterForAnalytics` → `{ operations, includeExcluded, showsExcluded }`, `filterAccounts`. `lib/utils/analytics.ts`: один предикат `countsInAnalytics` і необов'язкові `{ includeExcluded }` для `buildCashFlow`, `buildPL`, `buildCalendar` (Календар нарешті пропускає виключені). Браузер: хук `useAnalyticsFilters` (адреса через `useSearchParams` і `router.replace`, як журнал), посилання `AnalyticsNav` несуть параметри фільтра (`analyticsHref`), кнопка й діалог у `components/analytics/`, багатовибір `FilterMultiSelect` за зразком Finmap (пошук, «Усі …», рядки з прапорцями, «Вибрати») зі спільним правилом підсвітки S10t (`lib/ui/highlight.ts`). Сервер, колекції, індекси й правила Firestore не змінюються.

**Tech Stack:** Next.js 16 App Router (клієнтські сторінки звітів), React 19.2 + React Compiler lint, Base UI Dialog, next-intl (uk/pl/en), Vitest (лише node), Playwright (емулятори).

**Spec:** `docs/superpowers/specs/2026-11-02-s10f-analytics-filters-design.md`

**Гілка:** `s10f-analytics-filters` (вже створена, на ній лежить спека). Усі коміти в неї. Кінець кожного повідомлення коміту: порожній рядок і `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Додавати файли поіменно (`git add <файли>`), ніколи `git add -A`.

**Робоче середовище (Windows, Git Bash):** репозиторій `F:\AI\finflow`. Для емуляторів потрібна Java: `export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH"`. Не вбивати процеси за ім'ям образу (`taskkill /IM node.exe` заборонено). Не робити junction на `node_modules`.

**Закінчення рядків:** робоча копія CRLF, індекс LF (`core.autocrlf=true`). Наявні файли змінювати інструментом Edit (він зберігає CRLF); нові файли можна писати Write (LF), git нормалізує сам. Ніколи не переписувати наявний файл цілком через Write, якщо задача не каже «замінити файл повністю» (тоді CRLF теж нормалізується git, диф показує лише зміст).

**Базові числа (останні перевірені, після мерджа S10b `a59885b`; у цьому плані повні набори не запускались):** unit 2428 тестів / 178 файлів, rules 144 / 2, integration 323 / 33 файли, e2e 130, `lint` 0 errors / 10 warnings. Task 10 вимірює нові числа й порівнює з цими (очікувано unit 2451 / 180: 23 нові тести у 2 нових і 3 наявних файлах; e2e 132).

**Правила репозиторію, що діють у кожній задачі:** React Compiler lint (жодного синхронного `setState` у тілі ефекту; жодного читання `ref.current` під час рендеру); `messages/{uk,pl,en}.json` з однаковими ключами й однаковими аргументами ICU (`tests/unit/i18n/catalogs.test.ts`); жодного кириличного тексту в коді `app/(app)`, `components`, `lib`, `types` (`tests/unit/i18n/no-hardcoded-text.test.ts`; коментарі можна; `aria-label`/`placeholder` лише через `t()`); `new Intl.*` і `toLocale*()` лише в `lib/i18n` і `lib/utils`; кольори лише токенами (кольори рахунків і категорій це дані, inline можна); Vitest лише node, компонентних тестів немає (UI перевіряють e2e і скриншоти); прапорець, що показує лише стан адреси, мусить показати клік одразу (баг S10t), тому чернетка діалогу живе в локальному стані й іде в адресу лише на «Готово»; `npm run lint` без нових попереджень (зараз 10).

**Каталоги повідомлень:** файли `messages/*.json` записані рівно як `JSON.stringify(data, null, 2)` плюс перенос рядка (у робочій копії CRLF). Task 5 додає ключі тимчасовим скриптом у скретчпаді виконавця (поза репозиторієм; не комітити; видалити після запуску), як у плані S10b.

---

## Spec corrections

1. **Стан у адресі:** спільний хук `useAnalyticsFilters` (`useSearchParams` + `router.replace(..., { scroll: false })`, як `setView` журналу) на чотирьох сторінках; маршрут `[orgSlug]` динамічний (кукі мови в кореневому layout), тож `Suspense` не потрібен, як і журналу.
2. **Вкладки:** `AnalyticsNav` будує посилання через новий `analyticsHref(orgId, section, query)` з нормалізованих параметрів фільтра (`analyticsFiltersToParams(parseAnalyticsFilters(...))`); `activeAnalyticsSection` читає лише `usePathname()`, тож активна вкладка не ламається; модульна вкладка «Аналітика» і картки `analytics/page.tsx` відкривають звіт без фільтрів.
3. **Типи й категорії:** діють разом (AND), як у журналі; одне поле «Види платежів і категорії»: рядки Дохід / Витрата / Переказ, під Доходом і Витратою вкладені їхні категорії (Переказ без категорій).
4. **Вибирачі з `JournalFilters.tsx` не підходять для повторного використання:** там вбудовані списки прапорців, прив'язані до адреси журналу, і категорія це один `NativeSelect`; план створює `FilterMultiSelect` і бере з S10t `TagDot`, `nameKeyText` і правило підсвітки (`highlightedRow` переїжджає з `TagPicker` у `lib/ui/highlight.ts`).
5. **Уточнення власника 2026-11-02 (знімок Finmap «Filtry»):** кожне поле це випадний список «Теги (N)» з пошуком («Пошук тегів» / «Szukaj tagów»), першим рядком «Усі теги» / «Wszystkie tagi» (позначений, коли нічого не вибрано; позначка знімає вибір), рядком-прапорцем на кожне значення, останнім рядком «Без тегів» / «Bez tagów» (`_none`) і кнопкою «Вибрати» / «Wybrać» знизу; так само категорії, контрагенти й рахунки; низ діалогу «Готово» і «Скинути фільтри» / «Zresetuj filtry»; «Zapisz filtr» лишається в S22.
6. **Одне правило відбору:** `matchesSelection` виноситься з `matchesFilters` журналу без зміни його поведінки, звіти застосовують той самий предикат до браузерного `Transaction`.
7. **Рахунки й перекази:** фільтр рахунків збігається з `accountId` або `toAccountId` переказу (як журнал; спека казала лише `accountId`); на підсумки це не впливає (перекази не рахуються в жодному з трьох звітів), але в розгорнутому дні Календаря видно переказ на вибраний рахунок.
8. **`includeExcluded`:** останній необов'язковий параметр-об'єкт `{ includeExcluded?: boolean }` (за замовчуванням false) у `buildCashFlow`, `buildPL`, `buildCalendar` через один предикат `countsInAnalytics`; Календар тепер пропускає виключені і в днях, і в залишку, перенесеному з попередніх місяців, і в списку операцій розгорнутого дня.
9. **Підказка «Показано також операції, виключені з аналітики»:** показується, коли вибрано конкретний тег і серед відібраних операцій справді є виключена (`showsExcluded`); тег без прапорця сам підказки не дає (спека: при будь-якому конкретному тегу).
10. **Баланс:** `buildBalance` ніде не викликається (`BalanceSheet` сам сумує `accounts`), тож сторінка фільтрує список рахунків для `BalanceSheet` і CSV (`filterAccounts`), а мертві `buildBalance`/`BalanceData` видаляються; у «Балансу» немає `ReportToolbar`, кнопка стає поруч із «Станом на».
11. **Інші поля на Балансі:** діалог показує лише «Рахунки», лічильник рахує лише рахунки, інші параметри лишаються в адресі для інших вкладок, «Скинути фільтри» там знімає лише рахунки.
12. **`hasActiveAnalyticsFilters`:** замість булевої функції `activeAnalyticsFilterCount(filters, scope)` (кількість полів з вибором; типи й категорії одне поле), «є фільтри» це `> 0`.
13. **Архівні й видалені значення:** категорії не мають архіву й видаляються назавжди (`settings/categories`, `deleteDoc`), тож пропонуються лише наявні, а операції видаленої категорії йдуть у «Без категорії»; архівні теги й контрагенти пропонуються приглушено (вони є на старих операціях); ідентифікатор, якого вже немає у списку, лишається у фільтрі (звіт за ним порожній, лічильник його рахує), його знімають «Усі …» або «Скинути фільтри».
14. **Межі й некоректні параметри:** до 30 ідентифікаторів у списку (`idList` журналу, тепер експорт, `MAX_FILTER_IDS`), некоректні ідентифікатори й типи та повтори відкидаються, чужі параметри (`period`, `q`) ігноруються; діалог вимикає нові рядки на 30 (типи не рахуються), список показує до 100 рядків і «Ще N: уточніть пошук».
15. **CSV:** Cash Flow і P&L вже будують CSV з рядків звіту, тож він відфільтрований сам; CSV Балансу береться з відфільтрованих рахунків; у Календаря CSV немає.
16. **Лічильник:** число полів з вибором на кнопці («Фільтри» + значок; доступна назва «Фільтри (активних: N)»).
17. **Чернетка діалогу:** позначки одразу йдуть у локальну чернетку діалогу (клік видно відразу), «Вибрати» і Esc закривають лише список, «Готово» пише адресу, закриття діалогу без «Готово» відкидає чернетку.

## Рішення плану (в межах спеки)

- **Один власник кожного правила.** Відбір: `matchesSelection` (журнал і звіти). «Чи рахує звіт операцію»: `countsInAnalytics` (усі три звіти й список дня Календаря). Розбір списку ідентифікаторів: `idList` журналу. Підсвітка рядка: `highlightedRow` (TagPicker і фільтри).
- **Список відкривається в потоці діалогу, а не плаваючим шаром:** другий портал усередині Base UI Dialog потребував би власного керування фокусом і Esc і обрізався б на 390 px; вбудований список прокручується разом із діалогом. Відкритий одночасно лише один список; Esc у пошуку зупиняє подію (`stopPropagation`, як `TagPicker`), тож закривається список, а не діалог.
- **Рядки списку:** `role="option"` з `aria-selected` у `role="listbox" aria-multiselectable`, поле пошуку `role="combobox"` з `aria-activedescendant`; намальований прапорець (`aria-hidden`). Нічого не підсвічено, доки людина не друкує, не тисне стрілку чи справді не рухає мишу; Enter без підсвітки нічого не позначає; поки йде пошук, рядка «Усі …» немає, тож Enter після друку ніколи не знімає вибір.
- **Довгі назви:** `DialogContent` з `grid-cols-[minmax(0,1fr)]` (як `TransferSuggestions`), назви в рядках `break-words`, позначка «не враховується в аналітиці» біля тегу з прапорцем.
- **Дані діалогу:** категорії й рахунки з `useShell`; контрагенти й теги читаються лише поки діалог відкритий (`useCounterparties`/`useTags`), на Балансі взагалі ні; поле, чий список ще вантажиться, вимкнене. Порядок: категорії й контрагенти за `nameKeyText`, теги в порядку `sortTags`, рахунки як у бічній панелі.
- **«Скинути фільтри»** одразу застосовує порожній вибір полів, які показує діалог, і закриває його.
- **Тексти з кількістю** через двокрапку, без ICU-множин, як у S10-S10b. Польська кнопка списку «Wybrać» (так у Finmap, за словами власника).

---

## Карта файлів

| Файл | Дія | Відповідальність |
|---|---|---|
| `lib/domain/journal/filter.ts` | змінити | `SelectionFacts`, `Selection`, `matchesSelection`; експорт `idList`, `typeList`, `MAX_FILTER_IDS`; `matchesFilters` через `matchesSelection` |
| `lib/ui/highlight.ts` | створити | `highlightedRow` (правило S10t) |
| `components/tags/TagPicker.tsx` | змінити | імпорт `highlightedRow` замість локальної копії |
| `lib/domain/analytics-filter/filter.ts` | створити | `AnalyticsFilters`, адреса, лічильник, `filterForAnalytics`, `filterAccounts` |
| `lib/utils/analytics.ts` | змінити | `ReportOptions`, `countsInAnalytics`, `includeExcluded` у трьох звітах, Календар без виключених, видалення `buildBalance`/`BalanceData` |
| `lib/shell/analytics-sections.ts` | змінити | `analyticsHref` |
| `lib/hooks/useAnalyticsFilters.ts` | створити | фільтри з адреси і запис в адресу |
| `components/shell/AnalyticsNav.tsx` | змінити | посилання вкладок з параметрами фільтра |
| `messages/{uk,pl,en}.json` | змінити | `analytics.filters.*` |
| `components/analytics/FilterMultiSelect.tsx` | створити | випадний багатовибір Finmap |
| `components/analytics/AnalyticsFiltersDialog.tsx` | створити | діалог «Фільтри» з чернеткою |
| `components/analytics/AnalyticsFilters.tsx` | створити | кнопка з лічильником, підказка про виключені |
| `components/analytics/ReportToolbar.tsx` | змінити | кнопка «Фільтри» після періоду |
| `app/(app)/[orgSlug]/analytics/{cashflow,pl,calendar,balance}/page.tsx` | змінити | підключення фільтрів |
| `components/charts/CalendarView.tsx` | змінити | `includeExcluded`, список дня через `countsInAnalytics` |
| `tests/unit/ui/highlight.test.ts`, `tests/unit/domain/analytics-filter/filter.test.ts` | створити | підсвітка, чистий модуль фільтрів |
| `tests/unit/domain/journal/filter.test.ts`, `tests/unit/utils/analytics.test.ts`, `tests/unit/shell/analytics-sections.test.ts` | змінити | `matchesSelection`, звіти з фільтром, `analyticsHref` |
| `tests/e2e/analytics-filters.spec.ts`, `tests/ui-shots/analytics-filters.spec.ts` | створити | e2e і скриншоти |
| `CLAUDE.md`, `PROGRESS.md`, спека | змінити | документація, статус спеки |

---

### Task 1: Спільне правило відбору журналу і правило підсвітки списку

**Files:**
- Modify: `lib/domain/journal/filter.ts`, `components/tags/TagPicker.tsx`, `tests/unit/domain/journal/filter.test.ts`
- Create: `lib/ui/highlight.ts`, `tests/unit/ui/highlight.test.ts`

- [ ] **Step 1: Write the failing tests**

Створити `tests/unit/ui/highlight.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { highlightedRow } from '@/lib/ui/highlight'

describe('highlightedRow (S10t rule, shared with the report filters of S10f)', () => {
  it('nothing is highlighted before typing or moving', () => {
    expect(highlightedRow(3, '', null)).toBe(-1)
  })
  it('typing highlights the first row', () => {
    expect(highlightedRow(3, 'pd', null)).toBe(0)
  })
  it('a moved highlight wins and is clamped to a shorter list', () => {
    expect(highlightedRow(3, '', 1)).toBe(1)
    expect(highlightedRow(2, 'x', 5)).toBe(1)
  })
  it('an empty list has no highlight', () => {
    expect(highlightedRow(0, 'x', 2)).toBe(-1)
  })
})
```

У `tests/unit/domain/journal/filter.test.ts` замінити блок імпорту

```ts
  normalizeText,
  parseFilters,
  type FilterContext,
} from '@/lib/domain/journal/filter'
```

на

```ts
  normalizeText,
  parseFilters,
  idList,
  matchesSelection,
  MAX_FILTER_IDS,
  type FilterContext,
} from '@/lib/domain/journal/filter'
```

і додати в кінець файлу:

```ts
describe('matchesSelection (S10f: the journal and the reports share it)', () => {
  const none = { types: [], categoryIds: [], counterpartyIds: [], accountIds: [], tagIds: [] }

  it('several accounts: any of them, the target of a transfer included', () => {
    const s = { ...none, accountIds: ['a2', 'a3'] }
    expect(matchesSelection(tx({ accountId: 'a3' }), s)).toBe(true)
    expect(matchesSelection(tx({ type: 'transfer', toAccountId: 'a2', toAmountMinor: 12_000, toCurrency: 'PLN' }), s)).toBe(true)
    expect(matchesSelection(tx(), s)).toBe(false)
  })

  it('types and categories work together: an operation must fit both', () => {
    const s = { ...none, types: ['expense' as const], categoryIds: ['rent'] }
    expect(matchesSelection(tx({ categoryId: 'rent' }), s)).toBe(true)
    expect(matchesSelection(tx({ type: 'income', categoryId: 'rent' }), s)).toBe(false)
    expect(matchesSelection(tx(), s)).toBe(false)
  })

  it('idList drops what is not an id and keeps at most MAX_FILTER_IDS', () => {
    expect(idList('a1,,a b,__x__,a2')).toEqual(['a1', 'a2'])
    expect(idList(Array.from({ length: 40 }, (_, i) => `x${i}`).join(','))).toHaveLength(MAX_FILTER_IDS)
    expect(idList(null)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/ui/highlight.test.ts tests/unit/domain/journal/filter.test.ts`
Expected: FAIL (`@/lib/ui/highlight` не знайдено; `matchesSelection`, `idList`, `MAX_FILTER_IDS` не експортовані).

- [ ] **Step 3: Implement**

Створити `lib/ui/highlight.ts`:

```ts
/**
 * The highlighted row of an open list, or -1 for none (S10t; shared by TagPicker and the report filters of S10f). `moved` is
 * the row the person moved the highlight to (arrows or a real pointer move), or null while they have not. With a typed query
 * the first row is highlighted; without one nothing is, so Enter right after the list opens cannot choose a row by accident.
 * A moved highlight is clamped, because a narrower query can shorten the list under it.
 */
export function highlightedRow(count: number, query: string, moved: number | null): number {
  if (count === 0) return -1
  if (moved !== null) return Math.min(moved, count - 1)
  return query !== '' ? 0 : -1
}
```

У `components/tags/TagPicker.tsx` замінити

```ts
import { MAX_TX_TAGS, type Tag } from '@/lib/domain/tags/types'
import { cn } from '@/lib/utils'
```

на

```ts
import { MAX_TX_TAGS, type Tag } from '@/lib/domain/tags/types'
import { highlightedRow } from '@/lib/ui/highlight'
import { cn } from '@/lib/utils'
```

і видалити локальну копію разом із порожнім рядком після неї:

```ts
/**
 * The highlighted row of the open list, or -1 for none. `moved` is the row the person moved the highlight to (arrows or
 * a real pointer move), or null while they have not. With a typed query the first row is highlighted; without one
 * nothing is, so Enter right after Tab (the list opens on focus) cannot choose a tag by accident. A moved highlight is
 * clamped, because a narrower query can shorten the list under it.
 */
function highlightedRow(count: number, query: string, moved: number | null): number {
  if (count === 0) return -1
  if (moved !== null) return Math.min(moved, count - 1)
  return query !== '' ? 0 : -1
}

```

У `lib/domain/journal/filter.ts`:

1. Замінити

```ts
const MAX_LIST = 30
const MAX_QUERY = 100
```

на

```ts
/** Ids one list filter keeps (`cp`, `cat`, `tg`; the reports' `accounts` too, S10f); the rest of a hand-made link is dropped. */
export const MAX_FILTER_IDS = 30
const MAX_QUERY = 100
```

2. Замінити

```ts
function ids(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .filter((s) => isId(s))
    .slice(0, MAX_LIST)
}
```

на

```ts
/** A comma-separated list of ids from the address: what is not an id is dropped, at most `MAX_FILTER_IDS` stay. */
export function idList(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .filter((s) => isId(s))
    .slice(0, MAX_FILTER_IDS)
}

/** A comma-separated list of operation types from the address; anything else is dropped. */
export function typeList(raw: string | null): TxType[] {
  return (raw ?? '').split(',').filter((t): t is TxType => (TX_TYPES as readonly string[]).includes(t))
}
```

3. У `parseFilters` замінити

```ts
    counterpartyIds: ids(p.get('cp')),
    categoryIds: ids(p.get('cat')),
    tagIds: ids(p.get('tg')),
```

на

```ts
    counterpartyIds: idList(p.get('cp')),
    categoryIds: idList(p.get('cat')),
    tagIds: idList(p.get('tg')),
```

і

```ts
  f.types = (p.get('types') ?? '')
    .split(',')
    .filter((t): t is TxType => (TX_TYPES as readonly string[]).includes(t))
```

на

```ts
  f.types = typeList(p.get('types'))
```

4. Замінити

```ts
/** The whole predicate, so the in-memory part of a page read and the tests use one definition. */
export function matchesFilters(tx: LedgerTransaction, f: JournalFilters, ctx: FilterContext): boolean {
  if (f.types.length && !f.types.includes(tx.type)) return false
  if (f.status && tx.status !== f.status) return false
  if (f.minMinor !== undefined && tx.amountMinor < f.minMinor) return false
  if (f.maxMinor !== undefined && tx.amountMinor > f.maxMinor) return false
  if (f.categoryIds.length && (tx.categoryId === undefined || !f.categoryIds.includes(tx.categoryId))) return false
  if (f.counterpartyIds.length && (tx.counterpartyId === undefined || !f.counterpartyIds.includes(tx.counterpartyId))) return false
  if (f.accountId && tx.accountId !== f.accountId && tx.toAccountId !== f.accountId) return false
  if (f.tagIds.length) {
    const untagged = tx.tags.length === 0 && f.tagIds.includes(NO_TAG)
    if (!untagged && !tx.tags.some((id) => f.tagIds.includes(id))) return false
  }
  if (f.excludedOnly && tx.excluded !== true) return false
```

на

```ts
/** What the choice filters read from an operation: the journal's ledger rows and the reports' operations (S10f) both have it. */
export type SelectionFacts = Pick<LedgerTransaction, 'type' | 'accountId' | 'toAccountId' | 'categoryId' | 'counterpartyId' | 'tags'>

/** The choice part of a filter, one definition for the journal and the reports (S10f). */
export interface Selection {
  types: readonly TxType[]
  categoryIds: readonly string[]
  counterpartyIds: readonly string[]
  /** The operation's account, or the target account of a transfer, is one of these. */
  accountIds: readonly string[]
  /** Any of these tags; `NO_TAG` matches an operation without tags. */
  tagIds: readonly string[]
}

/**
 * Every non-empty list must match, and inside a list any value does: types and categories therefore work together (an
 * operation must fit both when both are chosen); counterparties, accounts and tags mean «any of the chosen».
 */
export function matchesSelection(tx: SelectionFacts, s: Selection): boolean {
  if (s.types.length && !s.types.includes(tx.type)) return false
  if (s.categoryIds.length && (tx.categoryId === undefined || !s.categoryIds.includes(tx.categoryId))) return false
  if (s.counterpartyIds.length && (tx.counterpartyId === undefined || !s.counterpartyIds.includes(tx.counterpartyId))) return false
  if (s.accountIds.length && !s.accountIds.includes(tx.accountId) && (tx.toAccountId === undefined || !s.accountIds.includes(tx.toAccountId))) return false
  if (s.tagIds.length) {
    const untagged = tx.tags.length === 0 && s.tagIds.includes(NO_TAG)
    if (!untagged && !tx.tags.some((id) => s.tagIds.includes(id))) return false
  }
  return true
}

/** The whole predicate, so the in-memory part of a page read and the tests use one definition. */
export function matchesFilters(tx: LedgerTransaction, f: JournalFilters, ctx: FilterContext): boolean {
  if (!matchesSelection(tx, { ...f, accountIds: f.accountId ? [f.accountId] : [] })) return false
  if (f.status && tx.status !== f.status) return false
  if (f.minMinor !== undefined && tx.amountMinor < f.minMinor) return false
  if (f.maxMinor !== undefined && tx.amountMinor > f.maxMinor) return false
  if (f.excludedOnly && tx.excluded !== true) return false
```

(Решта `matchesFilters`, дати й текст, лишається як є. Поведінка журналу не змінюється: ті самі умови, лише інший порядок у кон'юнкції.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/ui tests/unit/domain/journal tests/unit/domain/tags tests/unit/utils/journal-url.test.ts tests/unit/utils/journal-url-tags.test.ts && npm run typecheck`
Expected: PASS (нові 7 тестів, усі наявні тести журналу й тегів без змін), `tsc` чисто.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add lib/ui/highlight.ts lib/domain/journal/filter.ts components/tags/TagPicker.tsx tests/unit/ui/highlight.test.ts tests/unit/domain/journal/filter.test.ts && git commit -m "refactor(journal): share the choice predicate and the list highlight rule

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Чистий модуль фільтрів аналітики `lib/domain/analytics-filter/`

**Files:**
- Create: `lib/domain/analytics-filter/filter.ts`, `tests/unit/domain/analytics-filter/filter.test.ts`

- [ ] **Step 1: Write the failing tests**

Створити `tests/unit/domain/analytics-filter/filter.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  activeAnalyticsFilterCount,
  analyticsFiltersToParams,
  EMPTY_ANALYTICS_FILTERS,
  filterAccounts,
  filterForAnalytics,
  parseAnalyticsFilters,
  type AnalyticsFilters,
} from '@/lib/domain/analytics-filter/filter'
import { EMPTY_FILTERS, matchesFilters, NO_TAG, type FilterContext } from '@/lib/domain/journal/filter'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { toUiTransaction } from '@/lib/firebase/ledger-map'
import { makeAccount, makeTx } from '../../helpers/fixtures'

const f = (over: Partial<AnalyticsFilters>): AnalyticsFilters => ({ ...EMPTY_ANALYTICS_FILTERS, ...over })
const ids = (list: { id: string }[]): string[] => list.map((x) => x.id)

describe('the address', () => {
  it('round-trips every field under the journal names, the accounts in `accounts`', () => {
    const value = f({ types: ['income', 'transfer'], categoryIds: ['c1'], counterpartyIds: ['p1', 'p2'], tagIds: ['vat', NO_TAG], accountIds: ['a1', 'a2'] })
    const params = analyticsFiltersToParams(value)
    expect([...params.keys()]).toEqual(['types', 'cat', 'cp', 'tg', 'accounts'])
    expect(params.get('tg')).toBe('vat,_none')
    expect(parseAnalyticsFilters(new URLSearchParams(params.toString()))).toEqual(value)
  })

  it('no choice is an empty query', () => {
    expect(analyticsFiltersToParams(EMPTY_ANALYTICS_FILTERS).toString()).toBe('')
    expect(parseAnalyticsFilters(new URLSearchParams(''))).toEqual(EMPTY_ANALYTICS_FILTERS)
  })

  it('drops bad values, repeats and the parameters it does not own', () => {
    const p = new URLSearchParams('types=income,bogus,income&cat=c1,,c 2,__x__&cp=a/b&tg=vat,vat&accounts=a1,a.b&period=prevYear&q=x')
    expect(parseAnalyticsFilters(p)).toEqual(f({ types: ['income'], categoryIds: ['c1'], tagIds: ['vat'], accountIds: ['a1'] }))
  })

  it('keeps at most 30 ids per list, as the journal', () => {
    const many = Array.from({ length: 40 }, (_, i) => `a${i}`).join(',')
    const parsed = parseAnalyticsFilters(new URLSearchParams({ accounts: many, tg: many }))
    expect(parsed.accountIds).toHaveLength(30)
    expect(parsed.tagIds).toHaveLength(30)
  })
})

describe('activeAnalyticsFilterCount', () => {
  it('counts the fields in use; payment types and categories are one field', () => {
    expect(activeAnalyticsFilterCount(EMPTY_ANALYTICS_FILTERS, 'operations')).toBe(0)
    expect(activeAnalyticsFilterCount(f({ types: ['income'], categoryIds: ['c1', 'c2'] }), 'operations')).toBe(1)
    expect(activeAnalyticsFilterCount(f({ types: ['income'], counterpartyIds: ['p1'], tagIds: [NO_TAG], accountIds: ['a1'] }), 'operations')).toBe(4)
  })

  it('the Balance counts only the accounts', () => {
    expect(activeAnalyticsFilterCount(f({ tagIds: ['vat'] }), 'accounts')).toBe(0)
    expect(activeAnalyticsFilterCount(f({ tagIds: ['vat'], accountIds: ['a1'] }), 'accounts')).toBe(1)
  })
})

describe('filterForAnalytics', () => {
  const sale = makeTx({ id: 'sale', type: 'income', accountId: 'a1', categoryId: 'c-sales', counterpartyId: 'p1' })
  const rent = makeTx({ id: 'rent', type: 'expense', accountId: 'a1', categoryId: 'c-rent', counterpartyId: 'p2', tags: ['q4'] })
  const vat = makeTx({ id: 'vat', type: 'expense', accountId: 'a2', tags: ['vat'], excluded: true })
  const move = makeTx({ id: 'move', type: 'transfer', accountId: 'a1', toAccountId: 'a3', toAmount: 100, toCurrency: 'PLN' })
  const all = [sale, rent, vat, move]

  it('without a choice: the same array, the excluded operations left to the reports', () => {
    const out = filterForAnalytics(all, EMPTY_ANALYTICS_FILTERS)
    expect(out.operations).toBe(all)
    expect(out).toMatchObject({ includeExcluded: false, showsExcluded: false })
  })

  it('types and categories work together', () => {
    expect(ids(filterForAnalytics(all, f({ types: ['expense'] })).operations)).toEqual(['rent', 'vat'])
    expect(ids(filterForAnalytics(all, f({ types: ['expense'], categoryIds: ['c-rent'] })).operations)).toEqual(['rent'])
    expect(ids(filterForAnalytics(all, f({ types: ['income'], categoryIds: ['c-rent'] })).operations)).toEqual([])
  })

  it('counterparties and accounts mean any of the chosen; an account matches the target of a transfer', () => {
    expect(ids(filterForAnalytics(all, f({ counterpartyIds: ['p1', 'p2'] })).operations)).toEqual(['sale', 'rent'])
    expect(ids(filterForAnalytics(all, f({ accountIds: ['a2', 'a3'] })).operations)).toEqual(['vat', 'move'])
  })

  it('a concrete tag brings the excluded operations in and says so when there are any; «без тегів» does not', () => {
    const vatOnly = filterForAnalytics(all, f({ tagIds: ['vat'] }))
    expect(ids(vatOnly.operations)).toEqual(['vat'])
    expect(vatOnly).toMatchObject({ includeExcluded: true, showsExcluded: true })
    expect(filterForAnalytics(all, f({ tagIds: ['q4'] }))).toMatchObject({ includeExcluded: true, showsExcluded: false })
    const untagged = filterForAnalytics(all, f({ tagIds: [NO_TAG] }))
    expect(ids(untagged.operations)).toEqual(['sale', 'move'])
    expect(untagged).toMatchObject({ includeExcluded: false, showsExcluded: false })
  })

  it('chooses the operations the journal lists for the same choice', () => {
    const ledger = (over: Partial<LedgerTransaction>): LedgerTransaction => ({
      id: 'x',
      type: 'expense',
      status: 'actual',
      accountId: 'a1',
      amountMinor: 1000,
      currency: 'PLN',
      paymentDate: '2026-10-10',
      accrual: { mode: 'date', date: '2026-10-10' },
      isRecurring: false,
      tags: [],
      fileUrls: [],
      ...over,
    })
    const rows = [
      ledger({ id: 'l1', type: 'income', categoryId: 'c1', counterpartyId: 'p1' }),
      ledger({ id: 'l2', categoryId: 'c2', tags: ['vat'], excluded: true }),
      ledger({ id: 'l3', accountId: 'a2', counterpartyId: 'p1', tags: ['q4'] }),
      ledger({ id: 'l4', type: 'transfer', toAccountId: 'a2', toAmountMinor: 1000, toCurrency: 'PLN' }),
      ledger({ id: 'l5', type: 'income', accountId: 'a2' }),
    ]
    const ui = rows.map((tx) => toUiTransaction('org', tx))
    const ctx: FilterContext = { accountName: () => undefined, counterpartyName: () => undefined }
    const choices = [
      f({ types: ['expense'], categoryIds: ['c2'] }),
      f({ counterpartyIds: ['p1'] }),
      f({ tagIds: ['vat', NO_TAG] }),
      f({ tagIds: [NO_TAG] }),
      f({ accountIds: ['a2'] }),
    ]
    for (const choice of choices) {
      const { accountIds, ...rest } = choice
      const journal = rows.filter((tx) => matchesFilters(tx, { ...EMPTY_FILTERS, ...rest, accountId: accountIds[0] }, ctx))
      expect(ids(filterForAnalytics(ui, choice).operations), JSON.stringify(choice)).toEqual(ids(journal))
    }
  })
})

describe('filterAccounts', () => {
  it('every account without a choice, otherwise the chosen ones in their order', () => {
    const accounts = [makeAccount({ id: 'a1' }), makeAccount({ id: 'a2' }), makeAccount({ id: 'a3' })]
    expect(filterAccounts(accounts, EMPTY_ANALYTICS_FILTERS)).toBe(accounts)
    expect(ids(filterAccounts(accounts, f({ accountIds: ['a3', 'a1'] })))).toEqual(['a1', 'a3'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/analytics-filter`
Expected: FAIL (`@/lib/domain/analytics-filter/filter` не знайдено).

- [ ] **Step 3: Implement**

Створити `lib/domain/analytics-filter/filter.ts`:

```ts
import { idList, matchesSelection, NO_TAG, typeList, type SelectionFacts } from '@/lib/domain/journal/filter'
import type { TxType } from '@/lib/domain/ledger/types'

/**
 * The filters of the reports (S10f): kept in the address and shared by the Cash Flow, P&L, Calendar and Balance tabs.
 * The period is chosen separately and stays out of them.
 */
export interface AnalyticsFilters {
  types: TxType[]
  categoryIds: string[]
  counterpartyIds: string[]
  /** Any of these tags; `NO_TAG` stands for «без тегів». */
  tagIds: string[]
  accountIds: string[]
}

export const EMPTY_ANALYTICS_FILTERS: AnalyticsFilters = { types: [], categoryIds: [], counterpartyIds: [], tagIds: [], accountIds: [] }

/** Which fields a report offers: the Balance is made of accounts, the other reports of operations. */
export type AnalyticsScope = 'operations' | 'accounts'

function unique<T>(list: T[]): T[] {
  return [...new Set(list)]
}

/**
 * Lenient, like the journal's `parseFilters` and with its names (`types`, `cat`, `cp`, `tg`; the accounts in `accounts`):
 * a bad value or a repeat is dropped, at most 30 ids a list stay, other parameters are not read.
 */
export function parseAnalyticsFilters(p: Pick<URLSearchParams, 'get'>): AnalyticsFilters {
  return {
    types: unique(typeList(p.get('types'))),
    categoryIds: unique(idList(p.get('cat'))),
    counterpartyIds: unique(idList(p.get('cp'))),
    tagIds: unique(idList(p.get('tg'))),
    accountIds: unique(idList(p.get('accounts'))),
  }
}

export function analyticsFiltersToParams(f: AnalyticsFilters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.types.length) p.set('types', f.types.join(','))
  if (f.categoryIds.length) p.set('cat', f.categoryIds.join(','))
  if (f.counterpartyIds.length) p.set('cp', f.counterpartyIds.join(','))
  if (f.tagIds.length) p.set('tg', f.tagIds.join(','))
  if (f.accountIds.length) p.set('accounts', f.accountIds.join(','))
  return p
}

/** The fields with a choice, as the «Фільтри» button counts them: payment types and categories are one field. */
export function activeAnalyticsFilterCount(f: AnalyticsFilters, scope: AnalyticsScope): number {
  const fields: string[][] = scope === 'accounts' ? [f.accountIds] : [[...f.types, ...f.categoryIds], f.counterpartyIds, f.tagIds, f.accountIds]
  return fields.filter((list) => list.length > 0).length
}

export interface AnalyticsSelection<T> {
  operations: T[]
  /** A concrete tag is chosen: the reports count the operations excluded from analytics too (Finmap's rule). */
  includeExcluded: boolean
  /** ...and some of the chosen operations are such: the page says so («Показано також операції, виключені з аналітики»). */
  showsExcluded: boolean
}

/** The operations the reports are built from, by the journal's rule (`matchesSelection`); without a choice the same array. */
export function filterForAnalytics<T extends SelectionFacts & { excluded?: boolean }>(operations: T[], f: AnalyticsFilters): AnalyticsSelection<T> {
  const includeExcluded = f.tagIds.some((id) => id !== NO_TAG)
  const chosen = activeAnalyticsFilterCount(f, 'operations') === 0 ? operations : operations.filter((tx) => matchesSelection(tx, f))
  return { operations: chosen, includeExcluded, showsExcluded: includeExcluded && chosen.some((tx) => tx.excluded === true) }
}

/** The accounts the Balance shows: the chosen ones, or every account without a choice. */
export function filterAccounts<T extends { id: string }>(accounts: T[], f: AnalyticsFilters): T[] {
  return f.accountIds.length === 0 ? accounts : accounts.filter((a) => f.accountIds.includes(a.id))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/analytics-filter && npm run typecheck`
Expected: PASS (12 тестів), `tsc` чисто.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add lib/domain/analytics-filter/filter.ts tests/unit/domain/analytics-filter/filter.test.ts && git commit -m "feat(analytics): pure report filters with the journal's matching rule

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Звіти: `includeExcluded`, Календар без виключених, прибрати `buildBalance`

**Files:**
- Modify: `lib/utils/analytics.ts`, `tests/unit/utils/analytics.test.ts`

- [ ] **Step 1: Write the failing tests**

У `tests/unit/utils/analytics.test.ts` замінити рядок імпорту

```ts
import { buildCashFlow, buildPL } from '@/lib/utils/analytics'
```

на

```ts
import { EMPTY_ANALYTICS_FILTERS, filterForAnalytics, type AnalyticsFilters } from '@/lib/domain/analytics-filter/filter'
import { NO_TAG } from '@/lib/domain/journal/filter'
import { buildCalendar, buildCashFlow, buildPL, type CashFlowReport } from '@/lib/utils/analytics'
```

і додати в кінець файлу:

```ts
describe('report filters (S10f)', () => {
  const period = resolvePeriod({ preset: 'currentMonth' }, NOW)
  const NONE = 'Bez kategorii'
  const totals = (report: CashFlowReport): [number, number] => [
    report.buckets.reduce((s, b) => s + b.income, 0),
    report.buckets.reduce((s, b) => s + b.expense, 0),
  ]
  const excluded = (t: Transaction): Transaction => ({ ...t, tags: ['vat'], excluded: true })

  it('Cash Flow and P&L count the excluded operations only with includeExcluded', () => {
    const txs = [
      excluded(tx('income', 230, '2026-10-20T10:00:00Z')),
      excluded(tx('expense', 230, '2026-10-20T11:00:00Z')),
      tx('income', 1000, '2026-10-21T10:00:00Z', 'cat-in'),
    ]
    expect(totals(buildCashFlow(txs, period, 'uk'))).toEqual([1000, 0])
    expect(totals(buildCashFlow(txs, period, 'uk', { includeExcluded: true }))).toEqual([1230, 230])
    const cats = [category('cat-in', 'income', 'Sprzedaż')]
    const rows = (opts?: { includeExcluded: boolean }) => buildPL(txs, cats, period, NONE, undefined, opts).rows.map((r) => [r.categoryId, r.total])
    expect(rows()).toEqual([['cat-in', 1000]])
    expect(rows({ includeExcluded: true })).toEqual([
      ['cat-in', 1000],
      ['__uncategorized_income', 230],
      ['__uncategorized_expense', 230],
    ])
  })

  it('the Calendar leaves the excluded operations out too, also from the balance carried in (the S10t gap)', () => {
    const txs = [
      excluded(tx('income', 500, '2026-09-10T12:00:00Z')),
      tx('income', 100, '2026-09-11T12:00:00Z'),
      excluded(tx('income', 230, '2026-10-20T10:00:00Z')),
      excluded(tx('expense', 230, '2026-10-20T11:00:00Z')),
      tx('expense', 40, '2026-10-21T12:00:00Z'),
    ]
    const days = buildCalendar(txs, 2026, 9)
    expect(days.reduce((s, d) => s + d.income, 0)).toBe(0)
    expect(days.reduce((s, d) => s + d.expense, 0)).toBe(40)
    expect(days[19]).toMatchObject({ date: '2026-10-20', income: 0, expense: 0, hasTransactions: false, balance: 100 })
    expect(days[30].balance).toBe(60)
    const all = buildCalendar(txs, 2026, 9, { includeExcluded: true })
    expect(all[19]).toMatchObject({ income: 230, expense: 230, hasTransactions: true, balance: 600 })
    expect(all[30].balance).toBe(560)
  })

  it('with a filter the totals are the sums of the operations it chose (the data of the e2e)', () => {
    const at = (t: Transaction, over: Partial<Transaction>): Transaction => ({ ...t, ...over })
    const txs = [
      at(tx('income', 500, '2026-10-02T10:00:00Z', 'cat-in'), { accountId: 'main' }),
      at(tx('expense', 120, '2026-10-05T10:00:00Z', 'cat-ex'), { accountId: 'main' }),
      at(tx('expense', 40, '2026-10-06T10:00:00Z', 'cat-ex'), { accountId: 'main', tags: ['fuel'] }),
      at(tx('expense', 230, '2026-10-07T10:00:00Z'), { accountId: 'main', tags: ['vat'], excluded: true }),
      at(tx('income', 230, '2026-10-07T10:00:00Z'), { accountId: 'vat', tags: ['vat'], excluded: true }),
      at(tx('expense', 15, '2026-10-08T10:00:00Z', 'cat-ex'), { accountId: 'vat' }),
      at(tx('transfer', 300, '2026-10-09T10:00:00Z'), { accountId: 'main', toAccountId: 'vat' }),
    ]
    const cats = [category('cat-in', 'income', 'Sprzedaż'), category('cat-ex', 'expense', 'Koszty')]
    const cases: [Partial<AnalyticsFilters>, [number, number]][] = [
      [{}, [500, 175]],
      [{ tagIds: ['vat'] }, [230, 230]],
      [{ tagIds: [NO_TAG] }, [500, 135]],
      [{ accountIds: ['vat'] }, [0, 15]],
      [{ types: ['expense'], categoryIds: ['cat-ex'] }, [0, 175]],
    ]
    for (const [choice, expected] of cases) {
      const { operations, includeExcluded } = filterForAnalytics(txs, { ...EMPTY_ANALYTICS_FILTERS, ...choice })
      const counted = operations.filter((t) => t.type !== 'transfer' && (includeExcluded || t.excluded !== true))
      const sum = (type: 'income' | 'expense') => counted.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0)
      const label = JSON.stringify(choice)
      expect([sum('income'), sum('expense')], label).toEqual(expected)
      expect(totals(buildCashFlow(operations, period, 'uk', { includeExcluded })), label).toEqual(expected)
      const pl = buildPL(operations, cats, period, NONE, undefined, { includeExcluded })
      const plSum = (type: 'income' | 'expense') => pl.rows.filter((r) => r.type === type).reduce((s, r) => s + r.total, 0)
      expect([plSum('income'), plSum('expense')], label).toEqual(expected)
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/utils/analytics.test.ts`
Expected: FAIL (`includeExcluded` ще ігнорується: `[1000, 0]` замість `[1230, 230]`; Календар рахує виключені).

- [ ] **Step 3: Implement**

У `lib/utils/analytics.ts`:

1. Замінити `import { Transaction, Account, Category } from '@/types'` на `import { Transaction, Category } from '@/types'`.

2. Замінити

```ts
export interface BalanceData {
  totalAssets: number
  totalBalance: number
  accounts: Account[]
}
```

на

```ts
/** How a report treats the operations excluded from analytics by their tags (S10t). */
export interface ReportOptions {
  /** Count them too: a concrete tag is chosen in the report filters (S10f, Finmap's rule). Default false. */
  includeExcluded?: boolean
}

/** The one rule of the reports: an operation excluded from analytics counts only when the filters ask for it (S10f). */
export function countsInAnalytics(tx: Pick<Transaction, 'excluded'>, opts: ReportOptions = {}): boolean {
  return tx.excluded !== true || opts.includeExcluded === true
}
```

3. Замінити

```ts
 * Transfers and operations excluded from analytics by their tags (S10t) do not count. `balance` is the running total
 * of `net` from the start of the range.
 * `locale` (the UI language) only decides the bucket labels.
 */
export function buildCashFlow(transactions: Transaction[], range: PeriodRange, locale: Locale): CashFlowReport {
```

на

```ts
 * Transfers do not count, nor do operations excluded from analytics by their tags (S10t) unless `opts.includeExcluded`
 * (S10f). `balance` is the running total of `net` from the start of the range.
 * `locale` (the UI language) only decides the bucket labels.
 */
export function buildCashFlow(transactions: Transaction[], range: PeriodRange, locale: Locale, opts: ReportOptions = {}): CashFlowReport {
```

4. Замінити `    if (tx.excluded || !inRange(tx, bounded)) continue` на `    if (!countsInAnalytics(tx, opts) || !inRange(tx, bounded)) continue`.

5. Замінити

```ts
 * Transfers and operations excluded from analytics (S10t) do not count; transactions without a known category go to two rows (income and
```

на

```ts
 * Transfers do not count, nor do operations excluded from analytics (S10t) unless `opts.includeExcluded` (S10f); transactions without a known category go to two rows (income and
```

і

```ts
  nameOf: (category: Category) => string = (category) => category.name
): PLReport {
```

на

```ts
  nameOf: (category: Category) => string = (category) => category.name,
  opts: ReportOptions = {}
): PLReport {
```

6. Замінити `    if (tx.type === 'transfer' || tx.excluded) continue` на `    if (tx.type === 'transfer' || !countsInAnalytics(tx, opts)) continue`.

7. Замінити

```ts
export function buildCalendar(
  transactions: Transaction[],
  year: number,
  month: number
): DayData[] {
```

на

```ts
/**
 * The days of a month (`month` 0-based) with their income, expense and running balance. Transfers do not count, nor do
 * operations excluded from analytics unless `opts.includeExcluded` (S10f closes the gap S10t left here): neither in the days
 * nor in the balance carried in from before the month.
 */
export function buildCalendar(
  transactions: Transaction[],
  year: number,
  month: number,
  opts: ReportOptions = {}
): DayData[] {
```

8. Замінити

```ts
  for (const tx of transactions) {
    const date = tx.date instanceof Date ? tx.date : new Date(tx.date)
    if (date.getFullYear() < year || (date.getFullYear() === year && date.getMonth() < month)) {
```

на

```ts
  for (const tx of transactions) {
    if (!countsInAnalytics(tx, opts)) continue
    const date = tx.date instanceof Date ? tx.date : new Date(tx.date)
    if (date.getFullYear() < year || (date.getFullYear() === year && date.getMonth() < month)) {
```

і

```ts
    for (const tx of transactions) {
      const date = tx.date instanceof Date ? tx.date : new Date(tx.date)
      const txDateStr =
```

на

```ts
    for (const tx of transactions) {
      if (!countsInAnalytics(tx, opts)) continue
      const date = tx.date instanceof Date ? tx.date : new Date(tx.date)
      const txDateStr =
```

9. Видалити мертву функцію (ніде не викликається; `BalanceSheet` сам сумує свої рахунки) разом із порожнім рядком перед нею:

```ts

export function buildBalance(accounts: Account[]): BalanceData {
  const totalBalance = accounts.reduce((sum, acc) => sum + acc.balance, 0)
  return {
    totalAssets: totalBalance,
    totalBalance,
    accounts,
  }
}
```

Перевірка, що її ніхто не імпортує: `cd /f/AI/finflow && grep -rn "buildBalance\|BalanceData" app components lib tests types` має нічого не знайти.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/utils && npm run typecheck`
Expected: PASS (3 нові тести, наявні тести звітів без змін), `tsc` чисто (сторінки ще викликають звіти без `opts`, це дозволено).

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add lib/utils/analytics.ts tests/unit/utils/analytics.test.ts && git commit -m "feat(analytics): includeExcluded in the reports; the Calendar skips excluded operations

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Адреса: хук `useAnalyticsFilters` і вкладки, що зберігають фільтри

**Files:**
- Create: `lib/hooks/useAnalyticsFilters.ts`
- Modify: `lib/shell/analytics-sections.ts`, `components/shell/AnalyticsNav.tsx`, `tests/unit/shell/analytics-sections.test.ts`

- [ ] **Step 1: Write the failing test**

У `tests/unit/shell/analytics-sections.test.ts` замінити

```ts
import { ANALYTICS_SECTIONS, activeAnalyticsSection, analyticsPath } from '@/lib/shell/analytics-sections'
```

на

```ts
import { ANALYTICS_SECTIONS, activeAnalyticsSection, analyticsHref, analyticsPath } from '@/lib/shell/analytics-sections'
```

і додати після блоку `describe('analyticsPath', ...)`:

```ts
describe('analyticsHref', () => {
  it('carries the query of the report filters (S10f), nothing when there is none', () => {
    expect(analyticsHref('org1', 'pl', 'tg=vat&accounts=a1')).toBe('/org1/analytics/pl?tg=vat&accounts=a1')
    expect(analyticsHref('org1', 'balance', '')).toBe('/org1/analytics/balance')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/shell/analytics-sections.test.ts`
Expected: FAIL (`analyticsHref` не експортовано).

- [ ] **Step 3: Implement**

У кінець `lib/shell/analytics-sections.ts` додати:

```ts

/** The report URL with a query: the report filters (S10f) ride along when the person switches tabs. */
export function analyticsHref(orgId: string, section: AnalyticsSection, query: string): string {
  const path = analyticsPath(orgId, section)
  return query ? `${path}?${query}` : path
}
```

Створити `lib/hooks/useAnalyticsFilters.ts`:

```ts
'use client'

import { useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { analyticsFiltersToParams, parseAnalyticsFilters, type AnalyticsFilters } from '@/lib/domain/analytics-filter/filter'

export interface UseAnalyticsFiltersResult {
  filters: AnalyticsFilters
  /** Writes the filters into the address (replace, no scroll), as the journal does with its view. */
  setFilters: (next: AnalyticsFilters) => void
}

/** The report filters of S10f: they live in the address, so a link shares them and the report tabs keep them. */
export function useAnalyticsFilters(): UseAnalyticsFiltersResult {
  const router = useRouter()
  const pathname = usePathname()
  const query = useSearchParams().toString()
  // Parsed once per address, so the pages' memos see the same object until the address changes.
  const filters = useMemo(() => parseAnalyticsFilters(new URLSearchParams(query)), [query])
  const setFilters = (next: AnalyticsFilters) => {
    const params = analyticsFiltersToParams(next).toString()
    router.replace(params ? `${pathname}?${params}` : pathname, { scroll: false })
  }
  return { filters, setFilters }
}
```

У `components/shell/AnalyticsNav.tsx` замінити

```ts
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useShell } from '@/lib/hooks/useShell'
import { ANALYTICS_SECTIONS, activeAnalyticsSection, analyticsPath } from '@/lib/shell/analytics-sections'
```

на

```ts
import { usePathname, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { analyticsFiltersToParams, parseAnalyticsFilters } from '@/lib/domain/analytics-filter/filter'
import { useShell } from '@/lib/hooks/useShell'
import { ANALYTICS_SECTIONS, activeAnalyticsSection, analyticsHref } from '@/lib/shell/analytics-sections'
```

замінити

```ts
  const active = activeAnalyticsSection(usePathname(), orgId)
```

на

```ts
  const active = activeAnalyticsSection(usePathname(), orgId)
  // The report filters (S10f) follow the person from tab to tab: only their own parameters go along, normalised.
  const query = analyticsFiltersToParams(parseAnalyticsFilters(useSearchParams())).toString()
```

і `            href={analyticsPath(orgId, section.slug)}` на `            href={analyticsHref(orgId, section.slug, query)}`.

- [ ] **Step 4: Run the checks**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/shell && npm run typecheck && npm run lint`
Expected: PASS (1 новий тест), `tsc` чисто, `lint` 0 errors / 10 warnings.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add lib/shell/analytics-sections.ts lib/hooks/useAnalyticsFilters.ts components/shell/AnalyticsNav.tsx tests/unit/shell/analytics-sections.test.ts && git commit -m "feat(analytics): report filters in the address, kept across the report tabs

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Повідомлення uk / pl / en

**Files:**
- Modify: `messages/uk.json`, `messages/pl.json`, `messages/en.json`

- [ ] **Step 1: Merge the keys**

Створити інструментом Write файл `s10f-i18n.cjs` у своєму скретчпаді (каталог поза репозиторієм; якщо скретчпаду немає, `$TEMP`), щоб кирилиця лишилась UTF-8:

```js
// Temporary (S10f plan, Task 5): merges analytics.filters into the three catalogs, keeping their format. Not committed.
const fs = require('fs')
const path = require('path')
const ROOT = 'F:/AI/finflow'
const ADD = {
  uk: {
    analytics: {
      filters: {
        button: 'Фільтри',
        buttonActive: 'Фільтри (активних: {count})',
        title: 'Фільтри',
        apply: 'Готово',
        reset: 'Скинути фільтри',
        choose: 'Вибрати',
        excludedHint: 'Показано також операції, виключені з аналітики',
        noMatches: 'Нічого не знайдено',
        more: 'Ще {count}: уточніть пошук',
        full: 'Не більше {max} у списку',
        kinds: { label: 'Види платежів і категорії', all: 'Усі види і категорії', search: 'Пошук категорій' },
        counterparties: { label: 'Контрагенти', all: 'Усі контрагенти', search: 'Пошук контрагентів' },
        tags: { label: 'Теги', all: 'Усі теги', search: 'Пошук тегів', untagged: 'Без тегів' },
        accounts: { label: 'Рахунки', all: 'Усі рахунки', search: 'Пошук рахунків' },
      },
    },
  },
  pl: {
    analytics: {
      filters: {
        button: 'Filtry',
        buttonActive: 'Filtry (aktywne: {count})',
        title: 'Filtry',
        apply: 'Gotowe',
        reset: 'Zresetuj filtry',
        choose: 'Wybrać',
        excludedHint: 'Pokazano też operacje wyłączone z analityki',
        noMatches: 'Nic nie znaleziono',
        more: 'Jeszcze {count}: zawęź wyszukiwanie',
        full: 'Nie więcej niż {max} na liście',
        kinds: { label: 'Rodzaje płatności i kategorie', all: 'Wszystkie rodzaje i kategorie', search: 'Szukaj kategorii' },
        counterparties: { label: 'Kontrahenci', all: 'Wszyscy kontrahenci', search: 'Szukaj kontrahentów' },
        tags: { label: 'Tagi', all: 'Wszystkie tagi', search: 'Szukaj tagów', untagged: 'Bez tagów' },
        accounts: { label: 'Konta', all: 'Wszystkie konta', search: 'Szukaj kont' },
      },
    },
  },
  en: {
    analytics: {
      filters: {
        button: 'Filters',
        buttonActive: 'Filters (active: {count})',
        title: 'Filters',
        apply: 'Done',
        reset: 'Reset filters',
        choose: 'Select',
        excludedHint: 'Also showing operations excluded from analytics',
        noMatches: 'Nothing found',
        more: '{count} more: narrow the search',
        full: 'At most {max} in the list',
        kinds: { label: 'Payment types and categories', all: 'All types and categories', search: 'Search categories' },
        counterparties: { label: 'Counterparties', all: 'All counterparties', search: 'Search counterparties' },
        tags: { label: 'Tags', all: 'All tags', search: 'Search tags', untagged: 'No tags' },
        accounts: { label: 'Accounts', all: 'All accounts', search: 'Search accounts' },
      },
    },
  },
}
function merge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && target[key] !== null && typeof target[key] === 'object') merge(target[key], value)
    else target[key] = value
  }
}
for (const [lang, fragment] of Object.entries(ADD)) {
  const file = path.join(ROOT, 'messages', `${lang}.json`)
  const src = fs.readFileSync(file, 'utf8')
  const data = JSON.parse(src)
  merge(data, fragment)
  let out = JSON.stringify(data, null, 2) + '\n'
  if (src.includes('\r\n')) out = out.replace(/\n/g, '\r\n')
  fs.writeFileSync(file, out)
}
```

Run (підставити повний шлях до скрипта): `cd /f/AI/finflow && node "<скретчпад>/s10f-i18n.cjs" && rm "<скретчпад>/s10f-i18n.cjs" && git diff --stat messages`
Expected: три каталоги змінено однаково (у кожному новий блок `analytics.filters` з 23 ключами в кінці `analytics`, кома після колишнього останнього ключа `balance`; більше нічого).

- [ ] **Step 2: Run the checks**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/i18n && npm run typecheck`
Expected: PASS (однакові ключі й аргументи ICU `{count}`, `{max}` у трьох каталогах), `tsc` чисто.

- [ ] **Step 3: Commit**

```bash
cd /f/AI/finflow && git add messages/uk.json messages/pl.json messages/en.json && git commit -m "feat(analytics): uk, pl and en texts for the report filters

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Компоненти: `FilterMultiSelect`, діалог «Фільтри», кнопка й підказка

**Files:**
- Create: `components/analytics/FilterMultiSelect.tsx`, `components/analytics/AnalyticsFiltersDialog.tsx`, `components/analytics/AnalyticsFilters.tsx`

- [ ] **Step 1: The multi-select**

Створити `components/analytics/FilterMultiSelect.tsx`:

```tsx
'use client'

import { useId, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { nameKeyText } from '@/lib/domain/counterparties/normalize'
import { MAX_FILTER_IDS } from '@/lib/domain/journal/filter'
import { highlightedRow } from '@/lib/ui/highlight'
import { cn } from '@/lib/utils'

/** Rows the open list shows at most; the search narrows the rest. */
const MAX_ROWS = 100

export interface FilterOption {
  id: string
  label: string
  /** A colour mark before the label (a tag, an account, a category). */
  marker?: ReactNode
  /** A short muted note after the label («не враховується в аналітиці»). */
  note?: string
  /** Archived: still offered (old operations carry it), shown muted. */
  muted?: boolean
  /** Indented under the row above it (a category under its payment type). */
  nested?: boolean
  /** Not counted against the list limit, shown bold (a payment type above its categories). */
  free?: boolean
}

interface Props {
  /** The field's name; the closed field reads «Теги (2)» once something is chosen. */
  label: string
  /** The first row: ticked while nothing is chosen; ticking it clears the choice («Усі теги»). */
  allLabel: string
  /** The search field's placeholder and name («Пошук тегів»). */
  searchLabel: string
  options: FilterOption[]
  /** The chosen ids: the dialog's draft. */
  value: string[]
  onChange: (ids: string[]) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  /** No more ids may be added (the 30-id limit of the address): rows not chosen yet, except `free` ones, are disabled. */
  full?: boolean
  disabled?: boolean
}

type Row = { kind: 'all' } | { kind: 'option'; option: FilterOption }

/**
 * A multiple choice the way Finmap's «Filtry» shows it (S10f): the field opens a list under itself with a search, «Усі …»
 * first, one checkbox row per value and «Вибрати». A tick goes to the dialog's draft at once; «Вибрати» and Esc close the
 * list. The highlight follows S10t: nothing is highlighted until the person types, presses an arrow or really moves the
 * pointer, so Enter never ticks a row by accident.
 */
export function FilterMultiSelect({ label, allLabel, searchLabel, options, value, onChange, open, onOpenChange, full = false, disabled }: Props) {
  const t = useTranslations('analytics.filters')
  const panelId = useId()
  const listId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [query, setQuery] = useState('')
  // The row the person moved the highlight to; null until they do.
  const [moved, setMoved] = useState<number | null>(null)
  // Where the pointer was when it last entered or moved over a row: only a real move may move the highlight (S10t).
  const pointer = useRef<string | null>(null)

  const q = nameKeyText(query)
  const matching = q === '' ? options : options.filter((o) => nameKeyText(o.label).includes(q))
  // While searching there is no «Усі …» row, so the first match (highlighted by typing) is never «clear the choice».
  const head: Row[] = q === '' ? [{ kind: 'all' }] : []
  const rows: Row[] = [...head, ...matching.slice(0, MAX_ROWS).map((option): Row => ({ kind: 'option', option }))]
  const hidden = Math.max(0, matching.length - MAX_ROWS)
  const highlighted = highlightedRow(rows.length, q, moved)
  const chosen = new Set(value)
  const count = value.length

  const close = () => {
    onOpenChange(false)
    setQuery('')
    setMoved(null)
    pointer.current = null
    triggerRef.current?.focus()
  }
  const blocked = (row: Row): boolean => row.kind === 'option' && full && !chosen.has(row.option.id) && row.option.free !== true
  const toggle = (row: Row) => {
    if (row.kind === 'all') onChange([])
    else if (chosen.has(row.option.id)) onChange(value.filter((id) => id !== row.option.id))
    else if (!blocked(row)) onChange([...value, row.option.id])
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (rows.length > 0) setMoved(Math.min(highlighted + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (rows.length > 0) setMoved(Math.max(highlighted - 1, 0))
    } else if (e.key === 'Enter') {
      // Enter never submits and never ticks a row nobody highlighted.
      e.preventDefault()
      if (highlighted >= 0) toggle(rows[highlighted])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      // Closing the list must not also close the dialog around it.
      e.stopPropagation()
      close()
    }
  }

  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          if (open) {
            close()
            return
          }
          setQuery('')
          setMoved(null)
          onOpenChange(true)
        }}
        className={cn(
          'flex h-10 w-full items-center gap-2 rounded-field border border-line bg-surface px-3 text-left text-sm text-ink transition-colors hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-soft-foreground disabled:opacity-50',
          count > 0 && 'border-brand',
        )}
      >
        <span className="min-w-0 flex-1 truncate font-medium">{count > 0 ? `${label} (${count})` : label}</span>
        <ChevronDownIcon aria-hidden className={cn('size-4 shrink-0 text-ink-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div id={panelId} className="mt-1 space-y-2 rounded-field border border-line bg-surface p-2 shadow-pop">
          <Input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
            aria-label={searchLabel}
            placeholder={searchLabel}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              // Typing highlights the first match again.
              setMoved(null)
            }}
            onKeyDown={onKeyDown}
            className="h-9 rounded-control border-line bg-surface"
          />
          <ul id={listId} role="listbox" aria-multiselectable="true" aria-label={label} className="max-h-64 overflow-y-auto">
            {rows.map((row, index) => {
              const checked = row.kind === 'all' ? count === 0 : chosen.has(row.option.id)
              const off = blocked(row)
              return (
                <li
                  key={row.kind === 'all' ? 'all' : `o:${row.option.id}`}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={checked}
                  aria-disabled={off || undefined}
                  // mousedown keeps the focus in the search field; the click ticks the row.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggle(row)}
                  onMouseEnter={(e) => {
                    pointer.current = `${e.screenX},${e.screenY}`
                  }}
                  onMouseMove={(e) => {
                    const at = `${e.screenX},${e.screenY}`
                    if (at === pointer.current) return
                    pointer.current = at
                    setMoved(index)
                  }}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-control px-2 py-2 text-sm text-ink',
                    index === highlighted && 'bg-canvas',
                    row.kind === 'option' && row.option.nested && 'pl-7',
                    off && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
                      checked ? 'border-brand bg-brand text-ink' : 'border-line bg-surface',
                    )}
                  >
                    {checked && <CheckIcon className="size-3" strokeWidth={3} />}
                  </span>
                  {row.kind === 'all' ? (
                    <span className="min-w-0 flex-1 break-words font-medium">{allLabel}</span>
                  ) : (
                    <>
                      {row.option.marker && <span className="mt-1.5 flex shrink-0">{row.option.marker}</span>}
                      <span className={cn('min-w-0 flex-1 break-words', row.option.muted && 'text-ink-muted', row.option.free && 'font-medium')}>
                        {row.option.label}
                        {row.option.note && (
                          <>
                            {' '}
                            <span className="text-xs text-ink-muted">{row.option.note}</span>
                          </>
                        )}
                      </span>
                    </>
                  )}
                </li>
              )
            })}
            {matching.length === 0 && (
              <li role="presentation" className="px-2 py-2 text-sm text-ink-muted">
                {t('noMatches')}
              </li>
            )}
          </ul>
          {hidden > 0 && <p className="px-2 text-xs text-ink-muted">{t('more', { count: hidden })}</p>}
          {full && <p className="px-2 text-xs text-ink-muted">{t('full', { max: MAX_FILTER_IDS })}</p>}
          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={close}>
              {t('choose')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: The dialog**

Створити `components/analytics/AnalyticsFiltersDialog.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { FilterMultiSelect, type FilterOption } from '@/components/analytics/FilterMultiSelect'
import { TagDot } from '@/components/tags/TagDot'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EMPTY_ANALYTICS_FILTERS, type AnalyticsFilters, type AnalyticsScope } from '@/lib/domain/analytics-filter/filter'
import { nameKeyText } from '@/lib/domain/counterparties/normalize'
import { MAX_FILTER_IDS, NO_TAG } from '@/lib/domain/journal/filter'
import { TX_TYPES, type TxType } from '@/lib/domain/ledger/types'
import { useCounterparties } from '@/lib/hooks/useCounterparties'
import { useShell } from '@/lib/hooks/useShell'
import { useTags } from '@/lib/hooks/useTags'
import { useCategoryName } from '@/lib/i18n/useCategoryName'

type Field = 'kinds' | 'counterparties' | 'tags' | 'accounts'

// The payment types and the categories share one list, so their ids get a prefix there.
const TYPE = 't:'
const CATEGORY = 'c:'

/** A colour the person chose for an account or a category: data, so it stays inline. */
function ColorDot({ color }: { color: string }) {
  return <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
}

/** Name order, case and Latin diacritics ignored (the key the tags and counterparties compare names by). */
function byName<T>(name: (x: T) => string): (a: T, b: T) => number {
  return (a, b) => {
    const x = nameKeyText(name(a))
    const y = nameKeyText(name(b))
    return x < y ? -1 : x > y ? 1 : 0
  }
}

interface Props {
  /** `accounts` on the Balance: only «Рахунки» is shown. */
  scope: AnalyticsScope
  /** The filters in the address when the dialog opened. */
  value: AnalyticsFilters
  onApply: (next: AnalyticsFilters) => void
  onClose: () => void
}

/**
 * «Фільтри» of the reports (S10f, Finmap's dialog): «Види платежів і категорії», «Контрагенти», «Теги» (with «Без тегів»),
 * «Рахунки». The choice is a draft in this dialog (a tick shows at once); «Готово» hands it over, «Скинути фільтри» clears
 * the fields shown and applies, closing the dialog any other way drops the draft.
 */
export function AnalyticsFiltersDialog({ scope, value, onApply, onClose }: Props) {
  const t = useTranslations('analytics.filters')
  const tTypes = useTranslations('journal.filters')
  const tTags = useTranslations('settings.tags.picker')
  const categoryName = useCategoryName()
  const { orgId, accounts, incomeCategories, expenseCategories } = useShell()
  const operations = scope === 'operations'
  // Counterparties and tags are read only while the dialog is open, and never for the Balance.
  const { counterparties, loading: counterpartiesLoading } = useCounterparties(operations ? orgId : null)
  const { tags, loading: tagsLoading } = useTags(operations ? orgId : null)
  const [draft, setDraft] = useState<AnalyticsFilters>(value)
  const [openField, setOpenField] = useState<Field | null>(null)
  const set = (patch: Partial<AnalyticsFilters>) => setDraft((d) => ({ ...d, ...patch }))
  // One list open at a time.
  const field = (key: Field) => ({ open: openField === key, onOpenChange: (open: boolean) => setOpenField(open ? key : null) })

  const kindOptions = TX_TYPES.flatMap((type): FilterOption[] => {
    const categories = type === 'income' ? incomeCategories : type === 'expense' ? expenseCategories : []
    return [
      { id: `${TYPE}${type}`, label: tTypes(`type_${type}`), free: true },
      ...[...categories]
        .sort(byName(categoryName))
        .map((c): FilterOption => ({ id: `${CATEGORY}${c.id}`, label: categoryName(c), marker: <ColorDot color={c.color} />, nested: true })),
    ]
  })
  const kindValue = [...draft.types.map((x) => `${TYPE}${x}`), ...draft.categoryIds.map((x) => `${CATEGORY}${x}`)]
  const setKinds = (ids: string[]) =>
    set({
      types: ids.filter((id) => id.startsWith(TYPE)).map((id) => id.slice(TYPE.length) as TxType),
      categoryIds: ids.filter((id) => id.startsWith(CATEGORY)).map((id) => id.slice(CATEGORY.length)),
    })
  const counterpartyOptions = [...counterparties]
    .sort(byName((c) => c.name))
    .map((c): FilterOption => ({ id: c.id, label: c.name, muted: c.archived }))
  const tagOptions: FilterOption[] = [
    ...tags.map(
      (tag): FilterOption => ({
        id: tag.id,
        label: tag.name,
        marker: <TagDot color={tag.color} />,
        muted: tag.archived,
        note: tag.excludeFromAnalytics ? tTags('excluded') : undefined,
      }),
    ),
    { id: NO_TAG, label: t('tags.untagged') },
  ]
  const accountOptions = accounts.map((a): FilterOption => ({ id: a.id, label: a.name, marker: <ColorDot color={a.color} /> }))
  // «Скинути фільтри» clears what the dialog shows: everything on Cash Flow, P&L and the Calendar, the accounts on the Balance.
  const reset: AnalyticsFilters = operations ? EMPTY_ANALYTICS_FILTERS : { ...value, accountIds: [] }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* One column that may not grow to a long nowrap line: long names wrap inside it on a phone (as in TransferSuggestions). */}
      <DialogContent data-testid="analytics-filters" className="max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {operations && (
            <>
              <FilterMultiSelect
                label={t('kinds.label')}
                allLabel={t('kinds.all')}
                searchLabel={t('kinds.search')}
                options={kindOptions}
                value={kindValue}
                onChange={setKinds}
                full={draft.categoryIds.length >= MAX_FILTER_IDS}
                {...field('kinds')}
              />
              <FilterMultiSelect
                label={t('counterparties.label')}
                allLabel={t('counterparties.all')}
                searchLabel={t('counterparties.search')}
                options={counterpartyOptions}
                value={draft.counterpartyIds}
                onChange={(ids) => set({ counterpartyIds: ids })}
                full={draft.counterpartyIds.length >= MAX_FILTER_IDS}
                disabled={counterpartiesLoading}
                {...field('counterparties')}
              />
              <FilterMultiSelect
                label={t('tags.label')}
                allLabel={t('tags.all')}
                searchLabel={t('tags.search')}
                options={tagOptions}
                value={draft.tagIds}
                onChange={(ids) => set({ tagIds: ids })}
                full={draft.tagIds.length >= MAX_FILTER_IDS}
                disabled={tagsLoading}
                {...field('tags')}
              />
            </>
          )}
          <FilterMultiSelect
            label={t('accounts.label')}
            allLabel={t('accounts.all')}
            searchLabel={t('accounts.search')}
            options={accountOptions}
            value={draft.accountIds}
            onChange={(ids) => set({ accountIds: ids })}
            full={draft.accountIds.length >= MAX_FILTER_IDS}
            {...field('accounts')}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onApply(reset)}>
            {t('reset')}
          </Button>
          <Button type="button" onClick={() => onApply(draft)}>
            {t('apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: The button and the hint**

Створити `components/analytics/AnalyticsFilters.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { EyeOff, SlidersHorizontal } from 'lucide-react'
import { AnalyticsFiltersDialog } from '@/components/analytics/AnalyticsFiltersDialog'
import { TOOLBAR_PILL } from '@/components/analytics/PeriodSelect'
import { activeAnalyticsFilterCount, type AnalyticsFilters, type AnalyticsScope } from '@/lib/domain/analytics-filter/filter'
import { cn } from '@/lib/utils'

interface ButtonProps {
  /** `accounts` on the Balance: only the account field is shown and counted. */
  scope: AnalyticsScope
  value: AnalyticsFilters
  onChange: (next: AnalyticsFilters) => void
}

/** The «Фільтри» pill of a report (S10f) with the number of fields in use; the dialog is mounted only while open. */
export function AnalyticsFiltersButton({ scope, value, onChange }: ButtonProps) {
  const t = useTranslations('analytics.filters')
  const [open, setOpen] = useState(false)
  const count = activeAnalyticsFilterCount(value, scope)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={count > 0 ? t('buttonActive', { count }) : t('button')}
        className={cn(TOOLBAR_PILL, count > 0 && 'bg-brand-soft text-brand-soft-foreground hover:bg-brand-soft-hover')}
      >
        <SlidersHorizontal aria-hidden className="size-4 shrink-0" />
        <span>{t('button')}</span>
        {count > 0 && (
          <span
            data-testid="analytics-filters-count"
            aria-hidden
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-soft-foreground px-1.5 text-xs font-semibold tabular-nums text-white"
          >
            {count}
          </span>
        )}
      </button>
      {open && (
        <AnalyticsFiltersDialog
          scope={scope}
          value={value}
          onApply={(next) => {
            onChange(next)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** «Показано також операції, виключені з аналітики»: over a report that counts them because a tag is chosen (S10f). */
export function ExcludedHint() {
  const t = useTranslations('analytics.filters')
  return (
    <p data-testid="analytics-excluded-hint" className="flex items-start gap-2 rounded-field bg-canvas px-3 py-2 text-sm text-ink-muted">
      <EyeOff aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{t('excludedHint')}</span>
    </p>
  )
}
```

- [ ] **Step 4: Run the checks**

Run: `cd /f/AI/finflow && npm run typecheck && npm run lint && npx vitest run --config vitest.config.ts tests/unit/i18n`
Expected: `tsc` чисто; `lint` 0 errors / 10 warnings (у нових файлах жодного: немає `setState` в ефектах, `ref.current` читається лише в обробниках); `no-hardcoded-text` PASS (кирилиця лише в коментарях).

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add components/analytics/FilterMultiSelect.tsx components/analytics/AnalyticsFiltersDialog.tsx components/analytics/AnalyticsFilters.tsx && git commit -m "feat(analytics): the Filters dialog with Finmap-style multi-selects

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Cash Flow і P&L: кнопка в `ReportToolbar`, відфільтровані звіти, підказка

**Files:**
- Modify: `components/analytics/ReportToolbar.tsx`, `app/(app)/[orgSlug]/analytics/cashflow/page.tsx`, `app/(app)/[orgSlug]/analytics/pl/page.tsx`

- [ ] **Step 1: The toolbar**

Замінити файл `components/analytics/ReportToolbar.tsx` повністю:

```tsx
'use client'

import { useTranslations } from 'next-intl'
import { Download } from 'lucide-react'
import { AnalyticsFiltersButton } from '@/components/analytics/AnalyticsFilters'
import { PeriodSelect } from '@/components/analytics/PeriodSelect'
import type { AnalyticsFilters } from '@/lib/domain/analytics-filter/filter'
import type { PeriodSelection } from '@/lib/utils/period'

interface ReportToolbarProps {
  period: PeriodSelection
  onPeriodChange: (value: PeriodSelection) => void
  /** The report filters from the address (S10f). */
  filters: AnalyticsFilters
  onFiltersChange: (next: AnalyticsFilters) => void
  onExport: () => void
}

/**
 * The row of pills under a report's title (Finmap's report toolbar structure): the period filter first, then «Фільтри»
 * (S10f), then the actions as square icon pills (CSV export).
 */
export function ReportToolbar({ period, onPeriodChange, filters, onFiltersChange, onExport }: ReportToolbarProps) {
  const t = useTranslations('analytics')
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PeriodSelect value={period} onChange={onPeriodChange} />
      <AnalyticsFiltersButton scope="operations" value={filters} onChange={onFiltersChange} />
      <button
        type="button"
        onClick={onExport}
        aria-label={t('exportCsv')}
        title={t('exportCsv')}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-field bg-canvas text-ink transition-colors hover:bg-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-soft-foreground sm:size-10"
      >
        <Download aria-hidden className="size-4.5" />
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Cash Flow**

У `app/(app)/[orgSlug]/analytics/cashflow/page.tsx`:

1. Замінити

```ts
import { useState, useMemo } from 'react'
import { useTransactions } from '@/lib/hooks/useTransactions'
```

на

```ts
import { useState, useMemo } from 'react'
import { filterForAnalytics } from '@/lib/domain/analytics-filter/filter'
import { useAnalyticsFilters } from '@/lib/hooks/useAnalyticsFilters'
import { useTransactions } from '@/lib/hooks/useTransactions'
```

2. Замінити `import { ReportToolbar } from '@/components/analytics/ReportToolbar'` на

```ts
import { ExcludedHint } from '@/components/analytics/AnalyticsFilters'
import { ReportToolbar } from '@/components/analytics/ReportToolbar'
```

3. Замінити

```ts
  const { granularity, buckets: data } = useMemo(
    () => buildCashFlow(transactions, resolvePeriod(period, now), locale),
    [transactions, period, now, locale]
  )
```

на

```ts
  // The report filters live in the address (S10f); a concrete tag brings the operations excluded from analytics in.
  const { filters, setFilters } = useAnalyticsFilters()
  const selection = useMemo(() => filterForAnalytics(transactions, filters), [transactions, filters])

  const { granularity, buckets: data } = useMemo(
    () => buildCashFlow(selection.operations, resolvePeriod(period, now), locale, { includeExcluded: selection.includeExcluded }),
    [selection, period, now, locale]
  )
```

4. Замінити

```tsx
          <ReportToolbar period={period} onPeriodChange={setPeriod} onExport={handleExport} />
```

на

```tsx
          <ReportToolbar period={period} onPeriodChange={setPeriod} filters={filters} onFiltersChange={setFilters} onExport={handleExport} />
          {selection.showsExcluded && <ExcludedHint />}
```

CSV (`handleExport`) не змінюється: він бере рядки `data`, які тепер побудовані з відфільтрованих операцій.

- [ ] **Step 3: P&L**

У `app/(app)/[orgSlug]/analytics/pl/page.tsx`:

1. Замінити `import { useTransactions } from '@/lib/hooks/useTransactions'` на

```ts
import { filterForAnalytics } from '@/lib/domain/analytics-filter/filter'
import { useAnalyticsFilters } from '@/lib/hooks/useAnalyticsFilters'
import { useTransactions } from '@/lib/hooks/useTransactions'
```

2. Замінити `import { ReportToolbar } from '@/components/analytics/ReportToolbar'` на

```ts
import { ExcludedHint } from '@/components/analytics/AnalyticsFilters'
import { ReportToolbar } from '@/components/analytics/ReportToolbar'
```

3. Замінити

```ts
  const { monthKeys, rows } = useMemo(
    () => buildPL(transactions, categories, resolvePeriod(period, now), noCategory, categoryName),
    [transactions, categories, period, now, noCategory, categoryName]
  )
```

на

```ts
  // The report filters live in the address (S10f); a concrete tag brings the operations excluded from analytics in.
  const { filters, setFilters } = useAnalyticsFilters()
  const selection = useMemo(() => filterForAnalytics(transactions, filters), [transactions, filters])

  const { monthKeys, rows } = useMemo(
    () => buildPL(selection.operations, categories, resolvePeriod(period, now), noCategory, categoryName, { includeExcluded: selection.includeExcluded }),
    [selection, categories, period, now, noCategory, categoryName]
  )
```

4. Замінити

```tsx
          <ReportToolbar period={period} onPeriodChange={setPeriod} onExport={handleExport} />
```

на

```tsx
          <ReportToolbar period={period} onPeriodChange={setPeriod} filters={filters} onFiltersChange={setFilters} onExport={handleExport} />
          {selection.showsExcluded && <ExcludedHint />}
```

- [ ] **Step 4: Run the checks**

Run: `cd /f/AI/finflow && npm run typecheck && npm run lint && npx vitest run --config vitest.config.ts tests/unit/utils tests/unit/domain/analytics-filter tests/unit/i18n`
Expected: `tsc` чисто, `lint` 0 errors / 10 warnings, тести PASS.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add components/analytics/ReportToolbar.tsx "app/(app)/[orgSlug]/analytics/cashflow/page.tsx" "app/(app)/[orgSlug]/analytics/pl/page.tsx" && git commit -m "feat(analytics): Filters on Cash Flow and P&L, with the excluded-operations hint

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Календар і Баланс

**Files:**
- Modify: `components/charts/CalendarView.tsx`, `app/(app)/[orgSlug]/analytics/calendar/page.tsx`, `app/(app)/[orgSlug]/analytics/balance/page.tsx`

- [ ] **Step 1: CalendarView**

У `components/charts/CalendarView.tsx`:

1. Замінити `import { buildCalendar, DayData } from '@/lib/utils/analytics'` на `import { buildCalendar, countsInAnalytics, DayData } from '@/lib/utils/analytics'`.

2. Замінити

```ts
  currency: string
  loading?: boolean
}

/** «жовтень» -> «Жовтень»
```

на

```ts
  currency: string
  loading?: boolean
  /** A concrete tag is chosen in the report filters (S10f): the operations excluded from analytics count too. */
  includeExcluded?: boolean
}

/** «жовтень» -> «Жовтень»
```

3. Замінити

```ts
export default function CalendarView({ transactions, year, month, onNavigate, currency, loading }: CalendarViewProps) {
```

на

```ts
export default function CalendarView({ transactions, year, month, onNavigate, currency, loading, includeExcluded = false }: CalendarViewProps) {
```

і

```ts
  const days = buildCalendar(transactions, year, month)
```

на

```ts
  const days = buildCalendar(transactions, year, month, { includeExcluded })
  // The list under an opened day shows what the day's totals count (transfers stay listed, as before).
  const counted = transactions.filter((tx) => countsInAnalytics(tx, { includeExcluded }))
```

4. Замінити

```tsx
              transactions={transactions}
              currency={currency}
```

на

```tsx
              transactions={counted}
              currency={currency}
```

- [ ] **Step 2: The Calendar page**

У `app/(app)/[orgSlug]/analytics/calendar/page.tsx`:

1. Замінити `import { useState } from 'react'` на `import { useMemo, useState } from 'react'`.

2. Замінити `import CalendarView from '@/components/charts/CalendarView'` на

```ts
import CalendarView from '@/components/charts/CalendarView'
import { AnalyticsFiltersButton, ExcludedHint } from '@/components/analytics/AnalyticsFilters'
import { filterForAnalytics } from '@/lib/domain/analytics-filter/filter'
import { useAnalyticsFilters } from '@/lib/hooks/useAnalyticsFilters'
```

3. Замінити

```ts
  const loading = txLoading || !org
```

на

```ts
  const loading = txLoading || !org
  // The report filters live in the address (S10f); a concrete tag brings the operations excluded from analytics in.
  const { filters, setFilters } = useAnalyticsFilters()
  const selection = useMemo(() => filterForAnalytics(transactions, filters), [transactions, filters])
```

4. Замінити

```tsx
      <CalendarView
        transactions={transactions}
```

на

```tsx
      <div className="space-y-4">
        <AnalyticsFiltersButton scope="operations" value={filters} onChange={setFilters} />
        {selection.showsExcluded && <ExcludedHint />}
      </div>

      <CalendarView
        transactions={selection.operations}
        includeExcluded={selection.includeExcluded}
```

- [ ] **Step 3: The Balance page**

У `app/(app)/[orgSlug]/analytics/balance/page.tsx`:

1. Замінити `import { useState } from 'react'` на `import { useMemo, useState } from 'react'`.

2. Замінити `import { NativeSelect } from '@/components/ui/native-select'` на

```ts
import { AnalyticsFiltersButton } from '@/components/analytics/AnalyticsFilters'
import { NativeSelect } from '@/components/ui/native-select'
import { filterAccounts } from '@/lib/domain/analytics-filter/filter'
import { useAnalyticsFilters } from '@/lib/hooks/useAnalyticsFilters'
```

3. Замінити

```ts
  const handleExport = () => {
    exportToCSV(
      accounts.map((acc) => ({
```

на

```ts
  // The Balance is made of accounts: of the report filters (S10f) only the accounts apply; the rest stay in the address for the other tabs.
  const { filters, setFilters } = useAnalyticsFilters()
  const shown = useMemo(() => filterAccounts(accounts, filters), [accounts, filters])

  const handleExport = () => {
    exportToCSV(
      shown.map((acc) => ({
```

4. Замінити

```tsx
        {/* Period dropdown */}
        <div className="flex items-center gap-3">
```

на

```tsx
        {/* Period dropdown and the account filter (S10f) */}
        <div className="flex flex-wrap items-center gap-3">
```

5. Замінити

```tsx
          </NativeSelect>
        </div>
```

на

```tsx
          </NativeSelect>
          <AnalyticsFiltersButton scope="accounts" value={filters} onChange={setFilters} />
        </div>
```

6. Замінити `          accounts={accounts}` (проп `BalanceSheet`) на `          accounts={shown}`.

- [ ] **Step 4: Run the checks**

Run: `cd /f/AI/finflow && npm run typecheck && npm run lint && npx vitest run --config vitest.config.ts tests/unit/utils tests/unit/i18n`
Expected: `tsc` чисто, `lint` 0 errors / 10 warnings, тести PASS.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add components/charts/CalendarView.tsx "app/(app)/[orgSlug]/analytics/calendar/page.tsx" "app/(app)/[orgSlug]/analytics/balance/page.tsx" && git commit -m "feat(analytics): Filters on the Calendar and the account filter on the Balance

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: E2E фільтрів і скриншоти

**Files:**
- Create: `tests/e2e/analytics-filters.spec.ts`, `tests/ui-shots/analytics-filters.spec.ts`

- [ ] **Step 1: Write the e2e spec**

Створити `tests/e2e/analytics-filters.spec.ts`:

```ts
// tests/e2e/analytics-filters.spec.ts
// Report filters (S10f): the VAT pair tagged «ПДВ» (excluded from analytics) stays out of the totals until the tag is
// chosen, then comes in with the hint (the CSV follows); the choice travels between the report tabs; «Без тегів»; an
// account filter on Cash Flow and on the Balance; «Скинути фільтри».
import { readFileSync } from 'node:fs'
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { registerViaUi, waitForShell, type RegisteredUser } from './helpers/app-ui'
import { seedDoc } from './helpers/emulator-firestore'
import { seedLedgerAccount, seedLedgerOperation } from './helpers/ledger-seed'
import { todayDay } from '../../lib/utils/today'

const NEEDS_EMULATORS =
  'Needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"'

const income = (page: Page): Locator => page.getByTestId('cashflow-total-income')
const expense = (page: Page): Locator => page.getByTestId('cashflow-total-expense')
const hint = (page: Page): Locator => page.getByTestId('analytics-excluded-hint')
const tab = (page: Page, name: string): Locator =>
  page.getByRole('navigation', { name: 'Розділи аналітики' }).getByRole('link', { name, exact: true })

/** A tag in the exact shape the server stores (lib/domain/tags/doc.ts). */
async function seedTag(request: APIRequestContext, orgId: string, id: string, name: string, excludeFromAnalytics: boolean): Promise<void> {
  await seedDoc(request, `organizations/${orgId}/tags`, id, {
    schemaVersion: 1,
    name,
    color: excludeFromAnalytics ? 'rose' : 'amber',
    excludeFromAnalytics,
    archived: false,
    recalcPending: false,
    orgId,
    createdAt: new Date(),
    createdBy: 'e2e',
    updatedAt: new Date(),
  })
}

/**
 * A PLN company, all today: on «Konto główne» a sale of 500, rent of 120, fuel of 40 tagged «Паливо» and the VAT 230 out
 * tagged «ПДВ» (excluded from analytics); on «Rachunek VAT» the VAT 230 in (the same tag) and a bank fee of 15. Without
 * filters Cash Flow shows 500 / 175 (tests/unit/utils/analytics.test.ts checks the same numbers).
 */
async function setup(page: Page, request: APIRequestContext, prefix: string): Promise<RegisteredUser> {
  const user = await registerViaUi(page, prefix, 'PLN')
  await waitForShell(page, user.companyName)
  const org = user.orgId
  await seedLedgerAccount(request, org, 'acc-main', { name: 'Konto główne', balance: 5000, currency: 'PLN' })
  await seedLedgerAccount(request, org, 'acc-vat', { name: 'Rachunek VAT', balance: 1000, currency: 'PLN' })
  await seedTag(request, org, 'tag-vat', 'ПДВ', true)
  await seedTag(request, org, 'tag-fuel', 'Паливо', false)
  const day = todayDay()
  const main = { accountId: 'acc-main', currency: 'PLN', date: day }
  const vat = { accountId: 'acc-vat', currency: 'PLN', date: day }
  await seedLedgerOperation(request, org, 'op-sale', { ...main, type: 'income', amount: 500, description: 'Faktura 7/11' })
  await seedLedgerOperation(request, org, 'op-rent', { ...main, type: 'expense', amount: 120, description: 'Czynsz' })
  await seedLedgerOperation(request, org, 'op-fuel', { ...main, type: 'expense', amount: 40, description: 'Orlen', tags: ['tag-fuel'] })
  await seedLedgerOperation(request, org, 'op-vat-out', { ...main, type: 'expense', amount: 230, description: 'VAT na rachunek VAT', tags: ['tag-vat'], excluded: true })
  await seedLedgerOperation(request, org, 'op-vat-in', { ...vat, type: 'income', amount: 230, description: 'VAT z konta głównego', tags: ['tag-vat'], excluded: true })
  await seedLedgerOperation(request, org, 'op-fee', { ...vat, type: 'expense', amount: 15, description: 'Opłata bankowa' })
  return user
}

/** Opens «Фільтри» on the current report; `active` is the number the button shows (0: none). */
async function openFilters(page: Page, active = 0): Promise<Locator> {
  await page.getByRole('button', { name: active > 0 ? `Фільтри (активних: ${active})` : 'Фільтри', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Фільтри' })
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('report filters (emulators)', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test('«ПДВ» brings the excluded VAT pair into the totals with a hint, the CSV follows, the tabs keep the choice', async ({ page, request }) => {
    const user = await setup(page, request, 'af-tag')
    await page.goto(`/${user.orgId}/analytics/cashflow`)
    await waitForShell(page, user.companyName)
    await expect(income(page)).toHaveText('500')
    await expect(expense(page)).toHaveText('175')
    await expect(hint(page)).toHaveCount(0)

    const dialog = await openFilters(page)
    await dialog.getByRole('button', { name: 'Теги', exact: true }).click()
    const search = dialog.getByRole('combobox', { name: 'Пошук тегів' })
    await expect(search).toBeFocused()
    await expect(dialog.getByRole('option', { name: 'Усі теги' })).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.getByRole('option', { name: 'Без тегів' })).toBeVisible()
    // Nothing is highlighted before typing: Enter ticks nothing (the S10t rule).
    await search.press('Enter')
    await expect(dialog.getByRole('option', { name: 'Усі теги' })).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.getByRole('option', { name: /^ПДВ/ })).toHaveAttribute('aria-selected', 'false')
    // Typing highlights the first match; Enter ticks it.
    await search.fill('пдв')
    await search.press('Enter')
    await expect(dialog.getByRole('option', { name: /^ПДВ/ })).toHaveAttribute('aria-selected', 'true')
    // Esc closes only the list; the tick stays in the dialog's draft.
    await search.press('Escape')
    await expect(search).toBeHidden()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Теги (1)' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Готово' }).click()
    await expect(dialog).toBeHidden()

    await expect(page).toHaveURL(/\/analytics\/cashflow\?tg=tag-vat$/)
    await expect(income(page)).toHaveText('230')
    await expect(expense(page)).toHaveText('230')
    await expect(hint(page)).toHaveText('Показано також операції, виключені з аналітики')
    await expect(page.getByTestId('analytics-filters-count')).toHaveText('1')

    // The CSV is the filtered report: this month 230 in, 230 out, nothing else.
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Експорт CSV', exact: true }).click()
    const csv = readFileSync(await (await download).path(), 'utf8')
    expect(csv).toContain(',230,230,0,')
    expect(csv).not.toContain(',500,')

    // The report tabs keep the choice.
    for (const [name, path] of [['P&L', 'pl'], ['Календар', 'calendar']] as const) {
      await tab(page, name).click()
      await expect(page).toHaveURL(new RegExp(`/analytics/${path}\\?tg=tag-vat$`))
      await expect(hint(page)).toBeVisible()
    }
    await tab(page, 'Баланс').click()
    await expect(page).toHaveURL(/\/analytics\/balance\?tg=tag-vat$/)
    // The Balance is made of accounts: the tag does not apply there and is not counted.
    await expect(page.getByRole('button', { name: 'Фільтри', exact: true })).toBeVisible()
    await tab(page, 'Cash Flow').click()
    await expect(page).toHaveURL(/\/analytics\/cashflow\?tg=tag-vat$/)
    await expect(income(page)).toHaveText('230')
  })

  test('«Без тегів», an account on Cash Flow and on the Balance, then «Скинути фільтри»', async ({ page, request }) => {
    const user = await setup(page, request, 'af-acc')
    await page.goto(`/${user.orgId}/analytics/cashflow`)
    await waitForShell(page, user.companyName)
    await expect(income(page)).toHaveText('500')

    let dialog = await openFilters(page)
    await dialog.getByRole('button', { name: 'Теги', exact: true }).click()
    await dialog.getByRole('option', { name: 'Без тегів' }).click()
    await expect(dialog.getByRole('option', { name: 'Усі теги' })).toHaveAttribute('aria-selected', 'false')
    await dialog.getByRole('button', { name: 'Вибрати' }).click()
    await expect(dialog.getByRole('button', { name: 'Теги (1)' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Готово' }).click()
    await expect(page).toHaveURL(/\?tg=_none$/)
    await expect(income(page)).toHaveText('500')
    await expect(expense(page)).toHaveText('135')
    await expect(hint(page)).toHaveCount(0)

    dialog = await openFilters(page, 1)
    await dialog.getByRole('button', { name: 'Теги (1)' }).click()
    await dialog.getByRole('option', { name: 'Усі теги' }).click()
    await expect(dialog.getByRole('option', { name: 'Без тегів' })).toHaveAttribute('aria-selected', 'false')
    await dialog.getByRole('button', { name: 'Вибрати' }).click()
    await dialog.getByRole('button', { name: 'Рахунки', exact: true }).click()
    await dialog.getByRole('option', { name: 'Rachunek VAT' }).click()
    await dialog.getByRole('button', { name: 'Вибрати' }).click()
    await expect(dialog.getByRole('button', { name: 'Рахунки (1)' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Готово' }).click()
    await expect(page).toHaveURL(/\?accounts=acc-vat$/)
    // The VAT account: the bank fee only (its VAT income is excluded from analytics and no tag is chosen).
    await expect(income(page)).toHaveText('0')
    await expect(expense(page)).toHaveText('15')

    await tab(page, 'Баланс').click()
    await expect(page).toHaveURL(/\/analytics\/balance\?accounts=acc-vat$/)
    const main = page.getByRole('main')
    await expect(main.getByText('Rachunek VAT')).toBeVisible()
    await expect(main.getByText('Konto główne')).toHaveCount(0)
    await expect(page.getByTestId('analytics-filters-count')).toHaveText('1')

    await tab(page, 'Cash Flow').click()
    dialog = await openFilters(page, 1)
    await dialog.getByRole('button', { name: 'Скинути фільтри' }).click()
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`/${user.orgId}/analytics/cashflow$`))
    await expect(income(page)).toHaveText('500')
    await expect(expense(page)).toHaveText('175')
    await expect(page.getByRole('button', { name: 'Фільтри', exact: true })).toBeVisible()
  })
})
```

- [ ] **Step 2: Write the screenshots spec**

Створити `tests/ui-shots/analytics-filters.spec.ts`:

```ts
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { registerViaUi, waitForShell } from '../e2e/helpers/app-ui'
import { seedDoc } from '../e2e/helpers/emulator-firestore'
import { seedLedgerAccount, seedLedgerOperation } from '../e2e/helpers/ledger-seed'
import { todayDay } from '../../lib/utils/today'
import pl from '../../messages/pl.json'
import uk from '../../messages/uk.json'

// S10f: the report filters (Cash Flow with «Фільтри» and the hint, the dialog, the tags and the payment types lists open,
// the Balance with an account filter) at 1440 and 390 px in uk and pl. Files: analytics-filters-<state>-<desktop|phone>-<uk|pl>.png.
const OUT_DIR = join(process.cwd(), 'ui-shots')
const VIEWPORTS = [
  { form: 'desktop', width: 1440, height: 900 },
  { form: 'phone', width: 390, height: 844 },
] as const
const LOCALES = [
  ['uk', uk],
  ['pl', pl],
] as const
const LONG_TAG = 'Koszty reprezentacyjne i delegacje zagraniczne'
const LONG_CATEGORY = 'Usługi księgowe, prawne i doradztwo podatkowe dla spółki'

/** A tag in the exact shape the server stores (lib/domain/tags/doc.ts). */
function tagDoc(orgId: string, name: string, color: string, flags: { excludeFromAnalytics?: boolean; archived?: boolean } = {}) {
  return {
    schemaVersion: 1,
    name,
    color,
    excludeFromAnalytics: flags.excludeFromAnalytics === true,
    archived: flags.archived === true,
    recalcPending: false,
    orgId,
    createdAt: new Date(),
    createdBy: 'shots',
    updatedAt: new Date(),
  }
}

test.describe('analytics filters shots', () => {
  test.skip(
    !process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST,
    'Run with `npm run ui:shots` (it starts the Auth + Firestore emulators)',
  )

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true })
    for (const old of readdirSync(OUT_DIR)) {
      if (old.startsWith('analytics-filters-') && old.endsWith('.png')) rmSync(join(OUT_DIR, old), { force: true })
    }
  })

  for (const [locale, messages] of LOCALES) {
    test(`analytics filters in ${locale}`, async ({ page, request, context }) => {
      test.setTimeout(300_000)
      await page.setViewportSize({ width: 1440, height: 900 })
      const user = await registerViaUi(page, `afshots${locale}`, 'PLN')
      await waitForShell(page, user.companyName)
      const org = user.orgId
      const m = messages.analytics.filters

      await seedLedgerAccount(request, org, 'acc-main', { name: 'Konto główne Millennium', balance: 25000, currency: 'PLN' })
      await seedLedgerAccount(request, org, 'acc-vat', { name: 'Rachunek VAT', balance: 1200, currency: 'PLN' })
      await seedDoc(request, `organizations/${org}/categories`, 'cat-fees', { name: LONG_CATEGORY, type: 'expense', color: '#6366f1', orgId: org, createdAt: new Date() })
      await seedDoc(request, `organizations/${org}/tags`, 'tag-vat', tagDoc(org, 'ПДВ', 'rose', { excludeFromAnalytics: true }))
      await seedDoc(request, `organizations/${org}/tags`, 'tag-long', tagDoc(org, LONG_TAG, 'violet'))
      await seedDoc(request, `organizations/${org}/tags`, 'tag-old', tagDoc(org, 'Stare', 'slate', { archived: true }))
      const day = todayDay()
      const main = { accountId: 'acc-main', currency: 'PLN', date: day }
      await seedLedgerOperation(request, org, 'op-1', { ...main, type: 'income', amount: 4200, description: 'Faktura 12/11' })
      await seedLedgerOperation(request, org, 'op-2', { ...main, type: 'expense', amount: 230, description: 'VAT', tags: ['tag-vat'], excluded: true })
      await seedLedgerOperation(request, org, 'op-3', { type: 'income', accountId: 'acc-vat', currency: 'PLN', date: day, amount: 230, description: 'VAT', tags: ['tag-vat'], excluded: true })
      await seedLedgerOperation(request, org, 'op-4', { ...main, type: 'expense', amount: 650, description: 'Biuro rachunkowe', categoryId: 'cat-fees', tags: ['tag-long'] })

      if (locale !== 'uk') await context.addCookies([{ name: 'NEXT_LOCALE', value: locale, url: 'http://localhost:3000' }])

      const noHorizontalScroll = async (what: string): Promise<void> => {
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        expect(over, `${what}: the page scrolls sideways by ${over}px`).toBeLessThanOrEqual(0)
      }
      const dialogFits = async (what: string): Promise<void> => {
        const box = await page.getByRole('dialog').boundingBox()
        const vp = page.viewportSize()
        expect(box, `${what}: no dialog`).not.toBeNull()
        if (box && vp) {
          expect(box.x, `${what}: dialog left`).toBeGreaterThanOrEqual(0)
          expect(box.y, `${what}: dialog top`).toBeGreaterThanOrEqual(0)
          expect(box.x + box.width, `${what}: dialog right`).toBeLessThanOrEqual(vp.width + 0.5)
          expect(box.y + box.height, `${what}: dialog bottom`).toBeLessThanOrEqual(vp.height + 0.5)
        }
      }

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        const shot = async (state: string): Promise<void> => {
          await page.screenshot({ path: join(OUT_DIR, `analytics-filters-${state}-${viewport.form}-${locale}.png`), animations: 'disabled' })
        }
        const dialog = page.getByRole('dialog', { name: m.title })

        await page.goto(`/${org}/analytics/cashflow?tg=tag-vat`)
        await waitForShell(page, user.companyName)
        await expect(page.getByTestId('analytics-excluded-hint')).toBeVisible()
        await noHorizontalScroll('report')
        await shot('report')

        await page.getByRole('button', { name: m.buttonActive.replace('{count}', '1') }).click()
        await expect(dialog).toBeVisible()
        await dialogFits('dialog')
        await shot('dialog')

        // The tags list: search, «Усі теги», the excluded tag with its note, a long name that wraps, an archived tag, «Без тегів».
        await dialog.getByRole('button', { name: `${m.tags.label} (1)` }).click()
        await expect(dialog.getByRole('option', { name: m.tags.untagged })).toBeVisible()
        await dialogFits('tags')
        await shot('tags')
        await dialog.getByRole('button', { name: m.choose }).click()

        // The payment types with their categories (a long category name that wraps).
        await dialog.getByRole('button', { name: m.kinds.label, exact: true }).click()
        await expect(dialog.getByRole('option', { name: LONG_CATEGORY })).toBeVisible()
        await dialogFits('kinds')
        await shot('kinds')
        await page.keyboard.press('Escape')
        await page.keyboard.press('Escape')
        await expect(dialog).toBeHidden()

        await page.goto(`/${org}/analytics/balance?accounts=acc-vat`)
        await waitForShell(page, user.companyName)
        await expect(page.getByTestId('analytics-filters-count')).toHaveText('1')
        await noHorizontalScroll('balance')
        await shot('balance')
      }
    })
  }
})
```

- [ ] **Step 3: Run e2e and the screenshots**

```bash
cd /f/AI/finflow && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only auth,firestore --project demo-finflow "npx playwright test tests/e2e/analytics-filters.spec.ts tests/e2e/app-shell.spec.ts tests/e2e/transfers.spec.ts tests/e2e/tags.spec.ts tests/e2e/smoke.spec.ts tests/e2e/i18n.spec.ts"
```

Expected: усі PASS (2 нові сценарії; наявні оболонка, період звітів, перекази, теги, смоук і мови без змін: без фільтрів адреса звітів і їхні числа ті самі).

```bash
cd /f/AI/finflow && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only auth,firestore --project demo-finflow "npx playwright test --config playwright.shots.config.ts tests/ui-shots/analytics-filters.spec.ts tests/ui-shots/shots.spec.ts"
```

Expected: PASS, у `ui-shots/` 20 файлів `analytics-filters-*.png` (5 станів × 2 ширини × 2 мови) і знімки `shots.spec.ts`. Переглянути їх (читанням зображень): кнопка «Фільтри»/«Filtry» зі значком у рядку періоду (на телефоні рядок переноситься, бічного прокручування немає), підказка над звітом, діалог уміщається, довгі назви тегу й категорії переносяться в рядку списку (не розширюють діалог на 390 px), архівний тег приглушений, біля «ПДВ» видно «не враховується в аналітиці», «Без тегів» останній, «Вибрати»/«Wybrać» внизу списку, «Готово» і «Скинути фільтри»/«Zresetuj filtry» внизу діалогу.

- [ ] **Step 4: Commit**

```bash
cd /f/AI/finflow && git add tests/e2e/analytics-filters.spec.ts tests/ui-shots/analytics-filters.spec.ts && git commit -m "test(analytics): e2e of the report filters; screenshots at 1440 and 390 px

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Документація, статус спеки і повна перевірка

**Files:**
- Modify: `CLAUDE.md`, `PROGRESS.md`, `docs/superpowers/specs/2026-11-02-s10f-analytics-filters-design.md`

- [ ] **Step 1: CLAUDE.md**

1. У `## Project Overview` замінити кінець рядка `Working today: ...` ` ... and every one splits back, the bank balances whole (S10b).` на ` ... and every one splits back, the bank balances whole (S10b), and report filters: Cash Flow, P&L and the Calendar filter by payment type and category, counterparty, tag (with «без тегів») and account, the Balance by account, the choice kept in the address across the report tabs (S10f).`
2. У `## Folder Structure` замінити рядок `  analytics/     ← PeriodSelect, ReportToolbar (report period filter)` на `  analytics/     ← PeriodSelect, ReportToolbar (report period filter), AnalyticsFilters, AnalyticsFiltersDialog, FilterMultiSelect (report filters, S10f)`.
3. У `### Components`, у пункті `Report period filter`, речення `` `ReportToolbar` puts it first in the pill row under the title, then the CSV icon button.`` замінити на `` `ReportToolbar` puts it first in the pill row under the title, then «Фільтри» (S10f), then the CSV icon button.``
4. У `## Tags (S10t)`, у пункті `**Data:**`, речення `` The Cash Flow and P&L pages skip `excluded` operations (`lib/utils/analytics.ts`); reports with a tag filter and an «excluded» line are S12.`` замінити на `` The reports skip `excluded` operations (`countsInAnalytics` in `lib/utils/analytics.ts`; the Calendar too since S10f) unless a concrete tag is chosen in the report filters (S10f); the «excluded» reconciliation line is S12.``
5. У кінець файлу (після блоку `## Own transfers (S10b)`) додати:

```
## Report filters (S10f)

Spec: `docs/superpowers/specs/2026-11-02-s10f-analytics-filters-design.md`. Plan: `docs/superpowers/plans/2026-11-02-s10f-analytics-filters.md`.

- **Data:** no server, collection, index or rule changes; the reports filter the operations they already read (`useTransactions`).
- **Address:** `lib/domain/analytics-filter/filter.ts` (pure): `AnalyticsFilters` (`types`, `categoryIds`, `counterpartyIds`, `tagIds`, `accountIds`), `parseAnalyticsFilters` / `analyticsFiltersToParams` with the journal's names `types`, `cat`, `cp`, `tg` (`_none` = no tags) and `accounts` (comma-separated; invalid ids, types and repeats dropped, at most `MAX_FILTER_IDS` = 30 per list, other parameters not read). `useAnalyticsFilters` (`lib/hooks/`) reads them and writes them back with `router.replace` (no scroll); the period stays a page choice outside the address. `AnalyticsNav` links carry the filter parameters (`analyticsHref`), so the choice follows the report tabs and can be shared; the module tab and the analytics index open the reports without filters.
- **Matching:** `matchesSelection` (`lib/domain/journal/filter.ts`) is the one rule of the journal and the reports: types and categories together, counterparties, accounts (the account or a transfer's target) and tags «any of the chosen», `_none` the operations without tags. `filterForAnalytics` returns `{ operations, includeExcluded, showsExcluded }`: a concrete tag makes the reports count the operations excluded from analytics (Finmap's rule) and, when some of them are, the page shows «Показано також операції, виключені з аналітики» (`analytics-excluded-hint`). `buildCashFlow`, `buildPL`, `buildCalendar` take `{ includeExcluded }` (default false); `countsInAnalytics` is the one predicate (the Calendar's day list uses it too). The Balance applies only the accounts (`filterAccounts` on the list given to `BalanceSheet` and to its CSV); the Cash Flow and P&L CSV are built from the filtered reports.
- **UI:** `AnalyticsFiltersButton` (`components/analytics/AnalyticsFilters.tsx`: the pill «Фільтри» with the number of fields in use, `analytics-filters-count`; in `ReportToolbar` on Cash Flow and P&L, above the Calendar, next to the Balance's date select) opens `AnalyticsFiltersDialog`: «Види платежів і категорії» (Дохід, Витрата, Переказ, the categories under their type), «Контрагенти», «Теги» (with «Без тегів» last), «Рахунки» (the Balance shows only this one). Each field is a `FilterMultiSelect` in Finmap's form («Теги (N)», a search, «Усі …» first, a checkbox row per value, «Вибрати»), opened inline one at a time; ticks go to the dialog's draft at once, «Вибрати» and Esc close the list, «Готово» writes the address, «Скинути фільтри» clears the fields the dialog shows and applies. The S10t highlight rule (`highlightedRow`, `lib/ui/highlight.ts`) is shared with `TagPicker`: nothing is highlighted until typing, an arrow or a real pointer move, so Enter never ticks a row by accident. Archived tags and counterparties are offered, muted; deleted categories cannot be chosen (their operations stay under «Без категорії»).
- **Tests:** unit `tests/unit/domain/analytics-filter/filter.test.ts`, `tests/unit/utils/analytics.test.ts` (block «report filters (S10f)»), `tests/unit/domain/journal/filter.test.ts` (`matchesSelection`), `tests/unit/ui/highlight.test.ts`, `tests/unit/shell/analytics-sections.test.ts`; e2e `tests/e2e/analytics-filters.spec.ts`; screenshots `tests/ui-shots/analytics-filters.spec.ts` (`playwright.shots.config.ts`).
```

- [ ] **Step 2: The spec status**

У `docs/superpowers/specs/2026-11-02-s10f-analytics-filters-design.md` у рядку 3 замінити `> Статус: **чернетка спеки, чекає перегляду власника.**` на `> Статус: **затверджено власником 2026-11-02.**` (решта рядка без змін).

- [ ] **Step 3: Run the whole verification**

```bash
cd /f/AI/finflow && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npm run typecheck && npm run lint && npm run check:server-imports && npm run test:unit && npm run test:rules && npm run test:integration && npm run build
```

```bash
cd /f/AI/finflow && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"
```

Expected: `tsc` чисто; `lint` 0 errors і не більше 10 попереджень; `check:server-imports` OK (серверних залежностей не торкались); unit PASS (очікувано 180 файлів / 2451 тест); rules без змін 144 / 2; integration PASS, зокрема `journal-*` (спільний `matchesSelection`; очікувано 323 / 33); збірка успішна без попередження про `useSearchParams` і `Suspense`; e2e усі PASS (очікувано 132). Записати фактичні числа (тести й файли кожного набору, час e2e) для PROGRESS.md і порівняти з базовими з шапки плану. Якщо інтеграційний прогін падає лише в `tests/integration/counterparties-write.test.ts` (відомий тайм-аут паралельного тесту з S10t), прогнати цей файл окремо й записати обидва результати; не виправляти його в цій гілці.

- [ ] **Step 4: PROGRESS.md**

У кінець `PROGRESS.md` (після запису `## 2026-11-01 — S10b: перекази між власними рахунками` з його «Known follow-ups») додати запис у тому ж форматі:

- заголовок `## 2026-11-02 — S10f: фільтри аналітики`, рядок зі спекою й планом;
- **Статус:** реалізовано в гілці `s10f-analytics-filters`, чекає огляду й мерджа; лише код: сервер, колекції, індекси й правила Firestore не змінено, розгортання правил чи індексів не потрібне;
- `### Зроблено`: спільний `matchesSelection` журналу і звітів; адреса фільтрів (`types`, `cat`, `cp`, `tg`, `accounts`; 30 на список; некоректні й повтори відкидаються) і вкладки, що її зберігають (`analyticsHref`); `includeExcluded` у трьох звітах через `countsInAnalytics`, Календар тепер пропускає виключені (прогалина S10t), зокрема в перенесеному залишку і списку дня; Баланс лише за рахунками (`filterAccounts`; мертві `buildBalance`/`BalanceData` прибрано); діалог «Фільтри» за знімком Finmap від власника (список з пошуком, «Усі …», прапорці, «Без тегів», «Вибрати»; «Готово» і «Скинути фільтри»), лічильник полів на кнопці, підказка про виключені лише коли вони справді є серед відібраних; правило підсвітки S10t спільне з `TagPicker`; CSV з відфільтрованих звітів; перелік поправок спеки (рахунок і `toAccountId`, підказка, лічильник замість `hasActiveAnalyticsFilters`, вибирачі журналу не перевикористані);
- `### Підсумок перевірок (дата, реально виміряно)`: числа з кроку 3 для `typecheck`, `lint` (errors/warnings), `check:server-imports`, unit, rules, integration, build, e2e, з порівнянням із базовими (unit 2428/178, rules 144/2, integration 323/33, e2e 130, lint 10);
- `### Не перевірено`: реальні дані production (діалог на справжніх тегах ПДВ і «Банкомат», кількість контрагентів понад 100 рядків списку), поведінка на телефоні в реальному браузері (лише скриншоти Playwright), читання з екранного зчитувача (лише ролі й назви в e2e);
- `### Known follow-ups (S10f)`: фільтри не зберігаються (S22) і не діють на дашборді (S12, використає цей діалог); рядок «Виключено з аналітики» для звірки (S12); типи й категорії діють разом (вибір «Дохід» і категорії витрат дає порожній звіт, як у журналі); ідентифікатор видаленої категорії чи рахунку лишається у фільтрі, доки його не знімуть «Усі …» або «Скинути фільтри»; `buildCalendar` бере дату операції за місцевим часом браузера, а не UTC (як і до S10f).

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add CLAUDE.md PROGRESS.md docs/superpowers/specs/2026-11-02-s10f-analytics-filters-design.md && git commit -m "docs(analytics): S10f report filters in CLAUDE.md and PROGRESS.md; spec approved

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Після реалізації (веде контролер, не субагент)

1. Огляд усієї гілки opus-рев'юером (свіжий контекст, еталон: спека, розділ «Spec corrections» і цей план), виправлення знахідок з тестами. Окремо перевірити: журнал фільтрує точно як до S10f (`matchesFilters` через `matchesSelection`, тести журналу й інтеграційні `journal-*`); жоден прапорець не залежить лише від адреси; Enter без підсвітки нічого не позначає; без фільтрів Cash Flow і P&L рахують як до S10f, а Календар тепер без виключених.
2. Візуальна перевірка: `npx firebase emulators:exec --only auth,firestore --project demo-finflow "npx playwright test --config playwright.shots.config.ts tests/ui-shots/analytics-filters.spec.ts"` і перегляд усіх `ui-shots/analytics-filters-*.png` на 1440 і 390 px українською й польською (довгі назви в списках, діалог на телефоні, кнопка зі значком у рядку періоду, підказка); після змін оболонки чи токенів також `npm run ui:shots`.
3. `git push -u origin s10f-analytics-filters`, чернетка PR (тіло англійською за зразком PR #17-#21, у кінці `🤖 Generated with [Claude Code](https://claude.com/claude-code)`), зелений CI (job `ci`). Якщо в CI падає e2e, якого не видно локально, спершу розібрати його з артефактів CI (звіт Playwright, трейси, скриншоти), знайти причину, виправити з тестом і перезапустити; не перезапускати наосліп.
4. **Зупинка і запит явного «ок» власника на злиття.** Далі кожен крок розгортання за окремим «ок»:
   1. Злиття PR. Деплою правил чи індексів немає (`firestore.rules` і `firestore.indexes.json` не змінено); міграції даних немає.
   2. Vercel production READY; перевірка без входу: `/<org>/analytics/cashflow?tg=x` як і раніше переводить на `/login?redirect=…` (нових маршрутів немає).
   3. Власник відкриває «Фільтри» на реальних даних: тег ПДВ показує пари ПДВ з підказкою, «Без тегів» їх ховає, рахунок звужує Cash Flow і Баланс, вкладки зберігають вибір, «Скинути фільтри» повертає звіт як був.
   4. Оновити пам'ять і хаб в Obsidian.
