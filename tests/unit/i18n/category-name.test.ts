import { describe, expect, it } from 'vitest'
import uk from '@/messages/uk.json'
import pl from '@/messages/pl.json'
import en from '@/messages/en.json'
import { defaultCategorySlug, localizeCategoryName } from '@/lib/i18n/category-name'

type Type = 'income' | 'expense'
const TYPES: Type[] = ['income', 'expense']
const catalogs = { uk, pl, en }

// A stand-in for useTranslations(): resolves a root catalog key in the "active" catalog.
function translator(catalog: typeof pl) {
  return (key: string): string => {
    let node: unknown = catalog
    for (const part of key.split('.')) node = (node as Record<string, unknown>)[part]
    if (typeof node !== 'string') throw new Error(`missing key ${key}`)
    return node
  }
}

describe('defaultCategorySlug', () => {
  for (const [lang, catalog] of Object.entries(catalogs)) {
    for (const type of TYPES) {
      for (const [slug, name] of Object.entries(catalog.defaultCategories[type])) {
        it(`${lang} ${type} «${name}» is the default "${slug}"`, () => {
          expect(defaultCategorySlug(name, type)).toBe(slug)
        })
      }
    }
  }

  it('the same name in two catalogs of one type never points at two slugs', () => {
    for (const type of TYPES) {
      const seen = new Map<string, string>()
      for (const catalog of Object.values(catalogs)) {
        for (const [slug, name] of Object.entries(catalog.defaultCategories[type])) {
          const key = name.trim().toLowerCase()
          expect(seen.get(key) ?? slug).toBe(slug)
          seen.set(key, slug)
        }
      }
    }
  })

  it('ignores case and surrounding whitespace', () => {
    expect(defaultCategorySlug(`  ${pl.defaultCategories.expense.rent.toUpperCase()}\t`, 'expense')).toBe('rent')
    expect(defaultCategorySlug(` ${en.defaultCategories.expense.rent.toLowerCase()} `, 'expense')).toBe('rent')
    expect(defaultCategorySlug(uk.defaultCategories.income.sales.toUpperCase(), 'income')).toBe('sales')
  })

  it('does not match a default of the other type', () => {
    expect(defaultCategorySlug(uk.defaultCategories.expense.rent, 'income')).toBeNull()
    expect(defaultCategorySlug(uk.defaultCategories.income.sales, 'expense')).toBeNull()
  })

  it('does not match a name that merely contains or differs from a default', () => {
    expect(defaultCategorySlug('My shop', 'income')).toBeNull()
    expect(defaultCategorySlug(`${en.defaultCategories.expense.rent} office`, 'expense')).toBeNull()
    expect(defaultCategorySlug('', 'expense')).toBeNull()
    expect(defaultCategorySlug('   ', 'income')).toBeNull()
  })
})

describe('localizeCategoryName', () => {
  const t = translator(pl)

  it('shows a default in the active language, whichever catalog it was stored from', () => {
    expect(localizeCategoryName({ name: uk.defaultCategories.expense.rent, type: 'expense' }, t)).toBe(
      pl.defaultCategories.expense.rent,
    )
    expect(localizeCategoryName({ name: en.defaultCategories.expense.rent, type: 'expense' }, t)).toBe(
      pl.defaultCategories.expense.rent,
    )
    expect(localizeCategoryName({ name: uk.defaultCategories.income.sales, type: 'income' }, t)).toBe(
      pl.defaultCategories.income.sales,
    )
  })

  it('follows the active language', () => {
    const stored = { name: uk.defaultCategories.expense.rent, type: 'expense' as const }
    expect(localizeCategoryName(stored, translator(en))).toBe(en.defaultCategories.expense.rent)
    expect(localizeCategoryName(stored, translator(uk))).toBe(uk.defaultCategories.expense.rent)
  })

  it('leaves a default name of the other type as stored', () => {
    const name = uk.defaultCategories.expense.rent
    expect(localizeCategoryName({ name, type: 'income' }, t)).toBe(name)
  })

  it('leaves user data as stored, spaces included', () => {
    expect(localizeCategoryName({ name: 'My shop', type: 'income' }, t)).toBe('My shop')
    expect(localizeCategoryName({ name: ' My shop ', type: 'expense' }, t)).toBe(' My shop ')
  })
})
