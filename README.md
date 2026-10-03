# Magic Collection Manager 2.13.2

Magic Collection Manager is een lokale, responsive webapp voor het beheren van een persoonlijke Magic: The Gathering-collectie, wanted-list en decks. De applicatie gebruikt Node.js, Express.js, SQLite en Scryfall en is bedoeld voor één gebruiker zonder ingebouwde authenticatie.

Versie **2.0.0** is de eerste productiebaseline. Versie **2.11.0** voegt de pagina **Kaarten ontdekken** toe voor gericht zoeken tijdens het bouwen van een deck. De zoekcatalogus wordt opgebouwd uit MTGJSON AtomicCards en ondersteunt combineerbare filters voor onder meer kaarttekst, abilities, keywords, kleuridentiteit, kaarttype, mana value, legaliteit, effecten, tokenafmetingen en tutor-doelen. De onderhoudspagina kan deze catalogus op de achtergrond importeren en bijwerken.

Versie **2.11.1** maakt de filters op **Kaarten ontdekken** reactief: beschikbare opties en aantallen bewegen mee met de andere gekozen filters. De bestaande MTGJSON-catalogus blijft direct bruikbaar; opnieuw importeren is niet nodig.

Versie **2.11.2** laat de ontdekpagina leeg starten, markeert de gezochte kaarttekst en voegt kaartafbeeldingen in een popup toe. Kleur, mana en legaliteit staan in een horizontale, standaard ingeklapte sectie. Vanuit **Kaart opzoeken** kun je met **Terug** naar dezelfde zoekopdracht en scrollpositie. Bij één overgebleven naamsuggestie verschijnen de printings automatisch.

Versie **2.11.3** verwijdert de herhaalde filterredenen bij ontdekresultaten en geeft elk kaarttype een eigen kleurmarkering. De afbeeldingspopup herkent een ontbrekend preview-endpoint en legt uit dat ook de backend moet worden bijgewerkt en herstart.

Versie **2.12.0** voegt blijvende markeringen voor interessante kaarten toe, inclusief het filter **Gemarkeerd**. De primaire gebruikersdatabase krijgt hiervoor automatisch een nieuwe tabel; de MTGJSON-database blijft ongewijzigd. De ontdekfilters kunnen per sectie worden ingeklapt en als geheel worden verborgen. Een hoog filterpaneel is zelfstandig scrollbaar en blijft op desktop meteen binnen bereik.

Versie **2.13.0** voegde rechtstreeks toevoegen aan een deck vanuit **Kaarten ontdekken** toe. Versie **2.13.1** toont bij kaarten uit het gekozen deck een duidelijke aanduiding **Al in deck**. Deze kaarten blijven zichtbaar in de resultaten, ook na toevoegen. De deckdropdown heeft geen zichtbaar label erboven en lijnt uit met de dropdown ernaast. Deze update verandert geen databaseschema en vereist geen herimport.

Versie **2.13.2** activeert **Kleur, mana en legaliteit** pas als er een filter in **Tekst en kaartsoort** is ingevuld. Alleen een deck, kleur of managrens kiezen laadt dus geen kaarten. Vooraf gekozen waarden blijven bewaard en worden toegepast zodra je een naam, kaarttekst, ability, keyword, kaarttype of subtype invult.

De MTGJSON-catalogus staat bewust in de volledig zelfstandige SQLite-database `mtgjson-atomic.sqlite`. Markeringen staan vanaf 2.12.0 in `discovery_marks` in de bestaande gebruikersdatabase `magic-collection.sqlite`; bestaande collectie-, wanted- en deckgegevens blijven behouden. Markeringen gebruiken stabiele kaartidentiteiten, geen catalogusrij-ID's of databasepaden. De twee databases worden niet met `ATTACH` of foreign keys gekoppeld. De kaarttekst-, lijst-, deck- en importverbeteringen uit 2.6 tot en met 2.10.4 blijven onderdeel van deze release.

## Belangrijkste mogelijkheden

- Snel lokaal zoeken en direct zien of een kaart in bezit is, hoeveel exemplaren beschikbaar zijn, in welke decks deze voorkomt en of de kaart op Wanted staat.
- Verschillende fysieke printings, talen, condities, locaties en non-foil/foil/etched exemplaren registreren, met zichtbare Scryfall-prijzen per printing en afwerking.
- Scryfall-autocomplete, printingselectie en lokaal opgeslagen kaartmetadata.
- Een aparte ontdekpagina om kaarten op gecombineerde regels, kleuren en effecten te vinden, bijvoorbeeld Landfall-kaarten die een 2/2 creature token maken of groene kaarten met een tutor-effect.
- Interessante kaarten markeren en via **Gemarkeerd** terugvinden, ook na het vervangen van de MTGJSON-catalogus.
- Ontdekte kaarten rechtstreeks aan een deck toevoegen en meteen herkennen welke kaarten al in het gekozen deck zitten.
- Een onderhoudsimport van de officiële MTGJSON AtomicCards-catalogus naar een volledig losse, opnieuw opbouwbare SQLite-database.
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

Daarin staan onder andere de primaire SQLite-database, de optionele losse MTGJSON-catalogus en de lokale afbeeldingscache.

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

De melding **Endpoint niet gevonden.** bij een kaartafbeelding betekent dat de aanvraag niet bij het preview-endpoint uitkomt. Dit endpoint is aanwezig vanaf 2.11.2. Vervang de volledige applicatiecode (inclusief `server.js` en `src/`), behoud je `.env` en `data/`, en herstart de Node.js-/systemd-service. Via `/api/read/health` kun je daarna de actieve serverversie controleren. Blijft het probleem bestaan terwijl de juiste versie draait, controleer dan of de reverse proxy `/api/read/card-catalog/preview` doorstuurt naar dezelfde applicatie. Een ontbrekende kaartafbeelding bij Scryfall geeft een andere melding.

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
CARD_CATALOG_DATABASE_FILE=mtgjson-atomic.sqlite
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

`CARD_CATALOG_DATABASE_FILE` bepaalt uitsluitend het databasebestand van de zelfstandige MTGJSON-zoekcatalogus; de relatieve standaardwaarde staat onder `DATA_DIR`. Het resolved pad mag niet gelijk zijn aan dat van `DATABASE_FILE`; de server weigert dan te starten. De importbron zelf is bewust niet configureerbaar en is vastgezet op de officiële HTTPS-download van MTGJSON.

## Lees-, schrijf- en AI-API

De API is gescheiden in:

```text
/api/read/*
/api/write/*
/api/ai/*
```

Alle normale leesacties van de webinterface gebruiken `/api/read`. Mutaties gebruiken `/api/write`. De aparte `/api/ai`-zone bevat vier compacte read-only endpoints voor LLM-tools en wordt niet door de webinterface zelf gebruikt. Hierdoor kan een reverse proxy bijvoorbeeld de volledige webapp en beide leeszones extern beschikbaar maken, terwijl alleen lokale netwerkadressen mogen schrijven.

De ontdekpagina gebruikt de read-only endpoints onder `/api/read/card-catalog`. Het starten van een AtomicCards-import is een onderhoudsmutatie via `/api/write/maintenance/card-catalog/import`; de aanvraag antwoordt direct, waarna de voortgang via het read-only statusendpoint kan worden gevolgd.

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

## MTGJSON-kaartcatalogus

Via **Instellingen en onderhoud → MTGJSON-kaartcatalogus** kan `AtomicCards.json.gz` van de vaste officiële MTGJSON-bron worden geïmporteerd. De import draait in een afzonderlijke worker, controleert de officiële SHA-256-controlecode, verwerkt het uitgepakte JSON-bestand begrensd en streaming en bouwt eerst een tijdelijke SQLite-database. Pas na een geslaagde integriteitscontrole wordt deze als `mtgjson-atomic.sqlite` geactiveerd. Tijdens een update blijft de vorige catalogus beschikbaar; bij een fout blijft die versie behouden.

De download en verwerking kunnen enige tijd duren en vereisen internettoegang en voldoende vrije schijfruimte. De onderhoudspagina toont download- en verwerkingsvoortgang. Per proces kan maar één catalogusimport tegelijk actief zijn. Een serverstop breekt een lopende import af en ruimt tijdelijke bestanden op.

Deze catalogus is alleen een opnieuw opbouwbare zoekbron. Zij bevat geen collectie-, deck-, wanted- of markeringsgegevens en heeft geen databasekoppeling met de primaire applicatiedatabase. De bestaande knop **Databaseback-up downloaden** maakt een consistente back-up van `magic-collection.sqlite`, inclusief je markeringen; importeer AtomicCards opnieuw om de zoekcatalogus te herstellen.

## Kaarten ontdekken

De link **Kaarten ontdekken** in het linker- en mobiele menu opent een aparte zoekpagina voor deckbouw. Alle actieve filters worden gecombineerd. Er kan worden gezocht op naam, Oracle-tekst, ability of trigger, keyword, type, subtype, Commander-kleuridentiteit, mana value, legaliteit en een afgeleid kaarteffect. De kleurmodus kan kaarten tonen die binnen de gekozen kleuren passen, alle gekozen kleuren bevatten of exact die kleuridentiteit hebben.

Zonder ingevulde zoekfilters verschijnen nog geen kaarten. Zodra je een inhoudelijk filter invult, worden de resultaten geladen; **Filters resetten** maakt de resultaten weer leeg. Een opgeslagen link met filters herstelt de zoekopdracht direct. De sectie **Kleur, mana en legaliteit** staat horizontaal boven de resultaten en is bij een nieuw bezoek ingeklapt.

De opties in **Kleur, mana en legaliteit**, inclusief de deckkeuze, worden alleen toegepast als minstens één veld in **Tekst en kaartsoort** is ingevuld: **Naam**, **Kaarttekst bevat**, **Ability of trigger**, **Keyword**, **Kaarttype** of **Subtype**. Een waarde met alleen spaties telt niet mee. Je kunt de extra opties vooraf kiezen; ze blijven in het formulier en de terugkeerlink bewaard, maar starten zelf geen zoekopdracht en beperken de reactieve filteropties nog niet. Dit geldt ook voor een opgeslagen link met alleen kleur-, mana-, legaliteits- of deckinstellingen.

Als je het laatste filter in **Tekst en kaartsoort** wist, worden die extra opties weer inactief. Zonder andere zoekfilters verdwijnen de resultaten. **Effect** en **Gemarkeerd** blijven zelfstandig bruikbaar; de extra opties worden daarbij pas toegepast zodra ook **Tekst en kaartsoort** is ingevuld.

**Filters verbergen** verbergt alle filterpanelen, inclusief **Kleur, mana en legaliteit**, zonder actieve filters te wissen. **Tekst en kaartsoort** en **Effect** zijn daarnaast afzonderlijk inklapbaar. Het filterpaneel blijft op desktop bovenaan in beeld zodra je scrollt; als de inhoud hoger is dan de beschikbare schermruimte, kun je binnen het paneel scrollen.

Naast **Kaart opzoeken** staat **Markeren**. Daarmee bewaar je een interessante kaart; met dezelfde knop kun je de markering weer verwijderen. Het filter **Gemarkeerd** toont alleen opgeslagen kaarten en kan met alle andere filters worden gecombineerd. Dit filter start ook zonder andere zoektermen een zoekopdracht. Resetten van filters wist geen markeringen. In alleen-lezenmodus kun je markeringen bekijken en erop filteren; wijzigen vereist toegang tot de schrijf-API.

Markeringen staan blijvend in de primaire gebruikersdatabase, op basis van Oracle-identiteit met een genormaliseerde kaartnaam als terugval. Het vervangen of opnieuw importeren van AtomicCards verwijdert ze niet. Een kaart die tijdelijk ontbreekt in de catalogus verschijnt daar niet als resultaat, maar de opgeslagen markering blijft bestaan.

Naast **Markeren** staat **Naar deck**. Deze knop opent dezelfde toevoegpopup als op de collectiepagina, met deck, aantal, rol, tags en notitie. **Ontbrekende exemplaren ook aan Wanted toevoegen** staat standaard uit. Een kaart hoeft nog niet in je collectie te zitten: bij bevestigen wordt een lokaal bekende printing gebruikt of via Scryfall op exacte naam opgehaald. Voor een specifieke printing kun je eerst **Kaart opzoeken** gebruiken. De actie voegt geen fysieke exemplaren aan je collectie toe.

Bij **Kleur, mana en legaliteit** staat een deckdropdown zonder zichtbaar label erboven. Zodra **Tekst en kaartsoort** is ingevuld, herken je kaarten uit het gekozen deck aan **Al in deck** en een gekleurde rand. Dit omvat alle rollen, inclusief commanders, sideboard en maybeboard. De vergelijking gebruikt Oracle-ID's over verschillende printings heen, met een genormaliseerde naam als terugval wanneer een Oracle-ID ontbreekt. Kaarten blijven zichtbaar: de deckkeuze verandert geen zoekresultaten, aantallen, paginering of reactieve filteropties. Je eigen **Markeren**-keuzes en het filter **Gemarkeerd** blijven hiervan onafhankelijk.

Met **Geen deck geselecteerd** wordt geen deck vergeleken. Zijn er ook geen zoekfilters meer actief, dan keert de pagina terug naar de lege beginstaat. De keuze blijft bij terugnavigatie behouden en wordt met **Filters resetten** gewist. Oudere opgeslagen links met `excludeDeckId` worden als deckkeuze herkend en verbergen geen kaarten meer.

Het gekozen deck staat alvast geselecteerd in de toevoegpopup. Na toevoegen worden de huidige resultaten vernieuwd; de kaart blijft staan en krijgt **Al in deck** wanneer de deckvergelijking actief is en je haar aan het geselecteerde deck hebt toegevoegd. **Naar deck** blijft beschikbaar als je nog een exemplaar wilt toevoegen.

De filteropties zijn reactief. Kies je bijvoorbeeld **Instant**, dan tonen abilities, subtypes, effecten, legaliteit en de overige opties alleen waarden die bij instants en je andere filters passen. Ook naam- en kaarttekstzoeken beperken de keuzelijsten. Beschikbare manawaarden worden als suggesties getoond; je kunt zelf een minimum en maximum blijven invullen.

Elke keuzelijst houdt rekening met de andere filters, maar niet met haar eigen gekozen waarde. Zo blijft een keuze vervangbaar. Aantallen worden over de volledige gefilterde catalogus berekend, niet alleen de zichtbare resultaatpagina. Een al gekozen waarde zonder matches blijft herkenbaar staan met **0 matches**, zodat niets stilzwijgend uit je zoekopdracht verdwijnt. Met de lege optie of **Filters resetten** maak je de zoekopdracht weer ruimer. Bij het wisselen van effect tellen verborgen token- of tutorfilters niet meer mee.

Effectfilters omvatten onder meer Landfall, creature tokens, tutors, mana-productie, kaarten trekken, counters, power/toughness-verhoging, removal, sacrifice en graveyard-interactie. Bij tokens kan ook op power, toughness en tokentype worden gezocht; bij tutors op het gezochte kaarttype. Zo vindt de combinatie **Landfall**, **Token maken**, power **2** en toughness **2** kaarten die 2/2 tokens maken, terwijl **Kaarttekst bevat** met **search**, **groen**, **Library doorzoeken** en eventueel een tutor-doel groene tutor-kaarten vindt. Effecten zijn automatisch afgeleid uit de Engelse AtomicCards-kaarttekst; controleer voor deckgebruik altijd de getoonde Oracle-tekst.

Resultaten tonen de kaartnaam, manakosten, type, Oracle-tekst en kleuridentiteit. De filterredenen worden niet bij elke kaart herhaald. Elk kaarttype heeft een eigen kleurmarkering; bij een **Artifact Creature** worden beide types afzonderlijk gekleurd. Supertypes zoals Legendary en subtypes blijven gewone tekst. De invoer bij **Kaarttekst bevat** wordt letterlijk en zonder hoofdletteronderscheid in de kaarttekst gemarkeerd; mana-iconen en bestaande abilitymarkeringen blijven behouden. Het kleine afbeeldingsicoon links van de kaartnaam opent een popup met een Scryfall-afbeelding. Deze preview voegt niets aan je collectie of primaire database toe en vereist internettoegang wanneer de afbeelding nog niet geladen is.

**Kaart opzoeken** opent de bestaande Scryfall-printingselectie voor die kaart. De knop **Terug** op de opzoekpagina herstelt vervolgens de filters, resultaatpagina en scrollpositie van de ontdekpagina. Zonder geïmporteerde catalogus toont de ontdekpagina een directe verwijzing naar Onderhoud.

## Kaart opzoeken en toevoegen

Na het kiezen van een kaartnaam worden alle papieren printings getoond en wordt automatisch een passende printing geselecteerd en in het invoerpaneel weergegeven. Een eerder gekozen printing wordt waar mogelijk hersteld; anders krijgt een lokaal bekende printing de voorkeur en valt de keuze terug op de eerste passende printing. Een keuzelijst met collectornummers kan de lijst beperken tot één kaartnummer en de automatische keuze daarop afstemmen. De printing blijft handmatig te wijzigen. Het invoerpaneel toont uitsluitend de beschikbare EUR-prijzen van de geselecteerde printing.

Blijft tijdens het typen precies één kaartsuggestie over, dan worden die printings meteen geladen. Bij meerdere suggesties kies je nog zelf een naam. Verder typen blijft mogelijk; verouderde zoekantwoorden kunnen een nieuwere invoer niet overschrijven.

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

De collectielijst gebruikt dezelfde leesbare opbouw als de decklijst: een grotere kaartafbeelding, naam en manakosten, printingmetadata, rarity, prijs, aantal en afwerking, gevolgd door de kaarttekst met gerenderde symbolen. Binnen `.card-list-content` krijgt de kaartnaam flexibel de resterende ruimte en staan de manakosten rechts uitgelijnd, zodat langere namen minder snel afbreken. De kaarttekst en de inline mana- en tapsymbolen hebben een duidelijke, goed leesbare grootte; generieke, numerieke, gekleurde, kleurloze en tapsymbolen delen één consistente verticale basislijn. Alleen de exacte tekst van een herkende abilitynaam of een herkend kaartkeyword krijgt een subtiele markering; de rest van de Oracle-tekst behoudt zijn normale achtergrond. De kaartnaam is gewone tekst; een klik op de kaartafbeelding opent eerst de grote preview en via **Details** daarna de volledige kaartpagina. De functionele badges **Produceert** en **Zoekt** worden niet in de collectieregels getoond; de gegevens blijven beschikbaar via **Kenmerken** en de collectie blijft erop filterbaar. **Naar deck**, **Bewerken**, **Kenmerken** en **Verwijderen** staan samen in één compact **Acties**-menu.

De synthetische abilityfilters **Tutor land** en **Tutor creature** verschijnen alleen wanneer de collectie daadwerkelijk een passende kaart bevat. Ze gebruiken de effectieve library-searchinzichten: automatische herkenning uit de volledige Oracle-tekst en Oracle-brede handmatige correcties. **Tutor land** omvat zowel `land` als `basic_land`; **Tutor creature** omvat `creature`. Algemene tutors (`any`) en overige beperkte zoekdoelen (`other`) worden niet ten onrechte aan een van deze twee specifieke filters toegewezen.

Bij het bewerken van een collectieregel die exact gelijk wordt aan een al bestaande fysieke regel, worden de twee regels automatisch veilig samengevoegd in plaats van een databasefout te geven.

## Decks

Een deck mag kaarten bevatten die nog niet in bezit zijn. Per kaart worden bezit, ontbrekende aantallen en wanted-status berekend.

De deckpagina ondersteunt zoeken, rolfilters en kaarttypefilters. Ook deze filters zijn standaard ingeklapt en kunnen met **Filters tonen** worden geopend. Direct daarnaast staan keuzelijsten voor sorteren op **Mana kosten** of **Naam kaart** en groeperen op **Type** of **Ability**. Standaard wordt op manakosten gesorteerd en op kaarttype gegroepeerd. Bij abilitygroepering bepaalt het primaire herkende kaartkeyword de groep. Heeft een kaart geen keyword, dan worden in vaste volgorde de al aanwezige functionele kaartinzichten voor mana produceren, land zoeken en creature zoeken gebruikt; pas daarna valt de kaart onder **Geen ability**. Elke kaart staat daarbij in precies één groep. Met **Lijst** en **Kaarten** kan worden gewisseld tussen de beheerlijst en een grote visuele weergave. Beide weergaven gebruiken dezelfde filters, sortering en groepering; de kaartweergave, de gekozen sortering en groepering, het gekozen aantal kaarten per rij en de filters worden in de URL bewaard. In de kaartweergave biedt **Kaarten per rij** de expliciete keuzes 1 tot en met 8, met **5** als standaard; de eerdere keuze **Automatisch** is verwijderd. Op kleinere schermen wordt het gekozen aantal responsief begrensd en blijven kaartafbeeldingen volledig zichtbaar zonder aan de zijkanten te worden afgesneden.

In de lijst opent de compacte knop **Acties** één menu met de beschikbare acties **Naar Wanted**, **Bewerken**, **Kenmerken**, **Combo's/synergieën** en **Verwijderen**. Bij samengevoegde basic lands worden alleen acties aangeboden die veilig op de groep kunnen worden uitgevoerd; via het printingoverzicht blijven de afzonderlijke printings beheerbaar. De kaartafbeelding is in deze lijst 92 pixels breed en opent de grote preview; de kaartnaam zelf is gewone tekst. Binnen `.card-list-content` krijgt de naam flexibel de resterende ruimte en staan de manakosten rechts uitgelijnd, zodat lange namen minder snel over twee regels lopen terwijl de mana per rij netjes blijft staan. Daarna staat de kaarttekst met gerenderde symbolen tussen de kaartsamenvatting en **Acties**. Kaarttekst en inline symbolen zijn duidelijk leesbaar; generieke, numerieke, gekleurde, kleurloze en tapsymbolen gebruiken dezelfde verticale basislijn. Alleen de exacte abilitynaam of het herkende keyword wordt gemarkeerd; de overige tekst blijft normaal weergegeven.

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

Een nieuwe 2.0-installatie maakt de primaire gebruikersdatabase rechtstreeks uit `src/db/schema.sql` aan. Er is geen `schema_migrations`-tabel en er zijn geen historische migratiescripts. Versie 2.12.0 voegt bij de eerste herstart automatisch de onafhankelijke tabel `discovery_marks` toe met `CREATE TABLE IF NOT EXISTS`; bestaande tabellen en gegevens worden niet vervangen. De compatibiliteitswaarde `user_version = 20000` blijft behouden. Voor bestaande 2.x-installaties is geen handmatige migratie nodig.

Het primaire schema wordt idempotent geïnitialiseerd en gebruikt foreign keys, WAL-mode en een integriteitscontrole op de onderhoudspagina. De optionele MTGJSON-catalogus gebruikt een eigen schema en eigen SQLite-bestand. Markeringsrecords bevatten alleen onafhankelijke kaartidentiteiten, geen catalogusrij-ID, foreign key of `ATTACH`-koppeling. Het catalogusschema wijzigt niet en opnieuw importeren is niet nodig voor deze update.

Maak regelmatig een back-up van gebruikersdata via **Instellingen en onderhoud → Databaseback-up downloaden** of door de volledige `data/`-map veilig te kopiëren wanneer de applicatie is gestopt. De downloadbare databaseback-up bevat alleen de primaire database; de MTGJSON-catalogus kan opnieuw worden geïmporteerd.

## Projectstructuur

```text
server.js
src/
  config.js
  card-catalog/
    database.js
    import-service.js
    repository.js
    schema.sql
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

De applicatie bevat gerichte regressietests voor kritieke repositorylogica, de begrensde AtomicCards-parser, kaartcataloguszoekacties, importisolatie en frontendweergavecontracten. Voer ze uit met `npm test`.


## Read-only kaart opzoeken

Ook wanneer `/api/write` door de reverse proxy is geblokkeerd, blijven de globale zoekactie en de printinglijst onder **Kaart opzoeken** bruikbaar. Een printing kan worden bekeken en de kaartdetailpagina kan worden geopend. De invoervelden en knoppen waarmee collectie-, deck- of wantedgegevens worden gewijzigd, worden in read-only mode verborgen.
