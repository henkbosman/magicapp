import { api, apiPath } from '../api.js';
import { createSimulatorLibraryController } from '../simulator-library.js';
import {
  cardImage,
  metric,
  pageHeader
} from '../components.js';
import {
  getDeckSimulatorReturnLabel,
  returnFromDeckSimulator
} from '../navigation-state.js';
import { escapeHtml, openDialog, toast } from '../utils.js';

const SIMULATED_ROLES = new Set(['main']);
const COMMAND_ROLES = new Set(['commander', 'partner', 'companion']);
const MAX_STACK_SIZE = 5;
const ZONE_LABELS = {
  library: 'Library', hand: 'Hand', battlefield: 'Tafel', graveyard: 'Graveyard', exile: 'Exile', command: 'Command zone'
};

function shuffle(values) {
  const items = [...values];
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [items[index], items[swap]] = [items[swap], items[index]];
  }
  return items;
}

function makeInstances(cards) {
  const library = [];
  const command = [];
  for (const item of cards) {
    if (!SIMULATED_ROLES.has(item.role) && !COMMAND_ROLES.has(item.role)) continue;
    for (let copy = 1; copy <= Number(item.quantity || 1); copy += 1) {
      const instance = {
        id: `${item.id}:${copy}`,
        deckCardId: item.id,
        cardId: item.card.id,
        tapped: false
      };
      if (COMMAND_ROLES.has(item.role)) command.push(instance);
      else library.push(instance);
    }
  }
  return { library: shuffle(library), command };
}

function createInitialState(cards) {
  const zones = makeInstances(cards);
  const hand = [];
  for (let index = 0; index < 7 && zones.library.length; index += 1) hand.push(zones.library.pop());
  return {
    zones: {
      library: zones.library,
      hand,
      battlefield: [],
      graveyard: [],
      exile: [],
      command: zones.command
    },
    updatedAt: Date.now()
  };
}

function itemMap(cards) {
  return new Map(cards.map((item) => [Number(item.id), item]));
}

function itemForInstance(instance, byDeckCardId) {
  return byDeckCardId.get(Number(instance?.deckCardId)) || null;
}

function findZone(state, instanceId) {
  for (const [zone, instances] of Object.entries(state.zones)) {
    const index = instances.findIndex((instance) => instance.id === instanceId);
    if (index >= 0) return { zone, index, instance: instances[index] };
  }
  return null;
}

function moveInstance(state, instanceId, targetZone) {
  const found = findZone(state, instanceId);
  if (!found || !Array.isArray(state.zones[targetZone]) || found.zone === targetZone) return false;
  const [instance] = state.zones[found.zone].splice(found.index, 1);
  instance.tapped = false;
  state.zones[targetZone].push(instance);
  state.updatedAt = Date.now();
  return true;
}

function drawTop(state, targetZone = 'hand') {
  if (targetZone === 'library' || !Array.isArray(state.zones[targetZone])) return false;
  const instance = state.zones.library.pop();
  if (!instance) return false;
  instance.tapped = false;
  state.zones[targetZone].push(instance);
  state.updatedAt = Date.now();
  return true;
}

function simulatorCard(instance, zone, byDeckCardId, { stackIndex, stackSize } = {}) {
  const item = itemForInstance(instance, byDeckCardId);
  if (!item) return '';
  const positionLabel = stackSize > 1 ? `, exemplaar ${stackIndex + 1} van ${stackSize}` : '';
  const stateLabel = zone === 'battlefield' ? `, ${instance.tapped ? 'getapt' : 'ongetapt'}` : '';
  const label = `${item.card.name} in ${ZONE_LABELS[zone]}${stateLabel}${positionLabel}`;
  return `<div class="simulator-playing-card ${instance.tapped ? 'tapped' : ''}" data-sim-instance="${escapeHtml(instance.id)}" data-sim-source-zone="${zone}" draggable="true" tabindex="0" role="button" aria-label="${escapeHtml(label)}" title="${escapeHtml(item.card.name)}">
    ${cardImage(item.card, { className: 'sim-playing-card-image' })}
  </div>`;
}

function battlefieldIdentity(card, instance) {
  // cardKey normally contains the Oracle ID, but falls back to a printing ID
  // for older records. Prefer the name over that printing-specific fallback.
  const oracleId = String(card?.oracleId || (card?.cardKey !== card?.scryfallId ? card?.cardKey : '') || '').trim().toLowerCase();
  if (oracleId) return `oracle:${oracleId}`;
  const name = String(card?.name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (name) return `name:${name}`;
  return `instance:${instance.id}`;
}

function battlefieldStacksHtml(instances, byDeckCardId) {
  const groups = new Map();
  for (const instance of instances) {
    const item = itemForInstance(instance, byDeckCardId);
    if (!item) continue;
    const key = JSON.stringify([battlefieldIdentity(item.card, instance), Boolean(instance.tapped)]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(instance);
  }

  const stacks = [];
  for (const group of groups.values()) {
    // Every copy stays individually visible, focusable and draggable. Limiting
    // each pile prevents large land groups from covering their own controls.
    for (let offset = 0; offset < group.length; offset += MAX_STACK_SIZE) {
      const stack = group.slice(offset, offset + MAX_STACK_SIZE);
      const item = itemForInstance(stack[0], byDeckCardId);
      const tapped = Boolean(stack[0].tapped);
      const label = `${stack.length} × ${item.card.name} · ${tapped ? 'getapt' : 'ongetapt'}`;
      stacks.push(`<div class="simulator-card-stack${tapped ? ' is-tapped' : ''}" role="group" aria-label="${escapeHtml(label)}" style="--sim-stack-count: ${stack.length}">
        <div class="simulator-stack-cards">${stack.map((instance, stackIndex) => `<div class="simulator-stack-slot" style="--sim-stack-index: ${stackIndex}">${simulatorCard(instance, 'battlefield', byDeckCardId, { stackIndex, stackSize: stack.length })}</div>`).join('')}</div>
        ${stack.length > 1 ? `<span class="simulator-stack-count" aria-hidden="true">${stack.length}</span>` : ''}
      </div>`);
    }
  }
  return stacks.join('');
}

function zoneHtml(zone, instances, byDeckCardId, { empty = 'Sleep kaarten hierheen.' } = {}) {
  return `<section class="simulator-zone simulator-zone-${zone}" data-sim-dropzone="${zone}">
    <header><h2>${escapeHtml(ZONE_LABELS[zone])}</h2><span>${instances.length}</span></header>
    <div class="simulator-zone-cards">${instances.length
      ? zone === 'battlefield'
        ? battlefieldStacksHtml(instances, byDeckCardId)
        : instances.map((instance) => simulatorCard(instance, zone, byDeckCardId)).join('')
      : `<p class="simulator-zone-empty">${escapeHtml(empty)}</p>`}</div>
  </section>`;
}

function libraryPileHtml(state) {
  return `<section class="simulator-zone simulator-library-zone" data-sim-dropzone="library">
    <header><h2>Library</h2><span>${state.zones.library.length}</span></header>
    <div class="library-pile-wrap">
      <div class="library-pile ${state.zones.library.length ? '' : 'empty'}" data-sim-library-source draggable="${state.zones.library.length ? 'true' : 'false'}" tabindex="0" role="button" aria-haspopup="menu" aria-label="Library-acties; klik of gebruik de rechtermuisknop" title="Klik of rechtermuisknop voor library-acties; sleep de bovenste kaart naar een zone">
        <span class="library-card-back" aria-hidden="true"><i></i></span>
        <span class="library-pile-count">${state.zones.library.length}</span>
      </div>
    </div>
  </section>`;
}

function openSimulatorCardZoom(item) {
  const card = item?.card;
  if (!card) return null;
  const revision = encodeURIComponent(`${card.scryfallId || ''}:${card.updatedAt || ''}`);
  const front = apiPath(`/cards/${card.id}/image?face=front&size=large&v=${revision}`);
  const hasBack = Boolean(card.images?.backLarge || card.images?.backNormal || card.images?.backSmall || card.images?.backPng);
  const back = hasBack
    ? apiPath(`/cards/${card.id}/image?face=back&size=large&v=${revision}`)
    : '';
  return openDialog({
    title: card.name,
    cancelLabel: 'Sluiten',
    wide: hasBack,
    content: `<div class="simulator-card-zoom ${hasBack ? 'has-back' : ''}">
      <figure><img src="${escapeHtml(front)}" alt="${escapeHtml(card.name)}"><figcaption>Voorzijde</figcaption></figure>
      ${hasBack ? `<figure><img src="${escapeHtml(back)}" alt="${escapeHtml(`Achterzijde van ${card.name}`)}"><figcaption>Achterzijde</figcaption></figure>` : ''}
    </div>`
  });
}

function tableHtml(state, byDeckCardId) {
  return `<div class="simulator-layout">
    <div class="simulator-table" aria-label="Drag-and-drop speeltafel">
      <div class="simulator-top-zones">
        ${libraryPileHtml(state)}
        ${zoneHtml('graveyard', state.zones.graveyard, byDeckCardId)}
        ${zoneHtml('exile', state.zones.exile, byDeckCardId)}
        ${zoneHtml('command', state.zones.command, byDeckCardId, { empty: 'Geen commander of companion.' })}
      </div>
      ${zoneHtml('battlefield', state.zones.battlefield, byDeckCardId)}
      ${zoneHtml('hand', state.zones.hand, byDeckCardId)}
    </div>
  </div>`;
}

function clearDropHighlights(scope = document) {
  scope.querySelectorAll('.sim-drop-active, .sim-drop-hover').forEach((element) => {
    element.classList.remove('sim-drop-active', 'sim-drop-hover');
  });
}

function installNativeDrag(root, onDrop, onDragComplete) {
  let payload = null;
  root.addEventListener('dragstart', (event) => {
    const card = event.target.closest('[data-sim-instance]');
    const library = event.target.closest('[data-sim-library-source]');
    if (!card && !library) return;
    payload = card ? { type: 'instance', id: card.dataset.simInstance } : { type: 'library' };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', card ? `instance:${card.dataset.simInstance}` : 'library');
    (card || library).classList.add('sim-dragging');
    root.querySelectorAll('[data-sim-dropzone]').forEach((zone) => zone.classList.add('sim-drop-active'));
  });
  root.addEventListener('dragover', (event) => {
    const zone = event.target.closest('[data-sim-dropzone]');
    if (!zone || !payload) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    root.querySelectorAll('.sim-drop-hover').forEach((entry) => entry.classList.remove('sim-drop-hover'));
    zone.classList.add('sim-drop-hover');
  });
  root.addEventListener('drop', (event) => {
    const zone = event.target.closest('[data-sim-dropzone]');
    if (!zone || !payload) return;
    event.preventDefault();
    onDrop(payload, zone.dataset.simDropzone);
    onDragComplete();
    payload = null;
    clearDropHighlights(root);
  });
  root.addEventListener('dragend', () => {
    if (payload) onDragComplete();
    payload = null;
    root.querySelectorAll('.sim-dragging').forEach((element) => element.classList.remove('sim-dragging'));
    clearDropHighlights(root);
  });
}

function installTouchDrag(root, onDrop, onDragComplete) {
  let pending = null;
  let drag = null;
  let holdTimer = null;

  const cleanup = () => {
    clearTimeout(holdTimer);
    holdTimer = null;
    drag?.ghost?.remove();
    drag?.source?.classList.remove('sim-dragging');
    drag = null;
    pending = null;
    clearDropHighlights(root);
    document.body.classList.remove('simulator-touch-dragging');
  };

  const start = () => {
    if (!pending) return;
    const source = pending.source;
    const ghost = source.cloneNode(true);
    ghost.classList.add('sim-drag-ghost');
    ghost.removeAttribute('data-sim-instance');
    ghost.removeAttribute('data-sim-library-source');
    ghost.style.left = `${pending.startX}px`;
    ghost.style.top = `${pending.startY}px`;
    document.body.append(ghost);
    source.classList.add('sim-dragging');
    root.querySelectorAll('[data-sim-dropzone]').forEach((zone) => zone.classList.add('sim-drop-active'));
    document.body.classList.add('simulator-touch-dragging');
    drag = { ...pending, ghost };
    pending = null;
  };

  root.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') return;
    const card = event.target.closest('[data-sim-instance]');
    const library = event.target.closest('[data-sim-library-source]');
    if (!card && !library) return;
    pending = {
      pointerId: event.pointerId,
      source: card || library,
      payload: card ? { type: 'instance', id: card.dataset.simInstance } : { type: 'library' },
      startX: event.clientX,
      startY: event.clientY
    };
    try {
      root.setPointerCapture(event.pointerId);
    } catch {
      // Some browsers do not expose pointer capture for delegated targets.
    }
    holdTimer = window.setTimeout(start, 220);
  });

  root.addEventListener('pointermove', (event) => {
    if (pending && pending.pointerId === event.pointerId) {
      const distance = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
      if (distance > 10) cleanup();
      return;
    }
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    drag.ghost.style.left = `${event.clientX}px`;
    drag.ghost.style.top = `${event.clientY}px`;
    drag.ghost.hidden = true;
    const element = document.elementFromPoint(event.clientX, event.clientY);
    drag.ghost.hidden = false;
    const zone = element?.closest?.('[data-sim-dropzone]');
    root.querySelectorAll('.sim-drop-hover').forEach((entry) => entry.classList.remove('sim-drop-hover'));
    zone?.classList.add('sim-drop-hover');
  }, { passive: false });

  const finish = (event) => {
    if (pending && pending.pointerId === event.pointerId) {
      cleanup();
      return;
    }
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.ghost.hidden = true;
    const element = document.elementFromPoint(event.clientX, event.clientY);
    drag.ghost.hidden = false;
    const zone = element?.closest?.('[data-sim-dropzone]');
    if (zone) onDrop(drag.payload, zone.dataset.simDropzone);
    onDragComplete();
    cleanup();
  };
  root.addEventListener('pointerup', finish);
  root.addEventListener('pointercancel', () => {
    if (drag) onDragComplete();
    cleanup();
  });
  return cleanup;
}

function installSimulatorDrag(root, onDrop, onDragComplete = () => {}) {
  installNativeDrag(root, onDrop, onDragComplete);
  return installTouchDrag(root, onDrop, onDragComplete);
}

function librarySearchDialog(state, byDeckCardId, onMove) {
  const rows = state.zones.library
    .map((instance) => ({ instance, item: itemForInstance(instance, byDeckCardId) }))
    .filter((entry) => entry.item)
    .sort((left, right) => left.item.card.name.localeCompare(right.item.card.name, 'nl'));
  const dialog = openDialog({
    title: 'Library doorzoeken',
    cancelLabel: 'Sluiten',
    wide: true,
    content: `<div class="field"><label>Kaartnaam</label><input id="sim-library-filter" type="search" autocomplete="off" placeholder="Filter library..."></div>
      <div class="sim-library-dialog-targets"><div data-library-dialog-target="hand">Hand</div><div data-library-dialog-target="battlefield">Tafel</div><div data-library-dialog-target="graveyard">Graveyard</div><div data-library-dialog-target="exile">Exile</div></div>
      <div id="sim-library-results" class="sim-library-image-grid">${rows.map(({ item, instance }) => `<div class="sim-library-image-card" data-library-search-row data-search="${escapeHtml(item.card.name.toLocaleLowerCase('nl'))}" data-library-instance="${escapeHtml(instance.id)}" draggable="true" tabindex="0" title="${escapeHtml(item.card.name)}">
          ${cardImage(item.card, { className: 'sim-library-card-image' })}
        </div>`).join('')}</div>`
  });
  const filter = dialog.querySelector('#sim-library-filter');
  filter?.addEventListener('input', () => {
    const query = filter.value.trim().toLocaleLowerCase('nl');
    dialog.querySelectorAll('[data-library-search-row]').forEach((row) => {
      row.hidden = Boolean(query) && !String(row.dataset.search || '').includes(query);
    });
  });

  let instanceId = null;
  let selectedInstanceId = null;
  const selectCard = (card) => {
    dialog.querySelectorAll('[data-library-instance].selected').forEach((entry) => entry.classList.remove('selected'));
    selectedInstanceId = card?.dataset.libraryInstance || null;
    card?.classList.add('selected');
  };
  dialog.addEventListener('click', (event) => {
    const card = event.target.closest('[data-library-instance]');
    if (card) {
      selectCard(card);
      return;
    }
    const target = event.target.closest('[data-library-dialog-target]');
    if (!target || !selectedInstanceId) return;
    onMove(selectedInstanceId, target.dataset.libraryDialogTarget);
    dialog.close();
  });
  dialog.addEventListener('keydown', (event) => {
    const card = event.target.closest('[data-library-instance]');
    if (!card || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    selectCard(card);
  });
  dialog.addEventListener('dragstart', (event) => {
    const card = event.target.closest('[data-library-instance]');
    if (!card) return;
    instanceId = card.dataset.libraryInstance;
    card.classList.add('sim-dragging');
    dialog.querySelectorAll('[data-library-dialog-target]').forEach((target) => target.classList.add('sim-drop-active'));
    event.dataTransfer.setData('text/plain', instanceId);
  });
  dialog.addEventListener('dragover', (event) => {
    const target = event.target.closest('[data-library-dialog-target]');
    if (!target || !instanceId) return;
    event.preventDefault();
    dialog.querySelectorAll('.sim-drop-hover').forEach((entry) => entry.classList.remove('sim-drop-hover'));
    target.classList.add('sim-drop-hover');
  });
  dialog.addEventListener('drop', (event) => {
    const target = event.target.closest('[data-library-dialog-target]');
    if (!target || !instanceId) return;
    event.preventDefault();
    onMove(instanceId, target.dataset.libraryDialogTarget);
    dialog.close();
  });
  dialog.addEventListener('dragend', () => {
    instanceId = null;
    clearDropHighlights(dialog);
  });
  return dialog;
}

function metricsHtml(state) {
  return [
    metric('Library', state.zones.library.length, 'Kaarten over'),
    metric('Hand', state.zones.hand.length, 'Kaarten in hand'),
    metric('Tafel', state.zones.battlefield.length, 'Kaarten op tafel'),
    metric('Graveyard', state.zones.graveyard.length, 'Kaarten in graveyard'),
    metric('Exile', state.zones.exile.length, 'Kaarten in exile')
  ].join('');
}

export async function renderDeckSimulator(context) {
  const deckId = Number(context.params.id);
  const returnToken = context.query.get('return') || '';
  const [deck, cards] = await Promise.all([
    api(`/decks/${deckId}`),
    api(`/decks/${deckId}/cards`)
  ]);
  const byDeckCardId = itemMap(cards);
  let state = createInitialState(cards);

  return {
    html: `${pageHeader({
      eyebrow: `${deck.format} · Speeltest`,
      title: `${deck.name} - Goldfishing`,
      description: 'Sleep kaarten vrij tussen library, hand, tafel, command zone, graveyard en exile.',
      actions: `<button id="simulator-back" class="button secondary" type="button">← ${escapeHtml(getDeckSimulatorReturnLabel(returnToken))}</button><button id="sim-reset" class="button secondary" type="button">Reset</button>`
    })}
    <section class="simulator-metrics metrics-grid">${metricsHtml(state)}</section>
    <div id="deck-simulator-root">${tableHtml(state, byDeckCardId)}</div>`,
    mount() {
      const root = document.getElementById('deck-simulator-root');
      let disposed = false;
      let cardClickTimer = null;
      let suppressCardZoomUntil = 0;
      let libraryController = null;
      const listeners = [];
      const dialogs = new Set();
      const listen = (element, type, handler) => {
        if (!element) return;
        element.addEventListener(type, handler);
        listeners.push(() => element.removeEventListener(type, handler));
      };
      const trackDialog = (dialog) => {
        if (!dialog) return null;
        dialogs.add(dialog);
        dialog.addEventListener('close', () => dialogs.delete(dialog), { once: true });
        return dialog;
      };
      const openCardZoom = (item) => disposed ? null : trackDialog(openSimulatorCardZoom(item));
      const render = () => {
        if (disposed) return;
        libraryController?.closeMenu();
        if (root) root.innerHTML = tableHtml(state, byDeckCardId);
        const metrics = document.querySelector('.simulator-metrics');
        if (metrics) metrics.innerHTML = metricsHtml(state);
      };
      libraryController = createSimulatorLibraryController({
        getState: () => state,
        byDeckCardId,
        render,
        moveInstance: (instanceId, targetZone) => !disposed && moveInstance(state, instanceId, targetZone),
        drawTop: (targetZone) => !disposed && drawTop(state, targetZone),
        openCardZoom,
        shuffle,
        openLibrarySearch: () => {
          if (disposed) return null;
          if (!state.zones.library.length) return toast('De library is leeg.', 'warning');
          const searchedState = state;
          return trackDialog(librarySearchDialog(searchedState, byDeckCardId, (instanceId, targetZone) => {
            if (disposed || state !== searchedState) return;
            if (moveInstance(state, instanceId, targetZone)) render();
          }));
        }
      });
      const handleDrop = (payload, targetZone) => {
        if (disposed) return;
        const changed = payload.type === 'library'
          ? drawTop(state, targetZone)
          : moveInstance(state, payload.id, targetZone);
        if (changed) render();
      };
      const cleanupDrag = root ? installSimulatorDrag(root, handleDrop, () => {
        suppressCardZoomUntil = Date.now() + 400;
        clearTimeout(cardClickTimer);
        libraryController.closeMenu();
      }) : () => {};

      listen(document.getElementById('simulator-back'), 'click', () => returnFromDeckSimulator(returnToken, deckId));
      listen(document.getElementById('sim-reset'), 'click', () => {
        trackDialog(openDialog({
          title: 'Simulatie resetten',
          content: '<p class="dialog-message">Alle zones worden gewist. Het deck wordt opnieuw geschud en je krijgt zeven kaarten.</p>',
          submitLabel: 'Resetten',
          destructive: true,
          writeAction: false,
          onSubmit: (_formData, resetDialog) => {
            if (disposed) return true;
            clearTimeout(cardClickTimer);
            libraryController.closeDialogs();
            for (const dialog of dialogs) if (dialog !== resetDialog) dialog.close();
            state = createInitialState(cards);
            render();
            toast('De speeltest is opnieuw begonnen.');
            return true;
          }
        }));
      });

      listen(root, 'contextmenu', (event) => {
        const library = event.target.closest('[data-sim-library-source]');
        if (!library) return;
        event.preventDefault();
        clearTimeout(cardClickTimer);
        libraryController.openMenu({ opener: library, clientX: event.clientX, clientY: event.clientY });
      });
      listen(root, 'dblclick', (event) => {
        clearTimeout(cardClickTimer);
        const library = event.target.closest('[data-sim-library-source]');
        if (library) {
          libraryController.closeMenu();
          if (!drawTop(state, 'hand')) toast('De library is leeg.', 'warning');
          render();
          return;
        }
        const card = event.target.closest('[data-sim-instance]');
        if (!card) return;
        const found = findZone(state, card.dataset.simInstance);
        if (found?.zone !== 'battlefield') return;
        found.instance.tapped = !found.instance.tapped;
        render();
      });
      listen(root, 'click', (event) => {
        if (Date.now() < suppressCardZoomUntil || event.detail > 1) return;
        const library = event.target.closest('[data-sim-library-source]');
        if (library) {
          clearTimeout(cardClickTimer);
          cardClickTimer = window.setTimeout(() => {
            if (!disposed && Date.now() >= suppressCardZoomUntil) libraryController.openMenu({ opener: library });
          }, 320);
          return;
        }
        const card = event.target.closest('[data-sim-instance]');
        if (!card) return;
        clearTimeout(cardClickTimer);
        cardClickTimer = window.setTimeout(() => {
          if (disposed || Date.now() < suppressCardZoomUntil) return;
          const found = findZone(state, card.dataset.simInstance);
          const item = found ? itemForInstance(found.instance, byDeckCardId) : null;
          if (item) openCardZoom(item);
        }, 320);
      });
      listen(root, 'keydown', (event) => {
        const library = event.target.closest('[data-sim-library-source]');
        if (library && (['Enter', ' ', 'ContextMenu'].includes(event.key) || (event.key === 'F10' && event.shiftKey))) {
          event.preventDefault();
          clearTimeout(cardClickTimer);
          libraryController.openMenu({ opener: library });
          return;
        }
        const card = event.target.closest('[data-sim-instance]');
        if (!card || !['Enter', ' '].includes(event.key)) return;
        const found = findZone(state, card.dataset.simInstance);
        event.preventDefault();
        if (event.key === 'Enter') {
          const item = found ? itemForInstance(found.instance, byDeckCardId) : null;
          if (item) openCardZoom(item);
          return;
        }
        if (found?.zone === 'battlefield') {
          found.instance.tapped = !found.instance.tapped;
          render();
          // Preserve keyboard focus when this copy moves between tapped and
          // untapped stacks, so Space still acts on the same physical card.
          [...root.querySelectorAll('[data-sim-instance]')]
            .find((entry) => entry.dataset.simInstance === found.instance.id)?.focus();
        }
      });
      return () => {
        disposed = true;
        clearTimeout(cardClickTimer);
        cleanupDrag();
        libraryController.dispose();
        for (const dialog of dialogs) dialog.close();
        dialogs.clear();
        for (const cleanup of listeners) cleanup();
      };
    }
  };
}
