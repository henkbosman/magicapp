function normalizeCardName(value) {
  return String(value ?? '')
    // Preserve meaning-bearing Unicode marks in localized card names.
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[’‘`]/gu, "'")
    .replace(/[‐‑‒–—―]/gu, '-')
    .replace(/[^\p{L}\p{N}/' -]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

// A printing may be requested by its full English/localized name, a single
// face, or a printed flavor name. Partial/fuzzy matches are not identities.
export function cardMatchesRequestedName(card, requestedName, raw = card.raw || card) {
  const requested = normalizeCardName(requestedName);
  if (!requested) return false;
  const candidates = [
    card.name,
    card.printedName,
    raw.printed_name,
    raw.flavor_name,
    ...(card.cardFaces || []).flatMap((face) => [face.name, face.printed_name, face.flavor_name]),
    ...(raw.card_faces || []).flatMap((face) => [face.name, face.printed_name, face.flavor_name])
  ].filter(Boolean);
  return candidates.some((candidate) => {
    const names = String(candidate).split(/\s*\/\/\s*/u);
    return names.some((name) => normalizeCardName(name) === requested)
      || normalizeCardName(candidate) === requested;
  });
}
