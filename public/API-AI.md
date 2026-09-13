# Magic Collection Manager AI API 2.3.1

Base: `https://<host>/api/ai`  
Alle endpoints zijn `GET` en read-only.

## `GET /api/ai/decks`

Compact overzicht van alle decks.

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
      "cards": 100
    }
  ]
}
```

## `GET /api/ai/decks/:id/cards`

Kaarten in één deck. Gebruik `cardId` voor een gericht kaartdetailverzoek.

### Input JSON

```json
{"path":{"id":7}}
```

### Output JSON

```json
{
  "deck": {
    "id": 7,
    "name": "Yedora",
    "format": "commander",
    "cards": 100
  },
  "cards": [
    {
      "cardId": 123,
      "name": "Sakura-Tribe Elder",
      "qty": 1,
      "role": "main"
    }
  ]
}
```

## `GET /api/ai/cards/:id`

Minimale functionele kaartinformatie.

### Input JSON

```json
{"path":{"id":123}}
```

### Output JSON

```json
{
  "card": {
    "id": 123,
    "name": "Sakura-Tribe Elder",
    "manaCost": "{1}{G}",
    "manaValue": 2,
    "type": "Creature — Snake Shaman",
    "text": "Sacrifice Sakura-Tribe Elder: Search your library for a basic land card...",
    "keywords": [],
    "power": "1",
    "toughness": "1"
  }
}
```

## `GET /api/ai/collection?q=&type=&subtype=&colors=&keyword=&manaValue=&set=&rarity=&availability=&deckId=&limit=&offset=`

Compacte, gepagineerde lijst van unieke kaarten in bezit. Standaard `limit=25`, maximaal `100`.

Filters: `q`, `type`, `subtype`, `colors`, `keyword`, `manaValue`, `set`, `rarity`, `availability`, `deckId`, `limit`, `offset`.

### Input JSON

```json
{
  "query": {
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
      "type": "Creature — Elf Druid"
    }
  ],
  "page": {
    "total": 60,
    "limit": 25,
    "offset": 0,
    "nextOffset": 25
  }
}
```

## Fout

```json
{"error":{"message":"..."}}
```
