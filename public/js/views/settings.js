import { api, downloadApi } from '../api.js';
import { pageHeader, sectionCard } from '../components.js';
import { escapeHtml, formatNumber, formValue, toast } from '../utils.js';

function formatMegabytes(bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(2)} MB`;
}

export async function renderSettings() {
  const status = await api('/maintenance/status');
  const cache = status.externalApiCache || { entries: 0, freshEntries: 0, staleEntries: 0, payloadBytes: 0 };
  const printingCatalog = status.printingCatalog || { entries: 0, cards: 0, completeCards: 0, incompleteCards: 0 };

  return {
    html: `
      ${pageHeader({
        eyebrow: 'Beheer',
        title: 'Instellingen en onderhoud',
        description: 'Maak back-ups, beheer de externe API-cache, importeer een collectie en vernieuw lokaal opgeslagen kaartgegevens.'
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
          <form id="refresh-cards-form" class="form-grid">
            <div class="field"><label>Alleen ouder dan (dagen)</label><input name="staleDays" type="number" min="0" value="7"><small>0 vernieuwt alle kaarten</small></div>
            <div class="field"><label>Maximaal aantal</label><input name="limit" type="number" min="1" max="5000" value="500"></div>
            <div class="form-actions full"><button class="button primary" type="submit" data-write-action>Kaartgegevens vernieuwen</button></div>
          </form><div id="refresh-result"></div>`)}

        ${sectionCard('Collectie importeren (CSV)', `<div class="import-box">
          <p>Ondersteunde kolommen: <strong>name</strong>, set_code, collector_number, quantity, finish, language, condition, location, notes en purchase_price.</p>
          <input id="csv-file" type="file" accept=".csv,text/csv">
          <textarea id="csv-text" rows="10" placeholder="name,set_code,collector_number,quantity,finish\nSol Ring,cmm,396,1,nonfoil"></textarea>
          <button id="import-csv" class="button primary" data-write-action>CSV importeren</button>
          <div id="import-result"></div>
        </div>`)}
      </section>

      <section class="grid-2 maintenance-grid">
        ${sectionCard('Interne REST API', `<p>Leesacties, schrijfacties en compacte LLM-uitvoer gebruiken afzonderlijke paden. Een reverse proxy kan daardoor <strong>/api/write/</strong> uitsluitend binnen het LAN toelaten.</p><div class="api-list"><div class="api-endpoint">GET /api/read/cards/search?q=eternal</div><div class="api-endpoint">GET /api/read/collection</div><div class="api-endpoint">GET /api/read/decks/:id/stats</div><div class="api-endpoint">GET /api/read/wanted</div><div class="api-endpoint">GET /api/ai/decks</div><div class="api-endpoint">GET /api/ai/collection</div><div class="api-endpoint">POST /api/write/collection</div><div class="api-endpoint">POST /api/write/collection/with-deck</div><div class="api-endpoint">PATCH /api/write/wanted/:id/printing</div><div class="api-endpoint">POST /api/write/maintenance/external-cache/clear</div></div><div class="form-actions"><a class="button secondary" href="/API-READ.md" target="_blank" rel="noopener">Read API (Markdown)</a><a class="button secondary" href="/API-WRITE.md" target="_blank" rel="noopener">Write API (Markdown)</a><a class="button secondary" href="/API-AI.md" target="_blank" rel="noopener">LLM API (Markdown)</a></div>`)}
        ${sectionCard('Databasecontrole', `<table class="status-table"><tr><td>2.0-basisschema</td><td>${Number(status.schemaVersion) === 20000 ? 'Actief' : `Versie ${escapeHtml(status.schemaVersion)}`}</td></tr><tr><td>Integriteitscontrole</td><td>${escapeHtml(status.databaseIntegrity)}</td></tr><tr><td>Foreign-keyproblemen</td><td>${formatNumber(status.foreignKeyIssues)}</td></tr></table>`)}
      </section>`,
    mount() {
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

      const file = document.getElementById('csv-file');
      const text = document.getElementById('csv-text');
      file?.addEventListener('change', async () => {
        const selected = file.files?.[0];
        if (selected) text.value = await selected.text();
      });

      document.getElementById('import-csv')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        if (!text.value.trim()) return toast('Kies een CSV-bestand of plak CSV-tekst.', 'warning');
        button.disabled = true;
        button.textContent = 'Importeren…';
        try {
          const result = await api('/collection/import.csv', { method: 'POST', body: { csv: text.value } });
          document.getElementById('import-result').innerHTML = `<div class="import-result"><strong>${result.importedCount} regels geïmporteerd.</strong>${result.failed.length ? `<br>${result.failed.length} regels mislukt: ${result.failed.slice(0, 5).map((row) => escapeHtml(`${row.name}: ${row.reason}`)).join('; ')}` : ''}</div>`;
          toast('Collectie-import afgerond.', result.failed.length ? 'warning' : 'success');
        } catch (error) {
          toast(error.message, 'error');
        } finally {
          button.disabled = false;
          button.textContent = 'CSV importeren';
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
