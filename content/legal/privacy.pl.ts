// DRAFT for lawyer review. Polish text is authoritative.
import type { LegalContent } from '@/lib/legal/content-types'

// Facts checked against the code:
// name + email + password via Firebase Auth, display name in the Auth profile only: lib/firebase/auth.ts (updateProfile);
// company name + currency, roles owner/accountant/viewer: lib/server/orgs.ts, firestore.rules, messages roles.*;
// consent records (doc, version, at, locale, source register/google/gate): lib/server/consent/index.ts, lib/legal/consent.ts;
// rate-limit counters keyed by scope + user id, only a count and an expiry: lib/server/rate-limit.ts, lib/server/rate-limit-guard.ts;
// Enable Banking read-only (GET sessions/details/balances/transactions; access balances+transactions), IP + user agent
// sent as psu-* headers when the user is present: lib/server/banking/eb-api.ts, lib/server/banking/index.ts,
// app/api/enablebanking/session/route.ts; stored bank fields (IBAN, name, currency, counterparty, remittance): lib/server/banking/link.ts, key.ts.
export const privacyPl: LegalContent = {
  title: 'Polityka prywatności',
  intro:
    'Ta polityka wyjaśnia, jakie dane osobowe przetwarzamy w związku z korzystaniem z FinFlow, w jakich celach i na jakiej podstawie oraz jakie prawa Ci przysługują. Wiążąca jest wersja polska tego dokumentu.',
  sections: [
    {
      id: 'controller',
      title: 'Administrator danych',
      blocks: [
        {
          kind: 'p',
          text: 'Administratorem danych osobowych jest {name} {legalForm}, {address}, NIP {nip} (dalej: „my”). W sprawach ochrony danych osobowych możesz pisać na adres {rodoEmail}.',
        },
        {
          kind: 'p',
          text: 'W FinFlow występujemy w dwóch rolach:',
        },
        {
          kind: 'ul',
          items: [
            'Jako administrator przetwarzamy dane potrzebne do logowania i prowadzenia konta: imię i nazwisko, adres e-mail, zapisy akceptacji dokumentów oraz dane techniczne (logi).',
            'Jako podmiot przetwarzający przetwarzamy dane biznesowe firmy, którą prowadzisz w FinFlow (np. operacje, kontrahentów i dane z rachunków bankowych). Administratorem tych danych jest firma korzystająca z usługi. Zasady ich przetwarzania określa umowa powierzenia (Regulamin, załącznik: powierzenie przetwarzania danych).',
          ],
        },
      ],
    },
    {
      id: 'purposes',
      title: 'Cele i podstawy prawne przetwarzania',
      blocks: [
        {
          kind: 'table',
          head: ['Cel', 'Dane', 'Podstawa prawna'],
          rows: [
            [
              'Założenie i prowadzenie konta oraz świadczenie usługi',
              'Imię i nazwisko, adres e-mail, dane logowania, nazwa i waluta firmy, Twoja rola w firmie',
              'Art. 6 ust. 1 lit. b RODO (wykonanie umowy)',
            ],
            [
              'Bezpieczeństwo usługi i zapobieganie nadużyciom, w tym logi techniczne i limity liczby żądań',
              'Adres IP, informacje o przeglądarce (user agent), identyfikator konta, liczniki żądań',
              'Art. 6 ust. 1 lit. f RODO (nasz prawnie uzasadniony interes: bezpieczeństwo usługi)',
            ],
            [
              'Wypełnianie obowiązków prawnych oraz ustalenie, dochodzenie lub obrona roszczeń',
              'Dane w zakresie niezbędnym do danego obowiązku lub roszczenia',
              'Art. 6 ust. 1 lit. c RODO (obowiązek prawny) oraz art. 6 ust. 1 lit. f RODO (nasz prawnie uzasadniony interes: ochrona przed roszczeniami)',
            ],
            [
              'Wykazanie akceptacji Regulaminu i Polityki prywatności',
              'Dokument, wersja, czas i język akceptacji',
              'Art. 6 ust. 1 lit. f RODO oraz art. 7 ust. 1 RODO (rozliczalność: możliwość wykazania akceptacji)',
            ],
          ],
        },
        {
          kind: 'p',
          text: 'W tej wersji usługi nie przetwarzamy danych osobowych w celach marketingowych.',
        },
      ],
    },
    {
      id: 'data',
      title: 'Jakie dane przetwarzamy',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Dane konta: imię i nazwisko oraz adres e-mail. Jeśli zakładasz konto z hasłem, hasło przechowuje w postaci skrótu (hash) usługa Firebase Authentication (Google); my nie znamy Twojego hasła. Jeśli logujesz się przez Google, otrzymujemy z konta Google m.in. imię i nazwisko oraz adres e-mail.',
            'Dane firmy: nazwa i waluta firmy oraz Twoja rola w firmie (Właściciel, Księgowy lub Przeglądający).',
            'Treści, które wprowadzasz do usługi, np. operacje, kontrahenci, kategorie i plany płatności. Przetwarzamy je jako podmiot przetwarzający w imieniu firmy.',
            'Dane techniczne: adres IP i informacje o przeglądarce (user agent), które mogą trafiać do logów serwera prowadzonych przez dostawcę hostingu, oraz liczniki żądań służące do limitów. Liczniki są powiązane z identyfikatorem konta, a nie z adresem IP, i zawierają tylko liczbę żądań w danym przedziale czasu.',
            'Zapisy akceptacji: który dokument zaakceptowano, w jakiej wersji, kiedy, w jakim języku i w jakiej sytuacji (przy rejestracji, przy logowaniu przez Google lub w oknie z prośbą o akceptację).',
            'Dane bankowe: jeśli połączysz rachunek bankowy, na Twoje polecenie odczytujemy przez Enable Banking dane rachunku (np. numer IBAN, nazwę i walutę), saldo oraz operacje (np. kwotę, datę, tytuł i nazwę kontrahenta). Dostęp na podstawie PSD2 służy wyłącznie do odczytu: nie możemy zlecać płatności. Gdy odczyt odbywa się w Twojej obecności, przekazujemy Enable Banking także Twój adres IP i informacje o przeglądarce, aby bank wiedział, że zapytanie wykonano w Twojej obecności. Dane bankowe są danymi firmy i przetwarzamy je jako podmiot przetwarzający.',
          ],
        },
      ],
    },
    {
      id: 'recipients',
      title: 'Odbiorcy danych',
      blocks: [
        {
          kind: 'p',
          text: 'Korzystamy z dostawców, którzy przetwarzają dane w naszym imieniu i na nasze polecenie:',
        },
        { kind: 'processors' },
        {
          kind: 'ul',
          items: [
            'Osoby, które mają dostęp do tej samej firmy w FinFlow (np. księgowi), widzą jej dane w zakresie swojej roli.',
            'Organy publiczne otrzymują dane tylko wtedy, gdy wymagają tego przepisy prawa.',
          ],
        },
      ],
    },
    {
      id: 'transfers',
      title: 'Przekazywanie danych poza EOG',
      blocks: [
        {
          kind: 'p',
          text: 'Google i Vercel mogą przetwarzać dane także poza Europejskim Obszarem Gospodarczym, w tym w USA. Takie przekazanie opiera się, gdzie jest to dostępne, na standardowych klauzulach umownych zatwierdzonych przez Komisję Europejską lub na ramach ochrony danych UE–USA (EU–US Data Privacy Framework). Enable Banking przetwarza dane w Finlandii, czyli w Unii Europejskiej.',
        },
      ],
    },
    {
      id: 'retention',
      title: 'Jak długo przechowujemy dane',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Dane konta: przez cały czas istnienia konta.',
            'Dane firmy: do czasu, gdy właściciel usunie firmę lub zażąda usunięcia danych.',
            'Zapisy akceptacji: tak długo, jak jest to potrzebne do wykazania akceptacji dokumentów.',
            'Logi techniczne i liczniki żądań: krótko, nie dłużej, niż jest to potrzebne dla bezpieczeństwa usługi. Dokładny okres określa specyfikacja operacyjna.',
          ],
        },
        {
          kind: 'p',
          text: 'Na pisemne żądanie (wystarczy e-mail na adres {rodoEmail}) usuwamy dane w ciągu jednego miesiąca, chyba że przepisy prawa wymagają ich dalszego przechowywania.',
        },
      ],
    },
    {
      id: 'rights',
      title: 'Twoje prawa',
      blocks: [
        {
          kind: 'p',
          text: 'Masz prawo do:',
        },
        {
          kind: 'ul',
          items: [
            'dostępu do swoich danych i otrzymania ich kopii;',
            'sprostowania danych nieprawidłowych lub niekompletnych;',
            'usunięcia danych;',
            'ograniczenia przetwarzania;',
            'przenoszenia danych; właściciel firmy może sam wyeksportować dane firmy w aplikacji: Ustawienia → Prywatność i dane;',
            'sprzeciwu wobec przetwarzania opartego na naszym prawnie uzasadnionym interesie;',
            'wycofania zgody w dowolnym momencie, jeśli przetwarzanie opiera się na zgodzie; wycofanie zgody nie wpływa na zgodność z prawem przetwarzania przed jej wycofaniem;',
            'wniesienia skargi do Prezesa Urzędu Ochrony Danych Osobowych.',
          ],
        },
        {
          kind: 'p',
          text: 'Aby skorzystać z tych praw, napisz na adres {rodoEmail}. Odpowiemy w ciągu jednego miesiąca od otrzymania żądania. Jeśli żądanie dotyczy danych firmy, które przetwarzamy jako podmiot przetwarzający, przekażemy je firmie albo pomożemy jej je obsłużyć.',
        },
      ],
    },
    {
      id: 'cookies',
      title: 'Cookies',
      blocks: [
        {
          kind: 'p',
          text: 'Używamy tylko dwóch ściśle niezbędnych cookies (do utrzymania logowania i do zapamiętania języka) oraz pamięci przeglądarki, w której zapisujemy ustawienia interfejsu i stan logowania. Nie używamy cookies ani narzędzi śledzących. Szczegóły znajdziesz w Polityce cookies: /legal/cookies.',
        },
      ],
    },
    {
      id: 'automated',
      title: 'Zautomatyzowane podejmowanie decyzji',
      blocks: [
        {
          kind: 'p',
          text: 'Nie podejmujemy decyzji opartych wyłącznie na zautomatyzowanym przetwarzaniu, w tym profilowaniu, które wywoływałyby wobec Ciebie skutki prawne lub w podobny sposób istotnie na Ciebie wpływały.',
        },
      ],
    },
  ],
}
