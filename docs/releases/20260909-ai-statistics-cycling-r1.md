# MapOS — statistické otázky a cyklistické mapy

## Stav

Nasazeno `20260909-ai-statistics-cycling-r1` dne 9. 9. 2026; veřejně ověřeno 12. 9. 2026. Předchozí potvrzená verze: `20260909-product-ux-r2`.

## Opravené příčiny

- CommandSearch volal chat bez ID/revize konverzace, vyžadoval a předával pevně OSM, zahazoval všechny karty kromě míst a při změně textu mazal odpověď. Search i panel nyní používají jednu službu `runChatTurn` a existující `chatSession`. Přechod do panelu nepokládá otázku znovu.
- Nerozpoznaná otázka v deterministickém fallbacku vždy četla polohu středu mapy. Místní průvodce se nyní používá jen pro místní otázky; nepodporovaný dotaz přizná chybějící odpověď.
- Statistické otázky mají přednost před modelem i detailem právě vybraného pinu. Explicitní země má přednost před polohou, krátké navazující otázky přebírají ukazatel/zemi/rok podle předchozího dotazu. Neznámé město se nesmí stát dříve zvolenou zemí. Žádný externí/modelový dotaz pro vypočtený statistický přehled.
- Server vybírá skutečnou publikovanou řadu a jedno období, řadí hodnoty uvnitř země podle územních kódů, kontroluje edici hranic a uvádí pokrytí. Národní číslo neodpovídá na otázku, kde uvnitř země je nejhorší situace. Modelová tvrzení ani odhadnuté hodnoty se nepoužívají.
- Mapa dostává konkrétní téma, rok, vyloučené alternativní datasety a bbox. Přiblížení je součástí vyžádaného srovnání; běžné aktualizace textu nic nepřibližují. Statistiku lze znovu zobrazit z odpovědi. Přepnutí statistiky neotevře jiný panel. Chybějící nová řada odstraní předchozí tematickou výplň.
- Základní podporované statistické dotazy: AROPE, nezaměstnanost, nezaměstnanost mladých, náklady na bydlení, hustota a počet obyvatel. Úroveň závisí na skutečně importované sérii; ne všechny položky mají regionální data. Nejde o dokončení libovolné analytiky přirozeného jazyka.
- Plná CyclOSM již byla v registru podkladů; nyní je explicitně dostupná přímo u Lite spolu s akcí pro značené cyklotrasy. Waymarked `activity` se při prvním zapnutí nastaví atomicky — jinak původní helper zahodil filtry před vytvořením vrstvy a zapnul pěší síť. Volba plného podkladu nemění kameru.

## Data

Po ověřené záloze `/opt/ps3000/apps/mapos-v3/backups/20260909-before-statistical-chat.dump`:

- GISCO NUTS 2, edice 2024: 299 publikovaných území, zdroj `gisco-nuts2`, serverový import existujícím vydávacím postupem.
- `eurostat-poverty`: 2 157 hodnot, 2015–2025.
- `eurostat-unemployment`: 7 733 hodnot, 2000–2025.
- Kontrolní Česko AROPE 2025: 8/8 regionů; Moravskoslezsko 14,5 %, Jihozápad 13,7 %, Severozápad 13,5 %, Severovýchod 12,1 %, Střední Čechy 11,2 %, Střední Morava 11,1 %, Praha 9,1 %, Jihovýchod 8,8 %.
- AROPE znamená ohrožení chudobou nebo sociálním vyloučením, nikoli samotnou příjmovou chudobu. Zdroj: [Eurostat ilc_peps11n](https://ec.europa.eu/eurostat/databrowser/view/ilc_peps11n).
- Statistické dlaždice nově dovolují join na publikované NUTS 2024 v souladu s prototypovým ADR 0012; atribuce a edice zůstávají. Předchozí technická podmínka je omezovala na Natural Earth / LAU. Nevytváří se nový import během pohybu mapy ani při otázce.

## Ověření před vydáním

- 53 cílených testů: parser otázky/kontext/rok, správné pořadí a pokrytí, národní fallback, priorita před modelem, uchování serverové historie, intent hledání, atomické zapnutí vrstvy a další store regrese.
- Širší AI sada: 153 testů prošlo; jediná chyba byla chybějící import testovací funkce v novém testu hledání. Opravený soubor samostatně 8/8, závěrečná cílená sada 53/53.
- Typecheck API/web, sestavení obou aplikací, hranice architektury, CSS tokeny a kontrola tajných údajů.
- Browser s označenou simulovanou odpovědí: náhled po blur zůstává; druhá otázka obsahuje původní conversation ID a baseRevision 2; panel zachoval obě otázky. Přiblížení respektovalo odsazení levého panelu. Modelově simulované výsledky nejsou důkazem živé analytiky.
- Browser plná CyclOSM: skutečný zdroj `/cyclosm/`, stejná kamera před/po. Samostatné značené sítě se ověřují nad skutečným registrem rendereru.

## Zbývá mimo tento balíček

Libovolné regiony/obce v AI analytice, automatické doplnění chybějících datasetů, časové trendy a srovnání více zemí, plná živá modelová syntéza v přiděleném rozpočtu. Není aktivováno placené pokračování ani nové externí modelové volání. Dostupnost komunitních dlaždic CyclOSM/Waymarked zůstává závislá na jejich provozovateli.

## Živá kontrola 12. 9. 2026 a navazující r2

- Veřejné zdraví API OK, VPS current ukazoval na r1. Statistická otázka z Tarragony vrací skutečná česká data AROPE 2025, 8/8 regionů, aktivuje `theme-poverty` a správný vyloučený celostátní zdroj. Screenshot: `output/playwright/20260912-live-poverty.png`.
- „A nezaměstnanost?“ odeslala stejné ID konverzace s baseRevision 2; odpověď z lokální databáze dokončena za 193 ms v jediném pozorovaném browser požadavku (není p95). Severozápad 4,8 %, 2025, 8/8 regionů. Žádný modelový výpočet pro toto srovnání.
- R1 ale při přechodu zoomu spouštěla opětovnou aktivaci s výchozími volbami: otevřela statistický panel a mohla přizpůsobit mapu celému evropskému pokrytí. Nová r2 zachovává pasivní obnovu bez změny panelu/kamery a drží loading až po dokončení výměny vrstvy.
- Trvale otevřený AI náhled zachovává také vyšší vykreslovací pořadí, aby jej po blur nepřekryla legenda.
- R2: 34 testů bez selhání včetně nové regresní kontroly přechodu zoomu, výměny témat a neměnné kamery/panelu. Build, architektura a kontrola tajných údajů prošly.
