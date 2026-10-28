// tests/unit/domain/journal/csv.test.ts
import { describe, expect, it } from 'vitest'
import { buildCsv, csvCell, EXPORT_COLUMNS, exportRow, formatAmount } from '@/lib/domain/journal/csv'
import type { JournalRow } from '@/lib/domain/journal/types'

describe('formatAmount', () => {
  it('writes minor units with the chosen decimal sign and no thousands separator', () => {
    expect(formatAmount(123456, ',')).toBe('1234,56')
    expect(formatAmount(-5, '.')).toBe('-0.05')
    expect(formatAmount(0, ',')).toBe('0,00')
    expect(formatAmount(100, ',')).toBe('1,00')
  })
})

describe('csvCell', () => {
  it('quotes a cell with a delimiter, quote or newline', () => {
    expect(csvCell('a;b')).toBe('"a;b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"')
  })
  it('defuses formulas', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvCell('+48 123')).toBe("'+48 123")
    expect(csvCell('-x')).toBe("'-x")
    expect(csvCell('@cmd')).toBe("'@cmd")
    expect(csvCell('\tx')).toBe("'\tx")
  })
  it('leaves plain text alone', () => {
    expect(csvCell('Faktura 12')).toBe('Faktura 12')
  })
  it('leaves a signed amount alone, so an expense stays a number in the sheet', () => {
    expect(csvCell('-123,45')).toBe('-123,45')
    expect(csvCell('-0.05')).toBe('-0.05')
  })
})

describe('buildCsv', () => {
  it('starts with a BOM, uses ; and CRLF', () => {
    expect(buildCsv(['a', 'b'], [['1', '2;3']])).toBe('﻿a;b\r\n1;"2;3"\r\n')
  })
})

const ctx = {
  decimal: ',' as const,
  accountName: (id: string) => ({ a1: 'Konto', a2: 'Kasa' })[id] ?? id,
  categoryName: (id: string) => ({ k1: 'Czynsz' })[id] ?? id,
  counterpartyName: (id: string) => ({ c1: 'ZUS' })[id] ?? id,
  statusLabel: (s: string) => (s === 'actual' ? 'Faktyczna' : 'Planowana'),
  typeLabel: (t: string) => t,
  baseCurrency: 'PLN',
}

const row = (tx: Partial<JournalRow['tx']>, balanceAfterMinor: number | null = 5_000): JournalRow => ({
  tx: {
    id: 't',
    type: 'expense',
    status: 'actual',
    accountId: 'a1',
    amountMinor: 12_345,
    currency: 'PLN',
    paymentDate: '2026-10-10',
    accrual: { mode: 'date', date: '2026-10-10' },
    isRecurring: false,
    tags: [],
    fileUrls: [],
    ...tx,
  },
  balanceAfterMinor,
})

describe('exportRow', () => {
  it('has one cell per column', () => {
    expect(exportRow(row({}), ctx)).toHaveLength(EXPORT_COLUMNS.length)
  })
  it('an expense is negative, with both accrual bounds equal to the day', () => {
    const cells = Object.fromEntries(EXPORT_COLUMNS.map((c, i) => [c, exportRow(row({ categoryId: 'k1', counterpartyId: 'c1', description: 'x' }), ctx)[i]]))
    expect(cells).toMatchObject({
      paymentDate: '2026-10-10',
      accrualFrom: '2026-10-10',
      accrualTo: '2026-10-10',
      status: 'Faktyczna',
      account: 'Konto',
      category: 'Czynsz',
      counterparty: 'ZUS',
      comment: 'x',
      amount: '-123,45',
      currency: 'PLN',
      amountBase: '-123,45',
      balanceAfter: '50,00',
    })
  })
  it('a period fills both bounds; a planned row has no balance', () => {
    const cells = exportRow(row({ status: 'planned', accrual: { mode: 'period', from: '2026-10-01', to: '2026-12-31' } }, null), ctx)
    expect(cells[EXPORT_COLUMNS.indexOf('accrualFrom')]).toBe('2026-10-01')
    expect(cells[EXPORT_COLUMNS.indexOf('accrualTo')]).toBe('2026-12-31')
    expect(cells[EXPORT_COLUMNS.indexOf('balanceAfter')]).toBe('')
  })
  it('a foreign-currency income carries the PLN amount and the rate', () => {
    const cells = exportRow(
      row({
        type: 'income',
        currency: 'EUR',
        amountMinor: 10_000,
        base: { payment: 42_310, accrual: 42_310 },
        fx: { payment: { rate: 4.231, from: 'EUR', to: 'PLN', requestedDate: '2026-10-10', rateDate: '2026-10-09', tableNo: '1/A/NBP', source: 'NBP_A' } },
      }),
      ctx,
    )
    expect(cells[EXPORT_COLUMNS.indexOf('amount')]).toBe('100,00')
    expect(cells[EXPORT_COLUMNS.indexOf('amountBase')]).toBe('423,10')
    expect(cells[EXPORT_COLUMNS.indexOf('rate')]).toBe('4,231')
    expect(cells[EXPORT_COLUMNS.indexOf('rateDate')]).toBe('2026-10-09')
  })
  it('a transfer is the outgoing amount and names both accounts', () => {
    const cells = exportRow(row({ type: 'transfer', toAccountId: 'a2', toAmountMinor: 12_345, toCurrency: 'PLN' }), ctx)
    expect(cells[EXPORT_COLUMNS.indexOf('amount')]).toBe('-123,45')
    expect(cells[EXPORT_COLUMNS.indexOf('toAccount')]).toBe('Kasa')
    expect(cells[EXPORT_COLUMNS.indexOf('amountBase')]).toBe('')
  })
})
