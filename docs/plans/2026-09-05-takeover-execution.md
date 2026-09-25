# MapOS: pořadí dokončení po převzetí

Autoritativní rozsah: [schválený plán](2026-09-04-performance-approved.md).
Aktuální stav nasazení a důkazy: [průběžný záznam](2026-09-mapos-followup-next-ai.md).
Tento dokument zkracuje další implementační kroky; nenahrazuje akceptaci původních fází.
Herní a velký vizuální redesign uživatel odložil. Nezaměňovat existující herní kód za dokončený produkt.

## Nejdřív stabilní vydání

Nasazení WMS zastavila ochrana databáze: již publikovaná migrace 0021 získala další SQL.
Oprava obnovuje původní checksum a přesouvá nové indexy do 0022. Nikdy nepřepisovat ledger
ani vypínat kontrolu checksumů. Doplněn regresní test proti ověřené produkční hodnotě.
Opravené očekávání migrací a inventář sdílené cesty `/v2/world/threads/save` jsou součástí převzetí.
Release označit jako dokončený až po obnově zálohy, dvojím spuštění migrací, kompatibilitě
staré aplikace, HTTP kontrolách a veřejném smoke testu.

## Další implementace v pořadí dopadu

| Pořadí | Konkrétní práce                                                                                                                                                                                                                                                                                                  | Důkaz dokončení                                                                                                                                                |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | U Mapy/Park4Night a dalších skutečně používaných POI zdrojů doplnit resolver detailu podle stabilního source ID. Teprve potom odebrat detailová pole z přehledu. V `placesPresentation.ts` dnes zůstávají telefon, web, otevírací doba a další pole. Zachovat atributy skutečně používaných filtrů a uložená ID. | Otevření nového i dříve uloženého pinu se stejným detailem; test bez dalších detailových dotazů při posunu; porovnání přenesených bajtů nad stejnými záznamy.  |
| 2      | Propagovat zrušení dotazu až k poskytovatelům a doplnit společné rozpočty přednačítání. Prověřit dlouhé Mapy probe dávky a zpětný tlak více uživatelů, nikoli jen souběh v jednom požadavku.                                                                                                                     | Změna výřezu/vypnutí vrstvy zastaví nepotřebnou práci; pomalý zdroj nezablokuje ostatní; test několika současných klientů.                                     |
| 3      | Discover detail navázat přímo na identitu polygonu. Po zemích připravit municipality/LAU se zdrojovou licencí, identitami a kontrolou úplnosti; ponechat atomické edice a fallback.                                                                                                                              | Hover bez síťového čekání, město odpovídá polygonu, přechody úrovní bez děr; pokrytí uvedeno po zemích. ADM2 nevydávat za všechny obce.                        |
| 4      | Změřit pracovníky a GPU vedle hlavního JS heapu. Zopakovat stejný scénář 6/12 vrstev na klidném stroji a s reálnými poskytovateli.                                                                                                                                                                               | Zdroje/listenery stabilní; odezva interakcí měřena samostatně od p95 dlouhých úloh; doložené before/after. Postup v `docs/performance-benchmark.md`.           |
| 5      | Počasí: původ modelu a čas aktualizace u vzorků, skutečné pokrytí a prostorově stabilní výběr.                                                                                                                                                                                                                   | Uživatel rozpozná interpolaci a zdroj; změna zoomu nespouští opakovaně stejné drahé dotazy. Jemnější vykreslení není tvrzení o vyšší přesnosti.                |
| 6      | Dokončit adaptéry po jednom: WMS časové legendy a obnova capabilities; ArcGIS stránkování, výběr atributů a polygon fill; další WMTS matice až s validací.                                                                                                                                                       | Pro každý protokol import → změna výřezu/filtru → detail/legenda → chyba/429 → živý zdroj. WMS omezení viz `docs/wms-time.md`.                                 |
| 7      | Doplnit vybrané užitečné vrstvy z původní tabulky: sucho, koupání, bathymetrie tam, kde existuje, cyklotrasy. Pro každou ověřit licenci, pokrytí, aktualizaci a provozní náklady.                                                                                                                                | Funkční vrstva s filtrem a attribution, nikoli pouze položka katalogu. Registrace/klíče požadovat pro konkrétní zdroj; nepředstírat plošná data hloubek jezer. |
| 8      | Smíšené dopravní profily po úsecích: kompatibilní SDK kontrakt, hash/cache jednotlivých dvojic, undo a zachování nastavení při přesunu bodů; editor úseku a pravdivý export.                                                                                                                                     | Změna jednoho úseku přepočítá jen dotčené dvojice. Globální profil nesmí přepsat individuální volbu ani zkreslit export. Podrobnosti v průběžném plánu.        |
| 9      | Praktické „Kdy vyrazit“ a porovnání uložených sestav; průvodce a AI až nad stabilními ID a zdroji.                                                                                                                                                                                                               | Okamžitě použitelný výsledek bez čekání mapy na AI. Neužitečnou trip timeline ponechat skrytou.                                                                |

## UX a hra pro navazující rozhodnutí

- Clustery: ověřit překryvy na městském zoomu; sladit vizuální průměr a cluster radius,
  čitelnost počtu, klikací cíl a rozbalení. Změřit na hustých reálných datech a mobilu.
- Piny a drawer: společná barva, ikona a tvar podle kategorie; velikost podle zoomu,
  zřetelný výběr, klávesnice a reduced-motion. Animace přes transform/opacity bez nových dotazů.
- Logo a brand řešit jako jednotný návrh, nikoli nahodilou změnu několika ikon.
- QuestLayer: samostatně specifikovat typy otevřených questů, licence, autoritu splnění,
  GPS přesnost, soukromí polohy, offline režim a obnovení session. Existující sociální a 3D kód
  vyžaduje vlastní produktovou akceptaci, nikoli jen testy optimalizace mapy.

Každý další blok uzavřít změnou, relevantním testem, známými limity a přesným stavem nasazení.
Starší průběžné formulace „běží“ nepovažovat za aktuální stav bez ověření.
