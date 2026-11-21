import Link from 'next/link'
import { ArrowRight, Check } from 'lucide-react'
import type { Metadata } from 'next'
import { ThemeToggle } from '@/components/ThemeToggle'
import { LegalLinks } from '@/components/legal/LegalLinks'

export const metadata: Metadata = {
  title: 'Ціни — FinFlow',
  description: 'Один план для всього. $29/місяць або $24/місяць при річній оплаті. 14 днів безкоштовно — без кредитної картки.',
}

const features = [
  'Необмежена кількість транзакцій',
  'Необмежена кількість рахунків',
  'Cash Flow і P&L звіти',
  'Платіжний календар і баланс',
  'Експорт CSV',
  'Підтримка в робочі дні',
]

const faq = [
  { q: 'Що відбувається після 14 днів?', a: 'Ви отримаєте нагадування за 3 дні. Якщо не підписались — доступ переходить в режим читання. Дані не видаляються.' },
  { q: 'Чи можна скасувати підписку?', a: 'Так, в будь-який момент з налаштувань. Доступ зберігається до кінця оплаченого місяця.' },
  { q: 'Скільки компаній можна вести?', a: 'Один акаунт — одна організація. Для кількох компаній — окремі акаунти.' },
]

export default function PricingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-[#f7f7f5] dark:bg-[#0a0a0a] text-[#0d0d0d] dark:text-[#f0f0f0]">

      {/* Nav */}
      <header className="border-b border-black/[0.07] dark:border-white/[0.06] sticky top-0 bg-[#f7f7f5]/92 dark:bg-[#0a0a0a]/90 backdrop-blur-md z-50">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#00c896] flex items-center justify-center">
              <span className="text-black font-black text-sm leading-none">F</span>
            </div>
            <span className="font-display font-bold text-[15px] tracking-tight text-[#0d0d0d] dark:text-white">FinFlow</span>
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm text-black/45 dark:text-white/45">
            <Link href="/#features" className="hover:text-black dark:hover:text-white transition-colors duration-200">Можливості</Link>
            <Link href="/pricing" className="text-[#0d0d0d] dark:text-white font-medium">Ціни</Link>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/login" className="text-sm text-black/45 dark:text-white/45 hover:text-black dark:hover:text-white transition-colors duration-200">
              Увійти
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">

        {/* Header */}
        <section className="pt-24 pb-16 px-6 text-center">
          <div className="max-w-xl mx-auto">
            <p className="text-[11px] font-bold text-[#00c896] uppercase tracking-[0.25em] mb-5">Тарифи</p>
            <h1 className="font-display text-[3rem] md:text-[3.5rem] font-black text-[#0d0d0d] dark:text-white tracking-[-0.04em] leading-[1.02] mb-5">
              Один план.<br />Все включено.
            </h1>
            <p className="text-lg text-black/42 dark:text-white/40 leading-relaxed">
              Жодних рівнів, жодних прихованих обмежень.<br />
              Один прозорий тариф для команд до 50 осіб.
            </p>
          </div>
        </section>

        {/* Pricing card */}
        <section className="pb-28 px-6">
          <div className="max-w-[460px] mx-auto">
            <div className="rounded-2xl border border-[#00c896]/22 bg-white dark:bg-[#0d0d0d] p-9">
              <div className="flex items-start justify-between mb-7">
                <div>
                  <p className="text-[11px] font-bold text-[#00c896] uppercase tracking-[0.2em] mb-4">Pro</p>
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-[3.75rem] font-black text-[#0d0d0d] dark:text-white tracking-tight leading-none">$29</span>
                    <span className="text-black/35 dark:text-white/35 text-lg">/місяць</span>
                  </div>
                  <p className="text-sm text-[#00c896]/70 font-medium mt-2">
                    або $24/міс при річній оплаті — економія $60/рік
                  </p>
                </div>
                <span className="mt-1 text-[10px] font-bold text-[#00c896] border border-[#00c896]/25 bg-[#00c896]/[0.08] px-2.5 py-1 rounded-full uppercase tracking-wider">
                  Популярний
                </span>
              </div>

              <ul className="space-y-3.5 mb-9">
                {features.map((feature) => (
                  <li key={feature} className="flex items-center gap-3">
                    <Check className="w-4 h-4 text-[#00c896] shrink-0" />
                    <span className="text-sm text-black/60 dark:text-white/60">{feature}</span>
                  </li>
                ))}
              </ul>

              <Link
                href="/register"
                className="inline-flex items-center justify-center gap-2 w-full bg-[#00c896] hover:bg-[#00daa6] text-black font-bold rounded-xl h-12 text-base transition-all duration-200"
                style={{ boxShadow: '0 0 40px hsla(161,100%,39%,0.2)' }}
              >
                Почати 14-денний trial
                <ArrowRight className="h-4 w-4" />
              </Link>
              <p className="text-center text-xs text-black/22 dark:text-white/22 mt-3">
                Кредитна картка не потрібна
              </p>
            </div>

            <div className="mt-4 p-4 rounded-xl border border-black/[0.08] dark:border-white/[0.07] bg-white dark:bg-[#0d0d0d]">
              <p className="text-sm text-black/38 dark:text-white/35 text-center">
                Річна оплата:&nbsp;
                <span className="font-semibold text-[#0d0d0d]/60 dark:text-white/60">$288/рік</span>
                &nbsp;замість $348 — платіть менше за лояльність.
              </p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-24 px-6 border-t border-black/[0.07] dark:border-white/[0.06]">
          <div className="max-w-2xl mx-auto">
            <h2 className="font-display text-[2rem] font-black text-[#0d0d0d] dark:text-white tracking-[-0.03em] mb-12 text-center">
              Часті питання
            </h2>
            <div>
              {faq.map((item, i) => (
                <div key={i} className="py-6 border-b border-black/[0.07] dark:border-white/[0.06] last:border-0">
                  <p className="font-semibold text-[#0d0d0d]/80 dark:text-white/80 mb-2.5">{item.q}</p>
                  <p className="text-black/42 dark:text-white/40 text-sm leading-relaxed">{item.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="border-t border-black/[0.07] dark:border-white/[0.06] py-10 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-[#00c896] flex items-center justify-center">
              <span className="text-black font-black text-xs">F</span>
            </div>
            <span className="font-display font-bold text-black/50 dark:text-white/50 text-sm">FinFlow</span>
          </Link>
          <p className="text-sm text-black/18 dark:text-white/18">© 2026 FinFlow</p>
        </div>
        <div className="max-w-6xl mx-auto mt-6 flex justify-center">
          <LegalLinks />
        </div>
      </footer>

    </div>
  )
}
