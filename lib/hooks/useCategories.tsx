'use client'

import { useEffect, useRef, useState } from 'react'
import { getCategories, seedDefaultCategories } from '@/lib/firebase/categories'
import type { DefaultCategoryNames } from '@/lib/firebase/default-categories'
import type { Category } from '@/types'

interface UseCategoriesResult {
  incomeCategories: Category[]
  expenseCategories: Category[]
  loading: boolean
  error: string | null
}

const EMPTY_CATEGORIES: Category[] = []

interface UseCategoriesOptions {
  /**
   * Create the default categories when the company has none. Only a caller who may write data can
   * (the rules refuse everyone else), so a viewer passes false and never even tries.
   */
  seed?: boolean
  /**
   * Display names of the default categories in the active UI language (slug -> name). Seeding
   * needs them: without names nothing is seeded. Switching the language later does not re-seed or
   * rename anything; the categories keep the language they were created in.
   */
  names?: DefaultCategoryNames
}

export function useCategories(orgId: string | null, { seed = true, names }: UseCategoriesOptions = {}): UseCategoriesResult {
  // The data is stored with the company it belongs to, so a company switch never shows the
  // previous company's categories while the new subscription waits for its first snapshot.
  const [snapshot, setSnapshot] = useState<{ orgId: string; categories: Category[] } | null>(null)
  const [error] = useState<string | null>(null)

  // The seeding effect reads the latest names without depending on them, so a language switch
  // neither re-subscribes nor seeds again. (Declared first: effects run in declaration order.)
  const namesRef = useRef(names)
  useEffect(() => {
    namesRef.current = names
  })

  useEffect(() => {
    if (!orgId) return

    // Seed defaults on first load
    const seedNames = namesRef.current
    if (seed && seedNames) {
      seedDefaultCategories(orgId, seedNames).catch(() => {
        // silently ignore if already seeded
      })
    }

    const unsub = getCategories(orgId, (data) => {
      setSnapshot({ orgId, categories: data })
    })
    return () => {
      unsub()
    }
  }, [orgId, seed])

  const current = orgId !== null && snapshot?.orgId === orgId
  const loading = orgId !== null && !current
  const categories = current ? snapshot.categories : EMPTY_CATEGORIES

  const incomeCategories = categories.filter((c) => c.type === 'income')
  const expenseCategories = categories.filter((c) => c.type === 'expense')

  return { incomeCategories, expenseCategories, loading, error }
}
