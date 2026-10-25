import { api } from './api.js';
import { cardImage } from './components.js';
import { escapeHtml, openDialog } from './utils.js';
import {
  simulatorItem,
  isSimulatorCreature,
  tokenChoices,
  addSimulatorTokens,
  duplicateSimulatorCreature,
  setSimulatorCounters
} from './simulator-permanents.js';

function integerField(formData, name, min, max, label) {
  const raw = String(formData.get(name) ?? '').trim();
  const value = Number(raw);
  if (!/^[+-]?\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} moet een geheel getal van ${min} tot en met ${max} zijn.`);
  }
  return value;
}

const quantityField = '<label class="field"><span>Aantal</span><input name="quantity" type="number" min="1" max="1000" step="1" value="1" required></label>';

function tokenLabel(card) {
  const stats = card.power !== null && card.power !== undefined && card.toughness !== null && card.toughness !== undefined
    ? ` · ${card.power}/${card.toughness}` : '';
  const colors = card.colors?.length ? ` · ${card.colors.join('/')}` : '';
  return `${card.name}${stats}${colors} · ${card.typeLine || 'Token'}`;
}

// All changes belong only to this simulator session. Token metadata uses the
// existing read API; the collection, deck and original card records are never
// written. Every callback checks both the session and the physical instance.
export function createSimulatorCardActions({ getState, byDeckCardId, render }) {
  let disposed = false;
  let menu = null;
  let cachedState = null;
  const tokenCache = new Map();
  const dialogs = new Set();

  const currentSource = (context) => !disposed && getState() === context.state
    && context.state.zones.battlefield.includes(context.instance);
  const currentMenu = (context) => menu === context && currentSource(context);

  function trackDialog(dialog, kind) {
    dialog.setAttribute('data-sim-card-dialog', kind);
    dialogs.add(dialog);
    dialog.addEventListener('close', () => dialogs.delete(dialog), { once: true });
    return dialog;
  }

  function counterDialog(context) {
    if (!currentSource(context)) return;
    const card = context.item.card;
    const creature = isSimulatorCreature(card);
    const counters = context.instance.counters || {};
    const field = (name, label, min) => `<label class="field"><span>${label}</span><input name="${name}" type="number" min="${min}" max="9999" step="1" value="${escapeHtml(counters[name] ?? 0)}" required></label>`;
    let applied = false;
    trackDialog(openDialog({
      title: `Geef counters · ${card.name}`,
      submitLabel: 'Instellen',
      writeAction: false,
      initialFocus: creature ? '[name="power"]' : '[name="generic"]',
      content: `<p class="muted">Stel het totale aantal counters op deze kaart in. Nul verwijdert de counters.</p>
        <div class="form-grid">${creature
    ? field('power', 'Power-counters', -9999) + field('toughness', 'Toughness-counters', -9999)
    : field('generic', 'Counters', 0)}</div>`,
      onSubmit: (formData, dialog) => {
        if (applied || !dialog.open || !currentSource(context)) return true;
        const values = creature ? {
          power: integerField(formData, 'power', -9999, 9999, 'Power'),
          toughness: integerField(formData, 'toughness', -9999, 9999, 'Toughness')
        } : { generic: integerField(formData, 'generic', 0, 9999, 'Counters') };
        setSimulatorCounters(context.instance, card, values);
        applied = true;
        context.state.updatedAt = Date.now();
        render();
        return true;
      }
    }), 'counters');
  }

  function duplicateDialog(context) {
    if (!currentSource(context) || !isSimulatorCreature(context.item.card)) return;
    let applied = false;
    trackDialog(openDialog({
      title: `Dupliceer · ${context.item.card.name}`,
      submitLabel: 'Dupliceren',
      writeAction: false,
      initialFocus: '[name="quantity"]',
      content: `<p class="muted">Maak extra exemplaren op tafel. De nieuwe exemplaren beginnen zonder counters en ongetapt.</p>${quantityField}`,
      onSubmit: (formData, dialog) => {
        if (applied || !dialog.open || !currentSource(context)) return true;
        const quantity = integerField(formData, 'quantity', 1, 1000, 'Aantal');
        duplicateSimulatorCreature(context.state, context.instance, quantity, byDeckCardId);
        applied = true;
        render();
        return true;
      }
    }), 'duplicate');
  }

  function tokenDialog(context) {
    if (!currentSource(context) || !context.choices.length) return;
    const choices = context.choices;
    let applied = false;
    const dialog = trackDialog(openDialog({
      title: `Maak token · ${context.item.card.name}`,
      submitLabel: 'Tokens maken',
      writeAction: false,
      initialFocus: choices.length > 1 ? '[name="tokenIndex"]' : '[name="quantity"]',
      content: `<div class="form-grid"><label class="field"><span>Token</span><select name="tokenIndex">${choices.map((card, index) => `<option value="${index}">${escapeHtml(tokenLabel(card))}</option>`).join('')}</select></label>${quantityField}</div>
        <div class="simulator-token-preview" data-sim-token-preview>${cardImage(choices[0], { className: 'sim-playing-card-image' })}</div>`,
      onSubmit: (formData, currentDialog) => {
        if (applied || !currentDialog.open || !currentSource(context)) return true;
        const index = integerField(formData, 'tokenIndex', 0, choices.length - 1, 'Tokenkeuze');
        const quantity = integerField(formData, 'quantity', 1, 1000, 'Aantal');
        addSimulatorTokens(context.state, choices[index], quantity);
        applied = true;
        render();
        return true;
      }
    }), 'token');
    dialog.querySelector('[name="tokenIndex"]').addEventListener('change', (event) => {
      if (!dialog.open || !currentSource(context)) return;
      const card = choices[Number(event.target.value)];
      if (card) dialog.querySelector('[data-sim-token-preview]').innerHTML = cardImage(card, { className: 'sim-playing-card-image' });
    });
  }

  function positionMenu(context) {
    const { element, opener, clientX, clientY } = context;
    const anchor = opener?.getBoundingClientRect?.();
    const bounds = element.getBoundingClientRect();
    const x = Number.isFinite(clientX) && clientX > 0 ? clientX : (anchor?.right || 8);
    const y = Number.isFinite(clientY) && clientY > 0 ? clientY : (anchor?.bottom || 8);
    element.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
  }

  function renderMenu(context, initial = false) {
    if (!currentMenu(context)) return;
    const focused = context.element.contains(document.activeElement)
      ? document.activeElement?.getAttribute('data-sim-card-action') : null;
    const actions = [];
    if (context.choices.length) actions.push(['token', 'Maak token', '＋']);
    actions.push(['counters', 'Geef counters', '±']);
    if (isSimulatorCreature(context.item.card)) actions.push(['duplicate', 'Dupliceer', '▱']);
    if (context.error) actions.push(['retry', 'Tokengegevens opnieuw laden', '↻']);
    context.element.innerHTML = `<div class="deck-card-action-menu" role="menu" tabindex="-1" aria-label="${escapeHtml(`Acties voor ${context.item.card.name}`)}">${actions.map(([action, label, icon]) => `<button type="button" class="deck-card-action-choice" role="menuitem" data-sim-card-action="${action}"><span class="deck-card-action-icon" aria-hidden="true">${icon}</span><span><strong>${label}</strong></span></button>`).join('')}</div>
      ${context.loading || context.error ? `<p class="simulator-token-status" data-sim-token-status role="status">${escapeHtml(context.loading ? 'Tokengegevens laden…' : context.error)}</p>` : ''}`;
    positionMenu(context);
    const target = focused && context.element.querySelector(`[data-sim-card-action="${focused}"]`);
    if (target) target.focus();
    else if (initial || focused) context.element.querySelector('[role="menuitem"]')?.focus();
  }

  async function loadTokens(context) {
    if (!currentMenu(context) || context.loading) return;
    const localId = Number(context.item.card.id);
    if (!Number.isSafeInteger(localId) || localId <= 0) return;
    const cacheKey = `${localId}:${context.item.card.updatedAt || ''}`;
    const cached = tokenCache.get(cacheKey);
    if (cached) {
      context.choices = cached;
      renderMenu(context);
      return;
    }
    context.loading = true;
    context.error = '';
    context.controller = new AbortController();
    renderMenu(context);
    try {
      const tokens = await api(`/cards/${localId}/tokens`, { signal: context.controller.signal });
      if (!currentMenu(context) || context.controller.signal.aborted) return;
      if (!Array.isArray(tokens) || tokens.some((token) => !token || typeof token.name !== 'string' || typeof token.available !== 'boolean')) {
        throw new Error('De server gaf geen geldige tokengegevens terug.');
      }
      context.choices = tokenChoices(tokens);
      const incomplete = tokens.some((token) => !token.available);
      context.error = incomplete ? 'Niet alle tokengegevens zijn beschikbaar. Je kunt het opnieuw proberen.' : '';
      if (!incomplete) tokenCache.set(cacheKey, context.choices);
    } catch (error) {
      if (!currentMenu(context) || context.controller.signal.aborted) return;
      context.error = `Tokengegevens konden niet worden geladen: ${error.message || 'Onbekende fout.'}`;
    } finally {
      if (currentMenu(context)) {
        context.loading = false;
        renderMenu(context);
      }
    }
  }

  function closeMenu({ restoreFocus = false } = {}) {
    if (!menu) return;
    const context = menu;
    menu = null;
    context.controller?.abort();
    document.removeEventListener('pointerdown', context.onPointerDown, true);
    document.removeEventListener('keydown', context.onKeyDown);
    window.removeEventListener('resize', context.onViewportChange);
    window.removeEventListener('scroll', context.onViewportChange, true);
    context.element.remove();
    if (restoreFocus && context.opener?.isConnected) context.opener.focus();
  }

  function openMenu({ instanceId, opener, clientX, clientY } = {}) {
    closeMenu();
    if (disposed) return;
    const state = getState();
    const instance = state.zones.battlefield.find((entry) => entry.id === instanceId);
    const item = simulatorItem(instance, byDeckCardId);
    if (!instance || !item?.card) return;
    if (cachedState !== state) {
      tokenCache.clear();
      cachedState = state;
    }
    const element = document.createElement('div');
    element.className = 'deck-card-context-menu simulator-context-menu simulator-card-context-menu';
    element.style.left = '0px';
    element.style.top = '0px';
    document.body.append(element);
    const context = { state, instance, item, element, opener, clientX, clientY, choices: [], error: '', loading: false };
    context.onPointerDown = (event) => {
      if (!element.contains(event.target)) closeMenu();
    };
    context.onKeyDown = (event) => {
      if (!currentMenu(context)) return;
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        closeMenu({ restoreFocus: true });
        return;
      }
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      const items = [...element.querySelectorAll('[role="menuitem"]')];
      if (!items.length) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : index < 0 ? (event.key === 'ArrowUp' ? items.length - 1 : 0)
          : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
      items[next].focus();
    };
    context.onViewportChange = (event) => {
      if (event.type === 'scroll' && event.target !== window && element.contains(event.target)) return;
      closeMenu();
    };
    menu = context;
    document.addEventListener('pointerdown', context.onPointerDown, true);
    document.addEventListener('keydown', context.onKeyDown);
    window.addEventListener('resize', context.onViewportChange);
    window.addEventListener('scroll', context.onViewportChange, true);
    element.addEventListener('contextmenu', (event) => event.preventDefault());
    element.addEventListener('click', (event) => {
      const button = event.target.closest('[data-sim-card-action]');
      if (!button || !currentMenu(context)) return;
      const action = button.dataset.simCardAction;
      if (action === 'retry') {
        void loadTokens(context);
        return;
      }
      closeMenu();
      if (action === 'token') tokenDialog(context);
      else if (action === 'counters') counterDialog(context);
      else if (action === 'duplicate') duplicateDialog(context);
    });
    renderMenu(context, true);
    void loadTokens(context);
  }

  function closeDialogs() {
    closeMenu();
    for (const dialog of [...dialogs].reverse()) if (dialog.open) dialog.close();
    dialogs.clear();
    tokenCache.clear();
    cachedState = null;
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
