'use client'

import { useState, useEffect, useCallback } from 'react'
import { Account } from '@/types'
import { useTranslations } from 'next-intl'
import { useFormatters } from '@/lib/i18n/useFormatters'
import { TOKEN_COLORS } from '@/lib/ui/colors'

interface BalanceSheetProps {
  accounts: Account[]
  orgId?: string
  /** The company currency: every amount on the sheet is shown in it (no conversion before S04). */
  currency: string
  loading?: boolean
}

interface EditableFields {
  // Assets I — Fixed
  realestate: number
  equipment: number
  // Assets II — Current
  inventory: number
  receivables: number
  // Liabilities I — Equity
  charter_capital: number
  additional_capital: number
  // Liabilities II — Debt
  loans: number
}

const DEFAULT_FIELDS: EditableFields = {
  realestate: 0,
  equipment: 0,
  inventory: 0,
  receivables: 0,
  charter_capital: 0,
  additional_capital: 0,
  loans: 0,
}

function EditableRow({
  label,
  value,
  currency,
  onChange,
}: {
  label: string
  value: number
  currency: string
  onChange: (v: number) => void
}) {
  const { currencySymbol } = useFormatters()
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-ink flex-1">{label}</span>
      <div className="flex items-center gap-1 shrink-0">
        <input
          type="number"
          min={0}
          step="0.01"
          value={value || ''}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          placeholder="0.00"
          className="w-32 text-right text-sm px-2 py-1 rounded-md border border-line focus:outline-none focus:ring-1 focus:ring-brand-soft-foreground focus:border-brand-soft-foreground text-ink bg-surface"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        />
        <span className="text-xs text-ink-muted">{currencySymbol(currency)}</span>
      </div>
    </div>
  )
}

function ReadOnlyRow({ label, value, currency, color }: { label: string; value: number; currency: string; color?: string }) {
  const { money } = useFormatters()
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-ink flex-1">{label}</span>
      <span
        className="text-sm font-medium shrink-0"
        style={{ fontVariantNumeric: 'tabular-nums', color: color ?? (value >= 0 ? TOKEN_COLORS.ink : TOKEN_COLORS.expense) }}
      >
        {money(value, currency)}
      </span>
    </div>
  )
}

function SectionHeader({ roman, title, total, currency }: { roman: string; title: string; total: number; currency: string }) {
  const { money } = useFormatters()
  return (
    <div className="flex items-center justify-between py-2 border-t border-line mt-2">
      <span className="text-xs font-bold text-ink-muted uppercase tracking-wide">
        {roman}. {title}
      </span>
      <span
        className="text-sm font-semibold"
        style={{ fontVariantNumeric: 'tabular-nums', color: total >= 0 ? TOKEN_COLORS.ink : TOKEN_COLORS.expense }}
      >
        {money(total, currency)}
      </span>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {[0, 1].map((i) => (
        <div key={i} className="rounded-xl border border-line p-5 space-y-4">
          <div className="h-4 w-28 bg-line rounded animate-pulse" />
          {Array.from({ length: 4 }).map((_, j) => (
            <div key={j} className="flex justify-between items-center gap-4">
              <div className="h-3 flex-1 bg-canvas rounded animate-pulse" />
              <div className="h-3 w-24 bg-canvas rounded animate-pulse" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export default function BalanceSheet({ accounts, orgId = 'default', currency, loading }: BalanceSheetProps) {
  const t = useTranslations('charts.balanceSheet')
  const { money } = useFormatters()
  const storageKey = `balance-sheet-${orgId}`

  const [fields, setFields] = useState<EditableFields>(DEFAULT_FIELDS)

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        setFields({ ...DEFAULT_FIELDS, ...JSON.parse(stored) })
      }
    } catch {
      // ignore parse errors
    }
  }, [storageKey])

  // Save to localStorage on change
  const updateField = useCallback(
    (key: keyof EditableFields, value: number) => {
      setFields((prev) => {
        const next = { ...prev, [key]: value }
        try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* noop */ }
        return next
      })
    },
    [storageKey]
  )

  if (loading) return <Skeleton />

  // --- Assets calculations ---
  const cryptoAccounts = accounts.filter((a) => a.type === 'crypto')
  const cryptoTotal = cryptoAccounts.reduce((s, a) => s + a.balance, 0)

  // Section I — Fixed assets
  const fixedTotal = fields.realestate + fields.equipment + cryptoTotal

  // Section II — Current assets
  const currentTotal = fields.inventory + fields.receivables

  // Section III — Money (auto from accounts)
  const moneyTotal = accounts.reduce((s, a) => s + a.balance, 0)

  const totalAssets = fixedTotal + currentTotal + moneyTotal

  // --- Liabilities calculations ---
  // Section I — Equity
  const retainedEarnings = moneyTotal // auto = sum of all money accounts
  const equityTotal = fields.charter_capital + fields.additional_capital + retainedEarnings

  // Section II — Debt
  const debtTotal = fields.loans

  const totalLiabilities = equityTotal + debtTotal

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6" style={{ fontVariantNumeric: 'tabular-nums' }}>
      {/* ======= ASSETS ======= */}
      <div className="rounded-xl border border-line bg-surface p-5 space-y-1">
        <div className="flex items-center justify-between pb-3 border-b border-line">
          <h3 className="text-sm font-bold text-ink uppercase tracking-wide">{t('assets')}</h3>
          <span className="text-sm font-bold text-brand-soft-foreground">{money(totalAssets, currency)}</span>
        </div>

        {/* I. Fixed */}
        <SectionHeader roman="I" title={t('fixedAssets')} total={fixedTotal} currency={currency} />
        <EditableRow label={t('realEstate')} value={fields.realestate} currency={currency} onChange={(v) => updateField('realestate', v)} />
        <EditableRow label={t('equipment')} value={fields.equipment} currency={currency} onChange={(v) => updateField('equipment', v)} />
        <ReadOnlyRow label={t('crypto')} value={cryptoTotal} currency={currency} />
        {cryptoAccounts.map((acc) => (
          <div key={acc.id} className="flex items-center justify-between gap-3 pl-4 py-1">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: acc.color }} />
              <span className="text-xs text-ink-muted truncate">{acc.name}</span>
            </div>
            {/* A single account is shown in its own currency. */}
            <span className="text-xs text-ink-muted shrink-0">{money(acc.balance, acc.currency)}</span>
          </div>
        ))}

        {/* II. Current */}
        <SectionHeader roman="II" title={t('currentAssets')} total={currentTotal} currency={currency} />
        <EditableRow label={t('inventory')} value={fields.inventory} currency={currency} onChange={(v) => updateField('inventory', v)} />
        <EditableRow label={t('receivables')} value={fields.receivables} currency={currency} onChange={(v) => updateField('receivables', v)} />

        {/* III. Money */}
        <SectionHeader roman="III" title={t('money')} total={moneyTotal} currency={currency} />
        {accounts.length === 0 ? (
          <p className="text-sm text-ink-muted italic py-1">{t('noAccounts')}</p>
        ) : (
          accounts.map((acc) => (
            <div key={acc.id} className="flex items-center justify-between gap-3 py-1">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: acc.color }} />
                <span className="text-sm text-ink truncate">{acc.name}</span>
              </div>
              <span
                className="text-sm font-medium shrink-0"
                style={{ color: acc.balance >= 0 ? TOKEN_COLORS.ink : TOKEN_COLORS.expense }}
              >
                {money(acc.balance, acc.currency)}
              </span>
            </div>
          ))
        )}

        {/* Total */}
        <div className="flex justify-between items-center pt-3 mt-2 border-t-2 border-ink">
          <span className="text-base font-bold text-ink">{t('totalAssets')}</span>
          <span className="text-base font-bold text-brand-soft-foreground">{money(totalAssets, currency)}</span>
        </div>
      </div>

      {/* ======= LIABILITIES ======= */}
      <div className="rounded-xl border border-line bg-surface p-5 space-y-1">
        <div className="flex items-center justify-between pb-3 border-b border-line">
          <h3 className="text-sm font-bold text-ink uppercase tracking-wide">{t('liabilities')}</h3>
          <span className="text-sm font-bold text-ink">{money(totalLiabilities, currency)}</span>
        </div>

        {/* I. Equity */}
        <SectionHeader roman="I" title={t('equity')} total={equityTotal} currency={currency} />
        <EditableRow label={t('charterCapital')} value={fields.charter_capital} currency={currency} onChange={(v) => updateField('charter_capital', v)} />
        <EditableRow label={t('additionalCapital')} value={fields.additional_capital} currency={currency} onChange={(v) => updateField('additional_capital', v)} />
        <ReadOnlyRow label={t('retainedEarnings')} value={retainedEarnings} currency={currency} color={retainedEarnings >= 0 ? TOKEN_COLORS.income : TOKEN_COLORS.expense} />

        {/* II. Debt */}
        <SectionHeader roman="II" title={t('debt')} total={debtTotal} currency={currency} />
        <EditableRow label={t('loans')} value={fields.loans} currency={currency} onChange={(v) => updateField('loans', v)} />

        {/* Total */}
        <div className="flex justify-between items-center pt-3 mt-2 border-t-2 border-ink">
          <span className="text-base font-bold text-ink">{t('totalLiabilities')}</span>
          <span className="text-base font-bold text-ink">{money(totalLiabilities, currency)}</span>
        </div>

        {/* Balance check */}
        <div className={[
          'flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium mt-2',
          Math.abs(totalAssets - totalLiabilities) < 0.01
            ? 'bg-brand-soft text-income'
            : 'bg-expense-soft text-expense',
        ].join(' ')}>
          <span>{t('check')}</span>
          <span>
            {Math.abs(totalAssets - totalLiabilities) < 0.01
              ? t('balanced')
              : t('difference', { amount: money(Math.abs(totalAssets - totalLiabilities), currency) })}
          </span>
        </div>
      </div>
    </div>
  )
}
