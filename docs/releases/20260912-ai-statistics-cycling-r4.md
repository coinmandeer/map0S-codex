# MapOS — dokončené cyklistické volby a statistická konverzace

Nasazeno `20260912-ai-statistics-cycling-r4` dne 12. 9. 2026, navazuje na [r3](20260912-ai-statistics-cycling-r3.md), [r2](20260912-ai-statistics-cycling-r2.md) a [r1](20260909-ai-statistics-cycling-r1.md). Záloha, obnova a zdraví služeb prošly. Finální veřejný průchod zahrnuje následné r5, které navíc čeká na vytvoření cookie při úplně první návštěvě.

## Co uživatel dostává

- Plná CyclOSM je dostupná mezi podklady a přímou akcí vedle Lite. Značené cyklotrasy mají samostatnou akci; nemění kameru ani ostatní vybrané aktivity. Lite není náhradou celé cyklistické mapy.
- Dotaz „kde je největší chudoba v ČR“ zaměří Česko, zobrazí regionální statistiku a odpověď s ukazatelem, obdobím a zdrojem. Zůstává otevřená konverzace s kontextem dalších otázek a návazností na hlavní AI panel.
- Mapa při automatické obnově nepřeskakuje na celé evropské pokrytí ani neotevírá statistický explorer. Mobilní fit nepočítá panely dvakrát a náhled nepřesahuje obrazovku.
- R4 odstraňuje zbývající mazání první otázky při obnově uloženého guest účtu. První potvrzení identity přebírá identitu cookie, kterou již používají API požadavky. Každá další změna účtu/odhlášení ruší běh a maže historii. Anonymní bootstrap, guest bootstrap, opakované potvrzení a změny účtu mají regresní testy.
- Legenda už nezaměňuje počet položek barevné stupnice za počet skutečných měření. Uvádí jednotku; regionální pokrytí zůstává v odpovědi.

## Ověření

- 18/18 cílených testů poslední opravy, včetně bootstrapu a zneplatnění identity, fitBounds, statistické obnovy, rozpoznání kontextu a legendy.
- Web TypeScript a produkční build prošly. Architektura a kontrola tajných údajů prošly. Dřívější samostatné sady R1/R2 a jejich rozsah viz příslušné dokumenty.
- Lokální mobilní browser s živými daty: skutečná odpověď guest bootstrapu záměrně pozdržena o 1,8 s (obsah nezměněn). Již získaná odpověď na chudobu přežila příchod identity ve 2,28 s. Poté se kontrola vrátila k běžnému síťovému provozu.
- R3 veřejně ověřila celý statistický řetězec a regionální vykreslení; R4 doplní veřejný mobilní reload a potvrzení finálního vydání níže.

## Omezení

Statistický parser podporuje konkrétní implementované ukazatele a země; libovolná obecní analytika a obecná živá modelová syntéza zůstávají nedokončené. AROPE je ohrožení chudobou nebo sociálním vyloučením. Nejde o samostatnou míru příjmové chudoby. Pokrytí a kvalita zdrojů viz r1. Živé jednotlivé doby odezvy nejsou p95; v tomto follow-up se neopakoval celý 6/12vrstvový benchmark ani 30 cyklů.
