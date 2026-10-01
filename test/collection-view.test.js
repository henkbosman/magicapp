import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  collectionCardActionDescriptors,
  collectionCardActionMenuHtml,
  renderCollectionRows
} from '../public/js/views/collection.js';

function collectionItem() {
  return {
    id: 41,
    quantity: 3,
    finish: 'nonfoil',
    language: 'en',
    condition: 'near_mint',
    location: 'Map 1',
    purchasePrice: null,
    notes: '',
    card: {
      id: 7,
      name: 'Mana Elf',
      manaCost: '{1}{G}',
      printedText: '',
      oracleText: 'Flying\n{T}: Add {C}.',
      keywords: ['Flying'],
      setName: 'Test Set',
      setCode: 'tst',
      collectorNumber: '12',
      rarity: 'rare',
      images: {
        small: 'https://example.invalid/small.jpg',
        normal: 'https://example.invalid/normal.jpg'
      },
      prices: { eur: '1.25' },
      usage: { owned: 3, needed: 1, free: 2, shortage: 0, wanted: 0 },
      insights: {
        manaProduction: { entries: [{ mana: 'G', amount: 1, variable: false }] },
        librarySearch: { targets: ['land'] }
      }
    }
  };
}

test('collectielijst toont naam, mana, kaarttekst en alle collectiegegevens zonder functietags', () => {
  const html = renderCollectionRows([collectionItem()]);

  assert.match(html, /class="collection-card-name-mana"/);
  assert.match(html, /<strong class="collection-card-name">Mana Elf<\/strong>/);
  assert.doesNotMatch(html, /<(?:a|button)[^>]*class="[^"]*collection-card-name/);
  assert.match(html, /<a class="card-thumb-link card-preview-trigger"[^>]+data-card-preview-id="41"/);
  assert.match(html, /class="collection-card-mana-slot">[\s\S]*?aria-label="Manakosten \{1\}\{G\}"/);
  assert.match(html, /class="collection-card-rules-text oracle-text">[\s\S]*?aria-label="Tappen"[\s\S]*?aria-label="Kleurloos mana"/);
  assert.match(html, /<mark class="oracle-keyword">Flying<\/mark>/);
  assert.match(html, /rarity-badge rarity-rare/);
  assert.match(html, /€ 1,25/);
  assert.match(html, /<strong>3×<\/strong><small>nonfoil<\/small>/);
  assert.match(html, /class="usage-badges compact"/);
  assert.match(html, /In bezit <strong>3<\/strong>/);
  assert.doesNotMatch(html, /card-insight-badges|function-chip|Produceert|Zoekt/);
  assert.match(html, /class="button secondary small open-collection-card-actions"[^>]*data-write-action[^>]*>Acties<\/button>/);
  assert.doesNotMatch(html, /class="[^"]*(collection-to-deck|edit-card-insights|edit-item|delete-item)/);
});

test('collectie-actiemenu bundelt alle bestaande mutaties als schrijfactions', () => {
  const actions = collectionCardActionDescriptors();
  const html = collectionCardActionMenuHtml();

  assert.deepEqual(actions.map((action) => action.key), ['deck', 'edit', 'insights', 'remove']);
  assert.deepEqual(actions.map((action) => action.label), ['Naar deck', 'Bewerken', 'Kenmerken', 'Verwijderen']);
  assert.equal((html.match(/data-collection-card-action=/g) || []).length, 4);
  assert.equal((html.match(/data-write-action/g) || []).length, 4);
  assert.match(html, /data-collection-card-action="remove"[\s\S]*?Verwijderen/);
});

test('collectielijst gebruikt flexibele kaartnamen, rechts uitgelijnde mana en responsieve grid-gebieden', () => {
  const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(styles, /\.collection-card-row\s*\{[^}]*grid-template-columns:\s*92px[^;]+;[^}]*grid-template-areas:\s*"image summary text actions";/s);
  assert.match(styles, /\.collection-card-name-mana\s*\{[^}]*width:\s*100%;[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) max-content;/s);
  assert.match(styles, /\.collection-card-mana-slot\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*flex-end;/s);
  assert.match(styles, /\.collection-card-mana-slot \.mana-cost\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*justify-content:\s*flex-end;/s);
  assert.match(styles, /\.collection-card-row \.list-thumb,[\s\S]*?width:\s*92px;[\s\S]*?object-fit:\s*contain;/);
  assert.match(styles, /@media \(max-width:\s*1279px\)[\s\S]*?\.collection-card-row\s*\{[\s\S]*?"image summary"[\s\S]*?"image text"/);
  assert.match(styles, /@media \(max-width:\s*640px\)[\s\S]*?\.collection-card-row\s*\{[\s\S]*?"text text"[\s\S]*?"actions actions";/);
});
