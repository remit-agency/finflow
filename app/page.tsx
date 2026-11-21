import Link from 'next/link'
import { ArrowRight, Check, BarChart2, Calendar, ArrowLeftRight, Code2, ShoppingCart, HardHat, Briefcase, Factory, PieChart } from 'lucide-react'
import { LandingNavLogin, LandingHeroLogin } from '@/components/landing/LandingAuthButtons'
import { ThemeToggle } from '@/components/ThemeToggle'
import { LegalLinks } from '@/components/legal/LegalLinks'

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen bg-[#f7f7f5] dark:bg-[#0a0a0a] text-[#0d0d0d] dark:text-[#f0f0f0]">

      {/* ── NAV ── */}
      <header className="border-b border-black/[0.07] dark:border-white/[0.06] sticky top-0 bg-[#f7f7f5]/92 dark:bg-[#0a0a0a]/90 backdrop-blur-md z-50">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#00c896] flex items-center justify-center">
              <span className="text-black font-black text-sm leading-none">F</span>
            </div>
            <span className="font-display font-bold text-[15px] tracking-tight text-[#0d0d0d] dark:text-white">FinFlow</span>
          </div>
          <nav className="hidden md:flex items-center gap-8 text-sm text-black/45 dark:text-white/45">
            <Link href="#features" className="hover:text-black dark:hover:text-white transition-colors duration-200">Можливості</Link>
            <Link href="#industries" className="hover:text-black dark:hover:text-white transition-colors duration-200">Для кого</Link>
            <Link href="/pricing" className="hover:text-black dark:hover:text-white transition-colors duration-200">Ціни</Link>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LandingNavLogin />
            <Link
              href="/register"
              className="inline-flex items-center gap-1.5 bg-[#00c896] hover:bg-[#00daa6] text-black font-semibold rounded-lg text-sm h-8 px-4 transition-colors duration-200"
            >
              Спробувати
            </Link>
          </div>
        </div>
      </header>

      <main>

        {/* ── HERO ── */}
        <section className="grain relative overflow-hidden min-h-[90vh] flex items-center bg-[#f7f7f5] dark:bg-[#0a0a0a]">
          <div
            className="absolute top-[-10%] left-[30%] w-[700px] h-[700px] rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, hsla(161,100%,39%,0.06) 0%, transparent 65%)' }}
          />
          <div
            className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, hsla(161,100%,39%,0.04) 0%, transparent 70%)' }}
          />

          <div className="max-w-6xl mx-auto px-6 w-full py-20 grid md:grid-cols-[1fr_420px] gap-12 lg:gap-20 items-center">

            {/* Left */}
            <div>
              <div className="animate-fade-up-1 inline-flex items-center gap-2 border border-[#00c896]/25 bg-[#00c896]/[0.06] text-[#00c896] text-xs font-semibold px-3 py-1.5 rounded-full mb-8 tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full bg-[#00c896]" />
                14 днів безкоштовно — без картки
              </div>
              <h1 className="animate-fade-up-2 font-display text-[3.25rem] md:text-[4rem] lg:text-[4.5rem] font-black leading-[1.02] tracking-[-0.04em] mb-6 text-[#0d0d0d] dark:text-white">
                Фінанси<br />
                бізнесу<br />
                <span className="text-[#00c896]">без Excel</span>
              </h1>
              <p className="animate-fade-up-3 text-[1.0625rem] text-black/50 dark:text-white/50 leading-relaxed mb-10 max-w-[420px]">
                Cash Flow, P&amp;L і рух грошей для команд 2–50 осіб.
                Один зрозумілий інструмент замість таблиць.
              </p>
              <div className="animate-fade-up-4 flex flex-col sm:flex-row gap-3">
                <Link
                  href="/register"
                  className="inline-flex items-center justify-center gap-2 bg-[#00c896] hover:bg-[#00daa6] text-black font-bold rounded-xl h-12 px-8 text-[0.9375rem] transition-all duration-200"
                  style={{ boxShadow: '0 0 40px hsla(161,100%,39%,0.25)' }}
                >
                  Почати безкоштовно
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <LandingHeroLogin />
              </div>
            </div>

            {/* Right: Dashboard preview */}
            <div className="animate-fade-up-3 relative hidden md:block">
              <div
                className="rounded-2xl border border-black/[0.09] dark:border-white/[0.08] bg-white dark:bg-[#0f0f0f] overflow-hidden"
                style={{ boxShadow: '0 32px 64px rgba(0,0,0,0.08)' }}
              >
                <div className="flex items-center gap-1.5 px-4 py-3 border-b border-black/[0.07] dark:border-white/[0.06] bg-[#f5f5f3] dark:bg-[#0c0c0c]">
                  <span className="w-2.5 h-2.5 rounded-full bg-black/[0.08] dark:bg-white/[0.08]" />
                  <span className="w-2.5 h-2.5 rounded-full bg-black/[0.08] dark:bg-white/[0.08]" />
                  <span className="w-2.5 h-2.5 rounded-full bg-black/[0.08] dark:bg-white/[0.08]" />
                  <span className="text-[10px] text-black/20 dark:text-white/20 ml-2 font-mono tracking-wider">finflow.app</span>
                </div>
                <div className="p-4 grid grid-cols-3 gap-2">
                  {[
                    { label: 'Баланс', value: '₴248 350', color: '#00c896' },
                    { label: 'Дохід', value: '+₴85 000', color: '#22c55e' },
                    { label: 'Витрати', value: '−₴52 400', color: '#ef4444' },
                  ].map((card) => (
                    <div key={card.label} className="bg-[#f0f0ee] dark:bg-[#141414] rounded-xl border border-black/[0.06] dark:border-white/[0.06] p-3">
                      <p className="text-[10px] text-black/30 dark:text-white/30 mb-1.5 tracking-wide">{card.label}</p>
                      <p className="font-display text-sm font-bold tabular-nums" style={{ color: card.color }}>{card.value}</p>
                    </div>
                  ))}
                </div>
                <div className="px-4 pb-4 space-y-1.5">
                  {[
                    { name: 'Клієнт «Альфа» — оплата', cat: 'Продажі', amount: '+₴45 000', color: '#22c55e' },
                    { name: 'Оренда офісу', cat: 'Операційні', amount: '−₴12 000', color: '#ef4444' },
                    { name: 'Зарплата команди', cat: 'Зарплата', amount: '−₴85 000', color: '#ef4444' },
                  ].map((tx, i) => (
                    <div key={i} className="bg-[#f0f0ee] dark:bg-[#141414] rounded-xl border border-black/[0.06] dark:border-white/[0.06] px-3 py-2.5 flex items-center justify-between">
                      <div>
                        <p className="text-[11px] font-medium text-black/70 dark:text-white/70">{tx.name}</p>
                        <p className="text-[10px] text-black/30 dark:text-white/25 mt-0.5">{tx.cat}</p>
                      </div>
                      <p className="font-display text-[11px] font-bold tabular-nums" style={{ color: tx.color }}>{tx.amount}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div
                className="absolute -bottom-6 -right-6 w-28 h-28 rounded-full border border-[#00c896]/10"
                style={{ background: 'radial-gradient(circle, hsla(161,100%,39%,0.04) 0%, transparent 60%)' }}
              />
            </div>
          </div>
        </section>

        {/* ── FOR WHOM ── */}
        <section id="industries" className="py-24 px-6 border-t border-black/[0.07] dark:border-white/[0.06]">
          <div className="max-w-5xl mx-auto">
            <div className="mb-14">
              <p className="text-[11px] font-bold text-[#00c896] uppercase tracking-[0.25em] mb-4">Для кого</p>
              <h2 className="font-display text-[2.5rem] font-black text-[#0d0d0d] dark:text-white tracking-[-0.03em] leading-tight">Оберіть свою нішу</h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { icon: Code2,        color: '#6366f1', bg: 'bg-[#6366f1]/10 dark:bg-[#6366f1]/10', title: 'IT та агенції',  desc: 'Проекти, зарплати підрядників, клієнтські платежі' },
                { icon: ShoppingCart, color: '#f59e0b', bg: 'bg-[#f59e0b]/10 dark:bg-[#f59e0b]/10', title: 'Торгівля',       desc: 'Закупки, продажі, залишки, маржинальність' },
                { icon: HardHat,      color: '#fb923c', bg: 'bg-[#fb923c]/10 dark:bg-[#fb923c]/10', title: 'Будівництво',    desc: 'Кошториси, витрати по об\'єктах, аванси' },
                { icon: Briefcase,    color: '#00c896', bg: 'bg-[#00c896]/10 dark:bg-[#00c896]/10', title: 'Послуги',         desc: 'Підписки, регулярні доходи, клієнти' },
                { icon: Factory,      color: '#64748b', bg: 'bg-[#64748b]/10 dark:bg-[#64748b]/10', title: 'Виробництво',    desc: 'Сировина, собівартість, витрати' },
                { icon: PieChart,     color: '#ec4899', bg: 'bg-[#ec4899]/10 dark:bg-[#ec4899]/10', title: 'Фінансисти',     desc: 'P&L, Cash Flow, баланс в одному місці' },
              ].map((item) => {
                const Icon = item.icon
                return (
                <div
                  key={item.title}
                  className="group p-5 rounded-2xl border border-black/[0.08] dark:border-white/[0.07] hover:border-[#00c896]/30 hover:bg-[#00c896]/[0.02] dark:hover:bg-[#00c896]/[0.03] transition-all duration-300 cursor-pointer bg-white dark:bg-transparent"
                >
                  <div className={`w-9 h-9 rounded-xl ${item.bg} flex items-center justify-center mb-4`}>
                    <Icon className="w-4 h-4" style={{ color: item.color }} />
                  </div>
                  <h3 className="font-semibold text-[#0d0d0d]/85 dark:text-white/85 mb-1.5 text-sm">{item.title}</h3>
                  <p className="text-xs text-black/38 dark:text-white/35 leading-relaxed">{item.desc}</p>
                </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── FEATURES ── */}
        <section id="features" className="py-24 px-6 border-t border-black/[0.07] dark:border-white/[0.06]">
          <div className="max-w-5xl mx-auto">
            <div className="mb-16">
              <p className="text-[11px] font-bold text-[#00c896] uppercase tracking-[0.25em] mb-4">Можливості</p>
              <h2 className="font-display text-[2.5rem] font-black text-[#0d0d0d] dark:text-white tracking-[-0.03em]">Все що потрібно</h2>
            </div>
            <div className="space-y-2">
              {[
                { num: '01', icon: ArrowLeftRight, color: '#00c896', title: 'Транзакції в реальному часі', desc: 'Доходи, витрати, перекази. Пошук і фільтри за рахунком, категорією та датою.', items: ['Дохід / Витрата / Переказ', 'Фільтр по рахунку', 'Кольорове кодування'] },
                { num: '02', icon: BarChart2, color: '#818cf8', title: 'Cash Flow та P&L', desc: 'Графік руху грошей і звіт прибутків/збитків по категоріях.', items: ['Bar chart + лінія балансу', 'Pie charts', 'Експорт CSV'] },
                { num: '03', icon: Calendar, color: '#f59e0b', title: 'Платіжний календар', desc: 'Операції по днях. Касовий розрив видно одразу.', items: ['Навігація по місяцях', 'Щоденні підсумки', 'Залишок на кожен день'] },
              ].map((f) => {
                const Icon = f.icon
                return (
                  <div
                    key={f.title}
                    className="group grid md:grid-cols-[72px_1fr_220px] gap-6 items-center px-6 py-5 rounded-2xl border border-black/[0.07] dark:border-white/[0.06] hover:border-black/[0.12] dark:hover:border-white/[0.11] hover:bg-black/[0.015] dark:hover:bg-white/[0.018] transition-all duration-300"
                  >
                    <span className="font-display text-[2.75rem] font-black text-black/[0.05] dark:text-white/[0.05] tabular-nums leading-none select-none">
                      {f.num}
                    </span>
                    <div>
                      <div className="flex items-center gap-2.5 mb-1.5">
                        <Icon className="w-4 h-4 shrink-0" style={{ color: f.color }} />
                        <h3 className="font-semibold text-[#0d0d0d]/85 dark:text-white/85 text-[0.9375rem]">{f.title}</h3>
                      </div>
                      <p className="text-sm text-black/40 dark:text-white/38 leading-relaxed">{f.desc}</p>
                    </div>
                    <ul className="hidden md:flex flex-col gap-1.5">
                      {f.items.map((item) => (
                        <li key={item} className="flex items-center gap-2 text-xs text-black/38 dark:text-white/35">
                          <Check className="w-3 h-3 text-[#00c896]/70 shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── VS EXCEL ── */}
        <section className="py-24 px-6 border-t border-black/[0.07] dark:border-white/[0.06]">
          <div className="max-w-4xl mx-auto">
            <div className="mb-14">
              <p className="text-[11px] font-bold text-[#00c896] uppercase tracking-[0.25em] mb-4">Порівняння</p>
              <h2 className="font-display text-[2.5rem] font-black text-[#0d0d0d] dark:text-white tracking-[-0.03em]">Чому не Excel?</h2>
              <p className="text-black/40 dark:text-white/38 mt-3 text-base">Excel — інструмент для таблиць, не для фінансового обліку команди</p>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-black/[0.08] dark:border-white/[0.07] bg-white dark:bg-[#0d0d0d] p-7">
                <p className="text-[11px] font-bold text-black/25 dark:text-white/25 uppercase tracking-[0.2em] mb-6">Excel / Google Sheets</p>
                <ul className="space-y-4">
                  {['Ручне зведення кожного місяця', 'Формули ламаються при редагуванні', 'Помилки при копіюванні', 'Немає автоматичних звітів'].map((t) => (
                    <li key={t} className="flex items-start gap-3 text-sm text-black/35 dark:text-white/30">
                      <span className="text-red-500/50 shrink-0 mt-0.5 leading-none text-base">—</span>
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-[#00c896]/20 bg-[#00c896]/[0.025] p-7">
                <p className="text-[11px] font-bold text-[#00c896] uppercase tracking-[0.2em] mb-6">FinFlow</p>
                <ul className="space-y-4">
                  {['Автоматичний підрахунок в реальному часі', 'Дані зберігаються без формул', 'Доступ з будь-якого пристрою', 'Редагуйте що завгодно — нічого не ламається', 'Cash Flow і P&L готові автоматично'].map((t) => (
                    <li key={t} className="flex items-start gap-3 text-sm text-[#0d0d0d]/72 dark:text-white/70">
                      <Check className="w-3.5 h-3.5 text-[#00c896] mt-0.5 shrink-0" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── PRICING TEASER ── */}
        <section className="py-24 px-6 border-t border-black/[0.07] dark:border-white/[0.06]">
          <div className="max-w-[440px] mx-auto">
            <div className="text-center mb-10">
              <p className="text-[11px] font-bold text-[#00c896] uppercase tracking-[0.25em] mb-4">Тарифи</p>
              <h2 className="font-display text-[2.5rem] font-black text-[#0d0d0d] dark:text-white tracking-[-0.03em]">Проста ціна</h2>
            </div>
            <div className="rounded-2xl border border-[#00c896]/20 bg-white dark:bg-[#0d0d0d] p-8">
              <p className="text-[11px] font-bold text-[#00c896] uppercase tracking-[0.2em] mb-5">Pro</p>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="font-display text-[3.5rem] font-black text-[#0d0d0d] dark:text-white tracking-tight leading-none">$29</span>
                <span className="text-black/35 dark:text-white/35 text-lg">/ міс</span>
              </div>
              <p className="text-sm text-black/28 dark:text-white/25 mb-8">або $290 / рік — економія 2 місяці</p>
              <ul className="space-y-3 mb-8">
                {['Необмежені транзакції', 'Необмежена кількість рахунків', 'Cash Flow + P&L + Баланс', 'Платіжний календар', 'Експорт CSV'].map((f) => (
                  <li key={f} className="flex items-center gap-3 text-sm text-black/60 dark:text-white/60">
                    <Check className="w-3.5 h-3.5 text-[#00c896] shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/register"
                className="inline-flex items-center justify-center w-full bg-[#00c896] hover:bg-[#00daa6] text-black font-bold rounded-xl h-12 transition-all duration-200"
                style={{ boxShadow: '0 0 40px hsla(161,100%,39%,0.2)' }}
              >
                Почати 14 днів безкоштовно
              </Link>
              <p className="text-xs text-black/22 dark:text-white/22 text-center mt-3">Кредитна картка не потрібна</p>
            </div>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="grain relative py-28 px-6 overflow-hidden border-t border-black/[0.07] dark:border-white/[0.06] bg-[#f7f7f5] dark:bg-[#0a0a0a]">
          <div
            className="absolute inset-x-0 top-0 h-px pointer-events-none"
            style={{ background: 'linear-gradient(90deg, transparent, hsla(161,100%,39%,0.35), transparent)' }}
          />
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(ellipse 60% 50% at 50% 0%, hsla(161,100%,39%,0.05) 0%, transparent 100%)' }}
          />
          <div className="relative max-w-2xl mx-auto text-center">
            <h2 className="font-display text-[3rem] md:text-[3.75rem] font-black text-[#0d0d0d] dark:text-white tracking-[-0.04em] leading-[1.02] mb-6">
              Почніть вести облік<br />
              <span className="text-[#00c896]">сьогодні</span>
            </h2>
            <p className="text-black/42 dark:text-white/40 text-lg mb-10 leading-relaxed">
              14 днів повного доступу. Швидке налаштування.<br className="hidden md:block" />Без кредитної картки.
            </p>
            <Link
              href="/register"
              className="inline-flex items-center gap-2.5 bg-[#00c896] hover:bg-[#00daa6] text-black font-black h-14 px-12 rounded-xl text-base transition-all duration-200"
              style={{ boxShadow: '0 0 60px hsla(161,100%,39%,0.25)' }}
            >
              Створити акаунт безкоштовно
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </section>

      </main>

      {/* ── FOOTER ── */}
      <footer className="border-t border-black/[0.07] dark:border-white/[0.06] py-10 px-6 bg-[#f7f7f5] dark:bg-[#0a0a0a]">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-[#00c896] flex items-center justify-center">
              <span className="text-black font-black text-xs">F</span>
            </div>
            <span className="font-display font-bold text-black/50 dark:text-white/50 text-sm">FinFlow</span>
          </div>
          <nav className="flex items-center gap-6 text-sm text-black/28 dark:text-white/25">
            <Link href="#features" className="hover:text-black/60 dark:hover:text-white/60 transition-colors">Можливості</Link>
            <Link href="/pricing" className="hover:text-black/60 dark:hover:text-white/60 transition-colors">Ціни</Link>
          </nav>
          <p className="text-sm text-black/18 dark:text-white/18">© 2026 FinFlow</p>
        </div>
        <div className="max-w-6xl mx-auto mt-6 flex justify-center">
          <LegalLinks />
        </div>
      </footer>

    </div>
  )
}
