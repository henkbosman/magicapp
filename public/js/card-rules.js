export function isBasicLand(card) {
  return Boolean(
    card
    && Array.isArray(card.cardTypes)
    && Array.isArray(card.supertypes)
    && card.cardTypes.includes('Land')
    && card.supertypes.includes('Basic')
  );
}
