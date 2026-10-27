import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_DECK_SIZE, hypergeometricOdds, multivariateIntersectOdds } from '../public/js/draw-odds.js';

function close(actual, expected, description = '', tolerance = 2e-14) {
  assert.ok(Number.isFinite(actual), `${description}: finite result`);
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${description}: ${actual} differs from ${expected}`);
}

function choose(n, k) {
  if (k < 0 || k > n) return 0n;
  let result = 1n;
  for (let index = 1; index <= Math.min(k, n - k); index++) {
    result = result * BigInt(n - index + 1) / BigInt(index);
  }
  return result;
}

function hands(deckSize, draws) {
  const result = [];
  for (let mask = 0; mask < 2 ** deckSize; mask++) {
    const selected = Array.from({ length: deckSize }, (_, index) => index)
      .filter((index) => mask & (1 << index));
    if (selected.length === draws) result.push(selected);
  }
  return result;
}

test('hypergeometric results match every enumerated small deck and target', () => {
  for (let deckSize = 1; deckSize <= 8; deckSize++) {
    for (let draws = 0; draws <= deckSize; draws++) {
      const sample = hands(deckSize, draws);
      for (let copies = 0; copies <= deckSize; copies++) {
        const counts = sample.map((hand) => hand.filter((index) => index < copies).length);
        for (let target = 0; target <= deckSize; target++) {
          const result = hypergeometricOdds({ deckSize, copies, draws, target });
          const key = `${deckSize}/${copies}/${draws}/${target}`;
          close(result.exact, counts.filter((count) => count === target).length / sample.length, key);
          close(result.lessThan, counts.filter((count) => count < target).length / sample.length, key);
          close(result.atMost, counts.filter((count) => count <= target).length / sample.length, key);
          close(result.atLeast, counts.filter((count) => count >= target).length / sample.length, key);
          close(result.greaterThan, counts.filter((count) => count > target).length / sample.length, key);
          close(result.expected, counts.reduce((sum, count) => sum + count, 0) / sample.length, key);
        }
      }
    }
  }
});

test('intersect matches enumeration for all disjoint A/B categories in small decks', () => {
  for (let deckSize = 1; deckSize <= 8; deckSize++) {
    for (let draws = 0; draws <= deckSize; draws++) {
      const sample = hands(deckSize, draws);
      for (let copiesA = 0; copiesA <= deckSize; copiesA++) {
        for (let copiesB = 0; copiesB <= deckSize - copiesA; copiesB++) {
          const expected = sample.filter((hand) => hand.some((index) => index < copiesA)
            && hand.some((index) => index >= copiesA && index < copiesA + copiesB)).length / sample.length;
          const actual = multivariateIntersectOdds({ deckSize, copiesA, copiesB, draws });
          close(actual, expected, `${deckSize}/${copiesA}/${copiesB}/${draws}`);
        }
      }
    }
  }
});

test('60-card examples match exact combinatorial hand counts', () => {
  const denominator = Number(choose(60, 7));
  const result = hypergeometricOdds({ deckSize: 60, copies: 4, draws: 7, target: 1 });
  const zero = Number(choose(56, 7)) / denominator;
  const one = Number(choose(4, 1) * choose(56, 6)) / denominator;
  close(result.exact, one);
  close(result.lessThan, zero);
  close(result.atMost, zero + one);
  close(result.atLeast, 1 - zero);
  close(result.greaterThan, 1 - zero - one);
  close(result.expected, 7 * 4 / 60);
  close(multivariateIntersectOdds({ deckSize: 60, copiesA: 4, copiesB: 4, draws: 7 }),
    Number(choose(60, 7) - 2n * choose(56, 7) + choose(52, 7)) / denominator);
});

test('zero/full draws, absent cards, impossible targets and guaranteed draws are exact', () => {
  assert.deepEqual(hypergeometricOdds({ deckSize: 99, copies: 35, draws: 0, target: 0 }),
    { exact: 1, lessThan: 0, atMost: 1, atLeast: 1, greaterThan: 0, expected: 0 });
  assert.deepEqual(hypergeometricOdds({ deckSize: 99, copies: 35, draws: 99, target: 35 }),
    { exact: 1, lessThan: 0, atMost: 1, atLeast: 1, greaterThan: 0, expected: 35 });
  assert.deepEqual(hypergeometricOdds({ deckSize: 99, copies: 0, draws: 7, target: 1 }),
    { exact: 0, lessThan: 1, atMost: 1, atLeast: 0, greaterThan: 0, expected: 0 });
  assert.equal(hypergeometricOdds({ deckSize: 99, copies: 99, draws: 7, target: 0 }).greaterThan, 1);
  assert.equal(hypergeometricOdds({ deckSize: 99, copies: 4, draws: 7, target: 8 }).atLeast, 0);
  for (const draws of [0, 1]) {
    assert.equal(multivariateIntersectOdds({ deckSize: 99, copiesA: 40, copiesB: 40, draws }), 0);
  }
  assert.equal(multivariateIntersectOdds({ deckSize: 99, copiesA: 0, copiesB: 99, draws: 99 }), 0);
  assert.equal(multivariateIntersectOdds({ deckSize: 99, copiesA: 98, copiesB: 1, draws: 99 }), 1);
  assert.equal(multivariateIntersectOdds({ deckSize: 99, copiesA: 50, copiesB: 49, draws: 51 }), 1);
});

test('large decks remain normalized, symmetric and preserve tiny probabilities', () => {
  const midpoint = hypergeometricOdds({ deckSize: MAX_DECK_SIZE, copies: 5000, draws: 5000, target: 2500 });
  close(midpoint.lessThan + midpoint.exact + midpoint.greaterThan, 1);
  close(midpoint.lessThan, midpoint.greaterThan);
  assert.equal(midpoint.expected, 2500);
  const rare = hypergeometricOdds({ deckSize: 10000, copies: 100, draws: 100, target: 100 });
  const rareExpected = 1 / Number(choose(10000, 100));
  assert.ok(rare.exact > 0);
  assert.ok(Math.abs(rare.exact / rareExpected - 1) < 1e-12);
  assert.equal(rare.atLeast, rare.exact);
  const tinyIntersect = multivariateIntersectOdds({ deckSize: 10000, copiesA: 1, copiesB: 1, draws: 2 });
  close(tinyIntersect / (2 / (10000 * 9999)), 1);
  for (const input of [
    { deckSize: 99, copiesA: 1, copiesB: 35, draws: 7 },
    { deckSize: 10000, copiesA: 9876, copiesB: 1, draws: 123 },
    { deckSize: 10000, copiesA: 17, copiesB: 218, draws: 5555 }
  ]) {
    close(multivariateIntersectOdds(input), multivariateIntersectOdds({ ...input, copiesA: input.copiesB, copiesB: input.copiesA }));
  }
});

test('invalid numeric values fail explicitly instead of silently changing their meaning', () => {
  const hyper = { deckSize: 60, copies: 4, draws: 7, target: 1 };
  const multi = { deckSize: 60, copiesA: 4, copiesB: 4, draws: 7 };
  for (const invalid of ['', '4', null, undefined, true, NaN, Infinity, -1, 1.5, MAX_DECK_SIZE + 1]) {
    for (const key of Object.keys(hyper)) {
      assert.throws(() => hypergeometricOdds({ ...hyper, [key]: invalid }), RangeError);
    }
    for (const key of Object.keys(multi)) {
      assert.throws(() => multivariateIntersectOdds({ ...multi, [key]: invalid }), RangeError);
    }
  }
  assert.throws(() => hypergeometricOdds(), /Deckgrootte/);
  assert.throws(() => multivariateIntersectOdds(), /Deckgrootte/);
  assert.throws(() => hypergeometricOdds({ ...hyper, deckSize: 0 }), /Deckgrootte/);
  assert.throws(() => hypergeometricOdds({ ...hyper, draws: 61 }), /getrokken/);
  assert.throws(() => hypergeometricOdds({ ...hyper, copies: 61 }), /exemplaren/);
  assert.throws(() => hypergeometricOdds({ ...hyper, target: 61 }), /Gewenst/);
  assert.throws(() => multivariateIntersectOdds({ ...multi, copiesA: 40, copiesB: 40 }), /slechts één groep/);
});
