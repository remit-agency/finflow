import { describe, expect, it } from 'vitest'
import { matchColumns } from '@/lib/domain/import/finmap/columns'

// Synthetic header in the order of the export, written with plain Polish names (not the owner's file).
const PLAIN = [
  'Data płatności', 'Data zaksięgowania', 'Okres księgowania – data od', 'Okres księgowania – data do',
  'Kwota w walucie konta', 'Kwota w walucie firmy', 'Z konta', 'Na konto',
  'Kategoria', 'Podkategoria', 'Kontrahent', 'Podkontrahent', 'Projekt', 'Podprojekt', 'Tagi', 'Komentarz',
]

// Latin letters replaced by their Cyrillic look-alikes (explicit escapes, so the test does not depend on the editor).
const LOOKALIKE: Record<string, string> = {
  a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', k: 'к', i: 'і',
  A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', I: 'І', K: 'К', M: 'М',
  O: 'О', P: 'Р', T: 'Т', X: 'Х',
}
const swapToLookalikes = (s: string) => [...s].map((ch) => LOOKALIKE[ch] ?? ch).join('')

describe('matchColumns', () => {
  it('finds all 16 columns of a plain header, by position', () => {
    const { map, missing } = matchColumns(PLAIN)
    expect(missing).toEqual([])
    expect(Object.keys(map)).toHaveLength(16)
    expect(map.paymentDate).toBe(0)
    expect(map.bookingDate).toBe(1)
    expect(map.periodFrom).toBe(2)
    expect(map.periodTo).toBe(3)
    expect(map.amountAccount).toBe(4)
    expect(map.amountCompany).toBe(5)
    expect(map.from).toBe(6)
    expect(map.to).toBe(7)
    expect(map.comment).toBe(15)
  })

  it('finds the same columns when letters are Cyrillic look-alikes', () => {
    const header = PLAIN.map(swapToLookalikes)
    expect(header[0]).not.toBe(PLAIN[0])
    const { map, missing } = matchColumns(header)
    expect(missing).toEqual([])
    expect(map).toEqual(matchColumns(PLAIN).map)
  })

  it('reports a missing required column', () => {
    const header = PLAIN.filter((h) => h !== 'Z konta')
    expect(matchColumns(header).missing).toEqual(['from'])
  })

  it('reports every missing required column', () => {
    const header = PLAIN.filter((h) => h !== 'Data płatności' && h !== 'Na konto')
    expect(matchColumns(header).missing).toEqual(['paymentDate', 'to'])
  })

  it('leaves optional columns out of the map when they are absent', () => {
    const header = PLAIN.filter((h) => h !== 'Komentarz')
    const { map, missing } = matchColumns(header)
    expect(missing).toEqual([])
    expect(map.comment).toBeUndefined()
  })
})
