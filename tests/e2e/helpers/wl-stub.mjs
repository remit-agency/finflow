// A stand-in for the MF white list (wl-api.mf.gov.pl) for the Playwright run: the dev server is started with
// WL_API_BASE pointing here, so no test ever calls the real government API.
//   7740001454 -> a VAT payer with one account    anything else valid-looking -> not in the register (subject null)
import http from 'node:http'

const PORT = 4010

const FOUND = {
  name: 'ORLEN SPÓŁKA AKCYJNA',
  nip: '7740001454',
  statusVat: 'Czynny',
  residenceAddress: 'CHEMIKÓW 7, 09-411 PŁOCK',
  workingAddress: null,
  accountNumbers: ['61109010140000071219812874'],
  hasVirtualAccounts: false,
}

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
    if (url.pathname === '/health') {
      res.end('ok')
      return
    }
    res.setHeader('Content-Type', 'application/json')
    const match = /^\/api\/search\/nip\/(\d{10})$/.exec(url.pathname)
    if (!match) {
      res.statusCode = 404
      res.end('{"message":"not found"}')
      return
    }
    res.end(JSON.stringify({ result: { subject: match[1] === '7740001454' ? FOUND : null, requestId: 'stub' } }))
  })
  .listen(PORT, '127.0.0.1')
