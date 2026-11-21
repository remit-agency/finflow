// DRAFT for lawyer review. Polish text is authoritative.
import type { LegalContent } from '@/lib/legal/content-types'

// Facts checked against the code:
// roles owner/accountant/viewer and what each may do: firestore.rules, lib/shell/permissions.ts, requireOrgRole in app/api/orgs/**,
// messages roles.*; a new company has one member, its creator as owner: lib/server/orgs.ts;
// verification email at registration: lib/firebase/auth.ts (sendEmailVerification); a verified email is required to connect a bank:
// app/api/enablebanking/session/route.ts (requireVerifiedUser, lib/server/auth.ts);
// Enable Banking read-only (GET sessions/details/balances/transactions; access balances+transactions), bank connection by the owner only,
// 90 days asked for and the bank's valid_until kept: lib/server/banking/eb-api.ts, app/api/enablebanking/session/route.ts;
// disconnect stops reading and keeps the fetched operations: lib/server/banking/link.ts (disconnect),
// app/api/orgs/[orgId]/bank/connections/[connectionId]/route.ts; an expired access must be renewed: lib/server/banking/sync.ts, messages bank.*;
// a new document version asks for acceptance again: lib/legal/consent.ts (needsConsent), components/consent/ConsentGate.tsx;
// counterparty fields (name, NIP, address, IBAN): lib/domain/counterparties/types.ts; bank fields: lib/server/banking/link.ts, key.ts;
// security: HttpOnly session cookie (Secure in production): lib/server/session-cookie.ts; deny-by-default rules and server-only writes:
// firestore.rules; HTTPS to Enable Banking: lib/server/banking/eb-api.ts.
export const termsPl: LegalContent = {
  title: 'Regulamin',
  intro:
    'Ten Regulamin określa zasady korzystania z FinFlow. Częścią Regulaminu jest załącznik o powierzeniu przetwarzania danych osobowych. Wiążąca jest wersja polska tego dokumentu.',
  sections: [
    {
      id: 'definitions',
      title: 'Definicje',
      blocks: [
        {
          kind: 'ul',
          items: [
            'Usługodawca: {name} {legalForm}, {address}, NIP {nip}.',
            'Użytkownik: osoba, która założyła Konto w FinFlow.',
            'Konto: konto Użytkownika w FinFlow, chronione danymi logowania.',
            'Firma: organizacja (przedsiębiorca), której finanse Użytkownik prowadzi w FinFlow.',
            'Usługa: aplikacja FinFlow udostępniana przez Usługodawcę.',
            'Dane Firmy: dane, które Użytkownicy wprowadzają do Usługi lub pobierają do niej dla Firmy, np. rachunki, operacje, kontrahenci, kategorie i dane z banku.',
          ],
        },
      ],
    },
    {
      id: 'service',
      title: 'Usługa',
      blocks: [
        {
          kind: 'p',
          text: '1. FinFlow służy do prowadzenia przepływów pieniężnych (cash flow) i rachunkowości zarządczej małej firmy. Pozwala prowadzić rachunki i operacje, oglądać raporty, importować dane z plików i łączyć się z bankiem.',
        },
        {
          kind: 'p',
          text: '2. Usługa jest w fazie testów (beta). Oznacza to, że:',
        },
        {
          kind: 'ul',
          items: [
            'nie gwarantujemy dostępności ani czasu reakcji (brak SLA);',
            'funkcje mogą się zmieniać, a niektóre mogą zostać wycofane;',
            'w okresie beta korzystanie z Usługi jest bezpłatne.',
          ],
        },
        {
          kind: 'p',
          text: '3. W przyszłości Usługa może stać się płatna. Opłaty zaczną obowiązywać dopiero po osobnej informacji i po tym, jak Użytkownik osobno je zaakceptuje.',
        },
      ],
    },
    {
      id: 'account',
      title: 'Konto',
      blocks: [
        {
          kind: 'p',
          text: '1. Aby korzystać z Usługi, trzeba założyć Konto i zaakceptować Regulamin oraz Politykę prywatności. Konto można założyć z adresem e-mail i hasłem albo przez konto Google.',
        },
        {
          kind: 'p',
          text: '2. Jedna osoba może mieć jedno Konto. Konta nie wolno udostępniać innym osobom.',
        },
        {
          kind: 'p',
          text: '3. Po rejestracji wysyłamy e-mail z linkiem do potwierdzenia adresu. Niektóre funkcje, np. połączenie z bankiem, wymagają potwierdzonego adresu e-mail.',
        },
        {
          kind: 'p',
          text: '4. Użytkownik dba o bezpieczeństwo swojego hasła i nie przekazuje go nikomu. Jeśli podejrzewa, że ktoś poznał jego hasło, powinien je zmienić i napisać na adres {supportEmail}.',
        },
        {
          kind: 'p',
          text: '5. Każdy Użytkownik ma w Firmie jedną z ról:',
        },
        {
          kind: 'ul',
          items: [
            'Właściciel: ma pełny dostęp do Firmy, w tym do jej ustawień (nazwy i waluty) i do połączeń z bankiem.',
            'Księgowy: wprowadza i zmienia dane, np. rachunki, operacje, kategorie, kontrahentów i importy.',
            'Przeglądający: tylko odczytuje dane Firmy.',
          ],
        },
        {
          kind: 'p',
          text: '6. Użytkownik, który zakłada Firmę, zostaje jej Właścicielem. Właściciel decyduje, kto ma dostęp do Firmy i z jaką rolą, i odpowiada za ten wybór.',
        },
      ],
    },
    {
      id: 'obligations',
      title: 'Obowiązki Użytkownika',
      blocks: [
        {
          kind: 'p',
          text: 'Użytkownik:',
        },
        {
          kind: 'ul',
          items: [
            'korzysta z Usługi zgodnie z prawem i z Regulaminem;',
            'nie nadużywa Usługi, w szczególności nie próbuje obejść zabezpieczeń, uzyskać dostępu do cudzych danych ani zakłócić działania Usługi;',
            'odpowiada za poprawność i legalność danych, które wprowadza do Usługi.',
          ],
        },
        {
          kind: 'p',
          text: 'Usługa nie zastępuje księgowości prowadzonej zgodnie z przepisami ani doradztwa podatkowego. Raporty w FinFlow mają charakter zarządczy.',
        },
      ],
    },
    {
      id: 'banking',
      title: 'Połączenie z bankiem',
      blocks: [
        {
          kind: 'p',
          text: '1. Na polecenie Właściciela Firmy FinFlow łączy się z bankiem przez Enable Banking na podstawie przepisów o usługach płatniczych (PSD2).',
        },
        {
          kind: 'p',
          text: '2. Dostęp służy wyłącznie do odczytu: FinFlow pobiera dane rachunku, saldo i operacje. FinFlow nigdy nie zleca płatności ani nie przesyła pieniędzy.',
        },
        {
          kind: 'p',
          text: '3. Właściciel może w każdej chwili rozłączyć bank w aplikacji. Wtedy FinFlow przestaje pobierać dane z tego banku. Operacje pobrane wcześniej zostają w Firmie.',
        },
        {
          kind: 'p',
          text: '4. FinFlow prosi bank o dostęp na 90 dni. Dostęp wygasa w dniu wskazanym przez bank. Potem trzeba go odnowić, aby FinFlow dalej pobierał nowe operacje.',
        },
      ],
    },
    // TO BE CONFIRMED BY THE LAWYER: liability limits
    {
      id: 'liability',
      title: 'Odpowiedzialność',
      blocks: [
        {
          kind: 'p',
          text: '1. Usługa w fazie beta jest udostępniana w obecnym stanie, bez gwarancji, w zakresie, w jakim pozwala na to prawo.',
        },
        {
          kind: 'p',
          text: '2. Usługodawca nie odpowiada za skutki błędnych danych wprowadzonych przez Użytkownika ani za przerwy w działaniu banków i Enable Banking.',
        },
        {
          kind: 'p',
          text: '3. Ograniczenia odpowiedzialności obowiązują tylko w zakresie dozwolonym przez prawo. Regulamin nie wyłącza odpowiedzialności, której nie można wyłączyć na podstawie przepisów.',
        },
      ],
    },
    {
      id: 'ip',
      title: 'Własność intelektualna',
      blocks: [
        {
          kind: 'p',
          text: '1. Usługa, w tym jej kod, wygląd i nazwa, należy do Usługodawcy.',
        },
        {
          kind: 'p',
          text: '2. Firma zachowuje wszystkie prawa do Danych Firmy. Udziela Usługodawcy licencji na Dane Firmy tylko w zakresie potrzebnym do świadczenia Usługi.',
        },
      ],
    },
    {
      id: 'termination',
      title: 'Zakończenie korzystania',
      blocks: [
        {
          kind: 'p',
          text: '1. Użytkownik może w każdej chwili przestać korzystać z Usługi.',
        },
        {
          kind: 'p',
          text: '2. Właściciel może wyeksportować Dane Firmy w aplikacji: Ustawienia → Prywatność i dane.',
        },
        {
          kind: 'p',
          text: '3. Aby usunąć Konto lub Dane Firmy, wystarczy napisać na adres {rodoEmail}. Usuwamy dane w ciągu jednego miesiąca od otrzymania wiadomości, chyba że przepisy prawa wymagają ich dalszego przechowywania.',
        },
        {
          kind: 'p',
          text: '4. Usługodawca może zawiesić Konto, jeśli Użytkownik nadużywa Usługi lub narusza Regulamin.',
        },
      ],
    },
    {
      id: 'changes',
      title: 'Zmiany Regulaminu',
      blocks: [
        {
          kind: 'p',
          text: '1. Usługodawca może zmienić Regulamin, np. z powodu zmian w Usłudze lub w przepisach.',
        },
        {
          kind: 'p',
          text: '2. Istotna zmiana oznacza nową wersję Regulaminu. Przed dalszym korzystaniem z Usługi aplikacja poprosi o ponowną akceptację.',
        },
      ],
    },
    {
      id: 'law',
      title: 'Prawo właściwe i reklamacje',
      blocks: [
        {
          kind: 'p',
          text: '1. Usługa jest przeznaczona dla przedsiębiorców i służy do prowadzenia ich działalności.',
        },
        {
          kind: 'p',
          text: '2. Do Regulaminu stosuje się prawo polskie.',
        },
        {
          kind: 'p',
          text: '3. Reklamacje można zgłaszać na adres {supportEmail}. Odpowiadamy w ciągu 14 dni od otrzymania reklamacji.',
        },
        {
          kind: 'p',
          text: '4. Spory rozstrzyga sąd właściwy według przepisów ogólnych.',
        },
      ],
    },
    {
      id: 'dpa',
      title: 'Załącznik: powierzenie przetwarzania danych osobowych',
      blocks: [
        {
          kind: 'p',
          text: '1. Ten załącznik jest umową powierzenia przetwarzania danych osobowych w rozumieniu art. 28 RODO. Jest częścią Regulaminu i obowiązuje od chwili akceptacji Regulaminu.',
        },
        {
          kind: 'p',
          text: '2. W tym załączniku Firma jest administratorem danych osobowych zawartych w Danych Firmy, a Usługodawca jest podmiotem przetwarzającym.',
        },
        {
          kind: 'p',
          text: '3. Przedmiot i czas trwania: Usługodawca przetwarza dane osobowe zawarte w Danych Firmy przez cały czas, gdy Firma korzysta z Usługi, a potem do ich zwrotu lub usunięcia.',
        },
        {
          kind: 'p',
          text: '4. Charakter i cel: przechowywanie i przetwarzanie danych księgowych Firmy w celu świadczenia Usługi.',
        },
        {
          kind: 'p',
          text: '5. Kategorie danych:',
        },
        {
          kind: 'ul',
          items: [
            'dane identyfikacyjne i kontaktowe kontrahentów, np. nazwa, NIP, adres i numer rachunku;',
            'nazwy i opisy operacji;',
            'dane operacji bankowych, w tym numer IBAN, nazwa kontrahenta i tytuł płatności.',
          ],
        },
        {
          kind: 'p',
          text: '6. Kategorie osób: kontrahenci Firmy, jej pracownicy i współpracownicy.',
        },
        {
          kind: 'p',
          text: '7. Usługodawca:',
        },
        {
          kind: 'ul',
          items: [
            'przetwarza dane wyłącznie na udokumentowane polecenie Firmy; poleceniem jest Regulamin oraz działania Użytkowników Firmy w Usłudze; jeśli polecenie narusza prawo, Usługodawca informuje o tym Firmę;',
            'zapewnia, że osoby upoważnione do przetwarzania danych zobowiązały się do zachowania poufności;',
            'stosuje środki bezpieczeństwa: szyfrowane połączenia (TLS), dostęp do danych według ról w Firmie, reguły bezpieczeństwa bazy danych (Firestore), które domyślnie blokują dostęp, zapis danych wrażliwych wyłącznie przez serwer oraz cookie sesji niedostępne dla skryptów strony (HttpOnly);',
            'pomaga Firmie odpowiadać na żądania osób, których dane dotyczą, oraz wywiązywać się z obowiązków z art. 32–36 RODO, w zakresie wynikającym z charakteru przetwarzania;',
            'bez zbędnej zwłoki zawiadamia Firmę o naruszeniu ochrony danych osobowych;',
            'po zakończeniu korzystania z Usługi zwraca lub usuwa dane, według wyboru Firmy, chyba że przepisy prawa wymagają ich dalszego przechowywania.',
          ],
        },
        {
          kind: 'p',
          text: '8. Firma wyraża zgodę na korzystanie z następujących dalszych podmiotów przetwarzających:',
        },
        { kind: 'processors' },
        {
          kind: 'p',
          text: '9. Usługodawca informuje Firmę z wyprzedzeniem o planowanej zmianie tej listy. Firma może wnieść sprzeciw. Jeśli sprzeciw nie zostanie uwzględniony, Firma może zakończyć korzystanie z Usługi.',
        },
        {
          kind: 'p',
          text: '10. Przekazywanie danych poza Europejski Obszar Gospodarczy odbywa się tak, jak opisuje to Polityka prywatności: gdzie jest to dostępne, na podstawie standardowych klauzul umownych lub ram ochrony danych UE–USA (EU–US Data Privacy Framework).',
        },
        {
          kind: 'p',
          text: '11. Audyt: na żądanie Firmy Usługodawca udostępnia informacje potrzebne do wykazania zgodności z art. 28 RODO i umożliwia audyt, nie częściej niż raz w roku i po uprzedzeniu z rozsądnym wyprzedzeniem.',
        },
      ],
    },
  ],
}
