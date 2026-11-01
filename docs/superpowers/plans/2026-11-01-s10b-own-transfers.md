# S10b: Перекази між власними рахунками (пропозиції, «Зробити переказом», «Об’єднати», «Розділити»). План реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Рух грошей між власними рахунками стає справжнім переказом, який не потрапляє в Cash Flow і P&L. Журнал пропонує пари банк ↔ банк (людина підтверджує), панель вибору робить переказ з однієї банківської операції (банкомат → каса) або зливає дві банківські операції в один переказ, а форма розділяє переказ назад. Баланс банківського рахунка не змінюється ніколи; злиття пари не змінює жодного балансу; кожна дія скасовується.

**Architecture:** Чисті правила в `lib/domain/ledger/` (нові поля `toDate`, `bankTo`; день зарахування `receivedOn` і `datedEffects`; блокування банківських сторін; `convertToTransfer`, `mergeToTransfer`, `splitTransferSides`, `combineChanges`) і `lib/domain/transfers/` (пошук пар, розбір тіла запиту, версії, відхилені пари, правила вибору в журналі). Ledger `lib/server/ledger/transfer.ts`: `makeTransfer` і `splitTransfer`, кожен в одній Admin-транзакції через `changeSet` (спільні `applyChange`/`storedDoc` з `write.ts`), аудит `via: 'transfer'`. Відновлення видаленого банківського переказу йде через наявний маршрут створення: `bankSidesOf` бере обидва банківські блоки лише з позначок `bankSeen`. Журнал на сервері рахує прихід переказу на день зарахування. Сервер пропозицій `lib/server/transfers/` (читання 90 днів, запуск дій, сервіс) і маршрути `app/api/orgs/[orgId]/transfers/**`. Браузер: `lib/api/transfers-client.ts`, `useTransferSuggestions`, банер і діалог пропозицій, кнопки панелі вибору, рядок і форма переказу. Скрипт `check:transfers` (лише читання) перед розгортанням.

**Tech Stack:** Next.js 16 route handlers, firebase-admin (транзакції, `Filter.or`, `select`, `updateTime`), Vitest (unit, властивості, інтеграційні на емуляторі Firestore), Playwright (емулятори), next-intl (uk/pl/en).

**Spec:** `docs/superpowers/specs/2026-11-01-s10b-own-transfers-design.md`

**Гілка:** `s10b-transfers` (вже створена, на ній лежить спека). Усі коміти в неї. Кінець кожного повідомлення коміту: порожній рядок і `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Додавати файли поіменно (`git add <файли>`), ніколи `git add -A`.

**Робоче середовище (Windows, Git Bash):** репозиторій `F:\AI\finflow`. Для емулятора Firestore потрібна Java: `export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH"`. Не вбивати процеси за ім'ям образу (`taskkill /IM node.exe` заборонено). Не робити junction на `node_modules`.

**Закінчення рядків:** робоча копія CRLF, індекс LF (`core.autocrlf=true`). Наявні файли змінювати інструментом Edit (він зберігає CRLF); нові файли можна писати Write (LF), git нормалізує сам. Ніколи не переписувати наявний файл цілком через Write, якщо задача не каже «замінити файл повністю» (тоді CRLF теж нормалізується git, диф показує лише зміст).

**Базові числа (прочитано в `PROGRESS.md`, запис S10t, 2026-10-30; повні набори в цьому плані не запускались):** unit 2281 тест / 162 файли (контролер має 2289 / 162 після правок огляду, що ввійшли в мердж `b675991`; файлів `tests/unit/**/*.test.ts` у гілці 162), rules 144 / 2, integration 289 / 29 (контролер: 290 / 29; файлів 29), e2e 126 (файлів `tests/e2e/*.spec.ts` 14), `lint` 0 errors / 10 warnings. Task 15 вимірює нові числа й порівнює з цими.

**Правила репозиторію, що діють у кожній задачі:** React Compiler lint (жодного синхронного `setState` у тілі ефекту: лише в колбеках промісів, таймерів і обробниках); каталоги `messages/{uk,pl,en}.json` мають однакові ключі й однакові імена аргументів ICU (`tests/unit/i18n/catalogs.test.ts`); жодного кириличного тексту в коді `app/(app)`, `components`, `lib`, `types` (`tests/unit/i18n/no-hardcoded-text.test.ts`; коментарі можна; `aria-label`/`placeholder`/`title` лише через `t()`); `new Intl.*` і `toLocale*()` лише в `lib/i18n` і `lib/utils`; `lib/server/**` імпортує `firebase-admin`, клієнтський код ні; кожен обробник під `app/api` викликає `await requireUser(req)`; кольори лише токенами; гроші лише в цілих мінорних одиницях; `npm run lint` без нових попереджень (зараз 10).

**Каталоги повідомлень:** файли `messages/*.json` записані рівно як `JSON.stringify(data, null, 2)` плюс перенос рядка (у робочій копії CRLF). Task 9 додає всі ключі S10b тимчасовим скриптом `tmp-i18n.cjs` у корені (створити інструментом Write, щоб кирилиця лишилась UTF-8; `node tmp-i18n.cjs`; `rm tmp-i18n.cjs`; не комітити), як у плані S10t. Апостроф в українських текстах — `’` (U+2019, як у каталозі), бо прямий `'` в ICU є символом екранування.

---

## Spec corrections

1. **Повторна синхронізація (відкрите питання 1): лише додає.** `syncStep` (`lib/server/banking/sync.ts`) пропускає кожен ключ, що вже має позначку `bankSeen` (`if (seen.has(key)) { skipped++; continue }`), і ніколи не оновлює наявну операцію; операція в статусі `PDNG` позначки не має й чекає своєї проведеної версії (`mapped.reason === 'status'`). Тож переказ із `bank`/`bankTo` синхронізація не чіпає, і її код не змінюється. Єдине вікно ризику: `syncStep` пише операцію до позначки (`createWithRules`, потім `seenCol.doc(key).set`), а нову спробу «лікує» повтор `createTransaction` тим самим id. Якщо операцію без позначки злити як другу сторону, наступна синхронізація створила б її знову. Тому злиття пари в транзакції читає `bankSeen/{key}` вхідної сторони і без неї відмовляє `not_eligible` (Task 3). Регресія: злиття, потім повторний `syncStep` дає `imported: 0`, видалена сторона не з'являється (Task 3).
2. **Undo видалення (відкрите питання 2): зараз не працює для банківського переказу, план це виправляє.** `restoreTransaction` (`lib/api/transaction-undo.ts`) шле чернетку з `clientId = bk_…`, а `bankProvenanceOf` (`lib/server/ledger/write.ts`) вимагає, щоб `type`, `accountId`, `amountMinor`, `paymentDate` збіглися зі знімком позначки, де записано `expense`/`income`, тож відповідь `invalid_input` на `clientId`; крім того, UI-тип `Transaction` не має `bankTo`/`toDate`, і переказ повернувся б без них. План (Task 4): `bankProvenanceOf` стає `bankSidesOf`: переказ відновлюється «як є» лише з позначок (вихідна сторона: знімок `expense` власного ключа id; вхідна: знімок `income` ключа `bankToKey` на `toAccountId` із сумою `toAmountMinor` і днем `toDate ?? paymentDate`; переказ лише з вхідною банківською стороною: знімок `income` власного ключа); тіло створення отримує два внутрішні ключі `toDate` і `bankToKey` (лише для `transfer` під `bk_`-id з `internal`, у `PATCH` їх немає); сторона, що вже «живе» (її операція існує або її тримає `bankTo.key` іншого переказу), відмовляється, тож ні undo, ні запит клієнта не порахують банківську операцію двічі; `Transaction`/`toUiTransaction` несуть `bankTo` і `toDate`, `restoreTransaction` додає `bankRestoreOf(tx)`. Повторного імпорту немає: позначки обох сторін лишаються завжди.
3. **`toDate` і залишок після рядка журналу.** Спека говорить лише про агрегат `cash_*`. Але `lib/server/journal/read.ts` бере операції дня за `paymentDate` (`opsOfDay`), рух після сторінки рахує сумами за `paymentDate` (`netAfterDay`), а рух між днями сторінки бере з денних агрегатів (`netsBetween`), де прихід уже лежить на `toDate`. Без змін журнал рахував би прихід двічі або на іншому дні. План (Task 5): `opsOfDay` бере ще `toDate == day && toAccountId == рахунок` (лише рівності, без нового індексу) і рахує рух за `datedEffects`; `netAfterDay` додає поправку `arrivalShift` з переказів на рахунок, сплачених у межах ±`MAX_ARRIVAL_DAYS` від дня (наявний індекс журналу `(toAccountId, paymentDate desc, createdAt desc)`). Щоб це вікно було скінченним, різниця `toDate` і `paymentDate` обмежена `MAX_ARRIVAL_DAYS` = 7 днів і для ручного злиття (у спеці межі для ручного злиття немає; пропозиції й так ≤ 3 днів).
4. **`bankTo` без дубля суми, валюти й дати.** Спека: `bankTo` = `BankInfo` + `key`, `amountMinor`, `currency`, `date`. Останні три вже є полями переказу (`toAmountMinor`, `toCurrency`, `toDate ?? paymentDate`), і блокування банку їх замикає; дві копії одного факту можуть розійтися. План: `bankTo = { key, accountRef, entryReference?, counterpartyName?, remittance? }` (`BankToInfo`), розділення бере суму, валюту й день із полів переказу.
5. **Баланс рахунка призначення при «Зробити переказом».** «Баланси рахунків не змінюються ніколи» справджується для злиття пари. При перетворенні однієї операції не змінюється баланс банківського рахунка, а рахунок призначення (каса) отримує другу сторону (±X): у цьому мета перетворення (не вводити другу сторону вручну). Тести перевіряють саме так.
6. **Рахунок призначення, підключений до банку.** Спека описує «банк → каса / ручний рахунок», але явно не забороняє банківський. Якщо в рахунка призначення є свій банк, той банк сам імпортує свою сторону, і сума задвоїться. План: перетворення з ціллю, до якої прив'язано `bankAccounts` (будь-який статус), відмовляє `not_eligible` на `toAccountId` (`isLinkedToBank` у `lib/server/ledger/accounts.ts` стає експортом); для двох банків є злиття.
7. **Одна валюта, однакові суми.** Спека: у парі «реальні суми обох банків». Але `toRawInput` переказу однієї валюти не несе `toAmountMinor`, а `buildTransaction` ставить його рівним `amountMinor`; переказ однієї валюти з різними сумами не пройшов би жодного редагування (блокування `toAmountMinor`). План: злиття однієї валюти вимагає рівних сум (`not_eligible`; різниця це комісія банку, поза обсягом спеки); різні валюти можуть мати будь-які суми.
8. **Коди результатів.** Спека: `conflict`, `invalid`, `not_eligible`. Коду `invalid` у ledger немає: кожен результат несе код ledger, як масові дії S08 (`conflict`, `not_eligible`, `invalid_input`, `currency_mismatch`, `account_not_found`, `not_found`, `ledger_busy`, `unknown`). `not_eligible` це новий `LedgerErrorCode` (422).
9. **Тест покриття авторизації.** `tests/unit/server/route-auth-coverage.test.ts` сам обходить усі `app/api/**/route.ts`: нові маршрути потрапляють у нього без правок, якщо кожен обробник має `await requireUser(req)`. Список 401 без сесії в e2e `tests/e2e/api-guards.spec.ts` доповнюється (Task 14).
10. **Меню рядка журналу немає.** `TransactionList` не має меню рядка (клік по рядку відкриває форму). «Розділити переказ» живе у формі редагування, яка відкривається з рядка на будь-якій ширині; у рядку позначка «з банку» і «зарахування <день>» (Task 12).
11. **Скасування перетворення й злиття.** `splitTransfer` повертає операції без категорії й контрагента (як каже спека). Тост «Скасувати» після розділення ще записує кожну операцію назад у її стан «до» (`revertTransaction`, як undo масової зміни S08), тож категорії, контрагенти, період і теги повертаються; слід `autoRules` не повертається (відомий follow-up S10).
12. **`splitTransfer` без `expectVersion` у запиті.** Журнал не має версій рядків. Сервер читає переказ, розв'язує курси сторони в іншій валюті (мережа, поза транзакцією), а транзакція вимагає ту саму версію (`conflict` інакше). Непридатний id у шляху дає 404 (як `transactions/{txId}`), непридатні id у тілі `POST /transfers` дають 400.
13. **Правило нечитабельного документа.** Некоректні `toDate` або `bankTo`, чи будь-яке з них на доході або витраті, роблять документ нечитабельним (`parseTransaction` → `null`, `verifyLedger` → `uncountable`), як некоректний `excluded` у S10t. Некоректний `bank` і далі просто ігнорується (S09).
14. **Теги при злитті й `excluded`.** Злиття бере `mergeTags(out.tags, inc.tags)` (до 10), відкинуті рахуються в `droppedTags` і показуються в тості. Теги другої операції не перевіряються на архів (вони вже були на операції, людина не дає їх заново); `excluded` обчислюється з прапорців усіх тегів у тій самій транзакції, як у `commit`. Переказ із тегом-прапорцем лягає в `x_cash_*` обох днів.
15. **Пропозиції й вартість читань.** Банківські операції не можна відібрати запитом без нового індексу (`source` + `paymentDate`), тож читання бере операції 90 днів за `paymentDate` (до 2000, `select` полів) і фільтрує в пам'яті. Читання йде при відкритті журналу, при відкритті діалогу і після дій з переказами (подія `finflow:transfers-changed`), а не після кожного редагування. Маршрут читають усі члени, але банер бачать лише ті, хто може писати.
16. **Cash Flow і P&L не змінюються.** Сторінки звітів будують звіт з операцій (`lib/utils/analytics.ts`) і вже пропускають `transfer`; агрегатів `cashcat_`/`pl_` переказ не має за побудовою `contributions`. Тож перекази зникають зі звітів без змін у звітах.
17. **«Не прив'язана до шаблону»** це `isRecurring === false` (окремих шаблонів у моделі немає).

## Рішення плану (в межах спеки)

- **Одне правило на сервері й у браузері.** Придатність і побудова переказу живуть у чистому `lib/domain/ledger/transfer.ts`; панель вибору журналу (`mergePairOf`) пробує саме `mergeToTransfer`, а пошук пар бере `bankSideOf`.
- **Один власник руху по днях.** `datedEffects` (`lib/domain/ledger/effects.ts`) каже, який рахунок, коли і на скільки рухається; `balanceEffects` тепер його сума по рахунку, `contributions` бере `receivedOn`, журнал рахує рух дня з `datedEffects`.
- **Одне правило запису.** `applyChange` і `storedDoc` винесено з `commit` у `write.ts` (прибирає дубль циклу інкрементів у `commit` і `refreshExcluded`); переказ і розділення пишуть через них і `combineChanges` (кілька `changeSet` однієї транзакції).
- **Ідентифікатори й поля.** Переказ отримує id витрати (`bk_…`), а для переказу лише з вхідною банківською стороною id доходу. Переказ зберігає теги, файли (до 10, без повторів), опис витрати (або доходу, якщо в витрати немає) і проєкт; категорія, контрагент, період, курси й `autoRules` знімаються. При розділенні обидві операції отримують теги переказу; дохід отримує опис із `bankTo.remittance` (так його описує імпорт, крім рідкісного `note`).
- **Версії** пари з пропозицій мають вигляд `<секунди>.<9 цифр наносекунд>` (`updateTime` документа). Злиття з панелі й перетворення версій не мають: транзакція читає операції сама.
- **Відхилені пари:** у діалозі всі пари позначені; «Підтвердити вибрані» зливає позначені, а зняті запам'ятовує в `localStorage` (`finflow:transfer-dismissed:<org>`, 500 найновіших, усе в `try/catch`); «Не зараз» закриває без запам'ятовування. Невдалі пари лишаються в діалозі з причиною, вдалі зникають.
- **Один тост для всіх дій з переказами:** що зроблено, що ні (найчастіша причина, як у масових діях), скільки тегів не вмістилося; «Скасувати» розділяє зроблене й повертає операції в стан «до».
- **Порядок усередині дня** для приходу з іншого дня: за часом створення операції серед операцій цього дня (ключ журналу з `paymentDate`, заміненим на день руху).
- **`refusalCode`** (`lib/server/ledger/http.ts`) стає спільним для масових дій і переказів (прибирає дубль у `runBulk`).
- **Тексти з кількістю** через двокрапку, без ICU-множин, як у S10/S10t.

---

## Карта файлів

| Файл | Дія | Відповідальність |
|---|---|---|
| `lib/domain/ledger/types.ts` | змінити | `MAX_ARRIVAL_DAYS`, `BankToInfo`, поля `toDate`, `bankTo` |
| `lib/domain/ledger/days.ts` | змінити | `daysApart` |
| `lib/domain/ledger/effects.ts` | змінити | `receivedOn`, `datedEffects`, `balanceEffects` через них |
| `lib/domain/ledger/rollups.ts` | змінити | `transferInMinor` на день зарахування |
| `lib/domain/ledger/doc.ts` | змінити | `parseBankInfo`, серіалізація й розбір `toDate`/`bankTo` |
| `lib/domain/ledger/bank-lock.ts` | змінити | блокування обох банківських сторін, `withBankSides` |
| `lib/domain/ledger/errors.ts`, `lib/server/ledger/http.ts` | змінити | код `not_eligible` (422), `refusalCode` |
| `lib/domain/ledger/transfer.ts` | створити | `bankKeyOf`, `bankSideOf`, `convertToTransfer`, `mergeToTransfer`, `splitTransferSides` |
| `lib/domain/ledger/change.ts` | змінити | `combineChanges` |
| `lib/domain/ledger/input.ts`, `lib/domain/ledger/build.ts` | змінити | `MAX_FILE_URLS`; внутрішні ключі `toDate`/`bankToKey`; `toDate` у побудові |
| `lib/server/ledger/write.ts` | змінити | `applyChange`, `storedDoc`, `bankSidesOf`, перенос сторін у редагуванні |
| `lib/server/ledger/transfer.ts` | створити | `makeTransfer`, `splitTransfer` |
| `lib/server/ledger/{audit,accounts,index}.ts` | змінити | `via: 'transfer'`, експорт `isLinkedToBank`, `ledger.makeTransfer`/`splitTransfer` |
| `lib/server/journal/read.ts`, `lib/domain/journal/balance.ts` | змінити | день руху в залишку після рядка, `arrivalShiftOf`, запити для перевірки |
| `lib/server/journal/bulk.ts` | змінити | `refusalCode` |
| `lib/domain/transfers/{types,version,pairs,input,dismissed,selection}.ts` | створити | константи й типи, версії, пошук пар, тіло запиту, відхилені пари, вибір у журналі |
| `lib/server/transfers/{read,run,index}.ts` | створити | читання пропозицій, запуск дій, сервіс `transfers` |
| `app/api/orgs/[orgId]/transfers/route.ts`, `.../suggestions/route.ts`, `.../[txId]/split/route.ts` | створити | маршрути |
| `types/index.ts`, `lib/firebase/ledger-map.ts` | змінити | `bankTo`, `toDate` в UI |
| `lib/api/{ledger-client,transaction-undo}.ts` | змінити | `BankRestore`, `bankRestoreOf` |
| `lib/api/transfers-client.ts`, `lib/hooks/useTransferSuggestions.ts` | створити | виклики, подія, undo; хук пропозицій |
| `messages/{uk,pl,en}.json` | змінити | `journal.transfers.*`, три коди `journal.bulk.errors.*` |
| `components/transactions/{TransferSuggestions,ConvertTransferDialog}.tsx` | створити | банер і діалог пар, діалог «Зробити переказом» |
| `components/transactions/{SelectionBar,TransactionList}.tsx`, `app/(app)/[orgSlug]/transactions/page.tsx` | змінити | кнопки панелі, рядок переказу, підключення |
| `components/forms/transaction/TransactionForm.tsx` | змінити | блокування банківського переказу, «Розділити переказ» |
| `scripts/check-transfers.ts`, `scripts/lib/check-transfers.ts`, `package.json` | створити / змінити | `npm run check:transfers` |
| `tests/unit/domain/ledger/{transfer-fields,transfer,transfer-property,transfer-input}.test.ts` | створити | поля, правила, властивості, вхід |
| `tests/unit/server/ledger-http.test.ts` | змінити | `not_eligible` |
| `tests/unit/domain/journal/arrival.test.ts`, `tests/unit/domain/transfers/*.test.ts` | створити | поправка журналу, чиста логіка пропозицій |
| `tests/unit/api/transfers/routes.test.ts`, `tests/unit/server/transfers/run.test.ts`, `tests/unit/api/{transfers-client,transfer-undo}.test.ts`, `tests/unit/scripts/check-transfers.test.ts` | створити | маршрути, запуск, клієнт, undo, скрипт |
| `tests/integration/transfer-helpers.ts`, `tests/integration/{ledger-transfers,ledger-transfer-split,journal-transfers,transfers-read}.test.ts` | створити | інтеграційні тести |
| `tests/e2e/helpers/transfer-seed.ts`, `tests/e2e/transfers.spec.ts`, `tests/e2e/api-guards.spec.ts`, `tests/ui-shots/transfers.spec.ts` | створити / змінити | e2e і скриншоти |
| `CLAUDE.md`, `PROGRESS.md` | змінити | документація |

---

### Task 1: Ledger domain: поля `toDate` і `bankTo`, день зарахування, блокування банківських сторін, код `not_eligible`

**Files:**
- Modify: `lib/domain/ledger/types.ts`, `lib/domain/ledger/days.ts`, `lib/domain/ledger/effects.ts`, `lib/domain/ledger/rollups.ts`, `lib/domain/ledger/doc.ts`, `lib/domain/ledger/bank-lock.ts`, `lib/domain/ledger/errors.ts`, `lib/server/ledger/http.ts`
- Test: `tests/unit/domain/ledger/transfer-fields.test.ts` (створити), `tests/unit/server/ledger-http.test.ts`

- [ ] **Step 1: Write the failing tests**

Створити `tests/unit/domain/ledger/transfer-fields.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { assertBankUnlocked, withBankSides } from '@/lib/domain/ledger/bank-lock'
import { changeSet } from '@/lib/domain/ledger/change'
import { daysApart } from '@/lib/domain/ledger/days'
import { parseTransaction, transactionToDoc } from '@/lib/domain/ledger/doc'
import { balanceEffects, datedEffects, receivedOn } from '@/lib/domain/ledger/effects'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { contributions } from '@/lib/domain/ledger/rollups'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

const OUT_KEY = 'a'.repeat(32)
const IN_KEY = 'b'.repeat(32)

/** 1000 zł from the Millennium account to the Monobank one: both sides from the banks, the money arrived two days later. */
const pair: LedgerTransaction = {
  id: `bk_${OUT_KEY}`, type: 'transfer', status: 'actual', accountId: 'mil', amountMinor: 100_000, currency: 'PLN',
  toAccountId: 'mono', toAmountMinor: 100_000, toCurrency: 'PLN', toDate: '2026-10-14',
  paymentDate: '2026-10-12', accrual: { mode: 'date', date: '2026-10-12' }, isRecurring: false, tags: [], fileUrls: [],
  bank: { accountRef: 'ba-mil', entryReference: 'r-out', counterpartyName: 'Własne', remittance: 'Przelew' },
  bankTo: { key: IN_KEY, accountRef: 'ba-mono', entryReference: 'r-in', remittance: 'Przelew' },
}

/** 300 zł from the cash box into the bank: only the incoming side came from a bank (a converted income). */
const deposit: LedgerTransaction = {
  id: `bk_${IN_KEY}`, type: 'transfer', status: 'actual', accountId: 'cash', amountMinor: 30_000, currency: 'PLN',
  toAccountId: 'mil', toAmountMinor: 30_000, toCurrency: 'PLN',
  paymentDate: '2026-10-20', accrual: { mode: 'date', date: '2026-10-20' }, isRecurring: false, tags: [], fileUrls: [],
  bankTo: { key: IN_KEY, accountRef: 'ba-mil' },
}

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : 'other'
  }
  return 'ok'
}

describe('the transfer fields in the operation document (S10b)', () => {
  it('round-trips the arrival day and both bank sides; only an outgoing bank side marks the source', () => {
    const doc = transactionToDoc(pair)
    expect(doc).toMatchObject({
      source: 'bank',
      toDate: '2026-10-14',
      bankTo: { key: IN_KEY, accountRef: 'ba-mono', entryReference: 'r-in', remittance: 'Przelew' },
    })
    expect(parseTransaction(pair.id, doc)).toEqual(pair)
    const depositDoc = transactionToDoc(deposit)
    expect('source' in depositDoc).toBe(false)
    expect('toDate' in depositDoc).toBe(false)
    expect(parseTransaction(deposit.id, depositDoc)).toEqual(deposit)
  })

  it.each([
    ['an arrival day that is not a day', { toDate: '2026-10-32' }],
    ['a bankTo without a key', { bankTo: { accountRef: 'ba-mono' } }],
    ['a bankTo whose key is not a document id', { bankTo: { key: 'a/b', accountRef: 'ba-mono' } }],
    ['a bankTo without its bank account', { bankTo: { key: IN_KEY } }],
    ['a bankTo that is not a map', { bankTo: 'ba-mono' }],
  ])('a transfer with %s is unreadable', (_name, change) => {
    expect(parseTransaction(pair.id, { ...transactionToDoc(pair), ...change })).toBeNull()
  })

  it('an income or an expense with an arrival day or an incoming bank side is unreadable', () => {
    const income: LedgerTransaction = {
      id: `bk_${OUT_KEY}`, type: 'income', status: 'actual', accountId: 'mil', amountMinor: 500, currency: 'PLN',
      paymentDate: '2026-10-20', accrual: { mode: 'date', date: '2026-10-20' }, isRecurring: false, tags: [], fileUrls: [],
    }
    const doc = transactionToDoc(income)
    expect(parseTransaction(income.id, doc)).not.toBeNull()
    expect(parseTransaction(income.id, { ...doc, toDate: '2026-10-21' })).toBeNull()
    expect(parseTransaction(income.id, { ...doc, bankTo: { key: IN_KEY, accountRef: 'ba-mil' } })).toBeNull()
  })
})

describe('the arrival day of a transfer', () => {
  it('is its own toDate, else the payment day', () => {
    expect(receivedOn(pair)).toBe('2026-10-14')
    expect(receivedOn(deposit)).toBe('2026-10-20')
  })

  it('dates the money in; the balance effects add up the same per account; a planned transfer moves nothing', () => {
    expect(datedEffects(pair)).toEqual([
      { accountId: 'mil', day: '2026-10-12', delta: -100_000 },
      { accountId: 'mono', day: '2026-10-14', delta: 100_000 },
    ])
    expect(balanceEffects(pair)).toEqual({ mil: -100_000, mono: 100_000 })
    expect(datedEffects({ ...pair, status: 'planned' })).toEqual([])
    expect(balanceEffects({ ...pair, status: 'planned' })).toEqual({})
  })

  it('puts the transfer in of the target on the arrival day, in the x_ twin when the transfer is excluded', () => {
    expect([...contributions(pair, 'PLN')]).toEqual([
      ['cash_mil_2026-10-12', { transferOutMinor: 100_000 }],
      ['cash_mono_2026-10-14', { transferInMinor: 100_000 }],
    ])
    expect([...contributions({ ...pair, excluded: true }, 'PLN')]).toEqual([
      ['x_cash_mil_2026-10-12', { transferOutMinor: 100_000 }],
      ['x_cash_mono_2026-10-14', { transferInMinor: 100_000 }],
    ])
    expect([...contributions(deposit, 'PLN')]).toEqual([
      ['cash_cash_2026-10-20', { transferOutMinor: 30_000 }],
      ['cash_mil_2026-10-20', { transferInMinor: 30_000 }],
    ])
  })

  it('moving the arrival day moves only the rollup of the target and no balance', () => {
    const later: LedgerTransaction = { ...pair, toDate: '2026-10-15' }
    const change = changeSet(pair, later, 'PLN')
    expect([...change.rollupDeltas]).toEqual([
      ['cash_mono_2026-10-15', { transferInMinor: 100_000 }],
      ['cash_mono_2026-10-14', { transferInMinor: -100_000 }],
    ])
    expect(change.balanceDeltas).toEqual({})
  })

  it('daysApart counts whole days in either order', () => {
    expect(daysApart('2026-10-12', '2026-10-14')).toBe(2)
    expect(daysApart('2026-10-14', '2026-10-12')).toBe(2)
    expect(daysApart('2026-10-31', '2026-11-01')).toBe(1)
    expect(daysApart('2026-10-12', '2026-10-12')).toBe(0)
  })
})

describe('the bank lock of a transfer (S10b)', () => {
  it('lets the comment, the tags and the account of a side that is not from a bank change', () => {
    expect(code(() => assertBankUnlocked(pair, { ...pair, description: 'Własny', tags: ['q4'] }))).toBe('ok')
    expect(code(() => assertBankUnlocked(deposit, { ...deposit, accountId: 'cash2' }))).toBe('ok')
  })

  it.each([
    ['type', { type: 'expense' as const }],
    ['status', { status: 'planned' as const }],
    ['accountId', { accountId: 'other' }],
    ['amountMinor', { amountMinor: 99_999 }],
    ['paymentDate', { paymentDate: '2026-10-13' }],
    ['toAccountId', { toAccountId: 'other' }],
    ['toAmountMinor', { toAmountMinor: 99_999 }],
    ['toDate', { toDate: '2026-10-15' }],
  ])('a transfer from bank to bank refuses a change of %s', (field, change) => {
    expect(code(() => assertBankUnlocked(pair, { ...pair, ...change }))).toBe(`bank_locked:${field}`)
  })

  it.each([
    ['type', { type: 'income' as const }],
    ['toAccountId', { toAccountId: 'other' }],
    ['toAmountMinor', { toAmountMinor: 1 }],
    ['paymentDate', { paymentDate: '2026-10-21' }],
  ])('a deposit refuses a change of %s (its arrival day is the payment day)', (field, change) => {
    expect(code(() => assertBankUnlocked(deposit, { ...deposit, ...change }))).toBe(`bank_locked:${field}`)
  })

  it('withBankSides gives an edited transfer back its bank blocks and its arrival day', () => {
    const edited: LedgerTransaction = { ...pair, description: 'x' }
    delete edited.bank
    delete edited.bankTo
    delete edited.toDate
    expect(withBankSides(edited, pair)).toEqual({ ...pair, description: 'x' })
  })
})
```

У `tests/unit/server/ledger-http.test.ts` у таблиці `LEDGER` після рядка `  tag_archived: 422,` додати рядок:

```ts
  not_eligible: 422,
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/ledger/transfer-fields.test.ts tests/unit/server/ledger-http.test.ts`
Expected: FAIL (`withBankSides`, `daysApart`, `datedEffects`, `receivedOn` не існують; `toDate`/`bankTo` не зберігаються; код `not_eligible` невідомий).

- [ ] **Step 3: Implement**

`lib/domain/ledger/types.ts`:

1. Після рядка `export const LEDGER_CURRENCIES = ['PLN', 'EUR', 'USD', 'UAH'] as const` додати:

```ts

/**
 * The arrival day of a transfer (`toDate`, S10b) is at most this many days from its payment day. Banks book the two sides
 * of an own transfer within a few days; the journal's balance read relies on the bound (lib/server/journal/read.ts reads
 * the transfers of these days around a page instead of an index on `toDate`).
 */
export const MAX_ARRIVAL_DAYS = 7
```

2. Після інтерфейсу `BankInfo` (перед коментарем `/** A rule that filled the category or the counterparty of an operation (S10): ...`) додати:

```ts
/**
 * The incoming bank side of a transfer (S10b): the bank block of the income it was and that income's bank key (its id was
 * `bk_` + key). Its amount, currency and day are the transfer's own `toAmountMinor`, `toCurrency` and `toDate ??
 * paymentDate`, which the bank lock keeps.
 */
export interface BankToInfo extends BankInfo {
  key: string
}

```

3. У `LedgerTransaction` після рядка `  toCurrency?: string` додати:

```ts
  /**
   * The day the money arrived on `toAccountId` (S10b), stored only when the receiving bank booked it on another day than
   * `paymentDate` (at most MAX_ARRIVAL_DAYS away); absent means the payment day. Transfers only.
   */
  toDate?: string
```

4. У `LedgerTransaction` після рядка `  bank?: BankInfo` додати:

```ts
  /** The incoming side of a transfer when that side was a bank operation (S10b); `bank` is then the outgoing one. Transfers only. */
  bankTo?: BankToInfo
```

`lib/domain/ledger/days.ts`: у кінець файлу додати:

```ts

/** Whole days between two days, in either order. */
export function daysApart(a: string, b: string): number {
  return Math.abs(daysInRange(a, b) - 1)
}
```

`lib/domain/ledger/effects.ts`: замінити рядки від `import type { LedgerTransaction } from './types'` до кінця функції `balanceEffects` (перші 14 рядків файлу) на:

```ts
import type { LedgerTransaction } from './types'

/** The day the target account of a transfer receives the money: its own `toDate` when it has one (S10b), else the payment day. */
export function receivedOn(tx: Pick<LedgerTransaction, 'paymentDate' | 'toDate'>): string {
  return tx.toDate ?? tx.paymentDate
}

/** One movement of one account on one day, in minor units. */
export interface DatedEffect {
  accountId: string
  day: string
  delta: number
}

/**
 * How an operation moves the accounts and on which day: an income or an expense on its payment day; a transfer takes the
 * money off its account on the payment day and puts it on the target on the arrival day (S10b). Planned operations move
 * nothing. The single owner of «which account, when, how much»: the balances, the rollups and the journal read it.
 */
export function datedEffects(tx: LedgerTransaction): DatedEffect[] {
  if (tx.status !== 'actual') return []
  switch (tx.type) {
    case 'income':
      return [{ accountId: tx.accountId, day: tx.paymentDate, delta: tx.amountMinor }]
    case 'expense':
      return [{ accountId: tx.accountId, day: tx.paymentDate, delta: -tx.amountMinor }]
    case 'transfer':
      return [
        { accountId: tx.accountId, day: tx.paymentDate, delta: -tx.amountMinor },
        { accountId: tx.toAccountId as string, day: receivedOn(tx), delta: tx.toAmountMinor as number },
      ]
  }
}

/** Change of each account balance (minor units) caused by an operation, whatever the day. Planned operations have none. */
export function balanceEffects(tx: LedgerTransaction): Record<string, number> {
  return mergeEffects(...datedEffects(tx).map((e) => ({ [e.accountId]: e.delta })))
}
```

`lib/domain/ledger/rollups.ts`:

1. Після рядка `import { baseOf } from './build'` додати `import { receivedOn } from './effects'`.
2. У коментарі `contributions` рядок ` *  - cash_{account}_{paymentDay}: in/out in the account currency and in the company currency; transfer in/out;` замінити на:

```ts
 *  - cash_{account}_{paymentDay}: in/out in the account currency and in the company currency; transfer out, and transfer in
 *    on the day the money arrived (`toDate ?? paymentDate`, S10b);
```

3. Рядок `    bump(docs, doc(cashDocId(tx.toAccountId as string, tx.paymentDate)), 'transferInMinor', sign * (tx.toAmountMinor as number))` замінити на:

```ts
    bump(docs, doc(cashDocId(tx.toAccountId as string, receivedOn(tx))), 'transferInMinor', sign * (tx.toAmountMinor as number))
```

`lib/domain/ledger/doc.ts`:

1. Рядки `import { isDay } from './days'` і `import { isMinor } from './money'` замінити на:

```ts
import { isDay } from './days'
import { isId } from './guards'
import { isMinor } from './money'
```

2. У списку імпортів типів після `  type BankInfo,` додати `  type BankToInfo,`.
3. Після функції `parseAutoRules` (перед коментарем `/** The stored fields of an operation ...`) додати:

```ts
/**
 * A bank block (`bank` of an operation, `bank` of a bank mark, `bankTo` without its key): `accountRef` and the optional
 * strings; null when it is not one. The one reader of that shape (S09, S10b).
 */
export function parseBankInfo(v: unknown): BankInfo | null {
  if (!isRecord(v) || typeof v.accountRef !== 'string') return null
  const bank: BankInfo = { accountRef: v.accountRef }
  for (const key of ['entryReference', 'counterpartyName', 'remittance'] as const) {
    const value = v[key]
    if (typeof value === 'string') bank[key] = value
  }
  return bank
}

function bankInfoToDoc(b: BankInfo): Record<string, string> {
  const doc: Record<string, string> = { accountRef: b.accountRef }
  if (b.entryReference !== undefined) doc.entryReference = b.entryReference
  if (b.counterpartyName !== undefined) doc.counterpartyName = b.counterpartyName
  if (b.remittance !== undefined) doc.remittance = b.remittance
  return doc
}

/** A stored `bankTo` (S10b): a bank block plus the key of the income it was; null when it is not one. */
function parseBankTo(v: unknown): BankToInfo | null {
  if (!isRecord(v) || !isId(v.key)) return null
  const bank = parseBankInfo(v)
  return bank === null ? null : { key: v.key, ...bank }
}

```

4. У `transactionToDoc` після рядка `  if (tx.toCurrency !== undefined) doc.toCurrency = tx.toCurrency` додати `  if (tx.toDate !== undefined) doc.toDate = tx.toDate`.
5. У `transactionToDoc` блок

```ts
  if (tx.bank !== undefined) {
    doc.source = 'bank'
    const bank: Record<string, string> = { accountRef: tx.bank.accountRef }
    if (tx.bank.entryReference !== undefined) bank.entryReference = tx.bank.entryReference
    if (tx.bank.counterpartyName !== undefined) bank.counterpartyName = tx.bank.counterpartyName
    if (tx.bank.remittance !== undefined) bank.remittance = tx.bank.remittance
    doc.bank = bank
  }
```

замінити на:

```ts
  if (tx.bank !== undefined) {
    doc.source = 'bank'
    doc.bank = bankInfoToDoc(tx.bank)
  }
  if (tx.bankTo !== undefined) doc.bankTo = { key: tx.bankTo.key, ...bankInfoToDoc(tx.bankTo) }
```

6. У `parseTransaction` рядки

```ts
    tx.toCurrency = data.toCurrency
  } else {
    const counterpartyId = optionalString(data.counterpartyId)
```

замінити на:

```ts
    tx.toCurrency = data.toCurrency
    // S10b: the arrival day and the incoming bank side. Malformed, they make the document unreadable (as `excluded` does).
    if (data.toDate !== undefined) {
      if (!isDay(data.toDate)) return null
      tx.toDate = data.toDate
    }
    if (data.bankTo !== undefined) {
      const bankTo = parseBankTo(data.bankTo)
      if (!bankTo) return null
      tx.bankTo = bankTo
    }
  } else {
    if (data.toDate !== undefined || data.bankTo !== undefined) return null
    const counterpartyId = optionalString(data.counterpartyId)
```

7. У `parseTransaction` блок

```ts
  if (data.source === 'bank' && isRecord(data.bank) && typeof data.bank.accountRef === 'string') {
    const bank: BankInfo = { accountRef: data.bank.accountRef }
    for (const key of ['entryReference', 'counterpartyName', 'remittance'] as const) {
      const value = data.bank[key]
      if (typeof value === 'string') bank[key] = value
    }
    tx.bank = bank
  }
```

замінити на:

```ts
  if (data.source === 'bank') {
    // A malformed bank block is left out rather than hiding the operation (S09).
    const bank = parseBankInfo(data.bank)
    if (bank) tx.bank = bank
  }
```

`lib/domain/ledger/bank-lock.ts`: замінити файл повністю на:

```ts
import { receivedOn } from './effects'
import { LedgerError } from './errors'
import type { LedgerTransaction } from './types'

/** The fields that must keep matching the statement of the operation's own bank (an import, or the outgoing side of a transfer). */
const LOCKED = ['type', 'status', 'accountId', 'amountMinor', 'paymentDate'] as const
/** The incoming bank side of a transfer (S10b): what the statement of the receiving bank fixes, besides its day. */
const LOCKED_TO = ['type', 'status', 'toAccountId', 'toAmountMinor'] as const

/**
 * An operation imported from a bank may change everything except what the statement fixes. A transfer with bank sides
 * (S10b) keeps its type and the fields of each bank side: `bank` locks the account, amount and payment day the money left
 * from, `bankTo` the target account, the amount that arrived and the arrival day (`toDate ?? paymentDate`). The other
 * account of a transfer with one bank side, its tags and its comment stay editable. `next` must already carry the prior
 * bank blocks and arrival day (`withBankSides`).
 */
export function assertBankUnlocked(prior: LedgerTransaction, next: LedgerTransaction): void {
  // Every imported operation has a statement of its own bank; only a transfer whose bank side is the incoming one has not.
  if (prior.bank !== undefined || prior.bankTo === undefined) {
    for (const field of LOCKED) {
      if (prior[field] !== next[field]) throw new LedgerError('bank_locked', field)
    }
  }
  if (prior.bankTo !== undefined) {
    for (const field of LOCKED_TO) {
      if (prior[field] !== next[field]) throw new LedgerError('bank_locked', field)
    }
    if (receivedOn(prior) !== receivedOn(next)) throw new LedgerError('bank_locked', prior.toDate !== undefined ? 'toDate' : 'paymentDate')
  }
}

/** `next` with where `prior` came from (S09, S10b): its bank blocks and its arrival day. An edit never changes them. */
export function withBankSides(next: LedgerTransaction, prior: LedgerTransaction): LedgerTransaction {
  const out: LedgerTransaction = { ...next }
  if (prior.bank !== undefined) out.bank = prior.bank
  if (prior.bankTo !== undefined) out.bankTo = prior.bankTo
  if (prior.toDate !== undefined) out.toDate = prior.toDate
  return out
}
```

`lib/domain/ledger/errors.ts`: після рядка `  | 'tag_archived'` додати:

```ts
  /** The operations cannot become a transfer, or the transfer cannot be split (S10b). */
  | 'not_eligible'
```

`lib/server/ledger/http.ts`: у `LEDGER_STATUS` після рядка `  tag_archived: 422,` додати `  not_eligible: 422,`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/ledger tests/unit/server/ledger-http.test.ts tests/unit/domain/journal tests/unit/domain/banking && npm run typecheck`
Expected: PASS (нові тести; наявні `bank-lock.test.ts`, `doc-bank.test.ts`, `effects.test.ts`, `rollups.test.ts`, `property.test.ts` без змін: `balanceEffects` дає ті самі мапи, а операції без `toDate` лягають туди ж), `tsc` чисто.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add lib/domain/ledger/types.ts lib/domain/ledger/days.ts lib/domain/ledger/effects.ts lib/domain/ledger/rollups.ts lib/domain/ledger/doc.ts lib/domain/ledger/bank-lock.ts lib/domain/ledger/errors.ts lib/server/ledger/http.ts tests/unit/domain/ledger/transfer-fields.test.ts tests/unit/server/ledger-http.test.ts && git commit -m "feat(transfers): arrival day and incoming bank side of a transfer in the ledger domain

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Чисті правила переказу `lib/domain/ledger/transfer.ts`, `combineChanges`, властивості

**Files:**
- Create: `lib/domain/ledger/transfer.ts`
- Modify: `lib/domain/ledger/change.ts`, `lib/domain/ledger/input.ts`
- Test: `tests/unit/domain/ledger/transfer.test.ts`, `tests/unit/domain/ledger/transfer-property.test.ts` (створити)

- [ ] **Step 1: Write the failing tests**

Створити `tests/unit/domain/ledger/transfer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { changeSet, combineChanges } from '@/lib/domain/ledger/change'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { bankKeyOf, bankSideOf, convertToTransfer, mergeToTransfer, splitTransferSides } from '@/lib/domain/ledger/transfer'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

const K = (c: string) => c.repeat(32)

/** A bank operation as the import writes it; `extra` replaces fields. */
function bankOp(key: string, type: 'income' | 'expense', accountId: string, amountMinor: number, paymentDate: string, extra: Partial<LedgerTransaction> = {}): LedgerTransaction {
  return {
    id: `bk_${key}`, type, status: 'actual', accountId, amountMinor, currency: 'PLN', paymentDate,
    accrual: { mode: 'date', date: paymentDate }, isRecurring: false, tags: [], fileUrls: [],
    bank: { accountRef: `ba-${accountId}`, remittance: `Przelew ${key.slice(0, 4)}` }, ...extra,
  }
}

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : 'other'
  }
  return 'ok'
}

describe('bankKeyOf and bankSideOf', () => {
  it('a bank expense is the money that left, a bank income the money that arrived', () => {
    expect(bankKeyOf(`bk_${K('1')}`)).toBe(K('1'))
    expect(bankSideOf(bankOp(K('1'), 'expense', 'mil', 100, '2026-10-20'))).toBe('out')
    expect(bankSideOf(bankOp(K('2'), 'income', 'mil', 100, '2026-10-20'))).toBe('in')
  })

  it('a manual, planned or recurring operation, a transfer and an id without the bank prefix are no bank side', () => {
    const op = bankOp(K('1'), 'expense', 'mil', 100, '2026-10-20')
    expect(bankKeyOf('manual-12345678')).toBeNull()
    expect(bankKeyOf('bk_')).toBeNull()
    expect(bankSideOf({ ...op, bank: undefined })).toBeNull()
    expect(bankSideOf({ ...op, status: 'planned' })).toBeNull()
    expect(bankSideOf({ ...op, isRecurring: true })).toBeNull()
    expect(bankSideOf({ ...op, type: 'transfer' })).toBeNull()
    expect(bankSideOf({ ...op, id: 'manual-12345678' })).toBeNull()
  })
})

describe('convertToTransfer', () => {
  it('a bank expense becomes a transfer to the target with its bank block; category, counterparty, accrual, rules trace and flag go', () => {
    const atm = bankOp(K('1'), 'expense', 'mil', 100_000, '2026-10-20', {
      categoryId: 'k-ex', counterpartyId: 'cp1', autoRules: [{ id: 'r1', name: 'ATM' }], description: 'Bankomat', tags: ['q4'],
      accrual: { mode: 'date', date: '2026-10-01' }, excluded: true, projectId: 'p1',
    })
    expect(convertToTransfer(atm, { id: 'cash', currency: 'PLN' })).toEqual({
      id: atm.id, type: 'transfer', status: 'actual', accountId: 'mil', amountMinor: 100_000, currency: 'PLN',
      toAccountId: 'cash', toAmountMinor: 100_000, toCurrency: 'PLN', paymentDate: '2026-10-20',
      accrual: { mode: 'date', date: '2026-10-20' }, isRecurring: false, tags: ['q4'], fileUrls: [], description: 'Bankomat',
      projectId: 'p1', bank: atm.bank,
    })
  })

  it('a bank income becomes a transfer from the target; its bank block becomes the incoming side', () => {
    const deposit = bankOp(K('2'), 'income', 'mil', 30_000, '2026-10-21')
    expect(convertToTransfer(deposit, { id: 'cash', currency: 'PLN' })).toEqual({
      id: deposit.id, type: 'transfer', status: 'actual', accountId: 'cash', amountMinor: 30_000, currency: 'PLN',
      toAccountId: 'mil', toAmountMinor: 30_000, toCurrency: 'PLN', paymentDate: '2026-10-21',
      accrual: { mode: 'date', date: '2026-10-21' }, isRecurring: false, tags: [], fileUrls: [],
      bankTo: { key: K('2'), accountRef: 'ba-mil', remittance: 'Przelew 2222' },
    })
  })

  it('refuses another currency, the same account and anything that is not a bank side', () => {
    const atm = bankOp(K('1'), 'expense', 'mil', 100_000, '2026-10-20')
    expect(code(() => convertToTransfer(atm, { id: 'eur', currency: 'EUR' }))).toBe('currency_mismatch:toAccountId')
    expect(code(() => convertToTransfer(atm, { id: 'mil', currency: 'PLN' }))).toBe('invalid_input:toAccountId')
    expect(code(() => convertToTransfer({ ...atm, bank: undefined }, { id: 'cash', currency: 'PLN' }))).toBe('not_eligible:undefined')
    const transfer = convertToTransfer(atm, { id: 'cash', currency: 'PLN' })
    expect(code(() => convertToTransfer(transfer, { id: 'cash2', currency: 'PLN' }))).toBe('not_eligible:undefined')
  })
})

describe('mergeToTransfer', () => {
  it('the expense keeps its id and day; the income gives the target, its amount, its bank block and its day', () => {
    const out = bankOp(K('3'), 'expense', 'mil', 100_000, '2026-10-12', { categoryId: 'k-ex', tags: ['a'] })
    const inc = bankOp(K('4'), 'income', 'mono', 100_000, '2026-10-14', { categoryId: 'k-in', tags: ['b'], description: 'Wpływ', fileUrls: ['f1'] })
    const { transfer, droppedTags } = mergeToTransfer(out, inc)
    expect(transfer).toEqual({
      id: out.id, type: 'transfer', status: 'actual', accountId: 'mil', amountMinor: 100_000, currency: 'PLN',
      toAccountId: 'mono', toAmountMinor: 100_000, toCurrency: 'PLN', toDate: '2026-10-14', paymentDate: '2026-10-12',
      accrual: { mode: 'date', date: '2026-10-12' }, isRecurring: false, tags: ['a', 'b'], fileUrls: ['f1'],
      description: 'Wpływ', bank: out.bank, bankTo: { key: K('4'), ...inc.bank },
    })
    expect(droppedTags).toEqual([])
    expect(mergeToTransfer(out, { ...inc, paymentDate: '2026-10-12' }).transfer.toDate).toBeUndefined()
  })

  it('across currencies both real amounts stay', () => {
    const out = bankOp(K('3'), 'expense', 'eur', 10_000, '2026-10-12', { currency: 'EUR' })
    const inc = bankOp(K('4'), 'income', 'mil', 44_000, '2026-10-13')
    expect(mergeToTransfer(out, inc).transfer).toMatchObject({ amountMinor: 10_000, currency: 'EUR', toAmountMinor: 44_000, toCurrency: 'PLN' })
  })

  it('keeps the expense tags first and reports what did not fit in 10', () => {
    const t = (n: number) => `t${String(n).padStart(2, '0')}`
    const out = bankOp(K('3'), 'expense', 'mil', 100, '2026-10-12', { tags: [1, 2, 3, 4, 5, 6].map(t) })
    const inc = bankOp(K('4'), 'income', 'mono', 100, '2026-10-12', { tags: [5, 6, 7, 8, 9, 10, 11, 12].map(t) })
    const { transfer, droppedTags } = mergeToTransfer(out, inc)
    expect(transfer.tags).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(t))
    expect(droppedTags).toEqual([t(11), t(12)])
  })

  it.each([
    ['two expenses', bankOp(K('4'), 'expense', 'mono', 100, '2026-10-12')],
    ['the same account', bankOp(K('4'), 'income', 'mil', 100, '2026-10-12')],
    ['8 days apart', bankOp(K('4'), 'income', 'mono', 100, '2026-10-20')],
    ['another amount in the same currency', bankOp(K('4'), 'income', 'mono', 99, '2026-10-12')],
    ['a manual income', { ...bankOp(K('4'), 'income', 'mono', 100, '2026-10-12'), bank: undefined }],
  ])('refuses %s', (_name, inc) => {
    const out = bankOp(K('3'), 'expense', 'mil', 100, '2026-10-12')
    expect(code(() => mergeToTransfer(out, inc))).toBe('not_eligible:undefined')
  })
})

describe('splitTransferSides', () => {
  it('a transfer from bank to bank gives back the expense and the income under its own id, on the arrival day', () => {
    const out = bankOp(K('3'), 'expense', 'mil', 100_000, '2026-10-12', { categoryId: 'k-ex' })
    const inc = bankOp(K('4'), 'income', 'mono', 100_000, '2026-10-14')
    const { transfer } = mergeToTransfer(out, { ...inc, tags: ['vat'] })
    const { kept, recreated } = splitTransferSides({ ...transfer, description: 'Własny' })
    expect(kept).toEqual({
      id: out.id, type: 'expense', status: 'actual', accountId: 'mil', amountMinor: 100_000, currency: 'PLN',
      paymentDate: '2026-10-12', accrual: { mode: 'date', date: '2026-10-12' }, isRecurring: false, tags: ['vat'], fileUrls: [],
      description: 'Własny', bank: out.bank,
    })
    expect(recreated).toEqual({
      id: inc.id, type: 'income', status: 'actual', accountId: 'mono', amountMinor: 100_000, currency: 'PLN',
      paymentDate: '2026-10-14', accrual: { mode: 'date', date: '2026-10-14' }, isRecurring: false, tags: ['vat'], fileUrls: [],
      description: 'Przelew 4444', bank: inc.bank,
    })
  })

  it('a converted expense comes back alone; a deposit comes back as its income under its id', () => {
    const atm = bankOp(K('1'), 'expense', 'mil', 100_000, '2026-10-20')
    expect(splitTransferSides(convertToTransfer(atm, { id: 'cash', currency: 'PLN' }))).toEqual({ kept: atm, recreated: null })
    const deposit = bankOp(K('2'), 'income', 'mil', 30_000, '2026-10-21')
    expect(splitTransferSides(convertToTransfer(deposit, { id: 'cash', currency: 'PLN' }))).toEqual({ kept: deposit, recreated: null })
  })

  it('refuses a manual transfer, a planned one and anything that is not a transfer', () => {
    const atm = bankOp(K('1'), 'expense', 'mil', 100_000, '2026-10-20')
    const transfer = convertToTransfer(atm, { id: 'cash', currency: 'PLN' })
    expect(code(() => splitTransferSides({ ...transfer, bank: undefined }))).toBe('not_eligible:undefined')
    expect(code(() => splitTransferSides({ ...transfer, status: 'planned' }))).toBe('not_eligible:undefined')
    expect(code(() => splitTransferSides(atm))).toBe('not_eligible:undefined')
  })
})

describe('combineChanges', () => {
  it('a merge written as one change moves no balance; its rollups are the sum of both changes', () => {
    const out = bankOp(K('3'), 'expense', 'mil', 100_000, '2026-10-14')
    const inc = bankOp(K('4'), 'income', 'mono', 100_000, '2026-10-14')
    const { transfer } = mergeToTransfer(out, inc)
    const combined = combineChanges(changeSet(out, transfer, 'PLN'), changeSet(inc, null, 'PLN'))
    expect(combined.balanceDeltas).toEqual({})
    expect(combined.rollupDeltas.get('cash_mono_2026-10-14')).toEqual({ transferInMinor: 100_000, inMinor: -100_000, inBase: -100_000 })
    expect(combined.rollupDeltas.get('cash_mil_2026-10-14')).toEqual({ transferOutMinor: 100_000, outMinor: -100_000, outBase: -100_000 })
    expect(combined.rollupDeltas.get('pl_2026-10')).toEqual({ 'categories._none.expenseBase': -100_000, 'categories._none.incomeBase': -100_000 })
  })
})
```

Створити `tests/unit/domain/ledger/transfer-property.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { attachFx, buildTransaction, fxPlan } from '@/lib/domain/ledger/build'
import { addDays } from '@/lib/domain/ledger/days'
import { computeLedger } from '@/lib/domain/ledger/expected'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { diffRollups, type RollupDocs } from '@/lib/domain/ledger/rollups'
import { convertToTransfer, mergeToTransfer, splitTransferSides } from '@/lib/domain/ledger/transfer'
import type { LedgerAccount, LedgerTransaction } from '@/lib/domain/ledger/types'
import { ACCOUNTS, BASE, Model, TODAY, fakeEvidence, randomTx, rng } from './model'

const pick = <T,>(r: () => number, items: readonly T[]): T => items[Math.floor(r() * items.length)]
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
const KEY = (n: number) => n.toString(16).padStart(32, '0')

/** What the ledger does before it stores an operation in another currency: the rates (the model's deterministic fake). */
function withRates(tx: LedgerTransaction): LedgerTransaction {
  const plan = fxPlan(tx, BASE, TODAY)
  return attachFx(tx, plan, plan.map((p) => fakeEvidence(p.from, p.to, p.date)))
}

/** A bank operation as the import writes it: actual, no category, the accrual on the payment day, a bank block. */
function bankOp(n: number, type: 'income' | 'expense', account: LedgerAccount, paymentDate: string, amountMinor: number): LedgerTransaction {
  const input = parseTransactionInput({ type, accountId: account.id, amountMinor, paymentDate })
  const built = buildTransaction(`bk_${KEY(n)}`, input, { today: TODAY, account, category: null, baseCurrency: BASE })
  return { ...withRates(built), bank: { accountRef: `ba-${account.id}` } }
}

/** A bank expense of one account and the bank income of another that a merge accepts. */
function bankPair(r: () => number, n: number): [LedgerTransaction, LedgerTransaction] {
  const from = pick(r, ACCOUNTS)
  const to = pick(r, ACCOUNTS.filter((a) => a.id !== from.id))
  const day = addDays(TODAY, -int(r, 3, 60))
  const amount = int(r, 1, 300_000)
  const out = bankOp(n, 'expense', from, day, amount)
  const inc = bankOp(n + 1, 'income', to, addDays(day, int(r, -3, 3)), from.currency === to.currency ? amount : int(r, 1, 300_000))
  return [out, inc]
}

function checkAgainstOracle(model: Model): void {
  const oracle = computeLedger(ACCOUNTS, [...model.txs.values()], BASE)
  expect(oracle.invalid).toEqual([])
  expect(model.balances).toEqual(oracle.balances)
  expect(diffRollups(model.rollups, oracle.rollups)).toEqual([])
}

const copyRollups = (docs: RollupDocs): RollupDocs => new Map([...docs].map(([id, flat]) => [id, { ...flat }]))

/** Background noise: random operations of the S05 generator (planned ones, transfers, other currencies). */
function noise(r: () => number, model: Model, count: number, prefix: string): void {
  for (let i = 0; i < count; i++) {
    const tx = randomTx(r, `${prefix}${i}`)
    if (tx) model.commit(null, tx)
  }
}

describe('own transfers (S10b) over random ledgers', () => {
  it('merges keep every balance, splits give back the balances and rollups of the bank operations, and the oracle agrees throughout', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const r = rng(20_000 + seed)
      const model = new Model()
      noise(r, model, 15, 'n')
      const pairs = Array.from({ length: 4 }, (_, i) => bankPair(r, 100 * seed + 10 * i))
      for (const [out, inc] of pairs) {
        model.commit(null, out)
        model.commit(null, inc)
      }
      const balances = { ...model.balances }
      const rollups = copyRollups(model.rollups)

      const transfers = pairs.map(([out, inc]) => {
        const { transfer } = mergeToTransfer(out, inc)
        model.commit(out, transfer)
        model.commit(inc, null)
        checkAgainstOracle(model)
        expect(model.balances).toEqual(balances)
        return transfer
      })

      for (const transfer of transfers) {
        const { kept, recreated } = splitTransferSides(transfer)
        model.commit(transfer, withRates(kept))
        if (recreated) model.commit(null, withRates(recreated))
        checkAgainstOracle(model)
      }
      expect(model.balances).toEqual(balances)
      expect(diffRollups(model.rollups, rollups)).toEqual([])
    }
  })

  it('a conversion keeps the bank account balance, moves the target by the amount, and a split gives everything back', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const r = rng(30_000 + seed)
      const model = new Model()
      noise(r, model, 10, 'n')
      // pln1 is the bank, pln2 the cash box: one currency, as a conversion requires.
      const [bank, cash] = [ACCOUNTS[0], ACCOUNTS[1]]
      const type = r() < 0.5 ? 'income' : 'expense'
      const op = bankOp(seed, type, bank, addDays(TODAY, -int(r, 0, 60)), int(r, 1, 300_000))
      model.commit(null, op)
      const balances = { ...model.balances }
      const rollups = copyRollups(model.rollups)

      const transfer = convertToTransfer(op, cash)
      model.commit(op, transfer)
      checkAgainstOracle(model)
      expect(model.balances[bank.id]).toBe(balances[bank.id])
      expect(model.balances[cash.id]).toBe(balances[cash.id] + (type === 'expense' ? op.amountMinor : -op.amountMinor))

      const { kept, recreated } = splitTransferSides(transfer)
      expect(recreated).toBeNull()
      model.commit(transfer, withRates(kept))
      checkAgainstOracle(model)
      expect(model.balances).toEqual(balances)
      expect(diffRollups(model.rollups, rollups)).toEqual([])
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/ledger/transfer.test.ts tests/unit/domain/ledger/transfer-property.test.ts`
Expected: FAIL (`@/lib/domain/ledger/transfer` не існує, `combineChanges` не існує).

- [ ] **Step 3: Implement**

`lib/domain/ledger/input.ts`:

1. Після рядка `export const MIN_DAY = '2000-01-01'` додати:

```ts
/** Files one operation keeps at most. */
export const MAX_FILE_URLS = 10
```

2. Рядок `    fileUrls: stringList(r.fileUrls, 'fileUrls', 10, 2048),` замінити на `    fileUrls: stringList(r.fileUrls, 'fileUrls', MAX_FILE_URLS, 2048),`.

`lib/domain/ledger/change.ts`: у кінець файлу додати:

```ts

/** Several change sets written by one transaction as one (S10b: a transfer and the operation it absorbed, or split off). */
export function combineChanges(...parts: ChangeSet[]): ChangeSet {
  const rollupDeltas: RollupDocs = new Map()
  for (const part of parts) addInto(rollupDeltas, part.rollupDeltas)
  return { balanceDeltas: mergeEffects(...parts.map((part) => part.balanceDeltas)), rollupDeltas }
}
```

Створити `lib/domain/ledger/transfer.ts`:

```ts
import type { AccountRef } from './build'
import { daysApart } from './days'
import { receivedOn } from './effects'
import { LedgerError } from './errors'
import { BANK_CLIENT_ID_PREFIX, MAX_FILE_URLS } from './input'
import { MAX_ARRIVAL_DAYS, type BankInfo, type BankToInfo, type LedgerTransaction } from './types'
import { mergeTags } from '@/lib/domain/tags/assign'

/** The bank key of a bank operation id (`bk_` + key), or null for any other id. */
export function bankKeyOf(id: string): string | null {
  return id.startsWith(BANK_CLIENT_ID_PREFIX) && id.length > BANK_CLIENT_ID_PREFIX.length ? id.slice(BANK_CLIENT_ID_PREFIX.length) : null
}

/** The side of a transfer an operation can be: the money that left (`out`) or the money that arrived (`in`). */
export type BankSide = 'out' | 'in'

/** What `bankSideOf` reads; the suggestions read (lib/domain/transfers/pairs.ts) has these fields too. */
export type BankSideSource = Pick<LedgerTransaction, 'id' | 'type' | 'status' | 'isRecurring' | 'bank'>

/**
 * The bank side an operation can give a transfer (S10b): an actual income or expense imported from a bank under its bank
 * id and not tied to a recurring template. Anything else (a manual operation, a planned one, a transfer) is null.
 */
export function bankSideOf(tx: BankSideSource): BankSide | null {
  if (tx.status !== 'actual' || tx.isRecurring || tx.bank === undefined || bankKeyOf(tx.id) === null) return null
  if (tx.type === 'expense') return 'out'
  if (tx.type === 'income') return 'in'
  return null
}

type Shared = Pick<LedgerTransaction, 'id' | 'type' | 'status' | 'paymentDate' | 'accrual' | 'isRecurring' | 'tags' | 'fileUrls' | 'description' | 'projectId'>

/**
 * What a transfer built from a bank operation keeps of it: id, payment day, tags, files, comment and project. Category,
 * counterparty, accrual, rates and the rules' trace go (a transfer has no P&L side), and so does `excluded`: the ledger
 * decides it from the tags inside its transaction.
 */
function sharedOf(tx: LedgerTransaction): Shared {
  const out: Shared = {
    id: tx.id,
    type: 'transfer',
    status: 'actual',
    paymentDate: tx.paymentDate,
    accrual: { mode: 'date', date: tx.paymentDate },
    isRecurring: false,
    tags: [...tx.tags],
    fileUrls: [...tx.fileUrls],
  }
  if (tx.description !== undefined) out.description = tx.description
  if (tx.projectId !== undefined) out.projectId = tx.projectId
  return out
}

/**
 * «Зробити переказом» (S10b): a bank expense of A becomes a transfer A → `target`, a bank income of A a transfer
 * `target` → A whose incoming side is the bank one (`bankTo`). The bank side keeps its account, amount and day, so the bank
 * account's balance does not move; the target (a cash box, a manual account) gets the other side. Throws `not_eligible`,
 * `invalid_input` on `toAccountId` (the same account) or `currency_mismatch` (a conversion moves one amount).
 */
export function convertToTransfer(tx: LedgerTransaction, target: AccountRef): LedgerTransaction {
  const side = bankSideOf(tx)
  if (side === null) throw new LedgerError('not_eligible')
  if (target.id === tx.accountId) throw new LedgerError('invalid_input', 'toAccountId')
  if (target.currency !== tx.currency) throw new LedgerError('currency_mismatch', 'toAccountId')
  const bank = tx.bank as BankInfo
  const amounts = { amountMinor: tx.amountMinor, toAmountMinor: tx.amountMinor }
  if (side === 'out') {
    return { ...sharedOf(tx), ...amounts, accountId: tx.accountId, currency: tx.currency, toAccountId: target.id, toCurrency: target.currency, bank }
  }
  return {
    ...sharedOf(tx),
    ...amounts,
    accountId: target.id,
    currency: target.currency,
    toAccountId: tx.accountId,
    toCurrency: tx.currency,
    bankTo: { key: bankKeyOf(tx.id) as string, ...bank },
  }
}

export interface MergedTransfer {
  transfer: LedgerTransaction
  /** Tags of the income that did not fit next to the expense's (at most 10 on an operation). */
  droppedTags: string[]
}

/**
 * «Об’єднати в переказ» (S10b): a bank expense of A and a bank income of B become one transfer A → B under the expense's id,
 * with the real amounts of both banks; the arrival day is the income's day when it differs. No balance moves. The tags of
 * both stay (the expense's first, at most 10). Throws `not_eligible` unless `out` is a bank expense and `inc` a bank income
 * of another account, at most MAX_ARRIVAL_DAYS apart, with equal amounts when the currency is one (a difference would be a
 * bank fee, and a transfer in one currency has one amount).
 */
export function mergeToTransfer(out: LedgerTransaction, inc: LedgerTransaction): MergedTransfer {
  if (bankSideOf(out) !== 'out' || bankSideOf(inc) !== 'in' || out.accountId === inc.accountId) throw new LedgerError('not_eligible')
  if (out.currency === inc.currency && out.amountMinor !== inc.amountMinor) throw new LedgerError('not_eligible')
  if (daysApart(out.paymentDate, inc.paymentDate) > MAX_ARRIVAL_DAYS) throw new LedgerError('not_eligible')
  const tags = mergeTags(out.tags, inc.tags)
  const transfer: LedgerTransaction = {
    ...sharedOf(out),
    tags,
    fileUrls: [...new Set([...out.fileUrls, ...inc.fileUrls])].slice(0, MAX_FILE_URLS),
    accountId: out.accountId,
    amountMinor: out.amountMinor,
    currency: out.currency,
    toAccountId: inc.accountId,
    toAmountMinor: inc.amountMinor,
    toCurrency: inc.currency,
    bank: out.bank as BankInfo,
    bankTo: { key: bankKeyOf(inc.id) as string, ...(inc.bank as BankInfo) },
  }
  if (inc.paymentDate !== out.paymentDate) transfer.toDate = inc.paymentDate
  if (transfer.description === undefined && inc.description !== undefined) transfer.description = inc.description
  if (transfer.projectId === undefined && inc.projectId !== undefined) transfer.projectId = inc.projectId
  return { transfer, droppedTags: inc.tags.filter((id) => !tags.includes(id)) }
}

export interface SplitSides {
  /** The operation under the transfer's own id: the expense (the outgoing bank side), or the income of a deposit. */
  kept: LedgerTransaction
  /** The income re-created under its own bank id when the transfer had both bank sides; null otherwise. */
  recreated: LedgerTransaction | null
}

/**
 * «Розділити» (S10b): a transfer with a bank side becomes the bank operations it was. The outgoing bank side comes back as
 * the expense under the transfer's id; the incoming one as the income under its own bank id (`bk_` + key), on the arrival
 * day, with the bank's text as its comment; a deposit (only the incoming side from a bank) comes back as that income under
 * the transfer's id. Both keep the transfer's tags and files. No category, counterparty or rates: the ledger resolves the
 * rates of a side in another currency again. No balance moves. Throws `not_eligible` for anything but an actual transfer
 * with a bank side.
 */
export function splitTransferSides(tx: LedgerTransaction): SplitSides {
  if (tx.type !== 'transfer' || tx.status !== 'actual' || (tx.bank === undefined && tx.bankTo === undefined)) throw new LedgerError('not_eligible')
  const common = { status: 'actual' as const, isRecurring: false, tags: [...tx.tags], fileUrls: [...tx.fileUrls] }
  const finish = (op: LedgerTransaction, description: string | undefined): LedgerTransaction => {
    const out: LedgerTransaction = { ...op }
    if (description !== undefined) out.description = description
    if (tx.projectId !== undefined) out.projectId = tx.projectId
    return out
  }
  const income = (id: string, bank: BankInfo): LedgerTransaction => {
    const day = receivedOn(tx)
    return {
      ...common,
      id,
      type: 'income',
      accountId: tx.toAccountId as string,
      amountMinor: tx.toAmountMinor as number,
      currency: tx.toCurrency as string,
      paymentDate: day,
      accrual: { mode: 'date', date: day },
      bank,
    }
  }

  if (tx.bank === undefined) {
    const { key, ...bank } = tx.bankTo as BankToInfo
    // A deposit is stored under the id of the income it was.
    if (bankKeyOf(tx.id) !== key) throw new LedgerError('not_eligible')
    return { kept: finish(income(tx.id, bank), tx.description), recreated: null }
  }
  const expense: LedgerTransaction = {
    ...common,
    id: tx.id,
    type: 'expense',
    accountId: tx.accountId,
    amountMinor: tx.amountMinor,
    currency: tx.currency,
    paymentDate: tx.paymentDate,
    accrual: { mode: 'date', date: tx.paymentDate },
    bank: tx.bank,
  }
  const kept = finish(expense, tx.description)
  if (tx.bankTo === undefined) return { kept, recreated: null }
  const { key, ...bank } = tx.bankTo
  const recreated: LedgerTransaction = { ...income(`${BANK_CLIENT_ID_PREFIX}${key}`, bank) }
  if (bank.remittance !== undefined) recreated.description = bank.remittance
  if (tx.projectId !== undefined) recreated.projectId = tx.projectId
  return { kept, recreated }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/ledger && npm run typecheck`
Expected: PASS (правила, властивості на 240 випадкових книгах, наявні тести ledger без змін), `tsc` чисто.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add lib/domain/ledger/transfer.ts lib/domain/ledger/change.ts lib/domain/ledger/input.ts tests/unit/domain/ledger/transfer.test.ts tests/unit/domain/ledger/transfer-property.test.ts && git commit -m "feat(transfers): pure rules to convert, merge and split own transfers

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Ledger: `makeTransfer` (перетворення і злиття пари) в одній Admin-транзакції

**Files:**
- Create: `lib/server/ledger/transfer.ts`, `tests/integration/transfer-helpers.ts`, `tests/integration/ledger-transfers.test.ts`
- Modify: `lib/server/ledger/write.ts`, `lib/server/ledger/audit.ts`, `lib/server/ledger/accounts.ts`, `lib/server/ledger/index.ts`

- [ ] **Step 1: Write the failing tests**

Створити `tests/integration/transfer-helpers.ts`:

```ts
import type { Firestore } from 'firebase-admin/firestore'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import type { BankInfo, LedgerTransaction } from '@/lib/domain/ledger/types'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { createTransaction } from '@/lib/server/ledger/write'
import { ORG, UID } from './helpers'

/** A bank key (32 hex characters, as `bankTxKeys` makes them) from a small number. */
export const KEY = (n: number): string => n.toString(16).padStart(32, '0')

export interface BankOp {
  key: string
  type: 'income' | 'expense'
  accountId: string
  amountMinor: number
  paymentDate: string
  categoryId?: string
  description?: string
  tags?: string[]
}

/**
 * A bank operation exactly as the sync leaves it (lib/server/banking/sync.ts): the ledger writes it under `bk_<key>` with its
 * bank block (rollups and audit included), then its `bankSeen` mark with the locked fields it was imported with.
 */
export async function importBankOp(db: Firestore, deps: LedgerDeps, op: BankOp): Promise<LedgerTransaction> {
  const bank: BankInfo = { accountRef: `ba-${op.accountId}`, entryReference: `ref-${op.key.slice(-4)}`, counterpartyName: 'Własne konto', remittance: `Przelew ${op.key.slice(-4)}` }
  const body: Record<string, unknown> = {
    clientId: `bk_${op.key}`,
    type: op.type,
    accountId: op.accountId,
    amountMinor: op.amountMinor,
    paymentDate: op.paymentDate,
    tags: op.tags ?? [],
  }
  if (op.categoryId !== undefined) body.categoryId = op.categoryId
  if (op.description !== undefined) body.description = op.description
  const { transaction } = await createTransaction(deps, ORG, UID, parseTransactionInput(body, { internal: true }), bank)
  await db.doc(`organizations/${ORG}/bankSeen/${op.key}`).set({
    txId: `bk_${op.key}`,
    at: '2026-10-20T10:00:00.000Z',
    bank,
    snapshot: { type: op.type, accountId: op.accountId, amountMinor: op.amountMinor, paymentDate: op.paymentDate },
  })
  return transaction
}
```

Створити `tests/integration/ledger-transfers.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Timestamp } from 'firebase-admin/firestore'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { bankTxKeys } from '@/lib/server/banking/key'
import { syncStep } from '@/lib/server/banking/sync'
import { rebuildLedger } from '@/lib/server/ledger/rebuild'
import { makeTransfer } from '@/lib/server/ledger/transfer'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { bankDeps, ebTx, fakeEb, seedBank } from './bank-helpers'
import { ORG, UID, balanceOf, clearFirestore, makeDeps, readDoc, rollup, seedAccount, seedCategory, seedOrg, seedTag, testDb } from './helpers'
import { KEY, importBankOp } from './transfer-helpers'

const db = testDb()
const deps = makeDeps(db)
const txDoc = (id: string) => readDoc(db, `organizations/${ORG}/transactions/${id}`)
const mark = (key: string) => readDoc(db, `organizations/${ORG}/bankSeen/${key}`)
const versionOf = async (id: string) => (await db.doc(`organizations/${ORG}/transactions/${id}`).get()).updateTime as Timestamp

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : `other:${String(e)}`
  }
  return 'none'
}

async function balances(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const id of ['mil', 'mono', 'cash', 'eur']) out[id] = await balanceOf(db, ORG, id)
  return out
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'mil', 'PLN', 500_000)
  await seedAccount(db, ORG, 'mono', 'PLN', 0)
  await seedAccount(db, ORG, 'cash', 'PLN', 0)
  await seedAccount(db, ORG, 'eur', 'EUR', 100_000)
  await seedCategory(db, ORG, 'k-ex', 'expense')
  await seedCategory(db, ORG, 'k-in', 'income')
  await seedTag(db, ORG, 'q4', { name: 'Q4' })
  await seedTag(db, ORG, 'vat', { name: 'ПДВ', excludeFromAnalytics: true })
})

describe('makeTransfer: a pair of bank operations', () => {
  it('merges an expense and an income of two accounts into one transfer: no balance moves, the income goes, its mark stays', async () => {
    const out = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 100_000, paymentDate: '2026-10-20', categoryId: 'k-ex', tags: ['q4'] })
    const inc = await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mono', amountMinor: 100_000, paymentDate: '2026-10-20', categoryId: 'k-in' })
    const before = await balances()

    // In any order: the expense becomes the transfer.
    const made = await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [inc.id, out.id] })
    expect(made).toMatchObject({ deletedId: inc.id, droppedTags: 0 })
    expect(made.before.map((t) => t.id)).toEqual([out.id, inc.id])
    expect(made.transaction).toMatchObject({
      id: out.id, type: 'transfer', accountId: 'mil', toAccountId: 'mono', amountMinor: 100_000, toAmountMinor: 100_000,
      tags: ['q4'], bank: out.bank, bankTo: { key: KEY(2), ...inc.bank },
    })
    expect(made.transaction.categoryId).toBeUndefined()
    expect(made.transaction.toDate).toBeUndefined()
    expect(await txDoc(out.id)).toMatchObject({ type: 'transfer', source: 'bank', bankTo: { key: KEY(2) } })
    expect(await txDoc(inc.id)).toBeUndefined()
    expect(await mark(KEY(2))).toBeDefined()

    expect(await balances()).toEqual(before)
    expect(await rollup(db, ORG, 'cash_mil_2026-10-20')).toEqual({ transferOutMinor: 100_000 })
    expect(await rollup(db, ORG, 'cash_mono_2026-10-20')).toEqual({ transferInMinor: 100_000 })
    expect(await rollup(db, ORG, 'cashcat_2026-10')).toEqual({})
    expect(await rollup(db, ORG, 'pl_2026-10')).toEqual({})
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)

    const audit = await db.collection(`organizations/${ORG}/audit`).where('via', '==', 'transfer').get()
    expect(audit.docs.map((d) => `${d.get('action')}:${d.get('targetId')}`).sort()).toEqual([`tx.delete:${inc.id}`, `tx.update:${out.id}`].sort())
  })

  it('puts the money in on the day the receiving bank booked it, and the from-scratch computation agrees', async () => {
    const out = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 100_000, paymentDate: '2026-10-12' })
    const inc = await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mono', amountMinor: 100_000, paymentDate: '2026-10-14' })
    const made = await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })
    expect(made.transaction.toDate).toBe('2026-10-14')
    expect(await rollup(db, ORG, 'cash_mil_2026-10-12')).toEqual({ transferOutMinor: 100_000 })
    expect(await rollup(db, ORG, 'cash_mono_2026-10-14')).toEqual({ transferInMinor: 100_000 })
    expect(await rollup(db, ORG, 'cash_mono_2026-10-12')).toEqual({})
    const report = await rebuildLedger(deps, ORG, UID, { apply: false })
    expect(report.ok).toBe(true)
    expect(report.rollupDiffs).toEqual([])

    // An arrival day one day off is a rollup difference verifyLedger reports.
    await db.doc(`organizations/${ORG}/transactions/${out.id}`).update({ toDate: '2026-10-15' })
    const drift = await verifyLedger(deps, ORG)
    expect(drift.ok).toBe(false)
    expect(drift.rollupDiffs.map((d) => d.docId)).toEqual(['cash_mono_2026-10-14', 'cash_mono_2026-10-15'])
  })

  it('across currencies keeps both real amounts and drops the rates of the expense', async () => {
    const out = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'eur', amountMinor: 10_000, paymentDate: '2026-10-20' })
    const inc = await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mil', amountMinor: 44_000, paymentDate: '2026-10-21' })
    expect(out.base).toBeDefined()
    const before = await balances()
    const made = await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })
    expect(made.transaction).toMatchObject({ accountId: 'eur', currency: 'EUR', amountMinor: 10_000, toAccountId: 'mil', toCurrency: 'PLN', toAmountMinor: 44_000, toDate: '2026-10-21' })
    expect(made.transaction.fx).toBeUndefined()
    expect(made.transaction.base).toBeUndefined()
    expect(await balances()).toEqual(before)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('refuses a pair one of whose operations changed after the person saw it, and writes nothing', async () => {
    const out = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 100_000, paymentDate: '2026-10-20' })
    const inc = await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mono', amountMinor: 100_000, paymentDate: '2026-10-20' })
    const seen = [await versionOf(out.id), await versionOf(inc.id)] as const
    await updateTransaction(deps, ORG, UID, inc.id, { description: 'Zmieniony' })
    const before = await balances()
    expect(await code(makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id], versions: seen }))).toBe('conflict:undefined')
    expect(await txDoc(inc.id)).toMatchObject({ type: 'income', description: 'Zmieniony' })
    expect(await txDoc(out.id)).toMatchObject({ type: 'expense' })
    expect(await balances()).toEqual(before)

    // With the versions as they are now the same pair goes through.
    const now = [await versionOf(out.id), await versionOf(inc.id)] as const
    expect((await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id], versions: now })).deletedId).toBe(inc.id)
  })

  it('merges the tags (the expense first, at most 10) and takes `excluded` from all of them', async () => {
    const t = (n: number) => `t${String(n).padStart(2, '0')}`
    for (let n = 1; n <= 12; n++) await seedTag(db, ORG, t(n))
    const out = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 100, paymentDate: '2026-10-20', tags: [1, 2, 3, 4, 5, 6].map(t) })
    const inc = await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mono', amountMinor: 100, paymentDate: '2026-10-20', tags: [5, 6, 7, 8, 9, 10, 11, 12].map(t) })
    const made = await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })
    expect(made.transaction.tags).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(t))
    expect(made.droppedTags).toBe(2)

    const out2 = await importBankOp(db, deps, { key: KEY(3), type: 'expense', accountId: 'mil', amountMinor: 500, paymentDate: '2026-10-21', tags: ['q4'] })
    const inc2 = await importBankOp(db, deps, { key: KEY(4), type: 'income', accountId: 'mono', amountMinor: 500, paymentDate: '2026-10-22', tags: ['vat'] })
    const excluded = await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out2.id, inc2.id] })
    expect(excluded.transaction).toMatchObject({ tags: ['q4', 'vat'], excluded: true })
    expect(await rollup(db, ORG, 'x_cash_mil_2026-10-21')).toEqual({ transferOutMinor: 500 })
    expect(await rollup(db, ORG, 'x_cash_mono_2026-10-22')).toEqual({ transferInMinor: 500 })
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('refuses what is not a pair of bank sides, and a pair whose income has no mark; nothing moves', async () => {
    const out = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 100_000, paymentDate: '2026-10-12' })
    const inc = await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mono', amountMinor: 100_000, paymentDate: '2026-10-12' })
    const manual = await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'income', accountId: 'mono', amountMinor: 100_000, paymentDate: '2026-10-12' }))
    const sameAccount = await importBankOp(db, deps, { key: KEY(3), type: 'income', accountId: 'mil', amountMinor: 100_000, paymentDate: '2026-10-12' })
    const otherExpense = await importBankOp(db, deps, { key: KEY(4), type: 'expense', accountId: 'mono', amountMinor: 100_000, paymentDate: '2026-10-12' })
    const tooLate = await importBankOp(db, deps, { key: KEY(5), type: 'income', accountId: 'mono', amountMinor: 100_000, paymentDate: '2026-10-20' })
    const otherAmount = await importBankOp(db, deps, { key: KEY(6), type: 'income', accountId: 'mono', amountMinor: 99_999, paymentDate: '2026-10-12' })
    const before = await balances()

    for (const other of [manual.transaction.id, sameAccount.id, otherExpense.id, tooLate.id, otherAmount.id]) {
      expect(await code(makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, other] })), other).toBe('not_eligible:undefined')
    }
    expect(await code(makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, 'gone-12345678'] }))).toBe('not_found:undefined')

    await db.doc(`organizations/${ORG}/bankSeen/${KEY(2)}`).delete()
    expect(await code(makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] }))).toBe('not_eligible:undefined')
    expect(await txDoc(inc.id)).toMatchObject({ type: 'income' })
    expect(await balances()).toEqual(before)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })
})

describe('makeTransfer: one bank operation', () => {
  it('a cash machine withdrawal becomes a transfer to the cash box: the bank balance stays, the cash box gets the money', async () => {
    const atm = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 100_000, paymentDate: '2026-10-20', categoryId: 'k-ex' })
    const made = await makeTransfer(deps, ORG, UID, { mode: 'convert', id: atm.id, toAccountId: 'cash' })
    expect(made).toMatchObject({ deletedId: null, droppedTags: 0 })
    expect(made.before).toEqual([atm])
    expect(made.transaction).toMatchObject({ id: atm.id, type: 'transfer', accountId: 'mil', toAccountId: 'cash', bank: atm.bank })
    expect(made.transaction.bankTo).toBeUndefined()
    expect(await balanceOf(db, ORG, 'mil')).toBe(400_000)
    expect(await balanceOf(db, ORG, 'cash')).toBe(100_000)
    expect(await rollup(db, ORG, 'cash_mil_2026-10-20')).toEqual({ transferOutMinor: 100_000 })
    expect(await rollup(db, ORG, 'cash_cash_2026-10-20')).toEqual({ transferInMinor: 100_000 })
    expect(await rollup(db, ORG, 'pl_2026-10')).toEqual({})
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('a deposit (a bank income) becomes a transfer from the cash box whose incoming side is the bank one', async () => {
    const deposit = await importBankOp(db, deps, { key: KEY(5), type: 'income', accountId: 'mil', amountMinor: 30_000, paymentDate: '2026-10-21' })
    const made = await makeTransfer(deps, ORG, UID, { mode: 'convert', id: deposit.id, toAccountId: 'cash' })
    expect(made.transaction).toMatchObject({ id: deposit.id, type: 'transfer', accountId: 'cash', toAccountId: 'mil', bankTo: { key: KEY(5), ...deposit.bank } })
    expect(made.transaction.bank).toBeUndefined()
    expect((await txDoc(deposit.id))?.source).toBeUndefined()
    expect(await balanceOf(db, ORG, 'mil')).toBe(530_000)
    expect(await balanceOf(db, ORG, 'cash')).toBe(-30_000)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('refuses a target fed by a bank, another currency, the same account, a missing account and an operation that is a transfer already', async () => {
    const atm = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 100_000, paymentDate: '2026-10-20' })
    await db.doc(`organizations/${ORG}/bankAccounts/ba-mono`).set({ orgId: ORG, accountId: 'mono', status: 'disconnected' })
    expect(await code(makeTransfer(deps, ORG, UID, { mode: 'convert', id: atm.id, toAccountId: 'mono' }))).toBe('not_eligible:toAccountId')
    expect(await code(makeTransfer(deps, ORG, UID, { mode: 'convert', id: atm.id, toAccountId: 'eur' }))).toBe('currency_mismatch:toAccountId')
    expect(await code(makeTransfer(deps, ORG, UID, { mode: 'convert', id: atm.id, toAccountId: 'mil' }))).toBe('invalid_input:toAccountId')
    expect(await code(makeTransfer(deps, ORG, UID, { mode: 'convert', id: atm.id, toAccountId: 'nope' }))).toBe('account_not_found:toAccountId')
    expect(await txDoc(atm.id)).toMatchObject({ type: 'expense' })
    await makeTransfer(deps, ORG, UID, { mode: 'convert', id: atm.id, toAccountId: 'cash' })
    expect(await code(makeTransfer(deps, ORG, UID, { mode: 'convert', id: atm.id, toAccountId: 'cash' }))).toBe('not_eligible:undefined')
  })
})

describe('the bank sync after a merge', () => {
  it('does not import the merged income again: its mark stays and the sync only adds what it has no mark for', async () => {
    await seedAccount(db, ORG, 'a1', 'PLN', 0)
    await seedBank(db)
    const r1 = ebTx('r1', '100.00', 'CRDT', '2026-10-20')
    const bank = bankDeps(db, fakeEb({ '': { transactions: [r1], continuationKey: null } }, '100.00'))
    await syncStep(bank, ORG, UID, 'ba1')
    const incomeId = `bk_${bankTxKeys('ba1', [r1])[0].key}`
    const out = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 10_000, paymentDate: '2026-10-20' })
    await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, incomeId] })

    expect(await syncStep(bank, ORG, UID, 'ba1')).toMatchObject({ imported: 0, skipped: 1 })
    expect(await txDoc(incomeId)).toBeUndefined()
    expect(await txDoc(out.id)).toMatchObject({ type: 'transfer', toAccountId: 'a1' })
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /f/AI/finflow && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts tests/integration/ledger-transfers.test.ts"
```

Expected: FAIL (`@/lib/server/ledger/transfer` не існує).

- [ ] **Step 3: Implement**

`lib/server/ledger/write.ts`:

1. Рядок `import { FieldValue, Timestamp, type DocumentSnapshot } from 'firebase-admin/firestore'` замінити на `import { FieldValue, Timestamp, type DocumentSnapshot, type Firestore, type Transaction } from 'firebase-admin/firestore'`.
2. Рядок `import { changeSet } from '@/lib/domain/ledger/change'` замінити на `import { changeSet, type ChangeSet } from '@/lib/domain/ledger/change'`.
3. Після функції `evidenceOf` додати:

```ts
/** Writes the balance and rollup increments of a change set inside `t` (S05: the single write rule, `changeSet`). */
export function applyChange(t: Transaction, db: Firestore, orgId: string, change: ChangeSet, ts: Timestamp): void {
  for (const [id, delta] of Object.entries(change.balanceDeltas)) {
    t.update(accountsCol(db, orgId).doc(id), { balanceMinor: FieldValue.increment(delta), updatedAt: ts })
  }
  for (const [id, flat] of change.rollupDeltas) {
    t.set(rollupsCol(db, orgId).doc(id), nest(flat, (n) => FieldValue.increment(n)), { merge: true })
  }
}

/**
 * The stored document of an operation: its fields plus the server's bookkeeping. `old` is the stored data of the operation
 * it replaces (absent for a new one): its creation stamp and the S05 migration provenance outlive every edit.
 */
export function storedDoc(next: LedgerTransaction, orgId: string, uid: string, ts: Timestamp, old?: Record<string, unknown>): Record<string, unknown> {
  return {
    ...transactionToDoc(next),
    ...(old && old.migratedFrom !== undefined ? { migratedFrom: old.migratedFrom } : {}),
    ...(old && old.legacy !== undefined ? { legacy: old.legacy } : {}),
    orgId,
    createdAt: old ? (old.createdAt ?? ts) : ts,
    createdBy: old ? (old.createdBy ?? uid) : uid,
    updatedAt: ts,
    updatedBy: uid,
  }
}
```

4. У `commit` блок

```ts
    for (const [id, delta] of Object.entries(change.balanceDeltas)) {
      t.update(accountsCol(db, orgId).doc(id), { balanceMinor: FieldValue.increment(delta), updatedAt: ts })
    }
    for (const [id, flat] of change.rollupDeltas) {
      t.set(rollupsCol(db, orgId).doc(id), nest(flat, (n) => FieldValue.increment(n)), { merge: true })
    }

    if (next) {
      const old = currentSnap.data() ?? {}
      t.set(txRef, {
        ...transactionToDoc(next),
        // Provenance of a migrated operation (S05 migration) outlives edits.
        ...(job.prior && old.migratedFrom !== undefined ? { migratedFrom: old.migratedFrom } : {}),
        ...(job.prior && old.legacy !== undefined ? { legacy: old.legacy } : {}),
        orgId,
        createdAt: job.prior ? (old.createdAt ?? ts) : ts,
        createdBy: job.prior ? (old.createdBy ?? uid) : uid,
        updatedAt: ts,
        updatedBy: uid,
      })
    } else {
```

замінити на:

```ts
    applyChange(t, db, orgId, change, ts)

    if (next) {
      t.set(txRef, storedDoc(next, orgId, uid, ts, job.prior ? (currentSnap.data() ?? {}) : undefined))
    } else {
```

5. У `refreshExcluded` блок

```ts
    for (const [id, delta] of Object.entries(change.balanceDeltas)) {
      t.update(accountsCol(db, orgId).doc(id), { balanceMinor: FieldValue.increment(delta), updatedAt: ts })
    }
    for (const [id, flat] of change.rollupDeltas) {
      t.set(rollupsCol(db, orgId).doc(id), nest(flat, (n) => FieldValue.increment(n)), { merge: true })
    }
    t.update(txRef, { excluded: excluded ? true : FieldValue.delete(), updatedAt: ts, updatedBy: uid })
```

замінити на:

```ts
    applyChange(t, db, orgId, change, ts)
    t.update(txRef, { excluded: excluded ? true : FieldValue.delete(), updatedAt: ts, updatedBy: uid })
```

`lib/server/ledger/audit.ts`: рядки

```ts
/** What made a change when it was not a person's own edit (S10: the rules; S10t: a tag's flag changed). */
export interface AuditMeta {
  via?: 'rule' | 'tag'
}
```

замінити на:

```ts
/**
 * What made a change when it was not a plain edit of the operation: the rules (S10), a tag's flag (S10t), or making or
 * splitting a transfer (S10b: the operation changed type, went into the transfer, or came back out of it).
 */
export interface AuditMeta {
  via?: 'rule' | 'tag' | 'transfer'
}
```

`lib/server/ledger/accounts.ts`: рядок `async function isLinkedToBank(t: Transaction, deps: LedgerDeps, orgId: string, accountId: string): Promise<boolean> {` замінити на `export async function isLinkedToBank(t: Transaction, deps: LedgerDeps, orgId: string, accountId: string): Promise<boolean> {`.

Створити `lib/server/ledger/transfer.ts`:

```ts
import { Timestamp, type DocumentSnapshot, type Firestore, type Transaction } from 'firebase-admin/firestore'
import { changeSet, combineChanges } from '@/lib/domain/ledger/change'
import { parseAccount, parseTransaction, transactionToDoc } from '@/lib/domain/ledger/doc'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { bankKeyOf, bankSideOf, convertToTransfer, mergeToTransfer } from '@/lib/domain/ledger/transfer'
import type { LedgerAccount, LedgerTransaction } from '@/lib/domain/ledger/types'
import { excludedFromTags, tagFlagsOf, withExcluded } from '@/lib/domain/tags/exclude'
import { isLinkedToBank } from './accounts'
import { auditData } from './audit'
import type { LedgerDeps } from './deps'
import { assertUnlocked } from './lock'
import { accountsCol, auditCol, orgRef, tagsCol, transactionsCol } from './paths'
import { applyChange, storedDoc } from './write'

/**
 * One «make it a transfer» (S10b). `convert`: one bank operation and the account of the other side. `pair`: two bank
 * operations in any order (the expense becomes the transfer, the income goes into it); `versions`, when given, are the
 * versions the person saw (a suggestion), in the order of `ids`.
 */
export type TransferJob =
  | { mode: 'convert'; id: string; toAccountId: string }
  | { mode: 'pair'; ids: readonly [string, string]; versions?: readonly [Timestamp, Timestamp] }

export interface MadeTransfer {
  transaction: LedgerTransaction
  /** The bank operation that went into the transfer (a pair); null for a conversion. */
  deletedId: string | null
  /** Tags of that operation left out because the transfer had 10 already. */
  droppedTags: number
  /** The operations as they were before: what an undo writes back after the split. */
  before: LedgerTransaction[]
}

/** The operation in a snapshot read inside the transaction: gone is `not_found`, a document the ledger cannot read is `not_eligible`. */
function operationOf(snap: DocumentSnapshot): LedgerTransaction {
  if (!snap.exists) throw new LedgerError('not_found')
  const tx = parseTransaction(snap.id, snap.data())
  if (!tx) throw new LedgerError('not_eligible')
  return tx
}

/** `excluded` of an operation with these tags, from the flags as they are inside this transaction (S10t). */
async function excludedNow(t: Transaction, db: Firestore, orgId: string, tags: readonly string[]): Promise<boolean> {
  const snaps: DocumentSnapshot[] = []
  for (const id of tags) snaps.push(await t.get(tagsCol(db, orgId).doc(id)))
  return excludedFromTags(tags, tagFlagsOf(snaps))
}

/** Every account the operations touch exists with the currency they carry (as `commit` checks); otherwise `conflict`. */
async function assertAccounts(t: Transaction, db: Firestore, orgId: string, txs: readonly LedgerTransaction[]): Promise<void> {
  const want = new Map<string, string>()
  for (const tx of txs) {
    want.set(tx.accountId, tx.currency)
    if (tx.toAccountId !== undefined && tx.toCurrency !== undefined) want.set(tx.toAccountId, tx.toCurrency)
  }
  for (const [id, currency] of want) {
    const snap = await t.get(accountsCol(db, orgId).doc(id))
    const account = snap.exists ? parseAccount(snap.id, snap.data()) : null
    if (!account || account.currency !== currency) throw new LedgerError('conflict')
  }
}

async function targetAccount(t: Transaction, db: Firestore, orgId: string, id: string): Promise<LedgerAccount> {
  const snap = await t.get(accountsCol(db, orgId).doc(id))
  const account = snap.exists ? parseAccount(snap.id, snap.data()) : null
  if (!account) throw new LedgerError('account_not_found', 'toAccountId')
  return account
}

/**
 * Makes a transfer (S10b) in ONE Firestore transaction: the operation(s), the balances and rollups through the change sets
 * (`changeSet`, `combineChanges`), the audit. A conversion turns one bank operation into a transfer with an account that no
 * bank feeds (such an account gets its side from its own bank: merge the two instead). A pair turns a bank expense into a
 * transfer that absorbs the bank income of another account; the income is deleted, its `bankSeen` mark stays (and must
 * exist: it keeps the sync from importing that income again). Every read comes first.
 */
export async function makeTransfer(deps: LedgerDeps, orgId: string, uid: string, job: TransferJob): Promise<MadeTransfer> {
  const { db } = deps
  return db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const orgSnap = await t.get(orgRef(db, orgId))
    if (!orgSnap.exists) throw new LedgerError('not_found', 'org')
    const baseCurrency = orgSnap.get('currency') as string
    return job.mode === 'convert' ? convertIn(t, deps, orgId, uid, baseCurrency, job) : mergeIn(t, deps, orgId, uid, baseCurrency, job)
  })
}

async function convertIn(
  t: Transaction,
  deps: LedgerDeps,
  orgId: string,
  uid: string,
  baseCurrency: string,
  job: Extract<TransferJob, { mode: 'convert' }>,
): Promise<MadeTransfer> {
  const { db } = deps
  const ref = transactionsCol(db, orgId).doc(job.id)
  const snap = await t.get(ref)
  const prior = operationOf(snap)
  const target = await targetAccount(t, db, orgId, job.toAccountId)
  if (await isLinkedToBank(t, deps, orgId, target.id)) throw new LedgerError('not_eligible', 'toAccountId')
  const built = convertToTransfer(prior, target)
  await assertAccounts(t, db, orgId, [prior, built])
  const next = withExcluded(built, await excludedNow(t, db, orgId, built.tags))

  const ts = Timestamp.fromDate(deps.now())
  applyChange(t, db, orgId, changeSet(prior, next, baseCurrency), ts)
  t.set(ref, storedDoc(next, orgId, uid, ts, snap.data() ?? {}))
  t.create(auditCol(db, orgId).doc(), auditData(deps, 'tx.update', uid, prior.id, transactionToDoc(prior), transactionToDoc(next), { via: 'transfer' }))
  return { transaction: next, deletedId: null, droppedTags: 0, before: [prior] }
}

async function mergeIn(
  t: Transaction,
  deps: LedgerDeps,
  orgId: string,
  uid: string,
  baseCurrency: string,
  job: Extract<TransferJob, { mode: 'pair' }>,
): Promise<MadeTransfer> {
  const { db } = deps
  const refs = job.ids.map((id) => transactionsCol(db, orgId).doc(id))
  const snaps = [await t.get(refs[0]), await t.get(refs[1])]
  const versions = job.versions
  if (versions) {
    snaps.forEach((snap, i) => {
      if (snap.exists && (!snap.updateTime || !snap.updateTime.isEqual(versions[i]))) throw new LedgerError('conflict')
    })
  }
  const [a, b] = snaps.map(operationOf)
  // The expense is the outgoing side and keeps its id; the income goes into it.
  const first = bankSideOf(a) === 'out'
  const out = first ? a : b
  const inc = first ? b : a
  const outSnap = first ? snaps[0] : snaps[1]
  const incRef = first ? refs[1] : refs[0]
  const { transfer, droppedTags } = mergeToTransfer(out, inc)
  const markSnap = await t.get(orgRef(db, orgId).collection('bankSeen').doc(bankKeyOf(inc.id) as string))
  if (!markSnap.exists) throw new LedgerError('not_eligible')
  await assertAccounts(t, db, orgId, [out, inc, transfer])
  const next = withExcluded(transfer, await excludedNow(t, db, orgId, transfer.tags))

  const ts = Timestamp.fromDate(deps.now())
  applyChange(t, db, orgId, combineChanges(changeSet(out, next, baseCurrency), changeSet(inc, null, baseCurrency)), ts)
  t.set(outSnap.ref, storedDoc(next, orgId, uid, ts, outSnap.data() ?? {}))
  t.delete(incRef)
  t.create(auditCol(db, orgId).doc(), auditData(deps, 'tx.update', uid, out.id, transactionToDoc(out), transactionToDoc(next), { via: 'transfer' }))
  t.create(auditCol(db, orgId).doc(), auditData(deps, 'tx.delete', uid, inc.id, transactionToDoc(inc), null, { via: 'transfer' }))
  return { transaction: next, deletedId: inc.id, droppedTags: droppedTags.length, before: [out, inc] }
}
```

`lib/server/ledger/index.ts`:

1. Після рядка `import { rebuildLedger } from './rebuild'` додати `import { makeTransfer, type TransferJob } from './transfer'`.
2. У об'єкті `ledger` після рядка `  retagTransaction: (orgId: string, uid: string, txId: string, change: TagChange) => retagTransaction(ledgerDeps(), orgId, uid, txId, change),` додати:

```ts
  makeTransfer: (orgId: string, uid: string, job: TransferJob) => makeTransfer(ledgerDeps(), orgId, uid, job),
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /f/AI/finflow && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts tests/integration/ledger-transfers.test.ts tests/integration/ledger-transactions.test.ts tests/integration/ledger-tags.test.ts tests/integration/tags-recalc.test.ts tests/integration/ledger-restore.test.ts tests/integration/bank-sync.test.ts" && npm run typecheck && npm run lint
```

Expected: PASS (нові тести; `commit` і `refreshExcluded` пишуть те саме через `applyChange`/`storedDoc`, наявні тести ledger, тегів, відновлення й синхронізації без змін), `tsc` чисто, `lint` без нових попереджень.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add lib/server/ledger/transfer.ts lib/server/ledger/write.ts lib/server/ledger/audit.ts lib/server/ledger/accounts.ts lib/server/ledger/index.ts tests/integration/transfer-helpers.ts tests/integration/ledger-transfers.test.ts && git commit -m "feat(transfers): makeTransfer converts a bank operation or merges a bank pair in one transaction

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `splitTransfer`, відновлення видаленого банківського переказу, редагування банківського переказу

**Files:**
- Modify: `lib/server/ledger/transfer.ts`, `lib/server/ledger/write.ts`, `lib/server/ledger/index.ts`, `lib/domain/ledger/input.ts`, `lib/domain/ledger/build.ts`, `types/index.ts`, `lib/firebase/ledger-map.ts`, `lib/api/ledger-client.ts`, `lib/api/transaction-undo.ts`
- Test: `tests/unit/domain/ledger/transfer-input.test.ts`, `tests/unit/api/transfer-undo.test.ts`, `tests/integration/ledger-transfer-split.test.ts` (створити)

- [ ] **Step 1: Write the failing tests**

Створити `tests/unit/domain/ledger/transfer-input.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildTransaction } from '@/lib/domain/ledger/build'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransactionInput, parseTransactionPatch } from '@/lib/domain/ledger/input'

const A = 'a'.repeat(32)
const B = 'b'.repeat(32)
const PAIR = { clientId: `bk_${A}`, type: 'transfer', accountId: 'mil', toAccountId: 'mono', amountMinor: 100_000, paymentDate: '2026-10-12' }
const INTERNAL = { internal: true }

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : 'other'
  }
  return 'ok'
}

describe('the restore keys of a bank transfer (S10b)', () => {
  it('the undo of a deleted bank transfer may bring its arrival day and the key of its incoming bank side', () => {
    expect(parseTransactionInput({ ...PAIR, toDate: '2026-10-14', bankToKey: B }, INTERNAL)).toMatchObject({ toDate: '2026-10-14', bankToKey: B })
    const sameDay = parseTransactionInput({ ...PAIR, bankToKey: B }, INTERNAL)
    expect(sameDay.bankToKey).toBe(B)
    expect(sameDay.toDate).toBeUndefined()
  })

  it.each<[string, Record<string, unknown>, { internal?: boolean } | undefined, string]>([
    ['without the internal flag the bank id itself is refused', { ...PAIR, bankToKey: B }, undefined, 'invalid_input:clientId'],
    ['under an ordinary id', { ...PAIR, clientId: 'manual-12345678', bankToKey: B }, INTERNAL, 'invalid_input:bankToKey'],
    ['an arrival day without the incoming key', { ...PAIR, toDate: '2026-10-14' }, INTERNAL, 'invalid_input:bankToKey'],
    ['its own key as the incoming key', { ...PAIR, bankToKey: A }, INTERNAL, 'invalid_input:bankToKey'],
    ['an incoming key that is not a document id', { ...PAIR, bankToKey: 'a/b' }, INTERNAL, 'invalid_input:bankToKey'],
    ['an arrival day on the payment day', { ...PAIR, toDate: '2026-10-12', bankToKey: B }, INTERNAL, 'invalid_input:toDate'],
    ['an arrival day 8 days away', { ...PAIR, toDate: '2026-10-20', bankToKey: B }, INTERNAL, 'invalid_input:toDate'],
    ['an arrival day on an income', { clientId: `bk_${A}`, type: 'income', accountId: 'mil', amountMinor: 1, paymentDate: '2026-10-12', toDate: '2026-10-13' }, INTERNAL, 'invalid_input:toDate'],
    ['an incoming key on an expense', { clientId: `bk_${A}`, type: 'expense', accountId: 'mil', amountMinor: 1, paymentDate: '2026-10-12', bankToKey: B }, INTERNAL, 'invalid_input:bankToKey'],
  ])('refuses %s', (_name, body, opts, expected) => {
    expect(code(() => parseTransactionInput(body, opts))).toBe(expected)
  })

  it('an edit never takes them', () => {
    expect(code(() => parseTransactionPatch({ toDate: '2026-10-14' }))).toBe('invalid_input:toDate')
    expect(code(() => parseTransactionPatch({ bankToKey: B }))).toBe('invalid_input:bankToKey')
  })

  it('the build keeps the arrival day of the input', () => {
    const input = parseTransactionInput({ ...PAIR, toDate: '2026-10-14', bankToKey: B }, INTERNAL)
    const tx = buildTransaction(PAIR.clientId, input, {
      today: '2026-10-27',
      account: { id: 'mil', currency: 'PLN' },
      toAccount: { id: 'mono', currency: 'PLN' },
      category: null,
      baseCurrency: 'PLN',
    })
    expect(tx.toDate).toBe('2026-10-14')
  })
})
```

Створити `tests/unit/api/transfer-undo.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bankRestoreOf, restoreTransaction } from '@/lib/api/transaction-undo'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { toUiTransaction } from '@/lib/firebase/ledger-map'

const OUT_KEY = 'a'.repeat(32)
const IN_KEY = 'b'.repeat(32)
const pair: LedgerTransaction = {
  id: `bk_${OUT_KEY}`, type: 'transfer', status: 'actual', accountId: 'mil', amountMinor: 100_000, currency: 'PLN',
  toAccountId: 'mono', toAmountMinor: 100_000, toCurrency: 'PLN', toDate: '2026-10-14',
  paymentDate: '2026-10-12', accrual: { mode: 'date', date: '2026-10-12' }, isRecurring: false, tags: ['q4'], fileUrls: [],
  bank: { accountRef: 'ba-mil' }, bankTo: { key: IN_KEY, accountRef: 'ba-mono' },
}
const deposit: LedgerTransaction = {
  id: `bk_${IN_KEY}`, type: 'transfer', status: 'actual', accountId: 'cash', amountMinor: 30_000, currency: 'PLN',
  toAccountId: 'mil', toAmountMinor: 30_000, toCurrency: 'PLN', paymentDate: '2026-10-20',
  accrual: { mode: 'date', date: '2026-10-20' }, isRecurring: false, tags: [], fileUrls: [], bankTo: { key: IN_KEY, accountRef: 'ba-mil' },
}

afterEach(() => vi.unstubAllGlobals())

describe('the transfer fields in the browser (S10b)', () => {
  it('toUiTransaction carries the incoming bank side and the arrival day', () => {
    const ui = toUiTransaction('o1', pair)
    expect(ui.bankTo).toEqual(pair.bankTo)
    expect(ui.toDate).toBe('2026-10-14')
    expect(toUiTransaction('o1', deposit).toDate).toBeUndefined()
  })

  it('bankRestoreOf: the arrival day when it differs, the incoming key when both sides came from banks, nothing otherwise', () => {
    expect(bankRestoreOf(toUiTransaction('o1', pair))).toEqual({ toDate: '2026-10-14', bankToKey: IN_KEY })
    expect(bankRestoreOf(toUiTransaction('o1', deposit))).toEqual({})
    const expense: LedgerTransaction = { ...deposit, type: 'expense', toAccountId: undefined, toAmountMinor: undefined, toCurrency: undefined, bankTo: undefined }
    expect(bankRestoreOf(toUiTransaction('o1', expense))).toEqual({})
  })

  it('restoreTransaction of a bank transfer sends both with the draft', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ transaction: { id: pair.id } }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await restoreTransaction('o1', toUiTransaction('o1', pair))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/orgs/o1/transactions')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      clientId: pair.id, type: 'transfer', status: 'actual', accountId: 'mil', toAccountId: 'mono', amountMinor: 100_000,
      paymentDate: '2026-10-12', isRecurring: false, tags: ['q4'], fileUrls: [], toDate: '2026-10-14', bankToKey: IN_KEY,
    })
  })
})
```

Створити `tests/integration/ledger-transfer-split.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { draftToBody, draftToPatch } from '@/lib/api/ledger-client'
import { transactionToDraft } from '@/lib/api/transaction-draft'
import { bankRestoreOf } from '@/lib/api/transaction-undo'
import { parseTransaction } from '@/lib/domain/ledger/doc'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransactionInput, type TransactionInput } from '@/lib/domain/ledger/input'
import { flatten } from '@/lib/domain/ledger/rollups'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { toUiTransaction } from '@/lib/firebase/ledger-map'
import { makeTransfer, splitTransfer } from '@/lib/server/ledger/transfer'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createTransaction, deleteTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { ORG, UID, balanceOf, clearFirestore, fakeResolveRate, makeDeps, readDoc, seedAccount, seedOrg, seedTag, testDb } from './helpers'
import { KEY, importBankOp } from './transfer-helpers'

const db = testDb()
const deps = makeDeps(db)
const txDoc = (id: string) => readDoc(db, `organizations/${ORG}/transactions/${id}`)

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : `other:${String(e)}`
  }
  return 'none'
}

async function stored(id: string): Promise<LedgerTransaction> {
  const snap = await db.doc(`organizations/${ORG}/transactions/${id}`).get()
  const tx = parseTransaction(snap.id, snap.data())
  if (!tx) throw new Error(`unreadable ${id}`)
  return tx
}

async function balances(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const id of ['mil', 'mono', 'cash', 'cash2', 'eur']) out[id] = await balanceOf(db, ORG, id)
  return out
}

/** Every rollup document with its non-zero fields. */
async function allRollups(): Promise<Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, number>> = {}
  for (const d of (await db.collection(`organizations/${ORG}/rollups`).get()).docs) {
    const flat = Object.fromEntries(Object.entries(flatten(d.data())).filter(([, v]) => v !== 0))
    if (Object.keys(flat).length > 0) out[d.id] = flat
  }
  return out
}

/** The undo of a delete as the browser sends it: the draft under the operation's id, plus what a bank transfer adds. */
function restoreInput(tx: LedgerTransaction, over: Record<string, unknown> = {}): TransactionInput {
  const ui = toUiTransaction(ORG, tx)
  const body = { ...JSON.parse(JSON.stringify({ ...draftToBody(transactionToDraft(ui), ui.id), ...bankRestoreOf(ui) })), ...over }
  return parseTransactionInput(body, { internal: true })
}

/** A bank pair of mil → mono, merged; the income on `inDay`. */
async function mergedPair(inDay = '2026-10-20') {
  const out = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 100_000, paymentDate: '2026-10-20' })
  const inc = await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mono', amountMinor: 100_000, paymentDate: inDay })
  return { out, inc }
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'mil', 'PLN', 500_000)
  await seedAccount(db, ORG, 'mono', 'PLN', 0)
  await seedAccount(db, ORG, 'cash', 'PLN', 0)
  await seedAccount(db, ORG, 'cash2', 'PLN', 0)
  await seedAccount(db, ORG, 'eur', 'EUR', 100_000)
  await seedTag(db, ORG, 'q4', { name: 'Q4' })
})

describe('splitTransfer', () => {
  it('a merged pair comes back as its two bank operations: the balances and the rollups are those before the merge', async () => {
    const { out, inc } = await mergedPair('2026-10-22')
    const beforeBalances = await balances()
    const beforeRollups = await allRollups()
    await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })

    const { restored } = await splitTransfer(deps, ORG, UID, out.id)
    expect(restored.map((t) => `${t.id}:${t.type}`)).toEqual([`${out.id}:expense`, `${inc.id}:income`])
    expect(await stored(out.id)).toMatchObject({ type: 'expense', accountId: 'mil', amountMinor: 100_000, paymentDate: '2026-10-20', bank: out.bank })
    expect(await stored(inc.id)).toMatchObject({ type: 'income', accountId: 'mono', paymentDate: '2026-10-22', bank: inc.bank, description: inc.bank?.remittance })
    expect((await stored(out.id)).bankTo).toBeUndefined()
    expect(await balances()).toEqual(beforeBalances)
    expect(await allRollups()).toEqual(beforeRollups)
    expect(await readDoc(db, `organizations/${ORG}/bankSeen/${KEY(2)}`)).toBeDefined()
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
    const audit = await db.collection(`organizations/${ORG}/audit`).where('action', '==', 'tx.create').where('via', '==', 'transfer').get()
    expect(audit.docs.map((d) => d.get('targetId'))).toEqual([inc.id])
  })

  it('a converted expense and a converted income come back alone, and the cash box is back where it was', async () => {
    const atm = await importBankOp(db, deps, { key: KEY(3), type: 'expense', accountId: 'mil', amountMinor: 100_000, paymentDate: '2026-10-20' })
    const deposit = await importBankOp(db, deps, { key: KEY(4), type: 'income', accountId: 'mil', amountMinor: 30_000, paymentDate: '2026-10-21' })
    const before = await balances()
    await makeTransfer(deps, ORG, UID, { mode: 'convert', id: atm.id, toAccountId: 'cash' })
    await makeTransfer(deps, ORG, UID, { mode: 'convert', id: deposit.id, toAccountId: 'cash' })
    expect(await balanceOf(db, ORG, 'cash')).toBe(70_000)

    expect((await splitTransfer(deps, ORG, UID, atm.id)).restored).toHaveLength(1)
    expect((await splitTransfer(deps, ORG, UID, deposit.id)).restored).toHaveLength(1)
    expect(await stored(atm.id)).toEqual(atm)
    expect(await stored(deposit.id)).toEqual(deposit)
    expect(await balances()).toEqual(before)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('a side in another currency gets its rates again', async () => {
    const out = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'eur', amountMinor: 10_000, paymentDate: '2026-10-20' })
    const inc = await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mil', amountMinor: 44_000, paymentDate: '2026-10-20' })
    await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })
    await splitTransfer(deps, ORG, UID, out.id)
    expect((await stored(out.id)).base).toEqual(out.base)
    expect((await stored(out.id)).fx).toEqual(out.fx)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('refuses when the transfer changed while the rates were resolved, and writes nothing', async () => {
    const out = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'eur', amountMinor: 10_000, paymentDate: '2026-10-20' })
    const inc = await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mil', amountMinor: 44_000, paymentDate: '2026-10-20' })
    await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })
    const rates = fakeResolveRate()
    let touched = false
    const racing = makeDeps(db, {
      resolveRate: async (from, to, date) => {
        if (!touched) {
          touched = true
          await updateTransaction(deps, ORG, UID, out.id, { description: 'W międzyczasie' })
        }
        return rates(from, to, date)
      },
    })
    expect(await code(splitTransfer(racing, ORG, UID, out.id))).toBe('conflict:undefined')
    expect(await stored(out.id)).toMatchObject({ type: 'transfer', description: 'W międzyczasie' })
    expect(await txDoc(inc.id)).toBeUndefined()
  })

  it('refuses a manual transfer, an income, a missing operation and an income id that is taken', async () => {
    const manual = await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'transfer', accountId: 'mil', toAccountId: 'cash', amountMinor: 500, paymentDate: '2026-10-20' }))
    expect(await code(splitTransfer(deps, ORG, UID, manual.transaction.id))).toBe('not_eligible:undefined')
    const income = await importBankOp(db, deps, { key: KEY(9), type: 'income', accountId: 'mil', amountMinor: 1, paymentDate: '2026-10-20' })
    expect(await code(splitTransfer(deps, ORG, UID, income.id))).toBe('not_eligible:undefined')
    expect(await code(splitTransfer(deps, ORG, UID, 'gone-12345678'))).toBe('not_found:undefined')

    const { out, inc } = await mergedPair()
    await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })
    await db.doc(`organizations/${ORG}/transactions/${inc.id}`).set({ placeholder: true })
    expect(await code(splitTransfer(deps, ORG, UID, out.id))).toBe('conflict:undefined')
    expect(await stored(out.id)).toMatchObject({ type: 'transfer' })
  })
})

describe('the undo of a deleted bank transfer', () => {
  it('a merged pair with its arrival day, a deposit and a converted expense come back as they were, from the marks', async () => {
    const { out, inc } = await mergedPair('2026-10-22')
    const pair = (await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })).transaction
    const deposit = await importBankOp(db, deps, { key: KEY(4), type: 'income', accountId: 'mil', amountMinor: 30_000, paymentDate: '2026-10-21' })
    const depositTransfer = (await makeTransfer(deps, ORG, UID, { mode: 'convert', id: deposit.id, toAccountId: 'cash' })).transaction
    const atm = await importBankOp(db, deps, { key: KEY(3), type: 'expense', accountId: 'mil', amountMinor: 100_000, paymentDate: '2026-10-20' })
    const atmTransfer = (await makeTransfer(deps, ORG, UID, { mode: 'convert', id: atm.id, toAccountId: 'cash' })).transaction
    await updateTransaction(deps, ORG, UID, pair.id, { tags: ['q4'], description: 'Własny' })
    const tagged = await stored(pair.id)
    const before = await balances()

    for (const tx of [tagged, depositTransfer, atmTransfer]) {
      await deleteTransaction(deps, ORG, UID, tx.id)
      await createTransaction(deps, ORG, UID, restoreInput(tx))
      expect(await stored(tx.id)).toEqual(tx)
    }
    expect(await balances()).toEqual(before)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('refuses a restore that names another arrival day or another incoming side, and writes nothing', async () => {
    const { out, inc } = await mergedPair('2026-10-22')
    const pair = (await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })).transaction
    await deleteTransaction(deps, ORG, UID, pair.id)
    const before = await balances()
    expect(await code(createTransaction(deps, ORG, UID, restoreInput(pair, { toDate: '2026-10-21' })))).toBe('invalid_input:clientId')
    expect(await code(createTransaction(deps, ORG, UID, restoreInput(pair, { bankToKey: KEY(7) })))).toBe('invalid_input:clientId')
    expect(await code(createTransaction(deps, ORG, UID, restoreInput(pair, { toAccountId: 'cash' })))).toBe('invalid_input:clientId')
    expect(await txDoc(pair.id)).toBeUndefined()
    expect(await balances()).toEqual(before)
  })

  it('never counts a bank operation twice: a merged income cannot come back on its own, nor a transfer whose income is back', async () => {
    const { out, inc } = await mergedPair()
    const pair = (await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })).transaction
    const incomeAlone = parseTransactionInput({ clientId: inc.id, type: 'income', accountId: 'mono', amountMinor: 100_000, paymentDate: '2026-10-20' }, { internal: true })
    expect(await code(createTransaction(deps, ORG, UID, incomeAlone))).toBe('invalid_input:clientId')

    // The transfer is deleted and the income comes back alone (its mark allows it now); the transfer then cannot come back.
    await deleteTransaction(deps, ORG, UID, pair.id)
    await createTransaction(deps, ORG, UID, incomeAlone)
    expect(await code(createTransaction(deps, ORG, UID, restoreInput(pair)))).toBe('invalid_input:clientId')
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })
})

describe('an edit of a bank transfer', () => {
  it('keeps both bank sides and the arrival day; a full replace with the same draft (the undo of an edit) passes', async () => {
    const { out, inc } = await mergedPair('2026-10-22')
    const pair = (await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })).transaction
    await updateTransaction(deps, ORG, UID, pair.id, { description: 'Własny', tags: ['q4'] })
    expect(await stored(pair.id)).toMatchObject({ description: 'Własny', tags: ['q4'], bank: pair.bank, bankTo: pair.bankTo, toDate: '2026-10-22' })
    await updateTransaction(deps, ORG, UID, pair.id, draftToPatch(transactionToDraft(toUiTransaction(ORG, pair))), { restore: true })
    expect(await stored(pair.id)).toEqual(pair)
  })

  it('refuses a change of a bank side; the account of the side that is not from a bank may change', async () => {
    const { out, inc } = await mergedPair()
    const pair = (await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [out.id, inc.id] })).transaction
    expect(await code(updateTransaction(deps, ORG, UID, pair.id, { toAccountId: 'cash' }))).toBe('bank_locked:toAccountId')
    expect(await code(updateTransaction(deps, ORG, UID, pair.id, { paymentDate: '2026-10-19' }))).toBe('bank_locked:paymentDate')

    const deposit = await importBankOp(db, deps, { key: KEY(4), type: 'income', accountId: 'mil', amountMinor: 30_000, paymentDate: '2026-10-21' })
    await makeTransfer(deps, ORG, UID, { mode: 'convert', id: deposit.id, toAccountId: 'cash' })
    expect(await code(updateTransaction(deps, ORG, UID, deposit.id, { toAccountId: 'cash2' }))).toBe('bank_locked:toAccountId')
    await updateTransaction(deps, ORG, UID, deposit.id, { accountId: 'cash2' })
    expect(await balanceOf(db, ORG, 'cash')).toBe(0)
    expect(await balanceOf(db, ORG, 'cash2')).toBe(-30_000)
    expect((await stored(deposit.id)).bankTo).toEqual({ key: KEY(4), ...deposit.bank })
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/ledger/transfer-input.test.ts tests/unit/api/transfer-undo.test.ts; export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts tests/integration/ledger-transfer-split.test.ts"
```

Expected: FAIL (`toDate`/`bankToKey` не приймаються; `bankRestoreOf`, `splitTransfer` не існують; UI-тип не має `bankTo`/`toDate`; відновлення банківського переказу дає `invalid_input` на `clientId`; редагування губить `bankTo`/`toDate`).

- [ ] **Step 3: Implement**

`lib/domain/ledger/input.ts`:

1. Рядок `import { isDay, monthsBetween } from './days'` замінити на `import { daysApart, isDay, monthsBetween } from './days'`.
2. Рядок `import { TX_STATUSES, TX_TYPES, type Accrual, type LedgerTransaction, type TxStatus, type TxType } from './types'` замінити на `import { MAX_ARRIVAL_DAYS, TX_STATUSES, TX_TYPES, type Accrual, type LedgerTransaction, type TxStatus, type TxType } from './types'`.
3. Рядки

```ts
const CREATE_KEYS = [
  'clientId', 'type', 'status', 'accountId', 'amountMinor', 'toAccountId', 'toAmountMinor', 'paymentDate',
  'accrual', 'categoryId', 'counterpartyId', 'description', 'isRecurring', 'projectId', 'tags', 'fileUrls',
] as const
const PATCH_KEYS = CREATE_KEYS.filter((k) => k !== 'clientId')
```

замінити на:

```ts
const CREATE_KEYS = [
  'clientId', 'type', 'status', 'accountId', 'amountMinor', 'toAccountId', 'toAmountMinor', 'paymentDate',
  'accrual', 'categoryId', 'counterpartyId', 'description', 'isRecurring', 'projectId', 'tags', 'fileUrls',
  'toDate', 'bankToKey',
] as const
/** What only the undo of a deleted bank transfer sends (S10b): never part of an edit. */
const RESTORE_KEYS: readonly string[] = ['toDate', 'bankToKey']
const PATCH_KEYS = CREATE_KEYS.filter((k) => k !== 'clientId' && !RESTORE_KEYS.includes(k))
```

4. В інтерфейсі `TransactionInput` після рядка `  fileUrls: string[]` додати:

```ts
  /** The arrival day of a bank transfer that comes back from a delete (S10b); only with `bankToKey`. */
  toDate?: string
  /** The bank key of the incoming side of a bank transfer that comes back from a delete (S10b). */
  bankToKey?: string
```

5. У `parseTransactionInput` рядки

```ts
    if (r.counterpartyId !== undefined) bad('counterpartyId')
  } else {
    if (r.toAccountId !== undefined) bad('toAccountId')
    if (r.toAmountMinor !== undefined) bad('toAmountMinor')
```

замінити на:

```ts
    if (r.counterpartyId !== undefined) bad('counterpartyId')
    if (r.toDate !== undefined || r.bankToKey !== undefined) {
      // Only the undo of a deleted bank transfer sends these (S10b): under its bank id, from server code that lets bank ids
      // through. createTransaction checks both against the bank's marks.
      const clientId = typeof r.clientId === 'string' && opts?.internal === true ? r.clientId : ''
      if (!clientId.startsWith(BANK_CLIENT_ID_PREFIX)) bad(r.toDate !== undefined ? 'toDate' : 'bankToKey')
      if (!isId(r.bankToKey) || r.bankToKey === clientId.slice(BANK_CLIENT_ID_PREFIX.length)) bad('bankToKey')
      out.bankToKey = r.bankToKey
      if (r.toDate !== undefined) {
        const toDate = day(r.toDate, 'toDate')
        if (toDate === paymentDate || daysApart(toDate, paymentDate) > MAX_ARRIVAL_DAYS) bad('toDate')
        out.toDate = toDate
      }
    }
  } else {
    if (r.toAccountId !== undefined) bad('toAccountId')
    if (r.toAmountMinor !== undefined) bad('toAmountMinor')
    if (r.toDate !== undefined) bad('toDate')
    if (r.bankToKey !== undefined) bad('bankToKey')
```

`lib/domain/ledger/build.ts`: після рядка `    tx.toCurrency = to.currency` додати `    if (input.toDate !== undefined) tx.toDate = input.toDate`.

`lib/server/ledger/write.ts`:

1. Рядок `import { assertBankUnlocked } from '@/lib/domain/ledger/bank-lock'` замінити на `import { assertBankUnlocked, withBankSides } from '@/lib/domain/ledger/bank-lock'`.
2. Рядок `import { parseAccount, parseTransaction, transactionToDoc } from '@/lib/domain/ledger/doc'` замінити на `import { parseAccount, parseBankInfo, parseTransaction, transactionToDoc } from '@/lib/domain/ledger/doc'`.
3. Рядок `import type { AutoRuleRef, BankInfo, LedgerTransaction, RateEvidence } from '@/lib/domain/ledger/types'` замінити на `import type { AutoRuleRef, BankInfo, BankToInfo, LedgerTransaction, RateEvidence } from '@/lib/domain/ledger/types'`.
4. Функцію `readBankBlock` (з коментарем `/** The \`bank\` block of a bank mark, ...`) і функцію `bankProvenanceOf` (з коментарем `/** The provenance of a create whose id is a bank operation id ...`) видалити й на їхньому місці (після функції `isRecord`) вставити:

```ts
/** The bank blocks a create under a bank id takes from the bank's own marks (S09; transfers S10b). */
interface BankSides {
  bank?: BankInfo
  bankTo?: BankToInfo
}

function refuseBankId(): never {
  throw new LedgerError('invalid_input', 'clientId')
}

/** The bank's mark of one imported operation: its bank block and the locked fields of the import; null without them (a failed import). */
async function readMark(deps: LedgerDeps, orgId: string, key: string): Promise<{ bank: BankInfo; snapshot: Record<string, unknown> } | null> {
  const snap = await orgRef(deps.db, orgId).collection('bankSeen').doc(key).get()
  const mark = snap.exists ? snap.data() : undefined
  const bank = parseBankInfo(mark?.bank)
  return bank !== null && isRecord(mark?.snapshot) ? { bank, snapshot: mark.snapshot } : null
}

/** The import a mark records was this one: type, account, amount and payment day. */
function imported(s: Record<string, unknown>, type: string, accountId: string, amountMinor: number, paymentDate: string): boolean {
  return s.type === type && s.accountId === accountId && s.amountMinor === amountMinor && s.paymentDate === paymentDate
}

/**
 * A bank side about to come back must not live on already (S10b): neither as its own operation nor as the incoming side of
 * another transfer. `selfId` is the operation being created; it may hold the key itself (a replay of the same create,
 * which `commit` answers with the stored operation).
 */
async function assertSideFree(deps: LedgerDeps, orgId: string, key: string, selfId: string): Promise<void> {
  const ownId = `${BANK_CLIENT_ID_PREFIX}${key}`
  if (ownId !== selfId && (await transactionsCol(deps.db, orgId).doc(ownId).get()).exists) refuseBankId()
  const holders = await transactionsCol(deps.db, orgId).where('bankTo.key', '==', key).limit(2).get()
  if (holders.docs.some((d) => d.id !== selfId)) refuseBankId()
}

/**
 * The provenance of a create whose id is a bank operation id (`bk_` + key). Only the bank's own marks (`bankSeen/{key}`,
 * written by the sync at import) can say what the operation was: the create must repeat the locked fields of that import
 * and be an actual operation, otherwise it is refused (`invalid_input` on `clientId`). This is how an undo of a deleted bank
 * operation comes back with its bank block, and how a client cannot make one. A transfer (S10b) comes back the same way:
 * its outgoing side is the expense its own id was imported as, its incoming side the income of `bankToKey` on
 * `toAccountId` with `toAmountMinor` on `toDate ?? paymentDate` (a deposit, whose only bank side is the incoming one, is the
 * income its own id was imported as). A side that lives on already is refused, so nothing counts a bank operation twice.
 * Ids without the prefix return undefined (an ordinary create).
 */
async function bankSidesOf(deps: LedgerDeps, orgId: string, input: TransactionInput): Promise<BankSides | undefined> {
  const clientId = input.clientId
  if (clientId === undefined || !clientId.startsWith(BANK_CLIENT_ID_PREFIX)) return undefined
  if (input.status !== 'actual') refuseBankId()
  const key = clientId.slice(BANK_CLIENT_ID_PREFIX.length)
  const own = await readMark(deps, orgId, key)
  if (own === null) refuseBankId()
  if (input.type !== 'transfer') {
    if (!imported(own.snapshot, input.type, input.accountId, input.amountMinor, input.paymentDate)) refuseBankId()
    await assertSideFree(deps, orgId, key, clientId)
    return { bank: own.bank }
  }
  const toAccountId = input.toAccountId as string
  // Between accounts of one currency the amount that arrives is the amount itself (buildTransaction).
  const toAmountMinor = input.toAmountMinor ?? input.amountMinor
  if (imported(own.snapshot, 'expense', input.accountId, input.amountMinor, input.paymentDate)) {
    if (input.bankToKey === undefined) return { bank: own.bank }
    const other = await readMark(deps, orgId, input.bankToKey)
    if (other === null || !imported(other.snapshot, 'income', toAccountId, toAmountMinor, input.toDate ?? input.paymentDate)) refuseBankId()
    await assertSideFree(deps, orgId, input.bankToKey, clientId)
    return { bank: own.bank, bankTo: { key: input.bankToKey, ...other.bank } }
  }
  if (input.bankToKey !== undefined || !imported(own.snapshot, 'income', toAccountId, toAmountMinor, input.paymentDate)) refuseBankId()
  await assertSideFree(deps, orgId, key, clientId)
  return { bankTo: { key, ...own.bank } }
}
```

5. У `createTransaction` рядки

```ts
  const provenance = bank ?? (await bankProvenanceOf(deps, orgId, input))
  const next = await prepare(deps, orgId, txId, input)
  if (provenance !== undefined) next.tx = { ...next.tx, bank: provenance }
```

замінити на:

```ts
  const sides = bank !== undefined ? { bank } : await bankSidesOf(deps, orgId, input)
  const next = await prepare(deps, orgId, txId, input)
  if (sides !== undefined) next.tx = { ...next.tx, ...sides }
```

6. У `updateTransaction` рядки

```ts
  if (prior.tx.bank !== undefined) {
    assertBankUnlocked(prior.tx, next.tx)
    // toRawInput never carries `bank`, so an edit keeps the provenance from the prior document.
    next.tx = { ...next.tx, bank: prior.tx.bank }
  }
```

замінити на:

```ts
  if (prior.tx.bank !== undefined || prior.tx.bankTo !== undefined) {
    // toRawInput never carries the bank blocks or the arrival day (S10b): an edit keeps them from the prior document, and
    // the lock compares what each bank side fixes.
    const carried = withBankSides(next.tx, prior.tx)
    assertBankUnlocked(prior.tx, carried)
    next.tx = carried
  }
```

`lib/server/ledger/transfer.ts`:

1. Рядок `import { Timestamp, type DocumentSnapshot, type Firestore, type Transaction } from 'firebase-admin/firestore'` лишити; після нього додати `import { attachFx, fxPlan } from '@/lib/domain/ledger/build'`.
2. Рядок `import { bankKeyOf, bankSideOf, convertToTransfer, mergeToTransfer } from '@/lib/domain/ledger/transfer'` замінити на `import { bankKeyOf, bankSideOf, convertToTransfer, mergeToTransfer, splitTransferSides } from '@/lib/domain/ledger/transfer'`.
3. Рядок `import { applyChange, storedDoc } from './write'` замінити на `import { applyChange, evidenceOf, storedDoc } from './write'`.
4. У кінець файлу додати:

```ts

export interface SplitResult {
  /** What the transfer was split into: the operation under its id first, then the income re-created under its bank id. */
  restored: LedgerTransaction[]
}

/**
 * Splits a transfer with a bank side back into the bank operations it was (S10b, `splitTransferSides`), in ONE Firestore
 * transaction through the change sets, so no balance moves. A side in another currency than the company's needs its rates
 * again: they are resolved first (network, outside the transaction), and the transaction then requires the transfer to be
 * the version read before (`conflict` otherwise). The re-created income must not exist (`conflict`). Audit: `tx.update` of
 * the transfer and `tx.create` of the income, both `via: 'transfer'`.
 */
export async function splitTransfer(deps: LedgerDeps, orgId: string, uid: string, txId: string): Promise<SplitResult> {
  const { db } = deps
  const ref = transactionsCol(db, orgId).doc(txId)
  const read = await ref.get()
  if (!read.exists) throw new LedgerError('not_found')
  const prior = parseTransaction(read.id, read.data())
  if (!prior || !read.updateTime) throw new LedgerError('not_eligible')
  const version = read.updateTime
  const org = await orgRef(db, orgId).get()
  if (!org.exists) throw new LedgerError('not_found', 'org')
  const baseCurrency = org.get('currency') as string
  const sides = splitTransferSides(prior)
  const today = deps.today()
  const withRates = async (tx: LedgerTransaction): Promise<LedgerTransaction> => {
    const plan = fxPlan(tx, baseCurrency, today)
    const snapshots = await Promise.all(plan.map((r) => deps.resolveRate(r.from, r.to, r.date)))
    return attachFx(tx, plan, snapshots.map(evidenceOf))
  }
  const kept = await withRates(sides.kept)
  const recreated = sides.recreated === null ? null : await withRates(sides.recreated)

  return db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const orgSnap = await t.get(orgRef(db, orgId))
    const snap = await t.get(ref)
    const otherRef = recreated === null ? null : transactionsCol(db, orgId).doc(recreated.id)
    const otherSnap = otherRef === null ? null : await t.get(otherRef)
    if (!orgSnap.exists || orgSnap.get('currency') !== baseCurrency) throw new LedgerError('conflict')
    if (!snap.exists) throw new LedgerError('not_found')
    if (!snap.updateTime || !snap.updateTime.isEqual(version)) throw new LedgerError('conflict')
    if (otherSnap?.exists) throw new LedgerError('conflict')
    await assertAccounts(t, db, orgId, recreated === null ? [prior, kept] : [prior, kept, recreated])
    // Both sides keep the transfer's tags: one reading of their flags serves both (S10t).
    const excluded = await excludedNow(t, db, orgId, prior.tags)
    const keptNext = withExcluded(kept, excluded)
    const recreatedNext = recreated === null ? null : withExcluded(recreated, excluded)

    const ts = Timestamp.fromDate(deps.now())
    applyChange(t, db, orgId, combineChanges(changeSet(prior, keptNext, baseCurrency), changeSet(null, recreatedNext, baseCurrency)), ts)
    t.set(ref, storedDoc(keptNext, orgId, uid, ts, snap.data() ?? {}))
    t.create(auditCol(db, orgId).doc(), auditData(deps, 'tx.update', uid, prior.id, transactionToDoc(prior), transactionToDoc(keptNext), { via: 'transfer' }))
    if (otherRef !== null && recreatedNext !== null) {
      t.create(otherRef, storedDoc(recreatedNext, orgId, uid, ts))
      t.create(auditCol(db, orgId).doc(), auditData(deps, 'tx.create', uid, recreatedNext.id, null, transactionToDoc(recreatedNext), { via: 'transfer' }))
    }
    return { restored: recreatedNext === null ? [keptNext] : [keptNext, recreatedNext] }
  })
}
```

`lib/server/ledger/index.ts`:

1. Рядок `import { makeTransfer, type TransferJob } from './transfer'` замінити на `import { makeTransfer, splitTransfer, type TransferJob } from './transfer'`.
2. Після рядка `  makeTransfer: (orgId: string, uid: string, job: TransferJob) => makeTransfer(ledgerDeps(), orgId, uid, job),` додати:

```ts
  splitTransfer: (orgId: string, uid: string, txId: string) => splitTransfer(ledgerDeps(), orgId, uid, txId),
```

`types/index.ts`:

1. Рядок `import type { Accrual, AutoRuleRef, BankInfo, TxStatus } from '@/lib/domain/ledger/types'` замінити на `import type { Accrual, AutoRuleRef, BankInfo, BankToInfo, TxStatus } from '@/lib/domain/ledger/types'`.
2. В інтерфейсі `Transaction` після рядка `  bank?: BankInfo` додати:

```ts
  /** The incoming side of a transfer when it came from a bank (S10b). */
  bankTo?: BankToInfo
  /** The day the money arrived on `toAccountId` (`YYYY-MM-DD`), when it differs from the payment day (S10b). */
  toDate?: string
```

`lib/firebase/ledger-map.ts`: після рядка `  if (tx.bank !== undefined) ui.bank = tx.bank` додати:

```ts
  if (tx.bankTo !== undefined) ui.bankTo = tx.bankTo
  if (tx.toDate !== undefined) ui.toDate = tx.toDate
```

`lib/api/ledger-client.ts`: рядки

```ts
/** `clientId` makes a retry or a double click create the operation once. */
export async function createTransaction(orgId: string, draft: TransactionDraft, clientId?: string): Promise<string> {
  const out = (await call('POST', `${org(orgId)}/transactions`, draftToBody(draft, clientId))) as { transaction: { id: string } }
```

замінити на:

```ts
/** What only the undo of a deleted bank transfer adds to a create (S10b); the server checks both against the bank's marks. */
export interface BankRestore {
  /** The arrival day, when the receiving bank booked it on another day than the payment day. */
  toDate?: string
  /** The bank key of the incoming side of a transfer that has both bank sides. */
  bankToKey?: string
}

/** `clientId` makes a retry or a double click create the operation once. */
export async function createTransaction(orgId: string, draft: TransactionDraft, clientId?: string, restore: BankRestore = {}): Promise<string> {
  const out = (await call('POST', `${org(orgId)}/transactions`, { ...draftToBody(draft, clientId), ...restore })) as { transaction: { id: string } }
```

`lib/api/transaction-undo.ts`: замінити файл повністю на:

```ts
import { createTransaction, updateTransaction, type BankRestore } from '@/lib/api/ledger-client'
import { transactionToDraft } from '@/lib/api/transaction-draft'
import type { Transaction } from '@/types'

/** Undo of a delete: the operation is created again under its own id, with the content it had (and its bank sides, S10b). */
export function restoreTransaction(orgId: string, tx: Transaction): Promise<string> {
  return createTransaction(orgId, transactionToDraft(tx), tx.id, bankRestoreOf(tx))
}

/**
 * What the undo of a deleted bank transfer adds to its draft (S10b): the arrival day when it differs from the payment day,
 * and the key of the incoming bank side when both sides came from banks (a transfer with one bank side is under that side's
 * own id). Nothing for any other operation. The server takes the bank blocks from its marks, never from here.
 */
export function bankRestoreOf(tx: Transaction): BankRestore {
  if (tx.type !== 'transfer') return {}
  const out: BankRestore = {}
  if (tx.toDate !== undefined) out.toDate = tx.toDate
  if (tx.bank !== undefined && tx.bankTo !== undefined) out.bankToKey = tx.bankTo.key
  return out
}

/**
 * Undo of an edit or of a bulk change: the operation as it was stored before is written back as a full replace. It says so
 * (`restore`), because the state may carry a tag that is archived by now.
 */
export function revertTransaction(orgId: string, before: Transaction): Promise<void> {
  return updateTransaction(orgId, before.id, transactionToDraft(before), { restore: true })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/ledger tests/unit/api tests/unit/firebase && npm run typecheck && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts tests/integration/ledger-transfer-split.test.ts tests/integration/ledger-transfers.test.ts tests/integration/bank-undo.test.ts tests/integration/ledger-bank.test.ts tests/integration/ledger-restore.test.ts tests/integration/bank-sync.test.ts"
```

Expected: PASS (нові тести; `bank-undo.test.ts` без змін: звичайна банківська операція відновлюється з позначки, змінене заблоковане поле, позначка-невдача чи її відсутність дають `invalid_input` на `clientId`; `transaction-undo.test.ts` без змін: витрата не отримує нових ключів), `tsc` чисто.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add lib/server/ledger/transfer.ts lib/server/ledger/write.ts lib/server/ledger/index.ts lib/domain/ledger/input.ts lib/domain/ledger/build.ts types/index.ts lib/firebase/ledger-map.ts lib/api/ledger-client.ts lib/api/transaction-undo.ts tests/unit/domain/ledger/transfer-input.test.ts tests/unit/api/transfer-undo.test.ts tests/integration/ledger-transfer-split.test.ts && git commit -m "feat(transfers): split a bank transfer back, restore a deleted one from the bank marks, keep its sides on edits

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Журнал на сервері: залишок після рядка з днем зарахування

**Files:**
- Modify: `lib/server/journal/read.ts`, `lib/domain/journal/balance.ts`
- Test: `tests/unit/domain/journal/arrival.test.ts`, `tests/integration/journal-transfers.test.ts` (створити)

- [ ] **Step 1: Write the failing tests**

Створити `tests/unit/domain/journal/arrival.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { arrivalShiftOf } from '@/lib/domain/journal/balance'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

const transfer = (paymentDate: string, toDate?: string, status: 'actual' | 'planned' = 'actual'): LedgerTransaction => ({
  id: 'bk_1', type: 'transfer', status, accountId: 'mil', amountMinor: 100, currency: 'PLN', toAccountId: 'mono',
  toAmountMinor: 90, toCurrency: 'PLN', paymentDate, accrual: { mode: 'date', date: paymentDate }, isRecurring: false,
  tags: [], fileUrls: [], ...(toDate === undefined ? {} : { toDate }),
})

describe('arrivalShiftOf (S10b)', () => {
  it('adds the money in when it left on or before the day and arrived after it', () => {
    expect(arrivalShiftOf(transfer('2026-10-12', '2026-10-14'), '2026-10-12')).toBe(90)
    expect(arrivalShiftOf(transfer('2026-10-12', '2026-10-14'), '2026-10-13')).toBe(90)
  })

  it('takes it off when it left after the day but arrived on or before it', () => {
    expect(arrivalShiftOf(transfer('2026-10-17', '2026-10-16'), '2026-10-16')).toBe(-90)
  })

  it('is 0 when both days are on one side of the day, without an arrival day, and for a planned transfer', () => {
    expect(arrivalShiftOf(transfer('2026-10-12', '2026-10-14'), '2026-10-14')).toBe(0)
    expect(arrivalShiftOf(transfer('2026-10-12', '2026-10-14'), '2026-10-11')).toBe(0)
    expect(arrivalShiftOf(transfer('2026-10-17', '2026-10-16'), '2026-10-17')).toBe(0)
    expect(arrivalShiftOf(transfer('2026-10-12'), '2026-10-12')).toBe(0)
    expect(arrivalShiftOf(transfer('2026-10-12', '2026-10-14', 'planned'), '2026-10-13')).toBe(0)
  })
})
```

Створити `tests/integration/journal-transfers.test.ts`:

```ts
// tests/integration/journal-transfers.test.ts
import { Timestamp } from 'firebase-admin/firestore'
import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_FILTERS, type JournalFilters } from '@/lib/domain/journal/filter'
import { compareKeys, decodeCursor, type JournalKey } from '@/lib/domain/journal/order'
import { parseAccount, parseTransaction } from '@/lib/domain/ledger/doc'
import { datedEffects } from '@/lib/domain/ledger/effects'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { readJournalPage } from '@/lib/server/journal/read'
import { makeTransfer } from '@/lib/server/ledger/transfer'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { ORG, clearFirestore, makeDeps, seedAccount, seedOrg, testDb, UID } from './helpers'
import { KEY, importBankOp, type BankOp } from './transfer-helpers'

const db = testDb()
let tick = 0
// Every write one second later: the creation times order the operations inside a day.
const deps = makeDeps(db, { now: () => new Date(Date.UTC(2026, 9, 27, 10, 0, 0) + ++tick * 1000) })

interface Stored { tx: LedgerTransaction; key: JournalKey }

async function allStored(): Promise<Stored[]> {
  const snap = await db.collection(`organizations/${ORG}/transactions`).get()
  const out: Stored[] = []
  for (const d of snap.docs) {
    const tx = parseTransaction(d.id, d.data())
    const created = d.get('createdAt') as Timestamp
    if (tx) out.push({ tx, key: { paymentDate: tx.paymentDate, createdAtS: created.seconds, createdAtN: created.nanoseconds, id: d.id } })
  }
  return out.sort((a, b) => compareKeys(a.key, b.key))
}

/**
 * The oracle: every movement of every account on its own day (S10b: the money in of a transfer on its arrival day), in the
 * listing order inside the day; each operation gets the balance of its own account right after its movement there.
 */
async function expectedBalances(stored: Stored[]): Promise<Map<string, number>> {
  const balances = new Map<string, number>()
  for (const d of (await db.collection(`organizations/${ORG}/accounts`).get()).docs) {
    const a = parseAccount(d.id, d.data())
    if (a) balances.set(a.id, a.openingMinor)
  }
  const moves = stored.flatMap(({ tx, key }) => datedEffects(tx).map((e) => ({ tx, e, key: { ...key, paymentDate: e.day } })))
  moves.sort((a, b) => compareKeys(b.key, a.key)) // oldest first
  const after = new Map<string, number>()
  for (const { tx, e } of moves) {
    balances.set(e.accountId, (balances.get(e.accountId) ?? 0) + e.delta)
    if (e.accountId === tx.accountId) after.set(tx.id, balances.get(e.accountId) as number)
  }
  return after
}

async function readAll(filters: JournalFilters, limit: number) {
  const rows: Awaited<ReturnType<typeof readJournalPage>>['rows'] = []
  let cursor: JournalKey | null = null
  let guard = 0
  do {
    const page = await readJournalPage(deps, ORG, { filters, cursor, limit })
    rows.push(...page.rows)
    cursor = page.next === null ? null : decodeCursor(page.next)
    if (++guard > 200) throw new Error('the cursor never ends')
  } while (cursor)
  return rows
}

const OPS: BankOp[] = [
  { key: KEY(1), type: 'income', accountId: 'mono', amountMinor: 30_000, paymentDate: '2026-10-12' },
  { key: KEY(2), type: 'expense', accountId: 'mil', amountMinor: 100_000, paymentDate: '2026-10-12' },
  { key: KEY(3), type: 'income', accountId: 'mono', amountMinor: 100_000, paymentDate: '2026-10-14' },
  { key: KEY(4), type: 'expense', accountId: 'mono', amountMinor: 5_000, paymentDate: '2026-10-13' },
  { key: KEY(5), type: 'expense', accountId: 'mono', amountMinor: 2_000, paymentDate: '2026-10-14' },
  { key: KEY(10), type: 'expense', accountId: 'mono', amountMinor: 700, paymentDate: '2026-10-15' },
  { key: KEY(7), type: 'income', accountId: 'mil', amountMinor: 40_000, paymentDate: '2026-10-16' },
  { key: KEY(8), type: 'income', accountId: 'mono', amountMinor: 1_000, paymentDate: '2026-10-16' },
  { key: KEY(6), type: 'expense', accountId: 'mono', amountMinor: 40_000, paymentDate: '2026-10-17' },
  { key: KEY(9), type: 'expense', accountId: 'mil', amountMinor: 3_000, paymentDate: '2026-10-18' },
]

beforeEach(async () => {
  tick = 0
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'mil', 'PLN', 500_000)
  await seedAccount(db, ORG, 'mono', 'PLN', 50_000)
  for (const op of OPS) await importBankOp(db, deps, op)
  // mil → mono left on 10-12 and arrived on 10-14; mono → mil left on 10-17 and arrived the day before.
  await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [`bk_${KEY(2)}`, `bk_${KEY(3)}`] })
  await makeTransfer(deps, ORG, UID, { mode: 'pair', ids: [`bk_${KEY(6)}`, `bk_${KEY(7)}`] })
})

describe('the balance after each journal row with transfers that arrived on another day (S10b)', () => {
  it.each([1, 2, 3, 50])('pages of %i rows over every account', async (limit) => {
    const stored = await allStored()
    const oracle = await expectedBalances(stored)
    const rows = await readAll(EMPTY_FILTERS, limit)
    expect(rows.map((r) => r.tx.id)).toEqual(stored.map((s) => s.tx.id))
    for (const row of rows) expect(row.balanceAfterMinor, `${row.tx.id} at ${limit}`).toBe(oracle.get(row.tx.id))
  })

  it.each([1, 2, 5])('pages of %i rows of the receiving account', async (limit) => {
    const stored = await allStored()
    const oracle = await expectedBalances(stored)
    const rows = await readAll({ ...EMPTY_FILTERS, accountId: 'mono' }, limit)
    expect(rows.map((r) => r.tx.id)).toEqual(stored.filter((s) => s.tx.accountId === 'mono' || s.tx.toAccountId === 'mono').map((s) => s.tx.id))
    for (const row of rows) expect(row.balanceAfterMinor, `${row.tx.id} at ${limit}`).toBe(oracle.get(row.tx.id))
  })

  it('the newest row of each account shows its balance, and the ledger verifies', async () => {
    const rows = await readAll(EMPTY_FILTERS, 50)
    for (const accountId of ['mil', 'mono']) {
      const newest = rows.find((r) => r.tx.accountId === accountId)
      const stored = await db.doc(`organizations/${ORG}/accounts/${accountId}`).get()
      expect(newest?.balanceAfterMinor, accountId).toBe(stored.get('balanceMinor'))
    }
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/journal/arrival.test.ts; export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts tests/integration/journal-transfers.test.ts"
```

Expected: FAIL (`arrivalShiftOf` не існує; залишки рядків `mono` між 10-12 і 10-14 та рядків `mil` біля 10-16/10-17 розходяться з оракулом).

- [ ] **Step 3: Implement**

`lib/domain/journal/balance.ts`:

1. На початок файлу додати рядок `import type { LedgerTransaction } from '@/lib/domain/ledger/types'` і порожній рядок.
2. У кінець файлу додати:

```ts

/**
 * What the money in of a transfer adds to «the net movement of its target after `day`» beyond the sums by payment day
 * (S10b, `toDate`): + the amount when it left on or before `day` but arrived after it, − the amount when it left after
 * `day` but arrived on or before it; 0 otherwise, and for anything but an actual transfer with an arrival day of its own.
 */
export function arrivalShiftOf(tx: LedgerTransaction, day: string): number {
  if (tx.type !== 'transfer' || tx.status !== 'actual' || tx.toDate === undefined) return 0
  const amount = tx.toAmountMinor as number
  if (tx.paymentDate <= day && tx.toDate > day) return amount
  if (tx.paymentDate > day && tx.toDate <= day) return -amount
  return 0
}
```

`lib/server/journal/read.ts`:

1. Рядок `import { balancesAfter, type DayOps } from '@/lib/domain/journal/balance'` замінити на `import { arrivalShiftOf, balancesAfter, type DayOps } from '@/lib/domain/journal/balance'`.
2. Рядок `import { balanceEffects } from '@/lib/domain/ledger/effects'` замінити на:

```ts
import { addDays } from '@/lib/domain/ledger/days'
import { datedEffects } from '@/lib/domain/ledger/effects'
```

3. Рядок `import type { LedgerAccount, LedgerTransaction } from '@/lib/domain/ledger/types'` замінити на `import { MAX_ARRIVAL_DAYS, type LedgerAccount, type LedgerTransaction } from '@/lib/domain/ledger/types'`.
4. У коментарі над `netAfterDay` після речення `... and transfers into the account (\`toAmountMinor\`). They are billed by index entries, not by documents read.` додати рядок коментаря:

```ts
 * A transfer whose money arrived on another day than it left (S10b) is corrected by `arrivalShift`.
```

5. У `netAfterDay` рядки

```ts
  const [income, outflow, transferIn] = await Promise.all([
    sum(actualAfter.where('accountId', '==', accountId).where('type', '==', 'income'), 'amountMinor'),
    sum(actualAfter.where('accountId', '==', accountId).where('type', 'in', ['expense', 'transfer']), 'amountMinor'),
    sum(actualAfter.where('toAccountId', '==', accountId), 'toAmountMinor'),
  ])
  return income - outflow + transferIn
}
```

замінити на:

```ts
  const [income, outflow, transferIn, arrivals] = await Promise.all([
    sum(actualAfter.where('accountId', '==', accountId).where('type', '==', 'income'), 'amountMinor'),
    sum(actualAfter.where('accountId', '==', accountId).where('type', 'in', ['expense', 'transfer']), 'amountMinor'),
    sum(actualAfter.where('toAccountId', '==', accountId), 'toAmountMinor'),
    arrivalShift(deps, orgId, accountId, day, stats),
  ])
  return income - outflow + transferIn + arrivals
}

/**
 * The transfers into the account paid within MAX_ARRIVAL_DAYS of `day`: the only ones whose arrival day (S10b) can be on
 * the other side of `day` than their payment day. The listing query of the journal (index `toAccountId`, `paymentDate`,
 * `createdAt`), so no index of its own. Exported for the rollout check (scripts/check-transfers.ts).
 */
export function arrivalsQuery(deps: Pick<LedgerDeps, 'db'>, orgId: string, accountId: string, day: string): Query {
  return transactionsCol(deps.db, orgId)
    .where('toAccountId', '==', accountId)
    .where('paymentDate', '>=', addDays(day, -MAX_ARRIVAL_DAYS))
    .where('paymentDate', '<=', addDays(day, MAX_ARRIVAL_DAYS))
    .orderBy('paymentDate', 'desc')
    .orderBy('createdAt', 'desc')
    .orderBy(FieldPath.documentId(), 'desc')
}

/** The sums by payment day place the money in of a transfer on the day it left; this moves it to the day it arrived. */
async function arrivalShift(deps: LedgerDeps, orgId: string, accountId: string, day: string, stats: ReadStats): Promise<number> {
  const snap = await arrivalsQuery(deps, orgId, accountId, day).get()
  stats.docsRead += snap.size
  let shift = 0
  for (const d of snap.docs) {
    const tx = parseTransaction(d.id, d.data())
    if (tx) shift += arrivalShiftOf(tx, day)
  }
  return shift
}
```

6. Функцію `opsOfDay` разом з її коментарем `/** Every actual operation that moves the account on \`day\`, in listing order, with its effect on the account. */` замінити на:

```ts
/**
 * Every operation that may move the account on `day`: paid that day from or to it, or a transfer whose money arrived on it
 * that day (S10b `toDate`). Equality filters only, so no composite index. Exported for the rollout check.
 */
export function dayOpsQuery(deps: Pick<LedgerDeps, 'db'>, orgId: string, accountId: string, day: string): Query {
  return transactionsCol(deps.db, orgId).where(
    Filter.or(
      Filter.and(Filter.where('paymentDate', '==', day), Filter.or(Filter.where('accountId', '==', accountId), Filter.where('toAccountId', '==', accountId))),
      Filter.and(Filter.where('toDate', '==', day), Filter.where('toAccountId', '==', accountId)),
    ),
  )
}

/** Every actual operation that moves the account on `day`, in listing order, with its movement of the account that day. */
async function opsOfDay(deps: LedgerDeps, orgId: string, accountId: string, day: string, stats: ReadStats): Promise<DayOps['ops']> {
  const snap = await dayOpsQuery(deps, orgId, accountId, day).get()
  stats.docsRead += snap.size
  const listed: { key: JournalKey; id: string; effect: number }[] = []
  for (const d of snap.docs) {
    const tx = parseTransaction(d.id, d.data())
    if (!tx) continue
    // What moves this account on this day (S10b: the money in of a transfer counts on its arrival day; planned moves nothing).
    const moves = datedEffects(tx).filter((e) => e.accountId === accountId && e.day === day)
    if (moves.length === 0) continue
    // An operation without a creation time cannot be listed, but it still moved the balance: keep it, last in its day. Money
    // that arrived from another payment day sits among the operations of this day by its creation time.
    const key: JournalKey = { ...(keyOf(d) ?? { createdAtS: 0, createdAtN: 0, id: d.id }), paymentDate: day }
    listed.push({ key, id: d.id, effect: moves.reduce((sum, e) => sum + e.delta, 0) })
  }
  return listed.sort((a, b) => compareKeys(a.key, b.key)).map(({ id, effect }) => ({ id, effect }))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/journal && npm run typecheck && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts tests/integration/journal-transfers.test.ts tests/integration/journal-read.test.ts tests/integration/journal-tags.test.ts tests/integration/journal-budget.test.ts"
```

Expected: PASS (нові тести; `journal-read`, `journal-tags` без змін, бо без `toDate` день руху дорівнює дню платежу; `journal-budget` без змін: у його сценарії немає переказів, тож запит `arrivalsQuery` нічого не читає, а `aggregates` рахує лише суми), `tsc` чисто.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add lib/server/journal/read.ts lib/domain/journal/balance.ts tests/unit/domain/journal/arrival.test.ts tests/integration/journal-transfers.test.ts && git commit -m "feat(transfers): the journal's balance after a row counts the money in on its arrival day

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Чиста логіка пропозицій і вибору `lib/domain/transfers/`

**Files:**
- Create: `lib/domain/transfers/types.ts`, `lib/domain/transfers/version.ts`, `lib/domain/transfers/pairs.ts`, `lib/domain/transfers/input.ts`, `lib/domain/transfers/dismissed.ts`, `lib/domain/transfers/selection.ts`
- Test: `tests/unit/domain/transfers/pairs.test.ts`, `tests/unit/domain/transfers/input.test.ts`, `tests/unit/domain/transfers/dismissed.test.ts`, `tests/unit/domain/transfers/selection.test.ts` (створити)

- [ ] **Step 1: Write the failing tests**

Створити `tests/unit/domain/transfers/pairs.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { addDays } from '@/lib/domain/ledger/days'
import { findTransferPairs, parseCandidate } from '@/lib/domain/transfers/pairs'
import type { Candidate } from '@/lib/domain/transfers/types'
import { encodeVersion, parseVersion } from '@/lib/domain/transfers/version'

let n = 0
/** A bank operation as the suggestions read sees it. */
function cand(type: 'income' | 'expense', accountId: string, amountMinor: number, paymentDate: string, extra: Partial<Candidate> = {}): Candidate {
  n++
  return {
    id: `bk_${String(n).padStart(32, '0')}`, version: `1790000000.${String(n).padStart(9, '0')}`, type, status: 'actual',
    isRecurring: false, accountId, amountMinor, currency: 'PLN', paymentDate,
    bank: { accountRef: `ba-${accountId}`, counterpartyName: 'Własne', remittance: `Przelew ${n}` }, ...extra,
  }
}

describe('parseCandidate', () => {
  it('reads the selected fields of a v2 bank operation and its version', () => {
    const data = {
      schemaVersion: 2, type: 'expense', status: 'actual', isRecurring: false, accountId: 'mil', amountMinor: 500, currency: 'PLN',
      paymentDate: '2026-10-20', source: 'bank', bank: { accountRef: 'ba1', remittance: 'Przelew' },
    }
    expect(parseCandidate('bk_1', data, '1.000000002')).toEqual({
      id: 'bk_1', version: '1.000000002', type: 'expense', status: 'actual', isRecurring: false, accountId: 'mil', amountMinor: 500,
      currency: 'PLN', paymentDate: '2026-10-20', bank: { accountRef: 'ba1', remittance: 'Przelew' },
    })
    expect(parseCandidate('m1', { ...data, source: undefined }, '1.000000002')?.bank).toBeUndefined()
  })

  it('a document of another schema or with a broken field is no candidate', () => {
    const data = { schemaVersion: 2, type: 'expense', status: 'actual', isRecurring: false, accountId: 'mil', amountMinor: 500, currency: 'PLN', paymentDate: '2026-10-20' }
    expect(parseCandidate('x', { ...data, schemaVersion: 1 }, '1.000000000')).toBeNull()
    expect(parseCandidate('x', { ...data, amountMinor: -5 }, '1.000000000')).toBeNull()
    expect(parseCandidate('x', { ...data, paymentDate: '20.10.2026' }, '1.000000000')).toBeNull()
    expect(parseCandidate('x', { ...data, type: 'gift' }, '1.000000000')).toBeNull()
  })
})

describe('findTransferPairs', () => {
  it('pairs a bank expense and a bank income of two accounts: same amount and currency, at most 3 days apart', () => {
    const out = cand('expense', 'mil', 100_000, '2026-10-12')
    const inc = cand('income', 'mono', 100_000, '2026-10-15')
    expect(findTransferPairs([out, inc])).toEqual({
      pairs: [{
        from: { id: out.id, version: out.version, accountId: 'mil', amountMinor: 100_000, currency: 'PLN', paymentDate: '2026-10-12', counterpartyName: 'Własne', remittance: out.bank?.remittance },
        to: { id: inc.id, version: inc.version, accountId: 'mono', amountMinor: 100_000, currency: 'PLN', paymentDate: '2026-10-15', counterpartyName: 'Własne', remittance: inc.bank?.remittance },
      }],
      total: 1,
      ambiguous: 0,
    })
  })

  it.each([
    ['4 days apart', cand('income', 'mono', 100_000, '2026-10-16')],
    ['the same account', cand('income', 'mil', 100_000, '2026-10-12')],
    ['another currency', cand('income', 'eur', 100_000, '2026-10-12', { currency: 'EUR' })],
    ['another amount', cand('income', 'mono', 99_999, '2026-10-12')],
    ['a manual income', cand('income', 'mono', 100_000, '2026-10-12', { bank: undefined })],
    ['a planned income', cand('income', 'mono', 100_000, '2026-10-12', { status: 'planned' })],
    ['a recurring income', cand('income', 'mono', 100_000, '2026-10-12', { isRecurring: true })],
    ['a transfer', cand('income', 'mono', 100_000, '2026-10-12', { type: 'transfer' })],
  ])('offers nothing for %s', (_name, other) => {
    expect(findTransferPairs([cand('expense', 'mil', 100_000, '2026-10-12'), other]).pairs).toEqual([])
  })

  it('a side with two candidates is not offered and counts as ambiguous', () => {
    const out = cand('expense', 'mil', 70_000, '2026-10-20')
    const a = cand('income', 'mono', 70_000, '2026-10-20')
    const b = cand('income', 'cash', 70_000, '2026-10-21')
    expect(findTransferPairs([out, a, b])).toEqual({ pairs: [], total: 0, ambiguous: 1 })
    const out2 = cand('expense', 'cash', 70_000, '2026-10-19')
    // Two expenses for one income: neither the expense with two incomes nor the income with two expenses is offered.
    expect(findTransferPairs([out, out2, a])).toEqual({ pairs: [], total: 0, ambiguous: 1 })
  })

  it('offers the newest pairs first, at most 50, and says how many there are', () => {
    const cands: Candidate[] = []
    for (let i = 0; i < 60; i++) {
      const day = addDays('2026-10-26', -i)
      cands.push(cand('expense', 'mil', 1_000 + i, day), cand('income', 'mono', 1_000 + i, day))
    }
    const { pairs, total } = findTransferPairs(cands)
    expect(total).toBe(60)
    expect(pairs).toHaveLength(50)
    expect(pairs[0].from.paymentDate).toBe('2026-10-26')
    expect(pairs[49].from.paymentDate).toBe(addDays('2026-10-26', -49))
  })
})

describe('versions', () => {
  it('round-trip seconds and nanoseconds; anything else is no version', () => {
    expect(encodeVersion({ seconds: 1790000000, nanoseconds: 5 })).toBe('1790000000.000000005')
    expect(parseVersion('1790000000.000000005')).toEqual({ seconds: 1790000000, nanoseconds: 5 })
    for (const bad of ['1790000000', '1790000000.5', 'x.000000005', '', 5, null]) expect(parseVersion(bad)).toBeNull()
  })
})
```

Створити `tests/unit/domain/transfers/input.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransferRequest } from '@/lib/domain/transfers/input'

const V = '1790000000.000000001'

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : 'other'
  }
  return 'ok'
}

describe('parseTransferRequest', () => {
  it('reads suggested pairs with the versions the person saw, a merge and a conversion', () => {
    expect(parseTransferRequest({ pairs: [{ fromId: 'bk_a1', toId: 'bk_b1', versions: [V, V] }] })).toEqual({
      kind: 'pairs',
      pairs: [{ ids: ['bk_a1', 'bk_b1'], versions: [V, V] }],
    })
    expect(parseTransferRequest({ merge: ['bk_a1', 'bk_b1'] })).toEqual({ kind: 'merge', ids: ['bk_a1', 'bk_b1'] })
    expect(parseTransferRequest({ convert: { ids: ['bk_a1', 'bk_a2'], toAccountId: 'cash' } })).toEqual({ kind: 'convert', ids: ['bk_a1', 'bk_a2'], toAccountId: 'cash' })
  })

  it.each<[string, unknown, string]>([
    ['an empty body', {}, 'invalid_input:body'],
    ['two kinds at once', { merge: ['a', 'b'], convert: { ids: ['a'], toAccountId: 'c' } }, 'invalid_input:body'],
    ['an unknown key', { split: ['a'] }, 'invalid_input:split'],
    ['no pairs', { pairs: [] }, 'invalid_input:pairs'],
    ['51 pairs', { pairs: Array.from({ length: 51 }, (_, i) => ({ fromId: `a${i}`, toId: `b${i}`, versions: [V, V] })) }, 'invalid_input:pairs'],
    ['a pair of one operation', { pairs: [{ fromId: 'a', toId: 'a', versions: [V, V] }] }, 'invalid_input:pairs.0'],
    ['an id that is no document id', { pairs: [{ fromId: 'a/b', toId: 'c', versions: [V, V] }] }, 'invalid_input:pairs.0'],
    ['a broken version', { pairs: [{ fromId: 'a', toId: 'b', versions: [V, '1'] }] }, 'invalid_input:pairs.0.versions'],
    ['an unknown key in a pair', { pairs: [{ fromId: 'a', toId: 'b', versions: [V, V], note: 'x' }] }, 'invalid_input:pairs.0.note'],
    ['one operation in two pairs', { pairs: [{ fromId: 'a', toId: 'b', versions: [V, V] }, { fromId: 'a', toId: 'c', versions: [V, V] }] }, 'invalid_input:pairs'],
    ['a merge of three', { merge: ['a', 'b', 'c'] }, 'invalid_input:merge'],
    ['a merge of one twice', { merge: ['a', 'a'] }, 'invalid_input:merge'],
    ['a conversion of none', { convert: { ids: [], toAccountId: 'cash' } }, 'invalid_input:convert.ids'],
    ['a conversion of 26', { convert: { ids: Array.from({ length: 26 }, (_, i) => `a${i}`), toAccountId: 'cash' } }, 'invalid_input:convert.ids'],
    ['a conversion without a target', { convert: { ids: ['a'] } }, 'invalid_input:convert.toAccountId'],
    ['a body that is a list', [], 'invalid_input:body'],
  ])('refuses %s', (_name, body, expected) => {
    expect(code(() => parseTransferRequest(body))).toBe(expected)
  })
})
```

Створити `tests/unit/domain/transfers/dismissed.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DISMISSED_PREFIX, MAX_DISMISSED, pairKeyOf, readDismissed, withDismissed, writeDismissed, type KeyValueStorage } from '@/lib/domain/transfers/dismissed'

function memory(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}
const broken: KeyValueStorage = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  },
}

describe('the pairs turned down in this browser', () => {
  it('are kept per company', () => {
    const storage = memory()
    expect(writeDismissed(storage, 'org1', [pairKeyOf('a', 'b')])).toBe(true)
    expect(readDismissed(storage, 'org1')).toEqual(['a|b'])
    expect(readDismissed(storage, 'org2')).toEqual([])
    expect(storage.data.has(`${DISMISSED_PREFIX}org1`)).toBe(true)
  })

  it('missing, blocked or foreign storage reads as nothing and a write says it failed', () => {
    const storage = memory()
    storage.data.set(`${DISMISSED_PREFIX}org1`, '{"not":"a list"}')
    expect(readDismissed(storage, 'org1')).toEqual([])
    storage.data.set(`${DISMISSED_PREFIX}org1`, '[1, "a|b"]')
    expect(readDismissed(storage, 'org1')).toEqual(['a|b'])
    expect(readDismissed(broken, 'org1')).toEqual([])
    expect(readDismissed(null, 'org1')).toEqual([])
    expect(writeDismissed(broken, 'org1', ['a|b'])).toBe(false)
    expect(writeDismissed(null, 'org1', ['a|b'])).toBe(false)
  })

  it('adds each key once, the newest last, and forgets the oldest beyond the limit', () => {
    expect(withDismissed(['a|b', 'c|d'], ['a|b', 'e|f', 'e|f'])).toEqual(['c|d', 'a|b', 'e|f'])
    const many = Array.from({ length: MAX_DISMISSED }, (_, i) => `k${i}|x`)
    const next = withDismissed(many, ['new|x'])
    expect(next).toHaveLength(MAX_DISMISSED)
    expect(next[0]).toBe('k1|x')
    expect(next[MAX_DISMISSED - 1]).toBe('new|x')
  })
})
```

Створити `tests/unit/domain/transfers/selection.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { convertSourceOf, mergePairOf } from '@/lib/domain/transfers/selection'

let n = 0
function bankOp(type: 'income' | 'expense', accountId: string, amountMinor: number, paymentDate: string, extra: Partial<LedgerTransaction> = {}): LedgerTransaction {
  n++
  return {
    id: `bk_${String(n).padStart(32, '0')}`, type, status: 'actual', accountId, amountMinor, currency: 'PLN', paymentDate,
    accrual: { mode: 'date', date: paymentDate }, isRecurring: false, tags: [], fileUrls: [], bank: { accountRef: `ba-${accountId}` }, ...extra,
  }
}

describe('convertSourceOf', () => {
  it('is the account when every selected row is a bank operation of that one account, either side', () => {
    expect(convertSourceOf([bankOp('expense', 'mil', 1, '2026-10-20'), bankOp('income', 'mil', 2, '2026-10-21')])).toEqual({ accountId: 'mil', currency: 'PLN' })
  })

  it('is null for nothing, two accounts or a row that is not a bank side', () => {
    expect(convertSourceOf([])).toBeNull()
    expect(convertSourceOf([bankOp('expense', 'mil', 1, '2026-10-20'), bankOp('expense', 'mono', 1, '2026-10-20')])).toBeNull()
    expect(convertSourceOf([bankOp('expense', 'mil', 1, '2026-10-20'), bankOp('expense', 'mil', 1, '2026-10-20', { bank: undefined })])).toBeNull()
  })
})

describe('mergePairOf', () => {
  it('is the expense and the income in that order, whatever order they were selected in', () => {
    const out = bankOp('expense', 'mil', 100, '2026-10-20')
    const inc = bankOp('income', 'mono', 100, '2026-10-22')
    expect(mergePairOf([inc, out])).toEqual([out, inc])
    expect(mergePairOf([out, inc])).toEqual([out, inc])
  })

  it('is null for anything the ledger would refuse', () => {
    const out = bankOp('expense', 'mil', 100, '2026-10-20')
    expect(mergePairOf([out])).toBeNull()
    expect(mergePairOf([out, bankOp('income', 'mil', 100, '2026-10-20')])).toBeNull()
    expect(mergePairOf([out, bankOp('income', 'mono', 99, '2026-10-20')])).toBeNull()
    expect(mergePairOf([out, bankOp('income', 'mono', 100, '2026-10-28')])).toBeNull()
    expect(mergePairOf([out, bankOp('expense', 'mono', 100, '2026-10-20')])).toBeNull()
    expect(mergePairOf([out, bankOp('income', 'mono', 100, '2026-10-20'), bankOp('income', 'cash', 100, '2026-10-20')])).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/transfers`
Expected: FAIL (`@/lib/domain/transfers/*` не існують).

- [ ] **Step 3: Implement**

Створити `lib/domain/transfers/types.ts`:

```ts
import type { BankInfo, LedgerTransaction, TxStatus, TxType } from '@/lib/domain/ledger/types'

/** How far back the suggestions look (S10b): the payment days of the last 90 days. */
export const SUGGEST_DAYS = 90
/** Operations one suggestions read takes at most, newest first; beyond it the answer says `truncated`. */
export const SUGGEST_SCAN = 2000
/** Pairs one answer offers at most, newest first. */
export const MAX_SUGGESTIONS = 50
/** The two sides of a suggested pair are at most this many days apart (a manual merge allows MAX_ARRIVAL_DAYS). */
export const SUGGEST_MAX_DAYS = 3
/** Operations one «Зробити переказом» request converts at most; the browser sends a larger selection in several. */
export const MAX_CONVERT_IDS = 25
/** The largest JSON body of `POST /transfers`. */
export const TRANSFER_BODY_MAX_BYTES = 64 * 1024

/** One operation as the suggestions read sees it: only the fields it selects, and the document's version. */
export interface Candidate {
  id: string
  version: string
  type: TxType
  status: TxStatus
  isRecurring: boolean
  accountId: string
  amountMinor: number
  currency: string
  paymentDate: string
  bank?: BankInfo
}

/** One side of a suggested pair: what the dialog shows, and the version the confirmation sends back. */
export interface SuggestionSide {
  id: string
  version: string
  accountId: string
  amountMinor: number
  currency: string
  paymentDate: string
  counterpartyName?: string
  remittance?: string
}

/** A suggested own transfer: the bank expense (`from`) and the bank income (`to`). */
export interface TransferSuggestion {
  from: SuggestionSide
  to: SuggestionSide
}

export interface SuggestionsResult {
  /** At most MAX_SUGGESTIONS, newest first. */
  pairs: TransferSuggestion[]
  /** Unambiguous pairs found, before the cap. */
  total: number
  /** Bank sides with more than one candidate: not offered, left to the person. */
  ambiguous: number
  /** The read stopped at SUGGEST_SCAN operations: older ones were not looked at. */
  truncated: boolean
}

/** A parsed body of `POST /transfers`. */
export type TransferRequest =
  | { kind: 'pairs'; pairs: { ids: [string, string]; versions: [string, string] }[] }
  | { kind: 'merge'; ids: [string, string] }
  | { kind: 'convert'; ids: string[]; toAccountId: string }

/** The result of one pair or one operation of a request. */
export type TransferOutcome =
  | { ids: string[]; ok: true; id: string; deletedId: string | null; droppedTags: number; before: LedgerTransaction[] }
  | { ids: string[]; ok: false; code: string }

export type MadeOutcome = Extract<TransferOutcome, { ok: true }>
export type FailedOutcome = Extract<TransferOutcome, { ok: false }>
```

Створити `lib/domain/transfers/version.ts`:

```ts
/** A document version (Firestore `updateTime`) in parts. A Firestore Timestamp has these fields. */
export interface VersionParts {
  seconds: number
  nanoseconds: number
}

const VERSION = /^(\d{1,12})\.(\d{9})$/

/** The version as the browser carries it: `<seconds>.<9 digits of nanoseconds>`. */
export function encodeVersion(v: VersionParts): string {
  return `${v.seconds}.${String(v.nanoseconds).padStart(9, '0')}`
}

/** The parts of an encoded version, or null when it is not one. */
export function parseVersion(s: unknown): VersionParts | null {
  if (typeof s !== 'string') return null
  const m = VERSION.exec(s)
  return m ? { seconds: Number(m[1]), nanoseconds: Number(m[2]) } : null
}
```

Створити `lib/domain/transfers/pairs.ts`:

```ts
import { daysApart, isDay } from '@/lib/domain/ledger/days'
import { SCHEMA_VERSION, parseBankInfo } from '@/lib/domain/ledger/doc'
import { isMinor } from '@/lib/domain/ledger/money'
import { bankSideOf } from '@/lib/domain/ledger/transfer'
import { TX_STATUSES, TX_TYPES, type TxStatus, type TxType } from '@/lib/domain/ledger/types'
import { MAX_SUGGESTIONS, SUGGEST_MAX_DAYS, type Candidate, type SuggestionSide, type SuggestionsResult, type TransferSuggestion } from './types'

/** The fields the suggestions read selects (Firestore bills the document anyway; the answer stays small). */
export const CANDIDATE_FIELDS = ['schemaVersion', 'type', 'status', 'isRecurring', 'accountId', 'amountMinor', 'currency', 'paymentDate', 'source', 'bank'] as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A selected operation document as a candidate, or null when it is not a readable v2 operation. */
export function parseCandidate(id: string, data: unknown, version: string): Candidate | null {
  if (!isRecord(data) || data.schemaVersion !== SCHEMA_VERSION) return null
  const { type, status, isRecurring, accountId, amountMinor, currency, paymentDate } = data
  if (!(TX_TYPES as readonly unknown[]).includes(type) || !(TX_STATUSES as readonly unknown[]).includes(status)) return null
  if (typeof isRecurring !== 'boolean' || typeof accountId !== 'string' || typeof currency !== 'string') return null
  if (!isMinor(amountMinor) || amountMinor <= 0 || !isDay(paymentDate)) return null
  const c: Candidate = { id, version, type: type as TxType, status: status as TxStatus, isRecurring, accountId, amountMinor, currency, paymentDate }
  if (data.source === 'bank') {
    const bank = parseBankInfo(data.bank)
    if (bank) c.bank = bank
  }
  return c
}

function sideOf(c: Candidate): SuggestionSide {
  const side: SuggestionSide = { id: c.id, version: c.version, accountId: c.accountId, amountMinor: c.amountMinor, currency: c.currency, paymentDate: c.paymentDate }
  if (c.bank?.counterpartyName !== undefined) side.counterpartyName = c.bank.counterpartyName
  if (c.bank?.remittance !== undefined) side.remittance = c.bank.remittance
  return side
}

const later = (p: TransferSuggestion): string => (p.from.paymentDate > p.to.paymentDate ? p.from.paymentDate : p.to.paymentDate)
const desc = (a: string, b: string): number => (a > b ? -1 : a < b ? 1 : 0)

/**
 * The own transfers the journal suggests (S10b): a bank expense and a bank income (`bankSideOf`) of two different accounts,
 * the same amount in the same currency, at most SUGGEST_MAX_DAYS apart. A pair is offered only when each of its sides has
 * exactly one candidate; a side with several (two equal incomes the same week) counts as ambiguous and is left to the
 * person. Newest pairs first (by the later day of the two, then the expense id), at most `max`.
 */
export function findTransferPairs(cands: readonly Candidate[], max: number = MAX_SUGGESTIONS): Omit<SuggestionsResult, 'truncated'> {
  const outs: Candidate[] = []
  const incomes = new Map<string, Candidate[]>()
  for (const c of cands) {
    const side = bankSideOf(c)
    if (side === 'out') outs.push(c)
    else if (side === 'in') {
      const key = `${c.currency}|${c.amountMinor}`
      incomes.set(key, [...(incomes.get(key) ?? []), c])
    }
  }
  const matchesOf = new Map<string, Candidate[]>()
  const outsPerIncome = new Map<string, number>()
  for (const o of outs) {
    const found = (incomes.get(`${o.currency}|${o.amountMinor}`) ?? []).filter(
      (i) => i.accountId !== o.accountId && daysApart(i.paymentDate, o.paymentDate) <= SUGGEST_MAX_DAYS,
    )
    matchesOf.set(o.id, found)
    for (const i of found) outsPerIncome.set(i.id, (outsPerIncome.get(i.id) ?? 0) + 1)
  }
  const pairs: TransferSuggestion[] = []
  for (const o of outs) {
    const found = matchesOf.get(o.id) ?? []
    if (found.length === 1 && outsPerIncome.get(found[0].id) === 1) pairs.push({ from: sideOf(o), to: sideOf(found[0]) })
  }
  const ambiguous = [...matchesOf.values()].filter((f) => f.length > 1).length + [...outsPerIncome.values()].filter((count) => count > 1).length
  pairs.sort((a, b) => desc(later(a), later(b)) || desc(a.from.id, b.from.id))
  return { pairs: pairs.slice(0, max), total: pairs.length, ambiguous }
}
```

Створити `lib/domain/transfers/input.ts`:

```ts
import { asRecord, bad, isId, onlyKeys } from '@/lib/domain/ledger/guards'
import { MAX_CONVERT_IDS, MAX_SUGGESTIONS, type TransferRequest } from './types'
import { parseVersion } from './version'

/** `min`..`max` safe document ids, none twice. */
function distinctIds(v: unknown, field: string, min: number, max: number): string[] {
  if (!Array.isArray(v) || v.length < min || v.length > max) bad(field)
  if (!v.every((id) => isId(id)) || new Set(v).size !== v.length) bad(field)
  return [...(v as string[])]
}

/**
 * A body of `POST /transfers` (S10b): exactly one of `pairs` (suggested pairs with the versions the person saw), `merge`
 * (two operations in any order) and `convert` (operations of one bank account and the account of the other side).
 * Anything else, an unusable id included, is `invalid_input` with the field.
 */
export function parseTransferRequest(body: unknown): TransferRequest {
  const r = asRecord(body)
  onlyKeys(r, ['pairs', 'merge', 'convert'])
  if (Object.keys(r).length !== 1) bad('body')
  if (r.pairs !== undefined) {
    if (!Array.isArray(r.pairs) || r.pairs.length === 0 || r.pairs.length > MAX_SUGGESTIONS) bad('pairs')
    const pairs = r.pairs.map((raw: unknown, i: number) => {
      const p = asRecord(raw, `pairs.${i}`)
      onlyKeys(p, ['fromId', 'toId', 'versions'], `pairs.${i}.`)
      const [fromId, toId] = distinctIds([p.fromId, p.toId], `pairs.${i}`, 2, 2)
      const versions = p.versions
      if (!Array.isArray(versions) || versions.length !== 2 || !versions.every((v) => parseVersion(v) !== null)) bad(`pairs.${i}.versions`)
      return { ids: [fromId, toId] as [string, string], versions: [versions[0], versions[1]] as [string, string] }
    })
    // One operation goes into one transfer: an id in two pairs is refused.
    distinctIds(pairs.flatMap((p) => p.ids), 'pairs', 2, 2 * MAX_SUGGESTIONS)
    return { kind: 'pairs', pairs }
  }
  if (r.merge !== undefined) {
    const [a, b] = distinctIds(r.merge, 'merge', 2, 2)
    return { kind: 'merge', ids: [a, b] }
  }
  const c = asRecord(r.convert, 'convert')
  onlyKeys(c, ['ids', 'toAccountId'], 'convert.')
  const ids = distinctIds(c.ids, 'convert.ids', 1, MAX_CONVERT_IDS)
  if (!isId(c.toAccountId)) bad('convert.toAccountId')
  return { kind: 'convert', ids, toAccountId: c.toAccountId }
}
```

Створити `lib/domain/transfers/dismissed.ts`:

```ts
import type { TransferSuggestion } from './types'

/** Where this browser keeps the suggested pairs the person turned down (S10b), per company. Never sent to the server. */
export const DISMISSED_PREFIX = 'finflow:transfer-dismissed:'
/** The newest turned-down pairs kept; older ones are forgotten (and may be suggested again). */
export const MAX_DISMISSED = 500

/** The part of `Storage` the list needs (`window.localStorage` fits). */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>

export const pairKeyOf = (fromId: string, toId: string): string => `${fromId}|${toId}`
export const pairKey = (s: TransferSuggestion): string => pairKeyOf(s.from.id, s.to.id)

/** The pairs turned down in this browser; [] when storage is missing, blocked, throws or holds something else. */
export function readDismissed(storage: KeyValueStorage | null, orgId: string): string[] {
  if (!storage) return []
  try {
    const parsed: unknown = JSON.parse(storage.getItem(`${DISMISSED_PREFIX}${orgId}`) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

/** Keeps `keys` (the newest MAX_DISMISSED). False when storage is missing or refuses: the list then lives in memory only. */
export function writeDismissed(storage: KeyValueStorage | null, orgId: string, keys: readonly string[]): boolean {
  if (!storage) return false
  try {
    storage.setItem(`${DISMISSED_PREFIX}${orgId}`, JSON.stringify(keys.slice(-MAX_DISMISSED)))
    return true
  } catch {
    return false
  }
}

/** `current` plus `added`, each key once, the newest last, at most MAX_DISMISSED. */
export function withDismissed(current: readonly string[], added: readonly string[]): string[] {
  const fresh = added.filter((k, i) => added.indexOf(k) === i)
  return [...current.filter((k) => !fresh.includes(k)), ...fresh].slice(-MAX_DISMISSED)
}
```

Створити `lib/domain/transfers/selection.ts`:

```ts
import { LedgerError } from '@/lib/domain/ledger/errors'
import { bankSideOf, mergeToTransfer } from '@/lib/domain/ledger/transfer'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'

/**
 * The bank account a «Зробити переказом» selection comes from (S10b): every selected row is a bank income or expense of
 * that one account. Null otherwise (the bar then does not offer it).
 */
export function convertSourceOf(rows: readonly LedgerTransaction[]): { accountId: string; currency: string } | null {
  if (rows.length === 0 || rows.some((r) => bankSideOf(r) === null)) return null
  const { accountId, currency } = rows[0]
  return rows.every((r) => r.accountId === accountId) ? { accountId, currency } : null
}

/**
 * The two rows of an «Об’єднати в переказ» selection, the expense first: exactly the pair the ledger's own rule accepts
 * (`mergeToTransfer`), in whichever order they were selected. Null otherwise.
 */
export function mergePairOf(rows: readonly LedgerTransaction[]): [LedgerTransaction, LedgerTransaction] | null {
  if (rows.length !== 2) return null
  for (const [out, inc] of [[rows[0], rows[1]], [rows[1], rows[0]]] as const) {
    try {
      mergeToTransfer(out, inc)
      return [out, inc]
    } catch (e) {
      if (!(e instanceof LedgerError)) throw e
    }
  }
  return null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/transfers && npm run typecheck && npm run lint`
Expected: PASS (4 файли), `tsc` чисто, `lint` без нових попереджень.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add lib/domain/transfers/types.ts lib/domain/transfers/version.ts lib/domain/transfers/pairs.ts lib/domain/transfers/input.ts lib/domain/transfers/dismissed.ts lib/domain/transfers/selection.ts tests/unit/domain/transfers/pairs.test.ts tests/unit/domain/transfers/input.test.ts tests/unit/domain/transfers/dismissed.test.ts tests/unit/domain/transfers/selection.test.ts && git commit -m "feat(transfers): pure suggestion finder, request parsing and journal selection rules

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Сервер пропозицій і дій, маршрути `transfers/**`

**Files:**
- Create: `lib/server/transfers/read.ts`, `lib/server/transfers/run.ts`, `lib/server/transfers/index.ts`, `app/api/orgs/[orgId]/transfers/route.ts`, `app/api/orgs/[orgId]/transfers/suggestions/route.ts`, `app/api/orgs/[orgId]/transfers/[txId]/split/route.ts`
- Modify: `lib/server/ledger/http.ts`, `lib/server/journal/bulk.ts`
- Test: `tests/unit/api/transfers/routes.test.ts`, `tests/unit/server/transfers/run.test.ts`, `tests/integration/transfers-read.test.ts` (створити)

- [ ] **Step 1: Write the failing tests**

Створити `tests/unit/server/transfers/run.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { LedgerError } from '@/lib/domain/ledger/errors'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import type { MadeTransfer, TransferJob } from '@/lib/server/ledger/transfer'
import { runTransfers } from '@/lib/server/transfers/run'

const tx = (id: string) => ({ id }) as LedgerTransaction
const made = (id: string, deletedId: string | null): MadeTransfer => ({ transaction: tx(id), deletedId, droppedTags: 1, before: [tx(id)] })

afterEach(() => vi.restoreAllMocks())

describe('runTransfers', () => {
  it('runs every suggested pair with its versions as timestamps, one by one, and answers a result for each', async () => {
    const jobs: TransferJob[] = []
    const ledger = {
      makeTransfer: vi.fn(async (_org: string, _uid: string, job: TransferJob) => {
        jobs.push(job)
        if (job.mode === 'pair' && job.ids[0] === 'a2') throw new LedgerError('conflict')
        return made(job.mode === 'pair' ? job.ids[0] : job.id, job.mode === 'pair' ? job.ids[1] : null)
      }),
    }
    const out = await runTransfers(ledger, 'org1', 'u1', {
      kind: 'pairs',
      pairs: [
        { ids: ['a1', 'b1'], versions: ['1790000000.000000001', '1790000000.000000002'] },
        { ids: ['a2', 'b2'], versions: ['1790000001.000000000', '1790000001.000000000'] },
      ],
    })
    expect(out).toEqual([
      { ids: ['a1', 'b1'], ok: true, id: 'a1', deletedId: 'b1', droppedTags: 1, before: [tx('a1')] },
      { ids: ['a2', 'b2'], ok: false, code: 'conflict' },
    ])
    expect(jobs[0]).toEqual({ mode: 'pair', ids: ['a1', 'b1'], versions: [new Timestamp(1790000000, 1), new Timestamp(1790000000, 2)] })
    expect(ledger.makeTransfer).toHaveBeenCalledTimes(2)
  })

  it('a merge is one pair without versions; a conversion is one job per operation', async () => {
    const jobs: TransferJob[] = []
    const ledger = {
      makeTransfer: vi.fn(async (_org: string, _uid: string, job: TransferJob) => {
        jobs.push(job)
        return made(job.mode === 'convert' ? job.id : job.ids[0], null)
      }),
    }
    await runTransfers(ledger, 'org1', 'u1', { kind: 'merge', ids: ['x', 'y'] })
    await runTransfers(ledger, 'org1', 'u1', { kind: 'convert', ids: ['c1', 'c2'], toAccountId: 'cash' })
    expect(jobs).toEqual([
      { mode: 'pair', ids: ['x', 'y'] },
      { mode: 'convert', id: 'c1', toAccountId: 'cash' },
      { mode: 'convert', id: 'c2', toAccountId: 'cash' },
    ])
  })

  it('an unexpected error is that result `unknown`, logged once, and the rest go on', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ledger = {
      makeTransfer: vi.fn(async (_org: string, _uid: string, job: TransferJob) => {
        if (job.mode === 'convert' && job.id === 'c1') throw new Error('socket hang up')
        return made(job.mode === 'convert' ? job.id : 'x', null)
      }),
    }
    const out = await runTransfers(ledger, 'org1', 'u1', { kind: 'convert', ids: ['c1', 'c2'], toAccountId: 'cash' })
    expect(out.map((o) => (o.ok ? 'ok' : o.code))).toEqual(['unknown', 'ok'])
    expect(log).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(log.mock.calls[0])).toContain('c1')
  })
})
```

Створити `tests/unit/api/transfers/routes.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { transfers } from '@/lib/server/transfers'
import { resetFakeAdmin } from '@/tests/unit/helpers/fake-admin'
import { POST as runRoute } from '@/app/api/orgs/[orgId]/transfers/route'
import { GET as suggestionsRoute } from '@/app/api/orgs/[orgId]/transfers/suggestions/route'
import { POST as splitRoute } from '@/app/api/orgs/[orgId]/transfers/[txId]/split/route'

vi.mock('@/lib/server/firebase-admin', async () => {
  const { fakeAdmin: admin } = await import('@/tests/unit/helpers/fake-admin')
  return { getAdmin: () => admin }
})
vi.mock('@/lib/server/transfers', () => ({
  transfers: { suggestions: vi.fn(), run: vi.fn(), split: vi.fn() },
}))

const V = '1790000000.000000001'

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

type Call = { name: string; mock: keyof typeof transfers; call: (token: string | null) => Promise<Response> }

const READ: Call = { name: 'GET /transfers/suggestions', mock: 'suggestions', call: (t) => suggestionsRoute(req('GET', '/api/orgs/org-acme/transfers/suggestions', undefined, t), ctx()) }
const WRITES: Call[] = [
  { name: 'POST /transfers', mock: 'run', call: (t) => runRoute(req('POST', '/api/orgs/org-acme/transfers', { merge: ['bk_a1', 'bk_b1'] }, t), ctx()) },
  { name: 'POST /transfers/{id}/split', mock: 'split', call: (t) => splitRoute(req('POST', '/api/orgs/org-acme/transfers/bk_a1/split', undefined, t), ctx({ txId: 'bk_a1' })) },
]

beforeEach(() => {
  resetFakeAdmin()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const fn of Object.values(transfers)) vi.mocked(fn).mockReset()
  vi.mocked(transfers.suggestions).mockResolvedValue({ pairs: [], total: 0, ambiguous: 0, truncated: false })
  vi.mocked(transfers.run).mockResolvedValue([])
  vi.mocked(transfers.split).mockResolvedValue({ restored: [] })
})

describe('authorization of every transfer route', () => {
  describe.each([READ, ...WRITES])('$name', ({ mock, call }) => {
    it('answers 401 without a session', async () => {
      expect((await call(null)).status).toBe(401)
      expect(transfers[mock]).not.toHaveBeenCalled()
    })

    it('answers 403 to a user who is not a member', async () => {
      expect((await call('token-mallory')).status).toBe(403)
      expect(transfers[mock]).not.toHaveBeenCalled()
    })
  })

  it.each(WRITES.map((r) => [r.name, r] as const))('%s answers 403 to a viewer', async (_name, { mock, call }) => {
    expect((await call('token-dave')).status).toBe(403)
    expect(transfers[mock]).not.toHaveBeenCalled()
  })
})

describe('GET /transfers/suggestions', () => {
  it('lets a viewer read the suggestions, not cached', async () => {
    const result = { pairs: [], total: 3, ambiguous: 1, truncated: true }
    vi.mocked(transfers.suggestions).mockResolvedValue(result)
    const res = await suggestionsRoute(req('GET', '/api/orgs/org-acme/transfers/suggestions', undefined, 'token-dave'), ctx())
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual(result)
    expect(transfers.suggestions).toHaveBeenCalledWith('org-acme')
  })
})

describe('POST /transfers', () => {
  it.each([
    ['alice', 'user-alice'],
    ['carol', 'user-carol'],
  ])('runs the parsed request for %s and answers the results', async (name, uid) => {
    const results = [{ ids: ['bk_a1', 'bk_b1'], ok: false as const, code: 'not_eligible' }]
    vi.mocked(transfers.run).mockResolvedValue(results)
    const body = { pairs: [{ fromId: 'bk_a1', toId: 'bk_b1', versions: [V, V] }] }
    const res = await runRoute(req('POST', '/api/orgs/org-acme/transfers', body, `token-${name}`), ctx())
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ results })
    expect(transfers.run).toHaveBeenCalledWith('org-acme', uid, { kind: 'pairs', pairs: [{ ids: ['bk_a1', 'bk_b1'], versions: [V, V] }] })
  })

  it('answers 400 for an unusable body and does not run anything', async () => {
    for (const body of [{}, { merge: ['a/b', 'c'] }, { convert: { ids: [], toAccountId: 'cash' } }]) {
      const res = await runRoute(req('POST', '/api/orgs/org-acme/transfers', body), ctx())
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid_input' })
    }
    expect(transfers.run).not.toHaveBeenCalled()
  })

  it('answers 413 for a body over 64 KB', async () => {
    const res = await runRoute(req('POST', '/api/orgs/org-acme/transfers', JSON.stringify({ convert: { ids: ['a'], toAccountId: 'x'.repeat(70_000) } })), ctx())
    expect(res.status).toBe(413)
    expect(transfers.run).not.toHaveBeenCalled()
  })
})

describe('POST /transfers/{id}/split', () => {
  it('splits and answers the restored operations', async () => {
    const restored = [{ id: 'bk_a1' }, { id: 'bk_b1' }]
    vi.mocked(transfers.split).mockResolvedValue({ restored } as never)
    const res = await splitRoute(req('POST', '/api/orgs/org-acme/transfers/bk_a1/split', undefined, 'token-carol'), ctx({ txId: 'bk_a1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ restored })
    expect(transfers.split).toHaveBeenCalledWith('org-acme', 'user-carol', 'bk_a1')
  })

  it('answers 404 for an id that is not a safe document id, and maps the ledger refusals', async () => {
    expect((await splitRoute(req('POST', '/api/orgs/org-acme/transfers/a.b/split'), ctx({ txId: 'a.b' }))).status).toBe(404)
    vi.mocked(transfers.split).mockRejectedValue(new LedgerError('not_eligible'))
    const res = await splitRoute(req('POST', '/api/orgs/org-acme/transfers/bk_a1/split'), ctx({ txId: 'bk_a1' }))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'not_eligible' })
    vi.mocked(transfers.split).mockRejectedValue(new LedgerError('conflict'))
    expect((await splitRoute(req('POST', '/api/orgs/org-acme/transfers/bk_a1/split'), ctx({ txId: 'bk_a1' }))).status).toBe(409)
  })
})
```

Створити `tests/integration/transfers-read.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { makeTransfer, type TransferJob } from '@/lib/server/ledger/transfer'
import { createTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { readTransferSuggestions } from '@/lib/server/transfers/read'
import { runTransfers } from '@/lib/server/transfers/run'
import { ORG, UID, clearFirestore, makeDeps, seedAccount, seedOrg, testDb } from './helpers'
import { KEY, importBankOp } from './transfer-helpers'

const db = testDb()
const deps = makeDeps(db)
const ledger = { makeTransfer: (orgId: string, uid: string, job: TransferJob) => makeTransfer(deps, orgId, uid, job) }

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'mil', 'PLN', 500_000)
  await seedAccount(db, ORG, 'mono', 'PLN', 0)
  await seedAccount(db, ORG, 'cash', 'PLN', 0)
})

describe('readTransferSuggestions', () => {
  it('offers a bank pair of the last 90 days with the versions to confirm it, and leaves out manual and older operations', async () => {
    const out = await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 50_000, paymentDate: '2026-10-25' })
    const inc = await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mono', amountMinor: 50_000, paymentDate: '2026-10-26' })
    await createTransaction(deps, ORG, UID, parseTransactionInput({ type: 'income', accountId: 'cash', amountMinor: 50_000, paymentDate: '2026-10-25' }))
    // 2026-07-01 is before the 90 days that end on TODAY (2026-10-27).
    await importBankOp(db, deps, { key: KEY(3), type: 'expense', accountId: 'mil', amountMinor: 7_000, paymentDate: '2026-07-01' })
    await importBankOp(db, deps, { key: KEY(4), type: 'income', accountId: 'mono', amountMinor: 7_000, paymentDate: '2026-07-01' })

    const read = await readTransferSuggestions(deps, ORG)
    expect(read).toMatchObject({ total: 1, ambiguous: 0, truncated: false, scanned: 3, bankSides: 2 })
    expect(read.pairs).toEqual([
      {
        from: expect.objectContaining({ id: out.id, accountId: 'mil', amountMinor: 50_000, paymentDate: '2026-10-25', remittance: out.bank?.remittance }),
        to: expect.objectContaining({ id: inc.id, accountId: 'mono', paymentDate: '2026-10-26' }),
      },
    ])

    const [pair] = read.pairs
    const results = await runTransfers(ledger, ORG, UID, { kind: 'pairs', pairs: [{ ids: [pair.from.id, pair.to.id], versions: [pair.from.version, pair.to.version] }] })
    expect(results).toMatchObject([{ ok: true, id: out.id, deletedId: inc.id, droppedTags: 0 }])
    expect((await readTransferSuggestions(deps, ORG)).total).toBe(0)
  })

  it('a pair changed after the read is a conflict; the next read offers it with the new version', async () => {
    await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 50_000, paymentDate: '2026-10-25' })
    const inc = await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mono', amountMinor: 50_000, paymentDate: '2026-10-25' })
    const [stale] = (await readTransferSuggestions(deps, ORG)).pairs
    await updateTransaction(deps, ORG, UID, inc.id, { description: 'Zmieniony' })
    const request = (p: typeof stale) => ({ kind: 'pairs' as const, pairs: [{ ids: [p.from.id, p.to.id] as [string, string], versions: [p.from.version, p.to.version] as [string, string] }] })
    expect(await runTransfers(ledger, ORG, UID, request(stale))).toEqual([{ ids: [stale.from.id, stale.to.id], ok: false, code: 'conflict' }])
    const [fresh] = (await readTransferSuggestions(deps, ORG)).pairs
    expect(fresh.to.version).not.toBe(stale.to.version)
    expect((await runTransfers(ledger, ORG, UID, request(fresh)))[0].ok).toBe(true)
  })

  it('a side with two candidates is not offered and counts as ambiguous', async () => {
    await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 70_000, paymentDate: '2026-10-20' })
    await importBankOp(db, deps, { key: KEY(2), type: 'income', accountId: 'mono', amountMinor: 70_000, paymentDate: '2026-10-20' })
    await importBankOp(db, deps, { key: KEY(3), type: 'income', accountId: 'cash', amountMinor: 70_000, paymentDate: '2026-10-21' })
    expect(await readTransferSuggestions(deps, ORG)).toMatchObject({ pairs: [], total: 0, ambiguous: 1 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/server/transfers/run.test.ts tests/unit/api/transfers/routes.test.ts; export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts tests/integration/transfers-read.test.ts"
```

Expected: FAIL (`@/lib/server/transfers/*` і маршрути `transfers/**` не існують).

- [ ] **Step 3: Implement**

`lib/server/ledger/http.ts`: у кінець файлу додати:

```ts

/**
 * The short code of a refused write for a result per operation (bulk changes, transfers): a ledger or rate refusal (a 4xx,
 * or the 503 of an unavailable rate). Null for anything unexpected, which the caller logs and reports as `unknown`.
 */
export function refusalCode(e: unknown): string | null {
  const mapped = toHttpError(e)
  return mapped instanceof HttpError && (mapped.status < 500 || mapped.status === 503) ? mapped.message : null
}
```

`lib/server/journal/bulk.ts`:

1. Рядки `import { HttpError } from '@/lib/server/http-error'` і `import { toHttpError } from '@/lib/server/ledger/http'` замінити одним рядком `import { refusalCode } from '@/lib/server/ledger/http'`.
2. У `runBulk` блок

```ts
    } catch (e) {
      const mapped = toHttpError(e)
      if (mapped instanceof HttpError && (mapped.status < 500 || mapped.status === 503)) {
        // The short code is the error message (`new HttpError(status, code, extra?)`).
        out.push({ id, ok: false, code: mapped.message })
      } else {
        // No request body, tokens or patch in the log: the org, the operation and what went wrong.
        console.error('[journal.bulk] unexpected error', { orgId, txId: id, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) })
        out.push({ id, ok: false, code: 'unknown' })
      }
    }
```

замінити на:

```ts
    } catch (e) {
      const code = refusalCode(e)
      // No request body, tokens or patch in the log: the org, the operation and what went wrong.
      if (code === null) console.error('[journal.bulk] unexpected error', { orgId, txId: id, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) })
      out.push({ id, ok: false, code: code ?? 'unknown' })
    }
```

Створити `lib/server/transfers/read.ts`:

```ts
import { addDays } from '@/lib/domain/ledger/days'
import { bankSideOf } from '@/lib/domain/ledger/transfer'
import { CANDIDATE_FIELDS, findTransferPairs, parseCandidate } from '@/lib/domain/transfers/pairs'
import { SUGGEST_DAYS, SUGGEST_SCAN, type Candidate, type SuggestionsResult } from '@/lib/domain/transfers/types'
import { encodeVersion } from '@/lib/domain/transfers/version'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { transactionsCol } from '@/lib/server/ledger/paths'

export interface SuggestionsRead extends SuggestionsResult {
  /** Operations read (at most SUGGEST_SCAN). */
  scanned: number
  /** Of those, bank incomes and expenses that can be a side of a transfer. */
  bankSides: number
}

/**
 * The suggested own transfers of a company (S10b), computed on demand, nothing stored. One query: the operations whose
 * payment day is within the last SUGGEST_DAYS, newest first, at most SUGGEST_SCAN, only the fields the finder needs
 * (Firestore cannot pick the bank operations without an index of its own, so they are picked in memory). Each side carries
 * its document version, which a confirmation sends back.
 */
export async function readTransferSuggestions(deps: Pick<LedgerDeps, 'db' | 'today'>, orgId: string): Promise<SuggestionsRead> {
  const snap = await transactionsCol(deps.db, orgId)
    .where('paymentDate', '>=', addDays(deps.today(), -SUGGEST_DAYS))
    .orderBy('paymentDate', 'desc')
    .select(...CANDIDATE_FIELDS)
    .limit(SUGGEST_SCAN)
    .get()
  const cands: Candidate[] = []
  for (const d of snap.docs) {
    const c = parseCandidate(d.id, d.data(), encodeVersion(d.updateTime))
    if (c) cands.push(c)
  }
  return {
    ...findTransferPairs(cands),
    truncated: snap.size >= SUGGEST_SCAN,
    scanned: snap.size,
    bankSides: cands.filter((c) => bankSideOf(c) !== null).length,
  }
}
```

Створити `lib/server/transfers/run.ts`:

```ts
import { Timestamp } from 'firebase-admin/firestore'
import type { TransferOutcome, TransferRequest } from '@/lib/domain/transfers/types'
import { parseVersion } from '@/lib/domain/transfers/version'
import { refusalCode } from '@/lib/server/ledger/http'
import type { MadeTransfer, TransferJob } from '@/lib/server/ledger/transfer'

/** The ledger call a transfer request is made of (the production `ledger` object has it). */
export interface TransferLedger {
  makeTransfer(orgId: string, uid: string, job: TransferJob): Promise<MadeTransfer>
}

interface Planned {
  ids: string[]
  job: TransferJob
}

function timestampOf(version: string): Timestamp {
  const parts = parseVersion(version)
  // parseTransferRequest has checked every version of the request.
  if (parts === null) throw new Error('an unparsed version reached runTransfers')
  return new Timestamp(parts.seconds, parts.nanoseconds)
}

function plan(req: TransferRequest): Planned[] {
  switch (req.kind) {
    case 'pairs':
      return req.pairs.map((p): Planned => ({ ids: [...p.ids], job: { mode: 'pair', ids: p.ids, versions: [timestampOf(p.versions[0]), timestampOf(p.versions[1])] } }))
    case 'merge':
      return [{ ids: [...req.ids], job: { mode: 'pair', ids: req.ids } }]
    case 'convert':
      return req.ids.map((id): Planned => ({ ids: [id], job: { mode: 'convert', id, toAccountId: req.toAccountId } }))
  }
}

/**
 * Runs a transfer request one pair or one operation at a time, each its own Firestore transaction (S10b). A refusal is that
 * item's result and the rest go on; so is an unexpected error (`unknown`, logged once by ids, never with the body).
 */
export async function runTransfers(ledger: TransferLedger, orgId: string, uid: string, req: TransferRequest): Promise<TransferOutcome[]> {
  const out: TransferOutcome[] = []
  for (const { ids, job } of plan(req)) {
    try {
      const made = await ledger.makeTransfer(orgId, uid, job)
      out.push({ ids, ok: true, id: made.transaction.id, deletedId: made.deletedId, droppedTags: made.droppedTags, before: made.before })
    } catch (e) {
      const code = refusalCode(e)
      if (code === null) console.error('[transfers] unexpected error', { orgId, ids, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) })
      out.push({ ids, ok: false, code: code ?? 'unknown' })
    }
  }
  return out
}
```

Створити `lib/server/transfers/index.ts`:

```ts
import 'server-only'
import type { TransferRequest } from '@/lib/domain/transfers/types'
import { ledger, ledgerDeps } from '@/lib/server/ledger'
import { readTransferSuggestions } from './read'
import { runTransfers } from './run'

/** Own transfers (S10b) bound to the production Firestore, NBP rates and the Warsaw clock. */
export const transfers = {
  /** What the journal offers: the pairs, how many there are, the ambiguous sides, whether the read was cut. */
  suggestions: async (orgId: string) => {
    const { pairs, total, ambiguous, truncated } = await readTransferSuggestions(ledgerDeps(), orgId)
    return { pairs, total, ambiguous, truncated }
  },
  run: (orgId: string, uid: string, req: TransferRequest) => runTransfers(ledger, orgId, uid, req),
  split: (orgId: string, uid: string, txId: string) => ledger.splitTransfer(orgId, uid, txId),
}
```

Створити `app/api/orgs/[orgId]/transfers/suggestions/route.ts`:

```ts
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { toHttpError } from '@/lib/server/ledger/http'
import { transfers } from '@/lib/server/transfers'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string }> }

// GET /api/orgs/{orgId}/transfers/suggestions  (owner, accountant, viewer) -> { pairs, total, ambiguous, truncated }
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant', 'viewer'])
    const result = await transfers.suggestions(orgId)
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toHttpError(e))
  }
}
```

Створити `app/api/orgs/[orgId]/transfers/route.ts`:

```ts
import { parseTransferRequest } from '@/lib/domain/transfers/input'
import { TRANSFER_BODY_MAX_BYTES } from '@/lib/domain/transfers/types'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { toHttpError } from '@/lib/server/ledger/http'
import { readJsonBody } from '@/lib/server/request-body'
import { transfers } from '@/lib/server/transfers'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string }> }

// POST /api/orgs/{orgId}/transfers  (owner, accountant)
// { pairs: [{ fromId, toId, versions: [from, to] }] } | { merge: [a, b] } | { convert: { ids, toAccountId } }
// -> { results: [{ ids, ok: true, id, deletedId, droppedTags, before } | { ids, ok: false, code }] }
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    const request = parseTransferRequest(await readJsonBody(req, TRANSFER_BODY_MAX_BYTES))
    const results = await transfers.run(orgId, uid, request)
    return Response.json({ results }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toHttpError(e))
  }
}
```

Створити `app/api/orgs/[orgId]/transfers/[txId]/split/route.ts`:

```ts
import { isId } from '@/lib/domain/ledger/guards'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse, HttpError } from '@/lib/server/http-error'
import { toHttpError } from '@/lib/server/ledger/http'
import { transfers } from '@/lib/server/transfers'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string; txId: string }> }

// POST /api/orgs/{orgId}/transfers/{txId}/split  (owner, accountant) -> { restored }
// No body: the server reads the transfer itself and refuses with `conflict` if it changes before the write.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId, txId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    if (!isId(txId)) throw new HttpError(404, 'not_found')
    const { restored } = await transfers.split(orgId, uid, txId)
    return Response.json({ restored }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toHttpError(e))
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/server tests/unit/api/transfers tests/unit/server/route-auth-coverage.test.ts && npm run typecheck && npm run lint && npm run check:server-imports && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts tests/integration/transfers-read.test.ts tests/integration/journal-bulk.test.ts"
```

Expected: PASS (`route-auth-coverage` бачить `await requireUser` у кожному новому обробнику без правок списку; `journal-bulk` без змін: `refusalCode` дає ті самі коди й той самий один запис у журналі помилок), `tsc` чисто, `lint` без нових попереджень, `check:server-imports` OK.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add lib/server/ledger/http.ts lib/server/journal/bulk.ts lib/server/transfers/read.ts lib/server/transfers/run.ts lib/server/transfers/index.ts "app/api/orgs/[orgId]/transfers/route.ts" "app/api/orgs/[orgId]/transfers/suggestions/route.ts" "app/api/orgs/[orgId]/transfers/[txId]/split/route.ts" tests/unit/server/transfers/run.test.ts tests/unit/api/transfers/routes.test.ts tests/integration/transfers-read.test.ts && git commit -m "feat(transfers): suggestions read and transfer routes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Браузер: клієнт переказів і хук пропозицій

**Files:**
- Create: `lib/api/transfers-client.ts`, `lib/hooks/useTransferSuggestions.ts`
- Test: `tests/unit/api/transfers-client.test.ts` (створити)

- [ ] **Step 1: Write the failing test**

Створити `tests/unit/api/transfers-client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const notify = vi.fn()
vi.mock('@/lib/api/ledger-events', () => ({
  notifyLedgerChanged: () => notify(),
  withoutNotifications: async <T,>(fn: () => Promise<T>) => {
    try {
      return await fn()
    } finally {
      notify()
    }
  },
}))

import { confirmPairs, convertToTransfers, mergeIntoTransfer, splitTransfer, undoTransfers } from '@/lib/api/transfers-client'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import type { MadeOutcome, TransferSuggestion } from '@/lib/domain/transfers/types'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const side = (id: string, version: string) => ({ id, version, accountId: 'a', amountMinor: 1, currency: 'PLN', paymentDate: '2026-10-20' })
const pair: TransferSuggestion = { from: side('bk_a1', '1.000000001'), to: side('bk_b1', '1.000000002') }

beforeEach(() => notify.mockClear())
afterEach(() => vi.unstubAllGlobals())

describe('transfer calls', () => {
  it('confirms pairs with the versions the person saw, merges, splits, and reloads the journal after each', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ results: [{ ids: ['bk_a1', 'bk_b1'], ok: false, code: 'conflict' }] }))
      .mockResolvedValueOnce(json({ results: [{ ids: ['x', 'y'], ok: false, code: 'not_eligible' }] }))
      .mockResolvedValueOnce(json({ restored: [{ id: 'bk_a1' }] }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await confirmPairs('org 1', [pair])).toEqual([{ ids: ['bk_a1', 'bk_b1'], ok: false, code: 'conflict' }])
    expect(await mergeIntoTransfer('org 1', ['x', 'y'])).toEqual({ ids: ['x', 'y'], ok: false, code: 'not_eligible' })
    expect(await splitTransfer('org 1', 'bk_a1')).toEqual([{ id: 'bk_a1' }])
    expect(fetchMock.mock.calls.map((c) => [c[0], c[1]?.method])).toEqual([
      ['/api/orgs/org%201/transfers', 'POST'],
      ['/api/orgs/org%201/transfers', 'POST'],
      ['/api/orgs/org%201/transfers/bk_a1/split', 'POST'],
    ])
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ pairs: [{ fromId: 'bk_a1', toId: 'bk_b1', versions: ['1.000000001', '1.000000002'] }] })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ merge: ['x', 'y'] })
    expect(fetchMock.mock.calls[2][1].body).toBeUndefined()
    expect(notify).toHaveBeenCalledTimes(3)
  })

  it('converts in requests of 25; a failed request makes its ids and the rest unknown and stops', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `c${i}`)
    const ok = (chunk: string[]) => json({ results: chunk.map((id) => ({ ids: [id], ok: true, id, deletedId: null, droppedTags: 0, before: [] })) })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(ids.slice(0, 25)))
      .mockResolvedValueOnce(json({ error: 'internal' }, 500))
    vi.stubGlobal('fetch', fetchMock)
    const out = await convertToTransfers('org1', ids, 'cash')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ convert: { ids: ids.slice(0, 25), toAccountId: 'cash' } })
    expect(out).toHaveLength(60)
    expect(out.slice(0, 25).every((o) => o.ok)).toBe(true)
    expect(out.slice(25).every((o) => !o.ok && o.code === 'unknown')).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)
  })
})

describe('undoTransfers', () => {
  it('splits each transfer and writes its operations back as they were; a failure counts and the rest go on', async () => {
    const before = (id: string) => ({ id }) as LedgerTransaction
    const made = (id: string, prior: string[]): MadeOutcome => ({ ids: prior, ok: true, id, deletedId: null, droppedTags: 0, before: prior.map(before) })
    const calls: string[] = []
    const out = await undoTransfers('org1', [made('t1', ['t1', 'b1']), made('t2', ['t2']), made('t3', ['t3'])], {
      split: async (id) => {
        calls.push(`split:${id}`)
        if (id === 't2') throw new Error('conflict')
      },
      revert: async (tx) => {
        calls.push(`revert:${tx.id}`)
      },
    })
    expect(out).toEqual({ done: 2, failed: 1 })
    expect(calls).toEqual(['split:t1', 'revert:t1', 'revert:b1', 'split:t2', 'split:t3', 'revert:t3'])
    expect(notify).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/api/transfers-client.test.ts`
Expected: FAIL (`@/lib/api/transfers-client` не існує).

- [ ] **Step 3: Implement**

Створити `lib/api/transfers-client.ts`:

```ts
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { MAX_CONVERT_IDS, type MadeOutcome, type SuggestionsResult, type TransferOutcome, type TransferSuggestion } from '@/lib/domain/transfers/types'
import { toUiTransaction } from '@/lib/firebase/ledger-map'
import { apiCall, readApiError } from './ledger-client'
import { notifyLedgerChanged, withoutNotifications } from './ledger-events'
import { revertTransaction } from './transaction-undo'

const EVENT = 'finflow:transfers-changed'
const org = (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}`

/** Tells the journal's suggestions that transfers were made or split in this browser: they read again. */
export function notifyTransfersChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

export function onTransfersChanged(callback: () => void): () => void {
  window.addEventListener(EVENT, callback)
  return () => window.removeEventListener(EVENT, callback)
}

/** After a write: the journal reloads its rows and the suggestions read again. */
function changed(): void {
  notifyLedgerChanged()
  notifyTransfersChanged()
}

/** The pairs the journal suggests (S10b). Throws `LedgerApiError`. */
export async function fetchTransferSuggestions(orgId: string, signal?: AbortSignal): Promise<SuggestionsResult> {
  const res = await fetch(`${org(orgId)}/transfers/suggestions`, { credentials: 'same-origin', signal })
  if (!res.ok) throw await readApiError(res)
  return (await res.json()) as SuggestionsResult
}

async function post(orgId: string, body: unknown): Promise<TransferOutcome[]> {
  const out = (await apiCall('POST', `${org(orgId)}/transfers`, body)) as { results: TransferOutcome[] }
  return out.results
}

/** Confirms suggested pairs with the versions the person saw: a pair changed since is a `conflict`, never merged blindly. */
export async function confirmPairs(orgId: string, pairs: readonly TransferSuggestion[]): Promise<TransferOutcome[]> {
  try {
    return await post(orgId, { pairs: pairs.map((p) => ({ fromId: p.from.id, toId: p.to.id, versions: [p.from.version, p.to.version] })) })
  } finally {
    changed()
  }
}

/** «Об’єднати в переказ»: two selected bank operations, in any order. */
export async function mergeIntoTransfer(orgId: string, ids: readonly [string, string]): Promise<TransferOutcome> {
  try {
    const [result] = await post(orgId, { merge: [...ids] })
    return result
  } finally {
    changed()
  }
}

/**
 * «Зробити переказом»: operations of one bank account with `toAccountId`, in requests of MAX_CONVERT_IDS. A request that
 * fails (network, a 5xx) ends the run: its ids and those not sent yet are `unknown`, what was done stays reported.
 */
export async function convertToTransfers(orgId: string, ids: readonly string[], toAccountId: string): Promise<TransferOutcome[]> {
  const out: TransferOutcome[] = []
  try {
    for (let i = 0; i < ids.length; i += MAX_CONVERT_IDS) {
      try {
        out.push(...(await post(orgId, { convert: { ids: ids.slice(i, i + MAX_CONVERT_IDS), toAccountId } })))
      } catch {
        out.push(...ids.slice(i).map((id): TransferOutcome => ({ ids: [id], ok: false, code: 'unknown' })))
        break
      }
    }
    return out
  } finally {
    changed()
  }
}

/** «Розділити переказ»: the bank operations the transfer was. Throws `LedgerApiError` (`not_eligible`, `conflict`, ...). */
export async function splitTransfer(orgId: string, txId: string): Promise<LedgerTransaction[]> {
  try {
    const out = (await apiCall('POST', `${org(orgId)}/transfers/${encodeURIComponent(txId)}/split`)) as { restored: LedgerTransaction[] }
    return out.restored
  } finally {
    changed()
  }
}

/**
 * The undo of transfers made in this browser (the toast): each is split, then each of its operations is written back as it
 * was before (the split gives them back without category, counterparty or period). A failure counts and the rest go on;
 * the journal reloads once at the end.
 */
export async function undoTransfers(
  orgId: string,
  made: readonly MadeOutcome[],
  o: { split?: (id: string) => Promise<unknown>; revert?: (before: LedgerTransaction) => Promise<unknown> } = {},
): Promise<{ done: number; failed: number }> {
  const split = o.split ?? ((id: string) => splitTransfer(orgId, id))
  const revert = o.revert ?? ((before: LedgerTransaction) => revertTransaction(orgId, toUiTransaction(orgId, before)))
  let done = 0
  let failed = 0
  await withoutNotifications(async () => {
    for (const m of made) {
      try {
        await split(m.id)
        for (const before of m.before) await revert(before)
        done++
      } catch {
        failed++
      }
    }
  })
  notifyTransfersChanged()
  return { done, failed }
}
```

Створити `lib/hooks/useTransferSuggestions.ts`:

```ts
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchTransferSuggestions, onTransfersChanged } from '@/lib/api/transfers-client'
import { pairKey, readDismissed, withDismissed, writeDismissed } from '@/lib/domain/transfers/dismissed'
import type { SuggestionsResult, TransferSuggestion } from '@/lib/domain/transfers/types'
import { browserLocalStorage } from '@/lib/shell/sidebar-store'

/** Several transfer actions in a row (an undo of many) read the suggestions once. */
const REFRESH_DEBOUNCE_MS = 300

export interface UseTransferSuggestions {
  /** The server's suggestions without the pairs turned down in this browser. */
  pairs: TransferSuggestion[]
  truncated: boolean
  /** Remembers the pairs the person turned down (this browser only). */
  dismiss: (pairs: readonly TransferSuggestion[]) => void
  /** Reads the suggestions again (the dialog opens). */
  refresh: () => void
}

/**
 * The own transfers the journal suggests (S10b), for `orgId` (null: nothing is read, e.g. a viewer). Read when the journal
 * opens, on `refresh` and after transfer actions in this browser, never after an ordinary edit (each read costs up to 2000
 * document reads). A failed read shows nothing: the banner is only a hint.
 */
export function useTransferSuggestions(orgId: string | null): UseTransferSuggestions {
  const [round, setRound] = useState(0)
  const [loaded, setLoaded] = useState<{ orgId: string; result: SuggestionsResult } | null>(null)
  const [dismissed, setDismissed] = useState<{ orgId: string; keys: string[] } | null>(null)

  useEffect(() => {
    if (!orgId) return
    const ac = new AbortController()
    fetchTransferSuggestions(orgId, ac.signal).then(
      (result) => {
        if (!ac.signal.aborted) setLoaded({ orgId, result })
      },
      () => {
        // A hint only: a failed read leaves the last answer (or none) in place.
      },
    )
    return () => ac.abort()
  }, [orgId, round])

  useEffect(() => {
    if (!orgId) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = onTransfersChanged(() => {
      clearTimeout(timer)
      timer = setTimeout(() => setRound((r) => r + 1), REFRESH_DEBOUNCE_MS)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [orgId])

  const keys = useMemo(
    () => (dismissed && dismissed.orgId === orgId ? dismissed.keys : orgId ? readDismissed(browserLocalStorage(), orgId) : []),
    [orgId, dismissed],
  )
  const result = loaded && loaded.orgId === orgId ? loaded.result : null
  const pairs = useMemo(() => (result ? result.pairs.filter((p) => !keys.includes(pairKey(p))) : []), [result, keys])

  const dismiss = useCallback(
    (gone: readonly TransferSuggestion[]) => {
      if (!orgId || gone.length === 0) return
      const next = withDismissed(readDismissed(browserLocalStorage(), orgId), gone.map(pairKey))
      writeDismissed(browserLocalStorage(), orgId, next)
      setDismissed({ orgId, keys: next })
    },
    [orgId],
  )
  const refresh = useCallback(() => setRound((r) => r + 1), [])

  return { pairs, truncated: result?.truncated ?? false, dismiss, refresh }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/api && npm run typecheck && npm run lint`
Expected: PASS, `tsc` чисто, `lint` без нових попереджень (`setState` лише в колбеках промісу, таймера й обробниках).

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add lib/api/transfers-client.ts lib/hooks/useTransferSuggestions.ts tests/unit/api/transfers-client.test.ts && git commit -m "feat(transfers): browser client, undo and the suggestions hook

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Повідомлення uk / pl / en

**Files:**
- Modify: `messages/uk.json`, `messages/pl.json`, `messages/en.json`

- [ ] **Step 1: Merge the keys**

Створити інструментом Write `tmp-i18n.cjs` у корені репозиторію:

```js
// Temporary (S10b plan, Task 9): merges the keys below into the three catalogs, keeping their format. Not committed.
const fs = require('fs')
const ADD = {
  uk: {
    journal: {
      transfers: {
        banner: 'Знайдено можливих переказів між вашими рахунками: {count}',
        bannerOpen: 'Переглянути',
        dialogTitle: 'Можливі перекази',
        dialogBody: 'Ці операції з банку схожі на рух грошей між вашими рахунками. Позначені пари стануть переказами: вони зникнуть із Cash Flow і P&L, залишки рахунків не зміняться. Пари без позначки цей браузер більше не пропонуватиме.',
        pick: 'Переказ {from} → {to}, {amount}, {date}',
        confirm: 'Підтвердити вибрані',
        later: 'Не зараз',
        truncated: 'Переглянуто лише найновіші операції. Старші можна об’єднати вручну.',
        failedPair: 'Не вдалося: {reason}',
        done: 'Перекази створено: {count}.',
        partial: 'Не вдалося: {count} ({reason}).',
        droppedTags: 'Не всі теги вмістилися, відкинуто: {count}.',
        undo: 'Скасувати',
        undoFailed: 'Не вдалося скасувати все',
        undone: 'Розділено переказів: {count}',
        convert: 'Зробити переказом',
        merge: 'Об’єднати в переказ',
        convertTitle: 'Зробити переказом',
        convertBody: 'Вибрано операцій: {count}. Вони стануть переказами між «{account}» і рахунком, який ви оберете (та сама валюта: {currency}). Залишок «{account}» не зміниться.',
        convertTarget: 'Рахунок',
        convertChoose: 'Оберіть рахунок',
        convertNoTarget: 'Немає іншого рахунку у валюті {currency}.',
        convertApply: 'Зробити переказом',
        convertCancel: 'Скасувати',
        converted: 'Перетворено на перекази: {ok} з {total}.',
        merged: 'Операції об’єднано в переказ.',
        split: 'Розділити переказ',
        splitHint: 'Це переказ з банку. Щоб змінити рахунки чи суми, розділіть його на операції банку.',
        splitDone: 'Переказ розділено',
        splitFailed: 'Не вдалося розділити переказ',
        arrival: 'зарахування {date}',
      },
      bulk: {
        errors: {
          not_eligible: 'Операція не підходить для переказу',
          currency_mismatch: 'Рахунки мають різні валюти',
          account_not_found: 'Рахунок не знайдено',
        },
      },
    },
  },
  pl: {
    journal: {
      transfers: {
        banner: 'Znaleziono możliwe przelewy między Twoimi kontami: {count}',
        bannerOpen: 'Przejrzyj',
        dialogTitle: 'Możliwe przelewy',
        dialogBody: 'Te operacje bankowe wyglądają na przepływ pieniędzy między Twoimi kontami. Zaznaczone pary staną się przelewami: znikną z Cash Flow i P&L, salda kont się nie zmienią. Pary bez zaznaczenia nie będą już proponowane w tej przeglądarce.',
        pick: 'Przelew {from} → {to}, {amount}, {date}',
        confirm: 'Potwierdź wybrane',
        later: 'Nie teraz',
        truncated: 'Przejrzano tylko najnowsze operacje. Starsze można połączyć ręcznie.',
        failedPair: 'Nie udało się: {reason}',
        done: 'Utworzono przelewy: {count}.',
        partial: 'Nie udało się: {count} ({reason}).',
        droppedTags: 'Nie wszystkie tagi się zmieściły, pominięto: {count}.',
        undo: 'Cofnij',
        undoFailed: 'Nie udało się cofnąć wszystkiego',
        undone: 'Rozdzielono przelewy: {count}',
        convert: 'Zamień na przelew',
        merge: 'Połącz w przelew',
        convertTitle: 'Zamień na przelew',
        convertBody: 'Wybrano operacji: {count}. Staną się przelewami między „{account}” a kontem, które wybierzesz (ta sama waluta: {currency}). Saldo „{account}” się nie zmieni.',
        convertTarget: 'Konto',
        convertChoose: 'Wybierz konto',
        convertNoTarget: 'Brak innego konta w walucie {currency}.',
        convertApply: 'Zamień na przelew',
        convertCancel: 'Anuluj',
        converted: 'Zamieniono na przelewy: {ok} z {total}.',
        merged: 'Połączono operacje w przelew.',
        split: 'Rozdziel przelew',
        splitHint: 'To przelew z banku. Aby zmienić konta lub kwoty, rozdziel go na operacje bankowe.',
        splitDone: 'Przelew rozdzielono',
        splitFailed: 'Nie udało się rozdzielić przelewu',
        arrival: 'wpływ {date}',
      },
      bulk: {
        errors: {
          not_eligible: 'Operacja nie nadaje się na przelew',
          currency_mismatch: 'Konta mają różne waluty',
          account_not_found: 'Nie znaleziono konta',
        },
      },
    },
  },
  en: {
    journal: {
      transfers: {
        banner: 'Possible transfers between your accounts found: {count}',
        bannerOpen: 'Review',
        dialogTitle: 'Possible transfers',
        dialogBody: 'These bank transactions look like money moving between your own accounts. Ticked pairs become transfers: they leave Cash Flow and P&L, and the account balances stay the same. Pairs you untick are not suggested again in this browser.',
        pick: 'Transfer {from} → {to}, {amount}, {date}',
        confirm: 'Confirm selected',
        later: 'Not now',
        truncated: 'Only the newest transactions were checked. Older ones can be merged by hand.',
        failedPair: 'Failed: {reason}',
        done: 'Transfers created: {count}.',
        partial: 'Failed: {count} ({reason}).',
        droppedTags: 'Not every tag fit, left out: {count}.',
        undo: 'Undo',
        undoFailed: 'Could not undo everything',
        undone: 'Transfers split: {count}',
        convert: 'Make a transfer',
        merge: 'Merge into a transfer',
        convertTitle: 'Make a transfer',
        convertBody: 'Selected: {count}. They become transfers between “{account}” and the account you choose (same currency: {currency}). The balance of “{account}” stays the same.',
        convertTarget: 'Account',
        convertChoose: 'Choose an account',
        convertNoTarget: 'There is no other account in {currency}.',
        convertApply: 'Make a transfer',
        convertCancel: 'Cancel',
        converted: 'Turned into transfers: {ok} of {total}.',
        merged: 'The operations were merged into a transfer.',
        split: 'Split the transfer',
        splitHint: 'This is a bank transfer. To change its accounts or amounts, split it into the bank transactions.',
        splitDone: 'The transfer was split',
        splitFailed: 'Could not split the transfer',
        arrival: 'arrived {date}',
      },
      bulk: {
        errors: {
          not_eligible: 'The operation cannot become a transfer',
          currency_mismatch: 'The accounts have different currencies',
          account_not_found: 'The account was not found',
        },
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
  const file = `messages/${lang}.json`
  const src = fs.readFileSync(file, 'utf8')
  const data = JSON.parse(src)
  merge(data, fragment)
  let out = JSON.stringify(data, null, 2) + '\n'
  if (src.includes('\r\n')) out = out.replace(/\n/g, '\r\n')
  fs.writeFileSync(file, out)
}
```

Run: `cd /f/AI/finflow && node tmp-i18n.cjs && rm tmp-i18n.cjs && git diff --stat messages`
Expected: три каталоги змінено однаково (у кожному той самий рядок `+`/`-`: новий блок `journal.transfers` з 31 ключем у кінці `journal`, три нові коди в кінці `journal.bulk.errors`, кома після двох колишніх останніх ключів).

- [ ] **Step 2: Run the checks**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/i18n && npm run typecheck`
Expected: PASS (`catalogs` бачить однакові ключі й однакові імена аргументів ICU у трьох каталогах), `tsc` чисто.

- [ ] **Step 3: Commit**

```bash
cd /f/AI/finflow && git add messages/uk.json messages/pl.json messages/en.json && git commit -m "feat(transfers): uk, pl and en texts for own transfers

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Журнал: банер і діалог пропозицій

**Files:**
- Create: `components/transactions/TransferSuggestions.tsx`
- Modify: `app/(app)/[orgSlug]/transactions/page.tsx`
- Test: чиста логіка вже покрита (Task 6, 8); поведінку перевіряє `tests/e2e/transfers.spec.ts` (Task 14). Тут: `typecheck`, `lint`, `no-hardcoded-text`.

- [ ] **Step 1: Implement the banner and the dialog**

Створити `components/transactions/TransferSuggestions.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowLeftRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { fromMinor } from '@/lib/domain/ledger/money'
import { pairKey } from '@/lib/domain/transfers/dismissed'
import type { SuggestionSide, TransferSuggestion } from '@/lib/domain/transfers/types'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { formatDayShortUtc } from '@/lib/utils/journal'
import type { Account } from '@/types'

/** «Знайдено можливих переказів…» over the journal (S10b): opens the dialog of suggested pairs. */
export function TransferSuggestionsBanner({ count, onOpen }: { count: number; onOpen: () => void }) {
  const t = useTranslations('journal.transfers')
  return (
    <div
      data-testid="transfer-suggestions"
      className="flex flex-wrap items-center gap-3 rounded-panel border border-line bg-brand-soft px-4 py-2.5 text-sm text-brand-soft-foreground"
    >
      <ArrowLeftRight aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{t('banner', { count })}</span>
      <Button type="button" variant="soft" size="sm" onClick={onOpen}>
        {t('bannerOpen')}
      </Button>
    </div>
  )
}

interface DialogProps {
  pairs: TransferSuggestion[]
  accounts: Account[]
  truncated: boolean
  busy: boolean
  /** Why a pair failed on the last confirmation (already translated), by pair key: such a pair stays with its reason. */
  failures: ReadonlyMap<string, string>
  /** The ticked pairs, and the unticked ones (turned down in this browser). */
  onConfirm: (chosen: TransferSuggestion[], rejected: TransferSuggestion[]) => void
  onClose: () => void
}

/** The suggested pairs (S10b): every pair starts ticked; «Підтвердити вибрані» merges the ticked ones, «Не зараз» closes. */
export function TransferSuggestionsDialog({ pairs, accounts, truncated, busy, failures, onConfirm, onClose }: DialogProps) {
  const t = useTranslations('journal.transfers')
  const { locale, money } = useFormatters()
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(() => new Set())
  const nameOf = (id: string): string => accounts.find((a) => a.id === id)?.name ?? '—'
  const dayOf = (day: string): string => formatDayShortUtc(new Date(`${day}T00:00:00Z`), locale)
  const amountOf = (side: SuggestionSide): string => money(fromMinor(side.amountMinor), side.currency)
  const toggle = (key: string) =>
    setUnticked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const chosen = pairs.filter((p) => !unticked.has(pairKey(p)))
  const rejected = pairs.filter((p) => unticked.has(pairKey(p)))

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('dialogTitle')}</DialogTitle>
          <DialogDescription>{t('dialogBody')}</DialogDescription>
        </DialogHeader>

        <ul className="space-y-2">
          {pairs.map((p) => {
            const key = pairKey(p)
            const from = nameOf(p.from.accountId)
            const to = nameOf(p.to.accountId)
            const dates = p.from.paymentDate === p.to.paymentDate ? dayOf(p.from.paymentDate) : `${dayOf(p.from.paymentDate)} → ${dayOf(p.to.paymentDate)}`
            const failure = failures.get(key)
            return (
              <li key={key} data-testid="transfer-suggestion" className="rounded-field border border-line px-3 py-2">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 accent-brand"
                    checked={!unticked.has(key)}
                    onChange={() => toggle(key)}
                    aria-label={t('pick', { from, to, amount: amountOf(p.from), date: dates })}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{`${from} → ${to}`}</span>
                    <span className="block text-xs tabular-nums text-ink-muted">{dates}</span>
                    {p.from.remittance && <span className="block truncate text-xs text-ink-muted">{p.from.remittance}</span>}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-ink">{amountOf(p.from)}</span>
                </label>
                {failure && (
                  <p role="alert" className="mt-1 text-xs text-expense">
                    {t('failedPair', { reason: failure })}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
        {truncated && <p className="text-sm text-ink-muted">{t('truncated')}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t('later')}
          </Button>
          <Button type="button" disabled={busy || pairs.length === 0} onClick={() => onConfirm(chosen, rejected)}>
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Wire it into the journal page**

`app/(app)/[orgSlug]/transactions/page.tsx`:

1. Після рядка `import { TransactionList } from '@/components/transactions/TransactionList'` додати `import { TransferSuggestionsBanner, TransferSuggestionsDialog } from '@/components/transactions/TransferSuggestions'`.
2. Після рядка `import { collectMatching, SELECT_ALL_LIMIT } from '@/lib/api/journal-matching'` додати `import { confirmPairs, undoTransfers } from '@/lib/api/transfers-client'`.
3. Після рядка `import type { LedgerTransaction } from '@/lib/domain/ledger/types'` додати:

```ts
import { pairKeyOf } from '@/lib/domain/transfers/dismissed'
import type { FailedOutcome, MadeOutcome, TransferOutcome, TransferSuggestion } from '@/lib/domain/transfers/types'
```

4. Після рядка `import { useTags } from '@/lib/hooks/useTags'` додати `import { useTransferSuggestions } from '@/lib/hooks/useTransferSuggestions'`.
5. Після рядка `  const tDelete = useTranslations('journal.delete')` додати `  const tTransfers = useTranslations('journal.transfers')`.
6. Після рядка `  const [abort, setAbort] = useState<AbortController | null>(null)` додати:

```ts

  // Own transfers (S10b): the suggestions banner and its dialog, for the people who may write.
  const suggestions = useTransferSuggestions(canEdit ? orgId : null)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestFailures, setSuggestFailures] = useState<ReadonlyMap<string, string>>(new Map())
```

7. Перед рядком `  const summary = selectionSummary(selectedRows, baseCurrency)` додати:

```ts
  // One toast for every transfer action (S10b): what was made, what failed and why, the tags that did not fit. «Скасувати»
  // splits what was made and writes its operations back as they were.
  const announceTransfers = (results: TransferOutcome[], message: string) => {
    const made = results.filter((r): r is MadeOutcome => r.ok)
    const failed = results.filter((r): r is FailedOutcome => !r.ok)
    const dropped = made.reduce((sum, r) => sum + r.droppedTags, 0)
    const text = [
      message,
      failed.length > 0 ? tTransfers('partial', { count: failed.length, reason: failureReason(failed) }) : '',
      dropped > 0 ? tTransfers('droppedTags', { count: dropped }) : '',
    ]
      .filter(Boolean)
      .join(' ')
    if (made.length === 0) {
      toast.warning(text)
      return
    }
    undoToast({
      message: text,
      actionLabel: tTransfers('undo'),
      failureMessage: tTransfers('undoFailed'),
      id: 'journal-transfers',
      duration: BULK_UNDO_MS,
      undo: async () => {
        const out = await undoTransfers(orgId, made)
        if (out.failed > 0) throw new Error('partial')
        toast.success(tTransfers('undone', { count: out.done }))
      },
    })
  }

  const openSuggestions = () => {
    setSuggestFailures(new Map())
    setSuggestOpen(true)
    // The dialog shows what the server says now: the operations may have changed since the journal opened.
    suggestions.refresh()
  }

  // «Підтвердити вибрані»: the ticked pairs become transfers; the unticked ones are not offered again in this browser. A pair
  // that fails stays in the dialog with its reason; the dialog closes when every pair went through.
  const confirmSuggested = async (chosen: TransferSuggestion[], rejected: TransferSuggestion[]) => {
    suggestions.dismiss(rejected)
    if (chosen.length === 0) {
      setSuggestOpen(false)
      return
    }
    setBusy(true)
    try {
      const results = await confirmPairs(orgId, chosen)
      announceTransfers(results, tTransfers('done', { count: results.filter((r) => r.ok).length }))
      const failures = new Map<string, string>()
      for (const r of results) if (!r.ok) failures.set(pairKeyOf(r.ids[0], r.ids[1]), errorText(r.code))
      setSuggestFailures(failures)
      if (failures.size === 0) setSuggestOpen(false)
    } catch {
      toast.error(tBulk('errors.unknown'))
    } finally {
      setBusy(false)
    }
  }

```

8. Після блоку

```tsx
      {error && (
        <p role="alert" className="rounded-control bg-expense-soft px-3 py-2 text-sm text-expense">
          {t('loadError')}
        </p>
      )}
```

додати:

```tsx

      {canEdit && suggestions.pairs.length > 0 && <TransferSuggestionsBanner count={suggestions.pairs.length} onOpen={openSuggestions} />}
```

9. Між рядками

```tsx
          onClose={() => setEditField(null)}
        />
      )}
```

(кінець блоку `BulkEditDialog`) і `      <ConfirmDialog` додати:

```tsx

      {canEdit && suggestOpen && (
        <TransferSuggestionsDialog
          pairs={suggestions.pairs}
          accounts={accounts}
          truncated={suggestions.truncated}
          busy={busy}
          failures={suggestFailures}
          onConfirm={(chosen, rejected) => void confirmSuggested(chosen, rejected)}
          onClose={() => setSuggestOpen(false)}
        />
      )}
```

- [ ] **Step 3: Run the checks**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/i18n && npm run typecheck && npm run lint`
Expected: PASS (`no-hardcoded-text`: тексти й `aria-label` лише через `t()`), `tsc` чисто (ключі `journal.transfers.*` типізовані з `messages/uk.json`), `lint` без нових попереджень.

- [ ] **Step 4: Commit**

```bash
cd /f/AI/finflow && git add components/transactions/TransferSuggestions.tsx "app/(app)/[orgSlug]/transactions/page.tsx" && git commit -m "feat(transfers): suggestions banner and dialog in the journal

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Панель вибору: «Зробити переказом» і «Об’єднати в переказ»

**Files:**
- Create: `components/transactions/ConvertTransferDialog.tsx`
- Modify: `components/transactions/SelectionBar.tsx`, `app/(app)/[orgSlug]/transactions/page.tsx`
- Test: правила вибору покриті (`tests/unit/domain/transfers/selection.test.ts`, Task 6); поведінку перевіряє e2e (Task 14). Тут: `typecheck`, `lint`, `no-hardcoded-text`.

- [ ] **Step 1: Implement the dialog and the bar**

Створити `components/transactions/ConvertTransferDialog.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import type { Account } from '@/types'

interface Props {
  /** The bank account every selected operation belongs to. */
  source: Account
  accounts: Account[]
  count: number
  busy: boolean
  onApply: (toAccountId: string) => void
  onClose: () => void
}

/**
 * «Зробити переказом» (S10b): the account of the other side (a cash box, a manual account) in the currency of the bank
 * account. The server refuses an account a bank feeds (`not_eligible`): two bank operations are merged instead.
 */
export function ConvertTransferDialog({ source, accounts, count, busy, onApply, onClose }: Props) {
  const t = useTranslations('journal.transfers')
  const targets = accounts.filter((a) => a.id !== source.id && a.currency === source.currency)
  const [target, setTarget] = useState('')

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('convertTitle')}</DialogTitle>
          <DialogDescription>{t('convertBody', { count, account: source.name, currency: source.currency })}</DialogDescription>
        </DialogHeader>

        {targets.length > 0 ? (
          <div className="space-y-1">
            <Label htmlFor="transfer-target">{t('convertTarget')}</Label>
            <NativeSelect id="transfer-target" wrapperClassName="w-full" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">{t('convertChoose')}</option>
              {targets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">{t('convertNoTarget', { currency: source.currency })}</p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t('convertCancel')}
          </Button>
          <Button type="button" disabled={busy || target === ''} onClick={() => onApply(target)}>
            {t('convertApply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

`components/transactions/SelectionBar.tsx`: замінити файл повністю на:

```tsx
'use client'

import { useTranslations } from 'next-intl'
import { ArrowLeftRight, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { selectionSummary } from '@/lib/domain/journal/selection'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { fromMinor } from '@/lib/domain/ledger/money'
import { useFormatters } from '@/lib/i18n/useFormatters'

export type BulkField = 'category' | 'counterparty' | 'comment' | 'paymentDate' | 'accrual' | 'addTags' | 'removeTags'

const FIELDS: BulkField[] = ['category', 'counterparty', 'comment', 'paymentDate', 'accrual', 'addTags', 'removeTags']

interface Props {
  rows: LedgerTransaction[]
  baseCurrency: string
  onEdit: (field: BulkField) => void
  onDelete: () => void
  onClear: () => void
  /** «Select all matching the filter»: offered while more rows match than are loaded. */
  matching: { offer: boolean; running: boolean; limitReached: boolean; limit: number }
  onSelectMatching: () => void
  /** «Зробити переказом» (S10b): set while every selected row is a bank operation of one account. */
  onConvert?: () => void
  /** «Об’єднати в переказ» (S10b): set while the selection is a bank expense and a bank income that make one transfer. */
  onMerge?: () => void
}

/** Appears over the journal while rows are checked: how many, their net amount, the transfer actions, «change data» and «delete». */
export function SelectionBar({ rows, baseCurrency, onEdit, onDelete, onClear, matching, onSelectMatching, onConvert, onMerge }: Props) {
  const t = useTranslations('journal.selection')
  const tTransfers = useTranslations('journal.transfers')
  const { money } = useFormatters()
  const { count, totalBaseMinor } = selectionSummary(rows, baseCurrency)

  return (
    // Dark ink on the brand green (`primary-foreground`, 7.7:1); white on it would be 2.2:1.
    <div
      role="region"
      aria-label={t('region')}
      className="sticky top-2 z-20 flex flex-wrap items-center gap-3 rounded-panel bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-pop max-sm:fixed max-sm:inset-x-3 max-sm:top-auto max-sm:bottom-3"
    >
      <span className="font-semibold">{t('selected', { count })}</span>
      <span className="tabular-nums">{money(fromMinor(totalBaseMinor), baseCurrency)}</span>
      {matching.running ? (
        <span role="status">{t('selecting')}</span>
      ) : matching.limitReached ? (
        <span role="status">{t('limitReached', { limit: matching.limit })}</span>
      ) : (
        matching.offer && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onSelectMatching}
            className="px-2 text-primary-foreground underline hover:bg-primary-foreground/10 hover:text-primary-foreground"
          >
            {t('selectAllMatching')}
          </Button>
        )
      )}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        {onMerge && (
          <Button type="button" variant="secondary" size="sm" onClick={onMerge} className="gap-1">
            <ArrowLeftRight className="size-3.5" />
            {tTransfers('merge')}
          </Button>
        )}
        {onConvert && (
          <Button type="button" variant="secondary" size="sm" onClick={onConvert} className="gap-1">
            <ArrowLeftRight className="size-3.5" />
            {tTransfers('convert')}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="secondary" size="sm" />}>{t('change')}</DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {FIELDS.map((field) => (
              <DropdownMenuItem key={field} onClick={() => onEdit(field)}>
                {t(`field_${field}`)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="button" variant="secondary" size="sm" onClick={onDelete} className="gap-1">
          <Trash2 className="size-3.5" />
          {t('delete')}
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onClear} aria-label={t('clear')} className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">
          <X className="size-4" />
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire them into the journal page**

`app/(app)/[orgSlug]/transactions/page.tsx`:

1. Після рядка `import { BulkEditDialog } from '@/components/transactions/BulkEditDialog'` додати `import { ConvertTransferDialog } from '@/components/transactions/ConvertTransferDialog'`.
2. Рядок `import { confirmPairs, undoTransfers } from '@/lib/api/transfers-client'` замінити на `import { confirmPairs, convertToTransfers, mergeIntoTransfer, undoTransfers } from '@/lib/api/transfers-client'`.
3. Після рядка `import { pairKeyOf } from '@/lib/domain/transfers/dismissed'` додати `import { convertSourceOf, mergePairOf } from '@/lib/domain/transfers/selection'`.
4. Після рядка `  const [suggestFailures, setSuggestFailures] = useState<ReadonlyMap<string, string>>(new Map())` додати:

```ts
  // «Зробити переказом» and «Об’єднати в переказ» are offered only for a selection the ledger's own rules accept.
  const [convertOpen, setConvertOpen] = useState(false)
  const convertSource = useMemo(() => convertSourceOf(selectedRows), [selectedRows])
  const mergePair = useMemo(() => mergePairOf(selectedRows), [selectedRows])
  const sourceAccount = convertSource ? (accounts.find((a) => a.id === convertSource.accountId) ?? null) : null
```

5. Перед рядком `  const summary = selectionSummary(selectedRows, baseCurrency)` додати:

```ts
  const convertSelected = async (toAccountId: string) => {
    setBusy(true)
    try {
      const results = await convertToTransfers(orgId, selectedRows.map((r) => r.id), toAccountId)
      announceTransfers(results, tTransfers('converted', { ok: results.filter((r) => r.ok).length, total: results.length }))
      clearSelection()
      setConvertOpen(false)
    } catch {
      toast.error(tBulk('errors.unknown'))
    } finally {
      setBusy(false)
    }
  }

  const mergeSelected = async () => {
    if (!mergePair) return
    setBusy(true)
    try {
      const result = await mergeIntoTransfer(orgId, [mergePair[0].id, mergePair[1].id])
      announceTransfers([result], result.ok ? tTransfers('merged') : '')
      if (result.ok) clearSelection()
    } catch {
      toast.error(tBulk('errors.unknown'))
    } finally {
      setBusy(false)
    }
  }

```

6. У `<SelectionBar ...>` після рядка `          onClear={clearSelection}` додати:

```tsx
          onConvert={convertSource && sourceAccount && !busy ? () => setConvertOpen(true) : undefined}
          onMerge={mergePair && !busy ? () => void mergeSelected() : undefined}
```

7. Перед блоком `      {canEdit && suggestOpen && (` додати:

```tsx
      {canEdit && convertOpen && sourceAccount && (
        <ConvertTransferDialog
          source={sourceAccount}
          accounts={accounts}
          count={selectedRows.length}
          busy={busy}
          onApply={(toAccountId) => void convertSelected(toAccountId)}
          onClose={() => setConvertOpen(false)}
        />
      )}

```

- [ ] **Step 3: Run the checks**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/i18n tests/unit/domain/transfers && npm run typecheck && npm run lint`
Expected: PASS, `tsc` чисто, `lint` без нових попереджень.

- [ ] **Step 4: Commit**

```bash
cd /f/AI/finflow && git add components/transactions/ConvertTransferDialog.tsx components/transactions/SelectionBar.tsx "app/(app)/[orgSlug]/transactions/page.tsx" && git commit -m "feat(transfers): make a transfer and merge into a transfer from the selection bar

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Рядок банківського переказу і «Розділити переказ» у формі

**Files:**
- Modify: `components/transactions/TransactionList.tsx`, `components/forms/transaction/TransactionForm.tsx`
- Test: e2e (Task 14). Тут: `typecheck`, `lint`, `no-hardcoded-text`.

- [ ] **Step 1: The row**

`components/transactions/TransactionList.tsx`:

1. Після рядка `  const tJournal = useTranslations('journal')` додати `  const tTransfers = useTranslations('journal.transfers')`.
2. Після рядка `                  const accrual = accrualText(tx)` додати:

```tsx
                  // The money of a transfer arrived on another day than it left (S10b): shown under the date.
                  const arrival = tx.toDate ? tTransfers('arrival', { date: formatDayShortUtc(new Date(`${tx.toDate}T00:00:00Z`), locale) }) : null
```

3. Рядок `                  const counterpartyLine = !!counterparty || showFill || !!tx.bank` замінити на `                  const counterpartyLine = !!counterparty || showFill || !!tx.bank || !!tx.bankTo`.
4. Після рядка `                        {accrual && <span className="block text-xs text-ink-muted">{accrual}</span>}` додати:

```tsx
                        {arrival && <span data-testid="transfer-arrival" className="block text-xs text-ink-muted">{arrival}</span>}
```

5. Після рядка `                        {planned && <Badge variant="chip" className="mt-1">{t('planned')}</Badge>}` додати:

```tsx
                        {/* The date column is hidden on a phone: the arrival day goes under the account there. */}
                        {arrival && <span data-testid="transfer-arrival-phone" className="block text-xs text-ink-muted sm:hidden">{arrival}</span>}
```

6. Рядок `                            {tx.bank && <Badge variant="chip" className="shrink-0">{tJournal('fromBank')}</Badge>}` замінити на:

```tsx
                            {(tx.bank || tx.bankTo) && <Badge variant="chip" className="shrink-0">{tJournal('fromBank')}</Badge>}
```

- [ ] **Step 2: The form**

`components/forms/transaction/TransactionForm.tsx`:

1. Після рядка `import { restoreTransaction, revertTransaction } from '@/lib/api/transaction-undo'` додати `import { splitTransfer } from '@/lib/api/transfers-client'`.
2. Після рядка `  const tCommon = useTranslations('common')` додати `  const tTransfers = useTranslations('journal.transfers')`.
3. Рядки

```tsx
  // An operation imported from a bank keeps its amount, payment date, account and type (the server refuses to change them too).
  const bankLocked = transaction?.bank !== undefined
```

замінити на:

```tsx
  // An operation imported from a bank keeps its amount, payment date, account and type (the server refuses to change them too).
  // A transfer with a bank side (S10b) keeps the whole amount block here; «Розділити переказ» gives the bank operations back.
  const bankLocked = transaction?.bank !== undefined || transaction?.bankTo !== undefined
  const bankTransfer = transaction?.type === 'transfer' && bankLocked
```

4. Рядок `  const [busy, setBusy] = useState<'save' | 'delete' | null>(null)` замінити на `  const [busy, setBusy] = useState<'save' | 'delete' | 'split' | null>(null)`.
5. Після функції `remove` (перед коментарем `  // Closing a form that holds changes asks first; an untouched form closes at once.`) додати:

```tsx
  const split = async () => {
    if (!transaction || inFlight.current) return
    inFlight.current = true
    setBusy('split')
    try {
      await splitTransfer(orgId, transaction.id)
      toast.success(tTransfers('splitDone'))
      onClose()
    } catch {
      toast.error(tTransfers('splitFailed'))
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

```

6. Після блоку

```tsx
          {bankLocked && (
            <p data-testid="bank-locked-hint" className="text-xs text-ink-muted">
              {t('bankLockedHint')}
            </p>
          )}
```

додати:

```tsx
          {bankTransfer && (
            <p data-testid="split-hint" className="text-xs text-ink-muted">
              {tTransfers('splitHint')}
            </p>
          )}
```

7. Після блоку кнопки видалення

```tsx
            {isEdit && (
              <Button type="button" variant="destructive" disabled={busy !== null} onClick={() => setConfirm('delete')} className="sm:mr-auto">
                {t('delete')}
              </Button>
            )}
```

додати:

```tsx
            {bankTransfer && (
              <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void split()} data-testid="split-transfer">
                {tTransfers('split')}
              </Button>
            )}
```

- [ ] **Step 3: Run the checks**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/i18n tests/unit/api/transaction-draft.test.ts && npm run typecheck && npm run lint`
Expected: PASS, `tsc` чисто, `lint` без нових попереджень.

- [ ] **Step 4: Commit**

```bash
cd /f/AI/finflow && git add components/transactions/TransactionList.tsx components/forms/transaction/TransactionForm.tsx && git commit -m "feat(transfers): bank transfer row with its arrival day, split from the form

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Скрипт `check:transfers` (лише читання, перед розгортанням)

**Files:**
- Create: `scripts/check-transfers.ts`, `scripts/lib/check-transfers.ts`, `tests/unit/scripts/check-transfers.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Створити `tests/unit/scripts/check-transfers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { sumChecks, transferCheckLine, type TransferCheck } from '@/scripts/lib/check-transfers'

const a: TransferCheck = { scanned: 812, bankSides: 640, pairs: 7, ambiguous: 2, truncated: false, bankTransfers: 0 }
const b: TransferCheck = { scanned: 2000, bankSides: 1900, pairs: 31, ambiguous: 0, truncated: true, bankTransfers: 3 }

describe('check:transfers', () => {
  it('prints counts only, one line per company', () => {
    expect(transferCheckLine('org1', a)).toBe('org org1: 7 pair(s) to suggest, 2 ambiguous side(s), 640 bank operation(s) of 812 read, 0 transfer(s) with a bank side')
    expect(transferCheckLine('org2', b)).toBe('org org2: 31 pair(s) to suggest, 0 ambiguous side(s), 1900 bank operation(s) of 2000 read (cut at the read limit), 3 transfer(s) with a bank side')
  })

  it('adds the companies up', () => {
    expect(sumChecks([a, b])).toEqual({ scanned: 2812, bankSides: 2540, pairs: 38, ambiguous: 2, truncated: true, bankTransfers: 3 })
    expect(sumChecks([])).toEqual({ scanned: 0, bankSides: 0, pairs: 0, ambiguous: 0, truncated: false, bankTransfers: 0 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/scripts/check-transfers.test.ts`
Expected: FAIL (`@/scripts/lib/check-transfers` не існує).

- [ ] **Step 3: Implement**

Створити `scripts/lib/check-transfers.ts`:

```ts
// Pure part of scripts/check-transfers.ts (S10b rollout check). Unit-tested in Vitest.

/** What the check read for one company: counts only. */
export interface TransferCheck {
  /** Operations of the last 90 days the suggestions read (at most 2000). */
  scanned: number
  /** Of those, bank incomes and expenses that can be a side of a transfer. */
  bankSides: number
  /** Pairs the journal would suggest. */
  pairs: number
  /** Sides with more than one candidate: not suggested, left to the person. */
  ambiguous: number
  /** The read stopped at its limit. */
  truncated: boolean
  /** Transfers that already carry a bank side (none before the rollout). */
  bankTransfers: number
}

export function transferCheckLine(orgId: string, c: TransferCheck): string {
  const read = `${c.bankSides} bank operation(s) of ${c.scanned} read${c.truncated ? ' (cut at the read limit)' : ''}`
  return `org ${orgId}: ${c.pairs} pair(s) to suggest, ${c.ambiguous} ambiguous side(s), ${read}, ${c.bankTransfers} transfer(s) with a bank side`
}

export function sumChecks(checks: readonly TransferCheck[]): TransferCheck {
  return checks.reduce(
    (sum, c) => ({
      scanned: sum.scanned + c.scanned,
      bankSides: sum.bankSides + c.bankSides,
      pairs: sum.pairs + c.pairs,
      ambiguous: sum.ambiguous + c.ambiguous,
      truncated: sum.truncated || c.truncated,
      bankTransfers: sum.bankTransfers + c.bankTransfers,
    }),
    { scanned: 0, bankSides: 0, pairs: 0, ambiguous: 0, truncated: false, bankTransfers: 0 },
  )
}
```

Створити `scripts/check-transfers.ts`:

```ts
// Read-only check for the S10b rollout (own transfers). Per company it reads what the journal's suggestions would offer
// (pairs, ambiguous sides, bank operations of the last 90 days) and how many transfers already carry a bank side, and it
// runs once every query shape S10b adds (the day and arrival reads of the journal, the `bankTo.key` lookup of an undo), so a
// missing index shows up as FAILED_PRECONDITION with its creation link. Never writes anything.
//   npm run check:transfers                                   over the emulator when FIRESTORE_EMULATOR_HOST is set
//   npm run check:transfers -- --project=finflow-e94b5        production (the flag is required; nothing is read without it)
//   --org=<id> limits the run to one company.
// Prints counts only, never names, amounts or texts.
// Exit code: 0 everything read, 1 a read failed, 2 refused or bad arguments.
import fs from 'node:fs'
import path from 'node:path'
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { toDay } from '@/lib/domain/ledger/days'
import { arrivalsQuery, dayOpsQuery } from '@/lib/server/journal/read'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { accountsCol, transactionsCol } from '@/lib/server/ledger/paths'
import { readTransferSuggestions } from '@/lib/server/transfers/read'
import { todayUtcDay } from '@/lib/utils/today'
import { assertReadinessTarget, parseCheckJournalArgs } from './lib/check-journal-args'
import { sumChecks, transferCheckLine, type TransferCheck } from './lib/check-transfers'

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

function describeError(e: unknown): string {
  if (e instanceof Error) {
    const code = (e as { code?: unknown }).code
    return `${code !== undefined ? `code ${String(code)}` : 'error'}: ${e.message}`
  }
  return 'error'
}

async function checkOrg(db: Firestore, orgId: string): Promise<TransferCheck> {
  const deps: Pick<LedgerDeps, 'db' | 'today'> = { db, today: () => toDay(todayUtcDay()) }
  const read = await readTransferSuggestions(deps, orgId)
  // The query shapes S10b adds, each once (an empty answer is fine; a missing index throws FAILED_PRECONDITION).
  const firstAccount = (await accountsCol(db, orgId).select().limit(1).get()).docs[0]?.id
  if (firstAccount !== undefined) {
    await dayOpsQuery(deps, orgId, firstAccount, deps.today()).limit(1).get()
    await arrivalsQuery(deps, orgId, firstAccount, deps.today()).limit(1).get()
  }
  await transactionsCol(db, orgId).where('bankTo.key', '==', '_probe').limit(1).get()
  const transfers = await transactionsCol(db, orgId).where('type', '==', 'transfer').select('bank', 'bankTo').get()
  const bankTransfers = transfers.docs.filter((d) => d.get('bank') !== undefined || d.get('bankTo') !== undefined).length
  return { scanned: read.scanned, bankSides: read.bankSides, pairs: read.total, ambiguous: read.ambiguous, truncated: read.truncated, bankTransfers }
}

async function main(): Promise<number> {
  const parsed = parseCheckJournalArgs(process.argv.slice(2))
  if (!parsed.ok) fail(parsed.message, 2)
  const { org, raw } = parsed.args

  const target = assertReadinessTarget({ emulator: !!process.env.FIRESTORE_EMULATOR_HOST, args: raw })
  if (!target.ok) fail(target.message, 2)

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({ projectId: EMULATOR_PROJECT_ID })
    console.log(`target: Firestore EMULATOR (project ${EMULATOR_PROJECT_ID})`)
  } else {
    initializeApp({ credential: credential(), projectId: PROJECT_ID })
    console.log(`target: PRODUCTION (project ${PROJECT_ID}), read-only`)
  }
  const db = getFirestore()

  const orgIds = org ? [org] : (await db.collection('organizations').select().get()).docs.map((d) => d.id)
  console.log(`companies: ${orgIds.length}`)

  const checks: TransferCheck[] = []
  const errored: string[] = []
  for (const orgId of orgIds) {
    try {
      const c = await checkOrg(db, orgId)
      checks.push(c)
      console.log(transferCheckLine(orgId, c))
    } catch (e) {
      console.error(`org ${orgId}: FAILED (${describeError(e)})`)
      errored.push(orgId)
    }
  }
  console.log(transferCheckLine('ALL', sumChecks(checks)))
  if (errored.length > 0) console.error(`failed companies (${errored.length}): ${errored.join(', ')}`)
  else console.log('DONE: every company was read. Nothing was written.')
  return errored.length > 0 ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`FAILED (${describeError(e)})`)
    process.exit(1)
  },
)
```

`package.json`: після рядка `    "check:tags": "node --conditions=react-server --import tsx scripts/check-tags.ts",` додати:

```json
    "check:transfers": "node --conditions=react-server --import tsx scripts/check-transfers.ts",
```

- [ ] **Step 4: Run the test and the script on the emulator**

```bash
cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/scripts/check-transfers.test.ts && npm run typecheck && npm run lint && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only firestore --project demo-finflow "npm run check:transfers"
```

Expected: тест PASS, `tsc` чисто, `lint` без нових попереджень; скрипт на порожньому емуляторі друкує `target: Firestore EMULATOR`, `companies: 0`, рядок `org ALL: 0 pair(s) ...`, `DONE: ...` і виходить з кодом 0. Без емулятора й без `--project=finflow-e94b5` (`npm run check:transfers`) виходить з кодом 2 і `REFUSED`, нічого не читаючи.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add scripts/check-transfers.ts scripts/lib/check-transfers.ts tests/unit/scripts/check-transfers.test.ts package.json && git commit -m "feat(transfers): read-only check:transfers before the rollout

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 14: E2E переказів, 401 маршрутів, скриншоти

**Files:**
- Create: `tests/e2e/helpers/transfer-seed.ts`, `tests/e2e/transfers.spec.ts`, `tests/ui-shots/transfers.spec.ts`
- Modify: `tests/e2e/api-guards.spec.ts`

- [ ] **Step 1: Seed helper**

Створити `tests/e2e/helpers/transfer-seed.ts`:

```ts
// Bank operations written by the real ledger for the S10b specs: the `bankSeen` mark first, in the shape the sync stores it
// (lib/server/banking/sync.ts), then the create route under the bank id, which takes the bank block from that mark. The
// operations get rollups and audit entries like imported ones, without the fake bank.
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { seedDoc } from './emulator-firestore'

const ORIGIN = { Origin: 'http://localhost:3000' }

export interface SeedBankOperation {
  /** Letters and digits; the operation id is `bk_<key>`. */
  key: string
  type: 'income' | 'expense'
  accountId: string
  amountMinor: number
  paymentDate: string
  /** The bank's text, also the comment of the operation (as the import makes it). */
  remittance: string
}

/** Returns the id of the operation. `page` must be signed in (its request context carries the session cookie). */
export async function seedBankOperation(page: Page, request: APIRequestContext, orgId: string, op: SeedBankOperation): Promise<string> {
  const bank = { accountRef: `ba-${op.accountId}`, entryReference: `ref-${op.key}`, counterpartyName: 'Własne konto', remittance: op.remittance }
  await seedDoc(request, `organizations/${orgId}/bankSeen`, op.key, {
    txId: `bk_${op.key}`,
    at: new Date().toISOString(),
    bank,
    snapshot: { type: op.type, accountId: op.accountId, amountMinor: op.amountMinor, paymentDate: op.paymentDate },
  })
  const res = await page.request.post(`/api/orgs/${orgId}/transactions`, {
    headers: ORIGIN,
    data: { clientId: `bk_${op.key}`, type: op.type, accountId: op.accountId, amountMinor: op.amountMinor, paymentDate: op.paymentDate, description: op.remittance },
  })
  expect(res.status(), `bank operation ${op.key}`).toBe(201)
  return `bk_${op.key}`
}
```

- [ ] **Step 2: Write the e2e spec and the 401 checks**

Створити `tests/e2e/transfers.spec.ts`:

```ts
// tests/e2e/transfers.spec.ts
// Own transfers (S10b): a suggested pair confirmed (Cash Flow counts neither side), a cash machine withdrawal turned into a
// transfer to the cash box and undone from the toast, two bank operations of different days merged from the selection bar
// and split back from the form.
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { registerViaUi, waitForShell, type RegisteredUser } from './helpers/app-ui'
import { dayFromToday } from './helpers/bank-seed'
import { readDoc } from './helpers/emulator-firestore'
import { seedLedgerAccount } from './helpers/ledger-seed'
import { seedBankOperation } from './helpers/transfer-seed'
import { todayDay } from '../../lib/utils/today'

const NEEDS_EMULATORS =
  'Needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"'

const rowsOf = (page: Page): Locator => page.locator('tbody').getByRole('row').filter({ has: page.getByRole('checkbox') })
const toast = (page: Page, text: string): Locator => page.locator('[data-sonner-toast]').filter({ hasText: text })
const accountRow = (page: Page, name: string): Locator =>
  page.getByRole('complementary', { name: 'Рахунки' }).getByRole('listitem').filter({ hasText: name })

/** The stored balance of an account in minor units (seeded numbers and the ledger's increments are doubles). */
async function balanceMinor(request: APIRequestContext, orgId: string, accountId: string): Promise<number> {
  const raw = (await readDoc(request, `organizations/${orgId}/accounts/${accountId}`))?.balanceMinor as unknown as
    | { doubleValue?: number; integerValue?: string }
    | undefined
  return Number(raw?.doubleValue ?? raw?.integerValue)
}

/** A PLN company with two bank accounts (1000 zł and 0) and a cash box, on the journal. */
async function setup(page: Page, request: APIRequestContext, prefix: string): Promise<RegisteredUser> {
  const user = await registerViaUi(page, prefix, 'PLN')
  await waitForShell(page, user.companyName)
  await seedLedgerAccount(request, user.orgId, 'acc-a', { name: 'Konto A', balance: 1000, currency: 'PLN' })
  await seedLedgerAccount(request, user.orgId, 'acc-b', { name: 'Konto B', balance: 0, currency: 'PLN' })
  await seedLedgerAccount(request, user.orgId, 'acc-cash', { name: 'Kasa', balance: 0, currency: 'PLN', type: 'cash' })
  await expect(accountRow(page, 'Kasa')).toBeVisible()
  return user
}

test.describe('own transfers (emulators)', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test('a suggested pair becomes one transfer: the balances stay and Cash Flow counts neither side', async ({ page, request }) => {
    const user = await setup(page, request, 'tr-pair')
    const day = todayDay()
    await seedBankOperation(page, request, user.orgId, { key: 'e2epairout1', type: 'expense', accountId: 'acc-a', amountMinor: 50_000, paymentDate: day, remittance: 'Przelew własny' })
    await seedBankOperation(page, request, user.orgId, { key: 'e2epairin01', type: 'income', accountId: 'acc-b', amountMinor: 50_000, paymentDate: day, remittance: 'Przelew własny' })
    await seedBankOperation(page, request, user.orgId, { key: 'e2esale0001', type: 'income', accountId: 'acc-a', amountMinor: 10_000, paymentDate: day, remittance: 'Faktura 1/11' })
    await page.goto(`/${user.orgId}/transactions`)
    await expect(rowsOf(page)).toHaveCount(3)

    const banner = page.getByTestId('transfer-suggestions')
    await expect(banner).toContainText('Знайдено можливих переказів між вашими рахунками: 1')
    await banner.getByRole('button', { name: 'Переглянути' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('checkbox', { name: /Konto A → Konto B/ })).toBeChecked()
    await dialog.getByRole('button', { name: 'Підтвердити вибрані' }).click()
    await expect(toast(page, 'Перекази створено: 1.')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(rowsOf(page)).toHaveCount(2)
    await expect(rowsOf(page).filter({ hasText: 'Konto A → Konto B' })).toHaveCount(1)
    await expect(banner).toHaveCount(0)
    expect(await balanceMinor(request, user.orgId, 'acc-a')).toBe(60_000)
    expect(await balanceMinor(request, user.orgId, 'acc-b')).toBe(50_000)

    await page.goto(`/${user.orgId}/analytics/cashflow`)
    await expect(page.getByTestId('cashflow-total-income')).toHaveText('100')
    await expect(page.getByTestId('cashflow-total-expense')).toHaveText('0')
  })

  test('a cash machine withdrawal becomes a transfer to the cash box, and «Скасувати» gives the expense back', async ({ page, request }) => {
    const user = await setup(page, request, 'tr-atm')
    await seedBankOperation(page, request, user.orgId, { key: 'e2eatm00001', type: 'expense', accountId: 'acc-a', amountMinor: 100_000, paymentDate: todayDay(), remittance: 'Bankomat Gdańsk' })
    await page.goto(`/${user.orgId}/transactions`)
    await expect(rowsOf(page)).toHaveCount(1)
    await expect(page.getByTestId('transfer-suggestions')).toHaveCount(0)

    await rowsOf(page).first().getByRole('checkbox').check()
    const bar = page.getByRole('region', { name: 'Вибрані операції' })
    await bar.getByRole('button', { name: 'Зробити переказом' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('#transfer-target').selectOption({ label: 'Kasa' })
    await dialog.getByRole('button', { name: 'Зробити переказом' }).click()
    await expect(dialog).toBeHidden()
    const done = toast(page, 'Перетворено на перекази: 1 з 1.')
    await expect(done).toBeVisible()
    await expect(rowsOf(page).filter({ hasText: 'Konto A → Kasa' })).toHaveCount(1)
    expect(await balanceMinor(request, user.orgId, 'acc-a')).toBe(0)
    await expect.poll(() => balanceMinor(request, user.orgId, 'acc-cash')).toBe(100_000)

    await done.getByRole('button', { name: 'Скасувати' }).click()
    await expect(rowsOf(page).filter({ hasText: 'Konto A → Kasa' })).toHaveCount(0)
    await expect(rowsOf(page)).toHaveCount(1)
    await expect(rowsOf(page).first()).toContainText('Bankomat Gdańsk')
    await expect.poll(() => balanceMinor(request, user.orgId, 'acc-cash')).toBe(0)
    expect(await balanceMinor(request, user.orgId, 'acc-a')).toBe(0)
  })

  test('two bank operations of different days are merged from the selection bar and split back from the form', async ({ page, request }) => {
    const user = await setup(page, request, 'tr-merge')
    await seedBankOperation(page, request, user.orgId, { key: 'e2emergeout', type: 'expense', accountId: 'acc-a', amountMinor: 30_000, paymentDate: dayFromToday(-1), remittance: 'Na Konto B' })
    await seedBankOperation(page, request, user.orgId, { key: 'e2emergein1', type: 'income', accountId: 'acc-b', amountMinor: 30_000, paymentDate: todayDay(), remittance: 'Z Konta A' })
    await page.goto(`/${user.orgId}/transactions`)
    await expect(rowsOf(page)).toHaveCount(2)

    for (const i of [0, 1]) await rowsOf(page).nth(i).getByRole('checkbox').check()
    const bar = page.getByRole('region', { name: 'Вибрані операції' })
    await expect(bar.getByRole('button', { name: 'Зробити переказом' })).toHaveCount(0)
    await bar.getByRole('button', { name: 'Об’єднати в переказ' }).click()
    await expect(toast(page, 'Операції об’єднано в переказ.')).toBeVisible()
    await expect(rowsOf(page)).toHaveCount(1)
    const transfer = rowsOf(page).filter({ hasText: 'Konto A → Konto B' })
    await expect(transfer.getByTestId('transfer-arrival')).toContainText('зарахування')
    await expect(transfer).toContainText('з банку')
    expect(await balanceMinor(request, user.orgId, 'acc-a')).toBe(70_000)
    expect(await balanceMinor(request, user.orgId, 'acc-b')).toBe(30_000)

    await transfer.getByRole('button', { name: /Konto A → Konto B/ }).click()
    const form = page.getByRole('dialog')
    await expect(form.getByTestId('bank-locked-hint')).toBeVisible()
    await expect(form.getByTestId('split-hint')).toBeVisible()
    await form.getByTestId('split-transfer').click()
    await expect(toast(page, 'Переказ розділено')).toBeVisible()
    await expect(form).toBeHidden()
    await expect(rowsOf(page)).toHaveCount(2)
    await expect(rowsOf(page).filter({ hasText: 'Konto A → Konto B' })).toHaveCount(0)
    expect(await balanceMinor(request, user.orgId, 'acc-a')).toBe(70_000)
    expect(await balanceMinor(request, user.orgId, 'acc-b')).toBe(30_000)
  })
})
```

`tests/e2e/api-guards.spec.ts`: перед рядком `  test('Enable Banking callback rejects a forged state before exchanging the code (400)', async ({ request }) => {` додати:

```ts
  // S10b: the transfer routes refuse a request without a session cookie, before they read any data.
  test('transfer endpoints require a session cookie (401)', async ({ request }) => {
    const origin = { Origin: 'http://localhost:3000' }
    const calls: { method: 'GET' | 'POST'; path: string; data?: object }[] = [
      { method: 'GET', path: '/api/orgs/x/transfers/suggestions' },
      { method: 'POST', path: '/api/orgs/x/transfers', data: { merge: ['a', 'b'] } },
      { method: 'POST', path: '/api/orgs/x/transfers/t1/split' },
    ]
    for (const { method, path, data } of calls) {
      const res = await request.fetch(path, { method, headers: origin, data })
      expect(res.status(), `${method} ${path}`).toBe(401)
    }
  })

```

- [ ] **Step 3: Write the screenshot spec**

Створити `tests/ui-shots/transfers.spec.ts`:

```ts
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { registerViaUi, waitForShell } from '../e2e/helpers/app-ui'
import { dayFromToday } from '../e2e/helpers/bank-seed'
import { seedLedgerAccount } from '../e2e/helpers/ledger-seed'
import { seedBankOperation } from '../e2e/helpers/transfer-seed'
import pl from '../../messages/pl.json'
import uk from '../../messages/uk.json'

// S10b: own transfers (the journal with the suggestions banner and a transfer row with its arrival day, the suggestions
// dialog, «Зробити переказом», the form of a bank transfer with «Розділити переказ») at 1440 and 390 px in uk and pl.
// Files: transfers-<state>-<desktop|phone>-<uk|pl>.png.
const OUT_DIR = join(process.cwd(), 'ui-shots')
const VIEWPORTS = [
  { form: 'desktop', width: 1440, height: 900 },
  { form: 'phone', width: 390, height: 844 },
] as const
const LOCALES = [
  ['uk', uk],
  ['pl', pl],
] as const
const ORIGIN = { Origin: 'http://localhost:3000' }

test.describe('transfers shots', () => {
  test.skip(
    !process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST,
    'Run with `npm run ui:shots` (it starts the Auth + Firestore emulators)',
  )

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true })
    for (const old of readdirSync(OUT_DIR)) {
      if (old.startsWith('transfers-') && old.endsWith('.png')) rmSync(join(OUT_DIR, old), { force: true })
    }
  })

  for (const [locale, messages] of LOCALES) {
    test(`transfers in ${locale}`, async ({ page, request, context }) => {
      test.setTimeout(300_000)
      await page.setViewportSize({ width: 1440, height: 900 })
      const user = await registerViaUi(page, `trshots${locale}`, 'PLN')
      await waitForShell(page, user.companyName)
      const org = user.orgId
      const m = messages.journal.transfers

      await seedLedgerAccount(request, org, 'acc-main', { name: 'Konto główne Millennium', balance: 25000, currency: 'PLN' })
      await seedLedgerAccount(request, org, 'acc-mono', { name: 'Monobank firmowy', balance: 4000, currency: 'PLN' })
      await seedLedgerAccount(request, org, 'acc-cash', { name: 'Kasa', balance: 1500, currency: 'PLN', type: 'cash' })
      // A pair the journal suggests (both today), a merged pair of two days, a cash machine withdrawal to convert.
      const op = (key: string, type: 'income' | 'expense', accountId: string, amountMinor: number, days: number, remittance: string) =>
        seedBankOperation(page, request, org, { key: `${locale}${key}`, type, accountId, amountMinor, paymentDate: dayFromToday(days), remittance })
      await op('sugout001', 'expense', 'acc-main', 150_000, 0, 'Przelew własny na Monobank')
      await op('sugin0001', 'income', 'acc-mono', 150_000, 0, 'Przelew z Millennium')
      const out = await op('mrgout001', 'expense', 'acc-main', 300_000, -3, 'Zasilenie konta Monobank')
      const inc = await op('mrgin0001', 'income', 'acc-mono', 300_000, -2, 'Zasilenie z Millennium')
      const merged = await page.request.post(`/api/orgs/${org}/transfers`, { headers: ORIGIN, data: { merge: [out, inc] } })
      expect(merged.status()).toBe(200)
      await op('atm000001', 'expense', 'acc-main', 100_000, -1, 'Bankomat Euronet Gdańsk')

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
          await page.screenshot({ path: join(OUT_DIR, `transfers-${state}-${viewport.form}-${locale}.png`), animations: 'disabled' })
        }
        const dialog = page.getByRole('dialog')
        const rows = page.locator('tbody').getByRole('row')

        await page.goto(`/${org}/transactions`)
        await waitForShell(page, user.companyName)
        const banner = page.getByTestId('transfer-suggestions')
        await expect(banner).toBeVisible()
        await expect(page.getByTestId(viewport.form === 'phone' ? 'transfer-arrival-phone' : 'transfer-arrival')).toBeVisible()
        await noHorizontalScroll('journal')
        await shot('journal')

        await banner.getByRole('button', { name: m.bannerOpen }).click()
        await expect(dialog.getByTestId('transfer-suggestion')).toHaveCount(1)
        await dialogFits('suggestions')
        await shot('suggestions')
        await dialog.getByRole('button', { name: m.later }).click()
        await expect(dialog).toBeHidden()

        // The withdrawal: select it, then «Зробити переказом» with the cash box chosen; cancelled, nothing changes.
        await rows.filter({ hasText: 'Bankomat Euronet' }).getByRole('checkbox').check()
        const bar = page.getByRole('region', { name: messages.journal.selection.region })
        await bar.getByRole('button', { name: m.convert }).click()
        await dialog.locator('#transfer-target').selectOption({ label: 'Kasa' })
        await dialogFits('convert')
        await shot('convert')
        await dialog.getByRole('button', { name: m.convertCancel }).click()
        await expect(dialog).toBeHidden()
        await bar.getByRole('button', { name: messages.journal.selection.clear }).click()

        // The merged transfer opens locked, with «Розділити переказ»; closed without a change.
        await rows.filter({ hasText: 'Zasilenie konta Monobank' }).getByRole('button', { name: /Millennium → Monobank/ }).click()
        await expect(dialog.getByTestId('split-transfer')).toBeVisible()
        await dialogFits('form')
        await shot('form')
        await page.keyboard.press('Escape')
        await expect(dialog).toBeHidden()
      }
    })
  }
})
```

- [ ] **Step 4: Run e2e and the screenshots**

```bash
cd /f/AI/finflow && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only auth,firestore --project demo-finflow "npx playwright test tests/e2e/transfers.spec.ts tests/e2e/api-guards.spec.ts tests/e2e/journal.spec.ts tests/e2e/transaction-form.spec.ts tests/e2e/banks.spec.ts tests/e2e/tags.spec.ts"
```

Expected: усі PASS (3 нові сценарії, 401 маршрутів переказів, наявні журнал, форма, банки й теги без змін: їхні дані не дають пар, тож банера немає).

```bash
cd /f/AI/finflow && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only auth,firestore --project demo-finflow "npx playwright test --config playwright.shots.config.ts tests/ui-shots/transfers.spec.ts"
```

Expected: PASS, у `ui-shots/` 16 файлів `transfers-*.png` (4 стани × 2 ширини × 2 мови). Переглянути їх (читанням зображень): банер і діалог не обрізані, довгі польські підписи кнопок панелі переносяться, «зарахування»/«wpływ» видно під датою (на телефоні під рахунком), діалоги вміщаються, на телефоні немає бічного прокручування.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add tests/e2e/helpers/transfer-seed.ts tests/e2e/transfers.spec.ts tests/e2e/api-guards.spec.ts tests/ui-shots/transfers.spec.ts && git commit -m "test(transfers): e2e of suggestions, conversion, merge and split; screenshots

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Документація і повна перевірка

**Files:**
- Modify: `CLAUDE.md`, `PROGRESS.md`

- [ ] **Step 1: CLAUDE.md**

1. У `## Project Overview` кінець рядка `Working today: ...` ` ... while the balances stay whole (S10t).` замінити на ` ... while the balances stay whole (S10t), and own transfers: the journal suggests bank-to-bank pairs, a bank operation becomes a transfer to a cash box, two bank operations merge into one transfer and every one splits back, the bank balances whole (S10b).`
2. У `## Folder Structure` після рядка `  api/orgs/[orgId]/tags/{route,[tagId],[tagId]/impact,[tagId]/recalculate}/route.ts  ← tags (S10t): list, create, edit, impact, recalculation steps` додати:

```
  api/orgs/[orgId]/transfers/{route,suggestions,[txId]/split}/route.ts  ← own transfers (S10b): make (pairs, merge, convert), suggestions, split
```

3. У розділі `## Banks (S09)` у пункті `**Provenance and lock:**` після речення `... category, counterparty, comment and accrual stay editable.` додати речення ` A transfer with bank sides (S10b) is locked per side, see «Own transfers (S10b)».`
4. У кінець файлу (після блоку `## Tags (S10t)`) додати:

```
## Own transfers (S10b)

Spec: `docs/superpowers/specs/2026-11-01-s10b-own-transfers-design.md`. Plan: `docs/superpowers/plans/2026-11-01-s10b-own-transfers.md`.

- **Data:** no new collections, indexes or rules. A transfer may carry `bank` (its outgoing side came from a bank), `bankTo` (`{ key, accountRef, entryReference?, counterpartyName?, remittance? }`: the incoming side was the bank income `bk_<key>`; its amount, currency and day are the transfer's `toAmountMinor`, `toCurrency`, `toDate ?? paymentDate`) and `toDate` (the day the money arrived on `toAccountId`, stored only when it differs from `paymentDate`, at most `MAX_ARRIVAL_DAYS` = 7 days away). Only the server writes them; a malformed `toDate`/`bankTo`, or either on an income or expense, makes the document unreadable (`verifyLedger` lists it as uncountable). `datedEffects` (`lib/domain/ledger/effects.ts`) is the one owner of «which account, which day, how much»: the money in of a transfer counts on `receivedOn(tx)` in the `cash_`/`x_cash_` rollups and in the journal's balance after a row (`dayOpsQuery` adds `toDate == day`, `arrivalShift` corrects the sums by payment day from the transfers paid within 7 days, no new index); the balances never depend on the day.
- **Pure rules (`lib/domain/ledger/transfer.ts`):** `bankSideOf` (an actual, non-recurring bank income or expense under its `bk_` id), `convertToTransfer` (an expense of A → A→B, an income of A → B→A with `bankTo`; one currency, B ≠ A), `mergeToTransfer` (a bank expense of A and a bank income of B → A→B under the expense id, both banks' real amounts, equal amounts in one currency, at most 7 days apart, tags merged to 10 with the dropped ones counted), `splitTransferSides` (back to the bank operations without a category; the income on its arrival day with the bank text as comment). Category, counterparty, accrual, rates and `autoRules` do not survive a conversion. `combineChanges` adds the change sets of one transaction.
- **Ledger (`lib/server/ledger/transfer.ts`):** `makeTransfer` (`convert` or `pair`, ONE Admin transaction through `applyChange`, audit `tx.update`/`tx.delete` with `via: 'transfer'`) and `splitTransfer` (a side in another currency gets its rates again before the transaction, which then requires the version read before, else `conflict`; the income is re-created under `bk_<key>`, audit `tx.create` with `via: 'transfer'`). A conversion refuses a target linked to a bank (`not_eligible` on `toAccountId`: that bank brings its own side); a merge needs the `bankSeen` mark of the income (it keeps the sync from importing it again; the sync only adds keys it has no mark for and never updates an operation). New code `not_eligible` (422).
- **Bank lock:** `assertBankUnlocked` keeps the type and every bank side: `bank` locks `accountId`, `amountMinor`, `paymentDate`; `bankTo` locks `toAccountId`, `toAmountMinor` and `toDate ?? paymentDate`; the other account, tags and comment stay editable. `updateTransaction` carries `bank`, `bankTo` and `toDate` from the prior document (`withBankSides`). The form locks the whole amount block of a bank transfer and offers «Розділити переказ» (`split-transfer`).
- **Undo of a delete:** a bank transfer comes back through the create route with `toDate` and `bankToKey` (internal create keys, never in a PATCH; `bankRestoreOf` in `lib/api/transaction-undo.ts`); `createTransaction` takes both bank blocks from the `bankSeen` marks only (`bankSidesOf`) and refuses a side that lives on already (its own operation exists or another transfer's `bankTo.key` holds it), so nothing counts a bank operation twice.
- **Suggestions:** `GET /api/orgs/{orgId}/transfers/suggestions` (every member) reads the operations of the last 90 days by `paymentDate` (at most 2000, selected fields, filtered in memory) and answers `{ pairs, total, ambiguous, truncated }`: a bank expense and a bank income of two accounts, same amount and currency, at most 3 days apart, each side with exactly one candidate, newest first, at most 50, each side with its version (`<seconds>.<nanoseconds>`). Turned-down pairs live in this browser only (`localStorage` `finflow:transfer-dismissed:<org>`, the newest 500). The journal reads them on load, when the dialog opens and after a transfer action (`finflow:transfers-changed`), never after an ordinary edit.
- **Routes:** `POST /api/orgs/{orgId}/transfers` with `{ pairs: [{ fromId, toId, versions }] }`, `{ merge: [a, b] }` or `{ convert: { ids (1-25), toAccountId } }` (owner, accountant; 64 KB) answers a result per pair or id (`ok` with `id`, `deletedId`, `droppedTags`, `before`, or a ledger code: `conflict`, `not_eligible`, `currency_mismatch`, `invalid_input`, `account_not_found`, `not_found`, `ledger_busy`, `unknown`); `POST /transfers/{txId}/split` (no body) answers `{ restored }`.
- **UI:** the journal banner (`transfer-suggestions`) and its dialog (`components/transactions/TransferSuggestions.tsx`: every pair ticked, failed pairs stay with the reason), «Зробити переказом» (`ConvertTransferDialog`) and «Об’єднати в переказ» in the selection bar (offered only for a selection `convertSourceOf`/`mergePairOf` accept), one undo toast for all of them (split, then the operations written back as they were); a bank transfer row has «з банку» and «зарахування <day>» (`transfer-arrival`, on a phone `transfer-arrival-phone`).
- **Rollout guard:** `npm run check:transfers -- --project=finflow-e94b5` (read-only; refuses production without the flag) counts per company the pairs, ambiguous sides and bank operations the suggestions see and the transfers that carry a bank side, and runs each new query shape once (a missing index shows as `FAILED_PRECONDITION`).
- **Tests:** unit `tests/unit/domain/ledger/transfer*.test.ts`, `tests/unit/domain/transfers/*`, `tests/unit/domain/journal/arrival.test.ts`, `tests/unit/api/transfers/routes.test.ts`, `tests/unit/api/{transfers-client,transfer-undo}.test.ts`, `tests/unit/server/transfers/run.test.ts`, `tests/unit/scripts/check-transfers.test.ts`; integration `tests/integration/{ledger-transfers,ledger-transfer-split,journal-transfers,transfers-read}.test.ts` (helper `transfer-helpers.ts`); e2e `tests/e2e/transfers.spec.ts` (seed `helpers/transfer-seed.ts`); screenshots `tests/ui-shots/transfers.spec.ts` (`playwright.shots.config.ts`).
```

- [ ] **Step 2: Run the whole verification**

```bash
cd /f/AI/finflow && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npm run typecheck && npm run lint && npm run check:server-imports && npm run test:unit && npm run test:rules && npm run test:integration && npm run build
```

```bash
cd /f/AI/finflow && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"
```

Expected: `tsc` чисто; `lint` 0 errors і не більше 10 попереджень; `check:server-imports` OK; unit, rules (без змін: 144 / 2), integration PASS; збірка успішна (маршрути `/api/orgs/[orgId]/transfers`, `.../suggestions`, `.../[txId]/split` у списку); e2e усі PASS. Записати фактичні числа (тести й файли кожного набору, час e2e) для PROGRESS.md і порівняти з базовими з шапки плану. Якщо інтеграційний прогін падає лише в `tests/integration/counterparties-write.test.ts` (відомий follow-up S10t: тайм-аут паралельного тесту), прогнати цей файл окремо й записати обидва результати; не виправляти його в цій гілці.

- [ ] **Step 3: PROGRESS.md**

У кінець `PROGRESS.md` (після запису `## 2026-10-29 — S10t: теги` з його «Known follow-ups») додати запис у тому ж форматі:

- заголовок `## 2026-11-01 — S10b: перекази між власними рахунками`, рядок зі спекою й планом;
- **Статус:** реалізовано в гілці `s10b-transfers`, чекає огляду й мерджа; на production нічого не розгорнуто; нових індексів і змін правил Firestore немає; перед злиттям потрібен `check:transfers` на production (окреме «ок» власника);
- `### Зроблено`: поля `toDate`/`bankTo` і правило нечитабельного документа; `datedEffects`/`receivedOn` як єдиний власник руху по днях; блокування обох банківських сторін і перенос сторін при редагуванні; чисті правила перетворення, злиття й розділення з властивостями; `makeTransfer` (перетворення з відмовою для рахунка з банком, злиття з обов'язковою позначкою `bankSeen`), `splitTransfer` (повторні курси, перевірка версії); відновлення видаленого банківського переказу з позначок (`bankSidesOf`, `bankRestoreOf`) без подвоєння сторін; залишок після рядка журналу на день зарахування (поправка спеки 3); пропозиції 90 днів (однозначність, ≤ 3 дні, до 50); маршрути; банер і діалог, «Зробити переказом», «Об’єднати в переказ», рядок і форма з «Розділити переказ», один тост скасування; `check:transfers`; відповіді на відкриті питання спеки (синхронізація лише додає; undo видалення відновлює переказ «як є» з позначок);
- `### Підсумок перевірок (дата, реально виміряно)`: числа з кроку 2 для `typecheck`, `lint` (errors/warnings), `check:server-imports`, unit, rules, integration, build, e2e, з порівнянням із базовими (unit 2281/162 за PROGRESS.md або 2289/162 за мерджем, rules 144/2, integration 289/29 або 290/29, e2e 126, lint 10);
- `### Не перевірено`: реальні дані production (`check:transfers` ще не запускався), чи справді production має індекс для `opsOfDay` з `toDate` і для `bankTo.key` (перевіряє `check:transfers`), поведінка на телефоні в реальному браузері, швидкість читання пропозицій на 2000 операціях production;
- `### Known follow-ups (S10b)`: пропозиції читають до 2000 документів при кожному відкритті журналу й діалогу (індекс `source` + `paymentDate` зменшив би читання); скасування перетворення чи злиття не повертає слід `autoRules` (як undo S10); форма блокує весь блок суми банківського переказу, хоча сервер дозволяє змінити небанківський рахунок; різновалютні пропозиції, злиття з уже введеною вручну операцією, комісії банку й розпізнавання за IBAN лишаються поза обсягом (спека); залишок після рядка переказу в журналі показує баланс вихідного рахунка навіть у фільтрі за рахунком призначення (як до S10b); злиття старше 7 днів між сторонами відмовляє (`MAX_ARRIVAL_DAYS`).

- [ ] **Step 4: Commit**

```bash
cd /f/AI/finflow && git add CLAUDE.md PROGRESS.md && git commit -m "docs(transfers): S10b own transfers in CLAUDE.md and PROGRESS.md

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Після реалізації (веде контролер, не субагент)

1. Огляд усієї гілки opus-рев'юером (свіжий контекст, еталон: спека, розділ «Spec corrections» і цей план), виправлення знахідок з тестами. Окремо перевірити: кожен запис переказу йде однією транзакцією через `changeSet`/`applyChange`; жоден шлях не дає банківській операції жити двічі (злиття, розділення, undo видалення, запит клієнта з `bk_`-id); журнал без `toDate` рахує точно як до S10b.
2. Візуальна перевірка: `npx firebase emulators:exec --only auth,firestore --project demo-finflow "npx playwright test --config playwright.shots.config.ts tests/ui-shots/transfers.spec.ts"` і перегляд усіх `ui-shots/transfers-*.png` на 1440 і 390 px українською й польською (довгі польські підписи кнопок панелі вибору, діалоги на телефоні, позначка «з банку», «зарахування»/«wpływ»); після змін оболонки чи токенів також `npm run ui:shots`.
3. `git push -u origin s10b-transfers`, чернетка PR (тіло англійською за зразком PR #17-#20, у кінці `🤖 Generated with [Claude Code](https://claude.com/claude-code)`), зелений CI (job `ci`). Якщо в CI падає e2e, якого не видно локально, спершу розібрати його з артефактів CI (звіт Playwright, трейси, скриншоти), знайти причину, виправити з тестом і перезапустити; не перезапускати наосліп.
4. Після зеленого CI, з окремого «ок» власника: на production лише читання `npm run check:transfers -- --project=finflow-e94b5` (крок «Розгортання» спеки). Якщо будь-яка компанія дає `FAILED_PRECONDITION` (потрібен індекс), зупинитись: створити індекс окремим погодженим кроком і лише потім зливати. Записати, скільки пар знайшлося б і скільки сторін неоднозначні.
5. **Зупинка і запит явного «ок» власника на злиття.** Далі кожен крок розгортання за окремим «ок»:
   1. Злиття PR. Деплою правил чи індексів немає (`firestore.rules` і `firestore.indexes.json` не змінено); міграції даних немає (без `toDate`/`bankTo` операції рахуються як раніше).
   2. Vercel production READY; перевірка без входу: `GET /api/orgs/x/transfers/suggestions` дає `401`; `verifyLedger` лише читання на production (власник: `POST /api/orgs/{org}/ledger/rebuild?apply=0`).
   3. Власник підтверджує свої пари (Millennium ↔ Monobank), робить банкомат переказом у касу, дивиться, що баланси банківських рахунків не змінились, Cash Flow і P&L більше не показують цих операцій, а «Розділити переказ» і «Скасувати» повертають усе як було; потім ще раз `verifyLedger` лише читання.
   4. Оновити пам'ять і хаб в Obsidian.

