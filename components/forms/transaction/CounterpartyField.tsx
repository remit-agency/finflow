'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { CounterpartyForm } from '@/components/counterparties/CounterpartyForm'
import { CounterpartyPicker } from '@/components/counterparties/CounterpartyPicker'
import { Label } from '@/components/ui/label'
import { useCounterparties } from '@/lib/hooks/useCounterparties'

interface Props {
  orgId: string
  /** The chosen counterparty id, or '' for none. */
  value: string
  onChange: (id: string) => void
  error?: string
}

export function CounterpartyField({ orgId, value, onChange, error }: Props) {
  const t = useTranslations('forms.transaction')
  const { counterparties } = useCounterparties(orgId)
  // What was typed in the picker when «add» was chosen; the form opens with it. Null: the form is closed.
  const [creating, setCreating] = useState<string | null>(null)
  const typedNip = creating !== null && /^\d{10}$/.test(creating.replace(/[\s-]/g, '')) ? creating.replace(/[\s-]/g, '') : undefined

  return (
    <div className="space-y-1">
      <Label htmlFor="tx-counterparty">{t('counterparty')}</Label>
      <CounterpartyPicker
        id="tx-counterparty"
        counterparties={counterparties}
        value={value || null}
        onChange={(id) => onChange(id ?? '')}
        onCreate={(typed) => setCreating(typed)}
      />
      {error && <p className="text-xs text-expense">{error}</p>}
      {creating !== null && (
        <CounterpartyForm
          orgId={orgId}
          initial={typedNip ? { nip: typedNip } : { name: creating }}
          onSaved={(saved) => onChange(saved.id)}
          onClose={() => setCreating(null)}
        />
      )}
    </div>
  )
}
