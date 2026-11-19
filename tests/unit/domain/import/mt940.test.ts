import { describe, expect, it } from 'vitest'
import { normalizeSource, parseMt940 } from '@/lib/domain/import/mt940'

const GENERIC = `:20:STMT0001
:25:PL61109010140000071219812874
:28C:00001/001
:60F:C261001PLN1000,00
:61:2610021002C500,00NTRFINV12//REF0001
:86:Faktura 12/10 od Klient
:61:2610051005D120,50NTRFNONREF//REF0002
:86:Zakup materialow
:62F:C261005PLN1379,50
`

const TILDE = `:20:PL001
:25:/PL61109010140000071219812874
:28C:12/1
:60F:C261001PLN2000,00
:61:2610031003D246,00NTRFNONREF//BR1
:86:020~00PRZELEW~20Faktura FV/10/2026~21 za uslugi~32ACME SP Z O O~33WARSZAWA~3810901014000007121981
:61:2610061006C1230,00NTRFNONREF//BR2
:86:010~00PRZELEW PRZYCHODZACY~20Oplata za zamowienie 77~32KLIENT JAN KOWALSKI
:62F:C261006PLN2984,00
`

describe('parseMt940', () => {
  it('reads a plain statement', () => {
    const { statements, issues } = parseMt940(GENERIC)
    expect(issues).toEqual([])
    expect(statements).toHaveLength(1)
    const s = statements[0]
    expect(s).toMatchObject({ index: 0, source: 'PL61109010140000071219812874', number: '00001/001', currency: 'PLN', reconciliation: 0 })
    expect(s.opening).toEqual({ amountMinor: 100000, day: '2026-10-01', currency: 'PLN' })
    expect(s.closing).toEqual({ amountMinor: 137950, day: '2026-10-05', currency: 'PLN' })
    expect(s.operations).toEqual([
      { day: '2026-10-02', type: 'income', amountMinor: 50000, reference: 'REF0001', counterpartyName: null, remittance: 'Faktura 12/10 od Klient', ordinal: 0 },
      { day: '2026-10-05', type: 'expense', amountMinor: 12050, reference: 'REF0002', counterpartyName: null, remittance: 'Zakup materialow', ordinal: 0 },
    ])
  })

  it('reads the Polish ~NN dialect: name and title from the sub-fields', () => {
    const { statements, issues } = parseMt940(TILDE)
    expect(issues).toEqual([])
    const [a, b] = statements[0].operations
    expect(a).toMatchObject({ type: 'expense', amountMinor: 24600, counterpartyName: 'ACME SP Z O O WARSZAWA', remittance: 'Faktura FV/10/2026 za uslugi' })
    expect(b).toMatchObject({ type: 'income', amountMinor: 123000, counterpartyName: 'KLIENT JAN KOWALSKI', remittance: 'Oplata za zamowienie 77' })
    expect(statements[0].source).toBe('PL61109010140000071219812874')
    expect(statements[0].reconciliation).toBe(0)
  })

  it('reads the ?NN variant of the dialect', () => {
    const text = TILDE.replace(/~/g, '?')
    expect(parseMt940(text).statements[0].operations[0]).toMatchObject({ counterpartyName: 'ACME SP Z O O WARSZAWA', remittance: 'Faktura FV/10/2026 za uslugi' })
  })

  it('keeps the whole :86: text as the remittance when the dialect is unknown', () => {
    const text = GENERIC.replace('Zakup materialow', 'SOME/UNKNOWN/FORMAT 77')
    expect(parseMt940(text).statements[0].operations[1]).toMatchObject({ counterpartyName: null, remittance: 'SOME/UNKNOWN/FORMAT 77' })
  })

  it('reads reversals: RD is money back (income), RC is money out (expense)', () => {
    const text = `:20:X
:25:PL61109010140000071219812874
:60F:C261001PLN100,00
:61:261002D10,00NTRFNONREF
:61:261003RD10,00NTRFNONREF
:61:261004RC5,00NTRFNONREF
:62F:C261004PLN95,00
`
    expect(parseMt940(text).statements[0].operations.map((o) => o.type)).toEqual(['expense', 'income', 'expense'])
    expect(parseMt940(text).statements[0].reconciliation).toBe(0)
  })

  it('numbers identical lines', () => {
    const text = `:20:X
:25:PL61109010140000071219812874
:60F:C261001PLN100,00
:61:261002D5,00NTRFNONREF
:86:Kawa
:61:261002D5,00NTRFNONREF
:86:Kawa
:62F:C261002PLN90,00
`
    expect(parseMt940(text).statements[0].operations.map((o) => o.ordinal)).toEqual([0, 1])
  })

  it('reads several statements and a negative (D) balance', () => {
    const text = `${GENERIC}${GENERIC.replace('STMT0001', 'STMT0002').replace('C261001PLN1000,00', 'D261001PLN100,00').replace('C261005PLN1379,50', 'C261005PLN279,50')}`
    const { statements } = parseMt940(text)
    expect(statements.map((s) => s.index)).toEqual([0, 1])
    expect(statements[1].opening?.amountMinor).toBe(-10000)
    expect(statements[1].reconciliation).toBe(0)
  })

  it('strips a SWIFT envelope', () => {
    const text = `{1:F01BANKPLPWAXXX0000000000}{2:O9401200261005BANKPLPWAXXX00000000002610051200N}{4:\n${GENERIC}-}`
    expect(parseMt940(text).statements).toHaveLength(1)
  })

  it('keeps the good statement when a :61: line is broken, and says where', () => {
    const text = GENERIC.replace('2610051005D120,50NTRFNONREF//REF0002', 'garbage')
    const { statements, issues } = parseMt940(text)
    expect(statements[0].operations).toHaveLength(1)
    expect(issues).toEqual([{ code: 'bad_61', line: 7, tag: '61' }])
    expect(statements[0].reconciliation).not.toBe(0)
  })

  it('says no_statement for text that is not MT940', () => {
    expect(parseMt940('hello,world\n1,2').issues).toEqual([{ code: 'no_statement', line: 1 }])
    expect(parseMt940('').statements).toEqual([])
  })

  it('moves a booking date across the year end', () => {
    const text = `:20:X\n:25:PL61109010140000071219812874\n:60F:C261230PLN100,00\n:61:2612300102C5,00NTRFNONREF\n:62F:C270102PLN105,00\n`
    expect(parseMt940(text).statements[0].operations[0].day).toBe('2027-01-02')
  })
})

describe('normalizeSource', () => {
  it('makes an IBAN of an NRB, a slash form and spaced text', () => {
    expect(normalizeSource('61109010140000071219812874')).toBe('PL61109010140000071219812874')
    expect(normalizeSource('/PL61 1090 1014 0000 0712 1981 2874')).toBe('PL61109010140000071219812874')
    expect(normalizeSource('10901014/0000071219812874')).toBe('109010140000071219812874')
  })
})
