import { describe, expect, it, vi } from 'vitest'
import { HttpError, errorResponse } from '@/lib/server/http-error'

describe('HttpError', () => {
  it('carries an HTTP status and a message', () => {
    const err = new HttpError(403, 'forbidden')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(HttpError)
    expect(err.status).toBe(403)
    expect(err.message).toBe('forbidden')
    expect(err.name).toBe('HttpError')
  })

  it('keeps a valid 4xx/5xx status as is', () => {
    expect(new HttpError(404, 'nope').status).toBe(404)
    expect(new HttpError(400, 'bad').status).toBe(400)
    expect(new HttpError(599, 'edge').status).toBe(599)
  })

  it.each([99, 200, 204, 399, 600, 700, Number.NaN, 404.5, Infinity, -1])(
    'normalizes the invalid status %s to 500',
    (status) => {
      expect(new HttpError(status, 'x').status).toBe(500)
    },
  )

  it('never makes errorResponse throw on an invalid status', async () => {
    const res = errorResponse(new HttpError(204, 'no content'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'no content' })
  })
})

describe('errorResponse', () => {
  it('maps an HttpError to a JSON response with its status and message', async () => {
    const res = errorResponse(new HttpError(401, 'unauthorized'))
    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('maps any other error to a generic 500 and logs it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const boom = new Error('db password is hunter2')
    const res = errorResponse(boom)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal' })
    expect(log).toHaveBeenCalledTimes(1)
    const args = log.mock.calls[0]
    expect(args).not.toContain(boom)
    expect(args[1]).toEqual({ name: 'Error', message: 'db password is hunter2', stack: boom.stack })
    log.mockRestore()
  })

  it('does not dump extra properties of the error (request headers, tokens) into the log', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const leaky = Object.assign(new Error('upstream failed'), {
      request: { headers: { authorization: 'Bearer SECRET-TOKEN' } },
    })
    errorResponse(leaky)
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET-TOKEN')
    log.mockRestore()
  })

  it('logs a non-Error value as a string message', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    errorResponse('just a string')
    expect(log.mock.calls[0][1]).toEqual({ name: 'NonError', message: 'just a string' })
    log.mockRestore()
  })

  it('treats thrown non-Error values as internal errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = errorResponse('just a string')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal' })
  })
})

describe('HttpError extra fields', () => {
  it('adds them to the JSON body but never lets them replace the error code', async () => {
    const res = errorResponse(new HttpError(409, 'duplicate', { field: 'nip', existingId: 'c1', error: 'hacked' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ field: 'nip', existingId: 'c1', error: 'duplicate' })
  })

  it('leaves the body as before when there are none', async () => {
    expect(await errorResponse(new HttpError(404, 'not_found')).json()).toEqual({ error: 'not_found' })
  })
})
