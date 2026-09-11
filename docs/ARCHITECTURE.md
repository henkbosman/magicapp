# Architectuur - Magic Collection Manager 2.1.0

## Overzicht

De applicatie is een single-process Node.js/Express-webapp met een statische HTML/CSS/JavaScript-frontend en SQLite als permanente lokale opslag.

```text
Browser
  │
  ├── /             statische responsive frontend
  ├── /api/read/*   alleen leesacties
  └── /api/write/*  mutaties
         │
      Express
         │
  routes → services → SQLite
                   ↘ Scryfall/cache
```

Er is geen authenticatie of gebruikersmodel. De netwerkgrens hoort bij de reverse proxy/firewall.

## Productiebaseline en database

Versie 2.0 gebruikt één geconsolideerd schema in `src/db/schema.sql`. Bij iedere start wordt dit schema idempotent uitgevoerd met `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` en `CREATE TRIGGER IF NOT EXISTS`.

Er is bewust geen historische migratie-engine in de 2.0-productiecode. 2.0 is de eerste ondersteunde productiebaseline.

Permanente gegevens staan onder `DATA_DIR` (standaard `data/`). SQLite gebruikt foreign keys, WAL-mode, `synchronous=NORMAL` en een busy timeout.

Belangrijkste tabellen:

- `cards`: lokaal gecachete Scryfall-printingmetadata;
- `collection_items`: fysieke exemplaren/groepen in bezit;
- `decks`: deckmetadata;
- `deck_cards`: gewenste kaarten per deck, onafhankelijk van bezit;
- `deck_card_tags`: deck-specifieke functietags;
- `deck_card_groups` + `deck_card_group_members`: benoemde combo-/synergiegroepen en volgorde;
- `wanted_items`: wanted-kaarten;
- `wanted_item_decks`: koppeling tussen wanted-items en decks;
- `card_user_metadata`: Oracle-brede handmatige correcties voor mana-productie en library-searchfuncties;
- `external_api_cache`: tijdelijke persistente Scryfall-responsecache;
- `card_printing_catalog` + `card_printing_catalog_state`: lokale catalogus van mogelijke printings.

## Kaartidentiteit

De tabel `cards` bevat fysieke printings en gebruikt Scryfall ID als unieke externe identifier. Voor beschikbaarheid en deckbehoefte wordt primair `oracle_id` gebruikt; wanneer die ontbreekt valt de applicatie terug op `scryfall_id`.

Daardoor kunnen verschillende fysieke printings van hetzelfde Oracle-kaartconcept samen worden geteld, terwijl een deck of collection item toch naar een concrete printing kan verwijzen.

Joined queries aliasen de database-ID van `cards` expliciet als `card_record_id` en die van fysieke collectieregels als `collection_item_id`. Dit voorkomt ID-botsingen in JavaScriptmappers.

## Routes en services

`src/routes/` bevat dunne HTTP-routes. Validatie gebeurt bij de routegrens. Domeinlogica zit in `src/services/`.

Belangrijke services:

- `card-repository.js`: lokale kaarten, collectie, gebruikstellingen;
- `card-cache-service.js`: lokale kaartcache en Scryfall-ophalen;
- `scryfall-service.js`: externe verzoeken met rate limiting/cache;
- `image-cache-service.js`: lokale schijfcache voor kaartafbeeldingen;
- `deck-service.js`: deck CRUD, deckkaarten, ontbrekende kaarten;
- `deck-stats-service.js`: centrale deterministische deckstatistieken;
- `deck-link-service.js`: combo-/synergiegroepen;
- `deck-printing-service.js`: deckprinting afstemmen na aankoop;
- `wanted-service.js`: wanted CRUD en deckrelaties;
- `printing-catalog-service.js`: mogelijke printings/rarities per Oracle-kaart;
- `card-insight-service.js`: afgeleide en handmatig corrigeerbare mana-/zoekkenmerken;
- `import-export-service.js`: CSV- en deckimport/export.

## Lees- en schrijfzone

Express mount twee API-zones:

```text
/api/read
/api/write
```

`/api/read` accepteert alleen GET/HEAD. `/api/write` weigert GET/HEAD en bevat alle muterende endpoints. De frontend controleert `POST /api/write/health`; wanneer dit niet bereikbaar is, worden schrijfcontrols disabled en verschijnt de interface als alleen-lezen.

## Frontend

De frontend is frameworkloos ES modules JavaScript. `public/js/app.js` is de hash-router en laadt views voor dashboard, collectie, kaart toevoegen, decks, deckdetails, statistieken, simulator, wanted, kaartdetails en onderhoud.

Navigatiestatus voor detailpagina's bewaart bronroute, filters en scrollpositie in session storage. Daardoor kan de gebruiker terugkeren naar dezelfde lijstpositie.

## Caching

### Scryfall-responses

`external_api_cache` bewaart externe responses met TTL. Identieke gelijktijdige verzoeken worden samengevoegd en verlopen cachedata kan bij een tijdelijke storing als fallback dienen.

### Printingcatalogus

Mogelijke papieren printings worden afzonderlijk genormaliseerd opgeslagen zodat Wanted-filters lokaal kunnen werken zonder per filterwijziging externe calls te doen.

### Afbeeldingen

Kaartafbeeldingen worden standaard onder `data/images/` gecachet. Cachebestanden zijn gekoppeld aan de exacte externe afbeelding-URL om verwisselde afbeeldingen door naam/ID-botsingen te voorkomen.

## Deckstatistieken

`deck-stats-service.js` berekent statistieken uitsluitend uit lokale data. Hieronder vallen mana curves, kleuren, types, lands, creatures, keywords, tags, Commander-waarschuwingen, ontbrekende kaarten, mana-productie, library-searchfuncties en combo-/synergiegroepstatistieken.

Er is geen Monte Carlo- of regelsimulatieanalyse in 2.0.

## Simulator

De decksimulator is bewust een vrije client-side speeltafel en geen Magic-regelengine. De status staat in `sessionStorage`; kaartverplaatsingen veranderen geen databasegegevens.


## Statische API-documentatie

De volledige machineleesbare endpointbeschrijving staat als pure Markdown in `public/API.md`. Express serveert dit bestand rechtstreeks op `/API.md` met content type `text/markdown; charset=utf-8`. `docs/API.md` bevat dezelfde inhoud voor gebruik vanuit de broncode en releasebundel. De onderhoudspagina linkt naar de publieke variant.

De documentatie benoemt voor elk endpoint de HTTP-methode, route, pad- en queryparameters, JSON-body en responsevorm. Hierdoor hoeft een LLM-integratie de frontendcode niet te analyseren om de API te gebruiken.

## Foutafhandeling en veiligheid

- API-errors gebruiken consistente JSON-foutresponses.
- Onverwachte serverfouten worden gelogd zonder interne details naar de browser te sturen.
- CSP beperkt scripts/styles tot de eigen origin; afbeeldingen mogen daarnaast van Scryfall worden geladen.
- De afbeeldingsproxy accepteert alleen gevalideerde Scryfall HTTPS-hosts.
- SQLite foreign keys bewaken relaties en cascades.
- Reverse-proxyfiltering kan de schrijfzone tot het LAN beperken.


## Read-only printing preview

De read-API mag technische Scryfall-cachedata vullen zodat externe clients zonder toegang tot `/api/write` printings en kaartdetails kunnen bekijken. Gebruikersdata zoals collectie, wanted en decks wordt uitsluitend via de write-API gemuteerd.
