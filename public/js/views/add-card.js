import { api, queryString } from '../api.js';
import { addCardToWanted } from '../card-actions.js';
import { isBasicLand } from '../card-rules.js';
import { cachedCardImageUrl, cardImage, manaCost, pageHeader, usageBadges } from '../components.js';
import {
  defaultLanguage,
  finishOptions,
  languageOptions,
  variantForLanguage
} from '../printing-utils.js';
import { debounce, emptyState, escapeHtml, formValue, openDialog, parseTags, toast } from '../utils.js';

const ROLE_OPTIONS = [
  ['main', 'Main deck'],
  ['commander', 'Commander'],
  ['partner', 'Tweede commander'],
  ['companion', 'Companion'],
  ['sideboard', 'Sideboard'],
  ['maybeboard', 'Maybeboard']
];

const PRICE_ROWS = [
  ['eur', 'Non-foil', 'EUR'],
  ['eur_foil', 'Foil', 'EUR'],
  ['eur_etched', 'Etched', 'EUR'],
  ['usd', 'Non-foil', 'USD'],
  ['usd_foil', 'Foil', 'USD'],
  ['usd_etched', 'Etched', 'USD'],
  ['tix', 'MTGO', 'TIX']
];

function formatPrice(value, currency) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (currency === 'TIX') return `${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 }).format(number)} tix`;
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(number);
}

function pricesHtml(prices = {}) {
  const rows = PRICE_ROWS
    .filter(([key]) => prices?.[key] !== null && prices?.[key] !== undefined && prices?.[key] !== '')
    .map(([key, label, currency]) => `<div class="printing-price-item"><span>${escapeHtml(label)} · ${escapeHtml(currency)}</span><strong>${escapeHtml(formatPrice(prices[key], currency))}</strong></div>`);
  return rows.length
    ? `<div class="printing-price-grid">${rows.join('')}</div>`
    : '<p class="muted printing-price-empty">Voor deze printing is geen prijsinformatie beschikbaar.</p>';
}

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
  const initialPrices = variant?.prices || printing.prices || card.prices || {};
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
          <div data-selected-usage>${usageBadges(card.usage)}</div>
        </div>
      </div>
      <section class="selected-printing-prices" aria-label="Prijsinformatie">
        <h3>Prijzen</h3>
        <div data-printing-prices>${pricesHtml(initialPrices)}</div>
      </section>
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
            <label class="checkbox-field full"><input name="reconcileWanted" type="checkbox" checked> Wanted-aantal automatisch verminderen</label>
          </div>
          <div class="add-card-actions">
            <button class="button primary" type="submit" data-write-action>Collectie</button>
            ${isBasicLand(card) ? '<button type="button" class="button secondary" disabled title="Basic lands komen niet op Wanted">Wanted</button>' : '<button type="button" id="selected-to-wanted" class="button secondary" data-write-action>Wanted</button>'}
            <button type="button" id="selected-to-collection-deck" class="button secondary" data-write-action>Collectie + Deck</button>
          </div>
        </form>
      </div>
    </div>
  </div>`;
}

function uniqueCollectorNumbers(printings) {
  return [...new Set((printings || []).map((printing) => String(printing.collectorNumber || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }));
}

export async function renderAddCard(context) {
  const initialQuery = context.query.get('q') || '';
  const initialName = context.query.get('name') || '';
  const initialPrinting = context.query.get('printing') || '';
  const initialCollectorNumber = context.query.get('collectorNumber') || '';
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
            <div class="add-card-search-controls">
              <div class="field autocomplete-wrap">
                <label class="sr-only" for="add-card-search">Kaartnaam</label>
                <input id="add-card-search" type="search" autocomplete="off" placeholder="Typ minimaal twee letters…" value="${escapeHtml(initialName || initialQuery)}">
                <div id="add-suggestions" class="autocomplete-list" hidden></div>
              </div>
              <div class="field add-card-number-field">
                <label class="sr-only" for="add-card-collector-number">Kaartnummer</label>
                <select id="add-card-collector-number" aria-label="Kaartnummer" disabled>
                  <option value="">Alle kaartnummers</option>
                </select>
              </div>
            </div>
          </div>
          <div id="printing-status" class="picker-status">Kies een kaartnaam om beschikbare printings te tonen.</div>
          <div id="printing-list" class="printing-grid"></div>
        </div>
        <div id="selected-card-panel">${selectedPanel(null, null)}</div>
      </section>`,
    mount() {
      const search = document.getElementById('add-card-search');
      const collectorSelect = document.getElementById('add-card-collector-number');
      const suggestions = document.getElementById('add-suggestions');
      const status = document.getElementById('printing-status');
      const list = document.getElementById('printing-list');
      const panel = document.getElementById('selected-card-panel');

      const updateAddRoute = ({
        name = search.value.trim(),
        printing = selectedPrinting?.scryfallId || '',
        collectorNumber = collectorSelect.value
      } = {}) => {
        const params = new URLSearchParams();
        if (name) params.set('name', name);
        if (collectorNumber) params.set('collectorNumber', collectorNumber);
        if (printing) params.set('printing', printing);
        const nextHash = `#/add${params.toString() ? `?${params.toString()}` : ''}`;
        window.history.replaceState(null, '', nextHash);
      };

      const currentCollectionPayload = (form) => {
        const data = new FormData(form);
        const language = formValue(data, 'language', 'en');
        const variant = variantForLanguage(selectedPrinting, language, selectedCard);
        const identifier = variant?.cardId
          ? { cardId: Number(variant.cardId) }
          : variant?.scryfallId
            ? { scryfallId: variant.scryfallId }
            : { setCode: selectedPrinting.setCode, collectorNumber: selectedPrinting.collectorNumber, language };
        return {
          ...identifier,
          quantity: Number(formValue(data, 'quantity', '1')),
          finish: formValue(data, 'finish', 'nonfoil'),
          language,
          condition: formValue(data, 'condition', 'near_mint'),
          location: formValue(data, 'location'),
          purchasePrice: formValue(data, 'purchasePrice') || null,
          notes: '',
          reconcileWanted: data.has('reconcileWanted')
        };
      };

      const refreshSelectedUsage = async (knownCard = null) => {
        if (knownCard) selectedCard = knownCard;
        else if (selectedCard?.id) selectedCard = await api(`/cards/${selectedCard.id}`);
        if (!selectedCard) return;
        const usage = panel.querySelector('[data-selected-usage]');
        if (usage) usage.innerHTML = usageBadges(selectedCard.usage);
        panel.querySelectorAll('[data-card-detail-link]').forEach((link) => {
          link.setAttribute('href', `#/cards/${Number(selectedCard.id)}`);
        });
      };

      const openCollectionDeckDialog = async (form) => {
        const decks = await api('/decks');
        if (!decks.length) {
          toast('Maak eerst een deck aan.', 'warning', { position: 'top' });
          return;
        }
        const collectionPayload = currentCollectionPayload(form);
        openDialog({
          title: `${selectedCard.name} aan collectie en deck toevoegen`,
          submitLabel: 'Collectie + Deck',
          content: `<div class="form-grid">
            <div class="field full"><label>Deck</label><select name="deckId">${decks.map((deck) => `<option value="${deck.id}">${escapeHtml(deck.name)}</option>`).join('')}</select></div>
            <div class="field"><label>Aantal in deck</label><input name="deckQuantity" type="number" min="1" value="${Math.max(Number(collectionPayload.quantity || 1), 1)}" required></div>
            <div class="field"><label>Rol</label><select name="role">${ROLE_OPTIONS.map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('')}</select></div>
            <div class="field full"><label>Functionele tags</label><input name="tags" placeholder="Ramp, Draw, Protection"></div>
            <div class="field full"><label>Decknotitie</label><textarea name="note"></textarea></div>
          </div>`,
          onSubmit: async (data) => {
            const deckId = Number(formValue(data, 'deckId'));
            const result = await api('/collection/with-deck', {
              method: 'POST',
              body: {
                ...collectionPayload,
                deckId,
                deckQuantity: Number(formValue(data, 'deckQuantity', String(collectionPayload.quantity || 1))),
                role: formValue(data, 'role', 'main'),
                tags: parseTags(formValue(data, 'tags')),
                note: formValue(data, 'note')
              }
            });
            await refreshSelectedUsage(result.collectionItem?.card || null);
            const deckName = decks.find((deck) => deck.id === deckId)?.name || 'het deck';
            toast(`${selectedCard.name} is toegevoegd aan je collectie en aan ${deckName}.`, 'success', { position: 'top' });
            return true;
          }
        });
      };

      const scrollActionsIntoView = () => {
        const actions = panel.querySelector('.add-card-actions');
        if (!actions || actions.offsetParent === null) return;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const rect = actions.getBoundingClientRect();
          const topBoundary = 88;
          const bottomBoundary = window.innerHeight - 18;
          if (rect.top < topBoundary || rect.bottom > bottomBoundary) {
            actions.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }));
      };

      const bindSelectedActions = () => {
        const form = document.getElementById('add-collection-form');
        if (!form || !selectedCard || !selectedPrinting) return;

        const languageSelect = form.querySelector('[name="language"]');
        const finishSelect = form.querySelector('[name="finish"]');
        let languagePreviewSequence = 0;
        languageSelect?.addEventListener('change', async () => {
          const selectedLanguage = languageSelect.value;
          const variant = variantForLanguage(selectedPrinting, selectedLanguage, selectedCard);
          finishSelect.innerHTML = finishOptions(variant?.finishes, finishSelect.value);
          const image = panel.querySelector('.preview-image');
          if (image && variant?.image) image.src = cachedCardImageUrl(variant.image);
          const priceContainer = panel.querySelector('[data-printing-prices]');
          if (priceContainer) priceContainer.innerHTML = pricesHtml(variant?.prices || selectedPrinting.prices || selectedCard.prices || {});

          if (variant?.cardId) {
            panel.querySelectorAll('[data-card-detail-link]').forEach((link) => link.setAttribute('href', `#/cards/${Number(variant.cardId)}`));
            return;
          }
          if (!variant?.scryfallId || variant.scryfallId === selectedCard.scryfallId) return;

          const currentSequence = ++languagePreviewSequence;
          try {
            const exactVariant = await api(`/cards/preview/${encodeURIComponent(variant.scryfallId)}`);
            if (currentSequence !== languagePreviewSequence || languageSelect.value !== selectedLanguage) return;
            selectedCard = exactVariant;
            panel.querySelectorAll('[data-card-detail-link]').forEach((link) => link.setAttribute('href', `#/cards/${Number(exactVariant.id)}`));
          } catch {
            // De gekozen taal blijft bruikbaar voor toevoegen; alleen de detailkoppeling
            // valt terug op de representatieve printing wanneer de preview niet laadt.
          }
        });

        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const button = form.querySelector('[type="submit"]');
          button.disabled = true;
          button.textContent = 'Toevoegen…';
          try {
            const added = await api('/collection', { method: 'POST', body: currentCollectionPayload(form) });
            await refreshSelectedUsage(added.card || null);
            toast(`${selectedCard.name} is aan je collectie toegevoegd.`, 'success', { position: 'top' });
          } catch (error) {
            toast(error.message, 'error', { position: 'top' });
          } finally {
            if (document.body.contains(button)) {
              button.disabled = false;
              button.textContent = 'Collectie';
            }
          }
        });

        document.getElementById('selected-to-wanted')?.addEventListener('click', () => {
          const data = new FormData(form);
          addCardToWanted(selectedCard, {
            quantity: Number(formValue(data, 'quantity', '1')),
            toastOptions: { position: 'top' },
            onDone: () => refreshSelectedUsage()
          });
        });

        document.getElementById('selected-to-collection-deck')?.addEventListener('click', () => {
          openCollectionDeckDialog(form).catch((error) => toast(error.message, 'error', { position: 'top' }));
        });
      };

      const renderPrintingList = () => {
        const collectorNumber = collectorSelect.value;
        const entries = loadedPrintings
          .map((printing, index) => ({ printing, index }))
          .filter(({ printing }) => !collectorNumber || String(printing.collectorNumber) === collectorNumber);

        if (!entries.length) {
          list.innerHTML = '';
          status.hidden = false;
          status.textContent = collectorNumber
            ? `Geen printings gevonden met kaartnummer ${collectorNumber}.`
            : 'Geen printings gevonden.';
          return;
        }

        status.hidden = true;
        list.innerHTML = entries.map(({ printing, index }) => printingHtml(printing, index)).join('');
        list.querySelectorAll('.printing-card').forEach((button) => {
          const printing = loadedPrintings[Number(button.dataset.printingIndex)];
          button.classList.toggle('selected', Boolean(selectedPrinting && printing?.printingKey === selectedPrinting.printingKey));
          button.addEventListener('click', () => choosePrinting(button));
        });
      };

      const populateCollectorNumbers = (selected = '') => {
        const numbers = uniqueCollectorNumbers(loadedPrintings);
        const validSelected = numbers.includes(String(selected)) ? String(selected) : '';
        collectorSelect.innerHTML = `<option value="">Alle kaartnummers</option>${numbers.map((number) => `<option value="${escapeHtml(number)}" ${number === validSelected ? 'selected' : ''}>#${escapeHtml(number)}</option>`).join('')}`;
        collectorSelect.disabled = numbers.length === 0;
        collectorSelect.value = validSelected;
      };

      const choosePrinting = async (button, { updateRoute = true, scrollToActions = true } = {}) => {
        const index = Number(button.dataset.printingIndex);
        const nextPrinting = loadedPrintings[index];
        if (!nextPrinting) return;
        if (selectedPrinting?.printingKey === nextPrinting.printingKey && panel.querySelector('#add-collection-form')) {
          if (updateRoute) updateAddRoute({ name: search.value.trim(), printing: selectedPrinting.scryfallId });
          if (scrollToActions) scrollActionsIntoView();
          return;
        }
        selectedPrinting = nextPrinting;
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
          if (scrollToActions) scrollActionsIntoView();
        } catch (error) {
          toast(error.message, 'error', { position: 'top' });
          selectedPrinting = null;
          list.querySelectorAll('.printing-card').forEach((item) => item.classList.remove('selected'));
          panel.innerHTML = selectedPanel(null, null);
          if (updateRoute) updateAddRoute({ name: search.value.trim(), printing: '' });
        } finally {
          list.querySelectorAll('button').forEach((item) => { item.disabled = false; });
        }
      };

      const resetSelection = () => {
        selectedCard = null;
        selectedPrinting = null;
        panel.innerHTML = selectedPanel(null, null);
      };

      const loadPrintings = async (name, { restorePrinting = '', restoreCollectorNumber = '' } = {}) => {
        search.value = name;
        resetSelection();
        loadedPrintings = [];
        collectorSelect.disabled = true;
        collectorSelect.innerHTML = '<option value="">Alle kaartnummers</option>';
        updateAddRoute({ name, printing: '', collectorNumber: restoreCollectorNumber });
        suggestions.hidden = true;
        status.hidden = false;
        status.innerHTML = '<span class="spinner"></span><p>Printings laden…</p>';
        list.innerHTML = '';
        try {
          const response = await api(`/cards/printings${queryString({ name })}`);
          loadedPrintings = response.data || response;
          populateCollectorNumbers(restoreCollectorNumber);
          renderPrintingList();

          if (restorePrinting) {
            const restoreIndex = loadedPrintings.findIndex((printing) => printing.scryfallId === restorePrinting
              || printing.variants?.some((variant) => variant.scryfallId === restorePrinting));
            if (restoreIndex >= 0) {
              const printing = loadedPrintings[restoreIndex];
              if (collectorSelect.value && String(printing.collectorNumber) !== collectorSelect.value) {
                populateCollectorNumbers(printing.collectorNumber);
                renderPrintingList();
              }
              const restoreButton = list.querySelector(`[data-printing-index="${restoreIndex}"]`);
              if (restoreButton) await choosePrinting(restoreButton, { updateRoute: false, scrollToActions: false });
            }
          }
          updateAddRoute({ name, printing: restorePrinting && selectedPrinting ? selectedPrinting.scryfallId : '' });
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

      collectorSelect.addEventListener('change', () => {
        renderPrintingList();
        updateAddRoute();
      });
      search.addEventListener('input', suggest);
      search.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const first = suggestions.querySelector('button');
        if (first) first.click();
        else if (search.value.trim()) loadPrintings(search.value.trim());
      });
      if (initialName) return loadPrintings(initialName, {
        restorePrinting: initialPrinting,
        restoreCollectorNumber: initialCollectorNumber
      });
      if (initialQuery.length >= 2) setTimeout(suggest, 0);
      return undefined;
    }
  };
}
