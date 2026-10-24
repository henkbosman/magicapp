export function deckTagKey(value) {
  return String(value ?? '').trim().normalize('NFC').toLocaleLowerCase('nl');
}
