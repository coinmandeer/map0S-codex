# Velocity: audit pro MapOS

Ověřeno čtením zdrojového kódu 2026-09-07, commit `89d4983bd842e70d99de2abee255ea89c0bc863b`.
Repozitář: https://github.com/AndrewCTF/velocity
Lokální audit: `/tmp/mapos-velocity-audit-20260907`. Nebyly spouštěny cizí install skripty, collectory ani scraping. Počty kontaktů, spotřeba RAM a propustnost uváděné autory nejsou měření MapOS.

## Rozhodnutí

Velocity je inspirace pro samostatný Global/Planet svět a společný tok pohybových objektů. Nepřebírat celý Python/FastAPI backend, Cesium frontend, OSINT shell ani jeho nezávislý AI runtime. MapOS již vlastní registry/adaptéry, Fastify/PostGIS, gateway AI, tool registry, časový ovladač a MapLibre/Three scénu.

Kód Velocity je AGPL-3.0-or-later. Dokumentovat případný převzatý kód a jeho licenci; aktuální úkol používá architektonickou inspiraci a samostatnou implementaci. Licence kódu neposkytuje automaticky právo ukládat a redistribuovat data jednotlivých služeb.

## Co skutečně obsahuje kód

| Subsystém                     | Zdroj v připnutém commitu                                      | Zjištění a relevance                                                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenSky                       | `apps/api/app/ingest/opensky.py`                               | OAuth2 client credentials, cache tokenu, bbox dotazy, normalizace ICAO24/callsign/rychlosti/výšky. Zachovává `time_position` a `last_contact`: správný princip pro MapOS.              |
| Multi-feed ADS-B              | `apps/api/app/routes/adsb.py`                                  | Sloučení snapshotů, evidence zdrojů, ETag a časový rozpočet, dopočet stáří původní pozice i pro starý cache hit. Nezaměňuje 304 za nové měření.                                        |
| Alternativní letadlové zdroje | `apps/api/app/config.py`, `adsb_sidecar.py`, `adsb_fr24.py`    | Kombinuje přímé veřejné endpointy, tar1090 a browser sidecary. Globální pokrytí bez klíče není záruka oficiálního bezplatného API. Nepřebírat scraping FR24 ani obcházení omezení.     |
| Norské AIS                    | `ais_keyless.py`, `ais_firehose.py`                            | Kystdatahuset GeoJSON a NMEA ingest. Vhodný regionální pilot po ověření oficiálních podmínek. Záznamy musí rozlišovat zdrojový čas a čas přijetí.                                      |
| Finské AIS                    | `ais_keyless.py`, `mqtt_client.py`                             | Digitraffic přes MQTT/WSS, MMSI z topicu, normalizace poloh a jednotek. MapOS má použít standardní MQTT knihovnu, ne přepisovat ručně wire protokol.                                   |
| Globální AIS                  | `ais_keyless.py`, `ais_sidecar.py`, `routes/ais.py`            | AISStream s klíčem plus MyShipTracking/ShipXplorer a další volitelné sidecary. Nejde o homogenní otevřenou globální databázi. Pokrytí je regionální, částečné a různého stáří.         |
| AIS normalizace               | `ais_firehose.py`                                              | Ošetřuje nedostupné hodnoty AIS, např. sentinel rychlosti/heading. Dobré převzít jako testovací scénáře, nikoli nulami nahrazovat neznámé hodnoty.                                     |
| Paměťový stav                 | `correlate/store.py`                                           | Deque historie + latest index, retenční okno a limit počtu. Periodický úklid místo O(N) průchodu po každém bodu.                                                                       |
| Archiv                        | `history.py`                                                   | SQLite, buffer, flush přibližně 3 s, oddělené retenční a diskové stropy. Coverage výpočty cachuje, aby dlouhé čtení neblokovalo WAL. MapOS využije svůj Postgres a dávky/partitioning. |
| Replay                        | `globe/HistoryPlayback.ts`                                     | Oddělený historický datasource a obnova skrytých živých vrstev. Cesium SampledPositionProperty s lineární interpolací a HOLD mimo interval.                                            |
| Predikce letadel              | `globe/adapters/deadReckon.ts`                                 | Krátká projekce podle hlášené rychlosti/směru, cutoff stáří, omezení extrapolace. Je to odhad polohy, ne nové měření.                                                                  |
| Stáří a původ                 | `globe/adapters/freshness.ts`, `registry/provenance.ts`        | Ztlumení starých kontaktů, čitelný věk, explicitní pravidlo hodnocení důvěry. Vhodné pro detail i hover MapOS.                                                                         |
| Satelity                      | `globe/adapters/SatelliteAdapter.ts`                           | satellite.js, SGP4, buffer vzorků dráhy, převod km→m, limity podle zařízení. V tomto commitu využívá TLE pole a výpočty rozděluje na hlavním vlákně, nejde o hotový OMM worker.        |
| Globální scéna                | `globe/GlobeCanvas.tsx`, `qualityPresets.ts`, `renderNeeds.ts` | Cesium, přepínání režimů, render podle potřeby a pohybu, samostatné kvalitativní presety. Hodí se do lazy Planet scény, ne jako náhrada hry.                                           |
| Ochrana výkonu                | `globe/pollGate.ts`, `frameBudget.ts`, `adaptiveGovernor.ts`   | Společný debounce 300 ms, dávkování obnov, sdílený rozpočet snímku a omezování méně důležitých vrstev. Parametry jsou vázané na Velocity.                                              |
| Korelace                      | `correlate/types.py`, `rules.py`, `runner.py`                  | Observations a odvozené alerts. Do MapOS jen vysvětlitelné souvislosti, žádné automatické závěry o úmyslu plavidla či původu rušení.                                                   |
| AI/MCP                        | `llm.py`, `llm_pool.py`, `news/brief.py`, plugin a nástroje    | Tool-first čtení aktuálních dat a zdrojové odpovědi. MapOS rozšíří vlastní gateway a katalog nástrojů; nový LLM server není potřeba.                                                   |

Pro odkazy na konkrétní soubor použít:
`https://github.com/AndrewCTF/velocity/blob/89d4983bd842e70d99de2abee255ea89c0bc863b/<cesta>`.

## Důležité limity a problémy nepřebírat

1. `pollGate.ts` vypouští nejvýše čtyři starty v dávce po 250 ms, ale nečeká na dokončení Promise. To není skutečný limit souběžných transportů. MapOS zachová svůj completion-based scheduler.
2. Rozpočet 12 ms na datové aktualizace v `frameBudget.ts` je pro MapOS příliš agresivní; mapa i Three potřebují zbývající čas. Výchozí dávka MapOS maximálně 4 ms/snímek a 2 ms na mobilu, měřit spolu s rendererem.
3. `freshness.ts:isCorroborated` zachází s neznámým počtem zdrojů jako s potvrzením. MapOS musí zachovat tři stavy: potvrzeno / jeden zdroj / neznámé.
4. Počet endpointů není počet nezávislých pozorovatelů. Feed family a společného upstream původce evidovat odděleně; dvě zrcadla stejné sítě nepotvrzují polohu dvakrát.
5. `ObservationStore.add` bez podmínky přepíše latest. V MapOS starší/out-of-order událost nesmí vrátit aktuální polohu zpět v čase. Do archivu může být přijata odděleně.
6. Replay v prohlédnutém `HistoryPlayback` předává do vykreslení lon/lat bez výšky. MapOS zachová výšku i typ reference; neklást historická letadla na zem.
7. Část satelitních výpočtů běží na hlavním vlákně. MapOS začne s malým OMM výběrem a workerem, nikoli s tisíci satelitů v základním UI.
8. Parametry více endpointů a výkonnostní komentáře v README a v kódu se liší. Za zdroj pravdy pro audit slouží připnutý commit, živé služby nebyly zatíženy.
9. README samo přiznává neautorizované scraping zdroje a vysokou spotřebu browser sidecarů. Do VPS MapOS tyto collectory neinstalovat jako výchozí integrace.
10. Výpadek AIS není důkaz úmyslného vypnutí vysílače. Odhady, nepravidelná pozorování a odvozené korelace musejí být jasně označené.
11. Nekopírovat globální bezpodmínečný stream všech lodí do každého klienta. Filter bbox proběhne na serveru před přenosem a limitem.
12. Nepřenášet univerzální archiv celého světa. Retence a diskový strop jsou součástí produktu i provozního rozpočtu.

## Oficiální cesty pro MapOS

| Zdroj             | Data a pokrytí                             | Přístup a pravidlo                                                                                                                        | Výchozí rozhodnutí                                                                                                                   |
| ----------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| OpenSky           | ADS-B state vectors, nerovnoměrné pokrytí  | OAuth2; anonymní i účtové kredity a cena podle rozsahu. https://openskynetwork.github.io/opensky-api/rest.html                            | První letecký adaptér, on-demand oblast, interval určuje přidělený denní rozpočet. Neslibovat nepřetržitý globální live feed zdarma. |
| Digitraffic       | Lodní polohy a metadata kolem Finska/Baltu | Oficiální REST/MQTT. https://www.digitraffic.fi/en/marine-traffic/                                                                        | První lodní pilot; jeden serverový odběr a výřezové subscriptions.                                                                   |
| Kystverket        | Otevřená část norských AIS                 | https://www.kystverket.no/en/sea-transport-and-ports/ais/access-to-ais-data/                                                              | Druhý regionální adaptér. Otevřená a uzavřená data nejsou stejný produkt.                                                            |
| AISStream         | Další lodní pokrytí podle feederů          | Samostatný klíč a ověření podmínek/limitů                                                                                                 | Volitelný adaptér po aktivaci účtu, ne předpoklad tohoto vydání.                                                                     |
| Vlastní ADS-B/AIS | Přijímač uživatele/provozovatele           | Explicitně nakonfigurovaný serverový zdroj                                                                                                | Později import; žádné veřejné libovolné URL proxy.                                                                                   |
| CelesTrak         | Orbitální elementy, nikoli live GPS        | OMM JSON explicitní FORMAT; obnova nejvýše jednou za 2 h, jitter a backoff. https://celestrak.org/NORAD/documentation/gp-data-formats.php | Planet pilot: ISS + omezený výběr, poloha vypočtená ve workeru.                                                                      |
| SondeHub          | Radiosondy/telemetrie                      | Ověřit kontrakt oficiálního API při aktivaci                                                                                              | Následující malý moving-object adaptér.                                                                                              |
| GTFS-RT           | Vozidla veřejné dopravy                    | Jen konkrétní síť s VehiclePositions a platnou licencí                                                                                    | Později městský pilot; sdílet společný transport.                                                                                    |

## T13 — Společný pohybový subsystém

Závislosti: T01 metadata/abort, T06 světy, T07 rozpočty. Nejde o změnu autority GPS hry.

- Additivní v2 feature extension `motion`: entityKind, stableId, observedAt (nullable), receivedAt, validAt, position, altitudeM + datum, speedMps, courseDeg, headingDeg, sourceFamily, measurement/prediction/replay, quality, expiresAt. ID letadel ICAO24 a lodí MMSI neodvozovat od názvu.
- Jeden collector na aktivní zdroj, sdílený serverový latest index a omezený ring buffer. Delší archiv není automatická součást běžného provozu.
- Demand leases platné 60 s; server vypíná nepoužívaný on-demand collector po 60 s bez odběru. Dva klienti stejného regionu nesmějí znásobit upstream dotazy.
- Existující Fastify WS transport rozšířit novým namespace pro veřejná data: subscribe(kind,bbox,filters,mode), snapshot, delta(upsert/remove), status, reset. Herní/session zprávy nemíchat.
- Subscriber bbox + malý okraj; jedna zpráva nejvýše 256 KiB, maximálně 500 změn, odeslání nejvýše 1×/s. Pomalý klient dostane reset/latest snapshot místo nekonečné fronty.
- Client latest limit 5 000 objektů desktop / 1 000 mobil. Přehled širší oblasti přejde na agregace s uvedeným počtem; pořadí priorit vybraný objekt → viewport → ostatní.
- Raw observed position je neměnná. Interpolovaná/predikovaná render position je oddělená; žádný odhad se nearchivuje jako skutečné pozorování.
- Krátká predikce jen s validní rychlostí, směrem a známým stářím; letadlo max15 s, loď max30 s. Pak HOLD a viditelný věk. Neprojektovat starý fix přes několik minut.
- Stáří nastavovat po poskytovateli: první pilot aircraft fresh<=120s, vessel<=180s; unknown není fresh. Zastaralé záznamy ztlumit, mimo retenční dobu odstranit nebo přesunout do explicitní historie.
- Selected track načíst samostatně, max2 000 vzorků. Historie v1: opt-in region, 24 h / 1 GiB (nižší dosažený strop vítězí), vzorek nejvýše 1×/30s na objekt, významný obrat/vzdálenost lze uložit navíc v globálním byte limitu. Postgres partitioning a dávky mimo request loop.
- Replay má svůj čas a renderer state; nepřepisuje live latest cache ani aktivní herní polohu. Mezery nad 5 min rozdělit, nedokreslovat spojení jako fakt. Dráha obsahuje výšku, pokud existuje.
- Testy: out-of-order, opakovaný snapshot, dateline, nula/sentinel, chybějící čas, stejné upstream mirror rodiny, subscriber odchod, 429, přerušené WS, pomalý klient, replay gap, opakované start/stop bez úniku.

## T14 — Global/Planet

Global je preset v samostatném světě: letadla, lodě, přírodní události a čas. Planet je samostatná lazy scéna až po T13, ne nový povinný renderer Discover.

1. Nejprve provozovat T13 na MapLibre se stejnými piny, statusem a detailem. Tím se ověří data bez nákladů glóbu.
2. Planet scene interface: mount/unmount, viewport, selection, time, screenshot hook, capabilities. Při přepnutí jediná aktivní scéna; předchozí view se uchová.
3. Cesium import jen při vstupu, bez plného balíku v hlavní stránce. Země, den/noc, imagery a výpočet ISS; 3D cities/photorealistic tiles nejsou výchozí.
4. Satelity: explicitní OMM, worker, max250 desktop/50 mobil v první etapě; vybraný objekt může mít dráhu, ostatní pouze marker. OMM epoch a čas výpočtu viditelné v detailu.
5. Kvalita Balanced/Low Data, bez automatického trvalého přepisování uživatelových přepínačů. Při výkonové degradaci nejprve redukovat labels/LOD/frekvenci, teprve potom oznámeně pozastavit nejméně důležité vrstvy.
6. Planet nepřebírá běžné POI, planner ani herní questy. AI používá stejnou evidence službu s jinými scope/tool capabilities.
7. Akceptace: návrat do Discover obnoví původní pohled a vrstvy; žádný druhý běžící WebGL loop, collector nebo timeline. Velikost lazy downloadu a GPU/paměť naměřit zvlášť.
