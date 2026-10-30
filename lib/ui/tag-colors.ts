import type { TagColor } from '@/lib/domain/tags/types'

/** The dot of each palette colour (S10t): the utilities of the `--color-tag-*` tokens in app/globals.css. */
export const TAG_DOT_CLASS: Record<TagColor, string> = {
  slate: 'bg-tag-slate',
  sky: 'bg-tag-sky',
  emerald: 'bg-tag-emerald',
  amber: 'bg-tag-amber',
  rose: 'bg-tag-rose',
  violet: 'bg-tag-violet',
}
