'use client'

import { useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { TagDot } from '@/components/tags/TagDot'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LedgerApiError } from '@/lib/api/ledger-client'
import { createTag, tagImpact, updateTag } from '@/lib/api/tags-client'
import type { TagPatch } from '@/lib/domain/tags/input'
import { DEFAULT_TAG_COLOR, TAG_COLORS, TAG_NAME_MAX, type Tag, type TagColor } from '@/lib/domain/tags/types'
import { cn } from '@/lib/utils'

interface Props {
  orgId: string
  /** The tag to edit; absent for a new one. */
  tag?: Tag
  onClose: () => void
  /** After a change of the flag of a tag that some operation carries: the page runs the recalculation. */
  onRecalc: (tag: Tag) => void
}

type Phase = { kind: 'form' } | { kind: 'confirm'; count: number; patch: TagPatch }

/**
 * The tag editor: name, a colour of the palette, «Не враховувати в аналітиці», archive or restore. A change of the
 * flag of a tag with operations asks first («Буде перераховано операцій: N»), then the page shows the recalculation.
 */
export function TagEditor({ orgId, tag, onClose, onRecalc }: Props) {
  const t = useTranslations('settings.tags')
  const tCommon = useTranslations('common')
  const [name, setName] = useState(tag?.name ?? '')
  const [color, setColor] = useState<TagColor>(tag?.color ?? DEFAULT_TAG_COLOR)
  const [exclude, setExclude] = useState(tag?.excludeFromAnalytics ?? false)
  const [phase, setPhase] = useState<Phase>({ kind: 'form' })
  const [busy, setBusy] = useState(false)

  const errorText = (e: unknown): string => {
    const code = e instanceof LedgerApiError ? e.code : ''
    if (code === 'duplicate') return t('errors.duplicate')
    if (code === 'limit_reached') return t('errors.limit')
    if (code === 'not_found') return t('errors.gone')
    if (code === 'invalid_input') return t('errors.invalid')
    return t('errors.save')
  }

  /** The fields that differ from the stored tag. */
  const changes = (): TagPatch => {
    const patch: TagPatch = {}
    if (!tag) return patch
    if (name.replace(/\s+/g, ' ').trim() !== tag.name) patch.name = name
    if (color !== tag.color) patch.color = color
    if (exclude !== tag.excludeFromAnalytics) patch.excludeFromAnalytics = exclude
    return patch
  }

  const send = async (patch: TagPatch) => {
    if (!tag) return
    const result = await updateTag(orgId, tag.id, patch)
    toast.success(t('saved'))
    onClose()
    if (result.recalc) onRecalc(result.tag)
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || name.trim() === '') return
    setBusy(true)
    try {
      if (!tag) {
        await createTag(orgId, { name, color, excludeFromAnalytics: exclude })
        toast.success(t('saved'))
        onClose()
        return
      }
      const patch = changes()
      if (Object.keys(patch).length === 0) {
        onClose()
        return
      }
      if (patch.excludeFromAnalytics !== undefined) {
        const count = await tagImpact(orgId, tag.id)
        if (count > 0) {
          setPhase({ kind: 'confirm', count, patch })
          setBusy(false)
          return
        }
      }
      await send(patch)
    } catch (err) {
      toast.error(errorText(err))
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (phase.kind !== 'confirm') return
    setBusy(true)
    try {
      await send(phase.patch)
    } catch (err) {
      toast.error(errorText(err))
      setBusy(false)
      setPhase({ kind: 'form' })
    }
  }

  const toggleArchive = async () => {
    if (!tag || busy) return
    setBusy(true)
    try {
      await updateTag(orgId, tag.id, { archived: !tag.archived })
      toast.success(t('saved'))
      onClose()
    } catch (err) {
      toast.error(errorText(err))
      setBusy(false)
    }
  }

  if (phase.kind === 'confirm') {
    return (
      <Dialog open onOpenChange={(open) => !open && !busy && setPhase({ kind: 'form' })}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('editor.confirmTitle')}</DialogTitle>
            <DialogDescription data-testid="tag-recalc-count">{t('editor.confirmBody', { count: phase.count })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setPhase({ kind: 'form' })}>
              {tCommon('cancel')}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void confirm()}>
              {t('editor.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tag ? t('editor.titleEdit') : t('editor.titleNew')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4" noValidate>
          <div className="space-y-1">
            <Label htmlFor="tag-name">{t('editor.name')}</Label>
            <Input id="tag-name" maxLength={TAG_NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-ink">{t('editor.color')}</legend>
            <div role="radiogroup" aria-label={t('editor.color')} className="flex flex-wrap gap-2">
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={t(`colors.${c}`)}
                  onClick={() => setColor(c)}
                  className={cn(
                    'flex size-9 items-center justify-center rounded-full border bg-surface focus-visible:outline-2 focus-visible:outline-brand-soft-foreground',
                    color === c ? 'border-ink' : 'border-line',
                  )}
                >
                  <TagDot color={c} className="size-4" />
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex items-start gap-3">
            <input
              id="tag-exclude"
              type="checkbox"
              role="switch"
              className="mt-1 accent-brand"
              checked={exclude}
              onChange={(e) => setExclude(e.target.checked)}
              aria-describedby="tag-exclude-hint"
            />
            <div className="space-y-0.5">
              <Label htmlFor="tag-exclude">{t('editor.exclude')}</Label>
              <p id="tag-exclude-hint" className="text-xs text-ink-muted">
                {t('editor.excludeHint')}
              </p>
            </div>
          </div>

          {tag?.archived && <p className="text-xs text-ink-muted">{t('editor.archivedNote')}</p>}

          <DialogFooter className="flex-row items-center justify-between gap-2">
            {tag ? (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void toggleArchive()}>
                {tag.archived ? t('editor.restore') : t('editor.archive')}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                {tCommon('cancel')}
              </Button>
              <Button type="submit" disabled={busy || name.trim() === ''}>
                {busy ? t('editor.saving') : tCommon('save')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
