# Magic Collection Manager 2.22.3

Magic Collection Manager is een lokale, responsive webapp voor het beheren van een persoonlijke Magic: The Gathering-collectie, wanted-list en decks. De applicatie gebruikt Node.js, Express.js, SQLite en Scryfall en is bedoeld voor één gebruiker zonder ingebouwde authenticatie.

Versie **2.0.0** is de eerste productiebaseline. Versie **2.11.0** voegt de pagina **Kaarten ontdekken** toe voor gericht zoeken tijdens het bouwen van een deck. De zoekcatalogus wordt opgebouwd uit MTGJSON AtomicCards en ondersteunt combineerbare filters voor onder meer kaarttekst, abilities, keywords, kleuridentiteit, kaarttype, mana value, legaliteit, effecten, tokenafmetingen en tutor-doelen. De onderhoudspagina kan deze catalogus op de achtergrond importeren en bijwerken.

Versie **2.11.1** maakt de filters op **Kaarten ontdekken** reactief: beschikbare opties en aantallen bewegen mee met de andere gekozen filters. De bestaande MTGJSON-catalogus blijft direct bruikbaar; opnieuw importeren is niet nodig.

Versie **2.11.2** laat de ontdekpagina leeg starten, markeert de gezochte kaarttekst en voegt kaartafbeeldingen in een popup toe. Kleur, mana en legaliteit staan in een horizontale, standaard ingeklapte sectie. Vanuit **Kaart opzoeken** kun je met **Terug** naar dezelfde zoekopdracht en scrollpositie. Bij één overgebleven naamsuggestie verschijnen de printings automatisch.

Versie **2.11.3** verwijdert de herhaalde filterredenen bij ontdekresultaten en geeft elk kaarttype een eigen kleurmarkering. De afbeeldingspopup herkent een ontbrekend preview-endpoint en legt uit dat ook de backend moet worden bijgewerkt en herstart.

Versie **2.12.0** voegt blijvende markeringen voor interessante kaarten toe, inclusief het filter **Gemarkeerd**. De primaire gebruikersdatabase krijgt hiervoor automatisch een nieuwe tabel; de MTGJSON-database blijft ongewijzigd. De ontdekfilters kunnen per sectie worden ingeklapt en als geheel worden verborgen. Een hoog filterpaneel is zelfstandig scrollbaar en blijft op desktop meteen binnen bereik.

Versie **2.13.0** voegde rechtstreeks toevoegen aan een deck vanuit **Kaarten ontdekken** toe. Versie **2.13.1** toont bij kaarten uit het gekozen deck een duidelijke aanduiding **Al in deck**. Deze kaarten blijven zichtbaar in de resultaten, ook na toevoegen. De deckdropdown heeft geen zichtbaar label erboven en lijnt uit met de dropdown ernaast. Deze update verandert geen databaseschema en vereist geen herimport.

Versie **2.13.2** activeert **Kleur, mana en legaliteit** pas als er een filter in **Tekst en kaartsoort** is ingevuld. Alleen een deck, kleur of managrens kiezen laadt dus geen kaarten. Vooraf gekozen waarden blijven bewaard en worden toegepast zodra je een naam, kaarttekst, ability, keyword, kaarttype of subtype invult.

Versie **2.13.3** voegt **Legendary** toe aan **Subtype** op **Kaarten ontdekken**. Kies daarnaast **Kaarttype: Creature** voor legendary creatures. De bestaande catalogus is direct bruikbaar; opnieuw importeren is niet nodig.

De MTGJSON-catalogus staat bewust in de volledig zelfstandige SQLite-database `mtgjson-atomic.sqlite`. Markeringen staan vanaf 2.12.0 in `discovery_marks` in de bestaande gebruikersdatabase `magic-collection.sqlite`; bestaande collectie-, wanted- en deckgegevens blijven behouden. Markeringen gebruiken stabiele kaartidentiteiten, geen catalogusrij-ID's of databasepaden. De twee databases worden niet met `ATTACH` of foreign keys gekoppeld. De kaarttekst-, lijst-, deck- en importverbeteringen uit 2.6 tot en met 2.10.4 blijven onderdeel van deze release.

Versie **2.13.4** herstelt fouten rond afwerkingskeuze, verouderde bewerkformulieren, dubbele toevoegingen en verlies van gegevens bij samenvoegen. Beide databaseschema’s blijven gelijk; bestaande gegevens worden niet automatisch gecorrigeerd. Zie [het integriteitsonderzoek](docs/DATA-INTEGRITY-AUDIT.md) voor bevindingen, tests en upgrade-instructies.

Versie **2.13.5** schermt **Kaart toevoegen** verder af: late antwoorden kunnen een nieuwe kaartselectie niet vervangen, kaartidentiteit wordt vóór opslag gecontroleerd en ongerelateerde collectie-, Wanted- en deckgegevens blijven behouden. Zie [de gerichte toevoegcontrole](docs/ADD-CARD-ISOLATION.md).

Versie **2.14.0** bundelt de deckacties in **Meer…**, voegt een exportpopup met kopiëren en downloaden in TXT- of Forge/Neo Forge-DCK-formaat toe en biedt **Geen** als groepering in beide deckweergaven.

Versie **2.14.1** neemt in DCK ook de gekozen set en het collectornummer op, bijvoorbeeld `1 Yedora, Grave Gardener|DSC|[209]`. Verschillende printings blijven afzonderlijke exportregels.

Versie **2.15.0** voegt **In bezit** toe aan Kaarten ontdekken en verdeelt basic lands bij DCK-export willekeurig over eigen printings van dezelfde kaart.

Versie **2.16.0** laat decks standaard openen in **Kaarten** en voegt **Functionele tags** toe aan de groepering in beide deckweergaven.

Versie **2.16.1** toont na deckimport een blijvend resultaatvenster met de geïmporteerde aantallen en eventuele overgeslagen regels met foutreden. De kaartweergave toont alleen een aantal bij meerdere exemplaren; de lijstweergave laat de labels **Missende kaarten** en **Alle decks** weg.

Versie **2.17.0** voegt per deck beheer van functionele tags toe, gebruikt bestaande tags in toevoeg- en bewerkpopups, maakt de Wanted-kaartkiezer breder en ververst geopende decks automatisch na wijzigingen vanuit een andere browser.

Versie **2.17.1** herstelt de oorspronkelijke breedte van de Wanted-popups en maakt de kaartzoekpopup hoger, met meer ruimte voor kaartsuggesties. Deze correctie verandert geen database of API.

Versie **2.18.0** laat **In bezit** correct samenwerken met de commander-kleuridentiteit, vereenvoudigt het tagbeheer en voegt beheer, kaarttoewijzing en groepering van synergieën toe. Synergieën kunnen vooraf zonder kaarten worden aangemaakt; hiervoor wordt de bestaande opslag gebruikt.

Versie **2.19.0** toont bijbehorende tokenafbeeldingen onder de kaartafbeelding en tokeninformatie boven **Beschikbaarheid** op de kaartdetailpagina. De bestaande Scryfall-verwijzingen bepalen welke tokens erbij horen; ook meerdere tokens worden getoond.

Versie **2.20.0** hernoemt de deckknop naar **Goldfishing**, geeft de speeltafel de volledige breedte en stapelt gelijke kaarten op tafel. Iedere kaart blijft afzonderlijk te bedienen; getapte en ongetapte exemplaren staan apart.

Versie **2.21.0** plaatst de aantallen op de kaartstapels, voegt **Exile** toe en verplaatst library-acties naar een rechtermuisknopmenu. **Toon X kaarten** ondersteunt bekijken met +/−, afzonderlijk verplaatsen en de resterende kaarten bovenop, onderop of geschud terugleggen. De knoppen **Beurt beëindigen** zijn verwijderd.

Versie **2.22.0** maakt Graveyard en Exile compacte stapels, deelt de hogere tafel in per kaarttype en laat de bovenste librarykaart rechtstreeks op de stapel zien of verbergen. **Toon X kaarten** heeft drie aparte teruglegknoppen.

Versie **2.22.2** herstelt het normale scrollen van de Goldfishing-pagina en de oorspronkelijke paginakop en tellers. Alleen de speeltafel heeft een begrensde hoogte; Enchantments en Artifacts houden ieder de helft van de rechterkolom.

Versie **2.22.3** geeft Hand en Command zone een vaste hoogte met één horizontale rij kaarten. De verticale scrollbalken in deze twee vakken en de herhaalde tekst **Sleep kaarten naar de tafel.** vervallen.

## Belangrijkste mogelijkheden

- Snel lokaal zoeken en direct zien of een kaart in bezit is, hoeveel exemplaren beschikbaar zijn, in welke decks deze voorkomt en of de kaart op Wanted staat.
- Verschillende fysieke printings, talen, condities, locaties en non-foil/foil/etched exemplaren registreren, met zichtbare Scryfall-prijzen per printing en afwerking.
- Scryfall-autocomplete, printingselectie en lokaal opgeslagen kaartmetadata.
- Een aparte ontdekpagina om kaarten op gecombineerde regels, kleuren en effecten te vinden, bijvoorbeeld Landfall-kaarten die een 2/2 creature token maken of groene kaarten met een tutor-effect.
- Interessante kaarten markeren en via **Gemarkeerd** terugvinden, ook na het vervangen van de MTGJSON-catalogus.
- Met **In bezit** uitsluitend cataloguskaarten vinden waarvan minstens één exemplaar in je collectie staat; alle reactieve filteropties volgen deze selectie.
- Ontdekte kaarten rechtstreeks aan een deck toevoegen en meteen herkennen welke kaarten al in het gekozen deck zitten.
- Een onderhoudsimport van de officiële MTGJSON AtomicCards-catalogus naar een volledig losse, opnieuw opbouwbare SQLite-database.
- Persistente SQLite-cache voor externe Scryfall-resultaten en een lokale schijfcache voor kaartafbeeldingen.
- Decks bouwen met kaarten die wel of niet in de collectie aanwezig zijn, inclusief een atomaire actie die één printing tegelijk aan de collectie en een deck toevoegt.
- Benoemde combo- en synergiegroepen met toelichting en instelbare volgorde. Synergieën kunnen vooraf worden aangemaakt en later aan meerdere kaarten worden gekoppeld; combo’s vereisen minimaal twee kaarten.
- Deckstatistieken voor mana curve, kleuren, kaarttypes, lands, creatures, handmatige tags, mana-productie, library-searchfuncties en Commander-controles.
- Een vrije, niet-persistente drag-and-drop-decksimulator met library, hand, battlefield, graveyard en command zone.
- Wanted-list met prioriteit, rarity, mogelijke printings, gekozen printing, prijsinformatie en deckfilter.
- Basic lands worden niet als ontbrekend beschouwd en komen niet op Wanted.
- Handmatig corrigeerbare kaartkenmerken voor mana-productie en library-searchfuncties.
- CSV-export voor de collectie, gecontroleerde tekstimport voor meerdere fysieke kaarten en tekstimport voor decks, met kopieerbare TXT- en DCK-export.
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

### Tokens bij een kaart

Op de kaartdetailpagina staan de bijbehorende tokenafbeeldingen onder de afbeelding van de kaart zelf. Het blok **Tokens**, direct boven **Beschikbaarheid**, toont per token de naam, het type, de eigen kleuren, eventuele power/toughness en kaarttekst met mana-iconen. Bij meerdere tokens worden ze allemaal getoond; dubbelzijdige tokens tonen beide zijden. Zonder tokenverwijzingen verschijnen deze onderdelen niet.

De koppelingen komen uit de al opgeslagen Scryfall-gegevens van de gekozen printing (`all_parts`, onderdeel `token`). Zo verwijst Greensleeves naar de groene 3/3 Badger-token. Ontbrekende tokengegevens worden via de unieke Scryfall-ID opgehaald en technisch gecachet; afbeeldingen gebruiken de bestaande lokale afbeeldingscache. Dit voegt geen tokens aan je collectie, decks of Wanted toe en verandert geen afwerking of aantallen. Er is geen databaseschemamigratie en de losse MTGJSON-catalogus wordt niet gebruikt of gewijzigd.

De normale kaartpagina verschijnt meteen terwijl de tokengegevens laden. Bij een tijdelijk probleem blijven beschikbare tokens en de overige kaartgegevens zichtbaar. Met **Opnieuw proberen** kun je het ophalen herhalen. Zonder internet zijn eerder gecachete gegevens en afbeeldingen bruikbaar, voor zover aanwezig; de eerste keer ophalen vereist toegang tot Scryfall. De bestaande knop **Kaartgegevens vernieuwen** kan verouderde tokenverwijzingen van de hoofdkaart opnieuw ophalen.

## MTGJSON-kaartcatalogus

Via **Instellingen en onderhoud → MTGJSON-kaartcatalogus** kan `AtomicCards.json.gz` van de vaste officiële MTGJSON-bron worden geïmporteerd. De import draait in een afzonderlijke worker, controleert de officiële SHA-256-controlecode, verwerkt het uitgepakte JSON-bestand begrensd en streaming en bouwt eerst een tijdelijke SQLite-database. Pas na een geslaagde integriteitscontrole wordt deze als `mtgjson-atomic.sqlite` geactiveerd. Tijdens een update blijft de vorige catalogus beschikbaar; bij een fout blijft die versie behouden.

De download en verwerking kunnen enige tijd duren en vereisen internettoegang en voldoende vrije schijfruimte. De onderhoudspagina toont download- en verwerkingsvoortgang. Per proces kan maar één catalogusimport tegelijk actief zijn. Een serverstop breekt een lopende import af en ruimt tijdelijke bestanden op.

Deze catalogus is alleen een opnieuw opbouwbare zoekbron. Zij bevat geen collectie-, deck-, wanted- of markeringsgegevens en heeft geen databasekoppeling met de primaire applicatiedatabase. De bestaande knop **Databaseback-up downloaden** maakt een consistente back-up van `magic-collection.sqlite`, inclusief je markeringen en functionele tagdefinities; importeer AtomicCards opnieuw om de zoekcatalogus te herstellen.

## Kaarten ontdekken

De link **Kaarten ontdekken** in het linker- en mobiele menu opent een aparte zoekpagina voor deckbouw. Alle actieve filters worden gecombineerd. Er kan worden gezocht op naam, Oracle-tekst, ability of trigger, keyword, type, subtype, Commander-kleuridentiteit, mana value, legaliteit en een afgeleid kaarteffect. De kleurmodus kan kaarten tonen die binnen de gekozen kleuren passen, alle gekozen kleuren bevatten of exact die kleuridentiteit hebben.

Zonder ingevulde zoekfilters verschijnen nog geen kaarten. Zodra je een inhoudelijk filter invult, worden de resultaten geladen; **Filters resetten** maakt de resultaten weer leeg. Een opgeslagen link met filters herstelt de zoekopdracht direct. De sectie **Kleur, mana en legaliteit** staat horizontaal boven de resultaten en is bij een nieuw bezoek ingeklapt.

De opties in **Kleur, mana en legaliteit**, inclusief de deckkeuze, worden toegepast als **In bezit** is aangevinkt of minstens één veld in **Tekst en kaartsoort** is ingevuld: **Naam**, **Kaarttekst bevat**, **Ability of trigger**, **Keyword**, **Kaarttype** of **Subtype**. Een waarde met alleen spaties telt niet mee. Je kunt de extra opties vooraf kiezen; ze blijven in het formulier en de terugkeerlink bewaard, maar starten zelf geen zoekopdracht en beperken de reactieve filteropties nog niet. Dit geldt ook voor een opgeslagen link met alleen kleur-, mana-, legaliteits- of deckinstellingen.

Als je het laatste filter in **Tekst en kaartsoort** wist en **In bezit** uit staat, worden die extra opties weer inactief. Zonder andere zoekfilters verdwijnen de resultaten. **Effect** en **Gemarkeerd** blijven zelfstandig bruikbaar; de extra opties worden daarbij pas toegepast zodra ook **Tekst en kaartsoort** is ingevuld of **In bezit** is aangevinkt.

**Filters verbergen** verbergt alle filterpanelen, inclusief **Kleur, mana en legaliteit**, zonder actieve filters te wissen. **Tekst en kaartsoort** en **Effect** zijn daarnaast afzonderlijk inklapbaar. Het filterpaneel blijft op desktop bovenaan in beeld zodra je scrollt; als de inhoud hoger is dan de beschikbare schermruimte, kun je binnen het paneel scrollen.

Naast **Kaart opzoeken** staat **Markeren**. Daarmee bewaar je een interessante kaart; met dezelfde knop kun je de markering weer verwijderen. Het filter **Gemarkeerd** toont alleen opgeslagen kaarten en kan met alle andere filters worden gecombineerd. Dit filter start ook zonder andere zoektermen een zoekopdracht. Resetten van filters wist geen markeringen. In alleen-lezenmodus kun je markeringen bekijken en erop filteren; wijzigen vereist toegang tot de schrijf-API.

Markeringen staan blijvend in de primaire gebruikersdatabase, op basis van Oracle-identiteit met een genormaliseerde kaartnaam als terugval. Het vervangen of opnieuw importeren van AtomicCards verwijdert ze niet. Een kaart die tijdelijk ontbreekt in de catalogus verschijnt daar niet als resultaat, maar de opgeslagen markering blijft bestaan.

Naast **Markeren** staat **Naar deck**. Deze knop opent dezelfde toevoegpopup als op de collectiepagina, met deck, aantal, rol, tags en notitie. **Ontbrekende exemplaren ook aan Wanted toevoegen** staat standaard uit. Een kaart hoeft nog niet in je collectie te zitten: bij bevestigen wordt een lokaal bekende printing gebruikt of via Scryfall op exacte naam opgehaald. Voor een specifieke printing kun je eerst **Kaart opzoeken** gebruiken. De actie voegt geen fysieke exemplaren aan je collectie toe.

Bij **Kleur, mana en legaliteit** staat een deckdropdown zonder zichtbaar label erboven. Zodra **Tekst en kaartsoort** is ingevuld of **In bezit** is aangevinkt, herken je kaarten uit het gekozen deck aan **Al in deck** en een gekleurde rand. Dit omvat alle rollen, inclusief commanders, sideboard en maybeboard. De vergelijking gebruikt Oracle-ID's over verschillende printings heen, met een genormaliseerde naam als terugval wanneer een Oracle-ID ontbreekt. Kaarten blijven zichtbaar: de deckkeuze verandert geen zoekresultaten, aantallen, paginering of reactieve filteropties. Je eigen **Markeren**-keuzes en het filter **Gemarkeerd** blijven hiervan onafhankelijk.

Met **Geen deck geselecteerd** wordt geen deck vergeleken. Zijn er ook geen zoekfilters meer actief, dan keert de pagina terug naar de lege beginstaat. De keuze blijft bij terugnavigatie behouden en wordt met **Filters resetten** gewist. Oudere opgeslagen links met `excludeDeckId` worden als deckkeuze herkend en verbergen geen kaarten meer.

Het gekozen deck staat alvast geselecteerd in de toevoegpopup. Na toevoegen worden de huidige resultaten vernieuwd; de kaart blijft staan en krijgt **Al in deck** wanneer de deckvergelijking actief is en je haar aan het geselecteerde deck hebt toegevoegd. **Naar deck** blijft beschikbaar als je nog een exemplaar wilt toevoegen.

De filteropties zijn reactief. Kies je bijvoorbeeld **Instant**, dan tonen abilities, subtypes, effecten, legaliteit en de overige opties alleen waarden die bij instants en je andere filters passen. Ook naam- en kaarttekstzoeken beperken de keuzelijsten. Beschikbare manawaarden worden als suggesties getoond; je kunt zelf een minimum en maximum blijven invullen.

**Subtype** bevat ook **Legendary** als er passende kaarten zijn. Dit is technisch een supertype en wordt gecontroleerd aan de hand van de opgeslagen kaartkenmerken. Met **Kaarttype: Creature** en **Subtype: Legendary** zie je uitsluitend legendary creatures; zonder de Legendary-keuze omvat Creature zowel gewone als legendary creatures.

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

De deckpagina ondersteunt zoeken, rolfilters en kaarttypefilters. Ook deze filters zijn standaard ingeklapt en kunnen met **Filters tonen** worden geopend. Direct daarnaast staan keuzelijsten voor sorteren op **Mana kosten** of **Naam kaart** en groeperen op **Type**, **Ability**, **Functionele tags**, **Synergieën** of **Geen**. Met **Geen** staan alle kaarten in één doorlopende lijst of één raster, gesorteerd volgens de gekozen sortering. Standaard wordt op manakosten gesorteerd en op kaarttype gegroepeerd. Bij abilitygroepering bepaalt het primaire herkende kaartkeyword de groep. Heeft een kaart geen keyword, dan worden in vaste volgorde de al aanwezige functionele kaartinzichten voor mana produceren, land zoeken en creature zoeken gebruikt; pas daarna valt de kaart onder **Geen ability**. Elke kaart staat bij abilitygroepering in precies één groep. **Functionele tags** gebruikt de handmatige tags die je beheert via **Meer… → Functionele tags beheren**, bijvoorbeeld Ramp, Draw en Protection. Via **Acties → Bewerken** wijs je bestaande tags aan een deckkaart toe. Een kaart met meerdere tags verschijnt in iedere passende groep. Dubbele tags en verschillen in hoofdletters leveren geen extra groep op. Taggroepen staan alfabetisch, met **Geen functionele tags** als laatste; binnen iedere groep geldt de gekozen sortering. Het totaal boven het overzicht telt een kaart eenmalig, ook als die in meerdere taggroepen staat. Basic lands worden per tag en rol samengevoegd, met alleen de aantallen en printings die bij die groep horen.

Een deck opent standaard in **Kaarten**. Met **Lijst** en **Kaarten** kan worden gewisseld tussen de beheerlijst en een grote visuele weergave. Beide weergaven gebruiken dezelfde filters, sortering en groepering; de weergavekeuze, de gekozen sortering en groepering, het gekozen aantal kaarten per rij en de filters worden in de URL bewaard. In de kaartweergave biedt **Kaarten per rij** de expliciete keuzes 1 tot en met 8, met **5** als standaard; de eerdere keuze **Automatisch** is verwijderd. Op kleinere schermen wordt het gekozen aantal responsief begrensd en blijven kaartafbeeldingen volledig zichtbaar zonder aan de zijkanten te worden afgesneden.

In de lijst opent de compacte knop **Acties** één menu met de beschikbare acties **Naar Wanted**, **Bewerken**, **Kenmerken**, **Combo's/synergieën** en **Verwijderen**. Bij samengevoegde basic lands worden alleen acties aangeboden die veilig op de groep kunnen worden uitgevoerd; via het printingoverzicht blijven de afzonderlijke printings beheerbaar. De kaartafbeelding is in deze lijst 92 pixels breed en opent de grote preview; de kaartnaam zelf is gewone tekst. Binnen `.card-list-content` krijgt de naam flexibel de resterende ruimte en staan de manakosten rechts uitgelijnd, zodat lange namen minder snel over twee regels lopen terwijl de mana per rij netjes blijft staan. Daarna staat de kaarttekst met gerenderde symbolen tussen de kaartsamenvatting en **Acties**. Kaarttekst en inline symbolen zijn duidelijk leesbaar; generieke, numerieke, gekleurde, kleurloze en tapsymbolen gebruiken dezelfde verticale basislijn. Alleen de exacte abilitynaam of het herkende keyword wordt gemarkeerd; de overige tekst blijft normaal weergegeven.

In de kaartweergave staat een aantalbadge alleen bij meer dan één exemplaar, bijvoorbeeld **2×**; **1×** wordt niet getoond. In de lijstweergave zijn de badges **Missende kaarten** en **Alle decks** verborgen. De overige bezits-, tekort- en Wanted-aanduidingen blijven beschikbaar. In de kaartweergave staan geen zichtbare ellipsis- of actieknoppen op de kaarten. De beschikbare kaartacties blijven bereikbaar via rechtsklikken, de ContextMenu-toets en `Shift+F10`; een normale klik opent eerst de grote preview. Het deckoverzicht toont per deck de kleuridentiteit met dezelfde manasymbolen als het collectiefilter. Commander-thumbnails zijn daar verdubbeld van 52 × 73 naar 104 × 146 pixels. Het venster voor **Kaart toevoegen** gebruikt een brede, hoge kaartkiezer zodat lokale resultaten en printings ook op grotere schermen overzichtelijk blijven. De optie om ontbrekende exemplaren ook aan Wanted toe te voegen staat standaard uit. Filters en scrollpositie blijven behouden na bewerken en na terugkeer vanaf kaartdetails of deckstatistieken. Basic lands met dezelfde kaartnaam en rol worden in de lijst samengevoegd, ook wanneer verschillende printings zijn gebruikt. De aantallen boven de lijst en in de rolfilters tellen echte kaarten in plaats van database-regels.

Combo’s vereisen minimaal twee kaarten. Synergieën kunnen vooraf worden aangemaakt via **Meer… → Synergie** en mogen ook leeg blijven. Via **Acties → Combo’s/synergieën → Synergieën kiezen** wijs je een kaart aan één of meer bestaande synergieën toe. Met **Groeperen → Synergieën** zie je de groepen in zowel de lijst- als kaartenweergave. Een kaart met meerdere synergieën verschijnt in iedere passende groep, maar telt eenmaal mee in het decktotaal. Kaarten zonder synergie staan onder **Geen synergie**. Binnen een combo of synergie kan een volgorde worden aangegeven. De tekstexport bundelt gelijke Oracle-kaarten over verschillende printings en exporteert bijvoorbeeld één regel `24 Forest` in plaats van meerdere losse Forest-regels.

**Meer…** opent het deckmenu met **Bewerken**, **Importeren**, **Dupliceren** en **Verwijderen**. De knoppen hebben dezelfde uitlijning. **Exporteren** opent een aparte popup met de volledige decklijst. Kies **Tekst (.txt)** of **Forge / Neo Forge (.dck)**, gebruik **Kopiëren** of selecteer zelf tekst, of sla de getoonde inhoud op met **Downloaden**. **Tekort exporteren** blijft een rechtstreekse TXT-download.

De TXT-export houdt dezelfde inhoud als voorheen. De DCK-export gebruikt `[metadata]` met de decknaam, `[Commander]` voor beide commanders, `[Main]` voor het hoofddeck en `[Sideboard]` voor sideboard en companion. Maybeboard wordt in beide formaten overgeslagen. DCK bevat per regel `aantal Naam|SET|[collectornummer]`. Basic lands worden willekeurig verdeeld over de eigen printings van dezelfde kaart; overige kaarten gebruiken de gekozen deckprinting. De geregistreerde aantallen vormen de voorraad per ronde. Bij tekort worden eigen printings opnieuw gebruikt; zonder passende eigen exemplaren blijft de oorspronkelijke deckprinting staan. Alleen identieke printingvermeldingen worden binnen een sectie samengevoegd; verschillende Forest-printings blijven dus apart. Foil wordt niet afgeleid uit de collectie, omdat een deckregel geen fysieke afwerking selecteert. Als printinggegevens ontbreken of niet veilig in DCK kunnen worden geschreven, geeft de export een melding met de kaartnaam. Zie [de exportbeschrijving](docs/DECK-EXPORT.md).

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

## Goldfishing

Via **Goldfishing** op de deckpagina open je de vrije speeltafel. Kaarten kunnen met drag-and-drop tussen library, hand, tafel, graveyard, exile en command zone worden verplaatst.

De Goldfishing-pagina scrollt normaal, met de oorspronkelijke paginakop en tellers boven de speeltafel. Alleen de speeltafel heeft een hoogte op basis van de schermhoogte, met ruimte rondom en voor mobiele navigatie. Hand en Command zone zijn 240 pixels hoog (210 op mobiel) en tonen kaarten in één horizontale rij. Bij veel kaarten kun je horizontaal scrollen; er is geen verticale scrollbalk in deze twee vakken. De kaartgebieden op tafel scrollen binnen hun eigen vak. Enchantments en Artifacts krijgen ieder de helft van de rechterkolom. Wanneer de vaste kaartrijen en de tafel niet samen in de beschikbare hoogte passen, is de speeltafel zelf intern scrollbaar zodat alle zones bereikbaar blijven. Landen staan onderaan, creatures erboven en enchantments/artifacts rechts. Kaarten met meerdere typen krijgen één plek: Land heeft voorrang, daarna Creature, Artifact en Enchantment. Overige kaarten blijven zichtbaar in een eigen rij. De indeling gebruikt de voorzijde; subtypes tellen niet als kaarttype.

Gelijke kaarten op tafel, inclusief verschillende printings van dezelfde basic land, staan in overlappende stapels van maximaal vijf exemplaren. De aantalbadge staat op de stapel, net als bij de library. Getapte en ongetapte exemplaren staan apart. Iedere kaart behoudt zijn eigen afbeelding en blijft afzonderlijk te verslepen, vergroten en tappen. Klik op een kaart om te vergroten; dubbelklik om te tappen of untappen. Met het toetsenbord gebruik je Enter voor vergroten en de spatiebalk voor tappen. Er is geen knop **Beurt beëindigen** meer; je tapt en untapt de kaarten zelf. De tellers bovenaan tonen de aantallen in library, hand, tafel, graveyard en exile.

Graveyard en Exile tonen ieder één stapel met de bovenste kaart en een aantalbadge. De bovenste kaart blijft rechtstreeks te verslepen. Klik of rechtsklik op de stapel om alle kaarten te bekijken, inclusief de kaarten onderin. Selecteer daar een kaart en kies een bestemming of **Vergroten**. Een dubbelklik op de stapel vergroot de bovenste kaart.

Rechtsklik op de library voor:

- **Toon bovenste kaart**: laat de bovenste kaart rechtstreeks op de library zien. De optie verandert in **Verberg bovenste kaart**. Zolang dit ingeschakeld is, wisselt de afbeelding mee met de actuele bovenste kaart na trekken, millen, schudden of terugleggen. Er opent geen popup en de volgorde/aantallen veranderen niet. **Reset** verbergt de bovenste kaart weer.
- **Mill kaart**: verplaats precies de bovenste kaart naar graveyard.
- **Toon X kaarten**: open de bovenste kaart en gebruik **+** en **−** om telkens een kaart meer of minder te tonen. De getoonde volgorde begint bij de bovenste kaart. Rechtsklik op een getoonde kaart voor **Naar hand**, **Naar speelveld**, **Naar graveyard** of **Naar exile**.
- **Schudden** en **Library bekijken**: de bestaande functies zijn via dit menu beschikbaar en staan niet meer bovenaan.

In **Toon X kaarten** staan naast +/− drie afzonderlijke teruglegknoppen:

- **Bovenaan library**: leg de resterende getoonde kaarten bovenop, in de getoonde volgorde.
- **Onderop library**: leg ze onderop, waarbij de eerst getoonde kaart als eerste van dat groepje gepakt wordt.
- **Shuffle in library**: schud de resterende getoonde kaarten door de volledige library.

De actie sluit de popup. Sluiten via **Sluiten**, het kruisje of Escape laat de resterende kaarten in dezelfde volgorde bovenop liggen; eerder verplaatste kaarten blijven in hun gekozen zone. Bekeken kaarten tellen als librarykaarten totdat je ze naar een andere zone verplaatst. Klikken op de library opent het menu ook; Enter, spatie of de contextmenutoets werken eveneens. Klik op een getoonde kaart om deze te vergroten. Het verplaatsmenu is ook bereikbaar met de contextmenutoets of Shift+F10.

De simulator valideert geen Magic-regels of betaalbaarheid. Alle toestand bestaat alleen in het geheugen van de geopende pagina en wordt niet in browseropslag of de database bewaard. Herladen, opnieuw openen of **Reset** begint een nieuwe speeltest. Alle acties werken ook in alleen-lezenmodus.

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


### Resultaat van deckimport

Na **Meer… → Importeren** verschijnt een resultaatvenster. Bij een volledig geslaagde import bevestigt het venster dat alle kaartregels zijn verwerkt. Bij een gedeeltelijke of geheel mislukte import toont het iedere overgeslagen regel met het oorspronkelijke regelnummer, de exacte invoer en de reden. De getoonde aantallen betreffen deze import; al aanwezige exemplaren worden niet nogmaals meegeteld. Commander-, partner- en companionregels volgen de bestaande limiet van één exemplaar.

Naamregels, regels met een aantal zoals `2 Sol Ring`, `2x Sol Ring` en `2xSol Ring`, en printingregels zoals `1 Sol Ring (CMM) 396` worden ondersteund. Lege regels, opmerkingen en herkende sectiekoppen zijn geen overgeslagen kaartregels. Een ongeldig aantal stopt de volledige import vóórdat deckkaarten worden toegevoegd. Na een gedeeltelijke import zijn de geslaagde regels al verwerkt: corrigeer en importeer alleen de overgeslagen regels opnieuw, onder de juiste sectiekop zoals Commander of Sideboard.


### Functionele tags beheren

Open op een deck **Meer… → Functionele tags beheren** om tags aan te maken, te hernoemen of te verwijderen. **Aanmaken** staat naast het naamveld. De lijst wordt automatisch bijgewerkt na wijzigingen; er is geen aparte knop **Vernieuwen**. Elke tag hoort bij één deck en blijft bestaan als er nog geen kaarten aan gekoppeld zijn. Hernoemen werkt alle toewijzingen binnen dat deck bij. Verwijderen haalt de tag en de toewijzingen weg; de kaarten, aantallen en tags van andere decks blijven behouden. Deckduplicatie kopieert ook ongebruikte tags.

**Aan deck toevoegen**, **Collectie + Deck** en het bewerken van een deckkaart bieden alleen bestaande tags van het gekozen deck aan. Je kunt meerdere tags aanvinken of de keuze leeg laten. Na een deckwissel wordt de tagkeuze opnieuw geladen en worden de vorige selecties gewist. Een hernoemde tag behoudt zijn ID; een verwijderde tag wordt niet door een oud formulier opnieuw aangemaakt.

Bij de eerste start van 2.17.0 wordt `deck_tags` automatisch aangemaakt in de primaire SQLite-database en gevuld met de bestaande toegewezen tags. De bestaande kaarttoewijzingen en collectiegegevens worden behouden. De MTGJSON-database blijft zelfstandig en ongewijzigd; herimport is niet nodig. Vervang de applicatiecode, behoud `.env` en `data/` en herstart Node.js of je systemd-service.

### Wijzigingen vanuit een andere browser

Een geopende deckpagina controleert elke vijf seconden op wijzigingen in dat deck via de server. Ook wijzigingen met hetzelfde kaarttotaal of binnen dezelfde seconde worden herkend. De pagina ververst met behoud van weergave, filters, sortering, groepering, kolommen en scrollpositie. Tijdens invoer, een open popup of een verborgen tabblad wordt verversen uitgesteld; na afloop hervat de controle. Dit werkt ook tussen verschillende browsers of apparaten die dezelfde applicatie gebruiken.

De popup **Kaart aan wanted-list toevoegen** heeft weer de oorspronkelijke breedte (maximaal 900 pixels) en is hoger (maximaal 820 pixels), zodat meer kaartsuggesties tegelijk zichtbaar zijn. De lijst gebruikt de beschikbare hoogte en kan scrollen; de sluitknoppen blijven bereikbaar. De popup past binnen de schermhoogte en -breedte. Het daaropvolgende Wanted-toevoegformulier heeft weer de oorspronkelijke breedte van maximaal 580 pixels.
