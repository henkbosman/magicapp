import { apiPath } from './api.js';
import { prepareCardDetailNavigation } from './navigation-state.js';
import { escapeHtml, openDialog } from './utils.js';

function hasBackImage(card) {
  const images = card?.images || {};
  return Boolean(images.backLarge || images.backNormal || images.backSmall || images.backPng);
}

function previewImageUrl(card, face) {
  const revision = encodeURIComponent(`${card.scryfallId || ''}:${card.updatedAt || ''}`);
  return apiPath(`/cards/${Number(card.id)}/image?face=${face}&size=large&v=${revision}`);
}

export function openCardPreview(card, { detailCardId = card?.id } = {}) {
  const cardId = Number(card?.id);
  const targetCardId = Number(detailCardId);
  if (!Number.isInteger(cardId) || cardId < 1 || !Number.isInteger(targetCardId) || targetCardId < 1) {
    return null;
  }

  const hasBack = hasBackImage(card);
  const title = card.name || 'Kaartvoorbeeld';
  const frontUrl = previewImageUrl(card, 'front');
  const backUrl = hasBack ? previewImageUrl(card, 'back') : '';

  return openDialog({
    title,
    cancelLabel: 'Sluiten',
    submitLabel: 'Details',
    wide: hasBack,
    writeAction: false,
    content: `<div class="card-image-preview simulator-card-zoom ${hasBack ? 'has-back' : ''}">
      <figure class="card-image-preview-face">
        <img class="card-image-preview-image" src="${escapeHtml(frontUrl)}" alt="${escapeHtml(title)}">
        ${hasBack ? '<figcaption>Voorzijde</figcaption>' : ''}
      </figure>
      ${hasBack ? `<figure class="card-image-preview-face">
        <img class="card-image-preview-image" src="${escapeHtml(backUrl)}" alt="${escapeHtml(`Achterzijde van ${title}`)}">
        <figcaption>Achterzijde</figcaption>
      </figure>` : ''}
    </div>`,
    onSubmit: async () => {
      window.location.hash = prepareCardDetailNavigation(`#/cards/${targetCardId}`);
      return true;
    }
  });
}
