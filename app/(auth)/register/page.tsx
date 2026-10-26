'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher'
import { useAuth } from '@/lib/hooks/useAuth'
import { useOrg } from '@/lib/hooks/useOrg'
import { auth } from '@/lib/firebase/firebase'
import { getMyOrganizationsForAuthPage } from '@/lib/firebase/members'
import { createOrgViaApi } from '@/lib/firebase/orgs-client'
import { classifyAuthFailure } from '@/lib/firebase/auth-errors'

const CURRENCIES = ['UAH', 'EUR', 'USD', 'PLN'] as const

async function hasNoCompany(uid: string): Promise<boolean> {
  return (await getMyOrganizationsForAuthPage(uid)).length === 0
}

export default function RegisterPage() {
  const t = useTranslations('auth.register')
  const tAuth = useTranslations('auth')
  const tErr = useTranslations('errors')
  const router = useRouter()
  const { user, loading: authLoading, signUp, signInGoogle, signOut } = useAuth()
  const { orgId: currentOrgId, loading: orgLoading, switchOrg } = useOrg()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [orgName, setOrgName] = useState('')
  const [currency, setCurrency] = useState('PLN')
  const [loading, setLoading] = useState(false)
  // True while a company-only submit runs, so that form does not flip while it is busy.
  const [companyOnlySubmit, setCompanyOnlySubmit] = useState(false)

  // A signed-in user without a company: their sign-up stopped before the company was created (or a
  // Google sign-in has no company yet). The account exists, so asking for name, email and password
  // again could only fail; the page then asks for the company alone. The real switch is this state;
  // `?step=org` (set by the login page) only picks the wording. During a normal sign-up the new
  // account is already signed in and has no company for a moment: the full form stays until it ends.
  const noCompany = !authLoading && user !== null && !orgLoading && currentOrgId === null
  const companyOnly = noCompany && (!loading || companyOnlySubmit)

  // OrgProvider's own load started when the user appeared, before a new org existed, so load the
  // org explicitly. The account, org and session already exist at this point: if that load fails,
  // still leave, with a full page load that rebuilds the org state from scratch.
  const showFailure = (err: unknown) => {
    const failure = classifyAuthFailure(err)
    toast.error(failure.kind === 'orgCreate' ? tErr(`orgCreate.${failure.code}`) : tErr(`auth.${failure.key}`))
  }

  const goToOrg = async (orgId: string) => {
    const ok = await switchOrg(orgId).then(() => true, () => false)
    if (ok) {
      router.push(`/${orgId}/transactions`)
    } else {
      // Deliberately a full page load (not router.push): it must rebuild the org state.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/${orgId}/transactions`)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (companyOnly) {
      if (orgName.trim().length === 0) return
    } else if (!name || !email || !password || !orgName) {
      return
    }

    setLoading(true)
    if (companyOnly) setCompanyOnlySubmit(true)
    try {
      // The SDK already has a signed-in user without a company (the form is in company-only mode,
      // or the user was signed in a moment ago): skip the sign-up and only create the company.
      const current = auth.currentUser
      if (current && orgName.trim().length > 0 && (companyOnly || (await hasNoCompany(current.uid)))) {
        const orgId = await createOrgViaApi(orgName.trim(), currency)
        await goToOrg(orgId)
        return
      }

      const { orgId } = await signUp(email, password, name, orgName, currency)
      await goToOrg(orgId)
    } catch (err: unknown) {
      showFailure(err)
    } finally {
      setLoading(false)
      setCompanyOnlySubmit(false)
    }
  }

  const handleGoogle = async () => {
    if (!orgName) {
      toast.error(t('googleNeedsCompany'))
      return
    }
    setLoading(true)
    try {
      const { user: googleUser } = await signInGoogle()
      const existingOrgs = await getMyOrganizationsForAuthPage(googleUser.uid)
      if (existingOrgs.length > 0) {
        await goToOrg(existingOrgs[0].id)
        return
      }
      const orgId = await createOrgViaApi(orgName, currency)
      await goToOrg(orgId)
    } catch (err: unknown) {
      showFailure(err)
    } finally {
      setLoading(false)
    }
  }

  const isValid = name.length > 0 && email.length > 0 && password.length >= 6 && orgName.length > 0

  // Only the wording depends on `?step=org`. `companyOnly` is never true on the server or during
  // hydration (it needs the signed-in user), so reading the URL here cannot cause a mismatch.
  const fromLogin = companyOnly && new URLSearchParams(window.location.search).get('step') === 'org'

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-[#0f0f0f] px-4 py-8">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher variant="select" />
      </div>
      <Card className="w-full max-w-[440px] bg-white rounded-[12px] shadow-lg">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-[8px] bg-[#00c896] flex items-center justify-center">
              <span className="text-white font-semibold text-sm">F</span>
            </div>
            <span className="text-[#111111] font-semibold text-lg">FinFlow</span>
          </div>
          <CardTitle className="text-[#111111] text-xl font-semibold">
            {companyOnly
              ? fromLogin
                ? t('companyOnlyFromLoginTitle')
                : t('companyOnlyTitle')
              : t('title')}
          </CardTitle>
          <CardDescription className="text-[#6b7280]">
            {companyOnly
              ? fromLogin
                ? t('companyOnlyFromLoginDescription')
                : t('companyOnlyDescription')
              : t('description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {!companyOnly && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-[#111111] text-sm font-medium">
                    {t('name')}
                  </Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder={t('namePlaceholder')}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="rounded-[6px] border-[#e5e7eb] text-[#111111] focus-visible:ring-[#00c896]"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-[#111111] text-sm font-medium">
                    {t('email')}
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder={t('emailPlaceholder')}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="rounded-[6px] border-[#e5e7eb] text-[#111111] focus-visible:ring-[#00c896]"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-[#111111] text-sm font-medium">
                    {t('password')}
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder={t('passwordPlaceholder')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="rounded-[6px] border-[#e5e7eb] text-[#111111] focus-visible:ring-[#00c896]"
                    minLength={6}
                    required
                  />
                </div>
              </>
            )}

            <div className={companyOnly ? 'space-y-4' : 'border-t border-[#e5e7eb] pt-4 space-y-4'}>
              {!companyOnly && (
                <p className="text-xs text-[#6b7280] font-medium uppercase tracking-wide">
                  {t('companySection')}
                </p>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="orgName" className="text-[#111111] text-sm font-medium">
                  {t('orgName')}
                </Label>
                <Input
                  id="orgName"
                  type="text"
                  placeholder={t('orgNamePlaceholder')}
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  className="rounded-[6px] border-[#e5e7eb] text-[#111111] focus-visible:ring-[#00c896]"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="currency" className="text-[#111111] text-sm font-medium">
                  {t('currency')}
                </Label>
                <Select value={currency} onValueChange={(v) => v && setCurrency(v)}>
                  <SelectTrigger
                    id="currency"
                    className="rounded-[6px] border-[#e5e7eb] text-[#111111] focus:ring-[#00c896]"
                  >
                    <SelectValue placeholder={t('currencyPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {tAuth(`currencies.${c}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-[#00c896] hover:bg-[#00b584] text-white rounded-[8px] font-medium disabled:opacity-50"
            >
              {companyOnly
                ? loading ? t('creatingCompany') : t('createCompany')
                : loading ? t('submitting') : t('submit')}
            </Button>
          </form>

          {companyOnly ? (
            <p className="text-center text-sm text-[#6b7280] mt-4">
              {t('notYou')}{' '}
              <button
                type="button"
                onClick={() => void signOut()}
                className="text-[#00c896] hover:underline font-medium"
              >
                {t('signOut')}
              </button>
            </p>
          ) : (
            <>
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[#e5e7eb]" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white px-2 text-[#6b7280]">{tAuth('or')}</span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={handleGoogle}
                disabled={loading}
                className="w-full rounded-[8px] border-[#e5e7eb] text-[#111111] hover:bg-[#f9fafb]"
              >
                <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                {t('google')}
              </Button>

              <p className="text-center text-sm text-[#6b7280] mt-4">
                {t('haveAccount')}{' '}
                <Link href="/login" className="text-[#00c896] hover:underline font-medium">
                  {t('toLogin')}
                </Link>
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
