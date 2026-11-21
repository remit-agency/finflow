import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getLocale } from 'next-intl/server'
import { getLegalContent } from '@/content/legal'
import { DraftBanner } from '@/components/legal/DraftBanner'
import { LegalDocument } from '@/components/legal/LegalDocument'
import { LegalLinks } from '@/components/legal/LegalLinks'
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher'
import { isLocale } from '@/lib/i18n/config'
import { PUBLIC_LEGAL_DOCS, isPublicLegalDoc } from '@/lib/legal/versions'

export function generateStaticParams() {
  return PUBLIC_LEGAL_DOCS.map((doc) => ({ doc }))
}

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }): Promise<Metadata> {
  const { doc } = await params
  if (!isPublicLegalDoc(doc)) return {}
  const locale = await getLocale()
  if (!isLocale(locale)) return {}
  return { title: `${getLegalContent(doc, locale).title} — FinFlow` }
}

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params
  if (!isPublicLegalDoc(doc)) notFound()
  const locale = await getLocale()
  if (!isLocale(locale)) notFound()

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6">
      <header className="flex items-center justify-between">
        <Link href="/" className="text-lg font-bold">FinFlow</Link>
        <LanguageSwitcher variant="select" />
      </header>
      <DraftBanner />
      <main>
        <LegalDocument doc={doc} locale={locale} />
      </main>
      <footer className="border-t border-border pt-4">
        <LegalLinks />
      </footer>
    </div>
  )
}
