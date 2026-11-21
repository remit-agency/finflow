import { strToU8, zipSync } from 'fflate'

/** One ZIP from named text files (UTF-8). Pure: the caller wraps the bytes in a Blob. */
export function buildExportZip(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const [name, text] of Object.entries(files)) entries[name] = strToU8(text)
  return zipSync(entries)
}
