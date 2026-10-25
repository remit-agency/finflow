'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Building2, RefreshCw, Trash2, ChevronDown, ChevronUp, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  getBankConnections,
  saveBankConnection,
  deleteBankConnection,
  type BankConnection,
} from '@/lib/firebase/bankConnections'
import { ebFetch } from '@/lib/enablebanking/client'
import { EB_PENDING_KEY, acceptEbAuth } from '@/lib/enablebanking/pending'
import { useFormatters } from '@/lib/i18n/useFormatters'

interface Institution {
  id: string
  name: string
  country: string
  logo: string | null
}

interface Props {
  orgId: string
}

// Codes only; the labels (with the flag) live in the catalogs (settings.banks.countries.<code>).
const COUNTRIES = ['PL', 'DE', 'GB', 'FR', 'NL', 'LT', 'UA'] as const

export default function EnableBankingConnect({ orgId }: Props) {
  const t = useTranslations('settings.banks')
  const tErrors = useTranslations('errors.bank')
  const { date } = useFormatters()
  const searchParams = useSearchParams()
  const [connections, setConnections] = useState<BankConnection[]>([])
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [country, setCountry] = useState('PL')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const handledEbAuth = useRef<string | null>(null)

  // Subscribe to Firestore bank connections
  useEffect(() => {
    const unsub = getBankConnections(orgId, setConnections)
    return unsub
  }, [orgId])

  // Handle callback from Enable Banking OAuth. Only a connection that THIS tab started is saved
  // (see lib/enablebanking/pending.ts); `eb_auth` is always stripped from the URL, even if rejected.
  useEffect(() => {
    const payload = searchParams.get('eb_auth')
    // Once per payload: a second effect run (Strict Mode, re-render before the URL update lands)
    // would otherwise find the pending entry already consumed and report a false failure.
    if (!payload || handledEbAuth.current === payload) return
    handledEbAuth.current = payload
    const url = new URL(window.location.href)
    url.searchParams.delete('eb_auth')
    window.history.replaceState({}, '', url.toString())

    const hadPending = sessionStorage.getItem(EB_PENDING_KEY) !== null
    const accepted = acceptEbAuth(payload, sessionStorage, t('defaultInstitution'))
    if (!accepted) {
      // Deferred: on a fresh page load this effect runs before the root <Toaster> has subscribed
      // (child effects run first), and sonner drops toasts emitted before that.
      const message = hadPending ? tErrors('connectFailed') : tErrors('notConfirmed')
      setTimeout(() => toast.error(message), 0)
      return
    }
    const newConn: Omit<BankConnection, 'id'> = {
      sessionId: accepted.sessionId,
      institutionName: accepted.institutionName,
      connectedAt: new Date().toISOString(),
    }
    saveBankConnection(orgId, newConn)
      .then(() => toast.success(t('connected', { name: newConn.institutionName })))
      .catch(() => toast.error(tErrors('saveFailed')))
  }, [searchParams, orgId, t, tErrors])

  const loadInstitutions = async (c: string) => {
    setLoading(true)
    try {
      const res = await ebFetch(`/api/enablebanking/institutions?country=${encodeURIComponent(c)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setInstitutions(data.institutions ?? [])
    } catch { toast.error(tErrors('loadInstitutions')) }
    finally { setLoading(false) }
  }

  const handleShowPicker = async () => {
    if (!showPicker) await loadInstitutions(country)
    setShowPicker(v => !v)
  }

  const handleCountryChange = async (c: string) => {
    setCountry(c)
    await loadInstitutions(c)
  }

  const handleConnect = async (inst: Institution) => {
    setConnecting(true)
    try {
      const res = await ebFetch('/api/enablebanking/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aspspName: inst.id, aspspCountry: inst.country, orgId }),
      })
      const data = await res.json()
      if (res.status === 403 && data.error === 'email_not_verified') {
        toast.error(tErrors('emailNotVerified'))
        setConnecting(false)
        return
      }
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      sessionStorage.setItem(EB_PENDING_KEY, JSON.stringify({ name: inst.name, authorizationId: data.authorizationId }))
      window.location.href = data.url
    } catch (e) {
      toast.error(tErrors('connect', { message: e instanceof Error ? e.message : String(e) }))
      setConnecting(false)
    }
  }

  const handleDisconnect = async (sessionId: string) => {
    try {
      await deleteBankConnection(orgId, sessionId)
      toast.success(t('disconnected'))
    } catch {
      toast.error(tErrors('disconnectFailed'))
    }
  }

  const filtered = institutions.filter(i => i.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="space-y-4">
      {connections.map(conn => (
        <div key={conn.sessionId} className="flex items-center justify-between p-3 rounded-[8px] bg-[#f9fafb] border border-[#e5e7eb]">
          <div className="flex items-center gap-3">
            <Building2 className="w-5 h-5 text-[#6b7280]" />
            <div>
              <p className="text-sm font-medium text-[#111111]">{conn.institutionName}</p>
              <p className="text-xs text-[#6b7280]">
                {/* connectedAt is an ISO instant: shown as the Warsaw calendar day. */}
                {t('connectedOn', {
                  date: date(new Date(conn.connectedAt), { dateStyle: 'medium', timeZone: 'Europe/Warsaw' }),
                })}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="w-8 h-8 text-red-500 hover:text-red-600"
            onClick={() => handleDisconnect(conn.sessionId)}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      ))}

      <Button variant="outline" className="rounded-[8px] border-[#00c896] text-brand-soft-foreground hover:bg-[#00c896]/5"
        onClick={handleShowPicker} disabled={loading || connecting}>
        {showPicker ? <ChevronUp className="w-4 h-4 mr-2" /> : <ChevronDown className="w-4 h-4 mr-2" />}
        {connecting ? t('redirecting') : loading ? t('loading') : t('connect')}
      </Button>

      {showPicker && (
        <div className="border border-[#e5e7eb] rounded-[8px] p-3 space-y-3">
          <div className="flex gap-2 flex-wrap">
            {COUNTRIES.map(code => (
              <button key={code} onClick={() => handleCountryChange(code)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-all ${country === code ? 'bg-[#00c896] text-ink border-[#00c896]' : 'border-[#e5e7eb] text-[#6b7280] hover:border-[#00c896]'}`}>
                {t(`countries.${code}`)}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9ca3af]" />
            <Input value={search} onChange={e => setSearch(e.target.value)}
              placeholder={t('searchPlaceholder')} className="pl-8 text-sm rounded-[6px] border-[#e5e7eb]" />
          </div>
          {loading ? (
            <div className="flex items-center gap-2 py-4 justify-center">
              <RefreshCw className="w-4 h-4 animate-spin text-[#00c896]" />
              <span className="text-sm text-[#6b7280]">{t('loading')}</span>
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-1">
              {filtered.length === 0 ? (
                <p className="text-sm text-[#9ca3af] text-center py-4">{t('noneFound')}</p>
              ) : filtered.map(inst => (
                <button key={inst.id} onClick={() => handleConnect(inst)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[#e5e7eb] hover:border-[#00c896] hover:bg-[#f0fdf9] transition-all text-left">
                  {inst.logo
                    ? <img src={inst.logo} alt={inst.name} className="w-7 h-7 rounded object-contain" />
                    : <div className="w-7 h-7 rounded bg-[#f3f4f6] flex items-center justify-center text-xs font-bold text-[#6b7280]">{inst.name[0]}</div>
                  }
                  <span className="text-sm text-[#111111] flex-1">{inst.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
