# MapOS — cyklistické mapy a návazná statistická odpověď

Nasazeno **`20260912-ai-statistics-cycling-r5`**, 12. 9. 2026. Veřejná aplikace: https://mapos.promptstudio3000.com. VPS current i veřejný browser ověřeny.

## Změny celé opravy

- Explicitní plný podklad CyclOSM, samostatná infrastruktura Lite a značené cyklotrasy Waymarked. Změna kamery není součástí přepnutí podkladu; přidání cyklistické aktivity zachovává další vybrané sítě.
- Otázka na chudobu v ČR používá regionální publikovaná data AROPE, zaměří Česko a připojí tematickou výplň. Navazující otázky zachovávají zemi/ukazatel/rok. Search a AI panel sdílejí konverzaci.
- Obnova statistiky neotevírá další panel ani nepřeskakuje na celé pokrytí. Mobilní zaměření nezapočítává panely dvakrát; náhled se vejde do viewportu a zůstává nad nástroji.
- Legenda ukazuje jednotku, nikoli počet barevných stupňů vydávaný za počet měření.
- R4 zachová otázku při prvním potvrzení serverové identity, včetně uloženého guest účtu; změna účtu/odhlášení nadále zneplatní historii a probíhající práci.
- R5 před prvním autentizovaným chatovým požadavkem počká na stejný guest bootstrap, který už provádí shell. První návštěvník bez cookie tak nedostane předčasnou 401. Stop odpojí jen čekající chat, ne inicializaci zbytku aplikace. Čekání má 8s limit a konkrétní chybu s možností otázku zopakovat; neodesílá automatický retry.

## Ověření před vydáním

- 19/19 cílených testů: sdílený bootstrap/Stop, první null/guest identita, změna účtu a logout, camera padding, statistická obnova, parser a kontext, legenda.
- Produkční web build/TypeScript prošel. Existující upozornění na velké bundly je evidované odděleně.
- Lokální mobilní browser + reálné veřejné API: odstraněny cookies testovacího browseru, `/auth/guest` zdržen před odesláním o 1,5 s. Otázka „kde je nejvetsi chudoba v CR“ a „A nezaměstnanost?“ obě uspěly bez chybového chat HTTP. Nešlo o fixture odpovědi. Zpoždění se po scénáři odstranilo.
- R4 ověřilo opožděné doručení skutečné guest odpovědi o 1,8 s: již získaný přehled zůstal zachovaný.
- R3 veřejně ověřilo řetězec ČR/chudoba → ČR/nezaměstnanost → ES/nezaměstnanost, kameru i vykreslení regionálních dat. Důkazy a jednotlivé mezikroky: [r1](20260909-ai-statistics-cycling-r1.md), [r2](20260912-ai-statistics-cycling-r2.md), [r3](20260912-ai-statistics-cycling-r3.md), [r4](20260912-ai-statistics-cycling-r4.md).

- Browser Stop během zpožděného bootstrapu: 0 požadavků `/v2/ai/chat`, loader skončil, zpráva o zastavení zůstala i po dokončení bootstrapu.

## Skutečná omezení

Rozpoznávání statistických dotazů pokrývá konkrétní ukazatele a země, nikoli libovolné obecní téma nebo kompletní obecnou modelovou analytiku. AROPE není samotná příjmová chudoba. Zdrojový rok, kvalita a chybějící pokrytí zůstávají uvedené. Živá plná syntéza, další regionální řady a širší analytické záměry jsou produktový backlog.

V tomto cíleném follow-up nebyl opakován celý 6/12vrstvový benchmark ani 30 cyklů. Jednotlivá odezva není p95. Mobilní emulace není zkouška fyzické klávesnice. Komunitní mapové dlaždice mohou mít externí výpadky.

## Finální veřejné ověření

- `current` ukazuje na `releases/20260912-ai-statistics-cycling-r5`. API `/api/health` vrací OK; API i web jsou healthy.
- Záloha a skutečná obnova 89 tabulek, migrace kandidáta, HTTP zdraví kandidáta, PostgreSQL import/ochrany dat a čtení/zápis předchozího image prošly. Důkaz: `/opt/ps3000/apps/mapos-v3/backups/20260912-ai-statistics-cycling-r5/RESTORE_DRILL.txt`, ověřeno 2026-09-12T09:13:24Z.
- Veřejný mobilní browser 390 × 844 bez cookies a uloženého stavu: z Tarragony otázka na českou chudobu → správná odpověď 8/8 NUTS 2 → česká tematická vrstva → navazující nezaměstnanost ve stejné konverzaci, revision 2. Nula chybových chat HTTP. Kamera zůstala [15,461; 49,823], zoom 4,5 při otevřeném mobilním panelu.
- Náhled x=12, šířka=366, pravý okraj=378; screenshot `output/playwright/20260912-public-r5-mobile.png`. Regionální výplně ověřeny po načtení také na desktopu: `output/playwright/20260912-public-r5-map.png`. Rozšíření viewportu zachovalo zoom; nejde o automatické přizpůsobení na celou Evropu.
- Veřejný katalog obsahuje tlačítka plné CyclOSM a značených cyklotras. Lokální kontrola skutečného rendereru ověřila oficiální full `/cyclosm/` a `waymarkedtrails.org/cycling` zdroje s nezměněnou kamerou. Legenda na veřejném webu již uvádí pouze `Jednotka %`.
- Veřejná desktopová konverzace ČR → změna ukazatele → Španělsko a návrat do hlavního AI panelu byla ověřena v r3; sdílená datová cesta se v r4/r5 neměnila.

Nebyly vytvořeny nové databázové migrace v tomto follow-up. Aplikaci lze vrátit na předchozí release; importované publikované řady zůstávají kompatibilní.
