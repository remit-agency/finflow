import type { Metadata } from 'next'
import { Unbounded, Manrope } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getTranslations } from 'next-intl/server'
import './globals.css'
import { AuthProvider } from '@/lib/hooks/useAuth'
import { OrgProvider } from '@/lib/hooks/useOrg'
import { Toaster } from '@/components/ui/sonner'

const unbounded = Unbounded({
  variable: '--font-display',
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  weight: ['400', '600', '700', '800', '900'],
  display: 'swap',
})

const manrope = Manrope({
  variable: '--font-body',
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta')
  return { title: t('title'), description: t('description') }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const locale = await getLocale()
  return (
    <html lang={locale} className={`${unbounded.variable} ${manrope.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        {/* enableColorScheme={false}: color-scheme comes from app/globals.css (`.dark`, and light
            under :root:has(.app-shell)); an inline one on <html> would beat the app shell's. */}
        <NextIntlClientProvider>
          <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} enableColorScheme={false}>
            <AuthProvider>
              <OrgProvider>
                {children}
                <Toaster />
              </OrgProvider>
            </AuthProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
