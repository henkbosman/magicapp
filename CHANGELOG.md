# Changelog

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
