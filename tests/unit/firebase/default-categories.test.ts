import { describe, expect, it } from 'vitest'
import { buildDefaultCategories, DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from '@/lib/firebase/default-categories'
import uk from '@/messages/uk.json'
import pl from '@/messages/pl.json'
import en from '@/messages/en.json'

const NAMES = { sales: 'Продажі', services: 'Послуги', investments: 'Інвестиції', other: 'Інше (дохід)' }

describe('buildDefaultCategories', () => {
  it('seeds exactly the income defaults (the expense defaults are defined but not seeded yet)', () => {
    const seeds = buildDefaultCategories(NAMES)
    expect(seeds.map((s) => s.name)).toEqual(['Продажі', 'Послуги', 'Інвестиції', 'Інше (дохід)'])
    expect(new Set(seeds.map((s) => s.type))).toEqual(new Set(['income']))
  })

  it('names every default from the map it is given, in the same order', () => {
    const seeds = buildDefaultCategories({ sales: 'Sprzedaż', services: 'Usługi', investments: 'Inwestycje', other: 'Inne (wpływ)' })
    expect(seeds.map((s) => s.name)).toEqual(['Sprzedaż', 'Usługi', 'Inwestycje', 'Inne (wpływ)'])
  })

  it('gives every default a unique, deterministic, path-safe document id that does not depend on the names', () => {
    const first = buildDefaultCategories(NAMES).map((s) => s.id)
    const second = buildDefaultCategories({ sales: 'a', services: 'b', investments: 'c', other: 'd' }).map((s) => s.id)
    expect(first).toEqual(['default-income-1', 'default-income-2', 'default-income-3', 'default-income-4'])
    expect(first).toEqual(second)
    expect(new Set(first).size).toBe(first.length)
    for (const id of first) expect(id).toMatch(/^default-income-[a-z0-9-]+$/)
  })

  it('keeps a colour on every default', () => {
    for (const seed of buildDefaultCategories(NAMES)) expect(seed.color).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('default category names in the catalogs', () => {
  it.each([
    ['uk', uk],
    ['pl', pl],
    ['en', en],
  ] as const)('%s names every income and expense default', (_locale, catalog) => {
    for (const { slug } of DEFAULT_INCOME_CATEGORIES) {
      expect(catalog.defaultCategories.income[slug].trim()).not.toBe('')
    }
    for (const { slug } of DEFAULT_EXPENSE_CATEGORIES) {
      expect(catalog.defaultCategories.expense[slug].trim()).not.toBe('')
    }
  })

  it('uk keeps the names the app has always seeded', () => {
    expect(buildDefaultCategories(uk.defaultCategories.income).map((s) => s.name)).toEqual(Object.values(NAMES))
  })
})
