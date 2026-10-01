import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { cardTextHtml } from '../public/js/components.js';

test('generieke mana in kaarttekst gebruikt dezelfde gecorrigeerde verticale uitlijning als kleurloos mana', () => {
  const pathText = cardTextHtml('{2}{W}{U}{B}{R}{G}, {T}, Sacrifice Path to the World Tree.');
  const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(pathText, /class="mana-symbol mana-bg-generic"[^>]*aria-label="2 generieke mana"/);
  assert.match(pathText, /class="mana-symbol mana-bg-W"/);
  assert.match(styles, /\.oracle-text \.mana-symbol\.mana-bg-C\s*\{\s*vertical-align:\s*-\.1em;\s*\}/);
  assert.match(styles, /\.oracle-text \.mana-symbol\.mana-bg-generic\s*\{\s*vertical-align:\s*-\.1em;\s*\}/);
});
