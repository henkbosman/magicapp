import { escapeHtml } from './utils.js';

function storageKey(key) {
  return `magic.filters.${key}`;
}

export function filtersExpanded(key) {
  try {
    return sessionStorage.getItem(storageKey(key)) === 'open';
  } catch {
    return false;
  }
}

export function filterToggleHtml({ id, panelId, expanded = false, activeCount = 0 }) {
  const active = Number(activeCount || 0);
  const label = expanded ? 'Filters verbergen' : 'Filters tonen';
  return `<div class="filter-toggle-row">
    <button id="${escapeHtml(id)}" class="button secondary filter-toggle" type="button" aria-expanded="${expanded ? 'true' : 'false'}" aria-controls="${escapeHtml(panelId)}">
      <span class="filter-toggle-icon" aria-hidden="true">⌁</span>
      <span data-filter-toggle-label>${label}</span>
      ${active > 0 ? `<span class="filter-active-count" data-filter-active-count>${active} actief</span>` : '<span class="filter-active-count" data-filter-active-count hidden></span>'}
    </button>
  </div>`;
}

export function bindFilterToggle({ button, panel, key, getActiveCount = () => 0 }) {
  if (!button || !panel) return { updateActiveCount() {} };

  const setExpanded = (expanded) => {
    panel.hidden = !expanded;
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    const label = button.querySelector('[data-filter-toggle-label]');
    if (label) label.textContent = expanded ? 'Filters verbergen' : 'Filters tonen';
    try {
      sessionStorage.setItem(storageKey(key), expanded ? 'open' : 'closed');
    } catch {
      // Session storage is an enhancement only; the toggle still works without it.
    }
  };

  const updateActiveCount = () => {
    const count = Number(getActiveCount() || 0);
    const badge = button.querySelector('[data-filter-active-count]');
    if (!badge) return;
    badge.hidden = count <= 0;
    badge.textContent = count > 0 ? `${count} actief` : '';
  };

  button.addEventListener('click', () => setExpanded(button.getAttribute('aria-expanded') !== 'true'));
  updateActiveCount();
  return { updateActiveCount, setExpanded };
}
