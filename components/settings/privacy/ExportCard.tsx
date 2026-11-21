'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { runExport, type ExportProgress } from '@/lib/api/export-client'
import { LedgerApiError } from '@/lib/api/ledger-client'
import { useShell } from '@/lib/hooks/useShell'
import { downloadBlob } from '@/lib/utils/download'

const isAbort = (e: unknown): boolean => (e as { name?: unknown } | null)?.name === 'AbortError'

/** Why the export failed, for the toast: the server's error code (and status), or the browser's own message. */
function reasonOf(e: unknown): string {
  if (e instanceof LedgerApiError) return `${e.code} (${e.status})`
  return e instanceof Error ? e.message : ''
}

/** The company owner downloads every company document as one ZIP built in the browser. Renders nothing for other roles. */
export function ExportCard() {
  const t = useTranslations('privacy.export')
  const { role, orgId, org } = useShell()
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => controller.current?.abort(), [])

  if (role !== 'owner') return null

  async function start() {
    const ctrl = new AbortController()
    controller.current = ctrl
    setRunning(true)
    setProgress(null)
    try {
      const result = await runExport(orgId, org?.name ?? '', { onProgress: setProgress, signal: ctrl.signal })
      downloadBlob(result.fileName, result.blob)
      toast.success(t('done'))
      if (!result.auditRecorded) toast.warning(t('auditWarning'))
    } catch (e) {
      if (!isAbort(e)) toast.error(t('failed', { reason: reasonOf(e) }))
    } finally {
      if (controller.current === ctrl) controller.current = null
      setRunning(false)
      setProgress(null)
    }
  }

  return (
    <Card className="ring-line" data-testid="export-card">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-ink">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-ink-muted">{t('description')}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={start} disabled={running} data-testid="export-start">
            {t('button')}
          </Button>
          {running ? (
            <Button variant="outline" onClick={() => controller.current?.abort()} data-testid="export-cancel">
              {t('cancel')}
            </Button>
          ) : null}
        </div>
        <p aria-live="polite" className="text-sm text-ink-muted" data-testid="export-progress">
          {running && progress ? t('progress', { index: progress.index, total: progress.total, docs: progress.docs }) : null}
        </p>
      </CardContent>
    </Card>
  )
}
