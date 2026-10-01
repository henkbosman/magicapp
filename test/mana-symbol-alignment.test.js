import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { cardTextHtml } from '../public/js/components.js';

test('alle symbolen in kaarttekst gebruiken dezelfde leesbare grootte en baseline', () => {
  const pathText = cardTextHtml('{2}{W}{U}{B}{R}{G}, {T}, Sacrifice Path to the World Tree.');
  const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(pathText, /class="mana-symbol mana-bg-generic"[^>]*aria-label="2 generieke mana"/);
  assert.match(pathText, /class="mana-symbol mana-bg-W"/);
  assert.match(styles, /\.oracle-text \.mana-symbol\s*\{[^}]*display:\s*inline-block;[^}]*width:\s*1\.2em;[^}]*height:\s*1\.2em;[^}]*vertical-align:\s*-\.2em;/s);
  assert.doesNotMatch(styles, /\.oracle-text \.mana-symbol\.mana-bg-(?:C|generic)\s*\{/);
  assert.match(styles, /\.oracle-text \.mana-symbol-text\s*\{\s*font-size:\s*\.68em;/);
});

test('kaarttekst markeert elke ability afzonderlijk en bewaart lege regels en escaping', () => {
  const html = cardTextHtml('{T}: Add {G}.\r\n\r\nPay {2}: <strong>Draw</strong>.');

  assert.equal((html.match(/class="oracle-ability-block"/g) || []).length, 2);
  assert.equal((html.match(/class="oracle-text-gap"/g) || []).length, 1);
  assert.match(html, /<p class="oracle-ability-block">[\s\S]*aria-label="Tappen"[\s\S]*aria-label="Groen mana"[\s\S]*<\/p>/);
  assert.match(html, /<p class="oracle-ability-block">Pay [\s\S]*aria-label="2 generieke mana"[\s\S]*&lt;strong&gt;Draw&lt;\/strong&gt;\.<\/p>/);
  assert.doesNotMatch(html, /<strong>Draw<\/strong>/);
});

test('kaarttekst in collectie- en decklijsten blijft op een leesbare grootte', () => {
  const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(styles, /\.deck-card-rules-text\s*\{[^}]*color:\s*var\(--ink\);[^}]*font-size:\s*\.9rem;/s);
  assert.match(styles, /\.collection-card-rules-text\s*\{[^}]*color:\s*var\(--ink\);[^}]*font-size:\s*\.9rem;/s);
  assert.match(styles, /\.oracle-text\s*\{[^}]*gap:\s*\.2em;/s);
  assert.match(styles, /\.oracle-ability-block\s*\{[^}]*padding:\s*\.22em \.45em;[^}]*border-left:\s*3px solid var\(--primary\);[^}]*background:\s*var\(--primary-soft\);/s);
});
