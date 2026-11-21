import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { PUBLIC_LEGAL_DOCS } from '@/lib/legal/versions'

/** A row of links to the three public legal documents. Synchronous so server pages and client pages (login, register) can both render it. */
export function LegalLinks() {
  const t = useTranslations('legal.links')
  return (
    <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
      {PUBLIC_LEGAL_DOCS.map((doc) => (
        <Link key={doc} href={`/legal/${doc}`} className="underline-offset-4 hover:underline">
          {t(doc)}
        </Link>
      ))}
    </nav>
  )
}
