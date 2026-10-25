'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { doc, deleteDoc } from 'firebase/firestore'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useShell } from '@/lib/hooks/useShell'
import { createCategory } from '@/lib/firebase/categories'
import { db } from '@/lib/firebase/firebase'
import { cn } from '@/lib/utils'
import type { Category } from '@/types'

// Colours a user can give a category. Stored on the category document: data, not styling.
const CATEGORY_COLORS = [
  '#22c55e', '#16a34a', '#4ade80', '#86efac',
  '#ef4444', '#dc2626', '#f87171', '#fca5a5',
  '#3b82f6', '#6366f1', '#a855f7', '#f59e0b',
  '#f97316', '#06b6d4', '#00c896', '#6b7280',
]

export default function CategoriesSettingsPage() {
  const t = useTranslations('settings.categories')
  const params = useParams()
  const orgId = params.orgSlug as string
  const { incomeCategories, expenseCategories, can } = useShell()
  const canEdit = can('data.write')

  const [newCatName, setNewCatName] = useState('')
  const [newCatType, setNewCatType] = useState<'income' | 'expense'>('income')
  const [newCatColor, setNewCatColor] = useState(CATEGORY_COLORS[0])
  const [addingCat, setAddingCat] = useState(false)

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCatName.trim()) return
    setAddingCat(true)
    try {
      await createCategory(orgId, { name: newCatName.trim(), type: newCatType, color: newCatColor })
      setNewCatName('')
      toast.success(t('added'))
    } catch {
      toast.error(t('failed'))
    } finally {
      setAddingCat(false)
    }
  }

  const handleDeleteCategory = async (cat: Category) => {
    try {
      await deleteDoc(doc(db, 'organizations', orgId, 'categories', cat.id))
      toast.success(t('deleted'))
    } catch {
      toast.error(t('failed'))
    }
  }

  return (
    <Card className="ring-line">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-ink">{t('title')}</CardTitle>
        <CardDescription className="text-ink-muted">{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {[
          { type: 'income' as const, cats: incomeCategories },
          { type: 'expense' as const, cats: expenseCategories },
        ].map(({ type, cats }) => (
          <div key={type}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t(type)}</p>
            {cats.length === 0 ? (
              <p className="text-sm italic text-ink-subtle">{t('none')}</p>
            ) : (
              <div className="space-y-1">
                {cats.map((cat) => (
                  <div key={cat.id} className="group flex items-center gap-2">
                    <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: cat.color }} />
                    <span className="flex-1 text-sm text-ink">{cat.name}</span>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => handleDeleteCategory(cat)}
                        aria-label={t('deleteLabel', { name: cat.name })}
                        className="text-ink-subtle opacity-0 transition-opacity group-hover:opacity-100 hover:text-expense focus-visible:opacity-100"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {canEdit && (
        <div className="border-t border-line pt-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t('addTitle')}</p>
          <form onSubmit={handleAddCategory} className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder={t('nameLabel')}
                aria-label={t('nameLabel')}
                className="h-9 flex-1 rounded-control border-line bg-surface"
              />
              <NativeSelect
                value={newCatType}
                onChange={(e) => setNewCatType(e.target.value as 'income' | 'expense')}
                aria-label={t('typeLabel')}
                className="border-line"
              >
                <option value="income">{t('typeIncome')}</option>
                <option value="expense">{t('typeExpense')}</option>
              </NativeSelect>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewCatColor(c)}
                  aria-label={t('colorLabel', { color: c })}
                  aria-pressed={newCatColor === c}
                  className={cn(
                    'size-5 rounded-full border-2 transition-transform',
                    newCatColor === c ? 'scale-110 border-ink' : 'border-transparent',
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <Button type="submit" disabled={!newCatName.trim() || addingCat}>
              <Plus className="mr-1 size-3.5" />
              {t('submit')}
            </Button>
          </form>
        </div>
        )}
      </CardContent>
    </Card>
  )
}
