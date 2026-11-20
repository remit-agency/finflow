'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { FileUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Account } from '@/types'
import { ImportDialog } from './ImportDialog'

interface Props {
  orgId: string
  accounts: Account[]
}

/** Opens the statement import in the journal. The caller renders it for the roles that may write (owner, accountant). */
export function ImportButton({ orgId, accounts }: Props) {
  const t = useTranslations('import')
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        type="button"
        data-testid="import-open"
        variant="outline"
        size="lg"
        onClick={() => setOpen(true)}
        className="gap-1.5 border-line bg-surface text-ink-muted"
      >
        <FileUp className="size-4" />
        {t('open')}
      </Button>
      {open && <ImportDialog orgId={orgId} accounts={accounts} onClose={() => setOpen(false)} />}
    </>
  )
}
