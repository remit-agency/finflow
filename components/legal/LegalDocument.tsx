import { getTranslations } from 'next-intl/server'
import { fillOperator, getLegalContent } from '@/content/legal'
import { OPERATOR } from '@/content/legal/operator'
import type { LegalBlock } from '@/lib/legal/content-types'
import type { Locale } from '@/lib/i18n/config'
import { LEGAL_VERSIONS, type PublicLegalDoc } from '@/lib/legal/versions'

const TABLE = 'w-full border-collapse text-left text-sm'
const CELL = 'border border-border px-3 py-2 align-top'

/** One public legal document in one language (server component). Operator tokens are filled here. */
export async function LegalDocument({ doc, locale }: { doc: PublicLegalDoc; locale: Locale }) {
  const t = await getTranslations('legal')
  const content = getLegalContent(doc, locale)
  const fill = (text: string) => fillOperator(text, OPERATOR)

  function renderBlock(block: LegalBlock, key: number) {
    switch (block.kind) {
      case 'p':
        return <p key={key}>{fill(block.text)}</p>
      case 'ul':
        return (
          <ul key={key} className="list-disc space-y-1 pl-6">
            {block.items.map((item, i) => (
              <li key={i}>{fill(item)}</li>
            ))}
          </ul>
        )
      case 'table':
        return (
          <div key={key} className="overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  {block.head.map((h, i) => (
                    <th key={i} scope="col" className={CELL}>
                      {fill(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c} className={CELL}>
                        {fill(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      case 'processors':
        return (
          <div key={key} className="overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th scope="col" className={CELL}>{t('processors.name')}</th>
                  <th scope="col" className={CELL}>{t('processors.purpose')}</th>
                  <th scope="col" className={CELL}>{t('processors.country')}</th>
                </tr>
              </thead>
              <tbody>
                {OPERATOR.processors.map((p) => (
                  <tr key={p.name}>
                    <td className={CELL}>{p.name}</td>
                    <td className={CELL}>{p.purpose[locale]}</td>
                    <td className={CELL}>{p.country}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
    }
  }

  return (
    <article className="space-y-6 leading-relaxed">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">{fill(content.title)}</h1>
        {doc !== 'cookies' && <p className="text-sm text-muted-foreground">{t('version', { version: LEGAL_VERSIONS[doc] })}</p>}
        <p>{fill(content.intro)}</p>
      </header>

      <nav aria-labelledby="legal-toc" className="rounded-md border border-border px-4 py-3">
        <h2 id="legal-toc" className="mb-2 text-sm font-semibold">{t('toc')}</h2>
        <ol className="list-decimal space-y-1 pl-6 text-sm">
          {content.sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="underline-offset-4 hover:underline">{fill(s.title)}</a>
            </li>
          ))}
        </ol>
      </nav>

      {content.sections.map((s) => (
        <section key={s.id} id={s.id} className="scroll-mt-6 space-y-3">
          <h2 className="text-xl font-semibold">{fill(s.title)}</h2>
          {s.blocks.map(renderBlock)}
        </section>
      ))}
    </article>
  )
}
