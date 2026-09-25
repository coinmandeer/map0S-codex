# MapOS — přehled skutečně vybrané oblasti a rozlišení statistik

## Aktualizace 12. 9. — oblastní odpovědi a statistiky

Aktuální pokračování a důkazy: [AI přehledy a regionální data](2026-09-12-overview-regions-completion.md). Tento záznam má přednost před staršími seznamy chyb níže. Nově jsou propojené LAU–NUTS identity (97 649 obcí / 31 zemí), regionální populace 65+ a HDP, členěný přehled s časnými mapovými referencemi, otázky o vybrané oblasti, volba územního rozlišení a opravený přenos průběžných odpovědí. Praha již dostává AROPE svého NUTS 2, nikoli náhradní údaj za celý stát.

Modelový kontrakt umožňuje validované zdrojové sekce; živá syntéza/web čekají na doloženou alokaci Ollama. Soukromé zdroje, libovolné správní crosswalky, automatická sousední srovnání a celá obecná webová rešerše se nepovažují za dokončené. Publikované věkové údaje znamenají první konkrétní řadu 65+, nikoli celou věkovou strukturu. Přesné nasazení, měření a omezení jsou v odkazovaném předání.

**Historické předání r3:** `20260912-area-overview-statistics-r3`, [veřejná aplikace](https://mapos.promptstudio3000.com). Záloha a obnova 89 tabulek ověřena 12. 9. 2026 v 10:04 UTC; následně veřejná HTTP/SSE, dlaždicová a browser kontrola. Podrobné výsledky a zbývající části jsou dole.

Následující audit zachycuje historický výchozí stav `20260912-ai-statistics-cycling-r5`. Je zachován pro vysvětlení změn, nikoli jako seznam stále otevřených chyb.

## Zjištěné příčiny obecného obsahu

1. Hlavní Discover stále volá `/v2/discover/context` podle středu, zoomu a bbox. `DiscoverPanel.tsx` sice čte `areaSelection`, ale předává ji jen samostatnému OverviewView. Route ani `discover/context.ts` dosud nepřenášejí areaId/revizi hlavnímu průvodci. Kliknutá oblast a oblast získaná reverzním vyhledáním středu proto nejsou garantovaně totožné.
2. `ai/overviewService.ts` pro oblast přidá převážně název, zemi, úroveň a revizi hranic. Přímo uvádí omezení, že oficiální statistiky nejsou připojené. `ai/areaEvidence.ts` přidává jen počty kategorií v neúplném lokálním OSM indexu uvnitř polygonu.
3. `ai/overviewProduction.ts` hledá ověřené jméno ve fact ID končícím `:name` a Wikipedia identitu ve factu `:wikidata`. Oblast poskytuje jiné ID, bez propojeného QID. Obohacení určené pro POI se na ni nepřenese. Samotné zapnutí modelu tento nedostatek neopraví.
4. Discover předává OverviewView souhlas, ale nepředává `web: true`; současný renderer nemá volbu vrstev/webu. Webové doplnění se touto cestou nespustí. Nezapínat je automaticky při pohybu nebo hoveru.
5. Modelová syntéza Overview je zatím výběr až šesti existujících evidence IDs. Webové kandidátní dokumenty nejsou automaticky validovanými fakty a do tohoto výběru nevstupují. Přehled proto nemůže nahradit chybějící regionální fakta delším textem.
6. Průvodce má vlastní collectors a fallback na krátký úvod Wikipedie/Wikivoyage; jejich podklady nejsou plně sdílené s přehledem vybraného polygonu.

## Statistiky: ověřený živý stav

Veřejné `/api/v2/themes/operations`, metadata a tabulkové odpovědi byly přečteny 12. 9. 2026. Existence descriptoru nebyla považována za dokončený import.

| Produkt                                                                                                                     | Skutečně publikovaná úroveň                                                       | Omezení                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AROPE, nezaměstnanost                                                                                                       | NUTS 2 + státy                                                                    | Česko má v ověřené odpovědi 8/8 NUTS 2. Nejde o všech 14 krajů ani obce.                                                                                                                        |
| Populace a hustota 2024                                                                                                     | LAU, obce + národní alternativy                                                   | 62 260 území s nenulovou přítomností číselného údaje (`value IS NOT NULL`), nikoli kompletní Evropa. Inventory uvádí i 97 987 importovaných řádků; ty nejsou všechny skutečně vyplněné hodnoty. |
| HDP na obyvatele, délka života, porodnost/úmrtnost, turismus, lékaři/lůžka, lesní pokryv a další aktuálně publikované série | Převážně státy                                                                    | Jemnější úrovně jsou v katalogu navržené, ale u řady datasetů publication/coverage chybí.                                                                                                       |
| Úmyslná zabití, silniční úmrtí                                                                                              | Aktuálně importované národní varianty                                             | Regionální descriptor není import. Úmyslná zabití nejsou obecná míra kriminality.                                                                                                               |
| NUTS 3 regionální populace/hustota a další řady                                                                             | Dostupné integrační definice, bez doloženého publikovaného importu v tomto auditu | Neslibovat hotové krajské pokrytí.                                                                                                                                                              |

Konkrétní obecní řádky veřejného API: Praha `CZ_554782`, 2024, 1 384 732 obyvatel; Tarragona `ES_43148`, 2024, 141 018 obyvatel. Jde o důkaz obecních dat v MapOS, ne o nově ověřený dnešní počet obyvatel. Bbox kolem ČR vrátil i polskou Vratislav: bbox je výřez, nikoli přesný filtr země.

V ČR NUTS 2 znamená 8 regionů soudržnosti, NUTS 3 znamená 14 krajů, LAU obce. Úrovně mají v jiných zemích jiné správní významy. Zdroj: [Eurostat correspondence tables](https://ec.europa.eu/eurostat/web/nuts/correspondence-tables), [ČSÚ — Praha jako statistická jednotka](https://csu.gov.cz/pha/praha-jako-uzemni-statisticka-jednotka).

## Ověřené chyby výběru zdrojů

- `GET /v2/themes/poverty?zoom=9` vrací `selectedDatasetId=eurostat-poverty-country`, úroveň `country`.
- Tentýž požadavek s `exclude=eurostat-poverty-country` vrací `eurostat-poverty`, úroveň `nuts2`, ready=true, rok 2025.
- Nezaměstnanost na zoomu 9 rovněž standardně vybere státní řadu.
- `themeService.ts` metadata přednostně vybírají country s výjimkou LAU při zoomu >=8. Výběr pro mapové dlaždice má další samostatnou větev navázanou na starý noncommercial flag.
- `themeExplorerService.ts` katalog/tabulka obsahují obdobnou preferenci. Chat ji nyní obchází explicitním vyloučením národního datasetu.
- `discoverPublishedStatistics.ts:17` nadále připouští bez noncommercial flagu pouze country/Natural Earth, i když tematické cesty už dovolují publikované GISCO edice. `catch` navíc mění chybu na prázdný seznam.

Neřešit plošným zapnutím `MAPOS_ALLOW_NONCOMMERCIAL_DATA`. Zachovat ADR 0012 a konkrétní pravidla jednotlivých poskytovatelů; opravit nekonzistentní technický výběr již povolených publikovaných edic.

## Navazující realizace bez změny stylu a rozložení

### P0 — jedna volba skutečného statistického rozlišení

- Sjednotit výběr datasetu pro metadata, katalog, dlaždice, tabulku, detail oblasti a AI. Vstup: ukazatel, publikované dostupné řady, explicitně zvolená úroveň/dataset, oblast/revize, období, zoom a vyloučené zdroje.
- Explicitní úroveň z otázky nebo UI má přednost; jinak vybírat vhodnou skutečně dostupnou podrobnost. Neupřednostňovat stát automaticky, když existuje použitelná regionální řada.
- V současném ovládání ukázat `Úroveň dat: regiony soudržnosti / kraje / obce / státy`, období a pokrytí. Seznam dostupných úrovní odvodit z publikovaných dat, ne všech descriptorů.
- Hranice Discover a hranice statistiky se nemusí shodovat. U konkrétní české obce zobrazit obecní populaci, ale AROPE vyšší oblasti odděleně jako „Údaj za širší region“. Nevyplnit obec krajským číslem jako lokálním měřením.
- Procenta mechanicky neprůměrovat a regionální hodnoty nepřepočítávat podle plochy. Agregovat pouze při kompatibilním zdroji, období a známém správném jmenovateli.
- Chyba databáze/zdroje má vlastní stav; prázdno není důkaz neexistence dat.

### P0 — přesná identita vybrané oblasti ve všech částech panelu

- Additivně rozšířit stávající Discover context o `areaId` a `boundaryRevision`; server je ověří stejným resolverem jako Overview. Tuto dvojici zahrnout do query identity, cache a ochrany před starými odpověďmi.
- Vybraná oblast řídí název, fakta, průvodce a statistiky. Reverzní geokódování středu používat jen bez explicitního výběru, jasně označené jako střed mapy.
- Z boundary identity na NUTS/LAU a Wikimedia přecházet přes ověřené zdrojové vazby/crosswalk. Shodný název ani střed polygonu nejsou důkaz totožnosti.
- Pokud chybí přesná vazba, přiznat omezení a případný širší kontext označit. Nepřiřazovat automaticky nejbližší město.

### P1 — obsahově užitečný přehled oblasti

Znovu použít současnou službu evidence, detailový renderer a guide collectors. Nevytvářet třetí regionální AI pipeline.

1. Okamžitě zobrazit ověřený název, typ, nadřazenou oblast a dostupná lokální fakta/cache.
2. Doplnit relevantní obecní/regionální statistiky s rokem, jednotkou a správnou územní úrovní. Vhodné srovnání se sousedy nebo nadřazenou oblastí nabídnout jen nad srovnatelnou řadou.
3. Přidat charakter území, doložené zajímavosti, výběr významných míst v přesném polygonu a praktické informace. U počtů z lokálního indexu uvést neúplné pokrytí; nepovažovat právě načtené piny za celkový počet.
4. Dostupné obrázky a ověřené Wikimedia odkazy použít bez nového plošného stahování médií.
5. Nabídnout „Jen dostupná data / Doplnit webem“. Externí doplnění pouze po explicitní akci, ve stávajícím rozpočtu; dílčí obsah zůstává při chybě.
6. Modelu předat stejná ověřená fakta; cílem je krátké vysvětlení, čím je oblast charakteristická, nikoli opsání názvu a revize polygonu. Rozšíření tvrzení podmínit validačními pravidly a citacemi, nikoli prostým povolením neověřených webových kandidátů.

### P2 — další skutečné regionální importy

Až po využití již publikovaných dat: prioritizovat české kraje (NUTS 3) a španělské odpovídající úrovně podle přínosu a skutečně dostupných řad. U každé uvést konkrétní zdroj, období, metodiku, pokrytí a vazbu na geometrii. Začít populací/věkovou strukturou a vhodnými ekonomickými ukazateli; obecní chudobu neslibovat bez skutečného zdroje.

## Akceptační scénáře

- Česko → Středočeský kraj → konkrétní obec: stabilní identita vybraného polygonu, odpovídající fakta, odlišně označený regionální kontext.
- Tarragona obec vs. provincie vs. Tarragonès: neztotožnit podle podobného názvu ani středu.
- Chudoba zapnutá přímo z katalogu i přes AI při stejném rozsahu zvolí stejnou dostupnou řadu, rok, legendu a geometrii.
- Obecní populace se objeví v přehledu obce; chybějící obecní AROPE neznamená nulu a nezíská vymyšlenou přesnost.
- Pomalý collector neblokuje první fakta, změna A → B neukáže A v B, cache pro jinou územní revizi se nepoužije.
- Hover/zoom nezakládají modelovou rešerši. Reopen platné cache nemění geometrii a nespotřebuje nové generování.
- Veřejný smoke nad ČR a Tarragonou včetně regionální tabulky, skutečných barev, citací a chybějícího zdroje. Nasazení až po těchto kontrolách; tento audit není nasazení.

## Implementace 12. 9. 2026 — průběžný záznam

Výše uvedený audit je výchozí stav. Následující změny jsou již implementované; stav veřejného vydání a importů bude doplněn po ověření.

- `themes/selectDataset.ts` sjednocuje volbu publikované podrobnosti pro metadata, dlaždice a tabulku. Při přiblížení se používají skutečné regionální řady; chybějící jemná řada nezakryje dostupnou vyšší. Období metadat se odvozuje od vybrané řady, takže novější národní rok nevrátí mapu skrytě na státy.
- Discover přenáší ID/revizi oblasti a ověřuje je před cache. Výběr nahrazuje reverzní geokódování. Změna oblasti odstraní neodpovídající předchozí obsah; posun při nezměněném výběru nezakládá nový dotaz.
- Publikované statistiky se připojují podle kódu a edice. Kontext vyšší úrovně vyžaduje pokrytí celého polygonu. Obecní údaj a širší region jsou označené odděleně; chybějící hodnoty se nezobrazují jako nula. Chyba SQL se nevrací jako úspěšný prázdný seznam. Dotaz má limit 2,5 s a podporuje zrušení.
- Stejná data používá přehled AI. Lokální počty, pojmenovaná zajímavá místa a statistiky se publikují nezávisle. OSM výběr se filtruje polygonem před limitem a zůstává označený jako neúplný lokální index.
- Česká a španělská obec se může propojit s Wikimedia přes úřední kód, zemi a jednoznačnou shodu. P7606 = český obecní kód, P772 = španělský INE kód. Bez shody se nepoužije stejnojmenné místo. Vyhledání identity používá společný omezený transport/cache.
- Volba „Jen dostupná data / Doplnit webem“ používá existující OverviewSession. Samotná změna volby nespouští generaci. Otevření návštěvnického přehledu čeká na sdílenou inicializaci relace.

### Dosavadní důkazy

- 67 cílených testů: metadata/dlaždice, rozdílná období, výběr oblasti místo středu, revize cache, přepnutí a pohyb, rozlišení lokálních/regionálních údajů, odmítnutí shody podle názvu, SSE přehled.
- API a web sestavení úspěšné; kontrola hranic architektury, CSS tokenů a úniku tajemství prošla.
- Živý read-only SQL nad Tarragonou: obecní populace 141 018 a hustota 2 517,44/km² (2024), regionální AROPE 21,3 % a nezaměstnanost 8,4 % za Katalánsko (2025). Čas kontrolního SQL 891 ms; není to měření celé UI pipeline ani p95.
- Živý join úředních kódů: CZ_554782 → Q1085 (1 648 ms), ES_43148 → Q15088 (806 ms). [Český obecní identifikátor](https://www.wikidata.org/wiki/Property:P7606), [INE identifikátor](https://www.wikidata.org/wiki/Property:P772).
- Předběžné načtení NUTS 3 populace Eurostatu: 40 802 pozorování, nejnovější rok 2025. Toto samo o sobě není publikovaný import.

### Dosud neuzavřené části

- Úplný automatický crosswalk libovolných geoBoundaries krajů/okresů na oficiální statistické jednotky a Wikimedia. Vnitřní geoBoundaries kód se nesmí vydávat za oficiální územní kód.
- Věková struktura a další nové regionální ekonomické řady; chudobu za obec neodvozovat z regionálního procenta.
- Automatická srovnání se sousedy, plošně připravená média oblastí a volná generativní syntéza nad validovanými tvrzeními nadále nejsou touto opravou dokončené.
- Referenční p95 pro všechny první fáze, plná mobilní/content eval matice a dlouhodobá zátěž nejsou nahrazené jednotkovými testy ani jedním SQL měřením.

### P2 — první skutečně publikované regionální rozšíření

Po ověřené záloze vydání r1 proběhl standardní verzovaný import GISCO NUTS 3 (2024): **1 345 hranic, 0 přeskočených**. Následoval atomický import `eurostat-demo-r-pjanaggr3` (40 802 řádků, 1990–2025) a `eurostat-population-density` (34 215 řádků, 2000–2024). Počet importovaných řádků není počet obcí ani počet nenulových měření.

Kontrola přesného joinu kódu/edice v PostgreSQL:

| Země      |    Populace NUTS 3, 2025 | Hustota NUTS 3, 2024 |
| --------- | -----------------------: | -------------------: |
| Česko     | 14 / 14 číselných hodnot |              14 / 14 |
| Španělsko | 59 / 59 číselných hodnot |              59 / 59 |

Kontrolní populační hodnoty: Praha CZ010 1 397 880, Středočeský kraj CZ020 1 466 215, statistický region Tarragona ES514 875 530. Poslední údaj není populace obce Tarragona. Španělské NUTS 3 nelze mechanicky přejmenovat na všechny administrativní provincie, protože zahrnují také odlišné ostrovní členění.

Zdroje a metodika: [Eurostat populace NUTS 3](https://ec.europa.eu/eurostat/databrowser/view/demo_r_pjanaggr3/default/table), [Eurostat hustota NUTS 3](https://ec.europa.eu/eurostat/databrowser/view/demo_r_d3dens/default/table). Příslušné manifesty/importní účtenky uchovávají edici a skutečné pokrytí. Věková struktura a další ekonomické série zůstávají další etapou P2.

### Nálezy z reálné kontroly UI

- Výběr obce El Catllar odeslal `ES_43043` a konkrétní revizi hranic, přestože souřadnice mapy ještě ukazovala na předchozí centrum. Server i záhlaví správně zobrazily El Catllar. Tím je ověřen přenos skutečné identity, nikoli pouze fixture.
- Územní rozsah čísla byl v původním rendereru schovaný v informační ikoně. Nově je název rozsahu a rok přímo pod hodnotou. Jednotky nejsou vynechané ani u publikovaných sérií mimo původní krátký seznam.
- Stručný přehled oblasti dostává lokální populační fakta a jasně označený širší kontext bez modelového volání. Lokální statistiky mají v omezeném seznamu faktů přednost před počty kategorií OSM.
- Při výpadku se uvádí konkrétní nedokončený collector, nikoli tvrzení, že všechny údaje chybějí. Zachované výsledky zůstávají viditelné.
- Cílená sada po těchto úpravách: **69 testů prošlo**. Kontroly architektury, CSS tokenů a tajemství opět prošly.
- Během sestavování r2 byla na sdíleném VPS zjištěna souběžná sestavení jiné aplikace, dostupná RAM přibližně 412 MiB a vyčerpaný 4GiB swap (09:54 UTC). Časy během tohoto intervalu nejsou referenční výkonové měření aplikace. Testovací prohlížeč byl dočasně odpojen od sítě, aby nezvyšoval zátěž.

Provozní oprava vydání: `scripts/deploy-vps.sh` nově sestavuje API a web postupně. Záloha, obnova, kompatibilita a atomické přepnutí zůstávají stejné. Důvodem je doložená souběžná paměťová zátěž na sdíleném 8GiB VPS, nikoli odhad podle velikosti frontendového balíku.

Dodatečná SQL optimalizace: výběr míst nyní používá existující GiST index nad `osm_pois.geog` (bez převodu indexovaného sloupce před bbox filtrem). Statistická geografie má explicitní předfiltr přes existující `geo_units.geom` index. Přesný `ST_Covers` zůstává zachovaný po tomto předfiltru. Živá kontrola El Catllar: 3 zdrojové záznamy zajímavých míst, 55 ms. Nejde o procentuální benchmark před/po, protože původní timeout vznikl během souběžného přetížení hostu.

Nasazení r2 bylo přerušeno ve fázi sestavování při přetížení hostu. Aktivní vydání zůstalo r1 a publikované statistiky zůstaly zachované. Finální r3 používá postupné sestavení. Žádné ostatní aplikace nebyly zastavené, konfigurace swapu se neměnila.

## Předání vydání r3

| Výsledek                                                     | Implementováno                        | Ověřeno                                                                      | Nasazeno                 |
| ------------------------------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------- | ------------------------ |
| Společná volba publikovaného rozlišení a období              | ano                                   | metadata + dekódované živé MVT + testy                                       | r3                       |
| Vybraná oblast místo středu, cache podle revize              | ano                                   | El Catllar UI; Praha/Tarragona HTTP; 1 dotaz při výběru, 0 dalších po posunu | r3                       |
| Oblastní fakta, místní místa a statistiky v krátkém přehledu | ano                                   | živé SSE bez modelu; citace a zachované výsledky                             | r3                       |
| Úřední kód → Wikimedia pro obce CZ/ES                        | ano                                   | živý join Praha/Tarragona; hlavní guide vrací `extract`                      | r3                       |
| Viditelný rozsah, jednotka a rok čísla                       | ano                                   | desktop 1280×720, mobil 390×844, bez horizontálního přetékání                | r3                       |
| NUTS 3 hranice/populace/hustota                              | ano                                   | 14/14 CZ a 59/59 ES v kontrolovaných letech, MVT geometrie s hodnotami       | publikovaná data         |
| Ostatní správní crosswalky, sousední srovnání, věkové řady   | částečné / další etapa                | nepovažovat za dokončené                                                     | ne                       |
| Volná modelová syntéza                                       | zachována existující rozpočtová brána | aktuální zdrojový režim funguje bez modelu                                   | bez nové aktivace modelu |

Veřejné měření z jednoho běhu Chromium na výše uvedeném desktopovém viewportu, přes skutečnou veřejnou adresu (nikoli fixtures):

| Cíl            | Discover bez teplé výsledkové cache | Teplá serverová cache | První přehled SSE bez modelu |
| -------------- | ----------------------------------: | --------------------: | ---------------------------: |
| Praha, LAU     |                              796 ms |                 44 ms |                       188 ms |
| Tarragona, LAU |                              682 ms |                 40 ms |                        69 ms |

Jde o jednotlivá měření, **nikoli p95**. První měření může využívat cache jednotlivých upstreamů; nenazývat je úplně studeným internetovým testem. SSE bez modelu končí jako `partial` se zachovanými doloženými fakty; chybějící aktivace modelu není vydávána za dokončenou modelovou rešerši.

[Důkazy HTTP/SSE](../evidence/2026-09-12-area-overview/public-check.json), [dekódované MVT](../evidence/2026-09-12-area-overview/tile-check.jsonl), [ověření regionálních importů](../evidence/2026-09-12-area-overview/regional-import.txt), [obnova zálohy](../evidence/2026-09-12-area-overview/restore.txt).

Historické omezení r3, **opravené oficiálním crosswalkem v navazujícím vydání**: LAU polygon Prahy se kvůli odlišné generalizaci přesně nepokryje NUTS polygonem. Proto její přehled zatím může nabídnout označený státní AROPE; mapa NUTS 2 současně správně obsahuje Prahu s hodnotou 9,1 % (2025). Toto je chybějící ověřený crosswalk, nikoli absence regionálního měření. Nepovolovat toleranci překryvu jako skrytou náhradu oficiální vazby. Tento navazující import a verzovaná kontrola jsou nyní publikované, viz aktuální předání.

Další drobné produktové úkoly: rozmanitější výběr míst do úvodu při duplicitách lokálního OSM indexu a důsledný překlad všech providerových jednotek/kategorií. Nelze slučovat odlišné entity jen podle stejného názvu. Širší matice témat, podkladů, přístupnosti a dlouhodobých výkonových měření zůstává samostatnou kontrolou; tento smoke ji nenahrazuje.
