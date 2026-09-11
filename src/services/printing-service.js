const LANGUAGE_ORDER = ['en', 'nl', 'de', 'fr', 'es', 'it', 'pt', 'ja', 'ko', 'ru', 'zhs', 'zht'];

export function summarizeLocalPrinting(card) {
  return {
    cardId: card.id,
    scryfallId: card.scryfallId,
    oracleId: card.oracleId,
    name: card.name,
    printedName: card.printedName,
    setName: card.setName,
    setCode: card.setCode,
    collectorNumber: card.collectorNumber,
    rarity: card.rarity,
    releasedAt: card.releasedAt,
    language: card.language,
    finishes: card.finishes,
    prices: card.prices,
    image: card.images.small || card.images.normal,
    imageNormal: card.images.normal || card.images.small,
    typeLine: card.typeLine,
    manaCost: card.manaCost,
    layout: card.layout,
    cached: true
  };
}

function printingKey(printing) {
  return `${String(printing.setCode || '').toLowerCase()}|${String(printing.collectorNumber || '')}`;
}

function languageRank(language) {
  const index = LANGUAGE_ORDER.indexOf(language);
  return index === -1 ? LANGUAGE_ORDER.length : index;
}

function chooseRepresentative(current, candidate) {
  if (!current) return candidate;
  const currentRank = languageRank(current.language);
  const candidateRank = languageRank(candidate.language);
  if (candidateRank !== currentRank) return candidateRank < currentRank ? candidate : current;
  if (candidate.cached !== current.cached) return candidate.cached ? candidate : current;
  return current;
}

export function groupPrintings(printings) {
  const groups = new Map();
  for (const printing of printings) {
    const key = printingKey(printing);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        representative: null,
        variants: new Map(),
        finishes: new Set()
      });
    }
    const group = groups.get(key);
    const language = printing.language || 'en';
    const currentVariant = group.variants.get(language);
    const mergedVariant = currentVariant
      ? {
          ...currentVariant,
          ...printing,
          cardId: printing.cardId || currentVariant.cardId || null,
          cached: Boolean(printing.cached || currentVariant.cached),
          finishes: [...new Set([...(currentVariant.finishes || []), ...(printing.finishes || [])])]
        }
      : { ...printing, cardId: printing.cardId || null, language, cached: Boolean(printing.cached) };
    group.variants.set(language, mergedVariant);
    for (const finish of printing.finishes || []) group.finishes.add(finish);
    group.representative = chooseRepresentative(group.representative, mergedVariant);
  }

  return [...groups.values()].map((group) => {
    const representative = group.representative;
    const variants = [...group.variants.values()]
      .sort((a, b) => languageRank(a.language) - languageRank(b.language) || a.language.localeCompare(b.language))
      .map((variant) => ({
        language: variant.language,
        scryfallId: variant.scryfallId,
        cardId: variant.cardId || null,
        finishes: variant.finishes || [],
        prices: variant.prices || {},
        image: variant.image || null,
        imageNormal: variant.imageNormal || variant.image || null,
        cached: Boolean(variant.cached)
      }));
    return {
      printingKey: group.key,
      cardId: representative.cardId || null,
      scryfallId: representative.scryfallId,
      oracleId: representative.oracleId,
      name: representative.name,
      printedName: representative.printedName,
      setName: representative.setName,
      setCode: representative.setCode,
      collectorNumber: representative.collectorNumber,
      rarity: representative.rarity,
      releasedAt: representative.releasedAt,
      language: representative.language,
      languages: variants.map((variant) => variant.language),
      finishes: [...group.finishes],
      variants,
      prices: representative.prices,
      image: representative.image,
      imageNormal: representative.imageNormal || representative.image,
      typeLine: representative.typeLine,
      manaCost: representative.manaCost,
      layout: representative.layout,
      cached: variants.some((variant) => variant.cached)
    };
  });
}
