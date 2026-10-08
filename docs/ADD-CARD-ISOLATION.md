# Controle kaart toevoegen — versie 2.13.5

Datum: 8 oktober 2026. Uitgangsversie: de eerder opgeleverde 2.13.4-ZIP.

## Onderzocht gedrag

De controle volgt kaart toevoegen vanaf de geselecteerde printing en taal, via preview en identiteitcontrole, tot de collectie-, Wanted- en deckmutaties. De voorwaarde is dat toevoegen van kaart A geen gegevens van een andere kaart B verandert. Hiervoor vergelijken de tests complete rijen vóór en na de bewerking, inclusief aantallen, foil/nonfoil, prijs, notities, kaartmetadata, deckregels, tags, combo's, persoonlijke kenmerken en markeringen.

De bestaande samenvoeging van fysieke exemplaren is gericht op dezelfde combinatie van printing-ID, afwerking, taal, conditie en locatie. Een andere afwerking of printing blijft een aparte collectieregel. Toevoegen aan een bestaande combinatie verhoogt uitsluitend die regel; notities en aankoopprijzen volgen de integriteitscontroles uit 2.13.4.

## Gevonden en hersteld

| Pad | Fout in 2.13.4 | Reparatie |
| --- | --- | --- |
| Frontendselectie | Een vertraagde gebruiksrefresh voor A kon de interne kaartselectie overschrijven nadat B was gekozen. De helper wordt onder meer gebruikt als een toevoegantwoord geen kaartobject bevat. | Antwoorden worden alleen toegepast als formulier, printing, taal, kaartobject en selectieronde nog overeenkomen. Een actie van een oud formulier wordt geblokkeerd. |
| Printingidentificatie | De frontend stuurde voor bekende varianten alleen een lokaal kaart-ID. Een achterhaalde ID-verwijzing werd daardoor niet aan de externe printingidentiteit getoetst. | Waar bekend worden lokaal kaart-ID en Scryfall-ID samen verstuurd en vóór mutaties vergeleken. |
| Externe lookup | De oude resolver kon een extern antwoord eerst opslaan en pas daarna een verkeerde identiteit afwijzen. Een afwijzing betekende dus niet altijd dat andere kaartmetadata onaangetast was. | Alle opgegeven identiteitseigenschappen worden vóór de eerste opslag getoetst. Bestaande printings worden bij toevoegen niet ververst. |
| Batch- en taalimport | Alle ontvangen batchkaarten werden vooraf gecachet, ook ongevraagde of niet-passende records. | Alleen aangevraagde, overeenkomende records worden opgeslagen. Afwijkingen blijven onopgeloste importregels. Naam-, set-, nummer- en toepasselijke taalcontroles worden gecombineerd. |
| Automatische Wanted-printing | De resolver voor precies één printing kon een verkeerd extern antwoord opslaan voordat bleek dat het bij een andere kaart hoorde. | Dezelfde identiteitscontrole wordt vóór opslag toegepast, inclusief de verwachte Oracle-identiteit. |
| Bekende kaartidentiteit | Een upsert kon de Oracle-identiteit van een bestaande printing vervangen of wissen, waardoor verwijzende collectie- en deckgegevens ineens bij een ander kaartconcept leken te horen. | Een afwijkende of ontbrekende Oracle-identiteit bij een bestaande bekende printing geeft een conflict zonder wijziging. Normale regels- en prijsrefresh blijft mogelijk bij dezelfde identiteit. |
| Toevoegen vanuit Wanted | Een verdwenen Wanted-item of een verwijzing naar een andere kaart werd niet vóór toevoegen geweigerd. | De bronverwijzing wordt binnen de transactie gecontroleerd. Ontbrekend geeft 404, een andere kaart 409; de collectie wordt niet aangepast. |
| Printingalignment | Het samenvoegen van printings kon ook ongerelateerde historische combo's met minder dan twee leden opruimen. | Alleen groepen die daadwerkelijk bij de samenvoeging betrokken zijn mogen worden opgeschoond. |

De gereproduceerde selectierace is een latente fout: huidige collectie-antwoorden bevatten doorgaans al een kaartobject, waardoor de extra gebruikslookup dan niet nodig is. Deze bevinding bewijst niet dat de eerder gemelde foil-afwijkingen hierdoor zijn ontstaan.

## Bewust behouden gedrag

- Als **Wanted-aantal automatisch verminderen** is aangevinkt, mag toevoegen het Wanted-aantal van dezelfde Oracle-kaart verminderen. Wanted van een andere kaart blijft ongewijzigd.
- De bestaande automatische deckprinting-afstemming mag voor diezelfde Oracle-kaart een nog niet bezeten printing vervangen door de verkregen printing. Bij toevoegen vanuit Wanted blijft dit beperkt tot de gekoppelde decks. Fysieke collectie-exemplaren van andere printings worden daarbij niet veranderd.
- **Collectie + Deck** voert de gekozen deckactie uit. Wie daarbij expliciet een nieuwe commander kiest, kan daarmee volgens het bestaande gedrag de vorige commander naar het main deck verplaatsen. Dat is onderdeel van die gekozen deckactie, niet van een gewone collectie-toevoeging.
- Het verwerven van bekende kaartmetadata veroorzaakt geen stille refresh van andere records in `cards`. De tijdelijke externe HTTP-responsecache blijft een technische cache; antwoorden daaruit moeten alsnog alle identiteitcontroles doorstaan voordat ze autoritatieve kaart- of gebruikersgegevens kunnen beïnvloeden.

## Tests en grenzen

De nieuwe tests gebruiken geïsoleerde tijdelijke SQLite-databases en echte services, plus de bestaande DOM-testadapter voor frontendinteracties:

- `test/add-card-sideeffects-isolation.test.js`: toevoegen van een nieuwe kaart, een bestaand exemplaar, dezelfde kaart in een andere printing, Wanted-scope, combo-scope en volledige rollback bij een mislukte gecombineerde deckactie.
- `test/add-card-identity-isolation.test.js`: foutieve externe antwoorden, dubbele identifiers, ongevraagde batchrecords en behoud van alle gegevens van kaart B. Legitieme gedrukte namen, alternatieve namen, dubbelzijdige kaarten en niet-Latijnse namen blijven ondersteund.
- `test/add-card-isolation-ui.test.js`: late antwoorden voor A nadat B is gekozen, vervolghandelingen voor collectie/Wanted/deck, oude formulieren en het doorsturen van beide identifiers.
- `test/card-identity-write-guard.test.js`: een bekende Oracle-identiteit kan niet worden vervangen of gewist; een normale metadatarefresh blijft werken.
- `test/add-wanted-printing-isolation.test.js`: bescherming van andere kaarten bij automatische printingkeuze voor Wanted.

De nieuwe foutscenario's zijn waar aangegeven ook uitgevoerd op de oorspronkelijke 2.13.4-broncode om de regressie vast te stellen. De productiegegevens van de gebruiker zijn niet beschikbaar en zijn niet gewijzigd. De tests bewijzen het gecontroleerde gedrag; zij reconstrueren geen eerdere wijzigingen aan fysieke exemplaren.

Eindcontrole: **300 tests, 295 geslaagd, 0 mislukt en 5 overgeslagen**. Er zijn 32 gerichte regressietests toegevoegd. De vijf overgeslagen tests vereisen Express voor HTTP-integratie; die afhankelijkheid is in deze omgeving niet beschikbaar. De onderliggende services en frontendinteracties zijn wel getest. De syntaxcontrole is geslaagd voor alle 110 JavaScript-bestanden. Er is geen visuele browsertest uitgevoerd.

Er zijn geen databaseschemawijzigingen, nieuwe endpointpaden of catalogusherimports nodig. Bestaande API-velden worden strikter gecontroleerd; tegenstrijdige invoer wordt geweigerd. Behoud bij installeren `.env` en `data/`, herstart Node/systemd en controleer versie 2.13.5 via `/api/read/health`.
