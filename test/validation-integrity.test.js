import assert from 'node:assert/strict';
import { test } from 'node:test';
import { positiveInteger, optionalNumber } from '../src/lib/validation.js';

test('lege aantallen worden nooit nul en kunnen dus geen verwijdering veroorzaken', () => {
  for (const value of ['', '   ', [], ['0'], {}, null, undefined, false]) {
    assert.throws(() => positiveInteger(value, 'Aantal', { allowZero: true }), (error) => error.status === 400);
  }
  assert.equal(positiveInteger(0, 'Aantal', { allowZero: true }), 0);
  assert.equal(positiveInteger('0', 'Aantal', { allowZero: true }), 0);
  assert.equal(positiveInteger(' 12 ', 'Aantal'), 12);
});

test('aantallen en IDs die JavaScript niet exact kan bewaren worden geweigerd', () => {
  for (const value of [Number.MAX_SAFE_INTEGER + 1, '9007199254740993', Infinity, NaN, 1.5, '-1']) {
    assert.throws(() => positiveInteger(value, 'Aantal'), (error) => error.status === 400);
  }
  assert.equal(positiveInteger(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
});

test('prijsinvoer accepteert alleen echte getallen of lege optionele waarden', () => {
  for (const value of [true, false, [], [3], {}, '   ', 'onbekend', Infinity]) {
    assert.throws(() => optionalNumber(value, 'Prijs'), (error) => error.status === 400);
  }
  for (const value of [undefined, null, '']) assert.equal(optionalNumber(value, 'Prijs'), null);
  assert.equal(optionalNumber('0', 'Prijs'), 0);
  assert.equal(optionalNumber(' 1.25 ', 'Prijs'), 1.25);
});
