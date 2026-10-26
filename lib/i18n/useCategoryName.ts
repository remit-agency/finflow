'use client'

import { useCallback } from 'react'
import { useTranslations } from 'next-intl'
import type { Category } from '@/types'
import { localizeCategoryName } from './category-name'

/** The category name as the UI shows it (client components): a default name in the active language. */
export function useCategoryName(): (category: Pick<Category, 'name' | 'type'>) => string {
  const t = useTranslations()
  return useCallback((category) => localizeCategoryName(category, t), [t])
}
