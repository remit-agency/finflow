// The README.txt of a company export ZIP: the same short text in Polish, English and Ukrainian. The file names mirror
// EXPORT_COLLECTIONS (lib/domain/export/collections.ts); keep the three texts in sync with it and with each other.
import { EXPORT_COLLECTIONS } from '@/lib/domain/export/collections'

const FILES = EXPORT_COLLECTIONS.map((c) => `${c}.json`).join(', ')
const NOT_EXPORTED = 'rollups, ledger, counterpartyKeys, tagKeys, bankSeen, bankAccounts, recurringDone, importLocks'

export function exportReadme(orgName: string, dateIso: string): string {
  return [
    'FinFlow - eksport danych firmy / company data export / експорт даних компанії',
    `${orgName} | ${dateIso}`,
    '',
    '== POLSKI ==',
    `Firma: ${orgName}. Data eksportu: ${dateIso}.`,
    `To archiwum zawiera po jednym pliku .json na kolekcję: ${FILES}, oraz me.json (dane Twojego konta: adres e-mail, nazwa, członkostwa, zgody).`,
    'Kwoty są liczbami całkowitymi w jednostkach podrzędnych waluty (grosze, centy), dokładnie tak, jak są zapisane (np. 12345 = 123,45).',
    `Czego NIE ma w archiwum: kolekcji pochodnych i technicznych (${NOT_EXPORTED}) - są odbudowywane z danych powyżej, więc nie niosą nowych informacji.`,
    'Tokeny dostępu do banków nigdy nie są eksportowane.',
    '',
    '== ENGLISH ==',
    `Company: ${orgName}. Export date: ${dateIso}.`,
    `This archive holds one .json file per collection: ${FILES}, and me.json (your own account data: email, name, memberships, consents).`,
    'Amounts are integers in minor units of the currency (grosze, cents), exactly as stored (for example 12345 = 123.45).',
    `NOT included: derived and technical collections (${NOT_EXPORTED}). They are rebuilt from the data above, so they hold no new information.`,
    'Bank access tokens are never exported.',
    '',
    '== УКРАЇНСЬКА ==',
    `Компанія: ${orgName}. Дата експорту: ${dateIso}.`,
    `Цей архів містить по одному файлу .json на колекцію: ${FILES}, а також me.json (дані вашого облікового запису: e-mail, ім'я, членство, згоди).`,
    'Суми - цілі числа в менших одиницях валюти (гроші, центи), точно так, як збережено (наприклад, 12345 = 123,45).',
    `НЕ включено: похідні та технічні колекції (${NOT_EXPORTED}). Вони відновлюються з наведених вище даних, тож нової інформації не містять.`,
    'Токени доступу до банків ніколи не експортуються.',
    '',
  ].join('\n')
}
