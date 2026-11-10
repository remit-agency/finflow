'use client'

import { useEffect, useState } from 'react'
import { fetchSeries } from '@/lib/api/recurring-client'

/**
 * The name of the series an operation belongs to (S11, the form's «з серії …»): a string; null when the series is gone or
 * cannot be read; undefined while loading or when the operation has no series.
 */
export function useSeriesName(orgId: string, seriesId: string | undefined): string | null | undefined {
  const [found, setFound] = useState<{ id: string; name: string | null } | null>(null)
  useEffect(() => {
    if (!seriesId) return
    const ac = new AbortController()
    fetchSeries(orgId, seriesId, ac.signal).then(
      (series) => {
        if (!ac.signal.aborted) setFound({ id: seriesId, name: series.name })
      },
      () => {
        if (!ac.signal.aborted) setFound({ id: seriesId, name: null })
      },
    )
    return () => ac.abort()
  }, [orgId, seriesId])
  if (!seriesId) return undefined
  return found !== null && found.id === seriesId ? found.name : undefined
}
