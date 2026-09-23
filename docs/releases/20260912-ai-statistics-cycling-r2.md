# MapOS — dokončení AI statistik a cyklistických voleb

## Vydání

Nasazeno jako `20260912-ai-statistics-cycling-r2` dne 12. 9. 2026. VPS ověřil obnovu zálohy a zdraví služeb. Následná mobilní kontrola našla dvojí camera padding a přesah náhledu; ty dokončuje r3. Navazuje na nasazené [r1](20260909-ai-statistics-cycling-r1.md), které obsahuje data, opravu konverzace a cyklistické volby.

## Rozdíl proti r1

- Pasivní změna rozlišení statistiky zachová panel a kameru. Automatická obnova již nepoužívá volby určené pro explicitní otevření statistického exploreru.
- Výměna tématu zůstává označená jako probíhající až do připojení nového tématu. Mezikrok nemůže obnovit předchozí statistiku přes novější zadání.
- AI náhled po ztrátě focusu zůstává nad legendami stejně jako při psaní. Rozložení hlavních ovládacích prvků se nemění.

## Ověření

- 34/34 cílených testů (statistický runtime, store, tematický renderer/manifesty).
- Nový test simuluje změnu zoomu mimo pokrytí zdroje a výměnu chudoba → nezaměstnanost. Nula změn kamery, panel zůstane zavřený, aktivní je pouze nové téma.
- Web build včetně TypeScript prošel; architektura 4 037 importů / 946 souborů; kontrola tajných údajů prošla. Upozornění na velikost některých balíků je původní technický dluh.
- Živá čísla, zdroje a importní pokrytí viz r1. Žádné nové databázové schéma v r2.

## Praktické použití

- Do vyhledávání: „kde je největší chudoba v ČR“, potvrdit Enterem. Odpověď používá regionální AROPE a automaticky přizpůsobí mapu Česku. „A nezaměstnanost?“ naváže ve stejné zemi; „A ve Španělsku?“ změní zemi a zachová ukazatel.
- U CyclOSM Lite je „Plná cyklistická mapa (podklad)“ a samostatné „Zobrazit značené cyklotrasy“. První výslovně mění podklad; druhé přidává cyklistickou síť k ostatním zvoleným aktivitám.
- Podpora statistických otázek je omezená na implementované ukazatele a rozpoznané země. Libovolná obecní analytika ani obecná živá modelová rešerše se tímto vydáním nepředstírá. Nedostupné údaje se nenahrazují nulou nebo popisem aktuální polohy.

## Živá konverzace (backend r1, 12. 9. 2026)

Ověřeno na veřejné doméně bez simulace odpovědi: „kde je nejvetsi chudoba v CR“ → „A nezaměstnanost?“ → „A ve Španělsku?“. Poslední otázka zachovala nezaměstnanost a přešla na 19/19 španělských NUTS 2; tabulka uvádí zdrojové poznámky. Přechod do AI panelu zachoval všechny tři otázky bez opakování původního dotazu.
