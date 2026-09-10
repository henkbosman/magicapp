# Changelog

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
