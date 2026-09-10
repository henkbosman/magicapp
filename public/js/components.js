import { apiPath } from './api.js';
import { escapeHtml, formatEuro, formatNumber } from './utils.js';


const RARITY_LABELS = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  mythic: 'Mythic',
  special: 'Special',
  bonus: 'Bonus'
};

const COLOR_LABELS = {
  W: 'Wit', U: 'Blauw', B: 'Zwart', R: 'Rood', G: 'Groen', C: 'Kleurloos', M: 'Meerkleurig',
  colorless: 'Kleurloos', multicolor: 'Meerkleurig'
};

const SEARCH_TARGET_LABELS = {
  land: 'Land', basic_land: 'Basic land', creature: 'Creature', artifact: 'Artifact',
  enchantment: 'Enchantment', instant: 'Instant', sorcery: 'Sorcery',
  planeswalker: 'Planeswalker', battle: 'Battle', any: 'Elke kaart', other: 'Andere/specifieke kaart'
};

function manaClass(part) {
  return ['W', 'U', 'B', 'R', 'G', 'C', 'S', 'P', 'M'].includes(part) ? part : 'generic';
}

function manaGlyph(part) {
  const value = String(part || '').toUpperCase();
  const paths = {
    W: '<circle cx="12" cy="12" r="3.3"/><path d="M12 2.3v4M12 17.7v4M2.3 12h4M17.7 12h4M5.15 5.15l2.85 2.85M16 16l2.85 2.85M18.85 5.15L16 8M8 16l-2.85 2.85" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
    U: '<path d="M12 2.1c-.9 2.3-6.4 7-6.4 12.1A6.4 6.4 0 0 0 12 20.7a6.4 6.4 0 0 0 6.4-6.5C18.4 9.1 12.9 4.4 12 2.1Zm-3.4 12c.5 1.7 1.6 2.7 3.4 3" fill="currentColor"/>',
    B: '<path d="M12 2.7c-4.5 0-7.4 3-7.4 7.1 0 2.7 1.2 4.6 3.1 5.8v3.1h2v2.1h1.8v-2.1h1v2.1h1.8v-2.1h2v-3.1c1.9-1.2 3.1-3.1 3.1-5.8 0-4.1-2.9-7.1-7.4-7.1Z"/><circle cx="9" cy="10.8" r="1.7" fill="rgba(255,255,255,.72)"/><circle cx="15" cy="10.8" r="1.7" fill="rgba(255,255,255,.72)"/><path d="m12 12.3-1.2 2h2.4Z" fill="rgba(255,255,255,.72)"/>',
    R: '<path d="M13.7 2.1c.5 3.7-2.7 4.8-2.1 7.6-1.7-.8-1.5-2.8-1.1-4.2-3.1 2.6-5 5.4-5 8.6a6.5 6.5 0 0 0 13 0c0-3.6-2.2-7.6-4.8-12Zm-1.5 17.5c-2 0-3.5-1.4-3.5-3.3 0-1.6 1-3.1 2.7-4.7-.1 1.7.7 2.6 1.6 3.2.6-.9.9-2 .7-3.2 1.3 1.4 2 3 2 4.5 0 2-1.5 3.5-3.5 3.5Z"/>',
    G: '<path d="M12 2.2c-2.2 2.7-6.9 4-6.9 9.1 0 3.6 2.7 6.2 6 6.5v3.9h1.9v-4c3.3-.4 5.9-3 5.9-6.4 0-5-4.7-6.4-6.9-9.1Zm0 12.4-3.2-3.2 1.2-1.2 1.1 1.1V7.1h1.8v5.4l1.8-1.8 1.2 1.2Z"/>',
    C: '<path d="M12 2.8 21.2 12 12 21.2 2.8 12Zm0 4.1L6.9 12l5.1 5.1 5.1-5.1Z" fill-rule="evenodd"/>',
    S: '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6M9.8 4.8 12 7l2.2-2.2M9.8 19.2 12 17l2.2 2.2M4.8 9.8 7.6 9l-.7-2.8M19.2 14.2l-2.8.8.7 2.8M4.8 14.2l2.8.8-.7 2.8M19.2 9.8 16.4 9l.7-2.8" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/>',
    P: '<circle cx="12" cy="12" r="7.8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3.3v17.4M8.2 8.2h5.2a3.6 3.6 0 0 1 0 7.2H9.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    M: '<path d="m12 3 2.2 5.6 6 .4-4.6 3.8 1.5 5.9-5.1-3.2-5.1 3.2 1.5-5.9L3.8 9l6-.4Z"/>'
  };
  if (paths[value]) return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[value]}</svg>`;
  const shown = value === 'T' ? '↷' : value;
  return `<span class="mana-symbol-text">${escapeHtml(shown)}</span>`;
}

function manaName(value) {
  const token = String(value || '').toUpperCase();
  if (COLOR_LABELS[token]) return `${COLOR_LABELS[token]} mana`;
  if (token === 'S') return 'Sneeuwmana';
  if (token === 'P') return 'Phyrexian mana';
  if (/^\d+$/.test(token)) return `${token} generieke mana`;
  if (token === 'X' || token === 'Y' || token === 'Z') return `${token} variabele mana`;
  return token;
}

export function manaSymbol(value, { label = '' } = {}) {
  const token = String(value || '').replace(/^\{?|\}?$/g, '').toUpperCase();
  const ariaLabel = label || (token.includes('/') ? token.split('/').map(manaName).join(' of ') : manaName(token));
  if (token.includes('/')) {
    const parts = token.split('/').slice(0, 2);
    return `<span class="mana-symbol mana-hybrid" role="img" aria-label="${escapeHtml(ariaLabel)}">${parts.map((part, index) => `<span class="mana-symbol-part mana-bg-${manaClass(part)} ${index === 0 ? 'left' : 'right'}" aria-hidden="true">${manaGlyph(part)}</span>`).join('')}</span>`;
  }
  return `<span class="mana-symbol mana-bg-${manaClass(token)}" role="img" aria-label="${escapeHtml(ariaLabel)}"><span aria-hidden="true">${manaGlyph(token)}</span></span>`;
}

export function manaLabel(value, label = '') {
  const token = value === 'colorless' ? 'C' : value === 'multicolor' ? 'M' : String(value).toUpperCase();
  const text = label || COLOR_LABELS[value] || COLOR_LABELS[token] || value;
  return `<span class="mana-label">${manaSymbol(token, { label: text })}<span>${escapeHtml(text)}</span></span>`;
}

export function pageHeader({ eyebrow = '', title, description = '', actions = '' }) {
  return `<header class="page-header">
    <div>${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ''}<h1>${escapeHtml(title)}</h1>${description ? `<p>${escapeHtml(description)}</p>` : ''}</div>
    ${actions ? `<div class="page-actions">${actions}</div>` : ''}
  </header>`;
}

export function metric(label, value, detail = '', tone = '') {
  return `<article class="metric-card ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</article>`;
}

export function manaCost(value) {
  if (!value) return '<span class="muted">—</span>';
  const parts = String(value).match(/\{[^}]+\}/g) || [value];
  return `<span class="mana-cost" aria-label="Manakosten ${escapeHtml(value)}">${parts.map((part) => manaSymbol(part)).join('')}</span>`;
}

export function colorIdentity(colors = []) {
  if (!colors.length) return `<span class="color-dots">${manaSymbol('C')}</span>`;
  return `<span class="color-dots">${colors.map((color) => manaSymbol(color)).join('')}</span>`;
}

export function cachedCardImageUrl(url) {
  if (!url) return '';
  return apiPath(`/cards/image-cache?url=${encodeURIComponent(url)}`);
}

export function cardImage(card, { className = '', back = false } = {}) {
  const remoteSource = back ? card.images?.backNormal : (card.images?.small || card.images?.normal);
  if (!remoteSource) return `<div class="card-image-placeholder ${className}"><span>${escapeHtml(card.name?.slice(0, 1) || '?')}</span></div>`;
  const localId = Number(card.id);
  const detailImage = /detail|preview|commander/.test(className);
  const size = detailImage ? 'normal' : 'small';
  const revision = encodeURIComponent(`${card.scryfallId || ''}:${card.updatedAt || ''}`);
  const source = Number.isInteger(localId) && localId > 0
    ? apiPath(`/cards/${localId}/image?face=${back ? 'back' : 'front'}&size=${size}&v=${revision}`)
    : cachedCardImageUrl(remoteSource);
  return `<img class="card-image ${className}" src="${escapeHtml(source)}" alt="${escapeHtml(back ? `Achterzijde van ${card.name}` : card.name)}" loading="lazy">`;
}

function manaEntrySymbols(mana) {
  const value = String(mana || '').toUpperCase();
  if (value === 'ANY') return '<span class="any-mana-symbol" title="Mana van een kleur naar keuze">✦</span>';
  return value.split('/').filter(Boolean).map((part, index) => `${index ? '<span class="mana-choice-separator">/</span>' : ''}${manaSymbol(part)}`).join('');
}

export function manaProductionHtml(entries = [], { emptyText = 'Geen mana-productie herkend.' } = {}) {
  if (!entries.length) return `<span class="muted">${escapeHtml(emptyText)}</span>`;
  return `<span class="mana-production-list">${entries.map((entry) => `<span class="mana-production-entry">${entry.variable ? '<span title="Variabele hoeveelheid">X×</span>' : `<strong>${Number(entry.amount || 1)}×</strong>`}${manaEntrySymbols(entry.mana)}</span>`).join('')}</span>`;
}

export function librarySearchHtml(targets = [], { emptyText = 'Geen deckzoekfunctie herkend.' } = {}) {
  if (!targets.length) return `<span class="muted">${escapeHtml(emptyText)}</span>`;
  return `<span class="library-search-list">${targets.map((target) => `<span class="function-chip tutor">⌕ ${escapeHtml(SEARCH_TARGET_LABELS[target] || target)}</span>`).join('')}</span>`;
}

export function cardInsightBadges(card, { showEmpty = false } = {}) {
  const mana = card?.insights?.manaProduction?.entries || [];
  const search = card?.insights?.librarySearch?.targets || [];
  if (!mana.length && !search.length && !showEmpty) return '';
  return `<div class="card-insight-badges">
    ${mana.length ? `<span class="function-chip mana"><span>Produceert</span>${manaProductionHtml(mana)}</span>` : ''}
    ${search.length ? `<span class="function-chip tutor"><span>Zoekt</span>${search.map((target) => escapeHtml(SEARCH_TARGET_LABELS[target] || target)).join(', ')}</span>` : ''}
    ${showEmpty && !mana.length && !search.length ? '<span class="function-chip neutral">Geen mana- of zoekfunctie herkend</span>' : ''}
  </div>`;
}

export function cardInsightSourceLabel(source) {
  return ({ manual: 'Handmatig', oracle: 'Afgeleid uit kaarttekst', scryfall: 'Scryfall', none: 'Niet herkend' })[source] || source || 'Niet herkend';
}

export function librarySearchTargetLabel(target) {
  return SEARCH_TARGET_LABELS[target] || target;
}

export function rarityBadge(rarity, { title = '' } = {}) {
  const value = String(rarity || '').toLowerCase();
  const label = RARITY_LABELS[value] || rarity || 'Onbekend';
  const tooltip = title || `Rarity: ${label}`;
  return `<span class="rarity-badge rarity-${escapeHtml(value || 'unknown')}" title="${escapeHtml(tooltip)}" aria-label="${escapeHtml(tooltip)}">${escapeHtml(label)}</span>`;
}

export function usageBadges(usage, { compact = false } = {}) {
  if (!usage) return '';
  const cls = compact ? 'usage-badges compact' : 'usage-badges';
  return `<div class="${cls}">
    <span class="badge owned">In bezit <strong>${formatNumber(usage.owned)}</strong></span>
    <span class="badge used">Nodig <strong>${formatNumber(usage.needed)}</strong></span>
    ${usage.assumedAvailable
      ? '<span class="badge neutral">Basic land beschikbaar</span>'
      : `<span class="badge ${usage.free > 0 ? 'free' : 'neutral'}">Vrij <strong>${formatNumber(usage.free)}</strong></span>`}
    ${usage.shortage > 0 ? `<span class="badge missing">Tekort <strong>${formatNumber(usage.shortage)}</strong></span>` : ''}
    ${usage.wanted > 0 ? `<span class="badge wanted">Wanted <strong>${formatNumber(usage.wanted)}</strong></span>` : ''}
  </div>`;
}

export function cardSearchResult(card) {
  const decks = card.usage?.decks || [];
  return `<button type="button" class="search-result" data-card-id="${card.id}">
    ${cardImage(card, { className: 'search-result-image' })}
    <span class="search-result-main">
      <span class="search-result-title"><strong>${escapeHtml(card.name)}</strong>${manaCost(card.manaCost)}</span>
      <small>${escapeHtml(card.typeLine)} · ${escapeHtml(card.setCode.toUpperCase())} #${escapeHtml(card.collectorNumber)}</small>
      ${usageBadges(card.usage, { compact: true })}
      ${decks.length ? `<small class="deck-line">Decks: ${decks.map((deck) => escapeHtml(deck.name)).join(', ')}</small>` : ''}
    </span>
    <span class="chevron">›</span>
  </button>`;
}

export function progressBar(value, max, label = '') {
  const safeMax = Math.max(Number(max || 0), 1);
  return `<div class="progress-wrap">${label ? `<div class="progress-label"><span>${escapeHtml(label)}</span><strong>${formatNumber(value)} / ${formatNumber(max)}</strong></div>` : ''}<progress max="${safeMax}" value="${Math.max(0, Number(value || 0))}"></progress></div>`;
}

export function barChart(entries, { emptyText = 'Geen gegevens', formatLabel = (key) => key, formatLabelHtml = null } = {}) {
  const rows = Object.entries(entries || {}).filter(([, value]) => Number(value) > 0 || Object.keys(entries || {}).length <= 8);
  const max = Math.max(...rows.map(([, value]) => Number(value)), 1);
  if (!rows.length) return `<p class="muted">${escapeHtml(emptyText)}</p>`;
  return `<div class="bar-chart">${rows.map(([key, value]) => {
    const label = formatLabel(key);
    const labelContent = formatLabelHtml ? formatLabelHtml(key) : escapeHtml(label);
    return `<div class="bar-row"><span title="${escapeHtml(label)}">${labelContent}</span><progress max="${max}" value="${Number(value)}"></progress><strong>${formatNumber(value)}</strong></div>`;
  }).join('')}</div>`;
}

export function manaBarChart(entries, options = {}) {
  return barChart(entries, {
    ...options,
    formatLabel: (key) => COLOR_LABELS[key] || COLOR_LABELS[String(key).toUpperCase()] || key,
    formatLabelHtml: (key) => manaLabel(key)
  });
}



export function tagPills(tags = []) {
  return tags.length ? `<div class="tag-list">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>` : '';
}

export function sectionCard(title, content, action = '') {
  return `<section class="panel"><header class="panel-header"><h2>${escapeHtml(title)}</h2>${action}</header><div class="panel-body">${content}</div></section>`;
}
