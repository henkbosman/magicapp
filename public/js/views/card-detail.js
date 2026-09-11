import { api, queryString } from '../api.js';
import { addCardToCollection, addCardToDeck, addCardToWanted } from '../card-actions.js';
import { cardImage, cardInsightSourceLabel, colorIdentity, librarySearchHtml, manaCost, manaProductionHtml, pageHeader, usageBadges } from '../components.js';
import { openCardInsightsEditor } from '../card-insights.js';
import { isBasicLand } from '../card-rules.js';
import { escapeHtml, formatEuro, refreshView, toast } from '../utils.js';
import { getCardReturnLabel, returnToCardSource } from '../navigation-state.js';

function faceText(card) {
  if (card.cardFaces?.length) {
    return card.cardFaces.map((face) => `<div class="face-block"><h3>${escapeHtml(face.name || card.name)} ${manaCost(face.mana_cost || '')}</h3><p class="card-meta">${escapeHtml(face.type_line || '')}</p><div class="oracle-text">${escapeHtml(face.oracle_text || face.printed_text || '')}</div>${face.power !== undefined && face.power !== null ? `<p><strong>${escapeHtml(face.power)} / ${escapeHtml(face.toughness)}</strong></p>` : ''}</div>`).join('');
  }
  return `<div class="oracle-text">${escapeHtml(card.oracleText || 'Geen Oracle text beschikbaar.')}</div>${card.power !== null ? `<p><strong>${escapeHtml(card.power)} / ${escapeHtml(card.toughness)}</strong></p>` : ''}`;
}

function legalityGrid(card) {
  const formats = ['commander','standard','pioneer','modern','legacy','vintage','pauper','oathbreaker','brawl'];
  return `<div class="legality-grid">${formats.map((format) => {
    const status = card.legalities?.[format] || 'not_legal';
    return `<div class="legality ${escapeHtml(status)}"><strong>${escapeHtml(format)}</strong><br>${escapeHtml(status.replace('_',' '))}</div>`;
  }).join('')}</div>`;
}

function ownedImageVariants(collectionItems, fallbackCard) {
  const variants = new Map();
  for (const item of collectionItems) {
    const key = String(item.card.id);
    const current = variants.get(key) || {
      card: item.card,
      quantity: 0,
      finishes: new Set(),
      languages: new Set()
    };
    current.quantity += Number(item.quantity || 0);
    if (item.finish) current.finishes.add(item.finish);
    if (item.language) current.languages.add(item.language);
    variants.set(key, current);
  }
  const rows = [...variants.values()].map((entry) => ({
    ...entry,
    finishes: [...entry.finishes],
    languages: [...entry.languages]
  }));
  rows.sort((left, right) => Number(right.card.id === fallbackCard.id) - Number(left.card.id === fallbackCard.id)
    || String(left.card.releasedAt || '').localeCompare(String(right.card.releasedAt || ''))
    || String(left.card.setName || '').localeCompare(String(right.card.setName || ''), 'nl'));
  return rows.length ? rows : [{ card: fallbackCard, quantity: 0, finishes: [], languages: [] }];
}

function ownedImageViewer(variants) {
  return `<div class="owned-image-viewer">
    <div class="owned-image-stage">
      ${variants.map((variant, index) => `<div class="owned-image-slide" data-owned-image-slide="${index}" ${index === 0 ? '' : 'hidden'}>
        ${cardImage(variant.card, { className: 'card-detail-image' })}
        ${variant.card.images.backNormal ? cardImage(variant.card, { className: 'card-detail-image', back: true }) : ''}
      </div>`).join('')}
    </div>
    ${variants.length > 1 ? `<div class="owned-image-switcher" aria-label="Afbeelding van fysiek exemplaar kiezen">
      <div class="owned-image-switcher-header"><strong>Afbeelding</strong><span id="owned-image-position">1 van ${variants.length}</span></div>
      <div class="owned-image-choice-list">
        ${variants.map((variant, index) => `<button type="button" class="owned-image-choice ${index === 0 ? 'active' : ''}" data-owned-image-index="${index}" aria-pressed="${index === 0 ? 'true' : 'false'}">
          <span>${escapeHtml(variant.card.setCode.toUpperCase())} #${escapeHtml(variant.card.collectorNumber)}</span>
          <small>${variant.quantity}× in bezit${variant.finishes.length ? ` · ${escapeHtml(variant.finishes.join(', '))}` : ''}</small>
        </button>`).join('')}
      </div>
    </div>` : ''}
  </div>`;
}

export async function renderCardDetail(context) {
  const cardId = Number(context.params.id);
  const returnToken = context.query.get('return') || '';
  const returnLabel = getCardReturnLabel(returnToken);
  const card = await api(`/cards/${cardId}`);
  const [collectionResult, wantedResult] = await Promise.all([
    api(`/collection/card/${cardId}`),
    api(`/wanted${queryString({ q: card.name })}`)
  ]);
  const collectionItems = collectionResult.items;
  const wantedItems = wantedResult.filter((item) => item.card.cardKey === card.cardKey);
  const euro = card.prices?.eur;
  const euroFoil = card.prices?.eur_foil;
  const imageVariants = ownedImageVariants(collectionItems, card);

  const collectionHtml = collectionItems.length ? `<div class="card-list">${collectionItems.map((item) => `<div class="collection-detail-row"><strong>${item.quantity}× ${escapeHtml(item.card.setName)} (${escapeHtml(item.card.setCode.toUpperCase())}) #${escapeHtml(item.card.collectorNumber)}</strong><span>${escapeHtml(item.finish)} · ${escapeHtml(item.language)} · ${escapeHtml(item.condition)}${item.location ? ` · ${escapeHtml(item.location)}` : ''}</span></div>`).join('')}</div>` : '<p class="muted">Deze Oracle-kaart is nog niet in je collectie aanwezig.</p>';
  const deckHtml = card.usage.decks.length ? `<div class="deck-link-list">${card.usage.decks.map((deck) => `<a href="#/decks/${deck.id}"><span>${escapeHtml(deck.name)}</span><strong>${deck.quantity}×</strong></a>`).join('')}</div>` : '<p class="muted">Deze kaart wordt nog niet in een deck gebruikt.</p>';

  return {
    html: `
      ${pageHeader({
        eyebrow: `${card.setName} · ${card.setCode.toUpperCase()} #${card.collectorNumber}`,
        title: card.name,
        description: card.printedName && card.printedName !== card.name ? card.printedName : card.typeLine,
        actions: `<button id="card-detail-back" class="button secondary" type="button">← ${escapeHtml(returnLabel)}</button><button id="card-add-collection" class="button primary" data-write-action>＋ Collectie</button><button id="card-add-deck" class="button secondary" data-write-action>▤ Deck</button>${isBasicLand(card) ? '' : '<button id="card-add-wanted" class="button secondary" data-write-action>☆ Wanted</button>'}`
      })}
      <section class="card-detail-grid">
        <div class="card-detail-image-stack">
          ${ownedImageViewer(imageVariants)}
          <button id="refresh-card" class="button secondary" data-write-action>Kaartgegevens vernieuwen</button>
        </div>
        <div>
          <section class="panel"><div class="panel-body">
            <div class="card-title-row"><h2>${escapeHtml(card.name)}</h2>${manaCost(card.manaCost)}</div>
            <p>${colorIdentity(card.colorIdentity)} <span class="muted">Mana value ${card.manaValue}</span></p>
            <h3>${escapeHtml(card.typeLine)}</h3>
            ${faceText(card)}
          </div></section>
          <section class="panel card-availability-panel"><header class="panel-header"><h2>Beschikbaarheid</h2></header><div class="panel-body">${usageBadges(card.usage)}${card.usage.decks.length ? `<p class="help-text">Verschillende fysieke printings tellen samen op basis van Oracle-identiteit.</p>` : ''}</div></section>
          <section class="grid-2">
            <section class="panel"><header class="panel-header"><h2>Kaartgegevens</h2></header><div class="panel-body"><div class="card-facts">
              <div class="fact"><span>Set</span><strong>${escapeHtml(card.setName)}</strong></div>
              <div class="fact"><span>Collector</span><strong>${escapeHtml(card.setCode.toUpperCase())} #${escapeHtml(card.collectorNumber)}</strong></div>
              <div class="fact"><span>Rarity</span><strong>${escapeHtml(card.rarity)}</strong></div>
              <div class="fact"><span>Taal</span><strong>${escapeHtml(card.language)}</strong></div>
              <div class="fact"><span>Artist</span><strong>${escapeHtml(card.artist || '—')}</strong></div>
              <div class="fact"><span>Releasedatum</span><strong>${escapeHtml(card.releasedAt || '—')}</strong></div>
              <div class="fact"><span>Non-foil prijs</span><strong>${formatEuro(euro)}</strong></div>
              <div class="fact"><span>Foil prijs</span><strong>${formatEuro(euroFoil)}</strong></div>
            </div></div></section>
            <section class="panel"><header class="panel-header"><h2>Keywords</h2></header><div class="panel-body">${card.keywords.length ? `<div class="tag-list">${card.keywords.map((keyword) => `<span class="tag">${escapeHtml(keyword)}</span>`).join('')}</div>` : '<p class="muted">Geen Scryfall-keywords.</p>'}</div></section>
          </section>
          <section class="panel card-insights-panel">
            <header class="panel-header"><h2>Mana en deckzoekfuncties</h2><button id="edit-card-insights" class="button secondary small" data-write-action>Kenmerken bewerken</button></header>
            <div class="panel-body insight-detail-grid">
              <div class="insight-detail-card"><span>Produceert mana</span><strong>${manaProductionHtml(card.insights?.manaProduction?.entries || [])}</strong><small>${escapeHtml(cardInsightSourceLabel(card.insights?.manaProduction?.source))}${card.insights?.manaProduction?.note ? ` · ${escapeHtml(card.insights.manaProduction.note)}` : ''}</small></div>
              <div class="insight-detail-card"><span>Kan opzoeken in library</span><strong>${librarySearchHtml(card.insights?.librarySearch?.targets || [])}</strong><small>${escapeHtml(cardInsightSourceLabel(card.insights?.librarySearch?.source))}${card.insights?.librarySearch?.note ? ` · ${escapeHtml(card.insights.librarySearch.note)}` : ''}</small></div>
            </div>
          </section>
          <section class="panel"><header class="panel-header"><h2>Fysieke exemplaren</h2></header><div class="panel-body">${collectionHtml}</div></section>
          <section class="panel"><header class="panel-header"><h2>Decks</h2></header><div class="panel-body">${deckHtml}</div></section>
          <section class="panel"><header class="panel-header"><h2>Wanted-status</h2></header><div class="panel-body">${wantedItems.length ? wantedItems.map((item) => `<p><strong>${item.quantity}× gewenst</strong> · prioriteit ${item.priority} · maximum ${formatEuro(item.maximumPrice)}</p>`).join('') : '<p class="muted">Niet op wanted-list.</p>'}</div></section>
          <section class="panel"><header class="panel-header"><h2>Legaliteit</h2></header><div class="panel-body">${legalityGrid(card)}</div></section>
        </div>
      </section>`,
    mount() {
      const imageSlides = [...document.querySelectorAll('[data-owned-image-slide]')];
      const imageChoices = [...document.querySelectorAll('[data-owned-image-index]')];
      const imagePosition = document.getElementById('owned-image-position');
      const showOwnedImage = (index) => {
        imageSlides.forEach((slide, slideIndex) => { slide.hidden = slideIndex !== index; });
        imageChoices.forEach((choice, choiceIndex) => {
          const active = choiceIndex === index;
          choice.classList.toggle('active', active);
          choice.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        if (imagePosition) imagePosition.textContent = `${index + 1} van ${imageSlides.length}`;
      };
      imageChoices.forEach((choice) => choice.addEventListener('click', () => {
        showOwnedImage(Number(choice.dataset.ownedImageIndex));
      }));

      document.getElementById('card-detail-back')?.addEventListener('click', () => returnToCardSource(returnToken));
      document.getElementById('edit-card-insights')?.addEventListener('click', () => openCardInsightsEditor(card, { onDone: refreshView }));
      document.getElementById('card-add-collection')?.addEventListener('click', () => addCardToCollection(card, { onDone: refreshView }));
      document.getElementById('card-add-wanted')?.addEventListener('click', () => addCardToWanted(card, { onDone: refreshView }));
      document.getElementById('card-add-deck')?.addEventListener('click', () => addCardToDeck(card, { onDone: refreshView }));
      document.getElementById('refresh-card')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true; button.textContent = 'Vernieuwen…';
        try { await api(`/cards/${card.id}/refresh`, { method: 'POST', body: {} }); toast('Kaartgegevens zijn vernieuwd.'); refreshView(); }
        catch (error) { toast(error.message, 'error'); button.disabled = false; button.textContent = 'Kaartgegevens vernieuwen'; }
      });
    }
  };
}
