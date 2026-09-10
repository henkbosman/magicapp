import { api, queryString } from './api.js';
import { cachedCardImageUrl, cardImage, manaCost } from './components.js';
import { debounce, escapeHtml, openDialog, toast } from './utils.js';

function localSuggestionHtml(card, index) {
  const owned = Number(card.usage?.owned || 0);
  return `<button type="button" class="picker-card-suggestion" data-local-index="${index}">
    ${cardImage(card, { className: 'picker-card-image' })}
    <span class="picker-card-copy">
      <span class="picker-card-title"><strong>${escapeHtml(card.name)}</strong>${manaCost(card.manaCost)}</span>
      <small>${escapeHtml(card.typeLine)} · ${escapeHtml(card.setCode.toUpperCase())} #${escapeHtml(card.collectorNumber)}</small>
      <span class="picker-card-badges">${owned > 0 ? `<span class="badge owned">In collectie <strong>${owned}</strong></span>` : '<span class="badge neutral">Lokaal bekend</span>'}</span>
    </span>
  </button>`;
}

export function pickCard({ title = 'Kies een kaart', initialQuery = '', preferCollection = false, singlePrinting = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let selectedName = '';
    let loadedPrintings = [];
    let loadedLocalCards = [];
    const dialog = openDialog({
      title,
      wide: true,
      cancelLabel: 'Sluiten',
      content: `
        <div class="field autocomplete-wrap">
          <label for="picker-search">Kaartnaam</label>
          <input id="picker-search" name="search" type="search" autocomplete="off" placeholder="Bijvoorbeeld Eternal Witness" value="${escapeHtml(initialQuery)}">
          <div id="picker-suggestions" class="autocomplete-list picker-suggestion-list" hidden></div>
        </div>
        <div id="picker-status" class="picker-status">${preferCollection
          ? 'Typ minimaal twee letters. Kaarten uit je collectie worden als eerste aangeboden.'
          : 'Typ minimaal twee letters om Scryfall en de lokale database te doorzoeken.'}</div>
        <div id="picker-results" class="printing-grid"></div>`
    });
    const search = dialog.querySelector('#picker-search');
    const suggestions = dialog.querySelector('#picker-suggestions');
    const status = dialog.querySelector('#picker-status');
    const results = dialog.querySelector('#picker-results');

    const finish = (card) => {
      settled = true;
      resolve(card);
      dialog.close();
    };
    dialog.addEventListener('close', () => {
      if (!settled) resolve(null);
    }, { once: true });

    const choosePrinting = async (button) => {
      const printing = loadedPrintings[Number(button.dataset.printingIndex)];
      if (!printing) return;
      const buttons = [...results.querySelectorAll('button')];
      buttons.forEach((item) => { item.disabled = true; });
      button.classList.add('selected');
      try {
        const body = printing.cardId
          ? { cardId: Number(printing.cardId) }
          : { scryfallId: printing.scryfallId };
        const card = await api('/cards/cache', { method: 'POST', body });
        finish(card);
      } catch (error) {
        toast(error.message, 'error');
        buttons.forEach((item) => { item.disabled = false; });
      }
    };

    const loadPrintings = async (name) => {
      selectedName = name;
      search.value = name;
      suggestions.hidden = true;
      status.hidden = false;
      status.innerHTML = '<span class="spinner"></span><p>Printings laden…</p>';
      results.innerHTML = '';
      try {
        const response = await api(`/cards/printings${queryString({ name })}`);
        const allPrintings = response.data || response;
        loadedPrintings = singlePrinting ? allPrintings.slice(0, 1) : allPrintings;
        status.hidden = true;
        if (!loadedPrintings.length) {
          status.hidden = false;
          status.textContent = 'Geen printings gevonden.';
          return;
        }
        results.innerHTML = loadedPrintings.map((printing, index) => `
          <button type="button" class="printing-card" data-write-action data-printing-index="${index}">
            ${printing.image ? `<img src="${escapeHtml(cachedCardImageUrl(printing.image))}" alt="" loading="lazy">` : `<span class="card-image-placeholder"><span>${escapeHtml(printing.name.slice(0, 1))}</span></span>`}
            <span><strong>${escapeHtml(printing.setName)}</strong><small>${escapeHtml(printing.setCode.toUpperCase())} #${escapeHtml(printing.collectorNumber)} · ${escapeHtml(printing.rarity)}${printing.releasedAt ? ` · ${escapeHtml(printing.releasedAt)}` : ''}</small>${printing.cached ? '<small>Lokaal opgeslagen</small>' : ''}</span>
          </button>`).join('');
        results.querySelectorAll('.printing-card').forEach((button) => button.addEventListener('click', () => choosePrinting(button)));
      } catch (error) {
        status.hidden = false;
        status.textContent = error.message;
      }
    };

    const selectLocalCard = (button) => {
      const card = loadedLocalCards[Number(button.dataset.localIndex)];
      if (card) finish(card);
    };

    const renderSuggestions = (localCards, remoteNames) => {
      loadedLocalCards = [...localCards].sort((a, b) => {
        const ownedDifference = Number(b.usage?.owned || 0) - Number(a.usage?.owned || 0);
        if (ownedDifference) return ownedDifference;
        return a.name.localeCompare(b.name, 'nl');
      });
      const knownNames = new Set(loadedLocalCards.map((card) => card.name.toLocaleLowerCase('nl')));
      const remote = remoteNames.filter((name) => !knownNames.has(String(name).toLocaleLowerCase('nl')));
      const ownedCount = loadedLocalCards.filter((card) => Number(card.usage?.owned || 0) > 0).length;
      const parts = [];
      if (loadedLocalCards.length) {
        parts.push(`<div class="autocomplete-section-label">${ownedCount ? 'Collectie en lokale kaarten' : 'Lokaal bekende kaarten'}</div>`);
        parts.push(loadedLocalCards.map(localSuggestionHtml).join(''));
      }
      if (remote.length) {
        parts.push('<div class="autocomplete-section-label">Andere kaarten via Scryfall</div>');
        parts.push(remote.map((name) => `<button type="button" class="picker-name-suggestion" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join(''));
      }
      suggestions.innerHTML = parts.join('');
      suggestions.hidden = !parts.length;
      suggestions.querySelectorAll('[data-local-index]').forEach((button) => button.addEventListener('click', () => selectLocalCard(button)));
      suggestions.querySelectorAll('[data-name]').forEach((button) => button.addEventListener('click', () => loadPrintings(button.dataset.name)));
    };

    const loadSuggestions = debounce(async () => {
      const query = search.value.trim();
      if (query.length < 2) {
        suggestions.hidden = true;
        return;
      }
      try {
        if (!preferCollection) {
          const response = await api(`/cards/autocomplete${queryString({ q: query })}`);
          const names = response.data || response;
          loadedLocalCards = [];
          suggestions.innerHTML = names.map((name) => `<button type="button" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join('');
          suggestions.hidden = !names.length;
          suggestions.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => loadPrintings(button.dataset.name)));
          return;
        }

        const [localResult, autocompleteResult] = await Promise.allSettled([
          api(`/cards/search${queryString({ q: query, limit: 12 })}`),
          api(`/cards/autocomplete${queryString({ q: query })}`)
        ]);
        const localCards = localResult.status === 'fulfilled' ? (localResult.value.data || localResult.value) : [];
        const remoteNames = autocompleteResult.status === 'fulfilled' ? (autocompleteResult.value.data || autocompleteResult.value) : [];
        if (!localCards.length && !remoteNames.length) {
          const message = autocompleteResult.status === 'rejected'
            ? autocompleteResult.reason.message
            : 'Geen kaarten gevonden.';
          suggestions.innerHTML = `<div class="picker-status">${escapeHtml(message)}</div>`;
          suggestions.hidden = false;
          return;
        }
        renderSuggestions(localCards, remoteNames);
      } catch (error) {
        suggestions.innerHTML = `<div class="picker-status">${escapeHtml(error.message)}</div>`;
        suggestions.hidden = false;
      }
    }, 220);

    search.addEventListener('input', loadSuggestions);
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const first = suggestions.querySelector('button');
        if (first) first.click();
        else if (search.value.trim()) loadPrintings(search.value.trim());
      }
    });
    if (initialQuery.trim().length >= 2) {
      loadSuggestions();
      setTimeout(() => {
        const first = suggestions.querySelector('button');
        if (first && selectedName === '') first.focus();
      }, 350);
    }
  });
}
