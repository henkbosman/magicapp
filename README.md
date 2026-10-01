# Magic Collection Manager 2.10.2

Magic Collection Manager is een lokale, responsive webapp voor het beheren van een persoonlijke Magic: The Gathering-collectie, wanted-list en decks. De applicatie gebruikt Node.js, Express.js, SQLite en Scryfall en is bedoeld voor één gebruiker zonder ingebouwde authenticatie.

Versie **2.0.0** is de eerste productiebaseline. Versie **2.10.2** toont kaartnamen in de collectie- en decklijst weer als gewone, niet-interactieve tekst; de kaartafbeelding blijft de ingang voor de grotere preview. Generieke en numerieke manasymbolen sluiten in kaarttekst verticaal aan op de andere manasymbolen. In de visuele kaartenweergave van een deck staat de keuze voor het aantal kaarten per rij direct naast **Filters tonen**. Deze patch wijzigt geen API-endpoints en geen databaseschema. De rechts uitgelijnde manakosten en verborgen functionele collectiebadges uit 2.10.1, de vernieuwde kaartlijsten en snelle printingkeuze uit 2.10, de gebundelde decklijstacties en tutorfilters uit 2.9, de instelbare kaartweergave uit 2.8, de kaartpreviews, gegroepeerde deckweergave en mana-producerfilter uit 2.7 en de gecontroleerde kaartenlijstimport en mana- en tapsymbolen uit 2.6 blijven onderdeel van deze release. De experimentele Monte Carlo/deckanalyse uit eerdere ontwikkelversies en de historische 1.x-databasemigratieketen maken geen deel uit van de productiecode; een nieuwe installatie initialiseert rechtstreeks het definitieve 2.0-basisschema.

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
- CSV-export voor de collectie, gecontroleerde tekstimport voor meerdere fysieke kaarten en tekstimport/-export voor decks.
- Gescheiden REST API-zones voor lezen en schrijven, zodat een reverse proxy `/api/write` tot het LAN kan beperken.
- Automatische alleen-lezeninterface: muterende acties worden grijs en uitgeschakeld wanneer de schrijf-API niet bereikbaar is, zonder storende statusmelding.
- Databaseback-up en onderhoudsfuncties.
- Compacte statische API-documentatie via `/API-READ.txt`, `/API-WRITE.txt` en de kale HTML-pagina `/API-AI.html`.

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
3. Voeg collectiegegevens via de normale kaartinvoer toe en importeer decks desgewenst via de bestaande deckimport.

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
PUBLIC_ORIGIN=
```

Vul `PUBLIC_ORIGIN` in met de volledige oorsprong (bijvoorbeeld `https://cards.example.nl`) wanneer je de app via een domeinnaam of reverse proxy opent. Zonder deze instelling zijn browser-schrijfacties alleen toegestaan via localhost, lokale hostnamen en private LAN-adressen; dit beperkt DNS-rebinding. Een ongeldige waarde stopt de server met een duidelijke configuratiefout. API-clients zonder `Origin`-header blijven bruikbaar.

Ongeldige numerieke waarden voor poort, time-out of request delay vallen veilig terug op de standaardwaarde.

## Lees-, schrijf- en AI-API

De API is gescheiden in:

```text
/api/read/*
/api/write/*
/api/ai/*
```

Alle normale leesacties van de webinterface gebruiken `/api/read`. Mutaties gebruiken `/api/write`. De aparte `/api/ai`-zone bevat vier compacte read-only endpoints voor LLM-tools en wordt niet door de webinterface zelf gebruikt. Hierdoor kan een reverse proxy bijvoorbeeld de volledige webapp en beide leeszones extern beschikbaar maken, terwijl alleen lokale netwerkadressen mogen schrijven.

Een Nginx-voorbeeld staat in:

```text
deploy/nginx-read-write.conf.example
```

De compacte endpointbeschrijvingen staan in:

```text
public/API-READ.txt
public/API-WRITE.txt
public/API-AI.html
docs/API-READ.txt
docs/API-WRITE.txt
docs/API-AI.html
```

Tijdens het draaien zijn de documenten bereikbaar via `/API-READ.txt`, `/API-WRITE.txt` en `/API-AI.html`. De onderhoudspagina bevat alle drie links. De LLM-documentatie is een kale HTML-pagina zonder eigen CSS of applicatielayout; de endpointpaden zijn aanklikbare links. Ieder endpoint staat in de volgorde URL, korte uitleg, input-JSON en output-JSON. De AI-API levert alleen compacte overzichten; volledige kaarttekst wordt pas via het afzonderlijke kaartdetailendpoint opgehaald.

Let op: de lees-API bevat persoonlijke collectie-, deck- en wantedgegevens. Als je de applicatie buiten het LAN publiceert, beveilig de toegang daarom zelf met bijvoorbeeld VPN, reverse-proxyauthenticatie en HTTPS.

## Kaartgegevens en caching

Scryfall is de primaire externe bron. De applicatie slaat kaartmetadata lokaal op en gebruikt daarna de lokale database voor normale schermen en zoekacties.

Externe resultaten worden tijdelijk in SQLite gecachet. Kaartafbeeldingen worden standaard lokaal opgeslagen in `data/images/`. Daardoor zijn herhaalde schermweergaven niet afhankelijk van nieuwe Scryfall-aanroepen.

Via **Instellingen en onderhoud** kan de externe responsecache worden geleegd of lokaal opgeslagen kaartmetadata opnieuw met Scryfall worden gesynchroniseerd. Gebruikersgegevens zoals aantallen, decks, wanted-status, notities en aankoopprijzen worden daarbij niet overschreven.

## Kaart opzoeken en toevoegen

Na het kiezen van een kaartnaam worden alle papieren printings getoond en wordt automatisch een passende printing geselecteerd en in het invoerpaneel weergegeven. Een eerder gekozen printing wordt waar mogelijk hersteld; anders krijgt een lokaal bekende printing de voorkeur en valt de keuze terug op de eerste passende printing. Een keuzelijst met collectornummers kan de lijst beperken tot één kaartnummer en de automatische keuze daarop afstemmen. De printing blijft handmatig te wijzigen. Het invoerpaneel toont uitsluitend de beschikbare EUR-prijzen van de geselecteerde printing.

De pagina en de link in het linkermenu heten beide **Kaart opzoeken**. De link blijft altijd beschikbaar, ook wanneer de write-API is uitgeschakeld. Alleen de acties die gegevens wijzigen worden dan verborgen of geblokkeerd.

Het opmerkingenveld is uit deze snelle invoer verwijderd. Aantal, taal, afwerking, conditie, locatie, aankoopprijs en de wanted-afstemming blijven staan nadat een actie is uitgevoerd. Na een geslaagde actie worden de drie actieknoppen geblokkeerd om dubbel toevoegen te voorkomen; een nieuwe printingselectie activeert ze weer.

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
- mana produceren;
- Tutor land;
- Tutor creature;
- set;
- rarity;
- afwerking;
- deck;
- beschikbaarheid.

Filters reageren direct zonder aparte filterknop en zijn standaard ingeklapt. Met **Filters tonen** kunnen ze worden geopend; met **Filters resetten** worden alle collectiecriteria in één keer gewist. Kleuridentiteit gebruikt compacte, aanklikbare manasymbolen. Een geselecteerd symbool krijgt een dikke rand. De zevende knop wisselt tussen **AND** en **OR**. AND vereist exact de gekozen identiteit; OR toont kaarten die minimaal één gekozen kleur gebruiken. Kleurloos is in OR-modus een afzonderlijk alternatief. De detailpagina herstelt bij teruggaan de eerdere filters en scrollpositie.

De collectielijst gebruikt dezelfde leesbare opbouw als de decklijst: een grotere kaartafbeelding, naam en manakosten, printingmetadata, rarity, prijs, aantal en afwerking, gevolgd door de kaarttekst met gerenderde symbolen. Binnen `.card-list-content` krijgt de kaartnaam flexibel de resterende ruimte en staan de manakosten rechts uitgelijnd, zodat langere namen minder snel afbreken. De kaartnaam is gewone tekst; een klik op de kaartafbeelding opent eerst de grote preview en via **Details** daarna de volledige kaartpagina. De functionele badges **Produceert** en **Zoekt** worden niet in de collectieregels getoond; de gegevens blijven beschikbaar via **Kenmerken** en de collectie blijft erop filterbaar. **Naar deck**, **Bewerken**, **Kenmerken** en **Verwijderen** staan samen in één compact **Acties**-menu.

De synthetische abilityfilters **Tutor land** en **Tutor creature** verschijnen alleen wanneer de collectie daadwerkelijk een passende kaart bevat. Ze gebruiken de effectieve library-searchinzichten: automatische herkenning uit de volledige Oracle-tekst en Oracle-brede handmatige correcties. **Tutor land** omvat zowel `land` als `basic_land`; **Tutor creature** omvat `creature`. Algemene tutors (`any`) en overige beperkte zoekdoelen (`other`) worden niet ten onrechte aan een van deze twee specifieke filters toegewezen.

Bij het bewerken van een collectieregel die exact gelijk wordt aan een al bestaande fysieke regel, worden de twee regels automatisch veilig samengevoegd in plaats van een databasefout te geven.

## Decks

Een deck mag kaarten bevatten die nog niet in bezit zijn. Per kaart worden bezit, ontbrekende aantallen en wanted-status berekend.

De deckpagina ondersteunt zoeken, rolfilters en kaarttypefilters. Ook deze filters zijn standaard ingeklapt en kunnen met **Filters tonen** worden geopend. Met **Lijst** en **Kaarten** kan worden gewisseld tussen de beheerlijst en een grote visuele weergave per hoofdkaarttype. Beide weergaven gebruiken dezelfde filters; de kaartweergave, het gekozen aantal kaarten per rij en de filters worden in de URL bewaard. In de kaartweergave kan het raster automatisch schalen of expliciet 1 tot en met 8 kaarten per rij tonen. Op kleinere schermen wordt het aantal responsief begrensd en blijven kaartafbeeldingen volledig zichtbaar zonder aan de zijkanten te worden afgesneden.

In de lijst opent de compacte knop **Acties** één menu met de beschikbare acties **Naar Wanted**, **Bewerken**, **Kenmerken**, **Combo's/synergieën** en **Verwijderen**. Bij samengevoegde basic lands worden alleen acties aangeboden die veilig op de groep kunnen worden uitgevoerd; via het printingoverzicht blijven de afzonderlijke printings beheerbaar. De kaartafbeelding is in deze lijst 92 pixels breed en opent de grote preview; de kaartnaam zelf is gewone tekst. Binnen `.card-list-content` krijgt de naam flexibel de resterende ruimte en staan de manakosten rechts uitgelijnd, zodat lange namen minder snel over twee regels lopen terwijl de mana per rij netjes blijft staan. Daarna staat de kaarttekst met gerenderde symbolen tussen de kaartsamenvatting en **Acties**; kleurloze en generieke/numerieke symbolen sluiten daarin optisch aan op de tekstregel.

In de kaartweergave staan geen zichtbare ellipsis- of actieknoppen op de kaarten. De beschikbare kaartacties blijven bereikbaar via rechtsklikken, de ContextMenu-toets en `Shift+F10`; een normale klik opent eerst de grote preview. Het deckoverzicht toont per deck de kleuridentiteit met dezelfde manasymbolen als het collectiefilter. Commander-thumbnails zijn daar verdubbeld van 52 × 73 naar 104 × 146 pixels. Het venster voor **Kaart toevoegen** gebruikt een brede, hoge kaartkiezer zodat lokale resultaten en printings ook op grotere schermen overzichtelijk blijven. De optie om ontbrekende exemplaren ook aan Wanted toe te voegen staat standaard uit. Filters en scrollpositie blijven behouden na bewerken en na terugkeer vanaf kaartdetails of deckstatistieken. Basic lands met dezelfde kaartnaam en rol worden in de lijst samengevoegd, ook wanneer verschillende printings zijn gebruikt. De aantallen boven de lijst en in de rolfilters tellen echte kaarten in plaats van database-regels.

Combo's en synergieën zijn benoemde groepen met minimaal twee kaarten en kunnen uit meer dan twee kaarten bestaan. Binnen een groep kan een volgorde worden aangegeven. De tekstexport bundelt gelijke Oracle-kaarten over verschillende printings en exporteert bijvoorbeeld één regel `24 Forest` in plaats van meerdere losse Forest-regels.

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
- mana-productie in een eigen vlak, met gelijke Oracle-kaarten en printings samengevoegd;
- library-searchfuncties in een afzonderlijk vlak;
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

Heeft een kaart aantoonbaar precies één papieren printing, dan kan deze automatisch worden gekozen. Bij aankoop kan de werkelijk gekochte printing aan de betreffende deckregel worden gekoppeld. Bij het toevoegen van een nieuw wanted-item opent na het aanklikken van de kaartnaam direct het formulier voor aantal, prioriteit, maximumprijs en opmerkingen; er is geen tussenstap meer waarin eerst één representatieve printing gekozen moet worden. De knop **Printing** blijft in alleen-lezenmodus beschikbaar om alle uitvoeringen en prijzen te bekijken, terwijl het wijzigen van de keuze uitgeschakeld blijft.

In de wanted-lijst opent een klik op de kaartafbeelding of kaartnaam eerst de grote kaartpreview. De knop **Details** opent vervolgens de volledige kaartpagina.

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

De applicatie bevat gerichte regressietests voor kritieke repositorylogica en weergavecontracten. Voer ze uit met `npm test`.


## Read-only kaart opzoeken

Ook wanneer `/api/write` door de reverse proxy is geblokkeerd, blijven de globale zoekactie en de printinglijst onder **Kaart opzoeken** bruikbaar. Een printing kan worden bekeken en de kaartdetailpagina kan worden geopend. De invoervelden en knoppen waarmee collectie-, deck- of wantedgegevens worden gewijzigd, worden in read-only mode verborgen.
