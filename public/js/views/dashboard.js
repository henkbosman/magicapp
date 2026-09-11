import { api } from '../api.js';
import { cardImage, metric, pageHeader, sectionCard, usageBadges } from '../components.js';
import { emptyState, escapeHtml, formatDate, formatEuro, formatNumber } from '../utils.js';

export async function renderDashboard() {
  const data = await api('/dashboard');
  const totals = data.totals;
  const recent = data.recentCollection;

  const recentHtml = recent.length
    ? `<div class="card-list">${recent.map((item) => `
      <article class="card-list-item">
        <a href="#/cards/${item.card.id}">${cardImage(item.card, { className: 'list-thumb' })}</a>
        <div class="card-list-content">
          <div class="card-title-row"><a href="#/cards/${item.card.id}"><strong>${escapeHtml(item.card.name)}</strong></a><strong>${formatNumber(item.quantity)}×</strong></div>
          <p class="card-meta">${escapeHtml(item.card.setName)} · ${escapeHtml(item.finish)} · toegevoegd ${formatDate(item.createdAt, true)}</p>
          ${usageBadges(item.card.usage, { compact: true })}
        </div>
        <div class="card-list-actions"><a class="button secondary small" href="#/cards/${item.card.id}">Bekijken</a></div>
      </article>`).join('')}</div>`
    : emptyState('Nog geen kaarten', 'Voeg je eerste kaart toe om je collectie op te bouwen.', '<a class="button primary" data-write-action href="#/add">Eerste kaart toevoegen</a>');

  return {
    html: `
      ${pageHeader({
        eyebrow: 'Overzicht',
        title: 'Mijn Magic-verzameling',
        actions: '<a class="button primary" data-write-action href="#/add">＋ Kaart toevoegen</a><a class="button secondary" href="#/decks">Deck bouwen</a>'
      })}
      <section class="metrics-grid">
        ${metric('Fysieke kaarten', formatNumber(totals.physicalCards), `${formatNumber(totals.uniqueCards)} unieke kaarten`, 'success')}
        ${metric('Decks', formatNumber(totals.decks), 'Gewenste decklijsten', 'info')}
        ${metric('Wanted', formatNumber(totals.wanted), 'Gewenste exemplaren', 'purple')}
        ${metric('Missende kaarten', formatNumber(totals.totalMissing), totals.totalMissing ? 'Over alle decks' : 'Alle deckbehoeften gedekt', totals.totalMissing ? 'danger' : 'success')}
        ${metric('Geschatte waarde', totals.valuedCopies ? formatEuro(totals.estimatedValueEur) : '—', totals.valuedCopies ? `${formatNumber(totals.valuedCopies)} geprijsde exemplaren` : 'Nog geen EUR-prijzen beschikbaar', 'warning')}
      </section>
      <section class="dashboard-grid">
        <div>
          ${sectionCard('Laatst toegevoegd', recentHtml, '<a class="button ghost small" href="#/collection">Volledige collectie →</a>')}
        </div>
        <div>
          ${sectionCard('Snelle acties', `<div class="quick-actions">
            <a class="quick-action" data-write-action href="#/add"><span>＋</span><div>Kaart registreren<small>Zoek printing en voeg toe</small></div></a>
            <a class="quick-action" href="#/decks"><span>▤</span><div>Deck beheren<small>Bouw ook met ontbrekende kaarten</small></div></a>
            <a class="quick-action" href="#/wanted"><span>☆</span><div>Wanted bekijken<small>Filter op deck en prioriteit</small></div></a>
          </div>`)}
        </div>
      </section>`
  };
}
