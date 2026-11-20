/**
 * Polish banks export MT940 as UTF-8 or Windows-1250. Strict UTF-8 first (a byte that is not valid UTF-8 throws), then
 * Windows-1250. Other code pages (CP852, ISO-8859-2) are not detected: their text still imports, with wrong letters.
 */
export function decodeStatementBytes(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1250' } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('windows-1250').decode(bytes), encoding: 'windows-1250' }
  }
}
