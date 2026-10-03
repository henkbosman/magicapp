import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cardTextHtml } from '../public/js/components.js';

test('kaarttekst markeert alle letterlijke zoekmatches zonder hoofdletteronderscheid', () => {
  const html = cardTextHtml('Create a 2/2 token. Then CREATE A 2/2 token.', [], { highlight: 'create a 2/2' });
  assert.equal(html, '<mark class="oracle-search-match">Create a 2/2</mark> token. Then <mark class="oracle-search-match">CREATE A 2/2</mark> token.');
  assert.equal(cardTextHtml('Nothing to mark.', [], { highlight: '   ' }), 'Nothing to mark.');
  assert.equal(cardTextHtml('Nothing to mark.', [], { highlight: 'xyz' }), 'Nothing to mark.');
});

test('zoekmarkering overlapt bestaande keywordmarkering zonder de ability uit te breiden', () => {
  const html = cardTextHtml('Landfall — Create a token.', ['Landfall'], { highlight: 'fall — Create' });
  assert.equal(html, '<mark class="oracle-keyword">Land<mark class="oracle-search-match">fall</mark></mark><mark class="oracle-search-match"> — Create</mark> a token.');
});

test('zoekmarkering behoudt symbolen, remindertekst en regeleinden', () => {
  const html = cardTextHtml('Flying (Flying is reminder text.)\r\n{T}: Add {C}.', ['Flying'], { highlight: '{T}: Add {C}' });
  assert.match(html, /^<mark class="oracle-keyword">Flying<\/mark> \(Flying is reminder text\.\)<br>/);
  assert.equal((html.match(/class="oracle-search-match"/g) || []).length, 3);
  assert.match(html, /aria-label="Tappen"/);
  assert.match(html, /aria-label="Kleurloos mana"/);
  const reminder = cardTextHtml('Flying (Flying is reminder text.)', ['Flying'], { highlight: '(Flying' });
  assert.match(reminder, /<mark class="oracle-search-match">\(<\/mark><mark class="oracle-search-match">Flying<\/mark>/);
  assert.equal((reminder.match(/class="oracle-keyword"/g) || []).length, 1);
});

test('zoektekst wordt als tekst behandeld, met veilige HTML en letterlijke regextekens', () => {
  const html = cardTextHtml('<img src=x onerror=alert(1)> & +1/+1 [x].', [], { highlight: '<img src=x onerror=alert(1)>' });
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /&lt;img src=x onerror=alert/);
  assert.match(cardTextHtml('+1/+1 [x].', [], { highlight: '+1/+1 [x].' }), /^<mark class="oracle-search-match">\+1\/\+1 \[x\]\.<\/mark>$/);
  assert.doesNotMatch(cardTextHtml('{G}', [], { highlight: 'mana-symbol' }), /oracle-search-match/);
});
