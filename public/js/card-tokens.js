import { api } from './api.js';
import { cachedCardImageUrl, cardTextHtml, colorIdentity, manaCost } from './components.js';
import { escapeHtml } from './utils.js';

const COLOR_NAMES = { W: 'Wit', U: 'Blauw', B: 'Zwart', R: 'Rood', G: 'Groen' };

function tokenFaces(token) {
  if (!token.cardFaces?.length) return [token];
  return token.cardFaces.map((face, index) => ({
    name: face.name || token.name,
    typeLine: face.type_line || token.typeLine,
    manaCost: face.mana_cost || '',
    oracleText: face.oracle_text || '',
    colors: face.colors ?? token.colors ?? [],
    keywords: [...(token.keywords || []), ...(face.keywords || [])],
    power: face.power,
    toughness: face.toughness,
    images: {
      ...(index === 0 ? token.images : {
        normal: token.images?.backNormal,
        large: token.images?.backLarge,
        png: token.images?.backPng,
        small: token.images?.backSmall
      }),
      ...Object.fromEntries(Object.entries(face.image_uris || {}).filter(([, value]) => value))
    }
  }));
}

function imageSource(face) {
  const images = face.images || {};
  const source = images.normal || images.large || images.png || images.small;
  if (!source) return '';
  try {
    const url = new URL(source);
    return url.protocol === 'https:' && url.hostname === 'cards.scryfall.io' ? url.href : '';
  } catch {
    return '';
  }
}

function tokenImageHtml(token, index) {
  return (token.available ? tokenFaces(token) : [token]).map((face, faceIndex) => {
    const source = token.available ? imageSource(face) : '';
    const name = face.name || token.name;
    return `<figure class="card-token-figure" data-token-figure="${index}:${faceIndex}">
      ${source ? `<img class="card-detail-image" data-token-image src="${escapeHtml(cachedCardImageUrl(source))}" alt="${escapeHtml(name)}" loading="lazy">` : ''}
      <p class="card-token-image-error" data-token-image-error ${source ? 'hidden' : ''}>Tokenafbeelding niet beschikbaar.</p>
      <figcaption>${escapeHtml(name)}</figcaption>
    </figure>`;
  }).join('');
}

function tokenFaceInfoHtml(face) {
  const colors = Array.isArray(face.colors) ? face.colors : [];
  const colorNames = colors.map((color) => COLOR_NAMES[color] || color).join(', ') || 'Kleurloos';
  const hasStats = face.power !== undefined && face.power !== null && face.power !== ''
    && face.toughness !== undefined && face.toughness !== null && face.toughness !== '';
  return `<div class="face-block">
    <h3>${escapeHtml(face.name)} ${manaCost(face.manaCost || '')}</h3>
    <p class="card-meta">${escapeHtml(face.typeLine || '')}</p>
    <p class="card-token-facts"><span>${colorIdentity(colors)} ${escapeHtml(colorNames)}</span>${hasStats ? `<strong>${escapeHtml(face.power)} / ${escapeHtml(face.toughness)}</strong>` : ''}</p>
    ${face.oracleText ? `<div class="oracle-text">${cardTextHtml(face.oracleText, face.keywords || [])}</div>` : ''}
  </div>`;
}

function tokenInfoHtml(token, index) {
  return `<article class="card-token-info" data-token-id="${escapeHtml(token.scryfallId || String(index))}">
    ${token.available ? tokenFaces(token).map(tokenFaceInfoHtml).join('')
      : `<h3>${escapeHtml(token.name)}</h3><p class="card-meta">${escapeHtml(token.typeLine || '')}</p><p class="muted">${escapeHtml(token.error || 'Tokengegevens zijn tijdelijk niet beschikbaar.')}</p>`}
  </article>`;
}

export function bindCardTokens({ cardId, imageContainer, infoPanel, imageStack }) {
  if (!imageContainer || !infoPanel) return () => {};
  const sourceHash = window.location.hash;
  let destroyed = false;
  let loading = false;
  let generation = 0;
  let controller;
  infoPanel.innerHTML = `<header class="panel-header"><h2>Tokens</h2><button type="button" class="button secondary small" data-token-retry hidden>Opnieuw proberen</button></header>
    <div class="panel-body"><p class="muted" data-token-status role="status">Tokengegevens laden…</p><div class="card-token-info-list" data-token-items></div></div>`;
  const status = infoPanel.querySelector('[data-token-status]');
  const retry = infoPanel.querySelector('[data-token-retry]');
  const items = infoPanel.querySelector('[data-token-items]');
  const isCurrent = () => !destroyed && window.location.hash === sourceHash
    && document.getElementById(imageContainer.id || imageContainer.getAttribute('id')) === imageContainer
    && document.getElementById(infoPanel.id || infoPanel.getAttribute('id')) === infoPanel;

  async function load() {
    if (!isCurrent() || loading) return;
    loading = true;
    const requestGeneration = ++generation;
    controller?.abort();
    controller = new AbortController();
    infoPanel.hidden = false;
    status.hidden = false;
    status.textContent = 'Tokengegevens laden…';
    retry.disabled = true;
    try {
      const tokens = await api(`/cards/${cardId}/tokens`, { signal: controller.signal });
      if (!isCurrent() || generation !== requestGeneration) return;
      if (!Array.isArray(tokens) || tokens.some((token) => !token || typeof token.name !== 'string'
        || typeof token.available !== 'boolean')) throw new Error('De server gaf geen geldige tokengegevens terug.');
      if (!tokens.length) {
        imageContainer.hidden = true;
        imageContainer.innerHTML = '';
        infoPanel.hidden = true;
        items.innerHTML = '';
        imageStack?.classList.remove('card-detail-has-tokens');
        return;
      }
      imageContainer.innerHTML = `<h2>Tokens</h2>${tokens.map(tokenImageHtml).join('')}`;
      imageContainer.hidden = false;
      imageStack?.classList.add('card-detail-has-tokens');
      items.innerHTML = tokens.map(tokenInfoHtml).join('');
      const unavailable = tokens.some((token) => !token.available);
      const missingImage = tokens.some((token) => token.available && tokenFaces(token).some((face) => !imageSource(face)));
      status.textContent = unavailable ? 'Niet alle tokengegevens konden worden geladen.'
        : missingImage ? 'Niet alle tokenafbeeldingen zijn beschikbaar.' : '';
      status.hidden = !unavailable && !missingImage;
      retry.hidden = status.hidden;
      imageContainer.querySelectorAll('[data-token-image]').forEach((img) => {
        img.addEventListener('error', () => {
          if (!isCurrent() || generation !== requestGeneration) return;
          img.hidden = true;
          const message = img.closest('[data-token-figure]').querySelector('[data-token-image-error]');
          message.textContent = 'Tokenafbeelding kon niet worden geladen.';
          message.hidden = false;
          status.textContent = 'Een of meer tokenafbeeldingen konden niet worden geladen.';
          status.hidden = false;
          retry.hidden = false;
        });
      });
    } catch (error) {
      if (!isCurrent() || generation !== requestGeneration) return;
      status.textContent = `Tokengegevens konden niet worden geladen: ${error.message || 'Onbekende fout.'}`;
      status.hidden = false;
      retry.hidden = false;
    } finally {
      if (isCurrent() && generation === requestGeneration) {
        loading = false;
        retry.disabled = false;
      }
    }
  }

  const onRetry = () => { void load(); };
  const onNavigation = () => { if (window.location.hash !== sourceHash) destroy(); };
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    generation++;
    controller?.abort();
    retry.removeEventListener?.('click', onRetry);
    window.removeEventListener?.('hashchange', onNavigation);
  }
  retry.addEventListener('click', onRetry);
  window.addEventListener?.('hashchange', onNavigation);
  void load();
  return destroy;
}
