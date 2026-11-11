// A stand-in for the NBP API (api.nbp.pl) for the Playwright run: the dev server is started with NBP_API_BASE pointing here,
// so no test ever calls the real NBP. Table A for every weekday of the asked range (holidays are not modelled): EUR 4.30,
// USD 4.00, UAH 0.10. Table numbers count the weekdays of the year, so a month read twice never shows a gap
// (`validateRefresh` in lib/server/fx/rates.ts refuses a gap). A range without a weekday is 404, as NBP answers.
//   GET /api/exchangerates/tables/A/{from}/{to}/?format=json
import http from 'node:http'

const PORT = 4012
const MID = { EUR: 4.3, USD: 4.0, UAH: 0.1 }
const DAY_MS = 86_400_000

const dayOf = (d) => d.toISOString().slice(0, 10)
const isWeekday = (d) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6

function tableNo(d) {
  let n = 0
  for (let x = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); x <= d; x = new Date(x.getTime() + DAY_MS)) if (isWeekday(x)) n++
  return `${String(n).padStart(3, '0')}/A/NBP/${d.getUTCFullYear()}`
}

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
    if (url.pathname === '/health') {
      res.end('ok')
      return
    }
    const match = /^\/api\/exchangerates\/tables\/A\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})\/?$/.exec(url.pathname)
    if (!match) {
      res.statusCode = 400
      res.end('400 BadRequest')
      return
    }
    const tables = []
    for (let d = new Date(`${match[1]}T00:00:00Z`); dayOf(d) <= match[2]; d = new Date(d.getTime() + DAY_MS)) {
      if (!isWeekday(d)) continue
      tables.push({ table: 'A', no: tableNo(d), effectiveDate: dayOf(d), rates: Object.entries(MID).map(([code, mid]) => ({ currency: code, code, mid })) })
    }
    if (tables.length === 0) {
      res.statusCode = 404
      res.end('404 NotFound')
      return
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(tables))
  })
  .listen(PORT, '127.0.0.1')
