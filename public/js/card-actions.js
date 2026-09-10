import { api, queryString } from './api.js';
import { isBasicLand } from './card-rules.js';
import {
  defaultLanguage,
  findPrintingForCard,
  finishOptions,
  languageOptions,
  variantForLanguage
} from './printing-utils.js';
import { escapeHtml, formValue, openDialog, parseTags, refreshView, toast } from './utils.js';

function fallbackPrinting(card) {
  return {
    printingKey: `${String(card.setCode || '').toLowerCase()}|${String(card.collectorNumber || '')}`,
    cardId: card.id || null,
    scryfallId: card.scryfallId,
    name: card.name,
    setName: card.setName,
    setCode: card.setCode,
    collectorNumber: card.collectorNumber,
    rarity: card.rarity,
    releasedAt: card.releasedAt,
    language: card.language || 'en',
    languages: [card.language || 'en'],
    finishes: card.finishes?.length ? card.finishes : ['nonfoil'],
    variants: [{
      language: card.language || 'en',
      cardId: card.id || null,
      scryfallId: card.scryfallId,
      finishes: card.finishes?.length ? card.finishes : ['nonfoil'],
      image: card.images?.small || card.images?.normal || null,
      cached: Boolean(card.id)
    }],
    cached: Boolean(card.id)
  };
}

async function printingForCard(card) {
  try {
    const response = await api(`/cards/printings${queryString({ name: card.name })}`);
    return findPrintingForCard(response.data || response, card) || fallbackPrinting(card);
  } catch {
    // The locally cached printing is enough to keep collection changes usable offline.
    return fallbackPrinting(card);
  }
}

export async function addCardToCollection(card, { onDone = refreshView, sourceWantedId = null } = {}) {
  const printing = await printingForCard(card);
  const language = defaultLanguage(printing, card);
  const variant = variantForLanguage(printing, language, card);
  const defaultFinish = variant?.finishes?.includes('nonfoil') ? 'nonfoil' : variant?.finishes?.[0];

  const dialog = openDialog({
    title: `${card.name} aan collectie toevoegen`,
    submitLabel: 'Toevoegen',
    content: `<div class="form-grid">
      <div class="field"><label>Aantal</label><input name="quantity" type="number" min="1" value="1" required></div>
      <div class="field"><label>Taal</label><select name="language">${languageOptions(printing, language, card)}</select></div>
      <div class="field"><label>Afwerking</label><select name="finish">${finishOptions(variant?.finishes, defaultFinish)}</select></div>
      <div class="field"><label>Conditie</label><select name="condition"><option value="near_mint">Near mint</option><option value="mint">Mint</option><option value="excellent">Excellent</option><option value="good">Good</option><option value="light_played">Light played</option><option value="played">Played</option><option value="poor">Poor</option></select></div>
      <div class="field"><label>Locatie</label><input name="location" placeholder="Map, doos of lade"></div>
      <div class="field"><label>Aankoopprijs (€)</label><input name="purchasePrice" type="number" min="0" step="0.01"></div>
      <div class="field full"><label>Opmerkingen</label><textarea name="notes"></textarea></div>
      <label class="checkbox-field full"><input type="checkbox" name="reconcileWanted" checked> Wanted-aantal automatisch verminderen</label>
    </div>`,
    onSubmit: async (data) => {
      const selectedLanguage = formValue(data, 'language', language);
      const selectedVariant = variantForLanguage(printing, selectedLanguage, card);
      const identifier = selectedVariant?.cardId
        ? { cardId: Number(selectedVariant.cardId) }
        : selectedVariant?.scryfallId
          ? { scryfallId: selectedVariant.scryfallId }
          : { cardId: card.id };

      const addedItem = await api('/collection', { method: 'POST', body: {
        ...identifier,
        quantity: Number(formValue(data, 'quantity', '1')),
        finish: formValue(data, 'finish', 'nonfoil'),
        language: selectedLanguage,
        condition: formValue(data, 'condition', 'near_mint'),
        location: formValue(data, 'location'),
        purchasePrice: formValue(data, 'purchasePrice') || null,
        notes: formValue(data, 'notes'),
        reconcileWanted: data.has('reconcileWanted'),
        sourceWantedId: sourceWantedId || null
      }});
      const aligned = Number(addedItem.deckPrintingAlignment?.updatedDeckCards || 0);
      toast(aligned
        ? `${card.name} is toegevoegd; ${aligned} deckkaart${aligned === 1 ? '' : 'en'} gebruikt nu deze printing.`
        : `${card.name} is aan je collectie toegevoegd.`);
      await onDone?.();
      return true;
    }
  });

  const languageSelect = dialog.querySelector('[name="language"]');
  const finishSelect = dialog.querySelector('[name="finish"]');
  languageSelect?.addEventListener('change', () => {
    const selectedVariant = variantForLanguage(printing, languageSelect.value, card);
    finishSelect.innerHTML = finishOptions(selectedVariant?.finishes, finishSelect.value);
  });
  return dialog;
}

export function addCardToWanted(card, { onDone = refreshView, quantity = 1, notes = '', deckId = null, deckIds = [] } = {}) {
  if (isBasicLand(card)) {
    toast('Basic lands worden als standaard beschikbaar beschouwd en komen niet op de wanted-list.', 'warning');
    return null;
  }

  return openDialog({
    title: `${card.name} op Wanted zetten`,
    submitLabel: 'Toevoegen',
    content: `<div class="form-grid">
      <div class="field"><label>Gewenst aantal</label><input name="quantity" type="number" min="1" value="${Math.max(Number(quantity || 1), 1)}" required></div>
      <div class="field"><label>Prioriteit</label><select name="priority"><option value="1">1 · Hoogst</option><option value="2">2 · Hoog</option><option value="3" selected>3 · Normaal</option><option value="4">4 · Laag</option><option value="5">5 · Laagst</option></select></div>
      <div class="field"><label>Maximumprijs (€)</label><input name="maximumPrice" type="number" min="0" step="0.01"></div>
      <div class="field full"><label>Opmerkingen</label><textarea name="notes">${escapeHtml(notes)}</textarea></div>
    </div>`,
    onSubmit: async (data) => {
      const wantedItem = await api('/wanted', { method: 'POST', body: {
        cardId: card.id,
        quantity: Number(formValue(data, 'quantity', '1')),
        priority: Number(formValue(data, 'priority', '3')),
        maximumPrice: formValue(data, 'maximumPrice') || null,
        notes: formValue(data, 'notes'),
        deckIds: [...new Set([...(Array.isArray(deckIds) ? deckIds : []), deckId].filter(Boolean).map(Number))]
      }});
      toast(wantedItem.printingSelected
        ? `${card.name} staat op je wanted-list; de enige beschikbare printing is automatisch gekozen.`
        : `${card.name} staat op je wanted-list.`);
      await onDone?.();
      return true;
    }
  });
}

export async function addCardToDeck(card, { deckId = null, onDone = refreshView } = {}) {
  const decks = await api('/decks');
  if (!decks.length) {
    toast('Maak eerst een deck aan.', 'warning');
    window.location.hash = '#/decks';
    return null;
  }
  const basicLand = isBasicLand(card);
  return openDialog({
    title: `${card.name} aan deck toevoegen`,
    submitLabel: 'Toevoegen',
    content: `<div class="form-grid">
      <div class="field full"><label>Deck</label><select name="deckId">${decks.map((deck) => `<option value="${deck.id}" ${Number(deckId) === deck.id ? 'selected' : ''}>${escapeHtml(deck.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Aantal</label><input name="quantity" type="number" min="1" value="1"></div>
      <div class="field"><label>Rol</label><select name="role"><option value="main">Main deck</option><option value="commander">Commander</option><option value="partner">Tweede commander</option><option value="companion">Companion</option><option value="sideboard">Sideboard</option><option value="maybeboard">Maybeboard</option></select></div>
      <div class="field full"><label>Functionele tags</label><input name="tags" placeholder="Ramp, Draw, Protection"></div>
      <div class="field full"><label>Notitie</label><textarea name="note"></textarea></div>
      ${basicLand
        ? '<p class="form-note full">Basic lands worden automatisch als beschikbaar behandeld en niet aan Wanted toegevoegd.</p>'
        : '<label class="checkbox-field full"><input name="addMissingWanted" type="checkbox" checked> Ontbrekende exemplaren ook aan Wanted toevoegen</label>'}
    </div>`,
    onSubmit: async (data) => {
      const selectedDeckId = Number(formValue(data, 'deckId'));
      const requestedQuantity = Number(formValue(data, 'quantity', '1'));
      const role = formValue(data, 'role', 'main');
      const added = await api(`/decks/${selectedDeckId}/cards`, { method: 'POST', body: {
        cardId: card.id,
        quantity: requestedQuantity,
        role,
        tags: parseTags(formValue(data, 'tags')),
        note: formValue(data, 'note')
      }});
      let wantedWarning = '';
      if (!basicLand && data.has('addMissingWanted')) {
        const effectiveAdded = ['commander', 'partner', 'companion'].includes(role) ? 1 : requestedQuantity;
        const wantedGap = Math.max((added.card?.usage?.shortage || 0) - (added.card?.usage?.wanted || 0), 0);
        const quantityForWanted = Math.min(effectiveAdded, wantedGap);
        if (quantityForWanted > 0) {
          try {
            await api('/wanted', { method: 'POST', body: {
              cardId: card.id,
              quantity: quantityForWanted,
              priority: 3,
              maximumPrice: null,
              notes: `Ontbreekt voor deck: ${decks.find((deck) => deck.id === selectedDeckId)?.name || ''}`,
              deckId: selectedDeckId
            }});
          } catch (error) {
            wantedWarning = ` Wanted bijwerken mislukte: ${error.message}`;
          }
        }
      }
      toast(`${card.name} is aan het deck toegevoegd.${wantedWarning}`, wantedWarning ? 'warning' : 'success');
      await onDone?.();
      return true;
    }
  });
}
