// lib/utils/download.ts
export const exportFileName = (prefix: string, day: string): string => `${prefix}-${day}.csv`

/** Hands a file to the browser's download. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/** Hands a text file to the browser's download. */
export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  downloadBlob(filename, new Blob([content], { type: mime }))
}
