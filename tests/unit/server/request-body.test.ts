import { describe, expect, it } from 'vitest'
import { HttpError } from '@/lib/server/http-error'
import { readJsonBody } from '@/lib/server/request-body'

function post(body: string, headers: Record<string, string> = { 'Content-Type': 'application/json' }): Request {
  return new Request('http://localhost/x', { method: 'POST', headers, body })
}

async function failure(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError)
    return e as HttpError
  }
  throw new Error('expected readJsonBody to reject')
}

describe('readJsonBody', () => {
  it('returns the parsed JSON value', async () => {
    expect(await readJsonBody(post('{"a":1}'), 100)).toEqual({ a: 1 })
  })

  it('accepts a content type with parameters and any letter case', async () => {
    const req = post('[1,2]', { 'Content-Type': 'Application/JSON; charset=utf-8' })
    expect(await readJsonBody(req, 100)).toEqual([1, 2])
  })

  it('refuses a content type other than application/json with 415', async () => {
    const e = await failure(readJsonBody(post('{"a":1}', { 'Content-Type': 'text/plain' }), 100))
    expect(e.status).toBe(415)
    expect(e.message).toBe('unsupported media type')
  })

  it('refuses a missing content type with 415', async () => {
    const e = await failure(readJsonBody(post('{"a":1}', {}), 100))
    expect(e.status).toBe(415)
  })

  it('refuses text over the cap with 413', async () => {
    const e = await failure(readJsonBody(post(JSON.stringify({ a: 'x'.repeat(50) })), 20))
    expect(e.status).toBe(413)
    expect(e.message).toBe('payload too large')
  })

  it('accepts text exactly at the cap', async () => {
    const text = '{"a":1}'
    expect(await readJsonBody(post(text), text.length)).toEqual({ a: 1 })
  })

  it('refuses a declared content-length over the cap with 413 before reading', async () => {
    const req = post('{}', { 'Content-Type': 'application/json', 'Content-Length': '5000' })
    const e = await failure(readJsonBody(req, 100))
    expect(e.status).toBe(413)
  })

  it('answers 400 invalid_body for text that is not JSON', async () => {
    const e = await failure(readJsonBody(post('{not json'), 100))
    expect(e.status).toBe(400)
    expect(e.message).toBe('invalid_body')
  })
})
