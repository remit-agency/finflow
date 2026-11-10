import { SYSTEM_COUNTERPARTIES, type SystemCounterpartySpec } from '@/lib/domain/counterparties/system'
import type { Preset } from './types'

/**
 * The tax presets (S11): the day of the month and the system counterparty of S06. Every preset is an expense, its amount an
 * estimate the person types, moved to the next business day. The day can be changed (ZUS on the 10th).
 */
export const PRESET_DEFAULTS: Record<Preset, { dayOfMonth: number; counterpartyId: string }> = {
  zus: { dayOfMonth: 15, counterpartyId: 'system_zus' },
  pit4: { dayOfMonth: 20, counterpartyId: 'system_us' },
  vat7: { dayOfMonth: 25, counterpartyId: 'system_us' },
}

/** The S06 system record a preset pays (ZUS or Urząd Skarbowy). */
export function presetCounterparty(preset: Preset): SystemCounterpartySpec {
  const spec = SYSTEM_COUNTERPARTIES.find((s) => s.id === PRESET_DEFAULTS[preset].counterpartyId)
  if (!spec) throw new Error(`no system counterparty for the preset ${preset}`)
  return spec
}
