import type { Locale } from '@/lib/i18n/config'

/**
 * Parses what a person types into an amount field, whatever their keyboard or habit:
 * `1 234,50`, `1234.5`, `1.234,50`, `1,234.50`, `0,125`. Returns null for anything else
 * (empty, letters, a minus sign, `1e3`, several decimal marks). Only non-negative amounts exist
 * in the forms, so a sign is rejected. Pure, independent of the UI language.
 *
 * Rules: (a) both `,` and `.` present: the right-most one is the decimal mark, the other the
 * thousands mark; (b) one kind, repeated: thousands marks (groups of exactly three digits);
 * (c) one occurrence followed by 1-2 digits (or none): decimal mark; (d) one occurrence followed
 * by exactly three digits with a 1-3 digit non-zero integer part: thousands mark (`1,234` is
 * 1234, `0,125` is 0.125); (e) otherwise decimal.
 */
export function parseAmountInput(text: string): number | null {
  const s = text.replace(/[\s  ]/g, '')
  if (!/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return null

  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  let integer: string
  let fraction = ''

  if (lastComma !== -1 && lastDot !== -1) {
    const decimalAt = Math.max(lastComma, lastDot)
    const decimalMark = s[decimalAt]
    const thousandsMark = decimalMark === ',' ? '.' : ','
    const before = s.slice(0, decimalAt)
    fraction = s.slice(decimalAt + 1)
    if (before.includes(decimalMark) || fraction.includes(thousandsMark)) return null
    const groups = before.split(thousandsMark)
    if (!groups.every((g, i) => (i === 0 ? /^\d{1,3}$/.test(g) : /^\d{3}$/.test(g)))) return null
    integer = groups.join('')
  } else if (lastComma !== -1 || lastDot !== -1) {
    const mark = lastComma !== -1 ? ',' : '.'
    const parts = s.split(mark)
    if (parts.length > 2) {
      if (!/^\d{1,3}$/.test(parts[0]) || !parts.slice(1).every((p) => /^\d{3}$/.test(p))) return null
      integer = parts.join('')
    } else {
      const [head, tail] = parts
      if (tail.length === 3 && /^[1-9]\d{0,2}$/.test(head)) integer = head + tail
      else {
        integer = head
        fraction = tail
      }
    }
  } else {
    integer = s
  }

  if (!/^\d*$/.test(integer) || !/^\d*$/.test(fraction)) return null
  const value = Number(`${integer || '0'}${fraction ? `.${fraction}` : ''}`)
  return Number.isFinite(value) ? value : null
}

/**
 * Like `parseAmountInput` for a field that may be negative (an opening balance: the migration
 * stores legacy balance minus the sum of operations, which can be below zero). An optional leading
 * `-` or the Unicode minus `−` (U+2212), optionally followed by spaces, then exactly what
 * `parseAmountInput` accepts. `-0` is 0, never -0. `+5`, a trailing or doubled sign give null.
 */
export function parseSignedAmountInput(text: string): number | null {
  const s = text.replace(/^[\s  ]+/, '')
  const negative = s.startsWith('-') || s.startsWith('−')
  const value = parseAmountInput(negative ? s.slice(1) : s)
  if (value === null) return null
  return negative && value !== 0 ? -value : value
}

interface DecimalParts {
  negative: boolean
  /** Digits before the decimal mark, no leading zeros (`0` for none). */
  integer: string
  /** Exactly two digits. */
  cents: string
}

/**
 * `value` rounded to 2 decimals, half away from zero, by its written decimal digits (so 1.005 is
 * 1.01 as typed, not 1.00 as the binary double would suggest), or null when it is not finite. From
 * 2^53 up a double has no fractional part: its exact integer value is returned.
 */
function decimalParts(value: number): DecimalParts | null {
  if (!Number.isFinite(value)) return null
  const abs = Math.abs(value)
  if (abs >= Number.MAX_SAFE_INTEGER) return { negative: value < 0, integer: BigInt(abs).toString(), cents: '00' }
  const written = String(abs)
  // Only values below 1e-6 are written with an exponent, and they round to zero.
  if (written.includes('e')) return { negative: false, integer: '0', cents: '00' }
  const [whole, fraction = ''] = written.split('.')
  const digits = (fraction + '000').slice(0, 3)
  let hundredths = BigInt(whole + digits.slice(0, 2))
  if (digits[2] >= '5') hundredths += BigInt(1)
  const text = hundredths.toString().padStart(3, '0')
  return { negative: value < 0 && hundredths !== BigInt(0), integer: text.slice(0, -2), cents: text.slice(-2) }
}

/** `value` rounded to 2 decimals (half away from zero), the precision money is stored with. A non-finite value is returned as it is. */
export function roundAmount(value: number): number {
  const parts = decimalParts(value)
  if (!parts || Math.abs(value) >= Number.MAX_SAFE_INTEGER) return value
  return (parts.negative ? -1 : 1) * Number(`${parts.integer}.${parts.cents}`)
}

/**
 * The text an amount field is prefilled with, the inverse of `parseAmountInput` for any amount
 * with at most 2 decimals: no thousands grouping (a grouped `1 234,50` would be fine to read back,
 * but a person editing it should not have to delete spaces), no exponent, at most 2 decimals
 * (rounded half away from zero, so a stored 12.345 shows `12,35`), trailing zeros trimmed, and the
 * decimal mark of the UI language: `,` for Polish and Ukrainian, `.` for English. Sub-cent values
 * show as `0`; a value that is not finite shows as an empty field.
 */
export function formatAmountInput(value: number, locale: Locale): string {
  const parts = decimalParts(value)
  if (!parts) return ''
  const fraction = parts.cents.replace(/0$/, '')
  const mark = locale === 'en' ? '.' : ','
  const body = parts.cents === '00' ? parts.integer : `${parts.integer}${mark}${fraction}`
  return parts.negative ? `-${body}` : body
}
