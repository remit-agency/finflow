'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { ebFetch } from '@/lib/enablebanking/client'
import { connectErrorKey, type ConnectErrorKey } from '@/lib/enablebanking/errors'

export type PsuType = 'business' | 'personal'

/** The bank a renewal connects to again, taken from the existing connection. */
export interface PickerInitial {
  name: string
  country: string
  psuType: PsuType
}

interface Institution {
  id: string
  name: string
  country: string
  logo: string | null
}

interface Props {
  orgId: string
  /** Renewal: the picker connects to this bank at once and shows only the redirect. */
  initial?: PickerInitial
  onCancel?: () => void
}

// Codes only; the labels (with the flag) live in the catalogs (settings.banks.countries.<code>).
const COUNTRIES = ['PL', 'DE', 'GB', 'FR', 'NL', 'LT', 'UA'] as const

/**
 * Starts the bank login: the server signs the state and answers with the bank's URL, the browser goes there.
 * Resolves to null while the browser is leaving, or to the message key when the start failed. The raw
 * status and code go to the console only.
 */
async function startConnection(orgId: string, aspsp: { id: string; country: string }, psuType: PsuType): Promise<ConnectErrorKey | null> {
  let status: number | null = null
  let code: unknown
  try {
    const res = await ebFetch('/api/enablebanking/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aspspName: aspsp.id, aspspCountry: aspsp.country, orgId, psuType }),
    })
    status = res.status
    const data = await res.json().catch(() => null)
    code = data?.error
    if (!res.ok || code || !data?.url) throw new Error(typeof code === 'string' ? code : `HTTP ${res.status}`)
    window.location.href = data.url
    return null
  } catch (e) {
    console.error('Bank connection failed', { status, code, error: e })
    return connectErrorKey(status, code)
  }
}

/** Institution search (by country), the business/personal choice, and the start of a connection. */
export function BankPicker({ orgId, initial, onCancel }: Props) {
  const t = useTranslations('settings.banks')
  const tErrors = useTranslations('errors.bank')
  const tCommon = useTranslations('common')
  const [country, setCountry] = useState(initial?.country ?? 'PL')
  const [psuType, setPsuType] = useState<PsuType>(initial?.psuType ?? 'business')
  const [search, setSearch] = useState('')
  // Institutions per country: a list, or 'failed'. A country missing here is still loading.
  const [lists, setLists] = useState<Record<string, Institution[] | 'failed'>>({})
  // A renewal starts connecting at mount, so it begins in the connecting state.
  const [connecting, setConnecting] = useState(initial !== undefined)
  const started = useRef(false)

  // Shows the failure and lets the person try again; a successful start leaves the page, so nothing resets.
  const launch = useCallback(
    (aspsp: { id: string; country: string }, type: PsuType) =>
      startConnection(orgId, aspsp, type).then((key) => {
        if (key === null) return
        setConnecting(false)
        toast.error(tErrors(key))
      }),
    [orgId, tErrors],
  )

  // Renewal: connect to the same bank right away, once (the ref survives Strict Mode's second effect run).
  useEffect(() => {
    if (!initial || started.current) return
    started.current = true
    void launch({ id: initial.name, country: initial.country }, initial.psuType)
  }, [initial, launch])

  // The institutions of the chosen country, loaded when it is first shown (not on renewal).
  useEffect(() => {
    if (initial || country in lists) return
    let cancelled = false
    ebFetch(`/api/enablebanking/institutions?country=${encodeURIComponent(country)}`)
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
        return (data.institutions ?? []) as Institution[]
      })
      .then(
        (list) => !cancelled && setLists((prev) => ({ ...prev, [country]: list })),
        (e) => {
          console.error('Loading banks failed', e)
          if (cancelled) return
          setLists((prev) => ({ ...prev, [country]: 'failed' }))
          toast.error(tErrors('loadInstitutions'))
        },
      )
    return () => {
      cancelled = true
    }
  }, [country, lists, initial, tErrors])

  const current = lists[country]
  const filtered = Array.isArray(current) ? current.filter((i) => i.name.toLowerCase().includes(search.toLowerCase())) : []

  if (connecting) {
    return (
      <div className="flex items-center gap-2 py-4 justify-center" role="status">
        <RefreshCw className="w-4 h-4 animate-spin text-[#00c896]" aria-hidden />
        <span className="text-sm text-[#6b7280]">{t('redirecting')}</span>
      </div>
    )
  }

  const handlePick = (inst: Institution) => {
    setConnecting(true)
    void launch({ id: inst.id, country: inst.country }, psuType)
  }

  return (
    <div className="space-y-3 rounded-[8px] border border-[#e5e7eb] p-3">
      <Segmented
        label={t('psuType.label')}
        value={psuType}
        onChange={setPsuType}
        options={[
          { value: 'business', label: t('psuType.business') },
          { value: 'personal', label: t('psuType.personal') },
        ]}
      />
      <div className="flex flex-wrap gap-2">
        {COUNTRIES.map((code) => (
          <button
            key={code}
            type="button"
            aria-pressed={country === code}
            onClick={() => setCountry(code)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-all ${country === code ? 'bg-[#00c896] text-ink border-[#00c896]' : 'border-[#e5e7eb] text-[#6b7280] hover:border-[#00c896]'}`}
          >
            {t(`countries.${code}`)}
          </button>
        ))}
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9ca3af]" aria-hidden />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="pl-8 text-sm rounded-[6px] border-[#e5e7eb]"
        />
      </div>
      {current === undefined ? (
        <div className="flex items-center gap-2 py-4 justify-center">
          <RefreshCw className="w-4 h-4 animate-spin text-[#00c896]" aria-hidden />
          <span className="text-sm text-[#6b7280]">{t('loading')}</span>
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto space-y-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-[#9ca3af] text-center py-4">{t('noneFound')}</p>
          ) : (
            filtered.map((inst) => (
              <button
                key={inst.id}
                type="button"
                onClick={() => handlePick(inst)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[#e5e7eb] hover:border-[#00c896] hover:bg-[#f0fdf9] transition-all text-left"
              >
                {inst.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- bank logos come from the Enable Banking CDN, not optimised here
                  <img src={inst.logo} alt={inst.name} className="w-7 h-7 rounded object-contain" />
                ) : (
                  <div className="w-7 h-7 rounded bg-[#f3f4f6] flex items-center justify-center text-xs font-bold text-[#6b7280]" aria-hidden>
                    {inst.name[0]}
                  </div>
                )}
                <span className="text-sm text-[#111111] flex-1">{inst.name}</span>
              </button>
            ))
          )}
        </div>
      )}
      {onCancel && (
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            {tCommon('cancel')}
          </Button>
        </div>
      )}
    </div>
  )
}
