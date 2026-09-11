import { api, apiPath } from '../api.js';
import {
  cardImage,
  librarySearchHtml,
  manaProductionHtml,
  metric,
  pageHeader
} from '../components.js';
import {
  getDeckSimulatorReturnLabel,
  returnFromDeckSimulator
} from '../navigation-state.js';
import { confirmDialog, escapeHtml, openDialog, toast } from '../utils.js';

const SIMULATED_ROLES = new Set(['main']);
const COMMAND_ROLES = new Set(['commander', 'partner', 'companion']);
const ZONE_LABELS = {
  library: 'Library', hand: 'Hand', battlefield: 'Tafel', graveyard: 'Graveyard', command: 'Command zone'
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
    turn: 1,
    zones: {
      library: zones.library,
      hand,
      battlefield: [],
      graveyard: [],
      command: zones.command
    },
    turnActions: { drawn: [], played: [], graveyarded: [] },
    history: [],
    updatedAt: Date.now()
  };
}

function itemMap(cards) {
  return new Map(cards.map((item) => [Number(item.id), item]));
}

function itemForInstance(instance, byDeckCardId) {
  return byDeckCardId.get(Number(instance?.deckCardId)) || null;
}

function instanceName(instance, byDeckCardId) {
  return itemForInstance(instance, byDeckCardId)?.card?.name || 'Onbekende kaart';
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
  if (!found || !state.zones[targetZone] || found.zone === targetZone) return false;
  const [instance] = state.zones[found.zone].splice(found.index, 1);
  instance.tapped = false;
  state.zones[targetZone].push(instance);
  if (targetZone === 'hand' && found.zone === 'library') state.turnActions.drawn.push(instance.id);
  if (targetZone === 'battlefield' && found.zone !== 'battlefield') state.turnActions.played.push(instance.id);
  if (targetZone === 'graveyard' && found.zone !== 'graveyard') state.turnActions.graveyarded.push(instance.id);
  state.updatedAt = Date.now();
  return true;
}

function drawTop(state, targetZone = 'hand') {
  if (targetZone === 'library') return false;
  const instance = state.zones.library.pop();
  if (!instance || !state.zones[targetZone]) return false;
  instance.tapped = false;
  state.zones[targetZone].push(instance);
  if (targetZone === 'hand') state.turnActions.drawn.push(instance.id);
  if (targetZone === 'battlefield') state.turnActions.played.push(instance.id);
  if (targetZone === 'graveyard') state.turnActions.graveyarded.push(instance.id);
  state.updatedAt = Date.now();
  return true;
}

function simulatorCard(instance, zone, byDeckCardId) {
  const item = itemForInstance(instance, byDeckCardId);
  if (!item) return '';
  const label = `${item.card.name} in ${ZONE_LABELS[zone]}`;
  return `<div class="simulator-playing-card ${instance.tapped ? 'tapped' : ''}" data-sim-instance="${escapeHtml(instance.id)}" data-sim-source-zone="${zone}" draggable="true" tabindex="0" role="button" aria-label="${escapeHtml(label)}" title="${escapeHtml(item.card.name)}">
    ${cardImage(item.card, { className: 'sim-playing-card-image' })}
  </div>`;
}

function zoneHtml(zone, instances, byDeckCardId, { empty = 'Sleep kaarten hierheen.' } = {}) {
  return `<section class="simulator-zone simulator-zone-${zone}" data-sim-dropzone="${zone}">
    <header><h2>${escapeHtml(ZONE_LABELS[zone])}</h2><span>${instances.length}</span></header>
    <div class="simulator-zone-cards">${instances.length
      ? instances.map((instance) => simulatorCard(instance, zone, byDeckCardId)).join('')
      : `<p class="simulator-zone-empty">${escapeHtml(empty)}</p>`}</div>
  </section>`;
}

function libraryPileHtml(state) {
  return `<section class="simulator-zone simulator-library-zone" data-sim-dropzone="library">
    <div class="sim-library-end-turn"><button class="button primary" type="button" data-sim-end-turn>Beurt beëindigen</button></div>
    <header><h2>Library</h2><span>${state.zones.library.length}</span></header>
    <div class="library-pile-wrap">
      <div class="library-pile ${state.zones.library.length ? '' : 'empty'}" data-sim-library-source draggable="${state.zones.library.length ? 'true' : 'false'}" tabindex="0" role="button" aria-label="Bovenste kaart van library; sleep naar een zone" title="Sleep de bovenste kaart naar hand, tafel of graveyard">
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

function aggregateBattlefieldMana(state, byDeckCardId) {
  const totals = new Map();
  for (const instance of state.zones.battlefield) {
    if (instance.tapped) continue;
    const item = itemForInstance(instance, byDeckCardId);
    for (const entry of item?.card?.insights?.manaProduction?.entries || []) {
      const key = `${entry.mana}|${entry.variable ? 1 : 0}`;
      const current = totals.get(key) || { mana: entry.mana, amount: 0, variable: entry.variable };
      current.amount += Number(entry.amount || 1);
      totals.set(key, current);
    }
  }
  return [...totals.values()];
}

function availableSearchCards(state, byDeckCardId) {
  const rows = [];
  for (const zone of ['battlefield', 'hand']) {
    for (const instance of state.zones[zone]) {
      const item = itemForInstance(instance, byDeckCardId);
      const targets = item?.card?.insights?.librarySearch?.targets || [];
      if (targets.length) rows.push({ zone, card: item.card, targets });
    }
  }
  return rows;
}

function groupProgress(groups, state, byDeckCardId) {
  const battlefieldIds = new Set(state.zones.battlefield.map((instance) => Number(instance.deckCardId)));
  const availableIds = new Set([
    ...state.zones.hand,
    ...state.zones.command,
    ...state.zones.graveyard
  ].map((instance) => Number(instance.deckCardId)));
  return groups.map((group) => {
    const ordered = [...(group.members || [])].sort((a, b) => Number(a.position) - Number(b.position));
    const completed = ordered.filter((member) => battlefieldIds.has(Number(member.deckCardId))).length;
    const next = ordered.find((member) => !battlefieldIds.has(Number(member.deckCardId))) || null;
    const nextItem = next ? byDeckCardId.get(Number(next.deckCardId)) : null;
    return {
      ...group,
      ordered,
      completed,
      complete: completed === ordered.length && ordered.length > 0,
      next,
      nextItem,
      nextAvailable: next ? availableIds.has(Number(next.deckCardId)) : false
    };
  });
}

function actionNames(ids, state, byDeckCardId) {
  const all = Object.values(state.zones).flat();
  return ids.map((id) => instanceName(all.find((instance) => instance.id === id) || { id }, byDeckCardId));
}

function turnInformationHtml(state, groups, byDeckCardId) {
  const mana = aggregateBattlefieldMana(state, byDeckCardId);
  const searchCards = availableSearchCards(state, byDeckCardId);
  const progress = groupProgress(groups, state, byDeckCardId);
  const drawn = actionNames(state.turnActions.drawn, state, byDeckCardId);
  const played = actionNames(state.turnActions.played, state, byDeckCardId);
  const graveyarded = actionNames(state.turnActions.graveyarded, state, byDeckCardId);
  const recentTurns = (state.history || []).slice(0, 5).map((entry) => ({
    turn: Number(entry.turn || 0),
    drawn: actionNames(entry.drawn || [], state, byDeckCardId),
    played: actionNames(entry.played || [], state, byDeckCardId),
    graveyarded: actionNames(entry.graveyarded || [], state, byDeckCardId)
  }));

  return `<aside class="simulator-information">
    <section class="sim-info-card turn-card">
      <span>Huidige beurt</span><strong>${state.turn}</strong>
      <div class="sim-turn-actions"><span>Gepakt: ${drawn.length}</span><span>Naar tafel: ${played.length}</span><span>Naar graveyard: ${graveyarded.length}</span></div>
    </section>
    <section class="sim-info-card">
      <h3>Beschikbare mana op tafel</h3>
      ${mana.length ? manaProductionHtml(mana) : '<p class="muted">Geen ongetapte mana-producers op tafel.</p>'}
    </section>
    <section class="sim-info-card">
      <h3>Deckzoekfuncties</h3>
      ${searchCards.length ? `<div class="sim-search-functions">${searchCards.map((entry) => `<div><strong>${escapeHtml(entry.card.name)}</strong><small>${escapeHtml(ZONE_LABELS[entry.zone])}</small>${librarySearchHtml(entry.targets)}</div>`).join('')}</div>` : '<p class="muted">Geen zoekkaart in je hand of op tafel.</p>'}
    </section>
    <section class="sim-info-card combo-progress-card">
      <h3>Combo's en synergieen</h3>
      ${progress.length ? progress.map((group) => `<div class="sim-combo-progress ${group.complete ? 'complete' : ''}">
        <div><span class="relation-type-badge ${escapeHtml(group.type)}">${group.type === 'combo' ? 'Combo' : 'Synergie'}</span><strong>${escapeHtml(group.name)}</strong></div>
        <progress max="${Math.max(group.ordered.length, 1)}" value="${group.completed}"></progress>
        <small>${group.complete ? 'Alle kaarten liggen op tafel.' : `Volgende stap: ${escapeHtml(group.nextItem?.card?.name || group.next?.name || 'onbekend')}${group.nextAvailable ? ' · beschikbaar in hand, command zone of graveyard' : ''}`}</small>
      </div>`).join('') : '<p class="muted">Geen combo\'s of synergieen vastgelegd.</p>'}
    </section>
    <section class="sim-info-card">
      <h3>Acties deze beurt</h3>
      <div class="sim-action-log">
        ${drawn.length ? `<p><strong>Gepakt:</strong> ${drawn.map(escapeHtml).join(', ')}</p>` : ''}
        ${played.length ? `<p><strong>Gespeeld:</strong> ${played.map(escapeHtml).join(', ')}</p>` : ''}
        ${graveyarded.length ? `<p><strong>Graveyard:</strong> ${graveyarded.map(escapeHtml).join(', ')}</p>` : ''}
        ${!drawn.length && !played.length && !graveyarded.length ? '<p class="muted">Nog geen acties in deze beurt.</p>' : ''}
      </div>
    </section>
    ${recentTurns.length ? `<section class="sim-info-card"><h3>Vorige beurten</h3><div class="sim-turn-history">${recentTurns.map((entry) => `<details><summary>Beurt ${entry.turn}<span>${entry.drawn.length} gepakt · ${entry.played.length} gespeeld · ${entry.graveyarded.length} graveyard</span></summary><div>${entry.drawn.length ? `<p><strong>Gepakt:</strong> ${entry.drawn.map(escapeHtml).join(', ')}</p>` : ''}${entry.played.length ? `<p><strong>Gespeeld:</strong> ${entry.played.map(escapeHtml).join(', ')}</p>` : ''}${entry.graveyarded.length ? `<p><strong>Graveyard:</strong> ${entry.graveyarded.map(escapeHtml).join(', ')}</p>` : ''}${!entry.drawn.length && !entry.played.length && !entry.graveyarded.length ? '<p class="muted">Geen geregistreerde acties.</p>' : ''}</div></details>`).join('')}</div></section>` : ''}
  </aside>`;
}

function tableHtml(state, groups, byDeckCardId) {
  return `<div class="simulator-layout">
    <div class="simulator-table" aria-label="Drag-and-drop speeltafel">
      <div class="simulator-top-zones">
        ${libraryPileHtml(state)}
        ${zoneHtml('graveyard', state.zones.graveyard, byDeckCardId)}
        ${zoneHtml('command', state.zones.command, byDeckCardId, { empty: 'Geen commander of companion.' })}
      </div>
      ${zoneHtml('battlefield', state.zones.battlefield, byDeckCardId)}
      ${zoneHtml('hand', state.zones.hand, byDeckCardId)}
    </div>
    ${turnInformationHtml(state, groups, byDeckCardId)}
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
}

function installSimulatorDrag(root, onDrop, onDragComplete = () => {}) {
  installNativeDrag(root, onDrop, onDragComplete);
  installTouchDrag(root, onDrop, onDragComplete);
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
      <div class="sim-library-dialog-targets"><div data-library-dialog-target="hand">Hand</div><div data-library-dialog-target="battlefield">Tafel</div><div data-library-dialog-target="graveyard">Graveyard</div></div>
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

export async function renderDeckSimulator(context) {
  const deckId = Number(context.params.id);
  const returnToken = context.query.get('return') || '';
  const [deck, cards, groups] = await Promise.all([
    api(`/decks/${deckId}`),
    api(`/decks/${deckId}/cards`),
    api(`/decks/${deckId}/links`)
  ]);
  const byDeckCardId = itemMap(cards);
  let state = createInitialState(cards);

  return {
    html: `${pageHeader({
      eyebrow: `${deck.format} · Speeltest`,
      title: `${deck.name} - simulator`,
      description: 'Sleep kaarten vrij tussen library, hand, tafel, command zone en graveyard.',
      actions: `<button id="simulator-back" class="button secondary" type="button"><- ${escapeHtml(getDeckSimulatorReturnLabel(returnToken))}</button><button id="sim-search-library" class="button secondary" type="button">Library bekijken</button><button id="sim-shuffle-library" class="button secondary" type="button">Schudden</button><button id="sim-end-turn" class="button primary" type="button">Beurt beëindigen</button><button id="sim-reset" class="button secondary" type="button">Reset</button>`
    })}
    <section class="simulator-metrics metrics-grid">
      ${metric('Beurt', state.turn, 'Handmatig doorlopen', 'info')}
      ${metric('Library', state.zones.library.length, 'Kaarten over')}
      ${metric('Hand', state.zones.hand.length, 'Kaarten in hand')}
      ${metric('Tafel', state.zones.battlefield.length, 'Kaarten op tafel')}
      ${metric('Graveyard', state.zones.graveyard.length, 'Kaarten in graveyard')}
    </section>
    <div id="deck-simulator-root">${tableHtml(state, groups, byDeckCardId)}</div>`,
    mount() {
      const root = document.getElementById('deck-simulator-root');
      let cardClickTimer = null;
      let suppressCardZoomUntil = 0;
      const render = () => {
        if (root) root.innerHTML = tableHtml(state, groups, byDeckCardId);
        const metrics = document.querySelector('.simulator-metrics');
        if (metrics) metrics.innerHTML = [
          metric('Beurt', state.turn, 'Handmatig doorlopen', 'info'),
          metric('Library', state.zones.library.length, 'Kaarten over'),
          metric('Hand', state.zones.hand.length, 'Kaarten in hand'),
          metric('Tafel', state.zones.battlefield.length, 'Kaarten op tafel'),
          metric('Graveyard', state.zones.graveyard.length, 'Kaarten in graveyard')
        ].join('');
      };

      const handleDrop = (payload, targetZone) => {
        const changed = payload.type === 'library'
          ? drawTop(state, targetZone)
          : moveInstance(state, payload.id, targetZone);
        if (changed) render();
      };
      if (root) installSimulatorDrag(root, handleDrop, () => {
        suppressCardZoomUntil = Date.now() + 400;
        clearTimeout(cardClickTimer);
      });

      const endTurn = () => {
        state.history.unshift({ turn: state.turn, ...state.turnActions });
        state.history = state.history.slice(0, 10);
        state.turn += 1;
        state.zones.battlefield.forEach((instance) => { instance.tapped = false; });
        state.turnActions = { drawn: [], played: [], graveyarded: [] };
        state.updatedAt = Date.now();
        render();
        toast(`Beurt ${state.turn} is begonnen.`);
      };

      document.getElementById('simulator-back')?.addEventListener('click', () => returnFromDeckSimulator(returnToken, deckId));
      document.getElementById('sim-end-turn')?.addEventListener('click', endTurn);
      document.getElementById('sim-reset')?.addEventListener('click', async () => {
        const confirmed = await confirmDialog({
          title: 'Simulatie resetten',
          message: 'Alle zones en beurtinformatie worden gewist. Het deck wordt opnieuw geschud en je krijgt zeven kaarten.',
          confirmLabel: 'Resetten',
          writeAction: false
        });
        if (!confirmed) return;
        state = createInitialState(cards);
        render();
        toast('De speeltest is opnieuw begonnen.');
      });
      document.getElementById('sim-shuffle-library')?.addEventListener('click', () => {
        state.zones.library = shuffle(state.zones.library);
        state.updatedAt = Date.now();
        render();
        toast('Library geschud.');
      });
      document.getElementById('sim-search-library')?.addEventListener('click', () => {
        if (!state.zones.library.length) return toast('De library is leeg.', 'warning');
        librarySearchDialog(state, byDeckCardId, (instanceId, targetZone) => {
          moveInstance(state, instanceId, targetZone);
          render();
        });
      });

      root?.addEventListener('dblclick', (event) => {
        clearTimeout(cardClickTimer);
        const library = event.target.closest('[data-sim-library-source]');
        if (library) {
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
      root?.addEventListener('click', (event) => {
        const endTurnButton = event.target.closest('[data-sim-end-turn]');
        if (endTurnButton) {
          endTurn();
          return;
        }
        const card = event.target.closest('[data-sim-instance]');
        if (!card || Date.now() < suppressCardZoomUntil || event.detail > 1) return;
        clearTimeout(cardClickTimer);
        cardClickTimer = window.setTimeout(() => {
          if (Date.now() < suppressCardZoomUntil) return;
          const found = findZone(state, card.dataset.simInstance);
          const item = found ? itemForInstance(found.instance, byDeckCardId) : null;
          if (item) openSimulatorCardZoom(item);
        }, 320);
      });
      root?.addEventListener('keydown', (event) => {
        const card = event.target.closest('[data-sim-instance]');
        if (!card || !['Enter', ' '].includes(event.key)) return;
        const found = findZone(state, card.dataset.simInstance);
        event.preventDefault();
        if (event.key === 'Enter') {
          const item = found ? itemForInstance(found.instance, byDeckCardId) : null;
          if (item) openSimulatorCardZoom(item);
          return;
        }
        if (found?.zone === 'battlefield') {
          found.instance.tapped = !found.instance.tapped;
          render();
        }
      });
    }
  };
}
