# MapOS — statistická konverzace a cyklistické mapy

Nasazeno `20260912-ai-statistics-cycling-r3`, 12. 9. 2026. Záloha/obnova/kompatibilita prošly; veřejné API zdravé. Navazuje na nasazená [r1](20260909-ai-statistics-cycling-r1.md) a [r2](20260912-ai-statistics-cycling-r2.md).

## Výsledek

- Full CyclOSM je dostupná explicitní akcí „Plná cyklistická mapa (podklad)“. Lite zůstává samostatným průhledným překryvem infrastruktury. Značené cyklotrasy přidává samostatná akce přes Waymarked, která zachová ostatní vybrané aktivity.
- Otázka „kde je největší chudoba v ČR“ pracuje s publikovaným regionálním ukazatelem AROPE, zdrojem, obdobím a skutečným pokrytím. Zaměří Česko a aktivuje tematickou výplň. Nepopisuje polohu tazatele.
- Vyhledávání drží konverzaci otevřenou. Navazující otázky dědí ukazatel nebo zemi; přechod do hlavního AI panelu používá stejnou relaci.
- r2 opravilo pasivní obnovu statistiky: neotevírá explorer ani nepřepisuje kameru; staré téma nemůže přepsat nové.
- r3 opravuje dvojí rezervaci prostoru panelů při fitBounds. MapLibre již obsahuje odsazení kamery; nové přiblížení přidá jen chybějící prostor a kontext. Platí i pro obecné zaměřování oblastí.
- Mobilní AI náhled zůstává uvnitř viditelného viewportu a nad sousedními nástroji. Rozložení hlavních prvků se nemění.
- Opožděné potvrzení anonymní relace nemaže první otázku. Skutečné přihlášení, změna účtu a odhlášení nadále ruší běh a odstraňují historii předchozí identity.

## Ověření r3

- 15/15 cílených testů: regionální parser a historie, statistická obnova, camera padding, relace a změny identity. R1/R2 mají další samostatné výsledky v jejich release dokumentech.
- Web TypeScript + produkční sestavení prošly. Kontroly CSS tokenů, architektonických hranic a tajných údajů prošly. Existující upozornění na velké balíky nezaměňovat za nově změřenou regresi.
- Lokální mobilní UI 390 × 844 s reálným veřejným API: z Tarragony na Česko [15,461; 49,823], zoom 4,48 při otevřeném 608px panelu. Odpověď uvádí 8/8 regionů a Moravskoslezsko 14,5 % (AROPE, 2025). Popover x=12, šířka=366, pravý okraj=378. Bez varování o nemožném fitBounds. Screenshot `output/playwright/20260912-mobile-ai-r3.png`.
- Browser běžel přes stávající Playwright CLI, bez nahrazování AI odpovědí fixtures. Emulace viewportu není ověření fyzické mobilní klávesnice.
- V tomto cíleném follow-up nebyl opakován celý benchmark 6/12 vrstev ani 30 cyklů. Dřívější výsledky nejsou novým měřením r3. Živé jednotlivé latence nejsou p95.

## Omezení a další postup

Statistická cesta je omezená na rozpoznané země a implementované ukazatele. Nejde o obecnou analytiku libovolného tématu či obce. Chudoba je výslovně AROPE, ne příjmová chudoba. Zdrojové příznaky kvality a chybějící hranice se neskrývají. Celkové evropské pokrytí není úplné; viz r1. Komunitní cyklistické dlaždice mohou mít výpadky.

Další produktová práce: obecnější rozpoznání analytického záměru nad ověřeným katalogem, další skutečné regionální série, jemnější územní úrovně a návaznost na živou syntézu. Opravené konkrétní dotazy nevydávat za dokončení všech historických AI plánů.

## Veřejná kontrola r3 a následná oprava

- Skutečná konverzace z Tarragony: Česko AROPE → česká nezaměstnanost → španělská nezaměstnanost. Česká kamera zůstává [15,461; 49,823], zoom 6,5 na desktopu; druhá otázka má stejné conversation ID a revision 2. Regionální barvy potvrzené screenshotem `output/playwright/20260912-public-r3-unemployment.png`.
- Mobilní reload s již existujícím guest účtem odhalil další variantu startovacího závodu: r3 zachovala pouze první null identitu, ale první guest UUID stále vymazalo otázku. Nejde o kompletně ověřenou opravu bootstrapu; r4 přijímá první serverově potvrzenou identitu a ruší běh až při skutečné následné změně.
