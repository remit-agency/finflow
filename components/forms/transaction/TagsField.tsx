'use client'

import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { TagPicker } from '@/components/tags/TagPicker'
import { Label } from '@/components/ui/label'
import { createTag, duplicateTagOf } from '@/lib/api/tags-client'
import { MAX_TX_TAGS, type Tag } from '@/lib/domain/tags/types'

interface Props {
  orgId: string
  tags: Tag[]
  value: string[]
  onChange: (ids: string[]) => void
  /** The owner and the accountant may create a tag right from the field. */
  canCreate: boolean
}

/** «Теги» of the operation form (S10t): several tags; a name nobody has yet creates the tag at once. */
export function TagsField({ orgId, tags, value, onChange, canCreate }: Props) {
  const t = useTranslations('forms.transaction')

  // The tag is created now (the operation is saved later); a name another tag already has picks that tag.
  const create = async (name: string): Promise<string | null> => {
    try {
      return (await createTag(orgId, { name })).id
    } catch (e) {
      const duplicate = duplicateTagOf(e)
      if (duplicate?.existingId) return duplicate.existingId
      toast.error(t('errors.tagCreate'))
      return null
    }
  }

  return (
    <div className="space-y-1">
      <Label htmlFor="tx-tags">{t('tags')}</Label>
      <TagPicker id="tx-tags" tags={tags} value={value} onChange={onChange} max={MAX_TX_TAGS} onCreate={canCreate ? create : undefined} />
    </div>
  )
}
