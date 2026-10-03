import { api } from './api.js';
import { escapeHtml, openDialog } from './utils.js';

function safePreviewImage(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'cards.scryfall.io'
      && !url.username && !url.password && !url.port) return url.href;
  } catch { /* Only trusted card image URLs can be displayed. */ }
  return '';
}

export function discoveryPreviewFaces(preview) {
  return (Array.isArray(preview?.faces) ? preview.faces : [])
    .map((face) => ({ name: String(face?.name || preview.name || 'Kaartvoorbeeld'), image: safePreviewImage(face?.image) }))
    .filter((face) => face.image)
    .slice(0, 2);
}

export function discoveryPreviewHtml(preview) {
  const faces = discoveryPreviewFaces(preview);
  if (!faces.length) return '<p role="status">Voor deze kaart is geen afbeelding beschikbaar.</p>';
  return `<div class="card-image-preview simulator-card-zoom ${faces.length > 1 ? 'has-back' : ''}">${faces.map((face) => `
    <figure class="card-image-preview-face">
      <img class="card-image-preview-image" src="${escapeHtml(face.image)}" alt="${escapeHtml(face.name)}">
      ${faces.length > 1 ? `<figcaption>${escapeHtml(face.name)}</figcaption>` : ''}
    </figure>`).join('')}</div>`;
}

export function openDiscoveryCardPreview(card) {
  if (!card?.name) return null;
  const controller = new AbortController();
  const dialog = openDialog({
    title: card.name,
    cancelLabel: 'Sluiten',
    writeAction: false,
    content: '<p role="status">Kaartafbeelding laden…</p>'
  });
  const closeOnNavigation = () => { if (dialog.open) dialog.close(); };
  window.addEventListener('hashchange', closeOnNavigation);
  dialog.addEventListener('close', () => {
    controller.abort();
    window.removeEventListener('hashchange', closeOnNavigation);
  }, { once: true });

  void (async () => {
    try {
      const preview = await api(`/card-catalog/preview?${new URLSearchParams({ name: card.name })}`, { signal: controller.signal });
      if (!dialog.open || controller.signal.aborted) return;
      const body = dialog.querySelector('.modal-body');
      dialog.classList.toggle('modal-wide', discoveryPreviewFaces(preview).length > 1);
      body.innerHTML = discoveryPreviewHtml(preview);
      body.querySelectorAll('img').forEach((image) => image.addEventListener('error', () => {
        image.hidden = true;
        const message = document.createElement('p');
        message.setAttribute('role', 'status');
        message.textContent = `De afbeelding van ${image.alt} kon niet worden geladen.`;
        image.after(message);
      }, { once: true }));
    } catch (error) {
      if (!dialog.open || controller.signal.aborted) return;
      dialog.querySelector('.modal-body').innerHTML = `<p role="status">${escapeHtml(error.message || 'De kaartafbeelding kon niet worden geladen.')}</p>`;
    }
  })();
  return dialog;
}
