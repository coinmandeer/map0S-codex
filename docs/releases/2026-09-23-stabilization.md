# Stabilizace společné verze MAPOS — 23. září 2026

Tento dokument je aktuální přehled stabilizace. Starší plány a audity jsou historické
záznamy; jejich nezaškrtnuté úkoly nejsou automaticky seznamem chyb současného kódu.

## Stav vydání

**Lokálně ověřený stabilizační kandidát, dosud nenasazený.** Veřejné `/api/health` a `/release.json`
na mapos2 dne 23. září shodně vrátily `20260921-mapos2-layers-r2`. Zápis auditu
z 20. září o tehdy neprovedeném nasazení proto nepopisuje dnešní produkci.
Veřejné kontroly bezpečnostních hlaviček, CORS a ochrany účtu/operations prošly.

Identifikátor sestavení: `20260923-stabilization-candidate`.
Zdrojová revize je určena lokálním Git tagem `stabilization-20260923-candidate`
(`git rev-parse stabilization-20260923-candidate`). Výchozí revize `c239d92`
nezahrnovala převzaté rozpracování a nesmí být použita jako revize kandidáta.

Ověřeno všech **121 prohlížečových scénářů** ve 20 souborech. Jde o společné
stabilizační běhy a cílená opakování po opravách, nikoli o tvrzení, že celý runner
prošel jedním nepřerušeným spuštěním. [Seznam výsledků a otisky logů](../evidence/2026-09-23-stabilization.json)
odlišuje tyto důkazy od historických auditů. Závěrečná oprava počasí má opakovanou
kontrolu typů, všech webových testů a produkčního sestavení.

## Jediný aktuální seznam

| Oblast                                            | Stav                         | Výsledek / další krok                                                                                                           |
| ------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| API, SDK a mapový runtime                         | Hotové lokální kontroly      | 772 API + 193 sdílených testů; typy a produkční sestavení. Dva volitelné API testy vyžadují živý model a PostgreSQL.            |
| Web, stav mapy a osobní data                      | Hotové základní kontroly     | 554 webových testů, typy, sestavení. Sedm volitelných testů zdrojů je ověřeno samostatným auditem 7/7.                          |
| Český katalog, 24 vrstev a ortofoto               | Převzato z dokončeného úkolu | Přepínače, skupiny, průhlednost, oblíbené a obnovení stavu; [audit českého balíku](../audits/2026-09-23-mapee-czech-layers.md). |
| Hledání, detaily, AI a statistiky                 | Hotové lokální kontroly      | Zdroje, období, zrušení, výpadky, návrat z detailu a zachování novějšího výběru.                                                |
| Plánování, Moje a importy                         | Hotové lokální kontroly      | Obnova uložené cesty, přepočet po vložení zastávky, ochrana novější změny, export a sdílení.                                    |
| Hra                                               | Hotové lokální kontroly      | Autoritativní World, opakované actionId, skutečný loot a upgrade, reconnect a oddělení GPS/explore.                             |
| Lint, formátování, kontrakty                      | Hotové                       | Lint bez chyb/varování, formát, manifest, 9 CLI testů, kontrakt vrstvy a 2 kontroly identity vydání.                            |
| Architektura, CSS, tajné údaje                    | Hotové                       | Hranice modulů, tokeny a kontrola zdrojů i vytvořených artefaktů prošly.                                                        |
| Zabalení pro nasazení                             | Hotová místní zkouška        | Dry run bez sítě; záměrně neplatný cíl `unconfigured.invalid:/unconfigured/mapos2`, žádná domněnka o skutečné instalaci.        |
| Databáze, Docker a nasazení kandidáta             | Neověřené                    | Vyžaduje PostgreSQL/PostGIS, skutečnou obnovu zálohy, Docker sestavení a SSH cíl s cestou instalace.                            |
| Další české pokrytí a slabší telefony             | Později / známé omezení      | Reálná geografická kontrola každé podvrstvy a přípojek; měření na fyzickém slabším telefonu. Offline fixtures toto neprokazují. |
| Detail parcely, nové územní plány, FPS, ekonomika | Později                      | Mimo rozsah stabilizace.                                                                                                        |

## Opravy při společné kontrole

- Skrytí AI výsledků odstraní dočasnou vrstvu také z URL a uloženého stavu. Opakované vytvoření/skrytí kontroluje regresní test.
- Obnova uloženého plánu běží i při otevření prázdného plánovače. Rozpracovaný start ani novější místní dokument nesmí přepsat opožděná odpověď. Neuložený draft se podle stávajícího produktového rozhodnutí po reloadu automaticky neotevírá.
- Přepočet zahájený hned po vložení doporučené zastávky používá již změněný dokument. Novější editace stále zneplatní starší odpověď routeru.
- Statická kontrola odstranila nepoužívané části a nahradila neurčité typy konkrétními kontrakty datových zdrojů a testovacích náhrad. Formátování sjednoceno bez změny veřejných rozhraní.
- Prohlížečové scénáře používají dnešní katalog, výběr startu/cíle, automatické obohacení detailu a autoritativní herní API. Zastaralé očekávání předvyplněné trasy nebo legacy odměn není požadovaným chováním produktu.

- Hladké vrstvy počasí zachovávají neviditelné výběrové plochy. Myš i klepnutí čtou stejnou hodnotu; výběr již neodkazuje pouze na původní společnou vrstvu `weather`. Vzhled zůstává hladký.

## Rozsah výsledků a omezení

- 193 SDK/runtime + 772 API + 554 webových testů; 9 CLI, 2 identity vydání a 7 kontrol práv ke zdrojům prošlo. Dva API testy pro živý model a skutečný PostgreSQL zůstaly přeskočené.
- 121 funkčních prohlížečových scénářů včetně mobilu 390 px, desktopu 1440 px, obou motivů a klávesnice. Čtyři snímky katalogu byly vizuálně zkontrolované. Podklad v offline fixture je záměrně jednobarevný.
- Mapa: 6 a 12 vrstev, 50 posunů, 30 přepnutí a 10 změn podkladu. Počty zdrojů, vrstev a posluchačů beze změny; růst hlavní JS paměti přibližně 11,4 a 13,4 MiB, pod příslušným limitem. GPU a paměť workerů se tímto neměří.
- Hra: pět minut pohybu a přepínání, jeden hráč a vykreslovací cyklus, paměť v limitu, uvolnění scény po odchodu. Bez konzolových chyb.
- Produkční sestavení upozorňuje na velké JS balíky nad 500 kB. Rozsáhlá změna dělení aplikace je odložená; měření na slabém fyzickém telefonu nebylo provedeno.
- Živé placené poskytovatele, zeměpisné pokrytí všech vrstev, Docker image, skutečnou databázovou obnovu a provozní návrat nelze vydávat za ověřené offline testy.
- Produkce mapos2 stále běží na `20260921-mapos2-layers-r2`. Kandidát nebyl odeslán ani aktivován. K dokončení jsou potřeba SSH cíl a adresář instalace, poté postup níže.

## Co patří do revize

Zdrojové změny jsou rozdělené mezi `apps/api`, `apps/web`, tři SDK/runtime balíky,
`e2e`, `scripts` a `infra`. Dokumentace, starší důkazy v `docs/evidence` a záměrné
obrazové přílohy `docs/shots` zůstávají zachované. Historické verzované migrace
nebyly přepsané; nové aditivní migrace se zahrnují společně se zdroji a testy.

Lokální `node_modules`, `dist`, `.cache`, `.playwright-cli`, `output`, testovací
výstupy, stažené herní modely, osobní `progress.md` a skutečné `.env` jsou mimo
verzování. Přítomnost historických důkazů neznamená ověření současného kandidáta.

## Opakovatelné kontroly

Po instalaci závislostí z lockfile spustit `npm run verify:release` nebo
`node scripts/verify-release.mjs`. Runner postupně sestaví knihovny, ověří typy,
testy a kontrakty, lint i formát, vytvoří produkční build a spustí izolované prohlížečové scénáře
včetně pětiminutové herní kontroly. `--list` vypíše kroky;
`--only=release-identity,contract` spustí pouze výslovně označený částečný průchod.
Výsledky a logy jsou v `output/release/checks/`; prohlížečový JSON v
`output/release/browser-results.json`. Tyto dočasné artefakty nejsou verzované.

Pro lokální instalovaný Chrome nastavit `MAPOS_E2E_CHANNEL=chrome`, jinak se používá
Playwright Chromium. Prohlížečové funkční testy používají vývojový inspekční most
a offline API na vlastních portech 4043/5183. Produkční sestavení se kontroluje
samostatně; tyto testy nejsou měřením dostupnosti externích poskytovatelů.

Kandidát musí navíc projít ověřením produkčního Compose a skutečnou obnovou databáze podle [provozní dokumentace](../operations/backup-restore.md).
Nedostupné provozní kontroly se nesmějí vykázat jako úspěšné.

## Nasazení a návrat

Potřebné údaje: `DEPLOY_HOST` a explicitní `DEPLOY_REMOTE_DIR` ověřené instalace
mapos2. Nepřebírat adresář původního mapos podle výchozí hodnoty skriptu.
Nejprve spustit dry run `scripts/deploy-vps.sh <jedinečný-release>`; teprve po
ověření cíle použít `DRY_RUN=0`. Skript obnoví zálohu v dočasné databázi, ověří
migrace a kompatibilitu předchozího image a aktivuje kandidáta.

Nově se uvnitř rollback bloku kontroluje shoda očekávaného release s API a webem
na loopbacku i veřejné doméně. Chyba vrací předchozí symlink a image; databázové
migrace se neopravují přepisem historie ani mazáním nových sloupců.
Závěrečné veřejné ověření:
`bash scripts/smoke-vps-public.sh https://mapos2.promptstudio3000.com <release>`.

Docker instaluje přes `npm ci` z povinného `package-lock.json`; nedochází k tichému
přegenerování závislostí při sestavení. Skutečný Docker build zůstává provozním
ověřením před aktivací.
