import { api, downloadApi } from '../api.js';
import { pageHeader, sectionCard } from '../components.js';
import { escapeHtml, formatNumber, formValue, toast } from '../utils.js';
import { applyWriteAvailability } from '../write-access.js';
import { catalogImportActive, normalizeCatalogStatus } from './card-discovery.js';

function formatMegabytes(bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(2)} MB`;
}

function formatCatalogDate(value) {
  if (!value) return '—';
  const dateOnly = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: String(value).includes('T') ? 'short' : undefined }).format(date);
}

function catalogStatusTable(status) {
  return `<table class="status-table">
    <tr><td>Status</td><td>${status.available ? 'Beschikbaar' : 'Nog niet geïmporteerd'}</td></tr>
    <tr><td>Kaarten</td><td>${formatNumber(status.cardCount)}</td></tr>
    <tr><td>MTGJSON-versie</td><td>${escapeHtml(status.sourceVersion || '—')}</td></tr>
    <tr><td>Brondatum</td><td>${escapeHtml(formatCatalogDate(status.sourceDate))}</td></tr>
    <tr><td>Laatste import</td><td>${escapeHtml(formatCatalogDate(status.importedAt))}</td></tr>
    <tr><td>Databasebestand</td><td>${escapeHtml(status.databaseFile || '—')}</td></tr>
    <tr><td>Databasegrootte</td><td>${status.databaseSizeBytes ? formatMegabytes(status.databaseSizeBytes) : '—'}</td></tr>
    ${status.error ? `<tr><td>Catalogusfout</td><td class="text-danger">${escapeHtml(status.error)}</td></tr>` : ''}
  </table>`;
}

function catalogProgressHtml(status) {
  const job = status.job;
  if (!job || !job.status || ['idle', 'none'].includes(job.status)) return '';
  const active = catalogImportActive(status);
  const failed = ['failed', 'error'].includes(job.status);
  const complete = ['complete', 'completed', 'done', 'success', 'succeeded'].includes(job.status);
  const downloadPhase = ['checking', 'downloading', 'download', 'verifying'].includes(String(job.phase || '').toLowerCase());
  const processed = job.total > 0 ? job.processed : downloadPhase ? job.downloadedBytes : 0;
  const total = job.total > 0 ? job.total : downloadPhase ? job.totalBytes : 0;
  const label = job.message
    || (failed ? 'Importeren is mislukt.' : complete ? 'Importeren is voltooid.' : 'Kaartcatalogus importeren…');
  const detail = job.total > 0
    ? `${formatNumber(job.processed)} van ${formatNumber(job.total)} kaarten verwerkt`
    : !downloadPhase && job.processed > 0
      ? `${formatNumber(job.processed)} kaarten verwerkt`
    : job.downloadedBytes > 0
      ? `${formatMegabytes(job.downloadedBytes)}${job.totalBytes > 0 ? ` van ${formatMegabytes(job.totalBytes)}` : ''} gedownload`
      : '';
  return `<div class="catalog-import-progress ${failed ? 'failed' : complete ? 'complete' : active ? 'active' : ''}" role="status" aria-live="polite">
    <strong>${escapeHtml(label)}</strong>
    <progress ${total > 0 ? `max="${total}" value="${Math.min(processed, total)}"` : ''}></progress>
    ${detail ? `<span>${escapeHtml(detail)}</span>` : ''}
    ${job.error ? `<span class="text-danger">${escapeHtml(job.error)}</span>` : ''}
  </div>`;
}

export async function renderSettings() {
  const [status, catalogResponse] = await Promise.all([
    api('/maintenance/status'),
    api('/card-catalog/status')
  ]);
  let catalogStatus = normalizeCatalogStatus(catalogResponse);
  const cache = status.externalApiCache || { entries: 0, freshEntries: 0, staleEntries: 0, payloadBytes: 0 };
  const printingCatalog = status.printingCatalog || { entries: 0, cards: 0, completeCards: 0, incompleteCards: 0 };

  return {
    html: `
      ${pageHeader({
        eyebrow: 'Beheer',
        title: 'Instellingen en onderhoud',
        description: 'Maak back-ups, beheer de externe API-cache en vernieuw lokaal opgeslagen kaartgegevens.'
      })}
      <section class="grid-2 maintenance-grid">
        ${sectionCard('Lokale opslag', `<table class="status-table">
          <tr><td>Applicatieversie</td><td>${escapeHtml(status.applicationVersion)}</td></tr>
          <tr><td>Node.js</td><td>${escapeHtml(status.nodeVersion)}</td></tr>
          <tr><td>Database</td><td>${escapeHtml(status.databaseFile)}</td></tr>
          <tr><td>Databasegrootte</td><td>${formatMegabytes(status.databaseSizeBytes)}</td></tr>
          <tr><td>Gecachte kaartrecords</td><td>${formatNumber(status.counts.cards)}</td></tr>
          <tr><td>Collectieregels</td><td>${formatNumber(status.counts.collectionItems)}</td></tr>
          <tr><td>Afbeeldingscache</td><td>${status.imageCacheEnabled ? `Aan · ${status.cachedImages} bestanden` : 'Uit'}</td></tr>
        </table><div class="form-actions"><button id="download-backup" class="button primary" type="button" data-write-action>Databaseback-up downloaden</button></div>`)}

        ${sectionCard('Externe API-cache', `<p>Zoekresultaten, printings, prijzen en kaartopvragingen van Scryfall worden tijdelijk in SQLite bewaard. Daardoor zijn minder externe verzoeken nodig en blijven eerder opgehaalde resultaten bruikbaar bij een storing.</p>
          <table class="status-table">
            <tr><td>Totaal aantal cache-items</td><td>${formatNumber(cache.entries)}</td></tr>
            <tr><td>Geldig</td><td>${formatNumber(cache.freshEntries)}</td></tr>
            <tr><td>Verlopen, als fallback bewaard</td><td>${formatNumber(cache.staleEntries)}</td></tr>
            <tr><td>Opgeslagen API-data</td><td>${formatMegabytes(cache.payloadBytes)}</td></tr>
            <tr><td>Printingcatalogus</td><td>${formatNumber(printingCatalog.entries)} printings voor ${formatNumber(printingCatalog.cards)} kaarten</td></tr>
            <tr><td>Volledige catalogi</td><td>${formatNumber(printingCatalog.completeCards)}</td></tr>
            <tr><td>Onvolledig/offline</td><td>${formatNumber(printingCatalog.incompleteCards)}</td></tr>
          </table>
          <div class="form-actions"><button id="clear-external-cache" class="button secondary" type="button" data-write-action>Externe API-cache leegmaken</button></div>
          <div id="cache-result"></div>`)}
      </section>

      <section class="grid-2 maintenance-grid">
        ${sectionCard('Scryfall synchroniseren', `<p>Vernieuw kaarttekst, legaliteit, prijzen en afbeeldings-URL’s. Deze onderhoudsactie omzeilt bewust de tijdelijke API-cache. Aantallen, decks, wanted-status en notities worden nooit overschreven.</p>
          <form id="refresh-cards-form" class="form-grid maintenance-sync-form">
            <div class="field maintenance-sync-field"><label for="refresh-stale-days">Alleen ouder dan (dagen)</label><input id="refresh-stale-days" name="staleDays" type="number" min="0" value="7"><small>0 vernieuwt alle kaarten</small></div>
            <div class="field maintenance-sync-field"><label for="refresh-limit">Maximaal aantal</label><input id="refresh-limit" name="limit" type="number" min="1" max="5000" value="500"><small aria-hidden="true">&nbsp;</small></div>
            <div class="form-actions full"><button class="button primary" type="submit" data-write-action>Kaartgegevens vernieuwen</button></div>
          </form><div id="refresh-result"></div>`)}
      </section>

      <section class="grid-2 maintenance-grid">
        ${sectionCard('MTGJSON-kaartcatalogus', `<p>Importeer AtomicCards om uitgebreid kaarten voor deckbouw te kunnen zoeken. De catalogus wordt in een volledig afzonderlijke SQLite-database opgeslagen; de collectie-database wordt hiervoor niet aangepast.</p>
          <div id="card-catalog-status">${catalogStatusTable(catalogStatus)}</div>
          <div id="card-catalog-progress">${catalogProgressHtml(catalogStatus)}</div>
          <p class="help-text">Een bestaande catalogus blijft tijdens het downloaden en verwerken beschikbaar. De bron wordt rechtstreeks en uitsluitend van MTGJSON opgehaald.</p>
          <div class="form-actions"><button id="import-card-catalog" class="button primary" type="button" data-write-action data-write-initially-disabled="${catalogImportActive(catalogStatus) ? 'true' : 'false'}" ${catalogImportActive(catalogStatus) ? 'disabled' : ''}>${catalogStatus.available ? 'Kaartcatalogus bijwerken' : 'AtomicCards importeren'}</button></div>`)}
      </section>

      <section class="grid-2 maintenance-grid">
        ${sectionCard('Interne REST API', `<p>Leesacties, schrijfacties en compacte LLM-uitvoer gebruiken afzonderlijke paden. Een reverse proxy kan daardoor <strong>/api/write/</strong> uitsluitend binnen het LAN toelaten.</p><div class="api-list"><div class="api-endpoint">GET /api/read/cards/search?q=eternal</div><div class="api-endpoint">GET /api/read/collection</div><div class="api-endpoint">GET /api/read/decks/:id/stats</div><div class="api-endpoint">GET /api/read/wanted</div><div class="api-endpoint">GET /api/ai/decks</div><div class="api-endpoint">GET /api/ai/collection</div><div class="api-endpoint">POST /api/write/collection</div><div class="api-endpoint">POST /api/write/collection/with-deck</div><div class="api-endpoint">PATCH /api/write/wanted/:id/printing</div><div class="api-endpoint">POST /api/write/maintenance/external-cache/clear</div></div><div class="api-doc-actions"><a class="button secondary" href="/API-READ.txt" target="_blank" rel="noopener">Read API (tekst)</a><a class="button secondary" href="/API-WRITE.txt" target="_blank" rel="noopener">Write API (tekst)</a><a class="button secondary" href="/API-AI.html" target="_blank" rel="noopener">LLM API (HTML)</a></div>`)}
        ${sectionCard('Databasecontrole', `<table class="status-table"><tr><td>2.0-basisschema</td><td>${Number(status.schemaVersion) === 20000 ? 'Actief' : `Versie ${escapeHtml(status.schemaVersion)}`}</td></tr><tr><td>Integriteitscontrole</td><td>${escapeHtml(status.databaseIntegrity)}</td></tr><tr><td>Foreign-keyproblemen</td><td>${formatNumber(status.foreignKeyIssues)}</td></tr></table>`)}
      </section>`,
    mount() {
      const catalogStatusElement = document.getElementById('card-catalog-status');
      const catalogProgressElement = document.getElementById('card-catalog-progress');
      const catalogImportButton = document.getElementById('import-card-catalog');
      let catalogPollTimer = null;

      const showCatalogStatus = (nextStatus) => {
        catalogStatus = normalizeCatalogStatus(nextStatus);
        catalogStatusElement.innerHTML = catalogStatusTable(catalogStatus);
        catalogProgressElement.innerHTML = catalogProgressHtml(catalogStatus);
        const importActive = catalogImportActive(catalogStatus);
        catalogImportButton.dataset.writeInitiallyDisabled = importActive ? 'true' : 'false';
        catalogImportButton.disabled = importActive;
        catalogImportButton.textContent = importActive
          ? 'Importeren…'
          : catalogStatus.available ? 'Kaartcatalogus bijwerken' : 'AtomicCards importeren';
        applyWriteAvailability(catalogImportButton);
      };

      const pollCatalogStatus = async () => {
        if (!catalogStatusElement.isConnected) return;
        try {
          showCatalogStatus(await api('/card-catalog/status'));
        } catch (error) {
          catalogProgressElement.innerHTML = `<p class="text-danger">${escapeHtml(error.message || 'De importstatus kon niet worden geladen.')}</p>`;
          if (catalogImportActive(catalogStatus)) {
            clearTimeout(catalogPollTimer);
            catalogPollTimer = setTimeout(pollCatalogStatus, 2500);
          } else {
            catalogImportButton.dataset.writeInitiallyDisabled = 'false';
            catalogImportButton.disabled = false;
            applyWriteAvailability(catalogImportButton);
          }
          return;
        }
        if (catalogImportActive(catalogStatus)) {
          clearTimeout(catalogPollTimer);
          catalogPollTimer = setTimeout(pollCatalogStatus, 1200);
        }
      };

      if (catalogImportActive(catalogStatus)) {
        catalogPollTimer = setTimeout(pollCatalogStatus, 500);
      }

      catalogImportButton?.addEventListener('click', async () => {
        catalogImportButton.disabled = true;
        catalogImportButton.textContent = 'Import starten…';
        try {
          const started = await api('/maintenance/card-catalog/import', { method: 'POST', body: {} });
          showCatalogStatus({
            ...catalogStatus,
            importJob: started?.importJob || started?.job || started
          });
          toast('De MTGJSON-import is gestart.');
          await pollCatalogStatus();
        } catch (error) {
          toast(error.message || 'De MTGJSON-import kon niet worden gestart.', 'error');
          catalogImportButton.disabled = false;
          catalogImportButton.textContent = catalogStatus.available ? 'Kaartcatalogus bijwerken' : 'AtomicCards importeren';
        }
      });

      document.getElementById('download-backup')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = 'Back-up maken…';
        try {
          await downloadApi('/maintenance/backup', { method: 'POST', body: {} });
          toast('Databaseback-up is aangemaakt.');
        } catch (error) {
          toast(error.message, 'error');
        } finally {
          button.disabled = false;
          button.textContent = 'Databaseback-up downloaden';
        }
      });

      document.getElementById('clear-external-cache')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = 'Cache leegmaken…';
        try {
          const result = await api('/maintenance/external-cache/clear', { method: 'POST', body: {} });
          const catalogEntries = Number(result.printingCatalogRemoved?.entries || 0);
          document.getElementById('cache-result').innerHTML = `<div class="import-result"><strong>${formatNumber(result.removed)} API-cache-item${result.removed === 1 ? '' : 's'} en ${formatNumber(catalogEntries)} printingregel${catalogEntries === 1 ? '' : 's'} verwijderd.</strong></div>`;
          toast('De externe API-cache is leeggemaakt.');
        } catch (error) {
          toast(error.message, 'error');
        } finally {
          button.disabled = false;
          button.textContent = 'Externe API-cache leegmaken';
        }
      });

      document.getElementById('refresh-cards-form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = event.currentTarget.querySelector('button');
        const data = new FormData(event.currentTarget);
        button.disabled = true;
        button.textContent = 'Synchroniseren…';
        try {
          const result = await api('/maintenance/refresh-cards', {
            method: 'POST',
            body: {
              staleDays: Number(formValue(data, 'staleDays', '7')),
              limit: Number(formValue(data, 'limit', '500'))
            }
          });
          document.getElementById('refresh-result').innerHTML = `<div class="import-result"><strong>${result.refreshed.length} kaarten vernieuwd.</strong>${result.failed.length ? `<br>${result.failed.length} mislukt.` : ''}</div>`;
          toast('Synchronisatie afgerond.', result.failed.length ? 'warning' : 'success');
        } catch (error) {
          toast(error.message, 'error');
        } finally {
          button.disabled = false;
          button.textContent = 'Kaartgegevens vernieuwen';
        }
      });
    }
  };
}
