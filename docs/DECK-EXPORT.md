# Deckexport — versie 2.16.0

Klik op **Exporteren** op de deckpagina. De popup opent met **Tekst (.txt)**. De tekst is selecteerbaar en kan met **Kopiëren** naar het klembord worden gekopieerd. Als de browser geen klembordtoegang geeft, wordt de tekst geselecteerd en verschijnt een aanwijzing voor handmatig kopiëren. **Downloaden** bewaart exact de getoonde inhoud in een bestand met de passende extensie.

Kies **Forge / Neo Forge (.dck)** voor het gestructureerde Forge-deckformaat. De export betreft het volledige deck; de zoekfilters, sortering en groepering op de pagina beperken de export niet. **Tekort exporteren** blijft de bestaande rechtstreekse TXT-download.

## Inhoud

TXT blijft de bestaande platte lijst: één regel `aantal Engelse kaartnaam`, met gelijke Oracle-kaarten over alle opgenomen deckrollen samengevoegd. Maybeboard wordt overgeslagen.

DCK begint met `[metadata]` en de decknaam en gebruikt deze secties:

| Deckrol | DCK-sectie |
| --- | --- |
| Commander en tweede commander | `[Commander]` |
| Main deck | `[Main]` |
| Sideboard en companion | `[Sideboard]` |
| Maybeboard | Niet opgenomen |

`[Main]` is altijd aanwezig. Lege andere secties worden weggelaten. Elke kaartregel bevat de gekozen printinggegevens, inclusief set en collectornummer:

```text
1 Yedora, Grave Gardener|DSC|[209]
1 Avenger of Zendikar|PLST|[WWK-96]
35 Forest|TRK|[325]
```

De setcode wordt in hoofdletters geschreven; het collectornummer blijft een tekstwaarde tussen blokhaken. Voorloopnullen, letters en koppeltekens blijven behouden. De blokhaken onderscheiden het collectornummer van een numerieke Forge-afbeeldingsindex.

Alleen gelijke naam/set/collectornummer-vermeldingen worden binnen een sectie opgeteld. Verschillende printings van dezelfde kaart blijven afzonderlijk, ook wanneer de deckweergave basic lands samen toont. Main en Sideboard blijven gescheiden.

Vanaf 2.15.0 krijgen basic lands willekeurig gekozen printings uit je collectie. Alleen eigen kaarten met een positief aantal en het type **Basic Land** komen in aanmerking, met exact dezelfde kaartnaam als het land in het deck. Forest, Snow-Covered Forest, Island en Wastes worden nooit onderling vervangen.

De geregistreerde aantallen vormen een voorraadronde: elk exemplaar wordt binnen die ronde maximaal één keer gebruikt, ook over meerdere deckregels of exportsecties. Moeten er meer landjes worden geëxporteerd dan je hebt geregistreerd, dan wordt je eigen voorraad opnieuw gebruikt. Zo blijft het deckaantal volledig behouden. Zijn er van dat land geen eigen exemplaren, dan blijft de oorspronkelijke deckprinting staan.

De randomisatie verandert alleen de exporttekst. De opgeslagen deckregels en je collectie worden niet gewijzigd. Niet-basic kaarten behouden hun gekozen deckprinting. Er wordt geen foil of taal gekozen: deckregels wijzen naar een printing, niet naar een specifiek fysiek exemplaar. De juiste afbeelding vereist dat de gebruikte Forge- of Neo Forge-versie de gekozen set en kaart ondersteunt.

Een nieuwe DCK-aanvraag kan een andere verdeling geven. **Kopiëren** en **Downloaden** gebruiken altijd exact de getoonde tekst; downloaden randomiseert dus niet opnieuw.

Bij ontbrekende setcode of collectornummer, of ongeldige scheidingstekens, stopt de DCK-export met een melding waarin de kaart wordt genoemd. Zo wordt niet stilzwijgend een willekeurige printing geëxporteerd. TXT blijft beschikbaar.

Voor transform-, modal-DFC-, adventure- en flipkaarten gebruikt DCK de naam van de voorkant. Splitkaarten behouden beide namen, bijvoorbeeld `Fire // Ice`. Deze conversie geldt alleen voor DCK: de oorspronkelijke namen in de database en de TXT-export blijven behouden.

## Techniek en controle

- `GET /api/read/decks/:id/export?format=txt|dck` levert `{data:{filename,text,format}}`. TXT is de standaard; een ongeldig formaat geeft 400 en een ontbrekend deck 404.
- `GET /api/read/decks/:id/export.txt` blijft beschikbaar, inclusief `?missing=true`.
- `GET /api/read/decks/:id/export.dck` geeft de DCK-download rechtstreeks terug.
- De export leest bestaande gegevens zonder externe kaartlookup of databasewijziging. Er zijn geen schemawijzigingen of nieuwe schrijf-endpoints.
- Tijdens laden zijn kopiëren en downloaden uitgeschakeld. Wisselen van formaat annuleert het vorige verzoek; laat binnenkomende antwoorden worden genegeerd. Sluiten van de popup annuleert eveneens het verzoek.

Regressietests controleren TXT-behoud, secties en aantallen, afzonderlijke printings, bijzondere collectornummers, kaartnamen, ontbrekende gegevens, lege decks, bestandsnamen, ongewijzigde database-inhoud en het wisselen, kopiëren en downloaden in de popup. Randomisatietests controleren eigen voorraad, scheiding van landnamen, opnieuw gebruiken bij tekort, het ontbreken van voorraad, verdeling over secties en grote aantallen. De volledige testset voor 2.15.0 telt 335 tests: 329 geslaagd en 6 HTTP-tests overgeslagen omdat Express in de ontwikkelomgeving niet beschikbaar is. De syntaxcontrole slaagt voor 114 JavaScript-bestanden. Een echte import in Forge of Neo Forge is hier niet uitgevoerd.

## Geraadpleegde formaatreferenties

De indeling is gecontroleerd tegen de officiële Forge-code en meegeleverde decks:

- [DeckSerializer.java](https://github.com/Card-Forge/forge/blob/master/forge-core/src/main/java/forge/deck/io/DeckSerializer.java): metadata en secties.
- [CardPool.java](https://github.com/Card-Forge/forge/blob/master/forge-core/src/main/java/forge/deck/CardPool.java): regels met aantal en printinggegevens.
- [Cultic.dck](https://github.com/Card-Forge/forge/blob/master/forge-gui/res/cube/Cultic.dck): naamconventies voor transform-, adventure- en splitkaarten.
- [CardDb.java](https://github.com/Card-Forge/forge/blob/master/forge-core/src/main/java/forge/card/CardDb.java): opzoeken via afzonderlijke kaartzijden en serialiseren van set en collectornummer.
- [Forge companion-uitleg](https://github.com/Card-Forge/forge/issues/2235): companion in Sideboard.
- [Neo Forge](https://dokkodolabs.itch.io/neo-forge): gebruikt het standaard DCK-formaat en de Forge-engine.

## Installeren

Vervang de applicatiecode, behoud `.env` en `data/` en herstart het Node.js-proces of de systemd-service. De aangepaste backend moet opnieuw worden geladen om de nieuwe exportverdeling te gebruiken. `/api/read/health` moet daarna versie `2.16.0` tonen.
