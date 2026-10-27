'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  createCounterparty,
  duplicateOf,
  lookupNip,
  updateCounterparty,
  type CounterpartyPatchDraft,
} from '@/lib/api/counterparty-client'
import { LedgerApiError } from '@/lib/api/ledger-client'
import { normalizeNip, tryNormalizeIban } from '@/lib/domain/counterparties/normalize'
import { MAX_IBANS, type Counterparty, type Vat } from '@/lib/domain/counterparties/types'
import { useFormatters } from '@/lib/i18n/useFormatters'

interface Props {
  orgId: string
  /** Absent: a new counterparty. */
  counterparty?: Counterparty
  onClose: () => void
  /** The starting name and NIP of a NEW counterparty (what was typed in a picker); ignored when editing. */
  initial?: { name?: string; nip?: string }
  /** Called with the saved counterparty after a successful save, before `onClose`. */
  onSaved?: (counterparty: Counterparty) => void
  /** Called with the id of the counterparty a duplicate error points at; the parent may switch to it. */
  onOpenExisting?: (id: string) => void
}

/** The NIP as 10 digits, or null when it is empty or not valid. */
function nipOrNull(raw: string): string | null {
  try {
    return normalizeNip(raw)
  } catch {
    return null
  }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

type Duplicate = { field: 'nip' | 'name'; existingId: string }

export function CounterpartyForm({ orgId, counterparty, onClose, initial, onSaved, onOpenExisting }: Props) {
  const t = useTranslations('settings.counterparties')
  const tCommon = useTranslations('common')
  const { date } = useFormatters()
  const isEdit = counterparty !== undefined

  const [name, setName] = useState(counterparty?.name ?? initial?.name ?? '')
  const [nip, setNip] = useState(counterparty?.nip ?? initial?.nip ?? '')
  const [address, setAddress] = useState(counterparty?.address ?? '')
  const [ibans, setIbans] = useState<string[]>(counterparty?.ibans.map((i) => i.iban) ?? [])
  const [vat, setVat] = useState<Vat | null>(counterparty?.vat ?? null)
  const [errors, setErrors] = useState<{ name?: string; nip?: string; ibans?: string }>({})
  const [busy, setBusy] = useState<null | 'lookup' | 'save'>(null)
  /** A refused save whose existing counterparty is known: shown under its field with a way to open it. */
  /** The white list found the NIP: a saved edit then re-asks the server even if the NIP text did not change. */
  const [lookedUp, setLookedUp] = useState(false)
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null)

  const nipDigits = nipOrNull(nip)

  /** The white list marks are for the NIP they were stored under; once the NIP is edited they are not shown. */
  const marksApply = counterparty?.nip !== undefined && counterparty.nip === nipDigits

  const whitelistBadge = (raw: string): string | null => {
    if (!marksApply) return null
    const stored = counterparty?.ibans.find((i) => i.iban === tryNormalizeIban(raw))
    if (stored === undefined) return null
    return stored.onWhitelist === null ? t('whitelist.unknown') : stored.onWhitelist ? t('whitelist.yes') : t('whitelist.no')
  }

  const errorText = (e: unknown): string => {
    if (e instanceof LedgerApiError) {
      const duplicate = duplicateOf(e)
      if (duplicate) return duplicate.field === 'nip' ? t('errors.duplicateNip') : t('errors.duplicateName')
      if (e.code === 'limit') return t('errors.limit')
      if (e.code === 'rate_limited') return t('errors.rateLimited')
      if (e.code === 'lookup_unavailable') return t('errors.lookupUnavailable')
      if (e.code === 'invalid_input') {
        const field = e.details?.field
        if (field === 'nip') return t('errors.nip')
        if (field === 'ibans') return t('errors.iban')
        if (field === 'name') return t('errors.name')
      }
    }
    return t('errors.save')
  }

  const handleLookup = async () => {
    if (nipDigits === null) {
      setErrors((prev) => ({ ...prev, nip: t('errors.nip') }))
      return
    }
    setErrors((prev) => ({ ...prev, nip: undefined }))
    setBusy('lookup')
    try {
      const result = await lookupNip(orgId, nipDigits)
      if (!result.found) {
        toast.info(t('errors.lookupNotFound'))
        return
      }
      setLookedUp(true)
      if (result.name) setName(result.name)
      if (result.address !== undefined) setAddress(result.address)
      if (result.vatStatus) setVat({ status: result.vatStatus, checkedOn: result.checkedOn })
      // A big company has hundreds of accounts: fill them only when the list is short and the form has none.
      if (ibans.length === 0 && result.ibans.length > 0 && result.ibans.length <= MAX_IBANS) setIbans(result.ibans)
      toast.success(t('toast.filled'))
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setDuplicate(null)
    const trimmedName = name.trim()
    const filled = ibans.map((i) => i.trim()).filter((i) => i !== '')
    const normalised = filled.map((i) => tryNormalizeIban(i))
    const next: typeof errors = {}
    if (trimmedName === '') next.name = t('errors.name')
    if (nip.trim() !== '' && nipDigits === null) next.nip = t('errors.nip')
    if (normalised.some((i) => i === null) || new Set(normalised).size !== normalised.length) next.ibans = t('errors.iban')
    setErrors(next)
    if (Object.keys(next).length > 0) return

    const ibanList = normalised as string[]
    const addressText = address.trim()
    setBusy('save')
    try {
      if (counterparty) {
        const patch: CounterpartyPatchDraft = {}
        if (trimmedName !== counterparty.name) patch.name = trimmedName
        // The server asks the white list whenever a patch carries the NIP, so a looked-up status is stored by sending it.
        if ((nipDigits ?? undefined) !== counterparty.nip || (lookedUp && nipDigits !== null)) patch.nip = nipDigits
        if (!sameList(ibanList, counterparty.ibans.map((i) => i.iban))) patch.ibans = ibanList
        if ((addressText === '' ? undefined : addressText) !== counterparty.address) patch.address = addressText === '' ? null : addressText
        if (Object.keys(patch).length === 0) {
          onClose()
          return
        }
        const saved = await updateCounterparty(orgId, counterparty.id, patch)
        toast.success(t('toast.saved'))
        onSaved?.(saved)
      } else {
        const created = await createCounterparty(orgId, {
          name: trimmedName,
          ibans: ibanList,
          ...(nipDigits === null ? {} : { nip: nipDigits }),
          ...(addressText === '' ? {} : { address: addressText }),
        })
        toast.success(t('toast.created'))
        onSaved?.(created)
      }
      onClose()
    } catch (e) {
      const found = duplicateOf(e)
      if (found?.existingId !== undefined) setDuplicate({ field: found.field, existingId: found.existingId })
      else toast.error(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  /** The refusal under its field, with a link-style button to the counterparty that already has the value. */
  const duplicateNotice = (field: Duplicate['field']) =>
    duplicate?.field === field && (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <p role="alert" className="text-red-500">
          {field === 'nip' ? t('errors.duplicateNip') : t('errors.duplicateName')}
        </p>
        {onOpenExisting && (
          <button type="button" className="font-medium text-brand-soft-foreground underline underline-offset-2" onClick={() => onOpenExisting(duplicate.existingId)}>
            {t('errors.openExisting')}
          </button>
        )}
      </div>
    )

  const handleArchive = async () => {
    if (!counterparty) return
    setBusy('save')
    try {
      await updateCounterparty(orgId, counterparty.id, { archived: !counterparty.archived })
      toast.success(counterparty.archived ? t('toast.restored') : t('toast.archived'))
      onClose()
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('form.titleEdit') : t('form.titleNew')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1">
            <Label htmlFor="cp-name">{t('form.name')}</Label>
            <Input id="cp-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={errors.name !== undefined} />
            {errors.name && <p role="alert" className="text-xs text-red-500">{errors.name}</p>}
            {duplicateNotice('name')}
          </div>

          <div className="space-y-1">
            <Label htmlFor="cp-nip">{t('form.nip')}</Label>
            <div className="flex gap-2">
              <Input
                id="cp-nip"
                value={nip}
                onChange={(e) => setNip(e.target.value)}
                inputMode="numeric"
                aria-describedby="cp-nip-help"
                aria-invalid={errors.nip !== undefined}
              />
              <Button type="button" variant="outline" onClick={handleLookup} disabled={busy !== null || nipDigits === null}>
                {busy === 'lookup' ? t('form.lookingUp') : t('form.lookup')}
              </Button>
            </div>
            <p id="cp-nip-help" className="text-xs text-ink-muted">{t('form.nipHelp')}</p>
            {errors.nip && <p role="alert" className="text-xs text-red-500">{errors.nip}</p>}
            {duplicateNotice('nip')}
            {vat && (
              <p data-testid="cp-vat" className="text-xs font-medium text-brand-soft-foreground">
                {t(`vat.${vat.status}`)} · {t('vat.checkedOn', { date: date(new Date(`${vat.checkedOn}T00:00:00Z`)) })}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="cp-address">{t('form.address')}</Label>
            <Input id="cp-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('form.ibans')}</legend>
            {ibans.map((value, index) => {
              const badge = whitelistBadge(value)
              return (
                <div key={index} className="space-y-1">
                  <div className="flex gap-2">
                    <Input
                      value={value}
                      onChange={(e) => setIbans((list) => list.map((x, i) => (i === index ? e.target.value : x)))}
                      placeholder={t('form.ibanPlaceholder')}
                      aria-label={t('form.ibans')}
                      inputMode="numeric"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('form.removeIban', { iban: value })}
                      onClick={() => setIbans((list) => list.filter((_, i) => i !== index))}
                    >
                      <X />
                    </Button>
                  </div>
                  {badge && <p className="text-xs text-ink-muted">{badge}</p>}
                </div>
              )
            })}
            {errors.ibans && <p role="alert" className="text-xs text-red-500">{errors.ibans}</p>}
            <Button type="button" variant="outline" size="sm" disabled={ibans.length >= MAX_IBANS} onClick={() => setIbans((list) => [...list, ''])}>
              <Plus />
              {t('form.addIban')}
            </Button>
          </fieldset>

          <DialogFooter className="gap-2 sm:justify-between">
            {isEdit ? (
              <Button type="button" variant="ghost" onClick={handleArchive} disabled={busy !== null}>
                {counterparty.archived ? t('form.restore') : t('form.archive')}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={busy === 'save'}>
                {tCommon('cancel')}
              </Button>
              <Button type="submit" disabled={busy !== null}>
                {busy === 'save' ? t('form.saving') : t('form.save')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
