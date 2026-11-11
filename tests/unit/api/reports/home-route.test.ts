// The home address of a company (S12): /<org> redirects to its dashboard when the company exists, and is a plain 404 otherwise.
// A long slug is refused before any read; a failed read is a 500 that says nothing of the cause.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/(app)/[orgSlug]/route'
import { fakeAdmin, fakeOrgs, resetFakeAdmin } from '@/tests/unit/helpers/fake-admin'

vi.mock('@/lib/server/firebase-admin', async () => {
  const { fakeAdmin: admin } = await import('@/tests/unit/helpers/fake-admin')
  return { getAdmin: () => admin }
})

const home = (slug: string) => GET(new Request(`http://localhost:3000/${slug}`), { params: Promise.resolve({ orgSlug: slug }) })

beforeEach(() => {
  resetFakeAdmin()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /[orgSlug] (the home address)', () => {
  it('redirects a company to its dashboard', async () => {
    fakeOrgs.set('org-acme', { name: 'Acme', currency: 'PLN' })
    const res = await home('org-acme')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost:3000/org-acme/dashboard')
  })

  it('a company that does not exist is a plain 404', async () => {
    const res = await home('org-missing')
    expect(res.status).toBe(404)
  })

  it('a slug longer than 128 characters is a 404 before any read', async () => {
    const collection = vi.spyOn(fakeAdmin.db, 'collection')
    const res = await home(`a${'b'.repeat(128)}`)
    expect(res.status).toBe(404)
    expect(collection).not.toHaveBeenCalled()
  })

  it('a slug of 128 characters is looked up', async () => {
    const res = await home('a'.repeat(128))
    expect(res.status).toBe(404)
    expect(console.error).not.toHaveBeenCalled()
  })

  it('a failed read is a 500 without the cause in the answer', async () => {
    vi.spyOn(fakeAdmin.db, 'collection').mockImplementation(() => {
      throw new Error('Firestore is unavailable: project finflow-secret')
    })
    const res = await home('org-acme')
    expect(res.status).toBe(500)
    const body = await res.text()
    expect(body).not.toContain('unavailable')
    expect(body).not.toContain('finflow-secret')
  })
})
