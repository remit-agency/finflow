// Deterministic Polish bank rows and the rules an owner would write for them: the S10 acceptance fixture.
// Row n uses template n % 20, so every template appears 15 times; two templates are meant to stay uncategorised.
import type { Rule, RuleCondition, RuleOperation, RuleType } from '@/lib/domain/rules/types'

export const FIXTURE_ACCOUNT = 'acc-main'

interface Template {
  type: RuleType
  bankName?: (n: number) => string
  remittance: (n: number) => string
  /** The category the rules are meant to give; null when no rule is meant to catch the row. */
  expected: string | null
  amountMinor?: (n: number) => number
}

const month = (n: number): string => `${String((n % 12) + 1).padStart(2, '0')}/2026`
const CLIENTS = ['ALFA', 'BETA TRADE', 'GAMMA LOGISTYKA', 'DELTA', 'OMEGA SERWIS']

const TEMPLATES: Template[] = [
  { type: 'expense', bankName: (n) => `ORLEN STACJA NR ${100 + n}`, remittance: (n) => `Płatność kartą ORLEN ${100 + n} GDAŃSK`, expected: 'cat-fuel' },
  { type: 'expense', bankName: (n) => `BP-STACJA PALIW ${n}`, remittance: () => 'Zakup paliwa', expected: 'cat-fuel' },
  { type: 'expense', bankName: (n) => `SHELL ${n} WARSZAWA`, remittance: () => 'Płatność kartą', expected: 'cat-fuel' },
  { type: 'expense', bankName: () => 'ZAKŁAD UBEZPIECZEŃ SPOŁECZNYCH', remittance: (n) => `ZUS SKŁADKI ${month(n)}`, expected: 'cat-zus' },
  { type: 'expense', bankName: () => 'URZĄD SKARBOWY GDAŃSK', remittance: (n) => `PIT-4R ${month(n)}`, expected: 'cat-tax' },
  { type: 'expense', bankName: () => 'URZĄD SKARBOWY GDAŃSK', remittance: (n) => `VAT-7 ${month(n)}`, expected: 'cat-tax' },
  { type: 'expense', bankName: (n) => `BIEDRONKA ${3000 + n}`, remittance: () => 'Płatność kartą', expected: 'cat-shop' },
  { type: 'expense', bankName: () => 'LIDL SP. Z O.O. SP.K.', remittance: () => 'Zakupy', expected: 'cat-shop' },
  { type: 'expense', bankName: (n) => `ŻABKA Z${5000 + n}`, remittance: () => 'Płatność BLIK', expected: 'cat-shop' },
  { type: 'expense', bankName: () => 'Allegro.pl sp. z o.o.', remittance: (n) => `Allegro zamówienie ${900000 + n}`, expected: 'cat-allegro' },
  { type: 'expense', bankName: () => 'PayU S.A.', remittance: (n) => `PayU *Allegro ${n}`, expected: 'cat-allegro' },
  { type: 'expense', remittance: (n) => `Opłata za prowadzenie rachunku ${month(n)}`, expected: 'cat-bank', amountMinor: (n) => 900 + (n % 5) * 100 },
  { type: 'expense', remittance: () => 'Prowizja za przelew natychmiastowy', expected: 'cat-bank', amountMinor: () => 500 },
  { type: 'expense', bankName: () => 'NIERUCHOMOŚCI GDAŃSK SP. Z O.O.', remittance: (n) => `Czynsz za lokal ${month(n)}`, expected: 'cat-rent' },
  { type: 'expense', bankName: () => 'ORANGE POLSKA S.A.', remittance: (n) => `Faktura ${month(n)} telefon`, expected: 'cat-telecom' },
  { type: 'expense', bankName: () => 'T-MOBILE POLSKA S.A.', remittance: (n) => `Abonament ${month(n)}`, expected: 'cat-telecom' },
  { type: 'expense', bankName: (n) => `Jan Kowalski ${n}`, remittance: (n) => `Wynagrodzenie ${month(n)}`, expected: 'cat-salary' },
  {
    type: 'income',
    bankName: (n) => `${CLIENTS[n % CLIENTS.length]} SP. Z O.O.`,
    remittance: (n) => `Przelew od ${CLIENTS[n % CLIENTS.length]} SP. Z O.O. Faktura FV/${n}/2026`,
    expected: 'cat-sales',
  },
  // Nothing is meant to catch these two: a private BLIK transfer and a refund.
  { type: 'expense', bankName: (n) => `Anna Nowak ${n}`, remittance: () => 'Przelew na telefon BLIK', expected: null },
  { type: 'income', bankName: () => 'Sklep internetowy', remittance: (n) => `Zwrot nadpłaty ${n}`, expected: null },
]

export interface FixtureRow {
  op: RuleOperation
  expected: string | null
}

/** 300 rows; row n uses template n % 20. */
export function fixtureRows(): FixtureRow[] {
  return Array.from({ length: 300 }, (_, n) => {
    const template = TEMPLATES[n % TEMPLATES.length]
    const op: RuleOperation = {
      type: template.type,
      accountId: FIXTURE_ACCOUNT,
      currency: 'PLN',
      amountMinor: template.amountMinor ? template.amountMinor(n) : 1_000 + ((n * 7_919) % 500_000),
      remittance: template.remittance(n),
    }
    if (template.bankName) op.bankName = template.bankName(n)
    return { op, expected: template.expected }
  })
}

const contains = (...values: string[]): RuleCondition => ({ kind: 'text', op: 'contains', values })

function rule(order: number, id: string, name: string, type: RuleType, conditions: RuleCondition[], actions: Rule['actions']): Rule {
  return { id, name, type, active: true, order, createdAtMs: 0, conditions, actions }
}

/** Ten rules, using every kind of condition. */
export const FIXTURE_RULES: Rule[] = [
  rule(0, 'r-fuel', 'Paliwo', 'expense', [contains('ORLEN', 'BP-STACJA', 'SHELL')], { categoryId: 'cat-fuel' }),
  rule(1, 'r-zus', 'ZUS', 'expense', [contains('ZUS')], { categoryId: 'cat-zus', counterpartyId: 'system_zus' }),
  rule(2, 'r-tax', 'Podatki', 'expense', [contains('Urząd Skarbowy')], { categoryId: 'cat-tax', counterpartyId: 'system_us' }),
  rule(3, 'r-shop', 'Zakupy', 'expense', [contains('Biedronka', 'Lidl', 'Żabka')], { categoryId: 'cat-shop' }),
  rule(4, 'r-allegro', 'Allegro', 'expense', [contains('allegro'), { kind: 'text', op: 'notContains', values: ['zwrot'] }], { categoryId: 'cat-allegro' }),
  rule(5, 'r-bank', 'Opłaty bankowe', 'expense', [contains('Opłata za prowadzenie', 'Prowizja'), { kind: 'amount', currency: 'PLN', maxMinor: 5_000 }], { categoryId: 'cat-bank' }),
  rule(6, 'r-rent', 'Czynsz', 'expense', [contains('czynsz')], { categoryId: 'cat-rent' }),
  rule(7, 'r-telecom', 'Telekomunikacja', 'expense', [contains('Orange', 'T-Mobile')], { categoryId: 'cat-telecom' }),
  rule(8, 'r-salary', 'Wynagrodzenia', 'expense', [contains('wynagrodzenie'), { kind: 'account', accountIds: [FIXTURE_ACCOUNT] }], { categoryId: 'cat-salary' }),
  rule(9, 'r-sales', 'Sprzedaż', 'income', [contains('faktura', 'FV/')], { categoryId: 'cat-sales' }),
]
