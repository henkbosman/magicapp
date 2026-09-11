# Magic Collection Manager Read API 2.1.1

Base URL: `https://<host>`  
Alle routes gebruiken `GET` en hebben geen JSON-body. Querywaarden staan in de URL.  
Foutformaat: `{"error":{"message":"...","details":null}}`.

## `GET /api/read/health`

Controleert of de read-API bereikbaar is.

### Input JSON

```json
{}
```

### Output JSON

```json
{"status":"ok","version":"2.1.1"}
```

## `GET /api/read/dashboard`

Geeft dashboardtotalen en recent toegevoegde collectie-items.

### Input JSON

```json
{}
```

### Output JSON

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
      {"id":55,"quantity":1,"finish":"nonfoil","createdAt":"2026-09-10 12:00:00","card":{"id":123,"name":"Eternal Witness"}}
    ]
  }
}
```

## `GET /api/read/cards/search?q={name}&limit={1..50}`

Doorzoekt lokale kaarten en groepeert verschillende printings per Oracle-kaart.

### Input JSON

```json
{}
```

### Output JSON

```json
{
  "data": [
    {
      "id": 123,
      "scryfallId": "uuid",
      "oracleId": "uuid",
      "cardKey": "uuid",
      "name": "Eternal Witness",
      "manaCost": "{1}{G}{G}",
      "manaValue": 3,
      "colorIdentity": ["G"],
      "typeLine": "Creature — Human Shaman",
      "cardTypes": ["Creature"],
      "oracleText": "...",
      "setCode": "m3c",
      "collectorNumber": "226",
      "rarity": "uncommon",
      "images": {"small":"https://...","normal":"https://...","large":"https://...","backNormal":null},
      "usage": {"owned":2,"needed":1,"free":1,"shortage":0,"wanted":0,"assumedAvailable":false,"decks":[]},
      "insights": {"manaProduction":{"entries":[]},"librarySearch":{"targets":[]}}
    }
  ]
}
```

## `GET /api/read/cards/autocomplete?q={at-least-2-characters}`

Combineert lokale kaartnamen met gecachte of actuele Scryfall-autocomplete.

### Input JSON

```json
{}
```

### Output JSON

```json
{"data":["Eternal Witness","Eternal Scourge"],"offline":false,"warning":null}
```

## `GET /api/read/cards/printings?name={card-name}`

Geeft alle papieren printings, gegroepeerd per setcode en collectornummer.

### Input JSON

```json
{}
```

### Output JSON

```json
{
  "data": [
    {
      "printingKey": "mh1|218",
      "cardId": 123,
      "scryfallId": "uuid",
      "oracleId": "uuid",
      "name": "Altar of Dementia",
      "setName": "Modern Horizons",
      "setCode": "mh1",
      "collectorNumber": "218",
      "rarity": "rare",
      "releasedAt": "2019-06-14",
      "languages": ["en","ja"],
      "finishes": ["nonfoil","foil"],
      "variants": [{"language":"en","scryfallId":"uuid","cardId":123,"finishes":["nonfoil","foil"],"image":"https://...","imageNormal":"https://...","cached":true}],
      "prices": {"eur":"7.00","eur_foil":"12.00"},
      "image": "https://...",
      "imageNormal": "https://..."
    }
  ],
  "offline": false,
  "complete": true,
  "stale": false,
  "warning": null
}
```

## `GET /api/read/cards/image-cache?url={encoded-scryfall-image-url}`

Levert een toegestane Scryfall-afbeelding via de lokale afbeeldingscache.

### Input JSON

```json
{}
```

### Output JSON

Niet van toepassing. Responsebody is `image/jpeg`, `image/png` of `image/webp`.

## `GET /api/read/cards/preview/:scryfallId`

Geeft een read-only kaartpreview; ontbrekende technische Scryfall-metadata mag lokaal worden gecachet.

### Input JSON

```json
{}
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
    "oracleText": "...",
    "setCode": "m3c",
    "collectorNumber": "226",
    "rarity": "uncommon",
    "images": {"normal":"https://...","large":"https://..."},
    "usage": {"owned":0,"needed":0,"free":0,"shortage":0,"wanted":0,"assumedAvailable":false,"decks":[]}
  }
}
```

## `GET /api/read/cards/:id/image?face={front|back}&size={small|normal|large|png}`

Levert een afbeelding van een lokale kaart. Standaard: `face=front`, `size=normal`.

### Input JSON

```json
{}
```

### Output JSON

Niet van toepassing. Responsebody is een kaartafbeelding.

## `GET /api/read/cards/:id`

Geeft één lokale kaart met gebruiks- en kenmerkeninformatie.

### Input JSON

```json
{}
```

### Output JSON

```json
{
  "data": {
    "id": 123,
    "scryfallId": "uuid",
    "oracleId": "uuid",
    "cardKey": "uuid",
    "name": "Eternal Witness",
    "manaCost": "{1}{G}{G}",
    "manaValue": 3,
    "colors": ["G"],
    "colorIdentity": ["G"],
    "typeLine": "Creature — Human Shaman",
    "cardTypes": ["Creature"],
    "subtypes": ["Human","Shaman"],
    "oracleText": "...",
    "keywords": [],
    "setName": "Modern Horizons 3 Commander",
    "setCode": "m3c",
    "collectorNumber": "226",
    "rarity": "uncommon",
    "language": "en",
    "images": {"small":"https://...","normal":"https://...","large":"https://...","backNormal":null},
    "finishes": ["nonfoil","foil"],
    "prices": {"eur":"0.20","eur_foil":"0.35"},
    "usage": {"owned":2,"needed":1,"free":1,"shortage":0,"wanted":0,"assumedAvailable":false,"decks":[]},
    "insights": {"manaProduction":{"source":"oracle","entries":[]},"librarySearch":{"source":"none","targets":[]}}
  }
}
```

## `GET /api/read/collection/options`

Geeft lokaal beschikbare sets, abilities en decks voor collectiefilters.

### Input JSON

```json
{}
```

### Output JSON

```json
{
  "data": {
    "sets": [{"code":"mh1","name":"Modern Horizons","quantity":4}],
    "abilities": [{"name":"Trample","cardCount":12}],
    "decks": [{"id":4,"name":"Yedora"}]
  }
}
```

## `GET /api/read/collection/export.csv`

Exporteert alle fysieke collectieregels als CSV.

### Input JSON

```json
{}
```

### Output JSON

Niet van toepassing. Responsebody is `text/csv` met kolommen `name,set_code,set_name,collector_number,quantity,finish,language,condition,location,notes,purchase_price,scryfall_id`.

## `GET /api/read/collection?q={text}&cardKey={key}&type={type}&color={W|U|B|R|G|M|C}&subtype={subtype}&manaValue={0..6|7+}&ability={keyword}&commanderLegal={legal|not_legal}&set={code}&rarity={rarity}&finish={nonfoil|foil|etched}&deckId={id}&availability={free|used|shortage}&limit={1..1000}&offset={integer}`

Geeft gefilterde, gepagineerde collectieregels. Alle queryparameters zijn optioneel.

### Input JSON

```json
{}
```

### Output JSON

```json
{
  "data": {
    "items": [
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
        "card": {"id":123,"name":"Eternal Witness","setCode":"m3c","collectorNumber":"226","usage":{},"insights":{}}
      }
    ],
    "total": 1,
    "limit": 200,
    "offset": 0
  }
}
```

## `GET /api/read/collection/card/:cardId`

Geeft een kaartconcept en alle fysieke collectie-items met dezelfde Oracle-identiteit.

### Input JSON

```json
{}
```

### Output JSON

```json
{
  "data": {
    "card": {"id":123,"cardKey":"uuid","name":"Eternal Witness","usage":{},"insights":{}},
    "items": [{"id":55,"quantity":2,"finish":"nonfoil","language":"en","condition":"near_mint","card":{"id":123,"name":"Eternal Witness"}}]
  }
}
```

## `GET /api/read/collection/:id`

Geeft één fysieke collectieregel.

### Input JSON

```json
{}
```

### Output JSON

```json
{
  "data": {
    "id": 55,
    "quantity": 2,
    "finish": "nonfoil",
    "language": "en",
    "condition": "near_mint",
    "location": "Map 1",
    "notes": "",
    "purchasePrice": 0.5,
    "card": {"id":123,"name":"Eternal Witness","setCode":"m3c","collectorNumber":"226","usage":{},"insights":{}}
  }
}
```

## `GET /api/read/decks`

Geeft alle decks met aantallen en missende kaarten.

### Input JSON

```json
{}
```

### Output JSON

```json
{
  "data": [
    {
      "id": 4,
      "name": "Yedora",
      "description": "",
      "format": "commander",
      "commanderCardId": 10,
      "secondCommanderCardId": null,
      "notes": "",
      "totalCards": 100,
      "uniqueCards": 80,
      "missingQuantity": 8,
      "missingUnique": 6,
      "globalShortage": 10,
      "commander": {"id":10,"name":"Yedora, Grave Gardener"},
      "secondCommander": null
    }
  ]
}
```

## `GET /api/read/decks/:id`

Geeft één deck met commanderobjecten en tellingen.

### Input JSON

```json
{}
```

### Output JSON

```json
{
  "data": {
    "id": 4,
    "name": "Yedora",
    "description": "",
    "format": "commander",
    "commanderCardId": 10,
    "secondCommanderCardId": null,
    "notes": "",
    "totalCards": 100,
    "uniqueCards": 80,
    "commander": {"id":10,"name":"Yedora, Grave Gardener"},
    "secondCommander": null,
    "createdAt": "2026-09-10 12:00:00",
    "updatedAt": "2026-09-10 12:00:00"
  }
}
```

## `GET /api/read/decks/:id/cards`

Geeft alle kaartregels van een deck, inclusief maybeboard.

### Input JSON

```json
{}
```

### Output JSON

```json
{
  "data": [
    {
      "id": 77,
      "quantity": 1,
      "role": "main",
      "note": "",
      "tags": ["Ramp"],
      "relations": [],
      "coverage": {"physicallyOwned":1,"assumedBasicLand":0,"assumedAvailable":false,"directlyOwned":1,"missingFromCollection":0,"globalShortage":0,"wantedGap":0,"sharedConflict":false,"onWanted":0},
      "card": {"id":123,"name":"Eternal Witness","usage":{},"insights":{}}
    }
  ]
}
```

## `GET /api/read/decks/:id/links`

Geeft benoemde combo- en synergiegroepen van een deck.

### Input JSON

```json
{}
```

### Output JSON

```json
{
  "data": [
    {
      "id": 9,
      "deckId": 4,
      "name": "Yedora sacrifice-loop",
      "type": "combo",
      "note": "",
      "memberCount": 3,
      "members": [{"deckCardId":77,"cardId":10,"name":"Yedora, Grave Gardener","quantity":1,"role":"commander","position":0}],
      "createdAt": "2026-09-10 12:00:00",
      "updatedAt": "2026-09-10 12:00:00"
    }
  ]
}
```

## `GET /api/read/decks/:id/stats?excludeLands={true|false}`

Geeft lokaal berekende deckstatistieken. `excludeLands` is standaard `true`.

### Input JSON

```json
{}
```

### Output JSON

```json
{
  "data": {
    "deck": {"id":4,"name":"Yedora"},
    "totals": {"cards":100,"uniqueCards":80,"legendary":5,"permanents":78,"nonPermanents":22},
    "types": {"Creature":31,"Land":37},
    "manaCurve": {"0":1,"1":8,"2":15,"3":17,"4":10,"5":6,"6":3,"7+":3},
    "manaCurveByColor": {"W":{},"U":{},"B":{},"R":{},"G":{},"C":{},"M":{}},
    "manaValue": {"averageExcludingLands":3.2,"averageIncludingLands":2.01,"selectedAverage":3.2,"excludeLandsFromAverage":true},
    "colors": {},
    "colorIdentity": {},
    "manaSymbols": {},
    "lands": {"total":37,"basic":29,"nonBasic":8,"ratio":37,"produces":{}},
    "functions": {"manaProducerCardLines":12,"manaProducerQuantity":12,"variableManaProducers":1,"manaByType":{},"manaProducers":[],"librarySearchCardLines":8,"librarySearchQuantity":8,"librarySearchByTarget":{},"librarySearchCards":[]},
    "creatures": {"total":31,"averagePower":2.8,"averageToughness":3.1,"legendary":4,"manaCurve":{},"topSubtypes":[],"keywords":{}},
    "tags": {},
    "coverage": {"total":100,"eligibleCards":63,"ownedCards":55,"basicLandsExcluded":37,"physicallyOwned":70,"assumedBasicLands":30,"directlyOwned":85,"missingFromCollection":8,"globalShortage":10,"onWanted":8,"notOnWanted":2,"percentage":87.3,"conflicts":[]},
    "links": {"totalGroups":3,"combos":1,"synergies":2,"linkedCards":8,"unlinkedCards":72,"cardsInMultipleGroups":1,"memberships":9,"averageGroupSize":3,"largestGroupSize":4,"largestGroupName":"Naam","participationPercentage":10,"byType":{},"groupSizes":{},"groups":[]},
    "validation": [{"severity":"warning","code":"...","cardId":123,"message":"..."}]
  }
}
```

## `GET /api/read/decks/:id/missing`

Geeft niet-basic kaarten die in het deck ontbreken en de algemene schaarste over alle decks.

### Input JSON

```json
{}
```

### Output JSON

```json
{
  "data": {
    "items": [
      {"card":{"id":123,"name":"Craterhoof Behemoth"},"quantityInDeck":1,"owned":0,"missingFromCollection":1,"neededAllDecks":2,"globalShortage":2,"wanted":1,"wantedGap":1}
    ],
    "summary": {"totalCards":100,"directlyOwned":92,"physicallyOwned":60,"assumedBasicLands":32,"missingFromCollection":8,"globalShortage":10,"uniqueMissingFromCollection":6,"uniqueShortages":7,"onWanted":8,"notOnWanted":2}
  }
}
```

## `GET /api/read/decks/:id/export.txt?missing={true|false}`

Exporteert het hele deck of alleen missende kaarten als tekst. `missing` is standaard `false`.

### Input JSON

```json
{}
```

### Output JSON

Niet van toepassing. Responsebody is `text/plain`, bijvoorbeeld `1 Sol Ring` per regel.

## `GET /api/read/wanted/options`

Vernieuwt zo nodig printingcatalogi en geeft filteropties.

### Input JSON

```json
{}
```

### Output JSON

```json
{
  "data": {
    "printings": [{"code":"mh1","name":"Modern Horizons","quantity":4,"printingCount":5}],
    "rarities": [{"rarity":"rare","quantity":7}],
    "decks": [{"id":4,"name":"Yedora","quantity":8}],
    "catalogIncomplete": 0,
    "catalogFailures": []
  }
}
```

## `GET /api/read/wanted/export.csv`

Exporteert de wanted-list als CSV.

### Input JSON

```json
{}
```

### Output JSON

Niet van toepassing. Responsebody is `text/csv` met kolommen `name,set_code,set_name,collector_number,quantity,priority,maximum_price,notes,scryfall_id`.

## `GET /api/read/wanted?q={text}&priority={1..5}&deckId={id}&printing={set-code}&rarity={rarity}&color={color}&sort={priority|name|price|quantity|printing|newest}`

Geeft lokaal opgeslagen wanted-items. Alle queryparameters zijn optioneel.

### Input JSON

```json
{}
```

### Output JSON

```json
{
  "data": [
    {
      "id": 31,
      "quantity": 1,
      "priority": 2,
      "maximumPrice": 8.5,
      "notes": "",
      "printingSelected": true,
      "printing": {"id":123,"setCode":"mh1","collectorNumber":"218","rarity":"rare"},
      "printingCatalog": {"printingCount":5,"sets":[],"rarities":[],"rarityPrintings":{}},
      "requestedForDecks": [{"id":4,"name":"Yedora"}],
      "card": {"id":123,"name":"Altar of Dementia","usage":{}}
    }
  ]
}
```

## `GET /api/read/maintenance/status`

Geeft technische status van database, caches en lokale installatie.

### Input JSON

```json
{}
```

### Output JSON

```json
{
  "data": {
    "applicationVersion": "2.1.1",
    "nodeVersion": "v24.0.0",
    "databaseFile": "magic-collection.sqlite",
    "databaseSizeBytes": 1048576,
    "imageCacheEnabled": true,
    "cachedImages": 120,
    "externalApiCache": {"entries":15,"freshEntries":12,"staleEntries":3,"payloadBytes":123456},
    "printingCatalog": {"entries":200,"cards":25,"completeCards":23,"incompleteCards":2},
    "databaseIntegrity": "ok",
    "foreignKeyIssues": 0,
    "schemaVersion": 20000,
    "counts": {"cards":250,"collectionItems":190,"decks":3,"wantedItems":18}
  }
}
```
