# S11: Планові й повторювані платежі, пресети ZUS/PIT/VAT, зіставлення план → факт. План реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Власник задає серію (оренда, підписка, ZUS, PIT-4, VAT-7), і сервер створює справжні планові операції на 3 місяці наперед, щодня дозаповнюючи вікно. Планові операції не рухають баланси, агрегати, звіти й Календар. Журнал пропонує пари «планова операція ↔ банківська операція», людина підтверджує одним кліком, без дубля; кожне підтвердження, пропуск і видалення скасовується. Розділ «Планові платежі» показує прострочене, найближчі 7 днів і серії.

**Architecture:** Чистий домен `lib/domain/recurring/` (розклад за UTC-днями і `pl-calendar`, серія і її тіла, позначки чисел, план заповнення і переписування, пошук пар, огляд, пресети) і поля серії в операції `lib/domain/ledger/` (`seriesId`, `occurrence`, `estimated`, `manual`; `withSeries`, `markChangeOf`). Усі записи операцій ідуть через `lib/server/ledger/` в ОДНІЙ Admin-транзакції через `changeSet`/`combineChanges`/`applyChange`/`storedDoc`: створення, заповнення, зміна і видалення серії (`series.ts`), підтвердження і скасування пари, «Пропустити» (`plan-match.ts`), позначки `recurringDone` у `commit` для «Позначити сплаченою», видалення і відновлення (`write.ts`). Читання й запуски `lib/server/recurring/` (огляд, пропозиції, щоденний генератор із бюджетом часу), маршрути `app/api/orgs/[orgId]/recurring/**` і частина `recurring` у відповіді наявного `POST /api/cron/bank-sync`. Браузер: `lib/api/recurring-client.ts`, хуки, сторінка `/[org]/recurring`, редактор серії, банер і діалог збігів у журналі, чип «Прострочено», підказка «з серії …» у формі. Скрипт `check:recurring` (лише читання) перед розгортанням.

**Tech Stack:** Next.js 16 route handlers, firebase-admin (транзакції, `getAll`, запити в транзакції, `count()`, `select`, `collectionGroup`), Vitest (unit, властивості, інтеграційні на емуляторі Firestore, правила), Playwright (емулятори), next-intl (uk/pl/en).

**Spec:** `docs/superpowers/specs/2026-11-10-s11-planned-payments-design.md` (затверджено власником 2026-11-10; рішення власника не переглядаються).

**Гілка:** `s11-planned-payments` (вже створена, на ній лежить спека). Усі коміти в неї. Кінець кожного повідомлення коміту: порожній рядок і `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Додавати файли поіменно (`git add <файли>`), ніколи `git add -A`.

**Робоче середовище (Windows, Git Bash):** репозиторій `F:\AI\finflow`. Для емулятора Firestore потрібна Java: `export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH"`. Не вбивати процеси за ім'ям образу (`taskkill /IM node.exe` заборонено). Не робити junction на `node_modules`.

**Закінчення рядків:** робоча копія CRLF, індекс LF (`core.autocrlf=true`). Наявні файли змінювати інструментом Edit (він зберігає CRLF); нові файли можна писати Write (LF), git нормалізує сам. Ніколи не переписувати наявний файл цілком через Write, якщо задача не каже «замінити файл повністю».

**Базові числа (прочитано в `PROGRESS.md`, записи S10b і S10f; повні набори в цьому плані не запускались):** unit 2530 тестів / 182 файли (S10f, 2026-11-04), rules 144 / 2 (S10b), integration 321 / 33 (S10b), e2e 138 (S10f), `lint` 0 errors / 10 warnings. Task 16 вимірює нові числа й порівнює з цими.

**Правила репозиторію, що діють у кожній задачі:** React Compiler lint (жодного синхронного `setState` у тілі ефекту: лише в колбеках промісів, таймерів і обробниках); каталоги `messages/{uk,pl,en}.json` мають однакові ключі й однакові імена аргументів ICU (`tests/unit/i18n/catalogs.test.ts`); жодного кириличного тексту в коді `app/(app)`, `components`, `lib`, `types` (`tests/unit/i18n/no-hardcoded-text.test.ts`; коментарі можна; `aria-label`/`placeholder`/`title` лише через `t()`); `new Intl.*` і `toLocale*()` лише в `lib/i18n` і `lib/utils`; `lib/server/**` імпортує `firebase-admin`, клієнтський код ні; кожен обробник під `app/api` викликає `await requireUser(req)` (крім `cron/bank-sync`, він в allow-list); кольори лише токенами; гроші лише в цілих мінорних одиницях; дні лише рядками `YYYY-MM-DD` (UTC-день, «сьогодні» Варшави дає `deps.today()` / `todayDay()`); кожна зміна `transactions`, `accounts`, `rollups`, `audit` іде через `lib/server/ledger` в одній транзакції; `npm run lint` без нових попереджень (зараз 10).

**Каталоги повідомлень:** файли `messages/*.json` записані рівно як `JSON.stringify(data, null, 2)` плюс перенос рядка (у робочій копії CRLF). Task 11 додає всі ключі S11 тимчасовим скриптом `tmp-i18n.cjs` у корені (створити інструментом Write, щоб кирилиця лишилась UTF-8; `node tmp-i18n.cjs`; `rm tmp-i18n.cjs`; не комітити), як у планах S10t і S10b. Апостроф в українських текстах — `’` (U+2019), бо прямий `'` в ICU є символом екранування.

---

## Відповіді на відкриті питання спеки (рішення плану, прочитано в коді)

1. **`isRecurring` і `seriesId`.** Код: `isRecurring` це булевий прапорець форми S07 (чекбокс «Повторювана транзакція» у «Додатково»), клієнт його ставить і змінює (`CREATE_KEYS`/`PATCH_KEYS` у `lib/domain/ledger/input.ts`), жодної поведінки, крім того, що S10b не бере таку операцію в переказ (`bankSideOf` у `lib/domain/ledger/transfer.ts`, поправка спеки S10b 17: «не прив'язана до шаблону» = `isRecurring === false`). **Рішення:** генератор `isRecurring` не ставить (завжди `false`); належність до серії має одне подання: серверні поля `seriesId` + `occurrence` (і `estimated`, `manual`), які клієнт не може надіслати (їх немає в `CREATE_KEYS`/`PATCH_KEYS`, тож тіло з ними дає `400 invalid_input`). `isRecurring` зберігає своє одне значення (позначка людини з форми). Справжня прив'язка до шаблону тепер `seriesId`, тому `bankSideOf` додатково відмовляє операції з `seriesId` (банківська операція, що сплатила план, прив'язана до серії: переказ з неї осиротив би позначку `paid`); перевірка `isRecurring` лишається як була, тож поведінка S10b для наявних даних не змінюється. Банківська операція отримує `seriesId`/`occurrence` лише при підтвердженні пари і втрачає їх при скасуванні.
2. **Один запуск за день і час маршруту.** Код: `app/api/cron/bank-sync/route.ts` має `maxDuration = 60`; `runBackgroundSync` має бюджет 45 с (`BACKGROUND_BUDGET_MS`), а крок, почавшись, може тривати до 20 с запиту до банку. **Рішення:** прапорець дня лежить на документі серії: `dueOn` = варшавський день, коли серії знову потрібне заповнення (завтра після заповнення; відсутній, коли серія призупинена або закінчилась). Генератор читає `collectionGroup('recurring').where('dueOn', '<=', today).orderBy('dueOn').limit(200)` (найдовше чекають першими) і заповнює кожну серію ОКРЕМОЮ транзакцією, яка ще раз перевіряє `dueOn` усередині, тож паралельні виклики нічого не дублюють (детермінований id + `t.create` лише відсутнього + позначки). Він іде ПІСЛЯ банківського оновлення (денні ліміти банку важливіші) і отримує залишок часу: `min(10 с, 55 с − вже витрачене)`; бюджет перевіряється перед кожною серією, тож одна година без часу просто переходить на наступну годину (виклик щогодини). Одна серія чи компанія, що падає, не зупиняє інших (try/catch на серію); постійна помилка (рахунку немає тощо) переносить `dueOn` на завтра (не забиває кожну годину), тимчасова (`ledger_busy`, `conflict`) лишає `dueOn`, щоб спробувати за годину. **Наздоганяння:** заповнення починається з дня після `generatedThrough` (останнього заповненого дня вікна), тож якщо виклик не приходив кілька днів чи тижнів, перше ж заповнення створює всі пропущені числа (минулі стають «Прострочено», нічого не губиться), не більше 100 чисел на серію за раз (`MAX_FILL_PER_SERIES`; решта в наступному виклику, `dueOn` лишається сьогоднішнім). Помилка самого читання серій (наприклад, відсутній індекс) повертає `recurring.failed: 1`, а `.github/workflows/bank-sync.yml` фарбує job червоним при `recurring.failed > 0`.
3. **`nextOccurrence` на серії чи запит планових операцій.** **Рішення:** поля `nextOccurrence` немає. Його довелося б оновлювати в кожному шляху, що торкається планової операції (форма, масові дії, видалення, підтвердження, пропуск, перенесення), тобто мати другу копію факту, яку планові операції вже несуть. `GET /recurring` рахує огляд на читанні: серії (до 100), `count()` прострочених, до 50 найстаріших прострочених, і планові операції від сьогодні до кінця вікна (до 1500 документів, `select` полів). «Наступна дата» серії = перша її планова операція від сьогодні; якщо в вікні її немає (усе пропущено, або річна серія), то перше число розкладу після `generatedThrough` (там позначок ще бути не може). Смуга «Найближчі 7 днів» = суми цих операцій за 7 днів окремо для надходжень і витрат, за валютами.

## Spec corrections (тлумачення в межах спеки)

1. **Перше число і фаза.** «Перше число на `startDate`» тлумачиться як перший день за правилом не раніше `startDate`; для «кожні N місяців» і «щороку» відлік періодів іде від місяця `startDate` (річна серія повторює місяць `startDate`, день `dayOfMonth`, 29 лютого стає 28). `weekday` це ISO-день (1 понеділок … 7 неділя).
2. **Вікно при створенні.** Серія створює числа від сьогодні (не з минулого `startDate`) до сьогодні + 3 місяці включно (`addMonthsClamped`). Минулі числа з'являються лише при наздоганянні (питання 2).
3. **Номер і дата.** `occurrence` це номінальне число за правилом (воно в id `pl_<seriesId>_<occurrence>`), `paymentDate` планової операції це число після `weekendRule`. Вікно пар «−3 … +10 днів» рахується від `paymentDate` планової операції (саме цього дня людина чекає платіж).
4. **«Змінено вручну».** Рішення власника 5 («виправлена вручну операція … серію більше не слухає») застосовується до будь-якої зміни людиною поля, яке задає серія, на плановій операції серії: тип, рахунок, сума, дата, категорія, контрагент, опис, теги. Зміна суми ще й знімає `estimated`. Файли не рахуються. «Позначити сплаченою» не робить `manual` (операція вже не план). Інакше зміна серії мовчки переписала б категорію чи опис, які людина вибрала.
5. **Позначка `paid` від форми.** «Позначити сплаченою» лишає операції `seriesId`, `occurrence`, `estimated`, `manual` і пише позначку `paid` з `txId` = id самої операції; повернення в план (undo, ручна зміна статусу) знімає цю позначку. Видалення фактичної операції серії позначку не чіпає (число лишається сплаченим).
6. **Позначка `deleted` і відновлення.** Видалення планової операції серії людиною (форма, масове видалення) пише позначку `deleted` з прапорцями операції. Префікс `pl_` зарезервований, як `bk_`: клієнт не може створити операцію з таким id; маршрут створення (він передає `internal`) відновлює її лише за позначкою `deleted`, `skipped` або `paid` самої себе, бере `seriesId`/`occurrence`/`estimated`/`manual` з позначки і знімає її (або лишає `paid` для фактичної). Так працює «Скасувати» видалення і «Пропустити».
7. **Прив'язка банківської операції.** Підтверджена пара дає банківській операції `seriesId` і `occurrence` (номер `bk_…` і `bankSeen` не змінюються). Пропозиції пропускають банківські операції з `seriesId` («непов'язана» з спеки), S10b не бере їх у переказ (питання 1). Позначка `paid` зберігає документ планової операції, її `createdAt`/`createdBy` і перенесені поля; скасування повертає план точно (той самий документ і порядок у журналі) і знімає лише ті перенесені поля, які досі не змінені.
8. **Зміна серії й сплачені періоди.** Переписування бере числа нового розкладу від сьогодні до кінця вікна, крім тих, чий період (тиждень, місяць, блок N місяців або рік нового розкладу) уже «зайнятий»: є позначка числа цієї серії (`paid`, `skipped`, `deleted`) або операція серії, яку зміна не переписує (фактична, `manual`, минула). Без цього зміна дня з 10-го на 20-те після оплати листопада 10-го створила б другий листопадовий платіж. Неоплачені не-`manual` майбутні операції з числом, якого в новому розкладі немає, видаляються без позначки, нові створюються; з тим самим числом оновлюються на місці.
9. **Контрагент пресету.** Системні записи S06 (`system_zus`, `system_us`) не мають NIP, тож «дублі за NIP» тут означає: спершу запис за фіксованим id, потім власник ключа назви (`counterpartyKeys/name_zus`), і лише якщо немає жодного, запис створюється в тій самій транзакції (як `seedExistingOrg`). Архівний записується як є, і створення відмовляє `422 counterparty_archived`.
10. **Коди маршрутів.** Не член компанії дістає `403 forbidden` (як усі маршрути, `requireOrgRole`); серія іншої компанії або неіснуюча дає `404 not_found`; непридатний id у шляху дає `404` (як `tags/{tagId}`, `transactions/{txId}`), непридатні id у тілі дають `400 invalid_input` з `field`.
11. **Що не змінюється в серії.** `kind` і `preset` фіксуються при створенні (PATCH їх не приймає); `currency` завжди валюта рахунку серії. Рахунок, яким користується серія, не можна видалити чи змінити йому валюту (`409 account_has_operations`, `field: 'recurring'`), бо генератор лишився б без рахунку.
12. **Що лишається після видалення серії.** Збережені майбутні планові операції («лишити») зберігають `seriesId` як слід; ні генератор, ні огляд не читають серію для них. Позначки `recurringDone` лишаються (історія; їх ніхто не видаляє).
13. **Огляд рахує всі планові операції.** «Прострочено: N» і «Найближчі 7 днів» рахують усі планові операції компанії (і ручні, не з серії); «Пропустити» доступне лише для операцій серії.
14. **`version` серії** це лічильник, +1 при кожній зміні людиною (PATCH); заповнення генератором його не змінює. Записи генератора мають `createdBy`/`uid` аудиту `system` (як `seedExistingOrg`).
15. **Ліміти записів.** Транзакція зміни чи видалення серії читає не більше 100 майбутніх операцій серії (`REWRITE_CAP`; понад це `409 limit_reached`, `field: 'planned'`, практично недосяжно: тижнева серія має ≤ 14 чисел у вікні), тож пише ≤ 2 × (100 + 14) + 2 документів, нижче межі Firestore 500.
16. **Скасування пари** — тіло `{ undo: [planId] }` того самого `POST /recurring/matches` (окремого маршруту в спеці немає).

## Рішення плану (в межах спеки)

- **Один власник кожного правила.** Розклад, період, день платежу, вікно: `lib/domain/recurring/schedule.ts`. Що створює одне заповнення і що переписує зміна: `plan.ts` (чисті `fillPlan`, `rewriteOccurrences`). Пари: `match.ts` (його `parsePlanSide`/`parseBankSide`/`canMatch` бере і читання пропозицій, і транзакція підтвердження). Рядки планових операцій: `rows.ts`. Позначки: `markChangeOf` у `lib/domain/ledger/series.ts` (одне правило для `commit`). Валідація тіла серії: одна функція `parseSeriesInput` (її бере й `parseSeries` для збереженого документа, і `applySeriesPatch`).
- **Одне правило запису.** Кожна транзакція з операціями бере `changeSet`/`combineChanges` + `applyChange` + `storedDoc` + `auditData(..., { via: 'plan' })` з `lib/server/ledger`. Планові операції дають порожній `changeSet` (`datedEffects`/`contributions` повертають нічого для `planned`), але проходять тим самим шляхом, тож `verifyLedger` бачить їх як звичайні.
- **Посилання серії, що зникли.** Генератор і переписування не падають через видалену категорію, архівного контрагента чи тег: такі поля просто не переходять у нові планові операції (правило «не перевіряти те, що не дається заново», як у S10/S10t); нове або змінене посилання в тілі серії перевіряється строго (`422 category_not_found` тощо). Рахунку немає: серія падає (`account_not_found`).
- **Індекси (точний список, Task 10):** `transactions (status ASC, paymentDate ASC)` для огляду і планових кандидатів пар; `transactions (seriesId ASC, paymentDate ASC)` для майбутніх операцій серії; `recurringDone (seriesId ASC, occurrence ASC)` для зайнятих періодів при переписуванні; `fieldOverrides` `recurring.dueOn` з `COLLECTION_GROUP ASCENDING` для генератора. Банківська частина пар бере форму запиту пропозицій S10b (`paymentDate` діапазон + `orderBy desc`), без нового індексу. Емулятор індекси не вимагає: `check:recurring` запускає кожну нову форму запиту на проді лише читанням.
- **Межі читань (правила продуктивності):** пропозиції читають планових кандидатів (`status == planned`, `paymentDate` від сьогодні − 90 до сьогодні + 3, до 500), і лише якщо такі є, банківські операції діапазону `[перший план − 3, min(сьогодні, останній план + 10)]` (до 2000); назви серій лише для знайдених пар (`getAll`, до 50). Огляд: до 100 + 1 агрегат + 50 + 1500 документів. Журнал читає пропозиції при відкритті, при відкритті діалогу і після дій зіставлення (`finflow:recurring-changed`), не після кожного редагування.
- **Відхилені пари** лише в цьому браузері: `localStorage` `finflow:plan-dismissed:<org>` (500 найновіших, усе в `try/catch`), тими самими функціями, що S10b (`readDismissed`/`writeDismissed` отримують необов'язковий префікс).
- **Версії** пар мають вигляд S10b `<секунди>.<9 цифр наносекунд>`; `timestampOf` переїжджає з `lib/server/transfers/run.ts` у спільний `lib/server/ledger/version.ts` (одне місце, обидва потоки його беруть).
- **Тексти з кількістю** через двокрапку, без ICU-множин, як у S10/S10t/S10b.
- **Нових `LedgerErrorCode` немає.** Пари й пропуск відмовляють наявними `not_eligible`, `conflict`, `not_found`; помилки серії мають свій клас `RecurringError` (`invalid_input` 400 з `field`, `not_found` 404, `limit_reached` 409), який `lib/server/recurring/http.ts` перетворює, а все інше віддає `toHttpError` з `lib/server/ledger/http.ts` (там нічого не змінюється).

---

## Карта файлів

| Файл | Дія | Відповідальність |
|---|---|---|
| `lib/domain/recurring/types.ts` | створити | константи, типи серії, позначки, огляду, пар, запитів |
| `lib/domain/recurring/schedule.ts` | створити | місяці, вікно, ISO-день, день платежу, числа розкладу, період |
| `lib/domain/recurring/{errors,presets,input,doc,plan}.ts` | створити | `RecurringError`; пресети; тіла запитів; документи серії й позначки; заповнення, переписування, вхід планової операції |
| `lib/domain/recurring/{rows,match,overview,dismissed}.ts` | створити | рядок планової операції; пари й перенесені поля; огляд; відхилені пари |
| `lib/domain/recurring/editor.ts` | створити | стан редактора серії, перевірка, тіло й PATCH |
| `lib/domain/ledger/{types,doc,input}.ts` | змінити | поля `seriesId`/`occurrence`/`estimated`/`manual`, префікс `pl_` |
| `lib/domain/ledger/series.ts` | створити | `withSeries`, `markChangeOf` |
| `lib/domain/ledger/transfer.ts`, `lib/domain/transfers/{types,pairs,dismissed}.ts` | змінити | `bankSideOf` без операцій серії; `seriesId` кандидата; префікс відхилених |
| `types/index.ts`, `lib/firebase/ledger-map.ts` | змінити | поля серії в UI-операції |
| `lib/server/ledger/{paths,audit,write,transfer,accounts,index}.ts` | змінити | колекції, `via: 'plan'`, позначки в `commit`, `operationOf`, захист рахунку, експорт |
| `lib/server/ledger/{series,plan-match,version}.ts` | створити | серія (створити, заповнити, змінити, видалити); пара і пропуск; `timestampOf` |
| `lib/server/transfers/run.ts` | змінити | `timestampOf` зі спільного модуля |
| `lib/server/recurring/{read,run,cron,http,index}.ts` | створити | огляд і пропозиції; запуск пар; щоденний генератор; помилки; сервіс |
| `app/api/orgs/[orgId]/recurring/{route,[seriesId]/route,[seriesId]/skip/route,suggestions/route,matches/route}.ts` | створити | маршрути |
| `app/api/cron/bank-sync/route.ts`, `.github/workflows/bank-sync.yml` | змінити | частина `recurring` і перевірка її `failed` |
| `firestore.rules`, `firestore.indexes.json` | змінити | `recurring` читають члени, `recurringDone` закрито; індекси |
| `scripts/check-recurring.ts`, `scripts/lib/check-recurring.ts`, `package.json` | створити / змінити | `npm run check:recurring` |
| `lib/api/{recurring-client,recurring-actions}.ts`, `lib/hooks/{useRecurringOverview,usePlanMatches,useSeriesName}.ts` | створити | виклики, події, дії з плановою операцією, хуки |
| `messages/{uk,pl,en}.json` | змінити | `recurring.*`, `journal.plans.*`, `journal.list.overdue`, `forms.transaction.series*`, `shell.modules.recurring` |
| `lib/shell/modules.ts` | змінити | вкладка «Планові платежі» |
| `app/(app)/[orgSlug]/recurring/page.tsx`, `components/recurring/*.tsx` | створити | сторінка, смуга, серії, найближчі операції, редактор, діалоги |
| `components/transactions/{PlanMatches,TransactionList}.tsx`, `app/(app)/[orgSlug]/transactions/page.tsx`, `components/forms/transaction/TransactionForm.tsx` | створити / змінити | банер і діалог збігів, чип «Прострочено», підказка серії |
| `tests/unit/domain/recurring/*.test.ts`, `tests/unit/domain/ledger/series.test.ts` | створити | розклад, вхід, документи, план, пари, огляд, редактор, властивості, поля серії |
| `tests/unit/server/recurring/*.test.ts`, `tests/unit/api/recurring/routes.test.ts`, `tests/unit/api/cron/bank-sync.test.ts`, `tests/unit/api/recurring-client.test.ts`, `tests/unit/scripts/check-recurring.test.ts`, `tests/unit/shell/modules.test.ts` | створити / змінити | запуск, помилки, маршрути, cron, клієнт, скрипт, вкладки |
| `tests/integration/recurring-helpers.ts`, `tests/integration/{ledger-plan-marks,ledger-series,ledger-plan-match,recurring-read}.test.ts` | створити | інтеграційні тести |
| `tests/rules/firestore.rules.test.ts` | змінити | матриця колекцій |
| `tests/e2e/helpers/recurring-seed.ts`, `tests/e2e/recurring.spec.ts`, `tests/e2e/api-guards.spec.ts`, `tests/ui-shots/recurring.spec.ts` | створити / змінити | e2e і скриншоти |
| `CLAUDE.md`, `PROGRESS.md`, `docs/superpowers/specs/2026-10-22-finflow-roadmap.md` | змінити | документація |

---

### Task 1: Чистий розклад `lib/domain/recurring/schedule.ts` і типи S11

**Files:**
- Create: `lib/domain/recurring/types.ts`, `lib/domain/recurring/schedule.ts`
- Test: `tests/unit/domain/recurring/schedule.test.ts`

- [ ] **Step 1: Write the failing test**

Створити `tests/unit/domain/recurring/schedule.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  addMonthsClamped,
  daysInMonth,
  isoWeekday,
  nextOccurrenceAfter,
  occurrencesBetween,
  paymentDayOf,
  periodOf,
  periodStart,
  windowEnd,
} from '@/lib/domain/recurring/schedule'
import type { Schedule } from '@/lib/domain/recurring/types'

const monthly = (dayOfMonth: number, startDate: string, extra: Partial<Schedule> = {}): Schedule => ({
  frequency: 'monthly', interval: 1, dayOfMonth, weekday: null, startDate, weekendRule: 'none', ...extra,
})
const weekly = (weekday: number, startDate: string, extra: Partial<Schedule> = {}): Schedule => ({
  frequency: 'weekly', interval: 1, dayOfMonth: null, weekday, startDate, weekendRule: 'none', ...extra,
})
const quarterly: Schedule = { frequency: 'everyNMonths', interval: 3, dayOfMonth: 10, weekday: null, startDate: '2026-01-10', weekendRule: 'none' }

describe('month arithmetic', () => {
  it('knows the length of a month, February of a leap year too', () => {
    expect(daysInMonth(2027, 2)).toBe(28)
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2026, 11)).toBe(30)
    expect(daysInMonth(2026, 12)).toBe(31)
  })

  it('adds months and takes the last day of a shorter month', () => {
    expect(addMonthsClamped('2026-11-30', 3)).toBe('2027-02-28')
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsClamped('2027-12-15', 1)).toBe('2028-01-15')
    expect(addMonthsClamped('2027-11-29', 3)).toBe('2028-02-29')
  })

  it('the window reaches three months ahead', () => {
    expect(windowEnd('2026-11-10')).toBe('2027-02-10')
    expect(windowEnd('2026-11-30')).toBe('2027-02-28')
  })

  it('numbers the weekdays from Monday', () => {
    expect(isoWeekday('2026-11-16')).toBe(1)
    expect(isoWeekday('2026-11-10')).toBe(2)
    expect(isoWeekday('2026-11-15')).toBe(7)
  })
})

describe('occurrencesBetween', () => {
  it('the 31st falls on the last day of shorter months (28 or 29 February)', () => {
    expect(occurrencesBetween(monthly(31, '2026-12-01'), '2026-12-01', '2027-04-30')).toEqual([
      '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30',
    ])
    expect(occurrencesBetween(monthly(31, '2028-01-01'), '2028-02-01', '2028-02-29')).toEqual(['2028-02-29'])
  })

  it('starts with the first rule day on or after the start', () => {
    expect(occurrencesBetween(monthly(15, '2026-11-20'), '2026-11-01', '2027-01-31')).toEqual(['2026-12-15', '2027-01-15'])
    expect(occurrencesBetween(monthly(15, '2026-11-15'), '2026-11-01', '2026-12-31')).toEqual(['2026-11-15', '2026-12-15'])
  })

  it('lists only the days inside the range, both ends included', () => {
    expect(occurrencesBetween(monthly(10, '2026-01-10'), '2026-11-10', '2027-02-10')).toEqual(['2026-11-10', '2026-12-10', '2027-01-10', '2027-02-10'])
    expect(occurrencesBetween(monthly(10, '2026-01-10'), '2026-11-11', '2026-12-09')).toEqual([])
    expect(occurrencesBetween(monthly(10, '2026-01-10'), '2026-12-01', '2026-11-01')).toEqual([])
  })

  it('stops at the end day, which counts', () => {
    expect(occurrencesBetween(monthly(15, '2026-11-01', { endDate: '2027-01-15' }), '2026-11-01', '2027-06-30')).toEqual(['2026-11-15', '2026-12-15', '2027-01-15'])
    expect(occurrencesBetween(monthly(15, '2026-11-01', { endDate: '2027-01-14' }), '2026-11-01', '2027-06-30')).toEqual(['2026-11-15', '2026-12-15'])
  })

  it('a weekly series takes its weekday every seven days', () => {
    expect(occurrencesBetween(weekly(1, '2026-11-10'), '2026-11-10', '2026-12-01')).toEqual(['2026-11-16', '2026-11-23', '2026-11-30'])
    expect(occurrencesBetween(weekly(2, '2026-11-10'), '2026-11-10', '2026-11-24')).toEqual(['2026-11-10', '2026-11-17', '2026-11-24'])
    expect(occurrencesBetween(weekly(1, '2026-01-05'), '2026-11-17', '2026-12-01')).toEqual(['2026-11-23', '2026-11-30'])
  })

  it('every N months keeps the phase of the start month', () => {
    expect(occurrencesBetween(quarterly, '2026-01-01', '2026-12-31')).toEqual(['2026-01-10', '2026-04-10', '2026-07-10', '2026-10-10'])
    expect(occurrencesBetween(quarterly, '2026-05-01', '2027-01-31')).toEqual(['2026-07-10', '2026-10-10', '2027-01-10'])
    expect(occurrencesBetween({ ...quarterly, startDate: '2026-01-20' }, '2026-01-01', '2026-07-31')).toEqual(['2026-04-10', '2026-07-10'])
  })

  it('a yearly series repeats the month of its start; 29 February becomes 28 in other years', () => {
    const yearly: Schedule = { frequency: 'yearly', interval: 1, dayOfMonth: 29, weekday: null, startDate: '2024-02-29', weekendRule: 'none' }
    expect(occurrencesBetween(yearly, '2024-01-01', '2028-12-31')).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29'])
  })

  it('does not move with the summer time change: days are calendar days', () => {
    // Poland: the clocks go forward on 2027-03-28 and back on 2026-10-25.
    expect(occurrencesBetween(weekly(1, '2027-03-15'), '2027-03-15', '2027-04-05')).toEqual(['2027-03-15', '2027-03-22', '2027-03-29', '2027-04-05'])
    expect(occurrencesBetween(monthly(25, '2026-09-01'), '2026-09-01', '2026-11-30')).toEqual(['2026-09-25', '2026-10-25', '2026-11-25'])
  })
})

describe('paymentDayOf (Polish business days)', () => {
  it('keeps a business day, and every day without a rule', () => {
    expect(paymentDayOf('2026-11-16', 'next')).toBe('2026-11-16')
    expect(paymentDayOf('2026-11-15', 'none')).toBe('2026-11-15')
  })

  it('moves a weekend to the next or the previous business day', () => {
    expect(paymentDayOf('2026-11-15', 'next')).toBe('2026-11-16')
    expect(paymentDayOf('2026-11-15', 'previous')).toBe('2026-11-13')
  })

  it('skips holidays: 11 November, Christmas Eve and Christmas, Easter Monday', () => {
    expect(paymentDayOf('2026-11-11', 'next')).toBe('2026-11-12')
    expect(paymentDayOf('2026-12-25', 'next')).toBe('2026-12-28')
    expect(paymentDayOf('2026-12-26', 'previous')).toBe('2026-12-23')
    // Easter Sunday 2027 is 28 March, the day the clocks go forward; Easter Monday is a holiday too.
    expect(paymentDayOf('2027-03-28', 'next')).toBe('2027-03-30')
  })

  it('the clocks going back on 25 October 2026 do not shift the day', () => {
    expect(paymentDayOf('2026-10-25', 'next')).toBe('2026-10-26')
  })
})

describe('periods', () => {
  it('an occurrence stands for its week, month, block of N months or year', () => {
    expect(periodOf(weekly(1, '2026-01-05'), '2026-11-18')).toBe('2026-11-16')
    expect(periodOf(monthly(10, '2026-01-10'), '2026-11-20')).toBe('2026-11')
    expect(periodOf({ ...quarterly, frequency: 'yearly' }, '2026-11-20')).toBe('2026')
    expect(periodOf(quarterly, '2026-05-02')).toBe('1')
    expect(periodOf(quarterly, '2026-03-31')).toBe('0')
  })

  it('the first day of the period a day is in', () => {
    expect(periodStart(weekly(1, '2026-01-05'), '2026-11-18')).toBe('2026-11-16')
    expect(periodStart(monthly(10, '2026-01-10'), '2026-11-20')).toBe('2026-11-01')
    expect(periodStart({ ...quarterly, frequency: 'yearly' }, '2026-11-20')).toBe('2026-01-01')
    expect(periodStart(quarterly, '2026-05-02')).toBe('2026-04-01')
  })
})

describe('nextOccurrenceAfter', () => {
  it('is the first occurrence strictly after the day, or null once the series ended', () => {
    expect(nextOccurrenceAfter(monthly(15, '2026-01-15'), '2026-11-15')).toBe('2026-12-15')
    expect(nextOccurrenceAfter(monthly(15, '2026-01-15', { endDate: '2026-11-30' }), '2026-11-15')).toBeNull()
    const biennial: Schedule = { frequency: 'everyNMonths', interval: 24, dayOfMonth: 1, weekday: null, startDate: '2026-01-01', weekendRule: 'none' }
    expect(nextOccurrenceAfter(biennial, '2026-01-01')).toBe('2028-01-01')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/recurring/schedule.test.ts`
Expected: FAIL (`@/lib/domain/recurring/schedule` не існує).

- [ ] **Step 3: Implement**

Створити `lib/domain/recurring/types.ts`:

```ts
import type { TxType } from '@/lib/domain/ledger/types'

/** Schema of a series document (`organizations/{org}/recurring/{id}`, S11). */
export const RECURRING_SCHEMA_VERSION = 1
/** Schema of an occurrence mark (`organizations/{org}/recurringDone/{planId}`, S11). */
export const DONE_SCHEMA_VERSION = 1

export const FREQUENCIES = ['weekly', 'monthly', 'everyNMonths', 'yearly'] as const
export type Frequency = (typeof FREQUENCIES)[number]
export const WEEKEND_RULES = ['none', 'next', 'previous'] as const
export type WeekendRule = (typeof WEEKEND_RULES)[number]
export const PRESETS = ['zus', 'pit4', 'vat7'] as const
export type Preset = (typeof PRESETS)[number]
export const SERIES_STATUSES = ['active', 'paused'] as const
export type SeriesStatus = (typeof SERIES_STATUSES)[number]
export const SERIES_KINDS = ['income', 'expense'] as const
export type SeriesKind = (typeof SERIES_KINDS)[number]
export const DONE_REASONS = ['paid', 'skipped', 'deleted'] as const
export type DoneReason = (typeof DONE_REASONS)[number]

/** Series one company may have (a technical limit; plan limits arrive in S17). */
export const MAX_SERIES = 100
export const SERIES_NAME_MAX = 80
/** As the comment of an operation (lib/domain/ledger/input.ts). */
export const SERIES_DESCRIPTION_MAX = 500
/** «Кожні N місяців»: N is 1-24. */
export const MAX_INTERVAL = 24
/** Planned operations reach this many months ahead of today. */
export const WINDOW_MONTHS = 3
/** A payment day is at most this many days from its occurrence (a weekend plus Polish holidays). */
export const MAX_SHIFT_DAYS = 7
/** Occurrences one fill of one series creates at most; the rest follows in the next fill (catch-up after a long pause). */
export const MAX_FILL_PER_SERIES = 100
/** Future operations of a series one change, pause or delete rewrites at most (the 500-write limit of a transaction). */
export const REWRITE_CAP = 100
/** Marks of a series one change reads at most (the periods they take). */
export const MARKS_SCAN = 500
/** The largest JSON body of the recurring routes. */
export const RECURRING_BODY_MAX_BYTES = 64 * 1024
/** A bank operation pays a plan from this many days before the plan's payment day ... */
export const MATCH_BEFORE_DAYS = 3
/** ... to this many days after it. */
export const MATCH_AFTER_DAYS = 10
/** Plans overdue for longer than this are not offered for a match. */
export const MATCH_LOOKBACK_DAYS = 90
/** Plans one suggestions read takes at most. */
export const MATCH_PLAN_SCAN = 500
/** Bank operations one suggestions read takes at most. */
export const MATCH_BANK_SCAN = 2000
/** Pairs one answer offers at most, newest first. */
export const MAX_MATCHES = 50
/** Pairs (or undos) one `POST /recurring/matches` takes at most. */
export const MAX_MATCH_ITEMS = 50
/** «Найближчі 7 днів»: today and the six days after it. */
export const UPCOMING_DAYS = 7
/** The page lists the planned operations of the next 31 days ... */
export const LIST_DAYS = 31
/** ... at most this many, and at most this many overdue ones. */
export const LIST_ROWS = 50
/** Planned operations one overview reads at most (today to the window end). */
export const PLANNED_SCAN = 1500
/** Series one daily run looks at, at most; the rest wait for the next hourly call. */
export const CRON_MAX_SERIES = 200
/** The daily fill may take at most this long of one hourly call ... */
export const RECURRING_CRON_BUDGET_MS = 10_000
/** ... and never past this point of the route's 60 s (`maxDuration` of app/api/cron/bank-sync). */
export const CRON_ROUTE_BUDGET_MS = 55_000
/** `createdBy` and the audit `uid` of what the daily fill writes. */
export const RECURRING_UID = 'system'

/** When a series repeats. Days are `YYYY-MM-DD` (UTC days), never moments. */
export interface Schedule {
  frequency: Frequency
  /** `everyNMonths` only: 1-24; 1 for the other frequencies. */
  interval: number
  /** monthly, everyNMonths, yearly: 1-31 (a shorter month takes its last day); null for weekly. */
  dayOfMonth: number | null
  /** weekly only: ISO weekday, 1 Monday ... 7 Sunday; null otherwise. */
  weekday: number | null
  /** The first occurrence is the first rule day on or after it; everyNMonths and yearly count their periods from its month. */
  startDate: string
  /** The last day an occurrence may fall on (included). */
  endDate?: string
  /** What a payment day that is not a Polish business day becomes. */
  weekendRule: WeekendRule
}

export interface Series extends Schedule {
  id: string
  name: string
  kind: SeriesKind
  accountId: string
  categoryId?: string
  counterpartyId?: string
  /** Tag ids, at most 10. */
  tags: string[]
  description?: string
  /** In the minor units of `currency`. */
  amountMinor: number
  /** Always the currency of `accountId`. */
  currency: string
  /** The amount is only an estimate (a tax): a match compares the counterparty instead. */
  estimated: boolean
  preset?: Preset
  status: SeriesStatus
  /** The last day the window of planned operations was filled to (absent before the first fill). */
  generatedThrough?: string
  /** The Warsaw day the daily fill is due again; absent when paused or nothing is left to create. */
  dueOn?: string
}

/** What a confirmed match copied from the plan onto the bank operation (only what it lacked). */
export interface Carried {
  categoryId?: string
  counterpartyId?: string
  description?: string
  tags?: string[]
}

/** One settled occurrence: paid, skipped or deleted by a person. Its id is the plan id. Written by the server only. */
export interface DoneMark {
  id: string
  seriesId: string
  occurrence: string
  reason: DoneReason
  /** paid: the operation that paid it (the plan itself after «Позначити сплаченою», or the bank operation of a match). */
  txId?: string
  /** The flags the plan had, so that a restore brings them back. */
  estimated: boolean
  manual: boolean
  /** A match only: the plan's stored fields (`transactionToDoc`), which the undo puts back. */
  plan?: Record<string, unknown>
  /** A match only: what the bank operation took over, which the undo takes off again while unchanged. */
  carried?: Carried
}
export type DoneMarkFields = Omit<DoneMark, 'id'>

/** One planned operation as the overview reads it (selected fields). */
export interface PlannedRow {
  id: string
  type: TxType
  accountId: string
  amountMinor: number
  currency: string
  paymentDate: string
  seriesId?: string
  occurrence?: string
  estimated: boolean
  manual: boolean
  categoryId?: string
  counterpartyId?: string
  description?: string
}

export interface CurrencyTotal {
  currency: string
  amountMinor: number
}

/** A series with the day its next payment is planned for (null: paused or ended). */
export interface SeriesRow extends Series {
  next: string | null
}

/** `GET /recurring`. */
export interface RecurringOverview {
  series: SeriesRow[]
  /** Planned operations before today, all of them. */
  overdueCount: number
  /** The oldest overdue ones, at most LIST_ROWS. */
  overdue: PlannedRow[]
  /** The planned operations of today and the next LIST_DAYS - 1 days, at most LIST_ROWS. */
  upcoming: PlannedRow[]
  /** «Найближчі 7 днів» per currency. */
  soon: { income: CurrencyTotal[]; expense: CurrencyTotal[] }
  /** The read of the window stopped at PLANNED_SCAN. */
  truncated: boolean
}

/** The plan of a suggested match. */
export interface PlanSide {
  id: string
  version: string
  type: 'income' | 'expense'
  accountId: string
  amountMinor: number
  currency: string
  paymentDate: string
  seriesId: string
  occurrence: string
  estimated: boolean
  counterpartyId?: string
  description?: string
  /** The series' name, when the series still exists. */
  name?: string
}

/** The bank operation of a suggested match. */
export interface BankSide {
  id: string
  version: string
  type: 'income' | 'expense'
  accountId: string
  amountMinor: number
  currency: string
  paymentDate: string
  counterpartyId?: string
  counterpartyName?: string
  remittance?: string
}

export interface PlanMatch {
  plan: PlanSide
  bank: BankSide
}

/** `GET /recurring/suggestions`. */
export interface MatchSuggestions {
  /** At most MAX_MATCHES, newest first. */
  pairs: PlanMatch[]
  /** Unambiguous pairs found, before the cap. */
  total: number
  /** Sides with more than one candidate: not offered, left to the person. */
  ambiguous: number
  /** A read stopped at its limit. */
  truncated: boolean
}

/** A parsed body of `POST /recurring/matches`. */
export type MatchRequest =
  | { kind: 'confirm'; items: { planId: string; bankId: string; versions: [string, string] }[] }
  | { kind: 'undo'; planIds: string[] }

/** The result of one pair (or one undo). */
export type MatchOutcome = { planId: string; ok: true; bankId: string } | { planId: string; ok: false; code: string }

/** What `DELETE /recurring/{id}` does with the future unpaid plans. */
export type FutureMode = 'delete' | 'keep'

/** The part `recurring` of the hourly `POST /api/cron/bank-sync` answer: counts only. */
export interface RecurringCronSummary {
  /** Due series the run read (at most CRON_MAX_SERIES). */
  considered: number
  filled: number
  /** Planned operations created. */
  created: number
  /** Not filled this hour: out of time, or no longer due. */
  skipped: number
  failed: number
}
```

Створити `lib/domain/recurring/schedule.ts`:

```ts
// The schedule of a series (S11): pure functions on `YYYY-MM-DD` days (UTC calendar days, never moments), so the summer
// time change never moves a day. Weekends and Polish holidays come from lib/utils/pl-calendar.ts.
import { addDays, daysApart, fromDay, toDay } from '@/lib/domain/ledger/days'
import { isBusinessDay, nextBusinessDay, previousBusinessDay } from '@/lib/utils/pl-calendar'
import { MAX_INTERVAL, WINDOW_MONTHS, type Schedule, type WeekendRule } from './types'

const pad = (n: number): string => String(n).padStart(2, '0')

/** Days in month `month` (1-12) of `year`. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Months counted from year 0: `year * 12 + month - 1`. */
function monthIndex(day: string): number {
  return Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1
}

/** Day `dayOfMonth` of the month `index`, or that month's last day when it is shorter. */
function dayOfMonthIndex(index: number, dayOfMonth: number): string {
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return `${year}-${pad(month)}-${pad(Math.min(dayOfMonth, daysInMonth(year, month)))}`
}

/** `day` plus `n` months; a day the target month does not have becomes its last day (2026-11-30 + 3 = 2027-02-28). */
export function addMonthsClamped(day: string, n: number): string {
  return dayOfMonthIndex(monthIndex(day) + n, Number(day.slice(8, 10)))
}

/** The last day the planned operations reach on `today`: three months ahead, included. */
export function windowEnd(today: string): string {
  return addMonthsClamped(today, WINDOW_MONTHS)
}

/** ISO weekday: 1 Monday ... 7 Sunday. */
export function isoWeekday(day: string): number {
  const w = fromDay(day).getUTCDay()
  return w === 0 ? 7 : w
}

/** The payment day of an occurrence: the occurrence itself, or the next / previous Polish business day when it is not one. */
export function paymentDayOf(occurrence: string, rule: WeekendRule): string {
  if (rule === 'none') return occurrence
  const date = fromDay(occurrence)
  if (isBusinessDay(date)) return occurrence
  return toDay(rule === 'next' ? nextBusinessDay(date) : previousBusinessDay(date))
}

/**
 * The occurrences (nominal days, before `weekendRule`) of a schedule within [from, to], both included, ascending. The first
 * occurrence is the first rule day on or after `startDate`; none falls after `endDate`. A month without `dayOfMonth` takes
 * its last day. everyNMonths and yearly keep the phase of the month of `startDate`.
 */
export function occurrencesBetween(s: Schedule, from: string, to: string): string[] {
  const lo = from > s.startDate ? from : s.startDate
  const hi = s.endDate !== undefined && s.endDate < to ? s.endDate : to
  if (lo > hi) return []
  const out: string[] = []
  if (s.frequency === 'weekly') {
    let day = addDays(s.startDate, ((s.weekday ?? 1) - isoWeekday(s.startDate) + 7) % 7)
    if (day < lo) day = addDays(day, Math.ceil(daysApart(day, lo) / 7) * 7)
    for (; day <= hi; day = addDays(day, 7)) out.push(day)
    return out
  }
  const step = s.frequency === 'monthly' ? 1 : s.frequency === 'yearly' ? 12 : s.interval
  const dom = s.dayOfMonth ?? 1
  const start = monthIndex(s.startDate)
  for (let k = Math.floor((monthIndex(lo) - start) / step); ; k++) {
    const day = dayOfMonthIndex(start + k * step, dom)
    if (day > hi) break
    if (day >= lo) out.push(day)
  }
  return out
}

/** The first occurrence strictly after `day`, or null when there is none within the longest period (the series ended). */
export function nextOccurrenceAfter(s: Schedule, day: string): string | null {
  return occurrencesBetween(s, addDays(day, 1), addMonthsClamped(day, MAX_INTERVAL + 1))[0] ?? null
}

/**
 * The period an occurrence of the schedule pays for: its week (the Monday), its month, its block of N months (counted from
 * the month of `startDate`) or its year. Two occurrences of one period pay for the same thing (S11: a change of the series
 * never plans a period that is already paid, skipped or deleted).
 */
export function periodOf(s: Schedule, day: string): string {
  switch (s.frequency) {
    case 'weekly':
      return addDays(day, 1 - isoWeekday(day))
    case 'monthly':
      return day.slice(0, 7)
    case 'yearly':
      return day.slice(0, 4)
    case 'everyNMonths':
      return String(Math.floor((monthIndex(day) - monthIndex(s.startDate)) / s.interval))
  }
}

/** The first day of the period `day` is in (see `periodOf`). */
export function periodStart(s: Schedule, day: string): string {
  switch (s.frequency) {
    case 'weekly':
      return addDays(day, 1 - isoWeekday(day))
    case 'monthly':
      return `${day.slice(0, 7)}-01`
    case 'yearly':
      return `${day.slice(0, 4)}-01-01`
    case 'everyNMonths': {
      const start = monthIndex(s.startDate)
      return dayOfMonthIndex(start + Math.floor((monthIndex(day) - start) / s.interval) * s.interval, 1)
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/recurring/schedule.test.ts && npm run typecheck && npm run lint`
Expected: PASS (усі тести), `tsc` чисто, `lint` 0 errors / 10 warnings. `TxType` у `types.ts` використано типом `PlannedRow`.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add lib/domain/recurring/types.ts lib/domain/recurring/schedule.ts tests/unit/domain/recurring/schedule.test.ts && git commit -m "feat(recurring): pure schedule on UTC days with Polish business days

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Ledger domain: поля серії в операції, префікс `pl_`, `withSeries`, `markChangeOf`, S10b без операцій серії

**Files:**
- Modify: `lib/domain/ledger/types.ts`, `lib/domain/ledger/doc.ts`, `lib/domain/ledger/input.ts`, `lib/domain/ledger/transfer.ts`, `lib/domain/transfers/types.ts`, `lib/domain/transfers/pairs.ts`, `types/index.ts`, `lib/firebase/ledger-map.ts`
- Create: `lib/domain/ledger/series.ts`
- Test: `tests/unit/domain/ledger/series.test.ts` (створити)

- [ ] **Step 1: Write the failing test**

Створити `tests/unit/domain/ledger/series.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseTransaction, transactionToDoc } from '@/lib/domain/ledger/doc'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { markChangeOf, withSeries, type MarkChange } from '@/lib/domain/ledger/series'
import { bankSideOf } from '@/lib/domain/ledger/transfer'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { parseCandidate } from '@/lib/domain/transfers/pairs'
import { toUiTransaction } from '@/lib/firebase/ledger-map'

/** The ZUS occurrence of 15 November 2026 (a Sunday), planned for Monday the 16th, the amount an estimate. */
const plan: LedgerTransaction = {
  id: 'pl_ser1_2026-11-15', type: 'expense', status: 'planned', accountId: 'mil', amountMinor: 150_000, currency: 'PLN',
  paymentDate: '2026-11-16', accrual: { mode: 'date', date: '2026-11-16' }, isRecurring: false, tags: [], fileUrls: [],
  counterpartyId: 'system_zus', seriesId: 'ser1', occurrence: '2026-11-15', estimated: true,
}

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : 'other'
  }
  return 'ok'
}

/** `next` as an edit builds it: the ledger's own fields come from the prior document, never from the request. */
function edited(change: Partial<LedgerTransaction>): LedgerTransaction {
  const next: LedgerTransaction = { ...plan, ...change }
  delete next.seriesId
  delete next.occurrence
  delete next.estimated
  delete next.manual
  return next
}

describe('the series fields of an operation (S11)', () => {
  it('round-trip; estimated and manual are stored only when true', () => {
    const doc = transactionToDoc(plan)
    expect(doc).toMatchObject({ seriesId: 'ser1', occurrence: '2026-11-15', estimated: true })
    expect('manual' in doc).toBe(false)
    expect(parseTransaction(plan.id, doc)).toEqual(plan)
    const plain: LedgerTransaction = { ...plan }
    delete plain.estimated
    expect('estimated' in transactionToDoc(plain)).toBe(false)
  })

  it.each([
    ['a series id that is not a document id', { seriesId: 'a/b' }],
    ['an occurrence that is not a day', { occurrence: '2026-11-31' }],
    ['a series id without its occurrence', { occurrence: undefined }],
    ['a flag that is not a boolean', { estimated: 'yes' }],
  ])('an operation with %s is unreadable', (_name, change) => {
    const doc: Record<string, unknown> = { ...transactionToDoc(plan), ...change }
    for (const [key, value] of Object.entries(change)) if (value === undefined) delete doc[key]
    expect(parseTransaction(plan.id, doc)).toBeNull()
  })

  it('a flag without a series, or a series link on a transfer, is unreadable', () => {
    const free = edited({})
    expect(parseTransaction(plan.id, { ...transactionToDoc(free), manual: true })).toBeNull()
    const transfer: Record<string, unknown> = {
      ...transactionToDoc(free), type: 'transfer', toAccountId: 'cash', toAmountMinor: 150_000, toCurrency: 'PLN', seriesId: 'ser1', occurrence: '2026-11-15',
    }
    delete transfer.counterpartyId
    expect(parseTransaction(plan.id, transfer)).toBeNull()
  })

  it('a request can neither name a series nor use a plan id', () => {
    const body = { type: 'expense', status: 'planned', accountId: 'mil', amountMinor: 100, paymentDate: '2026-11-16' }
    expect(code(() => parseTransactionInput({ ...body, seriesId: 'ser1' }))).toBe('invalid_input:seriesId')
    expect(code(() => parseTransactionInput({ ...body, occurrence: '2026-11-15' }))).toBe('invalid_input:occurrence')
    expect(code(() => parseTransactionInput({ ...body, estimated: true }))).toBe('invalid_input:estimated')
    expect(code(() => parseTransactionInput({ ...body, manual: true }))).toBe('invalid_input:manual')
    expect(code(() => parseTransactionInput({ ...body, clientId: 'pl_ser1_2026-11-15' }))).toBe('invalid_input:clientId')
    // The create route passes `internal`: then createTransaction decides by the occurrence's mark (lib/server/ledger/write.ts).
    expect(code(() => parseTransactionInput({ ...body, clientId: 'pl_ser1_2026-11-15' }, { internal: true }))).toBe('ok')
  })
})

describe('withSeries: an edit keeps the link and decides «змінено вручну»', () => {
  it('a new amount makes a planned occurrence manual and no longer an estimate', () => {
    const out = withSeries(edited({ amountMinor: 160_000 }), plan)
    expect(out).toMatchObject({ seriesId: 'ser1', occurrence: '2026-11-15', manual: true, amountMinor: 160_000 })
    expect(out.estimated).toBeUndefined()
  })

  it.each([
    ['the payment day', { paymentDate: '2026-11-20' }],
    ['the category', { categoryId: 'zus' }],
    ['the counterparty', { counterpartyId: undefined }],
    ['the comment', { description: 'grudzień' }],
    ['the account', { accountId: 'mono' }],
    ['the tags', { tags: ['t1'] }],
    ['the type', { type: 'income' as const }],
  ])('a change of %s makes it manual and keeps the estimate', (_name, change) => {
    expect(withSeries(edited(change), plan)).toMatchObject({ manual: true, estimated: true, seriesId: 'ser1' })
  })

  it('an edit of nothing the series sets (a file) keeps it as it was', () => {
    expect(withSeries(edited({ fileUrls: ['f1'] }), plan)).toEqual({ ...plan, fileUrls: ['f1'] })
  })

  it('marking it paid keeps the link and the flags; an operation without a series gets none', () => {
    const paid = withSeries(edited({ status: 'actual', paymentDate: '2026-11-10', amountMinor: 151_000 }), plan)
    expect(paid).toMatchObject({ status: 'actual', seriesId: 'ser1', occurrence: '2026-11-15', estimated: true })
    expect(paid.manual).toBeUndefined()
    const free = edited({})
    expect(withSeries({ ...free, description: 'x' }, free)).toEqual({ ...free, description: 'x' })
  })
})

describe('markChangeOf: which occurrence mark a write moves', () => {
  const paid: LedgerTransaction = { ...plan, status: 'actual', paymentDate: '2026-11-10' }
  const cases: Array<[string, LedgerTransaction | null, LedgerTransaction | null, MarkChange | null]> = [
    ['a plan marked as paid', plan, paid, 'paid'],
    ['a paid one back to a plan', paid, plan, 'clear'],
    ['a plan deleted', plan, null, 'deleted'],
    ['a paid one deleted (the occurrence stays paid)', paid, null, null],
    ['a plan restored', null, plan, 'clear'],
    ['a paid one restored', null, paid, 'paid'],
    ['a plan edited', plan, { ...plan, amountMinor: 1, manual: true }, null],
  ]
  it.each(cases)('%s', (_name, prior, next, want) => {
    expect(markChangeOf(prior, next)).toBe(want)
  })

  it('an operation without a series moves no mark', () => {
    expect(markChangeOf(edited({}), null)).toBeNull()
  })
})

describe('a bank operation that paid a plan is tied to its series (S10b)', () => {
  const bankOp: LedgerTransaction = {
    id: `bk_${'a'.repeat(32)}`, type: 'expense', status: 'actual', accountId: 'mil', amountMinor: 150_000, currency: 'PLN',
    paymentDate: '2026-11-16', accrual: { mode: 'date', date: '2026-11-16' }, isRecurring: false, tags: [], fileUrls: [], bank: { accountRef: 'ba-mil' },
  }

  it('is no bank side and no transfer candidate', () => {
    expect(bankSideOf(bankOp)).toBe('out')
    expect(bankSideOf({ ...bankOp, seriesId: 'ser1', occurrence: '2026-11-15' })).toBeNull()
    const candidate = parseCandidate(bankOp.id, { ...transactionToDoc(bankOp), seriesId: 'ser1' }, '1.000000001')
    expect(candidate?.seriesId).toBe('ser1')
    expect(candidate === null ? 'none' : bankSideOf(candidate)).toBeNull()
  })
})

describe('the UI operation carries the series fields', () => {
  it('maps them, the flags only when true', () => {
    const ui = toUiTransaction('org1', plan)
    expect(ui).toMatchObject({ seriesId: 'ser1', occurrence: '2026-11-15', estimated: true })
    expect(ui.manual).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/ledger/series.test.ts`
Expected: FAIL (`@/lib/domain/ledger/series` не існує; поля серії не зберігаються).

- [ ] **Step 3: Implement**

`lib/domain/ledger/types.ts`: в інтерфейсі `LedgerTransaction` після блоку поля `excluded?: boolean` (перед закриваючою `}`) додати:

```ts
  /**
   * The series this operation is an occurrence of (S11): set only by the server (the generator, a confirmed match), never
   * taken from a request. Income and expense only.
   */
  seriesId?: string
  /** The occurrence of the series it stands for: its nominal day before any weekend move (`YYYY-MM-DD`). With `seriesId`. */
  occurrence?: string
  /** The amount is only an estimate (a tax preset, S11); stored only when true. A new amount of a plan takes it off. */
  estimated?: boolean
  /** A person changed this planned occurrence (S11): a change of its series no longer rewrites it. Stored only when true. */
  manual?: boolean
```

`lib/domain/ledger/doc.ts`:

1. У `transactionToDoc` після рядка `  if (tx.excluded === true) doc.excluded = true` додати:

```ts
  if (tx.seriesId !== undefined && tx.occurrence !== undefined) {
    doc.seriesId = tx.seriesId
    doc.occurrence = tx.occurrence
    if (tx.estimated === true) doc.estimated = true
    if (tx.manual === true) doc.manual = true
  }
```

2. У `parseTransaction` після рядка `  if (data.excluded === true) tx.excluded = true` (перед `  return tx`) додати:

```ts
  // S11: the series link. Malformed, on a transfer, or a flag without the link: the document is unreadable (as `excluded`).
  if (data.seriesId !== undefined || data.occurrence !== undefined) {
    if (type === 'transfer' || !isId(data.seriesId) || !isDay(data.occurrence)) return null
    tx.seriesId = data.seriesId
    tx.occurrence = data.occurrence
  }
  for (const key of ['estimated', 'manual'] as const) {
    const value = data[key]
    if (value === undefined) continue
    if (typeof value !== 'boolean' || tx.seriesId === undefined) return null
    if (value) tx[key] = true
  }
```

`lib/domain/ledger/input.ts`:

1. Після оголошення `export const BANK_CLIENT_ID_PREFIX = 'bk_'` додати:

```ts
/**
 * The id prefix of a planned occurrence of a series (S11: `pl_<seriesId>_<occurrence>`). A client may not pick it either:
 * only the server's generator writes such ids, and the create route brings one back only from the occurrence's own mark
 * (`recurringDone`, see `createTransaction` in lib/server/ledger/write.ts): the undo of a delete or of «Пропустити».
 */
export const PLAN_CLIENT_ID_PREFIX = 'pl_'
```

2. У `parseTransactionInput` після рядка `  if (typeof r.clientId === 'string' && r.clientId.startsWith(BANK_CLIENT_ID_PREFIX) && opts?.internal !== true) bad('clientId')` додати:

```ts
  if (typeof r.clientId === 'string' && r.clientId.startsWith(PLAN_CLIENT_ID_PREFIX) && opts?.internal !== true) bad('clientId')
```

3. У коментарі `ParseOptions` після рядка ` *   own `bk_` id) reaches `createTransaction`. There the bank mark decides, so a client still cannot make a bank operation.` додати рядок:

```ts
 * - the same holds for a plan id (`pl_`, S11): the occurrence's mark decides.
```

Створити `lib/domain/ledger/series.ts`:

```ts
import { sameTags } from '@/lib/domain/tags/assign'
import type { LedgerTransaction } from './types'

/** The fields of an operation its series sets (S11). A person's change of any of them on a planned occurrence makes it manual. */
const SERIES_SET = ['type', 'accountId', 'amountMinor', 'paymentDate', 'categoryId', 'counterpartyId', 'description'] as const

/**
 * `next` (an edit, built from the request) with the series link of `prior` (S11): `seriesId`, `occurrence`, `estimated`,
 * `manual` come from the stored document only. A planned occurrence that stays planned becomes `manual` when a field its
 * series sets changes (then a change of the series no longer rewrites it), and loses `estimated` when its amount changes.
 * Marking it paid (or back) keeps the flags as they were: the operation is simply no longer a plan.
 */
export function withSeries(next: LedgerTransaction, prior: LedgerTransaction): LedgerTransaction {
  const out: LedgerTransaction = { ...next }
  delete out.seriesId
  delete out.occurrence
  delete out.estimated
  delete out.manual
  if (prior.seriesId === undefined || prior.occurrence === undefined) return out
  out.seriesId = prior.seriesId
  out.occurrence = prior.occurrence
  let estimated = prior.estimated === true
  let manual = prior.manual === true
  if (prior.status === 'planned' && next.status === 'planned') {
    if (next.amountMinor !== prior.amountMinor) estimated = false
    if (SERIES_SET.some((field) => prior[field] !== next[field]) || !sameTags(prior.tags, next.tags)) manual = true
  }
  if (estimated) out.estimated = true
  if (manual) out.manual = true
  return out
}

/** What a write does to the mark of its occurrence (`recurringDone`, S11): mark it paid, mark it deleted, or remove the mark. */
export type MarkChange = 'paid' | 'clear' | 'deleted'

/**
 * The one rule of the occurrence marks a ledger write moves (`commit` in lib/server/ledger/write.ts applies it):
 * - a plan becomes actual («Позначити сплаченою»): `paid` (the operation itself paid it);
 * - an actual one goes back to a plan (the undo of that): `clear`;
 * - a plan is deleted by a person: `deleted` (the generator never brings it back);
 * - an operation comes back under its plan id (the undo of a delete or of «Пропустити»): `clear` as a plan, `paid` as actual.
 * Deleting an actual occurrence leaves its `paid` mark (the occurrence stays paid). Operations without a series move none.
 */
export function markChangeOf(prior: LedgerTransaction | null, next: LedgerTransaction | null): MarkChange | null {
  const subject = next ?? prior
  if (subject === null || subject.seriesId === undefined) return null
  if (prior === null) return (next as LedgerTransaction).status === 'planned' ? 'clear' : 'paid'
  if (next === null) return prior.status === 'planned' ? 'deleted' : null
  if (prior.status === 'planned' && next.status === 'actual') return 'paid'
  if (prior.status === 'actual' && next.status === 'planned') return 'clear'
  return null
}
```

`lib/domain/ledger/transfer.ts`:

1. Рядок `export type BankSideSource = Pick<LedgerTransaction, 'id' | 'type' | 'status' | 'isRecurring' | 'bank'>` замінити на:

```ts
export type BankSideSource = Pick<LedgerTransaction, 'id' | 'type' | 'status' | 'isRecurring' | 'bank' | 'seriesId'>
```

2. Коментар і перший рядок `bankSideOf` замінити: рядки

```ts
/**
 * The bank side an operation can give a transfer (S10b): an actual income or expense imported from a bank under its bank
 * id and not tied to a recurring template. Anything else (a manual operation, a planned one, a transfer) is null.
 */
export function bankSideOf(tx: BankSideSource): BankSide | null {
  if (tx.status !== 'actual' || tx.isRecurring || tx.bank === undefined || bankKeyOf(tx.id) === null) return null
```

на

```ts
/**
 * The bank side an operation can give a transfer (S10b): an actual income or expense imported from a bank under its bank
 * id and not tied to a recurring template: neither marked «Повторювана» by a person (`isRecurring`) nor the payment of a
 * planned occurrence (`seriesId`, S11: a transfer would leave that occurrence's `paid` mark without its operation).
 * Anything else (a manual operation, a planned one, a transfer) is null.
 */
export function bankSideOf(tx: BankSideSource): BankSide | null {
  if (tx.status !== 'actual' || tx.isRecurring || tx.seriesId !== undefined || tx.bank === undefined || bankKeyOf(tx.id) === null) return null
```

`lib/domain/transfers/types.ts`: в інтерфейсі `Candidate` після рядка `  bank?: BankInfo` додати:

```ts
  /** Set when the operation paid a planned occurrence (S11): then it is no side of a transfer. */
  seriesId?: string
```

`lib/domain/transfers/pairs.ts`:

1. Рядок `export const CANDIDATE_FIELDS = ['schemaVersion', 'type', 'status', 'isRecurring', 'accountId', 'amountMinor', 'currency', 'paymentDate', 'source', 'bank'] as const` замінити на:

```ts
export const CANDIDATE_FIELDS = ['schemaVersion', 'type', 'status', 'isRecurring', 'accountId', 'amountMinor', 'currency', 'paymentDate', 'source', 'bank', 'seriesId'] as const
```

2. У `parseCandidate` перед `  return c` додати:

```ts
  if (typeof data.seriesId === 'string') c.seriesId = data.seriesId
```

`types/index.ts`: в інтерфейсі `Transaction` після рядка `  excluded?: boolean` додати:

```ts
  /** The series this operation is an occurrence of (S11), and that occurrence's day. Set by the server only. */
  seriesId?: string
  occurrence?: string
  /** The amount is an estimate (S11). */
  estimated?: boolean
  /** A person changed this planned occurrence: its series no longer rewrites it (S11). */
  manual?: boolean
```

`lib/firebase/ledger-map.ts`: у `toUiTransaction` після рядка `  if (tx.excluded === true) ui.excluded = true` додати:

```ts
  if (tx.seriesId !== undefined) ui.seriesId = tx.seriesId
  if (tx.occurrence !== undefined) ui.occurrence = tx.occurrence
  if (tx.estimated === true) ui.estimated = true
  if (tx.manual === true) ui.manual = true
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/ledger tests/unit/domain/transfers tests/unit/firebase tests/unit/api && npm run typecheck && npm run lint`
Expected: PASS. Якщо `tests/unit/domain/transfers/pairs.test.ts` порівнює точний список `CANDIDATE_FIELDS`, додати в очікуваний список `'seriesId'` останнім елементом (як у коді вище) і перезапустити. `tsc` чисто, `lint` 0 errors / 10 warnings.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add lib/domain/ledger/types.ts lib/domain/ledger/doc.ts lib/domain/ledger/input.ts lib/domain/ledger/series.ts lib/domain/ledger/transfer.ts lib/domain/transfers/types.ts lib/domain/transfers/pairs.ts types/index.ts lib/firebase/ledger-map.ts tests/unit/domain/ledger/series.test.ts && git commit -m "feat(ledger): series fields of an operation, reserved plan ids, occurrence mark rule

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(Якщо в Step 4 змінено `tests/unit/domain/transfers/pairs.test.ts`, додати його в `git add`.)

---

### Task 3: Домен серії: помилки, пресети, тіла запитів, документи, план заповнення й переписування

**Files:**
- Create: `lib/domain/recurring/errors.ts`, `lib/domain/recurring/presets.ts`, `lib/domain/recurring/input.ts`, `lib/domain/recurring/doc.ts`, `lib/domain/recurring/plan.ts`
- Test: `tests/unit/domain/recurring/input.test.ts`, `tests/unit/domain/recurring/doc.test.ts`, `tests/unit/domain/recurring/plan.test.ts` (створити)

- [ ] **Step 1: Write the failing tests**

Створити `tests/unit/domain/recurring/input.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { RecurringError } from '@/lib/domain/recurring/errors'
import {
  applySeriesPatch,
  assertSeriesHorizon,
  parseDeleteQuery,
  parseMatchRequest,
  parseSeriesInput,
  parseSeriesPatch,
  parseSkipBody,
  seriesFromInput,
  seriesToRaw,
} from '@/lib/domain/recurring/input'

const BASE = { name: '  Czynsz   biuro ', kind: 'expense', accountId: 'mil', amountMinor: 250_000, frequency: 'monthly', dayOfMonth: 10, startDate: '2026-11-01' }

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    return e instanceof RecurringError ? `${e.code}:${e.field}` : `other:${String(e)}`
  }
  return 'ok'
}

describe('parseSeriesInput', () => {
  it('reads a monthly series and fills the defaults', () => {
    expect(parseSeriesInput(BASE)).toEqual({
      name: 'Czynsz biuro', kind: 'expense', accountId: 'mil', tags: [], amountMinor: 250_000, estimated: false,
      frequency: 'monthly', interval: 1, dayOfMonth: 10, weekday: null, startDate: '2026-11-01', weekendRule: 'none',
    })
  })

  it('a preset gives its day, an estimate and the next business day; it is an expense', () => {
    expect(parseSeriesInput({ ...BASE, dayOfMonth: undefined, preset: 'zus' })).toMatchObject({ preset: 'zus', dayOfMonth: 15, estimated: true, weekendRule: 'next' })
    expect(parseSeriesInput({ ...BASE, preset: 'pit4', estimated: false })).toMatchObject({ dayOfMonth: 10, estimated: false, weekendRule: 'next' })
    expect(parseSeriesInput({ ...BASE, dayOfMonth: undefined, preset: 'vat7' })).toMatchObject({ dayOfMonth: 25 })
    expect(code(() => parseSeriesInput({ ...BASE, kind: 'income', preset: 'vat7' }))).toBe('invalid_input:kind')
  })

  it('a weekly series needs its weekday and takes no day of the month', () => {
    expect(parseSeriesInput({ ...BASE, frequency: 'weekly', dayOfMonth: undefined, weekday: 1 })).toMatchObject({ frequency: 'weekly', weekday: 1, dayOfMonth: null })
    expect(code(() => parseSeriesInput({ ...BASE, frequency: 'weekly', weekday: 1 }))).toBe('invalid_input:dayOfMonth')
    expect(code(() => parseSeriesInput({ ...BASE, frequency: 'weekly', dayOfMonth: undefined }))).toBe('invalid_input:weekday')
    expect(code(() => parseSeriesInput({ ...BASE, weekday: 3 }))).toBe('invalid_input:weekday')
  })

  it('every N months needs N from 1 to 24; the other frequencies take none', () => {
    expect(parseSeriesInput({ ...BASE, frequency: 'everyNMonths', interval: 3 })).toMatchObject({ interval: 3 })
    for (const interval of [0, 25, 1.5, '3', undefined]) {
      expect(code(() => parseSeriesInput({ ...BASE, frequency: 'everyNMonths', interval }))).toBe('invalid_input:interval')
    }
    expect(code(() => parseSeriesInput({ ...BASE, interval: 2 }))).toBe('invalid_input:interval')
  })

  it.each([
    ['an unknown key', { seriesId: 'x' }, 'seriesId'],
    ['an empty name', { name: '   ' }, 'name'],
    ['a name of 81 characters', { name: 'x'.repeat(81) }, 'name'],
    ['a zero amount', { amountMinor: 0 }, 'amountMinor'],
    ['a fractional amount', { amountMinor: 10.5 }, 'amountMinor'],
    ['day 32 of the month', { dayOfMonth: 32 }, 'dayOfMonth'],
    ['a start that is not a day', { startDate: '2026-02-30' }, 'startDate'],
    ['an end before the start', { endDate: '2026-10-31' }, 'endDate'],
    ['an unknown weekend rule', { weekendRule: 'later' }, 'weekendRule'],
    ['an unknown preset', { preset: 'cit' }, 'preset'],
    ['eleven tags', { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }, 'tags'],
    ['a tag twice', { tags: ['t1', 't1'] }, 'tags'],
    ['an account that is not an id', { accountId: 'a/b' }, 'accountId'],
    ['a category that is not an id', { categoryId: '' }, 'categoryId'],
    ['a transfer', { kind: 'transfer' }, 'kind'],
    ['an estimate that is not a flag', { estimated: 'yes' }, 'estimated'],
    ['a comment of 501 characters', { description: 'x'.repeat(501) }, 'description'],
  ])('refuses %s', (_name, change, field) => {
    expect(code(() => parseSeriesInput({ ...BASE, ...change }))).toBe(`invalid_input:${field}`)
  })

  it('keeps the optional fields, trims the comment and drops an empty one', () => {
    expect(parseSeriesInput({ ...BASE, categoryId: 'rent', counterpartyId: 'cp1', tags: ['t1'], description: '  Lokal 3 ', endDate: '2027-12-10' })).toMatchObject({
      categoryId: 'rent', counterpartyId: 'cp1', tags: ['t1'], description: 'Lokal 3', endDate: '2027-12-10',
    })
    expect('description' in parseSeriesInput({ ...BASE, description: '   ' })).toBe(false)
  })
})

describe('the horizon', () => {
  it('a start or an end more than 3650 days ahead is refused', () => {
    expect(code(() => assertSeriesHorizon({ startDate: '2026-11-01' }, '2026-11-10'))).toBe('ok')
    expect(code(() => assertSeriesHorizon({ startDate: '2036-11-07' }, '2026-11-10'))).toBe('ok')
    expect(code(() => assertSeriesHorizon({ startDate: '2036-11-08' }, '2026-11-10'))).toBe('invalid_input:startDate')
    expect(code(() => assertSeriesHorizon({ startDate: '2026-11-01', endDate: '2036-11-08' }, '2026-11-10'))).toBe('invalid_input:endDate')
  })
})

describe('a change of a series', () => {
  const series = seriesFromInput('ser1', parseSeriesInput({ ...BASE, categoryId: 'rent' }), 'PLN')

  it('takes only the editable fields; null clears an optional one', () => {
    expect(parseSeriesPatch({ amountMinor: 260_000, categoryId: null })).toEqual({ changes: { amountMinor: 260_000, categoryId: null }, removeFuture: false })
    expect(code(() => parseSeriesPatch({ kind: 'income' }))).toBe('invalid_input:kind')
    expect(code(() => parseSeriesPatch({ preset: 'zus' }))).toBe('invalid_input:preset')
    expect(code(() => parseSeriesPatch({ amountMinor: null }))).toBe('invalid_input:amountMinor')
    expect(code(() => parseSeriesPatch({}))).toBe('invalid_input:body')
  })

  it('a pause may remove the future plans; nothing else may', () => {
    expect(parseSeriesPatch({ status: 'paused', removeFuture: true })).toEqual({ changes: {}, status: 'paused', removeFuture: true })
    expect(code(() => parseSeriesPatch({ status: 'active', removeFuture: true }))).toBe('invalid_input:removeFuture')
    expect(code(() => parseSeriesPatch({ status: 'stopped' }))).toBe('invalid_input:status')
  })

  it('revalidates the whole series after the change', () => {
    const next = applySeriesPatch(series, parseSeriesPatch({ amountMinor: 260_000, categoryId: null, status: 'paused' }))
    expect(next).toMatchObject({ id: 'ser1', amountMinor: 260_000, status: 'paused', currency: 'PLN' })
    expect(next.categoryId).toBeUndefined()
    expect(code(() => applySeriesPatch(series, parseSeriesPatch({ endDate: '2026-01-01' })))).toBe('invalid_input:endDate')
  })

  it('a switch to weekly drops the day of the month, and back the weekday', () => {
    const weekly = applySeriesPatch(series, parseSeriesPatch({ frequency: 'weekly', weekday: 5 }))
    expect(weekly).toMatchObject({ frequency: 'weekly', weekday: 5, dayOfMonth: null, interval: 1 })
    const back = applySeriesPatch(weekly, parseSeriesPatch({ frequency: 'everyNMonths', interval: 2, dayOfMonth: 5 }))
    expect(back).toMatchObject({ frequency: 'everyNMonths', interval: 2, dayOfMonth: 5, weekday: null })
  })

  it('seriesToRaw is a body parseSeriesInput reads back to the same series', () => {
    expect(seriesFromInput('ser1', parseSeriesInput(seriesToRaw(series)), 'PLN')).toEqual(series)
  })
})

describe('the other bodies', () => {
  it('the delete query says what happens to the future plans (delete by default)', () => {
    expect(parseDeleteQuery(new URLSearchParams(''))).toBe('delete')
    expect(parseDeleteQuery(new URLSearchParams('future=keep'))).toBe('keep')
    expect(code(() => parseDeleteQuery(new URLSearchParams('future=maybe')))).toBe('invalid_input:future')
    expect(code(() => parseDeleteQuery(new URLSearchParams('x=1')))).toBe('invalid_input:x')
  })

  it('a skip names one occurrence day', () => {
    expect(parseSkipBody({ occurrence: '2026-11-15' })).toEqual({ occurrence: '2026-11-15' })
    expect(code(() => parseSkipBody({ occurrence: '15.11.2026' }))).toBe('invalid_input:occurrence')
    expect(code(() => parseSkipBody({ occurrence: '2026-11-15', x: 1 }))).toBe('invalid_input:x')
  })

  const V = '1790000000.000000001'
  const PLAN = 'pl_ser1_2026-11-15'
  const BANK = `bk_${'a'.repeat(32)}`

  it('a confirmation lists pairs with the versions the person saw; an undo lists plan ids', () => {
    expect(parseMatchRequest({ confirm: [{ planId: PLAN, bankId: BANK, versions: [V, V] }] })).toEqual({ kind: 'confirm', items: [{ planId: PLAN, bankId: BANK, versions: [V, V] }] })
    expect(parseMatchRequest({ undo: [PLAN] })).toEqual({ kind: 'undo', planIds: [PLAN] })
  })

  it.each([
    ['both keys', { confirm: [], undo: [] }, 'body'],
    ['no key', {}, 'body'],
    ['an unknown key', { pairs: [] }, 'pairs'],
    ['an empty list', { confirm: [] }, 'confirm'],
    ['51 undos', { undo: Array.from({ length: 51 }, (_, i) => `pl_ser${i}_2026-11-15`) }, 'undo'],
    ['a plan id that is not one', { confirm: [{ planId: 'manual-1', bankId: BANK, versions: [V, V] }] }, 'planId'],
    ['a bank id that is not one', { confirm: [{ planId: PLAN, bankId: 'manual-1', versions: [V, V] }] }, 'bankId'],
    ['a bad version', { confirm: [{ planId: PLAN, bankId: BANK, versions: [V, '1.2'] }] }, 'versions'],
    ['a plan twice', { confirm: [{ planId: PLAN, bankId: BANK, versions: [V, V] }, { planId: PLAN, bankId: `bk_${'b'.repeat(32)}`, versions: [V, V] }] }, 'confirm'],
    ['an undo twice', { undo: [PLAN, PLAN] }, 'undo'],
  ])('refuses %s', (_name, body, field) => {
    expect(code(() => parseMatchRequest(body))).toBe(`invalid_input:${field}`)
  })
})
```

Створити `tests/unit/domain/recurring/doc.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { doneToDoc, parseDone, parseSeries, seriesToDoc } from '@/lib/domain/recurring/doc'
import { parseSeriesInput, seriesFromInput } from '@/lib/domain/recurring/input'
import type { DoneMark, Series } from '@/lib/domain/recurring/types'

const series: Series = {
  ...seriesFromInput('ser1', parseSeriesInput({ name: 'ZUS', kind: 'expense', accountId: 'mil', amountMinor: 150_000, frequency: 'monthly', startDate: '2026-11-01', preset: 'zus', counterpartyId: 'system_zus' }), 'PLN'),
  generatedThrough: '2027-02-10',
  dueOn: '2026-11-11',
}

describe('the series document', () => {
  it('round-trips with its fill state; the writer fields are ignored', () => {
    const doc = seriesToDoc(series)
    expect(doc).toMatchObject({ schemaVersion: 1, name: 'ZUS', preset: 'zus', dayOfMonth: 15, weekday: null, weekendRule: 'next', estimated: true, status: 'active', generatedThrough: '2027-02-10', dueOn: '2026-11-11' })
    expect(parseSeries('ser1', { ...doc, orgId: 'org1', createdAt: 'x', version: 3 })).toEqual(series)
  })

  it.each([
    ['another schema', { schemaVersion: 2 }],
    ['an unknown status', { status: 'stopped' }],
    ['no currency', { currency: undefined }],
    ['a fill day that is not a day', { dueOn: 'tomorrow' }],
    ['day 0 of the month', { dayOfMonth: 0 }],
  ])('is unreadable with %s', (_name, change) => {
    const doc: Record<string, unknown> = { ...seriesToDoc(series), ...change }
    for (const [key, value] of Object.entries(change)) if (value === undefined) delete doc[key]
    expect(parseSeries('ser1', doc)).toBeNull()
  })
})

describe('the occurrence mark', () => {
  const mark: DoneMark = {
    id: 'pl_ser1_2026-11-15', seriesId: 'ser1', occurrence: '2026-11-15', reason: 'paid', txId: `bk_${'a'.repeat(32)}`,
    estimated: true, manual: false, plan: { type: 'expense' }, carried: { categoryId: 'zus', tags: ['t1'] },
  }
  const { id: _id, ...fields } = mark
  void _id

  it('round-trips and ignores the writer fields', () => {
    expect(parseDone(mark.id, { ...doneToDoc(fields), at: 'x', by: 'u', planCreatedAt: null })).toEqual(mark)
  })

  it('is unreadable under another id, with an unknown reason or a bad txId', () => {
    const doc = doneToDoc(fields)
    expect(parseDone('pl_ser1_2026-11-16', doc)).toBeNull()
    expect(parseDone(mark.id, { ...doc, reason: 'lost' })).toBeNull()
    expect(parseDone(mark.id, { ...doc, txId: 'a/b' })).toBeNull()
  })
})
```

Створити `tests/unit/domain/recurring/plan.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseSeriesInput, seriesFromInput } from '@/lib/domain/recurring/input'
import { fillPlan, parsePlanId, planId, planInputOf, rewriteOccurrences, rewriteState, seriesFieldsOf } from '@/lib/domain/recurring/plan'
import type { Series } from '@/lib/domain/recurring/types'

const rent: Series = seriesFromInput(
  'ser1',
  parseSeriesInput({ name: 'Czynsz', kind: 'expense', accountId: 'mil', amountMinor: 250_000, frequency: 'monthly', dayOfMonth: 10, startDate: '2026-10-01', categoryId: 'rent', description: 'Lokal' }),
  'PLN',
)

describe('plan ids', () => {
  it('are pl_<series>_<occurrence> and read back', () => {
    expect(planId('ser1', '2026-11-10')).toBe('pl_ser1_2026-11-10')
    expect(parsePlanId('pl_ser1_2026-11-10')).toEqual({ seriesId: 'ser1', occurrence: '2026-11-10' })
    expect(parsePlanId('pl_a_b_2026-11-10')).toEqual({ seriesId: 'a_b', occurrence: '2026-11-10' })
    for (const id of ['bk_x', 'pl_ser1_2026-11-31', 'pl__2026-11-10', 'pl_ser1']) expect(parsePlanId(id)).toBeNull()
  })
})

describe('fillPlan', () => {
  it('the first fill covers today to three months ahead and is due again tomorrow', () => {
    expect(fillPlan(rent, '2026-10-27')).toEqual({ occurrences: ['2026-11-10', '2026-12-10', '2027-01-10'], generatedThrough: '2027-01-27', dueOn: '2026-10-28' })
  })

  it('a later fill starts the day after the last one', () => {
    expect(fillPlan({ ...rent, generatedThrough: '2027-01-27' }, '2026-11-27')).toEqual({ occurrences: ['2027-02-10'], generatedThrough: '2027-02-27', dueOn: '2026-11-28' })
  })

  it('catches up the days the cron missed: the past ones become overdue plans', () => {
    expect(fillPlan({ ...rent, generatedThrough: '2027-01-27' }, '2027-04-01').occurrences).toEqual(['2027-02-10', '2027-03-10', '2027-04-10', '2027-05-10', '2027-06-10'])
  })

  it('stops at the cap of one fill and stays due today', () => {
    const weekly: Series = { ...rent, frequency: 'weekly', dayOfMonth: null, weekday: 1, startDate: '2020-01-06', generatedThrough: '2020-01-05' }
    const plan = fillPlan(weekly, '2026-10-27', 5)
    expect(plan.occurrences).toEqual(['2020-01-06', '2020-01-13', '2020-01-20', '2020-01-27', '2020-02-03'])
    expect(plan).toMatchObject({ generatedThrough: '2020-02-03', dueOn: '2026-10-27' })
  })

  it('an ended series is no longer due; a paused one creates nothing', () => {
    expect(fillPlan({ ...rent, endDate: '2026-12-10' }, '2026-10-27')).toEqual({ occurrences: ['2026-11-10', '2026-12-10'], generatedThrough: '2027-01-27', dueOn: undefined })
    expect(fillPlan({ ...rent, status: 'paused', generatedThrough: '2027-01-27' }, '2026-11-27')).toEqual({ occurrences: [], generatedThrough: '2027-01-27', dueOn: undefined })
  })
})

describe('rewriting after a change', () => {
  it('takes the new schedule from today to the window end, except the periods already taken', () => {
    const moved: Series = { ...rent, dayOfMonth: 20 }
    expect(rewriteOccurrences(moved, '2026-10-27', new Set())).toEqual(['2026-11-20', '2026-12-20', '2027-01-20'])
    expect(rewriteOccurrences(moved, '2026-10-27', new Set(['2026-11']))).toEqual(['2026-12-20', '2027-01-20'])
  })

  it('a resumed or changed series is filled to the window end and due tomorrow until it ends', () => {
    expect(rewriteState(rent, '2026-10-27')).toEqual({ generatedThrough: '2027-01-27', dueOn: '2026-10-28' })
    expect(rewriteState({ ...rent, endDate: '2026-12-31' }, '2026-10-27')).toEqual({ generatedThrough: '2027-01-27', dueOn: undefined })
  })
})

describe('the planned operation of an occurrence', () => {
  it('is planned on the payment day, with only the usable references', () => {
    const zus: Series = { ...rent, weekendRule: 'next', dayOfMonth: 15, estimated: true, counterpartyId: 'system_zus', tags: ['t1', 't2'] }
    expect(planInputOf(zus, '2026-11-15', { categoryId: 'rent', tags: ['t1'] })).toEqual({
      clientId: 'pl_ser1_2026-11-15', type: 'expense', status: 'planned', accountId: 'mil', amountMinor: 250_000, paymentDate: '2026-11-16',
      accrual: { mode: 'date', date: '2026-11-16' }, isRecurring: false, tags: ['t1'], fileUrls: [], categoryId: 'rent', description: 'Lokal',
    })
    expect(seriesFieldsOf(zus, '2026-11-15')).toEqual({ seriesId: 'ser1', occurrence: '2026-11-15', estimated: true })
    expect(seriesFieldsOf(rent, '2026-11-10')).toEqual({ seriesId: 'ser1', occurrence: '2026-11-10' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/recurring`
Expected: FAIL (модулі `errors`, `input`, `doc`, `plan` не існують; `schedule.test.ts` PASS).

- [ ] **Step 3: Implement**

Створити `lib/domain/recurring/errors.ts`:

```ts
export type RecurringErrorCode = 'invalid_input' | 'not_found' | 'limit_reached'

/** An expected failure of a series operation (S11). `field` names the offending input field. */
export class RecurringError extends Error {
  public readonly code: RecurringErrorCode
  public readonly field?: string

  constructor(code: RecurringErrorCode, field?: string) {
    super(field === undefined ? code : `${code}:${field}`)
    this.name = 'RecurringError'
    this.code = code
    this.field = field
  }
}
```

Створити `lib/domain/recurring/presets.ts`:

```ts
import { SYSTEM_COUNTERPARTIES, type SystemCounterpartySpec } from '@/lib/domain/counterparties/system'
import type { Preset } from './types'

/**
 * The tax presets (S11): the day of the month and the system counterparty of S06. Every preset is an expense, its amount an
 * estimate the person types, moved to the next business day. The day can be changed (ZUS on the 10th).
 */
export const PRESET_DEFAULTS: Record<Preset, { dayOfMonth: number; counterpartyId: string }> = {
  zus: { dayOfMonth: 15, counterpartyId: 'system_zus' },
  pit4: { dayOfMonth: 20, counterpartyId: 'system_us' },
  vat7: { dayOfMonth: 25, counterpartyId: 'system_us' },
}

/** The S06 system record a preset pays (ZUS or Urząd Skarbowy). */
export function presetCounterparty(preset: Preset): SystemCounterpartySpec {
  const spec = SYSTEM_COUNTERPARTIES.find((s) => s.id === PRESET_DEFAULTS[preset].counterpartyId)
  if (!spec) throw new Error(`no system counterparty for the preset ${preset}`)
  return spec
}
```

Створити `lib/domain/recurring/plan.ts`:

```ts
import { addDays, isDay } from '@/lib/domain/ledger/days'
import { isId } from '@/lib/domain/ledger/guards'
import { PLAN_CLIENT_ID_PREFIX, type TransactionInput } from '@/lib/domain/ledger/input'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { occurrencesBetween, paymentDayOf, periodOf, windowEnd } from './schedule'
import { MAX_FILL_PER_SERIES, type Series } from './types'

/** The deterministic id of an occurrence's operation: creating it again writes the same document. */
export function planId(seriesId: string, occurrence: string): string {
  return `${PLAN_CLIENT_ID_PREFIX}${seriesId}_${occurrence}`
}

const PLAN_ID = /^pl_(.+)_(\d{4}-\d{2}-\d{2})$/
/** Client ids are at most 64 characters (lib/domain/ledger/input.ts): a plan id must fit the create route. */
const MAX_PLAN_ID = 64

/** The series and the occurrence of a plan id, or null when it is not one. */
export function parsePlanId(id: string): { seriesId: string; occurrence: string } | null {
  const m = PLAN_ID.exec(id)
  if (m === null || id.length > MAX_PLAN_ID || !isId(m[1]) || !isDay(m[2])) return null
  return { seriesId: m[1], occurrence: m[2] }
}

function endedBy(s: Series, through: string): boolean {
  return s.endDate !== undefined && s.endDate <= through
}

/** What one fill of a series creates (`occurrences`) and the fill state it leaves on the series. */
export interface FillPlan {
  occurrences: string[]
  generatedThrough?: string
  dueOn?: string
}

/**
 * One fill of an active series on `today` (the daily generator and the create): the occurrences from the day after the last
 * fill (from today on the first fill, never before `startDate`) to the window end, at most `max`. A fill that reached the
 * window end is due again tomorrow, or never once `endDate` is behind it; a capped one stays due today and continues after
 * its last occurrence. A paused series creates nothing and is not due. Whether an occurrence already has an operation or a
 * mark is the server's check; this plan never returns an occurrence twice across fills.
 */
export function fillPlan(s: Series, today: string, max: number = MAX_FILL_PER_SERIES): FillPlan {
  if (s.status !== 'active') return { occurrences: [], generatedThrough: s.generatedThrough }
  const from = s.generatedThrough === undefined ? today : addDays(s.generatedThrough, 1)
  const end = windowEnd(today)
  const all = occurrencesBetween(s, from, end)
  if (all.length > max) {
    const occurrences = all.slice(0, max)
    return { occurrences, generatedThrough: occurrences[occurrences.length - 1], dueOn: today }
  }
  const generatedThrough = s.generatedThrough !== undefined && s.generatedThrough > end ? s.generatedThrough : end
  return { occurrences: all, generatedThrough, dueOn: endedBy(s, generatedThrough) ? undefined : addDays(today, 1) }
}

/**
 * The occurrences a changed (or resumed) series plans on `today`: its schedule from today to the window end, except those
 * whose period (`periodOf` of the new schedule) is already taken by a mark or an operation the change does not rewrite.
 */
export function rewriteOccurrences(s: Series, today: string, taken: ReadonlySet<string>): string[] {
  return occurrencesBetween(s, today, windowEnd(today)).filter((o) => !taken.has(periodOf(s, o)))
}

/** The fill state after a change of an active series: filled to the window end, due tomorrow until it ends. */
export function rewriteState(s: Series, today: string): Pick<FillPlan, 'generatedThrough' | 'dueOn'> {
  const end = windowEnd(today)
  return { generatedThrough: end, dueOn: s.status === 'active' && !endedBy(s, end) ? addDays(today, 1) : undefined }
}

/** The references of a series its plans can carry now (a deleted category, a missing or archived counterparty or tag are left out). */
export interface UsableRefs {
  categoryId?: string
  counterpartyId?: string
  tags: string[]
}

/**
 * The create input of one occurrence: a planned operation on its payment day (`weekendRule`), the accrual on that day,
 * never marked «Повторювана» (the series link is `seriesId`, see `seriesFieldsOf`), under its plan id.
 */
export function planInputOf(s: Series, occurrence: string, usable: UsableRefs): TransactionInput {
  const paymentDate = paymentDayOf(occurrence, s.weekendRule)
  const input: TransactionInput = {
    clientId: planId(s.id, occurrence),
    type: s.kind,
    status: 'planned',
    accountId: s.accountId,
    amountMinor: s.amountMinor,
    paymentDate,
    accrual: { mode: 'date', date: paymentDate },
    isRecurring: false,
    tags: [...usable.tags],
    fileUrls: [],
  }
  if (usable.categoryId !== undefined) input.categoryId = usable.categoryId
  if (usable.counterpartyId !== undefined) input.counterpartyId = usable.counterpartyId
  if (s.description !== undefined) input.description = s.description
  return input
}

/** The series fields of an occurrence's operation (only the server writes them). */
export function seriesFieldsOf(s: Series, occurrence: string): Pick<LedgerTransaction, 'seriesId' | 'occurrence' | 'estimated'> {
  return s.estimated ? { seriesId: s.id, occurrence, estimated: true } : { seriesId: s.id, occurrence }
}
```

Створити `lib/domain/recurring/input.ts`:

```ts
import { addDays, isDay } from '@/lib/domain/ledger/days'
import { MAX_FUTURE_DAYS } from '@/lib/domain/ledger/build'
import { isId } from '@/lib/domain/ledger/guards'
import { MIN_DAY } from '@/lib/domain/ledger/input'
import { MAX_MINOR, isMinor } from '@/lib/domain/ledger/money'
import { bankKeyOf } from '@/lib/domain/ledger/transfer'
import { tagIdsOf } from '@/lib/domain/tags/assign'
import { MAX_TX_TAGS } from '@/lib/domain/tags/types'
import { parseVersion } from '@/lib/domain/transfers/version'
import { RecurringError } from './errors'
import { parsePlanId } from './plan'
import { PRESET_DEFAULTS } from './presets'
import {
  FREQUENCIES,
  MAX_INTERVAL,
  MAX_MATCH_ITEMS,
  PRESETS,
  SERIES_DESCRIPTION_MAX,
  SERIES_KINDS,
  SERIES_NAME_MAX,
  SERIES_STATUSES,
  WEEKEND_RULES,
  type Frequency,
  type FutureMode,
  type MatchRequest,
  type Preset,
  type Series,
  type SeriesKind,
  type SeriesStatus,
  type WeekendRule,
} from './types'

function bad(field: string): never {
  throw new RecurringError('invalid_input', field)
}

function asRecord(v: unknown, field = 'body'): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) bad(field)
  return v as Record<string, unknown>
}

function onlyKeys(r: Record<string, unknown>, allowed: readonly string[]): void {
  for (const k of Object.keys(r)) if (!allowed.includes(k)) bad(k)
}

/** A validated create body (defaults filled). */
export interface SeriesInput {
  name: string
  kind: SeriesKind
  accountId: string
  categoryId?: string
  counterpartyId?: string
  tags: string[]
  description?: string
  amountMinor: number
  estimated: boolean
  preset?: Preset
  frequency: Frequency
  interval: number
  dayOfMonth: number | null
  weekday: number | null
  startDate: string
  endDate?: string
  weekendRule: WeekendRule
}

const CREATE_KEYS = [
  'name', 'kind', 'accountId', 'categoryId', 'counterpartyId', 'tags', 'description', 'amountMinor', 'estimated', 'preset',
  'frequency', 'interval', 'dayOfMonth', 'weekday', 'startDate', 'endDate', 'weekendRule',
] as const
/** `kind` and `preset` are fixed at creation. */
const PATCHABLE: readonly string[] = CREATE_KEYS.filter((k) => k !== 'kind' && k !== 'preset')
const NULLABLE = new Set(['categoryId', 'counterpartyId', 'description', 'endDate', 'interval', 'dayOfMonth', 'weekday'])

/** The display name: whitespace collapsed and trimmed, 1-80 characters. */
export function cleanSeriesName(v: unknown): string {
  if (typeof v !== 'string') bad('name')
  const text = v.replace(/\s+/g, ' ').trim()
  if (text.length < 1 || text.length > SERIES_NAME_MAX) bad('name')
  return text
}

function int(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) bad(field)
  return v
}

/** A field the frequency does not use: absent or null. */
function none(v: unknown, field: string): null {
  if (v !== undefined && v !== null) bad(field)
  return null
}

function oneOf<T extends string>(v: unknown, values: readonly T[], field: string): T {
  if (!(values as readonly unknown[]).includes(v)) bad(field)
  return v as T
}

function day(v: unknown, field: string): string {
  if (!isDay(v) || v < MIN_DAY) bad(field)
  return v
}

export function parseSeriesInput(body: unknown): SeriesInput {
  const r = asRecord(body)
  onlyKeys(r, CREATE_KEYS)
  const preset = r.preset === undefined ? undefined : oneOf(r.preset, PRESETS, 'preset')
  const kind = oneOf(r.kind, SERIES_KINDS, 'kind')
  if (preset !== undefined && kind !== 'expense') bad('kind')
  if (!isId(r.accountId)) bad('accountId')
  const frequency = oneOf(r.frequency, FREQUENCIES, 'frequency')
  if (!isMinor(r.amountMinor) || r.amountMinor <= 0 || r.amountMinor > MAX_MINOR) bad('amountMinor')
  const tags = r.tags === undefined ? [] : tagIdsOf(r.tags, MAX_TX_TAGS)
  if (tags === null) bad('tags')
  if (r.estimated !== undefined && typeof r.estimated !== 'boolean') bad('estimated')
  const weekly = frequency === 'weekly'
  let interval = 1
  if (frequency === 'everyNMonths') interval = int(r.interval, 'interval', 1, MAX_INTERVAL)
  else if (r.interval !== undefined && r.interval !== null && r.interval !== 1) bad('interval')
  const presetDay = preset === undefined ? undefined : PRESET_DEFAULTS[preset].dayOfMonth
  const startDate = day(r.startDate, 'startDate')

  const out: SeriesInput = {
    name: cleanSeriesName(r.name),
    kind,
    accountId: r.accountId,
    tags,
    amountMinor: r.amountMinor,
    estimated: typeof r.estimated === 'boolean' ? r.estimated : preset !== undefined,
    frequency,
    interval,
    dayOfMonth: weekly ? none(r.dayOfMonth, 'dayOfMonth') : int(r.dayOfMonth ?? presetDay, 'dayOfMonth', 1, 31),
    weekday: weekly ? int(r.weekday, 'weekday', 1, 7) : none(r.weekday, 'weekday'),
    startDate,
    weekendRule: r.weekendRule === undefined ? (preset !== undefined ? 'next' : 'none') : oneOf(r.weekendRule, WEEKEND_RULES, 'weekendRule'),
  }
  if (preset !== undefined) out.preset = preset
  if (r.endDate !== undefined && r.endDate !== null) {
    const endDate = day(r.endDate, 'endDate')
    if (endDate < startDate) bad('endDate')
    out.endDate = endDate
  }
  for (const key of ['categoryId', 'counterpartyId'] as const) {
    const value = r[key]
    if (value === undefined || value === null) continue
    if (!isId(value)) bad(key)
    out[key] = value
  }
  if (r.description !== undefined && r.description !== null) {
    if (typeof r.description !== 'string') bad('description')
    const text = r.description.trim()
    if (text.length > SERIES_DESCRIPTION_MAX) bad('description')
    if (text.length > 0) out.description = text
  }
  return out
}

/** A start or an end further than the ledger plans ahead (`MAX_FUTURE_DAYS`) is refused (the server knows today). */
export function assertSeriesHorizon(s: Pick<SeriesInput, 'startDate' | 'endDate'>, today: string): void {
  const horizon = addDays(today, MAX_FUTURE_DAYS)
  if (s.startDate > horizon) bad('startDate')
  if (s.endDate !== undefined && s.endDate > horizon) bad('endDate')
}

/** A new active series from a validated body; the fill state comes with the first fill. */
export function seriesFromInput(id: string, input: SeriesInput, currency: string): Series {
  return { id, ...input, currency, status: 'active' }
}

/** The stored series as a create body: what a PATCH is merged onto (only the fields its frequency uses). */
export function seriesToRaw(s: Series): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    name: s.name, kind: s.kind, accountId: s.accountId, tags: [...s.tags], amountMinor: s.amountMinor, estimated: s.estimated,
    frequency: s.frequency, startDate: s.startDate, weekendRule: s.weekendRule,
  }
  if (s.frequency === 'everyNMonths') raw.interval = s.interval
  if (s.frequency === 'weekly') raw.weekday = s.weekday
  else raw.dayOfMonth = s.dayOfMonth
  if (s.endDate !== undefined) raw.endDate = s.endDate
  if (s.categoryId !== undefined) raw.categoryId = s.categoryId
  if (s.counterpartyId !== undefined) raw.counterpartyId = s.counterpartyId
  if (s.description !== undefined) raw.description = s.description
  if (s.preset !== undefined) raw.preset = s.preset
  return raw
}

/** A validated PATCH: the changed fields (null clears an optional one), the new status, and whether a pause removes the future plans. */
export interface SeriesPatch {
  changes: Record<string, unknown>
  status?: SeriesStatus
  removeFuture: boolean
}

export function parseSeriesPatch(body: unknown): SeriesPatch {
  const r = asRecord(body)
  onlyKeys(r, [...PATCHABLE, 'status', 'removeFuture'])
  const changes: Record<string, unknown> = {}
  for (const key of PATCHABLE) {
    if (!(key in r)) continue
    if (r[key] === null && !NULLABLE.has(key)) bad(key)
    changes[key] = r[key]
  }
  const out: SeriesPatch = { changes, removeFuture: false }
  if (r.status !== undefined) out.status = oneOf(r.status, SERIES_STATUSES, 'status')
  if (r.removeFuture !== undefined) {
    if (typeof r.removeFuture !== 'boolean') bad('removeFuture')
    out.removeFuture = r.removeFuture
  }
  if (out.removeFuture && out.status !== 'paused') bad('removeFuture')
  if (Object.keys(changes).length === 0 && out.status === undefined) bad('body')
  return out
}

/**
 * The series after a PATCH: the stored series as a body, the changes merged (null deletes), the whole revalidated by
 * `parseSeriesInput` (one validation for create and change). A new frequency drops the fields only the old one used, unless
 * the patch gives them. The fill state stays: the writer decides it.
 */
export function applySeriesPatch(s: Series, patch: SeriesPatch): Series {
  const raw = seriesToRaw(s)
  const { changes } = patch
  if ('frequency' in changes) {
    if (changes.frequency === 'weekly') {
      if (!('dayOfMonth' in changes)) delete raw.dayOfMonth
    } else if (!('weekday' in changes)) delete raw.weekday
    if (changes.frequency !== 'everyNMonths' && !('interval' in changes)) delete raw.interval
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete raw[key]
    else raw[key] = value
  }
  const next: Series = { ...seriesFromInput(s.id, parseSeriesInput(raw), s.currency), status: patch.status ?? s.status }
  if (s.generatedThrough !== undefined) next.generatedThrough = s.generatedThrough
  if (s.dueOn !== undefined) next.dueOn = s.dueOn
  return next
}

/** `DELETE /recurring/{id}?future=delete|keep`: nothing else in the query; `delete` when absent. */
export function parseDeleteQuery(query: URLSearchParams): FutureMode {
  for (const key of query.keys()) if (key !== 'future') bad(key)
  const values = query.getAll('future')
  if (values.length === 0) return 'delete'
  const value = values[0]
  if (values.length !== 1 || (value !== 'delete' && value !== 'keep')) bad('future')
  return value
}

/** `POST /recurring/{id}/skip { occurrence }`. */
export function parseSkipBody(body: unknown): { occurrence: string } {
  const r = asRecord(body)
  onlyKeys(r, ['occurrence'])
  if (!isDay(r.occurrence)) bad('occurrence')
  return { occurrence: r.occurrence }
}

/** `POST /recurring/matches`: `{ confirm: [{ planId, bankId, versions }] }` or `{ undo: [planId] }`, 1-50 each, none twice. */
export function parseMatchRequest(body: unknown): MatchRequest {
  const r = asRecord(body)
  const keys = Object.keys(r)
  if (keys.length !== 1) bad('body')
  if (keys[0] === 'confirm') {
    const list = r.confirm
    if (!Array.isArray(list) || list.length === 0 || list.length > MAX_MATCH_ITEMS) bad('confirm')
    const items = list.map((item: unknown) => {
      const o = asRecord(item, 'confirm')
      onlyKeys(o, ['planId', 'bankId', 'versions'])
      if (typeof o.planId !== 'string' || parsePlanId(o.planId) === null) bad('planId')
      if (!isId(o.bankId) || bankKeyOf(o.bankId) === null) bad('bankId')
      const v = o.versions
      if (!Array.isArray(v) || v.length !== 2 || !v.every((x) => parseVersion(x) !== null)) bad('versions')
      return { planId: o.planId, bankId: o.bankId, versions: [v[0] as string, v[1] as string] as [string, string] }
    })
    if (new Set(items.map((i) => i.planId)).size !== items.length || new Set(items.map((i) => i.bankId)).size !== items.length) bad('confirm')
    return { kind: 'confirm', items }
  }
  if (keys[0] === 'undo') {
    const list = r.undo
    if (!Array.isArray(list) || list.length === 0 || list.length > MAX_MATCH_ITEMS) bad('undo')
    const planIds = list.map((id: unknown) => {
      if (typeof id !== 'string' || parsePlanId(id) === null) bad('undo')
      return id
    })
    if (new Set(planIds).size !== planIds.length) bad('undo')
    return { kind: 'undo', planIds }
  }
  return bad(keys[0])
}
```

Створити `lib/domain/recurring/doc.ts`:

```ts
import { isDay } from '@/lib/domain/ledger/days'
import { isId } from '@/lib/domain/ledger/guards'
import { RecurringError } from './errors'
import { parseSeriesInput, seriesFromInput } from './input'
import { planId } from './plan'
import {
  DONE_REASONS,
  DONE_SCHEMA_VERSION,
  RECURRING_SCHEMA_VERSION,
  SERIES_STATUSES,
  type Carried,
  type DoneMark,
  type DoneMarkFields,
  type DoneReason,
  type Series,
  type SeriesStatus,
} from './types'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** The stored fields of a series (no id; the writer adds orgId, createdAt, createdBy, updatedAt, updatedBy, version). */
export function seriesToDoc(s: Series): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    schemaVersion: RECURRING_SCHEMA_VERSION,
    name: s.name,
    kind: s.kind,
    accountId: s.accountId,
    tags: s.tags,
    amountMinor: s.amountMinor,
    currency: s.currency,
    estimated: s.estimated,
    frequency: s.frequency,
    interval: s.interval,
    dayOfMonth: s.dayOfMonth,
    weekday: s.weekday,
    startDate: s.startDate,
    weekendRule: s.weekendRule,
    status: s.status,
  }
  for (const key of ['categoryId', 'counterpartyId', 'description', 'endDate', 'preset', 'generatedThrough', 'dueOn'] as const) {
    if (s[key] !== undefined) doc[key] = s[key]
  }
  return doc
}

const BODY_KEYS = [
  'name', 'kind', 'accountId', 'categoryId', 'counterpartyId', 'tags', 'description', 'amountMinor', 'estimated', 'preset',
  'frequency', 'interval', 'dayOfMonth', 'weekday', 'startDate', 'endDate', 'weekendRule',
] as const

/**
 * A stored series, validated by the same rule as a create body (`parseSeriesInput`), or null when it is not a schema 1
 * series. The generator relies on every field it reads, so a malformed series is skipped, never half-filled.
 */
export function parseSeries(id: string, data: unknown): Series | null {
  if (!isRecord(data) || data.schemaVersion !== RECURRING_SCHEMA_VERSION) return null
  if (typeof data.currency !== 'string' || !(SERIES_STATUSES as readonly unknown[]).includes(data.status)) return null
  for (const key of ['generatedThrough', 'dueOn'] as const) if (data[key] !== undefined && !isDay(data[key])) return null
  const raw: Record<string, unknown> = {}
  for (const key of BODY_KEYS) if (data[key] !== undefined && data[key] !== null) raw[key] = data[key]
  try {
    const series: Series = { ...seriesFromInput(id, parseSeriesInput(raw), data.currency), status: data.status as SeriesStatus }
    if (typeof data.generatedThrough === 'string') series.generatedThrough = data.generatedThrough
    if (typeof data.dueOn === 'string') series.dueOn = data.dueOn
    return series
  } catch (e) {
    if (e instanceof RecurringError) return null
    throw e
  }
}

function stringList(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((s) => typeof s === 'string') ? [...v] : null
}

function carriedToDoc(c: Carried): Record<string, unknown> {
  const doc: Record<string, unknown> = {}
  if (c.categoryId !== undefined) doc.categoryId = c.categoryId
  if (c.counterpartyId !== undefined) doc.counterpartyId = c.counterpartyId
  if (c.description !== undefined) doc.description = c.description
  if (c.tags !== undefined) doc.tags = [...c.tags]
  return doc
}

function parseCarried(v: unknown): Carried | undefined {
  if (!isRecord(v)) return undefined
  const c: Carried = {}
  for (const key of ['categoryId', 'counterpartyId', 'description'] as const) if (typeof v[key] === 'string') c[key] = v[key] as string
  const tags = stringList(v.tags)
  if (tags !== null) c.tags = tags
  return c
}

/** The stored fields of a mark (no id; the writer adds `at`, `by` and, for a match, the plan's `planCreatedAt`/`planCreatedBy`). */
export function doneToDoc(m: DoneMarkFields): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    schemaVersion: DONE_SCHEMA_VERSION,
    seriesId: m.seriesId,
    occurrence: m.occurrence,
    reason: m.reason,
    estimated: m.estimated,
    manual: m.manual,
  }
  if (m.txId !== undefined) doc.txId = m.txId
  if (m.plan !== undefined) doc.plan = m.plan
  if (m.carried !== undefined) doc.carried = carriedToDoc(m.carried)
  return doc
}

/** A stored mark, or null when it is not one or does not belong under `id` (its plan id). */
export function parseDone(id: string, data: unknown): DoneMark | null {
  if (!isRecord(data) || data.schemaVersion !== DONE_SCHEMA_VERSION) return null
  const { seriesId, occurrence, reason, txId } = data
  if (!isId(seriesId) || !isDay(occurrence) || planId(seriesId, occurrence) !== id) return null
  if (!(DONE_REASONS as readonly unknown[]).includes(reason)) return null
  if (txId !== undefined && !isId(txId)) return null
  const mark: DoneMark = { id, seriesId, occurrence, reason: reason as DoneReason, estimated: data.estimated === true, manual: data.manual === true }
  if (typeof txId === 'string') mark.txId = txId
  if (isRecord(data.plan)) mark.plan = data.plan
  const carried = parseCarried(data.carried)
  if (carried !== undefined) mark.carried = carried
  return mark
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/recurring && npm run typecheck && npm run lint`
Expected: PASS (`schedule`, `input`, `doc`, `plan`), `tsc` чисто, `lint` 0 errors / 10 warnings.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add lib/domain/recurring/errors.ts lib/domain/recurring/presets.ts lib/domain/recurring/input.ts lib/domain/recurring/doc.ts lib/domain/recurring/plan.ts tests/unit/domain/recurring/input.test.ts tests/unit/domain/recurring/doc.test.ts tests/unit/domain/recurring/plan.test.ts && git commit -m "feat(recurring): series bodies, documents, presets and the fill and rewrite plan

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Домен зіставлення й огляду: рядки, пари, перенесені поля, огляд, відхилені пари, властивісний тест

**Files:**
- Create: `lib/domain/recurring/rows.ts`, `lib/domain/recurring/match.ts`, `lib/domain/recurring/overview.ts`, `lib/domain/recurring/dismissed.ts`
- Modify: `lib/domain/transfers/dismissed.ts`
- Test: `tests/unit/domain/recurring/match.test.ts`, `tests/unit/domain/recurring/overview.test.ts`, `tests/unit/domain/recurring/dismissed.test.ts`, `tests/unit/domain/recurring/property.test.ts` (створити)

- [ ] **Step 1: Write the failing tests**

Створити `tests/unit/domain/recurring/match.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { canMatch, carriedOf, findPlanMatches, parseBankSide, parsePlanSide, withCarried, withoutCarried } from '@/lib/domain/recurring/match'
import type { BankSide, PlanSide } from '@/lib/domain/recurring/types'

const K = (n: number): string => `bk_${String(n).padStart(32, '0')}`
const plan = (id: string, paymentDate: string, over: Partial<PlanSide> = {}): PlanSide => ({
  id, version: '1.000000001', type: 'expense', accountId: 'mil', amountMinor: 250_000, currency: 'PLN', paymentDate, seriesId: 'ser1', occurrence: paymentDate, estimated: false, ...over,
})
const bank = (id: string, paymentDate: string, over: Partial<BankSide> = {}): BankSide => ({
  id, version: '1.000000002', type: 'expense', accountId: 'mil', amountMinor: 250_000, currency: 'PLN', paymentDate, ...over,
})

describe('canMatch', () => {
  it('the same kind and account, the exact amount, from 3 days before to 10 days after the plan', () => {
    const p = plan('pl_ser1_2026-11-10', '2026-11-10')
    expect(canMatch(p, bank(K(1), '2026-11-07'))).toBe(true)
    expect(canMatch(p, bank(K(1), '2026-11-20'))).toBe(true)
    expect(canMatch(p, bank(K(1), '2026-11-06'))).toBe(false)
    expect(canMatch(p, bank(K(1), '2026-11-21'))).toBe(false)
    expect(canMatch(p, bank(K(1), '2026-11-10', { amountMinor: 250_001 }))).toBe(false)
    expect(canMatch(p, bank(K(1), '2026-11-10', { type: 'income' }))).toBe(false)
    expect(canMatch(p, bank(K(1), '2026-11-10', { accountId: 'mono' }))).toBe(false)
  })

  it('an estimate compares the counterparty instead of the amount; without a counterparty it never matches', () => {
    const p = plan('pl_zus_2026-11-16', '2026-11-16', { estimated: true, counterpartyId: 'system_zus' })
    expect(canMatch(p, bank(K(1), '2026-11-17', { amountMinor: 151_234, counterpartyId: 'system_zus' }))).toBe(true)
    expect(canMatch(p, bank(K(1), '2026-11-17', { amountMinor: 151_234 }))).toBe(false)
    expect(canMatch({ ...p, counterpartyId: undefined }, bank(K(1), '2026-11-17', { counterpartyId: 'system_zus' }))).toBe(false)
  })
})

describe('findPlanMatches', () => {
  it('offers a pair only when each side has exactly one candidate', () => {
    const a = plan('pl_ser1_2026-11-10', '2026-11-10')
    const b = plan('pl_ser2_2026-11-12', '2026-11-12', { seriesId: 'ser2' })
    expect(findPlanMatches([a, b], [bank(K(1), '2026-11-11')])).toEqual({ pairs: [], total: 0, ambiguous: 1 })
    expect(findPlanMatches([a], [bank(K(1), '2026-11-11'), bank(K(2), '2026-11-12')])).toEqual({ pairs: [], total: 0, ambiguous: 1 })
    expect(findPlanMatches([a], [bank(K(1), '2026-11-11')])).toEqual({ pairs: [{ plan: a, bank: bank(K(1), '2026-11-11') }], total: 1, ambiguous: 0 })
  })

  it('newest first by the bank day, at most the cap', () => {
    const plans = [0, 1, 2].map((i) => plan(`pl_ser${i}_2026-11-1${i}`, `2026-11-1${i}`, { seriesId: `ser${i}`, amountMinor: 1000 + i }))
    const banks = plans.map((p, i) => bank(K(i), p.paymentDate, { amountMinor: p.amountMinor }))
    const r = findPlanMatches(plans, banks, 2)
    expect(r.total).toBe(3)
    expect(r.pairs.map((m) => m.bank.paymentDate)).toEqual(['2026-11-12', '2026-11-11'])
  })
})

describe('parsing the sides', () => {
  const doc = {
    schemaVersion: 2, type: 'expense', status: 'planned', accountId: 'mil', amountMinor: 250_000, currency: 'PLN', paymentDate: '2026-11-10',
    seriesId: 'ser1', occurrence: '2026-11-10', counterpartyId: 'cp1',
  }

  it('a plan side is a planned income or expense of a series that nobody changed by hand', () => {
    expect(parsePlanSide('pl_ser1_2026-11-10', doc, 'v')).toEqual({
      id: 'pl_ser1_2026-11-10', version: 'v', type: 'expense', accountId: 'mil', amountMinor: 250_000, currency: 'PLN', paymentDate: '2026-11-10',
      seriesId: 'ser1', occurrence: '2026-11-10', estimated: false, counterpartyId: 'cp1',
    })
    expect(parsePlanSide('x', { ...doc, manual: true }, 'v')).toBeNull()
    expect(parsePlanSide('x', { ...doc, seriesId: undefined }, 'v')).toBeNull()
    expect(parsePlanSide('x', { ...doc, status: 'actual' }, 'v')).toBeNull()
  })

  it('a bank side is an actual bank income or expense that pays no plan yet', () => {
    const b = {
      schemaVersion: 2, type: 'expense', status: 'actual', accountId: 'mil', amountMinor: 250_000, currency: 'PLN', paymentDate: '2026-11-11',
      source: 'bank', bank: { accountRef: 'ba', remittance: 'Czynsz XI', counterpartyName: 'Landlord' }, counterpartyId: 'cp1',
    }
    expect(parseBankSide(K(1), b, 'v')).toEqual({
      id: K(1), version: 'v', type: 'expense', accountId: 'mil', amountMinor: 250_000, currency: 'PLN', paymentDate: '2026-11-11',
      counterpartyId: 'cp1', counterpartyName: 'Landlord', remittance: 'Czynsz XI',
    })
    expect(parseBankSide(K(1), { ...b, seriesId: 'ser1' }, 'v')).toBeNull()
    expect(parseBankSide('manual-12345678', b, 'v')).toBeNull()
    expect(parseBankSide(K(1), { ...b, source: undefined }, 'v')).toBeNull()
    expect(parseBankSide(K(1), { ...b, type: 'transfer' }, 'v')).toBeNull()
  })
})

describe('what a match carries over and what its undo takes back', () => {
  const p: LedgerTransaction = {
    id: 'pl_ser1_2026-11-10', type: 'expense', status: 'planned', accountId: 'mil', amountMinor: 250_000, currency: 'PLN', paymentDate: '2026-11-10',
    accrual: { mode: 'date', date: '2026-11-10' }, isRecurring: false, tags: ['t1'], fileUrls: [], categoryId: 'rent', counterpartyId: 'cp1',
    description: 'Lokal', seriesId: 'ser1', occurrence: '2026-11-10',
  }
  const b: LedgerTransaction = {
    id: K(1), type: 'expense', status: 'actual', accountId: 'mil', amountMinor: 250_000, currency: 'PLN', paymentDate: '2026-11-11',
    accrual: { mode: 'date', date: '2026-11-11' }, isRecurring: false, tags: [], fileUrls: [], description: 'Czynsz XI', counterpartyId: 'cp9',
    bank: { accountRef: 'ba' }, autoRules: [{ id: 'r1', name: 'Landlord' }],
  }

  it('only the fields the bank operation lacks', () => {
    expect(carriedOf(p, b)).toEqual({ categoryId: 'rent', tags: ['t1'] })
  })

  it('the undo takes off the link and what is still as carried; the rules trace stays', () => {
    const linked: LedgerTransaction = { ...withCarried(b, { categoryId: 'rent', tags: ['t1'] }), seriesId: 'ser1', occurrence: '2026-11-10' }
    expect(linked).toMatchObject({ categoryId: 'rent', tags: ['t1'], description: 'Czynsz XI', counterpartyId: 'cp9', autoRules: [{ id: 'r1', name: 'Landlord' }] })
    expect(withoutCarried(linked, { categoryId: 'rent', tags: ['t1'] })).toEqual(b)
    expect(withoutCarried({ ...linked, categoryId: 'office' }, { categoryId: 'rent', tags: ['t1'] })).toEqual({ ...b, categoryId: 'office' })
  })
})
```

Створити `tests/unit/domain/recurring/overview.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseSeriesInput, seriesFromInput } from '@/lib/domain/recurring/input'
import { buildOverview } from '@/lib/domain/recurring/overview'
import type { PlannedRow, Series } from '@/lib/domain/recurring/types'

const TODAY = '2026-11-10'
const row = (id: string, paymentDate: string, over: Partial<PlannedRow> = {}): PlannedRow => ({
  id, type: 'expense', accountId: 'mil', amountMinor: 10_000, currency: 'PLN', paymentDate, estimated: false, manual: false, ...over,
})
const rent: Series = {
  ...seriesFromInput('rent', parseSeriesInput({ name: 'Czynsz', kind: 'expense', accountId: 'mil', amountMinor: 250_000, frequency: 'monthly', dayOfMonth: 20, startDate: '2026-01-01' }), 'PLN'),
  generatedThrough: '2027-02-10',
  dueOn: '2026-11-11',
}
const insurance: Series = {
  ...seriesFromInput('ins', parseSeriesInput({ name: 'Ubezpieczenie', kind: 'expense', accountId: 'mil', amountMinor: 90_000, frequency: 'yearly', dayOfMonth: 5, startDate: '2026-06-05' }), 'PLN'),
  generatedThrough: '2027-02-10',
  dueOn: '2026-11-11',
}

describe('buildOverview', () => {
  it('sums the next 7 days per kind and currency, transfers left out', () => {
    const o = buildOverview({
      series: [], overdue: [], overdueCount: 0, truncated: false, today: TODAY,
      upcoming: [
        row('a', '2026-11-10'), row('b', '2026-11-16', { amountMinor: 5_000 }), row('c', '2026-11-17'),
        row('d', '2026-11-12', { type: 'income', amountMinor: 70_000 }), row('e', '2026-11-12', { currency: 'EUR', amountMinor: 1_000 }),
        row('f', '2026-11-11', { type: 'transfer' }),
      ],
    })
    expect(o.soon).toEqual({ income: [{ currency: 'PLN', amountMinor: 70_000 }], expense: [{ currency: 'EUR', amountMinor: 1_000 }, { currency: 'PLN', amountMinor: 15_000 }] })
  })

  it('the next date of a series is its first plan, else the schedule after the filled window; a paused one has none', () => {
    const o = buildOverview({
      series: [{ ...rent, id: 'gym', name: 'Siłownia', status: 'paused' }, insurance, rent], overdue: [], overdueCount: 0, truncated: false, today: TODAY,
      upcoming: [
        row('pl_rent_2026-11-20', '2026-11-20', { seriesId: 'rent', occurrence: '2026-11-20' }),
        row('pl_rent_2026-12-20', '2026-12-21', { seriesId: 'rent', occurrence: '2026-12-20' }),
      ],
    })
    expect(o.series.map((s) => [s.id, s.next])).toEqual([['rent', '2026-11-20'], ['ins', '2027-06-05'], ['gym', null]])
  })

  it('lists the overdue and the next 31 days, and passes the count and the cut through', () => {
    const o = buildOverview({ series: [], overdueCount: 7, truncated: true, today: TODAY, overdue: [row('old', '2026-11-01')], upcoming: [row('in', '2026-12-10'), row('out', '2026-12-11')] })
    expect(o.overdue.map((r) => r.id)).toEqual(['old'])
    expect(o.upcoming.map((r) => r.id)).toEqual(['in'])
    expect(o).toMatchObject({ overdueCount: 7, truncated: true })
  })
})
```

Створити `tests/unit/domain/recurring/dismissed.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { PLAN_DISMISSED_PREFIX, readPlanDismissed, writePlanDismissed } from '@/lib/domain/recurring/dismissed'
import { DISMISSED_PREFIX, readDismissed } from '@/lib/domain/transfers/dismissed'

function memory(): Storage {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) } as unknown as Storage
}

describe('turned-down plan matches (this browser only)', () => {
  it('live under their own key, apart from the turned-down transfers', () => {
    const storage = memory()
    expect(writePlanDismissed(storage, 'org1', ['pl_a_2026-11-10|bk_1'])).toBe(true)
    expect(readPlanDismissed(storage, 'org1')).toEqual(['pl_a_2026-11-10|bk_1'])
    expect(storage.getItem(`${PLAN_DISMISSED_PREFIX}org1`)).not.toBeNull()
    expect(readDismissed(storage, 'org1')).toEqual([])
    expect(storage.getItem(`${DISMISSED_PREFIX}org1`)).toBeNull()
  })

  it('a missing or throwing storage keeps nothing and never throws', () => {
    const throwing = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } } as unknown as Storage
    expect(readPlanDismissed(null, 'org1')).toEqual([])
    expect(readPlanDismissed(throwing, 'org1')).toEqual([])
    expect(writePlanDismissed(throwing, 'org1', ['k'])).toBe(false)
  })
})
```

Створити `tests/unit/domain/recurring/property.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { addDays, daysApart, fromDay } from '@/lib/domain/ledger/days'
import { fillPlan, planId } from '@/lib/domain/recurring/plan'
import { occurrencesBetween, paymentDayOf, windowEnd } from '@/lib/domain/recurring/schedule'
import { MAX_SHIFT_DAYS, type Series } from '@/lib/domain/recurring/types'
import { isBusinessDay } from '@/lib/utils/pl-calendar'

/** A small seeded generator (mulberry32): the same seed gives the same run. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(r: () => number, values: readonly T[]): T {
  return values[Math.floor(r() * values.length)]
}

function randomSeries(r: () => number, n: number): Series {
  const frequency = pick(r, ['weekly', 'monthly', 'everyNMonths', 'yearly'] as const)
  const startDate = addDays('2026-01-01', Math.floor(r() * 700))
  const series: Series = {
    id: `s${n}`, name: 'n', kind: 'expense', accountId: 'acc', tags: [], amountMinor: 100, currency: 'PLN', estimated: false, status: 'active',
    frequency,
    interval: frequency === 'everyNMonths' ? 1 + Math.floor(r() * 24) : 1,
    dayOfMonth: frequency === 'weekly' ? null : 1 + Math.floor(r() * 31),
    weekday: frequency === 'weekly' ? 1 + Math.floor(r() * 7) : null,
    startDate,
    weekendRule: pick(r, ['none', 'next', 'previous'] as const),
  }
  if (r() < 0.3) series.endDate = addDays(startDate, Math.floor(r() * 500))
  return series
}

describe('the daily fill over random series and days (property)', () => {
  it('creates every occurrence of the window exactly once, whatever days the cron misses or repeats', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed)
      const first = randomSeries(r, seed)
      let series = first
      let today = addDays('2026-01-01', Math.floor(r() * 700))
      const days = 30 + Math.floor(r() * 150)
      const returned: string[] = []
      let firstFill: string | null = null
      let lastFill: string | null = null
      for (let d = 0; d < days; d++, today = addDays(today, 1)) {
        if (r() < 0.25) continue // the hourly call did not come that day
        const runs = r() < 0.3 ? 2 : 1 // or came twice: the due guard keeps the second one from doing anything
        for (let run = 0; run < runs; run++) {
          if (series.dueOn !== undefined && series.dueOn > today) continue
          if (firstFill !== null && series.dueOn === undefined) continue // ended
          const plan = fillPlan(series, today)
          firstFill ??= today
          lastFill = today
          returned.push(...plan.occurrences)
          series = { ...series, generatedThrough: plan.generatedThrough, dueOn: plan.dueOn }
        }
      }
      const ids = returned.map((o) => planId(first.id, o))
      expect(new Set(ids).size, `seed ${seed}: an occurrence came twice`).toBe(ids.length)
      if (firstFill !== null && lastFill !== null) {
        expect(returned, `seed ${seed}`).toEqual(occurrencesBetween(first, firstFill, windowEnd(lastFill)))
      }
      for (const o of returned) {
        const pay = paymentDayOf(o, first.weekendRule)
        expect(daysApart(o, pay)).toBeLessThanOrEqual(MAX_SHIFT_DAYS)
        if (first.weekendRule !== 'none') expect(isBusinessDay(fromDay(pay)), `seed ${seed}: ${pay}`).toBe(true)
      }
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/recurring`
Expected: FAIL (`match`, `overview`, `dismissed` не існують; `property.test.ts` проходить уже зараз, бо бере лише `plan`/`schedule`: це очікувано, він закріплює властивість, а не нову функцію).

- [ ] **Step 3: Implement**

`lib/domain/transfers/dismissed.ts`: функції `readDismissed` і `writeDismissed` отримують необов'язковий префікс (S11 тримає свої відхилені пари окремо тим самим правилом). Рядки

```ts
export function readDismissed(storage: KeyValueStorage | null, orgId: string): string[] {
  if (!storage) return []
  try {
    const parsed: unknown = JSON.parse(storage.getItem(`${DISMISSED_PREFIX}${orgId}`) ?? '[]')
```

замінити на

```ts
export function readDismissed(storage: KeyValueStorage | null, orgId: string, prefix: string = DISMISSED_PREFIX): string[] {
  if (!storage) return []
  try {
    const parsed: unknown = JSON.parse(storage.getItem(`${prefix}${orgId}`) ?? '[]')
```

а рядки

```ts
export function writeDismissed(storage: KeyValueStorage | null, orgId: string, keys: readonly string[]): boolean {
  if (!storage) return false
  try {
    storage.setItem(`${DISMISSED_PREFIX}${orgId}`, JSON.stringify(keys.slice(-MAX_DISMISSED)))
```

на

```ts
export function writeDismissed(storage: KeyValueStorage | null, orgId: string, keys: readonly string[], prefix: string = DISMISSED_PREFIX): boolean {
  if (!storage) return false
  try {
    storage.setItem(`${prefix}${orgId}`, JSON.stringify(keys.slice(-MAX_DISMISSED)))
```

Створити `lib/domain/recurring/rows.ts`:

```ts
import { isDay } from '@/lib/domain/ledger/days'
import { SCHEMA_VERSION } from '@/lib/domain/ledger/doc'
import { isId } from '@/lib/domain/ledger/guards'
import { isMinor } from '@/lib/domain/ledger/money'
import { TX_TYPES, type TxType } from '@/lib/domain/ledger/types'
import type { PlannedRow } from './types'

/** The fields the overview and the plan side of the suggestions select (Firestore bills the document anyway; the answer stays small). */
export const ROW_FIELDS = [
  'schemaVersion', 'type', 'status', 'accountId', 'amountMinor', 'currency', 'paymentDate', 'seriesId', 'occurrence', 'estimated', 'manual',
  'categoryId', 'counterpartyId', 'description',
] as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A selected planned operation, or null when it is not a readable planned v2 operation. The one reader of that selection. */
export function parsePlannedRow(id: string, data: unknown): PlannedRow | null {
  if (!isRecord(data) || data.schemaVersion !== SCHEMA_VERSION || data.status !== 'planned') return null
  const { type, accountId, amountMinor, currency, paymentDate } = data
  if (!(TX_TYPES as readonly unknown[]).includes(type)) return null
  if (typeof accountId !== 'string' || !isMinor(amountMinor) || amountMinor <= 0 || typeof currency !== 'string' || !isDay(paymentDate)) return null
  const row: PlannedRow = {
    id, type: type as TxType, accountId, amountMinor, currency, paymentDate, estimated: data.estimated === true, manual: data.manual === true,
  }
  if (isId(data.seriesId) && isDay(data.occurrence)) {
    row.seriesId = data.seriesId
    row.occurrence = data.occurrence
  }
  for (const key of ['categoryId', 'counterpartyId', 'description'] as const) {
    const value = data[key]
    if (typeof value === 'string') row[key] = value
  }
  return row
}
```

Створити `lib/domain/recurring/match.ts`:

```ts
import { addDays, isDay } from '@/lib/domain/ledger/days'
import { SCHEMA_VERSION, parseBankInfo } from '@/lib/domain/ledger/doc'
import { isMinor } from '@/lib/domain/ledger/money'
import { bankKeyOf } from '@/lib/domain/ledger/transfer'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { sameTags } from '@/lib/domain/tags/assign'
import { parsePlannedRow } from './rows'
import { MATCH_AFTER_DAYS, MATCH_BEFORE_DAYS, MAX_MATCHES, type BankSide, type Carried, type MatchSuggestions, type PlanMatch, type PlanSide } from './types'

/** The fields the bank side of the suggestions selects. */
export const BANK_FIELDS = ['schemaVersion', 'type', 'status', 'accountId', 'amountMinor', 'currency', 'paymentDate', 'source', 'bank', 'seriesId', 'counterpartyId'] as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A plan a bank operation can pay: a planned income or expense of a series, not changed by hand. Null otherwise. */
export function parsePlanSide(id: string, data: unknown, version: string): PlanSide | null {
  const row = parsePlannedRow(id, data)
  if (row === null || row.seriesId === undefined || row.occurrence === undefined || row.manual || row.type === 'transfer') return null
  const side: PlanSide = {
    id, version, type: row.type, accountId: row.accountId, amountMinor: row.amountMinor, currency: row.currency, paymentDate: row.paymentDate,
    seriesId: row.seriesId, occurrence: row.occurrence, estimated: row.estimated,
  }
  if (row.counterpartyId !== undefined) side.counterpartyId = row.counterpartyId
  if (row.description !== undefined) side.description = row.description
  return side
}

/** A bank operation that can pay a plan: an actual bank income or expense under its `bk_` id that pays no plan yet. */
export function parseBankSide(id: string, data: unknown, version: string): BankSide | null {
  if (!isRecord(data) || data.schemaVersion !== SCHEMA_VERSION || data.status !== 'actual') return null
  const { type, accountId, amountMinor, currency, paymentDate } = data
  if (type !== 'income' && type !== 'expense') return null
  if (bankKeyOf(id) === null || data.source !== 'bank' || data.seriesId !== undefined) return null
  const bank = parseBankInfo(data.bank)
  if (bank === null) return null
  if (typeof accountId !== 'string' || !isMinor(amountMinor) || amountMinor <= 0 || typeof currency !== 'string' || !isDay(paymentDate)) return null
  const side: BankSide = { id, version, type, accountId, amountMinor, currency, paymentDate }
  if (typeof data.counterpartyId === 'string') side.counterpartyId = data.counterpartyId
  if (bank.counterpartyName !== undefined) side.counterpartyName = bank.counterpartyName
  if (bank.remittance !== undefined) side.remittance = bank.remittance
  return side
}

/**
 * Whether a bank operation can be the payment of a plan (S11): the same kind and account, its day from MATCH_BEFORE_DAYS
 * before to MATCH_AFTER_DAYS after the plan's payment day; the exact amount for an exact plan, the same counterparty for an
 * estimate (a plan without a counterparty is never matched as an estimate).
 */
export function canMatch(plan: PlanSide, bank: BankSide): boolean {
  if (plan.type !== bank.type || plan.accountId !== bank.accountId) return false
  if (bank.paymentDate < addDays(plan.paymentDate, -MATCH_BEFORE_DAYS) || bank.paymentDate > addDays(plan.paymentDate, MATCH_AFTER_DAYS)) return false
  if (plan.estimated) return plan.counterpartyId !== undefined && bank.counterpartyId === plan.counterpartyId
  return plan.amountMinor === bank.amountMinor && plan.currency === bank.currency
}

export const matchKey = (planId: string, bankId: string): string => `${planId}|${bankId}`
export const keyOfMatch = (m: PlanMatch): string => matchKey(m.plan.id, m.bank.id)

const desc = (a: string, b: string): number => (a > b ? -1 : a < b ? 1 : 0)

/**
 * The plan ↔ bank pairs the journal suggests (S11). A pair is offered only when the plan has exactly one bank candidate and
 * that bank operation exactly one plan; sides with several count as ambiguous and are left to the person. Newest first (by
 * the bank day, then the plan id), at most `max`.
 */
export function findPlanMatches(plans: readonly PlanSide[], banks: readonly BankSide[], max: number = MAX_MATCHES): Omit<MatchSuggestions, 'truncated'> {
  const banksOf = new Map<string, BankSide[]>()
  const plansPerBank = new Map<string, number>()
  for (const p of plans) {
    const found = banks.filter((b) => canMatch(p, b))
    banksOf.set(p.id, found)
    for (const b of found) plansPerBank.set(b.id, (plansPerBank.get(b.id) ?? 0) + 1)
  }
  const pairs: PlanMatch[] = []
  for (const p of plans) {
    const found = banksOf.get(p.id) ?? []
    if (found.length === 1 && plansPerBank.get(found[0].id) === 1) pairs.push({ plan: p, bank: found[0] })
  }
  const ambiguous = [...banksOf.values()].filter((f) => f.length > 1).length + [...plansPerBank.values()].filter((n) => n > 1).length
  pairs.sort((a, b) => desc(a.bank.paymentDate, b.bank.paymentDate) || desc(a.plan.id, b.plan.id))
  return { pairs: pairs.slice(0, max), total: pairs.length, ambiguous }
}

/** What a confirmed match copies from the plan: each of category, counterparty, comment and tags only when the bank operation has none. */
export function carriedOf(plan: LedgerTransaction, bank: LedgerTransaction): Carried {
  const c: Carried = {}
  if (bank.categoryId === undefined && plan.categoryId !== undefined) c.categoryId = plan.categoryId
  if (bank.counterpartyId === undefined && plan.counterpartyId !== undefined) c.counterpartyId = plan.counterpartyId
  if (bank.description === undefined && plan.description !== undefined) c.description = plan.description
  if (bank.tags.length === 0 && plan.tags.length > 0) c.tags = [...plan.tags]
  return c
}

/** The bank operation with the carried fields (its rules trace, amount, day and bank block untouched). */
export function withCarried(bank: LedgerTransaction, c: Carried): LedgerTransaction {
  const out: LedgerTransaction = { ...bank }
  if (c.categoryId !== undefined) out.categoryId = c.categoryId
  if (c.counterpartyId !== undefined) out.counterpartyId = c.counterpartyId
  if (c.description !== undefined) out.description = c.description
  if (c.tags !== undefined) out.tags = [...c.tags]
  return out
}

/** The undo of a match: the series link goes, and each carried field the bank operation still has unchanged. */
export function withoutCarried(bank: LedgerTransaction, c: Carried): LedgerTransaction {
  const out: LedgerTransaction = { ...bank }
  if (c.categoryId !== undefined && out.categoryId === c.categoryId) delete out.categoryId
  if (c.counterpartyId !== undefined && out.counterpartyId === c.counterpartyId) delete out.counterpartyId
  if (c.description !== undefined && out.description === c.description) delete out.description
  if (c.tags !== undefined && sameTags(out.tags, c.tags)) out.tags = []
  delete out.seriesId
  delete out.occurrence
  delete out.estimated
  delete out.manual
  return out
}
```

Створити `lib/domain/recurring/overview.ts`:

```ts
import { addDays } from '@/lib/domain/ledger/days'
import { nextOccurrenceAfter, paymentDayOf } from './schedule'
import { LIST_DAYS, LIST_ROWS, UPCOMING_DAYS, type CurrencyTotal, type PlannedRow, type RecurringOverview, type Series, type SeriesRow } from './types'

export interface OverviewInput {
  series: readonly Series[]
  /** The oldest overdue planned operations (the read takes LIST_ROWS). */
  overdue: readonly PlannedRow[]
  overdueCount: number
  /** The planned operations from today to the window end, by payment day. */
  upcoming: readonly PlannedRow[]
  truncated: boolean
  today: string
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function totals(m: ReadonlyMap<string, number>): CurrencyTotal[] {
  return [...m].map(([currency, amountMinor]) => ({ currency, amountMinor })).sort((a, b) => byText(a.currency, b.currency))
}

/** The next payment day of a series: its first plan from today, else the first occurrence after the filled window; none when paused or ended. */
function nextOf(s: Series, firstPlan: string | undefined, today: string): string | null {
  if (s.status !== 'active') return null
  if (firstPlan !== undefined) return firstPlan
  const after = nextOccurrenceAfter(s, s.generatedThrough ?? addDays(today, -1))
  return after === null ? null : paymentDayOf(after, s.weekendRule)
}

/**
 * `GET /recurring` from what it read (S11): «Прострочено» (count and the oldest rows), the planned operations of the next
 * LIST_DAYS, «Найближчі 7 днів» per kind and currency (transfers move no money out of the company and are left out), and
 * each series with its next payment day (active first by that day, then by name).
 */
export function buildOverview(input: OverviewInput): RecurringOverview {
  const { today } = input
  const soonEnd = addDays(today, UPCOMING_DAYS - 1)
  const listEnd = addDays(today, LIST_DAYS - 1)
  const income = new Map<string, number>()
  const expense = new Map<string, number>()
  const firstPlan = new Map<string, string>()
  for (const row of input.upcoming) {
    if (row.seriesId !== undefined && !firstPlan.has(row.seriesId)) firstPlan.set(row.seriesId, row.paymentDate)
    if (row.paymentDate > soonEnd || row.type === 'transfer') continue
    const sums = row.type === 'income' ? income : expense
    sums.set(row.currency, (sums.get(row.currency) ?? 0) + row.amountMinor)
  }
  const series = input.series.map((s): SeriesRow => ({ ...s, next: nextOf(s, firstPlan.get(s.id), today) }))
  series.sort((a, b) => {
    if (a.next !== b.next) {
      if (a.next === null) return 1
      if (b.next === null) return -1
      return byText(a.next, b.next)
    }
    return byText(a.name, b.name) || byText(a.id, b.id)
  })
  return {
    series,
    overdueCount: input.overdueCount,
    overdue: input.overdue.slice(0, LIST_ROWS),
    upcoming: input.upcoming.filter((r) => r.paymentDate <= listEnd).slice(0, LIST_ROWS),
    soon: { income: totals(income), expense: totals(expense) },
    truncated: input.truncated,
  }
}
```

Створити `lib/domain/recurring/dismissed.ts`:

```ts
import { readDismissed, writeDismissed, type KeyValueStorage } from '@/lib/domain/transfers/dismissed'

/** Where this browser keeps the plan matches the person turned down (S11), per company. Never sent to the server. */
export const PLAN_DISMISSED_PREFIX = 'finflow:plan-dismissed:'

/** The turned-down matches (`matchKey`); [] when storage is missing, blocked, throws or holds something else. */
export function readPlanDismissed(storage: KeyValueStorage | null, orgId: string): string[] {
  return readDismissed(storage, orgId, PLAN_DISMISSED_PREFIX)
}

/** Keeps `keys` (the newest 500). False when storage is missing or refuses: the list then lives in memory only. */
export function writePlanDismissed(storage: KeyValueStorage | null, orgId: string, keys: readonly string[]): boolean {
  return writeDismissed(storage, orgId, keys, PLAN_DISMISSED_PREFIX)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/recurring tests/unit/domain/transfers && npm run typecheck && npm run lint`
Expected: PASS (усі тести `recurring` і `transfers`; властивісний тест 300 серій), `tsc` чисто, `lint` 0 errors / 10 warnings.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add lib/domain/recurring/rows.ts lib/domain/recurring/match.ts lib/domain/recurring/overview.ts lib/domain/recurring/dismissed.ts lib/domain/transfers/dismissed.ts tests/unit/domain/recurring/match.test.ts tests/unit/domain/recurring/overview.test.ts tests/unit/domain/recurring/dismissed.test.ts tests/unit/domain/recurring/property.test.ts && git commit -m "feat(recurring): plan to bank matching, the overview and a property test of the fill

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Ledger: позначки чисел у `commit` («Позначити сплаченою», видалення, відновлення під `pl_`-id)

**Files:**
- Modify: `lib/server/ledger/paths.ts`, `lib/server/ledger/audit.ts`, `lib/server/ledger/write.ts`
- Create: `tests/integration/recurring-helpers.ts`, `tests/integration/ledger-plan-marks.test.ts`

- [ ] **Step 1: Write the failing integration test**

Створити `tests/integration/recurring-helpers.ts`:

```ts
import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import { transactionToDoc } from '@/lib/domain/ledger/doc'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { planId } from '@/lib/domain/recurring/plan'
import { ORG, UID, readDoc } from './helpers'

/** A planned occurrence of the series `ser1` on the PLN account `mil`. */
export function planOf(occurrence: string, over: Partial<LedgerTransaction> = {}): LedgerTransaction {
  return {
    id: planId('ser1', occurrence), type: 'expense', status: 'planned', accountId: 'mil', amountMinor: 120_000, currency: 'PLN',
    paymentDate: occurrence, accrual: { mode: 'date', date: occurrence }, isRecurring: false, tags: [], fileUrls: [],
    seriesId: 'ser1', occurrence, ...over,
  }
}

/**
 * A planned operation stored as the ledger stores it (`storedDoc` in lib/server/ledger/write.ts). A plan moves no balance
 * and no rollup, so its document is the whole of its ledger effect.
 */
export async function seedPlan(db: Firestore, plan: LedgerTransaction): Promise<void> {
  const ts = Timestamp.fromDate(new Date('2026-10-20T10:00:00Z'))
  await db.doc(`organizations/${ORG}/transactions/${plan.id}`).set({ ...transactionToDoc(plan), orgId: ORG, createdAt: ts, createdBy: UID, updatedAt: ts, updatedBy: UID })
}

export const txDoc = (db: Firestore, id: string, orgId = ORG) => readDoc(db, `organizations/${orgId}/transactions/${id}`)
export const markDoc = (db: Firestore, id: string, orgId = ORG) => readDoc(db, `organizations/${orgId}/recurringDone/${id}`)
```

Створити `tests/integration/ledger-plan-marks.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { fullPatch, parseTransactionInput, toRawInput } from '@/lib/domain/ledger/input'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createTransaction, deleteTransaction, retagTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { ORG, TODAY, UID, auditActions, balanceOf, clearFirestore, makeDeps, seedAccount, seedOrg, seedTag, testDb } from './helpers'
import { markDoc, planOf, seedPlan, txDoc } from './recurring-helpers'

const db = testDb()
const deps = makeDeps(db)
/** ZUS of 15 November (a Sunday) planned for Monday the 16th, an estimate. */
const PLAN = planOf('2026-11-15', { paymentDate: '2026-11-16', accrual: { mode: 'date', date: '2026-11-16' }, estimated: true })

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof LedgerError ? `${e.code}:${e.field}` : `other:${String(e)}`
  }
  return 'none'
}

/** The create body the undo of a delete sends (lib/api/transaction-undo.ts), through the create route's parser. */
function restoreInput(tx: LedgerTransaction = PLAN) {
  return parseTransactionInput(
    { clientId: tx.id, type: tx.type, status: tx.status, accountId: tx.accountId, amountMinor: tx.amountMinor, paymentDate: tx.paymentDate, tags: tx.tags, fileUrls: tx.fileUrls },
    { internal: true },
  )
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'mil', 'PLN', 500_000)
  await seedPlan(db, PLAN)
})

describe('«Позначити сплаченою» on an occurrence (S11)', () => {
  it('the operation becomes actual with its link, the occurrence is paid by it, the balance moves', async () => {
    await updateTransaction(deps, ORG, UID, PLAN.id, { status: 'actual', paymentDate: TODAY })
    expect(await txDoc(db, PLAN.id)).toMatchObject({ status: 'actual', paymentDate: TODAY, seriesId: 'ser1', occurrence: '2026-11-15', estimated: true })
    expect(await markDoc(db, PLAN.id)).toMatchObject({ reason: 'paid', txId: PLAN.id, seriesId: 'ser1', occurrence: '2026-11-15', estimated: true, manual: false, by: UID })
    expect(await balanceOf(db, ORG, 'mil')).toBe(380_000)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('its undo (the earlier state written back) makes it a plan again and lifts the mark', async () => {
    await updateTransaction(deps, ORG, UID, PLAN.id, { status: 'actual', paymentDate: TODAY })
    await updateTransaction(deps, ORG, UID, PLAN.id, fullPatch(toRawInput(PLAN)), { restore: true })
    const doc = await txDoc(db, PLAN.id)
    expect(doc).toMatchObject({ status: 'planned', paymentDate: '2026-11-16', estimated: true })
    expect(doc?.manual).toBeUndefined()
    expect(await markDoc(db, PLAN.id)).toBeUndefined()
    expect(await balanceOf(db, ORG, 'mil')).toBe(500_000)
  })
})

describe('a person changes a planned occurrence', () => {
  it('a new amount makes it manual and no longer an estimate; no mark moves', async () => {
    await updateTransaction(deps, ORG, UID, PLAN.id, { amountMinor: 130_000 })
    const doc = await txDoc(db, PLAN.id)
    expect(doc).toMatchObject({ status: 'planned', amountMinor: 130_000, manual: true, seriesId: 'ser1' })
    expect(doc?.estimated).toBeUndefined()
    expect(await markDoc(db, PLAN.id)).toBeUndefined()
  })

  it('a new comment or a new tag (the bulk path too) makes it manual, the estimate stays', async () => {
    await seedTag(db, ORG, 'q4')
    await updateTransaction(deps, ORG, UID, PLAN.id, { description: 'grudzień' })
    expect(await txDoc(db, PLAN.id)).toMatchObject({ manual: true, estimated: true })
    const dec = planOf('2026-12-15')
    await seedPlan(db, dec)
    await retagTransaction(deps, ORG, UID, dec.id, { add: ['q4'], remove: [] })
    expect(await txDoc(db, dec.id)).toMatchObject({ manual: true, tags: ['q4'] })
  })

  it('a request can never set the series fields', async () => {
    expect(await code(updateTransaction(deps, ORG, UID, PLAN.id, { seriesId: 'other' }))).toBe('invalid_input:seriesId')
  })
})

describe('deleting and bringing back an occurrence', () => {
  it('a deleted plan is marked deleted; its undo brings it back with its link and lifts the mark', async () => {
    await deleteTransaction(deps, ORG, UID, PLAN.id)
    expect(await txDoc(db, PLAN.id)).toBeUndefined()
    expect(await markDoc(db, PLAN.id)).toMatchObject({ reason: 'deleted', estimated: true, manual: false })
    const { transaction, replayed } = await createTransaction(deps, ORG, UID, restoreInput())
    expect(replayed).toBe(false)
    expect(transaction).toMatchObject({ id: PLAN.id, status: 'planned', seriesId: 'ser1', occurrence: '2026-11-15', estimated: true })
    expect(await markDoc(db, PLAN.id)).toBeUndefined()
    expect(await auditActions(db, ORG)).toEqual(['tx.create', 'tx.delete'])
  })

  it('a second restore of the same plan is a replay, not a second operation', async () => {
    await deleteTransaction(deps, ORG, UID, PLAN.id)
    await createTransaction(deps, ORG, UID, restoreInput())
    expect((await createTransaction(deps, ORG, UID, restoreInput())).replayed).toBe(true)
    expect(await auditActions(db, ORG)).toEqual(['tx.create', 'tx.delete'])
  })

  it('a plan id without a mark, or with the paid mark of a match, cannot be created', async () => {
    const jan = planOf('2027-01-15')
    expect(await code(createTransaction(deps, ORG, UID, restoreInput(jan)))).toBe('invalid_input:clientId')
    await db.doc(`organizations/${ORG}/recurringDone/${jan.id}`).set({
      schemaVersion: 1, seriesId: 'ser1', occurrence: '2027-01-15', reason: 'paid', txId: `bk_${'a'.repeat(32)}`, estimated: false, manual: false,
    })
    expect(await code(createTransaction(deps, ORG, UID, restoreInput(jan)))).toBe('invalid_input:clientId')
  })

  it('deleting a paid occurrence keeps its paid mark', async () => {
    await updateTransaction(deps, ORG, UID, PLAN.id, { status: 'actual', paymentDate: TODAY })
    await deleteTransaction(deps, ORG, UID, PLAN.id)
    expect(await markDoc(db, PLAN.id)).toMatchObject({ reason: 'paid', txId: PLAN.id })
    expect(await balanceOf(db, ORG, 'mil')).toBe(500_000)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /f/AI/finflow && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts tests/integration/ledger-plan-marks.test.ts"`
Expected: FAIL (позначок немає; після оновлення поля серії зникають; відновлення під `pl_` відмовляє або створює операцію без серії).

- [ ] **Step 3: Implement**

`lib/server/ledger/paths.ts`: у кінець файлу додати:

```ts
/** The series of planned payments (S11): written by the server, readable by members (firestore.rules). */
export const recurringCol = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('recurring')
/** One mark per settled occurrence (S11: paid, skipped, deleted), id = the plan id: closed to clients (firestore.rules). */
export const recurringDoneCol = (db: Firestore, orgId: string) => orgRef(db, orgId).collection('recurringDone')
```

`lib/server/ledger/audit.ts`:

1. Рядок `  | 'tag.create' | 'tag.update'` замінити на:

```ts
  | 'tag.create' | 'tag.update'
  | 'recurring.create' | 'recurring.update' | 'recurring.delete'
```

2. Блок `AuditMeta` замінити на:

```ts
/**
 * What made a change when it was not a plain edit of the operation: the rules (S10), a tag's flag (S10t), making or
 * splitting a transfer (S10b: the operation changed type, went into the transfer, or came back out of it), or planned
 * payments (S11: a series created, rewrote or deleted its plans, a match linked a bank operation to a plan, a skip).
 */
export interface AuditMeta {
  via?: 'rule' | 'tag' | 'transfer' | 'plan'
}
```

`lib/server/ledger/write.ts`:

1. Імпорти. Рядок `import { FieldValue, Timestamp, type DocumentSnapshot, type Firestore, type QuerySnapshot, type Transaction } from 'firebase-admin/firestore'` замінити на:

```ts
import { FieldValue, Timestamp, type DocumentReference, type DocumentSnapshot, type Firestore, type QuerySnapshot, type Transaction } from 'firebase-admin/firestore'
```

рядок `import { applyPatch, BANK_CLIENT_ID_PREFIX, toRawInput, type TransactionInput, type TransactionPatch } from '@/lib/domain/ledger/input'` замінити на:

```ts
import { applyPatch, BANK_CLIENT_ID_PREFIX, PLAN_CLIENT_ID_PREFIX, toRawInput, type TransactionInput, type TransactionPatch } from '@/lib/domain/ledger/input'
```

після рядка `import { nest } from '@/lib/domain/ledger/rollups'` додати:

```ts
import { markChangeOf, withSeries, type MarkChange } from '@/lib/domain/ledger/series'
```

після рядка `import { excludedFromTags, tagFlagsOf, withExcluded } from '@/lib/domain/tags/exclude'` додати:

```ts
import { doneToDoc, parseDone } from '@/lib/domain/recurring/doc'
import { parsePlanId, planId } from '@/lib/domain/recurring/plan'
import type { DoneReason } from '@/lib/domain/recurring/types'
```

рядок `import { accountsCol, auditCol, categoriesCol, counterpartiesCol, orgRef, rollupsCol, tagsCol, transactionsCol } from './paths'` замінити на:

```ts
import { accountsCol, auditCol, categoriesCol, counterpartiesCol, orgRef, recurringDoneCol, rollupsCol, tagsCol, transactionsCol } from './paths'
```

2. Перейменувати `refuseBankId` на `refuseClientId` в усьому файлі (Edit з `replace_all: true`, `old_string` = `refuseBankId`, `new_string` = `refuseClientId`): вона відмовляє будь-якому зарезервованому id, не лише банківському.

3. В інтерфейсі `Job` після рядка `  sideKeys?: string[]` додати:

```ts
  /**
   * The mark of the occurrence this write moves (S11, `markChangeOf`). `restoreReason` is the reason of the mark a create
   * under a plan id came back from: inside the transaction it must still be that mark.
   */
  planMark?: { change: MarkChange; restoreReason?: DoneReason }
```

4. У `commit` після рядків

```ts
      const holders = await t.get(transactionsCol(db, orgId).where('bankTo.key', '==', key).limit(2))
      sideReads.push({ own, holders })
    }
```

додати:

```ts
    // S11: the mark of the occurrence this write settles, clears or deletes. Read here, so a concurrent write of the same
    // occurrence (a match, a skip, another restore) conflicts and retries.
    const markOf = job.next?.tx ?? job.prior?.tx
    const markRef =
      job.planMark !== undefined && markOf?.seriesId !== undefined && markOf.occurrence !== undefined
        ? recurringDoneCol(db, orgId).doc(planId(markOf.seriesId, markOf.occurrence))
        : null
    const markSnap = markRef === null ? null : await t.get(markRef)
```

5. У `commit` після рядків

```ts
    } else {
      if (!currentSnap.exists) throw new LedgerError('not_found')
      if (!currentSnap.updateTime || !currentSnap.updateTime.isEqual(job.prior.version)) throw new LedgerError('conflict')
    }
```

додати:

```ts
    // The mark a restore comes back from must still be there (a second restore or a match in between took it).
    const restoreReason = job.planMark?.restoreReason
    if (restoreReason !== undefined && (markSnap === null || !markSnap.exists || markSnap.get('reason') !== restoreReason)) {
      throw new LedgerError('conflict')
    }
```

6. У `commit` після рядків

```ts
    if (next) {
      t.set(txRef, storedDoc(next, orgId, uid, ts, job.prior ? (currentSnap.data() ?? {}) : undefined))
    } else {
      t.delete(txRef)
    }
```

додати:

```ts
    if (markRef !== null && job.planMark !== undefined) {
      writeMark(t, markRef, markSnap, job.planMark.change, next ?? (job.prior as NonNullable<typeof job.prior>).tx, job.txId, uid, ts)
    }
```

7. Після функції `refuseClientId` (колишньої `refuseBankId`) додати:

```ts
/**
 * Writes the move of an occurrence mark (S11, `markChangeOf`) inside the write's transaction. `clear` lifts only a mark this
 * operation may lift: a skip or a delete it comes back from, or the `paid` it wrote itself; never the `paid` of a match.
 */
function writeMark(
  t: Transaction,
  ref: DocumentReference,
  snap: DocumentSnapshot | null,
  change: MarkChange,
  tx: LedgerTransaction,
  txId: string,
  uid: string,
  ts: Timestamp,
): void {
  if (change === 'clear') {
    if (snap?.exists && (snap.get('reason') !== 'paid' || snap.get('txId') === txId)) t.delete(ref)
    return
  }
  const mark = doneToDoc({
    seriesId: tx.seriesId as string,
    occurrence: tx.occurrence as string,
    reason: change === 'paid' ? 'paid' : 'deleted',
    estimated: tx.estimated === true,
    manual: tx.manual === true,
    ...(change === 'paid' ? { txId } : {}),
  })
  t.set(ref, { ...mark, at: ts, by: uid })
}

/** What a create under a plan id brings back (S11): the series link from the mark, or the operation already back (a retry). */
type PlanRestore = { fields: Partial<LedgerTransaction>; reason: DoneReason } | { replay: LedgerTransaction }

/**
 * The series link of a create under a plan id (`pl_`, S11), or undefined for any other id. Only the occurrence's own mark
 * says the operation was a plan of that series: a skipped or deleted plan, or one the person had marked paid itself. The
 * create takes `seriesId`, `occurrence`, `estimated` and `manual` from it, and `commit` lifts the mark (or keeps `paid`).
 * A retry of a restore that went through (no mark, the operation back) is a replay. Anything else, the `paid` of a match
 * included (its undo is `POST /recurring/matches`), is `invalid_input` on `clientId`.
 */
async function planRestoreOf(deps: LedgerDeps, orgId: string, input: TransactionInput): Promise<PlanRestore | undefined> {
  const id = input.clientId
  if (id === undefined || !id.startsWith(PLAN_CLIENT_ID_PREFIX)) return undefined
  const parts = parsePlanId(id)
  if (parts === null || input.type === 'transfer') refuseClientId()
  const snap = await recurringDoneCol(deps.db, orgId).doc(id).get()
  const mark = snap.exists ? parseDone(snap.id, snap.data()) : null
  if (mark === null) {
    const existing = await transactionsCol(deps.db, orgId).doc(id).get()
    const tx = existing.exists ? parseTransaction(existing.id, existing.data()) : null
    if (tx !== null && tx.seriesId === parts.seriesId) return { replay: tx }
    refuseClientId()
  }
  if (!(mark.reason === 'skipped' || mark.reason === 'deleted' || (mark.reason === 'paid' && mark.txId === id))) refuseClientId()
  const fields: Partial<LedgerTransaction> = { seriesId: parts.seriesId, occurrence: parts.occurrence }
  if (mark.estimated) fields.estimated = true
  if (mark.manual) fields.manual = true
  return { fields, reason: mark.reason }
}
```

8. У `createTransaction` рядки

```ts
  const restore = bank !== undefined ? undefined : await bankSidesOf(deps, orgId, input)
  const next = await prepare(deps, orgId, txId, input)
  if (bank !== undefined) next.tx = { ...next.tx, bank }
  else if (restore !== undefined) next.tx = { ...next.tx, ...restore.sides }
```

замінити на

```ts
  const restore = bank !== undefined ? undefined : await bankSidesOf(deps, orgId, input)
  const plan = await planRestoreOf(deps, orgId, input)
  if (plan !== undefined && 'replay' in plan) return { transaction: plan.replay, replayed: true }
  const next = await prepare(deps, orgId, txId, input)
  if (bank !== undefined) next.tx = { ...next.tx, bank }
  else if (restore !== undefined) next.tx = { ...next.tx, ...restore.sides }
  if (plan !== undefined) next.tx = { ...next.tx, ...plan.fields }
```

а в об'єкті, який `createTransaction` передає в `commit`, після рядка `    sideKeys: restore?.keys ?? [],` додати:

```ts
    planMark: plan === undefined ? undefined : { change: markChangeOf(null, next.tx) ?? 'clear', restoreReason: plan.reason },
```

9. У `updateTransaction` перед рядком `  const given = extras.autoRules ?? []` додати:

```ts
  // toRawInput never carries the series link either (S11): it comes from the prior document, and a person's change of a
  // planned occurrence makes it «змінено вручну».
  if (prior.tx.seriesId !== undefined) next.tx = withSeries(next.tx, prior.tx)
  const mark = markChangeOf(prior.tx, next.tx)
```

а в об'єкті, який `updateTransaction` передає в `commit`, після рядка `    restore: extras.restore === true,` додати:

```ts
    planMark: mark === null ? undefined : { change: mark },
```

10. `deleteTransaction` замінити повністю на:

```ts
export async function deleteTransaction(deps: LedgerDeps, orgId: string, uid: string, txId: string): Promise<WriteResult> {
  const prior = await loadPrior(deps, orgId, txId)
  // S11: a planned occurrence a person deletes is marked deleted (the generator never brings it back; an undo does).
  const mark = markChangeOf(prior.tx, null)
  return commit(deps, orgId, uid, { action: 'tx.delete', txId, prior, next: null, planMark: mark === null ? undefined : { change: mark } })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /f/AI/finflow && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts tests/integration/ledger-plan-marks.test.ts tests/integration/ledger-transactions.test.ts tests/integration/ledger-restore.test.ts tests/integration/bank-undo.test.ts tests/integration/ledger-tags.test.ts tests/integration/journal-bulk.test.ts" && npx vitest run --config vitest.config.ts tests/unit/domain/ledger tests/unit/server && npm run typecheck && npm run lint
```

Expected: усі PASS (нові 10 сценаріїв, наявні сценарії ledger, відновлення, банківського undo, тегів і масових дій без змін), `tsc` чисто, `lint` 0 errors / 10 warnings.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add lib/server/ledger/paths.ts lib/server/ledger/audit.ts lib/server/ledger/write.ts tests/integration/recurring-helpers.ts tests/integration/ledger-plan-marks.test.ts && git commit -m "feat(ledger): occurrence marks for paid, deleted and restored plans in the write transaction

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Ledger: серія (створити, заповнити, змінити, видалити), захист рахунку

**Files:**
- Create: `lib/server/ledger/series.ts`
- Modify: `lib/server/ledger/accounts.ts`, `lib/server/ledger/index.ts`
- Test: `tests/integration/ledger-series.test.ts`, `tests/unit/domain/recurring/out-of-reports.test.ts` (створити)

- [ ] **Step 1: Write the failing tests**

Створити `tests/unit/domain/recurring/out-of-reports.test.ts` (регресія: планові операції не рахуються ніде, крім журналу):

```ts
import { describe, expect, it } from 'vitest'
import { changeSet } from '@/lib/domain/ledger/change'
import { balanceEffects, datedEffects } from '@/lib/domain/ledger/effects'
import { contributions } from '@/lib/domain/ledger/rollups'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { toUiTransaction } from '@/lib/firebase/ledger-map'
import { isListed } from '@/lib/utils/journal'

const plan: LedgerTransaction = {
  id: 'pl_ser1_2026-11-10', type: 'expense', status: 'planned', accountId: 'mil', amountMinor: 250_000, currency: 'EUR',
  paymentDate: '2026-11-10', accrual: { mode: 'date', date: '2026-11-10' }, isRecurring: false, tags: ['vat'], fileUrls: [],
  categoryId: 'rent', seriesId: 'ser1', occurrence: '2026-11-10', estimated: true, excluded: true,
}

describe('a planned occurrence stays out of balances, rollups, reports and the Calendar (S11)', () => {
  it('moves no account and adds to no rollup, even in another currency without base amounts', () => {
    expect(datedEffects(plan)).toEqual([])
    expect(balanceEffects(plan)).toEqual({})
    expect([...contributions(plan, 'PLN')]).toEqual([])
    const change = changeSet(null, plan, 'PLN')
    expect(change.balanceDeltas).toEqual({})
    expect([...change.rollupDeltas]).toEqual([])
  })

  it('is listed by the journal only: the reports and the Calendar read without planned operations', () => {
    const ui = toUiTransaction('org1', plan)
    expect(isListed(ui, false)).toBe(false)
    expect(isListed(ui, true)).toBe(true)
  })
})
```

Створити `tests/integration/ledger-series.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { RecurringError } from '@/lib/domain/recurring/errors'
import { parseSeriesInput, parseSeriesPatch, type SeriesInput } from '@/lib/domain/recurring/input'
import { deleteAccount } from '@/lib/server/ledger/accounts'
import { createSeries, deleteSeries, fillSeries, updateSeries } from '@/lib/server/ledger/series'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { deleteTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { ORG, TODAY, UID, auditActions, balanceOf, clearFirestore, makeDeps, readDoc, seedAccount, seedCategory, seedCounterparty, seedOrg, testDb } from './helpers'
import { markDoc, txDoc } from './recurring-helpers'

const db = testDb()
const deps = makeDeps(db)
const on = (today: string) => makeDeps(db, { today: () => today })
// TODAY is 2026-10-27: the window reaches 2027-01-27.
const RENT: SeriesInput = parseSeriesInput({ name: 'Czynsz', kind: 'expense', accountId: 'mil', amountMinor: 250_000, frequency: 'monthly', dayOfMonth: 10, startDate: '2026-10-01', categoryId: 'rent' })
const ZUS: SeriesInput = parseSeriesInput({ name: 'ZUS', kind: 'expense', accountId: 'mil', amountMinor: 150_000, frequency: 'monthly', startDate: '2026-10-01', preset: 'zus' })

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return e instanceof LedgerError || e instanceof RecurringError ? `${e.code}:${e.field}` : `other:${String(e)}`
  }
  return 'none'
}

/** The planned operations of a series, by id. */
async function plansOf(seriesId: string): Promise<string[]> {
  const snap = await db.collection(`organizations/${ORG}/transactions`).where('seriesId', '==', seriesId).get()
  return snap.docs.filter((d) => d.get('status') === 'planned').map((d) => d.id).sort()
}

const ids = (seriesId: string, days: string[]) => days.map((d) => `pl_${seriesId}_${d}`)
const seriesDoc = (id: string) => readDoc(db, `organizations/${ORG}/recurring/${id}`)

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'mil', 'PLN', 500_000)
  await seedCategory(db, ORG, 'rent', 'expense')
})

describe('creating a series (S11)', () => {
  it('writes the series and the plans of the next three months under deterministic ids; nothing moves', async () => {
    const { series, created } = await createSeries(deps, ORG, UID, RENT)
    expect(created).toBe(3)
    expect(await plansOf(series.id)).toEqual(ids(series.id, ['2026-11-10', '2026-12-10', '2027-01-10']))
    expect(await txDoc(db, `pl_${series.id}_2026-11-10`)).toMatchObject({
      status: 'planned', type: 'expense', amountMinor: 250_000, categoryId: 'rent', paymentDate: '2026-11-10', isRecurring: false,
      seriesId: series.id, occurrence: '2026-11-10', createdBy: UID,
    })
    expect(await seriesDoc(series.id)).toMatchObject({ name: 'Czynsz', currency: 'PLN', status: 'active', generatedThrough: '2027-01-27', dueOn: '2026-10-28', version: 1, createdBy: UID })
    expect(await balanceOf(db, ORG, 'mil')).toBe(500_000)
    expect((await db.collection(`organizations/${ORG}/rollups`).get()).size).toBe(0)
    expect(await auditActions(db, ORG)).toEqual(['recurring.create', 'tx.create', 'tx.create', 'tx.create'])
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('moves a weekend day to the next business day and keeps the occurrence in the id', async () => {
    const { series } = await createSeries(deps, ORG, UID, { ...RENT, dayOfMonth: 15, weekendRule: 'next' })
    expect(await txDoc(db, `pl_${series.id}_2026-11-15`)).toMatchObject({ paymentDate: '2026-11-16', occurrence: '2026-11-15' })
  })

  it('refuses a missing account or category, and a series beyond the limit', async () => {
    expect(await code(createSeries(deps, ORG, UID, { ...RENT, accountId: 'nope' }))).toBe('account_not_found:accountId')
    expect(await code(createSeries(deps, ORG, UID, { ...RENT, categoryId: 'nope' }))).toBe('category_not_found:categoryId')
    await createSeries(deps, ORG, UID, RENT, { maxCount: 1 })
    expect(await code(createSeries(deps, ORG, UID, RENT, { maxCount: 1 }))).toBe('limit_reached:undefined')
  })

  it('a preset takes the ZUS record of S06, creating it once when the company has none', async () => {
    const first = await createSeries(deps, ORG, UID, ZUS)
    expect(first.series).toMatchObject({ counterpartyId: 'system_zus', estimated: true, weekendRule: 'next', dayOfMonth: 15 })
    expect(await readDoc(db, `organizations/${ORG}/counterparties/system_zus`)).toMatchObject({ name: 'ZUS', kind: 'zus' })
    expect((await createSeries(deps, ORG, UID, ZUS)).series.counterpartyId).toBe('system_zus')
    expect((await db.collection(`organizations/${ORG}/counterparties`).get()).size).toBe(1)
    expect(await txDoc(db, `pl_${first.series.id}_2026-11-15`)).toMatchObject({ counterpartyId: 'system_zus', estimated: true, paymentDate: '2026-11-16' })
  })

  it('a preset whose name a person already took uses that record, not a duplicate', async () => {
    await seedCounterparty(db, ORG, 'my-zus')
    await db.doc(`organizations/${ORG}/counterpartyKeys/name_zus`).set({ counterpartyId: 'my-zus' })
    expect((await createSeries(deps, ORG, UID, ZUS)).series.counterpartyId).toBe('my-zus')
  })
})

describe('the daily fill', () => {
  it('is not due again the same day; the next day it adds only what the window gained', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    expect(await fillSeries(deps, ORG, series.id)).toEqual({ due: false, created: 0 })
    expect(await fillSeries(on('2026-11-27'), ORG, series.id)).toEqual({ due: true, created: 1 })
    expect(await plansOf(series.id)).toContain(`pl_${series.id}_2027-02-10`)
    expect(await seriesDoc(series.id)).toMatchObject({ generatedThrough: '2027-02-27', dueOn: '2026-11-28', version: 1 })
  })

  it('two fills at once and a fill repeated create nothing twice', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    const runs = await Promise.all([fillSeries(on('2026-11-27'), ORG, series.id), fillSeries(on('2026-11-27'), ORG, series.id)])
    expect(runs.map((r) => r.created).sort()).toEqual([0, 1])
    expect(await fillSeries(on('2026-11-27'), ORG, series.id)).toEqual({ due: false, created: 0 })
    expect(await plansOf(series.id)).toHaveLength(4)
  })

  it('catches up after weeks without a call: the missed occurrences come as overdue plans', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    expect((await fillSeries(on('2027-04-01'), ORG, series.id)).created).toBe(5)
    expect(await plansOf(series.id)).toEqual(ids(series.id, ['2026-11-10', '2026-12-10', '2027-01-10', '2027-02-10', '2027-03-10', '2027-04-10', '2027-05-10', '2027-06-10']))
  })

  it('never creates an occurrence that already has a mark', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    const id = `pl_${series.id}_2027-02-10`
    await db.doc(`organizations/${ORG}/recurringDone/${id}`).set({ schemaVersion: 1, seriesId: series.id, occurrence: '2027-02-10', reason: 'skipped', estimated: false, manual: false })
    expect(await fillSeries(on('2026-11-27'), ORG, series.id)).toEqual({ due: true, created: 0 })
    expect(await txDoc(db, id)).toBeUndefined()
  })

  it('a deleted category stays out of the new plans; the series still fills', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    await db.doc(`organizations/${ORG}/categories/rent`).delete()
    await fillSeries(on('2026-11-27'), ORG, series.id)
    expect((await txDoc(db, `pl_${series.id}_2027-02-10`))?.categoryId).toBeUndefined()
  })
})

describe('changing a series', () => {
  it('rewrites the future unpaid plans, not the paid or hand-changed ones', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    const [nov, dec, jan] = ids(series.id, ['2026-11-10', '2026-12-10', '2027-01-10'])
    await updateTransaction(deps, ORG, UID, nov, { status: 'actual', paymentDate: TODAY })
    await updateTransaction(deps, ORG, UID, dec, { description: 'grudzień' })
    expect(await updateSeries(deps, ORG, UID, series.id, parseSeriesPatch({ amountMinor: 260_000 }))).toMatchObject({ created: 0, updated: 1, deleted: 0 })
    expect(await txDoc(db, jan)).toMatchObject({ amountMinor: 260_000, status: 'planned' })
    expect(await txDoc(db, dec)).toMatchObject({ amountMinor: 250_000, manual: true })
    expect(await txDoc(db, nov)).toMatchObject({ amountMinor: 250_000, status: 'actual' })
    expect(await seriesDoc(series.id)).toMatchObject({ amountMinor: 260_000, version: 2 })
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('a new day moves the unpaid plans to their new dates; a month already paid gets no second plan', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    await updateTransaction(deps, ORG, UID, `pl_${series.id}_2026-11-10`, { status: 'actual', paymentDate: TODAY })
    expect(await updateSeries(deps, ORG, UID, series.id, parseSeriesPatch({ dayOfMonth: 20 }))).toMatchObject({ created: 2, updated: 0, deleted: 2 })
    expect(await plansOf(series.id)).toEqual(ids(series.id, ['2026-12-20', '2027-01-20']))
    expect(await markDoc(db, `pl_${series.id}_2026-12-10`)).toBeUndefined()
  })

  it('an occurrence a person deleted is not planned again by a change', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    await deleteTransaction(deps, ORG, UID, `pl_${series.id}_2026-12-10`)
    await updateSeries(deps, ORG, UID, series.id, parseSeriesPatch({ amountMinor: 260_000 }))
    expect(await plansOf(series.id)).toEqual(ids(series.id, ['2026-11-10', '2027-01-10']))
  })

  it('a pause stops the fill and may remove the future plans; resuming plans the window again', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    const paused = await updateSeries(deps, ORG, UID, series.id, parseSeriesPatch({ status: 'paused', removeFuture: true }))
    expect(paused).toMatchObject({ deleted: 3, series: { status: 'paused' } })
    expect(paused.series.dueOn).toBeUndefined()
    expect(await plansOf(series.id)).toEqual([])
    expect(await fillSeries(on('2026-11-27'), ORG, series.id)).toEqual({ due: false, created: 0 })
    expect(await updateSeries(deps, ORG, UID, series.id, parseSeriesPatch({ status: 'active' }))).toMatchObject({ created: 3, series: { status: 'active', dueOn: '2026-10-28' } })
  })

  it('refuses a new category that does not exist; an unchanged deleted one does not block a change', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    expect(await code(updateSeries(deps, ORG, UID, series.id, parseSeriesPatch({ categoryId: 'nope' })))).toBe('category_not_found:categoryId')
    await db.doc(`organizations/${ORG}/categories/rent`).delete()
    expect(await code(updateSeries(deps, ORG, UID, series.id, parseSeriesPatch({ name: 'Czynsz biuro' })))).toBe('none')
  })

  it('an unknown series is not found', async () => {
    expect(await code(updateSeries(deps, ORG, UID, 'nope', parseSeriesPatch({ name: 'x' })))).toBe('not_found:undefined')
  })
})

describe('deleting a series', () => {
  it('deletes the future unpaid plans by default and keeps the paid ones', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    await updateTransaction(deps, ORG, UID, `pl_${series.id}_2026-11-10`, { status: 'actual', paymentDate: TODAY })
    expect(await deleteSeries(deps, ORG, UID, series.id, 'delete')).toEqual({ deleted: 2 })
    expect(await seriesDoc(series.id)).toBeUndefined()
    expect(await txDoc(db, `pl_${series.id}_2026-11-10`)).toMatchObject({ status: 'actual', seriesId: series.id })
    expect(await plansOf(series.id)).toEqual([])
    expect(await balanceOf(db, ORG, 'mil')).toBe(250_000)
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('keeps them when asked', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    expect(await deleteSeries(deps, ORG, UID, series.id, 'keep')).toEqual({ deleted: 0 })
    expect(await plansOf(series.id)).toHaveLength(3)
  })
})

describe('an account a series uses', () => {
  it('cannot be deleted while the series lives, even without operations', async () => {
    const { series } = await createSeries(deps, ORG, UID, RENT)
    await updateSeries(deps, ORG, UID, series.id, parseSeriesPatch({ status: 'paused', removeFuture: true }))
    expect(await code(deleteAccount(deps, ORG, UID, 'mil'))).toBe('account_has_operations:recurring')
    await deleteSeries(deps, ORG, UID, series.id, 'delete')
    expect(await code(deleteAccount(deps, ORG, UID, 'mil'))).toBe('none')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/recurring/out-of-reports.test.ts; export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts tests/integration/ledger-series.test.ts"
```

Expected: `out-of-reports.test.ts` PASS одразу (це регресія наявної поведінки, перевірено читанням `effects.ts`, `rollups.ts`, `lib/utils/journal.ts`); інтеграційний FAIL (`@/lib/server/ledger/series` не існує).

- [ ] **Step 3: Implement**

Створити `lib/server/ledger/series.ts`:

```ts
import { FieldValue, Timestamp, type DocumentReference, type DocumentSnapshot, type Firestore, type Transaction } from 'firebase-admin/firestore'
import { counterpartyToDoc } from '@/lib/domain/counterparties/doc'
import { nameKey } from '@/lib/domain/counterparties/normalize'
import { systemCounterparty } from '@/lib/domain/counterparties/system'
import { buildTransaction } from '@/lib/domain/ledger/build'
import { changeSet, combineChanges } from '@/lib/domain/ledger/change'
import { addDays } from '@/lib/domain/ledger/days'
import { parseAccount, parseTransaction, transactionToDoc } from '@/lib/domain/ledger/doc'
import { LedgerError } from '@/lib/domain/ledger/errors'
import type { LedgerAccount, LedgerTransaction } from '@/lib/domain/ledger/types'
import { parseDone, parseSeries, seriesToDoc } from '@/lib/domain/recurring/doc'
import { RecurringError } from '@/lib/domain/recurring/errors'
import { applySeriesPatch, assertSeriesHorizon, seriesFromInput, type SeriesInput, type SeriesPatch } from '@/lib/domain/recurring/input'
import { fillPlan, planId, planInputOf, rewriteOccurrences, rewriteState, seriesFieldsOf, type UsableRefs } from '@/lib/domain/recurring/plan'
import { presetCounterparty } from '@/lib/domain/recurring/presets'
import { periodOf, periodStart } from '@/lib/domain/recurring/schedule'
import { MARKS_SCAN, MAX_SERIES, MAX_SHIFT_DAYS, RECURRING_UID, REWRITE_CAP, type FutureMode, type Preset, type Series } from '@/lib/domain/recurring/types'
import { excludedFromTags, tagFlagsOf, withExcluded } from '@/lib/domain/tags/exclude'
import { auditData } from './audit'
import type { LedgerDeps } from './deps'
import { assertUnlocked } from './lock'
import { accountsCol, auditCol, categoriesCol, counterpartiesCol, counterpartyKeysCol, orgRef, recurringCol, recurringDoneCol, tagsCol, transactionsCol } from './paths'
import { applyChange, storedDoc } from './write'

/** The operations of a series from `day` on, by payment day (index `transactions (seriesId ASC, paymentDate ASC)`). */
export function seriesOpsQuery(db: Firestore, orgId: string, seriesId: string, day: string) {
  return transactionsCol(db, orgId).where('seriesId', '==', seriesId).where('paymentDate', '>=', day).orderBy('paymentDate')
}

/** The marks of a series from occurrence `day` on (index `recurringDone (seriesId ASC, occurrence ASC)`). */
export function seriesMarksQuery(db: Firestore, orgId: string, seriesId: string, day: string) {
  return recurringDoneCol(db, orgId).where('seriesId', '==', seriesId).where('occurrence', '>=', day).orderBy('occurrence')
}

async function readAll(t: Transaction, refs: DocumentReference[]): Promise<DocumentSnapshot[]> {
  return refs.length === 0 ? [] : t.getAll(...refs)
}

/** Which references a write gives anew (then an unusable one is refused); the others are only left out of the plans. */
interface Strict {
  category: boolean
  counterparty: boolean
  tags: readonly string[]
}
const NOT_STRICT: Strict = { category: false, counterparty: false, tags: [] }

interface PlanContext {
  baseCurrency: string
  account: LedgerAccount
  usable: UsableRefs
  /** `excluded` of a plan with the usable tags (S10t). */
  excluded: boolean
}

/**
 * Reads what the plans of a series depend on, inside the transaction: the company, the account (a plan needs it, so a
 * missing one is `account_not_found`), the category, the counterparty and the tags. A reference the write gives anew must
 * be usable (`category_not_found`, `counterparty_not_found`, `counterparty_archived`, `tag_not_found`, `tag_archived`);
 * an unchanged one that is gone or archived is left out of the plans. `knownCounterparty`: created by this transaction.
 */
async function readContext(t: Transaction, db: Firestore, orgId: string, s: Series, strict: Strict, knownCounterparty = false): Promise<PlanContext> {
  const orgSnap = await t.get(orgRef(db, orgId))
  const accountSnap = await t.get(accountsCol(db, orgId).doc(s.accountId))
  const categorySnap = s.categoryId === undefined ? null : await t.get(categoriesCol(db, orgId).doc(s.categoryId))
  const counterpartySnap = s.counterpartyId === undefined || knownCounterparty ? null : await t.get(counterpartiesCol(db, orgId).doc(s.counterpartyId))
  const tagSnaps: DocumentSnapshot[] = []
  for (const id of s.tags) tagSnaps.push(await t.get(tagsCol(db, orgId).doc(id)))

  if (!orgSnap.exists) throw new RecurringError('not_found')
  const account = accountSnap.exists ? parseAccount(accountSnap.id, accountSnap.data()) : null
  if (account === null) throw new LedgerError('account_not_found', 'accountId')
  const usable: UsableRefs = { tags: [] }
  if (categorySnap !== null) {
    if (categorySnap.exists && categorySnap.get('type') === s.kind) usable.categoryId = s.categoryId
    else if (strict.category) throw new LedgerError('category_not_found', 'categoryId')
  }
  if (s.counterpartyId !== undefined) {
    if (knownCounterparty || (counterpartySnap?.exists && counterpartySnap.get('archived') !== true)) usable.counterpartyId = s.counterpartyId
    else if (strict.counterparty) throw new LedgerError(counterpartySnap?.exists ? 'counterparty_archived' : 'counterparty_not_found', 'counterpartyId')
  }
  tagSnaps.forEach((snap, i) => {
    if (snap.exists && snap.get('archived') !== true) usable.tags.push(s.tags[i])
    else if (strict.tags.includes(s.tags[i])) throw new LedgerError(snap.exists ? 'tag_archived' : 'tag_not_found', 'tags')
  })
  return { baseCurrency: orgSnap.get('currency') as string, account, usable, excluded: excludedFromTags(usable.tags, tagFlagsOf(tagSnaps)) }
}

/** The planned operation of one occurrence, built by the ledger's own rule (`buildTransaction`) plus its series fields. */
function buildPlan(s: Series, occurrence: string, ctx: PlanContext, today: string): LedgerTransaction {
  const input = planInputOf(s, occurrence, ctx.usable)
  const built = buildTransaction(input.clientId as string, input, {
    today,
    account: ctx.account,
    category: ctx.usable.categoryId === undefined ? null : { type: s.kind },
    baseCurrency: ctx.baseCurrency,
  })
  return withExcluded({ ...built, ...seriesFieldsOf(s, occurrence) }, ctx.excluded)
}

function sameDoc(a: LedgerTransaction, b: LedgerTransaction): boolean {
  return JSON.stringify(transactionToDoc(a)) === JSON.stringify(transactionToDoc(b))
}

interface PlanWrites {
  creates: LedgerTransaction[]
  updates: Array<{ prior: LedgerTransaction; next: LedgerTransaction; old: Record<string, unknown> }>
  deletes: LedgerTransaction[]
}

/** The plans' writes of one transaction: the change sets (empty for plans, kept as the single rule), the documents, the audit. */
function writePlans(t: Transaction, deps: LedgerDeps, orgId: string, uid: string, w: PlanWrites, baseCurrency: string, ts: Timestamp): void {
  const { db } = deps
  applyChange(
    t,
    db,
    orgId,
    combineChanges(
      ...w.creates.map((c) => changeSet(null, c, baseCurrency)),
      ...w.updates.map((u) => changeSet(u.prior, u.next, baseCurrency)),
      ...w.deletes.map((d) => changeSet(d, null, baseCurrency)),
    ),
    ts,
  )
  const audit = (action: 'tx.create' | 'tx.update' | 'tx.delete', id: string, before: unknown, after: unknown) =>
    t.create(auditCol(db, orgId).doc(), auditData(deps, action, uid, id, before, after, { via: 'plan' }))
  for (const c of w.creates) {
    t.create(transactionsCol(db, orgId).doc(c.id), storedDoc(c, orgId, uid, ts))
    audit('tx.create', c.id, null, transactionToDoc(c))
  }
  for (const u of w.updates) {
    t.set(transactionsCol(db, orgId).doc(u.next.id), storedDoc(u.next, orgId, uid, ts, u.old))
    audit('tx.update', u.next.id, transactionToDoc(u.prior), transactionToDoc(u.next))
  }
  for (const d of w.deletes) {
    t.delete(transactionsCol(db, orgId).doc(d.id))
    audit('tx.delete', d.id, transactionToDoc(d), null)
  }
}

function withState(s: Series, state: { generatedThrough?: string; dueOn?: string }): Series {
  const out: Series = { ...s }
  delete out.generatedThrough
  delete out.dueOn
  if (state.generatedThrough !== undefined) out.generatedThrough = state.generatedThrough
  if (state.dueOn !== undefined) out.dueOn = state.dueOn
  return out
}

/** The stored series: its fields plus the bookkeeping; `version` counts the people's changes. */
function storedSeries(s: Series, orgId: string, uid: string, ts: Timestamp, old?: Record<string, unknown>): Record<string, unknown> {
  return {
    ...seriesToDoc(s),
    orgId,
    createdAt: old?.createdAt ?? ts,
    createdBy: old?.createdBy ?? uid,
    updatedAt: ts,
    updatedBy: uid,
    version: typeof old?.version === 'number' ? old.version + 1 : 1,
  }
}

interface PresetCounterparty {
  id: string
  /** The company has neither the system record nor a record with its name: this transaction creates it. */
  create: boolean
}

/** The counterparty of a preset (S06 system record): by its fixed id, else the record that owns its name, else a new one. */
async function presetCounterpartyIn(t: Transaction, db: Firestore, orgId: string, preset: Preset): Promise<PresetCounterparty> {
  const spec = presetCounterparty(preset)
  const own = await t.get(counterpartiesCol(db, orgId).doc(spec.id))
  if (own.exists) return { id: spec.id, create: false }
  const key = await t.get(counterpartyKeysCol(db, orgId).doc(nameKey(spec.name)))
  const holder: unknown = key.exists ? key.get('counterpartyId') : undefined
  if (typeof holder === 'string') return { id: holder, create: false }
  return { id: spec.id, create: true }
}

/** Creates the S06 system record of a preset with its name key and audit entry (as `seedExistingOrg` does). */
function writeSystemCounterparty(t: Transaction, deps: LedgerDeps, orgId: string, uid: string, preset: Preset, ts: Timestamp): void {
  const spec = presetCounterparty(preset)
  const c = systemCounterparty(spec)
  t.create(counterpartiesCol(deps.db, orgId).doc(spec.id), { ...counterpartyToDoc(c), orgId, createdAt: ts, updatedAt: ts })
  t.create(counterpartyKeysCol(deps.db, orgId).doc(nameKey(spec.name)), { counterpartyId: spec.id })
  t.create(auditCol(deps.db, orgId).doc(), auditData(deps, 'counterparty.create', uid, spec.id, null, counterpartyToDoc(c)))
}

export interface CreatedSeries {
  series: Series
  created: number
}

/**
 * A new series (S11) in ONE transaction: the limit, the references, the series document, the plans of its first fill
 * (from today to three months ahead) and the audit entries. A preset without a counterparty takes the S06 system record.
 */
export async function createSeries(deps: LedgerDeps, orgId: string, uid: string, input: SeriesInput, opts: { maxCount?: number } = {}): Promise<CreatedSeries> {
  const { db } = deps
  const today = deps.today()
  assertSeriesHorizon(input, today)
  const ref = recurringCol(db, orgId).doc()
  return db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const count = (await t.get(recurringCol(db, orgId).count())).data().count
    const preset = input.preset !== undefined && input.counterpartyId === undefined ? await presetCounterpartyIn(t, db, orgId, input.preset) : null
    const draft = seriesFromInput(ref.id, preset === null ? input : { ...input, counterpartyId: preset.id }, '')
    const ctx = await readContext(t, db, orgId, draft, { category: true, counterparty: true, tags: draft.tags }, preset?.create === true)
    if (count >= (opts.maxCount ?? MAX_SERIES)) throw new RecurringError('limit_reached')

    const base: Series = { ...draft, currency: ctx.account.currency }
    const fill = fillPlan(base, today)
    const creates = fill.occurrences.map((o) => buildPlan(base, o, ctx, today))
    const series = withState(base, fill)
    const ts = Timestamp.fromDate(deps.now())
    if (preset?.create === true && input.preset !== undefined) writeSystemCounterparty(t, deps, orgId, uid, input.preset, ts)
    t.create(ref, storedSeries(series, orgId, uid, ts))
    t.create(auditCol(db, orgId).doc(), auditData(deps, 'recurring.create', uid, ref.id, null, seriesToDoc(series)))
    writePlans(t, deps, orgId, uid, { creates, updates: [], deletes: [] }, ctx.baseCurrency, ts)
    return { series, created: creates.length }
  })
}

export interface FillResult {
  /** False: the series is gone, paused, ended or already filled today (a parallel run did it). */
  due: boolean
  created: number
}

/**
 * The daily fill of one series (S11) in ONE transaction: due (`dueOn <= today`, checked inside, so two runs at once fill
 * once), the occurrences `fillPlan` gives (catch-up included), each created only when neither its operation nor its mark
 * exists, then the new fill state. Written as `system`. An unreadable series is refused (the cron reports it and waits a
 * day); a missing account is `account_not_found`.
 */
export async function fillSeries(deps: LedgerDeps, orgId: string, seriesId: string): Promise<FillResult> {
  const { db } = deps
  const ref = recurringCol(db, orgId).doc(seriesId)
  return db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const snap = await t.get(ref)
    const series = snap.exists ? parseSeries(snap.id, snap.data()) : null
    if (snap.exists && series === null) throw new RecurringError('invalid_input', 'series')
    const today = deps.today()
    if (series === null || series.dueOn === undefined || series.dueOn > today) return { due: false, created: 0 }
    const fill = fillPlan(series, today)
    const ctx = await readContext(t, db, orgId, series, NOT_STRICT)
    const ids = fill.occurrences.map((o) => planId(series.id, o))
    const ops = await readAll(t, ids.map((id) => transactionsCol(db, orgId).doc(id)))
    const marks = await readAll(t, ids.map((id) => recurringDoneCol(db, orgId).doc(id)))
    const creates = fill.occurrences.filter((_, i) => !ops[i].exists && !marks[i].exists).map((o) => buildPlan(series, o, ctx, today))
    const ts = Timestamp.fromDate(deps.now())
    writePlans(t, deps, orgId, RECURRING_UID, { creates, updates: [], deletes: [] }, ctx.baseCurrency, ts)
    t.update(ref, {
      generatedThrough: fill.generatedThrough ?? FieldValue.delete(),
      dueOn: fill.dueOn ?? FieldValue.delete(),
      currency: ctx.account.currency,
    })
    return { due: true, created: creates.length }
  })
}

export interface UpdatedSeries {
  series: Series
  created: number
  updated: number
  deleted: number
}

/**
 * A change of a series (S11) in ONE transaction. Paused: no new plans (`removeFuture` deletes the future unpaid ones, manual
 * ones too). Active (changed or resumed): the future unpaid plans that nobody changed by hand are rewritten to the new
 * schedule and content: the same occurrence is updated in place, an occurrence the new schedule no longer has is deleted
 * without a mark, a new one is created, and no occurrence is planned in a period that a mark or an operation the change
 * keeps (paid, manual, past) already takes (spec correction 8). At most REWRITE_CAP operations of the series are read.
 */
export async function updateSeries(deps: LedgerDeps, orgId: string, uid: string, seriesId: string, patch: SeriesPatch): Promise<UpdatedSeries> {
  const { db } = deps
  const ref = recurringCol(db, orgId).doc(seriesId)
  const today = deps.today()
  return db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const snap = await t.get(ref)
    const prior = snap.exists ? parseSeries(snap.id, snap.data()) : null
    if (prior === null) throw new RecurringError('not_found')
    const changed = applySeriesPatch(prior, patch)
    assertSeriesHorizon(changed, today)
    const strict: Strict = {
      category: changed.categoryId !== prior.categoryId,
      counterparty: changed.counterpartyId !== prior.counterpartyId,
      tags: changed.tags.filter((id) => !prior.tags.includes(id)),
    }
    const ctx = await readContext(t, db, orgId, changed, strict)
    const next: Series = { ...changed, currency: ctx.account.currency }
    const periodFrom = periodStart(next, today)
    const opsSnap = await t.get(seriesOpsQuery(db, orgId, seriesId, addDays(periodFrom, -MAX_SHIFT_DAYS)).limit(REWRITE_CAP + 1))
    if (opsSnap.size > REWRITE_CAP) throw new RecurringError('limit_reached', 'planned')
    const ops = opsSnap.docs.flatMap((d) => {
      const tx = parseTransaction(d.id, d.data())
      return tx === null ? [] : [{ tx, old: d.data() }]
    })
    const future = ops.filter((o) => o.tx.status === 'planned' && o.tx.paymentDate >= today)
    const w: PlanWrites = { creates: [], updates: [], deletes: [] }
    let series: Series

    if (next.status === 'paused') {
      if (patch.removeFuture) w.deletes = future.map((o) => o.tx)
      series = withState(next, { generatedThrough: prior.generatedThrough })
    } else {
      const marksSnap = await t.get(seriesMarksQuery(db, orgId, seriesId, periodFrom).limit(MARKS_SCAN))
      const rewritable = future.filter((o) => o.tx.manual !== true)
      const rewritableIds = new Set(rewritable.map((o) => o.tx.id))
      const taken = new Set<string>()
      for (const d of marksSnap.docs) {
        const mark = parseDone(d.id, d.data())
        if (mark !== null) taken.add(periodOf(next, mark.occurrence))
      }
      for (const o of ops) {
        if (!rewritableIds.has(o.tx.id) && o.tx.occurrence !== undefined && o.tx.occurrence >= periodFrom) taken.add(periodOf(next, o.tx.occurrence))
      }
      const desired = rewriteOccurrences(next, today, taken)
      const desiredIds = desired.map((o) => planId(seriesId, o))
      // An operation with a wanted id outside the read above (moved by hand far back) must not be created twice.
      const others = await readAll(t, desiredIds.filter((id) => !rewritableIds.has(id)).map((id) => transactionsCol(db, orgId).doc(id)))
      const existing = new Set(others.filter((s) => s.exists).map((s) => s.id))
      for (const o of rewritable) {
        const i = desiredIds.indexOf(o.tx.id)
        if (i < 0) {
          w.deletes.push(o.tx)
          continue
        }
        const want = buildPlan(next, desired[i], ctx, today)
        if (!sameDoc(o.tx, want)) w.updates.push({ prior: o.tx, next: want, old: o.old })
      }
      desired.forEach((occurrence, i) => {
        const id = desiredIds[i]
        if (!rewritableIds.has(id) && !existing.has(id)) w.creates.push(buildPlan(next, occurrence, ctx, today))
      })
      series = withState(next, rewriteState(next, today))
    }

    const ts = Timestamp.fromDate(deps.now())
    t.set(ref, storedSeries(series, orgId, uid, ts, snap.data()))
    t.create(auditCol(db, orgId).doc(), auditData(deps, 'recurring.update', uid, seriesId, seriesToDoc(prior), seriesToDoc(series)))
    writePlans(t, deps, orgId, uid, w, ctx.baseCurrency, ts)
    return { series, created: w.creates.length, updated: w.updates.length, deleted: w.deletes.length }
  })
}

/**
 * Deletes a series (S11) in ONE transaction; with `delete` its future unpaid plans too (manual ones included). Paid and past
 * operations stay and keep `seriesId` as a trace; the marks stay. An unreadable series document can still be deleted.
 */
export async function deleteSeries(deps: LedgerDeps, orgId: string, uid: string, seriesId: string, mode: FutureMode): Promise<{ deleted: number }> {
  const { db } = deps
  const ref = recurringCol(db, orgId).doc(seriesId)
  const today = deps.today()
  return db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const orgSnap = await t.get(orgRef(db, orgId))
    const snap = await t.get(ref)
    const opsSnap = mode === 'delete' ? await t.get(seriesOpsQuery(db, orgId, seriesId, today).limit(REWRITE_CAP + 1)) : null
    if (!orgSnap.exists || !snap.exists) throw new RecurringError('not_found')
    if (opsSnap !== null && opsSnap.size > REWRITE_CAP) throw new RecurringError('limit_reached', 'planned')
    const deletes = (opsSnap?.docs ?? []).flatMap((d) => {
      const tx = parseTransaction(d.id, d.data())
      return tx !== null && tx.status === 'planned' ? [tx] : []
    })
    const prior = parseSeries(snap.id, snap.data())
    const ts = Timestamp.fromDate(deps.now())
    t.delete(ref)
    t.create(auditCol(db, orgId).doc(), auditData(deps, 'recurring.delete', uid, seriesId, prior === null ? (snap.data() ?? null) : seriesToDoc(prior), null))
    writePlans(t, deps, orgId, uid, { creates: [], updates: [], deletes }, orgSnap.get('currency') as string, ts)
    return { deleted: deletes.length }
  })
}
```

`lib/server/ledger/accounts.ts`:

1. Рядок `import { accountsCol, auditCol, orgRef, transactionsCol } from './paths'` замінити на:

```ts
import { accountsCol, auditCol, orgRef, recurringCol, transactionsCol } from './paths'
```

2. Після функції `hasOperations` додати:

```ts
/** A series of planned payments uses the account (S11): its daily fill would be left without it. */
async function usedBySeries(t: Transaction, deps: LedgerDeps, orgId: string, accountId: string): Promise<boolean> {
  return !(await t.get(recurringCol(deps.db, orgId).where('accountId', '==', accountId).select().limit(1))).empty
}
```

3. В `updateAccount` після блоку

```ts
    if (patch.currency !== undefined && patch.currency !== before.currency && (await hasOperations(t, deps, orgId, accountId))) {
      throw new LedgerError('account_has_operations', 'currency')
    }
```

додати:

```ts
    if (patch.currency !== undefined && patch.currency !== before.currency && (await usedBySeries(t, deps, orgId, accountId))) {
      throw new LedgerError('account_has_operations', 'recurring')
    }
```

4. У `deleteAccount` після рядка `    if (await hasOperations(t, deps, orgId, accountId)) throw new LedgerError('account_has_operations')` додати:

```ts
    if (await usedBySeries(t, deps, orgId, accountId)) throw new LedgerError('account_has_operations', 'recurring')
```

`lib/server/ledger/index.ts`:

1. Після рядка `import type { TagChange } from '@/lib/domain/tags/assign'` додати:

```ts
import type { SeriesInput, SeriesPatch } from '@/lib/domain/recurring/input'
import type { FutureMode } from '@/lib/domain/recurring/types'
```

2. Після рядка `import { rebuildLedger } from './rebuild'` додати:

```ts
import { createSeries, deleteSeries, updateSeries } from './series'
```

3. В об'єкті `ledger` після рядка `  splitTransfer: (orgId: string, uid: string, txId: string) => splitTransfer(ledgerDeps(), orgId, uid, txId),` додати:

```ts
  createSeries: (orgId: string, uid: string, input: SeriesInput) => createSeries(ledgerDeps(), orgId, uid, input),
  updateSeries: (orgId: string, uid: string, seriesId: string, patch: SeriesPatch) => updateSeries(ledgerDeps(), orgId, uid, seriesId, patch),
  deleteSeries: (orgId: string, uid: string, seriesId: string, mode: FutureMode) => deleteSeries(ledgerDeps(), orgId, uid, seriesId, mode),
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /f/AI/finflow && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts tests/integration/ledger-series.test.ts tests/integration/ledger-plan-marks.test.ts tests/integration/ledger-accounts.test.ts tests/integration/counterparties-seed.test.ts" && npx vitest run --config vitest.config.ts tests/unit/domain/recurring && npm run typecheck && npm run lint && npm run check:server-imports
```

Expected: усі PASS (20 нових інтеграційних сценаріїв; рахунки й засів контрагентів без змін), `tsc` чисто, `lint` 0 errors / 10 warnings, `check:server-imports` OK.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add lib/server/ledger/series.ts lib/server/ledger/accounts.ts lib/server/ledger/index.ts tests/integration/ledger-series.test.ts tests/unit/domain/recurring/out-of-reports.test.ts && git commit -m "feat(ledger): series of planned payments with their plans in one transaction

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Ledger: план → факт (підтвердження, скасування) і «Пропустити цей раз»

**Files:**
- Create: `lib/server/ledger/plan-match.ts`
- Modify: `lib/server/ledger/transfer.ts` (експорт `operationOf`), `lib/server/ledger/index.ts`
- Test: `tests/integration/ledger-plan-match.test.ts` (створити)

- [ ] **Step 1: Write the failing integration test**

Створити `tests/integration/ledger-plan-match.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Timestamp } from 'firebase-admin/firestore'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { parseSeriesInput } from '@/lib/domain/recurring/input'
import { confirmMatch, skipOccurrence, undoMatch } from '@/lib/server/ledger/plan-match'
import { createSeries, fillSeries } from '@/lib/server/ledger/series'
import { verifyLedger } from '@/lib/server/ledger/verify'
import { createTransaction, updateTransaction } from '@/lib/server/ledger/write'
import { ORG, UID, auditActions, balanceOf, clearFirestore, makeDeps, readDoc, rollup, seedAccount, seedCategory, seedOrg, seedTag, testDb } from './helpers'
import { markDoc, txDoc } from './recurring-helpers'
import { KEY, importBankOp } from './transfer-helpers'

const db = testDb()
const deps = makeDeps(db)
// TODAY is 2026-10-27: the rent of the 27th is planned for today, the bank booked it the day before.
const RENT = parseSeriesInput({
  name: 'Czynsz', kind: 'expense', accountId: 'mil', amountMinor: 250_000, frequency: 'monthly', dayOfMonth: 27, startDate: '2026-10-01',
  categoryId: 'rent', tags: ['office'], description: 'Lokal 3',
})
const BANK = `bk_${KEY(1)}`
let seriesId = ''
let plan = ''

const versionOf = async (id: string) => (await db.doc(`organizations/${ORG}/transactions/${id}`).get()).updateTime as Timestamp
/** A stored document without the fields every write stamps anew. */
function stable(doc: Record<string, unknown> | undefined): Record<string, unknown> {
  const { updatedAt: _at, updatedBy: _by, ...rest } = doc ?? {}
  void _at
  void _by
  return rest
}

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
  await seedAccount(db, ORG, 'mil', 'PLN', 500_000)
  await seedCategory(db, ORG, 'rent', 'expense')
  await seedCategory(db, ORG, 'office-rent', 'expense')
  await seedTag(db, ORG, 'office')
  seriesId = (await createSeries(deps, ORG, UID, RENT)).series.id
  plan = `pl_${seriesId}_2026-10-27`
  await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 250_000, paymentDate: '2026-10-26' })
})

describe('confirming a match (S11)', () => {
  it('the bank operation stays and takes what it lacked; the plan goes; the occurrence is paid by it; no balance moves', async () => {
    const before = await balanceOf(db, ORG, 'mil')
    const done = await confirmMatch(deps, ORG, UID, { planId: plan, bankId: BANK, versions: [await versionOf(plan), await versionOf(BANK)] })
    expect(done.bank).toMatchObject({ id: BANK, amountMinor: 250_000, paymentDate: '2026-10-26', categoryId: 'rent', tags: ['office'], description: 'Lokal 3', seriesId, occurrence: '2026-10-27' })
    expect(await txDoc(db, plan)).toBeUndefined()
    expect(await markDoc(db, plan)).toMatchObject({ reason: 'paid', txId: BANK, carried: { categoryId: 'rent', tags: ['office'], description: 'Lokal 3' }, by: UID })
    expect(await readDoc(db, `organizations/${ORG}/bankSeen/${KEY(1)}`)).toBeDefined()
    expect(await balanceOf(db, ORG, 'mil')).toBe(before)
    expect(await rollup(db, ORG, 'cashcat_2026-10')).toEqual({ 'categories.rent.expenseBase': 250_000 })
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
    expect((await auditActions(db, ORG)).filter((a) => a !== 'tx.create' && a !== 'recurring.create')).toEqual(['tx.delete', 'tx.update'])
    const viaPlan = await db.collection(`organizations/${ORG}/audit`).where('action', 'in', ['tx.update', 'tx.delete']).get()
    expect(viaPlan.docs.every((d) => d.get('via') === 'plan')).toBe(true)
  })

  it('keeps what the bank operation had already and the rules trace', async () => {
    await updateTransaction(deps, ORG, UID, BANK, { description: 'Czynsz X' }, { autoRules: [{ id: 'r1', name: 'Landlord' }] })
    const done = await confirmMatch(deps, ORG, UID, { planId: plan, bankId: BANK })
    expect(done.bank).toMatchObject({ description: 'Czynsz X', categoryId: 'rent', autoRules: [{ id: 'r1', name: 'Landlord' }] })
    expect(await markDoc(db, plan)).toMatchObject({ carried: { categoryId: 'rent', tags: ['office'] } })
  })

  it('refuses a side changed since it was suggested, a second confirmation, and a pair that does not match', async () => {
    const versions: [Timestamp, Timestamp] = [await versionOf(plan), await versionOf(BANK)]
    await updateTransaction(deps, ORG, UID, BANK, { description: 'zmiana' })
    expect(await code(confirmMatch(deps, ORG, UID, { planId: plan, bankId: BANK, versions }))).toBe('conflict:undefined')
    await confirmMatch(deps, ORG, UID, { planId: plan, bankId: BANK })
    expect(await code(confirmMatch(deps, ORG, UID, { planId: plan, bankId: BANK }))).toBe('not_found:undefined')
    expect(await code(confirmMatch(deps, ORG, UID, { planId: `pl_${seriesId}_2026-11-27`, bankId: BANK }))).toBe('not_eligible:undefined')
  })
})

describe('undoing a match', () => {
  it('puts the plan back exactly and takes off what it carried', async () => {
    const planBefore = await txDoc(db, plan)
    const bankBefore = await txDoc(db, BANK)
    await confirmMatch(deps, ORG, UID, { planId: plan, bankId: BANK })
    await undoMatch(deps, ORG, UID, plan)
    expect(stable(await txDoc(db, plan))).toEqual(stable(planBefore))
    expect(stable(await txDoc(db, BANK))).toEqual(stable(bankBefore))
    expect(await markDoc(db, plan)).toBeUndefined()
    expect((await verifyLedger(deps, ORG)).ok).toBe(true)
  })

  it('leaves a field the person changed after the match', async () => {
    await confirmMatch(deps, ORG, UID, { planId: plan, bankId: BANK })
    await updateTransaction(deps, ORG, UID, BANK, { categoryId: 'office-rent' })
    await undoMatch(deps, ORG, UID, plan)
    const bank = await txDoc(db, BANK)
    expect(bank).toMatchObject({ categoryId: 'office-rent' })
    expect(bank?.seriesId).toBeUndefined()
  })

  it('refuses when there is nothing to undo', async () => {
    expect(await code(undoMatch(deps, ORG, UID, plan))).toBe('not_found:undefined')
    await confirmMatch(deps, ORG, UID, { planId: plan, bankId: BANK })
    await undoMatch(deps, ORG, UID, plan)
    expect(await code(undoMatch(deps, ORG, UID, plan))).toBe('not_found:undefined')
  })
})

describe('«Пропустити цей раз»', () => {
  it('deletes the plan with a skipped mark; its undo through the create route restores it', async () => {
    const next = `pl_${seriesId}_2026-11-27`
    const before = await skipOccurrence(deps, ORG, UID, seriesId, '2026-11-27')
    expect(before).toMatchObject({ id: next, status: 'planned' })
    expect(await txDoc(db, next)).toBeUndefined()
    expect(await markDoc(db, next)).toMatchObject({ reason: 'skipped' })
    expect(await fillSeries(makeDeps(db, { today: () => '2026-11-27' }), ORG, seriesId)).toMatchObject({ due: true })
    expect(await txDoc(db, next)).toBeUndefined()
    const input = parseTransactionInput(
      { clientId: next, type: 'expense', status: 'planned', accountId: 'mil', amountMinor: 250_000, paymentDate: before.paymentDate, categoryId: 'rent', tags: ['office'], description: 'Lokal 3' },
      { internal: true },
    )
    await createTransaction(deps, ORG, UID, input)
    expect(await txDoc(db, next)).toMatchObject({ seriesId, occurrence: '2026-11-27', status: 'planned' })
    expect(await markDoc(db, next)).toBeUndefined()
  })

  it('refuses an occurrence that is no plan of the series', async () => {
    expect(await code(skipOccurrence(deps, ORG, UID, seriesId, '2026-11-28'))).toBe('not_found:undefined')
    await confirmMatch(deps, ORG, UID, { planId: plan, bankId: BANK })
    expect(await code(skipOccurrence(deps, ORG, UID, seriesId, '2026-10-27'))).toBe('not_found:undefined')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /f/AI/finflow && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts tests/integration/ledger-plan-match.test.ts"`
Expected: FAIL (`@/lib/server/ledger/plan-match` не існує).

- [ ] **Step 3: Implement**

`lib/server/ledger/transfer.ts`: рядок `function operationOf(snap: DocumentSnapshot): LedgerTransaction {` замінити на:

```ts
export function operationOf(snap: DocumentSnapshot): LedgerTransaction {
```

Створити `lib/server/ledger/plan-match.ts`:

```ts
import { Timestamp, type DocumentSnapshot, type Firestore, type Transaction } from 'firebase-admin/firestore'
import { changeSet, combineChanges } from '@/lib/domain/ledger/change'
import { parseTransaction, transactionToDoc } from '@/lib/domain/ledger/doc'
import { LedgerError } from '@/lib/domain/ledger/errors'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { doneToDoc, parseDone } from '@/lib/domain/recurring/doc'
import { canMatch, carriedOf, parseBankSide, parsePlanSide, withCarried, withoutCarried } from '@/lib/domain/recurring/match'
import { planId } from '@/lib/domain/recurring/plan'
import type { Carried } from '@/lib/domain/recurring/types'
import { excludedFromTags, tagFlagsOf, withExcluded } from '@/lib/domain/tags/exclude'
import { auditData } from './audit'
import type { LedgerDeps } from './deps'
import { assertUnlocked } from './lock'
import { auditCol, categoriesCol, counterpartiesCol, orgRef, recurringDoneCol, tagsCol, transactionsCol } from './paths'
import { operationOf } from './transfer'
import { applyChange, storedDoc } from './write'

/** One «план → факт»: the plan, the bank operation and, from a suggestion, the versions the person saw (in that order). */
export interface MatchJob {
  planId: string
  bankId: string
  versions?: readonly [Timestamp, Timestamp]
}

export interface MatchDone {
  /** The bank operation after the write. */
  bank: LedgerTransaction
  /** The plan: the one that went (a confirmation) or came back (an undo). */
  plan: LedgerTransaction
}

async function tagSnapsOf(t: Transaction, db: Firestore, orgId: string, ids: readonly string[]): Promise<DocumentSnapshot[]> {
  const snaps: DocumentSnapshot[] = []
  for (const id of ids) snaps.push(await t.get(tagsCol(db, orgId).doc(id)))
  return snaps
}

/**
 * Confirms that a bank operation paid a plan (S11) in ONE transaction: the bank operation stays (its id, amount, day, bank
 * block and `bankSeen` mark untouched), takes from the plan each of category, counterparty, comment and tags it lacks
 * (a carried reference that is gone or archived is not carried), keeps its rules trace and gets the series link; the plan
 * is deleted; the occurrence gets a `paid` mark that keeps the plan's document and what was carried (for the undo).
 * No balance moves (the same account, amount and day); the category moves the bank operation's rollups. Audit: `tx.update`
 * of the bank operation and `tx.delete` of the plan, both `via: 'plan'`.
 */
export async function confirmMatch(deps: LedgerDeps, orgId: string, uid: string, job: MatchJob): Promise<MatchDone> {
  const { db } = deps
  const planRef = transactionsCol(db, orgId).doc(job.planId)
  const bankRef = transactionsCol(db, orgId).doc(job.bankId)
  const markRef = recurringDoneCol(db, orgId).doc(job.planId)
  return db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const orgSnap = await t.get(orgRef(db, orgId))
    const planSnap = await t.get(planRef)
    const bankSnap = await t.get(bankRef)
    const markSnap = await t.get(markRef)
    if (!orgSnap.exists) throw new LedgerError('not_found', 'org')
    const versions = job.versions
    if (versions) {
      const seen = [planSnap, bankSnap]
      seen.forEach((snap, i) => {
        if (snap.exists && (!snap.updateTime || !snap.updateTime.isEqual(versions[i]))) throw new LedgerError('conflict')
      })
    }
    const plan = operationOf(planSnap)
    const bank = operationOf(bankSnap)
    const planSide = parsePlanSide(planSnap.id, planSnap.data(), '')
    const bankSide = parseBankSide(bankSnap.id, bankSnap.data(), '')
    if (planSide === null || bankSide === null || markSnap.exists || !canMatch(planSide, bankSide)) throw new LedgerError('not_eligible')

    const wanted = carriedOf(plan, bank)
    const categorySnap = wanted.categoryId === undefined ? null : await t.get(categoriesCol(db, orgId).doc(wanted.categoryId))
    const counterpartySnap = wanted.counterpartyId === undefined ? null : await t.get(counterpartiesCol(db, orgId).doc(wanted.counterpartyId))
    const tagSnaps = await tagSnapsOf(t, db, orgId, wanted.tags ?? bank.tags)
    const carried: Carried = {}
    if (categorySnap?.exists && categorySnap.get('type') === bank.type) carried.categoryId = wanted.categoryId
    if (counterpartySnap?.exists && counterpartySnap.get('archived') !== true) carried.counterpartyId = wanted.counterpartyId
    if (wanted.description !== undefined) carried.description = wanted.description
    if (wanted.tags !== undefined) {
      const usable = wanted.tags.filter((_, i) => tagSnaps[i].exists && tagSnaps[i].get('archived') !== true)
      if (usable.length > 0) carried.tags = usable
    }
    const linked: LedgerTransaction = { ...withCarried(bank, carried), seriesId: plan.seriesId, occurrence: plan.occurrence }
    const next = withExcluded(linked, excludedFromTags(linked.tags, tagFlagsOf(tagSnaps)))

    const baseCurrency = orgSnap.get('currency') as string
    const ts = Timestamp.fromDate(deps.now())
    applyChange(t, db, orgId, combineChanges(changeSet(bank, next, baseCurrency), changeSet(plan, null, baseCurrency)), ts)
    t.set(bankRef, storedDoc(next, orgId, uid, ts, bankSnap.data() ?? {}))
    t.delete(planRef)
    t.create(markRef, {
      ...doneToDoc({
        seriesId: plan.seriesId as string,
        occurrence: plan.occurrence as string,
        reason: 'paid',
        txId: bank.id,
        estimated: plan.estimated === true,
        manual: plan.manual === true,
        plan: transactionToDoc(plan),
        carried,
      }),
      planCreatedAt: planSnap.get('createdAt') ?? null,
      planCreatedBy: planSnap.get('createdBy') ?? null,
      at: ts,
      by: uid,
    })
    t.create(auditCol(db, orgId).doc(), auditData(deps, 'tx.update', uid, bank.id, transactionToDoc(bank), transactionToDoc(next), { via: 'plan' }))
    t.create(auditCol(db, orgId).doc(), auditData(deps, 'tx.delete', uid, plan.id, transactionToDoc(plan), null, { via: 'plan' }))
    return { bank: next, plan }
  })
}

/**
 * Undoes a confirmed match (S11) in ONE transaction: the plan comes back from its mark exactly (its document, creation stamp
 * and order in the journal), the bank operation loses the series link and each carried field it still has unchanged (a
 * person's later change stays), the mark goes. `not_found` without a mark; `not_eligible` for a mark that is no match
 * (`paid` by the plan itself, `skipped`, `deleted`: those come back through the create route); `conflict` when the plan
 * already exists. Audit: `tx.update` of the bank operation and `tx.create` of the plan, both `via: 'plan'`.
 */
export async function undoMatch(deps: LedgerDeps, orgId: string, uid: string, id: string): Promise<MatchDone> {
  const { db } = deps
  const planRef = transactionsCol(db, orgId).doc(id)
  const markRef = recurringDoneCol(db, orgId).doc(id)
  return db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const orgSnap = await t.get(orgRef(db, orgId))
    const markSnap = await t.get(markRef)
    const planSnap = await t.get(planRef)
    if (!orgSnap.exists) throw new LedgerError('not_found', 'org')
    const mark = markSnap.exists ? parseDone(markSnap.id, markSnap.data()) : null
    if (mark === null) throw new LedgerError('not_found')
    if (mark.reason !== 'paid' || mark.txId === undefined || mark.txId === id || mark.plan === undefined) throw new LedgerError('not_eligible')
    const bankRef = transactionsCol(db, orgId).doc(mark.txId)
    const bankSnap = await t.get(bankRef)
    const bank = operationOf(bankSnap)
    const plan = parseTransaction(id, mark.plan)
    if (planSnap.exists) throw new LedgerError('conflict')
    if (plan === null || bank.seriesId !== mark.seriesId || bank.occurrence !== mark.occurrence) throw new LedgerError('not_eligible')

    const unlinked = withoutCarried(bank, mark.carried ?? {})
    const tagIds = [...new Set([...unlinked.tags, ...plan.tags])]
    const flags = tagFlagsOf(await tagSnapsOf(t, db, orgId, tagIds))
    const nextBank = withExcluded(unlinked, excludedFromTags(unlinked.tags, flags))
    const restored = withExcluded(plan, excludedFromTags(plan.tags, flags))

    const baseCurrency = orgSnap.get('currency') as string
    const ts = Timestamp.fromDate(deps.now())
    applyChange(t, db, orgId, combineChanges(changeSet(bank, nextBank, baseCurrency), changeSet(null, restored, baseCurrency)), ts)
    t.set(bankRef, storedDoc(nextBank, orgId, uid, ts, bankSnap.data() ?? {}))
    t.create(planRef, storedDoc(restored, orgId, uid, ts, { createdAt: markSnap.get('planCreatedAt') ?? undefined, createdBy: markSnap.get('planCreatedBy') ?? undefined }))
    t.delete(markRef)
    t.create(auditCol(db, orgId).doc(), auditData(deps, 'tx.update', uid, bank.id, transactionToDoc(bank), transactionToDoc(nextBank), { via: 'plan' }))
    t.create(auditCol(db, orgId).doc(), auditData(deps, 'tx.create', uid, id, null, transactionToDoc(restored), { via: 'plan' }))
    return { bank: nextBank, plan: restored }
  })
}

/**
 * «Пропустити цей раз» (S11) in ONE transaction: the plan of the occurrence is deleted and the occurrence gets a `skipped`
 * mark with the plan's flags, so neither the daily fill nor a change of the series brings it back; the undo is the create
 * route under the plan id (`planRestoreOf` in write.ts). Returns the plan as it was. `not_found` when the occurrence has no
 * plan of this series, `conflict` when it is marked already. Audit: `tx.delete`, `via: 'plan'`.
 */
export async function skipOccurrence(deps: LedgerDeps, orgId: string, uid: string, seriesId: string, occurrence: string): Promise<LedgerTransaction> {
  const { db } = deps
  const id = planId(seriesId, occurrence)
  const opRef = transactionsCol(db, orgId).doc(id)
  const markRef = recurringDoneCol(db, orgId).doc(id)
  return db.runTransaction(async (t) => {
    await assertUnlocked(t, deps, orgId)
    const orgSnap = await t.get(orgRef(db, orgId))
    const opSnap = await t.get(opRef)
    const markSnap = await t.get(markRef)
    if (!orgSnap.exists) throw new LedgerError('not_found', 'org')
    const op = operationOf(opSnap)
    if (op.status !== 'planned' || op.seriesId !== seriesId || op.occurrence !== occurrence) throw new LedgerError('not_eligible')
    if (markSnap.exists) throw new LedgerError('conflict')
    const ts = Timestamp.fromDate(deps.now())
    applyChange(t, db, orgId, changeSet(op, null, orgSnap.get('currency') as string), ts)
    t.delete(opRef)
    t.set(markRef, { ...doneToDoc({ seriesId, occurrence, reason: 'skipped', estimated: op.estimated === true, manual: op.manual === true }), at: ts, by: uid })
    t.create(auditCol(db, orgId).doc(), auditData(deps, 'tx.delete', uid, id, transactionToDoc(op), null, { via: 'plan' }))
    return op
  })
}
```

`lib/server/ledger/index.ts`:

1. Після рядка `import { createSeries, deleteSeries, updateSeries } from './series'` додати:

```ts
import { confirmMatch, skipOccurrence, undoMatch, type MatchJob } from './plan-match'
```

2. В об'єкті `ledger` після рядка `  deleteSeries: ...` (доданого в Task 6) додати:

```ts
  confirmMatch: (orgId: string, uid: string, job: MatchJob) => confirmMatch(ledgerDeps(), orgId, uid, job),
  undoMatch: (orgId: string, uid: string, planId: string) => undoMatch(ledgerDeps(), orgId, uid, planId),
  skipOccurrence: (orgId: string, uid: string, seriesId: string, occurrence: string) => skipOccurrence(ledgerDeps(), orgId, uid, seriesId, occurrence),
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /f/AI/finflow && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts tests/integration/ledger-plan-match.test.ts tests/integration/ledger-series.test.ts tests/integration/ledger-plan-marks.test.ts tests/integration/ledger-transfers.test.ts" && npm run typecheck && npm run lint
```

Expected: усі PASS (9 нових сценаріїв; перекази S10b без змін), `tsc` чисто, `lint` 0 errors / 10 warnings.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add lib/server/ledger/plan-match.ts lib/server/ledger/transfer.ts lib/server/ledger/index.ts tests/integration/ledger-plan-match.test.ts && git commit -m "feat(ledger): plan to fact match with an exact undo, and skipping an occurrence

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Сервер планових платежів: огляд, пропозиції, запуск пар, щоденний генератор, помилки, сервіс

**Files:**
- Create: `lib/server/ledger/version.ts`, `lib/server/recurring/read.ts`, `lib/server/recurring/run.ts`, `lib/server/recurring/cron.ts`, `lib/server/recurring/http.ts`, `lib/server/recurring/index.ts`
- Modify: `lib/server/transfers/run.ts`
- Test: `tests/unit/server/recurring/run.test.ts`, `tests/unit/server/recurring/http.test.ts`, `tests/integration/recurring-read.test.ts` (створити)

- [ ] **Step 1: Write the failing tests**

Створити `tests/unit/server/recurring/run.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { LedgerError } from '@/lib/domain/ledger/errors'
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { runMatches, type MatchLedger } from '@/lib/server/recurring/run'

const BANK = `bk_${'a'.repeat(32)}`
const tx = (id: string) => ({ id }) as LedgerTransaction

function fakeLedger() {
  return {
    confirmMatch: vi.fn(async (_o: string, _u: string, job: { planId: string; bankId: string }) => {
      if (job.planId.endsWith('15')) throw new LedgerError('conflict')
      if (job.planId.endsWith('16')) throw new Error('boom')
      return { bank: tx(job.bankId), plan: tx(job.planId) }
    }),
    undoMatch: vi.fn(async (_o: string, _u: string, planId: string) => ({ bank: tx(BANK), plan: tx(planId) })),
  } satisfies MatchLedger
}

describe('runMatches', () => {
  it('runs each pair on its own with the versions as timestamps; a refusal or an error is the result of that pair', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const ledger = fakeLedger()
    const V = '1790000000.000000001'
    const out = await runMatches(ledger, 'org1', 'u1', {
      kind: 'confirm',
      items: [
        { planId: 'pl_a_2026-11-14', bankId: BANK, versions: [V, V] },
        { planId: 'pl_a_2026-11-15', bankId: `bk_${'b'.repeat(32)}`, versions: [V, V] },
        { planId: 'pl_a_2026-11-16', bankId: `bk_${'c'.repeat(32)}`, versions: [V, V] },
      ],
    })
    expect(out).toEqual([
      { planId: 'pl_a_2026-11-14', ok: true, bankId: BANK },
      { planId: 'pl_a_2026-11-15', ok: false, code: 'conflict' },
      { planId: 'pl_a_2026-11-16', ok: false, code: 'unknown' },
    ])
    expect(ledger.confirmMatch.mock.calls[0][2]).toEqual({ planId: 'pl_a_2026-11-14', bankId: BANK, versions: [new Timestamp(1790000000, 1), new Timestamp(1790000000, 1)] })
  })

  it('undoes by plan id', async () => {
    const ledger = fakeLedger()
    expect(await runMatches(ledger, 'org1', 'u1', { kind: 'undo', planIds: ['pl_a_2026-11-14'] })).toEqual([{ planId: 'pl_a_2026-11-14', ok: true, bankId: BANK }])
    expect(ledger.undoMatch).toHaveBeenCalledWith('org1', 'u1', 'pl_a_2026-11-14')
  })
})
```

Створити `tests/unit/server/recurring/http.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { RecurringError } from '@/lib/domain/recurring/errors'
import { HttpError } from '@/lib/server/http-error'
import { toRecurringHttpError } from '@/lib/server/recurring/http'

describe('toRecurringHttpError', () => {
  it.each([
    [new RecurringError('invalid_input', 'name'), 400, 'invalid_input', { field: 'name' }],
    [new RecurringError('not_found'), 404, 'not_found', undefined],
    [new RecurringError('limit_reached', 'planned'), 409, 'limit_reached', { field: 'planned' }],
  ])('maps %s', (e, status, code, extra) => {
    const mapped = toRecurringHttpError(e)
    expect(mapped).toBeInstanceOf(HttpError)
    expect(mapped).toMatchObject({ status, message: code, extra })
  })

  it('passes ledger refusals to the ledger mapping and anything else through', () => {
    expect(toRecurringHttpError(new LedgerError('category_not_found', 'categoryId'))).toMatchObject({ status: 422, message: 'category_not_found' })
    const other = new Error('boom')
    expect(toRecurringHttpError(other)).toBe(other)
  })
})
```

Створити `tests/integration/recurring-read.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseTransactionInput } from '@/lib/domain/ledger/input'
import { parseSeriesInput } from '@/lib/domain/recurring/input'
import { createSeries } from '@/lib/server/ledger/series'
import { createTransaction } from '@/lib/server/ledger/write'
import { runRecurringCron } from '@/lib/server/recurring/cron'
import { readMatchSuggestions, readOverview } from '@/lib/server/recurring/read'
import { ORG, UID, clearFirestore, makeDeps, readDoc, seedAccount, seedCategory, seedOrg, testDb } from './helpers'
import { KEY, importBankOp } from './transfer-helpers'

const db = testDb()
const deps = makeDeps(db)
const on = (today: string) => makeDeps(db, { today: () => today })
// TODAY is 2026-10-27.
const rent = (dayOfMonth: number) =>
  parseSeriesInput({ name: 'Czynsz', kind: 'expense', accountId: 'mil', amountMinor: 250_000, frequency: 'monthly', dayOfMonth, startDate: '2026-10-01', categoryId: 'rent' })

async function planned(paymentDate: string, type: 'income' | 'expense', amountMinor: number) {
  return createTransaction(deps, ORG, UID, parseTransactionInput({ type, status: 'planned', accountId: 'mil', amountMinor, paymentDate }))
}

beforeEach(async () => {
  await clearFirestore()
  await seedOrg(db)
  await seedAccount(db, ORG, 'mil', 'PLN', 500_000)
  await seedCategory(db, ORG, 'rent', 'expense')
})

describe('the overview (S11)', () => {
  it('counts the overdue, sums the next 7 days and gives each series its next date', async () => {
    const { series } = await createSeries(deps, ORG, UID, rent(10))
    const overdue = await planned('2026-10-20', 'expense', 5_000)
    await planned('2026-10-30', 'income', 70_000)
    const o = await readOverview(deps, ORG)
    expect(o.overdueCount).toBe(1)
    expect(o.overdue.map((r) => r.id)).toEqual([overdue.transaction.id])
    expect(o.soon).toEqual({ income: [{ currency: 'PLN', amountMinor: 70_000 }], expense: [] })
    expect(o.upcoming.map((r) => r.paymentDate)).toEqual(['2026-10-30', '2026-11-10'])
    expect(o.series).toMatchObject([{ id: series.id, name: 'Czynsz', next: '2026-11-10' }])
    expect(o.truncated).toBe(false)
  })
})

describe('the match suggestions', () => {
  it('offers the one plan of the days around a bank operation, with the series name', async () => {
    await createSeries(deps, ORG, UID, rent(27))
    await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 250_000, paymentDate: '2026-10-26' })
    const r = await readMatchSuggestions(deps, ORG)
    expect(r.pairs).toHaveLength(1)
    expect(r.pairs[0]).toMatchObject({ plan: { occurrence: '2026-10-27', name: 'Czynsz' }, bank: { id: `bk_${KEY(1)}`, paymentDate: '2026-10-26' } })
    expect(r).toMatchObject({ total: 1, ambiguous: 0, truncated: false })
  })

  it('offers nothing for two equal bank operations, and reads no bank operation when no plan is near', async () => {
    await createSeries(deps, ORG, UID, rent(27))
    await importBankOp(db, deps, { key: KEY(1), type: 'expense', accountId: 'mil', amountMinor: 250_000, paymentDate: '2026-10-26' })
    await importBankOp(db, deps, { key: KEY(2), type: 'expense', accountId: 'mil', amountMinor: 250_000, paymentDate: '2026-10-25' })
    expect(await readMatchSuggestions(deps, ORG)).toMatchObject({ pairs: [], ambiguous: 1 })
    await clearFirestore()
    await seedOrg(db)
    await seedAccount(db, ORG, 'mil', 'PLN', 500_000)
    await createSeries(deps, ORG, UID, { ...rent(10), categoryId: undefined })
    expect(await readMatchSuggestions(deps, ORG)).toMatchObject({ pairs: [], plansRead: 0, banksRead: 0 })
  })
})

describe('the daily run', () => {
  it('fills the due series of every company; a broken one is reported and waits a day; the others go on', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await seedOrg(db, 'org2')
    await seedAccount(db, 'org2', 'acc2', 'PLN', 0)
    await createSeries(deps, ORG, UID, rent(10))
    await createSeries(deps, 'org2', UID, parseSeriesInput({ name: 'Netflix', kind: 'expense', accountId: 'acc2', amountMinor: 6_000, frequency: 'monthly', dayOfMonth: 5, startDate: '2026-10-01' }))
    await db.doc(`organizations/${ORG}/recurring/broken`).set({ schemaVersion: 1, dueOn: '2026-10-01' })
    const summary = await runRecurringCron(on('2026-11-27'), { budgetMs: 10_000 })
    expect(summary).toEqual({ considered: 3, filled: 2, created: 2, skipped: 0, failed: 1 })
    expect(await readDoc(db, `organizations/${ORG}/recurring/broken`)).toMatchObject({ dueOn: '2026-11-28' })
    expect(await runRecurringCron(on('2026-11-27'), { budgetMs: 10_000 })).toEqual({ considered: 0, filled: 0, created: 0, skipped: 0, failed: 0 })
  })

  it('does nothing without time left; the next call catches up', async () => {
    await createSeries(deps, ORG, UID, rent(10))
    expect(await runRecurringCron(on('2026-11-27'), { budgetMs: 0 })).toEqual({ considered: 0, filled: 0, created: 0, skipped: 0, failed: 0 })
    expect(await runRecurringCron(on('2026-11-27'), { budgetMs: 10_000 })).toMatchObject({ filled: 1, created: 1 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/server/recurring; export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts tests/integration/recurring-read.test.ts"
```

Expected: FAIL (модулі `lib/server/recurring/*` не існують).

- [ ] **Step 3: Implement**

Створити `lib/server/ledger/version.ts`:

```ts
import { Timestamp } from 'firebase-admin/firestore'
import { parseVersion } from '@/lib/domain/transfers/version'

/** A version the browser carries (`<seconds>.<9 digits of nanoseconds>`, already checked by the request parser) as a Firestore Timestamp. */
export function timestampOf(version: string): Timestamp {
  const parts = parseVersion(version)
  if (parts === null) throw new Error('an unparsed version reached the ledger')
  return new Timestamp(parts.seconds, parts.nanoseconds)
}
```

`lib/server/transfers/run.ts`: видалити рядки `import { Timestamp } from 'firebase-admin/firestore'` і `import { parseVersion } from '@/lib/domain/transfers/version'`, видалити всю локальну функцію `timestampOf` (від `function timestampOf(version: string): Timestamp {` до її `}`), а після рядка `import type { MadeTransfer, TransferJob } from '@/lib/server/ledger/transfer'` додати:

```ts
import { timestampOf } from '@/lib/server/ledger/version'
```

Створити `lib/server/recurring/read.ts`:

```ts
import type { Firestore, Query, QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { addDays } from '@/lib/domain/ledger/days'
import { parseSeries } from '@/lib/domain/recurring/doc'
import { BANK_FIELDS, findPlanMatches, parseBankSide, parsePlanSide } from '@/lib/domain/recurring/match'
import { buildOverview } from '@/lib/domain/recurring/overview'
import { ROW_FIELDS, parsePlannedRow } from '@/lib/domain/recurring/rows'
import { windowEnd } from '@/lib/domain/recurring/schedule'
import {
  LIST_ROWS,
  MATCH_AFTER_DAYS,
  MATCH_BANK_SCAN,
  MATCH_BEFORE_DAYS,
  MATCH_LOOKBACK_DAYS,
  MATCH_PLAN_SCAN,
  PLANNED_SCAN,
  type BankSide,
  type MatchSuggestions,
  type PlanMatch,
  type PlanSide,
  type PlannedRow,
  type RecurringOverview,
  type Series,
} from '@/lib/domain/recurring/types'
import { encodeVersion } from '@/lib/domain/transfers/version'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { recurringCol, transactionsCol } from '@/lib/server/ledger/paths'

type ReadDeps = Pick<LedgerDeps, 'db' | 'today'>

function nonNull<T>(v: T | null): v is T {
  return v !== null
}

/** Planned operations before today (index `transactions (status ASC, paymentDate ASC)`). */
export function overdueQuery(db: Firestore, orgId: string, today: string): Query {
  return transactionsCol(db, orgId).where('status', '==', 'planned').where('paymentDate', '<', today)
}

/** Planned operations from today to the window end, by payment day (the same index). */
export function upcomingQuery(db: Firestore, orgId: string, today: string): Query {
  return transactionsCol(db, orgId).where('status', '==', 'planned').where('paymentDate', '>=', today).where('paymentDate', '<=', windowEnd(today)).orderBy('paymentDate')
}

/** The plans a bank operation may have paid: from MATCH_LOOKBACK_DAYS back to MATCH_BEFORE_DAYS ahead (the same index). */
export function planCandidatesQuery(db: Firestore, orgId: string, today: string): Query {
  return transactionsCol(db, orgId)
    .where('status', '==', 'planned')
    .where('paymentDate', '>=', addDays(today, -MATCH_LOOKBACK_DAYS))
    .where('paymentDate', '<=', addDays(today, MATCH_BEFORE_DAYS))
    .orderBy('paymentDate')
}

/** The series whose daily fill is due, longest waiting first (index `fieldOverrides recurring.dueOn COLLECTION_GROUP`). */
export function dueSeriesQuery(db: Firestore, today: string): Query {
  return db.collectionGroup('recurring').where('dueOn', '<=', today).orderBy('dueOn')
}

export async function readSeries(deps: Pick<LedgerDeps, 'db'>, orgId: string, seriesId: string): Promise<Series | null> {
  const snap = await recurringCol(deps.db, orgId).doc(seriesId).get()
  return snap.exists ? parseSeries(snap.id, snap.data()) : null
}

function rowsOf(docs: readonly QueryDocumentSnapshot[]): PlannedRow[] {
  return docs.map((d) => parsePlannedRow(d.id, d.data())).filter(nonNull)
}

/**
 * `GET /recurring` (S11), computed on demand: the series (at most 100), the number of overdue planned operations (one
 * `count()`), the oldest LIST_ROWS of them, and the planned operations from today to the window end (at most PLANNED_SCAN,
 * selected fields). Nothing is stored.
 */
export async function readOverview(deps: ReadDeps, orgId: string): Promise<RecurringOverview> {
  const { db } = deps
  const today = deps.today()
  const [seriesSnap, countSnap, overdueSnap, upcomingSnap] = await Promise.all([
    recurringCol(db, orgId).get(),
    overdueQuery(db, orgId, today).count().get(),
    overdueQuery(db, orgId, today).orderBy('paymentDate').select(...ROW_FIELDS).limit(LIST_ROWS).get(),
    upcomingQuery(db, orgId, today).select(...ROW_FIELDS).limit(PLANNED_SCAN).get(),
  ])
  return buildOverview({
    series: seriesSnap.docs.map((d) => parseSeries(d.id, d.data())).filter(nonNull),
    overdue: rowsOf(overdueSnap.docs),
    overdueCount: countSnap.data().count,
    upcoming: rowsOf(upcomingSnap.docs),
    truncated: upcomingSnap.size >= PLANNED_SCAN,
    today,
  })
}

export interface MatchRead extends MatchSuggestions {
  plansRead: number
  banksRead: number
}

/** The names of the series of the pairs (one `getAll`, at most MAX_MATCHES documents). */
async function withNames(db: Firestore, orgId: string, pairs: PlanMatch[]): Promise<PlanMatch[]> {
  const ids = [...new Set(pairs.map((p) => p.plan.seriesId))]
  if (ids.length === 0) return pairs
  const snaps = await db.getAll(...ids.map((id) => recurringCol(db, orgId).doc(id)))
  const names = new Map<string, unknown>(snaps.filter((s) => s.exists).map((s) => [s.id, s.get('name')]))
  return pairs.map((p) => {
    const name = names.get(p.plan.seriesId)
    return typeof name === 'string' ? { ...p, plan: { ...p.plan, name } } : p
  })
}

/**
 * The plan ↔ bank pairs the journal suggests (S11), computed on demand. First the plans that a bank operation could have
 * paid (at most MATCH_PLAN_SCAN); only when there are some, the operations of the days they span (from the first plan's
 * day − MATCH_BEFORE_DAYS to the last plan's day + MATCH_AFTER_DAYS, never after today; at most MATCH_BANK_SCAN, the
 * query shape of the S10b suggestions, no new index), filtered to unlinked bank operations in memory. Each side carries its
 * document version, which a confirmation sends back.
 */
export async function readMatchSuggestions(deps: ReadDeps, orgId: string): Promise<MatchRead> {
  const { db } = deps
  const today = deps.today()
  const planSnap = await planCandidatesQuery(db, orgId, today).select(...ROW_FIELDS).limit(MATCH_PLAN_SCAN).get()
  const plans: PlanSide[] = planSnap.docs.map((d) => parsePlanSide(d.id, d.data(), encodeVersion(d.updateTime))).filter(nonNull)
  const plansCut = planSnap.size >= MATCH_PLAN_SCAN
  if (plans.length === 0) return { pairs: [], total: 0, ambiguous: 0, truncated: plansCut, plansRead: planSnap.size, banksRead: 0 }
  const from = addDays(plans[0].paymentDate, -MATCH_BEFORE_DAYS)
  const last = addDays(plans[plans.length - 1].paymentDate, MATCH_AFTER_DAYS)
  const to = last < today ? last : today
  const bankSnap =
    from > to
      ? null
      : await transactionsCol(db, orgId).where('paymentDate', '>=', from).where('paymentDate', '<=', to).orderBy('paymentDate', 'desc').select(...BANK_FIELDS).limit(MATCH_BANK_SCAN).get()
  const banks: BankSide[] = (bankSnap?.docs ?? []).map((d) => parseBankSide(d.id, d.data(), encodeVersion(d.updateTime))).filter(nonNull)
  const found = findPlanMatches(plans, banks)
  return {
    pairs: await withNames(db, orgId, found.pairs),
    total: found.total,
    ambiguous: found.ambiguous,
    truncated: plansCut || (bankSnap?.size ?? 0) >= MATCH_BANK_SCAN,
    plansRead: planSnap.size,
    banksRead: bankSnap?.size ?? 0,
  }
}
```

Створити `lib/server/recurring/run.ts`:

```ts
import type { MatchOutcome, MatchRequest } from '@/lib/domain/recurring/types'
import { refusalCode } from '@/lib/server/ledger/http'
import type { MatchDone, MatchJob } from '@/lib/server/ledger/plan-match'
import { timestampOf } from '@/lib/server/ledger/version'

/** The ledger calls a match request is made of (the production `ledger` object has them). */
export interface MatchLedger {
  confirmMatch(orgId: string, uid: string, job: MatchJob): Promise<MatchDone>
  undoMatch(orgId: string, uid: string, planId: string): Promise<MatchDone>
}

/**
 * Runs a match request one pair (or one undo) at a time, each its own Firestore transaction (S11). A refusal is that item's
 * result and the rest go on; so is an unexpected error (`unknown`, logged once by ids, never with the body).
 */
export async function runMatches(ledger: MatchLedger, orgId: string, uid: string, req: MatchRequest): Promise<MatchOutcome[]> {
  const items =
    req.kind === 'confirm'
      ? req.items.map((i) => ({
          planId: i.planId,
          run: () => ledger.confirmMatch(orgId, uid, { planId: i.planId, bankId: i.bankId, versions: [timestampOf(i.versions[0]), timestampOf(i.versions[1])] }),
        }))
      : req.planIds.map((planId) => ({ planId, run: () => ledger.undoMatch(orgId, uid, planId) }))
  const out: MatchOutcome[] = []
  for (const { planId, run } of items) {
    try {
      const done = await run()
      out.push({ planId, ok: true, bankId: done.bank.id })
    } catch (e) {
      const code = refusalCode(e)
      if (code === null) console.error('[recurring] unexpected error', { orgId, planId, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) })
      out.push({ planId, ok: false, code: code ?? 'unknown' })
    }
  }
  return out
}
```

Створити `lib/server/recurring/cron.ts`:

```ts
import { addDays } from '@/lib/domain/ledger/days'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { RecurringError } from '@/lib/domain/recurring/errors'
import { CRON_MAX_SERIES, type RecurringCronSummary } from '@/lib/domain/recurring/types'
import type { LedgerDeps } from '@/lib/server/ledger/deps'
import { fillSeries } from '@/lib/server/ledger/series'
import { dueSeriesQuery } from './read'

/** Refusals that pass by themselves (a rebuild holds the ledger, a write raced): try again at the next hourly call. */
const TRANSIENT = new Set(['ledger_busy', 'conflict'])

/**
 * The daily fill of planned payments (S11), a step of the hourly `POST /api/cron/bank-sync`. Reads the due series of every
 * company, longest waiting first (at most `max`), and fills each in its own transaction (`fillSeries`, which checks `dueOn`
 * again inside, so parallel calls never fill twice). The time budget is checked before each series: what is left waits for
 * the next call. A failing series never stops the others: it is logged by ids and counted; a lasting failure (no account,
 * an unreadable series) moves its `dueOn` to tomorrow, a passing one leaves it for the next hour. Counts only, never names.
 * Never throws: a failed read of the due series is one failure.
 */
export async function runRecurringCron(deps: LedgerDeps, opts: { budgetMs: number; max?: number }): Promise<RecurringCronSummary> {
  const started = Date.now()
  const summary: RecurringCronSummary = { considered: 0, filled: 0, created: 0, skipped: 0, failed: 0 }
  if (opts.budgetMs <= 0) return summary
  const today = deps.today()
  let docs
  try {
    docs = (await dueSeriesQuery(deps.db, today).select().limit(opts.max ?? CRON_MAX_SERIES).get()).docs
  } catch (e) {
    console.error('recurring cron: the due series could not be read', { error: e instanceof Error ? e.name : 'unknown' })
    summary.failed++
    return summary
  }
  summary.considered = docs.length
  for (const [i, doc] of docs.entries()) {
    if (Date.now() - started >= opts.budgetMs) {
      summary.skipped += docs.length - i
      break
    }
    const orgId = doc.ref.parent.parent?.id
    if (orgId === undefined) {
      summary.failed++
      continue
    }
    try {
      const r = await fillSeries(deps, orgId, doc.id)
      if (r.due) {
        summary.filled++
        summary.created += r.created
      } else summary.skipped++
    } catch (e) {
      summary.failed++
      const code = e instanceof LedgerError || e instanceof RecurringError ? e.code : 'unknown'
      console.error('recurring cron: a series could not be filled', { orgId, seriesId: doc.id, code })
      if (!TRANSIENT.has(code)) {
        try {
          await doc.ref.update({ dueOn: addDays(today, 1) })
        } catch {
          // The next run tries the series again.
        }
      }
    }
  }
  return summary
}
```

Створити `lib/server/recurring/http.ts`:

```ts
import 'server-only'
import { RecurringError, type RecurringErrorCode } from '@/lib/domain/recurring/errors'
import { HttpError } from '@/lib/server/http-error'
import { toHttpError } from '@/lib/server/ledger/http'

const STATUS: Record<RecurringErrorCode, number> = {
  invalid_input: 400,
  not_found: 404,
  limit_reached: 409,
}

/** A RecurringError becomes an HttpError (the code, plus `field` when set); everything else goes to the ledger mapping. */
export function toRecurringHttpError(e: unknown): unknown {
  if (e instanceof RecurringError) return new HttpError(STATUS[e.code], e.code, e.field === undefined ? undefined : { field: e.field })
  return toHttpError(e)
}
```

Створити `lib/server/recurring/index.ts`:

```ts
import 'server-only'
import type { SeriesInput, SeriesPatch } from '@/lib/domain/recurring/input'
import type { FutureMode, MatchRequest } from '@/lib/domain/recurring/types'
import { ledger, ledgerDeps } from '@/lib/server/ledger'
import { runRecurringCron } from './cron'
import { readMatchSuggestions, readOverview, readSeries } from './read'
import { runMatches } from './run'

/** Planned payments (S11) bound to the production Firestore and the Warsaw clock. Every write goes through `ledger`. */
export const recurring = {
  overview: (orgId: string) => readOverview(ledgerDeps(), orgId),
  get: (orgId: string, seriesId: string) => readSeries(ledgerDeps(), orgId, seriesId),
  create: (orgId: string, uid: string, input: SeriesInput) => ledger.createSeries(orgId, uid, input),
  update: (orgId: string, uid: string, seriesId: string, patch: SeriesPatch) => ledger.updateSeries(orgId, uid, seriesId, patch),
  remove: (orgId: string, uid: string, seriesId: string, mode: FutureMode) => ledger.deleteSeries(orgId, uid, seriesId, mode),
  skip: (orgId: string, uid: string, seriesId: string, occurrence: string) => ledger.skipOccurrence(orgId, uid, seriesId, occurrence),
  /** What the journal offers: the pairs, how many there are, the ambiguous sides, whether a read was cut. */
  suggestions: async (orgId: string) => {
    const { pairs, total, ambiguous, truncated } = await readMatchSuggestions(ledgerDeps(), orgId)
    return { pairs, total, ambiguous, truncated }
  },
  matches: (orgId: string, uid: string, req: MatchRequest) => runMatches(ledger, orgId, uid, req),
  /** The daily fill, a step of the hourly cron call; never throws. */
  cron: (budgetMs: number) => runRecurringCron(ledgerDeps(), { budgetMs }),
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/server && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only firestore --project demo-finflow "npx vitest run --config vitest.integration.config.ts tests/integration/recurring-read.test.ts tests/integration/transfers-read.test.ts tests/integration/ledger-transfers.test.ts" && npm run typecheck && npm run lint && npm run check:server-imports
```

Expected: усі PASS (нові unit і 6 інтеграційних сценаріїв; перекази S10b з `timestampOf` зі спільного модуля без змін), `tsc` чисто, `lint` 0 errors / 10 warnings, `check:server-imports` OK.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add lib/server/ledger/version.ts lib/server/transfers/run.ts lib/server/recurring/read.ts lib/server/recurring/run.ts lib/server/recurring/cron.ts lib/server/recurring/http.ts lib/server/recurring/index.ts tests/unit/server/recurring/run.test.ts tests/unit/server/recurring/http.test.ts tests/integration/recurring-read.test.ts && git commit -m "feat(recurring): overview, match suggestions, match runs and the bounded daily fill

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Маршрути `recurring/**`, частина `recurring` у щогодинному виклику, job GitHub

**Files:**
- Create: `app/api/orgs/[orgId]/recurring/route.ts`, `app/api/orgs/[orgId]/recurring/[seriesId]/route.ts`, `app/api/orgs/[orgId]/recurring/[seriesId]/skip/route.ts`, `app/api/orgs/[orgId]/recurring/suggestions/route.ts`, `app/api/orgs/[orgId]/recurring/matches/route.ts`, `tests/unit/api/recurring/routes.test.ts`
- Modify: `app/api/cron/bank-sync/route.ts`, `tests/unit/api/cron/bank-sync.test.ts`, `.github/workflows/bank-sync.yml`

- [ ] **Step 1: Write the failing tests**

Створити `tests/unit/api/recurring/routes.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LedgerError } from '@/lib/domain/ledger/errors'
import { RecurringError } from '@/lib/domain/recurring/errors'
import { recurring } from '@/lib/server/recurring'
import { resetFakeAdmin } from '@/tests/unit/helpers/fake-admin'
import { GET as overviewRoute, POST as createRoute } from '@/app/api/orgs/[orgId]/recurring/route'
import { DELETE as deleteRoute, GET as seriesRoute, PATCH as patchRoute } from '@/app/api/orgs/[orgId]/recurring/[seriesId]/route'
import { POST as skipRoute } from '@/app/api/orgs/[orgId]/recurring/[seriesId]/skip/route'
import { GET as suggestionsRoute } from '@/app/api/orgs/[orgId]/recurring/suggestions/route'
import { POST as matchesRoute } from '@/app/api/orgs/[orgId]/recurring/matches/route'

vi.mock('@/lib/server/firebase-admin', async () => {
  const { fakeAdmin: admin } = await import('@/tests/unit/helpers/fake-admin')
  return { getAdmin: () => admin }
})
vi.mock('@/lib/server/recurring', () => ({
  recurring: {
    overview: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), skip: vi.fn(), suggestions: vi.fn(), matches: vi.fn(), cron: vi.fn(),
  },
}))

const SERIES = 'abcdefghij0123456789'
const PLAN = `pl_${SERIES}_2026-11-10`
const BANK = `bk_${'a'.repeat(32)}`
const V = '1790000000.000000001'
const BODY = { name: 'Czynsz', kind: 'expense', accountId: 'mil', amountMinor: 250_000, frequency: 'monthly', dayOfMonth: 10, startDate: '2026-11-01' }
const base = '/api/orgs/org-acme/recurring'

function req(method: string, path: string, body?: unknown, token: string | null = 'token-alice'): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }
  if (token) headers.Cookie = `__session=${token}`
  return new Request(`http://localhost:3000${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
}
const ctx = <T extends Record<string, string> = Record<never, never>>(extra?: T) => ({
  params: Promise.resolve({ orgId: 'org-acme', ...extra } as { orgId: string } & T),
})
const one = () => ctx({ seriesId: SERIES })

type Call = { name: string; mock: keyof typeof recurring; call: (token: string | null) => Promise<Response> }
const READS: Call[] = [
  { name: 'GET /recurring', mock: 'overview', call: (t) => overviewRoute(req('GET', base, undefined, t), ctx()) },
  { name: 'GET /recurring/{id}', mock: 'get', call: (t) => seriesRoute(req('GET', `${base}/${SERIES}`, undefined, t), one()) },
  { name: 'GET /recurring/suggestions', mock: 'suggestions', call: (t) => suggestionsRoute(req('GET', `${base}/suggestions`, undefined, t), ctx()) },
]
const WRITES: Call[] = [
  { name: 'POST /recurring', mock: 'create', call: (t) => createRoute(req('POST', base, BODY, t), ctx()) },
  { name: 'PATCH /recurring/{id}', mock: 'update', call: (t) => patchRoute(req('PATCH', `${base}/${SERIES}`, { amountMinor: 1 }, t), one()) },
  { name: 'DELETE /recurring/{id}', mock: 'remove', call: (t) => deleteRoute(req('DELETE', `${base}/${SERIES}`, undefined, t), one()) },
  { name: 'POST /recurring/{id}/skip', mock: 'skip', call: (t) => skipRoute(req('POST', `${base}/${SERIES}/skip`, { occurrence: '2026-11-10' }, t), one()) },
  { name: 'POST /recurring/matches', mock: 'matches', call: (t) => matchesRoute(req('POST', `${base}/matches`, { undo: [PLAN] }, t), ctx()) },
]

beforeEach(() => {
  resetFakeAdmin()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const fn of Object.values(recurring)) vi.mocked(fn).mockReset()
  vi.mocked(recurring.overview).mockResolvedValue({ series: [], overdueCount: 0, overdue: [], upcoming: [], soon: { income: [], expense: [] }, truncated: false })
  vi.mocked(recurring.get).mockResolvedValue(null)
  vi.mocked(recurring.suggestions).mockResolvedValue({ pairs: [], total: 0, ambiguous: 0, truncated: false })
  vi.mocked(recurring.create).mockResolvedValue({ series: { id: SERIES } as never, created: 3 })
  vi.mocked(recurring.update).mockResolvedValue({ series: { id: SERIES } as never, created: 0, updated: 1, deleted: 0 })
  vi.mocked(recurring.remove).mockResolvedValue({ deleted: 2 })
  vi.mocked(recurring.skip).mockResolvedValue({ id: PLAN } as never)
  vi.mocked(recurring.matches).mockResolvedValue([])
})

describe('authorization of every recurring route', () => {
  describe.each([...READS, ...WRITES])('$name', ({ mock, call }) => {
    it('answers 401 without a session', async () => {
      expect((await call(null)).status).toBe(401)
      expect(recurring[mock]).not.toHaveBeenCalled()
    })

    it('answers 403 to a user who is not a member', async () => {
      expect((await call('token-mallory')).status).toBe(403)
      expect(recurring[mock]).not.toHaveBeenCalled()
    })
  })

  it.each(WRITES.map((r) => [r.name, r] as const))('%s answers 403 to a viewer', async (_name, { mock, call }) => {
    expect((await call('token-dave')).status).toBe(403)
    expect(recurring[mock]).not.toHaveBeenCalled()
  })

  it.each(READS.filter((r) => r.mock !== 'get').map((r) => [r.name, r] as const))('%s lets a viewer read, not cached', async (_name, { call }) => {
    const res = await call('token-dave')
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('POST /recurring', () => {
  it('creates a series from a valid body: 201 with the number of plans', async () => {
    const res = await createRoute(req('POST', base, BODY), ctx())
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ series: { id: SERIES }, created: 3 })
    expect(recurring.create).toHaveBeenCalledWith('org-acme', 'user-alice', expect.objectContaining({ name: 'Czynsz', dayOfMonth: 10, weekendRule: 'none' }))
  })

  it('answers 400 with the field for an invalid body and 413 above 64 KB', async () => {
    const bad = await createRoute(req('POST', base, { ...BODY, dayOfMonth: 32 }), ctx())
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'invalid_input', field: 'dayOfMonth' })
    expect((await createRoute(req('POST', base, { ...BODY, description: 'x'.repeat(70_000) }), ctx())).status).toBe(413)
    expect(recurring.create).not.toHaveBeenCalled()
  })

  it('maps the limit and a refused reference', async () => {
    vi.mocked(recurring.create).mockRejectedValueOnce(new RecurringError('limit_reached'))
    expect((await createRoute(req('POST', base, BODY), ctx())).status).toBe(409)
    vi.mocked(recurring.create).mockRejectedValueOnce(new LedgerError('category_not_found', 'categoryId'))
    const res = await createRoute(req('POST', base, BODY), ctx())
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'category_not_found' })
  })
})

describe('the routes of one series', () => {
  it('GET answers 404 for an unknown series and for an id that cannot be one', async () => {
    expect((await seriesRoute(req('GET', `${base}/${SERIES}`), one())).status).toBe(404)
    expect((await seriesRoute(req('GET', `${base}/a.b`), ctx({ seriesId: 'a.b' }))).status).toBe(404)
    expect(recurring.get).toHaveBeenCalledTimes(1)
  })

  it('PATCH passes the parsed change; a bad id is 404, a bad body 400', async () => {
    expect((await patchRoute(req('PATCH', `${base}/${SERIES}`, { status: 'paused', removeFuture: true }), one())).status).toBe(200)
    expect(recurring.update).toHaveBeenCalledWith('org-acme', 'user-alice', SERIES, { changes: {}, status: 'paused', removeFuture: true })
    expect((await patchRoute(req('PATCH', `${base}/a.b`, { name: 'x' }), ctx({ seriesId: 'a.b' }))).status).toBe(404)
    expect((await patchRoute(req('PATCH', `${base}/${SERIES}`, { kind: 'income' }), one())).status).toBe(400)
  })

  it('DELETE reads from the query what happens to the future plans', async () => {
    expect((await deleteRoute(req('DELETE', `${base}/${SERIES}?future=keep`), one())).status).toBe(200)
    expect(recurring.remove).toHaveBeenCalledWith('org-acme', 'user-alice', SERIES, 'keep')
    expect((await deleteRoute(req('DELETE', `${base}/${SERIES}?future=maybe`), one())).status).toBe(400)
  })

  it('skip passes the occurrence and answers the plan as it was', async () => {
    const res = await skipRoute(req('POST', `${base}/${SERIES}/skip`, { occurrence: '2026-11-10' }), one())
    expect(await res.json()).toEqual({ before: { id: PLAN } })
    expect(recurring.skip).toHaveBeenCalledWith('org-acme', 'user-alice', SERIES, '2026-11-10')
  })
})

describe('POST /recurring/matches', () => {
  it('passes a parsed confirmation and answers a result per pair', async () => {
    vi.mocked(recurring.matches).mockResolvedValueOnce([{ planId: PLAN, ok: true, bankId: BANK }])
    const res = await matchesRoute(req('POST', `${base}/matches`, { confirm: [{ planId: PLAN, bankId: BANK, versions: [V, V] }] }), ctx())
    expect(await res.json()).toEqual({ results: [{ planId: PLAN, ok: true, bankId: BANK }] })
    expect(recurring.matches).toHaveBeenCalledWith('org-acme', 'user-alice', { kind: 'confirm', items: [{ planId: PLAN, bankId: BANK, versions: [V, V] }] })
  })

  it('answers 400 for a bad body', async () => {
    expect((await matchesRoute(req('POST', `${base}/matches`, { pairs: [] }), ctx())).status).toBe(400)
  })
})
```

Замінити файл `tests/unit/api/cron/bank-sync.test.ts` повністю (Write) на:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backgroundBankDeps, banking } from '@/lib/server/banking'
import { recurring } from '@/lib/server/recurring'
import { POST } from '@/app/api/cron/bank-sync/route'

vi.mock('@/lib/server/banking', () => ({
  backgroundBankDeps: vi.fn(() => ({ marker: 'deps' })),
  banking: { runBackgroundSync: vi.fn() },
}))
vi.mock('@/lib/server/recurring', () => ({ recurring: { cron: vi.fn() } }))

const SECRET = 'a-long-random-secret-of-at-least-32-chars'
const SUMMARY = { slot: '2026-10-27#08', considered: 1, synced: 1, skipped: 0, failed: 0, rateLimited: 0, imported: 4 }
const PLANS = { considered: 2, filled: 2, created: 3, skipped: 0, failed: 0 }

function call(authorization?: string): Promise<Response> {
  return POST(new Request('http://localhost:3000/api/cron/bank-sync', { method: 'POST', headers: authorization ? { Authorization: authorization } : {} }))
}

beforeEach(() => {
  vi.stubEnv('BANK_CRON_SECRET', SECRET)
  vi.mocked(banking.runBackgroundSync).mockReset()
  vi.mocked(backgroundBankDeps).mockClear()
  vi.mocked(recurring.cron).mockReset()
  vi.mocked(recurring.cron).mockResolvedValue(PLANS)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/cron/bank-sync', () => {
  it('answers 503 and does nothing while no secret is configured', async () => {
    vi.stubEnv('BANK_CRON_SECRET', '')
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503)
    expect(banking.runBackgroundSync).not.toHaveBeenCalled()
    expect(recurring.cron).not.toHaveBeenCalled()
  })

  it('answers 503 for a secret shorter than 32 characters', async () => {
    vi.stubEnv('BANK_CRON_SECRET', 'short')
    expect((await call('Bearer short')).status).toBe(503)
    expect(banking.runBackgroundSync).not.toHaveBeenCalled()
  })

  it.each([
    ['no header', undefined],
    ['a wrong secret', 'Bearer nope'],
    ['the secret without Bearer', SECRET],
  ])('answers 401 with %s and does nothing', async (_name, header) => {
    const res = await call(header)
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('')
    expect(banking.runBackgroundSync).not.toHaveBeenCalled()
    expect(recurring.cron).not.toHaveBeenCalled()
  })

  it('runs the bank refresh with person-less dependencies, then the planned payments, and returns both counts, not cached', async () => {
    vi.mocked(banking.runBackgroundSync).mockResolvedValue(SUMMARY)
    const res = await call(`Bearer ${SECRET}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({ ...SUMMARY, recurring: PLANS })
    expect(banking.runBackgroundSync).toHaveBeenCalledWith({ marker: 'deps' })
    const budget = vi.mocked(recurring.cron).mock.calls[0][0]
    expect(budget).toBeGreaterThan(0)
    expect(budget).toBeLessThanOrEqual(10_000)
  })

  it('gives the planned payments only what is left of the route time', async () => {
    vi.mocked(banking.runBackgroundSync).mockResolvedValue(SUMMARY)
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValueOnce(1_000_000).mockReturnValueOnce(1_050_000)
    await call(`Bearer ${SECRET}`)
    now.mockReturnValueOnce(2_000_000).mockReturnValueOnce(2_058_000)
    await call(`Bearer ${SECRET}`)
    now.mockRestore()
    expect(vi.mocked(recurring.cron).mock.calls.map((c) => c[0])).toEqual([5_000, 0])
  })

  it('answers 500 when the bank refresh breaks, so the job turns red; the planned payments still run', async () => {
    vi.mocked(banking.runBackgroundSync).mockRejectedValue(new Error('boom'))
    const res = await call(`Bearer ${SECRET}`)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal' })
    expect(recurring.cron).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/api/recurring tests/unit/api/cron`
Expected: FAIL (маршрутів `recurring/**` немає; cron-маршрут не викликає `recurring.cron`).

- [ ] **Step 3: Implement**

Створити `app/api/orgs/[orgId]/recurring/route.ts`:

```ts
import { parseSeriesInput } from '@/lib/domain/recurring/input'
import { RECURRING_BODY_MAX_BYTES } from '@/lib/domain/recurring/types'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { recurring } from '@/lib/server/recurring'
import { toRecurringHttpError } from '@/lib/server/recurring/http'
import { readJsonBody } from '@/lib/server/request-body'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string }> }

// GET /api/orgs/{orgId}/recurring  (owner, accountant, viewer) -> { series, overdueCount, overdue, upcoming, soon, truncated }
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant', 'viewer'])
    return Response.json(await recurring.overview(orgId), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toRecurringHttpError(e))
  }
}

// POST /api/orgs/{orgId}/recurring  (owner, accountant) <series body> -> 201 { series, created }
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    const input = parseSeriesInput(await readJsonBody(req, RECURRING_BODY_MAX_BYTES))
    return Response.json(await recurring.create(orgId, uid, input), { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toRecurringHttpError(e))
  }
}
```

Створити `app/api/orgs/[orgId]/recurring/[seriesId]/route.ts`:

```ts
import { isId } from '@/lib/domain/ledger/guards'
import { parseDeleteQuery, parseSeriesPatch } from '@/lib/domain/recurring/input'
import { RECURRING_BODY_MAX_BYTES } from '@/lib/domain/recurring/types'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse, HttpError } from '@/lib/server/http-error'
import { recurring } from '@/lib/server/recurring'
import { toRecurringHttpError } from '@/lib/server/recurring/http'
import { readJsonBody } from '@/lib/server/request-body'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string; seriesId: string }> }

// GET /api/orgs/{orgId}/recurring/{seriesId}  (owner, accountant, viewer) -> { series }
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId, seriesId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant', 'viewer'])
    const series = isId(seriesId) ? await recurring.get(orgId, seriesId) : null
    if (series === null) throw new HttpError(404, 'not_found')
    return Response.json({ series }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toRecurringHttpError(e))
  }
}

// PATCH /api/orgs/{orgId}/recurring/{seriesId}  (owner, accountant) { <fields>?, status?, removeFuture? }
// -> { series, created, updated, deleted }
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId, seriesId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    if (!isId(seriesId)) throw new HttpError(404, 'not_found')
    const patch = parseSeriesPatch(await readJsonBody(req, RECURRING_BODY_MAX_BYTES))
    return Response.json(await recurring.update(orgId, uid, seriesId, patch), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toRecurringHttpError(e))
  }
}

// DELETE /api/orgs/{orgId}/recurring/{seriesId}?future=delete|keep  (owner, accountant) -> { deleted }
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId, seriesId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    if (!isId(seriesId)) throw new HttpError(404, 'not_found')
    const mode = parseDeleteQuery(new URL(req.url).searchParams)
    return Response.json(await recurring.remove(orgId, uid, seriesId, mode), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toRecurringHttpError(e))
  }
}
```

Створити `app/api/orgs/[orgId]/recurring/[seriesId]/skip/route.ts`:

```ts
import { isId } from '@/lib/domain/ledger/guards'
import { parseSkipBody } from '@/lib/domain/recurring/input'
import { RECURRING_BODY_MAX_BYTES } from '@/lib/domain/recurring/types'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse, HttpError } from '@/lib/server/http-error'
import { recurring } from '@/lib/server/recurring'
import { toRecurringHttpError } from '@/lib/server/recurring/http'
import { readJsonBody } from '@/lib/server/request-body'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string; seriesId: string }> }

// POST /api/orgs/{orgId}/recurring/{seriesId}/skip  (owner, accountant) { occurrence } -> { before }: the plan as it was (for the undo)
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId, seriesId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    if (!isId(seriesId)) throw new HttpError(404, 'not_found')
    const { occurrence } = parseSkipBody(await readJsonBody(req, RECURRING_BODY_MAX_BYTES))
    const before = await recurring.skip(orgId, uid, seriesId, occurrence)
    return Response.json({ before }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toRecurringHttpError(e))
  }
}
```

Створити `app/api/orgs/[orgId]/recurring/suggestions/route.ts`:

```ts
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { recurring } from '@/lib/server/recurring'
import { toRecurringHttpError } from '@/lib/server/recurring/http'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string }> }

// GET /api/orgs/{orgId}/recurring/suggestions  (owner, accountant, viewer) -> { pairs, total, ambiguous, truncated }
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant', 'viewer'])
    return Response.json(await recurring.suggestions(orgId), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toRecurringHttpError(e))
  }
}
```

Створити `app/api/orgs/[orgId]/recurring/matches/route.ts`:

```ts
import { parseMatchRequest } from '@/lib/domain/recurring/input'
import { RECURRING_BODY_MAX_BYTES } from '@/lib/domain/recurring/types'
import { requireOrgRole, requireUser } from '@/lib/server/auth'
import { errorResponse } from '@/lib/server/http-error'
import { recurring } from '@/lib/server/recurring'
import { toRecurringHttpError } from '@/lib/server/recurring/http'
import { readJsonBody } from '@/lib/server/request-body'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ orgId: string }> }

// POST /api/orgs/{orgId}/recurring/matches  (owner, accountant)
// { confirm: [{ planId, bankId, versions: [plan, bank] }] } | { undo: [planId] }
// -> { results: [{ planId, ok: true, bankId } | { planId, ok: false, code }] }
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { uid } = await requireUser(req)
    const { orgId } = await params
    await requireOrgRole(uid, orgId, ['owner', 'accountant'])
    const request = parseMatchRequest(await readJsonBody(req, RECURRING_BODY_MAX_BYTES))
    const results = await recurring.matches(orgId, uid, request)
    return Response.json({ results }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(toRecurringHttpError(e))
  }
}
```

Замінити файл `app/api/cron/bank-sync/route.ts` повністю (Write) на:

```ts
import { CRON_ROUTE_BUDGET_MS, RECURRING_CRON_BUDGET_MS } from '@/lib/domain/recurring/types'
import { backgroundBankDeps, banking } from '@/lib/server/banking'
import { bearerMatches } from '@/lib/server/cron-auth'
import { errorResponse } from '@/lib/server/http-error'
import { recurring } from '@/lib/server/recurring'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const MIN_SECRET_LENGTH = 32

// POST /api/cron/bank-sync  (GitHub Actions, every hour)  Authorization: Bearer <BANK_CRON_SECRET>
// Refreshes the linked bank accounts that are due in the current slot (08:00, 13:00, 17:00 Warsaw), then fills the planned
// payments of the day (S11) -> the bank counts, and the planned payments' counts under `recurring`.
// No session here: the secret is the only way in, and without a configured secret the route does nothing.
export async function POST(req: Request) {
  const started = Date.now()
  try {
    const secret = process.env.BANK_CRON_SECRET
    if (!secret || secret.length < MIN_SECRET_LENGTH) return new Response(null, { status: 503 })
    if (!bearerMatches(req.headers.get('authorization'), secret)) return new Response(null, { status: 401 })
    let bank: Awaited<ReturnType<typeof banking.runBackgroundSync>> | null = null
    let bankError: unknown = null
    try {
      bank = await banking.runBackgroundSync(backgroundBankDeps())
    } catch (e) {
      bankError = e
    }
    // S11: the bank refresh goes first (the bank's daily limits matter more). The planned payments get what is left of the
    // route's time, at most RECURRING_CRON_BUDGET_MS; an hour without time is caught up by the next call. They never throw.
    const left = CRON_ROUTE_BUDGET_MS - (Date.now() - started)
    const plans = await recurring.cron(Math.max(0, Math.min(RECURRING_CRON_BUDGET_MS, left)))
    if (bankError !== null || bank === null) return errorResponse(bankError)
    return Response.json({ ...bank, recurring: plans }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return errorResponse(e)
  }
}
```

`.github/workflows/bank-sync.yml`:

1. Рядок коментаря `# Calls the production route that refreshes the linked bank accounts in the slots 08:00, 13:00 and 17:00 Warsaw.` замінити на:

```yaml
# Calls the production route that refreshes the linked bank accounts in the slots 08:00, 13:00 and 17:00 Warsaw and fills
# the planned payments of the day (S11, the `recurring` part of the answer).
```

2. Рядки

```yaml
          failed=$(jq -r '.failed' "$RUNNER_TEMP/out.json") || { echo "bank-sync: the response is not JSON" >&2; exit 1; }
          case "$failed" in
            0) echo "bank-sync ok" ;;
            ''|*[!0-9]*) echo "bank-sync: the response has no failed count" >&2; exit 1 ;;
            *) echo "bank-sync: ${failed} account(s) failed"; exit 1 ;;
          esac
```

замінити на

```yaml
          failed=$(jq -r '.failed' "$RUNNER_TEMP/out.json") || { echo "bank-sync: the response is not JSON" >&2; exit 1; }
          planned=$(jq -r '.recurring.failed' "$RUNNER_TEMP/out.json") || { echo "bank-sync: the response is not JSON" >&2; exit 1; }
          case "$failed" in
            ''|*[!0-9]*) echo "bank-sync: the response has no failed count" >&2; exit 1 ;;
          esac
          case "$planned" in
            ''|*[!0-9]*) echo "bank-sync: the response has no planned payments count" >&2; exit 1 ;;
          esac
          if [ "$failed" = 0 ] && [ "$planned" = 0 ]; then
            echo "bank-sync ok"
          else
            echo "bank-sync: ${failed} account(s) and ${planned} planned payment series failed"
            exit 1
          fi
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/api tests/unit/server/route-auth-coverage.test.ts && npm run typecheck && npm run lint && npm run build`
Expected: PASS (маршрути, cron, тест покриття авторизації сам знаходить 5 нових `route.ts` з `await requireUser(req)`), `tsc` чисто, `lint` 0 errors / 10 warnings, збірка успішна, у списку маршрутів `/api/orgs/[orgId]/recurring`, `.../[seriesId]`, `.../[seriesId]/skip`, `.../suggestions`, `.../matches`.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add "app/api/orgs/[orgId]/recurring" app/api/cron/bank-sync/route.ts .github/workflows/bank-sync.yml tests/unit/api/recurring/routes.test.ts tests/unit/api/cron/bank-sync.test.ts && git commit -m "feat(recurring): routes, and the daily fill as a bounded step of the hourly cron call

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Правила Firestore, індекси, `check:recurring` (лише читання)

**Files:**
- Modify: `firestore.rules`, `firestore.indexes.json`, `tests/rules/firestore.rules.test.ts`, `package.json`
- Create: `scripts/check-recurring.ts`, `scripts/lib/check-recurring.ts`, `tests/unit/scripts/check-recurring.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/rules/firestore.rules.test.ts`:

1. Рядки

```ts
const SERVER_WRITTEN_SUBS = ['accounts', 'transactions', 'rollups', 'audit', 'counterparties', 'rules', 'tags'] as const
const MEMBER_READ_SUBS = ['accounts', 'categories', 'transactions', 'rollups', 'counterparties', 'rules', 'tags'] as const
const ALL_SUBS = ['accounts', 'categories', 'transactions', 'rollups', 'audit', 'bankConnections', 'bankAccounts', 'bankSeen', 'counterparties', 'rules', 'tags'] as const
// S09: the bank collections written by the server only. bankAccounts and bankSeen are closed to every client role.
const BANK_SERVER_ONLY_SUBS = ['bankAccounts', 'bankSeen'] as const
```

замінити на

```ts
const SERVER_WRITTEN_SUBS = ['accounts', 'transactions', 'rollups', 'audit', 'counterparties', 'rules', 'tags', 'recurring'] as const
const MEMBER_READ_SUBS = ['accounts', 'categories', 'transactions', 'rollups', 'counterparties', 'rules', 'tags', 'recurring'] as const
const ALL_SUBS = [
  'accounts', 'categories', 'transactions', 'rollups', 'audit', 'bankConnections', 'bankAccounts', 'bankSeen', 'counterparties', 'rules', 'tags',
  'recurring', 'recurringDone',
] as const
// S09: the bank collections written by the server only. bankAccounts and bankSeen are closed to every client role.
const BANK_SERVER_ONLY_SUBS = ['bankAccounts', 'bankSeen'] as const
// S11: the occurrence marks of planned payments, written by the server only and closed to every client role.
const PLAN_SERVER_ONLY_SUBS = ['recurringDone'] as const
```

2. Рядок `    it.each(BANK_SERVER_ONLY_SUBS)('%s: closed to every role, for reads and writes', async (sub) => {` замінити на:

```ts
    it.each([...BANK_SERVER_ONLY_SUBS, ...PLAN_SERVER_ONLY_SUBS])('%s: closed to every role, for reads and writes', async (sub) => {
```

3. У тесті `does not open other collection groups` список `['accounts', 'transactions', 'categories', 'rollups', 'audit', 'bankConnections', 'bankAccounts', 'bankSeen', 'ledger', 'counterparties', 'counterpartyKeys', 'rules', 'tags', 'tagKeys']` замінити на:

```ts
['accounts', 'transactions', 'categories', 'rollups', 'audit', 'bankConnections', 'bankAccounts', 'bankSeen', 'ledger', 'counterparties', 'counterpartyKeys', 'rules', 'tags', 'tagKeys', 'recurring', 'recurringDone']
```

Створити `tests/unit/scripts/check-recurring.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { recurringCheckLine, sumRecurringChecks, type RecurringCheck } from '@/scripts/lib/check-recurring'

const a: RecurringCheck = { series: 3, active: 2, paused: 1, due: 1, overdue: 4, upcoming: 6, pairs: 1, ambiguous: 0, truncated: false }
const b: RecurringCheck = { series: 0, active: 0, paused: 0, due: 0, overdue: 0, upcoming: 0, pairs: 0, ambiguous: 2, truncated: true }

describe('check:recurring', () => {
  it('prints counts only, one line per company', () => {
    expect(recurringCheckLine('org1', a)).toBe('org org1: 3 series (2 active, 1 paused, 1 due), 4 overdue plan(s), 6 plan(s) in the next 31 days, 1 pair(s) to suggest, 0 ambiguous side(s)')
    expect(recurringCheckLine('org2', b)).toBe('org org2: 0 series (0 active, 0 paused, 0 due), 0 overdue plan(s), 0 plan(s) in the next 31 days, 0 pair(s) to suggest, 2 ambiguous side(s) (cut at a read limit)')
  })

  it('adds the companies up', () => {
    expect(sumRecurringChecks([a, b])).toEqual({ series: 3, active: 2, paused: 1, due: 1, overdue: 4, upcoming: 6, pairs: 1, ambiguous: 2, truncated: true })
    expect(sumRecurringChecks([])).toEqual({ series: 0, active: 0, paused: 0, due: 0, overdue: 0, upcoming: 0, pairs: 0, ambiguous: 0, truncated: false })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/scripts/check-recurring.test.ts; export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npm run test:rules
```

Expected: unit FAIL (`@/scripts/lib/check-recurring` не існує); rules FAIL у `recurring: every member can read` (колекція ще закрита правилами), решта PASS.

- [ ] **Step 3: Implement**

`firestore.rules`:

1. Рядок коментаря `//   organizations/{orgId}/{accounts|categories|transactions|rollups|audit|bankConnections|bankAccounts|bankSeen|ledger|counterparties|counterpartyKeys|rules|tags|tagKeys}/{docId}` замінити на:

```
//   organizations/{orgId}/{accounts|categories|transactions|rollups|audit|bankConnections|bankAccounts|bankSeen|ledger|counterparties|counterpartyKeys|rules|tags|tagKeys|recurring|recurringDone}/{docId}
```

2. Рядки коментаря

```
// Accounts, transactions, rollups, audit, ledger, counterparties, rules (S10), tags (S10t) and the bank collections (bankConnections, bankAccounts,
// bankSeen: S09) are written by the server only (S05, S06, S09). counterpartyKeys and tagKeys (uniqueness keys), bankAccounts and bankSeen
// (bank sync state) and the root rateLimits are not readable or writable by clients at all.
```

замінити на

```
// Accounts, transactions, rollups, audit, ledger, counterparties, rules (S10), tags (S10t), recurring (S11: series of planned payments) and the
// bank collections (bankConnections, bankAccounts, bankSeen: S09) are written by the server only (S05, S06, S09). counterpartyKeys and tagKeys
// (uniqueness keys), bankAccounts and bankSeen (bank sync state), recurringDone (S11: occurrence marks) and the root rateLimits are not
// readable or writable by clients at all.
```

3. Рядки

```
        // bankAccounts and bankSeen match no rule below: closed to clients for reads and writes (deny by default).
        allow read: if (subcollection in ['accounts', 'categories', 'transactions', 'rollups', 'counterparties', 'rules', 'tags']
```

замінити на

```
        // bankAccounts, bankSeen and recurringDone match no rule below: closed to clients for reads and writes (deny by default).
        allow read: if (subcollection in ['accounts', 'categories', 'transactions', 'rollups', 'counterparties', 'rules', 'tags', 'recurring']
```

`firestore.indexes.json`:

1. Рядки

```json
        { "fieldPath": "toAmountMinor", "order": "ASCENDING" }
      ]
    }
  ],
```

замінити на

```json
        { "fieldPath": "toAmountMinor", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "transactions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "paymentDate", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "transactions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "seriesId", "order": "ASCENDING" },
        { "fieldPath": "paymentDate", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "recurringDone",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "seriesId", "order": "ASCENDING" },
        { "fieldPath": "occurrence", "order": "ASCENDING" }
      ]
    }
  ],
```

2. Рядки

```json
      "collectionGroup": "bankAccounts",
      "fieldPath": "status",
      "indexes": [
        { "order": "ASCENDING", "queryScope": "COLLECTION" },
        { "order": "DESCENDING", "queryScope": "COLLECTION" },
        { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    }
```

замінити на

```json
      "collectionGroup": "bankAccounts",
      "fieldPath": "status",
      "indexes": [
        { "order": "ASCENDING", "queryScope": "COLLECTION" },
        { "order": "DESCENDING", "queryScope": "COLLECTION" },
        { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    },
    {
      "collectionGroup": "recurring",
      "fieldPath": "dueOn",
      "indexes": [
        { "order": "ASCENDING", "queryScope": "COLLECTION" },
        { "order": "DESCENDING", "queryScope": "COLLECTION" },
        { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
      ]
    }
```

Створити `scripts/lib/check-recurring.ts`:

```ts
// Pure part of scripts/check-recurring.ts (S11 rollout check). Unit-tested in Vitest.

/** What the check read for one company: counts only. */
export interface RecurringCheck {
  series: number
  active: number
  paused: number
  /** Series whose daily fill is due today or earlier. */
  due: number
  /** Planned operations before today. */
  overdue: number
  /** Planned operations of today and the next 30 days (as the page lists them, at most 50). */
  upcoming: number
  /** Plan ↔ bank pairs the journal would suggest. */
  pairs: number
  ambiguous: number
  /** A read stopped at its limit. */
  truncated: boolean
}

export function recurringCheckLine(orgId: string, c: RecurringCheck): string {
  const cut = c.truncated ? ' (cut at a read limit)' : ''
  return `org ${orgId}: ${c.series} series (${c.active} active, ${c.paused} paused, ${c.due} due), ${c.overdue} overdue plan(s), ${c.upcoming} plan(s) in the next 31 days, ${c.pairs} pair(s) to suggest, ${c.ambiguous} ambiguous side(s)${cut}`
}

export function sumRecurringChecks(checks: readonly RecurringCheck[]): RecurringCheck {
  return checks.reduce(
    (sum, c) => ({
      series: sum.series + c.series,
      active: sum.active + c.active,
      paused: sum.paused + c.paused,
      due: sum.due + c.due,
      overdue: sum.overdue + c.overdue,
      upcoming: sum.upcoming + c.upcoming,
      pairs: sum.pairs + c.pairs,
      ambiguous: sum.ambiguous + c.ambiguous,
      truncated: sum.truncated || c.truncated,
    }),
    { series: 0, active: 0, paused: 0, due: 0, overdue: 0, upcoming: 0, pairs: 0, ambiguous: 0, truncated: false },
  )
}
```

Створити `scripts/check-recurring.ts`:

```ts
// Read-only check for the S11 rollout (planned payments). Per company it reads the overview and the match suggestions the
// way the app does, and it runs once every query shape S11 adds (the due series of the daily fill, the overdue count and
// list, the window of planned operations, the plan candidates and the bank days of the suggestions, the operations and the
// marks of one series), so a missing index shows up as FAILED_PRECONDITION with its creation link. Never writes anything.
//   npm run check:recurring                                   over the emulator when FIRESTORE_EMULATOR_HOST is set
//   npm run check:recurring -- --project=finflow-e94b5        production (the flag is required; nothing is read without it)
//   --org=<id> limits the run to one company.
// Prints counts only, never names, amounts or texts.
// Exit code: 0 everything read, 1 a read failed, 2 refused or bad arguments.
import fs from 'node:fs'
import path from 'node:path'
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { addDays, toDay } from '@/lib/domain/ledger/days'
import { transactionsCol } from '@/lib/server/ledger/paths'
import { seriesMarksQuery, seriesOpsQuery } from '@/lib/server/ledger/series'
import { dueSeriesQuery, readMatchSuggestions, readOverview } from '@/lib/server/recurring/read'
import { todayUtcDay } from '@/lib/utils/today'
import { assertReadinessTarget, parseCheckJournalArgs } from './lib/check-journal-args'
import { recurringCheckLine, sumRecurringChecks, type RecurringCheck } from './lib/check-recurring'

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

async function checkOrg(db: Firestore, orgId: string, today: string): Promise<RecurringCheck> {
  const deps = { db, today: () => today }
  const overview = await readOverview(deps, orgId)
  const matches = await readMatchSuggestions(deps, orgId)
  // The shapes the reads above may skip (no plan near today, no series), each once; an empty answer is fine.
  await seriesOpsQuery(db, orgId, '_probe', today).limit(1).get()
  await seriesMarksQuery(db, orgId, '_probe', today).limit(1).get()
  await transactionsCol(db, orgId).where('paymentDate', '>=', addDays(today, -13)).where('paymentDate', '<=', today).orderBy('paymentDate', 'desc').select().limit(1).get()
  return {
    series: overview.series.length,
    active: overview.series.filter((s) => s.status === 'active').length,
    paused: overview.series.filter((s) => s.status === 'paused').length,
    due: overview.series.filter((s) => s.dueOn !== undefined && s.dueOn <= today).length,
    overdue: overview.overdueCount,
    upcoming: overview.upcoming.length,
    pairs: matches.total,
    ambiguous: matches.ambiguous,
    truncated: overview.truncated || matches.truncated,
  }
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
  const today = toDay(todayUtcDay())

  let failedGlobal = false
  try {
    const due = await dueSeriesQuery(db, today).select().limit(1).get()
    console.log(`due series query: OK (${due.size} of at most 1 read)`)
  } catch (e) {
    console.error(`due series query: FAILED (${describeError(e)})`)
    failedGlobal = true
  }

  const orgIds = org ? [org] : (await db.collection('organizations').select().get()).docs.map((d) => d.id)
  console.log(`companies: ${orgIds.length}`)

  const checks: RecurringCheck[] = []
  const errored: string[] = []
  for (const orgId of orgIds) {
    try {
      const c = await checkOrg(db, orgId, today)
      checks.push(c)
      console.log(recurringCheckLine(orgId, c))
    } catch (e) {
      console.error(`org ${orgId}: FAILED (${describeError(e)})`)
      errored.push(orgId)
    }
  }
  console.log(recurringCheckLine('ALL', sumRecurringChecks(checks)))
  if (errored.length > 0) console.error(`failed companies (${errored.length}): ${errored.join(', ')}`)
  if (errored.length === 0 && !failedGlobal) console.log('DONE: every query ran. Nothing was written.')
  return errored.length > 0 || failedGlobal ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`FAILED (${describeError(e)})`)
    process.exit(1)
  },
)
```

`package.json`: після рядка `    "check:transfers": "node --conditions=react-server --import tsx scripts/check-transfers.ts",` додати:

```json
    "check:recurring": "node --conditions=react-server --import tsx scripts/check-recurring.ts",
```

- [ ] **Step 4: Run the tests and the script on the emulator**

```bash
cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/scripts/check-recurring.test.ts && npm run typecheck && npm run lint && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npm run test:rules && npx firebase emulators:exec --only firestore --project demo-finflow "npm run check:recurring"
```

Expected: unit PASS; `tsc` чисто; `lint` 0 errors / 10 warnings; rules PASS (2 файли; тестів більше, ніж базові 144, через `recurring` і `recurringDone` у матриці; записати число); скрипт на порожньому емуляторі друкує `target: Firestore EMULATOR`, `due series query: OK (0 of at most 1 read)`, `companies: 0`, рядок `org ALL: 0 series ...`, `DONE: every query ran. Nothing was written.` і виходить з кодом 0. Без емулятора й без `--project=finflow-e94b5` (`npm run check:recurring`) виходить з кодом 2 і `REFUSED`, нічого не читаючи.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add firestore.rules firestore.indexes.json tests/rules/firestore.rules.test.ts scripts/check-recurring.ts scripts/lib/check-recurring.ts tests/unit/scripts/check-recurring.test.ts package.json && git commit -m "feat(recurring): rules, indexes and the read-only check:recurring

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Браузер: клієнт, дії з плановою операцією, хуки, повідомлення uk / pl / en

**Files:**
- Create: `lib/api/recurring-client.ts`, `lib/api/recurring-actions.ts`, `lib/hooks/useRecurringOverview.ts`, `lib/hooks/usePlanMatches.ts`, `lib/hooks/useSeriesName.ts`, `tests/unit/api/recurring-client.test.ts`
- Modify: `messages/uk.json`, `messages/pl.json`, `messages/en.json`

- [ ] **Step 1: Write the failing test**

Створити `tests/unit/api/recurring-client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const notify = vi.fn()
vi.mock('@/lib/api/ledger-events', () => ({ notifyLedgerChanged: () => notify(), onLedgerChanged: () => () => {} }))

import { confirmMatches, deleteSeries, onRecurringChanged, skipPlan, undoMatches } from '@/lib/api/recurring-client'
import type { PlanMatch } from '@/lib/domain/recurring/types'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const PLAN = 'pl_ser1_2026-11-10'
const BANK = `bk_${'a'.repeat(32)}`
const pair: PlanMatch = {
  plan: { id: PLAN, version: '1.000000001', type: 'expense', accountId: 'mil', amountMinor: 1, currency: 'PLN', paymentDate: '2026-11-10', seriesId: 'ser1', occurrence: '2026-11-10', estimated: false },
  bank: { id: BANK, version: '1.000000002', type: 'expense', accountId: 'mil', amountMinor: 1, currency: 'PLN', paymentDate: '2026-11-11' },
}

beforeEach(() => notify.mockClear())
afterEach(() => vi.unstubAllGlobals())

describe('recurring calls', () => {
  it('confirms pairs with the versions the person saw and tells the journal and the page', async () => {
    // The unit tests run in Node: a bare EventTarget stands in for the window the events go through.
    vi.stubGlobal('window', new EventTarget())
    const heard = vi.fn()
    const off = onRecurringChanged(heard)
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ results: [{ planId: PLAN, ok: true, bankId: BANK }] }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await confirmMatches('org 1', [pair])).toEqual([{ planId: PLAN, ok: true, bankId: BANK }])
    expect(fetchMock.mock.calls[0][0]).toBe('/api/orgs/org%201/recurring/matches')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ confirm: [{ planId: PLAN, bankId: BANK, versions: ['1.000000001', '1.000000002'] }] })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(heard).toHaveBeenCalledTimes(1)
    off()
  })

  it('undoes in requests of at most 50', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `pl_s${i}_2026-11-10`)
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: { body: string }) =>
      json({ results: (JSON.parse(init.body) as { undo: string[] }).undo.map((planId) => ({ planId, ok: true, bankId: BANK })) }),
    )
    vi.stubGlobal('fetch', fetchMock)
    expect(await undoMatches('org1', ids)).toHaveLength(51)
    expect(fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).undo.length)).toEqual([50, 1])
  })

  it('deletes a series with the choice for the future plans, and a skip answers the plan as it was', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ deleted: 2 })).mockResolvedValueOnce(json({ before: { id: PLAN } }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await deleteSeries('org1', 'ser1', 'keep')).toEqual({ deleted: 2 })
    expect(await skipPlan('org1', 'ser1', '2026-11-10')).toEqual({ id: PLAN })
    expect(fetchMock.mock.calls.map((c) => [c[0], c[1]?.method])).toEqual([
      ['/api/orgs/org1/recurring/ser1?future=keep', 'DELETE'],
      ['/api/orgs/org1/recurring/ser1/skip', 'POST'],
    ])
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ occurrence: '2026-11-10' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/api/recurring-client.test.ts`
Expected: FAIL (`@/lib/api/recurring-client` не існує).

- [ ] **Step 3: Implement the client, the actions and the hooks**

Створити `lib/api/recurring-client.ts`:

```ts
import type { LedgerTransaction } from '@/lib/domain/ledger/types'
import { MAX_MATCH_ITEMS, type FutureMode, type MatchOutcome, type MatchSuggestions, type PlanMatch, type RecurringOverview, type Series } from '@/lib/domain/recurring/types'
import { apiCall, readApiError } from './ledger-client'
import { notifyLedgerChanged } from './ledger-events'

const EVENT = 'finflow:recurring-changed'
const org = (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}`
const one = (orgId: string, seriesId: string) => `${org(orgId)}/recurring/${encodeURIComponent(seriesId)}`

/** Tells the planned payments page and the journal's matches that series, plans or matches changed in this browser. */
export function notifyRecurringChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

export function onRecurringChanged(callback: () => void): () => void {
  window.addEventListener(EVENT, callback)
  return () => window.removeEventListener(EVENT, callback)
}

/** After a write: the journal reloads its rows, the page and the matches read again. */
function changed(): void {
  notifyLedgerChanged()
  notifyRecurringChanged()
}

async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', signal })
  if (!res.ok) throw await readApiError(res)
  return (await res.json()) as T
}

/** The page «Планові платежі» (S11). Throws `LedgerApiError`. */
export function fetchRecurringOverview(orgId: string, signal?: AbortSignal): Promise<RecurringOverview> {
  return read<RecurringOverview>(`${org(orgId)}/recurring`, signal)
}

/** One series (the form names it); status 404 when it is gone. */
export async function fetchSeries(orgId: string, seriesId: string, signal?: AbortSignal): Promise<Series> {
  return (await read<{ series: Series }>(one(orgId, seriesId), signal)).series
}

/** The plan ↔ bank pairs the journal suggests. */
export function fetchPlanMatches(orgId: string, signal?: AbortSignal): Promise<MatchSuggestions> {
  return read<MatchSuggestions>(`${org(orgId)}/recurring/suggestions`, signal)
}

export async function createSeries(orgId: string, body: Record<string, unknown>): Promise<{ series: Series; created: number }> {
  try {
    return (await apiCall('POST', `${org(orgId)}/recurring`, body)) as { series: Series; created: number }
  } finally {
    changed()
  }
}

export interface SeriesUpdate {
  series: Series
  created: number
  updated: number
  deleted: number
}

export async function updateSeries(orgId: string, seriesId: string, patch: Record<string, unknown>): Promise<SeriesUpdate> {
  try {
    return (await apiCall('PATCH', one(orgId, seriesId), patch)) as SeriesUpdate
  } finally {
    changed()
  }
}

export async function deleteSeries(orgId: string, seriesId: string, future: FutureMode): Promise<{ deleted: number }> {
  try {
    return (await apiCall('DELETE', `${one(orgId, seriesId)}?future=${future}`)) as { deleted: number }
  } finally {
    changed()
  }
}

/** «Пропустити цей раз»: the plan as it was, for the undo (`restoreTransaction` under its plan id). */
export async function skipPlan(orgId: string, seriesId: string, occurrence: string): Promise<LedgerTransaction> {
  try {
    return ((await apiCall('POST', `${one(orgId, seriesId)}/skip`, { occurrence })) as { before: LedgerTransaction }).before
  } finally {
    changed()
  }
}

async function postMatches(orgId: string, body: unknown): Promise<MatchOutcome[]> {
  return ((await apiCall('POST', `${org(orgId)}/recurring/matches`, body)) as { results: MatchOutcome[] }).results
}

/** Confirms suggested pairs with the versions the person saw: a side changed since is a `conflict`, never linked blindly. */
export async function confirmMatches(orgId: string, pairs: readonly PlanMatch[]): Promise<MatchOutcome[]> {
  try {
    const out: MatchOutcome[] = []
    for (let i = 0; i < pairs.length; i += MAX_MATCH_ITEMS) {
      const chunk = pairs.slice(i, i + MAX_MATCH_ITEMS)
      out.push(...(await postMatches(orgId, { confirm: chunk.map((p) => ({ planId: p.plan.id, bankId: p.bank.id, versions: [p.plan.version, p.bank.version] })) })))
    }
    return out
  } finally {
    changed()
  }
}

/** The undo of confirmed pairs, by plan id (requests of at most MAX_MATCH_ITEMS). */
export async function undoMatches(orgId: string, planIds: readonly string[]): Promise<MatchOutcome[]> {
  try {
    const out: MatchOutcome[] = []
    for (let i = 0; i < planIds.length; i += MAX_MATCH_ITEMS) out.push(...(await postMatches(orgId, { undo: planIds.slice(i, i + MAX_MATCH_ITEMS) })))
    return out
  } finally {
    changed()
  }
}
```

Створити `lib/api/recurring-actions.ts`:

```ts
import { paidDay } from '@/lib/domain/transaction-form/status'
import { toUiTransaction } from '@/lib/firebase/ledger-map'
import type { Transaction } from '@/types'
import { fetchTransaction } from './journal-client'
import { updateTransaction } from './ledger-client'
import { notifyRecurringChanged, skipPlan } from './recurring-client'
import { transactionToDraft } from './transaction-draft'
import { restoreTransaction, revertTransaction } from './transaction-undo'

/**
 * «Позначити сплаченою» from the page (S11): the operation as it is now (the list can be stale) becomes actual on its day,
 * or today when that is still ahead, as the form does. Returns it as it was, for the undo.
 */
export async function markPlanPaid(orgId: string, txId: string, today: string): Promise<Transaction> {
  const before = toUiTransaction(orgId, await fetchTransaction(orgId, txId))
  const draft = transactionToDraft(before)
  await updateTransaction(orgId, txId, { ...draft, status: 'actual', paymentDate: paidDay(draft.paymentDate, today) })
  notifyRecurringChanged()
  return before
}

/** «Перенести»: a new payment day (the ledger then marks the occurrence «змінено вручну»). Returns it as it was. */
export async function movePlan(orgId: string, txId: string, paymentDate: string): Promise<Transaction> {
  const before = toUiTransaction(orgId, await fetchTransaction(orgId, txId))
  await updateTransaction(orgId, txId, { ...transactionToDraft(before), paymentDate })
  notifyRecurringChanged()
  return before
}

/** «Пропустити»: the plan as it was, for the undo. */
export async function skipPlanOccurrence(orgId: string, seriesId: string, occurrence: string): Promise<Transaction> {
  return toUiTransaction(orgId, await skipPlan(orgId, seriesId, occurrence))
}

/** The undo of «Позначити сплаченою» or «Перенести»: the operation written back as it was (the mark follows it). */
export async function undoPlanEdit(orgId: string, before: Transaction): Promise<void> {
  await revertTransaction(orgId, before)
  notifyRecurringChanged()
}

/** The undo of «Пропустити»: the plan re-created under its plan id from its `skipped` mark. */
export async function undoPlanSkip(orgId: string, before: Transaction): Promise<void> {
  await restoreTransaction(orgId, before)
  notifyRecurringChanged()
}
```

Створити `lib/hooks/useRecurringOverview.ts`:

```ts
'use client'

import { useCallback, useEffect, useState } from 'react'
import { onLedgerChanged } from '@/lib/api/ledger-events'
import { fetchRecurringOverview, onRecurringChanged } from '@/lib/api/recurring-client'
import type { RecurringOverview } from '@/lib/domain/recurring/types'

/** Several changes in a row (an undo of many) read the overview once. */
const REFRESH_DEBOUNCE_MS = 300

export interface UseRecurringOverview {
  overview: RecurringOverview | null
  /** The last read failed (the last good answer, if any, stays). */
  error: boolean
  refresh: () => void
}

/** The page «Планові платежі» (S11): read on open, on `refresh` and after any change in this browser (a plan, a series, a match). */
export function useRecurringOverview(orgId: string): UseRecurringOverview {
  const [round, setRound] = useState(0)
  const [state, setState] = useState<{ orgId: string; overview: RecurringOverview | null; error: boolean } | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    fetchRecurringOverview(orgId, ac.signal).then(
      (overview) => {
        if (!ac.signal.aborted) setState({ orgId, overview, error: false })
      },
      () => {
        if (!ac.signal.aborted) setState((prev) => ({ orgId, overview: prev?.orgId === orgId ? prev.overview : null, error: true }))
      },
    )
    return () => ac.abort()
  }, [orgId, round])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const bump = () => {
      clearTimeout(timer)
      timer = setTimeout(() => setRound((r) => r + 1), REFRESH_DEBOUNCE_MS)
    }
    const offRecurring = onRecurringChanged(bump)
    const offLedger = onLedgerChanged(bump)
    return () => {
      offRecurring()
      offLedger()
      clearTimeout(timer)
    }
  }, [orgId])

  const refresh = useCallback(() => setRound((r) => r + 1), [])
  const current = state !== null && state.orgId === orgId ? state : null
  return { overview: current?.overview ?? null, error: current?.error ?? false, refresh }
}
```

Створити `lib/hooks/usePlanMatches.ts`:

```ts
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchPlanMatches, onRecurringChanged } from '@/lib/api/recurring-client'
import { readPlanDismissed, writePlanDismissed } from '@/lib/domain/recurring/dismissed'
import { keyOfMatch } from '@/lib/domain/recurring/match'
import type { MatchOutcome, MatchSuggestions, PlanMatch } from '@/lib/domain/recurring/types'
import { withDismissed } from '@/lib/domain/transfers/dismissed'
import { browserLocalStorage } from '@/lib/shell/sidebar-store'

const REFRESH_DEBOUNCE_MS = 300

export interface UsePlanMatches {
  /** The server's pairs without the ones turned down in this browser. */
  pairs: PlanMatch[]
  truncated: boolean
  dismiss: (pairs: readonly PlanMatch[]) => void
  refresh: () => void
  /** The pairs that went through leave the list at once; the failed ones stay. */
  settle: (outcomes: readonly MatchOutcome[]) => void
}

/**
 * The plan ↔ bank pairs the journal suggests (S11), for `orgId` (null: nothing is read, e.g. a viewer). Read when the
 * journal opens, on `refresh` and after a change of planned payments in this browser, never after an ordinary edit.
 * A failed read shows nothing: the banner is only a hint.
 */
export function usePlanMatches(orgId: string | null): UsePlanMatches {
  const [round, setRound] = useState(0)
  const [loaded, setLoaded] = useState<{ orgId: string; result: MatchSuggestions } | null>(null)
  const [dismissed, setDismissed] = useState<{ orgId: string; keys: string[] } | null>(null)

  useEffect(() => {
    if (!orgId) return
    const ac = new AbortController()
    fetchPlanMatches(orgId, ac.signal).then(
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
    const off = onRecurringChanged(() => {
      clearTimeout(timer)
      timer = setTimeout(() => setRound((r) => r + 1), REFRESH_DEBOUNCE_MS)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [orgId])

  const keys = useMemo(
    () => (dismissed && dismissed.orgId === orgId ? dismissed.keys : orgId ? readPlanDismissed(browserLocalStorage(), orgId) : []),
    [orgId, dismissed],
  )
  const result = loaded && loaded.orgId === orgId ? loaded.result : null
  const pairs = useMemo(() => (result ? result.pairs.filter((p) => !keys.includes(keyOfMatch(p))) : []), [result, keys])

  const dismiss = useCallback(
    (gone: readonly PlanMatch[]) => {
      if (!orgId || gone.length === 0) return
      const next = withDismissed(readPlanDismissed(browserLocalStorage(), orgId), gone.map(keyOfMatch))
      writePlanDismissed(browserLocalStorage(), orgId, next)
      setDismissed({ orgId, keys: next })
    },
    [orgId],
  )
  const refresh = useCallback(() => setRound((r) => r + 1), [])
  const settle = useCallback(
    (outcomes: readonly MatchOutcome[]) => {
      const done = new Set(outcomes.flatMap((o) => (o.ok ? [o.planId] : [])))
      setLoaded((prev) => (prev && prev.orgId === orgId ? { ...prev, result: { ...prev.result, pairs: prev.result.pairs.filter((p) => !done.has(p.plan.id)) } } : prev))
    },
    [orgId],
  )

  return { pairs, truncated: result?.truncated ?? false, dismiss, refresh, settle }
}
```

Створити `lib/hooks/useSeriesName.ts`:

```ts
'use client'

import { useEffect, useState } from 'react'
import { fetchSeries } from '@/lib/api/recurring-client'

/**
 * The name of the series an operation belongs to (S11, the form's «з серії …»): a string; null when the series is gone or
 * cannot be read; undefined while loading or when the operation has no series.
 */
export function useSeriesName(orgId: string, seriesId: string | undefined): string | null | undefined {
  const [found, setFound] = useState<{ id: string; name: string | null } | null>(null)
  useEffect(() => {
    if (!seriesId) return
    const ac = new AbortController()
    fetchSeries(orgId, seriesId, ac.signal).then(
      (series) => {
        if (!ac.signal.aborted) setFound({ id: seriesId, name: series.name })
      },
      () => {
        if (!ac.signal.aborted) setFound({ id: seriesId, name: null })
      },
    )
    return () => ac.abort()
  }, [orgId, seriesId])
  if (!seriesId) return undefined
  return found !== null && found.id === seriesId ? found.name : undefined
}
```

- [ ] **Step 4: Merge the message keys**

Створити інструментом Write `tmp-i18n.cjs` у корені репозиторію:

```js
// Temporary (S11 plan, Task 11): merges the keys below into the three catalogs, keeping their format. Not committed.
const fs = require('fs')
const ADD = {
  uk: {
    shell: { modules: { recurring: 'Планові платежі' } },
    journal: {
      list: { overdue: 'Прострочено' },
      plans: {
        banner: 'Знайдено збігів із плановими платежами: {count}',
        bannerOpen: 'Переглянути',
        dialogTitle: 'Збіги з плановими платежами',
        dialogBody: 'Ці операції з банку схожі на планові платежі. Позначені пари буде пов’язано: планова операція зникне, а банківська отримає її категорію, контрагента, теги й коментар, якщо їх ще не має. Пари без позначки цей браузер більше не пропонуватиме.',
        pick: 'Пов’язати «{name}» ({planDate}) з операцією банку {bankDate}, {amount}',
        planLabel: 'План {date}',
        bankLabel: 'Банк {date}',
        estimated: 'орієнтовно',
        confirm: 'Підтвердити вибрані',
        later: 'Не зараз',
        truncated: 'Переглянуто лише частину операцій.',
        failedPair: 'Не вдалося: {reason}',
        done: 'Пов’язано з плановими: {count}.',
        partial: 'Не вдалося: {count} ({reason}).',
        undo: 'Скасувати',
        undoFailed: 'Не вдалося скасувати все',
        undone: 'Повернуто планових: {count}',
        unnamed: 'Плановий платіж',
      },
    },
    forms: {
      transaction: {
        seriesHint: 'Операція з серії «{name}». Зміна суми, дати чи інших полів відв’яже її від серії: зміни серії її більше не оновлюватимуть.',
        seriesHintManual: 'Операція з серії «{name}», змінена вручну: серія її більше не оновлює.',
        seriesGone: 'Операція з видаленої серії планових платежів.',
      },
    },
    recurring: {
      title: 'Планові платежі',
      loadError: 'Не вдалося завантажити планові платежі',
      truncated: 'Показано не всі планові операції.',
      strip: {
        overdue: 'Прострочено: {count}',
        overdueNone: 'Прострочених немає',
        soon: 'Найближчі 7 днів',
        income: 'Надходження',
        expense: 'Витрати',
      },
      series: {
        title: 'Серії',
        add: 'Додати серію',
        addPreset: 'Додати з пресету',
        empty: 'Ще немає планових платежів. Додайте оренду, підписку чи податок, щоб бачити їх наперед.',
        name: 'Назва',
        next: 'Наступна дата',
        amount: 'Сума',
        repeat: 'Повторення',
        state: 'Стан',
        noNext: 'немає',
        estimated: 'орієнтовно',
        active: 'Активна',
        paused: 'Призупинена',
        edit: 'Змінити',
        pause: 'Призупинити',
        resume: 'Відновити',
        delete: 'Видалити',
        actions: 'Дії з серією {name}',
      },
      repeat: {
        weekly: 'Щотижня, {weekday}',
        monthly: 'Щомісяця, {day}-го',
        everyNMonths: 'Кожні {interval} міс., {day}-го',
        yearly: 'Щороку, {date}',
      },
      presets: {
        zus: 'ZUS',
        pit4: 'PIT-4',
        vat7: 'VAT-7',
        hint: 'Сума орієнтовна, її вводите ви. Дата переноситься на наступний робочий день.',
      },
      planned: {
        title: 'Найближчі планові операції',
        overdueTitle: 'Прострочені',
        upcomingTitle: 'Наступні 31 день',
        empty: 'Найближчим часом нічого не заплановано.',
        planned: 'Заплановано',
        overdue: 'Прострочено',
        estimated: 'Орієнтовно',
        manual: 'Змінено вручну',
        markPaid: 'Позначити сплаченою',
        move: 'Перенести',
        skip: 'Пропустити',
        rowActions: 'Дії з операцією {name}, {amount}, {date}',
        paid: 'Позначено сплаченою',
        moved: 'Дату перенесено',
        skipped: 'Пропущено цей раз',
        undo: 'Скасувати',
        undoFailed: 'Не вдалося скасувати',
        failed: 'Не вдалося: {reason}',
      },
      move: {
        title: 'Перенести дату',
        body: 'Операція позначиться як змінена вручну: зміни серії її більше не оновлюватимуть.',
        date: 'Нова дата',
        confirm: 'Перенести',
        cancel: 'Скасувати',
      },
      editor: {
        titleNew: 'Нова серія',
        titleEdit: 'Змінити серію',
        titlePreset: 'Новий платіж {preset}',
        name: 'Назва',
        kind: 'Вид',
        income: 'Надходження',
        expense: 'Витрата',
        account: 'Рахунок',
        chooseAccount: 'Оберіть рахунок',
        amount: 'Сума',
        estimated: 'Сума орієнтовна',
        category: 'Категорія',
        noCategory: 'Без категорії',
        description: 'Коментар',
        frequency: 'Повторення',
        freq: { weekly: 'Щотижня', monthly: 'Щомісяця', everyNMonths: 'Кожні кілька місяців', yearly: 'Щороку' },
        interval: 'Кожні, місяців',
        dayOfMonth: 'День місяця',
        dayHint: 'У коротшому місяці буде останній день місяця.',
        weekday: 'День тижня',
        startDate: 'Початок',
        endDate: 'Кінець (необов’язково)',
        weekendRule: 'Якщо день вихідний або святковий',
        weekend: { none: 'Не переносити', next: 'Наступний робочий день', previous: 'Попередній робочий день' },
        datePlaceholder: 'ДД.ММ.РРРР',
        openCalendar: 'Відкрити календар',
        save: 'Зберегти',
        create: 'Створити',
        cancel: 'Скасувати',
        rewriteHint: 'Зміни оновлять майбутні неоплачені операції серії, крім змінених вручну.',
        created: 'Серію створено, запланованих операцій: {count}',
        saved: 'Серію змінено',
        errors: {
          name: 'Вкажіть назву (до 80 символів)',
          account: 'Оберіть рахунок',
          amount: 'Вкажіть суму більше нуля',
          dayOfMonth: 'День від 1 до 31',
          interval: 'Від 1 до 24 місяців',
          startDate: 'Вкажіть дату початку',
          endDate: 'Кінець не раніше початку',
          limit: 'Не більше 100 серій у компанії',
          save: 'Не вдалося зберегти серію',
        },
      },
      pause: {
        title: 'Призупинити серію',
        body: 'Нові операції не створюватимуться.',
        removeFuture: 'Видалити майбутні неоплачені операції',
        confirm: 'Призупинити',
        done: 'Серію призупинено',
        resumed: 'Серію відновлено',
      },
      remove: {
        title: 'Видалити серію «{name}»?',
        body: 'Оплачені й минулі операції лишаться в журналі.',
        future: 'Видалити й майбутні неоплачені операції',
        confirm: 'Видалити',
        done: 'Серію видалено',
      },
      cancel: 'Скасувати',
    },
  },
  pl: {
    shell: { modules: { recurring: 'Płatności planowane' } },
    journal: {
      list: { overdue: 'Zaległe' },
      plans: {
        banner: 'Znaleziono dopasowania do płatności planowanych: {count}',
        bannerOpen: 'Przejrzyj',
        dialogTitle: 'Dopasowania do płatności planowanych',
        dialogBody: 'Te operacje z banku wyglądają na płatności planowane. Zaznaczone pary zostaną powiązane: operacja planowana zniknie, a bankowa otrzyma jej kategorię, kontrahenta, tagi i komentarz, jeśli ich jeszcze nie ma. Pary bez zaznaczenia nie będą już proponowane w tej przeglądarce.',
        pick: 'Powiąż „{name}” ({planDate}) z operacją banku {bankDate}, {amount}',
        planLabel: 'Plan {date}',
        bankLabel: 'Bank {date}',
        estimated: 'szacunkowo',
        confirm: 'Potwierdź wybrane',
        later: 'Nie teraz',
        truncated: 'Przejrzano tylko część operacji.',
        failedPair: 'Nie udało się: {reason}',
        done: 'Powiązano z planowanymi: {count}.',
        partial: 'Nie udało się: {count} ({reason}).',
        undo: 'Cofnij',
        undoFailed: 'Nie udało się cofnąć wszystkiego',
        undone: 'Przywrócono planowanych: {count}',
        unnamed: 'Płatność planowana',
      },
    },
    forms: {
      transaction: {
        seriesHint: 'Operacja z serii „{name}”. Zmiana kwoty, daty lub innych pól odłączy ją od serii: zmiany serii nie będą jej już aktualizować.',
        seriesHintManual: 'Operacja z serii „{name}”, zmieniona ręcznie: seria jej już nie aktualizuje.',
        seriesGone: 'Operacja z usuniętej serii płatności planowanych.',
      },
    },
    recurring: {
      title: 'Płatności planowane',
      loadError: 'Nie udało się wczytać płatności planowanych',
      truncated: 'Nie pokazano wszystkich operacji planowanych.',
      strip: {
        overdue: 'Zaległe: {count}',
        overdueNone: 'Brak zaległych',
        soon: 'Najbliższe 7 dni',
        income: 'Wpływy',
        expense: 'Wydatki',
      },
      series: {
        title: 'Serie',
        add: 'Dodaj serię',
        addPreset: 'Dodaj z szablonu',
        empty: 'Nie ma jeszcze płatności planowanych. Dodaj czynsz, subskrypcję lub podatek, aby widzieć je z wyprzedzeniem.',
        name: 'Nazwa',
        next: 'Następna data',
        amount: 'Kwota',
        repeat: 'Powtarzanie',
        state: 'Stan',
        noNext: 'brak',
        estimated: 'szacunkowo',
        active: 'Aktywna',
        paused: 'Wstrzymana',
        edit: 'Edytuj',
        pause: 'Wstrzymaj',
        resume: 'Wznów',
        delete: 'Usuń',
        actions: 'Działania dla serii {name}',
      },
      repeat: {
        weekly: 'Co tydzień, {weekday}',
        monthly: 'Co miesiąc, {day}.',
        everyNMonths: 'Co {interval} mies., {day}.',
        yearly: 'Co roku, {date}',
      },
      presets: {
        zus: 'ZUS',
        pit4: 'PIT-4',
        vat7: 'VAT-7',
        hint: 'Kwota jest szacunkowa, wpisujesz ją sam. Termin przesuwa się na następny dzień roboczy.',
      },
      planned: {
        title: 'Najbliższe operacje planowane',
        overdueTitle: 'Zaległe',
        upcomingTitle: 'Następne 31 dni',
        empty: 'W najbliższym czasie nic nie zaplanowano.',
        planned: 'Zaplanowano',
        overdue: 'Zaległe',
        estimated: 'Szacunkowo',
        manual: 'Zmieniono ręcznie',
        markPaid: 'Oznacz jako zapłaconą',
        move: 'Przesuń',
        skip: 'Pomiń',
        rowActions: 'Działania dla operacji {name}, {amount}, {date}',
        paid: 'Oznaczono jako zapłaconą',
        moved: 'Termin przesunięty',
        skipped: 'Pominięto tym razem',
        undo: 'Cofnij',
        undoFailed: 'Nie udało się cofnąć',
        failed: 'Nie udało się: {reason}',
      },
      move: {
        title: 'Przesuń termin',
        body: 'Operacja zostanie oznaczona jako zmieniona ręcznie: zmiany serii nie będą jej już aktualizować.',
        date: 'Nowa data',
        confirm: 'Przesuń',
        cancel: 'Anuluj',
      },
      editor: {
        titleNew: 'Nowa seria',
        titleEdit: 'Edytuj serię',
        titlePreset: 'Nowa płatność {preset}',
        name: 'Nazwa',
        kind: 'Rodzaj',
        income: 'Wpływ',
        expense: 'Wydatek',
        account: 'Konto',
        chooseAccount: 'Wybierz konto',
        amount: 'Kwota',
        estimated: 'Kwota szacunkowa',
        category: 'Kategoria',
        noCategory: 'Bez kategorii',
        description: 'Komentarz',
        frequency: 'Powtarzanie',
        freq: { weekly: 'Co tydzień', monthly: 'Co miesiąc', everyNMonths: 'Co kilka miesięcy', yearly: 'Co roku' },
        interval: 'Co ile miesięcy',
        dayOfMonth: 'Dzień miesiąca',
        dayHint: 'W krótszym miesiącu będzie to ostatni dzień miesiąca.',
        weekday: 'Dzień tygodnia',
        startDate: 'Początek',
        endDate: 'Koniec (opcjonalnie)',
        weekendRule: 'Jeśli dzień jest wolny od pracy',
        weekend: { none: 'Nie przesuwaj', next: 'Następny dzień roboczy', previous: 'Poprzedni dzień roboczy' },
        datePlaceholder: 'DD.MM.RRRR',
        openCalendar: 'Otwórz kalendarz',
        save: 'Zapisz',
        create: 'Utwórz',
        cancel: 'Anuluj',
        rewriteHint: 'Zmiany zaktualizują przyszłe niezapłacone operacje serii, poza zmienionymi ręcznie.',
        created: 'Seria utworzona, zaplanowanych operacji: {count}',
        saved: 'Seria zmieniona',
        errors: {
          name: 'Podaj nazwę (do 80 znaków)',
          account: 'Wybierz konto',
          amount: 'Podaj kwotę większą od zera',
          dayOfMonth: 'Dzień od 1 do 31',
          interval: 'Od 1 do 24 miesięcy',
          startDate: 'Podaj datę początku',
          endDate: 'Koniec nie wcześniej niż początek',
          limit: 'Najwyżej 100 serii w firmie',
          save: 'Nie udało się zapisać serii',
        },
      },
      pause: {
        title: 'Wstrzymać serię',
        body: 'Nowe operacje nie będą tworzone.',
        removeFuture: 'Usuń przyszłe niezapłacone operacje',
        confirm: 'Wstrzymaj',
        done: 'Seria wstrzymana',
        resumed: 'Seria wznowiona',
      },
      remove: {
        title: 'Usunąć serię „{name}”?',
        body: 'Zapłacone i minione operacje zostaną w dzienniku.',
        future: 'Usuń też przyszłe niezapłacone operacje',
        confirm: 'Usuń',
        done: 'Seria usunięta',
      },
      cancel: 'Anuluj',
    },
  },
  en: {
    shell: { modules: { recurring: 'Planned payments' } },
    journal: {
      list: { overdue: 'Overdue' },
      plans: {
        banner: 'Matches with planned payments found: {count}',
        bannerOpen: 'Review',
        dialogTitle: 'Matches with planned payments',
        dialogBody: 'These bank operations look like planned payments. The ticked pairs will be linked: the planned operation goes, and the bank one takes its category, counterparty, tags and comment where it has none. Unticked pairs are not offered again in this browser.',
        pick: 'Link “{name}” ({planDate}) to the bank operation of {bankDate}, {amount}',
        planLabel: 'Plan {date}',
        bankLabel: 'Bank {date}',
        estimated: 'estimated',
        confirm: 'Confirm selected',
        later: 'Not now',
        truncated: 'Only part of the operations was looked at.',
        failedPair: 'Failed: {reason}',
        done: 'Linked to plans: {count}.',
        partial: 'Failed: {count} ({reason}).',
        undo: 'Undo',
        undoFailed: 'Could not undo everything',
        undone: 'Plans brought back: {count}',
        unnamed: 'Planned payment',
      },
    },
    forms: {
      transaction: {
        seriesHint: 'From the series “{name}”. Changing the amount, the date or another field detaches it: changes of the series will no longer update it.',
        seriesHintManual: 'From the series “{name}”, changed by hand: the series no longer updates it.',
        seriesGone: 'From a deleted series of planned payments.',
      },
    },
    recurring: {
      title: 'Planned payments',
      loadError: 'Could not load the planned payments',
      truncated: 'Not every planned operation is shown.',
      strip: {
        overdue: 'Overdue: {count}',
        overdueNone: 'Nothing overdue',
        soon: 'Next 7 days',
        income: 'Incoming',
        expense: 'Outgoing',
      },
      series: {
        title: 'Series',
        add: 'Add a series',
        addPreset: 'Add from a preset',
        empty: 'No planned payments yet. Add rent, a subscription or a tax to see them ahead.',
        name: 'Name',
        next: 'Next date',
        amount: 'Amount',
        repeat: 'Repeats',
        state: 'State',
        noNext: 'none',
        estimated: 'estimated',
        active: 'Active',
        paused: 'Paused',
        edit: 'Edit',
        pause: 'Pause',
        resume: 'Resume',
        delete: 'Delete',
        actions: 'Actions for {name}',
      },
      repeat: {
        weekly: 'Weekly, {weekday}',
        monthly: 'Monthly, on day {day}',
        everyNMonths: 'Every {interval} months, on day {day}',
        yearly: 'Yearly, {date}',
      },
      presets: {
        zus: 'ZUS',
        pit4: 'PIT-4',
        vat7: 'VAT-7',
        hint: 'The amount is an estimate you enter. The date moves to the next business day.',
      },
      planned: {
        title: 'Upcoming planned operations',
        overdueTitle: 'Overdue',
        upcomingTitle: 'Next 31 days',
        empty: 'Nothing planned soon.',
        planned: 'Planned',
        overdue: 'Overdue',
        estimated: 'Estimated',
        manual: 'Changed by hand',
        markPaid: 'Mark as paid',
        move: 'Move',
        skip: 'Skip',
        rowActions: 'Actions for {name}, {amount}, {date}',
        paid: 'Marked as paid',
        moved: 'Date moved',
        skipped: 'Skipped this time',
        undo: 'Undo',
        undoFailed: 'Could not undo',
        failed: 'Failed: {reason}',
      },
      move: {
        title: 'Move the date',
        body: 'The operation is marked as changed by hand: changes of the series no longer update it.',
        date: 'New date',
        confirm: 'Move',
        cancel: 'Cancel',
      },
      editor: {
        titleNew: 'New series',
        titleEdit: 'Edit the series',
        titlePreset: 'New {preset} payment',
        name: 'Name',
        kind: 'Kind',
        income: 'Income',
        expense: 'Expense',
        account: 'Account',
        chooseAccount: 'Choose an account',
        amount: 'Amount',
        estimated: 'The amount is an estimate',
        category: 'Category',
        noCategory: 'No category',
        description: 'Comment',
        frequency: 'Repeats',
        freq: { weekly: 'Weekly', monthly: 'Monthly', everyNMonths: 'Every few months', yearly: 'Yearly' },
        interval: 'Every N months',
        dayOfMonth: 'Day of the month',
        dayHint: 'A shorter month takes its last day.',
        weekday: 'Weekday',
        startDate: 'Starts',
        endDate: 'Ends (optional)',
        weekendRule: 'If the day is a weekend or a holiday',
        weekend: { none: 'Keep the day', next: 'Next business day', previous: 'Previous business day' },
        datePlaceholder: 'DD.MM.YYYY',
        openCalendar: 'Open the calendar',
        save: 'Save',
        create: 'Create',
        cancel: 'Cancel',
        rewriteHint: 'The change updates the future unpaid operations of the series, except those changed by hand.',
        created: 'Series created, planned operations: {count}',
        saved: 'Series updated',
        errors: {
          name: 'Enter a name (up to 80 characters)',
          account: 'Choose an account',
          amount: 'Enter an amount above zero',
          dayOfMonth: 'A day from 1 to 31',
          interval: 'From 1 to 24 months',
          startDate: 'Enter the start date',
          endDate: 'The end is not before the start',
          limit: 'At most 100 series per company',
          save: 'Could not save the series',
        },
      },
      pause: {
        title: 'Pause the series',
        body: 'No new operations will be created.',
        removeFuture: 'Delete the future unpaid operations',
        confirm: 'Pause',
        done: 'Series paused',
        resumed: 'Series resumed',
      },
      remove: {
        title: 'Delete the series “{name}”?',
        body: 'Paid and past operations stay in the journal.',
        future: 'Also delete the future unpaid operations',
        confirm: 'Delete',
        done: 'Series deleted',
      },
      cancel: 'Cancel',
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
Expected: три каталоги змінено однаково: новий ключ `shell.modules.recurring`, `journal.list.overdue`, блок `journal.plans` (18 ключів), три ключі `forms.transaction.series*`, новий верхній блок `recurring` у кінці файлу.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/api/recurring-client.test.ts tests/unit/i18n tests/unit/shell && npm run typecheck && npm run lint`
Expected: PASS (клієнт; `catalogs` бачить однакові ключі й імена аргументів ICU у трьох каталогах; `no-hardcoded-text` без нового кириличного тексту в `lib`; `labels.test.ts` ще не бачить вкладки `recurring`, вона з'являється в Task 12), `tsc` чисто, `lint` 0 errors / 10 warnings (хуки без синхронного `setState` в ефектах).

- [ ] **Step 6: Commit**

```bash
cd /f/AI/finflow && git add lib/api/recurring-client.ts lib/api/recurring-actions.ts lib/hooks/useRecurringOverview.ts lib/hooks/usePlanMatches.ts lib/hooks/useSeriesName.ts tests/unit/api/recurring-client.test.ts messages/uk.json messages/pl.json messages/en.json && git commit -m "feat(recurring): browser client, plan actions, hooks and uk/pl/en messages

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Сторінка «Планові платежі»: вкладка меню, смуга, серії, найближчі операції з діями

**Files:**
- Modify: `lib/shell/modules.ts`, `lib/domain/recurring/rows.ts`, `tests/unit/shell/modules.test.ts`
- Create: `app/(app)/[orgSlug]/recurring/page.tsx`, `components/recurring/labels.ts`, `components/recurring/RecurringStrip.tsx`, `components/recurring/SeriesList.tsx`, `components/recurring/PlannedList.tsx`, `components/recurring/MoveDateDialog.tsx`, `tests/unit/domain/recurring/rows.test.ts`

Контракт сторінки: `'use client'`; дані з `useRecurringOverview(orgId)`; `h1` «Планові платежі»; смуга `recurring-strip` (`recurring-overdue` з «Прострочено: N» або «Прострочених немає», суми `recurring-soon-income` / `recurring-soon-expense` за валютами); секція «Серії» (`series-row` з назвою, повторенням і рахунком, `series-next`, сумою з «орієнтовно», `series-state`; порожній список `series-empty`); секція «Найближчі планові операції» з групами «Прострочені» і «Наступні 31 день» (`planned-row`, `data-overdue`, чипи `plan-overdue` / `plan-planned`, `plan-estimated`, «Змінено вручну»), дії лише з `can('data.write')`: «Позначити сплаченою», «Перенести» (діалог з `DateField` `#move-date`), «Пропустити» (лише для операції серії); кожна дія показує тост зі «Скасувати». Рядки обох списків це картки (`li` з `flex-col` на телефоні, `sm:flex-row` ширше), тож на 390 px немає бічного прокручування. Редагування серій (кнопки й діалоги) додає Task 13.

- [ ] **Step 1: Write the failing tests**

Створити `tests/unit/domain/recurring/rows.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isOverdue, parsePlannedRow } from '@/lib/domain/recurring/rows'

describe('planned rows (S11)', () => {
  it('a planned operation of a day before today is overdue; today and actual ones are not', () => {
    expect(isOverdue({ status: 'planned', paymentDate: '2026-11-09' }, '2026-11-10')).toBe(true)
    expect(isOverdue({ status: 'planned', paymentDate: '2026-11-10' }, '2026-11-10')).toBe(false)
    expect(isOverdue({ status: 'actual', paymentDate: '2026-11-01' }, '2026-11-10')).toBe(false)
  })

  it('reads a selected planned operation, with its series link and flags', () => {
    const data = { schemaVersion: 2, type: 'expense', status: 'planned', accountId: 'mil', amountMinor: 150_000, currency: 'PLN', paymentDate: '2026-11-16', seriesId: 'ser1', occurrence: '2026-11-15', estimated: true }
    expect(parsePlannedRow('pl_ser1_2026-11-15', data)).toEqual({
      id: 'pl_ser1_2026-11-15', type: 'expense', accountId: 'mil', amountMinor: 150_000, currency: 'PLN', paymentDate: '2026-11-16',
      seriesId: 'ser1', occurrence: '2026-11-15', estimated: true, manual: false,
    })
    expect(parsePlannedRow('x', { ...data, status: 'actual' })).toBeNull()
    expect(parsePlannedRow('x', { ...data, amountMinor: 0 })).toBeNull()
  })
})
```

`tests/unit/shell/modules.test.ts`:

1. Рядки

```ts
    expect(MODULE_TABS.map((t) => [t.key, t.href('org1')])).toEqual([
      ['transactions', '/org1/transactions'],
      ['analytics', '/org1/analytics/cashflow'],
    ])
```

замінити на

```ts
    expect(MODULE_TABS.map((t) => [t.key, t.href('org1')])).toEqual([
      ['transactions', '/org1/transactions'],
      ['recurring', '/org1/recurring'],
      ['analytics', '/org1/analytics/cashflow'],
    ])
```

2. Рядок `    ['/org1/transactions', 'transactions'],` замінити на:

```ts
    ['/org1/transactions', 'transactions'],
    ['/org1/recurring', 'recurring'],
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/recurring/rows.test.ts tests/unit/shell`
Expected: FAIL (`isOverdue` не існує; вкладки `recurring` немає).

- [ ] **Step 3: Implement**

`lib/domain/recurring/rows.ts`: рядок `import { TX_TYPES, type TxType } from '@/lib/domain/ledger/types'` замінити на:

```ts
import { TX_TYPES, type TxStatus, type TxType } from '@/lib/domain/ledger/types'
```

і в кінець файлу додати:

```ts
/** «Прострочено» (S11): a planned operation whose payment day is before today. Balances and reports still leave it out. */
export function isOverdue(op: { status: TxStatus; paymentDate: string }, today: string): boolean {
  return op.status === 'planned' && op.paymentDate < today
}
```

`lib/shell/modules.ts`:

1. Рядок `export type ModuleKey = 'transactions' | 'analytics'` замінити на:

```ts
export type ModuleKey = 'transactions' | 'recurring' | 'analytics'
```

2. Рядок `  { key: 'transactions', segment: 'transactions', href: (orgId) => `/${orgId}/transactions` },` замінити на:

```ts
  { key: 'transactions', segment: 'transactions', href: (orgId) => `/${orgId}/transactions` },
  { key: 'recurring', segment: 'recurring', href: (orgId) => `/${orgId}/recurring` },
```

Створити `components/recurring/labels.ts`:

```ts
import type { Schedule } from '@/lib/domain/recurring/types'
import type { Locale } from '@/lib/i18n/config'
import { formatDate, formatWeekday } from '@/lib/i18n/format'

/** A weekday 1 (Monday) ... 7 as a Date: 2026-11-16 is a Monday. */
export function weekdayDate(weekday: number): Date {
  return new Date(Date.UTC(2026, 10, 15 + weekday))
}

/** The message `recurring.repeat.<key>` and its values that describe a schedule («Щомісяця, 15-го»). */
export function repeatOf(s: Schedule, locale: Locale): { key: 'weekly' | 'monthly' | 'everyNMonths' | 'yearly'; values: Record<string, string | number> } {
  switch (s.frequency) {
    case 'weekly':
      return { key: 'weekly', values: { weekday: formatWeekday(weekdayDate(s.weekday ?? 1), locale, 'long') } }
    case 'monthly':
      return { key: 'monthly', values: { day: s.dayOfMonth ?? 1 } }
    case 'everyNMonths':
      return { key: 'everyNMonths', values: { interval: s.interval, day: s.dayOfMonth ?? 1 } }
    case 'yearly':
      // 2000 is a leap year, so 29 February has a date to show.
      return { key: 'yearly', values: { date: formatDate(new Date(Date.UTC(2000, Number(s.startDate.slice(5, 7)) - 1, s.dayOfMonth ?? 1)), locale, { day: 'numeric', month: 'long' }) } }
  }
}
```

Створити `components/recurring/RecurringStrip.tsx`:

```tsx
'use client'

import { useTranslations } from 'next-intl'
import { fromMinor } from '@/lib/domain/ledger/money'
import type { CurrencyTotal, RecurringOverview } from '@/lib/domain/recurring/types'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { cn } from '@/lib/utils'

/** «Прострочено: N» and «Найближчі 7 днів» (income and expense apart, per currency) over the page (S11). */
export function RecurringStrip({ overview }: { overview: RecurringOverview }) {
  const t = useTranslations('recurring.strip')
  const { money } = useFormatters()
  const sums = (list: CurrencyTotal[]): string => (list.length === 0 ? '—' : list.map((s) => money(fromMinor(s.amountMinor), s.currency)).join(' · '))
  const overdue = overview.overdueCount > 0
  return (
    <section data-testid="recurring-strip" className="grid gap-3 sm:grid-cols-3">
      <div className={cn('rounded-panel border border-line px-4 py-3', overdue ? 'bg-expense-soft text-expense' : 'bg-surface text-ink-muted')}>
        <p data-testid="recurring-overdue" className="text-sm font-semibold">
          {overdue ? t('overdue', { count: overview.overdueCount }) : t('overdueNone')}
        </p>
      </div>
      <div className="rounded-panel border border-line bg-surface px-4 py-3 sm:col-span-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{t('soon')}</p>
        <dl className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-2">
            <dt className="text-ink-muted">{t('income')}</dt>
            <dd data-testid="recurring-soon-income" className="text-right font-semibold tabular-nums text-income">{sums(overview.soon.income)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-ink-muted">{t('expense')}</dt>
            <dd data-testid="recurring-soon-expense" className="text-right font-semibold tabular-nums text-expense">{sums(overview.soon.expense)}</dd>
          </div>
        </dl>
      </div>
    </section>
  )
}
```

Створити `components/recurring/SeriesList.tsx`:

```tsx
'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { fromMinor } from '@/lib/domain/ledger/money'
import type { SeriesRow } from '@/lib/domain/recurring/types'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { formatDayShortUtc } from '@/lib/utils/journal'
import type { Account } from '@/types'
import { repeatOf } from './labels'

interface Props {
  rows: SeriesRow[]
  accounts: Account[]
  /** The actions of one series (Task 13 passes them for the people who may write). */
  actions?: (row: SeriesRow) => ReactNode
}

/** The series of the company (S11): name, how it repeats and on which account, the next date, the amount, the state. */
export function SeriesList({ rows, accounts, actions }: Props) {
  const t = useTranslations('recurring')
  const { locale, money } = useFormatters()
  if (rows.length === 0) {
    return (
      <p data-testid="series-empty" className="rounded-panel border border-dashed border-line px-4 py-6 text-sm text-ink-muted">
        {t('series.empty')}
      </p>
    )
  }
  return (
    <ul className="divide-y divide-line rounded-panel border border-line bg-surface">
      {rows.map((s) => {
        const repeat = repeatOf(s, locale)
        const account = accounts.find((a) => a.id === s.accountId)?.name ?? '—'
        return (
          <li key={s.id} data-testid="series-row" className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-ink">{s.name}</p>
              <p className="truncate text-xs text-ink-muted">{`${t(`repeat.${repeat.key}`, repeat.values)} · ${account}`}</p>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm sm:justify-end">
              <span data-testid="series-next" className="tabular-nums text-ink-muted">
                {s.next === null ? t('series.noNext') : formatDayShortUtc(new Date(`${s.next}T00:00:00Z`), locale)}
              </span>
              <span className="font-semibold tabular-nums text-ink">
                {money(fromMinor(s.amountMinor), s.currency)}
                {s.estimated && <span className="ml-1 text-xs font-normal text-ink-muted">{t('series.estimated')}</span>}
              </span>
              <Badge variant="chip" data-testid="series-state">
                {s.status === 'active' ? t('series.active') : t('series.paused')}
              </Badge>
              {actions?.(s)}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
```

Створити `components/recurring/PlannedList.tsx`:

```tsx
'use client'

import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { fromMinor } from '@/lib/domain/ledger/money'
import { isOverdue } from '@/lib/domain/recurring/rows'
import type { PlannedRow } from '@/lib/domain/recurring/types'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { cn } from '@/lib/utils'
import { formatDayShortUtc } from '@/lib/utils/journal'
import type { Account } from '@/types'

interface Props {
  overdue: PlannedRow[]
  upcoming: PlannedRow[]
  /** Series names by id. */
  names: ReadonlyMap<string, string>
  accounts: Account[]
  canEdit: boolean
  today: string
  /** The row an action is running for: every action waits meanwhile. */
  busyId: string | null
  onMarkPaid: (row: PlannedRow) => void
  onMove: (row: PlannedRow) => void
  onSkip: (row: PlannedRow) => void
}

/** The overdue and the next 31 days of planned operations (S11), as cards, with «Позначити сплаченою», «Перенести», «Пропустити». */
export function PlannedList(props: Props) {
  const t = useTranslations('recurring')
  const tPlans = useTranslations('journal.plans')
  const { locale, money } = useFormatters()
  if (props.overdue.length === 0 && props.upcoming.length === 0) {
    return <p className="rounded-panel border border-dashed border-line px-4 py-6 text-sm text-ink-muted">{t('planned.empty')}</p>
  }

  const card = (row: PlannedRow) => {
    const name = (row.seriesId !== undefined ? props.names.get(row.seriesId) : undefined) ?? row.description ?? tPlans('unnamed')
    const date = formatDayShortUtc(new Date(`${row.paymentDate}T00:00:00Z`), locale)
    const amount = money(fromMinor(row.amountMinor), row.currency)
    const account = props.accounts.find((a) => a.id === row.accountId)?.name ?? '—'
    const overdue = isOverdue({ status: 'planned', paymentDate: row.paymentDate }, props.today)
    const busy = props.busyId !== null
    return (
      <li key={row.id} data-testid="planned-row" data-overdue={overdue || undefined} className="flex flex-col gap-2 rounded-panel border border-line bg-surface px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">{name}</p>
          <p className="truncate text-xs tabular-nums text-ink-muted">{`${date} · ${account}`}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge variant="chip" data-testid={overdue ? 'plan-overdue' : 'plan-planned'} className={overdue ? 'bg-expense-soft text-expense' : undefined}>
              {overdue ? t('planned.overdue') : t('planned.planned')}
            </Badge>
            {row.estimated && <Badge variant="chip" data-testid="plan-estimated">{t('planned.estimated')}</Badge>}
            {row.manual && <Badge variant="chip">{t('planned.manual')}</Badge>}
          </div>
        </div>
        <span className={cn('font-semibold tabular-nums sm:w-32 sm:text-right', row.type === 'income' ? 'text-income' : 'text-ink')}>{amount}</span>
        {props.canEdit && (
          <div role="group" aria-label={t('planned.rowActions', { name, amount, date })} className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="soft" disabled={busy} onClick={() => props.onMarkPaid(row)}>
              {t('planned.markPaid')}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => props.onMove(row)}>
              {t('planned.move')}
            </Button>
            {row.seriesId !== undefined && row.occurrence !== undefined && (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => props.onSkip(row)}>
                {t('planned.skip')}
              </Button>
            )}
          </div>
        )}
      </li>
    )
  }

  const group = (title: string, rows: PlannedRow[]) =>
    rows.length === 0 ? null : (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{title}</h3>
        <ul className="space-y-2">{rows.map(card)}</ul>
      </div>
    )

  return (
    <div className="space-y-4">
      {group(t('planned.overdueTitle'), props.overdue)}
      {group(t('planned.upcomingTitle'), props.upcoming)}
    </div>
  )
}
```

Створити `components/recurring/MoveDateDialog.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { DateField } from '@/components/ui/date-field'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import type { PlannedRow } from '@/lib/domain/recurring/types'

/** «Перенести»: a new payment day for one planned operation (it becomes «змінено вручну»). */
export function MoveDateDialog({ row, onConfirm, onClose }: { row: PlannedRow; onConfirm: (day: string) => void; onClose: () => void }) {
  const t = useTranslations('recurring')
  const [day, setDay] = useState(row.paymentDate)
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('move.title')}</DialogTitle>
          <DialogDescription>{t('move.body')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="move-date">{t('move.date')}</Label>
          <DateField id="move-date" value={day} onChange={setDay} placeholder={t('editor.datePlaceholder')} calendarLabel={t('editor.openCalendar')} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('move.cancel')}
          </Button>
          <Button type="button" disabled={day === '' || day === row.paymentDate} onClick={() => onConfirm(day)}>
            {t('move.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

Створити `app/(app)/[orgSlug]/recurring/page.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { MoveDateDialog } from '@/components/recurring/MoveDateDialog'
import { PlannedList } from '@/components/recurring/PlannedList'
import { RecurringStrip } from '@/components/recurring/RecurringStrip'
import { SeriesList } from '@/components/recurring/SeriesList'
import { LedgerApiError } from '@/lib/api/ledger-client'
import { markPlanPaid, movePlan, skipPlanOccurrence, undoPlanEdit, undoPlanSkip } from '@/lib/api/recurring-actions'
import type { PlannedRow } from '@/lib/domain/recurring/types'
import { useRecurringOverview } from '@/lib/hooks/useRecurringOverview'
import { useShell } from '@/lib/hooks/useShell'
import { PAGE_CONTAINER } from '@/lib/ui/layout'
import { undoToast } from '@/lib/ui/undo-toast'
import { cn } from '@/lib/utils'
import { todayDay } from '@/lib/utils/today'
import type { Transaction } from '@/types'

// «Планові платежі» (S11): overdue and the next 7 days, the series, the upcoming planned operations with their actions.
export default function RecurringPage() {
  const t = useTranslations('recurring')
  const tBulk = useTranslations('journal.bulk')
  const { orgId, accounts, can } = useShell()
  const canEdit = can('data.write')
  const { overview, error } = useRecurringOverview(orgId)
  const [moving, setMoving] = useState<PlannedRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const today = todayDay()
  const names = useMemo(() => new Map((overview?.series ?? []).map((s) => [s.id, s.name])), [overview])

  const errorText = (e: unknown): string => {
    const key = `errors.${e instanceof LedgerApiError ? e.code : 'unknown'}` as 'errors.unknown'
    return tBulk.has(key) ? tBulk(key) : tBulk('errors.unknown')
  }

  // One action at a time; its toast offers «Скасувати» (the edit written back, or the skipped plan re-created).
  const act = async (row: PlannedRow, run: () => Promise<Transaction>, message: string, undo: (before: Transaction) => Promise<void>) => {
    if (busyId !== null) return
    setBusyId(row.id)
    try {
      const before = await run()
      undoToast({ message, actionLabel: t('planned.undo'), failureMessage: t('planned.undoFailed'), id: `plan-${row.id}`, undo: () => undo(before) })
    } catch (e) {
      toast.error(t('planned.failed', { reason: errorText(e) }))
    } finally {
      setBusyId(null)
    }
  }
  const markPaid = (row: PlannedRow) => void act(row, () => markPlanPaid(orgId, row.id, today), t('planned.paid'), (before) => undoPlanEdit(orgId, before))
  const skip = (row: PlannedRow) => {
    const { seriesId, occurrence } = row
    if (seriesId === undefined || occurrence === undefined) return
    void act(row, () => skipPlanOccurrence(orgId, seriesId, occurrence), t('planned.skipped'), (before) => undoPlanSkip(orgId, before))
  }
  const move = (day: string) => {
    const row = moving
    setMoving(null)
    if (row !== null) void act(row, () => movePlan(orgId, row.id, day), t('planned.moved'), (before) => undoPlanEdit(orgId, before))
  }

  return (
    <div className={cn(PAGE_CONTAINER, 'space-y-6')}>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 flex-1 font-display text-2xl font-semibold text-ink">{t('title')}</h1>
      </div>
      {error && overview === null && (
        <p role="alert" className="text-sm text-expense">
          {t('loadError')}
        </p>
      )}
      {overview !== null && (
        <>
          <RecurringStrip overview={overview} />
          <section aria-labelledby="series-title" className="space-y-3">
            <h2 id="series-title" className="text-lg font-semibold text-ink">
              {t('series.title')}
            </h2>
            <SeriesList rows={overview.series} accounts={accounts} />
          </section>
          <section aria-labelledby="planned-title" className="space-y-3">
            <h2 id="planned-title" className="text-lg font-semibold text-ink">
              {t('planned.title')}
            </h2>
            <PlannedList
              overdue={overview.overdue}
              upcoming={overview.upcoming}
              names={names}
              accounts={accounts}
              canEdit={canEdit}
              today={today}
              busyId={busyId}
              onMarkPaid={markPaid}
              onMove={setMoving}
              onSkip={skip}
            />
            {overview.truncated && <p className="text-sm text-ink-muted">{t('truncated')}</p>}
          </section>
        </>
      )}
      {moving !== null && <MoveDateDialog row={moving} onConfirm={move} onClose={() => setMoving(null)} />}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests and the build**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/recurring tests/unit/shell tests/unit/i18n && npm run typecheck && npm run lint && npm run build`
Expected: PASS (вкладки, `labels.test.ts` бачить `shell.modules.recurring`, `no-hardcoded-text` без кирилиці в нових компонентах); `tsc` чисто; `lint` 0 errors / 10 warnings; збірка успішна, сторінка `/[orgSlug]/recurring` у списку.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add lib/shell/modules.ts lib/domain/recurring/rows.ts tests/unit/shell/modules.test.ts tests/unit/domain/recurring/rows.test.ts "app/(app)/[orgSlug]/recurring/page.tsx" components/recurring/labels.ts components/recurring/RecurringStrip.tsx components/recurring/SeriesList.tsx components/recurring/PlannedList.tsx components/recurring/MoveDateDialog.tsx && git commit -m "feat(recurring): the planned payments page with overdue, the next 7 days and plan actions

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Редактор серії, пресети ZUS/PIT-4/VAT-7, призупинення й видалення

**Files:**
- Create: `lib/domain/recurring/editor.ts`, `tests/unit/domain/recurring/editor.test.ts`, `components/recurring/SeriesEditor.tsx`, `components/recurring/PresetMenu.tsx`, `components/recurring/PauseSeriesDialog.tsx`, `components/recurring/DeleteSeriesDialog.tsx`
- Modify: `app/(app)/[orgSlug]/recurring/page.tsx`

- [ ] **Step 1: Write the failing test**

Створити `tests/unit/domain/recurring/editor.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { editorToBody, editorToPatch, initialEditorState, validateEditor, type EditorState } from '@/lib/domain/recurring/editor'
import { parseSeriesInput, seriesFromInput } from '@/lib/domain/recurring/input'

const base = { today: '2026-11-10', defaultAccountId: 'mil', formatAmount: (n: number) => String(n).replace('.', ',') }

describe('the series editor (S11)', () => {
  it('a preset starts as an estimated expense to ZUS on the 15th, moved to the next business day', () => {
    expect(initialEditorState({ ...base, preset: 'zus', presetName: 'ZUS' })).toMatchObject({
      name: 'ZUS', kind: 'expense', accountId: 'mil', estimated: true, counterpartyId: 'system_zus', frequency: 'monthly', dayOfMonth: '15', weekendRule: 'next', startDate: '2026-11-10', preset: 'zus',
    })
    expect(initialEditorState({ ...base, preset: 'vat7', presetName: 'VAT-7' })).toMatchObject({ counterpartyId: 'system_us', dayOfMonth: '25' })
  })

  it('a new series starts monthly on today, without a weekend rule', () => {
    expect(initialEditorState(base)).toMatchObject({ name: '', amount: '', estimated: false, dayOfMonth: '10', weekendRule: 'none', preset: null })
  })

  it('names what is missing or wrong', () => {
    const s = initialEditorState({ ...base, defaultAccountId: '' })
    expect(validateEditor({ ...s, dayOfMonth: '32', endDate: '2026-11-01' })).toEqual({ name: true, accountId: true, amount: true, dayOfMonth: true, endDate: true })
    expect(validateEditor({ ...s, name: 'x', accountId: 'mil', amount: '1 234,50', frequency: 'everyNMonths', interval: '25' })).toEqual({ interval: true })
    expect(validateEditor({ ...s, name: 'x', accountId: 'mil', amount: '10', frequency: 'weekly', dayOfMonth: '' })).toEqual({})
  })

  it('builds a body the server reads, the amount in minor units', () => {
    const s: EditorState = { ...initialEditorState({ ...base, preset: 'zus', presetName: 'ZUS' }), amount: '1 234,50', tagIds: ['t1'], description: '  grudzień ' }
    expect(parseSeriesInput(editorToBody(s))).toEqual({
      name: 'ZUS', kind: 'expense', accountId: 'mil', counterpartyId: 'system_zus', tags: ['t1'], description: 'grudzień', amountMinor: 123_450,
      estimated: true, preset: 'zus', frequency: 'monthly', interval: 1, dayOfMonth: 15, weekday: null, startDate: '2026-11-10', weekendRule: 'next',
    })
  })

  it('an edit sends only what changed, a field the new frequency does not use as null', () => {
    const series = seriesFromInput('ser1', parseSeriesInput({ name: 'Czynsz', kind: 'expense', accountId: 'mil', amountMinor: 250_000, frequency: 'monthly', dayOfMonth: 10, startDate: '2026-11-01', description: 'Lokal' }), 'PLN')
    const start = initialEditorState({ ...base, series })
    expect(start).toMatchObject({ name: 'Czynsz', amount: '2500', dayOfMonth: '10', description: 'Lokal' })
    expect(editorToPatch(series, start)).toEqual({})
    expect(editorToPatch(series, { ...start, amount: '2600', frequency: 'weekly', weekday: '5', description: '' })).toEqual({
      amountMinor: 260_000, frequency: 'weekly', weekday: 5, dayOfMonth: null, description: null,
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/recurring/editor.test.ts`
Expected: FAIL (`@/lib/domain/recurring/editor` не існує).

- [ ] **Step 3: Implement the editor rule**

Створити `lib/domain/recurring/editor.ts`:

```ts
import { isDay } from '@/lib/domain/ledger/days'
import { fromMinor, toMinor } from '@/lib/domain/ledger/money'
import { parseAmountInput } from '@/lib/utils/amount-input'
import { seriesToRaw } from './input'
import { PRESET_DEFAULTS } from './presets'
import { MAX_INTERVAL, SERIES_NAME_MAX, type Frequency, type Preset, type Series, type SeriesKind, type WeekendRule } from './types'

/** What the series editor holds (S11): text as typed; numbers parse on save. */
export interface EditorState {
  name: string
  kind: SeriesKind
  accountId: string
  amount: string
  estimated: boolean
  categoryId: string
  counterpartyId: string
  tagIds: string[]
  description: string
  frequency: Frequency
  interval: string
  dayOfMonth: string
  weekday: string
  startDate: string
  endDate: string
  weekendRule: WeekendRule
  preset: Preset | null
}

export type EditorField = 'name' | 'accountId' | 'amount' | 'dayOfMonth' | 'interval' | 'startDate' | 'endDate'
export type EditorErrors = Partial<Record<EditorField, true>>

export interface InitialOptions {
  series?: Series
  preset?: Preset
  /** The preset's proper name (ZUS, PIT-4, VAT-7): the editor's first name. */
  presetName?: string
  today: string
  defaultAccountId: string
  /** The amount as the person types it in their language. */
  formatAmount: (amount: number) => string
}

/** The editor of a series as stored, of a preset (its day, an estimate, the next business day, its S06 counterparty), or a new one (monthly on today). */
export function initialEditorState(o: InitialOptions): EditorState {
  const s = o.series
  if (s !== undefined) {
    return {
      name: s.name, kind: s.kind, accountId: s.accountId, amount: o.formatAmount(fromMinor(s.amountMinor)), estimated: s.estimated,
      categoryId: s.categoryId ?? '', counterpartyId: s.counterpartyId ?? '', tagIds: [...s.tags], description: s.description ?? '',
      frequency: s.frequency, interval: String(s.interval), dayOfMonth: s.dayOfMonth === null ? '' : String(s.dayOfMonth),
      weekday: s.weekday === null ? '1' : String(s.weekday), startDate: s.startDate, endDate: s.endDate ?? '', weekendRule: s.weekendRule,
      preset: s.preset ?? null,
    }
  }
  const preset = o.preset ?? null
  return {
    name: preset !== null ? (o.presetName ?? '') : '',
    kind: 'expense',
    accountId: o.defaultAccountId,
    amount: '',
    estimated: preset !== null,
    categoryId: '',
    counterpartyId: preset !== null ? PRESET_DEFAULTS[preset].counterpartyId : '',
    tagIds: [],
    description: '',
    frequency: 'monthly',
    interval: '2',
    dayOfMonth: preset !== null ? String(PRESET_DEFAULTS[preset].dayOfMonth) : String(Number(o.today.slice(8, 10))),
    weekday: '1',
    startDate: o.today,
    endDate: '',
    weekendRule: preset !== null ? 'next' : 'none',
    preset,
  }
}

const whole = (text: string, min: number, max: number): boolean => /^\d+$/.test(text) && Number(text) >= min && Number(text) <= max
const cleanName = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** The fields the server would refuse, checked before the request (the server checks again). */
export function validateEditor(s: EditorState): EditorErrors {
  const e: EditorErrors = {}
  const name = cleanName(s.name)
  if (name.length < 1 || name.length > SERIES_NAME_MAX) e.name = true
  if (s.accountId === '') e.accountId = true
  const amount = parseAmountInput(s.amount)
  if (amount === null || amount <= 0) e.amount = true
  if (s.frequency !== 'weekly' && !whole(s.dayOfMonth, 1, 31)) e.dayOfMonth = true
  if (s.frequency === 'everyNMonths' && !whole(s.interval, 1, MAX_INTERVAL)) e.interval = true
  if (!isDay(s.startDate)) e.startDate = true
  if (s.endDate !== '' && (!isDay(s.endDate) || s.endDate < s.startDate)) e.endDate = true
  return e
}

/** The create body of a valid editor (`validateEditor` gave no errors): what `parseSeriesInput` reads. */
export function editorToBody(s: EditorState): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: cleanName(s.name),
    kind: s.kind,
    accountId: s.accountId,
    amountMinor: toMinor(parseAmountInput(s.amount) ?? 0),
    estimated: s.estimated,
    frequency: s.frequency,
    startDate: s.startDate,
    weekendRule: s.weekendRule,
    tags: [...s.tagIds],
  }
  if (s.frequency === 'weekly') body.weekday = Number(s.weekday)
  else body.dayOfMonth = Number(s.dayOfMonth)
  if (s.frequency === 'everyNMonths') body.interval = Number(s.interval)
  if (s.endDate !== '') body.endDate = s.endDate
  if (s.categoryId !== '') body.categoryId = s.categoryId
  if (s.counterpartyId !== '') body.counterpartyId = s.counterpartyId
  const description = s.description.trim()
  if (description !== '') body.description = description
  if (s.preset !== null) body.preset = s.preset
  return body
}

/** The PATCH of an edit: only the fields that differ from the stored series; a field the edit no longer has is null. */
export function editorToPatch(prior: Series, s: EditorState): Record<string, unknown> {
  const next = editorToBody(s)
  const old = seriesToRaw(prior)
  for (const fixed of ['kind', 'preset']) {
    delete next[fixed]
    delete old[fixed]
  }
  const patch: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
    if (JSON.stringify(old[key]) === JSON.stringify(next[key])) continue
    patch[key] = key in next ? next[key] : null
  }
  return patch
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/recurring/editor.test.ts`
Expected: PASS.

- [ ] **Step 5: The editor, the preset menu, the pause and delete dialogs, the page wiring**

Створити `components/recurring/SeriesEditor.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CounterpartyField } from '@/components/forms/transaction/CounterpartyField'
import { TagsField } from '@/components/forms/transaction/TagsField'
import { Button } from '@/components/ui/button'
import { DateField } from '@/components/ui/date-field'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { LedgerApiError } from '@/lib/api/ledger-client'
import { createSeries, updateSeries } from '@/lib/api/recurring-client'
import { editorToBody, editorToPatch, initialEditorState, validateEditor, type EditorErrors, type EditorState } from '@/lib/domain/recurring/editor'
import { FREQUENCIES, WEEKEND_RULES, type Preset, type Series } from '@/lib/domain/recurring/types'
import { useCounterparties } from '@/lib/hooks/useCounterparties'
import { useShell } from '@/lib/hooks/useShell'
import { useTags } from '@/lib/hooks/useTags'
import { formatWeekday } from '@/lib/i18n/format'
import { useCategoryName } from '@/lib/i18n/useCategoryName'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { formatAmountInput } from '@/lib/utils/amount-input'
import { todayDay } from '@/lib/utils/today'
import { weekdayDate } from './labels'

interface Props {
  orgId: string
  /** The series to change; absent: a new one. */
  series?: Series
  /** A new series from a tax preset. */
  preset?: Preset
  onClose: () => void
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const

/** Creates or changes a series (S11). Mounted only while open, so its state starts from the series or the preset. */
export function SeriesEditor({ orgId, series, preset, onClose }: Props) {
  const t = useTranslations('recurring')
  const tBulk = useTranslations('journal.bulk')
  const { locale } = useFormatters()
  const categoryName = useCategoryName()
  const { accounts, incomeCategories, expenseCategories, can } = useShell()
  const { counterparties } = useCounterparties(orgId)
  const { tags } = useTags(orgId)
  const [state, setState] = useState<EditorState>(() =>
    initialEditorState({
      series,
      preset,
      presetName: preset !== undefined ? t(`presets.${preset}`) : undefined,
      today: todayDay(),
      defaultAccountId: accounts[0]?.id ?? '',
      formatAmount: (amount) => formatAmountInput(amount, locale),
    }),
  )
  const [errors, setErrors] = useState<EditorErrors>({})
  const [busy, setBusy] = useState(false)
  const patch = (changes: Partial<EditorState>) => setState((s) => ({ ...s, ...changes }))
  const editing = series !== undefined
  const categories = state.kind === 'income' ? incomeCategories : expenseCategories
  const title = editing ? t('editor.titleEdit') : preset !== undefined ? t('editor.titlePreset', { preset: t(`presets.${preset}`) }) : t('editor.titleNew')

  const errorText = (e: unknown): string => {
    if (e instanceof LedgerApiError) {
      if (e.code === 'limit_reached') return t('editor.errors.limit')
      const key = `errors.${e.code}` as 'errors.unknown'
      if (tBulk.has(key)) return tBulk(key)
    }
    return t('editor.errors.save')
  }

  const save = async () => {
    if (busy) return
    const found = validateEditor(state)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setBusy(true)
    try {
      if (series === undefined) {
        const { created } = await createSeries(orgId, editorToBody(state))
        toast.success(t('editor.created', { count: created }))
      } else {
        const changes = editorToPatch(series, state)
        if (Object.keys(changes).length > 0) {
          await updateSeries(orgId, series.id, changes)
          toast.success(t('editor.saved'))
        }
      }
      onClose()
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const fieldError = (show: true | undefined, text: string) => (show ? <p className="text-xs text-expense">{text}</p> : null)

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {preset !== undefined && <DialogDescription>{t('presets.hint')}</DialogDescription>}
          {editing && <DialogDescription>{t('editor.rewriteHint')}</DialogDescription>}
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="series-name">{t('editor.name')}</Label>
            <Input id="series-name" value={state.name} maxLength={80} aria-invalid={errors.name} onChange={(e) => patch({ name: e.target.value })} />
            {fieldError(errors.name, t('editor.errors.name'))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="series-kind">{t('editor.kind')}</Label>
            <NativeSelect id="series-kind" value={state.kind} disabled={editing || preset !== undefined} onChange={(e) => patch({ kind: e.target.value as EditorState['kind'], categoryId: '' })}>
              <option value="expense">{t('editor.expense')}</option>
              <option value="income">{t('editor.income')}</option>
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="series-account">{t('editor.account')}</Label>
            <NativeSelect id="series-account" value={state.accountId} aria-invalid={errors.accountId} onChange={(e) => patch({ accountId: e.target.value })}>
              <option value="">{t('editor.chooseAccount')}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
            {fieldError(errors.accountId, t('editor.errors.account'))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="series-amount">{t('editor.amount')}</Label>
            <Input id="series-amount" inputMode="decimal" value={state.amount} aria-invalid={errors.amount} onChange={(e) => patch({ amount: e.target.value })} />
            {fieldError(errors.amount, t('editor.errors.amount'))}
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
            <input id="series-estimated" type="checkbox" className="accent-brand" checked={state.estimated} onChange={(e) => patch({ estimated: e.target.checked })} />
            {t('editor.estimated')}
          </label>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="series-category">{t('editor.category')}</Label>
            <NativeSelect id="series-category" value={state.categoryId} onChange={(e) => patch({ categoryId: e.target.value })}>
              <option value="">{t('editor.noCategory')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryName(c)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="sm:col-span-2">
            <CounterpartyField orgId={orgId} counterparties={counterparties} value={state.counterpartyId} onChange={(id) => patch({ counterpartyId: id })} />
          </div>
          <div className="sm:col-span-2">
            <TagsField orgId={orgId} tags={tags} value={state.tagIds} onChange={(ids) => patch({ tagIds: ids })} canCreate={can('data.write')} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="series-description">{t('editor.description')}</Label>
            <Input id="series-description" value={state.description} maxLength={500} onChange={(e) => patch({ description: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="series-frequency">{t('editor.frequency')}</Label>
            <NativeSelect id="series-frequency" value={state.frequency} onChange={(e) => patch({ frequency: e.target.value as EditorState['frequency'] })}>
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {t(`editor.freq.${f}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          {state.frequency === 'weekly' ? (
            <div className="space-y-1.5">
              <Label htmlFor="series-weekday">{t('editor.weekday')}</Label>
              <NativeSelect id="series-weekday" value={state.weekday} onChange={(e) => patch({ weekday: e.target.value })}>
                {WEEKDAYS.map((d) => (
                  <option key={d} value={String(d)}>
                    {formatWeekday(weekdayDate(d), locale, 'long')}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="series-day">{t('editor.dayOfMonth')}</Label>
              <Input id="series-day" inputMode="numeric" value={state.dayOfMonth} aria-invalid={errors.dayOfMonth} onChange={(e) => patch({ dayOfMonth: e.target.value })} />
              <p className={errors.dayOfMonth ? 'text-xs text-expense' : 'text-xs text-ink-muted'}>{errors.dayOfMonth ? t('editor.errors.dayOfMonth') : t('editor.dayHint')}</p>
            </div>
          )}
          {state.frequency === 'everyNMonths' && (
            <div className="space-y-1.5">
              <Label htmlFor="series-interval">{t('editor.interval')}</Label>
              <Input id="series-interval" inputMode="numeric" value={state.interval} aria-invalid={errors.interval} onChange={(e) => patch({ interval: e.target.value })} />
              {fieldError(errors.interval, t('editor.errors.interval'))}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="series-start">{t('editor.startDate')}</Label>
            <DateField id="series-start" value={state.startDate} onChange={(day) => patch({ startDate: day })} placeholder={t('editor.datePlaceholder')} calendarLabel={t('editor.openCalendar')} />
            {fieldError(errors.startDate, t('editor.errors.startDate'))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="series-end">{t('editor.endDate')}</Label>
            <DateField id="series-end" value={state.endDate} onChange={(day) => patch({ endDate: day })} placeholder={t('editor.datePlaceholder')} calendarLabel={t('editor.openCalendar')} />
            {fieldError(errors.endDate, t('editor.errors.endDate'))}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="series-weekend">{t('editor.weekendRule')}</Label>
            <NativeSelect id="series-weekend" value={state.weekendRule} onChange={(e) => patch({ weekendRule: e.target.value as EditorState['weekendRule'] })}>
              {WEEKEND_RULES.map((r) => (
                <option key={r} value={r}>
                  {t(`editor.weekend.${r}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t('editor.cancel')}
          </Button>
          <Button type="button" data-testid="series-save" disabled={busy} onClick={() => void save()}>
            {editing ? t('editor.save') : t('editor.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

Створити `components/recurring/PresetMenu.tsx`:

```tsx
'use client'

import { useTranslations } from 'next-intl'
import { ChevronDownIcon } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { PRESETS, type Preset } from '@/lib/domain/recurring/types'
import { cn } from '@/lib/utils'

/** «Додати з пресету»: ZUS, PIT-4, VAT-7 (S11). */
export function PresetMenu({ onPick }: { onPick: (preset: Preset) => void }) {
  const t = useTranslations('recurring')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger data-testid="preset-menu" className={cn(buttonVariants({ variant: 'soft' }), 'gap-1')}>
        {t('series.addPreset')}
        <ChevronDownIcon aria-hidden className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent sideOffset={6} className="min-w-44 rounded-panel p-1 shadow-pop ring-1 ring-line">
        {PRESETS.map((p) => (
          <DropdownMenuItem key={p} data-testid={`preset-${p}`} onClick={() => onPick(p)}>
            {t(`presets.${p}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

Створити `components/recurring/PauseSeriesDialog.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** «Призупинити»: no new plans; the future unpaid ones stay unless the person ticks their removal. */
export function PauseSeriesDialog({ busy, onConfirm, onClose }: { busy: boolean; onConfirm: (removeFuture: boolean) => void; onClose: () => void }) {
  const t = useTranslations('recurring')
  const [removeFuture, setRemoveFuture] = useState(false)
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('pause.title')}</DialogTitle>
          <DialogDescription>{t('pause.body')}</DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input id="pause-remove" type="checkbox" className="accent-brand" checked={removeFuture} onChange={(e) => setRemoveFuture(e.target.checked)} />
          {t('pause.removeFuture')}
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" data-testid="pause-confirm" disabled={busy} onClick={() => onConfirm(removeFuture)}>
            {t('pause.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

Створити `components/recurring/DeleteSeriesDialog.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { FutureMode } from '@/lib/domain/recurring/types'

/** «Видалити серію»: the future unpaid plans go too by default (spec); paid and past operations always stay. */
export function DeleteSeriesDialog({ name, busy, onConfirm, onClose }: { name: string; busy: boolean; onConfirm: (future: FutureMode) => void; onClose: () => void }) {
  const t = useTranslations('recurring')
  const [deleteFuture, setDeleteFuture] = useState(true)
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="break-words">{t('remove.title', { name })}</DialogTitle>
          <DialogDescription>{t('remove.body')}</DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input id="delete-future" type="checkbox" className="accent-brand" checked={deleteFuture} onChange={(e) => setDeleteFuture(e.target.checked)} />
          {t('remove.future')}
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" variant="destructive" data-testid="delete-confirm" disabled={busy} onClick={() => onConfirm(deleteFuture ? 'delete' : 'keep')}>
            {t('remove.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

`app/(app)/[orgSlug]/recurring/page.tsx` (зміни інструментом Edit):

1. Рядок `import { MoveDateDialog } from '@/components/recurring/MoveDateDialog'` замінити на:

```tsx
import { DeleteSeriesDialog } from '@/components/recurring/DeleteSeriesDialog'
import { MoveDateDialog } from '@/components/recurring/MoveDateDialog'
import { PauseSeriesDialog } from '@/components/recurring/PauseSeriesDialog'
import { PresetMenu } from '@/components/recurring/PresetMenu'
import { SeriesEditor } from '@/components/recurring/SeriesEditor'
import { Button } from '@/components/ui/button'
```

2. Рядок `import { markPlanPaid, movePlan, skipPlanOccurrence, undoPlanEdit, undoPlanSkip } from '@/lib/api/recurring-actions'` замінити на:

```tsx
import { markPlanPaid, movePlan, skipPlanOccurrence, undoPlanEdit, undoPlanSkip } from '@/lib/api/recurring-actions'
import { deleteSeries, updateSeries } from '@/lib/api/recurring-client'
```

3. Рядок `import type { PlannedRow } from '@/lib/domain/recurring/types'` замінити на:

```tsx
import type { FutureMode, PlannedRow, Preset, SeriesRow } from '@/lib/domain/recurring/types'
```

4. Після рядка `  const [busyId, setBusyId] = useState<string | null>(null)` додати:

```tsx
  // The series dialogs: one open at a time.
  const [editor, setEditor] = useState<{ series?: SeriesRow; preset?: Preset } | null>(null)
  const [pausing, setPausing] = useState<SeriesRow | null>(null)
  const [deleting, setDeleting] = useState<SeriesRow | null>(null)
  const [seriesBusy, setSeriesBusy] = useState(false)
```

5. Після функції `move` (після її закриваючої `}`) додати:

```tsx
  const changeSeries = async (run: () => Promise<unknown>, message: string) => {
    if (seriesBusy) return
    setSeriesBusy(true)
    try {
      await run()
      toast.success(message)
      setPausing(null)
      setDeleting(null)
    } catch (e) {
      toast.error(t('planned.failed', { reason: errorText(e) }))
    } finally {
      setSeriesBusy(false)
    }
  }
  const pause = (removeFuture: boolean) => {
    if (pausing !== null) void changeSeries(() => updateSeries(orgId, pausing.id, { status: 'paused', removeFuture }), t('pause.done'))
  }
  const resume = (s: SeriesRow) => void changeSeries(() => updateSeries(orgId, s.id, { status: 'active' }), t('pause.resumed'))
  const remove = (future: FutureMode) => {
    if (deleting !== null) void changeSeries(() => deleteSeries(orgId, deleting.id, future), t('remove.done'))
  }
  const seriesActions = (s: SeriesRow) => (
    <div role="group" aria-label={t('series.actions', { name: s.name })} className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => setEditor({ series: s })}>
        {t('series.edit')}
      </Button>
      {s.status === 'active' ? (
        <Button type="button" size="sm" variant="outline" onClick={() => setPausing(s)}>
          {t('series.pause')}
        </Button>
      ) : (
        <Button type="button" size="sm" variant="outline" disabled={seriesBusy} onClick={() => resume(s)}>
          {t('series.resume')}
        </Button>
      )}
      <Button type="button" size="sm" variant="outline" onClick={() => setDeleting(s)}>
        {t('series.delete')}
      </Button>
    </div>
  )
```

6. Рядок `        <h1 className="min-w-0 flex-1 font-display text-2xl font-semibold text-ink">{t('title')}</h1>` замінити на:

```tsx
        <h1 className="min-w-0 flex-1 font-display text-2xl font-semibold text-ink">{t('title')}</h1>
        {canEdit && (
          <>
            <PresetMenu onPick={(preset) => setEditor({ preset })} />
            <Button type="button" data-testid="series-add" onClick={() => setEditor({})}>
              {t('series.add')}
            </Button>
          </>
        )}
```

7. Рядок `            <SeriesList rows={overview.series} accounts={accounts} />` замінити на:

```tsx
            <SeriesList rows={overview.series} accounts={accounts} actions={canEdit ? seriesActions : undefined} />
```

8. Рядок `      {moving !== null && <MoveDateDialog row={moving} onConfirm={move} onClose={() => setMoving(null)} />}` замінити на:

```tsx
      {moving !== null && <MoveDateDialog row={moving} onConfirm={move} onClose={() => setMoving(null)} />}
      {editor !== null && <SeriesEditor orgId={orgId} series={editor.series} preset={editor.preset} onClose={() => setEditor(null)} />}
      {pausing !== null && <PauseSeriesDialog busy={seriesBusy} onConfirm={pause} onClose={() => setPausing(null)} />}
      {deleting !== null && <DeleteSeriesDialog name={deleting.name} busy={seriesBusy} onConfirm={remove} onClose={() => setDeleting(null)} />}
```

- [ ] **Step 6: Run the checks**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/domain/recurring tests/unit/i18n && npm run typecheck && npm run lint && npm run build`
Expected: PASS, `tsc` чисто (ключі `recurring.editor.*`, `recurring.pause.*`, `recurring.remove.*` є в каталогах з Task 11), `lint` 0 errors / 10 warnings, збірка успішна.

- [ ] **Step 7: Commit**

```bash
cd /f/AI/finflow && git add lib/domain/recurring/editor.ts tests/unit/domain/recurring/editor.test.ts components/recurring/SeriesEditor.tsx components/recurring/PresetMenu.tsx components/recurring/PauseSeriesDialog.tsx components/recurring/DeleteSeriesDialog.tsx "app/(app)/[orgSlug]/recurring/page.tsx" && git commit -m "feat(recurring): series editor with ZUS, PIT-4 and VAT-7 presets, pause and delete

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Журнал і форма: чип «Прострочено», банер і діалог збігів, «з серії …»

**Files:**
- Create: `components/transactions/PlanMatches.tsx`
- Modify: `components/transactions/TransactionList.tsx`, `app/(app)/[orgSlug]/transactions/page.tsx`, `components/forms/transaction/TransactionForm.tsx`

Перевірка цієї задачі: типи, lint, збірка (поведінку перевіряє e2e Task 15: `overdue-chip`, `plan-matches`, `plan-match`, `series-hint`).

- [ ] **Step 1: The overdue chip in the journal**

`components/transactions/TransactionList.tsx`:

1. Після рядка `import { fromMinor } from '@/lib/domain/ledger/money'` додати:

```tsx
import { toDay } from '@/lib/domain/ledger/days'
import { isOverdue } from '@/lib/domain/recurring/rows'
```

2. Рядок `import { formatDayShortUtc, formatWeekdayShortUtc, summarizeDay } from '@/lib/utils/journal'` замінити на:

```tsx
import { formatDayShortUtc, formatWeekdayShortUtc, summarizeDay } from '@/lib/utils/journal'
import { todayDay } from '@/lib/utils/today'
```

3. Після рядка `  const tAccountTypes = useTranslations('common.accountTypes')` додати:

```tsx
  // «Прострочено» (S11): a planned row whose payment day passed (the Warsaw day).
  const today = todayDay()
```

4. Рядок `                        {planned && <Badge variant="chip" className="mt-1">{t('planned')}</Badge>}` замінити на:

```tsx
                        {planned &&
                          (isOverdue({ status: tx.status, paymentDate: toDay(tx.date) }, today) ? (
                            <Badge variant="chip" data-testid="overdue-chip" className="mt-1 bg-expense-soft text-expense">
                              {t('overdue')}
                            </Badge>
                          ) : (
                            <Badge variant="chip" className="mt-1">
                              {t('planned')}
                            </Badge>
                          ))}
```

- [ ] **Step 2: The matches banner and dialog**

Створити `components/transactions/PlanMatches.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { CalendarCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { confirmMatches, undoMatches } from '@/lib/api/recurring-client'
import { mostFrequentCode } from '@/lib/domain/journal/selection'
import { fromMinor } from '@/lib/domain/ledger/money'
import { keyOfMatch } from '@/lib/domain/recurring/match'
import type { MatchOutcome, PlanMatch } from '@/lib/domain/recurring/types'
import { usePlanMatches } from '@/lib/hooks/usePlanMatches'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { undoToast } from '@/lib/ui/undo-toast'
import { formatDayShortUtc } from '@/lib/utils/journal'
import type { Account } from '@/types'

/** Bank operations that look like planned payments (S11): a banner over the journal and its dialog. Mounted for people who may write. */
export function PlanMatches({ orgId, accounts }: { orgId: string; accounts: Account[] }) {
  const t = useTranslations('journal.plans')
  const tBulk = useTranslations('journal.bulk')
  const matches = usePlanMatches(orgId)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failures, setFailures] = useState<ReadonlyMap<string, string>>(new Map())

  const errorText = (code: string): string => {
    const key = `errors.${code}` as 'errors.unknown'
    return tBulk.has(key) ? tBulk(key) : tBulk('errors.unknown')
  }

  const announce = (results: MatchOutcome[]) => {
    const made = results.filter((r) => r.ok)
    const failed = results.filter((r) => !r.ok) as Array<Extract<MatchOutcome, { ok: false }>>
    const text = [t('done', { count: made.length }), failed.length > 0 ? t('partial', { count: failed.length, reason: errorText(mostFrequentCode(failed) ?? 'unknown') }) : '']
      .filter(Boolean)
      .join(' ')
    if (made.length === 0) {
      toast.warning(text)
      return
    }
    undoToast({
      message: text,
      actionLabel: t('undo'),
      failureMessage: t('undoFailed'),
      id: 'journal-plan-matches',
      undo: async () => {
        const out = await undoMatches(orgId, made.map((r) => r.planId))
        if (out.some((r) => !r.ok)) throw new Error('partial')
        toast.success(t('undone', { count: out.length }))
      },
    })
  }

  const openDialog = () => {
    setFailures(new Map())
    setOpen(true)
    // The dialog shows what the server says now: the operations may have changed since the journal opened.
    matches.refresh()
  }

  // «Підтвердити вибрані»: the ticked pairs are linked; the unticked ones are not offered again in this browser. A pair that
  // fails stays in the dialog with its reason; the dialog closes when every pair went through.
  const confirm = async (chosen: PlanMatch[], rejected: PlanMatch[]) => {
    matches.dismiss(rejected)
    if (chosen.length === 0) {
      setOpen(false)
      return
    }
    setBusy(true)
    try {
      const results = await confirmMatches(orgId, chosen)
      announce(results)
      matches.settle(results)
      const failed = new Map<string, string>()
      for (const r of results) {
        const pair = chosen.find((p) => p.plan.id === r.planId)
        if (!r.ok && pair !== undefined) failed.set(keyOfMatch(pair), errorText(r.code))
      }
      setFailures(failed)
      if (failed.size === 0) setOpen(false)
    } catch {
      toast.error(errorText('unknown'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {matches.pairs.length > 0 && (
        <div data-testid="plan-matches" className="flex flex-wrap items-center gap-3 rounded-panel border border-line bg-brand-soft px-4 py-2.5 text-sm text-brand-soft-foreground">
          <CalendarCheck aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{t('banner', { count: matches.pairs.length })}</span>
          <Button type="button" variant="soft" size="sm" onClick={openDialog}>
            {t('bannerOpen')}
          </Button>
        </div>
      )}
      {open && (
        <PlanMatchesDialog
          pairs={matches.pairs}
          accounts={accounts}
          truncated={matches.truncated}
          busy={busy}
          failures={failures}
          onConfirm={(chosen, rejected) => void confirm(chosen, rejected)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

interface DialogProps {
  pairs: PlanMatch[]
  accounts: Account[]
  truncated: boolean
  busy: boolean
  /** Why a pair failed on the last confirmation (already translated), by `keyOfMatch`. */
  failures: ReadonlyMap<string, string>
  onConfirm: (chosen: PlanMatch[], rejected: PlanMatch[]) => void
  onClose: () => void
}

/** The suggested pairs: every pair starts ticked; «Підтвердити вибрані» links the ticked ones, «Не зараз» closes. */
function PlanMatchesDialog({ pairs, accounts, truncated, busy, failures, onConfirm, onClose }: DialogProps) {
  const t = useTranslations('journal.plans')
  const { locale, money } = useFormatters()
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(() => new Set())
  const dayOf = (day: string): string => formatDayShortUtc(new Date(`${day}T00:00:00Z`), locale)
  const accountOf = (id: string): string => accounts.find((a) => a.id === id)?.name ?? '—'
  const toggle = (key: string) =>
    setUnticked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const chosen = pairs.filter((p) => !unticked.has(keyOfMatch(p)))
  const rejected = pairs.filter((p) => unticked.has(keyOfMatch(p)))

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      {/* The one column may not grow to the widest nowrap line of a pair: a long name would run past the frame on a phone. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('dialogTitle')}</DialogTitle>
          <DialogDescription>{t('dialogBody')}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {pairs.map((p) => {
            const key = keyOfMatch(p)
            const name = p.plan.name ?? p.plan.description ?? t('unnamed')
            const amount = money(fromMinor(p.bank.amountMinor), p.bank.currency)
            const failure = failures.get(key)
            return (
              <li key={key} data-testid="plan-match" className="rounded-field border border-line px-3 py-2">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 accent-brand"
                    checked={!unticked.has(key)}
                    onChange={() => toggle(key)}
                    aria-label={t('pick', { name, planDate: dayOf(p.plan.paymentDate), bankDate: dayOf(p.bank.paymentDate), amount })}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-medium text-ink">{name}</span>
                    <span className="block text-xs tabular-nums text-ink-muted">
                      {`${t('planLabel', { date: dayOf(p.plan.paymentDate) })} · ${t('bankLabel', { date: dayOf(p.bank.paymentDate) })} · ${accountOf(p.bank.accountId)}`}
                    </span>
                    {p.bank.remittance && <span className="block truncate text-xs text-ink-muted">{p.bank.remittance}</span>}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-semibold tabular-nums text-ink">{amount}</span>
                    {p.plan.estimated && <span className="block text-xs text-ink-muted">{t('estimated')}</span>}
                  </span>
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

`app/(app)/[orgSlug]/transactions/page.tsx`:

1. Після рядка `import { TransferSuggestionsBanner, TransferSuggestionsDialog } from '@/components/transactions/TransferSuggestions'` додати:

```tsx
import { PlanMatches } from '@/components/transactions/PlanMatches'
```

2. Рядок `      {canEdit && suggestions.pairs.length > 0 && <TransferSuggestionsBanner count={suggestions.pairs.length} onOpen={openSuggestions} />}` замінити на:

```tsx
      {canEdit && suggestions.pairs.length > 0 && <TransferSuggestionsBanner count={suggestions.pairs.length} onOpen={openSuggestions} />}
      {canEdit && <PlanMatches orgId={orgId} accounts={accounts} />}
```

- [ ] **Step 3: «з серії …» in the form**

`components/forms/transaction/TransactionForm.tsx`:

1. Після рядка `import { useTags } from '@/lib/hooks/useTags'` додати:

```tsx
import { useSeriesName } from '@/lib/hooks/useSeriesName'
```

2. Після рядка `  const { tags } = useTags(orgId)` додати:

```tsx
  // A planned occurrence of a series (S11) names its series and warns that a change detaches it.
  const seriesPlan = transaction?.seriesId !== undefined && transaction.status === 'planned'
  const seriesName = useSeriesName(orgId, seriesPlan ? transaction?.seriesId : undefined)
```

3. Після блоку

```tsx
          {bankLocked && (
            <p data-testid="bank-locked-hint" className="text-xs text-ink-muted">
              {t('bankLockedHint')}
            </p>
          )}
```

додати:

```tsx
          {seriesPlan && (
            <p data-testid="series-hint" className="rounded-control bg-brand-soft px-3 py-2 text-xs text-brand-soft-foreground">
              {seriesName === null
                ? t('seriesGone')
                : transaction?.manual
                  ? t('seriesHintManual', { name: seriesName ?? '…' })
                  : t('seriesHint', { name: seriesName ?? '…' })}
            </p>
          )}
```

- [ ] **Step 4: Run the checks**

Run: `cd /f/AI/finflow && npx vitest run --config vitest.config.ts tests/unit/i18n tests/unit/domain && npm run typecheck && npm run lint && npm run build`
Expected: PASS, `tsc` чисто, `lint` 0 errors / 10 warnings (жодного синхронного `setState` в ефекті: `useSeriesName` і `usePlanMatches` ставлять стан лише в колбеках промісів), збірка успішна.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add components/transactions/PlanMatches.tsx components/transactions/TransactionList.tsx "app/(app)/[orgSlug]/transactions/page.tsx" components/forms/transaction/TransactionForm.tsx && git commit -m "feat(recurring): overdue chip, plan matches banner and dialog, series hint in the form

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 15: E2E планових платежів, 401 маршрутів, скриншоти

**Files:**
- Create: `tests/e2e/helpers/recurring-seed.ts`, `tests/e2e/recurring.spec.ts`, `tests/ui-shots/recurring.spec.ts`
- Modify: `tests/e2e/api-guards.spec.ts`

- [ ] **Step 1: Seed helper**

Створити `tests/e2e/helpers/recurring-seed.ts`:

```ts
// Series and planned operations written through the real routes for the S11 specs (the signed-in page's request context
// carries the session cookie), so they get their plans, marks and audit entries like the app's own.
import { expect, type Page } from '@playwright/test'

const ORIGIN = { Origin: 'http://localhost:3000' }

/** A series through `POST /recurring`; returns its id. */
export async function seedSeries(page: Page, orgId: string, body: Record<string, unknown>): Promise<string> {
  const res = await page.request.post(`/api/orgs/${orgId}/recurring`, { headers: ORIGIN, data: body })
  expect(res.status(), 'series').toBe(201)
  return ((await res.json()) as { series: { id: string } }).series.id
}

/** A planned operation a person typed (no series), on any day. */
export async function seedPlanned(
  page: Page,
  orgId: string,
  op: { type: 'income' | 'expense'; accountId: string; amountMinor: number; paymentDate: string; description: string },
): Promise<void> {
  const res = await page.request.post(`/api/orgs/${orgId}/transactions`, { headers: ORIGIN, data: { ...op, status: 'planned' } })
  expect(res.status(), 'planned operation').toBe(201)
}

/** ISO weekday (1 Monday ... 7 Sunday) of a `YYYY-MM-DD` day. */
export function isoWeekdayOf(day: string): number {
  return ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1
}
```

- [ ] **Step 2: Write the e2e spec and the 401 checks**

Створити `tests/e2e/recurring.spec.ts`:

```ts
// tests/e2e/recurring.spec.ts
// Planned payments (S11): a ZUS series from the preset puts its plans in the journal; a suggested match links the bank
// operation to its plan without a duplicate and the undo brings the plan back; an overdue plan has «Прострочено» in the
// journal and in the strip; «Пропустити» and its undo; a new amount of the series updates its future plans.
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { registerViaUi, waitForShell, type RegisteredUser } from './helpers/app-ui'
import { dayFromToday } from './helpers/bank-seed'
import { readDoc } from './helpers/emulator-firestore'
import { seedLedgerAccount } from './helpers/ledger-seed'
import { isoWeekdayOf, seedPlanned, seedSeries } from './helpers/recurring-seed'
import { seedBankOperation } from './helpers/transfer-seed'
import { todayDay } from '../../lib/utils/today'

const NEEDS_EMULATORS =
  'Needs the Auth + Firestore emulators. Run: firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"'

const rowsOf = (page: Page): Locator => page.locator('tbody').getByRole('row').filter({ has: page.getByRole('checkbox') })
const toast = (page: Page, text: string): Locator => page.locator('[data-sonner-toast]').filter({ hasText: text })
const accountRow = (page: Page, name: string): Locator =>
  page.getByRole('complementary', { name: 'Рахунки' }).getByRole('listitem').filter({ hasText: name })

async function balanceMinor(request: APIRequestContext, orgId: string, accountId: string): Promise<number> {
  const raw = (await readDoc(request, `organizations/${orgId}/accounts/${accountId}`))?.balanceMinor as unknown as
    | { doubleValue?: number; integerValue?: string }
    | undefined
  return Number(raw?.doubleValue ?? raw?.integerValue)
}

/** A PLN company with one bank account of 1000 zł. */
async function setup(page: Page, request: APIRequestContext, prefix: string): Promise<RegisteredUser> {
  const user = await registerViaUi(page, prefix, 'PLN')
  await waitForShell(page, user.companyName)
  await seedLedgerAccount(request, user.orgId, 'acc-a', { name: 'Konto A', balance: 1000, currency: 'PLN' })
  await expect(accountRow(page, 'Konto A')).toBeVisible()
  return user
}

/** A monthly rent on today's day of the month: plans for today and the next three months. */
function rentToday(amountMinor: number): Record<string, unknown> {
  const day = todayDay()
  return { name: 'Czynsz', kind: 'expense', accountId: 'acc-a', amountMinor, frequency: 'monthly', dayOfMonth: Number(day.slice(8, 10)), startDate: day }
}

test.describe('planned payments (emulators)', () => {
  test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST, NEEDS_EMULATORS)

  test('a ZUS series from the preset puts its planned operations in the journal', async ({ page, request }) => {
    const user = await setup(page, request, 'rc-preset')
    await page.goto(`/${user.orgId}/recurring`)
    await expect(page.getByRole('heading', { level: 1, name: 'Планові платежі' })).toBeVisible()
    await expect(page.getByTestId('series-empty')).toBeVisible()

    await page.getByTestId('preset-menu').click()
    await page.getByTestId('preset-zus').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('#series-name')).toHaveValue('ZUS')
    await expect(dialog.locator('#series-day')).toHaveValue('15')
    await expect(dialog.locator('#series-estimated')).toBeChecked()
    await dialog.locator('#series-account').selectOption({ label: 'Konto A' })
    await dialog.locator('#series-amount').fill('1500')
    await dialog.getByTestId('series-save').click()
    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('series-row').filter({ hasText: 'ZUS' })).toHaveCount(1)
    await expect(page.getByTestId('plan-estimated').first()).toBeVisible()

    await page.goto(`/${user.orgId}/transactions`)
    const plans = rowsOf(page).filter({ hasText: 'План' })
    await expect(plans.first()).toBeVisible()
    expect(await plans.count()).toBeGreaterThanOrEqual(3)
    expect(await balanceMinor(request, user.orgId, 'acc-a')).toBe(100_000)
  })

  test('a suggested match links the bank operation to its plan without a duplicate; «Скасувати» brings the plan back', async ({ page, request }) => {
    const user = await setup(page, request, 'rc-match')
    await seedSeries(page, user.orgId, rentToday(50_000))
    await seedBankOperation(page, request, user.orgId, { key: 'e2erent0001', type: 'expense', accountId: 'acc-a', amountMinor: 50_000, paymentDate: todayDay(), remittance: 'Czynsz listopad' })
    await page.goto(`/${user.orgId}/transactions`)
    await expect(rowsOf(page)).toHaveCount(5)

    const banner = page.getByTestId('plan-matches')
    await expect(banner).toContainText('Знайдено збігів із плановими платежами: 1')
    await banner.getByRole('button', { name: 'Переглянути' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('plan-match')).toHaveCount(1)
    await dialog.getByRole('button', { name: 'Підтвердити вибрані' }).click()
    await expect(dialog).toBeHidden()
    const done = toast(page, 'Пов’язано з плановими: 1.')
    await expect(done).toBeVisible()
    await expect(rowsOf(page)).toHaveCount(4)
    await expect(rowsOf(page).filter({ hasText: 'Czynsz listopad' })).toHaveCount(1)
    await expect(banner).toHaveCount(0)
    expect(await balanceMinor(request, user.orgId, 'acc-a')).toBe(50_000)

    await done.getByRole('button', { name: 'Скасувати' }).click()
    await expect(rowsOf(page)).toHaveCount(5)
    expect(await balanceMinor(request, user.orgId, 'acc-a')).toBe(50_000)
  })

  test('an overdue plan has «Прострочено» in the journal and in the strip', async ({ page, request }) => {
    const user = await setup(page, request, 'rc-overdue')
    await seedPlanned(page, user.orgId, { type: 'expense', accountId: 'acc-a', amountMinor: 12_000, paymentDate: dayFromToday(-3), description: 'Faktura prąd' })
    await page.goto(`/${user.orgId}/transactions`)
    await expect(rowsOf(page).filter({ hasText: 'Faktura prąd' }).getByTestId('overdue-chip')).toHaveText('Прострочено')

    await page.goto(`/${user.orgId}/recurring`)
    await expect(page.getByTestId('recurring-overdue')).toHaveText('Прострочено: 1')
    await expect(page.getByTestId('planned-row').filter({ hasText: 'Faktura prąd' }).getByTestId('plan-overdue')).toBeVisible()
  })

  test('«Пропустити» takes one plan off and «Скасувати» brings it back', async ({ page, request }) => {
    const user = await setup(page, request, 'rc-skip')
    const day = todayDay()
    await seedSeries(page, user.orgId, { name: 'Siłownia', kind: 'expense', accountId: 'acc-a', amountMinor: 15_000, frequency: 'weekly', weekday: isoWeekdayOf(day), startDate: day })
    await page.goto(`/${user.orgId}/recurring`)
    const rows = page.getByTestId('planned-row').filter({ hasText: 'Siłownia' })
    await expect(rows.first()).toBeVisible()
    const before = await rows.count()
    await rows.first().getByRole('button', { name: 'Пропустити' }).click()
    const skipped = toast(page, 'Пропущено цей раз')
    await expect(skipped).toBeVisible()
    await expect(rows).toHaveCount(before - 1)
    await skipped.getByRole('button', { name: 'Скасувати' }).click()
    await expect(rows).toHaveCount(before)
  })

  test('a new amount of the series updates its future plans', async ({ page, request }) => {
    const user = await setup(page, request, 'rc-amount')
    await seedSeries(page, user.orgId, rentToday(50_000))
    await page.goto(`/${user.orgId}/recurring`)
    await page.getByTestId('series-row').filter({ hasText: 'Czynsz' }).getByRole('button', { name: 'Змінити' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('#series-amount').fill('600')
    await dialog.getByTestId('series-save').click()
    await expect(dialog).toBeHidden()
    await expect(toast(page, 'Серію змінено')).toBeVisible()

    await page.goto(`/${user.orgId}/transactions`)
    await expect(rowsOf(page)).toHaveCount(4)
    await expect(rowsOf(page).filter({ hasText: '600' })).toHaveCount(4)
  })
})
```

`tests/e2e/api-guards.spec.ts`: перед рядком `  test('Enable Banking callback rejects a forged state before exchanging the code (400)', async ({ request }) => {` додати:

```ts
  // S11: the planned payments routes refuse a request without a session cookie, before they read any data.
  test('planned payments endpoints require a session cookie (401)', async ({ request }) => {
    const origin = { Origin: 'http://localhost:3000' }
    const calls: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; path: string; data?: object }[] = [
      { method: 'GET', path: '/api/orgs/x/recurring' },
      { method: 'POST', path: '/api/orgs/x/recurring', data: { name: 'x' } },
      { method: 'GET', path: '/api/orgs/x/recurring/s1' },
      { method: 'PATCH', path: '/api/orgs/x/recurring/s1', data: { name: 'x' } },
      { method: 'DELETE', path: '/api/orgs/x/recurring/s1' },
      { method: 'POST', path: '/api/orgs/x/recurring/s1/skip', data: { occurrence: '2026-11-10' } },
      { method: 'GET', path: '/api/orgs/x/recurring/suggestions' },
      { method: 'POST', path: '/api/orgs/x/recurring/matches', data: { undo: ['pl_s1_2026-11-10'] } },
    ]
    for (const { method, path, data } of calls) {
      const res = await request.fetch(path, { method, headers: origin, data })
      expect(res.status(), `${method} ${path}`).toBe(401)
    }
  })

```

- [ ] **Step 3: Write the screenshot spec**

Створити `tests/ui-shots/recurring.spec.ts`:

```ts
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { registerViaUi, waitForShell } from '../e2e/helpers/app-ui'
import { dayFromToday } from '../e2e/helpers/bank-seed'
import { seedLedgerAccount } from '../e2e/helpers/ledger-seed'
import { isoWeekdayOf, seedPlanned, seedSeries } from '../e2e/helpers/recurring-seed'
import { seedBankOperation } from '../e2e/helpers/transfer-seed'
import { todayDay } from '../../lib/utils/today'
import pl from '../../messages/pl.json'
import uk from '../../messages/uk.json'

// S11: planned payments (the page with the strip, the series and the upcoming plans; the ZUS preset editor; the journal
// with the matches banner and an overdue plan; the matches dialog) at 1440 and 390 px in uk and pl.
// Files: recurring-<state>-<desktop|phone>-<uk|pl>.png.
const OUT_DIR = join(process.cwd(), 'ui-shots')
const VIEWPORTS = [
  { form: 'desktop', width: 1440, height: 900 },
  { form: 'phone', width: 390, height: 844 },
] as const
const LOCALES = [
  ['uk', uk],
  ['pl', pl],
] as const

test.describe('recurring shots', () => {
  test.skip(
    !process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST,
    'Run with `npm run ui:shots` (it starts the Auth + Firestore emulators)',
  )

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true })
    for (const old of readdirSync(OUT_DIR)) {
      if (old.startsWith('recurring-') && old.endsWith('.png')) rmSync(join(OUT_DIR, old), { force: true })
    }
  })

  for (const [locale, messages] of LOCALES) {
    test(`planned payments in ${locale}`, async ({ page, request, context }) => {
      test.setTimeout(300_000)
      await page.setViewportSize({ width: 1440, height: 900 })
      const user = await registerViaUi(page, `rcshots${locale}`, 'PLN')
      await waitForShell(page, user.companyName)
      const org = user.orgId
      const day = todayDay()

      await seedLedgerAccount(request, org, 'acc-main', { name: 'Konto główne Millennium', balance: 25000, currency: 'PLN' })
      // ZUS (an estimate), the office rent on today's day (its bank payment came today: a match), a weekly gym, an overdue invoice.
      await seedSeries(page, org, { name: 'ZUS', kind: 'expense', accountId: 'acc-main', amountMinor: 160_000, frequency: 'monthly', startDate: day, preset: 'zus' })
      await seedSeries(page, org, { name: 'Czynsz biuro Gdańsk Wrzeszcz', kind: 'expense', accountId: 'acc-main', amountMinor: 350_000, frequency: 'monthly', dayOfMonth: Number(day.slice(8, 10)), startDate: day })
      await seedSeries(page, org, { name: 'Siłownia', kind: 'expense', accountId: 'acc-main', amountMinor: 15_000, frequency: 'weekly', weekday: isoWeekdayOf(day), startDate: dayFromToday(1) })
      await seedPlanned(page, org, { type: 'expense', accountId: 'acc-main', amountMinor: 42_000, paymentDate: dayFromToday(-4), description: 'Faktura Energa' })
      await seedBankOperation(page, request, org, { key: `${locale}rent00001`, type: 'expense', accountId: 'acc-main', amountMinor: 350_000, paymentDate: day, remittance: 'Czynsz biuro listopad' })

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
          await page.screenshot({ path: join(OUT_DIR, `recurring-${state}-${viewport.form}-${locale}.png`), animations: 'disabled' })
        }
        const dialog = page.getByRole('dialog')

        await page.goto(`/${org}/recurring`)
        await waitForShell(page, user.companyName)
        await expect(page.getByTestId('recurring-strip')).toBeVisible()
        await expect(page.getByTestId('series-row')).toHaveCount(3)
        await noHorizontalScroll('page')
        await shot('page')

        await page.getByTestId('preset-menu').click()
        await page.getByTestId('preset-zus').click()
        await expect(dialog.locator('#series-name')).toHaveValue('ZUS')
        await dialogFits('editor')
        await shot('editor')
        await dialog.getByRole('button', { name: messages.recurring.editor.cancel }).click()
        await expect(dialog).toBeHidden()

        await page.goto(`/${org}/transactions`)
        await waitForShell(page, user.companyName)
        const banner = page.getByTestId('plan-matches')
        await expect(banner).toBeVisible()
        await expect(page.getByTestId('overdue-chip')).toBeVisible()
        await noHorizontalScroll('journal')
        await shot('journal')

        await banner.getByRole('button', { name: messages.journal.plans.bannerOpen }).click()
        await expect(dialog.getByTestId('plan-match')).toHaveCount(1)
        await dialogFits('matches')
        await shot('matches')
        await dialog.getByRole('button', { name: messages.journal.plans.later }).click()
        await expect(dialog).toBeHidden()
      }
    })
  }
})
```

- [ ] **Step 4: Run e2e and the screenshots**

```bash
cd /f/AI/finflow && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only auth,firestore --project demo-finflow "npx playwright test tests/e2e/recurring.spec.ts tests/e2e/api-guards.spec.ts tests/e2e/journal.spec.ts tests/e2e/transaction-form.spec.ts tests/e2e/transfers.spec.ts tests/e2e/app-shell.spec.ts tests/e2e/counterparties.spec.ts"
```

Expected: усі PASS (5 нових сценаріїв, 401 маршрутів, наявні журнал, форма, перекази, оболонка з третьою вкладкою і контрагенти без змін: їхні дані не мають планових операцій серії, тож банера збігів немає).

```bash
cd /f/AI/finflow && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only auth,firestore --project demo-finflow "npx playwright test --config playwright.shots.config.ts tests/ui-shots/recurring.spec.ts"
```

Expected: PASS, у `ui-shots/` 16 файлів `recurring-*.png` (4 стани × 2 ширини × 2 мови). Переглянути їх (читанням зображень): смуга й картки на телефоні без бічного прокручування, довгі польські підписи кнопок («Oznacz jako zapłaconą», «Dodaj z szablonu») переносяться, редактор і діалог збігів вміщаються, чип «Прострочено»/«Zaległe» червоний, третя вкладка «Planowe…» не ламає рядок вкладок (рядок вкладок має власне горизонтальне прокручування `overflow-x-auto`, сторінка ні).

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add tests/e2e/helpers/recurring-seed.ts tests/e2e/recurring.spec.ts tests/e2e/api-guards.spec.ts tests/ui-shots/recurring.spec.ts && git commit -m "test(recurring): e2e of presets, matches, overdue, skip and series change; screenshots

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Документація і повна перевірка

**Files:**
- Modify: `CLAUDE.md`, `PROGRESS.md`, `docs/superpowers/specs/2026-10-22-finflow-roadmap.md`

- [ ] **Step 1: CLAUDE.md**

1. У `## Project Overview` кінець рядка `Working today: ...` ` ... the choice kept in the address across the report tabs (S10f).` замінити на ` ... the choice kept in the address across the report tabs (S10f), and planned payments: series (rent, subscriptions, the ZUS, PIT-4 and VAT-7 presets) keep planned operations three months ahead, filled daily by the hourly cron call; the journal suggests plan ↔ bank pairs confirmed in one click without a duplicate, and «Прострочено» marks the planned operations whose day passed; planned operations never move balances or reports (S11).`
2. У `## Folder Structure` рядок `    transactions/  analytics/{cashflow,pl,balance,calendar}/  settings/{...}/ (...)` доповнити: після `transactions/  ` вставити `recurring/  `; після рядка `  api/orgs/[orgId]/transfers/{route,suggestions,[txId]/split}/route.ts  ← own transfers (S10b): make (pairs, merge, convert), suggestions, split` додати:

```
  api/orgs/[orgId]/recurring/{route,[seriesId],[seriesId]/skip,suggestions,matches}/route.ts  ← planned payments (S11): overview and create, one series, skip, plan ↔ bank suggestions and matches
```

3. У `## Firestore Data Model (S00, S02)` у рядку `subcollections: ...` після `` `tagKeys` (S10t, server only; name keys) `` додати `, \`recurring\` (S11, written by the server, readable by every member), \`recurringDone\` (S11, server only; one mark per paid, skipped or deleted occurrence)`.
4. У `## Banks (S09)` у кінці пункту `**Фонове оновлення (S09b):**` додати речення: ` Після банку той самий виклик заповнює планові платежі дня (S11, частина \`recurring\` відповіді; job червоніє й при \`recurring.failed > 0\`).`
5. У `## Own transfers (S10b)` у пункті `**Pure rules ...**` текст `` `bankSideOf` (an actual, non-recurring bank income or expense under its `bk_` id) `` замінити на `` `bankSideOf` (an actual, non-recurring bank income or expense under its `bk_` id that pays no planned occurrence, `seriesId`, S11) ``.
6. У кінець файлу (після блоку `## Report filters (S10f)`) додати:

```
## Planned payments (S11)

Spec: `docs/superpowers/specs/2026-11-10-s11-planned-payments-design.md`. Plan: `docs/superpowers/plans/2026-11-10-s11-planned-payments.md`.

- **Data:** `organizations/{org}/recurring/{id}` `{ schemaVersion: 1, name (1-80), kind income|expense, accountId, categoryId?, counterpartyId?, tags (≤ 10), description?, amountMinor, currency (the account's), estimated, frequency weekly|monthly|everyNMonths|yearly, interval (everyNMonths 1-24, else 1), dayOfMonth (1-31, null for weekly), weekday (ISO 1-7, weekly only), startDate, endDate?, weekendRule none|next|previous, preset? zus|pit4|vat7, status active|paused, generatedThrough?, dueOn?, orgId, createdAt, createdBy, updatedAt, updatedBy, version }`, at most `MAX_SERIES` = 100 (409 `limit_reached`); `kind` and `preset` are fixed at creation. One validation for bodies and stored documents (`parseSeriesInput`). An occurrence is an ordinary planned operation `pl_<seriesId>_<occurrence>` with the server-only fields `seriesId`, `occurrence` (the nominal day), `estimated`, `manual` (`lib/domain/ledger/doc.ts`; a request with them is `400`; `pl_` ids are reserved like `bk_`). `isRecurring` stays the form's own flag: the generator never sets it. `recurringDone/{planId}` `{ seriesId, occurrence, reason paid|skipped|deleted, txId?, estimated, manual, plan?, carried?, planCreatedAt?, planCreatedBy?, at, by }` is closed to clients.
- **Schedule (pure, `lib/domain/recurring/schedule.ts`):** UTC day strings only (no summer time shift); the first occurrence is the first rule day on or after `startDate`; a shorter month takes its last day (31 → 28/29); everyNMonths and yearly keep the phase of the start month; `paymentDayOf` moves a weekend or Polish holiday by `weekendRule` (`lib/utils/pl-calendar.ts`); `periodOf` is the week, month, block or year an occurrence pays for.
- **Generator:** `createSeries` fills today to `windowEnd(today)` (three months, `addMonthsClamped`); `fillSeries` (the daily step) fills from the day after `generatedThrough`, so missed days come back as overdue plans, at most 100 per series and call; an occurrence is created only when neither its operation nor its mark exists (`t.create`, deterministic id), and `dueOn` is checked inside the transaction, so parallel runs fill once. A deleted category or an archived counterparty or tag of the series is left out of new plans; a missing account fails the series. Created plans are written by `system`, audit `tx.create` with `via: 'plan'`.
- **Daily step:** `POST /api/cron/bank-sync` runs the bank refresh first, then `runRecurringCron` (`lib/server/recurring/cron.ts`) with `min(10 s, 55 s − elapsed)`: the due series by `collectionGroup('recurring').where('dueOn', '<=', today).orderBy('dueOn')` (at most 200), each in its own transaction, the budget checked before each; a lasting failure moves `dueOn` to tomorrow, `ledger_busy`/`conflict` retry next hour. The answer has `recurring: { considered, filled, created, skipped, failed }`; `.github/workflows/bank-sync.yml` fails on `recurring.failed > 0`.
- **Change of a series (`updateSeries`, one transaction):** paused = no new plans (`removeFuture` deletes the future unpaid ones); active = the future unpaid plans not changed by hand follow the new schedule and content (same occurrence updated, a vanished one deleted without a mark, a new one created), never in a period a mark or a kept operation (paid, manual, past) already takes (`periodOf`, index `recurringDone (seriesId, occurrence)`); at most `REWRITE_CAP` = 100 future operations (409 `limit_reached`, `field: 'planned'`). Delete (`?future=delete|keep`, delete by default): paid and past stay with `seriesId`, the marks stay. A person's change of a field the series sets on a planned occurrence makes it `manual` (`withSeries`); a new amount also drops `estimated`. A series' account cannot be deleted or change currency (`account_has_operations`, `field: 'recurring'`).
- **Marks (`markChangeOf`, inside `commit`):** «Позначити сплаченою» (planned → actual) writes `paid` with `txId` = the operation; back to planned lifts it; a person's delete of a planned occurrence writes `deleted`; a create under a `pl_` id (the undo of a delete or of «Пропустити») is accepted only from a `skipped`, `deleted` or self-`paid` mark, takes the series fields from it and lifts it; a retry after it went through is a replay. Deleting an actual occurrence keeps `paid`.
- **Plan → fact:** `GET /recurring/suggestions` (every member) reads the planned series occurrences not changed by hand from 90 days back to 3 days ahead (`status, paymentDate` index, at most 500), and only then the bank operations of the days they span (at most 2000, S10b's query shape); a pair is the same kind and account, the bank day from −3 to +10 days of the plan's payment day, the exact amount, or for an estimate the same counterparty; each side with exactly one candidate; newest first, at most 50, with versions and the series name. `POST /recurring/matches { confirm | undo }` (owner, accountant) runs one transaction per pair: the bank operation keeps its id, amount, day, bank block, `bankSeen` mark and rules trace, takes the category, counterparty, tags and comment it lacks and the series link; the plan is deleted; `paid` keeps the plan's document and what was carried; the undo restores the plan exactly and takes off only what is still as carried. A bank operation with `seriesId` is never suggested again and is no side of a transfer (S10b). Turned-down pairs live in this browser (`finflow:plan-dismissed:<org>`).
- **Routes:** `GET|POST /api/orgs/{orgId}/recurring` (overview; create 201), `GET|PATCH|DELETE /recurring/{seriesId}`, `POST /recurring/{seriesId}/skip { occurrence }` (`{ before }`), `GET /recurring/suggestions`, `POST /recurring/matches`; writes owner and accountant, reads every member; 64 KB bodies; `RecurringError` (400 with `field`, 404, 409) in `lib/server/recurring/http.ts`, ledger codes through `toHttpError`; a path id that cannot be an id is 404.
- **Reads:** `GET /recurring` (`readOverview`) = the series, `count()` of overdue planned operations (all, not only series), the oldest 50, and the planned operations of today to the window end (at most 1500): «Наступна дата» is a series' first plan, else its first occurrence after `generatedThrough`; «Найближчі 7 днів» sums income and expense per currency. No `nextOccurrence` field.
- **UI:** module tab «Планові платежі» (`/[org]/recurring`): the strip (`recurring-overdue`, `recurring-soon-*`), the series (`series-row`, «Змінити», «Призупинити»/«Відновити», «Видалити» with the future plans choice), «Додати серію» and «Додати з пресету» (`preset-menu`, `preset-zus|pit4|vat7`: ZUS 15, PIT-4 20, VAT-7 25, estimated, next business day, the S06 counterparty), the upcoming plans as cards (`planned-row`, «Позначити сплаченою», «Перенести», «Пропустити», each with an undo toast). Journal: `overdue-chip` on a planned row whose day passed, the banner `plan-matches` and its dialog (`plan-match`). Form: `series-hint` («з серії …», the warning that a change detaches it).
- **Rollout guard:** `npm run check:recurring -- --project=finflow-e94b5` (read-only; refuses production without the flag) runs each new query shape once (due series, overdue count and list, the window, plan candidates and bank days, a series' operations and marks) and prints counts per company; a missing index shows as `FAILED_PRECONDITION`.
- **Tests:** unit `tests/unit/domain/recurring/*` (schedule incl. DST and holidays, input, documents, fill and rewrite plan, matching, overview, editor, rows, property test of daily fills), `tests/unit/domain/ledger/series.test.ts`, `tests/unit/server/recurring/*`, `tests/unit/api/recurring/routes.test.ts`, `tests/unit/api/cron/bank-sync.test.ts`, `tests/unit/api/recurring-client.test.ts`, `tests/unit/scripts/check-recurring.test.ts`; integration `tests/integration/{ledger-plan-marks,ledger-series,ledger-plan-match,recurring-read}.test.ts` (helper `recurring-helpers.ts`); rules in `tests/rules/`; e2e `tests/e2e/recurring.spec.ts` (seed `helpers/recurring-seed.ts`); screenshots `tests/ui-shots/recurring.spec.ts` (`playwright.shots.config.ts`).
```

- [ ] **Step 2: Roadmap**

`docs/superpowers/specs/2026-10-22-finflow-roadmap.md`: рядок, що починається з `| S11 | Планові й повторювані платежі, пресети ZUS/PIT/VAT, зіставлення план→факт |`, замінити на:

```
| S11 | Планові й повторювані платежі: серії з плановими операціями на 3 місяці наперед (щоденне дозаповнення в наявному щогодинному виклику), пресети ZUS/PIT-4/VAT-7, зіставлення план→факт одним кліком, «Прострочено» | L | S06, S08, S09, S09b, S10b | Розклад на 31-ше дає 28/29 лютого; перезапуск нічого не дублює; підтверджена пара не змінює баланс, `verifyLedger` чистий; див. [спеку S11](2026-11-10-s11-planned-payments-design.md) |
```

- [ ] **Step 3: Run the whole verification**

```bash
cd /f/AI/finflow && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npm run typecheck && npm run lint && npm run check:server-imports && npm run test:unit && npm run test:rules && npm run test:integration && npm run build
```

```bash
cd /f/AI/finflow && export PATH="/c/Users/Admin/.jre/temurin-21/bin:$PATH" && npx firebase emulators:exec --only auth,firestore --project demo-finflow "npm run test:e2e"
```

Expected: `tsc` чисто; `lint` 0 errors і не більше 10 попереджень; `check:server-imports` OK; unit, rules, integration PASS; збірка успішна (маршрути `/api/orgs/[orgId]/recurring/**` і сторінка `/[orgSlug]/recurring` у списку); e2e усі PASS. Записати фактичні числа (тести й файли кожного набору, час e2e) для PROGRESS.md і порівняти з базовими з шапки плану. Якщо інтеграційний прогін падає лише в `tests/integration/counterparties-write.test.ts` (відомий тайм-аут паралельного тесту S06), прогнати цей файл окремо й записати обидва результати; не виправляти його в цій гілці.

- [ ] **Step 4: PROGRESS.md**

У кінець `PROGRESS.md` (після останнього запису S10f з його «Known follow-ups») додати запис у тому ж форматі:

- заголовок `## 2026-11-10 — S11: планові й повторювані платежі`, рядок зі спекою й планом;
- **Статус:** реалізовано в гілці `s11-planned-payments`, чекає огляду й мерджа; на production нічого не розгорнуто; потрібні нові індекси (3 складені й `fieldOverrides recurring.dueOn`) і правила (`recurring`, `recurringDone`); перед злиттям: деплой індексів і `check:recurring` на production (окремі «ок» власника);
- `### Зроблено`: розклад на UTC-днях з польськими святами; серія з плановими операціями в одній транзакції; щоденне дозаповнення в щогодинному виклику з бюджетом часу, ізоляцією серій і наздоганянням; зміна серії з періодами, зайнятими позначками; позначки `recurringDone` у `commit` («Позначити сплаченою», видалення, відновлення під `pl_`); план → факт з точним скасуванням; «Пропустити»; пресети ZUS/PIT-4/VAT-7 з контрагентом S06; огляд без `nextOccurrence`; маршрути; сторінка, редактор, журнал (банер, чип), форма; `check:recurring`; відповіді на три відкриті питання спеки (розділ «Відповіді на відкриті питання» плану);
- `### Підсумок перевірок (дата, реально виміряно)`: числа з кроку 3 для `typecheck`, `lint` (errors/warnings), `check:server-imports`, unit, rules, integration, build, e2e з порівнянням із базовими (unit 2530/182, rules 144/2, integration 321/33, e2e 138, lint 10), і shots (16 зображень, що переглянуто);
- `### Не перевірено`: реальні дані production і готовність індексів (`check:recurring` ще не запускався), перший щоденний запуск на production (час відповіді маршруту з банком і серіями разом), поведінка на телефоні в реальному браузері, зіставлення з реальними банківськими текстами ZUS/US (для орієнтовних планів потрібен контрагент, який дає автоправило S10);
- `### Known follow-ups (S11)`: прапорець форми «Повторювана транзакція» (`isRecurring`) лишився без поведінки поряд із серіями (питання власнику: прибрати його або замінити на «Створити серію з операції»); undo видалення банківської операції, що сплатила план, повертає її без зв'язку `seriesId` (число лишається сплаченим); щоденний генератор обробляє до 200 серій за виклик і щонайбільше 10 с: при багатьох компаніях частина чекає наступної години; зміна дня серії рахує «зайнятим» увесь період нового розкладу (місяць для щомісячної серії), тож оплата раніше строку в іншому періоді може дати ще один план; орієнтовні плани зіставляються лише за контрагентом; суми VAT/PIT з даних (S21), прогноз і платіжний календар (S13), сповіщення про прострочене (S18) поза обсягом.

- [ ] **Step 5: Commit**

```bash
cd /f/AI/finflow && git add CLAUDE.md PROGRESS.md docs/superpowers/specs/2026-10-22-finflow-roadmap.md && git commit -m "docs(recurring): S11 planned payments in CLAUDE.md, PROGRESS.md and the roadmap

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Після реалізації (веде контролер, не субагент)

1. Огляд усієї гілки opus-рев'юером (свіжий контекст, еталон: спека, розділи плану «Відповіді на відкриті питання» і «Spec corrections», і цей план), виправлення знахідок з тестами. Окремо перевірити: кожен запис операцій іде однією транзакцією через `changeSet`/`combineChanges`/`applyChange`/`storedDoc` з аудитом; жоден шлях не створює число двічі й не губить його (створення, щоденне заповнення, паралельні заповнення, наздоганяння, зміна, пауза, відновлення, видалення, «Пропустити», видалення людиною, undo під `pl_`, підтвердження й скасування пари); позначка `recurringDone` і операція ніколи не суперечать одна одній; планові операції не потрапляють у баланси, агрегати, звіти й Календар; поведінка S10b для операцій без `seriesId` не змінилась; кожна транзакція пише менше 500 документів (найгірший випадок: `updateSeries` з `REWRITE_CAP`); клієнт не може виставити `seriesId`, `occurrence`, `estimated`, `manual` і не може створити `pl_`-операцію без позначки.
2. Візуальна перевірка: `npx firebase emulators:exec --only auth,firestore --project demo-finflow "npx playwright test --config playwright.shots.config.ts tests/ui-shots/recurring.spec.ts"` і перегляд усіх `ui-shots/recurring-*.png` на 1440 і 390 px українською й польською; оскільки змінився рядок вкладок оболонки, також `npm run ui:shots` і перегляд знімків оболонки (журнал, аналітика, налаштування) на обох ширинах.
3. `git push -u origin s11-planned-payments`, чернетка PR (тіло англійською за зразком PR #17-#22, у кінці `🤖 Generated with [Claude Code](https://claude.com/claude-code)`), зелений CI (job `ci`). Якщо в CI падає e2e, якого не видно локально, спершу розібрати його з артефактів CI (звіт Playwright, трейси, скриншоти), знайти причину, виправити з тестом і перезапустити; не перезапускати наосліп.
4. Після зеленого CI, з окремого «ок» власника: деплой ЛИШЕ індексів (додаються, нічого не змінюють у даних): `firebase deploy --only firestore:indexes --project finflow-e94b5 --account "$FIREBASE_ACCOUNT"`; дочекатися стану `READY` усіх нових індексів (консоль Firebase або `firebase firestore:indexes --project finflow-e94b5 --account "$FIREBASE_ACCOUNT"`). Потім, з окремого «ок», на production лише читання `npm run check:recurring -- --project=finflow-e94b5`. Будь-який `FAILED_PRECONDITION` або `FAILED`: зупинитись і розібратись окремим погодженим кроком. Записати лічильники.
5. **Зупинка і запит явного «ок» власника на злиття.** Далі кожен крок розгортання за окремим «ок»:
   1. Злиття PR і деплой правил: `firebase deploy --only firestore:rules --project finflow-e94b5 --account "$FIREBASE_ACCOUNT"` (нова колекція `recurring` для читання членами, `recurringDone` закрито). Міграції даних немає (операції без `seriesId` рахуються як раніше; серій ще немає).
   2. Vercel production READY; перевірка без входу: `GET /api/orgs/x/recurring`, `GET /api/orgs/x/recurring/suggestions` і `POST /api/orgs/x/recurring/matches` дають `401`; наступний щогодинний job `Bank sync` зелений (у відповіді є `recurring`, `failed: 0`); `verifyLedger` лише читання на production (власник: `POST /api/orgs/{org}/ledger/rebuild?apply=0`).
   3. Власник створює серії ZUS, PIT-4, VAT-7 (зі своїми сумами й днями) і одну звичайну (оренда), дивиться планові операції в журналі й на сторінці, підтверджує перший збіг із банком, перевіряє, що баланси банківських рахунків не змінились, а Cash Flow і P&L не показують планових операцій; пробує «Скасувати» для пари й «Пропустити»; потім ще раз `verifyLedger` лише читання.
   4. Оновити пам'ять і хаб в Obsidian.

---

## Самоперевірка плану (виконано під час написання)

- **Покриття спеки:** серія і її поля (Task 3, 6); планові операції з детермінованим id і полями серії (Task 2, 6); позначки `paid`/`skipped`/`deleted` і невідновлення (Task 5, 6, 7); генератор при створенні, зміні й щодня, ідемпотентність, паралельність (Task 6, 8, властивісний тест Task 4); щоденний виклик через `bank-sync` з частиною `recurring` і одним запуском на день (Task 8, 9); розклад: 31-ше, тиждень, N місяців, рік, кінцева дата, `weekendRule` зі святами, літній час (Task 1); зміна серії лише неоплачених і не `manual`, переписування дати під новим числом (Task 6); призупинення з вибором (Task 6, 13); видалення з вибором, за замовчуванням видалити (Task 6, 13); пропозиції: кандидати, сторона, рахунок, вікно −3/+10, сума або контрагент для `estimated`, неоднозначність, до 50, найновіші (Task 4, 8); підтвердження в одній транзакції з перенесенням полів, слідом `autoRules`, `bankSeen` без змін, аудит `via: 'plan'` (Task 7); скасування (Task 7, 11, 14); ручні дії «Позначити сплаченою» (Task 5, 12), «Перенести» → `manual` (Task 2, 12), «Пропустити» (Task 7, 12), сума → `manual` без `estimated` (Task 2); пресети ZUS 15 / PIT-4 20 / VAT-7 25, `next`, `estimated`, контрагент S06 без дублів (Task 3, 6, 13); маршрути, ролі, 64 КБ, 400/404/401, тест покриття авторизації (Task 9, 15); розділ меню, смуга, список серій, найближчі операції зі статусами (Task 12, 13); банер і діалог у журналі з `localStorage` у `try/catch`, чип «Прострочено» (Task 4, 11, 14); форма «з серії …» (Task 14); телефон 390 px (Task 12-15); правила, індекси, `check:recurring` (Task 10); тести модульні, інтеграційні, властивісний, e2e, скриншоти (Task 1-15); розгортання (розділ вище); три відкриті питання (розділ на початку).
- **Плейсхолдери:** немає «TBD»/«TODO»/«додати обробку помилок»; кожен крок з кодом має код; команди мають очікуваний результат.
- **Узгодженість імен:** `planId`/`parsePlanId`, `fillPlan`, `rewriteOccurrences`/`rewriteState`, `planInputOf`/`seriesFieldsOf`, `withSeries`/`markChangeOf`/`MarkChange`, `parsePlanSide`/`parseBankSide`/`canMatch`/`findPlanMatches`/`keyOfMatch`/`carriedOf`/`withCarried`/`withoutCarried`, `createSeries`/`fillSeries`/`updateSeries`/`deleteSeries`/`seriesOpsQuery`/`seriesMarksQuery`, `confirmMatch`/`undoMatch`/`skipOccurrence`/`MatchJob`/`MatchDone`, `readOverview`/`readSeries`/`readMatchSuggestions`/`dueSeriesQuery`, `runMatches`/`MatchLedger`, `runRecurringCron`, `toRecurringHttpError`, `recurring.{overview,get,create,update,remove,skip,suggestions,matches,cron}`, клієнт `fetchRecurringOverview`/`fetchSeries`/`fetchPlanMatches`/`createSeries`/`updateSeries`/`deleteSeries`/`skipPlan`/`confirmMatches`/`undoMatches`, дії `markPlanPaid`/`movePlan`/`skipPlanOccurrence`/`undoPlanEdit`/`undoPlanSkip`: однакові в задачах, де їх визначено й використано.

