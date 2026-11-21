import type { LegalContent } from '@/lib/legal/content-types'

// Polish is the authoritative text. Facts checked against the code:
// __session: lib/server/session-cookie.ts; NEXT_LOCALE: lib/i18n/client.ts + lib/i18n/config.ts;
// browser storage keys: lib/shell/sidebar-store.ts, lib/domain/transfers/dismissed.ts, lib/domain/recurring/dismissed.ts,
// components/charts/BalanceSheet.tsx, lib/hooks/useOrg.tsx, next-themes (app/layout.tsx), Firebase Auth SDK (lib/firebase/firebase.ts).
export const cookiesPl: LegalContent = {
  title: 'Polityka cookies',
  intro:
    'Ta strona wyjaśnia, jakich plików cookie i jakiej pamięci przeglądarki używa FinFlow. Wiążąca jest wersja polska tego dokumentu.',
  sections: [
    {
      id: 'what',
      title: 'Czym są cookies i dlaczego używamy tylko dwóch',
      blocks: [
        {
          kind: 'p',
          text: 'Cookie to mały plik tekstowy, który strona zapisuje w przeglądarce i odsyła przy kolejnych żądaniach. FinFlow używa wyłącznie dwóch cookies, obu ściśle niezbędnych do działania usługi: jednego do utrzymania logowania i jednego do zapamiętania języka interfejsu. Nie potrzebujemy żadnych innych, więc nie ma czego wyłączać ani na co się zgadzać.',
        },
        {
          kind: 'p',
          text: 'Cookies możesz usunąć w ustawieniach przeglądarki (zwykle w sekcji „Prywatność” lub „Dane witryn”). Usunięcie __session wylogowuje Cię z FinFlow; usunięcie NEXT_LOCALE przywraca domyślny język. Tak samo możesz wyczyścić dane witryny zapisane w pamięci przeglądarki, opisane niżej. Pytania skieruj na {supportEmail}.',
        },
      ],
    },
    {
      id: 'list',
      title: 'Lista cookies',
      blocks: [
        {
          kind: 'table',
          head: ['Nazwa', 'Cel', 'Okres ważności', 'Rodzaj'],
          rows: [
            [
              '__session',
              'Utrzymuje zalogowanie: zawiera podpisany token sesji, który serwer sprawdza przy otwieraniu stron aplikacji.',
              '7 dni (bez przedłużania)',
              'Ściśle niezbędny; HttpOnly (niedostępny dla skryptów), SameSite=Lax, Secure przy HTTPS',
            ],
            [
              'NEXT_LOCALE',
              'Zapamiętuje wybrany język interfejsu (pl, en lub uk).',
              '1 rok',
              'Ściśle niezbędny; bez HttpOnly (ustawiany przez przeglądarkę), SameSite=Lax, Secure przy HTTPS',
            ],
          ],
        },
      ],
    },
    {
      id: 'storage',
      title: 'Pamięć przeglądarki (localStorage i IndexedDB)',
      blocks: [
        {
          kind: 'p',
          text: 'Poza cookies FinFlow zapisuje w pamięci Twojej przeglądarki (localStorage) kilka ustawień wyglądu i wygody. Zostają tam do czasu wyczyszczenia danych witryny, nie wygasają same i nie są wysyłane na nasz serwer. Podane klucze, w których występuje <id>, oznaczają identyfikator firmy lub użytkownika.',
        },
        {
          kind: 'table',
          head: ['Klucz', 'Cel'],
          rows: [
            ['theme', 'Wybrany motyw kolorystyczny (jasny lub ciemny).'],
            ['finflow:sidebar-collapsed', 'Czy menu boczne jest zwinięte.'],
            ['lastOrgId_<id>', 'Ostatnio otwarta firma danego użytkownika, aby wrócić do niej po zalogowaniu.'],
            ['finflow:transfer-dismissed:<id>', 'Odrzucone sugestie przelewów między własnymi rachunkami (osobno dla każdej firmy).'],
            ['finflow:plan-dismissed:<id>', 'Odrzucone dopasowania zaplanowanych płatności (osobno dla każdej firmy).'],
            ['balance-sheet-<id>', 'Wartości wpisane ręcznie w zestawieniu bilansowym, np. nieruchomości, kapitał i pożyczki (osobno dla każdej firmy).'],
          ],
        },
        {
          kind: 'p',
          text: 'Dodatkowo pakiet Firebase Authentication (Google), który obsługuje logowanie, zapisuje stan zalogowania w bazie IndexedDB o nazwie firebaseLocalStorageDb (klucze zaczynają się od firebase:authUser:). Jest to konieczne, aby pozostać zalogowanym; zawarty w niej token służy do komunikacji z usługami Google Firebase.',
        },
      ],
    },
    {
      id: 'none',
      title: 'Czego nie używamy',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Nie używamy cookies analitycznych, reklamowych ani śledzących.',
            'Nie ładujemy skryptów firm trzecich do analityki, reklam ani profilowania.',
            'Czcionki są pobierane podczas budowania aplikacji i udostępniane z naszej własnej domeny, a nie z serwerów Google.',
          ],
        },
      ],
    },
  ],
}
