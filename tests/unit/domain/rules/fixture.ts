// The S10 acceptance fixture: 300 deterministic Polish bank rows of a small business and the 10 rules its owner writes.
//
// The statement is built like a real one, not like a rotation over templates:
// - recurring vendors with uneven frequency: fuel and shops dominate, the tax office, rent and bills come monthly;
// - operations only a specific rule catches: the income invoices (FV/), the salary (a wage and an account), the bank
//   fees (an amount), the Allegro purchases (not the refunds);
// - a long tail of 44 one-off counterparties that no rule covers (42 generated companies and private persons, plus
//   two named ones that are negatives for the substring hazards below);
// - negative rows that must not be miscategorised: the PKO BP bank fees (BP inside a bank name), BPH leasing (BP inside
//   a word), a shop named ZUSZKA (ZUS inside a word), an Allegro refund (the rule excludes «zwrot»), an income refund.
//
// The fuel rule uses «BP STACJA», not the bare «BP» of the spec's example: a bare BP is a substring test and hits
// «PKO BP» and «BPH» (see substring.test.ts). Nothing here is random: the rows are a fixed permutation of the list below.
import type { Rule, RuleCondition, RuleOperation, RuleType } from '@/lib/domain/rules/types'

export const FIXTURE_ACCOUNT = 'acc-main'
export const FIXTURE_ROWS = 300

interface Spec {
  /** What the row is, for the message of a failed expectation. */
  label: string
  count: number
  type: RuleType
  bankName?: (k: number) => string
  remittance: (k: number) => string
  amountMinor?: (k: number) => number
  /** The category the rules are meant to give; null when no rule is meant to catch the row. */
  expected: string | null
  /** A one-off counterparty: nothing in the statement repeats it. */
  oneOff?: boolean
}

const month = (k: number): string => `${String((k % 12) + 1).padStart(2, '0')}/2026`
const CLIENTS = ['ALFA', 'BETA TRADE', 'GAMMA LOGISTYKA', 'DELTA', 'OMEGA SERWIS']
const EMPLOYEES = ['Jan Kowalski', 'Ewa Nowicka']

// Names for the one-off counterparties: the k-th is distinct from every other one for k < 42 (see oneOffName).
const FIRST = ['Adam', 'Barbara', 'Cezary', 'Dorota', 'Eryk', 'Grażyna', 'Halina', 'Igor', 'Jolanta', 'Krzysztof', 'Lucyna', 'Marek', 'Natalia', 'Oskar', 'Patryk', 'Renata', 'Sebastian', 'Tomasz', 'Wiktor', 'Zofia']
const LAST = ['Wójcik', 'Kamiński', 'Lewandowski', 'Zieliński', 'Szymański', 'Woźniak', 'Dąbrowski', 'Kozłowski', 'Jankowski', 'Mazur', 'Kwiatkowski', 'Krawczyk', 'Piotrowski', 'Grabowski', 'Nowakowski', 'Pawłowski', 'Michalski', 'Król', 'Wieczorek', 'Jabłoński', 'Adamczyk']
const KINDS = ['Hurtownia', 'Warsztat', 'Pracownia']
const WORDS = ['Bałtyk', 'Tatry', 'Mazury', 'Orzeł', 'Lipa', 'Dąb', 'Klon', 'Wisła', 'Odra', 'Sokół', 'Jantar', 'Bursztyn', 'Kaszuby', 'Pomorze', 'Beskid', 'Sudety', 'Łabędź', 'Kormoran', 'Jodła', 'Sosna', 'Brzoza', 'Modrzew']

/** The k-th one-off: a private person for even k (the pair of first and last name), a company for odd k. */
function oneOffName(k: number): string {
  if (k % 2 === 0) return `${FIRST[(k / 2) % 20]} ${LAST[(k / 2) % 21]}`
  return `${KINDS[k % 3]} ${WORDS[k % 22]}`
}

const RECURRING: Spec[] = [
  // Fuel: three networks, ORLEN dominates.
  { label: 'fuel ORLEN', count: 40, type: 'expense', bankName: (k) => `ORLEN STACJA NR ${100 + k}`, remittance: (k) => `Płatność kartą ORLEN ${100 + k} GDAŃSK`, expected: 'cat-fuel' },
  { label: 'fuel BP', count: 16, type: 'expense', bankName: (k) => `BP-STACJA PALIW ${k}`, remittance: () => 'Zakup paliwa', expected: 'cat-fuel' },
  { label: 'fuel SHELL', count: 10, type: 'expense', bankName: (k) => `SHELL ${k} WARSZAWA`, remittance: () => 'Płatność kartą', expected: 'cat-fuel' },
  // Shops.
  { label: 'shop BIEDRONKA', count: 30, type: 'expense', bankName: (k) => `BIEDRONKA ${3000 + k}`, remittance: () => 'Płatność kartą', expected: 'cat-shop' },
  { label: 'shop LIDL', count: 14, type: 'expense', bankName: () => 'LIDL SP. Z O.O. SP.K.', remittance: () => 'Zakupy', expected: 'cat-shop' },
  { label: 'shop ŻABKA', count: 12, type: 'expense', bankName: (k) => `ŻABKA Z${5000 + k}`, remittance: () => 'Płatność BLIK', expected: 'cat-shop' },
  // Monthly: ZUS, the tax office, rent, telecoms and the bank.
  { label: 'ZUS', count: 12, type: 'expense', bankName: () => 'ZAKŁAD UBEZPIECZEŃ SPOŁECZNYCH', remittance: (k) => `ZUS SKŁADKI ${month(k)}`, expected: 'cat-zus' },
  { label: 'tax PIT-4R', count: 4, type: 'expense', bankName: () => 'URZĄD SKARBOWY GDAŃSK', remittance: (k) => `PIT-4R ${month(k)}`, expected: 'cat-tax' },
  { label: 'tax VAT-7', count: 4, type: 'expense', bankName: () => 'URZĄD SKARBOWY GDAŃSK', remittance: (k) => `VAT-7 ${month(k)}`, expected: 'cat-tax' },
  { label: 'Allegro purchase', count: 8, type: 'expense', bankName: () => 'Allegro.pl sp. z o.o.', remittance: (k) => `Allegro zamówienie ${900_000 + k}`, expected: 'cat-allegro' },
  { label: 'rent', count: 12, type: 'expense', bankName: () => 'NIERUCHOMOŚCI GDAŃSK SP. Z O.O.', remittance: (k) => `Czynsz za lokal ${month(k)}`, expected: 'cat-rent' },
  { label: 'telecom Orange', count: 6, type: 'expense', bankName: () => 'ORANGE POLSKA S.A.', remittance: (k) => `Faktura ${month(k)} telefon`, expected: 'cat-telecom' },
  { label: 'telecom T-Mobile', count: 6, type: 'expense', bankName: () => 'T-MOBILE POLSKA S.A.', remittance: (k) => `Abonament ${month(k)}`, expected: 'cat-telecom' },
  // The bank's own fees: «PKO BP» must not reach the fuel rule.
  { label: 'bank account fee', count: 12, type: 'expense', bankName: () => 'PKO BP S.A.', remittance: (k) => `Opłata za prowadzenie rachunku ${month(k)}`, amountMinor: (k) => 900 + (k % 5) * 100, expected: 'cat-bank' },
  { label: 'bank transfer fee', count: 6, type: 'expense', bankName: () => 'PKO BP S.A.', remittance: () => 'Prowizja za przelew natychmiastowy', amountMinor: () => 500, expected: 'cat-bank' },
  // Wages: a wage in the statement of the company's account.
  { label: 'salary', count: 6, type: 'expense', bankName: () => EMPLOYEES[0], remittance: (k) => `Wynagrodzenie ${month(k)}`, expected: 'cat-salary' },
  { label: 'salary', count: 6, type: 'expense', bankName: () => EMPLOYEES[1], remittance: (k) => `Wynagrodzenie ${month(k)}`, expected: 'cat-salary' },
  // Income: the invoices of five clients.
  {
    label: 'client invoice',
    count: 48,
    type: 'income',
    bankName: (k) => `${CLIENTS[k % CLIENTS.length]} SP. Z O.O.`,
    remittance: (k) => `Przelew od ${CLIENTS[k % CLIENTS.length]} SP. Z O.O. Faktura FV/${k}/2026`,
    expected: 'cat-sales',
  },
]

const NEGATIVE: Spec[] = [
  // Uncovered on purpose: the rule «Allegro» does not take a refund, and a shop's refund is not a sale.
  { label: 'Allegro refund (excluded by «zwrot»)', count: 2, type: 'expense', bankName: () => 'Allegro.pl sp. z o.o.', remittance: (k) => `Allegro zwrot należności ${k}`, expected: null },
  { label: 'income refund', count: 2, type: 'income', bankName: () => 'Sklep internetowy', remittance: (k) => `Zwrot nadpłaty ${k}`, expected: null },
]

const ONE_OFFS: Spec[] = [
  { label: 'one-off (BP inside BPH)', count: 1, type: 'expense', oneOff: true, bankName: () => 'BPH LEASING S.A.', remittance: () => 'Rata leasingu 10/2026', expected: null },
  { label: 'one-off (ZUS inside ZUSZKA)', count: 1, type: 'expense', oneOff: true, bankName: () => 'KWIACIARNIA ZUSZKA', remittance: () => 'Kwiaty na biuro', expected: null },
  { label: 'one-off person or company', count: 42, type: 'expense', oneOff: true, bankName: (k) => oneOffName(k), remittance: () => 'Płatność kartą', expected: null },
]

const SPECS: Spec[] = [...RECURRING, ...NEGATIVE, ...ONE_OFFS]

export interface FixtureRow {
  op: RuleOperation
  /** The category the rules must give, or null when they must give none. */
  expected: string | null
  /** The row is a one-off counterparty (it appears once in the statement). */
  oneOff: boolean
  label: string
}

/** A fixed permutation of the rows: 113 is prime and does not divide 300, so every row appears once. */
const ORDER_STRIDE = 113

/** The fixture rows in statement order. Every amount and text is a function of its template and its number, never of chance. */
export function fixtureRows(): FixtureRow[] {
  const entries: Array<{ spec: Spec; k: number }> = []
  for (const spec of SPECS) for (let k = 0; k < spec.count; k++) entries.push({ spec, k })
  if (entries.length !== FIXTURE_ROWS) throw new Error(`the fixture has ${entries.length} rows, not ${FIXTURE_ROWS}`)
  return Array.from({ length: FIXTURE_ROWS }, (_, i) => {
    const { spec, k } = entries[(i * ORDER_STRIDE) % FIXTURE_ROWS]
    const op: RuleOperation = {
      type: spec.type,
      accountId: FIXTURE_ACCOUNT,
      currency: 'PLN',
      amountMinor: spec.amountMinor ? spec.amountMinor(k) : 1_000 + ((i * 7_919) % 500_000),
      remittance: spec.remittance(k),
    }
    if (spec.bankName) op.bankName = spec.bankName(k)
    return { op, expected: spec.expected, oneOff: spec.oneOff === true, label: spec.label }
  })
}

const contains = (...values: string[]): RuleCondition => ({ kind: 'text', op: 'contains', values })

function rule(order: number, id: string, name: string, type: RuleType, conditions: RuleCondition[], actions: Rule['actions']): Rule {
  return { id, name, type, active: true, order, createdAtMs: 0, conditions, actions }
}

/**
 * Ten rules, using every kind of condition. The fuel rule's words are «ORLEN», «BP STACJA» and «SHELL»: the owner writes
 * the station's name, not the two letters (a bare «BP» would also match «PKO BP» and «BPH»; see substring.test.ts).
 */
export const FIXTURE_RULES: Rule[] = [
  rule(0, 'r-fuel', 'Paliwo', 'expense', [contains('ORLEN', 'BP STACJA', 'SHELL')], { categoryId: 'cat-fuel' }),
  rule(1, 'r-zus', 'ZUS', 'expense', [contains('ZUS SKŁADKI', 'ZAKŁAD UBEZPIECZEŃ')], { categoryId: 'cat-zus', counterpartyId: 'system_zus' }),
  rule(2, 'r-tax', 'Podatki', 'expense', [contains('Urząd Skarbowy')], { categoryId: 'cat-tax', counterpartyId: 'system_us' }),
  rule(3, 'r-shop', 'Zakupy', 'expense', [contains('Biedronka', 'Lidl', 'Żabka')], { categoryId: 'cat-shop' }),
  rule(4, 'r-allegro', 'Allegro', 'expense', [contains('allegro'), { kind: 'text', op: 'notContains', values: ['zwrot'] }], { categoryId: 'cat-allegro' }),
  rule(5, 'r-bank', 'Opłaty bankowe', 'expense', [contains('Opłata za prowadzenie', 'Prowizja'), { kind: 'amount', currency: 'PLN', maxMinor: 5_000 }], { categoryId: 'cat-bank' }),
  rule(6, 'r-rent', 'Czynsz', 'expense', [contains('czynsz')], { categoryId: 'cat-rent' }),
  rule(7, 'r-telecom', 'Telekomunikacja', 'expense', [contains('Orange', 'T-Mobile')], { categoryId: 'cat-telecom' }),
  rule(8, 'r-salary', 'Wynagrodzenia', 'expense', [contains('wynagrodzenie'), { kind: 'account', accountIds: [FIXTURE_ACCOUNT] }], { categoryId: 'cat-salary' }),
  rule(9, 'r-sales', 'Sprzedaż', 'income', [contains('faktura', 'FV/')], { categoryId: 'cat-sales' }),
]
