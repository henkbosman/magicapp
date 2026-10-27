// Probabilities for a uniformly shuffled deck, drawing without replacement.
// These calculators do not model mulligans, card selection or extra draws.
export const MAX_DECK_SIZE = 10000;

function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} moet een geheel getal tussen ${minimum} en ${maximum} zijn.`);
  }
  return value;
}

function validateDeck(deckSize, draws) {
  integer(deckSize, 1, MAX_DECK_SIZE, 'Deckgrootte');
  integer(draws, 0, deckSize, 'Aantal getrokken kaarten');
}

function compensatedSum(values) {
  let total = 0;
  let correction = 0;
  for (const value of values) {
    const corrected = value - correction;
    const next = total + corrected;
    correction = (next - total) - corrected;
    total = next;
  }
  return total;
}

const probability = (value) => Math.max(0, Math.min(1, value));

// Start at a mode with relative weight 1 and recurse outward. This avoids
// factorial overflow and an underflowed first probability for large decks.
// Every intermediate weight stays <= 1 (apart from rounding at a tied mode).
function distribution(deckSize, copies, draws) {
  const minimum = Math.max(0, draws - (deckSize - copies));
  const maximum = Math.min(copies, draws);
  const mode = Math.max(minimum, Math.min(maximum,
    Math.floor(((draws + 1) * (copies + 1)) / (deckSize + 2))));
  const weights = new Float64Array(maximum - minimum + 1);
  weights[mode - minimum] = 1;
  for (let count = mode; count < maximum; count++) {
    weights[count + 1 - minimum] = weights[count - minimum]
      * ((copies - count) * (draws - count))
      / ((count + 1) * (deckSize - copies - draws + count + 1));
  }
  for (let count = mode; count > minimum; count--) {
    weights[count - 1 - minimum] = weights[count - minimum]
      * (count * (deckSize - copies - draws + count))
      / ((copies - count + 1) * (draws - count + 1));
  }
  return { minimum, weights, total: compensatedSum(weights) };
}

/**
 * All probability results are fractions in [0, 1]; expected is a card count.
 * Inputs must be numbers containing integers. A target above draws/copies is
 * allowed: an impossible target has exact/upper-tail probability zero.
 */
export function hypergeometricOdds({ deckSize, copies, draws, target } = {}) {
  validateDeck(deckSize, draws);
  integer(copies, 0, deckSize, 'Aantal exemplaren');
  integer(target, 0, deckSize, 'Gewenst aantal');
  const { minimum, weights, total } = distribution(deckSize, copies, draws);
  const boundary = Math.max(0, Math.min(weights.length, target - minimum));
  const exactWeight = weights[target - minimum] || 0;
  // Sum each tail directly; subtracting a near-one CDF loses tiny odds.
  const lessThan = probability(compensatedSum(weights.subarray(0, boundary)) / total);
  const greaterStart = Math.max(0, Math.min(weights.length, target + 1 - minimum));
  const greaterThan = probability(compensatedSum(weights.subarray(greaterStart)) / total);
  const exact = probability(exactWeight / total);
  return {
    exact,
    lessThan,
    atMost: probability(lessThan + exact),
    atLeast: probability(greaterThan + exact),
    greaterThan,
    expected: draws * copies / deckSize
  };
}

/**
 * Chance of drawing at least one A AND at least one B. A and B are disjoint
 * categories: a physical card must not be counted in both input quantities.
 */
export function multivariateIntersectOdds({ deckSize, copiesA, copiesB, draws } = {}) {
  validateDeck(deckSize, draws);
  integer(copiesA, 0, deckSize, 'Aantal exemplaren van A');
  integer(copiesB, 0, deckSize, 'Aantal exemplaren van B');
  if (copiesA + copiesB > deckSize) {
    throw new RangeError('A en B mogen samen niet meer kaarten bevatten dan het deck. Tel elke kaart in slechts één groep mee.');
  }
  if (draws < 2 || copiesA === 0 || copiesB === 0) return 0;

  // Condition on the number of A cards drawn. The remaining draws form a
  // hypergeometric sample of the non-A cards. Precompute P(at least one B)
  // for those sample sizes in O(draws). log1p/expm1 preserve tiny chances.
  // This positive sum avoids cancellation in 1-P(no A)-P(no B)+P(neither).
  const remainingDeck = deckSize - copiesA;
  const conditional = new Float64Array(Math.min(draws, remainingDeck) + 1);
  let logNone = 0;
  for (let count = 1; count < conditional.length; count++) {
    if (count > remainingDeck - copiesB) {
      conditional[count] = 1;
    } else {
      logNone += Math.log1p(-copiesB / (remainingDeck - count + 1));
      conditional[count] = -Math.expm1(logNone);
    }
  }
  const { minimum, weights, total } = distribution(deckSize, copiesA, draws);
  const jointWeights = new Float64Array(weights.length);
  for (let index = 0; index < weights.length; index++) {
    const countA = minimum + index;
    if (countA > 0) jointWeights[index] = weights[index] * conditional[draws - countA];
  }
  return probability(compensatedSum(jointWeights) / total);
}
