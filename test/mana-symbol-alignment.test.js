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

test('kaarttekst markeert alleen het exacte keyword en behoudt manasymbolen en lege regels', () => {
  const html = cardTextHtml('Morph {2}{G} (You may cast this face down using morph.)\r\n\r\nMegamorph is andere tekst.', ['Morph']);

  assert.equal((html.match(/class="oracle-keyword"/g) || []).length, 1);
  assert.match(html, /^<mark class="oracle-keyword">Morph<\/mark>/);
  assert.match(html, /aria-label="2 generieke mana"/);
  assert.match(html, /aria-label="Groen mana"/);
  assert.match(html, /\(You may cast this face down using morph\.\)/);
  assert.match(html, /<br><br>Megamorph is andere tekst\.$/);
  assert.doesNotMatch(html, /oracle-ability-block|oracle-text-gap/);
});

test('keywords in remindertekst worden niet gemarkeerd', () => {
  const html = cardTextHtml('Flying (This creature can only be blocked by creatures with\nflying or reach.)', ['Flying']);

  assert.equal((html.match(/class="oracle-keyword"/g) || []).length, 1);
  assert.match(html, /^<mark class="oracle-keyword">Flying<\/mark> \(This creature can only be blocked by creatures with<br>flying or reach\.\)$/);
});

test('multiword-keywords zijn case-insensitive en krijgen voorrang boven deelkeywords', () => {
  const html = cardTextHtml('DOUBLE STRIKE, then strike again.', ['Strike', 'Double strike']);

  assert.match(html, /^<mark class="oracle-keyword">DOUBLE STRIKE<\/mark>, then <mark class="oracle-keyword">strike<\/mark> again\.$/);
  assert.equal((html.match(/class="oracle-keyword"/g) || []).length, 2);
});

test('keywordmarkering blijft HTML escapen', () => {
  const html = cardTextHtml('<img src=x> Morph & "test" {UNKNOWN}', ['Morph']);

  assert.match(html, /^&lt;img src=x&gt; <mark class="oracle-keyword">Morph<\/mark> &amp; &quot;test&quot; \{UNKNOWN\}$/);
  assert.doesNotMatch(html, /<img|<script/);
});

test('kaarttekst in collectie- en decklijsten blijft op een leesbare grootte', () => {
  const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(styles, /\.deck-card-rules-text\s*\{[^}]*color:\s*var\(--ink\);[^}]*font-size:\s*\.9rem;/s);
  assert.match(styles, /\.collection-card-rules-text\s*\{[^}]*color:\s*var\(--ink\);[^}]*font-size:\s*\.9rem;/s);
  assert.match(styles, /\.oracle-keyword\s*\{[^}]*background:\s*var\(--primary-soft\);[^}]*font-weight:\s*750;/s);
  assert.doesNotMatch(styles, /\.oracle-(?:ability-block|text-gap)\b/);
});
