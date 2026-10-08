import { api } from './api.js';
import { openDialog } from './utils.js';

let exportDialogSequence = 0;

export function openDeckExport(deckId) {
  const id = Number(deckId);
  if (!Number.isInteger(id) || id < 1) return null;

  const prefix = `deck-export-${++exportDialogSequence}`;
  const dialog = openDialog({
    title: 'Deck exporteren',
    cancelLabel: 'Sluiten',
    wide: true,
    writeAction: false,
    initialFocus: '[data-export-format]',
    content: `<div class="deck-export-controls">
      <div class="field">
        <label for="${prefix}-format">Exportformaat</label>
        <select id="${prefix}-format" data-export-format>
          <option value="txt">Tekst (.txt)</option>
          <option value="dck">Forge / Neo Forge (.dck)</option>
        </select>
      </div>
      <div class="page-actions">
        <button type="button" class="button primary" data-export-download disabled>Downloaden</button>
        <button type="button" class="button secondary" data-export-copy disabled>Kopiëren</button>
      </div>
    </div>
    <p class="help-text" data-export-printings hidden>Gebruikt de printings die in dit deck zijn gekozen. Forge / Neo Forge moet deze kaartversies ondersteunen.</p>
    <div class="field">
      <label for="${prefix}-text">Decklijst</label>
      <textarea id="${prefix}-text" class="deck-export-text" data-export-text rows="18" readonly spellcheck="false" aria-describedby="${prefix}-status"></textarea>
    </div>
    <p id="${prefix}-status" class="help-text" data-export-status role="status" aria-live="polite"></p>`
  });

  const formatSelect = dialog.querySelector('[data-export-format]');
  const text = dialog.querySelector('[data-export-text]');
  const status = dialog.querySelector('[data-export-status]');
  const download = dialog.querySelector('[data-export-download]');
  const copy = dialog.querySelector('[data-export-copy]');
  const printingNote = dialog.querySelector('[data-export-printings]');
  let generation = 0;
  let controller;
  let currentExport = null;

  async function loadExport() {
    const requestGeneration = ++generation;
    controller?.abort();
    controller = new AbortController();
    const format = formatSelect.value === 'dck' ? 'dck' : 'txt';
    printingNote.hidden = format !== 'dck';
    currentExport = null;
    text.value = '';
    text.setAttribute('aria-busy', 'true');
    download.disabled = true;
    copy.disabled = true;
    status.textContent = 'Decklijst laden…';
    try {
      const result = await api(`/decks/${id}/export?format=${format}`, { signal: controller.signal });
      if (!dialog.open || requestGeneration !== generation) return;
      if (typeof result?.text !== 'string' || typeof result?.filename !== 'string'
        || !result.filename.toLowerCase().endsWith(`.${format}`) || result.format !== format) {
        throw new Error('De server heeft geen geldige deckexport teruggegeven.');
      }
      currentExport = result;
      text.value = result.text;
      download.disabled = false;
      copy.disabled = false;
      status.textContent = result.filename;
    } catch (error) {
      if (!dialog.open || requestGeneration !== generation) return;
      status.textContent = error.message || 'De decklijst kon niet worden geladen.';
    } finally {
      if (dialog.open && requestGeneration === generation) text.removeAttribute('aria-busy');
    }
  }

  formatSelect.addEventListener('change', loadExport);
  dialog.addEventListener('close', () => {
    generation++;
    currentExport = null;
    controller?.abort();
  }, { once: true });

  download.addEventListener('click', () => {
    if (!dialog.open || download.disabled || !currentExport) return;
    const objectUrl = URL.createObjectURL(new Blob([currentExport.text], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = currentExport.filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  });

  copy.addEventListener('click', async () => {
    if (!dialog.open || copy.disabled || !currentExport) return;
    const snapshot = currentExport;
    const stillCurrent = () => dialog.open && currentExport === snapshot;
    copy.disabled = true;
    let copied = false;
    try {
      if (globalThis.navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(snapshot.text);
        copied = true;
      }
    } catch {
      // Clipboard access may be unavailable on HTTP or denied by the browser.
    }
    if (!stillCurrent()) return;
    if (!copied) {
      text.focus();
      text.select();
      try {
        copied = document.execCommand?.('copy') === true;
      } catch {
        copied = false;
      }
    }
    status.textContent = copied
      ? 'Decklijst gekopieerd.'
      : 'De tekst is geselecteerd. Kopieer met Ctrl+C of ⌘C.';
    copy.disabled = false;
  });

  loadExport();
  return dialog;
}
