# MapOS — produktové a UX vydání r2, 9. 9. 2026

## Nasazení

- Veřejný web: https://mapos.promptstudio3000.com.
- Potvrzená verze: `20260909-product-ux-r2`. První celek r1 následoval po `20260909-ai-overview-v2-r2`; r2 doplnilo katalog, přesnější undo a serverovou ochranu lokálního draftu.
- Záloha a zkušební obnova: `/opt/ps3000/apps/mapos-v3/backups/20260909-product-ux-r2`.
- Stávající release postup provedl zálohu, restore drill, migrace kandidáta, kontrolu předchozího obrazu, zdravotní kontroly a atomické přepnutí. Žádná nová databázová migrace v tomto balíčku.
- Veřejné `/api/health` odpovědělo `status:ok`; browser načetl mapu Tarragony a skutečné výsledky hledání včetně odlišení obce/provincie a stejnojmenných míst jinde.
- SSH během r2 vypadlo; žádný duplicitní deploy nebyl spuštěn. Běh na VPS pokračoval. Následná kontrola potvrdila aktivní symlink r2 a RESTORE_DRILL: 89 tabulek, legacy baseline, kandidátní migrace/HTTP, data-rights a předchozí image read/write prošly, ověřeno 2026-09-09T01:13:57Z.

## Změny chování

1. CyclOSM je průhledné Lite; plná mapa zůstává podkladem. OpenTopo překryv se migruje bez změny zvoleného podkladu. Waymarked vykreslí vybrané sítě a zrušená aktualizace po vypnutí nevytvoří další dítě.
2. Hledat zde obnovuje zachycené čekající/částečné/chybující vrstvy. Opacity mění jen styl. Chyba dlaždic není napravena pouhým panem a timeout nepřechází zpět do nekonečného loadingu ve stejném výřezu.
3. Události a nabídka tras nemění samy režim ani podklad. Přidání místa z detailu, kontextu, Discover či uložených míst připisuje skutečnou zastávku do draftu; nepřidává náhodný start/cíl, nezjišťuje GPS a neroutuje.
4. Jednobodový draft je označen `metadata["dev.mapos.collectingStops"]`. UI nabídne doplnění cíle; nedovolí výpočet/uložení před dvěma body. Oba serverové repozitáře také odmítají perzistenci jednobodového draftu s HTTP 400. Undo podle ID neobnovuje celou starou kopii přes další zastávky. Reload zachovává pravidlo prázdného nového plánování.
5. Chyba geocoderu zachová text, má retry a křížek; není úspěšným prázdným hledáním. Kontext geocoderu nepředstírá polygonový nebo viewport filtr.
6. Katalog pamatuje Vše/Zapnuté; filtr platí i uvnitř kategorií a statistik. Hledání zahrnuje názvy dostupných statistických sérií a odkazuje k existujícím překryvům. Zamčený zdroj má disabled přepínač s důvodem místo nefunkčního odemykání. Předvolby ukazují obsah před použitím; undo vrací nezměněná pole, ale zachová pozdější ruční opacity/filtr. Detailní filtry lze resetovat po vrstvě.
7. Discover zůstává během detailu připojený, uchovává místní obsah/scroll a vrací focus. Současná visualViewport, safe-area a mobilní konstrukce zůstává; rozvržení nebylo přestavěné.
8. Providerové bloky jsou kompaktní explicitní záložky. Dlouhý AI přehled má volitelné rozbalení, základní média/fakta nejsou znovu ukrytá. Uložené přehledy ruší staré dotazy; odstranění jiného záznamu neuzavře otevřený přehled.

## Automatické kontroly

- Výchozí cílená sada před implementací: 60 testů bez selhání.
- Kompletní webová sada po opravách lifecycle: 501 testů, 494 prošlo, 7 přeskočeno, žádné selhání. Pozdější UX úpravy mají samostatné následné kontroly uvedené níže; nejde o tvrzení o opakovaném celém běhu po každé změně.
- SDK po přidání lokálního draftu: 105/105.
- Následná cílená sada engine/store/draft/dlaždice: 33/33.
- R2 store/persistence testy: 21/21. R2 další regrese (dlaždice, stav, canonical append, vlastní mazání AI a parity): 22/22. Sady se překrývají, počty nesčítat jako počet unikátních testů.
- Celá API sada: 709 prošlo, 2 přeskočeno, jediný neúspěch byl časový limit offline load testu při souběžných sestaveních (p95 1324 ms). Izolovaný load test následně prošel; původní neúspěch není vymazán.
- Web/API TypeScript a produkční sestavení prošly. Architektonické hranice a CSS tokeny prošly; kontrola tajných údajů a build artefaktů prošla.
- Výkonnostní fixture původně odmítla nové URL CyclOSM Lite. Doplněn přesný allowlist produktu, nikoli globální povolení sítě. Opakovaný běh 6/12 vrstev prošel s nulou nepovolených externích požadavků.

## Browser důkazy

- Živé Praha/Tarragona hledání; identita obce oddělená od administrativní oblasti.
- Lokálně simulovaná geocode 503: viditelná chyba, zachované zadání, retry po obnovení skutečné služby vrátí výsledky Tarragony.
- Pravý klik → Přidat do trasy: zůstává Discover, jeden skutečný bod, potvrzení Otevřít plán / Vrátit. Jednobodový editor použitelný na desktopu i 390×844.
- Mockované uložené přehledy: zpožděné A → rychlé B skončí B (A nezobrazené); smazání A ponechá otevřené B; zavření během dotazu neobnoví přehled.
- Po ustálení: 20 pohybů kurzoru a změna opacity nevyvolaly žádný API požadavek. Dřívější pokus probíhal během stránkování OSM a proto nebyl použit jako důkaz příčiny požadavků.
- Screenshoty: `output/playwright/product-one-stop.png`, `output/playwright/product-mobile-plan.png`.

## Výkon: měření této verze, nikoli srovnání s původní produkcí

Prostředí: Mac16,12, arm64, 24 GiB RAM, Chromium 151.0.7922.34, výřez 1440×900, vývojový build. Offline fixtures: 400 bodů na datovou vrstvu plus dvě rastrové vrstvy, renderer kruhů. Každý scénář obsahuje 50 posunů, 30 vypnutí/zapnutí a 10 změn podkladu.

| Metrika                         |   6 vrstev |  12 vrstev |
| ------------------------------- | ---------: | ---------: |
| JS heap před cykly              |  18,96 MiB |  20,45 MiB |
| JS heap po cyklech a GC         |  28,02 MiB |  30,46 MiB |
| Mapové zdroje před/po           |    12 / 12 |    18 / 18 |
| Mapové vrstvy před/po           |    23 / 23 |    29 / 29 |
| Počet posluchačů podle události | beze změny | beze změny |
| Počet fixture odpovědí          |        130 |        278 |
| Nezkomprimované JSON odpovědi   |   8,56 MiB |  18,31 MiB |
| p95 zachycených dlouhých úloh   |     221 ms |     262 ms |

JSON velikost není síťový přenos. Dlouhé úlohy nejsou měření hoveru. Hlavní JS heap neobsahuje GPU a worker heaps. Nárůst paměti prošel existujícím limitem testu, ale neprokazuje absenci dlouhodobého úniku. Přesné artefakty: `output/performance/map-6-development-layers.json` a `map-12-development-layers.json`.

## Konkrétní hranice výsledku

- Není doložené procentuální zrychlení oproti staré produkci na shodných datech. Není změřený úplný hover p95 včetně všech obsluh; samotný hit-test není celá interakce.
- Živý CyclOSM/OSM může selhat či vrátit částečné výsledky. Opravené UI problém vysvětluje; nepředstírá opravu externí služby.
- Mobilní screenshot nenahrazuje fyzickou klávesnici, VoiceOver a kompletní přístupnost všech panelů.
- Obsahová deduplikace všech providerů, úplné veřejné sdílení soukromých AI odpovědí a živá modelová syntéza nejsou nově dokončeny.
- Dřívější evropské importy, další statistiky, bathymetrie, kvótované integrace, hra a Planet mají vlastní backlog. Toto vydání jejich stav nezvyšuje.

Dílčí hover profil nad zahřátou živou mapou Prahy: 120 volání MapLibre hit-testu během 40 pohybů, p95 0,60 ms, maximum 11,30 ms. Měří pouze synchronní `queryRenderedFeatures`, ne čekání na další snímek, React ani záměrných 150 ms náhledu.
