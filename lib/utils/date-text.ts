/** Typed day input: the form shows DD.MM.YYYY and stores a `YYYY-MM-DD` day key (or '' when not a real date). */

function isRealDay(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

/** `YYYY-MM-DD` -> `DD.MM.YYYY`; anything that is not a day key gives ''. */
export function formatDayText(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

/**
 * Parses what a person types or pastes into a day key, or null when it is not a real date.
 * Accepts DD.MM.YYYY (also with `/` or `-`) and YYYY-MM-DD; a one-digit day or month is padded.
 */
export function parseDayText(text: string): string | null {
  const t = text.trim()
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(t)
  const parts = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : null
  if (!parts) return null
  const [y, m, d] = parts.map(Number)
  if (!isRealDay(y, m, d)) return null
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`
}

/**
 * Keeps the field in DD.MM.YYYY shape while typing: only digits are taken and the dots appear by themselves.
 * A pasted complete date (YYYY-MM-DD, 1.2.2026) is normalised. The dot after a part shows once the next digit is typed,
 * so Backspace never fights the mask.
 */
export function maskDayText(raw: string): string {
  const whole = parseDayText(raw)
  if (whole) return formatDayText(whole)
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`
}
