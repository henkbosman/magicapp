# Onderzoek gegevensintegriteit — Magic Collection Manager 2.13.4

Datum: 8 oktober 2026. Onderzochte uitgangsversie: de eerder opgeleverde broncode-ZIP 2.13.3.

## Conclusie over foil/non-foil

Er zijn concrete fouten gevonden die een verkeerde afwerking kunnen laten opslaan. Er is geen verwisseling aangetoond bij het uitsluitend weergeven van reeds opgeslagen collectieregels.

De collectielijst gebruikt `collection_items.finish` via een expliciete kolomalias en koppelt die aan het eigen collectieregel-ID. De lijst gebruikt dus niet het veld met beschikbare afwerkingen van een printing als de afwerking van jouw exemplaar. Tests met dezelfde printing als nonfoil, foil en etched bevestigen dat toevoegen, filteren, uitlezen en verversen van kaartmetadata die regels gescheiden houden.

De productie-SQLite-database, eerdere back-ups en concrete getroffen kaarten waren niet beschikbaar. Daardoor is niet vastgesteld welke fout jouw waarneming heeft veroorzaakt of welke bestaande waarden moeten worden hersteld. De update doet geen automatische correcties aan opgeslagen afwerkingen.

## Fouten die direct met afwerking samenhangen

### Een taalwissel kon de gekozen afwerking verliezen

Reproductie: kies expliciet Foil bij een taal die foil en nonfoil ondersteunt. Wissel naar een taalvariant die alleen nonfoil ondersteunt en daarna terug naar de oorspronkelijke taal. De oude interface liet nu nonfoil geselecteerd. De omgekeerde richting was ook mogelijk. Vervolgens werd die gewijzigde selectie daadwerkelijk opgeslagen als je op Toevoegen klikte.

Dit speelde zowel op Kaart opzoeken als in de popup om een kaart aan de collectie toe te voegen. De expliciete voorkeur wordt nu apart bewaard en hersteld zodra de gekozen taal die afwerking weer ondersteunt. In een taal die de voorkeur niet ondersteunt toont het formulier nog steeds een werkelijk beschikbare afwerking. Deze reparatie bewaart de voorkeur binnen die printingselectie; ze introduceert geen nieuwe voorkeur die voor alle volgende kaarten geldt.

### Een ouder bewerkformulier kon nieuwere gegevens terugdraaien

Een geopend formulier bevatte een momentopname van onder meer aantal en afwerking. Als de collectieregel intussen veranderde, bijvoorbeeld in een ander tabblad of door een toevoeging, overschreef Opslaan die nieuwere waarden met de oudere formulierwaarden. Ook een verwijdering vanuit een verouderd overzicht kon inmiddels toegevoegde exemplaren verwijderen.

Lijst en detail leveren nu een `revision`. De interface stuurt die terug als `expectedRevision` bij wijzigen en verwijderen. De server vergelijkt deze binnen de database-transactie en weigert een verouderde versie met HTTP 409. Vernieuw in dat geval de collectie voordat je opnieuw bewerkt. Deze controle vereist geen nieuw databaseveld. Bestaande externe API-clients zonder `expectedRevision` blijven werken, maar moeten dit veld zelf gaan meesturen om dezelfde bescherming te krijgen.

### Een lege afwerking in een PATCH kon nonfoil worden

Een expliciet lege afwerking viel via de invoerstandaard terug op nonfoil. De route weigert nu lege of ongeldige afwerkingen. Het veld weglaten betekent nog steeds dat de bestaande afwerking behouden blijft.

Nieuwe of gewijzigde afwerkingen worden bovendien gecontroleerd tegen de beschikbare afwerkingen in de bekende printinggegevens. Ontbrekende oude cachemetadata geldt niet als bewijs dat een afwerking ongeldig is. Een historische afwijking wordt bij een ongerelateerde bewerking niet stil gecorrigeerd.

## Overige bevindingen en reparaties

| Onderdeel | Vastgesteld risico | Reparatie |
| --- | --- | --- |
| Toevoegformulieren | Herhaald indienen of opnieuw aanklikken van dezelfde printing tijdens opslaan kon meer exemplaren toevoegen. | Een eigen lopende-actiecontrole blokkeert herhaalde indiening, onafhankelijk van de disabled-toestand van de knop. Een lopende popup kan niet tussentijds door de gebruiker worden gesloten. |
| Vernieuwen na opslaan | Een geslaagde toevoeging kon als mislukt worden behandeld wanneer het daaropvolgende verversen faalde, met de mogelijkheid opnieuw toe te voegen. | Een bevestigde toevoeging blijft voltooid; een verversfout wordt afzonderlijk gemeld. |
| Collectiemerges | Toevoegen aan dezelfde fysieke variant overschreef opmerkingen en kon een bekende aankoopprijs vervangen. Samengevoegde opmerkingen werden soms afgekapt. | Beide teksten blijven behouden. Verschillende bekende aankoopprijzen of te lange gecombineerde notities geven 409 zonder gedeeltelijke wijzigingen. Gebruik een andere locatie om aankopen apart te bewaren, of bewerk de gegevens bewust. |
| Kaartidentiteit | Een verdwenen expliciet lokaal kaart-ID kon terugvallen op een andere printing. Batchlookup kon een opgegeven set negeren; deckimport kon de verkeerde kaart voor een opgegeven naam/set/nummer accepteren. | Expliciete identifiers zijn bindend. Ontbrekende of tegenstrijdige identifiers worden geweigerd. Set/nummer en naam moeten overeenkomen. |
| Fysieke printingkeuze | Digitale kaarten in de lokale cache konden opnieuw in de fysieke printingkeuze verschijnen. | Bekende digitale printings worden uit de fysieke selectie gefilterd, inclusief de gecontroleerde cachepaden. De cache bepaalt nooit zelfstandig de afwerking van een reeds opgeslagen collectieregel. |
| Aantallen | Een leeg aantal kon als nul worden uitgelegd, wat bij collectie-PATCH verwijderen betekent. Zeer grote aantallen konden numerieke precisie verliezen. | Lege of onveilige aantallen worden geweigerd; optelsommen worden gecontroleerd. Deckimport weigert ongeldige aantallen vóór de eerste deckmutatie. |
| Deckverwijdering | Een kaartregel-ID uit een ander deck kon de commander-/partnerverwijzing van het opgegeven deck wissen. | De regel moet bij het opgegeven deck horen; anders volgt 404 zonder wijzigingen. |
| Deck- en Wanted-notities | Additieve samenvoegingen konden persoonlijke notities vervangen; commandermerges konden ook tags verliezen. Printingmerges kapten lange notities af. | Notities en tags blijven behouden. Te lange combinaties geven een conflict en rollback. Expliciete PATCH-bewerkingen kunnen notities nog vervangen of leegmaken. |
| Wanted | Een fout na de eerste van meerdere writes liet een gedeeltelijk opgeslagen toevoeging achter. Tekorten van vóór een externe lookup konden door gelijktijdige acties verouderd zijn. | Samenhangende writes zijn één transactie. Het actuele tekort wordt na de lookup opnieuw gelezen voordat Wanted wordt aangevuld. |
| Transacties | Na een fout bij COMMIT werd de interne transactiediepte tweemaal verlaagd. Volgende geneste bewerkingen konden daardoor mislukken. | De teller wordt precies eenmaal in `finally` hersteld. Rollback en daaropvolgende geneste transacties zijn getest. |

## Verificatie

De regressietests gebruiken tijdelijke SQLite-databases en de echte services. De frontendtests voeren de echte eventhandlers uit met een kleine DOM-testadapter. Er zijn geen productiegegevens gewijzigd en er is geen visuele browsertest uitgevoerd.

Nieuwe tests staan in:

- `test/collection-integrity.test.js`: scheiding van afwerkingen, versies, merges en rollback.
- `test/collection-write-integrity-ui.test.js`: taalwissels in beide richtingen, herhaald toevoegen, verversfouten, juiste collectieregel en versievelden.
- `test/dialog-integrity.test.js`: herhaalde submits, sluiten tijdens opslaan en schrijfstatus.
- `test/import-cache-integrity.test.js`: printingidentiteit, import, digitale printings en behoud van afwerking bij refresh.
- `test/deck-wanted-integrity.test.js`: deckscope, behoud van gegevens, gelijktijdig aanvullen en rollback.
- `test/database-integrity.test.js`: commitfout en herstel van geneste transacties.
- `test/validation-integrity.test.js`: lege, onveilige en niet-numerieke invoer.

Dezelfde nieuwe regressies zijn voor de frontend, collectie en deck/Wanted ook tegen de oorspronkelijke 2.13.3-broncode uitgevoerd. Daar falen de relevante foutscenario's; in de aangepaste versie slagen ze. Tests die de correcte weergave en scheiding van opgeslagen afwerkingen controleren slagen ook in de oude versie.

De volledige testronde telt **268 tests: 263 geslaagd, 0 mislukt en 5 overgeslagen**. De syntaxcontrole is geslaagd voor alle **104 JavaScript-bestanden**. Er zijn 59 nieuwe tests toegevoegd ten opzichte van 2.13.3.

De vijf overgeslagen tests zijn HTTP-integratietests die Express nodig hebben; die afhankelijkheid is in deze omgeving niet beschikbaar. De routewijzigingen zijn wel nagekeken en de onderliggende service- en interactietests zijn uitgevoerd.

## Installeren en bestaande kaarten controleren

1. Download via Onderhoud eerst een databaseback-up. Bewaar ook eventuele oudere back-ups; daarin kan de oorspronkelijke afwerking nog staan.
2. Vervang de volledige applicatiecode door 2.13.4, met behoud van `.env` en `data/`.
3. Herstart de bestaande Node/systemd-service. Controleer via `/api/read/health` dat versie 2.13.4 draait en laad de browserpagina opnieuw.
4. Een catalogusherimport of wijziging van beide databaseschema's is niet nodig.
5. Exporteer de collectie naar CSV. Daar staan per fysieke collectieregel onder meer naam, set, collector number, aantal, `finish`, taal, conditie, locatie en `scryfall_id`. Vergelijk bij een getroffen kaart steeds dezelfde printing, taal, conditie en locatie; foil en nonfoil kunnen naast elkaar bestaan. Voor één bekend collectieregel-ID geeft `/api/read/collection/:id` de opgeslagen afwerking rechtstreeks terug.

Wanneer de CSV dezelfde foutieve afwerking bevat als de pagina, staat die waarde ook in de database. Wanneer beide verschillen, leg dan de exacte kaart, printing, het collectieregel-ID en beide waarden vast voor nader onderzoek. Een databaseback-up kan vervolgens worden onderzocht zonder de live gegevens te wijzigen.

De bestaande onderhoudscontrole op SQLite-integriteit controleert de structuur en verwijzingen. Zij kan niet vaststellen of een fysiek exemplaar werkelijk foil is. Deze versie voegt ook geen historielog toe waarmee eerdere afwerkingswijzigingen kunnen worden teruggedraaid. Zonder een oudere back-up of andere registratie kan de juiste oorspronkelijke keuze niet betrouwbaar uit de huidige gegevens worden afgeleid.

Er is geen algemene garantie op exact één verwerking bij een weggevallen netwerkverbinding nadat de server al heeft opgeslagen. De reparaties blokkeren de gereproduceerde herhaalde frontendacties; algemene API-idempotentie en versiecontroles voor alle overige entiteiten zijn niet toegevoegd.
