import { api, queryString } from '../api.js';
import { addCardToDeck, addCardToWanted } from '../card-actions.js';
import { isBasicLand } from '../card-rules.js';
import { cachedCardImageUrl, cardImage, manaCost, pageHeader, usageBadges } from '../components.js';
import {
  defaultLanguage,
  finishOptions,
  languageOptions,
  variantForLanguage
} from '../printing-utils.js';
import { debounce, emptyState, escapeHtml, formValue, toast } from '../utils.js';

function printingHtml(printing, index) {
  return `<button type="button" class="printing-card" data-printing-index="${index}">
    ${printing.image ? `<img src="${escapeHtml(cachedCardImageUrl(printing.image))}" alt="" loading="lazy">` : `<span class="card-image-placeholder"><span>${escapeHtml(printing.name.slice(0, 1))}</span></span>`}
    <span>
      <strong>${escapeHtml(printing.setName)}</strong>
      <small>${escapeHtml(printing.setCode.toUpperCase())} #${escapeHtml(printing.collectorNumber)} · ${escapeHtml(printing.rarity)}${printing.releasedAt ? ` · ${escapeHtml(printing.releasedAt)}` : ''}</small>
      ${printing.cached ? '<small>Lokaal opgeslagen</small>' : ''}
    </span>
  </button>`;
}

function selectedPanel(card, printing) {
  if (!card || !printing) return emptyState('Nog geen printing gekozen', 'Zoek een kaartnaam en kies daarna de fysieke printing die je bezit.');
  const language = defaultLanguage(printing, card);
  const variant = variantForLanguage(printing, language, card);
  return `<div class="panel selected-printing">
    <div class="panel-body">
      <div class="selected-card-preview">
        <a class="selected-printing-detail-link" data-card-detail-link href="#/cards/${Number(card.id)}" title="Open kaartdetails">
          ${cardImage(card, { className: 'preview-image' })}
        </a>
        <div>
          <div class="card-title-row"><h2><a data-card-detail-link href="#/cards/${Number(card.id)}">${escapeHtml(card.name)}</a></h2>${manaCost(card.manaCost)}</div>
          <p class="card-meta">${escapeHtml(card.typeLine)}</p>
          <p><strong>${escapeHtml(printing.setName)}</strong><br><small>${escapeHtml(printing.setCode.toUpperCase())} #${escapeHtml(printing.collectorNumber)} · ${escapeHtml(printing.rarity)}</small></p>
          ${usageBadges(card.usage)}
        </div>
      </div>
      <div data-write-only>
      <hr class="soft-divider">
      <form id="add-collection-form">
        <div class="form-grid">
          <div class="field"><label>Aantal</label><input name="quantity" type="number" min="1" value="1" required></div>
          <div class="field"><label>Taal</label><select name="language">${languageOptions(printing, language, card)}</select></div>
          <div class="field"><label>Afwerking</label><select name="finish">${finishOptions(variant?.finishes, 'nonfoil')}</select></div>
          <div class="field"><label>Conditie</label><select name="condition"><option value="near_mint">Near mint</option><option value="mint">Mint</option><option value="excellent">Excellent</option><option value="good">Good</option><option value="light_played">Light played</option><option value="played">Played</option><option value="poor">Poor</option></select></div>
          <div class="field"><label>Locatie</label><input name="location" placeholder="Map, doos of lade"></div>
          <div class="field"><label>Aankoopprijs (€)</label><input name="purchasePrice" type="number" min="0" step="0.01"></div>
          <div class="field full"><label>Opmerkingen</label><textarea class="add-card-notes" name="notes" rows="2"></textarea></div>
          <label class="checkbox-field full"><input name="reconcileWanted" type="checkbox" checked> Wanted-aantal automatisch verminderen</label>
        </div>
        <div class="add-card-actions">
          <button class="button primary add-card-primary-action" type="submit" data-write-action>＋ Aan collectie toevoegen</button>
          <div class="add-card-secondary-actions">${isBasicLand(card) ? '' : '<button type="button" id="selected-to-wanted" class="button secondary" data-write-action>☆ Naar Wanted</button>'}<button type="button" id="selected-to-deck" class="button secondary" data-write-action>▤ Naar deck</button></div>
        </div>
      </form>
      </div>
    </div>
  </div>`;
}

export async function renderAddCard(context) {
  const initialQuery = context.query.get('q') || '';
  const initialName = context.query.get('name') || '';
  const initialPrinting = context.query.get('printing') || '';
  let selectedCard = null;
  let selectedPrinting = null;
  let loadedPrintings = [];

  return {
    html: `
      ${pageHeader({ eyebrow: 'Snelle invoer', title: 'Kaart toevoegen', description: 'Zoek op naam, kies de juiste set en selecteer daarna taal en afwerking.' })}
      <section class="add-layout">
        <div>
          <div class="search-hero">
            <h2>Welke kaart wil je registreren?</h2>
            <p>Scryfall wordt alleen gebruikt voor zoeken en kaartmetadata; gekozen kaarten worden lokaal opgeslagen.</p>
            <div class="field autocomplete-wrap">
              <label class="sr-only" for="add-card-search">Kaartnaam</label>
              <input id="add-card-search" type="search" autocomplete="off" placeholder="Typ minimaal twee letters…" value="${escapeHtml(initialName || initialQuery)}">
              <div id="add-suggestions" class="autocomplete-list" hidden></div>
            </div>
          </div>
          <div id="printing-status" class="picker-status">Kies een kaartnaam om beschikbare printings te tonen.</div>
          <div id="printing-list" class="printing-grid"></div>
        </div>
        <div id="selected-card-panel">${selectedPanel(null, null)}</div>
      </section>`,
    mount() {
      const search = document.getElementById('add-card-search');
      const suggestions = document.getElementById('add-suggestions');
      const status = document.getElementById('printing-status');
      const list = document.getElementById('printing-list');
      const panel = document.getElementById('selected-card-panel');

      const bindSelectedActions = () => {
        const form = document.getElementById('add-collection-form');
        if (!form || !selectedCard || !selectedPrinting) return;

        const languageSelect = form.querySelector('[name="language"]');
        const finishSelect = form.querySelector('[name="finish"]');
        languageSelect?.addEventListener('change', () => {
          const variant = variantForLanguage(selectedPrinting, languageSelect.value, selectedCard);
          finishSelect.innerHTML = finishOptions(variant?.finishes, finishSelect.value);
          const image = panel.querySelector('.preview-image');
          if (image && variant?.image) image.src = cachedCardImageUrl(variant.image);
        });

        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const button = form.querySelector('[type="submit"]');
          button.disabled = true;
          button.textContent = 'Toevoegen…';
          try {
            const data = new FormData(form);
            const language = formValue(data, 'language', 'en');
            const variant = variantForLanguage(selectedPrinting, language, selectedCard);
            const identifier = variant?.cardId
              ? { cardId: Number(variant.cardId) }
              : variant?.scryfallId
                ? { scryfallId: variant.scryfallId }
                : { setCode: selectedPrinting.setCode, collectorNumber: selectedPrinting.collectorNumber, language };
            const added = await api('/collection', { method: 'POST', body: {
              ...identifier,
              quantity: Number(formValue(data, 'quantity', '1')),
              finish: formValue(data, 'finish', 'nonfoil'),
              language,
              condition: formValue(data, 'condition', 'near_mint'),
              location: formValue(data, 'location'),
              purchasePrice: formValue(data, 'purchasePrice') || null,
              notes: formValue(data, 'notes'),
              reconcileWanted: data.has('reconcileWanted')
            }});
            selectedCard = added.card || selectedCard;
            panel.innerHTML = selectedPanel(selectedCard, selectedPrinting);
            bindSelectedActions();
            toast(`${selectedCard.name} is toegevoegd. Je kunt direct nog een exemplaar of een andere kaart registreren.`);
            document.getElementById('add-collection-form')?.querySelector('[name="quantity"]')?.select();
          } catch (error) {
            toast(error.message, 'error');
          } finally {
            if (document.body.contains(button)) {
              button.disabled = false;
              button.textContent = '＋ Aan collectie toevoegen';
            }
          }
        });
        document.getElementById('selected-to-wanted')?.addEventListener('click', () => addCardToWanted(selectedCard, { onDone: async () => {
          selectedCard = await api(`/cards/${selectedCard.id}`);
          panel.innerHTML = selectedPanel(selectedCard, selectedPrinting);
          bindSelectedActions();
        }}));
        document.getElementById('selected-to-deck')?.addEventListener('click', () => addCardToDeck(selectedCard, { onDone: async () => {
          selectedCard = await api(`/cards/${selectedCard.id}`);
          panel.innerHTML = selectedPanel(selectedCard, selectedPrinting);
          bindSelectedActions();
        }}));
      };

      const updateAddRoute = ({ name = search.value.trim(), printing = '' } = {}) => {
        const params = new URLSearchParams();
        if (name) params.set('name', name);
        if (printing) params.set('printing', printing);
        const nextHash = `#/add${params.toString() ? `?${params.toString()}` : ''}`;
        window.history.replaceState(null, '', nextHash);
      };

      const choosePrinting = async (button, { updateRoute = true } = {}) => {
        const index = Number(button.dataset.printingIndex);
        selectedPrinting = loadedPrintings[index];
        if (!selectedPrinting) return;
        list.querySelectorAll('.printing-card').forEach((item) => {
          item.disabled = true;
          item.classList.toggle('selected', item === button);
        });
        if (updateRoute) updateAddRoute({ name: search.value.trim(), printing: selectedPrinting.scryfallId });
        panel.innerHTML = '<div class="panel"><div class="page-loading"><span class="spinner"></span><p>Printinginformatie laden…</p></div></div>';
        try {
          selectedCard = await api(`/cards/preview/${encodeURIComponent(selectedPrinting.scryfallId)}`);
          panel.innerHTML = selectedPanel(selectedCard, selectedPrinting);
          bindSelectedActions();
        } catch (error) {
          toast(error.message, 'error');
          selectedPrinting = null;
          list.querySelectorAll('.printing-card').forEach((item) => item.classList.remove('selected'));
          panel.innerHTML = selectedPanel(null, null);
          if (updateRoute) updateAddRoute({ name: search.value.trim() });
        } finally {
          list.querySelectorAll('button').forEach((item) => { item.disabled = false; });
        }
      };

      const loadPrintings = async (name, { restorePrinting = '' } = {}) => {
        search.value = name;
        updateAddRoute({ name, printing: restorePrinting });
        suggestions.hidden = true;
        status.hidden = false;
        status.innerHTML = '<span class="spinner"></span><p>Printings laden…</p>';
        list.innerHTML = '';
        try {
          const response = await api(`/cards/printings${queryString({ name })}`);
          loadedPrintings = response.data || response;
          status.hidden = true;
          list.innerHTML = loadedPrintings.map(printingHtml).join('');
          list.querySelectorAll('.printing-card').forEach((button) => button.addEventListener('click', () => choosePrinting(button)));
          if (restorePrinting) {
            const restoreIndex = loadedPrintings.findIndex((printing) => printing.scryfallId === restorePrinting
              || printing.variants?.some((variant) => variant.scryfallId === restorePrinting));
            const restoreButton = restoreIndex >= 0 ? list.querySelector(`[data-printing-index="${restoreIndex}"]`) : null;
            if (restoreButton) await choosePrinting(restoreButton, { updateRoute: false });
          }
        } catch (error) {
          status.hidden = false;
          status.textContent = error.message;
        }
      };

      const suggest = debounce(async () => {
        const query = search.value.trim();
        if (query.length < 2) {
          suggestions.hidden = true;
          return;
        }
        try {
          const response = await api(`/cards/autocomplete${queryString({ q: query })}`);
          const names = response.data || response;
          suggestions.innerHTML = names.map((name) => `<button type="button" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join('');
          suggestions.hidden = !names.length;
          suggestions.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => loadPrintings(button.dataset.name)));
        } catch (error) {
          suggestions.innerHTML = `<div class="picker-status">${escapeHtml(error.message)}</div>`;
          suggestions.hidden = false;
        }
      }, 220);

      search.addEventListener('input', suggest);
      search.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const first = suggestions.querySelector('button');
        if (first) first.click();
        else if (search.value.trim()) loadPrintings(search.value.trim());
      });
      if (initialName) return loadPrintings(initialName, { restorePrinting: initialPrinting });
      if (initialQuery.length >= 2) setTimeout(suggest, 0);
      return undefined;
    }
  };
}
