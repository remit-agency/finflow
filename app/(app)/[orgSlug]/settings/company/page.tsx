'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useOrg } from '@/lib/hooks/useOrg'
import { useShell } from '@/lib/hooks/useShell'
import { LedgerApiError, updateOrganization } from '@/lib/api/ledger-client'
import { fromMinor, parseMinorInput } from '@/lib/domain/ledger/money'

// Codes only; the labels live in the catalogs (settings.company.currencies.<code>).
const CURRENCIES = ['UAH', 'EUR', 'USD', 'PLN'] as const

/** The minimum as the field shows it: the company currency, 2 decimals, a comma. */
const minimumText = (minor: number): string => fromMinor(minor).toFixed(2).replace('.', ',')

export default function CompanySettingsPage() {
  const t = useTranslations('settings.company')
  const tCommon = useTranslations('common')
  const params = useParams()
  const orgId = params.orgSlug as string
  // The shell's org is always the URL's org; switchOrg only refreshes it after a save.
  const { org, can } = useShell()
  const canEdit = can('company.edit')
  const { switchOrg } = useOrg()

  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('UAH')
  const [minimum, setMinimum] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (org) {
      setName(org.name)
      setCurrency(org.currency)
      setMinimum(minimumText(org.cashMinimumMinor))
    }
  }, [org])

  // The name is saved trimmed (the rules also refuse a blank one); a blank name is not a valid change.
  const trimmedName = name.trim()
  // Null for anything that is not an amount (empty, a sign, letters): the minimum cannot be saved then.
  const minimumMinor = parseMinorInput(minimum)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canEdit || !orgId || trimmedName.length === 0 || minimumMinor === null) return
    setSaving(true)
    try {
      await updateOrganization(orgId, { name: trimmedName, currency, cashMinimumMinor: minimumMinor })
    } catch (e) {
      toast.error(e instanceof LedgerApiError && e.code === 'currency_locked' ? t('currencyLocked') : t('saveFailed'))
      setSaving(false)
      return
    }
    toast.success(t('saved'))
    // Reload the org so the header and the sidebar total show the new name and currency.
    // The save already succeeded, so a failed refresh must not be reported as a failed save.
    try {
      await switchOrg(orgId)
    } catch {
      // The shell keeps showing the previous values until the next load.
    }
    setSaving(false)
  }

  const isChanged = org && trimmedName.length > 0 && minimumMinor !== null && (trimmedName !== org.name || currency !== org.currency || minimumMinor !== org.cashMinimumMinor)

  return (
    <Card className="ring-line">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-ink">{t('title')}</CardTitle>
        <CardDescription className="text-ink-muted">{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="orgName" className="text-ink">{t('nameLabel')}</Label>
            <Input
              id="orgName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 rounded-control border-line bg-surface"
              required
              maxLength={120}
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="currency" className="text-ink">{t('currencyLabel')}</Label>
            <NativeSelect
              id="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              wrapperClassName="flex w-full"
              className="border-line"
              disabled={!canEdit}
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>{t(`currencies.${code}`)}</option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cashMinimum" className="text-ink">{t('minimumLabel')} ({org?.currency})</Label>
            <Input
              id="cashMinimum"
              data-testid="cash-minimum"
              inputMode="decimal"
              value={minimum}
              onChange={(e) => setMinimum(e.target.value)}
              className="h-9 rounded-control border-line bg-surface"
              aria-invalid={minimumMinor === null}
              disabled={!canEdit}
            />
            <p className="text-xs text-ink-muted">{minimumMinor === null ? t('minimumInvalid') : t('minimumHint')}</p>
          </div>
          {canEdit ? (
            <Button type="submit" size="lg" disabled={!isChanged || saving}>
              {saving ? t('saving') : tCommon('save')}
            </Button>
          ) : (
            <p className="text-xs text-ink-muted">{t('ownerOnly')}</p>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
