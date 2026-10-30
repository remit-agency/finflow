import type { TagColor } from '@/lib/domain/tags/types'
import { TAG_DOT_CLASS } from '@/lib/ui/tag-colors'
import { cn } from '@/lib/utils'

/** The colour mark of a tag. Decorative: the name is always shown next to it. */
export function TagDot({ color, className }: { color: TagColor; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', TAG_DOT_CLASS[color], className)} />
}
