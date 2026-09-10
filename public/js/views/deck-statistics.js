import { api, queryString } from '../api.js';
import {
  barChart,
  manaBarChart,
  manaLabel,
  manaProductionHtml,
  librarySearchHtml,
  librarySearchTargetLabel,
  metric,
  pageHeader,
  progressBar
} from '../components.js';
import {
  getDeckStatsReturnLabel,
  preserveCurrentScrollForNextRender,
  returnToDeckSource
} from '../navigation-state.js';
import { escapeHtml, toast } from '../utils.js';

const COLOR_LABELS = {
  W: 'Wit', U: 'Blauw', B: 'Zwart', R: 'Rood', G: 'Groen', C: 'Kleurloos', M: 'Meerkleurig'
};
const RELATION_LABELS = { synergy: 'Synergie', combo: 'Combo' };

function colorCurvesHtml(curves) {
  const entries = Object.entries(curves || {})
    .filter(([, curve]) => Object.values(curve || {}).some((value) => Number(value) > 0));
  if (!entries.length) return '<p class="muted">Nog geen niet-landkaarten om per kleur weer te geven.</p>';
  return `<div class="color-curve-grid">${entries.map(([color, curve]) => `
    <section class="color-curve">
      <h3>${manaLabel(color, COLOR_LABELS[color] || color)}</h3>
      ${barChart(curve)}
    </section>`).join('')}</div>`;
}

function validationHtml(validation) {
  if (!validation.length) {
    return '<div class="validation-item success"><span>✓</span><span>Geen Commander-waarschuwingen gevonden in de lokaal beschikbare kaartdata.</span></div>';
  }
  return `<div class="validation-list">${validation.map((issue) => `
    <div class="validation-item ${escapeHtml(issue.severity)}">
      <span>${issue.severity === 'error' ? '!' : '△'}</span>
      <span>${escapeHtml(issue.message)}</span>
    </div>`).join('')}</div>`;
}

function relationTypeBadge(type) {
  return `<span class="relation-type-badge ${escapeHtml(type)}">${escapeHtml(RELATION_LABELS[type] || type)}</span>`;
}

function linkGroupsHtml(groups = []) {
  if (!groups.length) return '';
  return `<div class="deck-stats-group-list">${groups.map((group) => `
    <details class="deck-stats-group">
      <summary>
        ${relationTypeBadge(group.type)}
        <strong>${escapeHtml(group.name)}</strong>
        <span>${group.memberCount} kaarten</span>
      </summary>
      <div class="deck-stats-group-body">
        ${group.note ? `<p>${escapeHtml(group.note)}</p>` : ''}
        <div class="deck-stats-group-members">
          ${(group.members || []).map((member, index) => `
            <a data-card-detail-link href="#/cards/${member.cardId}">
              <span class="play-order-step">${index + 1}</span>
              <span>${escapeHtml(member.name)}</span>
              <small>${member.quantity > 1 ? `${member.quantity}× · ` : ''}${escapeHtml(member.role)}</small>
            </a>`).join('')}
        </div>
      </div>
    </details>`).join('')}</div>`;
}

function linkStatisticsHtml(links) {
  if (!links.totalGroups) return '<p class="muted">Nog geen combo’s of synergieën vastgelegd.</p>';
  const totalRows = links.linkedCards + links.unlinkedCards;
  return `
    <div class="coverage-details link-stat-details">
      <div class="coverage-detail"><strong>${links.totalGroups}</strong><small>Groepen</small></div>
      <div class="coverage-detail"><strong>${links.combos}</strong><small>Combo’s</small></div>
      <div class="coverage-detail"><strong>${links.synergies}</strong><small>Synergieën</small></div>
      <div class="coverage-detail"><strong>${links.linkedCards}</strong><small>Gekoppelde kaartregels</small></div>
      <div class="coverage-detail"><strong>${links.averageGroupSize}</strong><small>Gem. kaarten per groep</small></div>
      <div class="coverage-detail"><strong>${links.cardsInMultipleGroups}</strong><small>In meerdere groepen</small></div>
    </div>
    ${progressBar(links.linkedCards, totalRows, 'Kaartregels in minimaal één groep')}
    ${links.largestGroupSize ? `<p class="panel-note"><strong>Grootste groep:</strong> ${escapeHtml(links.largestGroupName)} (${links.largestGroupSize} kaarten)</p>` : ''}
    <h3>Groepsgrootte</h3>
    ${barChart(links.groupSizes)}
    <h3>Vastgelegde groepen</h3>
    ${linkGroupsHtml(links.groups)}`;
}

function cardFunctionStatisticsHtml(functions = {}) {
  const manaCards = functions.manaProducers || [];
  const searchCards = functions.librarySearchCards || [];
  return `<div class="function-stat-summary">
    <div class="coverage-details">
      <div class="coverage-detail"><strong>${functions.manaProducerCardLines || 0}</strong><small>Mana-producerende kaartregels</small></div>
      <div class="coverage-detail"><strong>${functions.variableManaProducers || 0}</strong><small>Variabele producers</small></div>
      <div class="coverage-detail"><strong>${functions.librarySearchCardLines || 0}</strong><small>Kaarten die zoeken</small></div>
    </div>
    <div class="function-stat-columns">
      <section>
        <h3>Mana-productie</h3>
        ${manaCards.length ? `<div class="function-card-list">${manaCards.map((entry) => `<a data-card-detail-link href="#/cards/${entry.cardId}"><span><strong>${escapeHtml(entry.name)}</strong>${entry.quantity > 1 ? `<small>${entry.quantity}× in deck</small>` : ''}</span>${manaProductionHtml(entry.entries)}</a>`).join('')}</div>` : '<p class="muted">Geen mana-producerende kaarten herkend.</p>'}
      </section>
      <section>
        <h3>Library doorzoeken</h3>
        ${searchCards.length ? `<div class="function-card-list">${searchCards.map((entry) => `<a data-card-detail-link href="#/cards/${entry.cardId}"><span><strong>${escapeHtml(entry.name)}</strong>${entry.quantity > 1 ? `<small>${entry.quantity}× in deck</small>` : ''}</span>${librarySearchHtml(entry.targets)}</a>`).join('')}</div>` : '<p class="muted">Geen kaarten met een deckzoekfunctie herkend.</p>'}
        ${Object.keys(functions.librarySearchByTarget || {}).length ? `<div class="tag-list function-target-summary">${Object.entries(functions.librarySearchByTarget).map(([target, count]) => `<span class="tag">${escapeHtml(librarySearchTargetLabel(target))} · ${count}</span>`).join('')}</div>` : ''}
      </section>
    </div>
  </div>`;
}

function replaceStatsQuery(deckId, includeLands, returnToken) {
  const params = new URLSearchParams();
  if (includeLands) params.set('includeLands', '1');
  if (returnToken) params.set('return', returnToken);
  const query = params.toString();
  const hash = `#/decks/${deckId}/stats${query ? `?${query}` : ''}`;
  history.replaceState(history.state, '', `${window.location.pathname}${window.location.search}${hash}`);
}

export async function renderDeckStatistics(context) {
  const deckId = Number(context.params.id);
  let includeLands = context.query.get('includeLands') === '1';
  const returnToken = context.query.get('return') || '';
  const [deck, stats] = await Promise.all([
    api(`/decks/${deckId}`),
    api(`/decks/${deckId}/stats${queryString({ excludeLands: includeLands ? 'false' : 'true' })}`)
  ]);
  const wantedGap = stats.coverage.notOnWanted;

  return {
    html: `
      ${pageHeader({
        eyebrow: `${deck.format} · Statistieken`,
        title: `${deck.name} – statistieken`,
        description: 'Automatisch berekend uit de lokaal opgeslagen deck- en kaartgegevens.',
        actions: `<button id="deck-statistics-back" class="button secondary" type="button">← ${escapeHtml(getDeckStatsReturnLabel(returnToken))}</button>${wantedGap ? '<button id="stats-missing-to-wanted" class="button primary" data-write-action>Missende kaarten naar Wanted</button>' : ''}`
      })}

      <section class="metrics-grid">
        ${metric('Deckgrootte', stats.totals.cards, `${stats.totals.uniqueCards} unieke kaarten`, 'info')}
        ${metric('Niet beschikbaar', stats.coverage.missingFromCollection, `${stats.coverage.basicLandsExcluded} basic lands niet meegerekend`, stats.coverage.missingFromCollection ? 'danger' : 'success')}
        ${metric('Missende kaarten', stats.coverage.globalShortage, 'Inclusief gebruik in andere decks', stats.coverage.globalShortage ? 'warning' : 'success')}
        ${metric('Op Wanted', stats.coverage.onWanted, 'Tekort dat al op de aanschaflijst staat', stats.coverage.onWanted ? 'purple' : 'success')}
        ${metric('Nog niet Wanted', wantedGap, 'Nog niet gedekt door de aanschaflijst', wantedGap ? 'purple' : 'success')}
      </section>

      <section class="panel deck-stat-validation-panel">
        <header class="panel-header"><h2>Commander-controle</h2></header>
        <div class="panel-body">${validationHtml(stats.validation)}</div>
      </section>

      <div class="stats-toolbar">
        <label class="checkbox-field"><input id="average-land-toggle" type="checkbox" ${includeLands ? 'checked' : ''}> Lands meenemen in gemiddelde mana value</label>
        <strong id="average-mana-value">Gemiddelde mana value: ${stats.manaValue.selectedAverage}</strong>
      </div>

      <section class="panel mana-curves-panel">
        <header class="panel-header"><h2>Mana curve per kleur</h2></header>
        <div class="panel-body">
          <p class="chart-explanation">Lands zijn uitgesloten. Een meerkleurige kaart telt mee bij iedere betrokken kleur en daarnaast bij Meerkleurig.</p>
          ${colorCurvesHtml(stats.manaCurveByColor)}
        </div>
      </section>

      <section class="stats-grid">
        <section class="panel"><header class="panel-header"><h2>Mana curve</h2></header><div class="panel-body">${barChart(stats.manaCurve)}</div></section>
        <section class="panel"><header class="panel-header"><h2>Kaarttypes</h2></header><div class="panel-body">${barChart(stats.types)}</div></section>
        <section class="panel"><header class="panel-header"><h2>Kleuridentiteit</h2></header><div class="panel-body">${barChart(stats.colorIdentity, {
          formatLabel: (key) => ({ W: 'Wit', U: 'Blauw', B: 'Zwart', R: 'Rood', G: 'Groen', colorless: 'Kleurloos', multicolor: 'Meerkleurig' }[key] || key),
          formatLabelHtml: (key) => manaLabel(key, ({ W: 'Wit', U: 'Blauw', B: 'Zwart', R: 'Rood', G: 'Groen', colorless: 'Kleurloos', multicolor: 'Meerkleurig' }[key] || key))
        })}</div></section>
        <section class="panel"><header class="panel-header"><h2>Gekleurde manasymbolen</h2></header><div class="panel-body">${manaBarChart(stats.manaSymbols)}</div></section>
        <section class="panel"><header class="panel-header"><h2>Lands</h2></header><div class="panel-body"><div class="coverage-details"><div class="coverage-detail"><strong>${stats.lands.total}</strong><small>Totaal</small></div><div class="coverage-detail"><strong>${stats.lands.basic}</strong><small>Basic</small></div><div class="coverage-detail"><strong>${stats.lands.nonBasic}</strong><small>Non-basic</small></div><div class="coverage-detail"><strong>${stats.lands.ratio}%</strong><small>Van deck</small></div></div><h3>Betrouwbaar geproduceerde mana</h3>${manaBarChart(stats.lands.produces)}</div></section>
        <section class="panel"><header class="panel-header"><h2>Creatures</h2></header><div class="panel-body"><div class="coverage-details"><div class="coverage-detail"><strong>${stats.creatures.total}</strong><small>Creatures</small></div><div class="coverage-detail"><strong>${stats.creatures.averagePower ?? '—'}</strong><small>Gem. power</small></div><div class="coverage-detail"><strong>${stats.creatures.averageToughness ?? '—'}</strong><small>Gem. toughness</small></div><div class="coverage-detail"><strong>${stats.creatures.legendary}</strong><small>Legendary</small></div></div>${stats.creatures.topSubtypes.length ? `<h3>Veelvoorkomende subtypes</h3>${barChart(Object.fromEntries(stats.creatures.topSubtypes.map((row) => [row.name, row.count])))}` : ''}</div></section>
        <section class="panel"><header class="panel-header"><h2>Creature-keywords</h2></header><div class="panel-body">${barChart(stats.creatures.keywords)}</div></section>
        <section class="panel deck-function-stats-panel"><header class="panel-header"><h2>Mana en deckzoekfuncties</h2></header><div class="panel-body">${cardFunctionStatisticsHtml(stats.functions)}</div></section>
        <section class="panel"><header class="panel-header"><h2>Handmatige functies</h2></header><div class="panel-body">${barChart(stats.tags, { emptyText: 'Nog geen handmatige functietags vastgelegd.' })}</div></section>
        <section class="panel deck-links-stats-panel"><header class="panel-header"><h2>Combo’s en synergieën</h2></header><div class="panel-body">${linkStatisticsHtml(stats.links)}</div></section>
      </section>`,
    mount() {
      document.getElementById('deck-statistics-back')?.addEventListener('click', () => {
        returnToDeckSource(returnToken, deckId);
      });

      document.getElementById('average-land-toggle')?.addEventListener('change', (event) => {
        includeLands = event.target.checked;
        const average = includeLands
          ? stats.manaValue.averageIncludingLands
          : stats.manaValue.averageExcludingLands;
        const label = document.getElementById('average-mana-value');
        if (label) label.textContent = `Gemiddelde mana value: ${average}`;
        replaceStatsQuery(deckId, includeLands, returnToken);
      });

      document.getElementById('stats-missing-to-wanted')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          const result = await api(`/decks/${deck.id}/missing/to-wanted`, { method: 'POST', body: {} });
          toast(`${result.added.length} wanted-regel${result.added.length === 1 ? '' : 's'} bijgewerkt.`);
          preserveCurrentScrollForNextRender();
          context.refresh();
        } catch (error) {
          toast(error.message, 'error');
          button.disabled = false;
        }
      });
    }
  };
}
