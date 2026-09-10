import { api, queryString } from '../api.js';
import { addCardToDeck, addCardToWanted } from '../card-actions.js';
import { isBasicLand } from '../card-rules.js';
import { cachedCardImageUrl, cardImage, manaCost, pageHeader, usageBadges } from '../components.js';
import { prepareCardDetailNavigation } from '../navigation-state.js';
import {
  defaultLanguage,
  finishOptions,
  languageOptions,
  variantForLanguage
} from '../printing-utils.js';
import { debounce, emptyState, escapeHtml, formValue, toast } from '../utils.js';

function printingScryfallId(printing) {
  return printing?.scryfallId || printing?.variants?.find((variant) => variant?.scryfallId)?.scryfallId || '';
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
  if (!card || !printing) return emptyState('Nog geen printing gekozen', 'Zoek een kaartnaam en kies daarna een printing om de kaart te bekijken.');
  const language = defaultLanguage(printing, card);
  const variant = variantForLanguage(printing, language, card);
  return `<div class="panel selected-printing">
    <div class="panel-body">
      <div class="selected-card-preview">
        ${cardImage(card, { className: 'preview-image' })}
        <div>
          <div class="card-title-row"><h2>${escapeHtml(card.name)}</h2>${manaCost(card.manaCost)}</div>
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
            <div class="field full"><label>Opmerkingen</label><textarea name="notes"></textarea></div>
            <label class="checkbox-field full"><input name="reconcileWanted" type="checkbox" checked> Wanted-aantal automatisch verminderen</label>
          </div>
          <div class="form-actions">${isBasicLand(card) ? '' : '<button type="button" id="selected-to-wanted" class="button secondary" data-write-action>☆ Naar Wanted</button>'}<button type="button" id="selected-to-deck" class="button secondary" data-write-action>▤ Naar deck</button><button class="button primary" type="submit" data-write-action>＋ Aan collectie toevoegen</button></div>
        </form>
      </div>
    </div>
  </div>`;
}

function updateAddLocation(name, scryfallId) {
  const params = new URLSearchParams();
  if (name) params.set('q', name);
  if (scryfallId) params.set('printing', scryfallId);
  const destination = `#/add${params.toString() ? `?${params}` : ''}`;
  window.history.replaceState(window.history.state, '', destination);
}

export async function renderAddCard(context) {
  const initialQuery = context.query.get('q') || '';
  const initialPrintingId = context.query.get('printing') || '';
  let selectedCard = null;
  let selectedPrinting = null;
  let loadedPrintings = [];

  return {
    html: `
      ${pageHeader({ eyebrow: 'Snelle invoer', title: 'Kaart toevoegen', description: 'Zoek op naam en bekijk de beschikbare printings. Met schrijftoegang kun je daarna taal, afwerking en bezit registreren.' })}
      <section class="add-layout">
        <div>
          <div class="search-hero">
            <h2>Welke kaart wil je registreren?</h2>
            <p>Scryfall wordt alleen gebruikt voor zoeken en kaartmetadata; gekozen kaarten worden lokaal opgeslagen.</p>
            <div class="field autocomplete-wrap">
              <label class="sr-only" for="add-card-search">Kaartnaam</label>
              <input id="add-card-search" type="search" autocomplete="off" placeholder="Typ minimaal twee letters…" value="${escapeHtml(initialQuery)}">
              <div id="add-suggestions" class="autocomplete-list" hidden></div>
            </div>
          </div>
          <div id="printing-status" class="picker-status">Kies een kaartnaam om beschikbare printings te tonen.</div>
          <div id="printing-list" class="printing-grid"></div>
        </div>
        <div id="selected-card-panel">${selectedPanel(null, null)}</div>
      </section>`,
    async mount() {
      const search = document.getElementById('add-card-search');
      const suggestions = document.getElementById('add-suggestions');
      const status = document.getElementById('printing-status');
      const list = document.getElementById('printing-list');
      const panel = document.getElementById('selected-card-panel');

      const ensureSelectedCardIsLocal = async () => {
        if (Number(selectedCard?.id) > 0) return selectedCard;
        const scryfallId = printingScryfallId(selectedPrinting);
        if (!scryfallId) throw new Error('Deze printing heeft geen bruikbare Scryfall-ID.');
        selectedCard = await api('/cards/cache', { method: 'POST', body: { scryfallId } });
        return selectedCard;
      };

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

        document.getElementById('selected-to-wanted')?.addEventListener('click', async () => {
          try {
            const card = await ensureSelectedCardIsLocal();
            addCardToWanted(card, { onDone: async () => {
              selectedCard = await api(`/cards/${card.id}`);
              panel.innerHTML = selectedPanel(selectedCard, selectedPrinting);
              bindSelectedActions();
            }});
          } catch (error) {
            toast(error.message, 'error');
          }
        });
        document.getElementById('selected-to-deck')?.addEventListener('click', async () => {
          try {
            const card = await ensureSelectedCardIsLocal();
            addCardToDeck(card, { onDone: async () => {
              selectedCard = await api(`/cards/${card.id}`);
              panel.innerHTML = selectedPanel(selectedCard, selectedPrinting);
              bindSelectedActions();
            }});
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      };

      const showSelectedPrinting = async (printing, button) => {
        selectedPrinting = printing;
        list.querySelectorAll('.printing-card').forEach((item) => item.classList.toggle('selected', item === button));
        panel.innerHTML = '<div class="panel"><div class="page-loading"><span class="spinner"></span><p>Kaartgegevens laden…</p></div></div>';
        try {
          const scryfallId = printingScryfallId(printing);
          if (!scryfallId) throw new Error('Deze printing heeft geen bruikbare Scryfall-ID.');
          selectedCard = await api(`/cards/preview/${encodeURIComponent(scryfallId)}`);
          panel.innerHTML = selectedPanel(selectedCard, selectedPrinting);
          bindSelectedActions();
        } catch (error) {
          toast(error.message, 'error');
          selectedCard = null;
          selectedPrinting = null;
          list.querySelectorAll('.printing-card').forEach((item) => item.classList.remove('selected'));
          panel.innerHTML = selectedPanel(null, null);
        }
      };

      const openPrintingDetail = (button) => {
        const index = Number(button.dataset.printingIndex);
        const printing = loadedPrintings[index];
        const scryfallId = printingScryfallId(printing);
        if (!printing || !scryfallId) return;
        updateAddLocation(search.value.trim() || printing.name, scryfallId);
        window.location.hash = prepareCardDetailNavigation(`#/cards/preview/${encodeURIComponent(scryfallId)}`);
      };

      const loadPrintings = async (name, { restorePrintingId = '' } = {}) => {
        search.value = name;
        suggestions.hidden = true;
        status.hidden = false;
        status.innerHTML = '<span class="spinner"></span><p>Printings laden…</p>';
        list.innerHTML = '';
        try {
          const response = await api(`/cards/printings${queryString({ name })}`);
          loadedPrintings = response.data || response;
          status.hidden = true;
          list.innerHTML = loadedPrintings.map(printingHtml).join('');
          const buttons = [...list.querySelectorAll('.printing-card')];
          buttons.forEach((button) => button.addEventListener('click', () => openPrintingDetail(button)));

          if (restorePrintingId) {
            const index = loadedPrintings.findIndex((printing) => printingScryfallId(printing) === restorePrintingId
              || printing.variants?.some((variant) => variant.scryfallId === restorePrintingId));
            if (index >= 0) await showSelectedPrinting(loadedPrintings[index], buttons[index]);
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

      search.addEventListener('input', () => {
        selectedCard = null;
        selectedPrinting = null;
        panel.innerHTML = selectedPanel(null, null);
        suggest();
      });
      search.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const first = suggestions.querySelector('button');
        if (first) first.click();
        else if (search.value.trim()) loadPrintings(search.value.trim());
      });

      if (initialPrintingId && initialQuery.length >= 2) {
        await loadPrintings(initialQuery, { restorePrintingId: initialPrintingId });
      } else if (initialQuery.length >= 2) {
        setTimeout(suggest, 0);
      }
    }
  };
}
