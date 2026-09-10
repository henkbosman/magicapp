import { api, apiPath } from '../api.js';
import { addCardToDeck, addCardToWanted } from '../card-actions.js';
import { pickCard } from '../card-picker.js';
import { cardImage, cardInsightBadges, manaCost, pageHeader, tagPills } from '../components.js';
import { openCardInsightsEditor } from '../card-insights.js';
import { confirmDialog, emptyState, escapeHtml, formValue, openDialog, parseTags, refreshView, toast } from '../utils.js';
import { prepareDeckSimulatorNavigation, prepareDeckStatsNavigation, preserveCurrentScrollForNextRender } from '../navigation-state.js';
import { bindFilterToggle, filterToggleHtml, filtersExpanded } from '../collapsible-filters.js';

const ROLE_LABELS = {
  commander: 'Commander', partner: 'Tweede commander', companion: 'Companion',
  main: 'Main deck', sideboard: 'Sideboard', maybeboard: 'Maybeboard'
};

const RELATION_LABELS = { synergy: 'Synergie', combo: 'Combo' };
const CARD_TYPE_ORDER = ['Creature', 'Land', 'Artifact', 'Enchantment', 'Instant', 'Sorcery', 'Planeswalker', 'Battle', 'Kindred'];


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
  return `<div class="deck-relation-list">${relations.map((relation) => {
    const member = (relation.members || []).find((candidate) => Number(candidate.deckCardId) === Number(deckCardId));
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
        <button type="button" class="button primary create-deck-group" data-write-action ${cards.length < 2 ? 'disabled title="Voeg eerst nog een kaart aan het deck toe"' : ''}>＋ Nieuwe combo of synergie</button>
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

function deckCardHtml(item) {
  const conflict = item.coverage.globalShortage > 0;
  const status = item.coverage.assumedAvailable
    ? '<span class="badge neutral">Basic land beschikbaar</span>'
    : item.coverage.missingFromCollection > 0
      ? `<span class="badge missing">Mist ${item.coverage.missingFromCollection}</span>`
      : conflict
        ? `<span class="badge warning">Missende kaarten ${item.coverage.globalShortage}</span>`
        : '<span class="badge free">In bezit</span>';
  const searchText = [
    item.card.name,
    item.card.printedName,
    item.card.typeLine,
    item.card.setName,
    item.card.setCode,
    ...(item.tags || []),
    ...(item.relations || []).flatMap((group) => [
      group.name,
      group.type,
      group.note,
      ...(group.members || []).map((member) => member.name)
    ])
  ].filter(Boolean).join(' ').toLocaleLowerCase('nl');
  const wantedAction = item.coverage.wantedGap > 0
    ? `<button class="button secondary small deck-card-to-wanted" data-write-action data-id="${item.id}">☆ ${item.coverage.wantedGap > 1 ? `${item.coverage.wantedGap} naar Wanted` : 'Naar Wanted'}</button>`
    : '';
  const cardTypes = (item.card.cardTypes || []).join('|');
  return `<article class="card-list-item deck-card-row" data-role="${escapeHtml(item.role)}" data-types="${escapeHtml(cardTypes)}" data-search="${escapeHtml(searchText)}">
    <a class="card-thumb-link" data-card-detail-link href="#/cards/${item.card.id}">${cardImage(item.card, { className: 'list-thumb' })}</a>
    <div class="card-list-content">
      <div class="card-title-row"><div><span class="role-label">${escapeHtml(ROLE_LABELS[item.role] || item.role)}</span><br><a data-card-detail-link href="#/cards/${item.card.id}"><strong>${item.quantity}× ${escapeHtml(item.card.name)}</strong></a></div>${manaCost(item.card.manaCost)}</div>
      <p class="card-meta">${escapeHtml(item.card.typeLine)} · ${escapeHtml(item.card.setCode.toUpperCase())} #${escapeHtml(item.card.collectorNumber)}</p>
      <div class="usage-badges compact">${status}${item.coverage.onWanted ? '<span class="badge wanted">Wanted</span>' : ''}<span class="badge neutral">Totaal bezit ${item.card.usage.owned}</span><span class="badge used">Alle decks ${item.card.usage.needed}</span></div>
      ${tagPills(item.tags)}
      ${cardInsightBadges(item.card)}
      ${relationPills(item.relations, item.id)}
      ${item.note ? `<small>${escapeHtml(item.note)}</small>` : ''}
    </div>
    <div class="card-list-actions">${wantedAction}<button class="button secondary small manage-deck-relations" data-write-action data-id="${item.id}">Combo’s/synergieën${item.relations?.length ? ` (${item.relations.length})` : ''}</button><button class="button secondary small edit-deck-card-insights" data-write-action data-id="${item.id}">Kenmerken</button><button class="button secondary small edit-deck-card" data-write-action data-id="${item.id}">Bewerken</button><button class="button ghost small remove-deck-card text-danger" data-write-action data-id="${item.id}" data-name="${escapeHtml(item.card.name)}">Verwijderen</button></div>
  </article>`;
}


export async function renderDeckDetail(context) {
  const deckId = Number(context.params.id);
  const initialSearch = context.query.get('cardSearch') || '';
  const requestedRole = context.query.get('role') || 'all';
  const initialRole = requestedRole === 'all' || Object.hasOwn(ROLE_LABELS, requestedRole) ? requestedRole : 'all';
  const initialType = context.query.get('cardType') || '';
  const [deck, cards] = await Promise.all([
    api(`/decks/${deckId}`),
    api(`/decks/${deckId}/cards`)
  ]);
  const commander = deck.commander;
  const second = deck.secondCommander;
  const groupsById = new Map();
  cards.flatMap((item) => item.relations || []).forEach((group) => groupsById.set(group.id, group));
  const deckCardTypes = sortCardTypes(new Set(cards.flatMap((item) => item.card.cardTypes || [])));
  const selectedType = deckCardTypes.includes(initialType) ? initialType : '';
  const filterPanelKey = `deck-${deck.id}`;
  const filterPanelExpanded = filtersExpanded(filterPanelKey);
  const activeFilterCount = Number(Boolean(initialSearch)) + Number(initialRole !== 'all') + Number(Boolean(selectedType));

  const cardList = cards.length
    ? `<div id="deck-card-list" class="card-list">${cards.map(deckCardHtml).join('')}</div>`
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
        actions: `<a id="deck-simulator-link" class="button secondary" href="#/decks/${deck.id}/simulate">Simulator</a><a id="deck-statistics-link" class="button secondary" href="#/decks/${deck.id}/stats">Statistieken</a><button id="add-deck-card" class="button primary" data-write-action>＋ Kaart toevoegen</button><button id="edit-deck" class="button secondary" data-write-action>Bewerken</button><button id="more-deck" class="button secondary" data-write-action>Importeren</button>`
      })}
      ${commanderStrip}

      <section class="panel">
        <header class="panel-header"><h2>Decklijst</h2><div><a class="button secondary small" href="${apiPath(`/decks/${deck.id}/export.txt`)}">Exporteren</a> <a class="button secondary small" href="${apiPath(`/decks/${deck.id}/export.txt?missing=true`)}">Tekort exporteren</a></div></header>
        <div class="panel-body">
          <div class="deck-filter-heading">
            ${filterToggleHtml({ id: 'deck-filter-toggle', panelId: 'deck-filters-panel', expanded: filterPanelExpanded, activeCount: activeFilterCount })}
            <span id="deck-filter-summary" class="muted">${cards.length} kaartregels zichtbaar</span>
          </div>
          <div id="deck-filters-panel" class="deck-filters-panel collapsible-filters" ${filterPanelExpanded ? '' : 'hidden'}>
            <div class="deck-list-toolbar">
              <div class="deck-list-filter-fields">
                <div class="field deck-list-search"><label for="deck-card-search">Zoek in dit deck</label><input id="deck-card-search" type="search" autocomplete="off" value="${escapeHtml(initialSearch)}" placeholder="Filter op kaartnaam, type, set, tag, combo of synergie…"></div>
                <div class="field deck-list-type"><label for="deck-card-type">Kaarttype</label><select id="deck-card-type">${cardTypeOptions(deckCardTypes, selectedType)}</select></div>
              </div>
            </div>
            <div class="section-tabs" id="deck-tabs"><button class="${initialRole === 'all' ? 'active' : ''}" data-filter="all">Alles (${cards.length})</button>${Object.entries(ROLE_LABELS).map(([role,label]) => `<button class="${initialRole === role ? 'active' : ''}" data-filter="${role}">${escapeHtml(label)} (${cards.filter((item) => item.role === role).length})</button>`).join('')}</div>
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

      document.querySelectorAll('.deck-card-to-wanted').forEach((button) => button.addEventListener('click', () => {
        const item = cards.find((row) => row.id === Number(button.dataset.id));
        if (!item) return;
        addCardToWanted(item.card, {
          quantity: Math.max(Number(item.coverage.wantedGap || 1), 1),
          notes: `Ontbreekt voor deck: ${deck.name}`,
          deckId: deck.id,
          onDone: refreshDeckView
        });
      }));

      document.querySelectorAll('.edit-deck-card-insights').forEach((button) => button.addEventListener('click', () => {
        const item = cards.find((row) => row.id === Number(button.dataset.id));
        if (item) openCardInsightsEditor(item.card, { onDone: refreshDeckView });
      }));

      document.querySelectorAll('.edit-deck-card').forEach((button) => button.addEventListener('click', () => {
        const item = cards.find((row) => row.id === Number(button.dataset.id));
        if (!item) return;
        openDialog({
          title: `${item.card.name} in deck`, submitLabel: 'Opslaan',
          content: `<div class="form-grid"><div class="field"><label>Aantal</label><input name="quantity" type="number" min="1" value="${item.quantity}"></div><div class="field"><label>Rol</label><select name="role">${roleOptions(item.role)}</select></div><div class="field full"><label>Functionele tags</label><input name="tags" value="${escapeHtml(item.tags.join(', '))}" placeholder="Ramp, Draw, Protection"></div><div class="field full"><label>Notitie</label><textarea name="note">${escapeHtml(item.note)}</textarea></div></div>`,
          onSubmit: async (data) => {
            await api(`/decks/${deck.id}/cards/${item.id}`, { method: 'PATCH', body: { quantity: Number(formValue(data,'quantity','1')), role: formValue(data,'role'), tags: parseTags(formValue(data,'tags')), note: formValue(data,'note') } });
            toast(`${item.card.name} is bijgewerkt.`); refreshDeckView(); return true;
          }
        });
      }));

      document.querySelectorAll('.manage-deck-relations').forEach((button) => button.addEventListener('click', () => {
        const item = cards.find((row) => row.id === Number(button.dataset.id));
        if (item) openRelationsDialog(item, cards, deck);
      }));

      document.querySelectorAll('.show-deck-group').forEach((button) => button.addEventListener('click', () => {
        const group = groupsById.get(Number(button.dataset.groupId));
        if (group) openGroupDetailsDialog(group, cards, deck);
      }));

      document.querySelectorAll('.remove-deck-card').forEach((button) => button.addEventListener('click', async () => {
        const confirmed = await confirmDialog({ title: 'Kaart uit deck verwijderen', message: `Verwijder ${button.dataset.name} uit ${deck.name}?` });
        if (!confirmed) return;
        await api(`/decks/${deck.id}/cards/${button.dataset.id}`, { method: 'DELETE' });
        toast(`${button.dataset.name} is uit het deck verwijderd.`); refreshDeckView();
      }));

      let activeDeckFilter = initialRole;
      const deckSearch = document.getElementById('deck-card-search');
      const deckType = document.getElementById('deck-card-type');
      const deckFilterToggle = bindFilterToggle({
        button: document.getElementById('deck-filter-toggle'),
        panel: document.getElementById('deck-filters-panel'),
        key: filterPanelKey,
        getActiveCount: () => Number(Boolean(String(deckSearch?.value || '').trim()))
          + Number(activeDeckFilter !== 'all')
          + Number(Boolean(String(deckType?.value || '')))
      });
      const replaceDeckFilterQuery = () => {
        const params = new URLSearchParams();
        const search = String(deckSearch?.value || '').trim();
        const type = String(deckType?.value || '');
        if (search) params.set('cardSearch', search);
        if (activeDeckFilter !== 'all') params.set('role', activeDeckFilter);
        if (type) params.set('cardType', type);
        const query = params.toString();
        const hash = `#/decks/${deck.id}${query ? `?${query}` : ''}`;
        history.replaceState(history.state, '', `${window.location.pathname}${window.location.search}${hash}`);
      };
      const applyDeckListFilters = () => {
        const query = String(deckSearch?.value || '').trim().toLocaleLowerCase('nl');
        const selectedCardType = String(deckType?.value || '');
        let visible = 0;
        document.querySelectorAll('#deck-card-list > article').forEach((row) => {
          const roleMatch = activeDeckFilter === 'all' || row.dataset.role === activeDeckFilter;
          const types = String(row.dataset.types || '').split('|').filter(Boolean);
          const typeMatch = !selectedCardType || types.includes(selectedCardType);
          const searchMatch = !query || String(row.dataset.search || '').includes(query);
          row.hidden = !(roleMatch && typeMatch && searchMatch);
          if (!row.hidden) visible += 1;
        });
        const summary = document.getElementById('deck-filter-summary');
        if (summary) summary.textContent = `${visible} van ${cards.length} kaartregels zichtbaar`;
        const empty = document.getElementById('deck-filter-empty');
        if (empty) empty.hidden = visible > 0 || cards.length === 0;
      };
      const applyAndRememberDeckFilters = () => {
        applyDeckListFilters();
        replaceDeckFilterQuery();
        deckFilterToggle.updateActiveCount();
      };
      deckSearch?.addEventListener('input', applyAndRememberDeckFilters);
      deckType?.addEventListener('change', applyAndRememberDeckFilters);
      document.querySelectorAll('#deck-tabs button').forEach((button) => button.addEventListener('click', () => {
        document.querySelectorAll('#deck-tabs button').forEach((tab) => tab.classList.remove('active'));
        button.classList.add('active');
        activeDeckFilter = button.dataset.filter;
        applyAndRememberDeckFilters();
      }));
      applyDeckListFilters();

      const actions = document.querySelector('.page-actions');
      if (actions) {
        const extra = document.createElement('button');
        extra.className = 'button ghost';
        extra.textContent = 'Meer…';
        actions.append(extra);
        extra.addEventListener('click', () => {
          const dialog = openDialog({
            title: 'Deckacties', cancelLabel: 'Sluiten',
            content: `<div class="quick-actions"><button id="duplicate-action" class="quick-action" data-write-action type="button"><span>⧉</span><div>Dupliceren<small>Maak een volledige kopie</small></div></button><a class="quick-action" href="${apiPath(`/decks/${deck.id}/export.txt`)}"><span>⇩</span><div>Exporteren<small>Eenvoudige decklijst</small></div></a><button id="delete-action" class="quick-action text-danger" data-write-action type="button"><span>×</span><div>Verwijderen<small>Deck permanent wissen</small></div></button></div>`
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
