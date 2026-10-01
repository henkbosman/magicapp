import { api, apiPath } from '../api.js';
import { addCardToDeck, addCardToWanted } from '../card-actions.js';
import { pickCard } from '../card-picker.js';
import { cardImage, cardInsightBadges, cardTextHtml, manaCost, pageHeader, tagPills } from '../components.js';
import { openCardInsightsEditor } from '../card-insights.js';
import { confirmDialog, emptyState, escapeHtml, formValue, openDialog, parseTags, refreshView, toast } from '../utils.js';
import { prepareDeckSimulatorNavigation, prepareDeckStatsNavigation, preserveCurrentScrollForNextRender } from '../navigation-state.js';
import { bindFilterToggle, filterToggleHtml, filtersExpanded } from '../collapsible-filters.js';
import { isBasicLand } from '../card-rules.js';
import { openCardPreview } from '../card-preview.js';
import { applyWriteAvailability } from '../write-access.js';

const ROLE_LABELS = {
  commander: 'Commander', partner: 'Tweede commander', companion: 'Companion',
  main: 'Main deck', sideboard: 'Sideboard', maybeboard: 'Maybeboard'
};

const RELATION_LABELS = { synergy: 'Synergie', combo: 'Combo' };
const CARD_TYPE_ORDER = ['Creature', 'Land', 'Artifact', 'Enchantment', 'Instant', 'Sorcery', 'Planeswalker', 'Battle', 'Kindred'];
const CARD_TYPE_GROUP_LABELS = {
  Creature: 'Creatures',
  Land: 'Lands',
  Artifact: 'Artifacts',
  Enchantment: 'Enchantments',
  Instant: 'Instants',
  Sorcery: 'Sorceries',
  Planeswalker: 'Planeswalkers',
  Battle: 'Battles',
  Kindred: 'Kindred',
  Overig: 'Overig'
};
const DECK_VISUAL_COLUMN_OPTIONS = ['auto', '1', '2', '3', '4', '5', '6', '7', '8'];

const DECK_CARD_ACTION_ICONS = {
  wanted: '☆',
  relations: '⌘',
  insights: '◇',
  edit: '✎',
  remove: '×',
  printings: '▦'
};

export function normalizeDeckVisualColumns(value) {
  const normalized = String(value || 'auto');
  return DECK_VISUAL_COLUMN_OPTIONS.includes(normalized) ? normalized : 'auto';
}

export function deckDetailQueryString({ cardSearch = '', role = 'all', cardType = '', view = 'list', cardColumns = 'auto' } = {}) {
  const params = new URLSearchParams();
  const search = String(cardSearch || '').trim();
  const columns = normalizeDeckVisualColumns(cardColumns);
  if (search) params.set('cardSearch', search);
  if (role !== 'all') params.set('role', role);
  if (cardType) params.set('cardType', cardType);
  if (view === 'cards') params.set('view', 'cards');
  if (columns !== 'auto') params.set('cardColumns', columns);
  return params.toString();
}

function deckVisualColumnOptions(current) {
  return DECK_VISUAL_COLUMN_OPTIONS.map((value) => {
    const label = value === 'auto' ? 'Automatisch' : value;
    return `<option value="${value}" ${value === current ? 'selected' : ''}>${label}</option>`;
  }).join('');
}


function refreshDeckView() {
  preserveCurrentScrollForNextRender();
  refreshView();
}

function sortCardTypes(types) {
  return [...types].sort((left, right) => {
    const leftIndex = CARD_TYPE_ORDER.indexOf(left);
    const rightIndex = CARD_TYPE_ORDER.indexOf(right);
    if (leftIndex !== -1 || rightIndex !== -1) {
      return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
    }
    return left.localeCompare(right, 'nl');
  });
}

function cardTypeOptions(types, current = '') {
  return `<option value="">Alle kaarttypes</option>${types.map((type) => `<option value="${escapeHtml(type)}" ${type === current ? 'selected' : ''}>${escapeHtml(type)}</option>`).join('')}`;
}


function roleOptions(current) {
  return Object.entries(ROLE_LABELS).map(([value, label]) => `<option value="${value}" ${current === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
}


function relationTypeBadge(type) {
  return `<span class="relation-type-badge ${escapeHtml(type)}">${escapeHtml(RELATION_LABELS[type] || type)}</span>`;
}

function relationPills(relations = [], deckCardId = null) {
  if (!relations.length) return '';
  const deckCardIds = new Set((Array.isArray(deckCardId) ? deckCardId : [deckCardId]).filter(Boolean).map(Number));
  return `<div class="deck-relation-list">${relations.map((relation) => {
    const member = (relation.members || []).find((candidate) => deckCardIds.has(Number(candidate.deckCardId)));
    const step = member ? Number(member.position || 0) + 1 : null;
    return `
    <button type="button" class="deck-relation-pill ${escapeHtml(relation.type)} show-deck-group" data-group-id="${relation.id}" title="${escapeHtml(relation.note || `${RELATION_LABELS[relation.type] || relation.type}: ${relation.name}`)}">
      <span>${escapeHtml(RELATION_LABELS[relation.type] || relation.type)}</span>
      <strong>${escapeHtml(relation.name)}</strong>
      <small>${step ? `Stap ${step}/${relation.memberCount}` : relation.memberCount}</small>
    </button>`;
  }).join('')}</div>`;
}

function memberCardItem(cards, deckCardId) {
  return cards.find((item) => item.id === Number(deckCardId)) || null;
}

function groupMembersHtml(group, cards) {
  return `<div class="deck-group-member-list ordered">${group.members.map((member, index) => {
    const item = memberCardItem(cards, member.deckCardId);
    const card = item?.card || { id: member.cardId, name: member.name, images: {} };
    return `<article class="deck-group-member">
      <span class="play-order-step" aria-label="Stap ${index + 1}">${index + 1}</span>
      <a data-card-detail-link href="#/cards/${member.cardId}">${cardImage(card, { className: 'group-card-thumb' })}</a>
      <div>
        <a data-card-detail-link href="#/cards/${member.cardId}"><strong>${escapeHtml(member.name)}</strong></a>
        <small>${escapeHtml(ROLE_LABELS[member.role] || member.role)}${member.quantity > 1 ? ` · ${member.quantity}×` : ''}</small>
      </div>
      ${item ? manaCost(item.card.manaCost) : ''}
      ${index < group.members.length - 1 ? '<span class="play-order-arrow" aria-hidden="true">↓</span>' : ''}
    </article>`;
  }).join('')}</div>`;
}

function openGroupDetailsDialog(group, cards, deck) {
  const dialog = openDialog({
    title: group.name,
    wide: true,
    cancelLabel: 'Sluiten',
    content: `
      <div class="deck-group-detail-heading">
        ${relationTypeBadge(group.type)}
        <span>${group.memberCount} kaart${group.memberCount === 1 ? '' : 'en'} · speelvolgorde</span>
      </div>
      ${group.note ? `<p class="deck-group-note">${escapeHtml(group.note)}</p>` : ''}
      ${groupMembersHtml(group, cards)}
      <div class="dialog-inline-actions">
        <button type="button" class="button secondary edit-group-from-detail" data-write-action>Bewerken</button>
      </div>`
  });
  dialog.querySelector('.edit-group-from-detail')?.addEventListener('click', () => {
    dialog.close();
    openGroupEditor({ group, cards, deck });
  });
  return dialog;
}

function cardSelectionHtml(cards, selectedIds, fixedId = null) {
  return `<div class="deck-group-card-picker">${cards.map((item) => {
    const selected = selectedIds.has(item.id);
    const fixed = Number(fixedId) === item.id;
    return `<label class="deck-group-card-option ${selected ? 'selected' : ''} ${fixed ? 'fixed' : ''}" data-deck-card-option="${item.id}">
      ${fixed ? `<input type="hidden" name="fixedDeckCardId" value="${item.id}">` : ''}
      <input class="deck-group-card-checkbox" type="checkbox" value="${item.id}" ${selected ? 'checked' : ''} ${fixed ? 'disabled' : ''}>
      <span><strong>${escapeHtml(item.card.name)}</strong><small>${escapeHtml(ROLE_LABELS[item.role] || item.role)}${item.quantity > 1 ? ` · ${item.quantity}×` : ''}</small></span>
    </label>`;
  }).join('')}</div>`;
}

function orderedMemberEditorHtml(orderedIds, cards) {
  if (!orderedIds.length) return '<p class="muted">Selecteer kaarten om een speelvolgorde op te bouwen.</p>';
  return orderedIds.map((id, index) => {
    const item = memberCardItem(cards, id);
    if (!item) return '';
    return `<div class="group-order-row" data-group-order-id="${item.id}">
      <span class="play-order-step">${index + 1}</span>
      <span class="group-order-card"><strong>${escapeHtml(item.card.name)}</strong><small>${escapeHtml(ROLE_LABELS[item.role] || item.role)}</small></span>
      <div class="group-order-actions">
        <button type="button" class="icon-button group-order-up" aria-label="${escapeHtml(item.card.name)} eerder spelen" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="icon-button group-order-down" aria-label="${escapeHtml(item.card.name)} later spelen" ${index === orderedIds.length - 1 ? 'disabled' : ''}>↓</button>
      </div>
    </div>`;
  }).join('');
}

function openGroupEditor({ group = null, item = null, cards, deck }) {
  let orderedIds = group
    ? group.members.slice().sort((a, b) => Number(a.position) - Number(b.position)).map((member) => member.deckCardId)
    : item ? [item.id] : [];
  const selectedIds = new Set(orderedIds);
  const editing = Boolean(group);
  const dialog = openDialog({
    title: editing ? `${group.name} bewerken` : 'Nieuwe combo of synergie',
    submitLabel: editing ? 'Opslaan' : 'Toevoegen',
    wide: true,
    content: `<div class="form-grid">
      <div class="field full"><label>Naam</label><input name="name" value="${escapeHtml(group?.name || '')}" maxlength="200" required placeholder="Bijvoorbeeld: Yedora sacrifice-loop"></div>
      <div class="field"><label>Type</label><select name="type"><option value="synergy" ${group?.type === 'synergy' ? 'selected' : ''}>Synergie</option><option value="combo" ${group?.type === 'combo' ? 'selected' : ''}>Combo</option></select></div>
      <div class="field full"><label>Kaarten</label>${cardSelectionHtml(cards, selectedIds, editing ? null : item?.id)}</div>
      <div class="field full"><label>Speelvolgorde</label><div id="deck-group-order" class="group-order-editor">${orderedMemberEditorHtml(orderedIds, cards)}</div></div>
      <div class="field full"><label>Toelichting</label><textarea name="note" maxlength="2000" placeholder="Beschrijf waarom de kaarten samenwerken en wat het resultaat is.">${escapeHtml(group?.note || '')}</textarea></div>
    </div>`,
    onSubmit: async (data, dialogElement) => {
      const deckCardIds = [...dialogElement.querySelectorAll('[data-group-order-id]')]
        .map((row) => Number(row.dataset.groupOrderId))
        .filter((value) => Number.isInteger(value) && value > 0);
      if (deckCardIds.length < 2) throw new Error('Selecteer minimaal twee kaarten.');
      const path = editing ? `/decks/${deck.id}/links/${group.id}` : `/decks/${deck.id}/links`;
      await api(path, {
        method: editing ? 'PATCH' : 'POST',
        body: {
          name: formValue(data, 'name'),
          type: formValue(data, 'type', 'synergy'),
          note: formValue(data, 'note'),
          deckCardIds
        }
      });
      toast(editing ? 'Combo of synergie bijgewerkt.' : 'Combo of synergie toegevoegd.');
      refreshDeckView();
      return true;
    }
  });

  const orderElement = dialog.querySelector('#deck-group-order');
  const renderOrder = () => {
    if (orderElement) orderElement.innerHTML = orderedMemberEditorHtml(orderedIds, cards);
    dialog.querySelectorAll('[data-deck-card-option]').forEach((label) => {
      const id = Number(label.dataset.deckCardOption);
      const selected = orderedIds.includes(id);
      label.classList.toggle('selected', selected);
      const checkbox = label.querySelector('.deck-group-card-checkbox');
      if (checkbox && !checkbox.disabled) checkbox.checked = selected;
    });
  };

  dialog.querySelector('.deck-group-card-picker')?.addEventListener('change', (event) => {
    const checkbox = event.target.closest('.deck-group-card-checkbox');
    if (!checkbox) return;
    const id = Number(checkbox.value);
    if (checkbox.checked && !orderedIds.includes(id)) orderedIds.push(id);
    if (!checkbox.checked) orderedIds = orderedIds.filter((candidate) => candidate !== id);
    renderOrder();
  });
  orderElement?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-group-order-id]');
    if (!row) return;
    const id = Number(row.dataset.groupOrderId);
    const index = orderedIds.indexOf(id);
    if (index < 0) return;
    const delta = event.target.closest('.group-order-up') ? -1 : event.target.closest('.group-order-down') ? 1 : 0;
    const nextIndex = index + delta;
    if (!delta || nextIndex < 0 || nextIndex >= orderedIds.length) return;
    [orderedIds[index], orderedIds[nextIndex]] = [orderedIds[nextIndex], orderedIds[index]];
    renderOrder();
  });
  renderOrder();
  return dialog;
}

function openRelationsDialog(item, cards, deck) {
  const existing = item.relations || [];
  const dialog = openDialog({
    title: `Combo’s en synergieën voor ${item.card.name}`,
    wide: true,
    cancelLabel: 'Sluiten',
    content: `
      <section class="deck-link-dialog-section">
        ${existing.length ? `<div class="deck-link-dialog-list">${existing.map((group) => `
          <article class="deck-link-dialog-item">
            <div>
              ${relationTypeBadge(group.type)}
              <strong>${escapeHtml(group.name)}</strong>
              <small>${group.memberCount} kaarten${group.note ? ` · ${escapeHtml(group.note)}` : ''}</small>
            </div>
            <div class="deck-link-dialog-actions">
              <button type="button" class="button secondary small view-deck-group" data-group-id="${group.id}">Bekijken</button>
              <button type="button" class="button secondary small edit-deck-group" data-group-id="${group.id}" data-write-action>Bewerken</button>
              <button type="button" class="button ghost small delete-deck-group text-danger" data-group-id="${group.id}" data-write-action>Verwijderen</button>
            </div>
          </article>`).join('')}</div>` : '<p class="muted">Deze kaart hoort nog niet bij een combo of synergie.</p>'}
        <button type="button" class="button primary create-deck-group" data-write-action ${cards.length < 2 ? 'disabled title="Voeg eerst nog een kaart aan het deck toe"' : ''}><span class="icon-plus" aria-hidden="true"></span> Nieuwe combo of synergie</button>
      </section>`
  });

  const groupById = new Map(existing.map((group) => [group.id, group]));
  dialog.querySelectorAll('.view-deck-group').forEach((button) => button.addEventListener('click', () => {
    const group = groupById.get(Number(button.dataset.groupId));
    if (!group) return;
    dialog.close();
    openGroupDetailsDialog(group, cards, deck);
  }));
  dialog.querySelectorAll('.edit-deck-group').forEach((button) => button.addEventListener('click', () => {
    const group = groupById.get(Number(button.dataset.groupId));
    if (!group) return;
    dialog.close();
    openGroupEditor({ group, cards, deck });
  }));
  dialog.querySelectorAll('.delete-deck-group').forEach((button) => button.addEventListener('click', async () => {
    const group = groupById.get(Number(button.dataset.groupId));
    if (!group) return;
    const confirmed = await confirmDialog({
      title: `${RELATION_LABELS[group.type] || group.type} verwijderen`,
      message: `Verwijder “${group.name}”? De kaarten blijven in het deck staan.`
    });
    if (!confirmed) return;
    await api(`/decks/${deck.id}/links/${group.id}`, { method: 'DELETE' });
    toast(`${RELATION_LABELS[group.type] || group.type} verwijderd.`);
    dialog.close();
    refreshDeckView();
  }));
  dialog.querySelector('.create-deck-group')?.addEventListener('click', () => {
    dialog.close();
    openGroupEditor({ item, cards, deck });
  });
  return dialog;
}

function uniqueById(items = []) {
  const values = new Map();
  for (const item of items) {
    if (item?.id !== undefined && item?.id !== null) values.set(Number(item.id), item);
  }
  return [...values.values()];
}

function groupDeckCardsForDisplay(cards) {
  const displayRows = [];
  const basicLandGroups = new Map();

  for (const item of cards) {
    if (!isBasicLand(item.card)) {
      displayRows.push({ ...item, displayMembers: [item], groupedBasicLand: false });
      continue;
    }

    const key = `${item.role}\u0000${String(item.card.name || '').toLocaleLowerCase('en')}`;
    let group = basicLandGroups.get(key);
    if (!group) {
      group = {
        ...item,
        quantity: 0,
        tags: [],
        relations: [],
        note: '',
        displayMembers: [],
        groupedBasicLand: true,
        coverage: {
          physicallyOwned: 0,
          assumedBasicLand: 0,
          assumedAvailable: true,
          directlyOwned: 0,
          missingFromCollection: 0,
          globalShortage: 0,
          wantedGap: 0,
          sharedConflict: false,
          onWanted: false
        }
      };
      basicLandGroups.set(key, group);
      displayRows.push(group);
    }

    group.quantity += Number(item.quantity || 0);
    group.displayMembers.push(item);
    group.tags = [...new Set([...group.tags, ...(item.tags || [])])].sort((left, right) => left.localeCompare(right, 'nl'));
    group.relations = uniqueById([...group.relations, ...(item.relations || [])]);
    group.coverage.physicallyOwned += Number(item.coverage?.physicallyOwned || 0);
    group.coverage.assumedBasicLand += Number(item.coverage?.assumedBasicLand || 0);
    group.coverage.directlyOwned += Number(item.coverage?.directlyOwned || 0);
  }

  for (const group of basicLandGroups.values()) {
    const notes = [...new Set(group.displayMembers.map((member) => String(member.note || '').trim()).filter(Boolean))];
    group.note = notes.length === 1 ? notes[0] : notes.length > 1 ? `${notes.length} afzonderlijke notities bij de printings` : '';
  }

  return displayRows;
}

function deckCardQuantity(cards, role = 'all') {
  return cards.reduce((total, item) => total + (role === 'all' || item.role === role ? Number(item.quantity || 0) : 0), 0);
}

export function deckCardActionDescriptors(item) {
  const members = item.displayMembers || [item];
  const groupedPrintings = Boolean(item.groupedBasicLand && members.length > 1);
  if (groupedPrintings) {
    return [
      {
        key: 'printings',
        label: `Printings (${members.length})`,
        description: 'Bekijk en beheer de afzonderlijke printings.',
        write: false,
        destructive: false
      },
      {
        key: 'insights',
        label: 'Kenmerken',
        description: 'Pas de kenmerken van de getoonde printing aan.',
        write: true,
        destructive: false
      }
    ];
  }

  const wantedGap = Math.max(Number(item.coverage?.wantedGap || 0), 0);
  return [
    ...(wantedGap > 0 ? [{
      key: 'wanted',
      label: wantedGap > 1 ? `${wantedGap} naar Wanted` : 'Naar Wanted',
      description: 'Voeg de ontbrekende exemplaren toe aan Wanted.',
      write: true,
      destructive: false
    }] : []),
    {
      key: 'edit',
      label: 'Bewerken',
      description: 'Wijzig aantal, rol, tags en notitie.',
      write: true,
      destructive: false
    },
    {
      key: 'insights',
      label: 'Kenmerken',
      description: 'Pas functionele kaartkenmerken aan.',
      write: true,
      destructive: false
    },
    {
      key: 'relations',
      label: `Combo’s/synergieën${item.relations?.length ? ` (${item.relations.length})` : ''}`,
      description: 'Beheer relaties met andere kaarten in dit deck.',
      write: true,
      destructive: false
    },
    {
      key: 'remove',
      label: 'Verwijderen',
      description: 'Verwijder deze kaart uit het deck.',
      write: true,
      destructive: true
    }
  ];
}

export function deckCardListActionDescriptors(item) {
  return deckCardActionDescriptors(item);
}

function deckCardActionMenuHtml(item, { contextMenu = false } = {}) {
  const actions = deckCardActionDescriptors(item);
  const menuAttributes = contextMenu ? ' role="menu" tabindex="-1"' : '';
  const itemAttributes = contextMenu ? ' role="menuitem" tabindex="-1"' : '';
  return `<div class="deck-card-action-menu"${menuAttributes}>${actions.map((action) => `
    <button type="button" class="deck-card-action-choice ${action.destructive ? 'text-danger' : ''}" data-deck-card-action="${action.key}"${itemAttributes} ${action.write ? 'data-write-action' : ''}>
      <span class="deck-card-action-icon" aria-hidden="true">${DECK_CARD_ACTION_ICONS[action.key] || '•'}</span>
      <span><strong>${escapeHtml(action.label)}</strong><small>${escapeHtml(action.description)}</small></span>
    </button>`).join('')}</div>`;
}

function openDeckCardEditor(item, deck) {
  return openDialog({
    title: `${item.card.name} in deck`,
    submitLabel: 'Opslaan',
    content: `<div class="form-grid"><div class="field"><label>Aantal</label><input name="quantity" type="number" min="1" value="${item.quantity}"></div><div class="field"><label>Rol</label><select name="role">${roleOptions(item.role)}</select></div><div class="field full"><label>Functionele tags</label><input name="tags" value="${escapeHtml(item.tags.join(', '))}" placeholder="Ramp, Draw, Protection"></div><div class="field full"><label>Notitie</label><textarea name="note">${escapeHtml(item.note)}</textarea></div></div>`,
    onSubmit: async (data) => {
      await api(`/decks/${deck.id}/cards/${item.id}`, {
        method: 'PATCH',
        body: {
          quantity: Number(formValue(data, 'quantity', '1')),
          role: formValue(data, 'role'),
          tags: parseTags(formValue(data, 'tags')),
          note: formValue(data, 'note')
        }
      });
      toast(`${item.card.name} is bijgewerkt.`);
      refreshDeckView();
      return true;
    }
  });
}

async function removeDeckCardItem(item, deck) {
  const confirmed = await confirmDialog({
    title: 'Kaart uit deck verwijderen',
    message: `Verwijder ${item.card.name} (${item.card.setCode.toUpperCase()} #${item.card.collectorNumber}) uit ${deck.name}?`
  });
  if (!confirmed) return false;
  await api(`/decks/${deck.id}/cards/${item.id}`, { method: 'DELETE' });
  toast(`${item.card.name} is uit het deck verwijderd.`);
  refreshDeckView();
  return true;
}

function openBasicLandPrintingsDialog(group, cards, deck) {
  const members = group.displayMembers || [];
  const dialog = openDialog({
    title: `${group.quantity}× ${group.card.name}`,
    wide: true,
    cancelLabel: 'Sluiten',
    content: `<div class="basic-land-printing-list">${members.map((member) => `
      <article class="basic-land-printing-row">
        <a data-card-detail-link href="#/cards/${member.card.id}">${cardImage(member.card, { className: 'group-card-thumb' })}</a>
        <div>
          <a data-card-detail-link href="#/cards/${member.card.id}"><strong>${member.quantity}× ${escapeHtml(member.card.name)}</strong></a>
          <small>${escapeHtml(member.card.setName)} (${escapeHtml(member.card.setCode.toUpperCase())}) #${escapeHtml(member.card.collectorNumber)}${member.card.language ? ` · ${escapeHtml(member.card.language.toUpperCase())}` : ''}</small>
          ${member.note ? `<small>${escapeHtml(member.note)}</small>` : ''}
        </div>
        <div class="basic-land-printing-actions">
          <button type="button" class="button secondary small manage-basic-land-relations" data-id="${member.id}" data-write-action>Combo’s/synergieën</button>
          <button type="button" class="button secondary small edit-basic-land-printing" data-id="${member.id}" data-write-action>Bewerken</button>
          <button type="button" class="button ghost small remove-basic-land-printing text-danger" data-id="${member.id}" data-write-action>Verwijderen</button>
        </div>
      </article>`).join('')}</div>`
  });

  const memberById = new Map(members.map((member) => [member.id, member]));
  dialog.querySelectorAll('[data-card-detail-link]').forEach((link) => link.addEventListener('click', () => dialog.close()));
  dialog.querySelectorAll('.manage-basic-land-relations').forEach((button) => button.addEventListener('click', () => {
    const member = memberById.get(Number(button.dataset.id));
    if (!member) return;
    dialog.close();
    openRelationsDialog(member, cards, deck);
  }));
  dialog.querySelectorAll('.edit-basic-land-printing').forEach((button) => button.addEventListener('click', () => {
    const member = memberById.get(Number(button.dataset.id));
    if (!member) return;
    dialog.close();
    openDeckCardEditor(member, deck);
  }));
  dialog.querySelectorAll('.remove-basic-land-printing').forEach((button) => button.addEventListener('click', async () => {
    const member = memberById.get(Number(button.dataset.id));
    if (!member) return;
    dialog.close();
    await removeDeckCardItem(member, deck);
  }));
  return dialog;
}

function deckCardSearchText(item) {
  const members = item.displayMembers || [item];
  return [
    item.card.name,
    item.card.printedName,
    item.card.typeLine,
    ...members.flatMap((member) => [
      member.card.setName,
      member.card.setCode,
      member.card.collectorNumber,
      member.note,
      ...(member.tags || [])
    ]),
    ...(item.relations || []).flatMap((group) => [
      group.name,
      group.type,
      group.note,
      ...(group.members || []).map((member) => member.name)
    ])
  ].filter(Boolean).join(' ').toLocaleLowerCase('nl');
}

function deckCardFilterAttributes(item) {
  return `data-deck-filter-card data-display-id="${item.id}" data-role="${escapeHtml(item.role)}" data-types="${escapeHtml((item.card.cardTypes || []).join('|'))}" data-search="${escapeHtml(deckCardSearchText(item))}" data-quantity="${item.quantity}"`;
}

function primaryDeckCardType(card) {
  const types = card.cardTypes || [];
  return CARD_TYPE_ORDER.find((type) => types.includes(type)) || 'Overig';
}

function deckVisualCardHtml(item) {
  return `<article class="deck-visual-card" ${deckCardFilterAttributes(item)}>
    <button type="button" class="deck-visual-card-trigger" data-card-preview-id="${item.card.id}" aria-haspopup="dialog" aria-keyshortcuts="Shift+F10" title="Klik voor een grotere versie; rechtsklik voor kaartacties" aria-label="Toon grotere versie van ${escapeHtml(item.card.name)}, ${item.quantity} exemplaren">
      ${cardImage(item.card, { className: 'deck-visual-card-image card-preview-image' })}
      <span class="deck-visual-card-quantity" aria-hidden="true">${item.quantity}&times;</span>
    </button>
  </article>`;
}

function deckVisualGroupsHtml(items, columns) {
  const groups = new Map([...CARD_TYPE_ORDER, 'Overig'].map((type) => [type, []]));
  for (const item of items) groups.get(primaryDeckCardType(item.card)).push(item);

  return `<div id="deck-card-visual" class="deck-visual-groups" data-columns="${columns}">${[...groups.entries()]
    .filter(([, groupItems]) => groupItems.length)
    .map(([type, groupItems]) => `<section class="deck-visual-group" data-deck-type-group="${escapeHtml(type)}">
      <header class="deck-visual-group-header">
        <h3>${escapeHtml(CARD_TYPE_GROUP_LABELS[type] || type)}</h3>
        <span class="deck-visual-group-count" data-deck-group-count>${deckCardQuantity(groupItems)}</span>
      </header>
      <div class="deck-visual-grid">${groupItems.map(deckVisualCardHtml).join('')}</div>
    </section>`).join('')}</div>`;
}

function deckCardHtml(item) {
  const conflict = item.coverage.globalShortage > 0;
  const status = item.coverage.assumedAvailable
    ? '<span class="badge neutral">Basic land beschikbaar</span>'
    : item.coverage.missingFromCollection > 0
      ? `<span class="badge missing">Mist ${item.coverage.missingFromCollection}</span>`
      : conflict
        ? `<span class="badge warning">Missende kaarten ${item.coverage.globalShortage}</span>`
        : '<span class="badge free">In bezit</span>';
  const members = item.displayMembers || [item];
  const groupedPrintings = item.groupedBasicLand && members.length > 1;
  const meta = groupedPrintings
    ? `${escapeHtml(item.card.typeLine)} · ${members.length} printings`
    : `${escapeHtml(item.card.typeLine)} · ${escapeHtml(item.card.setCode.toUpperCase())} #${escapeHtml(item.card.collectorNumber)}`;
  const rulesText = item.card.printedText || item.card.oracleText || '';
  const hasReadOnlyAction = deckCardActionDescriptors(item).some((action) => !action.write);
  const actions = `<button type="button" class="button secondary small open-deck-card-actions" ${hasReadOnlyAction ? '' : 'data-write-action '}data-display-id="${item.id}" aria-haspopup="dialog" aria-label="Acties voor ${escapeHtml(item.card.name)}">Acties</button>`;
  return `<article class="card-list-item deck-card-row" ${deckCardFilterAttributes(item)}>
    <button type="button" class="card-thumb-link deck-card-preview-trigger" data-card-preview-id="${item.card.id}" aria-haspopup="dialog" aria-label="Toon grotere versie van ${escapeHtml(item.card.name)}">${cardImage(item.card, { className: 'list-thumb' })}</button>
    <div class="card-list-content">
      <div class="card-title-row deck-card-title-row"><div><span class="role-label">${escapeHtml(ROLE_LABELS[item.role] || item.role)}</span><div class="deck-card-name-mana"><span class="deck-card-name-slot"><button type="button" class="deck-card-name-preview" data-card-preview-id="${item.card.id}" aria-haspopup="dialog" aria-label="Toon grotere versie van ${item.quantity}× ${escapeHtml(item.card.name)}"><strong>${item.quantity}× ${escapeHtml(item.card.name)}</strong></button></span><span class="deck-card-mana-slot">${manaCost(item.card.manaCost)}</span></div></div></div>
      <p class="card-meta">${meta}</p>
      <div class="usage-badges compact">${status}${item.coverage.onWanted ? '<span class="badge wanted">Wanted</span>' : ''}<span class="badge neutral">Totaal bezit ${item.card.usage.owned}</span><span class="badge used">Alle decks ${item.card.usage.needed}</span></div>
      ${tagPills(item.tags)}
      ${cardInsightBadges(item.card)}
      ${relationPills(item.relations, members.map((member) => member.id))}
      ${item.note ? `<small>${escapeHtml(item.note)}</small>` : ''}
    </div>
    <div class="deck-card-rules-text oracle-text">${rulesText ? cardTextHtml(rulesText) : '<span class="muted">Geen kaarttekst beschikbaar.</span>'}</div>
    <div class="card-list-actions">${actions}</div>
  </article>`;
}

export async function renderDeckDetail(context) {
  const deckId = Number(context.params.id);
  const initialSearch = context.query.get('cardSearch') || '';
  const requestedRole = context.query.get('role') || 'all';
  const initialRole = requestedRole === 'all' || Object.hasOwn(ROLE_LABELS, requestedRole) ? requestedRole : 'all';
  const initialType = context.query.get('cardType') || '';
  const initialView = context.query.get('view') === 'cards' ? 'cards' : 'list';
  const initialColumns = normalizeDeckVisualColumns(context.query.get('cardColumns'));
  const [deck, cards] = await Promise.all([
    api(`/decks/${deckId}`),
    api(`/decks/${deckId}/cards`)
  ]);
  const commander = deck.commander;
  const second = deck.secondCommander;
  const groupsById = new Map();
  cards.flatMap((item) => item.relations || []).forEach((group) => groupsById.set(group.id, group));
  const displayCards = groupDeckCardsForDisplay(cards);
  const displayCardByLeadId = new Map(displayCards.map((item) => [item.id, item]));
  const displayCardByCardId = new Map(displayCards.map((item) => [Number(item.card.id), item]));
  const deckCardById = new Map(cards.map((item) => [Number(item.id), item]));
  const totalCardCount = deckCardQuantity(cards);
  const deckCardTypes = sortCardTypes(new Set(cards.flatMap((item) => item.card.cardTypes || [])));
  const selectedType = deckCardTypes.includes(initialType) ? initialType : '';
  const filterPanelKey = `deck-${deck.id}`;
  const filterPanelExpanded = filtersExpanded(filterPanelKey);
  const activeFilterCount = Number(Boolean(initialSearch)) + Number(initialRole !== 'all') + Number(Boolean(selectedType));

  const cardList = displayCards.length
    ? `<div id="deck-card-list" class="card-list" ${initialView === 'list' ? '' : 'hidden'}>${displayCards.map(deckCardHtml).join('')}</div>
      <div id="deck-card-visual-container" ${initialView === 'cards' ? '' : 'hidden'}>
        <div class="deck-visual-toolbar">
          <label for="deck-cards-per-row"><span>Kaarten per rij</span><select id="deck-cards-per-row">${deckVisualColumnOptions(initialColumns)}</select></label>
          <small>Op kleine schermen wordt het aantal automatisch begrensd.</small>
        </div>
        ${deckVisualGroupsHtml(displayCards, initialColumns)}
      </div>`
    : emptyState('Nog geen kaarten in dit deck', 'Voeg een commander of eerste kaart toe.', '<button id="empty-add-card" class="button primary" data-write-action>Kaart zoeken</button>');

  const commanderStrip = commander ? `<section class="commander-strip">
    <a data-card-detail-link href="#/cards/${commander.id}">${cardImage(commander, { className: 'commander-thumb-large' })}</a>
    <div><small>Commander</small><a data-card-detail-link href="#/cards/${commander.id}"><strong>${escapeHtml(commander.name)}</strong></a><span>${escapeHtml(commander.typeLine)}</span></div>
    ${second ? `<div class="commander-secondary"><a data-card-detail-link href="#/cards/${second.id}">${cardImage(second, { className: 'commander-thumb-large' })}</a><div><small>Tweede commander</small><a data-card-detail-link href="#/cards/${second.id}"><strong>${escapeHtml(second.name)}</strong></a></div></div>` : ''}
  </section>` : `<section class="commander-strip"><div class="card-image-placeholder commander-thumb-large"><span>?</span></div><div><small>Commander</small><strong>Nog niet ingesteld</strong><span>Voeg een kaart toe met de rol Commander.</span></div></section>`;

  return {
    html: `
      ${pageHeader({
        eyebrow: deck.format,
        title: deck.name,
        description: deck.description || '',
        actions: `<a id="deck-simulator-link" class="button secondary" href="#/decks/${deck.id}/simulate">Simulator</a><a id="deck-statistics-link" class="button secondary" href="#/decks/${deck.id}/stats">Statistieken</a><button id="add-deck-card" class="button primary" data-write-action><span class="icon-plus" aria-hidden="true"></span> Kaart toevoegen</button><button id="edit-deck" class="button secondary" data-write-action>Bewerken</button><button id="more-deck" class="button secondary" data-write-action>Importeren</button>`
      })}
      ${commanderStrip}

      <section class="panel">
        <header class="panel-header deck-panel-header">
          <div class="deck-panel-heading">
            <h2>Deck</h2>
            ${displayCards.length ? `<div class="deck-view-toggle" role="group" aria-label="Deckweergave">
              <button type="button" class="deck-view-button ${initialView === 'list' ? 'active' : ''}" data-deck-view="list" aria-pressed="${initialView === 'list'}">Lijst</button>
              <button type="button" class="deck-view-button ${initialView === 'cards' ? 'active' : ''}" data-deck-view="cards" aria-pressed="${initialView === 'cards'}">Kaarten</button>
            </div>` : ''}
          </div>
          <div class="deck-panel-actions"><a class="button secondary small" href="${apiPath(`/decks/${deck.id}/export.txt`)}">Exporteren</a> <a class="button secondary small" href="${apiPath(`/decks/${deck.id}/export.txt?missing=true`)}">Tekort exporteren</a></div>
        </header>
        <div class="panel-body">
          <div class="deck-filter-heading">
            ${filterToggleHtml({ id: 'deck-filter-toggle', panelId: 'deck-filters-panel', expanded: filterPanelExpanded, activeCount: activeFilterCount })}
            <span id="deck-filter-summary" class="muted">${totalCardCount} kaarten zichtbaar</span>
          </div>
          <div id="deck-filters-panel" class="deck-filters-panel collapsible-filters" ${filterPanelExpanded ? '' : 'hidden'}>
            <div class="deck-list-toolbar">
              <div class="deck-list-filter-fields">
                <div class="field deck-list-search"><label for="deck-card-search">Zoek in dit deck</label><input id="deck-card-search" type="search" autocomplete="off" value="${escapeHtml(initialSearch)}" placeholder="Filter op kaartnaam, type, set, tag, combo of synergie…"></div>
                <div class="field deck-list-type"><label for="deck-card-type">Kaarttype</label><select id="deck-card-type">${cardTypeOptions(deckCardTypes, selectedType)}</select></div>
              </div>
            </div>
            <div class="section-tabs" id="deck-tabs"><button class="${initialRole === 'all' ? 'active' : ''}" data-filter="all">Alles (${totalCardCount})</button>${Object.entries(ROLE_LABELS).map(([role,label]) => `<button class="${initialRole === role ? 'active' : ''}" data-filter="${role}">${escapeHtml(label)} (${deckCardQuantity(cards, role)})</button>`).join('')}</div>
          </div>
          ${cardList}
          <div id="deck-filter-empty" class="filter-empty" hidden>Geen kaarten voldoen aan deze zoekopdracht en selectie.</div>
        </div>
      </section>`,
    mount() {
      document.getElementById('deck-simulator-link')?.addEventListener('click', (event) => {
        event.preventDefault();
        window.location.hash = prepareDeckSimulatorNavigation(event.currentTarget.getAttribute('href'));
      });
      document.getElementById('deck-statistics-link')?.addEventListener('click', (event) => {
        event.preventDefault();
        window.location.hash = prepareDeckStatsNavigation(event.currentTarget.getAttribute('href'));
      });

      const addCard = async () => {
        const card = await pickCard({ title: `Kaart toevoegen aan ${deck.name}`, preferCollection: true });
        if (card) await addCardToDeck(card, { deckId: deck.id, onDone: refreshDeckView });
      };
      document.getElementById('add-deck-card')?.addEventListener('click', addCard);
      document.getElementById('empty-add-card')?.addEventListener('click', addCard);

      document.querySelectorAll('[data-card-preview-id]').forEach((trigger) => trigger.addEventListener('click', () => {
        const item = displayCardByCardId.get(Number(trigger.dataset.cardPreviewId));
        if (item) openCardPreview(item.card);
      }));


      document.getElementById('edit-deck')?.addEventListener('click', () => openDialog({
        title: 'Deck bewerken', submitLabel: 'Opslaan',
        content: `<div class="form-grid"><div class="field full"><label>Naam</label><input name="name" value="${escapeHtml(deck.name)}" required></div><div class="field"><label>Formaat</label><select name="format">${['commander','standard','pioneer','modern','legacy','vintage','pauper','oathbreaker','brawl','other'].map((value) => `<option value="${value}" ${deck.format === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div><div class="field full"><label>Beschrijving</label><textarea name="description">${escapeHtml(deck.description)}</textarea></div><div class="field full"><label>Notities</label><textarea name="notes">${escapeHtml(deck.notes)}</textarea></div></div>`,
        onSubmit: async (data) => {
          await api(`/decks/${deck.id}`, { method: 'PATCH', body: { name: formValue(data,'name'), format: formValue(data,'format'), description: formValue(data,'description'), notes: formValue(data,'notes') } });
          toast('Deck bijgewerkt.'); refreshDeckView(); return true;
        }
      }));

      document.getElementById('more-deck')?.addEventListener('click', () => openDialog({
        title: 'Decklijst importeren', submitLabel: 'Importeren', wide: true,
        content: `<p>Plak een lijst in het formaat <strong>1 Card Name</strong>. Moxfield-regels zoals <strong>1 Card Name (SET) 123</strong> worden ook herkend.</p><div class="field"><label>Decklijst</label><textarea name="text" rows="14" placeholder="Commander\n1 Yedora, Grave Gardener\n\nDeck\n1 Sol Ring"></textarea></div>`,
        onSubmit: async (data) => {
          const result = await api(`/decks/${deck.id}/import`, { method: 'POST', body: { text: formValue(data,'text') } });
          toast(`${result.importedCount} regels geïmporteerd${result.failed.length ? `; ${result.failed.length} mislukt` : ''}.`, result.failed.length ? 'warning' : 'success');
          refreshDeckView(); return true;
        }
      }));

      const runDeckCardAction = async (action, displayItem) => {
        if (!deckCardActionDescriptors(displayItem).some((descriptor) => descriptor.key === action)) return;
        const item = deckCardById.get(Number(displayItem.id)) || displayItem;
        if (action === 'wanted') {
          addCardToWanted(item.card, {
            quantity: Number(displayItem.coverage.wantedGap),
            notes: `Ontbreekt voor deck: ${deck.name}`,
            deckId: deck.id,
            onDone: refreshDeckView
          });
        } else if (action === 'relations') {
          openRelationsDialog(item, cards, deck);
        } else if (action === 'insights') {
          openCardInsightsEditor(item.card, { onDone: refreshDeckView });
        } else if (action === 'edit') {
          openDeckCardEditor(item, deck);
        } else if (action === 'remove') {
          await removeDeckCardItem(item, deck);
        } else if (action === 'printings') {
          openBasicLandPrintingsDialog(displayItem, cards, deck);
        }
      };

      const openDeckCardActionsDialog = (displayItem) => {
        const allowedActions = new Set(deckCardListActionDescriptors(displayItem).map((action) => action.key));
        const dialog = openDialog({
          title: `Acties voor ${displayItem.card.name}`,
          cancelLabel: 'Sluiten',
          initialFocus: '[data-deck-card-action]:not(:disabled)',
          content: deckCardActionMenuHtml(displayItem)
        });
        applyWriteAvailability(dialog);
        dialog.querySelector('.deck-card-action-menu')?.addEventListener('click', async (event) => {
          const button = event.target.closest('[data-deck-card-action]');
          if (!button || !allowedActions.has(button.dataset.deckCardAction)) return;
          const action = button.dataset.deckCardAction;
          dialog.close();
          await runDeckCardAction(action, displayItem);
        });
        return dialog;
      };

      document.querySelectorAll('.open-deck-card-actions').forEach((button) => button.addEventListener('click', () => {
        const item = displayCardByLeadId.get(Number(button.dataset.displayId));
        if (item) openDeckCardActionsDialog(item);
      }));

      document.querySelectorAll('.show-deck-group').forEach((button) => button.addEventListener('click', () => {
        const group = groupsById.get(Number(button.dataset.groupId));
        if (group) openGroupDetailsDialog(group, cards, deck);
      }));

      let contextMenuState = null;
      const closeDeckCardContextMenu = ({ restoreFocus = false } = {}) => {
        if (!contextMenuState) return;
        const { element, opener, onDocumentPointerDown, onDocumentKeyDown, onViewportChange } = contextMenuState;
        contextMenuState = null;
        document.removeEventListener('pointerdown', onDocumentPointerDown, true);
        document.removeEventListener('keydown', onDocumentKeyDown);
        window.removeEventListener('resize', onViewportChange);
        window.removeEventListener('scroll', onViewportChange, true);
        window.removeEventListener('hashchange', onViewportChange);
        window.removeEventListener('app:refresh', onViewportChange);
        element.remove();
        if (restoreFocus && opener?.isConnected) opener.focus();
      };
      const openDeckCardContextMenu = (displayItem, { opener, clientX, clientY } = {}) => {
        closeDeckCardContextMenu();
        const element = document.createElement('div');
        element.className = 'deck-card-context-menu';
        element.setAttribute('aria-label', `Acties voor ${displayItem.card.name}`);
        element.innerHTML = deckCardActionMenuHtml(displayItem, { contextMenu: true });
        element.querySelector('[role="menu"]')?.setAttribute('aria-label', `Acties voor ${displayItem.card.name}`);
        element.style.left = '0px';
        element.style.top = '0px';
        element.style.visibility = 'hidden';
        document.body.append(element);
        applyWriteAvailability(element);

        const enabledItems = () => [...element.querySelectorAll('[role="menuitem"]:not(:disabled)')];
        if (!enabledItems().length) {
          const notice = document.createElement('p');
          notice.className = 'deck-card-context-notice';
          notice.setAttribute('role', 'status');
          notice.textContent = 'Kaartacties zijn niet beschikbaar in alleen-lezenmodus.';
          element.querySelector('[role="menu"]')?.prepend(notice);
        }

        const anchor = opener?.getBoundingClientRect?.();
        const menuRect = element.getBoundingClientRect();
        const requestedX = Number.isFinite(clientX) && clientX > 0 ? clientX : (anchor?.right || 8);
        const requestedY = Number.isFinite(clientY) && clientY > 0 ? clientY : (anchor?.bottom || 8);
        const left = Math.max(8, Math.min(requestedX, window.innerWidth - menuRect.width - 8));
        const top = Math.max(8, Math.min(requestedY, window.innerHeight - menuRect.height - 8));
        element.style.left = `${left}px`;
        element.style.top = `${top}px`;
        element.style.visibility = '';

        const onDocumentPointerDown = (event) => {
          if (!element.contains(event.target)) closeDeckCardContextMenu();
        };
        const onDocumentKeyDown = (event) => {
          const items = enabledItems();
          if (event.key === 'Escape') {
            event.preventDefault();
            closeDeckCardContextMenu({ restoreFocus: true });
            return;
          }
          if (event.key === 'Tab') {
            event.preventDefault();
            closeDeckCardContextMenu({ restoreFocus: true });
            return;
          }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !items.length) return;
          event.preventDefault();
          const currentIndex = items.indexOf(document.activeElement);
          const nextIndex = event.key === 'Home' ? 0
            : event.key === 'End' ? items.length - 1
              : currentIndex < 0 ? (event.key === 'ArrowUp' ? items.length - 1 : 0)
                : event.key === 'ArrowDown' ? (currentIndex + 1) % items.length
                  : (currentIndex - 1 + items.length) % items.length;
          items[nextIndex].focus();
        };
        const onViewportChange = () => closeDeckCardContextMenu();
        contextMenuState = { element, opener, onDocumentPointerDown, onDocumentKeyDown, onViewportChange };
        document.addEventListener('pointerdown', onDocumentPointerDown, true);
        document.addEventListener('keydown', onDocumentKeyDown);
        window.addEventListener('resize', onViewportChange);
        window.addEventListener('scroll', onViewportChange, true);
        window.addEventListener('hashchange', onViewportChange);
        window.addEventListener('app:refresh', onViewportChange);
        element.querySelector('.deck-card-action-menu')?.addEventListener('click', async (event) => {
          const button = event.target.closest('[data-deck-card-action]');
          if (!button) return;
          const action = button.dataset.deckCardAction;
          closeDeckCardContextMenu();
          await runDeckCardAction(action, displayItem);
        });
        const firstItem = enabledItems()[0];
        if (firstItem) firstItem.focus();
        else element.querySelector('[role="menu"]')?.focus();
      };

      document.querySelectorAll('.deck-visual-card-trigger').forEach((trigger) => {
        const openActions = (event) => {
          const item = displayCardByLeadId.get(Number(trigger.closest('[data-display-id]')?.dataset.displayId));
          if (!item) return;
          event.preventDefault();
          event.stopPropagation();
          openDeckCardContextMenu(item, { opener: trigger, clientX: event.clientX, clientY: event.clientY });
        };
        trigger.addEventListener('contextmenu', openActions);
        trigger.addEventListener('keydown', (event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openActions(event);
        });
      });

      let activeDeckFilter = initialRole;
      let activeDeckView = initialView;
      let activeDeckColumns = initialColumns;
      const deckSearch = document.getElementById('deck-card-search');
      const deckType = document.getElementById('deck-card-type');
      const deckColumns = document.getElementById('deck-cards-per-row');
      const deckFilterToggle = bindFilterToggle({
        button: document.getElementById('deck-filter-toggle'),
        panel: document.getElementById('deck-filters-panel'),
        key: filterPanelKey,
        getActiveCount: () => Number(Boolean(String(deckSearch?.value || '').trim()))
          + Number(activeDeckFilter !== 'all')
          + Number(Boolean(String(deckType?.value || '')))
      });
      const replaceDeckFilterQuery = () => {
        const query = deckDetailQueryString({
          cardSearch: deckSearch?.value,
          role: activeDeckFilter,
          cardType: deckType?.value,
          view: activeDeckView,
          cardColumns: activeDeckColumns
        });
        const hash = `#/decks/${deck.id}${query ? `?${query}` : ''}`;
        history.replaceState(history.state, '', `${window.location.pathname}${window.location.search}${hash}`);
      };
      const matchesDeckFilters = (cardElement, query, selectedCardType) => {
        const roleMatch = activeDeckFilter === 'all' || cardElement.dataset.role === activeDeckFilter;
        const types = String(cardElement.dataset.types || '').split('|').filter(Boolean);
        const typeMatch = !selectedCardType || types.includes(selectedCardType);
        const searchMatch = !query || String(cardElement.dataset.search || '').includes(query);
        return roleMatch && typeMatch && searchMatch;
      };
      const applyDeckFilters = () => {
        const query = String(deckSearch?.value || '').trim().toLocaleLowerCase('nl');
        const selectedCardType = String(deckType?.value || '');
        let visible = 0;
        document.querySelectorAll('#deck-card-list > [data-deck-filter-card]').forEach((row) => {
          row.hidden = !matchesDeckFilters(row, query, selectedCardType);
          if (!row.hidden) visible += Number(row.dataset.quantity || 0);
        });
        document.querySelectorAll('#deck-card-visual [data-deck-filter-card]').forEach((card) => {
          card.hidden = !matchesDeckFilters(card, query, selectedCardType);
        });
        document.querySelectorAll('[data-deck-type-group]').forEach((group) => {
          const visibleCards = [...group.querySelectorAll('[data-deck-filter-card]')].filter((card) => !card.hidden);
          const visibleInGroup = visibleCards.reduce((total, card) => total + Number(card.dataset.quantity || 0), 0);
          group.hidden = visibleInGroup === 0;
          const count = group.querySelector('[data-deck-group-count]');
          if (count) count.textContent = String(visibleInGroup);
        });
        const summary = document.getElementById('deck-filter-summary');
        if (summary) summary.textContent = `${visible} van ${totalCardCount} kaarten zichtbaar`;
        const empty = document.getElementById('deck-filter-empty');
        if (empty) empty.hidden = visible > 0 || totalCardCount === 0;
      };
      const applyDeckView = () => {
        const list = document.getElementById('deck-card-list');
        const visual = document.getElementById('deck-card-visual-container');
        if (list) list.hidden = activeDeckView !== 'list';
        if (visual) visual.hidden = activeDeckView !== 'cards';
        document.querySelectorAll('[data-deck-view]').forEach((button) => {
          const selected = button.dataset.deckView === activeDeckView;
          button.classList.toggle('active', selected);
          button.setAttribute('aria-pressed', String(selected));
        });
      };
      const applyDeckColumns = () => {
        document.getElementById('deck-card-visual')?.setAttribute('data-columns', activeDeckColumns);
        if (deckColumns) deckColumns.value = activeDeckColumns;
      };
      const applyAndRememberDeckFilters = () => {
        closeDeckCardContextMenu();
        applyDeckFilters();
        replaceDeckFilterQuery();
        deckFilterToggle.updateActiveCount();
      };
      deckSearch?.addEventListener('input', applyAndRememberDeckFilters);
      deckType?.addEventListener('change', applyAndRememberDeckFilters);
      deckColumns?.addEventListener('change', () => {
        activeDeckColumns = normalizeDeckVisualColumns(deckColumns.value);
        applyDeckColumns();
        replaceDeckFilterQuery();
      });
      document.querySelectorAll('#deck-tabs button').forEach((button) => button.addEventListener('click', () => {
        document.querySelectorAll('#deck-tabs button').forEach((tab) => tab.classList.remove('active'));
        button.classList.add('active');
        activeDeckFilter = button.dataset.filter;
        applyAndRememberDeckFilters();
      }));
      document.querySelectorAll('[data-deck-view]').forEach((button) => button.addEventListener('click', () => {
        closeDeckCardContextMenu();
        activeDeckView = button.dataset.deckView === 'cards' ? 'cards' : 'list';
        applyDeckView();
        replaceDeckFilterQuery();
      }));
      applyDeckFilters();
      applyDeckView();
      applyDeckColumns();

      const actions = document.querySelector('.page-actions');
      if (actions) {
        const extra = document.createElement('button');
        extra.className = 'button ghost';
        extra.textContent = 'Meer…';
        actions.append(extra);
        extra.addEventListener('click', () => {
          const dialog = openDialog({
            title: 'Deckacties', cancelLabel: 'Sluiten',
            content: `<div class="quick-actions deck-quick-actions"><button id="duplicate-action" class="quick-action" data-write-action type="button"><span>⧉</span><div>Dupliceren<small>Maak een volledige kopie</small></div></button><a class="quick-action" href="${apiPath(`/decks/${deck.id}/export.txt`)}"><span>⇩</span><div>Exporteren<small>Eenvoudige decklijst</small></div></a><button id="delete-action" class="quick-action text-danger" data-write-action type="button"><span>×</span><div>Verwijderen<small>Deck permanent wissen</small></div></button></div>`
          });

          dialog.querySelector('#duplicate-action')?.addEventListener('click', () => {
            dialog.close();
            openDialog({
              title: 'Deck dupliceren',
              submitLabel: 'Dupliceren',
              content: `<div class="field"><label>Naam van de kopie</label><input name="name" value="${escapeHtml(`${deck.name} (kopie)`)}" required maxlength="200"></div>`,
              onSubmit: async (data) => {
                const copy = await api(`/decks/${deck.id}/duplicate`, { method: 'POST', body: { name: formValue(data, 'name') } });
                toast('Deck gedupliceerd.');
                window.location.hash = `#/decks/${copy.id}`;
                return true;
              }
            });
          });

          dialog.querySelector('#delete-action')?.addEventListener('click', async () => {
            dialog.close();
            const confirmed = await confirmDialog({ title: 'Deck verwijderen', message: `Weet je zeker dat je ${deck.name} wilt verwijderen? De collectie blijft behouden.` });
            if (confirmed) {
              await api(`/decks/${deck.id}`, { method: 'DELETE' });
              toast('Deck verwijderd.');
              window.location.hash = '#/decks';
            }
          });
        });
      }
    }
  };
}
