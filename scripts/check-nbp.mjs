// Manual live check against the real NBP API (not part of CI):
//   node scripts/check-nbp.mjs
// Confirms the shape the app relies on: table A, EUR and UAH present, tables only on working days.
const res = await fetch('https://api.nbp.pl/api/exchangerates/tables/A/2025-04-14/2025-04-25/?format=json')
if (!res.ok) throw new Error(`NBP answered ${res.status}`)
const tables = await res.json()
const days = tables.map((t) => t.effectiveDate)
const need = ['2025-04-14', '2025-04-15', '2025-04-16', '2025-04-17', '2025-04-18', '2025-04-22']
const missing = need.filter((d) => !days.includes(d))
if (missing.length) throw new Error(`expected tables on ${missing.join(', ')}`)
if (days.includes('2025-04-21')) throw new Error('Easter Monday must have no table')
for (const code of ['EUR', 'USD', 'UAH']) {
  if (!tables[0].rates.some((r) => r.code === code && r.mid > 0)) throw new Error(`${code} missing from table A`)
}
console.log('NBP table A ok:', days.join(' '))
