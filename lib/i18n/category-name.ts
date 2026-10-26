import uk from '@/messages/uk.json'
import pl from '@/messages/pl.json'
import en from '@/messages/en.json'
import type { Category } from '@/types'

type CategoryType = Category['type']

/** A catalog key of a default category name, relative to the root of the catalog. */
export type DefaultCategoryKey =
  | `defaultCategories.income.${keyof typeof uk.defaultCategories.income}`
  | `defaultCategories.expense.${keyof typeof uk.defaultCategories.expense}`

const CATALOGS = [uk, pl, en]
const TYPES: readonly CategoryType[] = ['income', 'expense']

// Category names are plain strings in Firestore, so a company created or seeded in one language
// keeps that language's default names. A name is a default when it equals, ignoring case and
// surrounding spaces, the default name of its own type in any catalog.
function lookupKey(name: string): string {
  return name.trim().normalize('NFC').toLowerCase()
}

const SLUGS_BY_NAME: Record<CategoryType, ReadonlyMap<string, string>> = (() => {
  const result = { income: new Map<string, string>(), expense: new Map<string, string>() }
  for (const type of TYPES) {
    for (const catalog of CATALOGS) {
      for (const [slug, name] of Object.entries(catalog.defaultCategories[type])) {
        const key = lookupKey(name)
        if (!result[type].has(key)) result[type].set(key, slug)
      }
    }
  }
  return result
})()

/** The slug of the default category that `name` is a name of for `type`, or null for any other name. */
export function defaultCategorySlug(name: string, type: CategoryType): string | null {
  return SLUGS_BY_NAME[type].get(lookupKey(name)) ?? null
}

/**
 * What the UI shows for a category: a default name in the active language, any other name as
 * stored (it is user data). `t` is the translator of the root catalog (`useTranslations()`).
 */
export function localizeCategoryName(
  category: Pick<Category, 'name' | 'type'>,
  t: (key: DefaultCategoryKey) => string,
): string {
  const slug = defaultCategorySlug(category.name, category.type)
  return slug ? t(`defaultCategories.${category.type}.${slug}` as DefaultCategoryKey) : category.name
}
