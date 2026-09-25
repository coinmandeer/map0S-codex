# Implementace mapOS: integrace, společné hledání a AI mapa

Pracovní stav k 24. 9. 2026. **Hlavní AI tok a dodané integrace jsou nasazené a živě ověřené ve vydání `20260924-ai-integrations-r5`.** Celý původní datový plán dokončený není; přesná omezení jsou níže.

## Aktualizace podle navazujícího zadání

Uživatel potvrdil, že limity vynucují poskytovatelé. Produkce používá `MAPOS_PROVIDER_BUDGET_MODE=provider`: Mapy a Foursquare nečekají na interní alokaci ani na databázové účtování. Zůstává rušení požadavků, cache, validace operací, reakce na odmítnutí poskytovatele a samostatný režim pro AI. Předchozí požadavek na doložení kreditů Mapy je zrušený. **Výjimkou je Google: uživatel následně výslovně požadoval nulové doplatky. Google Tiles proto nikdy neobchází ověřenou alokaci a zůstává vypnutý. V konzoli je ověřený účet Free Trial; bez ručního přechodu na Paid Google platby nestrhává. Places UI Kit má samostatné časově omezené povolení do 20. 12. 2026, před koncem současné zkoušky. Po ručním přechodu na Paid tato verifikace přestává platit; promo kredit ani upozornění rozpočtu nejsou limitem placeného účtu.**

- Dodané klíče jsou uložené pouze v serverovém env, s neveřejnou zálohou. Ticketmaster secret a OKAPI consumer secrets se pro veřejné čtení nepoužívají a nepředávají do aplikace.
- Google Places UI Kit v produkčním prohlížeči skutečně zobrazil Alcazabu v Málaze s oficiální atribucí. Test čistého refresh a levého panelu také prošel; oba scénáře bez JS chyb. Následný skutečný klik na kartu Google ověřil předání výběru mapě a zavření nabídky (3,5 s). Google podklady zůstávají vypnuté.
- Živě z VPS ověřeno: FIRMS CSV; OpenAQ, OCM, eBird a Ticketmaster vracejí záznamy; OKAPI DE/PL/US/UK vracejí keše. U UK bylo nutné opravit kódování URL parametrů.
- Po úpravě účtu Google Map Tiles nově vrací `API_KEY_HTTP_REFERRER_BLOCKED` (dříve `API_KEY_SERVICE_BLOCKED`); pro serverové volání je potřeba klíč omezený na IP VPS a Map Tiles API. Kontrola konzole prokázala, že dodaný klíč je již browser klíč omezený na `*.promptstudio3000.com/*` a sedm služeb včetně Places UI Kit, ale bez Map Tiles API. Je přesunut do konfigurace browser klíče; serverový klíč zůstává prázdný.
- Doplněn archiv sezení a obnovení z archivu. Historie ani její obnova nevolají model. Ruční i automatické zapnutí vrstev používá společné katalogové akce a selektivní undo.
- Statistické odpovědi nově vracejí také standardní mapový artefakt s generalizovanými publikovanými hranicemi, nulami/nodata, jednotkou, rokem a původem. Rozpoznání zemí není omezené na Evropu.
- Kontrola VPS nyní ukazuje 31 GB volných; dřívější nedostatek místa už neblokuje nasazení.
- Ověření před nasazením: API 818 testů (816 prošlo, 2 přeskočené), SDK 198, web 585 (578 prošlo, 7 přeskočených); 23 prohlížečových scénářů a následný cílený scénář archivace prošly. Typy, lint, formátování, kontrola tajných údajů, hranice architektury a sestavení prošly. OKAPI kódování má dalších 7 cílených testů.
- Vydání r3 prošlo sestavením, obnovou databázové zálohy, migracemi, kontrolami vlastnictví a veřejné identity nasazení. API i web jsou zdravé.
- Živý model nad produkčním API: dotaz na výlet u Málagy z výřezu Prahy vytvořil skutečný pěší okruh 4 064 m / 4 960 s / 437 souřadnic za 9,8 s. „Přidej kavárnu“ vložilo Café Negro, zachovalo konce a přepočítalo trasu na 4 097 m za 1,8 s.
- Noční dotaz na Málagu za 0,8 s zapnul tmavý podklad, atlas jasu, noční světla a oblačnost, se skutečným časem astronomické noci Europe/Madrid. Internet v Brazílii vrátil polygon a 84,46 % za rok 2024 za 0,3 s.
- Opravena prázdná odpověď hledání míst při studené OSM cache: omezený Mapy fallback, předání ověřené cílové oblasti, správná ID kategorií a preference pojmenovaných zastávek.
- Poslední oprava keší: databázová podmínka času používala neenkódovaný Date a rušila celou transakci. Používá typovaný operátor; filtr zdrojů se aplikuje před načítáním i limitem výsledků. Produkční HTTP rozhraní po opravě vrací keše (5 výsledků ve vybraném výřezu Londýna, 325 ms).

## Nasazené vydání r5

Nasazení `20260924-ai-integrations-r5` dokončeno. API, web i databáze jsou zdravé; identita veřejného vydání, obnova zálohy, migrace a kontroly vlastnictví prošly.

Živé ověření po nasazení:

- Tři produkční prohlížečové scénáře prošly: hledání/refresh/levý chat, skutečný Places UI Kit a ovládání nové sezónnosti vody.
- Noční dotaz u Prahy: 1,0 s, registrovaný rastrový artefakt i bodové výsledky načtené přes autorizované rozhraní (HTTP 200).
- Skutečný model přesunul Karlův most za Valdštejnskou zahradu, zachoval start/cíl a vypočítal pěší trasu 2 775 m / 112 souřadnic za 3,9 s. Historie dostupná HTTP 200.
- Živý GBFS v3 feed Bolt Brusel vrátil 5 110 aktuálních vozidel; v2 Lime odpověděl korektně prázdnou sadou. Filtrace vozidel ověřena jednotkově.

- Registrované rastrové vrstvy mají standardní artefakt konverzace, stabilní ID a ověřená metadata; vykreslují se existujícím katalogovým rendererem. Numerické hodnoty se z RGB dlaždic neodvozují.
- Model může upravit neuložený draft nástrojem pro plánové příkazy. Dávka je atomická, chrání koncové a zamčené body a odmítá nedoložená místa; následně proběhne skutečné trasování. Uložení zůstává samostatná akce.
- GBFS doplněno o bezstanicová vozidla, JRC o sezónnost a změny výskytu vody. Každá nová vrstva má hledání, AI metadata a zdrojové omezení.
- Globální historický atlas jasu: originál na VPS, SHA-256 `9725566ed4fcf1a8fa311654143bb024c4fe2a792b85356be99adce07e1e83c1`, ověřené bodové čtení na třech kontinentech a správné „bez dat“ mimo pokrytí. Konfigurace dalšího vydání používá globální soubor.
- Typy API/web, API i web jednotkové sady, SDK, lint a formátování prošly; cílená sada artefaktů a modelových editací: 36/36.
- [Podrobný závěr Google EEA](2026-09-24-google-eea-integration.md): podpisový secret se nepoužívá. Stávající doménový klíč nesplňuje serverové Tiles volání; EEA satelit/3D vyžaduje samostatný Google JS renderer. Places UI Kit už funguje.

## Zapojené změny

### Čistý start a hledání

- Start nepřebírá viditelnost vrstev, kategorií, presetů ani aktivní plán ze starých úložišť; nemaže účet, uložené plány a konverzace. Přepínání světů uchovává vrstvy jen v paměti stránky. Vypne také 3D a obnoví běžný svět.
- Běžné zapínání vrstev nezapisuje jejich konfiguraci do URL. Explicitní sdílené vrstvy/preset/statistiky se spotřebují při prvním otevření. Výchozí režim automaticky nezapíná primární vrstvu.
- SDK obsahuje katalog včetně kategorií a českých metadat, lokální hledání s diakritikou, synonymy, názvy skupin a překlepy. Našeptávač používá katalogové přepínače a posuvníky; kavárny aktivují příslušnou kategorii.
- Starý inline AI náhled odstraněn. Hledání otevírá levý konverzační panel; seznam historie, nové sezení a hledání názvů sezení.
- Autocomplete má debounce a rušení; explicitní odeslání používá stejný mechanismus proti opožděným odpovědím. Nominatim není volán při psaní, explicitní fallback má sdílený interval 1,1 s a povolenou cache.
- MapTiler browser geocoding jako záložní zdroj, s atribucí a zrušením požadavku. Vyžaduje `MAPTILER_FREE_CAP_VERIFIED=1` nebo explicitní režim limitů poskytovatele.

### Konverzace, výsledky a plánování

- Migrační soubor 0026: úplná historie oddělená od modelového kontextu, scéna a privátní artefakty. Vlastnická autorizace, porovnání revize, stránkovaný seznam, archivace a smazání. Mazání účtu kaskáduje; smazané sezení nelze obnovit opožděným artefaktem.
- Migrace zachovaných starých konverzací: pouze skutečné raw zprávy a citace; zkrácená minulost se označí, nevymýšlí se karty/scéna.
- Zavření panelu nezastaví běh. Přepnutí sezení zastaví starý běh a obnoví uloženou mapu bez volání modelu. Prázdné sezení nepřebírá staré výsledky ani vrstvy. Opraveno vykreslení artefaktů při obnově za načítání podkladu.
- Ruční změny mapy se po zklidnění ukládají do otevřeného sezení i při zavřeném panelu; ukládání se slučuje a serializuje. V panelu je přejmenování a smazání konverzace, samostatně uložené plány zůstávají.
- Přenos validovaného `MapContextSnapshot`: podklad, vrstvy, průhlednost, filtry, čas, oblast, revize plánu. Model dostává jen povolené vrstvy, souřadnice dle souhlasu.
- Běhy mají trvalou admission evidenci podle vlastníka a clientRequestId: souběžné opakování nevolá model znovu, dokončený běh se přehraje a smazané sezení se neobnoví. `MapScenePatch` se skutečně posílá a provádí, včetně kategorií, průhlednosti, času a skrytí nesouvisejících vrstev.
- Ověřené zastávky se zobrazují už před výpočtem trasy. Průběžné a konečné artefakty sdílejí ID; konečný výsledek nepředbíhá uložení scény.
- Scéna ukládá odkazy na velké artefakty, jejich načtení ověřuje vlastníka i příslušnost k sezení.
- Události streamu mají runId, sequence a revizi. Klient zahazuje opakované/opožděné události a cizí běhy. Artefakt se kontroluje proti sezení, běhu a revizi.
- `MapResultArtifact`: šest geometrií včetně polygonových otvorů a multipolygonů, omezené styly, numerické legendy, jednotky, čas, stav bez dat a původ. Zvýraznění karta ↔ bod, škály a zdrojové odkazy. Velké výsledky se načítají přes autorizované rozhraní.
- Zapojené výstupy: ověřené body, omezený výstup registrovaných datových vrstev přes query_layer (včetně mřížky NOAA s nulou/nodata a polygonových otvorů GDACS) a geometrický nástroj pro požadovaný vzdálenostní okruh. Okruh je výslovně odvozený geodetickým výpočtem, rozděluje se přes datovou hranici a nevydává se za izochronu. Model nezadává libovolnou geometrii.
- Mapová scéna obsahuje i oblast, čas a statistiku. Vrácení porovnává jednotlivá změněná pole, aby zachovalo pozdější ruční zásahy.
- Výslovné místo se ověří před hledáním zastávek/trasováním; Málaga přebije Prahu. `resolve_location` aktualizuje i kontext dalších nástrojů.
- Mapy matice max. 10×10, návrh pěšího okruhu a vkládání zastávky podle zajížďky. Fallback porovná omezené skutečné trasy. Pokud délka nesplní 2–4 h, odpověď to přizná.
- Skutečné trasování po úsecích, úplné metriky a geometrie ve výsledku i draftu; Douglas–Peucker se zachováním konců. Hlášený zákaz přístupu/uzavírka se neobchází změnou poskytovatele.
- „Přidej kavárnu“ zachovává dopravu, konce a pořadí včetně zámků. Další deterministické editace: přesný název/číslo zastávky pro odebrání, přesun na pozici, přejmenování a změna profilu. Nejasná editace vyžaduje upřesnění.
- Uložení plánu je samostatná akce nad pracovní kopií; běžné úpravy chatem nepřepisují uložený plán.

### Google, rozpočty a noční obloha

- AI katalog rozlišuje nakonfigurované, neověřené a chybující poskytovatele podle posledních požadavků; Google také podle dostupné ověřené alokace. Zatím nejde o úplný sdílený katalog zdraví všech zdrojů.
- Google terrain session, samostatná satellite capability, single-flight sessions, předčasná obnova a jeden kontrolovaný pokus po odmítnutí tile nebo viewport session. Každý skutečný tile request čerpá rozpočet.
- Cache-Control/ETag převzaté od poskytovatele; dynamická viewport atribuce a omezení zoomu, záložní podklad při selhání atribuce.
- Oficiální Places UI Kit jen po „Dohledat přes Google“. Zachovává komponentu a atribuci, předává pouze validní vybrané souřadnice; názvy/recenze/fotky neukládá do AI/databáze. Samostatný doménově omezený browser klíč; povolení přes ověřený hard cap nebo `GOOGLE_PLACES_TRIAL_VERIFIED_UNTIL` pro doložený Free Trial. Trial povolení po datu automaticky končí; není platné pro účet ručně převedený na Paid. CSP povoluje konkrétní SDK hosty.
- Mapy serverové dlaždice, hledání, trasy, elevace a matice nyní používají limity poskytovatele podle výslovného navazujícího zadání.
- Noční asistent při nezadaném čase volí první hodinu nejbližší astronomické noci. U nejvýše tří doložených kandidátů porovnává skutečně dostupný atlas, oblačnost a Měsíc; chybějící data uvádí zvlášť.
- SunCalc 1.9 + Open-Meteo: místní astronomická noc, Měsíc a hodinová oblačnost, čas z ovladače, zrušení požadavku. Po půlnoci se použije probíhající noc. Doložené vyhlídky k ověření přístupu, bez fiktivního skóre.
- Předání serverových klíčů/flagů v compose pro Google, NASA FIRMS, OpenAQ, OpenChargeMap, eBird a Ticketmaster; hodnoty nezveřejněny.

### Nové aktivovatelné datové vrstvy

| Zdroj                    | Zapojený rozsah                                                                           | Ověření / omezení                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESA WorldCover           | 2021 v200, 10 m, oficiální Terrascope WMTS, úplná legenda tříd a citace                   | Živá capability + PNG/CORS. Funguje KVP, inzerovaný REST vracel 400. Raster pouze pro zobrazení.                                                                                                                                                                                                                                    |
| NOAA SWPC                | OVATION, čas předpovědi, 1° mřížka / označené maximum větší buňky, barevná legenda        | Živá veřejná mřížka, validace nuly/času/souřadnic; starší než 3 h odmítnuta.                                                                                                                                                                                                                                                        |
| JRC Global Surface Water | Výskyt vody 1984–2024 v1.5, 30 m, oficiální procentní legenda                             | Živá WMTS a PNG/CORS. Historie, nikoli aktuální povodně. Doplněna seasonality 2024 a change 1984–1999 vs 2000–2024, oficiální legendy a ověřené PNG/CORS.                                                                                                                                                                           |
| GEBCO                    | Globální reliéf a hloubky 2026, 15″, WMS EPSG:3857 a oficiální legenda                    | Živá capability a PNG/CORS. Zobrazení, zatím bez numerického point query; nevhodné pro navigaci.                                                                                                                                                                                                                                    |
| Falchi / GFZ atlas       | Bodové čtení a omezená vzorkovaná mapa historické umělé složky jasu, mcd/m²               | Test skutečného Float32 GeoTIFF; CC BY-NC 4.0 doložena DOI metadaty. Originál stažen; výřez Málagy 522 kB ověřen čtením bodů. Globální originál nahraný na VPS, SHA-256 souhlasí; čtení Prahy, Málagy a Tokia ověřeno. Rozsah přibližně 60° j. š. až 85° s. š. Globální soubor aktivní v r5; regionální soubor zůstává jako záloha. |
| SoilGrids 2.0            | pH, organický uhlík, jílovitost; 0–5 cm, model 250 m, WMS s oficiálními legendami         | Všechny tři PNG a CORS ověřeny živě. Zatím zobrazení, nikoli WCS numerické dotazy.                                                                                                                                                                                                                                                  |
| GDACS                    | Události posledních 7 dní, poslední epizoda, nejvýše 3 modelové polygony v místním výřezu | Živá data, validace polygonových otvorů a browser scénář; omezené pokrytí a čas viditelné.                                                                                                                                                                                                                                          |
| Open-Meteo marine        | Jeden modelový bod: vlny, perioda, teplota moře a čas                                     | Živý dotaz u Málagy, test jednotek, nuly a stáří; nejde o plošnou interpolaci.                                                                                                                                                                                                                                                      |
| NASA POWER               | Bodová klimatologie sluneční energie, teploty a srážek                                    | Živý dotaz, perioda 2001–2020 dodaná zdrojem, test nodata a jednotek.                                                                                                                                                                                                                                                               |

Tyto vrstvy jsou v katalogu i slovníku AI a mají zdroj a časové/účelové omezení.

World Bank: odstraněn filtr omezující import na Evropu. Aktuální seznam 217 ekonomik ze zdroje vylučuje agregáty; test pokrývá několik kontinentů i Namibii. Přidány indikátory přístupu k elektřině a používání internetu do existujícího statistického importu, témata/rok/jednotka navazují na stávající systém. Produkční import dokončen: každý z obou indikátorů má 5 642 hodnot z období 2000–2025 (celkem 11 284). Brazílie ověřena skutečným AI dotazem.

geoBoundaries: projekt již má country-specific gbOpen import ADM1/ADM2, vydání dle boundaryID a metadata licence, testy znovu prošly. GBFS nyní vybírá země podle importovaných globálních hranic (na VPS 240 geometrií / 237 kódů). Připojuje station_status a system_information, počty přijímá jen do pěti minut stáří, uchovává licenci/atribuci operátora. Chybějící hranice jsou explicitní omezení. Doplněny GBFS v3 vehicle_status a v1/v2 free_bike_status: pouze čerstvá, volná a funkční vozidla mimo stanice, s původem a licencí provozovatele. Úplnost globálního pokrytí není zaručená.

## Dosavadní ověření

- SDK, API a web typové kontroly, všechny jednotkové sady, lint a formátování prošly. Poslední API sada: 822 testů, 820 prošlo, 2 přeskočené; dalších 8 cílených kontrol cache a Google gate prošlo.
- Prohlížeč: **23 scénářů, 23 prošlo** po přechodu historie na odkazy artefaktů. Fixture API; nejde o ověření živého modelu nebo účtu Google.
- Ověřeno ukládání ruční průhlednosti → čistý refresh → obnovení konkrétního sezení bez nového modelového dotazu; polygonové otvory GDACS; selektivní undo; ochrana cizích artefaktů.
- Produkční migrace 0026 včetně idempotence běhů vyzkoušena v transakci s ROLLBACK. Zachytila 20 starých zpráv; produkční schéma tím nebylo trvale změněno.
- Produkční API/web build, architektonické hranice, CSS a inventář zdrojových práv prošly; závěrečné rozšířené release kontroly jsou v `output/release/checks/`.
- Produkční trasa Málaga, následná kavárna, noční obloha, statistický polygon i načtení historie jsou ověřené živými požadavky. Produkční prohlížeč ověřil hledání vrstev, čistý refresh a levý AI panel bez JS chyb.
- Široká prohlížečová sada v posledním lokálním release běhu nenastartovala paměťový API server v sandboxu; není vykazována jako úspěšná. Předchozí cílené scénáře a produkční kontroly jsou uvedeny samostatně.

## VPS a konfigurace

- SSH funguje; nasazení `/opt/ps3000/apps/mapos-main/current`. Aktuálně běží `20260924-layer-category-isolation-r6`; API i web jsou zdravé.
- Při nasazení r5 zbývalo 28 GB volných / 96 GB. Cizí aplikace, Sauto verze ani Agent Zero `.time_travel` nebyly upravené.
- Dodané klíče a čtyři národní OKAPI klíče jsou v serverovém env. Foursquare a Mapy zachovávají původní klíče. Hodnoty klíčů se nevypisují.
- Google Tiles je explicitně vypnutý. Browser přístup má ověřený dočasný Free Trial; datum vypnutí `2026-12-20T00:00:00Z`. V konzoli nebyl proveden upgrade ani změna fakturace. Denní kvóta 100 000 dlaždic není měsíční bezplatný limit a nebyla v konzoli upravitelná.
- První pokus o vydání `20260924-ai-integrations-r1` skončil při sestavení webu kvůli chybějícím typům nového ovládání vrstev; stará produkce zůstala aktivní. Typy byly opravené a všechny následující kontroly prošly.
- Vydání r2 i r3 úspěšně nasazená; r3 přidalo opravy z živého AI průchodu. Každé vydání ověřilo obnovu zálohy, migrace a zdraví služby. R4 je úspěšně nasazené s opravenou cache keší a dočasným Google hledáním. Záloha a její obnova ověřené.

## Zbývající práce (není dokončeno)

1. Registrované rastry jsou nově napojené na konverzační artefakty: pouze známé katalogové ID, stabilní identita, původ, čas a legenda; žádné modelové URL nebo vymyšlené numerické hodnoty. Statistická území už mají standardní mapResult s hodnotami, jednotkami a hranicemi. Registrované vektorové vrstvy už vracejí validované mapResult přes query_layer, včetně GDACS a NOAA. Vypočtená trasa má nyní samostatný plánovací výstup; společný artefakt generuje body, geometrický radius a registrované vektorové výsledky.
2. Úplná metadata všech starších vrstev a statistických témat, sdílené zdraví poskytovatelů. Interní rozpočty ostatních poskytovatelů nejsou podle nového zadání překážkou ani zbývajícím úkolem; Google má výjimku kvůli následnému požadavku nulových doplatků. Nové zdroje již mají společné jednotky, čas, pokrytí a schopnosti v SDK/UI/AI.
3. Plná práce s plánovacími omezeními (například časový cíl nebo vynechání schodů); základní modelové editace pracovní kopie jsou již doplněné atomickou dávkou, včetně kontroly zámků, konců a doložených ID míst; samostatná kontrola undo po pomalé aktivaci statistiky (callback již doplněn). Stránkování zpráv uvnitř sezení zbývá; UI archivu je doplněné.
4. Živé ověření Google Tiles atribuce/zoom a trvalého nulového doplatku po skončení Free Trial; Places UI Kit je živě ověřený. Google Map Tiles API oprávnění a samostatný serverový klíč omezený na IP VPS. Browser klíč již ověřen. Ostatní dodané klíče jsou živě ověřené; interní alokace není vyžadována.
5. GFZ: originál a skutečný regionální výřez jsou připravené lokálně s licencí a SHA-256; výřez, manifest a licence jsou uložené na VPS v `/opt/ps3000/apps/mapos-main/data/sky-atlas/`, SHA-256 odpovídá místnímu souboru. Svazek je připojený a regionální vrstva aktivní, ověřená AI dotazem. Globální originál byl následně nahrán a ověřen, globální soubor je aktivní v r5. Novější noční kompozity zbývají.
6. FSQ OS Places: přístup Places Portal/Iceberg, regionální import a sloučení s OSM/Overture. Places enrichment zůstává oddělený a používá limity poskytovatele. Overture import nyní zachovává geometrii budov i původ, má geografický/paměťový limit a dry-run; skutečný DuckDB/tippecanoe import nebyl proveden.
7. Zbývající data: širší průzkum GBFS pokrytí, SoilGrids WCS, GEBCO numeric a HDX. Nové podrobnější geoBoundaries regiony vyžadují vybrané importy; globální země a oba nové ukazatele World Bank již v produkci jsou.
8. Kompletní široká release browser sada (cílených 23 scénářů prošlo); základní produkční AI průchod a nasazení jsou ověřené. Pracovní strom obsahuje i cizí starší změny, nelze jej bez rozlišení vydat za čistou změnovou sadu této implementace.

## Primární podklady

- [Google UI Kit](https://developers.google.com/maps/documentation/javascript/places-ui-kit/place-search)
- [MapTiler geocoding](https://docs.maptiler.com/cloud/api/geocoding/)
- [ESA WorldCover](https://esa-worldcover.org/en/data-access)
- [NOAA OVATION](https://www.swpc.noaa.gov/products/aurora-30-minute-forecast)
- [JRC data a licence](https://global-surface-water.appspot.com/download)
- [GEBCO 2026 data a podmínky](https://www.gebco.net/data-products-gridded-bathymetry-data/gebco2026-grid)
- [SoilGrids data/licence](https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs_02.html)
- [World Bank country API](https://datahelpdesk.worldbank.org/knowledgebase/articles/898590-country-api-queries)
- [GFZ archiv](https://datapub.gfz-potsdam.de/download/10.5880.GFZ.1.4.2016.001/)

## Pracovní kopie

Při zahájení už existovaly rozsáhlé nesouvisející necommitnuté změny. Jsou zachované. Nerevertovat celé soubory/strom, nerozšiřovat commit automaticky na cizí práci. Žádný commit ani PR nebyl vytvořen. Nasazení je popsáno výše; na VPS je připraven také regionální atlas (522 kB) s manifestem a licencí.

## Oprava izolace POI kategorií (r6)

Příčina hlášeného prolínání: `poiFusionService` načítal nekategorizované komunitní piny, Park4night i obecné encyklopedické body pro každou POI kategorii a slučoval je bez kontroly požadované kategorie. Přepínače katalogu předávaly kategorii správně, ale společný serverový výstup ji nevynucoval.

Oprava: adaptéry deklarují podporované kategorie; nesouvisející zdroje se přeskočí ještě před požadavkem. Všechny výsledky kategoriových dotazů se filtrují před deduplikací, včetně progresivních odpovědí; počty zdrojů odpovídají filtrovaným výsledkům. Park4night používá svou samostatnou vrstvu, dokud nemá ověřené mapování kategorií. Komunitní piny zůstávají v uživatelské vrstvě.

Ověření: 12 cílených testů prošlo, včetně izolace každé položky `OSM_POI_CATEGORIES`, ochrany před přepsáním bodem jiné kategorie a nulových volání nesouvisejících adaptérů pro bar/cafe/restaurant/parking. Typová kontrola API a lint prošly. Nasazení a živé ověření jsou průběžně doplněné níže.

R6 nasazeno a zdravé; obnova zálohy a identita vydání ověřeny. Živé odpovědi pro výřez Prahy: bary 100, kavárny 100, restaurace 100, parkování 43 bodů, ve všech čtyřech odpovědích nula cizích kategorií. Park4night a komunitní zdroj mají stav skipped bez volání adaptéru. Prohlížečový test izolace přepínače a čistého refresh také prošel.
