import { TagError } from './errors'

export function bad(field: string): never {
  throw new TagError('invalid_input', { field })
}

export function asRecord(v: unknown, field = 'body'): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) bad(field)
  return v as Record<string, unknown>
}

export function onlyKeys(r: Record<string, unknown>, allowed: readonly string[]): void {
  for (const k of Object.keys(r)) if (!allowed.includes(k)) bad(k)
}
