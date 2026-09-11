# Magic Collection Manager 2.2.2

Magic Collection Manager is een lokale, responsive webapp voor het beheren van een persoonlijke Magic: The Gathering-collectie, wanted-list en decks. De applicatie gebruikt Node.js, Express.js, SQLite en Scryfall en is bedoeld voor één gebruiker zonder ingebouwde authenticatie.

Versie **2.0.0** is de eerste productiebaseline. Versie **2.2.2** maakt de gecombineerde collectie-en-deckactie strikt atomair via het daarvoor bedoelde endpoint en verstuurt meerdere kleuridentiteiten in één eenduidige querywaarde. De experimentele Monte Carlo/deckanalyse uit eerdere ontwikkelversies en de historische 1.x-databasemigratieketen maken geen deel uit van de productiecode; een nieuwe installatie initialiseert rechtstreeks het definitieve 2.0-basisschema.

## Belangrijkste mogelijkheden

- Snel lokaal zoeken en direct zien of een kaart in bezit is, hoeveel exemplaren beschikbaar zijn, in welke decks deze voorkomt en of de kaart op Wanted staat.
- Verschillende fysieke printings, talen, condities, locaties en non-foil/foil/etched exemplaren registreren, met zichtbare Scryfall-prijzen per printing en afwerking.
- Scryfall-autocomplete, printingselectie en lokaal opgeslagen kaartmetadata.
- Persistente SQLite-cache voor externe Scryfall-resultaten en een lokale schijfcache voor kaartafbeeldingen.
- Decks bouwen met kaarten die wel of niet in de collectie aanwezig zijn, inclusief een atomaire actie die één printing tegelijk aan de collectie en een deck toevoegt.
- Benoemde combo- en synergiegroepen met twee of meer kaarten, toelichting en een instelbare volgorde.
- Deckstatistieken voor mana curve, kleuren, kaarttypes, lands, creatures, handmatige tags, mana-productie, library-searchfuncties en Commander-controles.
- Een vrije, niet-persistente drag-and-drop-decksimulator met library, hand, battlefield, graveyard en command zone.
- Wanted-list met prioriteit, rarity, mogelijke printings, gekozen printing, prijsinformatie en deckfilter.
- Basic lands worden niet als ontbrekend beschouwd en komen niet op Wanted.
- Handmatig corrigeerbare kaartkenmerken voor mana-productie en library-searchfuncties.
- CSV-import/-export voor de collectie en tekstimport/-export voor decks.
- Gescheiden REST API-zones voor lezen en schrijven, zodat een reverse proxy `/api/write` tot het LAN kan beperken.
- Automatische alleen-lezeninterface: muterende acties worden grijs en uitgeschakeld wanneer de schrijf-API niet bereikbaar is, zonder storende statusmelding.
- Databaseback-up en onderhoudsfuncties.
- Compacte statische API-documentatie in Markdown via `/API-READ.md` en `/API-WRITE.md`, bedoeld voor scripts en LLM-integraties.

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

### Belangrijk bij handmatige upgrades

Stop en start het Node.js-proces altijd opnieuw nadat applicatiebestanden zijn vervangen. Express laadt backendmodules alleen bij het starten van `node server.js`, terwijl bestanden uit `public/` tijdens een draaiend proces al wel vanaf schijf kunnen worden vernieuwd. Zonder herstart kan daardoor tijdelijk een nieuwe frontend met een oude backend draaien.

Bij een handmatig gestart proces:

```text
Ctrl+C
node server.js
```

Gebruik bij systemd of PM2 de bijbehorende restart-opdracht.

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

De endpointbeschrijvingen staan als compacte pure Markdown in:

```text
public/API-READ.md
public/API-WRITE.md
docs/API-READ.md
docs/API-WRITE.md
```

Tijdens het draaien zijn de documenten bereikbaar via `/API-READ.md` en `/API-WRITE.md`. De onderhoudspagina bevat beide links. Ieder endpoint staat in de volgorde URL, korte uitleg, input-JSON en output-JSON.

Let op: de lees-API bevat persoonlijke collectie-, deck- en wantedgegevens. Als je de applicatie buiten het LAN publiceert, beveilig de toegang daarom zelf met bijvoorbeeld VPN, reverse-proxyauthenticatie en HTTPS.

## Kaartgegevens en caching

Scryfall is de primaire externe bron. De applicatie slaat kaartmetadata lokaal op en gebruikt daarna de lokale database voor normale schermen en zoekacties.

Externe resultaten worden tijdelijk in SQLite gecachet. Kaartafbeeldingen worden standaard lokaal opgeslagen in `data/images/`. Daardoor zijn herhaalde schermweergaven niet afhankelijk van nieuwe Scryfall-aanroepen.

Via **Instellingen en onderhoud** kan de externe responsecache worden geleegd of lokaal opgeslagen kaartmetadata opnieuw met Scryfall worden gesynchroniseerd. Gebruikersgegevens zoals aantallen, decks, wanted-status, notities en aankoopprijzen worden daarbij niet overschreven.

## Kaart toevoegen

Na het kiezen van een kaartnaam worden alle papieren printings getoond. Een keuzelijst met collectornummers kan de lijst beperken tot één kaartnummer. Na selectie springt de pagina naar de invoer en toont zij uitsluitend de beschikbare EUR-prijzen van die printing.

Het opmerkingenveld is uit deze snelle invoer verwijderd. Aantal, taal, afwerking, conditie, locatie, aankoopprijs en de wanted-afstemming blijven staan nadat een actie is uitgevoerd en worden pas opnieuw geïnitialiseerd wanneer een andere printing wordt gekozen.

De drie acties staan naast elkaar:

- **Collectie**: voegt de fysieke printing aan de collectie toe;
- **Wanted**: voegt het Oracle-kaartconcept aan Wanted toe zonder de huidige printing vast te leggen;
- **Collectie + Deck**: voegt de fysieke printing binnen één transactie aan de collectie en aan het gekozen deck toe via `/collection/with-deck`. De actie wordt alleen als geslaagd getoond wanneer de server zowel de collectieregel als de deckregel bevestigt.

Succesmeldingen van dit scherm verschijnen bovenaan. De afbeelding en kaartnaam openen de exact geselecteerde printing op de kaartdetailpagina.

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

Filters reageren direct zonder aparte filterknop en zijn standaard ingeklapt. Met **Filters tonen** kunnen ze worden geopend; met **Filters resetten** worden alle collectiecriteria in één keer gewist. Kleuridentiteit gebruikt compacte, aanklikbare manasymbolen. Een geselecteerd symbool krijgt een dikke rand. Bij alleen groen verschijnen uitsluitend kaarten met exact een groene kleuridentiteit; kaarten met aanvullende kleuren worden uitgesloten. Bij meerdere gekozen kleuren mag de volledige kaartidentiteit uitsluitend uit die geselecteerde kleuren bestaan. Kleurloze kaarten verschijnen alleen wanneer **Kleurloos** is geselecteerd. Iedere collectieregel toont daarnaast de Scryfall-prijs voor de concrete printing en afwerking. De detailpagina herstelt bij teruggaan de eerdere filters en scrollpositie.

Bij het bewerken van een collectieregel die exact gelijk wordt aan een al bestaande fysieke regel, worden de twee regels automatisch veilig samengevoegd in plaats van een databasefout te geven.

## Decks

Een deck mag kaarten bevatten die nog niet in bezit zijn. Per kaart worden bezit, ontbrekende aantallen en wanted-status berekend.

De deckpagina ondersteunt zoeken, rolfilters en kaarttypefilters. Ook deze filters zijn standaard ingeklapt en kunnen met **Filters tonen** worden geopend. Het venster voor **Kaart toevoegen** gebruikt een brede, hoge kaartkiezer zodat lokale resultaten en printings ook op grotere schermen overzichtelijk blijven. Filters en scrollpositie blijven behouden na bewerken en na terugkeer vanaf kaartdetails of deckstatistieken.

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

De simulator valideert bewust geen Magic-regels of betaalbaarheid. De toestand bestaat alleen in het geheugen van de geopende pagina, wordt niet in browseropslag of de database bewaard en begint opnieuw na herladen of opnieuw openen. Alle simulatoracties, inclusief resetten, blijven daardoor beschikbaar in alleen-lezenmodus.

## Wanted-list

Wanted-items kunnen zonder gekozen printing worden opgeslagen. De Printing-filter toont alle mogelijke printings waarin wanted-kaarten voorkomen, zodat je bijvoorbeeld in een winkel gericht per set kunt zoeken.

De wanted-list gebruikt een standaard ingeklapte filtersectie, heeft een knop **Filters resetten** en ondersteunt filters op onder andere:

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
