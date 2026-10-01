import { api, queryString } from '../api.js';
import { addCardToWanted } from '../card-actions.js';
import { isBasicLand } from '../card-rules.js';
import { cachedCardImageUrl, cardImage, manaCost, pageHeader, usageBadges } from '../components.js';
import {
  allLanguageOptions,
  defaultLanguage,
  finishOptions,
  languageOptions,
  variantForLanguage
} from '../printing-utils.js';
import { debounce, emptyState, escapeHtml, formValue, openDialog, parseTags, toast } from '../utils.js';
import { applyWriteAvailability } from '../write-access.js';

const ROLE_OPTIONS = [
  ['main', 'Main deck'],
  ['commander', 'Commander'],
  ['partner', 'Tweede commander'],
  ['companion', 'Companion'],
  ['sideboard', 'Sideboard'],
  ['maybeboard', 'Maybeboard']
];

const PRICE_ROWS = [
  ['eur', 'Non-foil'],
  ['eur_foil', 'Foil'],
  ['eur_etched', 'Etched']
];

function printingContainsScryfallId(printing, scryfallId) {
  if (!scryfallId) return false;
  return printing?.scryfallId === scryfallId
    || printing?.variants?.some((variant) => variant.scryfallId === scryfallId);
}

function isLocallyKnownPrinting(printing) {
  return Boolean(printing?.cached
    || printing?.cardId
    || printing?.variants?.some((variant) => variant.cached || variant.cardId));
}

export function preferredPrintingIndex(printings, { scryfallId = '', collectorNumber = '' } = {}) {
  const available = Array.isArray(printings) ? printings : [];
  if (!available.length) return -1;

  const restoredIndex = available.findIndex((printing) => printingContainsScryfallId(printing, scryfallId));
  if (restoredIndex >= 0) return restoredIndex;

  const normalizedCollectorNumber = String(collectorNumber || '').trim();
  const candidates = available
    .map((printing, index) => ({ printing, index }))
    .filter(({ printing }) => !normalizedCollectorNumber
      || String(printing.collectorNumber || '') === normalizedCollectorNumber);
  if (!candidates.length) return -1;

  return (candidates.find(({ printing }) => isLocallyKnownPrinting(printing)) || candidates[0]).index;
}

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(number);
}

function pricesHtml(prices = {}) {
  const rows = PRICE_ROWS
    .filter(([key]) => prices?.[key] !== null && prices?.[key] !== undefined && prices?.[key] !== '')
    .map(([key, label]) => `<div class="printing-price-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatPrice(prices[key]))}</strong></div>`);
  return rows.length
    ? `<div class="printing-price-grid">${rows.join('')}</div>`
    : '<p class="muted printing-price-empty">Voor deze printing is geen EUR-prijs beschikbaar.</p>';
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
            <button class="button primary" type="submit" data-write-action data-add-card-action>Collectie</button>
            ${isBasicLand(card) ? '<button type="button" class="button secondary" disabled title="Basic lands komen niet op Wanted">Wanted</button>' : '<button type="button" id="selected-to-wanted" class="button secondary" data-write-action data-add-card-action>Wanted</button>'}
            <button type="button" id="selected-to-collection-deck" class="button secondary" data-write-action data-add-card-action>Collectie + Deck</button>
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

function collectionImportFormHtml() {
  return `<div id="collection-import-input">
    <p class="form-note">Plak één kaart per regel. Gebruik voor de juiste fysieke printing bij voorkeur <strong>1 Sol Ring (CMM) 396</strong>. Regels zonder set en kaartnummer krijgen eerst een automatisch gekozen printing ter controle.</p>
    <div class="field collection-import-text">
      <label for="collection-import-list">Kaartenlijst</label>
      <textarea id="collection-import-list" name="text" rows="14" required placeholder="1 Sol Ring (CMM) 396\n1 Arcane Signet (CMM) 365\n10 Forest (CMM) 450\n1 Command Tower (CMM) 995 *F*"></textarea>
      <p class="help-text">Ondersteunt ook 1x, koppen zoals Commander, Main en Deck, *F* voor foil en *E* voor etched foil. Kies je een niet-Engelse taal, vermeld dan altijd setcode en kaartnummer.</p>
    </div>
    <div class="form-grid">
      <div class="field"><label for="collection-import-language">Taal</label><select id="collection-import-language" name="language">${allLanguageOptions('en')}</select></div>
      <div class="field"><label for="collection-import-finish">Standaardafwerking</label><select id="collection-import-finish" name="finish">${finishOptions(['nonfoil', 'foil', 'etched'], 'nonfoil')}</select></div>
      <div class="field"><label for="collection-import-condition">Conditie</label><select id="collection-import-condition" name="condition"><option value="near_mint">Near mint</option><option value="mint">Mint</option><option value="excellent">Excellent</option><option value="good">Good</option><option value="light_played">Light played</option><option value="played">Played</option><option value="poor">Poor</option></select></div>
      <div class="field"><label for="collection-import-location">Locatie</label><input id="collection-import-location" name="location" maxlength="200" placeholder="Map, doos of lade"></div>
      <div class="field full"><label for="collection-import-notes">Notitie voor alle kaarten</label><textarea id="collection-import-notes" name="notes" maxlength="5000" placeholder="Bijvoorbeeld naam of datum van de listing"></textarea></div>
      <label class="checkbox-field full"><input name="reconcileWanted" type="checkbox" checked> Wanted-aantal automatisch verminderen</label>
    </div>
  </div>
  <p id="collection-import-status" class="sr-only" role="status" aria-live="polite"></p>
  <div id="collection-import-preview" role="region" aria-label="Importcontrole" hidden></div>`;
}

function importFailuresHtml(failures = []) {
  if (!failures.length) return '';
  return `<section class="import-validation-errors">
    <h3>${failures.length} ${failures.length === 1 ? 'regel kan' : 'regels kunnen'} niet worden geïmporteerd</h3>
    <div class="import-validation-list">${failures.map((failure) => `<div class="import-validation-item">
      <strong>${failure.lineNumber || failure.line ? `Regel ${Number(failure.lineNumber || failure.line)}: ` : ''}${escapeHtml(failure.rawLine || failure.name || 'Onbekende regel')}</strong>
      <span>${escapeHtml(failure.reason || failure.message || 'Kaart of printing niet gevonden.')}</span>
    </div>`).join('')}</div>
  </section>`;
}

function importPreviewHtml(preview, defaults = {}) {
  const items = preview.items || [];
  const totalQuantity = Number(preview.summary?.totalQuantity ?? items.reduce((total, item) => total + Number(item.quantity || 0), 0));
  const inferredCount = Number(preview.summary?.inferredCount ?? items.filter((item) => item.inferredPrinting || item.inferred).length);
  const rows = items.map((item) => {
    const card = item.card || item;
    const setCode = String(item.setCode || card.setCode || '').toUpperCase();
    const collectorNumber = item.collectorNumber || card.collectorNumber || '';
    const inferred = Boolean(item.inferredPrinting || item.inferred);
    return `<tr>
      <td><strong>${Number(item.quantity || 0)}×</strong></td>
      <td>${escapeHtml(item.name || card.name || '')}${inferred ? '<small class="import-inferred">Automatisch gekozen</small>' : ''}</td>
      <td>${escapeHtml(setCode)} #${escapeHtml(collectorNumber)}</td>
      <td>${escapeHtml(item.finish || 'nonfoil')}</td>
    </tr>`;
  }).join('');
  return `<div class="import-preview-summary">
    <h3 class="import-preview-title" tabindex="-1">Import controleren</h3>
    <p class="form-note"><strong>${totalQuantity} kaarten</strong> worden vanuit ${items.length} lijstregels toegevoegd of opgehoogd.</p>
    <p class="import-preview-defaults">Taal: <strong>${escapeHtml(String(defaults.language || 'en').toUpperCase())}</strong> · Conditie: <strong>${escapeHtml(defaults.condition || 'near_mint')}</strong>${defaults.location ? ` · Locatie: <strong>${escapeHtml(defaults.location)}</strong>` : ''} · Wanted verminderen: <strong>${defaults.reconcileWanted ? 'ja' : 'nee'}</strong>${defaults.notes ? ` · Notitie: <strong>${escapeHtml(defaults.notes)}</strong>` : ''}</p>
    ${inferredCount ? `<p class="import-warning"><strong>Controleer de automatisch gekozen printings.</strong> Voor ${inferredCount} ${inferredCount === 1 ? 'regel ontbrak' : 'regels ontbraken'} een set en kaartnummer.</p>` : ''}
    <div class="import-preview-scroll"><table class="import-preview-table">
      <caption class="sr-only">Gecontroleerde kaarten die worden geïmporteerd</caption>
      <thead><tr><th>Aantal</th><th>Kaart</th><th>Printing</th><th>Afwerking</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="form-actions"><button id="collection-import-back" type="button" class="button secondary">Lijst aanpassen</button></div>
  </div>`;
}

export async function renderAddCard(context) {
  const initialQuery = context.query.get('q') || '';
  const initialName = context.query.get('name') || '';
  const initialPrinting = context.query.get('printing') || '';
  const initialCollectorNumber = context.query.get('collectorNumber') || '';
  let selectedCard = null;
  let selectedPrinting = null;
  let loadedPrintings = [];
  let actionsLocked = false;

  return {
    html: `
      ${pageHeader({
        eyebrow: 'Snelle invoer',
        title: 'Kaart opzoeken',
        description: 'Zoek op naam, kies de juiste set en selecteer daarna taal en afwerking.',
        actions: '<button id="import-collection-list" class="button secondary" type="button" data-write-action>Importeren</button>'
      })}
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
      let printingLoadSequence = 0;
      let printingSelectionSequence = 0;
      let suggestionSequence = 0;

      const setAddActionsLocked = (locked) => {
        actionsLocked = Boolean(locked);
        const actions = panel.querySelector('.add-card-actions');
        actions?.classList.toggle('is-locked', actionsLocked);
        panel.querySelectorAll('[data-add-card-action], #selected-to-wanted').forEach((button) => {
          button.dataset.writeInitiallyDisabled = actionsLocked ? 'true' : 'false';
          button.disabled = actionsLocked;
        });
        applyWriteAvailability(panel);
      };

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

      const currentCollectionPayload = (form, {
        card = selectedCard,
        printing = selectedPrinting
      } = {}) => {
        const data = new FormData(form);
        const language = formValue(data, 'language', 'en');
        const variant = variantForLanguage(printing, language, card);
        const identifier = variant?.cardId
          ? { cardId: Number(variant.cardId) }
          : variant?.scryfallId
            ? { scryfallId: variant.scryfallId }
            : { setCode: printing.setCode, collectorNumber: printing.collectorNumber, language };
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

      const selectionIsCurrent = (form, printingKey) => Boolean(
        form
        && document.body.contains(form)
        && form === document.getElementById('add-collection-form')
        && selectedPrinting?.printingKey === printingKey
      );

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

      const openCollectionImportDialog = () => {
        let preparedPayload = null;
        let previewReady = false;
        const dialog = openDialog({
          title: 'Kaartenlijst importeren',
          submitLabel: 'Controleren',
          cancelLabel: 'Sluiten',
          wide: true,
          initialFocus: '#collection-import-list',
          content: collectionImportFormHtml(),
          onSubmit: async (data, dialogElement) => {
            const input = dialogElement.querySelector('#collection-import-input');
            const previewContainer = dialogElement.querySelector('#collection-import-preview');
            const previewStatus = dialogElement.querySelector('#collection-import-status');
            const submitButton = dialogElement.querySelector('button[type="submit"]');
            const inputControls = [...input.querySelectorAll('input, select, textarea')];
            const setInputLocked = (locked) => inputControls.forEach((control) => { control.disabled = locked; });

            if (!previewReady) {
              preparedPayload = {
                text: formValue(data, 'text'),
                language: formValue(data, 'language', 'en'),
                finish: formValue(data, 'finish', 'nonfoil'),
                condition: formValue(data, 'condition', 'near_mint'),
                location: formValue(data, 'location'),
                notes: formValue(data, 'notes'),
                reconcileWanted: data.has('reconcileWanted')
              };
              setInputLocked(true);
              let preview;
              try {
                preview = await api('/collection/import/preview', {
                  method: 'POST',
                  body: preparedPayload
                });
              } finally {
                if (dialogElement.open) setInputLocked(false);
              }
              const failures = preview.failures || preview.failed || [];
              previewContainer.hidden = false;
              if (!preview.canImport || failures.length) {
                previewContainer.innerHTML = importFailuresHtml(failures);
                previewStatus.textContent = `${failures.length} ${failures.length === 1 ? 'regel bevat' : 'regels bevatten'} een fout.`;
                const errorTitle = previewContainer.querySelector('h3');
                errorTitle?.setAttribute('tabindex', '-1');
                window.requestAnimationFrame(() => errorTitle?.focus());
                preparedPayload = null;
                return false;
              }

              preparedPayload.previewToken = preview.previewToken;
              previewReady = true;
              input.hidden = true;
              previewContainer.innerHTML = importPreviewHtml(preview, preparedPayload);
              previewStatus.textContent = `${Number(preview.summary?.totalQuantity || 0)} kaarten zijn gecontroleerd en klaar om toe te voegen.`;
              window.requestAnimationFrame(() => previewContainer.querySelector('.import-preview-title')?.focus({ preventScroll: true }));
              previewContainer.querySelector('#collection-import-back')?.addEventListener('click', () => {
                previewReady = false;
                preparedPayload = null;
                input.hidden = false;
                previewContainer.hidden = true;
                previewContainer.innerHTML = '';
                previewStatus.textContent = '';
                submitButton.textContent = 'Controleren';
                input.querySelector('textarea')?.focus();
              });
              window.setTimeout(() => { submitButton.textContent = 'Alles toevoegen'; }, 0);
              return false;
            }

            dialogElement.dataset.preventClose = 'true';
            dialogElement.querySelectorAll('button, input, select, textarea').forEach((control) => { control.disabled = true; });
            let result;
            try {
              result = await api('/collection/import', { method: 'POST', body: preparedPayload });
            } catch (error) {
              dialogElement.dataset.preventClose = 'false';
              dialogElement.querySelectorAll('button, input, select, textarea').forEach((control) => { control.disabled = false; });
              const failures = error?.details?.failures || [];
              if (failures.length || error?.status === 409) {
                const currentFailures = failures.length ? failures : [{
                  rawLine: 'Importcontrole verlopen',
                  message: error.message
                }];
                previewReady = false;
                preparedPayload = null;
                input.hidden = false;
                previewContainer.hidden = false;
                previewContainer.innerHTML = importFailuresHtml(currentFailures);
                previewStatus.textContent = 'De import moet opnieuw worden gecontroleerd.';
                const errorTitle = previewContainer.querySelector('h3');
                errorTitle?.setAttribute('tabindex', '-1');
                window.requestAnimationFrame(() => errorTitle?.focus());
                window.setTimeout(() => { submitButton.textContent = 'Controleren'; }, 0);
                return false;
              }
              toast(`${error.message} Controleer je collectie voordat je de import opnieuw probeert.`, error?.status === 0 ? 'warning' : 'error', { position: 'top' });
              dialogElement.close();
              return false;
            }
            const importedQuantity = Number(result.summary?.totalQuantity ?? result.importedQuantity ?? 0);
            const importedItems = Number(result.summary?.collectionItems ?? result.importedCount ?? 0);
            try {
              await refreshSelectedUsage();
            } catch {
              // De import is al atomair bevestigd. Een niet-kritieke refreshfout
              // mag de gebruiker nooit uitnodigen om dezelfde write te herhalen.
            }
            toast(`${importedQuantity} kaarten zijn in ${importedItems} collectieregels toegevoegd of opgehoogd.`, 'success', { position: 'top' });
            return true;
          }
        });
      };

      const openCollectionDeckDialog = async ({ form, card, printingKey, collectionPayload }) => {
        const decks = await api('/decks');
        if (!selectionIsCurrent(form, printingKey)) return;
        if (!decks.length) {
          toast('Maak eerst een deck aan.', 'warning', { position: 'top' });
          return;
        }
        openDialog({
          title: `${card.name} aan collectie en deck toevoegen`,
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
            let result;
            try {
              result = await api('/collection/with-deck', {
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
            } catch (error) {
              if (error?.status === 404) {
                throw new Error('De actieve backend kent de gecombineerde deckactie nog niet. Herstart de Node.js-server en probeer het opnieuw.');
              }
              throw error;
            }
            if (!result?.collectionItem?.id || !result?.deckCard?.id) {
              throw new Error('De server bevestigde de gecombineerde toevoeging niet. Herstart de Node.js-server en probeer het opnieuw.');
            }
            if (selectionIsCurrent(form, printingKey)) {
              await refreshSelectedUsage(result.collectionItem.card || result.deckCard.card || null);
              setAddActionsLocked(true);
            }
            const deckName = decks.find((deck) => deck.id === deckId)?.name || 'het deck';
            toast(`${card.name} is toegevoegd aan je collectie en aan ${deckName}.`, 'success', { position: 'top' });
            return true;
          }
        });
      };

      const scrollActionsIntoView = () => {
        const alignActions = (behavior = 'smooth') => {
          if (!document.body.contains(panel)) return;
          const actions = panel.querySelector('.add-card-actions');
          if (!actions || actions.offsetParent === null) return;
          const rect = actions.getBoundingClientRect();
          const topBoundary = 18;
          const bottomBoundary = window.innerHeight - 18;
          if (rect.top < topBoundary || rect.bottom > bottomBoundary) {
            actions.scrollIntoView({ behavior, block: 'center' });
          }
        };

        requestAnimationFrame(() => requestAnimationFrame(() => alignActions('smooth')));
        const image = panel.querySelector('.preview-image');
        if (image && !image.complete) {
          image.addEventListener('load', () => alignActions('smooth'), { once: true });
          image.addEventListener('error', () => alignActions('auto'), { once: true });
        }
        // Fonts and cached images can still change the panel height shortly after render.
        [180, 500, 900].forEach((delay) => window.setTimeout(() => alignActions('auto'), delay));
      };

      const bindSelectedActions = () => {
        const form = document.getElementById('add-collection-form');
        if (!form || !selectedCard || !selectedPrinting) return;

        const boundPrintingKey = selectedPrinting.printingKey;
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
            if (currentSequence !== languagePreviewSequence
              || languageSelect.value !== selectedLanguage
              || selectedPrinting?.printingKey !== boundPrintingKey
              || form !== document.getElementById('add-collection-form')) return;
            selectedCard = exactVariant;
            panel.querySelectorAll('[data-card-detail-link]').forEach((link) => link.setAttribute('href', `#/cards/${Number(exactVariant.id)}`));
          } catch {
            // De gekozen taal blijft bruikbaar voor toevoegen; alleen de detailkoppeling
            // valt terug op de representatieve printing wanneer de preview niet laadt.
          }
        });

        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (actionsLocked) return;
          const submittedCard = selectedCard;
          const submittedPrinting = selectedPrinting;
          const submittedPrintingKey = submittedPrinting?.printingKey;
          if (!submittedCard || !submittedPrintingKey) return;
          const payload = currentCollectionPayload(form, {
            card: submittedCard,
            printing: submittedPrinting
          });
          const button = form.querySelector('[type="submit"]');
          setAddActionsLocked(true);
          button.textContent = 'Toevoegen…';
          let succeeded = false;
          try {
            const added = await api('/collection', { method: 'POST', body: payload });
            if (selectionIsCurrent(form, submittedPrintingKey)) {
              await refreshSelectedUsage(added.card || null);
            }
            toast(`${submittedCard.name} is aan je collectie toegevoegd.`, 'success', { position: 'top' });
            succeeded = true;
          } catch (error) {
            toast(error.message, 'error', { position: 'top' });
          } finally {
            if (document.body.contains(button)) {
              button.textContent = 'Collectie';
              if (!succeeded) setAddActionsLocked(false);
            }
          }
        });

        document.getElementById('selected-to-wanted')?.addEventListener('click', () => {
          const wantedCard = selectedCard;
          const wantedPrintingKey = selectedPrinting?.printingKey;
          if (!wantedCard || !wantedPrintingKey) return;
          const data = new FormData(form);
          addCardToWanted(wantedCard, {
            quantity: Number(formValue(data, 'quantity', '1')),
            toastOptions: { position: 'top' },
            onDone: async () => {
              if (!selectionIsCurrent(form, wantedPrintingKey)) return;
              await refreshSelectedUsage();
              setAddActionsLocked(true);
            }
          });
        });

        document.getElementById('selected-to-collection-deck')?.addEventListener('click', () => {
          const deckCard = selectedCard;
          const deckPrinting = selectedPrinting;
          const deckPrintingKey = deckPrinting?.printingKey;
          if (!deckCard || !deckPrintingKey) return;
          const collectionPayload = currentCollectionPayload(form, {
            card: deckCard,
            printing: deckPrinting
          });
          openCollectionDeckDialog({
            form,
            card: deckCard,
            printingKey: deckPrintingKey,
            collectionPayload
          }).catch((error) => toast(error.message, 'error', { position: 'top' }));
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

      const choosePrinting = async (button, {
        updateRoute = true,
        scrollToActions = true,
        loadSequence = printingLoadSequence
      } = {}) => {
        if (loadSequence !== printingLoadSequence) return;
        const index = Number(button.dataset.printingIndex);
        const nextPrinting = loadedPrintings[index];
        if (!nextPrinting) return;
        setAddActionsLocked(false);
        if (selectedPrinting?.printingKey === nextPrinting.printingKey && panel.querySelector('#add-collection-form')) {
          if (updateRoute) updateAddRoute({ name: search.value.trim(), printing: selectedPrinting.scryfallId });
          if (scrollToActions) scrollActionsIntoView();
          return;
        }
        const selectionSequence = ++printingSelectionSequence;
        selectedPrinting = nextPrinting;
        list.querySelectorAll('.printing-card').forEach((item) => {
          item.disabled = true;
          item.classList.toggle('selected', item === button);
        });
        if (updateRoute) updateAddRoute({ name: search.value.trim(), printing: selectedPrinting.scryfallId });
        panel.innerHTML = '<div class="panel"><div class="page-loading"><span class="spinner"></span><p>Printinginformatie laden…</p></div></div>';
        try {
          const previewCard = await api(`/cards/preview/${encodeURIComponent(nextPrinting.scryfallId)}`);
          if (loadSequence !== printingLoadSequence
            || selectionSequence !== printingSelectionSequence
            || selectedPrinting?.printingKey !== nextPrinting.printingKey) return;
          selectedCard = previewCard;
          panel.innerHTML = selectedPanel(selectedCard, selectedPrinting);
          bindSelectedActions();
          setAddActionsLocked(false);
          if (scrollToActions) scrollActionsIntoView();
        } catch (error) {
          if (loadSequence !== printingLoadSequence || selectionSequence !== printingSelectionSequence) return;
          toast(error.message, 'error', { position: 'top' });
          selectedPrinting = null;
          list.querySelectorAll('.printing-card').forEach((item) => item.classList.remove('selected'));
          panel.innerHTML = selectedPanel(null, null);
          if (updateRoute) updateAddRoute({ name: search.value.trim(), printing: '' });
        } finally {
          if (loadSequence === printingLoadSequence && selectionSequence === printingSelectionSequence) {
            list.querySelectorAll('button').forEach((item) => { item.disabled = false; });
          }
        }
      };

      const resetSelection = () => {
        actionsLocked = false;
        selectedCard = null;
        selectedPrinting = null;
        panel.innerHTML = selectedPanel(null, null);
      };

      const loadPrintings = async (name, { restorePrinting = '', restoreCollectorNumber = '' } = {}) => {
        const loadSequence = ++printingLoadSequence;
        printingSelectionSequence += 1;
        suggestionSequence += 1;
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
          if (loadSequence !== printingLoadSequence) return;
          loadedPrintings = response.data || response;
          populateCollectorNumbers(restoreCollectorNumber);
          renderPrintingList();

          const preferredIndex = preferredPrintingIndex(loadedPrintings, {
            scryfallId: restorePrinting,
            collectorNumber: collectorSelect.value
          });
          if (preferredIndex >= 0) {
            const printing = loadedPrintings[preferredIndex];
            const restoresDifferentCollectorNumber = restorePrinting
              && printingContainsScryfallId(printing, restorePrinting)
              && collectorSelect.value
              && String(printing.collectorNumber) !== collectorSelect.value;
            if (restoresDifferentCollectorNumber) {
              populateCollectorNumbers(printing.collectorNumber);
              renderPrintingList();
            }
            const preferredButton = list.querySelector(`[data-printing-index="${preferredIndex}"]`);
            if (preferredButton) {
              await choosePrinting(preferredButton, {
                updateRoute: false,
                scrollToActions: false,
                loadSequence
              });
            }
          }
          if (loadSequence !== printingLoadSequence) return;
          updateAddRoute({ name, printing: selectedPrinting?.scryfallId || '' });
        } catch (error) {
          if (loadSequence !== printingLoadSequence) return;
          status.hidden = false;
          status.textContent = error.message;
        }
      };

      const suggest = debounce(async () => {
        const query = search.value.trim();
        if (query.length < 2) {
          suggestionSequence += 1;
          suggestions.hidden = true;
          return;
        }
        const currentSuggestionSequence = ++suggestionSequence;
        try {
          const response = await api(`/cards/autocomplete${queryString({ q: query })}`);
          if (currentSuggestionSequence !== suggestionSequence || search.value.trim() !== query) return;
          const names = response.data || response;
          suggestions.innerHTML = names.map((name) => `<button type="button" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join('');
          suggestions.hidden = !names.length;
          suggestions.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => loadPrintings(button.dataset.name)));
        } catch (error) {
          if (currentSuggestionSequence !== suggestionSequence || search.value.trim() !== query) return;
          suggestions.innerHTML = `<div class="picker-status">${escapeHtml(error.message)}</div>`;
          suggestions.hidden = false;
        }
      }, 220);

      collectorSelect.addEventListener('change', async () => {
        const collectorNumber = collectorSelect.value;
        const selectedRemainsVisible = selectedPrinting
          && (!collectorNumber || String(selectedPrinting.collectorNumber || '') === collectorNumber);

        if (selectedRemainsVisible) {
          renderPrintingList();
          updateAddRoute();
          return;
        }

        // Een kaartnummerfilter mag geen eerder gekozen, nu verborgen printing
        // in het rechterpaneel laten staan. Annuleer een eventueel lopende
        // preview en kies binnen het nieuwe filter opnieuw zonder te scrollen.
        printingSelectionSequence += 1;
        resetSelection();
        renderPrintingList();
        const preferredIndex = preferredPrintingIndex(loadedPrintings, { collectorNumber });
        const preferredButton = preferredIndex >= 0
          ? list.querySelector(`[data-printing-index="${preferredIndex}"]`)
          : null;
        if (preferredButton) {
          await choosePrinting(preferredButton, { scrollToActions: false });
          return;
        }
        updateAddRoute({ printing: '' });
      });
      document.getElementById('import-collection-list')?.addEventListener('click', openCollectionImportDialog);
      search.addEventListener('input', () => {
        // Verberg resultaten van de vorige zoekterm direct. Zo kan Enter niet
        // in het debouncevenster per ongeluk nog een oude suggestie kiezen en
        // kan een eerder gestart printingverzoek de nieuwe zoekterm niet winnen.
        printingLoadSequence += 1;
        printingSelectionSequence += 1;
        suggestionSequence += 1;
        resetSelection();
        loadedPrintings = [];
        collectorSelect.disabled = true;
        collectorSelect.innerHTML = '<option value="">Alle kaartnummers</option>';
        list.innerHTML = '';
        status.hidden = false;
        status.textContent = search.value.trim().length >= 2
          ? 'Kies een kaartnaam uit de zoeksuggesties.'
          : 'Typ minimaal twee letters om een kaart te zoeken.';
        suggestions.hidden = true;
        suggestions.innerHTML = '';
        updateAddRoute({ name: '', printing: '', collectorNumber: '' });
        suggest();
      });
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
