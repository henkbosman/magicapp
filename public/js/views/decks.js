import { api } from '../api.js';
import { cardImage, pageHeader } from '../components.js';
import { emptyState, escapeHtml, formValue, openDialog, refreshView, toast } from '../utils.js';

export async function renderDecks() {
  const decks = await api('/decks');
  const content = decks.length ? `<section class="deck-grid">${decks.map((deck) => `
    <a class="deck-card" href="#/decks/${deck.id}">
      <div class="deck-card-top">
        ${deck.commander ? cardImage(deck.commander, { className: 'commander-thumb' }) : '<div class="card-image-placeholder commander-thumb"><span>?</span></div>'}
        <div><span class="format-pill">${escapeHtml(deck.format)}</span><h2>${escapeHtml(deck.name)}</h2><small>${deck.commander ? escapeHtml(deck.commander.name) : 'Commander nog niet ingesteld'}</small></div>
      </div>
      ${deck.description ? `<p>${escapeHtml(deck.description)}</p>` : ''}
      <div class="deck-card-stats">
        <div class="deck-card-stat"><strong>${deck.totalCards}</strong><small>kaarten</small></div>
        <div class="deck-card-stat"><strong>${deck.missingQuantity}</strong><small>niet in collectie</small></div>
        <div class="deck-card-stat"><strong>${deck.globalShortage}</strong><small>missende kaarten</small></div>
      </div>
    </a>`).join('')}</section>` : emptyState('Nog geen decks', 'Maak een deck aan en voeg zowel kaarten uit je collectie als ontbrekende kaarten toe.', '<button id="empty-create-deck" class="button primary" data-write-action>Eerste deck maken</button>');

  const createDeck = () => openDialog({
    title: 'Nieuw deck',
    submitLabel: 'Deck maken',
    content: `<div class="form-grid">
      <div class="field full"><label>Naam</label><input name="name" required maxlength="200" placeholder="Bijvoorbeeld Yedora, Grave Gardener"></div>
      <div class="field"><label>Formaat</label><select name="format"><option value="commander">Commander</option><option value="standard">Standard</option><option value="pioneer">Pioneer</option><option value="modern">Modern</option><option value="legacy">Legacy</option><option value="pauper">Pauper</option><option value="other">Anders</option></select></div>
      <div class="field full"><label>Beschrijving</label><textarea name="description" placeholder="Strategie en doel van het deck"></textarea></div>
      <div class="field full"><label>Notities</label><textarea name="notes"></textarea></div>
    </div>`,
    onSubmit: async (data) => {
      const deck = await api('/decks', { method: 'POST', body: {
        name: formValue(data,'name'), format: formValue(data,'format'),
        description: formValue(data,'description'), notes: formValue(data,'notes')
      }});
      toast(`Deck ${deck.name} is aangemaakt.`);
      window.location.hash = `#/decks/${deck.id}`;
      return true;
    }
  });

  return {
    html: `${pageHeader({ eyebrow: 'Deckbouw', title: 'Decks', actions: '<button id="create-deck" class="button primary" data-write-action>＋ Nieuw deck</button>' })}${content}`,
    mount() {
      document.getElementById('create-deck')?.addEventListener('click', createDeck);
      document.getElementById('empty-create-deck')?.addEventListener('click', createDeck);
    }
  };
}
