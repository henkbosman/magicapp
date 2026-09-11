# Magic Collection Manager API 2.1.0

Dit document beschrijft de volledige interne REST API van Magic Collection Manager 2.1.0. Het is bedoeld voor scripts, integraties en taalmodellen die de applicatie willen uitlezen of bedienen.

## Basis-URL

Gebruik dezelfde host als de webapplicatie.

```text
https://magic.ferion.nl
```

Alle leesacties staan onder:

```text
/api/read
```

Alle schrijfacties staan onder:

```text
/api/write
```

Een reverse proxy kan `/api/write` blokkeren buiten het lokale netwerk terwijl `/api/read` beschikbaar blijft.

## Authenticatie

De applicatie bevat geen authenticatie. Beveilig toegang op netwerk- of reverse-proxyniveau.

## Content types

JSON-aanvragen gebruiken:

```http
Content-Type: application/json
```

De meeste JSON-responses gebruiken deze vorm:

```json
{
  "data": {}
}
```

Fouten gebruiken deze vorm:

```json
{
  "error": {
    "message": "Beschrijving van de fout",
    "details": null
  }
}
```

`details` ontbreekt wanneer er geen aanvullende foutinformatie is.

CSV-, tekst-, afbeeldings- en databaseback-upendpoints leveren geen JSON.

## HTTP-statuscodes

| Status | Betekenis |
|---|---|
| `200` | Aanvraag geslaagd |
| `201` | Object aangemaakt of import uitgevoerd |
| `400` | Ongeldige invoer |
| `404` | Object niet gevonden |
| `405` | Verkeerde HTTP-methode voor de read- of write-zone |
| `409` | Conflict, bijvoorbeeld een dubbele decknaam |
| `429` | Externe bron heeft de aanvraag tijdelijk begrensd |
| `500` | Onverwachte serverfout |

## Identificatie van een kaart

Endpoints die een kaart moeten opzoeken of lokaal cachen accepteren een van deze identificaties in de JSON-body:

```json
{
  "cardId": 123
}
```

```json
{
  "scryfallId": "00000000-0000-0000-0000-000000000000"
}
```

```json
{
  "setCode": "mh1",
  "collectorNumber": "218",
  "language": "en"
}
```

```json
{
  "name": "Altar of Dementia",
  "setCode": "mh1"
}
```

`cardId` is de lokale numerieke ID. `scryfallId` is de externe UUID. `setCode` is optioneel bij zoeken op naam.

## Gemeenschappelijke modellen

### Card

```json
{
  "id": 123,
  "scryfallId": "00000000-0000-0000-0000-000000000000",
  "oracleId": "00000000-0000-0000-0000-000000000001",
  "cardKey": "00000000-0000-0000-0000-000000000001",
  "name": "Eternal Witness",
  "printedName": null,
  "manaCost": "{1}{G}{G}",
  "manaValue": 3,
  "colors": ["G"],
  "colorIdentity": ["G"],
  "producedMana": [],
  "typeLine": "Creature — Human Shaman",
  "cardTypes": ["Creature"],
  "supertypes": [],
  "subtypes": ["Human", "Shaman"],
  "oracleText": "When Eternal Witness enters...",
  "printedText": "",
  "power": "2",
  "toughness": "1",
  "loyalty": null,
  "defense": null,
  "keywords": [],
  "setName": "Modern Horizons 3 Commander",
  "setCode": "m3c",
  "collectorNumber": "226",
  "rarity": "uncommon",
  "releasedAt": "2024-06-14",
  "artist": "Naam artiest",
  "language": "en",
  "layout": "normal",
  "legalities": {
    "commander": "legal"
  },
  "images": {
    "small": "https://cards.scryfall.io/...",
    "normal": "https://cards.scryfall.io/...",
    "large": "https://cards.scryfall.io/...",
    "png": "https://cards.scryfall.io/...",
    "backSmall": null,
    "backNormal": null,
    "backLarge": null,
    "backPng": null
  },
  "finishes": ["nonfoil", "foil"],
  "prices": {
    "eur": "0.20",
    "eur_foil": "0.35"
  },
  "cardFaces": [],
  "scryfallUri": "https://scryfall.com/card/...",
  "createdAt": "2026-09-10 12:00:00",
  "updatedAt": "2026-09-10 12:00:00"
}
```

`cardKey` is de Oracle-ID als die bestaat, anders de Scryfall-ID. Verschillende printings van hetzelfde Oracle-kaartconcept delen daardoor dezelfde `cardKey`.

### Usage

Een kaart met gebruiksinformatie bevat aanvullend:

```json
{
  "usage": {
    "owned": 2,
    "needed": 3,
    "free": 0,
    "shortage": 1,
    "wanted": 1,
    "assumedAvailable": false,
    "decks": [
      {
        "id": 4,
        "name": "Yedora",
        "quantity": 1
      }
    ]
  }
}
```

Basic lands hebben `assumedAvailable: true` en veroorzaken geen tekort.

### CardInsights

Kaartresponses kunnen aanvullend `insights` bevatten:

```json
{
  "insights": {
    "manaProduction": {
      "source": "oracle",
      "automaticSource": "oracle",
      "entries": [
        {
          "mana": "G",
          "amount": 1,
          "variable": false
        }
      ],
      "note": "",
      "detectedText": ["Add {G}."],
      "automaticEntries": []
    },
    "librarySearch": {
      "source": "manual",
      "automaticSource": "none",
      "targets": ["creature"],
      "note": "Handmatig ingesteld",
      "detectedText": [],
      "automaticTargets": []
    }
  }
}
```

Mogelijke waarden voor `mana` zijn onder andere `W`, `U`, `B`, `R`, `G`, `C`, `ANY` of een combinatie zoals `G/U`.

Mogelijke library-searchdoelen zijn:

```text
land
basic_land
creature
artifact
enchantment
instant
sorcery
planeswalker
battle
any
other
```

### PrintingSummary

```json
{
  "printingKey": "mh1|218",
  "cardId": 123,
  "scryfallId": "00000000-0000-0000-0000-000000000000",
  "oracleId": "00000000-0000-0000-0000-000000000001",
  "name": "Altar of Dementia",
  "printedName": null,
  "setName": "Modern Horizons",
  "setCode": "mh1",
  "collectorNumber": "218",
  "rarity": "rare",
  "releasedAt": "2019-06-14",
  "language": "en",
  "languages": ["en", "ja"],
  "finishes": ["nonfoil", "foil"],
  "variants": [
    {
      "language": "en",
      "scryfallId": "00000000-0000-0000-0000-000000000000",
      "cardId": 123,
      "finishes": ["nonfoil", "foil"],
      "image": "https://cards.scryfall.io/small/...",
      "imageNormal": "https://cards.scryfall.io/normal/...",
      "cached": true
    }
  ],
  "prices": {
    "eur": "7.00",
    "eur_foil": "12.00"
  },
  "image": "https://cards.scryfall.io/small/...",
  "imageNormal": "https://cards.scryfall.io/normal/...",
  "typeLine": "Artifact",
  "manaCost": "{2}",
  "layout": "normal",
  "cached": true
}
```

### CollectionItem

```json
{
  "id": 55,
  "quantity": 2,
  "finish": "nonfoil",
  "language": "en",
  "condition": "near_mint",
  "location": "Map 1",
  "notes": "",
  "purchasePrice": 0.5,
  "createdAt": "2026-09-10 12:00:00",
  "updatedAt": "2026-09-10 12:00:00",
  "card": {}
}
```

`card` is een `Card` met `usage` en `insights`.

Mogelijke `finish`-waarden:

```text
nonfoil
foil
etched
```

Mogelijke `condition`-waarden:

```text
mint
near_mint
excellent
good
light_played
played
poor
```

### Deck

```json
{
  "id": 4,
  "name": "Yedora",
  "description": "",
  "format": "commander",
  "commanderCardId": 10,
  "secondCommanderCardId": null,
  "notes": "",
  "createdAt": "2026-09-10 12:00:00",
  "updatedAt": "2026-09-10 12:00:00",
  "totalCards": 100,
  "uniqueCards": 80,
  "commander": {},
  "secondCommander": null
}
```

De decklijst voegt hieraan toe:

```json
{
  "missingQuantity": 8,
  "missingUnique": 6,
  "globalShortage": 10
}
```

Mogelijke formaten:

```text
commander
standard
pioneer
modern
legacy
vintage
pauper
oathbreaker
brawl
other
```

### DeckCard

```json
{
  "id": 77,
  "quantity": 1,
  "role": "main",
  "note": "",
  "tags": ["Ramp"],
  "relations": [],
  "createdAt": "2026-09-10 12:00:00",
  "updatedAt": "2026-09-10 12:00:00",
  "coverage": {
    "physicallyOwned": 1,
    "assumedBasicLand": 0,
    "assumedAvailable": false,
    "directlyOwned": 1,
    "missingFromCollection": 0,
    "globalShortage": 0,
    "wantedGap": 0,
    "sharedConflict": false,
    "onWanted": 0
  },
  "card": {}
}
```

Mogelijke rollen:

```text
commander
partner
companion
main
sideboard
maybeboard
```

### DeckLinkGroup

Een link is een benoemde combo- of synergiegroep met twee of meer deckkaarten.

```json
{
  "id": 9,
  "deckId": 4,
  "name": "Yedora sacrifice-loop",
  "type": "combo",
  "note": "",
  "memberCount": 3,
  "members": [
    {
      "deckCardId": 77,
      "cardId": 10,
      "name": "Yedora, Grave Gardener",
      "quantity": 1,
      "role": "commander",
      "position": 0
    }
  ],
  "createdAt": "2026-09-10 12:00:00",
  "updatedAt": "2026-09-10 12:00:00"
}
```

Mogelijke typen:

```text
combo
synergy
```

De volgorde van `deckCardIds` bij schrijven bepaalt de volgorde van de leden.

### WantedItem

```json
{
  "id": 31,
  "quantity": 1,
  "priority": 2,
  "maximumPrice": 8.5,
  "notes": "",
  "createdAt": "2026-09-10 12:00:00",
  "updatedAt": "2026-09-10 12:00:00",
  "printingSelected": true,
  "printing": {},
  "printingCatalog": {
    "printingCount": 5,
    "sets": [],
    "rarities": [],
    "rarityPrintings": {}
  },
  "requestedForDecks": [
    {
      "id": 4,
      "name": "Yedora"
    }
  ],
  "card": {}
}
```

`printing` is een `Card` of `null`. `card` is het algemene gekozen kaartconcept met gebruiksinformatie.

---

# Gezondheid

## `GET /api/read/health`

Controleert of de lees-API bereikbaar is.

### Input

Geen.

### Output `200`

```json
{
  "status": "ok",
  "version": "2.1.0"
}
```

## `POST /api/write/health`

Controleert of de schrijf-API bereikbaar is. De frontend gebruikt dit endpoint om read-onlymodus te bepalen.

### Input

Een lege JSON-body is toegestaan.

```json
{}
```

### Output `200`

```json
{
  "status": "ok",
  "writeAvailable": true,
  "version": "2.1.0"
}
```

---

# Dashboard

## `GET /api/read/dashboard`

Geeft de compacte totalen en laatst toegevoegde collectie-items.

### Input

Geen.

### Output `200`

```json
{
  "data": {
    "totals": {
      "physicalCards": 250,
      "uniqueCards": 190,
      "decks": 3,
      "wanted": 18,
      "totalMissing": 12,
      "estimatedValueEur": 455.25,
      "valuedCopies": 220
    },
    "recentCollection": [
      {
        "id": 55,
        "quantity": 1,
        "finish": "nonfoil",
        "createdAt": "2026-09-10 12:00:00",
        "card": {}
      }
    ]
  }
}
```

---

# Kaarten

## `GET /api/read/cards/search`

Doorzoekt uitsluitend lokaal bekende kaarten. Resultaten worden per Oracle-kaartconcept gegroepeerd.

### Queryparameters

| Parameter | Type | Verplicht | Beschrijving |
|---|---:|---:|---|
| `q` | string | ja | Deel van de kaartnaam |
| `limit` | integer | nee | `1` tot en met `50`, standaard `20` |

### Voorbeeld

```http
GET /api/read/cards/search?q=eternal&limit=20
```

### Output `200`

```json
{
  "data": [
    {
      "id": 123,
      "name": "Eternal Witness",
      "usage": {},
      "insights": {}
    }
  ]
}
```

Ieder item is een volledig `Card`-object met `usage` en `insights`.

## `GET /api/read/cards/autocomplete`

Combineert lokale namen met Scryfall-autocomplete. Externe responses worden gecachet.

### Queryparameters

| Parameter | Type | Verplicht | Beschrijving |
|---|---:|---:|---|
| `q` | string | ja | Minimaal twee tekens |

### Output `200`

```json
{
  "data": ["Eternal Witness", "Eternal Scourge"],
  "offline": false
}
```

Bij een bruikbare lokale fallback kan dit worden toegevoegd:

```json
{
  "warning": "Scryfall is tijdelijk niet bereikbaar"
}
```

## `GET /api/read/cards/printings`

Geeft alle papieren printings van een kaart, gegroepeerd per setcode en collectornummer. Talen en afwerkingen staan als varianten binnen een printing.

### Queryparameters

| Parameter | Type | Verplicht | Beschrijving |
|---|---:|---:|---|
| `name` | string | ja | Exacte of door Scryfall herkenbare kaartnaam, maximaal 300 tekens |

### Voorbeeld

```http
GET /api/read/cards/printings?name=Altar%20of%20Dementia
```

### Output `200`

```json
{
  "data": [],
  "offline": false,
  "complete": true,
  "stale": false,
  "warning": null
}
```

`data` is een lijst met `PrintingSummary`-objecten. `stale` en `warning` kunnen ontbreken.

## `GET /api/read/cards/image-cache`

Levert een Scryfall-kaartafbeelding via de lokale afbeeldingscache.

### Queryparameters

| Parameter | Type | Verplicht | Beschrijving |
|---|---:|---:|---|
| `url` | string | ja | Volledige toegestane HTTPS-afbeeldings-URL van Scryfall |

### Output `200`

Binaire afbeelding met het oorspronkelijke afbeeldingstype, bijvoorbeeld:

```http
Content-Type: image/jpeg
Cache-Control: public, max-age=31536000, immutable
```

Mogelijke fout: `400` bij een ongeldige of niet-toegestane URL.

## `GET /api/read/cards/preview/:scryfallId`

Geeft een volledige read-only preview van een printing. Wanneer deze printing nog niet lokaal bekend is, mag de server technische Scryfall-cachegegevens en kaartmetadata opslaan. Collectie-, deck- en wantedgegevens worden niet gewijzigd.

### Padparameters

| Parameter | Type | Beschrijving |
|---|---|---|
| `scryfallId` | UUID/string | Scryfall-ID van de printing |

### Output `200`

```json
{
  "data": {}
}
```

`data` is een `Card` met `usage`.

## `GET /api/read/cards/:id/image`

Levert een afbeelding voor een lokaal bekende kaart.

### Padparameters

| Parameter | Type | Beschrijving |
|---|---:|---|
| `id` | integer | Lokale kaart-ID |

### Queryparameters

| Parameter | Type | Standaard | Waarden |
|---|---|---|---|
| `face` | string | `front` | `front`, `back` |
| `size` | string | `normal` | `small`, `normal`, `large`, `png` |

### Output `200`

Binaire afbeelding. Geeft `404` wanneer de gevraagde zijde geen afbeelding heeft.

## `GET /api/read/cards/:id`

Geeft één lokaal bekende kaart met gebruiksinformatie.

### Padparameters

| Parameter | Type | Beschrijving |
|---|---:|---|
| `id` | integer | Lokale kaart-ID |

### Output `200`

```json
{
  "data": {}
}
```

`data` is een `Card` met `usage`.

## `POST /api/write/cards/cache`

Zoekt een kaart lokaal of bij Scryfall en slaat de printing lokaal op.

### Input

Gebruik één kaartidentificatie uit de sectie `Identificatie van een kaart`.

```json
{
  "scryfallId": "00000000-0000-0000-0000-000000000000"
}
```

### Output `201`

```json
{
  "data": {}
}
```

`data` is een `Card` met `usage`.

## `PATCH /api/write/cards/:id/metadata`

Stelt handmatige Oracle-brede correcties voor mana-productie en library-searchfuncties in. De correctie geldt voor alle lokale printings met dezelfde `cardKey`.

### Padparameters

| Parameter | Type | Beschrijving |
|---|---:|---|
| `id` | integer | Lokale kaart-ID |

### Input

```json
{
  "manaMode": "manual",
  "manaProduction": [
    {
      "mana": "G",
      "amount": 1,
      "variable": false
    }
  ],
  "manaProductionNote": "Tapt voor groen",
  "searchMode": "manual",
  "librarySearchTargets": ["creature"],
  "librarySearchNote": "Zoekt alleen een Elf"
}
```

Gebruik `automatic` om de handmatige override voor dat onderdeel te verwijderen:

```json
{
  "manaMode": "automatic",
  "searchMode": "automatic"
}
```

### Output `200`

```json
{
  "data": {}
}
```

`data` is een `Card` met bijgewerkte `insights`.

## `POST /api/write/cards/:id/refresh`

Vernieuwt één lokaal bekende printing geforceerd vanuit Scryfall. Gebruikersgegevens worden niet overschreven.

### Padparameters

| Parameter | Type | Beschrijving |
|---|---:|---|
| `id` | integer | Lokale kaart-ID |

### Input

Geen verplichte body.

### Output `200`

```json
{
  "data": {}
}
```

`data` is de vernieuwde `Card` met `usage`.

---

# Collectie

## `GET /api/read/collection/options`

Geeft de keuzelijsten voor de collectiefilters.

### Input

Geen.

### Output `200`

```json
{
  "data": {
    "sets": [
      {
        "code": "mh1",
        "name": "Modern Horizons",
        "quantity": 4
      }
    ],
    "abilities": [
      {
        "name": "Trample",
        "cardCount": 12
      }
    ],
    "decks": [
      {
        "id": 4,
        "name": "Yedora"
      }
    ]
  }
}
```

## `GET /api/read/collection/export.csv`

Exporteert alle fysieke collectieregels.

### Input

Geen.

### Output `200`

```http
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="collection.csv"
```

Kolommen:

```text
name,set_code,set_name,collector_number,quantity,finish,language,condition,location,notes,purchase_price,scryfall_id
```

## `GET /api/read/collection`

Geeft gefilterde en gepagineerde collectieregels.

### Queryparameters

| Parameter | Type | Beschrijving |
|---|---|---|
| `q` | string | Zoekterm in kaartnaam |
| `cardKey` | string | Exacte Oracle-ID of Scryfall-fallback-ID |
| `type` | string | Exact kaarttype, bijvoorbeeld `Creature` |
| `color` | string | `W`, `U`, `B`, `R`, `G`, `M` of `C` |
| `subtype` | string | Subtype, bijvoorbeeld `Elf` |
| `manaValue` | string/number | `0` tot en met `6` of `7+` |
| `ability` | string | Exact Scryfall-keyword, hoofdletterongevoelig |
| `commanderLegal` | boolean | Alleen Commander-legaliteit; beschikbaar voor integraties |
| `set` | string | Setcode |
| `rarity` | string | `common`, `uncommon`, `rare`, `mythic`, `special` of `bonus` |
| `finish` | string | `nonfoil`, `foil` of `etched` |
| `deckId` | integer | Alleen kaarten die in dit deck voorkomen |
| `availability` | string | `free`, `used` of `shortage` |
| `limit` | integer | `1` tot en met `1000`, standaard `200` |
| `offset` | integer | Startpositie, standaard `0` |

Bij `color=W`, `U`, `B`, `R` of `G` worden kaarten met exact die ene kleuridentiteit plus volledig kleurloze kaarten getoond. Multicolor kaarten worden niet meegenomen. `M` betekent twee of meer kleuren; `C` betekent uitsluitend een lege kleuridentiteit.

### Output `200`

```json
{
  "data": {
    "items": [],
    "total": 0,
    "limit": 200,
    "offset": 0
  }
}
```

`items` bevat `CollectionItem`-objecten.

## `POST /api/write/collection/import.csv`

Importeert collectiegegevens uit een CSV-string.

### Input

```json
{
  "csv": "name,set_code,collector_number,quantity\nEternal Witness,m3c,226,1\n"
}
```

Verplichte kaartnaamkolom: `name`, `card_name` of `kaartnaam`.

Ondersteunde optionele kolommen:

```text
set
set_code
collector_number
quantity
finish
language
condition
location
notes
purchase_price
```

### Output `201`

```json
{
  "data": {
    "importedCount": 1,
    "imported": [],
    "failed": [],
    "notFound": []
  }
}
```

`imported` bevat `CollectionItem`-objecten. `failed` bevat regels met `line`, `name` en `reason`.

## `POST /api/write/collection`

Voegt een fysieke kaart toe of verhoogt een passende bestaande collectieregel.

### Input

Combineer kaartidentificatie met:

```json
{
  "scryfallId": "00000000-0000-0000-0000-000000000000",
  "quantity": 1,
  "finish": "nonfoil",
  "language": "en",
  "condition": "near_mint",
  "location": "Map 1",
  "notes": "",
  "purchasePrice": 0.5,
  "reconcileWanted": true,
  "sourceWantedId": 31
}
```

| Veld | Type | Verplicht | Standaard |
|---|---|---:|---|
| `quantity` | integer groter dan 0 | nee | `1` |
| `finish` | string | nee | `nonfoil` |
| `language` | string, maximaal 10 tekens | nee | `en` |
| `condition` | string | nee | `near_mint` |
| `location` | string, maximaal 200 tekens | nee | leeg |
| `notes` | string, maximaal 5000 tekens | nee | leeg |
| `purchasePrice` | number of `null` | nee | `null` |
| `reconcileWanted` | boolean | nee | `true` |
| `sourceWantedId` | integer | nee | `null` |

Wanneer `sourceWantedId` is opgegeven, kan de werkelijk gekochte printing worden doorgezet naar de gekoppelde deckregels.

### Output `201`

```json
{
  "data": {
    "id": 55,
    "quantity": 1,
    "card": {},
    "deckPrintingAlignment": {
      "updatedDeckCards": 1,
      "deckIds": [4],
      "decks": [
        {
          "id": 4,
          "name": "Yedora"
        }
      ]
    }
  }
}
```

De velden van `CollectionItem` zijn aanwezig. `deckPrintingAlignment` kan aanvullend aanwezig zijn.

## `GET /api/read/collection/card/:cardId`

Geeft een kaartconcept en alle fysieke collectieregels met dezelfde `cardKey`.

### Padparameters

| Parameter | Type | Beschrijving |
|---|---:|---|
| `cardId` | integer | Lokale kaart-ID van een printing |

### Output `200`

```json
{
  "data": {
    "card": {},
    "items": []
  }
}
```

`card` is een `Card` met `usage`; `items` bevat `CollectionItem`-objecten voor alle bezeten printings van hetzelfde kaartconcept.

## `GET /api/read/collection/:id`

Geeft één fysieke collectieregel.

### Padparameters

| Parameter | Type | Beschrijving |
|---|---:|---|
| `id` | integer | Collectieregel-ID |

### Output `200`

```json
{
  "data": {}
}
```

`data` is een `CollectionItem`.

## `PATCH /api/write/collection/:id`

Wijzigt één collectieregel. Niet opgegeven velden behouden hun huidige waarde. Wanneer de nieuwe combinatie gelijk wordt aan een bestaande regel, worden de aantallen samengevoegd.

### Input

```json
{
  "quantity": 2,
  "finish": "foil",
  "language": "en",
  "condition": "near_mint",
  "location": "Map 2",
  "notes": "",
  "purchasePrice": 1.25
}
```

`quantity: 0` verwijdert de regel.

### Output `200`

```json
{
  "data": {}
}
```

`data` is het bijgewerkte `CollectionItem`. Bij `quantity: 0` is `data` gelijk aan `null`.

## `DELETE /api/write/collection/:id`

Verwijdert één fysieke collectieregel.

### Input

Geen body.

### Output `200`

```json
{
  "data": {}
}
```

`data` bevat de verwijderde `CollectionItem`.

---

# Decks

## `GET /api/read/decks`

Geeft alle decks, gesorteerd op laatste wijziging.

### Input

Geen.

### Output `200`

```json
{
  "data": []
}
```

Ieder item is een `Deck` met `missingQuantity`, `missingUnique`, `globalShortage` en de primaire commander.

## `POST /api/write/decks`

Maakt een deck aan.

### Input

```json
{
  "name": "Yedora",
  "description": "Mono-green Commander-deck",
  "format": "commander",
  "notes": ""
}
```

`name` is verplicht en maximaal 200 tekens. `description` is maximaal 5000 tekens. `notes` is maximaal 10000 tekens.

### Output `201`

```json
{
  "data": {}
}
```

`data` is een `Deck`.

## `GET /api/read/decks/:id`

Geeft één deck inclusief commanderobjecten en tellingen.

### Output `200`

```json
{
  "data": {}
}
```

`data` is een `Deck`.

## `PATCH /api/write/decks/:id`

Wijzigt naam, beschrijving, formaat en/of notities van een deck.

### Input

```json
{
  "name": "Yedora aangepast",
  "description": "Nieuwe beschrijving",
  "format": "commander",
  "notes": ""
}
```

Niet opgegeven velden behouden hun waarde.

### Output `200`

```json
{
  "data": {}
}
```

`data` is het bijgewerkte `Deck`.

## `DELETE /api/write/decks/:id`

Verwijdert een deck en de bijbehorende deckregels, tags, wanted-deckkoppelingen en combo-/synergiegroepen. Collectiekaarten blijven bestaan.

### Input

Geen body.

### Output `200`

```json
{
  "data": {}
}
```

`data` is het verwijderde `Deck`.

## `POST /api/write/decks/:id/duplicate`

Dupliceert het deck inclusief kaarten, rollen, tags en combo-/synergiegroepen.

### Input

```json
{
  "name": "Yedora (kopie)"
}
```

`name` is optioneel; zonder naam wordt automatisch `(kopie)` toegevoegd.

### Output `201`

```json
{
  "data": {}
}
```

`data` is het nieuwe `Deck`.

## `GET /api/read/decks/:id/cards`

Geeft alle kaartregels van een deck, inclusief maybeboard.

### Input

Geen queryparameters.

### Output `200`

```json
{
  "data": []
}
```

Ieder item is een `DeckCard`.

## `POST /api/write/decks/:id/cards`

Voegt een kaart aan een deck toe. Een kaart hoeft niet in de collectie te zitten.

### Input

Combineer kaartidentificatie met:

```json
{
  "scryfallId": "00000000-0000-0000-0000-000000000000",
  "quantity": 1,
  "role": "main",
  "note": "",
  "tags": ["Ramp", "Sacrifice"]
}
```

`tags` mag ook een kommagescheiden string zijn.

### Output `201`

```json
{
  "data": {}
}
```

`data` is een `DeckCard`.

## `PATCH /api/write/decks/:id/cards/:deckCardId`

Wijzigt hoeveelheid, rol, notitie en/of tags van een deckregel.

### Input

```json
{
  "quantity": 2,
  "role": "main",
  "note": "Belangrijk combo-onderdeel",
  "tags": ["Combo"]
}
```

Bij `commander`, `partner` en `companion` wordt de hoeveelheid op `1` gehouden.

### Output `200`

```json
{
  "data": {}
}
```

`data` is de bijgewerkte `DeckCard`.

## `DELETE /api/write/decks/:id/cards/:deckCardId`

Verwijdert een deckregel en ruimt bijbehorende groepslidmaatschappen op.

### Input

Geen body.

### Output `200`

```json
{
  "data": {}
}
```

`data` bevat de verwijderde deckregel.

## `GET /api/read/decks/:id/links`

Geeft alle benoemde combo- en synergiegroepen van een deck.

### Output `200`

```json
{
  "data": []
}
```

Ieder item is een `DeckLinkGroup`.

## `POST /api/write/decks/:id/links`

Maakt een combo- of synergiegroep.

### Input

```json
{
  "name": "Yedora sacrifice-loop",
  "type": "combo",
  "note": "",
  "deckCardIds": [77, 82, 91]
}
```

`deckCardIds` moet minimaal twee unieke deckkaart-ID's uit hetzelfde deck bevatten. De lijstvolgorde wordt opgeslagen als speelvolgorde.

Voor oudere integraties worden ook `firstDeckCardId` en `secondDeckCardId` geaccepteerd.

### Output `201`

```json
{
  "data": {}
}
```

`data` is een `DeckLinkGroup`.

## `PATCH /api/write/decks/:id/links/:linkId`

Wijzigt naam, type, notitie en/of ledenvolgorde van een combo-/synergiegroep.

### Input

```json
{
  "name": "Nieuwe groepsnaam",
  "type": "synergy",
  "note": "Nieuwe uitleg",
  "deckCardIds": [91, 77, 82]
}
```

Niet opgegeven velden behouden hun huidige waarde.

### Output `200`

```json
{
  "data": {}
}
```

`data` is de bijgewerkte `DeckLinkGroup`.

## `DELETE /api/write/decks/:id/links/:linkId`

Verwijdert een combo-/synergiegroep. De kaarten zelf blijven in het deck.

### Output `200`

```json
{
  "data": {}
}
```

`data` is de verwijderde `DeckLinkGroup`.

## `GET /api/read/decks/:id/stats`

Berekening van de volledige statische deckinformatie.

### Queryparameters

| Parameter | Type | Standaard | Beschrijving |
|---|---|---|---|
| `excludeLands` | boolean | `true` | Sluit lands uit van de geselecteerde gemiddelde mana value |

### Output `200`

```json
{
  "data": {
    "deck": {},
    "totals": {
      "cards": 100,
      "uniqueCards": 80,
      "legendary": 5,
      "permanents": 78,
      "nonPermanents": 22
    },
    "types": {
      "Creature": 31,
      "Land": 37
    },
    "manaCurve": {
      "0": 1,
      "1": 8,
      "2": 15,
      "3": 17,
      "4": 10,
      "5": 6,
      "6": 3,
      "7+": 3
    },
    "manaCurveByColor": {
      "W": {},
      "U": {},
      "B": {},
      "R": {},
      "G": {},
      "C": {},
      "M": {}
    },
    "manaValue": {
      "averageExcludingLands": 3.2,
      "averageIncludingLands": 2.01,
      "selectedAverage": 3.2,
      "excludeLandsFromAverage": true
    },
    "colors": {},
    "colorIdentity": {},
    "manaSymbols": {},
    "lands": {
      "total": 37,
      "basic": 29,
      "nonBasic": 8,
      "ratio": 37,
      "produces": {}
    },
    "functions": {
      "manaProducerCardLines": 12,
      "manaProducerQuantity": 12,
      "variableManaProducers": 1,
      "manaByType": {},
      "manaProducers": [],
      "librarySearchCardLines": 8,
      "librarySearchQuantity": 8,
      "librarySearchByTarget": {},
      "librarySearchCards": []
    },
    "creatures": {
      "total": 31,
      "averagePower": 2.8,
      "averageToughness": 3.1,
      "legendary": 4,
      "manaCurve": {},
      "topSubtypes": [],
      "keywords": {}
    },
    "tags": {},
    "coverage": {
      "total": 100,
      "eligibleCards": 63,
      "ownedCards": 55,
      "basicLandsExcluded": 37,
      "physicallyOwned": 70,
      "assumedBasicLands": 30,
      "directlyOwned": 85,
      "missingFromCollection": 8,
      "globalShortage": 10,
      "onWanted": 8,
      "notOnWanted": 2,
      "percentage": 87.3,
      "conflicts": []
    },
    "links": {
      "totalGroups": 3,
      "combos": 1,
      "synergies": 2,
      "linkedCards": 8,
      "unlinkedCards": 72,
      "cardsInCombos": 3,
      "cardsInSynergies": 6,
      "cardsInMultipleGroups": 1,
      "memberships": 9,
      "averageGroupSize": 3,
      "largestGroupSize": 4,
      "largestGroupName": "Naam",
      "participationPercentage": 10,
      "byType": {},
      "groupSizes": {},
      "groups": []
    },
    "validation": []
  }
}
```

`validation` bevat objecten met `severity`, `code`, optioneel `cardId` en `message`.

## `GET /api/read/decks/:id/missing`

Geeft kaarten die voor dit deck ontbreken en de algemene fysieke schaarste over alle decks.

### Output `200`

```json
{
  "data": {
    "items": [
      {
        "card": {},
        "quantityInDeck": 1,
        "owned": 0,
        "missingFromCollection": 1,
        "neededAllDecks": 2,
        "globalShortage": 2,
        "wanted": 1,
        "wantedGap": 1
      }
    ],
    "summary": {
      "totalCards": 100,
      "directlyOwned": 92,
      "physicallyOwned": 60,
      "assumedBasicLands": 32,
      "missingFromCollection": 8,
      "globalShortage": 10,
      "uniqueMissingFromCollection": 6,
      "uniqueShortages": 7,
      "onWanted": 8,
      "notOnWanted": 2
    }
  }
}
```

Basic lands worden niet als ontbrekend opgenomen.

## `POST /api/write/decks/:id/missing/to-wanted`

Voegt alle nog niet door Wanted gedekte, niet-basic ontbrekende kaarten van een deck toe aan Wanted.

### Input

Geen verplichte body.

### Output `200`

```json
{
  "data": {
    "added": [],
    "missing": {
      "items": [],
      "summary": {}
    }
  }
}
```

`added` bevat de aangemaakte of verhoogde `WantedItem`-objecten.

## `POST /api/write/decks/:id/import`

Importeert een eenvoudige decklijst.

### Input

```json
{
  "text": "Commander\n1 Yedora, Grave Gardener\n\nDeck\n1 Sol Ring\n1 Eternal Witness (M3C) 226\n"
}
```

Ondersteunde regels zijn onder andere:

```text
1 Card Name
1 Card Name (SET) 123
SB: 1 Card Name
Commander
Sideboard
Maybeboard
```

### Output `201`

```json
{
  "data": {
    "importedCount": 3,
    "imported": [],
    "failed": [],
    "notFound": []
  }
}
```

## `GET /api/read/decks/:id/export.txt`

Exporteert een deck als eenvoudige tekstlijst.

### Queryparameters

| Parameter | Type | Standaard | Beschrijving |
|---|---|---|---|
| `missing` | boolean | `false` | Exporteer uitsluitend ontbrekende kaarten |

### Output `200`

```http
Content-Type: text/plain; charset=utf-8
Content-Disposition: attachment; filename="decknaam.txt"
```

Voorbeeldinhoud:

```text
1 Yedora, Grave Gardener
1 Sol Ring
```

---

# Wanted

## `GET /api/read/wanted/options`

Vult of vernieuwt waar nodig de printingcatalogus van wanted-kaarten en geeft filteropties.

### Input

Geen.

### Output `200`

```json
{
  "data": {
    "printings": [
      {
        "code": "mh1",
        "name": "Modern Horizons",
        "quantity": 4,
        "printingCount": 5
      }
    ],
    "rarities": [
      {
        "rarity": "rare",
        "quantity": 7
      }
    ],
    "decks": [
      {
        "id": 4,
        "name": "Yedora",
        "quantity": 8
      }
    ],
    "catalogIncomplete": 0,
    "catalogFailures": []
  }
}
```

`catalogFailures` bevat fouten van kaarten waarvan de printingcatalogus niet kon worden vernieuwd.

## `GET /api/read/wanted/export.csv`

Exporteert de wanted-list.

### Output `200`

```http
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="wanted-list.csv"
```

Kolommen:

```text
name,set_code,set_name,collector_number,quantity,priority,maximum_price,notes,scryfall_id
```

## `GET /api/read/wanted`

Geeft de lokaal opgeslagen wanted-items. Dit endpoint doet tijdens filteren geen externe API-aanroepen.

### Queryparameters

| Parameter | Type | Beschrijving |
|---|---|---|
| `q` | string | Zoekterm in kaartnaam |
| `priority` | integer | `1` tot en met `5` |
| `deckId` | integer | Alleen kaarten die in dit deck nodig zijn; maybeboard telt niet mee |
| `printing` | string | Setcode waarin de kaart beschikbaar is, ongeacht de gekozen printing |
| `rarity` | string | Rarity van minimaal één mogelijke printing |
| `color` | string | Kleur of kleuridentiteit volgens de lokale wanted-filterlogica |
| `sort` | string | `priority`, `name`, `price`, `quantity`, `printing` of `newest` |

### Output `200`

```json
{
  "data": []
}
```

Ieder item is een `WantedItem`.

## `POST /api/write/wanted`

Voegt een kaart toe aan Wanted of verhoogt een bestaand wanted-item met dezelfde Oracle-identiteit. Basic lands worden geweigerd.

### Input

Combineer kaartidentificatie met:

```json
{
  "name": "Craterhoof Behemoth",
  "quantity": 1,
  "priority": 2,
  "maximumPrice": 25,
  "notes": "",
  "printingCardId": null,
  "deckIds": [4, 5]
}
```

In plaats van `deckIds` mag één `deckId` worden opgegeven. Wanneer aantoonbaar precies één papieren printing bestaat, kan die automatisch worden geselecteerd.

### Output `201`

```json
{
  "data": {}
}
```

`data` is een `WantedItem`.

## `PATCH /api/write/wanted/:id/printing`

Kiest of verwijdert een concrete printing voor een wanted-item.

### Input: kiezen via lokale kaart-ID

```json
{
  "printingCardId": 123
}
```

### Input: kiezen via Scryfall-ID

```json
{
  "scryfallId": "00000000-0000-0000-0000-000000000000"
}
```

### Input: kiezen via set en collectornummer

```json
{
  "setCode": "mh1",
  "collectorNumber": "218",
  "language": "en"
}
```

### Input: keuze verwijderen

```json
{
  "clear": true
}
```

Of:

```json
{
  "printingCardId": null
}
```

### Output `200`

```json
{
  "data": {}
}
```

`data` is het bijgewerkte `WantedItem`.

## `PATCH /api/write/wanted/:id`

Wijzigt hoeveelheid, prioriteit, maximumprijs en/of notities.

### Input

```json
{
  "quantity": 2,
  "priority": 1,
  "maximumPrice": 15,
  "notes": "Zoeken op beurs"
}
```

Niet opgegeven velden behouden hun huidige waarde.

### Output `200`

```json
{
  "data": {}
}
```

`data` is het bijgewerkte `WantedItem`.

## `DELETE /api/write/wanted/:id`

Verwijdert een wanted-item en de koppelingen met decks.

### Input

Geen body.

### Output `200`

```json
{
  "data": {}
}
```

`data` is het verwijderde `WantedItem`.

---

# Onderhoud

## `GET /api/read/maintenance/status`

Geeft technische statusinformatie van de lokale installatie.

### Input

Geen.

### Output `200`

```json
{
  "data": {
    "applicationVersion": "2.1.0",
    "nodeVersion": "v24.0.0",
    "databaseFile": "magic-collection.sqlite",
    "databaseSizeBytes": 1048576,
    "imageCacheEnabled": true,
    "cachedImages": 120,
    "externalApiCache": {
      "entries": 15,
      "freshEntries": 12,
      "staleEntries": 3,
      "payloadBytes": 123456
    },
    "printingCatalog": {
      "entries": 200,
      "cards": 25,
      "completeCards": 23,
      "incompleteCards": 2
    },
    "databaseIntegrity": "ok",
    "foreignKeyIssues": 0,
    "schemaVersion": 20000,
    "counts": {
      "cards": 250,
      "collectionItems": 190,
      "decks": 3,
      "wantedItems": 18
    }
  }
}
```

De exacte cachevelden kunnen worden uitgebreid; onbekende velden mogen door clients worden genegeerd.

## `POST /api/write/maintenance/refresh-cards`

Vernieuwt meerdere lokaal bekende kaarten vanuit Scryfall.

### Input

```json
{
  "staleDays": 30,
  "limit": 500
}
```

| Veld | Type | Standaard | Beschrijving |
|---|---:|---:|---|
| `staleDays` | integer vanaf 0 | `0` | Alleen kaarten ouder dan dit aantal dagen; `0` betekent geen leeftijdsfilter |
| `limit` | integer | `5000` | Maximum `5000` |

### Output `200`

```json
{
  "data": {
    "requested": 25,
    "refreshed": [
      {
        "id": 123,
        "name": "Eternal Witness"
      }
    ],
    "failed": [
      {
        "id": 124,
        "name": "Kaartnaam",
        "error": "Foutmelding"
      }
    ]
  }
}
```

## `POST /api/write/maintenance/refresh-card/:id`

Vernieuwt één lokale kaartprinting vanuit Scryfall.

### Padparameters

| Parameter | Type | Beschrijving |
|---|---:|---|
| `id` | integer | Lokale kaart-ID |

### Input

Geen verplichte body.

### Output `200`

```json
{
  "data": {}
}
```

`data` is de bijgewerkte `Card` zonder gegarandeerde `usage`-uitbreiding.

## `POST /api/write/maintenance/external-cache/clear`

Leegt de tijdelijke Scryfall-responsecache en de afgeleide printingcatalogus. Collectie-, deck-, wanted- en kaartgegevens blijven bestaan.

### Input

Geen verplichte body.

### Output `200`

```json
{
  "data": {
    "removed": 15,
    "printingCatalogRemoved": {
      "entries": 200,
      "cards": 25
    },
    "cache": {},
    "printingCatalog": {}
  }
}
```

## `POST /api/write/maintenance/backup`

Maakt via SQLite `VACUUM INTO` een consistente databaseback-up en stuurt deze direct terug.

### Input

Geen verplichte body.

### Output `200`

```http
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="magic-collection-{timestamp}.sqlite"
```

De tijdelijke serverkopie wordt na het versturen verwijderd.

---

# Samenvatting van alle endpoints

## Lees-API

```text
GET /api/read/health
GET /api/read/dashboard
GET /api/read/cards/search
GET /api/read/cards/autocomplete
GET /api/read/cards/printings
GET /api/read/cards/image-cache
GET /api/read/cards/preview/:scryfallId
GET /api/read/cards/:id/image
GET /api/read/cards/:id
GET /api/read/collection/options
GET /api/read/collection/export.csv
GET /api/read/collection
GET /api/read/collection/card/:cardId
GET /api/read/collection/:id
GET /api/read/decks
GET /api/read/decks/:id
GET /api/read/decks/:id/cards
GET /api/read/decks/:id/links
GET /api/read/decks/:id/stats
GET /api/read/decks/:id/missing
GET /api/read/decks/:id/export.txt
GET /api/read/wanted/options
GET /api/read/wanted/export.csv
GET /api/read/wanted
GET /api/read/maintenance/status
```

## Schrijf-API

```text
POST /api/write/health
POST /api/write/cards/cache
PATCH /api/write/cards/:id/metadata
POST /api/write/cards/:id/refresh
POST /api/write/collection/import.csv
POST /api/write/collection
PATCH /api/write/collection/:id
DELETE /api/write/collection/:id
POST /api/write/decks
PATCH /api/write/decks/:id
DELETE /api/write/decks/:id
POST /api/write/decks/:id/duplicate
POST /api/write/decks/:id/cards
PATCH /api/write/decks/:id/cards/:deckCardId
DELETE /api/write/decks/:id/cards/:deckCardId
POST /api/write/decks/:id/links
PATCH /api/write/decks/:id/links/:linkId
DELETE /api/write/decks/:id/links/:linkId
POST /api/write/decks/:id/missing/to-wanted
POST /api/write/decks/:id/import
POST /api/write/wanted
PATCH /api/write/wanted/:id/printing
PATCH /api/write/wanted/:id
DELETE /api/write/wanted/:id
POST /api/write/maintenance/refresh-cards
POST /api/write/maintenance/refresh-card/:id
POST /api/write/maintenance/external-cache/clear
POST /api/write/maintenance/backup
```
