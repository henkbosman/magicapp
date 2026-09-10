import { config } from '../config.js';
import { HttpError } from '../lib/http-error.js';
import { chunk, delay } from '../lib/text.js';
import { normalizeSearchText } from '../lib/text.js';
import { getExternalApiCache, setExternalApiCache } from './external-api-cache-service.js';
import { scryfallSummary } from './card-mapper.js';

const API_BASE = 'https://api.scryfall.com';

class ScryfallService {
  constructor() {
    this.queue = Promise.resolve();
    this.lastRequestAt = 0;
    this.inFlight = new Map();
  }

  async request(pathOrUrl, options = {}, minimumDelay = config.scryfallRequestDelayMs) {
    const task = this.queue.then(async () => {
      const waitFor = Math.max(0, minimumDelay - (Date.now() - this.lastRequestAt));
      if (waitFor > 0) await delay(waitFor);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.scryfallTimeoutMs);
      let response;
      try {
        response = await fetch(pathOrUrl.startsWith('http') ? pathOrUrl : `${API_BASE}${pathOrUrl}`, {
          ...options,
          headers: {
            Accept: 'application/json',
            'User-Agent': config.scryfallUserAgent,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {})
          },
          signal: controller.signal
        });
      } catch (error) {
        if (error.name === 'AbortError') {
          throw new HttpError(504, 'Scryfall reageerde niet binnen de ingestelde tijd. Lokale gegevens blijven beschikbaar.');
        }
        throw new HttpError(503, 'Scryfall is momenteel niet bereikbaar. Lokale gegevens blijven beschikbaar.', {
          cause: error.message
        });
      } finally {
        clearTimeout(timeout);
        this.lastRequestAt = Date.now();
      }

      const body = await response.json().catch(() => ({}));
      if (response.status === 429) {
        const retryAfter = Number.parseInt(response.headers.get('retry-after') || '30', 10);
        throw new HttpError(429, `Scryfall heeft tijdelijk te veel verzoeken ontvangen. Probeer het over ${retryAfter} seconden opnieuw.`, body);
      }
      if (!response.ok) {
        const status = response.status === 404 ? 404 : 502;
        throw new HttpError(status, body.details || 'Scryfall kon het verzoek niet verwerken.', body);
      }
      return body;
    });

    this.queue = task.catch(() => undefined);
    return task;
  }

  async cached(cacheKey, ttlMs, loader, { force = false, allowStaleOnError = true } = {}) {
    if (!force) {
      const cached = getExternalApiCache(cacheKey);
      if (cached) return cached.value;
    }

    if (!force && this.inFlight.has(cacheKey)) return this.inFlight.get(cacheKey);

    const request = (async () => {
      try {
        const value = await loader();
        setExternalApiCache(cacheKey, 'scryfall', value, ttlMs);
        return value;
      } catch (error) {
        if (allowStaleOnError) {
          const stale = getExternalApiCache(cacheKey, { allowStale: true });
          if (stale) {
            console.warn(`[scryfall-cache] Verouderde cache gebruikt voor ${cacheKey}: ${error.message}`);
            return stale.value;
          }
        }
        throw error;
      } finally {
        this.inFlight.delete(cacheKey);
      }
    })();

    if (!force) this.inFlight.set(cacheKey, request);
    return request;
  }

  autocomplete(query, { force = false } = {}) {
    const value = String(query || '').trim();
    if (value.length < 2) return Promise.resolve([]);
    const cacheKey = `autocomplete:${normalizeSearchText(value)}`;
    return this.cached(
      cacheKey,
      config.scryfallAutocompleteCacheTtlMs,
      () => this.request(`/cards/autocomplete?q=${encodeURIComponent(value)}&include_extras=true`).then((result) => result.data || []),
      { force }
    );
  }

  async printings(name, { force = false } = {}) {
    const normalizedName = normalizeSearchText(name);
    // v2 bevat uitsluitend fysieke paper-printings. Door de cacheversie in de
    // sleutel op te nemen worden oudere resultaten met digitale varianten niet
    // opnieuw gebruikt na een upgrade.
    const cacheKey = `printings:v2:${normalizedName}`;
    return this.cached(cacheKey, config.scryfallPrintingsCacheTtlMs, async () => {
      const escapedName = String(name).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const params = new URLSearchParams({
        q: `!"${escapedName}" game:paper`,
        unique: 'prints',
        order: 'released',
        dir: 'desc',
        include_extras: 'true',
        include_multilingual: 'true'
      });
      let url = `${API_BASE}/cards/search?${params}`;
      const cards = [];
      while (url) {
        const result = await this.request(url);
        cards.push(...(result.data || []));
        url = result.has_more ? result.next_page : null;
      }
      return cards.map(scryfallSummary);
    }, { force });
  }

  getById(id, { force = false } = {}) {
    const value = String(id);
    return this.cached(
      `card:id:${value}`,
      config.scryfallCardCacheTtlMs,
      () => this.request(`/cards/${encodeURIComponent(value)}`),
      { force }
    );
  }

  getByName(name, setCode = '', { force = false } = {}) {
    const params = new URLSearchParams({ exact: String(name) });
    if (setCode) params.set('set', setCode);
    const key = `card:name:${normalizeSearchText(name)}:${String(setCode || '').toLowerCase()}`;
    return this.cached(
      key,
      config.scryfallCardCacheTtlMs,
      () => this.request(`/cards/named?${params}`),
      { force }
    );
  }

  getByCollectorNumber(setCode, collectorNumber, language = '', { force = false } = {}) {
    const suffix = language ? `/${encodeURIComponent(language)}` : '';
    const key = `card:collector:${String(setCode).toLowerCase()}:${String(collectorNumber)}:${String(language).toLowerCase()}`;
    return this.cached(
      key,
      config.scryfallCardCacheTtlMs,
      () => this.request(`/cards/${encodeURIComponent(setCode)}/${encodeURIComponent(collectorNumber)}${suffix}`),
      { force }
    );
  }

  async getCollection(identifiers) {
    const results = [];
    const notFound = [];
    for (const batch of chunk(identifiers, 75)) {
      const cacheKey = `collection:${batch.map((item) => JSON.stringify(item)).sort().join('|')}`;
      const response = await this.cached(
        cacheKey,
        config.scryfallCardCacheTtlMs,
        () => this.request(
          '/cards/collection',
          { method: 'POST', body: JSON.stringify({ identifiers: batch }) }
        )
      );
      results.push(...(response.data || []));
      notFound.push(...(response.not_found || []));
      for (const card of response.data || []) {
        if (card?.id) setExternalApiCache(`card:id:${card.id}`, 'scryfall', card, config.scryfallCardCacheTtlMs);
      }
    }
    return { cards: results, notFound };
  }
}

export const scryfallService = new ScryfallService();
