/** A document version (Firestore `updateTime`) in parts. A Firestore Timestamp has these fields. */
export interface VersionParts {
  seconds: number
  nanoseconds: number
}

const VERSION = /^(\d{1,12})\.(\d{9})$/

/** The version as the browser carries it: `<seconds>.<9 digits of nanoseconds>`. */
export function encodeVersion(v: VersionParts): string {
  return `${v.seconds}.${String(v.nanoseconds).padStart(9, '0')}`
}

/** The parts of an encoded version, or null when it is not one. */
export function parseVersion(s: unknown): VersionParts | null {
  if (typeof s !== 'string') return null
  const m = VERSION.exec(s)
  return m ? { seconds: Number(m[1]), nanoseconds: Number(m[2]) } : null
}
