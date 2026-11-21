// The legal operator of FinFlow and the sub-processors. The OWNER fills the empty fields (see the spec, "Що має
// зробити власник"). While LEGAL_DRAFT is true every legal page shows a "draft, under legal review" banner.
// operatorProblems() is also a unit-test guard: LEGAL_DRAFT may only be false when no field is empty.
export const LEGAL_DRAFT = true

export interface Processor {
  name: string
  /** What the processor does for FinFlow, per language. */
  purpose: { pl: string; en: string; uk: string }
  /** Where the data is processed. */
  country: string
}

export interface Operator {
  name: string
  legalForm: string
  nip: string
  address: string
  rodoEmail: string
  supportEmail: string
  processors: readonly Processor[]
}

export const OPERATOR: Operator = {
  name: '',
  legalForm: '',
  nip: '',
  address: '',
  rodoEmail: '',
  supportEmail: '',
  processors: [
    { name: 'Google Cloud (Firebase Authentication, Cloud Firestore)', purpose: { pl: 'Logowanie i baza danych aplikacji', en: 'Sign-in and the application database', uk: 'Вхід і база даних застосунку' }, country: 'EU / USA (SCC, DPF)' },
    { name: 'Vercel Inc.', purpose: { pl: 'Hosting i uruchamianie aplikacji', en: 'Hosting and running the application', uk: 'Хостинг і запуск застосунку' }, country: 'EU (fra1) / USA (SCC, DPF)' },
    { name: 'Enable Banking Oy', purpose: { pl: 'Odczyt danych rachunków bankowych na polecenie użytkownika (PSD2)', en: 'Reading bank account data on the user instruction (PSD2)', uk: 'Читання даних банківських рахунків за дорученням користувача (PSD2)' }, country: 'Finland (EU)' },
  ],
}

const FIELDS = ['name', 'legalForm', 'nip', 'address', 'rodoEmail', 'supportEmail'] as const
const PLACEHOLDER = /^\s*(todo|tbd|xxx|\?+|-+)?\s*$/i

/** The names of operator fields that are empty or still a placeholder. */
export function operatorProblems(operator: Operator): string[] {
  return FIELDS.filter((key) => PLACEHOLDER.test(operator[key]))
}
