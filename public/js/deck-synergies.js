import { api } from './api.js';
import { escapeHtml, formValue, openDialog } from './utils.js';
import { applyWriteAvailability } from './write-access.js';

function positiveId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Kies een bestaand deck en een bestaande deckkaart.');
  return id;
}

function readSynergies(result, deckId) {
  if (!Array.isArray(result) || result.some((group) => !Number.isSafeInteger(group?.id)
    || group.id < 1 || typeof group.name !== 'string' || !group.name.trim()
    || !['synergy', 'combo'].includes(group.type) || !Array.isArray(group.members)
    || (group.deckId !== undefined && Number(group.deckId) !== deckId))) {
    throw new Error('De server heeft geen geldige lijst met synergieën teruggegeven.');
  }
  if (new Set(result.map((group) => group.id)).size !== result.length) {
    throw new Error('De server heeft dubbele synergie-ID’s teruggegeven.');
  }
  return result.filter((group) => group.type === 'synergy');
}

export function openDeckSynergyManager(deckId, { onChanged } = {}) {
  const id = positiveId(deckId);
  const sourceHash = window.location.hash;
  const dialog = openDialog({
    title: 'Synergieën beheren',
    wide: true,
    cancelLabel: 'Sluiten',
    content: `<p>Maak synergieën voor dit deck. Je kunt later per kaart via Acties → Combo’s/synergieën → Synergieën kiezen één of meer synergieën toewijzen.</p>
      <div class="deck-manager-create"><div class="field"><label>Nieuwe synergie<input name="newSynergy" maxlength="200" placeholder="Naam van de synergie" data-write-action></label></div><button type="button" class="button primary" data-create-deck-synergy data-write-action>Aanmaken</button></div>
      <p class="help-text" data-deck-synergies-status role="status">Synergieën laden…</p>
      <p class="import-warning" data-deck-synergies-error role="alert" hidden></p>
      <button type="button" class="button secondary small" data-deck-synergies-retry hidden>Opnieuw proberen</button>
      <div class="deck-tag-manager-list" data-deck-synergies-list></div>`
  });
  const list = dialog.querySelector('[data-deck-synergies-list]');
  const status = dialog.querySelector('[data-deck-synergies-status]');
  const errorElement = dialog.querySelector('[data-deck-synergies-error]');
  const newName = dialog.querySelector('[name="newSynergy"]');
  const retry = dialog.querySelector('[data-deck-synergies-retry]');
  let groups = [];
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
    list.innerHTML = groups.length ? groups.map((group) => `<div class="deck-tag-manager-row" data-deck-synergy-row="${group.id}">
      <div><strong>${escapeHtml(group.name)}</strong><small>${Number(group.memberCount) || 0} kaartregels</small></div>
      <div class="page-actions"><button type="button" class="button secondary small" data-rename-deck-synergy="${group.id}" data-write-action>Hernoemen</button><button type="button" class="button ghost small text-danger" data-delete-deck-synergy="${group.id}" data-write-action>Verwijderen</button></div>
    </div>`).join('') : '<p class="muted">Nog geen synergieën voor dit deck.</p>';
    controls();
  }

  async function load() {
    const requestGeneration = ++generation;
    controller?.abort();
    controller = new AbortController();
    loading = true;
    ready = false;
    retry.hidden = true;
    status.textContent = 'Synergieën laden…';
    controls();
    try {
      const result = readSynergies(await api(`/decks/${id}/links`, { signal: controller.signal }), id);
      if (!isCurrent() || generation !== requestGeneration) return false;
      groups = result;
      loading = false;
      ready = true;
      renderList();
      status.textContent = `${groups.length} ${groups.length === 1 ? 'synergie' : 'synergieën'} beschikbaar.`;
      return true;
    } catch (error) {
      if (!isCurrent() || generation !== requestGeneration) return false;
      status.textContent = 'De synergieën konden niet worden geladen.';
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
      if (!loaded) status.textContent = 'De wijziging is opgeslagen. Laad de lijst opnieuw om de actuele synergieën te zien.';
      try {
        await onChanged?.();
      } catch {
        if (isCurrent()) {
          errorElement.textContent = 'De synergie is opgeslagen, maar het deckoverzicht kon niet worden vernieuwd. Herlaad de deckpagina.';
          errorElement.hidden = false;
        }
      }
      return true;
    } catch (error) {
      if (isCurrent()) {
        errorTarget.textContent = error.message || 'De synergie kon niet worden opgeslagen.';
        if (!error?.status || error.status >= 500) {
          ready = false;
          retry.hidden = false;
          errorTarget.textContent += ' Laad de lijst opnieuw voordat je opnieuw probeert.';
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
    const button = dialog.querySelector('[data-create-deck-synergy]');
    if (!isCurrent() || childDialog?.open || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
    const name = newName.value.trim();
    if (!name) {
      errorElement.textContent = 'Vul een naam voor de synergie in.';
      errorElement.hidden = false;
      newName.focus();
      return;
    }
    void mutate('POST', `/decks/${id}/links`, { name, type: 'synergy', deckCardIds: [] }, {
      afterCommit: () => { newName.value = ''; }
    });
  }

  function editGroup(group, deleting) {
    if (!isCurrent() || childDialog?.open || busy || loading || !ready) return;
    childDialog = openDialog({
      title: deleting ? 'Synergie verwijderen' : 'Synergie hernoemen',
      submitLabel: deleting ? 'Verwijderen' : 'Opslaan',
      destructive: deleting,
      content: deleting
        ? `<p>Verwijder de synergie <strong>${escapeHtml(group.name)}</strong> en haar kaarttoewijzingen uit dit deck? De kaarten blijven in het deck.</p><p class="import-warning" data-synergy-edit-error role="alert" hidden></p>`
        : `<div class="field"><label>Naam<input name="name" value="${escapeHtml(group.name)}" maxlength="200" required></label></div><p class="import-warning" data-synergy-edit-error role="alert" hidden></p>`,
      onSubmit: (data, child) => mutate(deleting ? 'DELETE' : 'PATCH', `/decks/${id}/links/${group.id}`,
        deleting ? undefined : { name: formValue(data, 'name').trim() },
        { errorTarget: child.querySelector('[data-synergy-edit-error]') })
    });
    applyWriteAvailability(childDialog);
  }

  dialog.querySelector('[data-create-deck-synergy]').addEventListener('click', create);
  dialog.querySelector('form').addEventListener('submit', (event) => { event.preventDefault(); create(); });
  retry.addEventListener('click', () => {
    if (!isCurrent() || childDialog?.open || busy || loading) return;
    errorElement.hidden = true;
    void load();
  });
  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-rename-deck-synergy], [data-delete-deck-synergy]');
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
    const group = groups.find((candidate) => candidate.id === Number(button.dataset.renameDeckSynergy || button.dataset.deleteDeckSynergy));
    if (group) editGroup(group, Boolean(button.dataset.deleteDeckSynergy));
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

export function openDeckCardSynergies(deckId, item, { onChanged } = {}) {
  const id = positiveId(deckId);
  const deckCardId = positiveId(item.id);
  const sourceHash = window.location.hash;
  let ready = false;
  let completed = false;
  let loading = false;
  let generation = 0;
  let controller;
  let availableIds = new Set();
  const dialog = openDialog({
    title: `Synergieën voor ${item.card.name}`,
    submitLabel: 'Opslaan',
    content: `<p>Kies één of meer bestaande synergieën. Laat alles uitgevinkt om deze kaart uit alle synergieën te halen.</p>
      <div class="deck-tag-options" data-card-synergy-options role="group" aria-label="Synergieën"></div>
      <p class="help-text" data-card-synergy-status role="status">Synergieën laden…</p>
      <p class="import-warning" data-card-synergy-error role="alert" hidden></p>
      <button type="button" class="button secondary small" data-card-synergy-retry hidden>Opnieuw proberen</button>`,
    onSubmit: async () => {
      if (!isCurrent()) return false;
      if (completed) return true;
      if (!ready) throw new Error('Wacht tot de synergieën zijn geladen.');
      const synergyIds = [...options.querySelectorAll('[data-card-synergy-id]')]
        .filter((input) => input.checked).map((input) => Number(input.value));
      if (synergyIds.some((groupId) => !availableIds.has(groupId))) throw new Error('Kies alleen bestaande synergieën van dit deck.');
      errorElement.hidden = true;
      try {
        await api(`/decks/${id}/cards/${deckCardId}/synergies`, { method: 'PUT', body: { synergyIds: [...new Set(synergyIds)] } });
      } catch (error) {
        if (!isCurrent()) return false;
        ready = false;
        errorElement.textContent = error.message || 'De toewijzingen konden niet worden opgeslagen.';
        errorElement.hidden = false;
        status.textContent = 'Laad de synergieën opnieuw voordat je opnieuw opslaat.';
        retry.hidden = false;
        controls();
        return false;
      }
      completed = true;
      if (!isCurrent()) return true;
      try {
        await onChanged?.();
      } catch {
        errorElement.textContent = 'De toewijzingen zijn opgeslagen, maar het deckoverzicht kon niet worden vernieuwd. Sluit dit venster en herlaad de deckpagina.';
        errorElement.hidden = false;
        for (const input of options.querySelectorAll('[data-card-synergy-id]')) {
          input.dataset.writeInitiallyDisabled = 'true';
          input.disabled = true;
        }
        return false;
      }
      return true;
    }
  });
  const options = dialog.querySelector('[data-card-synergy-options]');
  const status = dialog.querySelector('[data-card-synergy-status]');
  const errorElement = dialog.querySelector('[data-card-synergy-error]');
  const retry = dialog.querySelector('[data-card-synergy-retry]');
  const submit = dialog.querySelector('[type="submit"]');
  const isCurrent = () => dialog.open && window.location.hash === sourceHash;

  function controls() {
    for (const control of dialog.querySelectorAll('[data-write-action]')) {
      control.dataset.writeInitiallyDisabled = String(!ready || loading);
    }
    applyWriteAvailability(dialog);
    retry.disabled = loading;
  }

  async function load() {
    if (!isCurrent() || completed || dialog.querySelector('form').getAttribute('aria-busy') === 'true') return;
    const requestGeneration = ++generation;
    controller?.abort();
    controller = new AbortController();
    ready = false;
    loading = true;
    availableIds = new Set();
    options.innerHTML = '';
    status.textContent = 'Synergieën laden…';
    retry.hidden = true;
    errorElement.hidden = true;
    controls();
    try {
      const groups = readSynergies(await api(`/decks/${id}/links`, { signal: controller.signal }), id);
      if (!isCurrent() || generation !== requestGeneration) return;
      availableIds = new Set(groups.map((group) => group.id));
      options.innerHTML = groups.map((group) => `<label class="checkbox-field"><input type="checkbox" name="synergyIds" value="${group.id}" data-card-synergy-id="${group.id}" data-write-action ${group.members.some((member) => Number(member.deckCardId) === deckCardId) ? 'checked' : ''}> ${escapeHtml(group.name)}</label>`).join('');
      ready = true;
      status.textContent = groups.length ? 'De selectie geldt alleen voor deze kaart.' : 'Dit deck heeft nog geen synergieën. Maak ze aan via Deckacties → Synergie.';
    } catch (error) {
      if (!isCurrent() || generation !== requestGeneration) return;
      errorElement.textContent = error.message || 'De synergieën konden niet worden geladen.';
      errorElement.hidden = false;
      retry.hidden = false;
      status.textContent = 'Laad de synergieën opnieuw voordat je opslaat.';
    } finally {
      if (isCurrent() && generation === requestGeneration) {
        loading = false;
        controls();
      }
    }
  }

  retry.addEventListener('click', () => { void load(); });
  const onNavigation = () => { if (!isCurrent() && dialog.open) dialog.close(); };
  window.addEventListener?.('hashchange', onNavigation);
  dialog.addEventListener('close', () => {
    generation++;
    controller?.abort();
    window.removeEventListener?.('hashchange', onNavigation);
  }, { once: true });
  submit.disabled = true;
  void load();
  return dialog;
}
