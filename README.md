# Magic Collection Manager 2.0.3

Magic Collection Manager is een lokale, responsive webapp voor het beheren van een persoonlijke Magic: The Gathering-collectie, wanted-list en decks. De applicatie gebruikt Node.js, Express.js, SQLite en Scryfall en is bedoeld voor één gebruiker zonder ingebouwde authenticatie.

Versie **2.0.0** is de eerste productiebaseline. Versie **2.0.3** bevat de verbeteringen uit 2.0.1 plus enkele mobiele layoutcorrecties. De experimentele Monte Carlo/deckanalyse uit eerdere ontwikkelversies is volledig verwijderd. Ook de historische 1.x-databasemigratieketen maakt geen deel meer uit van de productiecode; een nieuwe installatie initialiseert rechtstreeks het definitieve 2.0-basisschema.

## Belangrijkste mogelijkheden

- Snel lokaal zoeken en direct zien of een kaart in bezit is, hoeveel exemplaren beschikbaar zijn, in welke decks deze voorkomt en of de kaart op Wanted staat.
- Verschillende fysieke printings, talen, condities, locaties en non-foil/foil/etched exemplaren registreren.
- Scryfall-autocomplete, printingselectie en lokaal opgeslagen kaartmetadata.
- Persistente SQLite-cache voor externe Scryfall-resultaten en een lokale schijfcache voor kaartafbeeldingen.
- Decks bouwen met kaarten die wel of niet in de collectie aanwezig zijn.
- Benoemde combo- en synergiegroepen met twee of meer kaarten, toelichting en een instelbare volgorde.
- Deckstatistieken voor mana curve, kleuren, kaarttypes, lands, creatures, handmatige tags, mana-productie, library-searchfuncties en Commander-controles.
- Een vrije drag-and-drop-decksimulator met library, hand, battlefield, graveyard en command zone.
- Wanted-list met prioriteit, rarity, mogelijke printings, gekozen printing, prijsinformatie en deckfilter.
- Basic lands worden niet als ontbrekend beschouwd en komen niet op Wanted.
- Handmatig corrigeerbare kaartkenmerken voor mana-productie en library-searchfuncties.
- CSV-import/-export voor de collectie en tekstimport/-export voor decks.
- Gescheiden REST API-zones voor lezen en schrijven, zodat een reverse proxy `/api/write` tot het LAN kan beperken.
- Automatische alleen-lezeninterface: muterende acties worden grijs en uitgeschakeld wanneer de schrijf-API niet bereikbaar is, zonder storende statusmelding.
- Databaseback-up en onderhoudsfuncties.

## Vereisten

Aanbevolen is Docker met Docker Compose. Zonder Docker is Node.js 24 of nieuwer vereist.

## Starten met Docker

```bash
docker compose up -d --build
```

Open daarna:

```text
http://localhost:3000
```

Permanente gegevens staan standaard in:

```text
data/
```

Daarin staan onder andere de SQLite-database en de lokale afbeeldingscache.

## Starten zonder Docker

```bash
npm install
npm start
```

Open daarna `http://localhost:3000`.

## Eerste productie-installatie

Versie 2.0.0 is bewust een **nieuwe productiebaseline**. De code bevat geen upgradepad voor databases uit ontwikkelversies 1.x.

Voor de schoonste productie-installatie:

1. Bewaar eventuele 1.x-data als aparte back-up.
2. Start de 2.0-productiebasis met een nieuwe lege `data/`-map.
3. Importeer collectiegegevens zo nodig via CSV en decks via de bestaande deckimport.

Een oudere 1.x-database kan technisch tabellen bevatten die op delen van het 2.0-schema lijken, maar dit is geen ondersteund productie-upgradepad. Gebruik voor productie daarom een verse 2.0-database.

## Configuratie

Kopieer indien gewenst `.env.example` naar `.env` wanneer je zonder Docker werkt. Belangrijke variabelen:

```text
PORT=3000
HOST=0.0.0.0
DATA_DIR=./data
DATABASE_FILE=magic-collection.sqlite
SCRYFALL_TIMEOUT_MS=15000
SCRYFALL_REQUEST_DELAY_MS=550
SCRYFALL_AUTOCOMPLETE_CACHE_TTL_HOURS=168
SCRYFALL_PRINTINGS_CACHE_TTL_HOURS=12
SCRYFALL_PRINTING_CATALOG_TTL_HOURS=168
SCRYFALL_CARD_CACHE_TTL_HOURS=168
CACHE_IMAGES=true
```

Ongeldige numerieke waarden voor poort, time-out of request delay vallen veilig terug op de standaardwaarde.

## Lees- en schrijf-API

De API is gescheiden in:

```text
/api/read/*
/api/write/*
```

Alle normale leesacties gebruiken `/api/read`. Mutaties gebruiken `/api/write`. Hierdoor kan een reverse proxy bijvoorbeeld de volledige webapp en lees-API extern beschikbaar maken, terwijl alleen lokale netwerkadressen mogen schrijven.

Een Nginx-voorbeeld staat in:

```text
deploy/nginx-read-write.conf.example
```

Let op: de lees-API bevat persoonlijke collectie-, deck- en wantedgegevens. Als je de applicatie buiten het LAN publiceert, beveilig de toegang daarom zelf met bijvoorbeeld VPN, reverse-proxyauthenticatie en HTTPS.

## Kaartgegevens en caching

Scryfall is de primaire externe bron. De applicatie slaat kaartmetadata lokaal op en gebruikt daarna de lokale database voor normale schermen en zoekacties.

Externe resultaten worden tijdelijk in SQLite gecachet. Kaartafbeeldingen worden standaard lokaal opgeslagen in `data/images/`. Daardoor zijn herhaalde schermweergaven niet afhankelijk van nieuwe Scryfall-aanroepen.

Via **Instellingen en onderhoud** kan de externe responsecache worden geleegd of lokaal opgeslagen kaartmetadata opnieuw met Scryfall worden gesynchroniseerd. Gebruikersgegevens zoals aantallen, decks, wanted-status, notities en aankoopprijzen worden daarbij niet overschreven.

## Collectie

De collectie ondersteunt onder andere filters op:

- naam;
- kleur;
- kaarttype;
- subtype;
- mana value;
- ability/keyword;
- set;
- rarity;
- afwerking;
- deck;
- beschikbaarheid.

Filters reageren direct zonder aparte filterknop en zijn standaard ingeklapt. Met **Filters tonen** kunnen ze worden geopend; de gekozen filters blijven actief. De detailpagina herstelt bij teruggaan de eerdere filters en scrollpositie.

Bij het bewerken van een collectieregel die exact gelijk wordt aan een al bestaande fysieke regel, worden de twee regels automatisch veilig samengevoegd in plaats van een databasefout te geven.

## Decks

Een deck mag kaarten bevatten die nog niet in bezit zijn. Per kaart worden bezit, ontbrekende aantallen en wanted-status berekend.

De deckpagina ondersteunt zoeken, rolfilters en kaarttypefilters. Ook deze filters zijn standaard ingeklapt en kunnen met **Filters tonen** worden geopend. Filters en scrollpositie blijven behouden na bewerken en na terugkeer vanaf kaartdetails of deckstatistieken.

Combo's en synergieën zijn benoemde groepen met minimaal twee kaarten en kunnen uit meer dan twee kaarten bestaan. Binnen een groep kan een volgorde worden aangegeven.

## Deckstatistieken

De aparte statistiekenpagina berekent lokaal onder andere:

- totaal en unieke kaarten;
- mana curve en gemiddelde mana value;
- mana curve per kleur;
- kaarttype- en kleurverdeling;
- basic/non-basic lands;
- creature-statistieken en keywords;
- Commander-waarschuwingen;
- handmatige functietags;
- combo-/synergiegroepstatistieken;
- mana-productie;
- library-searchfuncties;
- ontbrekende kaarten en wanted-status.

Deterministische statistieken worden zonder AI berekend.

## Decksimulator

De simulator is een vrije speeltafel om gevoel te krijgen voor het deck. Kaarten worden als afbeeldingen getoond en kunnen met drag-and-drop tussen library, hand, battlefield, graveyard en command zone worden verplaatst.

De simulator valideert bewust geen Magic-regels of betaalbaarheid. De tijdelijke status blijft alleen in de browsersessie en verandert de database niet.

## Wanted-list

Wanted-items kunnen zonder gekozen printing worden opgeslagen. De Printing-filter toont alle mogelijke printings waarin wanted-kaarten voorkomen, zodat je bijvoorbeeld in een winkel gericht per set kunt zoeken.

De wanted-list gebruikt een standaard ingeklapte filtersectie en ondersteunt filters op onder andere:

- kaartnaam;
- prioriteit;
- deck;
- mogelijke printing;
- rarity;
- kleur.

Heeft een kaart aantoonbaar precies één papieren printing, dan kan deze automatisch worden gekozen. Bij aankoop kan de werkelijk gekochte printing aan de betreffende deckregel worden gekoppeld. Bij het toevoegen van een nieuw wanted-item wordt na de kaartnaam slechts één representatieve printing getoond; de gewenste printing kies je pas later. De knop **Printing** blijft in alleen-lezenmodus beschikbaar om alle uitvoeringen en prijzen te bekijken, terwijl het wijzigen van de keuze uitgeschakeld blijft.

## Database

Een nieuwe 2.0-installatie maakt rechtstreeks `src/db/schema.sql` aan. Er is geen `schema_migrations`-tabel en er zijn geen historische migratiescripts.

Het schema wordt idempotent geïnitialiseerd en gebruikt foreign keys, WAL-mode en een integriteitscontrole op de onderhoudspagina.

Maak regelmatig een back-up via **Instellingen en onderhoud → Databaseback-up downloaden** of door de volledige `data/`-map veilig te kopiëren wanneer de applicatie is gestopt.

## Projectstructuur

```text
server.js
src/
  config.js
  db/
    database.js
    schema.sql
  lib/
  routes/
  services/
public/
  index.html
  styles.css
  js/
    views/
scripts/
deploy/
data/
```

## Controle van de broncode

Voor een snelle syntaxcontrole:

```bash
npm run check
```

De applicatie bevat bewust geen automatische unit-, integratie- of end-to-endtests, conform de projectspecificatie.


## Read-only kaart toevoegen

Ook wanneer `/api/write` door de reverse proxy is geblokkeerd, blijven de globale zoekactie en de printinglijst onder **Kaart toevoegen** bruikbaar. Een printing kan worden bekeken en de kaartdetailpagina kan worden geopend. De invoervelden en knoppen waarmee collectie-, deck- of wantedgegevens worden gewijzigd, worden in read-only mode verborgen.
