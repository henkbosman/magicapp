import { api } from './api.js';
import { escapeHtml, formValue, openDialog } from './utils.js';
import { applyWriteAvailability } from './write-access.js';

function deckIdValue(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Kies een bestaand deck.');
  return id;
}

function readTagList(result) {
  if (!Array.isArray(result) || result.some((tag) => !Number.isSafeInteger(tag?.id)
    || tag.id < 1 || typeof tag.name !== 'string' || !tag.name.trim())) {
    throw new Error('De server heeft geen geldige lijst met functionele tags teruggegeven.');
  }
  if (new Set(result.map((tag) => tag.id)).size !== result.length) {
    throw new Error('De server heeft dubbele tag-ID’s teruggegeven.');
  }
  return result;
}

export function deckTagPickerHtml() {
  return `<div class="field full" data-deck-tag-picker>
    <label>Functionele tags</label>
    <div class="deck-tag-options" data-deck-tag-options role="group" aria-label="Functionele tags"></div>
    <p class="help-text" data-deck-tag-status role="status">Functionele tags laden…</p>
    <button type="button" class="button secondary small" data-deck-tag-retry hidden>Opnieuw laden</button>
  </div>`;
}

export function bindDeckTagPicker(dialog, {
  deckId,
  deckSelect = null,
  selectedTags = [],
  selectedTagIds = null
} = {}) {
  const wrapper = dialog.querySelector('[data-deck-tag-picker]');
  if (!wrapper) throw new Error('De tagkeuze ontbreekt in dit venster.');
  const options = wrapper.querySelector('[data-deck-tag-options]');
  const status = wrapper.querySelector('[data-deck-tag-status]');
  const retry = wrapper.querySelector('[data-deck-tag-retry]');
  const submit = dialog.querySelector('[type="submit"]');
  const originallyDisabled = submit?.dataset.writeInitiallyDisabled === 'true';
  let generation = 0;
  let controller;
  let destroyed = false;
  let loadedDeckId = null;
  let requestedDeckId = deckId;
  let selected = { selectedTags, selectedTagIds };
  let state = 'loading';
  let availableIds = new Set();

  function blockSubmit(blocked) {
    if (!submit) return;
    submit.dataset.writeInitiallyDisabled = String(originallyDisabled || blocked);
    submit.disabled = originallyDisabled || blocked || submit.getAttribute('aria-disabled') === 'true'
      || dialog.querySelector('form')?.getAttribute('aria-busy') === 'true';
  }

  function isActive(requestGeneration) {
    return !destroyed && dialog.open && generation === requestGeneration;
  }

  async function load(value, selection = {}) {
    if (destroyed || !dialog.open) return false;
    const requestGeneration = ++generation;
    controller?.abort();
    controller = new AbortController();
    requestedDeckId = value;
    selected = selection;
    loadedDeckId = null;
    availableIds = new Set();
    state = 'loading';
    options.innerHTML = '';
    options.setAttribute('aria-busy', 'true');
    status.textContent = 'Functionele tags laden…';
    retry.hidden = true;
    blockSubmit(true);
    try {
      const id = deckIdValue(value);
      const tags = readTagList(await api(`/decks/${id}/tags`, { signal: controller.signal }));
      if (!isActive(requestGeneration)) return false;
      if (deckSelect && Number(deckSelect.value) !== id) return false;
      let checkedIds;
      if (Array.isArray(selection.selectedTagIds)) {
        checkedIds = new Set(selection.selectedTagIds.map(Number));
        if ([...checkedIds].some((tagId) => !tags.some((tag) => tag.id === tagId))) {
          throw new Error('Een toegewezen tag is intussen verwijderd. Sluit dit venster en open de kaart opnieuw.');
        }
      } else {
        const names = new Set((Array.isArray(selection.selectedTags) ? selection.selectedTags : [])
          .map((name) => String(name).trim().toLocaleLowerCase('nl')).filter(Boolean));
        checkedIds = new Set(tags.filter((tag) => names.has(tag.name.trim().toLocaleLowerCase('nl'))).map((tag) => tag.id));
        if ([...names].some((name) => !tags.some((tag) => tag.name.trim().toLocaleLowerCase('nl') === name))) {
          throw new Error('Een toegewezen tag is intussen gewijzigd. Sluit dit venster en open de kaart opnieuw.');
        }
      }
      options.innerHTML = tags.map((tag) => `<label class="checkbox-field"><input type="checkbox" name="tagIds" value="${tag.id}" data-deck-tag-id="${tag.id}" ${checkedIds.has(tag.id) ? 'checked' : ''}> ${escapeHtml(tag.name)}</label>`).join('');
      availableIds = new Set(tags.map((tag) => tag.id));
      loadedDeckId = id;
      state = 'ready';
      status.textContent = tags.length
        ? 'Kies één of meer tags, of laat de selectie leeg.'
        : 'Dit deck heeft nog geen functionele tags. Maak ze aan via Deckacties → Functionele tags beheren.';
      blockSubmit(false);
      return true;
    } catch (error) {
      if (!isActive(requestGeneration)) return false;
      state = 'error';
      status.textContent = error.message || 'De functionele tags konden niet worden geladen.';
      retry.hidden = false;
      blockSubmit(true);
      return false;
    } finally {
      if (isActive(requestGeneration)) options.removeAttribute('aria-busy');
    }
  }

  function readSelectedTagIds() {
    if (destroyed || !dialog.open) throw new Error('Dit venster is niet meer actief.');
    if (state !== 'ready' || loadedDeckId !== Number(deckSelect ? deckSelect.value : requestedDeckId)) {
      throw new Error(state === 'loading' ? 'Wacht tot de functionele tags zijn geladen.' : 'Laad eerst de functionele tags van het gekozen deck.');
    }
    const ids = [...options.querySelectorAll('[data-deck-tag-id]')]
      .filter((input) => input.checked).map((input) => Number(input.value));
    if (ids.some((id) => !availableIds.has(id))) throw new Error('Kies alleen bestaande tags van dit deck.');
    return [...new Set(ids)];
  }

  const onDeckChange = () => { void load(deckSelect.value); };
  const onRetry = () => { void load(deckSelect ? deckSelect.value : requestedDeckId, selected); };
  function destroy() {
    destroyed = true;
    generation++;
    controller?.abort();
    deckSelect?.removeEventListener?.('change', onDeckChange);
    retry.removeEventListener?.('click', onRetry);
  }
  deckSelect?.addEventListener('change', onDeckChange);
  retry.addEventListener('click', onRetry);
  dialog.addEventListener('close', destroy, { once: true });
  const ready = load(deckSelect ? deckSelect.value : deckId, selected);
  return { ready, load, readSelectedTagIds, destroy };
}

export function openDeckTagManager(deckId, { onChanged } = {}) {
  const id = deckIdValue(deckId);
  const sourceHash = window.location.hash;
  const dialog = openDialog({
    title: 'Functionele tags beheren',
    wide: true,
    cancelLabel: 'Sluiten',
    content: `<p>Maak tags voor dit deck, bijvoorbeeld Ramp, Draw en Protection. Hernoemen werkt ook de toegewezen kaarten bij.</p>
      <div class="deck-manager-create"><label class="field">Nieuwe tag<input name="newTag" maxlength="60" placeholder="Naam van de tag" data-write-action></label><button type="button" class="button primary" data-create-deck-tag data-write-action>Aanmaken</button></div>
      <p class="help-text" data-deck-tags-status role="status">Functionele tags laden…</p>
      <p class="import-warning" data-deck-tags-error role="alert" hidden></p>
      <button type="button" class="button secondary small" data-retry-deck-tags hidden>Opnieuw proberen</button>
      <div class="deck-tag-manager-list" data-deck-tags-list></div>`
  });
  const list = dialog.querySelector('[data-deck-tags-list]');
  const status = dialog.querySelector('[data-deck-tags-status]');
  const errorElement = dialog.querySelector('[data-deck-tags-error]');
  const newName = dialog.querySelector('[name="newTag"]');
  const retry = dialog.querySelector('[data-retry-deck-tags]');
  let tags = [];
  let ready = false;
  let loading = false;
  let busy = false;
  let generation = 0;
  let controller;
  let childDialog = null;
  const isCurrent = () => dialog.open && window.location.hash === sourceHash;

  function controls() {
    for (const element of dialog.querySelectorAll('[data-write-action]')) {
      element.dataset.writeInitiallyDisabled = String(!ready || loading || busy);
    }
    applyWriteAvailability(dialog);
    retry.disabled = loading || busy;
  }

  function renderList() {
    list.innerHTML = tags.length ? tags.map((tag) => `<div class="deck-tag-manager-row" data-deck-tag-row="${tag.id}">
      <div><strong>${escapeHtml(tag.name)}</strong><small>${Number(tag.cardCount) || 0} kaartregels</small></div>
      <div class="page-actions"><button type="button" class="button secondary small" data-rename-deck-tag="${tag.id}" data-write-action>Hernoemen</button><button type="button" class="button ghost small text-danger" data-delete-deck-tag="${tag.id}" data-write-action>Verwijderen</button></div>
    </div>`).join('') : '<p class="muted">Nog geen functionele tags voor dit deck.</p>';
    controls();
  }

  async function load() {
    const requestGeneration = ++generation;
    controller?.abort();
    controller = new AbortController();
    loading = true;
    ready = false;
    status.textContent = 'Functionele tags laden…';
    retry.hidden = true;
    controls();
    try {
      const result = readTagList(await api(`/decks/${id}/tags`, { signal: controller.signal }));
      if (!isCurrent() || generation !== requestGeneration) return false;
      tags = result;
      loading = false;
      ready = true;
      renderList();
      status.textContent = `${tags.length} ${tags.length === 1 ? 'tag' : 'tags'} beschikbaar.`;
      return true;
    } catch (error) {
      if (!isCurrent() || generation !== requestGeneration) return false;
      status.textContent = 'De tags konden niet worden geladen.';
      errorElement.textContent = error.message || 'Laden mislukt.';
      errorElement.hidden = false;
      retry.hidden = false;
      return false;
    } finally {
      if (isCurrent() && generation === requestGeneration) {
        loading = false;
        controls();
      }
    }
  }

  async function mutate(method, path, body, { errorTarget = errorElement, afterCommit } = {}) {
    if (!isCurrent() || busy || loading || !ready) return false;
    busy = true;
    dialog.dataset.preventClose = 'true';
    controls();
    errorTarget.hidden = true;
    errorElement.hidden = true;
    let committed = false;
    try {
      await api(path, { method, ...(body === undefined ? {} : { body }) });
      committed = true;
      if (!isCurrent()) return true;
      afterCommit?.();
      const loaded = await load();
      if (!isCurrent()) return true;
      if (!loaded) status.textContent = 'De wijziging is opgeslagen. Probeer de lijst opnieuw te laden om de actuele tags te zien.';
      try {
        await onChanged?.();
      } catch {
        if (isCurrent()) {
          errorElement.textContent = 'De tag is opgeslagen, maar het deckoverzicht kon niet worden vernieuwd. Herlaad de deckpagina.';
          errorElement.hidden = false;
        }
      }
      return true;
    } catch (error) {
      if (isCurrent()) {
        errorTarget.textContent = error.message || 'De tag kon niet worden opgeslagen.';
        if (!error?.status || error.status >= 500) {
          errorTarget.textContent += ' Laad de lijst opnieuw voordat je opnieuw probeert.';
          retry.hidden = false;
        }
        errorTarget.hidden = false;
      }
      return committed;
    } finally {
      busy = false;
      delete dialog.dataset.preventClose;
      if (isCurrent()) controls();
    }
  }

  function create() {
    const button = dialog.querySelector('[data-create-deck-tag]');
    if (!isCurrent() || childDialog?.open || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
    const name = newName.value.trim();
    if (!name) {
      errorElement.textContent = 'Vul een naam voor de tag in.';
      errorElement.hidden = false;
      newName.focus();
      return;
    }
    void mutate('POST', `/decks/${id}/tags`, { name }, { afterCommit: () => { newName.value = ''; } });
  }

  function editTag(tag, deleting) {
    if (!isCurrent() || childDialog?.open || busy || loading || !ready) return;
    childDialog = openDialog({
      title: deleting ? 'Functionele tag verwijderen' : 'Functionele tag hernoemen',
      submitLabel: deleting ? 'Verwijderen' : 'Opslaan',
      destructive: deleting,
      content: deleting
        ? `<p>Verwijder de tag <strong>${escapeHtml(tag.name)}</strong> uit dit deck en van de kaarten waaraan deze is toegewezen? De kaarten blijven in het deck.</p><p class="import-warning" data-tag-edit-error role="alert" hidden></p>`
        : `<div class="field"><label>Naam</label><input name="name" value="${escapeHtml(tag.name)}" maxlength="60" required></div><p class="import-warning" data-tag-edit-error role="alert" hidden></p>`,
      onSubmit: (data, child) => mutate(deleting ? 'DELETE' : 'PATCH', `/decks/${id}/tags/${tag.id}`,
        deleting ? undefined : { name: formValue(data, 'name').trim() },
        { errorTarget: child.querySelector('[data-tag-edit-error]') })
    });
    applyWriteAvailability(childDialog);
  }

  dialog.querySelector('[data-create-deck-tag]').addEventListener('click', create);
  dialog.querySelector('form').addEventListener('submit', (event) => { event.preventDefault(); create(); });
  retry.addEventListener('click', () => {
    if (!isCurrent() || busy || loading) return;
    errorElement.hidden = true;
    void load();
  });
  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-rename-deck-tag], [data-delete-deck-tag]');
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
    const tagId = Number(button.dataset.renameDeckTag || button.dataset.deleteDeckTag);
    const tag = tags.find((candidate) => candidate.id === tagId);
    if (tag) editTag(tag, Boolean(button.dataset.deleteDeckTag));
  });
  const onNavigation = () => { if (!isCurrent() && dialog.open) dialog.close(); };
  window.addEventListener?.('hashchange', onNavigation);
  dialog.addEventListener('close', () => {
    generation++;
    controller?.abort();
    if (childDialog?.open) childDialog.close();
    window.removeEventListener?.('hashchange', onNavigation);
  }, { once: true });
  void load();
  return dialog;
}
