import { api, apiPath, queryString } from '../api.js';
import { addCardToCollection, addCardToWanted } from '../card-actions.js';
import { pickCard } from '../card-picker.js';
import { cachedCardImageUrl, cardImage, pageHeader, usageBadges } from '../components.js';
import { bindLiveFilters, resetFilterForm } from '../live-filters.js';
import { bindFilterToggle, filterToggleHtml, filtersExpanded } from '../collapsible-filters.js';
import {
  confirmDialog,
  emptyState,
  escapeHtml,
  formValue,
  formatEuro,
  openDialog,
  toast
} from '../utils.js';

const RARITY_LABELS = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  mythic: 'Mythic',
  special: 'Special',
  bonus: 'Bonus'
};

function stars(priority) {
  const filled = Math.max(1, 6 - Number(priority));
  return `<span class="priority" title="Prioriteit ${priority}">${'★'.repeat(filled)}${'☆'.repeat(5 - filled)}</span>`;
}

function option(value, label, current) {
  return `<option value="${escapeHtml(value)}" ${String(value) === String(current || '') ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

function pricePills(prices = {}, { emptyText = 'Geen prijs beschikbaar' } = {}) {
  const values = [
    ['Non-foil', prices.eur],
    ['Foil', prices.eur_foil],
    ['Etched', prices.eur_etched]
  ].filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (!values.length) return `<span class="muted wanted-price-empty">${escapeHtml(emptyText)}</span>`;
  return `<span class="wanted-price-list">${values.map(([label, value]) => `<span class="wanted-price-pill"><small>${escapeHtml(label)}</small><strong>${formatEuro(value)}</strong></span>`).join('')}</span>`;
}

function selectedPrintingText(item) {
  if (!item.printing) {
    return '<span class="wanted-printing-unselected">Printing nog niet gekozen</span>';
  }
  return `<span class="wanted-printing-selected"><strong>${escapeHtml(item.printing.setName)}</strong> (${escapeHtml(item.printing.setCode.toUpperCase())}) #${escapeHtml(item.printing.collectorNumber)}</span>`;
}

function rarityPrintingNames(item, rarity) {
  if (item.printing?.rarity === rarity) {
    return [`${item.printing.setName} (${String(item.printing.setCode || '').toUpperCase()}) #${item.printing.collectorNumber}`];
  }
  const printings = item.printingCatalog?.rarityPrintings?.[rarity] || [];
  const uniqueSets = new Map();
  for (const printing of printings) {
    const key = `${printing.setCode}:${printing.setName}`;
    if (!uniqueSets.has(key)) {
      uniqueSets.set(key, `${printing.setName} (${String(printing.setCode || '').toUpperCase()})`);
    }
  }
  if (!uniqueSets.size && item.card.rarity === rarity) {
    uniqueSets.set(item.card.setCode, `${item.card.setName} (${String(item.card.setCode || '').toUpperCase()})`);
  }
  return [...uniqueSets.values()];
}

function rarityBadges(item) {
  const rarities = item.printing?.rarity
    ? [item.printing.rarity]
    : item.printingCatalog?.rarities?.length
      ? item.printingCatalog.rarities
      : item.card.rarity ? [item.card.rarity] : [];
  if (!rarities.length) return '<span class="rarity-badge rarity-unknown">Onbekend</span>';
  return `<span class="rarity-list">${rarities.map((rarity) => {
    const label = RARITY_LABELS[rarity] || rarity;
    const printingNames = rarityPrintingNames(item, rarity);
    const title = printingNames.length ? `${label}: ${printingNames.join(', ')}` : label;
    return `<span class="rarity-badge rarity-${escapeHtml(rarity)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
  }).join('')}</span>`;
}

function samePrinting(card, printing) {
  return Boolean(card && printing
    && String(card.setCode || '').toLowerCase() === String(printing.setCode || '').toLowerCase()
    && String(card.collectorNumber || '') === String(printing.collectorNumber || ''));
}

function openPrintingPreview(printing) {
  const source = printing.imageNormal || printing.image;
  if (!source) return null;
  return openDialog({
    title: `${printing.name} · ${printing.setName}`,
    cancelLabel: 'Sluiten',
    wide: true,
    content: `<div class="printing-image-preview"><img src="${escapeHtml(cachedCardImageUrl(source))}" alt="${escapeHtml(`${printing.name} uit ${printing.setName}`)}"></div>`
  });
}

async function choosePrinting(item, onDone) {
  const dialog = openDialog({
    title: `Printing kiezen voor ${item.card.name}`,
    wide: true,
    cancelLabel: 'Sluiten',
    content: `<div class="wanted-printing-dialog">
      <p class="form-note">Kies de serie en het collectornummer dat je wilt aanschaffen. Taal en afwerking kies je pas wanneer je de kaart aan je collectie toevoegt.</p>
      <div id="wanted-printing-status" class="picker-status"><span class="spinner"></span><p>Printings en prijzen laden…</p></div>
      <div id="wanted-printing-results" class="wanted-printing-grid"></div>
    </div>`
  });

  const status = dialog.querySelector('#wanted-printing-status');
  const results = dialog.querySelector('#wanted-printing-results');

  try {
    const response = await api(`/cards/printings${queryString({ name: item.card.name })}`);
    const printings = response.data || response;
    if (!printings.length) {
      status.innerHTML = '<p>Er zijn geen printings gevonden.</p>';
      return;
    }

    status.hidden = true;
    results.innerHTML = `
      ${item.printing ? `<article class="wanted-printing-clear-card">
        <div><strong>Geen specifieke printing</strong><small>Laat de serie open wanneer iedere uitvoering geschikt is.</small></div>
        <button type="button" class="button secondary small" id="clear-wanted-printing" data-write-action>Keuze verwijderen</button>
      </article>` : ''}
      ${printings.map((printing, index) => {
        const current = samePrinting(item.printing, printing);
        return `<article class="wanted-printing-card ${current ? 'selected' : ''}">
          ${printing.image
            ? `<button type="button" class="wanted-printing-image-button" data-preview-index="${index}" aria-label="Vergroot ${escapeHtml(printing.name)} uit ${escapeHtml(printing.setName)}"><img src="${escapeHtml(cachedCardImageUrl(printing.image))}" alt="${escapeHtml(`${printing.name} uit ${printing.setName}`)}" loading="lazy"></button>`
            : `<span class="card-image-placeholder wanted-printing-image"><span>${escapeHtml(printing.name?.slice(0, 1) || '?')}</span></span>`}
          <div class="wanted-printing-copy">
            <div class="wanted-printing-heading"><strong>${escapeHtml(printing.setName)}</strong><span class="badge neutral">${escapeHtml(printing.setCode.toUpperCase())} #${escapeHtml(printing.collectorNumber)}</span></div>
            <small>${escapeHtml(RARITY_LABELS[printing.rarity] || printing.rarity || 'Onbekende rarity')}${printing.releasedAt ? ` · ${escapeHtml(printing.releasedAt)}` : ''}</small>
            ${pricePills(printing.prices)}
          </div>
          <button type="button" class="button ${current ? 'primary' : 'secondary'} small choose-wanted-printing" data-index="${index}" data-write-action ${current ? 'disabled' : ''}>${current ? 'Gekozen' : 'Kiezen'}</button>
        </article>`;
      }).join('')}`;

    results.querySelectorAll('[data-preview-index]').forEach((button) => button.addEventListener('click', () => {
      const printing = printings[Number(button.dataset.previewIndex)];
      if (printing) openPrintingPreview(printing);
    }));

    results.querySelector('#clear-wanted-printing')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await api(`/wanted/${item.id}/printing`, { method: 'PATCH', body: { clear: true } });
        toast(`De printingkeuze voor ${item.card.name} is verwijderd.`);
        dialog.close();
        await onDone?.();
      } catch (error) {
        button.disabled = false;
        toast(error.message, 'error');
      }
    });

    results.querySelectorAll('.choose-wanted-printing').forEach((button) => button.addEventListener('click', async () => {
      const printing = printings[Number(button.dataset.index)];
      if (!printing) return;
      button.disabled = true;
      const original = button.textContent;
      button.textContent = 'Opslaan…';
      try {
        const body = printing.cardId
          ? { printingCardId: Number(printing.cardId) }
          : { scryfallId: printing.scryfallId };
        await api(`/wanted/${item.id}/printing`, { method: 'PATCH', body });
        toast(`${printing.setName} is gekozen voor ${item.card.name}.`);
        dialog.close();
        await onDone?.();
      } catch (error) {
        button.disabled = false;
        button.textContent = original;
        toast(error.message, 'error');
      }
    }));
  } catch (error) {
    status.innerHTML = `<p class="text-danger">${escapeHtml(error.message)}</p>`;
  }
}

function renderWantedRows(items, hasFilters = false) {
  if (!items.length) {
    return emptyState(
      'Wanted-list is leeg',
      hasFilters ? 'Geen kaarten voldoen aan deze filters.' : 'Voeg kaarten toe die je nog wilt aanschaffen.',
      '<button id="empty-add-wanted" class="button primary" data-write-action>Kaart toevoegen</button>'
    );
  }

  return `<div class="card-list">${items.map((item) => {
    const displayCard = item.printing || item.card;
    const availableSets = item.printingCatalog?.sets?.length || 0;
    return `<article class="card-list-item wanted-row">
      <a class="card-thumb-link" data-card-detail-link href="#/cards/${displayCard.id || item.card.id}">${cardImage(displayCard, { className: 'list-thumb' })}</a>
      <div class="card-list-content">
        <div class="card-title-row">
          <a data-card-detail-link href="#/cards/${item.card.id}"><strong>${item.quantity}× ${escapeHtml(item.card.name)}</strong></a>
          <span class="wanted-title-meta">${rarityBadges(item)}${stars(item.priority)}</span>
        </div>
        <p class="card-meta wanted-printing-meta">${selectedPrintingText(item)}</p>
        ${item.printing ? pricePills(item.printing.prices, { emptyText: 'Prijs niet beschikbaar' }) : ''}
        ${usageBadges(item.card.usage, { compact: true })}
        <div class="wanted-meta">
          <span>Maximum: <strong>${formatEuro(item.maximumPrice)}</strong></span>
          <span>Mogelijke printings: <strong>${item.printingCatalog?.printingCount || 0}</strong>${availableSets ? ` in ${availableSets} serie${availableSets === 1 ? '' : 's'}` : ''}</span>
          ${item.card.usage.decks.length ? `<span>Nodig voor: <strong>${item.card.usage.decks.map((deck) => escapeHtml(deck.name)).join(', ')}</strong></span>` : ''}
        </div>
        ${item.notes ? `<small>${escapeHtml(item.notes)}</small>` : ''}
      </div>
      <div class="card-list-actions">
        <button class="button primary small acquire-wanted" data-id="${item.id}" data-write-action ${item.printing ? '' : 'disabled title="Kies eerst een printing"'}>Gekocht</button>
        <button class="button secondary small choose-printing" data-id="${item.id}">Printing</button>
        <button class="button secondary small edit-wanted" data-id="${item.id}" data-write-action>Bewerken</button>
        <button class="button ghost small delete-wanted text-danger" data-id="${item.id}" data-name="${escapeHtml(item.card.name)}" data-write-action>Verwijderen</button>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function printingOptionsHtml(options, current = '') {
  return `<option value="">Alle mogelijke printings</option>${(options.printings || []).map((printing) => option(
    printing.code,
    `${printing.name} (${printing.code.toUpperCase()}) · ${printing.quantity} kaart${printing.quantity === 1 ? '' : 'en'}`,
    current
  )).join('')}`;
}

function rarityOptionsHtml(options, current = '') {
  return `<option value="">Alle rarities</option>${(options.rarities || []).map((entry) => option(
    entry.rarity,
    `${RARITY_LABELS[entry.rarity] || entry.rarity} · ${entry.quantity} kaart${entry.quantity === 1 ? '' : 'en'}`,
    current
  )).join('')}`;
}

function deckOptionsHtml(options, current = '') {
  return `<option value="">Alle decks</option>${(options.decks || []).map((deck) => option(
    deck.id,
    `${deck.name} · ${deck.quantity} wanted-kaart${deck.quantity === 1 ? '' : 'en'}`,
    current
  )).join('')}`;
}

function resultCountText(items) {
  return `${items.length} resultaat${items.length === 1 ? '' : 'en'}`;
}

export async function renderWanted(context) {
  const filters = {
    q: context.query.get('q') || '',
    priority: context.query.get('priority') || '',
    deckId: context.query.get('deckId') || '',
    printing: context.query.get('printing') || '',
    rarity: context.query.get('rarity') || '',
    color: context.query.get('color') || '',
    sort: context.query.get('sort') || 'priority'
  };

  const filterPanelExpanded = filtersExpanded('wanted');
  const activeFilterCount = Object.entries(filters).filter(([key, value]) => key !== 'sort' && String(value || '').length > 0).length;

  let options = await api('/wanted/options');
  let items = await api(`/wanted${queryString(filters)}`);

  return {
    html: `
      ${pageHeader({
        eyebrow: 'Aanschaflijst',
        title: 'Wanted',
        description: 'Filter per deck of doorzoek de series waarin je wanted-kaarten zijn verschenen.',
        actions: `<button id="add-wanted" class="button primary" data-write-action>＋ Kaart toevoegen</button><a class="button secondary" href="${apiPath('/wanted/export.csv')}">CSV exporteren</a>`
      })}
      ${filterToggleHtml({ id: 'wanted-filter-toggle', panelId: 'wanted-filters', expanded: filterPanelExpanded, activeCount: activeFilterCount, resetId: 'wanted-filter-reset' })}
      <form id="wanted-filters" class="filters compact-filters wanted-filters live-filters collapsible-filters" autocomplete="off" ${filterPanelExpanded ? '' : 'hidden'}>
        <div class="field filter-search"><label>Naam</label><input name="q" type="search" value="${escapeHtml(filters.q)}" placeholder="Zoek wanted-kaart"></div>
        <div class="field"><label>Prioriteit</label><select name="priority"><option value="">Alle prioriteiten</option>${[1,2,3,4,5].map((value) => option(value, `Prioriteit ${value}`, filters.priority)).join('')}</select></div>
        <div class="field"><label>Deck</label><select id="wanted-deck-filter" name="deckId">${deckOptionsHtml(options, filters.deckId)}</select></div>
        <div class="field"><label>Printing</label><select id="wanted-printing-filter" name="printing">${printingOptionsHtml(options, filters.printing)}</select></div>
        <div class="field"><label>Rarity</label><select id="wanted-rarity-filter" name="rarity">${rarityOptionsHtml(options, filters.rarity)}</select></div>
        <div class="field"><label>Kleur</label><select name="color"><option value="">Alle kleuren</option>${[['W','Wit'],['U','Blauw'],['B','Zwart'],['R','Rood'],['G','Groen'],['M','Meerkleurig'],['C','Kleurloos']].map(([value,label]) => option(value, label, filters.color)).join('')}</select></div>
        <div class="field"><label>Sorteren</label><select name="sort">${[['priority','Prioriteit'],['name','Naam'],['printing','Printing'],['price','Maximumprijs'],['quantity','Aantal'],['newest','Nieuwste']].map(([value,label]) => option(value,label,filters.sort)).join('')}</select></div>
      </form>
      ${options.catalogIncomplete ? `<p class="filter-warning">Voor ${options.catalogIncomplete} kaart${options.catalogIncomplete === 1 ? '' : 'en'} kon de volledige printingcatalogus niet worden vernieuwd. Gecachte lokale gegevens blijven zichtbaar.</p>` : ''}
      <p id="wanted-result-count" class="result-count" aria-live="polite">${resultCountText(items)}</p>
      <div id="wanted-results">${renderWantedRows(items, context.query.toString().length > 0)}</div>`,
    mount() {
      const filterForm = document.getElementById('wanted-filters');
      const deckSelect = document.getElementById('wanted-deck-filter');
      const printingSelect = document.getElementById('wanted-printing-filter');
      const raritySelect = document.getElementById('wanted-rarity-filter');
      const resultsElement = document.getElementById('wanted-results');
      const countElement = document.getElementById('wanted-result-count');
      let liveFilters;
      const filterToggle = bindFilterToggle({
        button: document.getElementById('wanted-filter-toggle'),
        panel: filterForm,
        key: 'wanted',
        getActiveCount: () => [...new FormData(filterForm).entries()].filter(([key, value]) => key !== 'sort' && String(value || '').length > 0).length
      });

      const updateResults = (nextItems, hasFilters) => {
        items = nextItems;
        resultsElement.innerHTML = renderWantedRows(items, hasFilters);
      };

      const loadCurrentResults = async (params = liveFilters?.getParams() || new URLSearchParams(), signal) => {
        const nextItems = await api(`/wanted${params.toString() ? `?${params}` : ''}`, { signal });
        updateResults(nextItems, params.toString().length > 0);
        countElement.textContent = resultCountText(nextItems);
        filterToggle.updateActiveCount();
      };

      const reloadOptionsAndResults = async () => {
        options = await api('/wanted/options');
        const currentDeck = deckSelect.value;
        const currentPrinting = printingSelect.value;
        const currentRarity = raritySelect.value;
        deckSelect.innerHTML = deckOptionsHtml(options, currentDeck);
        printingSelect.innerHTML = printingOptionsHtml(options, currentPrinting);
        raritySelect.innerHTML = rarityOptionsHtml(options, currentRarity);
        if (currentDeck && ![...deckSelect.options].some((entry) => entry.value === currentDeck)) {
          deckSelect.value = '';
        }
        if (currentPrinting && ![...printingSelect.options].some((entry) => entry.value === currentPrinting)) {
          printingSelect.value = '';
        }
        if (currentRarity && ![...raritySelect.options].some((entry) => entry.value === currentRarity)) {
          raritySelect.value = '';
        }
        await liveFilters.apply();
      };

      liveFilters = bindLiveFilters({
        form: filterForm,
        routePath: '/wanted',
        defaults: { sort: 'priority' },
        onApply: loadCurrentResults,
        onError: (error) => toast(error.message || 'Filteren is mislukt.', 'error')
      });

      document.getElementById('wanted-filter-reset')?.addEventListener('click', () => {
        resetFilterForm(filterForm, { sort: 'priority' });
        liveFilters.apply();
      });

      const addWanted = async () => {
        const card = await pickCard({ title: 'Kaart aan wanted-list toevoegen', resolveNameDirectly: true });
        if (card) addCardToWanted(card, { onDone: reloadOptionsAndResults });
      };

      document.getElementById('add-wanted')?.addEventListener('click', addWanted);
      resultsElement.addEventListener('click', async (event) => {
        const emptyButton = event.target.closest('#empty-add-wanted');
        if (emptyButton) {
          addWanted();
          return;
        }

        const button = event.target.closest('[data-id]');
        if (!button) return;
        const item = items.find((candidate) => candidate.id === Number(button.dataset.id));
        if (!item) return;

        if (button.classList.contains('acquire-wanted')) {
          if (item.printing) addCardToCollection(item.printing, { sourceWantedId: item.id, onDone: reloadOptionsAndResults });
          return;
        }
        if (button.classList.contains('choose-printing')) {
          choosePrinting(item, reloadOptionsAndResults);
          return;
        }
        if (button.classList.contains('edit-wanted')) {
          openDialog({
            title: `${item.card.name} op Wanted`,
            submitLabel: 'Opslaan',
            content: `<div class="form-grid">
              <div class="field"><label>Aantal</label><input name="quantity" type="number" min="1" value="${item.quantity}"></div>
              <div class="field"><label>Prioriteit</label><select name="priority">${[1,2,3,4,5].map((value) => option(value, `${value}`, item.priority)).join('')}</select></div>
              <div class="field"><label>Maximumprijs (€)</label><input name="maximumPrice" type="number" min="0" step="0.01" value="${item.maximumPrice ?? ''}"></div>
              <div class="field full"><label>Opmerkingen</label><textarea name="notes">${escapeHtml(item.notes)}</textarea></div>
            </div>`,
            onSubmit: async (data) => {
              await api(`/wanted/${item.id}`, {
                method: 'PATCH',
                body: {
                  quantity: Number(formValue(data, 'quantity', '1')),
                  priority: Number(formValue(data, 'priority', '3')),
                  maximumPrice: formValue(data, 'maximumPrice') || null,
                  notes: formValue(data, 'notes')
                }
              });
              toast(`${item.card.name} is bijgewerkt.`);
              await loadCurrentResults();
              return true;
            }
          });
          return;
        }
        if (!button.classList.contains('delete-wanted')) return;
        const confirmed = await confirmDialog({
          title: 'Wanted-item verwijderen',
          message: `Verwijder ${item.card.name} van je wanted-list? De kaart blijft in decks staan.`
        });
        if (!confirmed) return;
        await api(`/wanted/${item.id}`, { method: 'DELETE' });
        toast(`${item.card.name} is van Wanted verwijderd.`);
        await reloadOptionsAndResults();
      });
    }
  };
}
