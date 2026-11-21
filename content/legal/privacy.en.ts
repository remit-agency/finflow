// DRAFT for lawyer review. Polish text is authoritative.
import type { LegalContent } from '@/lib/legal/content-types'

// Translation of privacy.pl.ts (the Polish text is authoritative); keep the facts in sync with it.
export const privacyEn: LegalContent = {
  title: 'Privacy policy',
  intro:
    'This policy explains which personal data we process when you use FinFlow, for what purposes and on what legal basis, and what rights you have. This is a translation: if it differs from the Polish version, the Polish version prevails.',
  sections: [
    {
      id: 'controller',
      title: 'Data controller',
      blocks: [
        {
          kind: 'p',
          text: 'The controller of personal data is {name} {legalForm}, {address}, NIP (tax ID) {nip} (“we”). For data protection matters you can write to {rodoEmail}.',
        },
        {
          kind: 'p',
          text: 'In FinFlow we act in two roles:',
        },
        {
          kind: 'ul',
          items: [
            'As the controller, we process the data needed for sign-in and for running your account: your name, email address, records of accepted documents and technical data (logs).',
            'As a processor, we process the business data of the company you run in FinFlow (for example transactions, counterparties and bank account data). The controller of that data is the company that uses the service. The rules for processing it are set out in the data processing agreement (Terms of Service, annex: data processing agreement).',
          ],
        },
      ],
    },
    {
      id: 'purposes',
      title: 'Purposes and legal bases of processing',
      blocks: [
        {
          kind: 'table',
          head: ['Purpose', 'Data', 'Legal basis'],
          rows: [
            [
              'Creating and running the account and providing the service',
              'Name, email address, sign-in data, company name and currency, your role in the company',
              'Art. 6(1)(b) GDPR (performance of a contract)',
            ],
            [
              'Security of the service and abuse prevention, including technical logs and request limits',
              'IP address, browser information (user agent), account identifier, request counters',
              'Art. 6(1)(f) GDPR (our legitimate interest: the security of the service)',
            ],
            [
              'Meeting legal obligations and establishing, exercising or defending claims',
              'Data to the extent needed for the obligation or claim concerned',
              'Art. 6(1)(c) GDPR (legal obligation) and Art. 6(1)(f) GDPR (our legitimate interest: protection against claims)',
            ],
            [
              'Proving acceptance of the Terms of Service and the Privacy Policy',
              'Document, version, time and language of acceptance',
              'Art. 6(1)(f) GDPR and Art. 7(1) GDPR (accountability: being able to prove acceptance)',
            ],
          ],
        },
        {
          kind: 'p',
          text: 'In this version of the service we do not process personal data for marketing purposes.',
        },
      ],
    },
    {
      id: 'data',
      title: 'What data we process',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Account data: your name and email address. If you create an account with a password, the password is stored as a hash by Firebase Authentication (Google); we never know your password. If you sign in with Google, we receive from your Google account, among other things, your name and email address.',
            'Company data: the company name and currency and your role in the company (Owner, Accountant or Viewer).',
            'Content you enter into the service, for example transactions, counterparties, categories and planned payments. We process it as a processor on behalf of the company.',
            'Technical data: your IP address and browser information (user agent), which may appear in server logs kept by the hosting provider, and request counters used for rate limits. The counters are linked to your account identifier, not to your IP address, and contain only the number of requests in a given time window.',
            'Records of acceptance: which document was accepted, in which version, when, in which language and in which situation (at registration, at sign-in with Google or in the window asking you to accept).',
            'Bank data: if you connect a bank account, on your instruction we read through Enable Banking the account data (for example the IBAN, name and currency), the balance and the transactions (for example the amount, date, payment title and counterparty name). The PSD2 access is read-only: we cannot order payments. When the data is read while you are present, we also pass your IP address and browser information to Enable Banking, so the bank knows that the request was made in your presence. Bank data is company data, and we process it as a processor.',
          ],
        },
      ],
    },
    {
      id: 'recipients',
      title: 'Recipients of data',
      blocks: [
        {
          kind: 'p',
          text: 'We use providers that process data on our behalf and on our instructions:',
        },
        { kind: 'processors' },
        {
          kind: 'ul',
          items: [
            'People who have access to the same company in FinFlow (for example accountants) see its data within the limits of their role.',
            'Public authorities receive data only when the law requires it.',
          ],
        },
      ],
    },
    {
      id: 'transfers',
      title: 'Transfers outside the EEA',
      blocks: [
        {
          kind: 'p',
          text: 'Google and Vercel may also process data outside the European Economic Area, including in the USA. Where available, such a transfer is based on the Standard Contractual Clauses approved by the European Commission or on the EU–US Data Privacy Framework. Enable Banking processes data in Finland, that is, in the European Union.',
        },
      ],
    },
    {
      id: 'retention',
      title: 'How long we keep data',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Account data: for as long as the account exists.',
            'Company data: until the owner deletes the company or asks for the data to be erased.',
            'Records of acceptance: for as long as needed to prove that the documents were accepted.',
            'Technical logs and request counters: for a short time, no longer than needed for the security of the service. The exact period is set in the operations specification.',
          ],
        },
        {
          kind: 'p',
          text: 'On a written request (an email to {rodoEmail} is enough) we erase the data within one month, unless the law requires us to keep it longer.',
        },
      ],
    },
    {
      id: 'rights',
      title: 'Your rights',
      blocks: [
        {
          kind: 'p',
          text: 'You have the right to:',
        },
        {
          kind: 'ul',
          items: [
            'access your data and receive a copy of it;',
            'have inaccurate or incomplete data rectified;',
            'have your data erased;',
            'restrict processing;',
            'data portability; the company owner can export the company data in the app: Settings → Privacy and data;',
            'object to processing based on our legitimate interest;',
            'withdraw consent at any time where processing is based on consent; withdrawal does not affect the lawfulness of processing before it;',
            'lodge a complaint with the President of the Personal Data Protection Office (Prezes Urzędu Ochrony Danych Osobowych).',
          ],
        },
        {
          kind: 'p',
          text: 'To exercise these rights, write to {rodoEmail}. We will reply within one month of receiving the request. If the request concerns company data that we process as a processor, we will pass it on to the company or help the company handle it.',
        },
      ],
    },
    {
      id: 'cookies',
      title: 'Cookies',
      blocks: [
        {
          kind: 'p',
          text: 'We use only two strictly necessary cookies (to keep you signed in and to remember the language) and browser storage, where we keep interface settings and the sign-in state. We use no tracking cookies or tracking tools. See the Cookie policy for details: /legal/cookies.',
        },
      ],
    },
    {
      id: 'automated',
      title: 'Automated decision-making',
      blocks: [
        {
          kind: 'p',
          text: 'We do not make decisions based solely on automated processing, including profiling, that would produce legal effects concerning you or similarly significantly affect you.',
        },
      ],
    },
  ],
}
