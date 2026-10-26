'use client'

import { useTheme } from 'next-themes'
import { useTranslations } from 'next-intl'
import { Sun, Moon } from 'lucide-react'
import { useEffect, useState } from 'react'

export function ThemeToggle() {
  const t = useTranslations('common')
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) return <div className="w-8 h-8" />

  const isDark = theme === 'dark'

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={t('toggleTheme')}
      className="w-8 h-8 flex items-center justify-center rounded-lg border border-black/10 dark:border-white/[0.08] text-black/40 dark:text-white/40 hover:text-black/70 dark:hover:text-white/70 hover:border-black/18 dark:hover:border-white/[0.15] transition-all duration-200"
    >
      {isDark
        ? <Sun className="w-[15px] h-[15px]" />
        : <Moon className="w-[15px] h-[15px]" />
      }
    </button>
  )
}
