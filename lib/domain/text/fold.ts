/**
 * Latin letters without their diacritics (`ł` counts as `l`, `ó` as `o`), case kept. Other scripts keep their letters:
 * Cyrillic `й` stays distinct from `и`; marks left over after recomposition (a stress mark, say) are dropped.
 * The one fold of the counterparty name key (S06) and of the rule text matching (S10).
 */
export function foldDiacritics(text: string): string {
  return text
    .normalize('NFD')
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
    .normalize('NFC')
    // What is still a combining mark now (a stress mark, say) is not part of a precomposed letter: `й` and `ї` stay.
    .replace(/\p{M}+/gu, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
}
