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
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher'
import { useAuth } from '@/lib/hooks/useAuth'
import { getMyOrganizationsForAuthPage } from '@/lib/firebase/members'
import { safeRedirectPath } from '@/lib/auth/paths'
import { authErrorKey } from '@/lib/firebase/auth-errors'

export default function LoginPage() {
  const t = useTranslations('auth.login')
  const tAuth = useTranslations('auth')
  const tAuthErr = useTranslations('errors.auth')
  const router = useRouter()
  const { signIn, signInGoogle } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) return

    setLoading(true)
    try {
      const user = await signIn(email, password)
      const orgs = await getMyOrganizationsForAuthPage(user.uid)
      if (orgs.length > 0) {
        const target = safeRedirectPath(new URLSearchParams(window.location.search).get('redirect'))
        router.push(target ?? `/${orgs[0].id}/transactions`)
      } else {
        // Signed in but without a company (e.g. a sign-up that stopped before the company was created).
        router.push('/register?step=org')
      }
    } catch (err: unknown) {
      toast.error(tAuthErr(authErrorKey(err)))
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = async () => {
    setLoading(true)
    try {
      const { user } = await signInGoogle()
      const orgs = await getMyOrganizationsForAuthPage(user.uid)
      if (orgs.length > 0) {
        const target = safeRedirectPath(new URLSearchParams(window.location.search).get('redirect'))
        router.push(target ?? `/${orgs[0].id}/transactions`)
      } else {
        router.push('/register?step=org')
      }
    } catch (err: unknown) {
      toast.error(tAuthErr(authErrorKey(err)))
    } finally {
      setLoading(false)
    }
  }

  const isValid = email.length > 0 && password.length >= 6

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-[#0f0f0f] px-4">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher variant="select" />
      </div>
      <Card className="w-full max-w-[400px] bg-white rounded-[12px] shadow-lg">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-[8px] bg-[#00c896] flex items-center justify-center">
              <span className="text-white font-semibold text-sm">F</span>
            </div>
            <span className="text-[#111111] font-semibold text-lg">FinFlow</span>
          </div>
          <CardTitle className="text-[#111111] text-xl font-semibold">{t('title')}</CardTitle>
          <CardDescription className="text-[#6b7280]">{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
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
                required
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-[#00c896] hover:bg-[#00b584] text-white rounded-[8px] font-medium disabled:opacity-50"
            >
              {loading ? t('submitting') : t('submit')}
            </Button>
          </form>

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
            {t('noAccount')}{' '}
            <Link href="/register" className="text-[#00c896] hover:underline font-medium">
              {t('toRegister')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
