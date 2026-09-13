# Magic Collection Manager AI API 2.3.2

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

Compacte, gepagineerde lijst van unieke kaarten in bezit. Alle filters zijn optioneel.

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

### Filters

| Filter | Betekenis | Geldige waarden |
|---|---|---|
| `q` | Deel van de kaartnaam | Vrije tekst, hoofdletterongevoelig |
| `type` | Hoofdkaarttype | Bijvoorbeeld `Creature`, `Land`, `Artifact`, `Enchantment`, `Instant`, `Sorcery`, `Planeswalker`, `Battle` |
| `subtype` | Exact subtype | Bijvoorbeeld `Elf`, `Druid`, `Forest`, `Equipment` |
| `colors` | Toegestane kleuridentiteit | Kommagescheiden `W,U,B,R,G,C`; `C` is kleurloos. `G,W` staat mono-groen, mono-wit en groen-wit toe |
| `keyword` | Exact Scryfall-keyword | Bijvoorbeeld `Flying`, `Trample`, `Morph`, `Ward` |
| `manaValue` | Mana value | Niet-negatief getal of `7+` |
| `set` | Setcode van een printing in bezit | Bijvoorbeeld `mh3`, `cmm`, `tmp` |
| `rarity` | Rarity | `common`, `uncommon`, `rare`, `mythic`, `special`, `bonus` |
| `availability` | Gebruikssituatie | `all`, `free`, `used`, `shortage`; standaard `all` |
| `deckId` | Alleen kaarten die in dit deck voorkomen | Positief deck-ID |
| `limit` | Maximum aantal resultaten | `1` t/m `100`; standaard `25` wanneer afwezig of leeg |
| `offset` | Startpositie voor paginering | Geheel getal vanaf `0`; standaard `0` |

### Output JSON

```json
{
  "cards": [
    {
      "id": 456,
      "name": "Llanowar Elves",
      "owned": 2,
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
