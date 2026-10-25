import type { Category } from '@/types'

// The display names live in the message catalogs (`defaultCategories.income.<slug>` and
// `defaultCategories.expense.<slug>`); the slug is the stable key and the colour is the only
// language-independent part.
export const DEFAULT_INCOME_CATEGORIES = [
  { slug: 'sales', color: '#22c55e' },
  { slug: 'services', color: '#16a34a' },
  { slug: 'investments', color: '#4ade80' },
  { slug: 'other', color: '#86efac' },
] as const

// Defined but not seeded yet: seedDefaultCategories has only ever created the income defaults,
// and this keeps that behaviour as it is.
export const DEFAULT_EXPENSE_CATEGORIES = [
  { slug: 'salary', color: '#ef4444' },
  { slug: 'rent', color: '#dc2626' },
  { slug: 'marketing', color: '#f87171' },
  { slug: 'utilities', color: '#fca5a5' },
  { slug: 'equipment', color: '#fb923c' },
  { slug: 'taxes', color: '#f97316' },
  { slug: 'other', color: '#fdba74' },
] as const

export type DefaultIncomeSlug = (typeof DEFAULT_INCOME_CATEGORIES)[number]['slug']

/** The income default names in the language that is active when the company is seeded, by slug. */
export type DefaultCategoryNames = Readonly<Record<string, string>>

export type DefaultCategorySeed = Pick<Category, 'name' | 'color' | 'type'> & { id: string }

/**
 * The categories a new organization starts with, each with a deterministic document id.
 * Writing them with setDoc makes seeding idempotent: two concurrent seeds (React StrictMode
 * double effects, two tabs) write the same documents instead of adding duplicates.
 * `names` maps each income slug to its display name (the caller reads them from the catalog).
 */
export function buildDefaultCategories(names: DefaultCategoryNames): DefaultCategorySeed[] {
  return DEFAULT_INCOME_CATEGORIES.map((c, index) => ({
    name: names[c.slug] ?? c.slug,
    color: c.color,
    id: `default-income-${index + 1}`,
    type: 'income' as const,
  }))
}
