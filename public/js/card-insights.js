import { api } from './api.js';
import {
  cardInsightSourceLabel,
  librarySearchHtml,
  librarySearchTargetLabel,
  manaProductionHtml
} from './components.js';
import { escapeHtml, formValue, openDialog, toast } from './utils.js';

const MANA_OPTIONS = [
  ['W', 'Wit'], ['U', 'Blauw'], ['B', 'Zwart'], ['R', 'Rood'],
  ['G', 'Groen'], ['C', 'Kleurloos'], ['ANY', 'Kleur naar keuze'],
  ['W/U', 'Wit of blauw'], ['W/B', 'Wit of zwart'], ['W/R', 'Wit of rood'], ['W/G', 'Wit of groen'],
  ['U/B', 'Blauw of zwart'], ['U/R', 'Blauw of rood'], ['U/G', 'Blauw of groen'],
  ['B/R', 'Zwart of rood'], ['B/G', 'Zwart of groen'], ['R/G', 'Rood of groen'],
  ['W/U/B/R/G', 'Een van de vijf kleuren']
];
const SEARCH_TARGETS = [
  'land', 'basic_land', 'creature', 'artifact', 'enchantment',
  'instant', 'sorcery', 'planeswalker', 'battle', 'any', 'other'
];

function manaOptionHtml(current = 'G') {
  return MANA_OPTIONS.map(([value, label]) => `<option value="${value}" ${value === current ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

function manaRowHtml(entry = { mana: 'G', amount: 1, variable: false }) {
  const safeMana = MANA_OPTIONS.some(([value]) => value === entry.mana) ? entry.mana : 'G';
  return `<div class="mana-manual-row">
    <select class="mana-manual-code" aria-label="Manasoort">${manaOptionHtml(safeMana)}</select>
    <label class="mana-amount-field"><span>Aantal</span><input class="mana-manual-amount" type="number" min="1" max="99" value="${Math.max(1, Number(entry.amount || 1))}"></label>
    <label class="checkbox-field compact"><input class="mana-manual-variable" type="checkbox" ${entry.variable ? 'checked' : ''}> Variabel</label>
    <button type="button" class="icon-button remove-mana-row" aria-label="Manaregel verwijderen">×</button>
  </div>`;
}

function searchCheckboxes(selected = []) {
  const current = new Set(selected);
  return `<div class="insight-checkbox-grid">${SEARCH_TARGETS.map((target) => `<label class="checkbox-field"><input type="checkbox" name="librarySearchTargets" value="${target}" ${current.has(target) ? 'checked' : ''}> ${escapeHtml(librarySearchTargetLabel(target))}</label>`).join('')}</div>`;
}

function automaticPreview(card) {
  const mana = card.insights?.manaProduction || { source: 'none', automaticEntries: [] };
  const search = card.insights?.librarySearch || { source: 'none', automaticTargets: [] };
  return `<div class="insight-auto-preview">
    <div><span>Automatische mana-productie</span><strong>${manaProductionHtml(mana.automaticEntries || [])}</strong></div>
    <div><span>Automatische zoekfunctie</span><strong>${librarySearchHtml(search.automaticTargets || [])}</strong></div>
  </div>`;
}

export function openCardInsightsEditor(card, { onDone } = {}) {
  const manaInsight = card.insights?.manaProduction || { source: 'none', entries: [], automaticEntries: [] };
  const searchInsight = card.insights?.librarySearch || { source: 'none', targets: [], automaticTargets: [] };
  const manaMode = manaInsight.source === 'manual' ? 'manual' : 'automatic';
  const searchMode = searchInsight.source === 'manual' ? 'manual' : 'automatic';
  const manualMana = manaMode === 'manual' ? manaInsight.entries : manaInsight.automaticEntries;
  const manualTargets = searchMode === 'manual' ? searchInsight.targets : searchInsight.automaticTargets;

  const dialog = openDialog({
    title: `Kaartkenmerken · ${card.name}`,
    submitLabel: 'Opslaan',
    wide: true,
    content: `<div class="card-insight-editor">
      ${automaticPreview(card)}
      <section class="insight-editor-section">
        <div class="field"><label>Mana-productie</label><select name="manaMode"><option value="automatic" ${manaMode === 'automatic' ? 'selected' : ''}>Automatisch (${escapeHtml(cardInsightSourceLabel(manaInsight.automaticSource || (manaInsight.source === 'manual' ? 'none' : manaInsight.source)))})</option><option value="manual" ${manaMode === 'manual' ? 'selected' : ''}>Handmatig instellen</option></select></div>
        <div class="manual-insight-area" data-manual-area="mana" ${manaMode === 'manual' ? '' : 'hidden'}>
          <div id="manual-mana-rows">${(manualMana || []).map(manaRowHtml).join('')}</div>
          <button id="add-mana-row" type="button" class="button secondary small">＋ Manasoort</button>
          <small>Gebruik meerdere regels wanneer een kaart meerdere soorten of hoeveelheden kan produceren. Vink Variabel aan bij effecten zoals “voor elke …”.</small>
        </div>
        <div class="field full"><label>Toelichting bij mana-productie</label><textarea name="manaProductionNote" maxlength="1000" placeholder="Bijvoorbeeld: alleen wanneer er drie Elves liggen.">${escapeHtml(manaInsight.note || '')}</textarea></div>
      </section>

      <section class="insight-editor-section">
        <div class="field"><label>Kaarten opzoeken in library</label><select name="searchMode"><option value="automatic" ${searchMode === 'automatic' ? 'selected' : ''}>Automatisch (${escapeHtml(cardInsightSourceLabel(searchInsight.automaticSource || (searchInsight.source === 'manual' ? 'none' : searchInsight.source)))})</option><option value="manual" ${searchMode === 'manual' ? 'selected' : ''}>Handmatig instellen</option></select></div>
        <div class="manual-insight-area" data-manual-area="search" ${searchMode === 'manual' ? '' : 'hidden'}>${searchCheckboxes(manualTargets || [])}</div>
        <div class="field full"><label>Toelichting bij zoekfunctie</label><textarea name="librarySearchNote" maxlength="1000" placeholder="Bijvoorbeeld: zoekt alleen een Forest met mana value 2 of lager.">${escapeHtml(searchInsight.note || '')}</textarea></div>
      </section>
    </div>`,
    onSubmit: async (data, dialogElement) => {
      const selectedManaMode = formValue(data, 'manaMode', 'automatic');
      const selectedSearchMode = formValue(data, 'searchMode', 'automatic');
      const manaProduction = [...dialogElement.querySelectorAll('.mana-manual-row')].map((row) => ({
        mana: row.querySelector('.mana-manual-code')?.value || 'G',
        amount: Number(row.querySelector('.mana-manual-amount')?.value || 1),
        variable: Boolean(row.querySelector('.mana-manual-variable')?.checked)
      }));
      const librarySearchTargets = [...dialogElement.querySelectorAll('[name="librarySearchTargets"]:checked')].map((input) => input.value);
      const updated = await api(`/cards/${card.id}/metadata`, {
        method: 'PATCH',
        body: {
          manaMode: selectedManaMode,
          manaProduction,
          manaProductionNote: formValue(data, 'manaProductionNote'),
          searchMode: selectedSearchMode,
          librarySearchTargets,
          librarySearchNote: formValue(data, 'librarySearchNote')
        }
      });
      toast(`Kaartkenmerken voor ${card.name} zijn opgeslagen.`);
      await onDone?.(updated);
      return true;
    }
  });

  const manaRows = dialog.querySelector('#manual-mana-rows');
  const updateModeVisibility = () => {
    const selectedManaMode = dialog.querySelector('[name="manaMode"]')?.value;
    const selectedSearchMode = dialog.querySelector('[name="searchMode"]')?.value;
    const manaArea = dialog.querySelector('[data-manual-area="mana"]');
    const searchArea = dialog.querySelector('[data-manual-area="search"]');
    if (manaArea) manaArea.hidden = selectedManaMode !== 'manual';
    if (searchArea) searchArea.hidden = selectedSearchMode !== 'manual';
  };
  dialog.querySelector('[name="manaMode"]')?.addEventListener('change', updateModeVisibility);
  dialog.querySelector('[name="searchMode"]')?.addEventListener('change', updateModeVisibility);
  dialog.querySelector('#add-mana-row')?.addEventListener('click', () => {
    manaRows?.insertAdjacentHTML('beforeend', manaRowHtml());
  });
  manaRows?.addEventListener('click', (event) => {
    event.target.closest('.remove-mana-row')?.closest('.mana-manual-row')?.remove();
  });
  updateModeVisibility();
  return dialog;
}
