// Shape of a legal document (typed content under content/legal/). Text may use the operator tokens
// {name} {legalForm} {nip} {address} {rodoEmail} {supportEmail}; they are filled when the page renders.
export type LegalBlock =
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  /** Renders the OPERATOR.processors list as a table (name, purpose, country). */
  | { kind: 'processors' }

export interface LegalSection { id: string; title: string; blocks: LegalBlock[] }
export interface LegalContent { title: string; intro: string; sections: LegalSection[] }
export const OPERATOR_TOKENS = ['name', 'legalForm', 'nip', 'address', 'rodoEmail', 'supportEmail'] as const
