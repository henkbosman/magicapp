# Architectuur - Magic Collection Manager 2.13.1

## Overzicht

De applicatie is een Node.js/Express-webapp met een statische HTML/CSS/JavaScript-frontend. Het hoofdproces beheert de primaire SQLite-gebruikersdatabase; een worker bouwt op verzoek een volledig zelfstandige, read-only geopende SQLite-zoekcatalogus.

```text
Browser
  │
  ├── /             statische responsive frontend
  ├── /api/read/*   leesacties van de webinterface
  ├── /api/write/*  mutaties
  └── /api/ai/*     compacte read-only LLM-endpoints
         │
      Express
         │
         ├── bestaande routes/services → magic-collection.sqlite → Scryfall/cache
         └── card-catalog route/repository → mtgjson-atomic.sqlite
                                              ↑
                                      importworker ← MTGJSON
```

Er is geen authenticatie of gebruikersmodel. De netwerkgrens hoort bij de reverse proxy/firewall.

## Productiebaseline en database

De primaire gebruikersdatabase gebruikt sinds versie 2.0 één geconsolideerd schema in `src/db/schema.sql`. Bij iedere start wordt dit schema idempotent uitgevoerd met `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` en `CREATE TRIGGER IF NOT EXISTS`.

Er is bewust geen historische migratie-engine in de 2.0-productiecode. 2.0 is de eerste ondersteunde productiebaseline.

Permanente gegevens staan onder `DATA_DIR` (standaard `data/`). De primaire database heet standaard `magic-collection.sqlite`, gebruikt foreign keys, WAL-mode, `synchronous=NORMAL` en een busy timeout en behoudt `user_version = 20000`.

Belangrijkste tabellen:

- `cards`: lokaal gecachete Scryfall-printingmetadata;
- `collection_items`: fysieke exemplaren/groepen in bezit;
- `decks`: deckmetadata;
- `deck_cards`: gewenste kaarten per deck, onafhankelijk van bezit;
- `deck_card_tags`: deck-specifieke functietags;
- `deck_card_groups` + `deck_card_group_members`: benoemde combo-/synergiegroepen en volgorde;
- `wanted_items`: wanted-kaarten;
- `wanted_item_decks`: koppeling tussen wanted-items en decks;
- `card_user_metadata`: Oracle-brede handmatige correcties voor mana-productie en library-searchfuncties;
- `discovery_marks`: gemarkeerde ontdekkingskaarten op basis van Scryfall Oracle-ID of genormaliseerde naam;
- `external_api_cache`: tijdelijke persistente Scryfall-responsecache;
- `card_printing_catalog` + `card_printing_catalog_state`: lokale catalogus van mogelijke printings.

Versie 2.11 voegt daarnaast standaard `mtgjson-atomic.sqlite` onder `DATA_DIR` toe. `CARD_CATALOG_DATABASE_FILE` kan het catalogusbestand wijzigen; configuratie weigert botsingen met `DATABASE_FILE` en met de bijbehorende SQLite journal-, WAL-, SHM- en herstelbestanden. De catalogus heeft een eigen schema in `src/card-catalog/schema.sql`, een eigen `user_version = 10000` en eigen interne foreign keys en indexen. De primaire database bevat geen catalogusgegevens, bestandspad, catalogusrij-ID of foreign key naar deze database. De applicatie gebruikt geen SQLite `ATTACH` en voert geen cross-database-joins uit.

Versie 2.12 voegt bij het starten automatisch de zelfstandige tabel `discovery_marks` en een naamindex aan de primaire database toe. Alleen stabiele externe kaartidentiteiten, namen en tijdstempels worden opgeslagen. De bestaande collectie-, deck- en wanted-tabellen blijven intact; `user_version` blijft 20000. De catalogus krijgt geen schemawijziging en vereist geen herimport.

De catalogus bevat genormaliseerde AtomicCards-eigenschappen en facettabellen voor keywords, abilities, types, subtypes, supertypes, printings, legaliteiten, effecten en tutor-doelen. Zij bevat uitsluitend afgeleide externe kaartdata en geen collectie-, deck-, wanted- of andere gebruikersdata. De bestaande back-uproute maakt daarom alleen een consistente kopie van de primaire database, inclusief markeringen; de catalogus is opnieuw vanuit MTGJSON op te bouwen.

## Kaartidentiteit

De tabel `cards` bevat fysieke printings en gebruikt Scryfall ID als unieke externe identifier. Voor beschikbaarheid en deckbehoefte wordt primair `oracle_id` gebruikt; wanneer die ontbreekt valt de applicatie terug op `scryfall_id`.

Daardoor kunnen verschillende fysieke printings van hetzelfde Oracle-kaartconcept samen worden geteld, terwijl een deck of collection item toch naar een concrete printing kan verwijzen.

Joined queries aliasen de database-ID van `cards` expliciet als `card_record_id` en die van fysieke collectieregels als `collection_item_id`. Dit voorkomt ID-botsingen in JavaScriptmappers.

## Routes en services

`src/routes/` bevat dunne HTTP-routes. Validatie gebeurt bij de routegrens. Domeinlogica voor gebruikersdata zit in `src/services/`; de geïsoleerde zoekcatalogus zit onder `src/card-catalog/`. `POST /api/write/collection/with-deck` is het expliciete endpoint voor een gecombineerde collectie- en decktoevoeging binnen één buitenste SQLite-transactie. `POST /api/write/collection` ondersteunt voor API-compatibiliteit dezelfde bewerking wanneer `deckId` aanwezig is. De collectie-import resolveert en valideert alle regels vóór de synchrone SQLite-transactie; hierdoor wordt een lijst volledig of helemaal niet toegevoegd. De bestaande collectie- en deckservices nemen via savepoints veilig aan buitenste transacties deel.

Belangrijke services:

- `ai-service.js`: compacte, gepagineerde modellen voor externe LLM-tools;
- `card-repository.js`: lokale kaarten, collectie, gebruikstellingen;
- `card-cache-service.js`: lokale kaartcache en Scryfall-ophalen;
- `scryfall-service.js`: externe verzoeken met rate limiting/cache;
- `image-cache-service.js`: lokale schijfcache voor kaartafbeeldingen;
- `deck-service.js`: deck CRUD, deckkaarten, ontbrekende kaarten en geaggregeerde tekstexport;
- `deck-stats-service.js`: centrale deterministische deckstatistieken;
- `deck-link-service.js`: combo-/synergiegroepen;
- `deck-printing-service.js`: deckprinting afstemmen na aankoop;
- `wanted-service.js`: wanted CRUD en deckrelaties;
- `discovery-mark-service.js`: permanente markeringen zonder afhankelijkheid van catalogusrijen of catalogusbestand;
- `card-discovery-context-service.js`: leest markeringen en kaartidentiteiten uit een geselecteerd deck voor de catalogusquery;
- `printing-catalog-service.js`: mogelijke printings/rarities per Oracle-kaart;
- `card-insight-service.js`: afgeleide en handmatig corrigeerbare mana-/zoekkenmerken;
- `import-export-service.js`: collectie-export, gecontroleerde collectie-import en deckimport/-export.

Belangrijke catalogusonderdelen:

- `routes/card-catalog.js`: read-only status-, optie-, zoek- en previewendpoints;
- `card-catalog/preview.js`: geïsoleerde Scryfall-afbeeldingsresolver met een begrensde geheugencache, zonder import of gebruik van de primaire database;
- `card-catalog/repository.js`: validatie, gefacetteerde opties, SQL-filtering, sortering en paginering;
- `card-catalog/database.js`: uitsluitend de aparte catalogusverbinding, read-only opening, validatie, recovery en activering;
- `card-catalog/import-service.js`: maximaal één achtergrondjob, publieke voortgang en workerlevenscyclus;
- `card-catalog/import-worker.js`: vaste officiële download, SHA-256-controle, limieten en gzip-stream;
- `card-catalog/builder.js`: tijdelijke databaseopbouw, metadata, indexering en integriteitscontrole;
- `lib/atomic-cards-parser.js`: begrensde streaming parser voor de `{meta,data}`-structuur;
- `lib/card-catalog-features.js`: tolerante normalisatie en herkenning van abilities en effecten.

## API-zones

Express mount drie API-zones:

```text
/api/read
/api/write
/api/ai
```

`/api/read` accepteert alleen GET/HEAD. Hieronder zijn `GET /card-catalog/status`, `/options`, `/search` en `/preview` gemount. `/api/write` weigert GET/HEAD en bevat alle muterende endpoints, waaronder `POST /maintenance/card-catalog/import`. Dat endpoint antwoordt met HTTP 202 zodra de job gestart is; een tweede gelijktijdige start geeft HTTP 409. `/api/ai` accepteert alleen GET/HEAD en levert vier compacte modellen voor decks, deckkaarten, kaartdetails en een gefilterde collectie. De webinterface gebruikt `/api/ai` niet. De frontend controleert `POST /api/write/health`; wanneer dit niet bereikbaar is, worden schrijfcontrols disabled en verschijnt de interface als alleen-lezen. De catalogus blijft in die modus doorzoekbaar, maar een import kan dan niet worden gestart.

## Frontend

De frontend is frameworkloos ES modules JavaScript. `public/js/app.js` is de hash-router en laadt views voor dashboard, collectie, kaart opzoeken, kaarten ontdekken, decks, deckdetails, statistieken, simulator, wanted, kaartdetails en onderhoud.

Navigatiestatus voor detailpagina's bewaart bronroute, filters en scrollpositie in session storage. Daardoor kan de gebruiker terugkeren naar dezelfde lijstpositie. De snelle kaartinvoer heet zichtbaar **Kaart opzoeken**, bewaart formulierwaarden in de actieve DOM en reset deze alleen bij een andere printing; kaartnaam, collectornummer en printing staan in de hashroute voor terugnavigatie. Na het laden van de printings herstelt de frontend eerst een eerdere selectie; anders beperkt zij de kandidaten tot een gekozen collectornummer en kiest daarbinnen een lokaal bekende of de eerste printing, die direct in het invoerpaneel wordt getoond. De lijstimport gebruikt eerst een preview van alle gevonden printings en voert daarna één atomaire bulkactie uit. Na een geslaagde enkelvoudige toevoegactie blijven de drie actieknoppen vergrendeld totdat opnieuw een printing wordt gekozen.

`#/discover` biedt een afzonderlijke deckbouwzoekpagina en staat in zowel het linker- als mobiele menu. De view controleert eerst de catalogusstatus en toont zonder actieve catalogus een onderhouds-CTA. Met een beschikbare catalogus combineert zij naam, Oracle-tekst, ability, keyword, type, subtype, kleuridentiteit, mana value, legaliteit en effectfilters. Alle actieve filters zijn conjunctief. De kleurmodi zijn subset van gekozen Commander-kleuren, bevat alle gekozen kleuren en exact. Tokenfilters ondersteunen power, toughness en tokentype; tutorfilters ondersteunen het gezochte kaarttype. De filterstate, sortering en pagina staan in de hashquery. Zonder inhoudelijk zoekfilter laadt de view alleen opties, geen zoekresultaten; reset herstelt deze lege beginstaat. Kleur, mana en legaliteit staan in een horizontale details-sectie die standaard dicht is.

Sinds 2.12 verbergt de hoofdknop zowel het zijpaneel als de horizontale kleursectie. Tekst en kaartsoort en Effect zijn afzonderlijke native details-secties. Het zijpaneel is op desktop sticky en begrensd tot de schermhoogte, met eigen verticale scrollruimte; op mobiel volgt het de gewone paginascroll. Terugnavigatie bewaart ook de open/dicht-toestand en interne scrollpositie.

Ieder resultaat toont links van de naam het preview-icoon en naast Kaart opzoeken een Markeren-knop. De view bevestigt een markering pas na een geslaagde write-response, blokkeert dubbele klikken en vernieuwt daarna resultaten en facets met de actuele filters. Alleen-lezenmodus blokkeert deze mutatie maar laat het Gemarkeerd-filter bruikbaar. Gemarkeerd telt zelfstandig als inhoudelijk zoekfilter; reset wist geen opgeslagen markeringen.

Sinds 2.13 staat naast Markeren ook Naar deck. De view gebruikt de gedeelde `addCardToDeck`-popup, met het geselecteerde deck als voorkeuze. Bestaande lokale kaarten worden op lokaal ID toegevoegd; cataloguskaarten gebruiken hun exacte naam, zonder hun catalogus-ID als primair kaart-ID te behandelen. Bij een bekend Oracle-ID controleert de resolver dat de gevonden printing bij het bedoelde kaartconcept hoort. Wanted gebruikt het lokaal opgeloste kaart-ID uit de geslaagde deckresponse en blijft standaard uit. Een geslaagde decktoevoeging kan niet opnieuw worden verstuurd doordat een latere Wanted- of schermverversing faalt.

De horizontale filtersectie bevat een deckdropdown zonder zichtbaar label, met een toegankelijke naam voor schermlezers. De lijst komt uit `GET /api/read/decks`; de managrenzen en suggesties blijven behouden. Sinds 2.13.1 staat de keuze als `deckId` in de route en bepaalt zij uitsluitend de aanduiding Al in deck. Een deckkeuze kan zelfstandig resultaten laden, maar beperkt ze niet. Na toevoegen vernieuwt de view resultaten en opties zonder de filtercontrols te vervangen; de kaart blijft zichtbaar en krijgt de actuele deckaanduiding. De toestand en scrollpositie van de filters blijven behouden. Een verdwenen geselecteerd deck blijft herkenbaar en verwijderbaar in de keuzelijst. Oudere routes met `excludeDeckId` worden naar de nieuwe deckkeuze vertaald.

Resultaten bevatten geen primaire database-ID. Een preview-icoon opent via `discovery-preview.js` een dialoog. Het nieuwe `GET /api/read/card-catalog/preview?name=...` resolveert de exacte kaartnaam via de vaste Scryfall named-route en geeft alleen gevalideerde afbeeldings-URL's terug. De resolver gebruikt een begrensde tijdelijke geheugencache, verzoekbundeling en time-outs; zij schrijft geen kaarten of cachegegevens in een database. De browser toont een of twee kaartzijden en meldt ontbrekende of mislukte afbeeldingen in de dialoog. De bestaande Content Security Policy blijft behouden.

Sinds 2.11.3 rendert de ontdekview de `matchReasons` uit de zoek-API niet meer. `discoveryTypeLineHtml` markeert bekende kaarttypewoorden met vaste kleurklassen, afzonderlijk per kaartzijde en alleen vóór de subtype-scheiding. Supertypes en subtypes blijven gewone escaped tekst. Meerdere types op één kaart behouden ieder hun kleur.

De algemene HTTP-404 **Endpoint niet gevonden.** is een ontbrekende route, geen Scryfall-afbeeldingsfout. De popup geeft bij precies die fout uitleg over backend-update en herstart. De previewroute zelf is sinds 2.11.2 geregistreerd onder `/api/read/card-catalog/preview`; een nog draaiend oud Node-proces of afwijkende proxyroute kan deze niet kennen, ook als nieuwe statische bestanden al zichtbaar zijn. De afzonderlijke HTTP-regressietest toetst de volledige routeprefix en onderscheidt deze fout van een bestaande route die geen afbeelding vindt; deze test vereist de normale Express-afhankelijkheid.

**Kaart opzoeken** bewaart via `prepareDiscoveryLookupNavigation` de ontdekroute en scrollpositie in een eigen terugkeercontext. De opzoekpagina behoudt `discoveryReturn` bij querywijzigingen en toont **Terug**. De ontdekroute bewaart voor deze terugkeer ook de open/dicht-toestand van de filterpanelen, zodat de pagina dezelfde hoogte krijgt. De bestaande router herstelt de scrollpositie na renderen. Precies één autocomplete-suggestie laadt automatisch printings, met guards tegen verouderde antwoorden en verder typen. `cardTextHtml` accepteert optioneel `{ highlight }` als derde parameter; letterlijke zoekmatches worden op brontekstposities gemarkeerd, zonder HTML-injectie of aantasting van symbolen en keywordmarkering.

De onderhoudsview leest de catalogus en actuele importjob via `GET /api/read/card-catalog/status`. Na een succesvolle `POST` pollt zij dit endpoint zolang de job actief is. De jobstatus bevat fase, verwerkt aantal, downloadbytes, melding en eventuele fout, zodat de write-aanvraag zelf kort kan blijven.

De deckdetailpagina gebruikt één centraal actiemodel voor het compacte **Acties**-menu in de lijst en het contextmenu in de visuele kaartweergave. Voor een normale kaart kan het lijstmenu Naar Wanted, Bewerken, Kenmerken, Combo's/synergieën en Verwijderen aanbieden; samengevoegde basic lands krijgen alleen groepsveilige acties. De lijst toont kaartafbeeldingen op 92 pixels breed. Binnen `.card-list-content` gebruikt de titelregel een flexibele naamkolom en een rechts uitgelijnde manaplaats. Daardoor krijgt de kaartnaam zoveel mogelijk ruimte zonder dat de mana-uitlijning per rij verloren gaat. De kaartnaam is gewone, niet-interactieve tekst; de afbeelding blijft de ingang voor de grotere kaartpreview. De kaarttekst en gerenderde symbolen staan vóór de actieknop op een duidelijk leesbare grootte. Generieke, numerieke, gekleurde, kleurloze en tapsymbolen gebruiken daar dezelfde verticale basislijn. Alleen de exacte tekst van een herkende abilitynaam of een herkend kaartkeyword wordt gemarkeerd; de overige Oracle-tekst blijft normaal weergegeven. In de kaartweergave staan geen zichtbare overflowknoppen; het contextmenu blijft bereikbaar via rechtsklikken, de ContextMenu-toets en `Shift+F10`. De kaartweergave bewaart een expliciete keuze van 1 tot en met 8 kaarten per rij in de hashroute, gebruikt standaard 5 en begrenst het raster responsief; de keuzelijst bevat geen automatische optie. Naast **Filters tonen** staan keuzes voor sorteren op manakosten of kaartnaam en groeperen op type of ability. De standaardwaarden zijn respectievelijk manakosten en type. Beide instellingen gelden voor de lijst- en kaartenweergave en worden in de hashroute bewaard. Bij abilitygroepering bepaalt het primaire herkende kaartkeyword de groep. Als dat ontbreekt, wordt in vaste volgorde teruggevallen op de al verrijkte functionele kaartinzichten voor mana produceren, land zoeken en creature zoeken. Kaarten zonder bruikbare ability vallen onder **Geen ability**; een kaart wordt nooit over meerdere groepen verdeeld.

De collectie rendert haar regels in dezelfde basisopbouw als de decklijst: kaartafbeelding, een flexibele naam met rechts uitgelijnde mana binnen `.card-list-content`, printingmetadata en statistieken, gerenderde kaarttekst en één **Acties**-knop. Ook hier gebruikt de kaarttekst de herstelde leesbare grootte en dezelfde symboolbasislijn voor alle mana- en tapsymbolen. Alleen de exacte tekst van een herkende abilitynaam of een herkend kaartkeyword wordt gemarkeerd; de rest van de Oracle-tekst behoudt zijn normale achtergrond. De kaartnaam is gewone, niet-interactieve tekst en de afbeelding blijft de ingang voor de grotere kaartpreview. De functionele badges **Produceert** en **Zoekt** worden bewust niet in de collectieregel gerenderd; de onderliggende inzichten blijven beschikbaar voor de kenmerkeneditor en collectiefilters. De actieknop opent een dialoog voor Naar deck, Bewerken, Kenmerken en Verwijderen en past daarin dezelfde alleen-lezenbeveiliging toe als andere muterende frontendacties. Het deckoverzicht gebruikt voor commanders thumbnails van 104 × 146 pixels, tweemaal de eerdere afmetingen.

De in versie 2.9 toegevoegde tutorfilters veranderden geen endpointpaden of databasetabellen. De bestaande `ability`-parameter van de collectie accepteert daarvoor de synthetische waarden `Tutor land` en `Tutor creature`.

Versie 2.11.0 voegde vier catalogusendpoints en een tweede SQLite-bestand toe. Versie 2.12 voegt `GET /api/read/discovery-marks` en `POST /api/write/discovery-marks` toe. De bestaande collectie-, deck-, wanted-, kaart- en AI-contracten blijven ongewijzigd.

## Caching

### Scryfall-responses

`external_api_cache` bewaart externe responses met TTL. Identieke gelijktijdige verzoeken worden samengevoegd en verlopen cachedata kan bij een tijdelijke storing als fallback dienen.

### Printingcatalogus

Mogelijke papieren printings worden afzonderlijk genormaliseerd opgeslagen zodat Wanted-filters lokaal kunnen werken zonder per filterwijziging externe calls te doen.

### MTGJSON-zoekcatalogus

De MTGJSON-catalogus is geen cachetabel in de primaire database en staat los van de Scryfall-printingcatalogus. De actieve verbinding wordt read-only en met `query_only` geopend. Bij een import bouwt een worker een uniek tijdelijk SQLite-bestand en raakt hij de actieve database niet aan. Na parsing, indexering, `quick_check` en `foreign_key_check` sluit en synchroniseert de worker het bestand. Het hoofdproces controleert daarna lichtgewicht schema, kaartaantal en bronmetadata en activeert het bestand via een rename met een tijdelijk `.previous`-bestand. Bij een fout blijft de vorige catalogus actief of wordt zij hersteld.

De import accepteert geen URL uit een request. Bron en checksum zijn vastgezet op de officiële MTGJSON HTTPS-locaties en redirects zijn uitgeschakeld. De gzip-download is maximaal 128 MiB, het uitgepakte document maximaal 512 MiB en de parser maximaal 100.000 kaartrecords; daarnaast gelden netwerk-time-outs, een schijfruimtecontrole en een maximale jobduur van twintig minuten. Het bestand wordt als gzip gecontroleerd en de gedownloade bytes moeten overeenkomen met de officiële SHA-256 voordat parsing begint.

De worker leest het JSON-document streaming en krijgt maximaal 256 MiB V8 old-generation geheugen. Tijdelijke bestanden hebben beperkte bestandsrechten en worden na succes, fout of serverstop opgeruimd. Een exclusieve lockfile voorkomt ook tussen meerdere Node-processen dat imports en cataloguswissels overlappen. Tijdens shutdown wordt een actieve worker eerst beëindigd en daarna worden de catalogus- en primaire databaseverbinding afzonderlijk gesloten.

## Cataloguszoekmodel

Sinds 2.11.1 accepteert het bestaande optiesendpoint dezelfde inhoudelijke filters als het zoekendpoint. Iedere facet past alle andere filters toe en laat zijn eigen dimensie weg (disjunctieve facets). Kleuren laten kleuridentiteit en kleurmodus weg; het manabereik laat beide grenzen weg; de effectfacet laat ook de effectafhankelijke token- en tutorwaarden weg. De tokenfacets toetsen overgebleven tokenkenmerken binnen dezelfde rij in `card_tokens`. Opties tellen unieke `catalog_key`-waarden over de volledige dataset, los van paginering en sortering. Alle catalogusqueries blijven read-only en bestaande catalogi vereisen geen herimport.

Sinds 2.12 lezen de zoek- en optieroutes de markeringen via de markeringservice en geven een momentopname als intern argument aan de catalogusrepository. Die repository opent de primaire database niet. `marked=1` beperkt alle facets en de zoekquery vóór telling, deduplicatie, sortering en paginering. Gebonden JSON-lijsten met `json_each` voorkomen een SQL-placeholderlimiet bij grote aantallen markeringen. Zoekresultaten bevatten altijd `markKey` en `marked`; interne markeringenlijsten komen niet in het publieke queryobject terecht.

Sinds 2.13.1 levert `cardDiscoveryContext` bij `deckId` de kaartidentiteiten van het gekozen deck onder `selectedDeck`, inclusief alle rollen en eventuele commander-verwijzingen. De catalogusrepository gebruikt deze momentopname alleen om bij ieder zoekresultaat `inDeck` te berekenen. Er is geen deckvoorwaarde in de SQL-filtering; telling, deduplicatie, sortering, paginering en alle facets blijven gelijk aan dezelfde zoekopdracht zonder deckkeuze. `inDeck` is false zonder geselecteerd deck. Oracle-ID heeft voorrang op de volledige genormaliseerde naam; naamfallback geldt alleen als aan minstens één kant een Oracle-ID ontbreekt. De handmatige markering `marked` blijft onafhankelijk.

De gedeelde parser accepteert een positief veilig geheel `deckId` of een lege keuze. `excludeDeckId` blijft een alias met de nieuwe betekenis; een expliciet `deckId`, ook leeg, heeft voorrang. De publieke queryresponse gebruikt alleen `deckId`. Een ontbrekend deck geeft HTTP 404; een ongeldig ID geeft HTTP 400. Beide routes importeren de contextservice pas bij een zoek- of optieverzoek, zodat status en preview hun bestaande isolatie behouden. Er zijn geen cross-database-joins, nieuwe schemawijzigingen of catalogusschrijfacties.

Een markering gebruikt bij voorkeur `oracle:<Scryfall Oracle-ID>` en anders `name:<genormaliseerde naam>`. Gelijke bekende Oracle-ID's matchen ongeacht de naam; naamfallback geldt alleen wanneer een van beide kanten geen Oracle-ID heeft. Twee verschillende bekende Oracle-ID's worden niet samengevoegd. Een naammarkering kan bij expliciet markeren met een later beschikbaar Oracle-ID worden opgewaardeerd. Bij verwijderen zonder Oracle-ID worden alle naamaliassen gewist die de betreffende naamkaart als gemarkeerd laten verschijnen. Afwezige kaarten blijven gemarkeerd in de primaire database en verschijnen weer zodra een passende cataloguskaart beschikbaar is. Status en preview blijven zonder gebruik van de primaire database werken.

De ontdekview haalt opties en resultaten met dezelfde filterwaarden op en past beide samen toe. Bij invoer wordt een verouderd verzoek direct ongeldig; tekstinvoer wordt kort gebundeld voordat een nieuwe aanvraag start. De bestaande formulierelementen blijven staan, terwijl opties ter plekke worden vervangen. Gekozen waarden met nul matches blijven zichtbaar en verwijderbaar, lege facets gebruiken geen statische volledige optielijst als fallback. Manawaarden dienen als suggesties; een handmatig gekozen bereik wordt nooit stilzwijgend aangepast.

De repository valideert lengte, numerieke bereiken, enums, pagina en limiet voordat SQL wordt opgebouwd. Alle waarden zijn gebonden parameters; tabelnamen komen uitsluitend uit interne vaste mappings. Zoekresultaten worden per `catalog_key` gededupliceerd en bieden maximaal 100 resultaten per pagina en maximaal 5.000 resultaten offset.

Naam- en Oracle-tekstfilters gebruiken genormaliseerde of case-insensitive deelmatches. Facettabellen verzorgen exacte filters voor abilities, keywords, types en subtypes. `colorMode=subset` vereist dat de kaart binnen de gekozen kleuren past, `contains` vereist alle gekozen kleuren en `exact` vereist dezelfde identiteit. Legaliteit heeft het formaat `format` of `format:status`, waarbij `legal` standaard is. Effectaliases worden naar interne waarden vertaald. Creature-token-, tutor-, tokenstatistiek- en tutor-doelfilters leggen aanvullende `EXISTS`-voorwaarden op; hierdoor kan bijvoorbeeld `ability=Landfall&effect=token&tokenPower=2&tokenToughness=2` gericht worden gecombineerd.

### Afbeeldingen

Kaartafbeeldingen worden standaard onder `data/images/` gecachet. Cachebestanden zijn gekoppeld aan de exacte externe afbeelding-URL om verwisselde afbeeldingen door naam/ID-botsingen te voorkomen.

## Collectiefiltering

De kleuridentiteitsfilter verzendt de gekozen kleuren als één canonieke `color`-waarde, bijvoorbeeld `color=G,W`, en de modus via `colorMode=and|or`; de backend accepteert daarnaast herhaalde kleurparameters. AND is standaard en vereist exact de gekozen identiteit: `G` toont mono-groen en `G,W` exact groen-wit. OR toont kaarten die minimaal één gekozen kleur bevatten. In OR-modus neemt `C` kleurloze kaarten als afzonderlijk alternatief mee. Filtering vindt vóór paginering in SQLite plaats. De AI-collectie houdt bewust zijn compacte exacte kleurfilter.

De abilityfilter combineert exacte kaartkeywords met synthetische inzichten. Naast **Mana produceren** kunnen **Tutor land** en **Tutor creature** worden getoond wanneer minstens één collectiekaart matcht. De tutorfilters werken met effectieve library-searchinzichten: Oracle-brede handmatige correcties hebben voorrang op automatische herkenning in de volledige Oracle-tekst. `Tutor land` omvat de doelen `land` en `basic_land`; `Tutor creature` omvat `creature`. De algemene categorie `any` en de restcategorie `other` tellen niet mee voor deze specifieke filters.

## Deckstatistieken

`deck-stats-service.js` berekent statistieken uitsluitend uit lokale data. Hieronder vallen mana curves, kleuren, types, lands, creatures, keywords, tags, Commander-waarschuwingen, ontbrekende kaarten, mana-productie, library-searchfuncties en combo-/synergiegroepstatistieken. Mana-producers en zoekkaarten worden op Oracle-identiteit samengevoegd, zodat verschillende printings van dezelfde kaart als één statistiekregel met een opgeteld aantal worden teruggegeven.

Er is geen Monte Carlo- of regelsimulatieanalyse in 2.0.

## Simulator

De decksimulator is bewust een vrije client-side speeltafel en geen Magic-regelengine. De toestand bestaat uitsluitend in het geheugen van de actieve view. Herladen of opnieuw openen start een nieuwe simulatie; kaartverplaatsingen veranderen geen browseropslag of databasegegevens. De resetbevestiging is een lokale actie en is niet gekoppeld aan de write-API.


## Statische API-documentatie

De endpointbeschrijving is opgesplitst in `public/API-READ.txt`, `public/API-WRITE.txt` en `public/API-AI.html`. Read en Write worden als platte tekst aangeboden. De LLM-beschrijving is een zelfstandige, kale HTML-pagina zonder eigen CSS of JavaScript; endpointpaden zijn aanklikbare links. De gelijknamige bestanden onder `docs/` zijn bronkopieën. De onderhoudspagina linkt naar alle drie publieke documenten. Oude `/API-AI.md`- en `/API-AI.txt`-URL’s sturen permanent door naar `/API-AI.html`.

Ieder endpoint gebruikt dezelfde compacte volgorde: URL, korte uitleg, input-JSON en output-JSON. Niet-JSON-responses zoals afbeeldingen, CSV, tekstexport en databaseback-ups worden expliciet als zodanig gemarkeerd.

## Foutafhandeling en veiligheid

- API-errors gebruiken consistente JSON-foutresponses.
- Onverwachte serverfouten worden gelogd zonder interne details naar de browser te sturen.
- CSP beperkt scripts/styles tot de eigen origin; afbeeldingen mogen daarnaast van Scryfall worden geladen.
- De write-API weigert browserrequests uit een andere site. Zonder configuratie accepteert de browser-writezone alleen localhost, lokale hostnamen en private LAN-adressen om DNS-rebinding te beperken. Voor domeinnamen of een reverse proxy moet `PUBLIC_ORIGIN` als gezaghebbende volledige oorsprong worden ingesteld; niet-browserclients zonder Origin-header blijven bruikbaar.
- De afbeeldingsproxy accepteert alleen gevalideerde Scryfall HTTPS-hosts.
- SQLite foreign keys bewaken relaties en cascades.
- Reverse-proxyfiltering kan de schrijfzone tot het LAN beperken.


## Read-only printing preview

De read-API mag technische Scryfall-cachedata vullen zodat externe clients zonder toegang tot `/api/write` printings en kaartdetails kunnen bekijken. Gebruikersdata zoals collectie, wanted en decks wordt uitsluitend via de write-API gemuteerd.
