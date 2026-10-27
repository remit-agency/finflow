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

  it.each<[unknown, string]>([['', 'empty'], ['   ', 'blank'], ['---', 'no letters or digits'], ['x'.repeat(201), 'too long'], [42, 'not a string'], [undefined, 'missing']])(
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
