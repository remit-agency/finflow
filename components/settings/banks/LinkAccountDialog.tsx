'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DateField } from '@/components/ui/date-field'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Segmented } from '@/components/ui/segmented'
import { fetchSessionAccounts, linkBankAccount, syncBankAccount } from '@/lib/api/bank-client'
import { LedgerApiError } from '@/lib/api/ledger-client'
import { bankErrorKey } from '@/lib/enablebanking/errors'
import type { LinkRequest } from '@/lib/domain/banking/link-input'
import type { BankConnectionStatus, BankSessionAccount } from '@/lib/domain/banking/status-types'
import { addDays } from '@/lib/domain/ledger/days'
import { todayDay } from '@/lib/utils/today'
import type { Account } from '@/types'

/** How far back the first import reaches by default; the person can move the date. */
const DEFAULT_IMPORT_DAYS = 90

interface Props {
  orgId: string
  connection: BankConnectionStatus
  finflowAccounts: Account[]
  /** FinFlow accounts already linked to some bank account (they cannot be picked again). */
  linkedAccountIds: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** The code of a failed call, '' for anything else (network errors). */
function errorCode(e: unknown): string {
  return e instanceof LedgerApiError ? e.code : ''
}

/**
 * Links the bank accounts of one connection, one step per account that is not linked yet: pick or create the
 * FinFlow account, the import start day, link, then run the first sync of that account right away.
 */
export function LinkAccountDialog({ orgId, connection, finflowAccounts, linkedAccountIds, open, onOpenChange }: Props) {
  const t = useTranslations('settings.banks')
  return (
    <Dialog open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('link.title')}</DialogTitle>
        </DialogHeader>
        {open && (
          <LinkSteps
            orgId={orgId}
            connection={connection}
            finflowAccounts={finflowAccounts}
            linkedAccountIds={linkedAccountIds}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

interface StepsProps {
  orgId: string
  connection: BankConnectionStatus
  finflowAccounts: Account[]
  linkedAccountIds: string[]
  onClose: () => void
}

/** Loads the bank's accounts when the dialog opens and walks through the unlinked ones. */
function LinkSteps({ orgId, connection, finflowAccounts, linkedAccountIds, onClose }: StepsProps) {
  const t = useTranslations('settings.banks')
  const tErrors = useTranslations('errors.bank')
  const tCommon = useTranslations('common')
  // null while loading; 'failed' when the bank could not list the accounts.
  const [loaded, setLoaded] = useState<BankSessionAccount[] | 'failed' | null>(null)
  const [index, setIndex] = useState(0)
  // Accounts linked during this dialog session: the status the page shows catches up only after the reload.
  const [justLinked, setJustLinked] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    fetchSessionAccounts(orgId, connection.id).then(
      (accounts) => {
        if (!cancelled) setLoaded(accounts)
      },
      (e) => {
        console.error('Loading bank accounts failed', errorCode(e))
        if (cancelled) return
        setLoaded('failed')
        toast.error(tErrors(bankErrorKey(errorCode(e))))
      },
    )
    return () => {
      cancelled = true
    }
  }, [orgId, connection.id, tErrors])

  if (loaded === null) return <p className="py-6 text-center text-sm text-[#6b7280]">{t('loading')}</p>
  if (loaded === 'failed') {
    return (
      <>
        <p className="text-sm text-[#6b7280]">{tErrors('loadStatus')}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tCommon('close')}
          </Button>
        </DialogFooter>
      </>
    )
  }

  const steps = loaded.filter((a) => !a.linked)
  const current = steps[index]
  if (!current) {
    return (
      <>
        <p className="text-sm text-[#6b7280]">{t('link.allLinked')}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tCommon('close')}
          </Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <LinkStep
      key={current.uid}
      orgId={orgId}
      connectionId={connection.id}
      bankName={connection.institutionName}
      account={current}
      finflowAccounts={finflowAccounts}
      taken={[...linkedAccountIds, ...justLinked]}
      onLinked={(accountId) => setJustLinked((list) => [...list, accountId])}
      onDone={() => (index + 1 < steps.length ? setIndex(index + 1) : onClose())}
      onCancel={onClose}
    />
  )
}

interface StepProps {
  orgId: string
  connectionId: string
  bankName: string
  account: BankSessionAccount
  finflowAccounts: Account[]
  taken: string[]
  onLinked: (accountId: string) => void
  onDone: () => void
  onCancel: () => void
}

/** One bank account: the form, then link and first sync. Mounted per account (keyed), so its state starts fresh. */
function LinkStep({ orgId, connectionId, bankName, account, finflowAccounts, taken, onLinked, onDone, onCancel }: StepProps) {
  const t = useTranslations('settings.banks')
  const tErrors = useTranslations('errors.bank')
  const tCommon = useTranslations('common')
  const tForm = useTranslations('forms.transaction')
  const currency = account.currency ?? ''
  const candidates = finflowAccounts.filter((f) => f.currency === account.currency && !taken.includes(f.id))

  const [mode, setMode] = useState<'create' | 'existing'>('create')
  const [name, setName] = useState(() => `${bankName} ${currency}`.trim())
  const [accountId, setAccountId] = useState(() => candidates[0]?.id ?? '')
  const [importFrom, setImportFrom] = useState(() => addDays(todayDay(), -DEFAULT_IMPORT_DAYS))
  const [busy, setBusy] = useState(false)
  // Operations the first sync has added so far; null when no sync runs.
  const [running, setRunning] = useState<number | null>(null)

  const canSubmit = !busy && importFrom !== '' && (mode === 'create' ? name.trim() !== '' : accountId !== '')

  const submit = async () => {
    const body: LinkRequest =
      mode === 'create'
        ? { connectionId, ebAccountUid: account.uid, mode: 'create', name: name.trim(), importFrom }
        : { connectionId, ebAccountUid: account.uid, mode: 'existing', accountId, importFrom }
    setBusy(true)
    let linked: { bankAccountId: string; accountId: string }
    try {
      linked = await linkBankAccount(orgId, body)
    } catch (e) {
      toast.error(tErrors(bankErrorKey(errorCode(e), 'linkFailed')))
      setBusy(false)
      return
    }
    // The account is linked now: a failed first sync leaves it linked (the card can retry), so the walk goes on.
    onLinked(linked.accountId)
    setRunning(0)
    try {
      const totals = await syncBankAccount(orgId, linked.bankAccountId, { onProgress: (p) => setRunning(p.imported) })
      if (totals.busy) toast.info(t('sync.busy'))
      else toast.success(totals.imported > 0 ? t('sync.imported', { count: totals.imported }) : t('sync.upToDate'))
    } catch (e) {
      toast.error(tErrors(bankErrorKey(errorCode(e))))
    }
    setRunning(null)
    setBusy(false)
    onDone()
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-[#111111]">
        {account.iban ? t('accounts.iban', { tail: account.iban.slice(-4) }) : t('accounts.noIban')} · {currency}
      </p>

      <Segmented
        label={t('link.account')}
        value={mode}
        onChange={setMode}
        options={[
          { value: 'create', label: t('link.create') },
          { value: 'existing', label: t('link.existing') },
        ]}
      />

      {mode === 'create' ? (
        <div className="space-y-1">
          <Label htmlFor="bank-link-name">{t('link.name')}</Label>
          <Input id="bank-link-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      ) : (
        <div className="space-y-1">
          <Label htmlFor="bank-link-existing">{t('link.account')}</Label>
          <NativeSelect id="bank-link-existing" value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={candidates.length === 0}>
            {candidates.length === 0 ? (
              <option value="" disabled>
                {t('link.noMatching', { currency })}
              </option>
            ) : (
              candidates.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))
            )}
          </NativeSelect>
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="bank-link-from">{t('link.importFrom')}</Label>
        <DateField
          id="bank-link-from"
          value={importFrom}
          onChange={setImportFrom}
          placeholder={tForm('datePlaceholder')}
          calendarLabel={tForm('openCalendar')}
        />
        <p className="text-xs text-[#6b7280]">{t('link.hint')}</p>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          {tCommon('cancel')}
        </Button>
        <Button data-testid="bank-link-submit" onClick={submit} disabled={!canSubmit}>
          {running === null ? t('link.submit') : `${t('sync.running')}${running > 0 ? ` (${running})` : ''}`}
        </Button>
      </DialogFooter>
    </div>
  )
}
