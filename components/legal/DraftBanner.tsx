import { getTranslations } from 'next-intl/server'
import { LEGAL_DRAFT } from '@/content/legal/operator'

/** "Draft, under legal review" notice; shown only while LEGAL_DRAFT is true. */
export async function DraftBanner() {
  if (!LEGAL_DRAFT) return null
  const t = await getTranslations('legal')
  return (
    <div role="note" className="rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm">
      {t('draft')}
    </div>
  )
}
