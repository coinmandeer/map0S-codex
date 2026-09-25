# MapOS – UX opravy po uživatelské kontrole

Vydání: `20260905-ux-discover-final`. Nasazeno a ověřeno na https://mapos.promptstudio3000.com.

## Implementováno

- Výchozí režim bez explicitního odkazu je Discover. Aktivní rozpracovaná trasa se po reloadu neobnovuje. Prázdný plán nabízí dvě prázdná hledání; skutečný dokument vznikne až výběrem obou míst. Uložené a sdílené plány zůstávají přístupné.
- Kliknutí hranice vybere oblast, přiblíží mapu a požádá o další správní úroveň. Při oddálení se vrací automatické prahy. Od zoomu 14 se skrývají všechny hranice včetně starého regionálního překryvu. Obce přejdou do uličního pohledu, pokud nemáme ověřené části města.
- Jedno tlačítko Borders, zapnutí/vypnutí a zrušení výběru. Bez samostatných tlačítek zoom/refresh a názvu oblasti.
- Pravé tlačítko, dlouhý dotyk (650 ms) a setrvání kurzoru (1,8 s) vytvoří dočasné místo s lokálním menu. GPS název se doplní se zrušitelným požadavkem. Detail, zpráva, přidání do trasy a uložení využívají existující cesty.
- Zpráva má kompaktní nativní dialog a stávající composer; nic se nepublikuje před odesláním uživatelem. Potlačen syntetický klik po dlouhém dotyku.
- Odstraněn středový pin a oba vstupy What is here. Hledání je vlevo; logo animuje aktivní úlohy a otevírá Map status s individuální obnovou vrstvy i Search this area.
- OSM POI mají minimální zoom 8; ruční opakování tento limit neobchází. Ikony jsou kruhové a větší, bez nožičky.
- Počasí při chybě nesmaže staré zobrazení ani neohlásí prázdný úspěch; odpojení vrstvy zneplatní čekající odpověď.
- 13 skutečně vykreslených náhledů Berlína. 20 podkladů s klíčem/licenčním omezením a jeden nedostupný zdroj mají výslovný fallback. VIIRS používá zoom 6 kvůli dostupnému rozsahu, ostatní zoom 11.
- Discover připojuje publikované statistiky obsahující vybranou souřadnici a zachovává skutečnou geografickou působnost, rok a citace. Na VPS importovány World Bank population, PM2.5 a forest cover (1196 řádků na sadu včetně null hodnot; počty nejsou počty aktuálně naměřených zemí).
- Hra má volný pohyb šipkami/WASD i bez testovacího serveru. GPS při vstupu smí posunout počátek jen před prvním pohybem. Návrat k hráči a bližší kamera používají skutečnou lokální pozici.
- Veřejný výchozí vzhled Aavegotchi #100 využívá existující přípravu GLB; neznamená vlastnictví NFT. Přístup k ostatním modelům a ověřeným odměnám zachovává původní kontroly. Nízké LOD: 1 094 808 B, 11 796 trojúhelníků; model se načítá pouze ve hře.
- Herní okolí se aktualizuje po sektorech se zrušením starého požadavku, nejvýše 96 teček. Lokální návštěvy a sběr jsou označený průzkum, ne serverové XP. Průzkumné cíle jsou viditelné v panelu.

## Ověření

- API: 651 prošlo, 1 přeskočený test. Web: 473 prošlo, 7 přeskočených testů.
- Přidané regresní kontroly: žádné načítání ani retry regionálních POI pod prahem, úspěšné načtení po přiblížení, chyba počasí a předání AbortSignal.
- Oba produkční buildy prošly. Zůstává upozornění na velké JS chunky; toto vydání neprohlašuje hlavní bundle za optimalizovaný.
- Browser: lokální menu, dialog zprávy, mobilní Map status, prázdný plán po reloadu a přechod na platnou trasu po zadání dvou souřadnic.
- Herní klient: dva běhy pohybu, screenshoty a stav v `output/playwright/ux-game-final/`. Skutečný GLB vykreslen, klávesy mění pozici, žádný soubor konzolových chyb. Referenční scéna má nejvýše 96 teček. Frame metriky jsou čas renderu herní scény, nikoli celkové FPS aplikace.

## Skutečně zbývá

1. Import ověřených městských částí: LAU nemá tuto granularitu. Nepředstírat evropské pokrytí ani nevyrábět libovolnou mřížku místo částí města.
2. Podrobnější crime/environment data: nyní přidané World Bank hodnoty jsou státní agregáty, nejsou živá lokální měření. Národní/regionální zdroje vyžadují ověřené publikace a geografické vazby.
3. Dokončit bohatý fotografický souhrn libovolného GPS místa. Nyní je rychlý GPS název a navazující existující detail/průvodce; úplná fotogalerie není zaručena všude.
4. Věrné náhledy zbývajících poskytovatelů podle oprávnění a dostupných klíčů.
5. Plný QuestLayer: importy různých veřejných questů, jejich licence a původ, vícefázové úkoly, multiplayer a originální modely konkrétních památek. Lokální tečky a průzkumné cíle tento rozsah nenahrazují.
6. Rozšířit CDN/cache strategii a politiku aktualizace výchozího modelu. Ověřený model už je předpřipravený v trvalém svazku na VPS; studené instalace bez této mezipaměti stále potřebují dostupný zdroj.
7. Nové dlouhé benchmarky 6/12 vrstev, paměť a fyzická mobilní zařízení. Předchozí čísla nesměšovat s tímto vydáním. Změřit reálný sběr bodů a postup questů v různých silničních sítích, nejen pohyb a vykreslení.
8. Rozdělení hlavního webového balíku a odstranění zbývajícího neaktivního starého UI kódu až s kontrolou zpětné kompatibility.

Mobilní dokončení: hledání rezervuje pravý sloupec ovládání; stav vrstvy pod minimálním zoomem nabízí přiblížení místo neúčinného opakování požadavku. Veřejná kontrola dále odhalila zrušení úrovně obcí při automatickém oddálení na celou provincii; programatické přizpůsobení a ruční oddálení jsou nyní rozlišeny.

Výchozí GLB byl ověřený lokálně, ale renderer vracel VPS nepodporovaný typ odpovědi. Využívá proto předpřipravený ověřený cache manifest a oba LOD soubory ve svazku `mapos-v3_mapos-v3-gotchi`; nekopíruje se do Git repozitáře ani webového balíku. Tři transportní testy včetně nového testu studeného startu z cache bez upstreamu prošly.

## Závěrečné veřejné ověření

`20260905-ux-discover-final` je zdravé vydání, záloha a zkušební obnova prošly. Všech sedm veřejných smoke kontrol prošlo. Na veřejné mapě ověřen přechod provincie → obecní dlaždice a poté zoom 14,2 bez hranic po ustálení načítání. Výchozí #100 má status ready, jeho veřejný GLB vrací HTTP 200 a v produkčním browseru se vykreslil; šipka posunula avatara. Nové zemské statistiky pro Španělsko jsou v odpovědi Discover včetně roku a územní působnosti. Artefakty: `output/performance/ux-discover-play-verification.json`, `ux-public-smoke.txt` a `output/playwright/ux-production-*.png`.

Pozor pro další iteraci: při prvním přechodu na dosud nenahrané obecní dlaždice je do připravení nové sady vidět předchozí celek. Také úplné odstranění výplně při přechodu na ulici je navázáno na připravenost stylu. Dále měřit a zkrátit tento přechod; nevydávat první studený přechod za okamžitý.
