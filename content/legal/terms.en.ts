// DRAFT for lawyer review. Polish text is authoritative.
import type { LegalContent } from '@/lib/legal/content-types'

// Translation of terms.pl.ts (the Polish text is authoritative); keep the facts in sync with it.
export const termsEn: LegalContent = {
  title: 'Terms of Service',
  intro:
    'These Terms set out the rules for using FinFlow. The annex on the processing of personal data forms part of the Terms. This is a translation: if it differs from the Polish version, the Polish version prevails.',
  sections: [
    {
      id: 'definitions',
      title: 'Definitions',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Provider: {name} {legalForm}, {address}, NIP (tax ID) {nip}.',
            'User: a person who has created an Account in FinFlow.',
            'Account: the User’s account in FinFlow, protected by sign-in credentials.',
            'Company: the organisation (business) whose finances the User keeps in FinFlow.',
            'Service: the FinFlow application provided by the Provider.',
            'Company Data: the data that Users enter into the Service or fetch into it for the Company, for example accounts, transactions, counterparties, categories and bank data.',
          ],
        },
      ],
    },
    {
      id: 'service',
      title: 'The Service',
      blocks: [
        {
          kind: 'p',
          text: '1. FinFlow is used to manage the cash flow and management accounting of a small business. It lets you keep accounts and transactions, view reports, import data from files and connect to a bank.',
        },
        {
          kind: 'p',
          text: '2. The Service is in a test phase (beta). This means that:',
        },
        {
          kind: 'ul',
          items: [
            'we do not guarantee availability or response times (no SLA);',
            'features may change, and some may be withdrawn;',
            'the Service is free of charge during the beta.',
          ],
        },
        {
          kind: 'p',
          text: '3. The Service may become paid in the future. Fees will apply only after a separate notice and after the User has separately accepted them.',
        },
      ],
    },
    {
      id: 'account',
      title: 'Account',
      blocks: [
        {
          kind: 'p',
          text: '1. To use the Service you must create an Account and accept the Terms and the Privacy policy. You can create an Account with an email address and a password or with a Google account.',
        },
        {
          kind: 'p',
          text: '2. One person may have one Account. An Account must not be shared with other people.',
        },
        {
          kind: 'p',
          text: '3. After registration we send an email with a link to confirm the address. Some features, for example the bank connection, require a confirmed email address.',
        },
        {
          kind: 'p',
          text: '4. The User keeps their password safe and does not give it to anyone. A User who suspects that someone knows their password should change it and write to {supportEmail}.',
        },
        {
          kind: 'p',
          text: '5. Each User has one of these roles in a Company:',
        },
        {
          kind: 'ul',
          items: [
            'Owner: has full access to the Company, including its settings (name and currency) and the bank connections.',
            'Accountant: enters and changes data, for example accounts, transactions, categories, counterparties and imports.',
            'Viewer: can only read the Company’s data.',
          ],
        },
        {
          kind: 'p',
          text: '6. The User who creates a Company becomes its Owner. The Owner decides who has access to the Company and with which role, and is responsible for that choice.',
        },
      ],
    },
    {
      id: 'obligations',
      title: 'User obligations',
      blocks: [
        {
          kind: 'p',
          text: 'The User:',
        },
        {
          kind: 'ul',
          items: [
            'uses the Service lawfully and in line with the Terms;',
            'does not abuse the Service, and in particular does not try to bypass its security, gain access to other people’s data or disrupt the Service;',
            'is responsible for the accuracy and lawfulness of the data they enter into the Service.',
          ],
        },
        {
          kind: 'p',
          text: 'The Service does not replace bookkeeping kept in line with the law or tax advice. The reports in FinFlow are for management purposes.',
        },
      ],
    },
    {
      id: 'banking',
      title: 'Bank connection',
      blocks: [
        {
          kind: 'p',
          text: '1. On the instruction of the Company’s Owner, FinFlow connects to the bank through Enable Banking under the payment services rules (PSD2).',
        },
        {
          kind: 'p',
          text: '2. The access is read-only: FinFlow fetches the account data, the balance and the transactions. FinFlow never initiates payments or moves money.',
        },
        {
          kind: 'p',
          text: '3. The Owner can disconnect the bank in the application at any time. FinFlow then stops fetching data from that bank. Transactions fetched earlier stay in the Company.',
        },
        {
          kind: 'p',
          text: '4. FinFlow asks the bank for access for 90 days. The access ends on the date set by the bank. After that it must be renewed for FinFlow to keep fetching new transactions.',
        },
      ],
    },
    // TO BE CONFIRMED BY THE LAWYER: liability limits
    {
      id: 'liability',
      title: 'Liability',
      blocks: [
        {
          kind: 'p',
          text: '1. During the beta the Service is provided as it is, without warranty, to the extent the law allows.',
        },
        {
          kind: 'p',
          text: '2. The Provider is not liable for the consequences of incorrect data entered by the User or for outages of banks and Enable Banking.',
        },
        {
          kind: 'p',
          text: '3. Limitations of liability apply only to the extent permitted by law. Nothing in the Terms excludes liability that cannot be excluded by law.',
        },
      ],
    },
    {
      id: 'ip',
      title: 'Intellectual property',
      blocks: [
        {
          kind: 'p',
          text: '1. The Service, including its code, design and name, belongs to the Provider.',
        },
        {
          kind: 'p',
          text: '2. The Company keeps all rights to the Company Data. It grants the Provider a licence to the Company Data only to the extent needed to provide the Service.',
        },
      ],
    },
    {
      id: 'termination',
      title: 'Ending the use of the Service',
      blocks: [
        {
          kind: 'p',
          text: '1. The User may stop using the Service at any time.',
        },
        {
          kind: 'p',
          text: '2. The Owner can export the Company Data in the application: Settings → Privacy and data.',
        },
        {
          kind: 'p',
          text: '3. To delete an Account or the Company Data, write to {rodoEmail}. We delete the data within one month of receiving the message, unless the law requires us to keep it longer.',
        },
        {
          kind: 'p',
          text: '4. The Provider may suspend an Account if the User abuses the Service or breaches the Terms.',
        },
      ],
    },
    {
      id: 'changes',
      title: 'Changes to the Terms',
      blocks: [
        {
          kind: 'p',
          text: '1. The Provider may change the Terms, for example because of changes in the Service or in the law.',
        },
        {
          kind: 'p',
          text: '2. A material change means a new version of the Terms. Before further use of the Service, the application asks for acceptance again.',
        },
      ],
    },
    {
      id: 'law',
      title: 'Governing law and complaints',
      blocks: [
        {
          kind: 'p',
          text: '1. The Service is intended for businesses (entrepreneurs) and is used to run their business.',
        },
        {
          kind: 'p',
          text: '2. The Terms are governed by Polish law.',
        },
        {
          kind: 'p',
          text: '3. Complaints can be sent to {supportEmail}. We reply within 14 days of receiving a complaint.',
        },
        {
          kind: 'p',
          text: '4. Disputes are settled by the court that has jurisdiction under the general rules.',
        },
      ],
    },
    {
      id: 'dpa',
      title: 'Annex: data processing agreement',
      blocks: [
        {
          kind: 'p',
          text: '1. This annex is an agreement on the processing of personal data within the meaning of Art. 28 GDPR. It forms part of the Terms and applies from the acceptance of the Terms.',
        },
        {
          kind: 'p',
          text: '2. In this annex the Company is the controller of the personal data contained in the Company Data, and the Provider is the processor.',
        },
        {
          kind: 'p',
          text: '3. Subject and duration: the Provider processes the personal data contained in the Company Data for as long as the Company uses the Service, and after that until the data is returned or deleted.',
        },
        {
          kind: 'p',
          text: '4. Nature and purpose: storing and processing the Company’s accounting data in order to provide the Service.',
        },
        {
          kind: 'p',
          text: '5. Categories of data:',
        },
        {
          kind: 'ul',
          items: [
            'identification and contact data of counterparties, for example name, NIP (tax ID), address and account number;',
            'names and descriptions of transactions;',
            'bank transaction data, including the IBAN, the counterparty name and the payment title.',
          ],
        },
        {
          kind: 'p',
          text: '6. Categories of data subjects: the Company’s counterparties, employees and contractors.',
        },
        {
          kind: 'p',
          text: '7. The Provider:',
        },
        {
          kind: 'ul',
          items: [
            'processes the data only on the Company’s documented instructions; the instructions are the Terms and the actions of the Company’s Users in the Service; if an instruction infringes the law, the Provider informs the Company;',
            'ensures that the persons authorised to process the data have committed themselves to confidentiality;',
            'applies security measures: encrypted connections (TLS), access to data by role in the Company, database security rules (Firestore) that deny access by default, writes of sensitive data by the server only, and a session cookie that page scripts cannot read (HttpOnly);',
            'helps the Company respond to requests from data subjects and meet its obligations under Art. 32–36 GDPR, to the extent the nature of the processing allows;',
            'notifies the Company of a personal data breach without undue delay;',
            'when the use of the Service ends, returns or deletes the data, as the Company chooses, unless the law requires it to be kept longer.',
          ],
        },
        {
          kind: 'p',
          text: '8. The Company agrees to the use of the following sub-processors:',
        },
        { kind: 'processors' },
        {
          kind: 'p',
          text: '9. The Provider informs the Company in advance of any planned change to this list. The Company may object. If the objection is not accepted, the Company may stop using the Service.',
        },
        {
          kind: 'p',
          text: '10. Data is transferred outside the European Economic Area as described in the Privacy policy: where available, on the basis of the standard contractual clauses or the EU–US Data Privacy Framework.',
        },
        {
          kind: 'p',
          text: '11. Audit: at the Company’s request, the Provider makes available the information needed to demonstrate compliance with Art. 28 GDPR and allows an audit, no more than once a year and with reasonable advance notice.',
        },
      ],
    },
  ],
}
