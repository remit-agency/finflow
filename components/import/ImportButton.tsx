'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { FileUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Account } from '@/types'
import { FinmapDialog } from './FinmapDialog'
import { ImportDialog } from './ImportDialog'
import { ImportSourceDialog, type ImportSource } from './ImportSourceDialog'

interface Props {
  orgId: string
  accounts: Account[]
}

/** The open import: the source chooser first, then the dialog of the chosen format. The caller renders it for the roles that may write. */
type Open = 'source' | ImportSource | null

/** Opens the import in the journal: a bank statement (MT940) or a Finmap export (S14b). */
export function ImportButton({ orgId, accounts }: Props) {
  const t = useTranslations('import')
  const [open, setOpen] = useState<Open>(null)
  return (
    <>
      <Button
        type="button"
        data-testid="import-open"
        variant="outline"
        size="lg"
        onClick={() => setOpen('source')}
        className="gap-1.5 border-line bg-surface text-ink-muted"
      >
        <FileUp className="size-4" />
        {t('open')}
      </Button>
      {open === 'source' && <ImportSourceDialog onClose={() => setOpen(null)} onChoose={(source) => setOpen(source)} />}
      {open === 'mt940' && <ImportDialog orgId={orgId} accounts={accounts} onClose={() => setOpen(null)} />}
      {open === 'finmap' && <FinmapDialog orgId={orgId} onClose={() => setOpen(null)} />}
    </>
  )
}
