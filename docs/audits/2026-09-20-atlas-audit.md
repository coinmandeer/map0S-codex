# Audit a sjednocení vrstev mapOS — 20. září 2026

Cíl: tento pracovní repozitář a https://mapos2.promptstudio3000.com. Pracovní strom obsahoval rozsáhlé změny před touto implementací; jejich přítomnost není důkazem nasazení. Technický dluh patří do tohoto dokumentu, nikoliv mezi mapové vrstvy.

## Změny

- Opravena všechna jména 17 tříd MODIS IGBP; voda je modrá třída 17, červená třída 13 označuje města. Referenční legenda: https://gibs.earthdata.nasa.gov/colormaps/v1.0/output/MODIS_IGBP_Land_Cover_Type.html.
- iNaturalist převeden na ověřené sparse fields API v2, nejvýše 4 stránky po 50 záznamech, s přiznaným omezením počtu. Živý český výřez 14.3,49.9,14.6,50.2 / Aves vrátil 200 výsledků za 4734 ms; původní v1 odpověď překračovala limit velikosti.
- Piny Overture Places a Mapillary pouličních objektů používají symboly a společný výběr. Dlaždicová geometrie zůstává dlaždicová. Opraveno odstraňování podvrstev před jejich zdroji.
- Společný bodový renderer respektuje datové barvy a velikosti. Fotografie, zprávy, družice, požáry a zemětřesení mají vlastní symboly. Trasy, plochy, rastry a budovy se nepřevádějí na piny.
- Jednotná kontrola konfigurace v enginu a UI; konkrétní zprávy zdrojů se dostávají k řádku vrstvy.
- Katalog má devět tematických kategorií, oddělené Moje, pohledy Aktivní a Oblíbené a hledání napříč statistikami i poskytovateli. Preset neschovává katalog. Sbalitelný aktivní seznam šetří místo na mobilu. ID vrstev a filtry zůstávají kompatibilní.
- Vypnutí souvisejícího filtru elektřiny zachovává značky a mobiliář. Celé sdílené doplňkové zdroje mají vlastní ovládání.
- Noční světla jsou výslovně historický kompozit 2016. Odstraněna nepodložená barevná legenda tmy. OpenSeaMap označen jako námořní značky; Mammalia jako savci.
- Živé polohy stárnou od pozorování, nikoliv každého nového načtení. Lodě se posouvají po kurzu a otáčejí podle heading. AIS neplatné hodnoty nejsou rychlost ani orientace. Obnovování respektuje skrytou kartu; datová hranice se dělí do dvou dotazů. Vozidla mají vlastní detail bez turistického enrichmentu.
- AIS slučuje zájmové oblasti místo zahazování malých výřezů, omezuje odpověď na 600 lodí, vysvětluje čekání na stream a samostatně uklízí odběry po vypršení zájmu. Digitraffic přiznává regionální pokrytí.
- Přidán release identifikátor API a webového artefaktu. Deploy výchozí host je mapos2 a skutečné nasazení vyžaduje explicitní serverovou cestu, aby nezasáhlo starší instalaci.
- Z aktivní GameLayer odstraněno načítání a klikání na legacy duchy/encounters: jejich mutace už server vrací jako HTTP 410. Aktivní interakce používají World session.
- RPG: existující autoritativní World nabízí sólové bojové questy, úlomky jako loot a trvalé vylepšení zbraně (max. 5 úrovní; cena 3 × nová úroveň). Každá úroveň přidává +2 útok / +4 kouzlo. Odměny, cena a opakované požadavky ověřuje server; GPS/explore/test mají oddělené profily. FPS není součástí této etapy.

## Inventář a význam výsledků

`2026-09-20-layer-inventory.json` eviduje 117 položek katalogu a doplňkových zdrojů, 55 registrovaných pluginů. Generuje jej `node --import tsx scripts/audit-layer-catalog.mts --live-config`. Do souboru se ukládají pouze booleany konfigurace, nikoli klíče. Sedm položek má konkrétní konfigurační překážku: Overture místa a budovy, FIRMS požáry, Opencaching, OpenChargeMap, OpenAQ a eBird. Dynamické statistiky a uživatelské importy mají metadata v panelu podle aktuálního runtime.

Stav `limited` znamená implementovaný zdroj s uvedenými omezeními, **nikoliv důkaz živého úspěchu**. `unavailable` znamená chybějící registraci nebo konfiguraci. `experimental` vychází z manifestu. Pro všechny zdroje současně nelze z jednotkových testů odvodit uptime, úplnost, aktuálnost ani licenci pro další použití.

## Technický dluh

| Priorita | Oblast a dopad                                                                                | Podmínka dokončení                                                                                              |
| -------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| P1       | Runtime metadata a část legacy manifestů stále odvozují geometrii ze širokého typu rendereru. | Zbývající pluginy popíší skutečnou geometrii, čas a pokrytí v kanonickém v2 manifestu.                          |
| P1       | Externí zdroje mají různé geografické limity, dostupnost a latence.                           | Provozní měření po jednotlivých zdrojích v podporovaných oblastech; rozlišovat chybu, prázdný výsledek a limit. |
| P1       | Jeden AIS websocket slučuje vzdálené zájmy, což může zvýšit přenos dat.                       | Zátěžové měření více geograficky vzdálených klientů; při dosažení rozpočtu přiznané omezení pokrytí.            |
| P1       | Úplný smoke test na mapos2 závisí na skutečném nasazení a dostupné konfiguraci.               | Shodný release v `/api/health` a `/release.json`, úspěšné kontroly hlavních scénářů na produkci.                |
| P2       | Staré herní implementace a nové World rozhraní existují vedle sebe.                           | Ověřit všechna připojení a teprve potom odstranit nepoužívané vstupy; zachovat sdílené renderery a ovladače.    |
| P2       | Data v historických a statistických vrstvách nejsou aktuální měření.                          | Datum a skutečný rozsah každé importované série musí být viditelné a testované proti poskytovateli.             |
| P2       | Objemné store/API moduly zvyšují riziko změn.                                                 | Rozdělovat podle stávajících funkčních hranic při dalších změnách; žádný plošný přepis kvůli tomuto auditu.     |
| P2       | Modely hry závisejí na provozovatelském mountu; procedural fallback je legitimní.             | Dokumentace uvádí skutečný mount a dostupné modely; netvrdí automatické stahování během Docker buildu.          |
| P2       | Jazyk zdrojových hlášek zůstává často český i v anglickém UI.                                 | Lokalizované kódy stavů a názvy polí; uchovat originální vysvětlení poskytovatele.                              |

Další rozvoj: nejprve měřená stabilita vrstev a čas/pokrytí importů, potom delší RPG řetězce a ekonomika odměn. FPS vyžaduje samostatný návrh kamery, kolizí a fyziky nad reálnou mapou.

## Ověření

Závěrečné výsledky: web 549 prošlých testů / 7 přeskočených; API 772 prošlých / 2 přeskočené. Nové testy pokrývají změnu stylu a interakci pinů, teardown zdrojů, datové barvy/velikosti, staré polohy, směr lodí, datovou hranici, sdílené filtry, AIS sentinel hodnoty a pokrytí více klientů. RPG test provádí souboje → loot → idempotentní upgrade → obnova po restartu → oddělení GPS postupu.

Audit práv ke zdrojům: 7/7. Layer SDK: 106/106. Kontrola architektonických hranic a CSS tokenů prošla. Produkční build a prohlížečové kontroly jsou zaznamenány níže. Screenshoty a herní textový stav jsou v `output/playwright/`.

### Dokončené lokální kontroly

- Produkční monorepo build prošel včetně API, webu a runtime starteru. Zůstává velikostní upozornění Vite na některé chunky (zejména MapLibre); nejde o chybu sestavení.
- Globální hledání `population` našlo statistiku. Screenshoty desktop 1280 × 800 a mobil 390 × 844 byly vizuálně zkontrolovány; dokument nemá horizontální přetečení (390/390 px).
- Povinný herní Playwright klient: dvě sekvence pohybu a útoku, připojená explore session, `error: null`, bojové questy ve snapshotu, bez zaznamenaných chyb konzole. Artefakty `output/playwright/mapos-rpg-cors-fixed/`. Jde o lokální fixture server, nikoliv důkaz produkčního GPS provozu.
- Renderovací mikrobenchmark ve skutečném prohlížeči: 6 vrstev / 1200 bodů — připojení 11 ms, interval snímku p95 16,8 ms; 12 vrstev / 2400 bodů — 19 ms, p95 16,7 ms. Po odpojení v obou případech 0 zbývajících zdrojů. Použita syntetická data; toto neměří latenci poskytovatelů ani dlouhodobý růst heapu. Záznam `output/playwright/layer-render-load.txt`.
- Po posledních úpravách samostatně prošlo 25 testů živé dopravy a World. Testování zdrojů zahrnuje opakované připojení/odpojení 6 a 12 vrstev.

- Prohlížečový bojový scénář navíc skutečně porazil strážce klávesou Space: XP 0 → 25, inventář získal 1 úlomek, serverový snapshot bez chyby. `output/playwright/mapos-rpg-combat/state-4.json` a `shot-4.png`.
- ADSB.lol veřejná odpověď ověřena: `now` je epoch v milisekundách. Adaptér používá tento čas pro `observedAt`, aby cache neomlazovala pozorování; klient upřednostňuje absolutní čas před relativním stářím.

### Nasazení

Nasazení na mapos2 nebylo provedeno: v repozitáři chybí SSH cíl a ověřená cesta této konkrétní instalace. Dotaz na tyto údaje byl odeslán uživateli. Není dovoleno odvodit serverovou cestu ze staršího hostu mapos. Po dodání údajů je nutné provést dry run, nasazení a kontrolu shodného release i mapových scénářů na cílové doméně.
