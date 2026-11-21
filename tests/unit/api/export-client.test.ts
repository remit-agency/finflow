import { afterEach, describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { runExport } from '@/lib/api/export-client'
import { LedgerApiError } from '@/lib/api/ledger-client'
import { EXPORT_COLLECTIONS, type ExportCollection } from '@/lib/domain/export/collections'

type Doc = { id: string; data: Record<string, unknown> }
const doc = (id: string): Doc => ({ id, data: { name: `n-${id}`, amountMinor: 12345 } })

const ME = { email: 'owner@finflow.test', memberships: [{ orgId: 'org1', role: 'owner' }] }
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/**
 * A fake server. `pages[collection]` lists the pages of a collection in order; every page but the last carries the cursor
 * `p<index>` of the page after it, so an EMPTY page in the middle still has a non-null `next`. A collection that is not
 * listed is one empty page.
 */
function server(pages: Partial<Record<ExportCollection, Doc[][]>> = {}, opts: { audit?: () => Promise<Response> } = {}) {
  return vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (init?.method === 'POST') return opts.audit ? opts.audit() : json({ ok: true })
    if (url === '/api/me/export') return json(ME)
    const query = new URL(url, 'http://localhost').searchParams
    const collection = query.get('collection') as ExportCollection
    const after = query.get('after')
    const list = pages[collection] ?? [[]]
    const index = after === null ? 0 : Number(after.slice(1))
    return json({ docs: list[index], next: index < list.length - 1 ? `p${index + 1}` : null })
  })
}

const getCalls = (fetchMock: ReturnType<typeof server>) => fetchMock.mock.calls.filter(([, init]) => init?.method !== 'POST')
const postCalls = (fetchMock: ReturnType<typeof server>) => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')

async function unzipBlob(blob: Blob): Promise<Record<string, Uint8Array>> {
  return unzipSync(new Uint8Array(await blob.arrayBuffer()))
}

afterEach(() => vi.unstubAllGlobals())

describe('runExport', () => {
  it('pages each collection until next is null, also through an empty page that still has a next cursor', async () => {
    const fetchMock = server({ transactions: [[doc('t1'), doc('t2'), doc('t3')], [], [doc('t4')]] })
    vi.stubGlobal('fetch', fetchMock)
    const progress: Array<{ collection: string; docs: number }> = []

    const result = await runExport('org1', 'Acme', { onProgress: (p) => progress.push({ collection: p.collection, docs: p.docs }) })

    const transactionUrls = getCalls(fetchMock)
      .map(([url]) => url)
      .filter((url) => url.includes('collection=transactions'))
    expect(transactionUrls).toEqual([
      '/api/orgs/org1/export/data?collection=transactions',
      '/api/orgs/org1/export/data?collection=transactions&after=p1',
      '/api/orgs/org1/export/data?collection=transactions&after=p2',
    ])
    expect(result.counts.transactions).toBe(4)
    expect(result.counts.accounts).toBe(0)
    // One page per other collection, plus the three transaction pages, plus me.json.
    expect(getCalls(fetchMock)).toHaveLength(EXPORT_COLLECTIONS.length - 1 + 3 + 1)
    // The empty page still reports progress and the running total stays 3 until the last page.
    expect(progress.filter((p) => p.collection === 'transactions').map((p) => p.docs)).toEqual([3, 3, 4])
  })

  it('builds a ZIP with <collection>.json for every export collection, me.json and README.txt', async () => {
    vi.stubGlobal('fetch', server({ accounts: [[doc('a1')]], transactions: [[doc('t1'), doc('t2')], [], [doc('t3')]] }))

    const result = await runExport('org1', 'Acme', {})
    const files = await unzipBlob(result.blob)

    expect(Object.keys(files).sort()).toEqual([...EXPORT_COLLECTIONS.map((c) => `${c}.json`), 'me.json', 'README.txt'].sort())
    expect(JSON.parse(strFromU8(files['accounts.json']))).toEqual([{ id: 'a1', name: 'n-a1', amountMinor: 12345 }])
    expect(JSON.parse(strFromU8(files['transactions.json'])).map((d: { id: string }) => d.id)).toEqual(['t1', 't2', 't3'])
    expect(JSON.parse(strFromU8(files['members.json']))).toEqual([])
    expect(JSON.parse(strFromU8(files['me.json']))).toEqual(ME)
    expect(strFromU8(files['README.txt'])).toContain('Acme')
    expect(result.blob.type).toBe('application/zip')
    expect(result.fileName).toMatch(/^finflow-acme-\d{4}-\d{2}-\d{2}\.zip$/)
  })

  it('throws AbortError when aborted between pages and makes no further request', async () => {
    const fetchMock = server({ organization: [[doc('o1')], [doc('o2')]] })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    const run = runExport('org1', 'Acme', { signal: controller.signal, onProgress: () => controller.abort() })

    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws AbortError at once when the signal is already aborted', async () => {
    const fetchMock = server()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort()

    await expect(runExport('org1', 'Acme', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retries a network TypeError once and then succeeds', async () => {
    const fetchMock = server()
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await runExport('org1', 'Acme', {})

    // The first request ran twice (the failed try and the retry); every other request once.
    expect(getCalls(fetchMock)).toHaveLength(EXPORT_COLLECTIONS.length + 1 + 1)
    expect(getCalls(fetchMock)[0][0]).toBe(getCalls(fetchMock)[1][0])
    expect(result.counts.organization).toBe(0)
  })

  it('gives up after the second network failure and does not retry an HTTP refusal', async () => {
    const network = server()
    network.mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', network)
    await expect(runExport('org1', 'Acme', {})).rejects.toBeInstanceOf(TypeError)
    expect(network).toHaveBeenCalledTimes(2)

    const refused = vi.fn(async () => json({ error: 'forbidden' }, 403))
    vi.stubGlobal('fetch', refused)
    await expect(runExport('org1', 'Acme', {})).rejects.toMatchObject({ name: 'LedgerApiError', status: 403, code: 'forbidden' })
    expect(refused).toHaveBeenCalledTimes(1)
    await expect(runExport('org1', 'Acme', {})).rejects.toBeInstanceOf(LedgerApiError)
  })

  it('reports auditRecorded false when the audit POST fails, but still returns the complete file', async () => {
    for (const audit of [async () => json({ error: 'internal' }, 500), async () => Promise.reject(new TypeError('offline'))]) {
      vi.stubGlobal('fetch', server({ transactions: [[doc('t1')]] }, { audit }))

      const result = await runExport('org1', 'Acme', {})

      expect(result.auditRecorded).toBe(false)
      expect(result.counts.transactions).toBe(1)
      expect(Object.keys(await unzipBlob(result.blob))).toContain('transactions.json')
    }
  })

  it('sends the audit POST once, after the last read, with the counts', async () => {
    const fetchMock = server({ transactions: [[doc('t1'), doc('t2')], [], [doc('t3')]], tags: [[doc('g1')]] })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runExport('org1', 'Acme', {})

    const posts = postCalls(fetchMock)
    expect(posts).toHaveLength(1)
    const [url, init] = posts[0]
    expect(url).toBe('/api/orgs/org1/export/data')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
    const body = JSON.parse(init?.body as string) as { counts: Record<string, number> }
    expect(body).toEqual({ counts: result.counts })
    expect(Object.keys(body.counts).sort()).toEqual([...EXPORT_COLLECTIONS].sort())
    expect(body.counts.transactions).toBe(3)
    expect(body.counts.tags).toBe(1)
    expect(result.auditRecorded).toBe(true)
    // The audit call is the very last request.
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe('POST')
  })
})
