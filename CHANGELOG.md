# Changelog

## 2.2.2 - 2026-09-11

### Opgelost

- **Collectie + Deck** gebruikt weer het expliciete endpoint `POST /api/write/collection/with-deck`. Dit endpoint vereist een deck en kan daardoor niet stilzwijgend alleen de collectie aanpassen.
- De frontend accepteert een gecombineerde toevoeging pas als de response zowel een `collectionItem` als een `deckCard` bevat. Een 404 van een nog actieve oude backend wordt vertaald naar een duidelijke melding dat het Node.js-proces opnieuw moet worden gestart.
- Deckvelden worden vóór het ophalen en opslaan van kaartmetadata gevalideerd; een ongeldige deckkeuze start geen collectieactie.
- De kleuridentiteitsfilter verstuurt meerdere kleuren voortaan als één canonieke waarde, bijvoorbeeld `color=G,W`, zodat queryparsers of proxies geen tweede kleur kunnen verliezen.
- De backend accepteert zowel kommagescheiden als herhaalde kleurparameters en behandelt ook geneste querywaarden robuust.
- Eén geselecteerde kleur toont alleen exact die monokleur. Bij meerdere gekozen kleuren worden kaarten toegelaten waarvan de volledige kleuridentiteit een niet-lege subset van de selectie is; een groen-witte kaart verschijnt dus bij groen plus wit, maar niet bij alleen groen.

### Deployment

- De beschreven symptomen kunnen optreden wanneer nieuwe bestanden over een draaiende Node.js-installatie worden gekopieerd zonder het proces te herstarten: statische frontendbestanden worden dan vernieuwd, terwijl de backendcode in het oude proces blijft. Stop en start `node server.js` daarom altijd opnieuw na een upgrade.

## 2.2.1 - 2026-09-11

### Verbeterd

- De kleuridentiteitsfilter toont alleen de zes manasymbolen; tekstlabels en losse checkbox-vakjes zijn visueel verwijderd.
- Geselecteerde kleuridentiteiten krijgen een duidelijke, dikkere groene rand en blijven volledig toetsenbordtoegankelijk.
- **Kaart toevoegen** toont uitsluitend beschikbare EUR-prijzen voor non-foil, foil en etched.

### Opgelost

- De monokleurfilter gebruikt nu een expliciete exacte controle: bij alleen groen worden kaarten met bijvoorbeeld groen-zwart of groen-wit uitgesloten.
- **Collectie + Deck** gebruikt het bestaande `POST /api/write/collection` met deckvelden, zodat de actie niet meer op een ontbrekend subendpoint kan stranden. De atomaire transactie blijft behouden.
- `POST /api/write/collection/with-deck` blijft als compatibiliteitsalias beschikbaar.

### Database

- Geen schemawijziging. Bestaande 2.0.x-, 2.1.x- en 2.2.0-data blijft rechtstreeks bruikbaar.

## 2.2.0 - 2026-09-11

### Verbeterd

- Na het kiezen van een printing op **Kaart toevoegen** scrolt de pagina zo nodig naar de drie actieknoppen.
- Het opmerkingenveld is uit de snelle kaartinvoer verwijderd.
- De geselecteerde printing toont beschikbare non-foil-, foil-, etched- en MTGO-prijzen in EUR, USD en TIX.
- Ingevulde collectievelden blijven na **Collectie**, **Wanted** en **Collectie + Deck** behouden en worden pas bij een andere printing opnieuw ingesteld.
- De acties heten nu **Collectie**, **Wanted** en **Collectie + Deck** en staan in die volgorde naast elkaar.
- **Collectie + Deck** schrijft de fysieke printing en de deckkaart atomair weg; bij een fout wordt geen halve toevoeging bewaard.
- Succes- en foutmeldingen van de snelle kaartinvoer verschijnen bovenaan het scherm.
- Naast het kaartnaamveld staat een collectornummerfilter dat alle beschikbare nummers van de gevonden kaart bevat.
- De kleuridentiteitsfilter in Collectie ondersteunt meerdere geselecteerde kleuren en toont alleen kaarten waarvan de volledige identiteit binnen die toegestane kleuren valt. **Meerkleurig** is vervallen; kleurloos is afzonderlijk selecteerbaar.
- Collectieregels tonen de beschikbare Scryfall-prijs voor hun concrete printing en afwerking.

### Opgelost

- De kaartdetailpagina die vanuit een geselecteerde printing wordt geopend, zet die exacte printing vooraan en valt niet meer terug op een andere printing die al in bezit is.
- Opnieuw klikken op dezelfde printing wist de reeds ingevulde waarden niet meer.
- Taalvarianten gebruiken waar mogelijk hun eigen exacte detailkoppeling en prijsinformatie.

### API

- Nieuw endpoint `POST /api/write/collection/with-deck` voor een atomaire collectie- en decktoevoeging.
- `GET /api/read/collection` accepteert herhaalde `color`-parameters voor een toegestane kleuridentiteit.

### Database

- Geen schemawijziging. Bestaande 2.0.x- en 2.1.x-data blijft rechtstreeks bruikbaar.

## 2.1.1 - 2026-09-11

### Verbeterd

- De API-documentatie is opgesplitst in `API-READ.md` en `API-WRITE.md`.
- Ieder endpoint staat compact in de volgorde URL, korte uitleg, input-JSON en output-JSON.
- De onderhoudspagina bevat afzonderlijke links naar beide Markdowndocumenten.
- De decksimulator bewaart geen speltoestand meer in `sessionStorage`; iedere opening of herlaadactie start een nieuwe simulatie.
- De lokale resetbevestiging is losgekoppeld van de write-API, zodat resetten ook in alleen-lezenmodus werkt.

### Database

- Geen schemawijziging. Bestaande 2.0.x- en 2.1.0-data blijft rechtstreeks bruikbaar.

## 2.1.0 - 2026-09-10

### Verbeterd

- Het venster voor **Kaart toevoegen** binnen een deck is aanzienlijk breder en hoger gemaakt. De zoekresultaten en printingkaarten gebruiken de beschikbare ruimte responsief.
- De kleuridentiteitsfilter in Collectie behandelt `W`, `U`, `B`, `R` en `G` voortaan als monokleurfilter inclusief kleurloze kaarten. Een groen-zwarte kaart verschijnt dus niet meer bij groen, terwijl een kleurloze kaart wel bruikbaar blijft.
- Collectie en Wanted hebben naast de inklapknop een directe knop **Filters resetten**. De resultaten worden zonder paginaverspringing opnieuw geladen.
- Het opmerkingenveld op **Kaart toevoegen** is compacter gemaakt.
- **Aan collectie toevoegen** staat als primaire actie boven **Naar Wanted** en **Naar deck**.
- De kaartdetailpagina heeft meer verticale ruimte tussen **Beschikbaarheid** en de daaropvolgende informatiepanelen.
- Het dashboard gebruikt nu **Mijn Magic-verzameling** en de algemene introductiezin is verwijderd.
- Er is een volledige statische API-handleiding toegevoegd als `public/API.md`. De pagina bevat alle read- en write-endpoints met invoer- en uitvoerformaten en is rechtstreeks bereikbaar via `/API.md`.
- De onderhoudspagina bevat een link naar de Markdown-API-handleiding.
- Markdownbestanden worden expliciet als `text/markdown; charset=utf-8` en zonder verouderde browsercache geserveerd.
- De voorbeeldconfiguraties gebruiken de 2.1.0-versie in de Scryfall User-Agent.

### Database

- Geen schemawijziging. Bestaande 2.0.x-data blijft rechtstreeks bruikbaar.

## 2.0.3 - 2026-09-10

### Verbeterd

- De globale zoekacties **Kaart opzoeken** en **Andere printing of nieuwe kaart zoeken** blijven beschikbaar in alleen-lezenmodus.
- Printings op **Kaart toevoegen** blijven selecteerbaar wanneer de schrijf-API niet beschikbaar is.
- Een nieuw read-endpoint laadt de details van een geselecteerde Scryfall-printing zonder toegang tot `/api/write`; technische kaartcache mag daarbij lokaal worden bijgewerkt, gebruikersdata niet.
- In alleen-lezenmodus worden de invoervelden en muterende knoppen van de geselecteerde printing volledig verborgen; kaart- en printinginformatie blijft zichtbaar.
- De afbeelding en naam van de geselecteerde printing openen de kaartdetailpagina. De terugknop herstelt daarna de kaart-toevoegenpagina, gekozen printing en scrollpositie.
- De kaartnaam en geselecteerde printing worden in de hashroute bewaard zodat de kaart-toevoegenpagina na terugnavigatie exact kan worden opgebouwd.

## 2.0.2 - 2026-09-10

### Opgelost

- Het plus-icoon van de knop **Kaart toevoegen** rechtsboven staat op mobiele schermen exact gecentreerd. De verborgen tekst neemt geen ruimte meer in.
- Op de mobiele kaartdetailpagina worden **Kaartgegevens** en **Keywords** onder elkaar weergegeven in plaats van naast elkaar.

## 2.0.1 - 2026-09-10

### Gewijzigd

- Collectie-, Wanted- en deckfilters zijn standaard ingeklapt en kunnen met **Filters tonen** worden geopend. Actieve filters blijven werken en worden als aantal op de toggle getoond.
- Bij het toevoegen van een kaart aan Wanted wordt na de kaartnaam slechts één representatieve printing getoond; de definitieve printing wordt later vanuit Wanted gekozen.
- De toelichting dat de gewenste printing later gekozen kan worden is uit het Wanted-toevoegvenster verwijderd.
- De knop **Printing** op Wanted blijft bruikbaar wanneer de schrijf-API geblokkeerd is. Printings en prijzen kunnen dan worden bekeken, maar de keuze kan niet worden gewijzigd.
- Afbeeldingen in de Wanted-printingkiezer zijn aanklikbaar en openen een grote, mobielvriendelijke preview.
- Scryfall-printingresultaten bewaren naast de thumbnail ook de normale afbeeldings-URL. De printingcacheversie is verhoogd zodat bestaande cachegegevens automatisch worden vernieuwd.
- De zichtbare melding/status voor een niet-beschikbare schrijf-API is verwijderd. Schrijfknoppen blijven wel automatisch grijs en uitgeschakeld.
- De mobiele ondernavigatie bevat voortaan vier duidelijke vaste knoppen: Home, Collectie, Decks en Wanted. De aparte Toevoegen-knop in deze balk is verwijderd.
- De mobiele navigatie heeft een constante inhoudshoogte en duidelijkere SVG-iconen met een zichtbare actieve status.
- De decktegels schakelen op smalle schermen naar één kolom en lange namen/teksten kunnen niet meer buiten het witte vlak lopen.

## 2.0.0 - 2026-09-10

Eerste productiebaseline.

### Verwijderd

- De volledige experimentele deckanalysefunctionaliteit, inclusief schermen, knoppen, API-routes, worker, repositories, services, CSS en opgeslagen analysemodel uit het nieuwe basisschema.
- De historische 1.x-databasemigratieketen en de `schema_migrations`-infrastructuur.
- Oude tussentabellen die niet meer door de productiefunctionaliteit worden gebruikt.
- Niet-bereikbare JavaScriptexports, verouderde CSS-selectors en andere aantoonbaar dode code.
- Niet-gebruikte collection-coveragevelden uit het deckoverzichtsmodel.

### Gewijzigd

- Een nieuwe installatie initialiseert direct één geconsolideerd `src/db/schema.sql` als 2.0-basisschema.
- Applicatieversie en Scryfall User-Agent worden centraal uit `package.json` afgeleid.
- Numerieke configuratievelden vallen bij ongeldige environmentwaarden terug op veilige standaarden.
- Frontend-cacheversies zijn bijgewerkt naar 2.0.0.

### Opgeloste bugs

- Joined collectiequery's gebruiken expliciete kaart- en collectieregel-ID's, zodat metadata en afbeeldingen niet aan de verkeerde kaart kunnen worden gekoppeld.
- Het kaartdetailendpoint van de collectie zoekt nu exact op Oracle/Scryfall-kaartidentiteit en niet via een tekstzoekopdracht.
- Beschikbaarheidsfilters in de collectie worden vóór paginering in SQL toegepast en de resultaatcount gebruikt dezelfde filters.
- Het wijzigen van een fysieke collectieregel naar dezelfde printing/taal/conditie/locatie als een bestaande regel voegt beide regels veilig samen in plaats van een UNIQUE/500-fout te veroorzaken.
- Een aankoop vanuit een wanted-item zonder expliciete deckkoppeling kan niet langer onverwacht printings in alle decks aanpassen.
- Timestamp-triggers hebben een expliciete guard gekregen en blijven daardoor veilig wanneer SQLite `recursive_triggers` ooit wordt ingeschakeld.
