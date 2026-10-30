'use client'

import { useTranslations } from 'next-intl'
import { EyeOff } from 'lucide-react'
import { TagDot } from '@/components/tags/TagDot'
import { Badge } from '@/components/ui/badge'
import type { Tag } from '@/lib/domain/tags/types'
import { cn } from '@/lib/utils'

interface Props {
  ids: readonly string[]
  tagsById: ReadonlyMap<string, Tag>
  /** `tag-chip` in the comment column, `tag-chip-phone` under the account on a phone. */
  testId: string
  className?: string
}

/** The tags of one journal row: colour, name, and a mark on a tag that keeps the operation out of the analytics. */
export function TagChips({ ids, tagsById, testId, className }: Props) {
  const t = useTranslations('settings.tags.picker')
  const known = ids.flatMap((id) => {
    const tag = tagsById.get(id)
    return tag ? [tag] : []
  })
  if (known.length === 0) return null
  return (
    <span className={cn('flex flex-wrap gap-1', className)}>
      {known.map((tag) => (
        <Badge key={tag.id} variant="chip" data-testid={testId} className={cn('max-w-40 gap-1 font-normal', tag.archived && 'text-ink-muted')}>
          <TagDot color={tag.color} />
          <span className="truncate">{tag.name}</span>
          {tag.excludeFromAnalytics && (
            <>
              <EyeOff className="size-3 text-ink-muted" aria-hidden />
              <span className="sr-only">{t('excluded')}</span>
            </>
          )}
        </Badge>
      ))}
    </span>
  )
}
