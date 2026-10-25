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
