import { cardImage } from './components.js';
import { escapeHtml, openDialog } from './utils.js';

const RETURN_LABELS = {
  top: 'Bovenaan library',
  bottom: 'Onderop library',
  shuffle: 'Shuffle in library'
};
const DESTINATIONS = [
  ['hand', 'Naar hand'],
  ['battlefield', 'Naar speelveld'],
  ['graveyard', 'Naar graveyard'],
  ['exile', 'Naar exile']
];

// Library arrays are stored bottom-to-top. Revealing cards only records their
// IDs; the physical instances remain in their original library positions until
// an explicit move or return action. Closing a preview therefore cannot lose,
// duplicate, draw or reorder any of its remaining cards.
export function createSimulatorLibraryController({
  getState, byDeckCardId, render, moveInstance, drawTop, openCardZoom, shuffle,
  openLibrarySearch
}) {
  let disposed = false;
  let menu = null;
  let reveal = null;
  const dialogs = new Set();

  const itemFor = (instance) => byDeckCardId.get(Number(instance?.deckCardId));
  const currentLibrary = () => getState()?.zones?.library || [];
  const isCurrent = (state) => !disposed && getState() === state;

  function trackDialog(dialog) {
    if (!dialog) return dialog;
    dialogs.add(dialog);
    dialog.addEventListener('close', () => dialogs.delete(dialog), { once: true });
    return dialog;
  }

  function closeMenu({ restoreFocus = false } = {}) {
    if (!menu) return;
    const previous = menu;
    menu = null;
    document.removeEventListener('pointerdown', previous.onPointerDown, true);
    document.removeEventListener('keydown', previous.onKeyDown);
    window.removeEventListener('resize', previous.onViewportChange);
    window.removeEventListener('scroll', previous.onViewportChange, true);
    previous.element.remove();
    if (restoreFocus && previous.opener?.isConnected) previous.opener.focus();
  }

  function showMenu({ label, actions, opener, clientX, clientY, container = document.body }) {
    closeMenu();
    if (disposed) return;
    const element = document.createElement('div');
    element.className = 'deck-card-context-menu simulator-context-menu';
    element.innerHTML = `<div class="deck-card-action-menu" role="menu" tabindex="-1" aria-label="${escapeHtml(label)}">${actions.map((action, index) => `<button type="button" class="deck-card-action-choice" role="menuitem" data-sim-menu-index="${index}" ${action.attribute}="${escapeHtml(action.value)}"${action.disabled ? ' disabled' : ''}><span class="deck-card-action-icon" aria-hidden="true">${escapeHtml(action.icon || '→')}</span><span><strong>${escapeHtml(action.label)}</strong></span></button>`).join('')}</div>`;
    element.style.left = '0px';
    element.style.top = '0px';
    element.style.visibility = 'hidden';
    container.append(element);
    const anchor = opener?.getBoundingClientRect?.();
    const bounds = element.getBoundingClientRect();
    const requestedX = Number.isFinite(clientX) && clientX > 0 ? clientX : (anchor?.right || 8);
    const requestedY = Number.isFinite(clientY) && clientY > 0 ? clientY : (anchor?.bottom || 8);
    element.style.left = `${Math.max(8, Math.min(requestedX, window.innerWidth - bounds.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(requestedY, window.innerHeight - bounds.height - 8))}px`;
    element.style.visibility = '';

    const enabledItems = () => [...element.querySelectorAll('[role="menuitem"]')].filter((item) => !item.disabled);
    const onPointerDown = (event) => {
      if (!element.contains(event.target)) closeMenu();
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        closeMenu({ restoreFocus: true });
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const items = enabledItems();
      if (!items.length) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : index < 0 ? (event.key === 'ArrowUp' ? items.length - 1 : 0)
          : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
      items[next].focus();
    };
    const onViewportChange = (event) => {
      // Scrolling a tall menu must not dismiss it before its last actions can
      // be reached. Outside scrolling still invalidates its screen anchor.
      if (event.type === 'scroll' && event.target !== window && element.contains(event.target)) return;
      closeMenu();
    };
    menu = { element, opener, onPointerDown, onKeyDown, onViewportChange };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    element.addEventListener('click', (event) => {
      const button = event.target.closest('[data-sim-menu-index]');
      if (!button || button.disabled || menu?.element !== element) return;
      const action = actions[Number(button.dataset.simMenuIndex)];
      closeMenu();
      action?.run();
    });
    element.addEventListener('contextmenu', (event) => event.preventDefault());
    (enabledItems()[0] || element.querySelector('[role="menu"]'))?.focus();
  }

  function openReveal(state) {
    if (!isCurrent(state)) return;
    reveal?.dialog.close();
    let revealedIds = [];
    const top = state.zones.library.at(-1);
    if (top) revealedIds.push(top.id);
    const dialog = trackDialog(openDialog({
      title: 'Toon X kaarten',
      cancelLabel: 'Sluiten',
      wide: true,
      writeAction: false,
      initialFocus: '[data-sim-reveal-more]',
      content: `<div class="sim-library-reveal-controls">
        <div class="sim-library-reveal-stepper">
          <button type="button" class="button secondary" data-sim-reveal-less aria-label="Eén kaart terugleggen">−</button>
          <span class="sim-library-reveal-count"><output data-sim-reveal-count aria-live="polite">0</output> zichtbaar</span>
          <button type="button" class="button secondary" data-sim-reveal-more aria-label="Eén kaart tonen">+</button>
        </div>
        <div class="sim-library-return-control">
          <select data-sim-reveal-return aria-label="Resterende kaarten terugplaatsen">
            <option value="top">Bovenaan library</option>
            <option value="bottom">Onderop library</option>
            <option value="shuffle">Shuffle in library</option>
          </select>
          <button type="button" class="button primary" data-sim-reveal-finish>Bovenaan library</button>
        </div>
      </div>
      <p class="muted sim-library-reveal-help">De eerste kaart is de bovenste. Rechtermuisknop op een kaart opent de verplaatsopties. Sluiten laat resterende kaarten bovenaan liggen.</p>
      <div class="sim-library-reveal-grid" data-sim-reveal-cards></div>`
    }));
    dialog.classList.add('simulator-reveal-dialog');
    dialog.setAttribute('data-sim-reveal-dialog', '');
    const session = { state, dialog };
    reveal = session;
    const grid = dialog.querySelector('[data-sim-reveal-cards]');
    const plus = dialog.querySelector('[data-sim-reveal-more]');
    const minus = dialog.querySelector('[data-sim-reveal-less]');
    const finish = dialog.querySelector('[data-sim-reveal-finish]');
    const returnChoice = dialog.querySelector('[data-sim-reveal-return]');

    const valid = () => isCurrent(state) && reveal === session && dialog.open;
    const remaining = () => {
      const byId = new Map(state.zones.library.map((instance) => [instance.id, instance]));
      revealedIds = revealedIds.filter((id) => byId.has(id));
      return revealedIds.map((id) => byId.get(id));
    };
    const update = () => {
      if (!valid()) return;
      const cards = remaining();
      dialog.querySelector('[data-sim-reveal-count]').textContent = String(cards.length);
      plus.disabled = cards.length >= state.zones.library.length;
      minus.disabled = cards.length === 0;
      grid.innerHTML = cards.length ? cards.map((instance, index) => {
        const item = itemFor(instance);
        const name = item?.card?.name || 'Onbekende kaart';
        return `<figure class="sim-library-reveal-item"><button type="button" class="sim-library-reveal-card" data-sim-revealed-instance="${escapeHtml(instance.id)}" aria-haspopup="menu" aria-label="${escapeHtml(`${index + 1}. ${name}; rechtermuisknop voor verplaatsopties`)}" title="${escapeHtml(name)}">${item ? cardImage(item.card, { className: 'sim-library-reveal-image' }) : escapeHtml(name)}</button><figcaption>${index + 1}. ${escapeHtml(name)}</figcaption></figure>`;
      }).join('') : '<p class="simulator-zone-empty">Geen kaarten zichtbaar. Gebruik + om een kaart te tonen.</p>';
    };
    plus.addEventListener('click', () => {
      if (!valid()) return;
      const alreadyRevealed = new Set(remaining().map((instance) => instance.id));
      const next = [...state.zones.library].reverse().find((instance) => !alreadyRevealed.has(instance.id));
      if (next) revealedIds.push(next.id);
      update();
    });
    minus.addEventListener('click', () => {
      if (!valid()) return;
      remaining();
      revealedIds.pop();
      update();
    });
    returnChoice.addEventListener('change', () => {
      finish.textContent = RETURN_LABELS[returnChoice.value] || RETURN_LABELS.top;
    });
    finish.addEventListener('click', () => {
      if (!valid()) return;
      const mode = returnChoice.value;
      if (!Object.hasOwn(RETURN_LABELS, mode)) return;
      const cards = remaining();
      if (mode === 'shuffle') {
        state.zones.library = shuffle(state.zones.library);
      } else {
        const ids = new Set(cards.map((instance) => instance.id));
        const unshown = state.zones.library.filter((instance) => !ids.has(instance.id));
        // Reverse the viewing order to preserve the order of future draws.
        state.zones.library = mode === 'bottom'
          ? [...cards].reverse().concat(unshown)
          : unshown.concat([...cards].reverse());
      }
      state.updatedAt = Date.now();
      render();
      dialog.close();
    });

    const openCardMenu = (event) => {
      const opener = event.target.closest('[data-sim-revealed-instance]');
      if (!opener || !valid()) return;
      event.preventDefault();
      event.stopPropagation();
      const id = opener.dataset.simRevealedInstance;
      const instance = remaining().find((card) => card.id === id);
      if (!instance) return;
      showMenu({
        label: `Verplaats ${itemFor(instance)?.card?.name || 'kaart'}`,
        opener, clientX: event.clientX, clientY: event.clientY, container: dialog,
        actions: DESTINATIONS.map(([target, label]) => ({
          label, attribute: 'data-sim-reveal-target', value: target,
          run: () => {
            if (!valid() || !remaining().some((card) => card.id === id)) return;
            if (moveInstance(id, target)) {
              render();
              update();
              plus.focus();
            }
          }
        }))
      });
    };
    grid.addEventListener('contextmenu', openCardMenu);
    grid.addEventListener('keydown', (event) => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openCardMenu(event);
    });
    grid.addEventListener('click', (event) => {
      const opener = event.target.closest('[data-sim-revealed-instance]');
      if (!opener || !valid()) return;
      const instance = remaining().find((card) => card.id === opener.dataset.simRevealedInstance);
      const item = itemFor(instance);
      if (item) trackDialog(openCardZoom(item));
    });
    dialog.addEventListener('close', () => {
      if (reveal === session) reveal = null;
      closeMenu();
    }, { once: true });
    update();
  }

  function openMenu({ opener, clientX, clientY } = {}) {
    if (disposed) return;
    const state = getState();
    const empty = currentLibrary().length === 0;
    const run = (callback) => () => { if (isCurrent(state)) callback(); };
    const actions = [
      { value: 'peek', label: 'Toon bovenste kaart', icon: '◉', disabled: empty, run: run(() => {
        const item = itemFor(state.zones.library.at(-1));
        if (item) trackDialog(openCardZoom(item));
      }) },
      { value: 'mill', label: 'Mill kaart', icon: '↓', disabled: empty, run: run(() => {
        if (drawTop('graveyard')) render();
      }) },
      { value: 'reveal', label: 'Toon X kaarten', icon: '▱', disabled: empty, run: run(() => openReveal(state)) },
      { value: 'shuffle', label: 'Schudden', icon: '↝', disabled: empty, run: run(() => {
        state.zones.library = shuffle(state.zones.library);
        state.updatedAt = Date.now();
        render();
      }) }
    ];
    if (openLibrarySearch) actions.push({ value: 'search', label: 'Library bekijken', icon: '⌕', disabled: empty,
      run: run(() => trackDialog(openLibrarySearch())) });
    showMenu({ label: 'Library-acties', actions: actions.map((action) => ({ ...action, attribute: 'data-sim-library-action' })), opener, clientX, clientY });
  }

  function closeDialogs() {
    closeMenu();
    for (const dialog of [...dialogs].reverse()) {
      if (dialog.open) dialog.close();
    }
    dialogs.clear();
    reveal = null;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    closeDialogs();
    window.removeEventListener('hashchange', dispose);
    window.removeEventListener('app:refresh', dispose);
  }
  window.addEventListener('hashchange', dispose);
  window.addEventListener('app:refresh', dispose);
  return { openMenu, closeMenu, closeDialogs, dispose };
}
