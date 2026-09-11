import { api, apiPath, queryString } from '../api.js';
import { addCardToDeck } from '../card-actions.js';
import { cardImage, cardInsightBadges, manaCost, manaLabel, pageHeader, rarityBadge, usageBadges } from '../components.js';
import { openCardInsightsEditor } from '../card-insights.js';
import { bindLiveFilters, resetFilterForm } from '../live-filters.js';
import { bindFilterToggle, filterToggleHtml, filtersExpanded } from '../collapsible-filters.js';
import { confirmDialog, emptyState, escapeHtml, formatEuro, formValue, openDialog, toast } from '../utils.js';

const CONDITION_LABELS = {
  mint: 'Mint', near_mint: 'Near mint', excellent: 'Excellent', good: 'Good',
  light_played: 'Light played', played: 'Played', poor: 'Poor'
};

function option(value, label, current) {
  return `<option value="${escapeHtml(value)}" ${String(current || '') === String(value) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

function collectionPrice(item) {
  const suffix = item.finish === 'foil' ? '_foil' : item.finish === 'etched' ? '_etched' : '';
  const prices = item.card?.prices || {};
  const euro = prices[`eur${suffix}`];
  const usd = prices[`usd${suffix}`];
  let value = '—';
  if (euro !== null && euro !== undefined && euro !== '') value = formatEuro(euro);
  else if (usd !== null && usd !== undefined && usd !== '') {
    value = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'USD' }).format(Number(usd));
  }
  return `<span class="collection-market-price" title="Scryfall-prijs voor deze printing en afwerking"><small>Prijs</small><strong>${escapeHtml(value)}</strong></span>`;
}

function colorIdentityOptions(selectedColors = []) {
  const selected = new Set(selectedColors.map((color) => String(color).toUpperCase()));
  return [['W', 'Wit'], ['U', 'Blauw'], ['B', 'Zwart'], ['R', 'Rood'], ['G', 'Groen'], ['C', 'Kleurloos']]
    .map(([value, label]) => `<label class="color-identity-option"><input type="checkbox" name="color" value="${value}" ${selected.has(value) ? 'checked' : ''}><span>${manaLabel(value, label)}</span></label>`)
    .join('');
}

function activeCollectionFilterCount(filters) {
  const scalarCount = Object.entries(filters)
    .filter(([key, value]) => key !== 'color' && String(value || '').length > 0)
    .length;
  return scalarCount + (filters.color.length ? 1 : 0);
}

function renderCollectionRows(items, hasFilters = false) {
  if (!items.length) {
    return emptyState(
      'Geen kaarten gevonden',
      hasFilters ? 'Pas je zoekterm of filters aan.' : 'Je collectie is nog leeg.',
      '<a class="button primary" data-write-action href="#/add">Kaart toevoegen</a>'
    );
  }
  return `<div class="card-list">${items.map((item) => `
    <article class="card-list-item">
      <a class="card-thumb-link" data-card-detail-link href="#/cards/${item.card.id}">${cardImage(item.card, { className: 'list-thumb' })}</a>
      <div class="card-list-content">
        <div class="card-title-row collection-card-title-row">
          <a data-card-detail-link href="#/cards/${item.card.id}"><strong>${escapeHtml(item.card.name)}</strong></a>
          <span class="collection-title-meta">${manaCost(item.card.manaCost)}${rarityBadge(item.card.rarity)}${collectionPrice(item)}<span class="collection-quantity"><strong>${item.quantity}×</strong><small>${escapeHtml(item.finish)}</small></span></span>
        </div>
        <p class="card-meta">${escapeHtml(item.card.setName)} (${escapeHtml(item.card.setCode.toUpperCase())}) #${escapeHtml(item.card.collectorNumber)} · ${escapeHtml(item.language)} · ${escapeHtml(CONDITION_LABELS[item.condition] || item.condition)}${item.location ? ` · ${escapeHtml(item.location)}` : ''}</p>
        ${usageBadges(item.card.usage, { compact: true })}
        ${cardInsightBadges(item.card)}
      </div>
      <div class="card-list-actions">
        <button class="button secondary small collection-to-deck" type="button" data-write-action data-item-id="${item.id}">Naar deck</button>
        <button class="button secondary small edit-card-insights" type="button" data-write-action data-item-id="${item.id}">Kenmerken</button>
        <button class="button secondary small edit-item" type="button" data-write-action data-item-id="${item.id}">Bewerken</button>
        <button class="button ghost small delete-item text-danger" type="button" data-write-action data-item-id="${item.id}" data-name="${escapeHtml(item.card.name)}">Verwijderen</button>
      </div>
    </article>`).join('')}</div>`;
}

function resultCountText(items) {
  return `${items.length} resultaat${items.length === 1 ? '' : 'en'}`;
}

export async function renderCollection(context) {
  const filters = {
    q: context.query.get('q') || '',
    color: context.query.getAll('color')
      .flatMap((value) => String(value).split(','))
      .map((value) => value.trim().toUpperCase())
      .filter((value, index, values) => ['W', 'U', 'B', 'R', 'G', 'C'].includes(value) && values.indexOf(value) === index),
    type: context.query.get('type') || '',
    subtype: context.query.get('subtype') || '',
    manaValue: context.query.get('manaValue') || '',
    ability: context.query.get('ability') || '',
    set: context.query.get('set') || '',
    rarity: context.query.get('rarity') || '',
    finish: context.query.get('finish') || '',
    deckId: context.query.get('deckId') || '',
    availability: context.query.get('availability') || ''
  };
  const filterPanelExpanded = filtersExpanded('collection');
  const activeFilterCount = activeCollectionFilterCount(filters);
  const [result, options] = await Promise.all([
    api(`/collection${queryString(filters)}`),
    api('/collection/options')
  ]);
  let items = result.items;

  return {
    html: `
      ${pageHeader({
        eyebrow: 'Fysiek bezit', title: 'Collectie',
        description: `${items.length} collectieregels zichtbaar. Beschikbaarheid wordt over alle printings van dezelfde Oracle-kaart berekend.`,
        actions: `<a class="button primary" data-write-action href="#/add">＋ Kaart toevoegen</a><a class="button secondary" href="${apiPath('/collection/export.csv')}">CSV exporteren</a>`
      })}
      ${filterToggleHtml({ id: 'collection-filter-toggle', panelId: 'collection-filters', expanded: filterPanelExpanded, activeCount: activeFilterCount, resetId: 'collection-filter-reset' })}
      <form id="collection-filters" class="filters live-filters collapsible-filters" autocomplete="off" ${filterPanelExpanded ? '' : 'hidden'}>
        <div class="field filter-search"><label>Naam</label><input name="q" type="search" value="${escapeHtml(filters.q)}" placeholder="Zoek in lokale collectie"></div>
        <fieldset class="field color-identity-filter"><legend>Kleuridentiteit</legend><div class="color-identity-options">${colorIdentityOptions(filters.color)}</div></fieldset>
        <div class="field"><label>Kaarttype</label><select name="type"><option value="">Alle types</option>${['Creature','Land','Artifact','Enchantment','Instant','Sorcery','Planeswalker','Battle'].map((v) => option(v, v, filters.type)).join('')}</select></div>
        <div class="field"><label>Subtype</label><input name="subtype" type="text" value="${escapeHtml(filters.subtype)}" placeholder="Bijv. Elf"></div>
        <div class="field"><label>Mana value</label><select name="manaValue"><option value="">Alle waardes</option>${['0','1','2','3','4','5','6','7+'].map((v) => option(v, v, filters.manaValue)).join('')}</select></div>
        <div class="field"><label>Ability</label><select name="ability"><option value="">Alle abilities</option>${(options.abilities || []).map((entry) => option(entry.name, `${entry.name} (${entry.cardCount})`, filters.ability)).join('')}</select></div>
        <div class="field"><label>Set</label><select name="set"><option value="">Alle sets</option>${options.sets.map((set) => option(set.code, `${set.name} (${set.quantity})`, filters.set)).join('')}</select></div>
        <div class="field"><label>Rarity</label><select name="rarity"><option value="">Alle rarities</option>${['common','uncommon','rare','mythic','special','bonus'].map((v) => option(v, v, filters.rarity)).join('')}</select></div>
        <div class="field"><label>Afwerking</label><select name="finish"><option value="">Alle afwerkingen</option>${['nonfoil','foil','etched'].map((v) => option(v, v, filters.finish)).join('')}</select></div>
        <div class="field"><label>Beschikbaarheid</label><select name="availability"><option value="">Alles</option>${[['free','Vrij beschikbaar'],['used','In een deck'],['shortage','Missende kaarten']].map(([v,l]) => option(v,l,filters.availability)).join('')}</select></div>
        <div class="field"><label>Deck</label><select name="deckId"><option value="">Alle decks</option>${options.decks.map((deck) => option(deck.id, deck.name, filters.deckId)).join('')}</select></div>
      </form>
      <p id="collection-result-count" class="result-count" aria-live="polite">${resultCountText(items)}</p>
      <div id="collection-results">${renderCollectionRows(items, context.query.toString().length > 0)}</div>`,
    mount() {
      const filterForm = document.getElementById('collection-filters');
      const resultsElement = document.getElementById('collection-results');
      const countElement = document.getElementById('collection-result-count');
      let liveFilters;
      const filterToggle = bindFilterToggle({
        button: document.getElementById('collection-filter-toggle'),
        panel: filterForm,
        key: 'collection',
        getActiveCount: () => new Set([...new FormData(filterForm).entries()]
          .filter(([, value]) => String(value || '').length > 0)
          .map(([name]) => name)).size
      });

      const updateResults = (nextItems, hasFilters) => {
        items = nextItems;
        resultsElement.innerHTML = renderCollectionRows(items, hasFilters);
        countElement.textContent = resultCountText(items);
      };

      const loadCurrentResults = async (params = liveFilters?.getParams() || new URLSearchParams(), signal) => {
        const next = await api(`/collection${params.toString() ? `?${params}` : ''}`, { signal });
        updateResults(next.items, params.toString().length > 0);
        filterToggle.updateActiveCount();
      };

      liveFilters = bindLiveFilters({
        form: filterForm,
        routePath: '/collection',
        onApply: loadCurrentResults,
        onError: (error) => toast(error.message || 'Filteren is mislukt.', 'error')
      });

      document.getElementById('collection-filter-reset')?.addEventListener('click', () => {
        resetFilterForm(filterForm);
        liveFilters.apply();
      });

      resultsElement.addEventListener('click', async (event) => {
        const deckButton = event.target.closest('.collection-to-deck');
        const insightButton = event.target.closest('.edit-card-insights');
        const editButton = event.target.closest('.edit-item');
        const deleteButton = event.target.closest('.delete-item');
        const action = deckButton || insightButton || editButton || deleteButton;
        if (!action) return;
        const item = items.find((candidate) => candidate.id === Number(action.dataset.itemId));
        if (!item) return;

        if (deckButton) {
          addCardToDeck(item.card, { onDone: loadCurrentResults });
          return;
        }

        if (insightButton) {
          openCardInsightsEditor(item.card, { onDone: loadCurrentResults });
          return;
        }

        if (editButton) {
          openDialog({
            title: `${item.card.name} bewerken`,
            submitLabel: 'Opslaan',
            content: `<div class="form-grid">
              <div class="field"><label>Aantal</label><input name="quantity" type="number" min="0" value="${item.quantity}" required></div>
              <div class="field"><label>Afwerking</label><select name="finish">${['nonfoil','foil','etched'].map((v) => option(v,v,item.finish)).join('')}</select></div>
              <div class="field"><label>Taal</label><input name="language" value="${escapeHtml(item.language)}"></div>
              <div class="field"><label>Conditie</label><select name="condition">${Object.entries(CONDITION_LABELS).map(([v,l]) => option(v,l,item.condition)).join('')}</select></div>
              <div class="field"><label>Locatie</label><input name="location" value="${escapeHtml(item.location)}"></div>
              <div class="field"><label>Aankoopprijs (€)</label><input name="purchasePrice" type="number" min="0" step="0.01" value="${item.purchasePrice ?? ''}"></div>
              <div class="field full"><label>Opmerkingen</label><textarea name="notes">${escapeHtml(item.notes)}</textarea></div>
            </div>`,
            onSubmit: async (data) => {
              await api(`/collection/${item.id}`, { method: 'PATCH', body: {
                quantity: Number(formValue(data,'quantity')),
                finish: formValue(data,'finish'), language: formValue(data,'language'),
                condition: formValue(data,'condition'), location: formValue(data,'location'),
                purchasePrice: formValue(data,'purchasePrice') || null, notes: formValue(data,'notes')
              }});
              toast(`${item.card.name} is bijgewerkt.`);
              await loadCurrentResults();
              return true;
            }
          });
          return;
        }

        const confirmed = await confirmDialog({ title: 'Collectieregel verwijderen', message: `Weet je zeker dat je ${item.card.name} uit de collectie wilt verwijderen?` });
        if (!confirmed) return;
        await api(`/collection/${item.id}`, { method: 'DELETE' });
        toast(`${item.card.name} is verwijderd.`);
        await loadCurrentResults();
      });
    }
  };
}
