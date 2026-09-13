# Magic Collection Manager AI API 2.3.0

Base: `https://<host>/api/ai`  
Alle endpoints zijn `GET`, read-only en geven compacte JSON. Gebruik `id`/`cardId` voor detailverzoeken.

## `GET /api/ai/decks`

Alle decks, zonder volledige kaartlijsten.

### Input JSON

```json
{}
```

### Output JSON

```json
{
  "decks": [
    {
      "id": 7,
      "name": "Yedora",
      "format": "commander",
      "commander": "Yedora, Grave Gardener",
      "cards": 100,
      "missing": 4,
      "updatedAt": "2026-09-13 10:00:00"
    }
  ]
}
```

## `GET /api/ai/decks/:id/cards`

Alle kaartregels van één deck. Vraag kaarttekst alleen op via `/api/ai/cards/:cardId` wanneer nodig.

### Input JSON

```json
{"path":{"id":7}}
```

### Output JSON

```json
{
  "deck": {"id":7,"name":"Yedora","format":"commander","cards":100},
  "cards": [
    {
      "entryId": 31,
      "cardId": 123,
      "name": "Sakura-Tribe Elder",
      "qty": 1,
      "role": "main",
      "manaCost": "{1}{G}",
      "manaValue": 2,
      "type": "Creature — Snake Shaman",
      "colorIdentity": ["G"],
      "tags": ["Ramp","Sacrifice"],
      "owned": 1,
      "missing": 0
    }
  ]
}
```

## `GET /api/ai/cards/:id`

Detailinformatie van één lokale kaartprinting. Gebruik een `cardId` uit de andere AI-endpoints.

### Input JSON

```json
{"path":{"id":123}}
```

### Output JSON

```json
{
  "card": {
    "id": 123,
    "scryfallId": "uuid",
    "oracleId": "uuid",
    "name": "Sakura-Tribe Elder",
    "manaCost": "{1}{G}",
    "manaValue": 2,
    "type": "Creature — Snake Shaman",
    "text": "Sacrifice Sakura-Tribe Elder: Search your library for a basic land card...",
    "colors": ["G"],
    "colorIdentity": ["G"],
    "keywords": [],
    "power": "1",
    "toughness": "1",
    "producesMana": [],
    "searchesLibraryFor": ["basic_land"],
    "commanderLegality": "legal",
    "printing": {
      "set": "Commander Masters",
      "setCode": "cmm",
      "collectorNumber": "314",
      "rarity": "common",
      "language": "en",
      "finishes": ["nonfoil","foil"],
      "pricesEur": {"nonfoil":"0.15","foil":"0.35"}
    },
    "usage": {
      "owned": 1,
      "used": 1,
      "free": 0,
      "shortage": 0,
      "wanted": 0,
      "decks": [{"id":7,"name":"Yedora","qty":1}]
    },
    "collection": [
      {"cardId":123,"setCode":"cmm","collectorNumber":"314","rarity":"common","qty":1,"finish":"nonfoil","language":"en","condition":"near_mint"}
    ]
  }
}
```

## `GET /api/ai/collection?q=&type=&subtype=&colors=&keyword=&manaValue=&set=&rarity=&availability=&deckId=&limit=&offset=`

Compacte, gepagineerde lijst van unieke kaarten in bezit. Standaard `limit=25`, maximaal `100`. `page.nextOffset` staat alleen in de response wanneer een volgende pagina bestaat.

Filters:

- `q`: deel van kaartnaam
- `type`: exact kaarttype, bijvoorbeeld `Creature`
- `subtype`: exact subtype, bijvoorbeeld `Elf`
- `colors`: toegestane kleuridentiteit, bijvoorbeeld `G` of `G,W`; `C` staat voor kleurloos
- `keyword`: exact keyword, bijvoorbeeld `Trample`
- `manaValue`: exact getal of `7+`
- `set`: setcode
- `rarity`: `common|uncommon|rare|mythic|special|bonus`
- `availability`: `all|free|used|shortage`
- `deckId`: alleen kaarten die in dit deck staan
- `limit`: `1..100`
- `offset`: vanaf `0`

### Input JSON

```json
{
  "query": {
    "q": "elf",
    "type": "Creature",
    "colors": "G",
    "availability": "free",
    "limit": 25,
    "offset": 0
  }
}
```

### Output JSON

```json
{
  "cards": [
    {
      "id": 456,
      "name": "Llanowar Elves",
      "owned": 2,
      "used": 1,
      "free": 1,
      "shortage": 0,
      "wanted": 0,
      "manaCost": "{G}",
      "manaValue": 1,
      "type": "Creature — Elf Druid",
      "colorIdentity": ["G"],
      "printings": 2
    }
  ],
  "page": {"total":60,"limit":25,"offset":0,"nextOffset":25}
}
```

## Fout

```json
{"error":{"message":"..."}}
```
