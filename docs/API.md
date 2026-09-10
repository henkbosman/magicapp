# REST API - Magic Collection Manager 2.0.3

De API gebruikt twee strikt gescheiden zones:

```text
/api/read/*   GET/HEAD
/api/write/*  POST/PATCH/DELETE
```

Responses bevatten normaal `{ "data": ... }`. Fouten gebruiken `{ "error": { "message": "..." } }`.

## Gezondheid

```text
GET  /api/read/health
POST /api/write/health
```

De frontend gebruikt de schrijfhealthcheck om automatisch alleen-lezenmodus te activeren wanneer `/api/write` door een reverse proxy wordt geblokkeerd.

## Dashboard

```text
GET /api/read/dashboard
```

## Kaarten

```text
GET   /api/read/cards/search?q=eternal
GET   /api/read/cards/autocomplete?q=eternal
GET   /api/read/cards/printings?name=Eternal%20Witness
GET   /api/read/cards/preview/:scryfallId
GET   /api/read/cards/image-cache?url=<scryfall-image-url>
GET   /api/read/cards/:id/image
GET   /api/read/cards/:id
POST  /api/write/cards/cache
PATCH /api/write/cards/:id/metadata
POST  /api/write/cards/:id/refresh
```

`GET /cards/preview/:scryfallId` levert detailgegevens voor een exacte Scryfall-printing via de lees-API zonder de printing in de lokale `cards`-tabel op te slaan. Hierdoor kunnen printings ook in alleen-lezenmodus volledig worden bekeken.

`PATCH /cards/:id/metadata` beheert handmatige Oracle-brede correcties voor mana-productie en library-searchfuncties.

## Collectie

```text
GET    /api/read/collection
GET    /api/read/collection/options
GET    /api/read/collection/export.csv
GET    /api/read/collection/card/:cardId
GET    /api/read/collection/:id
POST   /api/write/collection
POST   /api/write/collection/import.csv
PATCH  /api/write/collection/:id
DELETE /api/write/collection/:id
```

Belangrijke queryparameters voor `GET /collection`:

```text
q
cardKey
type
color
subtype
manaValue
ability
set
rarity
finish
deckId
availability=free|shortage|used
limit
offset
```

`commanderLegal` blijft als API-filter beschikbaar voor integraties, maar wordt niet in de collectie-interface aangeboden.

Voorbeeld toevoegen:

```json
{
  "scryfallId": "...",
  "quantity": 1,
  "finish": "nonfoil",
  "language": "en",
  "condition": "near_mint",
  "location": "Map 1",
  "notes": "",
  "purchasePrice": 0.5,
  "reconcileWanted": true,
  "sourceWantedId": 12
}
```

## Decks

```text
GET    /api/read/decks
POST   /api/write/decks
GET    /api/read/decks/:id
PATCH  /api/write/decks/:id
DELETE /api/write/decks/:id
POST   /api/write/decks/:id/duplicate

GET    /api/read/decks/:id/cards
POST   /api/write/decks/:id/cards
PATCH  /api/write/decks/:id/cards/:deckCardId
DELETE /api/write/decks/:id/cards/:deckCardId

GET    /api/read/decks/:id/links
POST   /api/write/decks/:id/links
PATCH  /api/write/decks/:id/links/:linkId
DELETE /api/write/decks/:id/links/:linkId

GET    /api/read/decks/:id/stats
GET    /api/read/decks/:id/missing
POST   /api/write/decks/:id/missing/to-wanted
POST   /api/write/decks/:id/import
GET    /api/read/decks/:id/export.txt
```

Een link is een benoemde combo- of synergiegroep en bevat minimaal twee `deckCardIds`, een type (`combo` of `synergy`), een naam, optionele notitie en een volgorde van leden.

De statistiekresponse wordt centraal door `deck-stats-service.js` berekend en bevat onder andere totals, mana curve, kaarttypes, kleuren, lands, creatures, keywords, tags, Commanderchecks, ontbrekende kaarten, mana-/zoekfuncties en groepstatistieken.

## Wanted

```text
GET    /api/read/wanted
GET    /api/read/wanted/options
GET    /api/read/wanted/export.csv
POST   /api/write/wanted
PATCH  /api/write/wanted/:id
PATCH  /api/write/wanted/:id/printing
DELETE /api/write/wanted/:id
```

Wanted-items kunnen zonder printing bestaan. `printing_card_id` wordt pas gezet wanneer een concrete printing is gekozen of wanneer aantoonbaar precies één papieren printing bestaat.

Filters ondersteunen onder andere naam, prioriteit, deck, mogelijke printing/set, rarity, kleur en sortering.

## Onderhoud

```text
GET  /api/read/maintenance/status
POST /api/write/maintenance/refresh-cards
POST /api/write/maintenance/refresh-card/:id
POST /api/write/maintenance/external-cache/clear
POST /api/write/maintenance/backup
```

`/maintenance/status` bevat applicatie-/Nodeversie, databasebestand en -grootte, tellingen, afbeeldingscache, externe API-cache, printingcatalogus, 2.0-schema-identificatie, SQLite-integriteitsstatus en foreign-keyproblemen.

## Reverse proxy

Een voorbeeld voor Nginx staat in `deploy/nginx-read-write.conf.example`. Het uitgangspunt is dat `/api/write` alleen bereikbaar is vanuit vertrouwde LAN-adressen, terwijl `/api/read` en de statische frontend desgewenst breder beschikbaar zijn.


## Printing-afbeeldingen

`GET /api/read/cards/printings?name=...` levert per printing naast `image` (thumbnail) ook `imageNormal` voor een grotere preview wanneer Scryfall die beschikbaar stelt.
