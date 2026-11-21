import type { LegalContent } from '@/lib/legal/content-types'

// Translation of cookies.pl.ts (the Polish text is authoritative); keep the facts in sync with it.
export const cookiesEn: LegalContent = {
  title: 'Cookie policy',
  intro:
    'This page explains which cookies and which browser storage FinFlow uses. This is a translation: if it differs from the Polish version, the Polish version prevails.',
  sections: [
    {
      id: 'what',
      title: 'What cookies are and why we use only two',
      blocks: [
        {
          kind: 'p',
          text: 'A cookie is a small text file that a website stores in your browser and sends back with later requests. FinFlow uses only two cookies, both strictly necessary for the service: one keeps you signed in and one remembers the interface language. We need no others, so there is nothing to switch off and nothing to consent to.',
        },
        {
          kind: 'p',
          text: 'You can delete cookies in your browser settings (usually under "Privacy" or "Site data"). Deleting __session signs you out of FinFlow; deleting NEXT_LOCALE restores the default language. You can clear the site data kept in browser storage, described below, in the same way. Questions: {supportEmail}.',
        },
      ],
    },
    {
      id: 'list',
      title: 'List of cookies',
      blocks: [
        {
          kind: 'table',
          head: ['Name', 'Purpose', 'Lifetime', 'Type'],
          rows: [
            [
              '__session',
              'Keeps you signed in: holds a signed session token that the server checks when you open application pages.',
              '7 days (not extended)',
              'Strictly necessary; HttpOnly (not readable by scripts), SameSite=Lax, Secure over HTTPS',
            ],
            [
              'NEXT_LOCALE',
              'Remembers the interface language you chose (pl, en or uk).',
              '1 year',
              'Strictly necessary; not HttpOnly (set by the browser), SameSite=Lax, Secure over HTTPS',
            ],
          ],
        },
      ],
    },
    {
      id: 'storage',
      title: 'Browser storage (localStorage and IndexedDB)',
      blocks: [
        {
          kind: 'p',
          text: 'Besides cookies, FinFlow keeps a few appearance and convenience settings in your browser storage (localStorage). They stay until you clear the site data, do not expire on their own and are not sent to our server. Where a key contains <id>, it stands for a company or user identifier.',
        },
        {
          kind: 'table',
          head: ['Key', 'Purpose'],
          rows: [
            ['theme', 'The colour theme you chose (light or dark).'],
            ['finflow:sidebar-collapsed', 'Whether the side menu is collapsed.'],
            ['lastOrgId_<id>', 'The company a user opened last, so you return to it after signing in.'],
            ['finflow:transfer-dismissed:<id>', 'Suggested transfers between your own accounts that you turned down (separately for each company).'],
            ['finflow:plan-dismissed:<id>', 'Suggested matches of planned payments that you turned down (separately for each company).'],
            ['balance-sheet-<id>', 'Values you typed into the balance sheet by hand, such as real estate, capital and loans (separately for each company).'],
          ],
        },
        {
          kind: 'p',
          text: 'In addition, the Firebase Authentication package (Google), which handles sign-in, stores your signed-in state in an IndexedDB database named firebaseLocalStorageDb (keys start with firebase:authUser:). This is needed to stay signed in; the token it holds is used to talk to Google Firebase services.',
        },
      ],
    },
    {
      id: 'none',
      title: 'What we do not use',
      blocks: [
        {
          kind: 'ul',
          items: [
            'We do not use analytics, advertising or tracking cookies.',
            'We do not load third-party scripts for analytics, advertising or profiling.',
            'Fonts are downloaded when the application is built and served from our own domain, not from Google servers.',
          ],
        },
      ],
    },
  ],
}
