import { api } from './api.js';
import { escapeHtml, formValue, openDialog } from './utils.js';

const IMPORT_SECTION_LABELS = {
  main: 'Deck', commander: 'Commander', partner: 'Partner', companion: 'Companion',
  sideboard: 'Sideboard', maybeboard: 'Maybeboard'
};

function closeOnNavigation(dialog, sourceHash) {
  const onNavigation = () => {
    if (window.location.hash !== sourceHash && dialog.open) dialog.close();
  };
  window.addEventListener('hashchange', onNavigation);
  dialog.addEventListener('close', () => window.removeEventListener('hashchange', onNavigation), { once: true });
}

function importResultSummary(result) {
  const importedCount = Number(result?.importedCount);
  if (!Number.isSafeInteger(importedCount) || importedCount < 0 || !Array.isArray(result?.failed)) {
    throw new Error('De server heeft geen geldig importresultaat teruggegeven.');
  }
  // Older servers return saved deck rows, whose quantities can include cards
  // already present. Only the explicit input-quantity total is reliable here.
  const importedQuantity = Number.isSafeInteger(result.importedQuantity) && result.importedQuantity >= 0
    ? result.importedQuantity : null;
  const failed = result.failed;
  const title = failed.length
    ? importedCount ? 'Deck gedeeltelijk geïmporteerd' : 'Deck niet geïmporteerd'
    : 'Deck geïmporteerd';
  const rows = `${importedCount} ${importedCount === 1 ? 'kaartregel' : 'kaartregels'}`;
  const quantity = importedQuantity === null ? ''
    : ` (${importedQuantity} ${importedQuantity === 1 ? 'kaart' : 'kaarten'})`;
  const summary = failed.length
    ? `${rows} geïmporteerd${quantity}. ${failed.length} ${failed.length === 1 ? 'regel is' : 'regels zijn'} overgeslagen.`
    : `${importedCount === 1 ? 'De kaartregel is' : `Alle ${rows} zijn`} geïmporteerd${quantity}.`;
  return { title, summary, failed };
}

function showImportResult(result, sourceHash) {
  const { title, summary, failed } = importResultSummary(result);
  const dialog = openDialog({
    title,
    wide: true,
    cancelLabel: 'Sluiten',
    writeAction: false,
    content: `<p class="import-result" data-import-summary role="status">${escapeHtml(summary)}</p>
      ${failed.length ? `<section class="import-validation-errors">
        <h3>Overgeslagen regels</h3>
        <p>De volgende regels zijn niet geïmporteerd. Corrigeer en importeer alleen deze regels opnieuw, onder de juiste sectiekop zoals Commander of Sideboard.</p>
        <div class="import-validation-list">${failed.map((failure) => {
          const line = Number(failure?.line);
          const prefix = Number.isSafeInteger(line) && line > 0 ? `Regel ${line}: ` : '';
          const rawLine = failure?.rawLine || failure?.name || 'Onbekende regel';
          const reason = failure?.reason || 'De kaart kon niet worden geïmporteerd.';
          const section = IMPORT_SECTION_LABELS[failure?.role];
          return `<div class="import-validation-item" data-import-failure>
            <strong data-import-line>${escapeHtml(prefix)}${escapeHtml(rawLine)}</strong>
            ${section ? `<span data-import-role>Sectie: ${escapeHtml(section)}</span>` : ''}
            <span data-import-reason>${escapeHtml(reason)}</span>
          </div>`;
        }).join('')}</div>
      </section>` : ''}
      <p class="import-warning" data-import-refresh-error role="alert" hidden></p>`
  });
  closeOnNavigation(dialog, sourceHash);
  return dialog;
}

export function openDeckImport(deckId, { onDone } = {}) {
  const id = Number(deckId);
  if (!Number.isInteger(id) || id < 1) return null;
  const sourceHash = window.location.hash;
  const dialog = openDialog({
    title: 'Decklijst importeren',
    submitLabel: 'Importeren',
    wide: true,
    initialFocus: '[name="text"]',
    content: `<p>Plak een lijst in het formaat <strong>1 Card Name</strong>. Moxfield-regels zoals <strong>1 Card Name (SET) 123</strong> worden ook herkend.</p>
      <div class="field"><label>Decklijst</label><textarea name="text" rows="14" required placeholder="Commander\n1 Yedora, Grave Gardener\n\nDeck\n1 Sol Ring"></textarea></div>
      <p class="import-warning" data-import-error role="alert" tabindex="-1" hidden></p>`,
    onSubmit: async (data, formDialog) => {
      const isCurrent = () => formDialog.open && window.location.hash === sourceHash;
      if (!isCurrent()) {
        formDialog.close();
        return false;
      }
      const errorElement = formDialog.querySelector('[data-import-error]');
      errorElement.hidden = true;
      errorElement.textContent = '';
      let result;
      try {
        result = await api(`/decks/${id}/import`, { method: 'POST', body: { text: formValue(data, 'text') } });
        if (!isCurrent()) return false;
        importResultSummary(result);
      } catch (error) {
        if (!isCurrent()) return false;
        const uncertain = !error?.status || error.status >= 500;
        errorElement.textContent = `${error.message || 'Importeren is niet gelukt.'}${uncertain ? ' Controleer je deck voordat je opnieuw importeert.' : ''}`;
        errorElement.hidden = false;
        errorElement.focus();
        return false;
      }
      // The result lives outside the page content, so refreshing the deck does
      // not discard the report or offer to submit successful rows a second time.
      formDialog.close();
      const resultDialog = showImportResult(result, sourceHash);
      try {
        await onDone?.(result);
      } catch (error) {
        if (resultDialog.open && window.location.hash === sourceHash) {
          const notice = resultDialog.querySelector('[data-import-refresh-error]');
          notice.textContent = 'Het importresultaat is verwerkt, maar het deckoverzicht kon niet worden vernieuwd. Herlaad de pagina om het bijgewerkte deck te zien.';
          notice.hidden = false;
        }
      }
      return false;
    }
  });
  closeOnNavigation(dialog, sourceHash);
  return dialog;
}
