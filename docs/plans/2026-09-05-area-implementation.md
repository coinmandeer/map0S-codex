# Interaktivní oblasti: implementace a ověření

Nasazeno 2026-09-05 jako `20260905-area-status-polish` (funkční vydání `20260905-interactive-areas` + oprava překryvu stavových hlášení) na https://mapos.promptstudio3000.com. Kontroly zálohy/obnovy, migrací a kompatibility prošly; veřejný smoke 7/7. Záloha: `/opt/ps3000/apps/mapos-v3/backups/20260905-area-status-polish`. Navazuje na schválený plán oblastí a úsporného UX.

## Implementováno

- Společný výběr oblasti se zdrojovou identitou a neměnnou revizí. Kliknutí filtruje podporované vrstvy, posun výběr zachovává. Zrušení/obnova/přiblížení/průvodce jsou v mapovém ovládání.
- Manifest `queryPolicy.areaFilter` je volitelný: `geometry` nebo `context`. Nedefinované starší vrstvy jsou kontext. V tomto vydání přesné filtrování deklarují OSM POI a uživatelské body/trasy; ostatní vrstvy jsou pravdivě označené.
- OSM, Mapy a uživatelské SQL dotazy filtrují podle polygonu před limitem, také uvnitř fusion. Fusion se nejprve omezí bbox oblasti, pak geometricky filtruje; externí omezené výsledky zůstávají partial. Cache/pager zahrnují identitu a revizi. Nedostupná revize je chyba, ne tiché vypnutí filtru.
- Stavová hlášení používají existující komponentu přímo v ovládání oblastí; nepřekrývají jeho tlačítka. Barvy panelu čtou společné tokeny světlého/tmavého tématu.
- Dva sloty hranic, lokální hover, kontrastní obrys, krátké prolínání, ruční úrovně. Vybraný polygon má samostatný zjednodušený obrys (limit 1 MiB) a přežije změnu úrovně. Téma potlačí výplň, ne hranici.
- Formát nových dlaždic je součástí hashe manifestu. Historické revize si zachovávají původní datový formát.
- Mapy/Park4Night detail z uloženého původního ID; u samostatných podporovaných zdrojů se kontaktní pole přenesou až v detailu. Smíšené zdroje zachovávají enrichment, který se zatím nedá plně rekonstruovat.
- Zrušení detailu se propaguje přes HTTP odpojení a resolver do Overpass/Wikidata/FSQ. Sdílený transport má počítané zájemce; jeden zrušený klient neodpojí druhého. Omezený background ingest OSM/fusion dál připravuje data pro následující poll.
- Menší clustery, piny přibližně 24–32 px, seznam nerozbalitelných clusterů po 100 s další/předchozí stránkou. Low Data vypíná fotografie i přednačítání v Places seznamu; běžné přednačítání sníženo z 20 na 4. Photo cache má limity 256/128 položek.
- Průvodce vybrané oblasti používá skutečné jméno a bbox z ID. U shodných názvů vyžaduje souřadnice článku v daném bbox (např. česká Praha nesmí být průvodcem slovenské obce Praha).

## Obecní data

GISCO LAU 2024: 97 987 jednotek v 34 zemích, CZ 6 258, ES 8 132; ověřený staging má 0 nevalidních/prázdných geometrií; všech 34 zemí bylo následně publikováno do produkce. Nejde o úplné pokrytí celé geografické Evropy ani o katastrální přesnost; zdroj je generalizovaný 1:1 000 000.

Celý 149 866 427 B soubor přesahuje 16 MiB limit webového transportu. Limit zůstává. Offline příprava používá soubor do 256 MiB a SHA256; `scripts/prepare-lau-import.py` jej rozdělí po zemích. `scripts/import-lau-countries.mjs` kontroluje country SHA/count/identity a zapisuje dávky po 200. Každá země má nezávislou atomickou edici. Produkční kopie použila již ověřený staging. Manifest `26dd406168ebf8da1fe35d8a4df280d18408ec3fa44b9eca23c070fb4b861ed9` obsahuje všech 97 987 LAU.

## Dosavadní důkazy

- API 650 pass / 1 skip, web 471 pass / 7 skip, SDK 105 pass; pozdější cílené testy guide/detail/area 25/25 a izolace fusion cache 3/3.
- Browser Discover/detail/galerie/viewport/Low Data: 17/17. Doplněná kontrola mobilu a p95 hoveru prošla 1/1. Hover: p95 21,8 ms, 30 událostí přes následující animation frame, Apple M4 / macOS arm64, fixture; žádné HTTP při hoveru.
- PostGIS: atomické publikace/rollback/neměnnost starých URL; díra polygonu, ostrov, bod na hranici, průchozí trasa a odmítnutí chybějící revize. DB lookup Mapy adresy a Park4Night fotografie/hodnocení včetně starého číselného ID ověřen v izolované DB.
- Fixture 500 Mapy-shaped POI: 148 076 → 120 686 B, úspora 18,50 %. Nejde o měření veřejného API.
- Produkční fixture benchmark 6/12 vrstev prošel: růst main-thread heap 11,25 / 12,36 MiB; mapové zdroje/vrstvy/listenery stabilní. DOM listener čítač rostl, workery/GPU nejsou změřené; neprohlašovat celý browser za paměťově vyřešený.

Produkční důkazy: `output/performance/area-production-smoke.json`, `area-production-manifest.json`, `lau-production-publication.jsonl`, `area-public-checks.txt`. Živý výběr Selva del Camp, La i geometrický dotaz vrací HTTP 200, výběr přežil změnu podkladu na CARTO Dark Matter i Esri World Imagery; konzole během kontroly bez chyb. Resolver Praha/La Selva: obrys 3 306 / 895 B (jednotlivé dotazy 135 / 310 ms včetně sítě, nikoli p95).

Živé MVT v zoomu 11: Tarragona 24 jednotek / 5 742 B, Praha 11 jednotek / 2 530 B, všechny identity jedinečné a úroveň LAU. Jednotlivé studené dotazy 533/540 ms včetně sítě, nikoli p95. Důkaz: `output/performance/area-production-tiles.json`.

## Zbývající širší práce

Národní přesnější municipality a evropské mezery, kompletní slučování detailů více providerů, rozšíření přesného area filtru na další adaptéry, nativní modelová provenance počasí a širší GPU/worker profilování. Hra/logo/nové AI funkce/smíšené dopravní profily zůstávají mimo tento implementační blok.

## Navazující implementace v pořadí dopadu

1. **Změřit a odstranit růst DOM listenerů.** Reprodukovat stejných 50 posunů / 10 přepnutí / 10 stylů, uložit heap snapshots po GC a určit držitele. Rozdělit main thread, MapLibre workery a GPU; samotné stabilní počty mapových sources nejsou důkaz vyřešené RAM. Poté opakovat 6/12 vrstev i se skutečnými poskytovateli na zaznamenaném zařízení.
2. **Rozšířit přesné filtrování bez falešného pokrytí.** Přidat do dalších SQL adaptérů polygon před limitem, do fusion sdílený area/revision klíč, a teprve pak manifest `geometry`. U služeb s omezeným upstreamem zachovat partial a samostatný stav chyb. Pokrýt soukromé trasy a stránkování přes skutečné HTTP nad izolovanou databází; nynější důkaz polygonových okrajů je PostGIS drill, ne kompletní end-to-end soukromá data.
3. **Doplnit evropské mezery a hierarchii.** Národní licencované otevřené obce pro státy mimo dostupný GISCO LAU 2024. Neslučovat LAU s ADM2. Připravit ověřené parent ID/jméno do dlaždice; aktuální hover zná místní název, úroveň a kód země, nikoli vždy název nadřazeného regionu. Ověřit shodu hranic/ostrovů proti národním registrům; generalizace 1:1 000 000 není katastr.
4. **Dokončit detail více zdrojů.** Vyřešit sloučení kontaktů a médií podle `sourceRefs` a priorit; až poté ořezat smíšené přehledy. Měřit bajty skutečných API odpovědí, nejen fixture. Prověřit opuštěné background úlohy a přidat priority detailu do případné společné fronty bez rušení ostatních zájemců.
5. **Rozšířit vizuální akceptaci.** Automatizovat výběr oblasti → změna podkladu/satelit/téma → detail/galerie a skutečný touch tap, kontrolovat pin priority a překryvy. Současný mobilní browser scénář používá úzký viewport a klik. Prověřit souběžné jednotlivé body nad maximálním zoomem clusteru; seznam zatím řeší nerozbalitelný cluster.
6. **Počasí a navigace.** Dodat původ/model/platnost pro každý vzorek, ne jen volbu modelu UI. Interpolace není vyšší přesnost. Trip timeline zůstává skrytá; její návrat podmínit konkrétním okamžitě užitečným scénářem.

Hra, questlayer, rozsáhlejší motion/brand, nové logo, AI a smíšené dopravní profily mají vlastní pozdější návrh; nezahrnovat je do této optimalizační akceptace.

Závěrečná kontrola opravy stavu na produkci: výběr `Selva del Camp, La`, stav uvnitř panelu, 0 původních plovoucích hlášení, konzole 0 chyb. Screenshot `output/playwright/area-final-selected.png`. Browser znovu 1/1 po změně komponenty hlášení; build webu prošel.
