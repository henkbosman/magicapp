# Magic Collection Manager Write API 2.3.3

Base URL: `https://<host>`  
Gebruik `Content-Type: application/json`. De reverse proxy kan `/api/write/*` buiten het LAN blokkeren.  
Foutformaat: `{"error":{"message":"...","details":null}}`.

Een kaart kan waar vermeld worden geïdentificeerd met één van deze JSON-vormen:

```json
{"cardId":123}
```

```json
{"scryfallId":"uuid"}
```

```json
{"setCode":"mh1","collectorNumber":"218","language":"en"}
```

```json
{"name":"Altar of Dementia","setCode":"mh1"}
```

## `POST /api/write/health`

Controleert of de write-API bereikbaar is.

### Input JSON

```json
{}
```

### Output JSON

```json
{"status":"ok","writeAvailable":true,"version":"2.3.3"}
```

## `POST /api/write/cards/cache`

Zoekt een kaart lokaal of bij Scryfall en slaat de printing lokaal op.

### Input JSON

```json
{"scryfallId":"uuid"}
```

### Output JSON

```json
{
  "data": {
    "id": 123,
    "scryfallId": "uuid",
    "oracleId": "uuid",
    "name": "Eternal Witness",
    "manaCost": "{1}{G}{G}",
    "typeLine": "Creature — Human Shaman",
    "setCode": "m3c",
    "collectorNumber": "226",
    "rarity": "uncommon",
    "usage": {"owned":0,"needed":0,"free":0,"shortage":0,"wanted":0,"assumedAvailable":false,"decks":[]}
  }
}
```

## `PATCH /api/write/cards/:id/metadata`

Stelt Oracle-brede handmatige correcties voor mana-productie en library-search in. Gebruik mode `automatic` om een override te verwijderen.

### Input JSON

```json
{
  "manaMode": "manual",
  "manaProduction": [{"mana":"G","amount":1,"variable":false}],
  "manaProductionNote": "Tapt voor groen",
  "searchMode": "manual",
  "librarySearchTargets": ["creature"],
  "librarySearchNote": "Zoekt alleen een Elf"
}
```

### Output JSON

```json
{
  "data": {
    "id": 123,
    "name": "Elvish Mystic",
    "insights": {
      "manaProduction": {"source":"manual","entries":[{"mana":"G","amount":1,"variable":false}],"note":"Tapt voor groen"},
      "librarySearch": {"source":"manual","targets":["creature"],"note":"Zoekt alleen een Elf"}
    }
  }
}
```

## `POST /api/write/cards/:id/refresh`

Vernieuwt één lokale printing geforceerd vanuit Scryfall.

### Input JSON

```json
{}
```

### Output JSON

```json
{"data":{"id":123,"scryfallId":"uuid","name":"Eternal Witness","setCode":"m3c","collectorNumber":"226","updatedAt":"2026-09-10 12:00:00","usage":{}}}
```

## `POST /api/write/collection/import.csv`

Importeert fysieke collectie-items uit een CSV-string.

### Input JSON

```json
{"csv":"name,set_code,collector_number,quantity\nEternal Witness,m3c,226,1\n"}
```

### Output JSON

```json
{
  "data": {
    "importedCount": 1,
    "imported": [{"id":55,"quantity":1,"card":{"id":123,"name":"Eternal Witness"}}],
    "failed": [],
    "notFound": []
  }
}
```

## `POST /api/write/collection`

Voegt een fysieke kaart toe. Voor de interfaceactie Collectie + Deck is `/api/write/collection/with-deck` het voorkeursendpoint; `deckId` blijft hier ondersteund voor API-compatibiliteit. Voeg één kaartidentificatie toe.

### Input JSON

```json
{
  "scryfallId": "uuid",
  "quantity": 1,
  "finish": "nonfoil",
  "language": "en",
  "condition": "near_mint",
  "location": "Map 1",
  "notes": "",
  "purchasePrice": 0.5,
  "reconcileWanted": true,
  "sourceWantedId": 31,
  "deckId": 4,
  "deckQuantity": 1,
  "role": "main",
  "tags": ["Ramp"],
  "note": "Decknotitie"
}
```

### Output JSON

Zonder `deckId`:

```json
{
  "data": {
    "id": 55,
    "quantity": 1,
    "finish": "nonfoil",
    "language": "en",
    "condition": "near_mint",
    "location": "Map 1",
    "purchasePrice": 0.5,
    "card": {"id":123,"name":"Eternal Witness"},
    "deckPrintingAlignment": {"updatedDeckCards":1,"deckIds":[4],"decks":[{"id":4,"name":"Yedora"}]}
  }
}
```

Met `deckId`:

```json
{
  "data": {
    "collectionItem": {"id":55,"quantity":1,"card":{"id":123,"name":"Eternal Witness"}},
    "deckCard": {"id":81,"quantity":1,"role":"main","tags":["Ramp"],"card":{"id":123,"name":"Eternal Witness"}}
  }
}
```

## `POST /api/write/collection/with-deck`

Voegt één concrete printing binnen dezelfde transactie toe aan de fysieke collectie en een deck. `deckId` en de deckvelden zijn verplicht.

### Input JSON

```json
{
  "scryfallId": "uuid",
  "quantity": 1,
  "finish": "nonfoil",
  "language": "en",
  "condition": "near_mint",
  "location": "Map 1",
  "notes": "",
  "purchasePrice": 0.5,
  "reconcileWanted": true,
  "deckId": 4,
  "deckQuantity": 1,
  "role": "main",
  "tags": ["Ramp"],
  "note": "Decknotitie"
}
```

### Output JSON

```json
{
  "data": {
    "collectionItem": {
      "id": 55,
      "quantity": 1,
      "finish": "nonfoil",
      "language": "en",
      "condition": "near_mint",
      "location": "Map 1",
      "purchasePrice": 0.5,
      "card": {"id":123,"name":"Eternal Witness"}
    },
    "deckCard": {
      "id": 81,
      "quantity": 1,
      "role": "main",
      "note": "Decknotitie",
      "tags": ["Ramp"],
      "card": {"id":123,"name":"Eternal Witness"}
    }
  }
}
```

## `PATCH /api/write/collection/:id`

Wijzigt een fysieke collectieregel. Niet opgegeven velden blijven gelijk; `quantity=0` verwijdert de regel volgens de servicelogica.

### Input JSON

```json
{"quantity":2,"finish":"foil","language":"en","condition":"excellent","location":"Map 2","notes":"","purchasePrice":1.25}
```

### Output JSON

```json
{"data":{"id":55,"quantity":2,"finish":"foil","language":"en","condition":"excellent","location":"Map 2","notes":"","purchasePrice":1.25,"card":{"id":123,"name":"Eternal Witness"}}}
```

Bij `quantity: 0`:

```json
{"data":null}
```

## `DELETE /api/write/collection/:id`

Verwijdert één fysieke collectieregel.

### Input JSON

```json
{}
```

### Output JSON

```json
{"data":{"id":55,"quantity":2,"finish":"nonfoil","card":{"id":123,"name":"Eternal Witness"}}}
```

## `POST /api/write/decks`

Maakt een deck aan. Formaat: `commander`, `standard`, `pioneer`, `modern`, `legacy`, `vintage`, `pauper`, `oathbreaker`, `brawl` of `other`.

### Input JSON

```json
{"name":"Yedora","description":"Mono-green Commander-deck","format":"commander","notes":""}
```

### Output JSON

```json
{"data":{"id":4,"name":"Yedora","description":"Mono-green Commander-deck","format":"commander","notes":"","commanderCardId":null,"secondCommanderCardId":null,"createdAt":"2026-09-10 12:00:00","updatedAt":"2026-09-10 12:00:00"}}
```

## `PATCH /api/write/decks/:id`

Wijzigt naam, beschrijving, formaat en/of notities van een deck.

### Input JSON

```json
{"name":"Yedora aangepast","description":"Nieuwe beschrijving","format":"commander","notes":""}
```

### Output JSON

```json
{"data":{"id":4,"name":"Yedora aangepast","description":"Nieuwe beschrijving","format":"commander","notes":"","updatedAt":"2026-09-10 12:00:00"}}
```

## `DELETE /api/write/decks/:id`

Verwijdert het deck en gekoppelde deckdata; collectiekaarten blijven bestaan.

### Input JSON

```json
{}
```

### Output JSON

```json
{"data":{"id":4,"name":"Yedora","format":"commander"}}
```

## `POST /api/write/decks/:id/duplicate`

Dupliceert deck, kaarten, tags en combo-/synergiegroepen. `name` is optioneel.

### Input JSON

```json
{"name":"Yedora (kopie)"}
```

### Output JSON

```json
{"data":{"id":5,"name":"Yedora (kopie)","format":"commander","totalCards":100,"uniqueCards":80}}
```

## `POST /api/write/decks/:id/cards`

Voegt een kaart toe aan een deck. Voeg één kaartidentificatie toe. Rollen: `commander`, `partner`, `companion`, `main`, `sideboard`, `maybeboard`.

### Input JSON

```json
{"scryfallId":"uuid","quantity":1,"role":"main","note":"","tags":["Ramp","Sacrifice"]}
```

### Output JSON

```json
{
  "data": {
    "id": 77,
    "quantity": 1,
    "role": "main",
    "note": "",
    "tags": ["Ramp","Sacrifice"],
    "coverage": {},
    "card": {"id":123,"name":"Eternal Witness","usage":{},"insights":{}}
  }
}
```

## `PATCH /api/write/decks/:id/cards/:deckCardId`

Wijzigt hoeveelheid, rol, notitie en/of tags van een deckkaart.

### Input JSON

```json
{"quantity":2,"role":"main","note":"Belangrijk combo-onderdeel","tags":["Combo"]}
```

### Output JSON

```json
{"data":{"id":77,"quantity":2,"role":"main","note":"Belangrijk combo-onderdeel","tags":["Combo"],"coverage":{},"card":{"id":123,"name":"Eternal Witness"}}}
```

## `DELETE /api/write/decks/:id/cards/:deckCardId`

Verwijdert een deckkaart en ruimt groepslidmaatschappen op.

### Input JSON

```json
{}
```

### Output JSON

```json
{"data":{"id":77,"quantity":1,"role":"main","card":{"id":123,"name":"Eternal Witness"}}}
```

## `POST /api/write/decks/:id/links`

Maakt een benoemde combo- of synergiegroep. `deckCardIds` bevat minimaal twee unieke kaarten; de volgorde wordt opgeslagen.

### Input JSON

```json
{"name":"Yedora sacrifice-loop","type":"combo","note":"","deckCardIds":[77,82,91]}
```

### Output JSON

```json
{"data":{"id":9,"deckId":4,"name":"Yedora sacrifice-loop","type":"combo","note":"","memberCount":3,"members":[{"deckCardId":77,"position":0},{"deckCardId":82,"position":1},{"deckCardId":91,"position":2}]}}
```

## `PATCH /api/write/decks/:id/links/:linkId`

Wijzigt naam, type, notitie en/of ledenvolgorde van een combo-/synergiegroep.

### Input JSON

```json
{"name":"Nieuwe groepsnaam","type":"synergy","note":"Nieuwe uitleg","deckCardIds":[91,77,82]}
```

### Output JSON

```json
{"data":{"id":9,"deckId":4,"name":"Nieuwe groepsnaam","type":"synergy","note":"Nieuwe uitleg","memberCount":3,"members":[{"deckCardId":91,"position":0},{"deckCardId":77,"position":1},{"deckCardId":82,"position":2}]}}
```

## `DELETE /api/write/decks/:id/links/:linkId`

Verwijdert een combo-/synergiegroep; deckkaarten blijven bestaan.

### Input JSON

```json
{}
```

### Output JSON

```json
{"data":{"id":9,"deckId":4,"name":"Yedora sacrifice-loop","type":"combo","members":[]}}
```

## `POST /api/write/decks/:id/missing/to-wanted`

Voegt alle nog niet door Wanted gedekte, niet-basic missende kaarten van het deck toe aan Wanted.

### Input JSON

```json
{}
```

### Output JSON

```json
{"data":{"added":[{"id":31,"quantity":1,"priority":3,"card":{"id":123,"name":"Craterhoof Behemoth"}}],"missing":{"items":[],"summary":{}}}}
```

## `POST /api/write/decks/:id/import`

Importeert een tekstdecklijst. Ondersteunt onder meer `1 Card Name`, `1 Card Name (SET) 123`, `SB:`, `Commander`, `Sideboard` en `Maybeboard`.

### Input JSON

```json
{"text":"Commander\n1 Yedora, Grave Gardener\n\nDeck\n1 Sol Ring\n1 Eternal Witness (M3C) 226\n"}
```

### Output JSON

```json
{"data":{"importedCount":3,"imported":[],"failed":[],"notFound":[]}}
```

## `POST /api/write/wanted`

Voegt een niet-basic kaart toe aan Wanted of verhoogt een bestaand item met dezelfde Oracle-identiteit. Voeg één kaartidentificatie toe.

### Input JSON

```json
{"name":"Craterhoof Behemoth","quantity":1,"priority":2,"maximumPrice":25,"notes":"","printingCardId":null,"deckIds":[4,5]}
```

### Output JSON

```json
{
  "data": {
    "id": 31,
    "quantity": 1,
    "priority": 2,
    "maximumPrice": 25,
    "notes": "",
    "printingSelected": false,
    "printing": null,
    "requestedForDecks": [{"id":4,"name":"Yedora"},{"id":5,"name":"Ander deck"}],
    "card": {"id":123,"name":"Craterhoof Behemoth","usage":{}}
  }
}
```

## `PATCH /api/write/wanted/:id/printing`

Kiest een printing met `printingCardId`, `scryfallId` of set/collectornummer; verwijder met `clear=true`.

### Input JSON

```json
{"printingCardId":123}
```

### Output JSON

```json
{"data":{"id":31,"printingSelected":true,"printing":{"id":123,"scryfallId":"uuid","setCode":"mh1","collectorNumber":"218","rarity":"rare"},"card":{"id":124,"name":"Altar of Dementia"}}}
```

## `PATCH /api/write/wanted/:id`

Wijzigt hoeveelheid, prioriteit, maximumprijs en/of notities.

### Input JSON

```json
{"quantity":2,"priority":1,"maximumPrice":15,"notes":"Zoeken op beurs"}
```

### Output JSON

```json
{"data":{"id":31,"quantity":2,"priority":1,"maximumPrice":15,"notes":"Zoeken op beurs","printingSelected":true,"printing":{},"card":{"id":123,"name":"Altar of Dementia"}}}
```

## `DELETE /api/write/wanted/:id`

Verwijdert een wanted-item en de deckkoppelingen.

### Input JSON

```json
{}
```

### Output JSON

```json
{"data":{"id":31,"quantity":1,"priority":2,"card":{"id":123,"name":"Craterhoof Behemoth"}}}
```

## `POST /api/write/maintenance/refresh-cards`

Vernieuwt meerdere lokale kaarten. `staleDays=0` negeert leeftijd; `limit` is maximaal 5000.

### Input JSON

```json
{"staleDays":30,"limit":500}
```

### Output JSON

```json
{"data":{"requested":25,"refreshed":[{"id":123,"name":"Eternal Witness"}],"failed":[{"id":124,"name":"Kaartnaam","error":"Foutmelding"}]}}
```

## `POST /api/write/maintenance/refresh-card/:id`

Vernieuwt één lokale kaartprinting vanuit Scryfall.

### Input JSON

```json
{}
```

### Output JSON

```json
{"data":{"id":123,"scryfallId":"uuid","name":"Eternal Witness","setCode":"m3c","collectorNumber":"226","updatedAt":"2026-09-10 12:00:00"}}
```

## `POST /api/write/maintenance/external-cache/clear`

Leegt tijdelijke Scryfall-responses en de printingcatalogus; gebruikersdata blijft bestaan.

### Input JSON

```json
{}
```

### Output JSON

```json
{"data":{"removed":15,"printingCatalogRemoved":{"entries":200,"cards":25},"cache":{"entries":0,"freshEntries":0,"staleEntries":0,"payloadBytes":0},"printingCatalog":{"entries":0,"cards":0,"completeCards":0,"incompleteCards":0}}}
```

## `POST /api/write/maintenance/backup`

Maakt een consistente SQLite-back-up en stuurt die direct terug.

### Input JSON

```json
{}
```

### Output JSON

Niet van toepassing. Responsebody is `application/octet-stream` met bestandsnaam `magic-collection-{timestamp}.sqlite`.
