import { createTranslator } from 'use-intl'
import { describe, expect, it } from 'vitest'
import en from '@/messages/en.json'
import pl from '@/messages/pl.json'
import uk from '@/messages/uk.json'

type Translate = (key: string, values: { count: number }) => string
const title = (locale: 'en' | 'pl' | 'uk', messages: object, count: number): string =>
  (createTranslator({ locale, messages, namespace: 'journal.delete' } as never) as unknown as Translate)('title', { count })

describe('journal.delete.title', () => {
  it('is plural-correct in English', () => {
    expect(title('en', en, 1)).toBe('Delete 1 operation?')
    expect(title('en', en, 2)).toBe('Delete 2 operations?')
    expect(title('en', en, 0)).toBe('Delete 0 operations?')
  })

  it('is plural-correct in Polish', () => {
    expect(title('pl', pl, 1)).toBe('Usunąć 1 operację?')
    expect(title('pl', pl, 3)).toBe('Usunąć 3 operacje?')
    expect(title('pl', pl, 5)).toBe('Usunąć 5 operacji?')
    expect(title('pl', pl, 22)).toBe('Usunąć 22 operacje?')
  })

  it('reads «Видалити операцій: N?» for every count in Ukrainian (a colon needs no plural form)', () => {
    for (const n of [1, 2, 5, 21]) expect(title('uk', uk, n)).toBe(`Видалити операцій: ${n}?`)
  })
})
