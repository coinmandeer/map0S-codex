# Discover: návrat mezi oblastmi, trvalé dlaždice a náhledy Mapy.com

## Změny

- Kliknutí uchová rodiče vybrané oblasti i úroveň sourozenců. Po oddálení alespoň o 0,4 zoomu z jejího přiblíženého výřezu se vrací výběr rodiče a zobrazí okolní oblasti. Velký skok může projít více úrovněmi najednou.
- U vybrané obce zůstává pouze její obrys, okolní obce se vracejí po oddálení. Při zoomu 14 a výše se hranice skrývají. Výběr se při návratu skutečně mění, takže se současně aktualizuje filtr dat.
- Ovládání Borders je ikonou vlevo dole, odsunutou podle šířky otevřeného panelu; na mobilu nad spodním panelem. Nabídka se vejde do obrazovky.
- Mapy.com základní, turistické, zimní a letecké náhledy používají skutečný berlínský tile ze stejné autorizované proxy jako mapa. Žádný API klíč není v prohlížeči. Obrázky se načítají až s viditelnými kartami.

## Načítání hranic

Zdrojové hranice jsou již v lokálním PostGIS, nikoli živě stahované z externí služby. Toto vydání přidává:

1. Cache přehledových MVT na persistentním svazku `/data/boundaries`, společném napříč vydáními. Zápis je atomický, klíč obsahuje neměnnou edici. Scoped dlaždice zůstávají ve zvlášť omezené RAM cache.
2. RAM limit 32 MiB / 2048 položek, disk se promazává na 2 GiB. Chyba cache nesmí blokovat mapu. Starší edice se nezaměňují s novou.
3. Sdílenou 60sekundovou cache manifestu a dostupnosti. Dostupné administrativní úrovně se už neagregují přes všechny obce při každém dotazu na dlaždici.
4. Přehledové dlaždice s nativním zoomem 3 / 5 / 7 / 9. Vyšší zoom znovu používá stejný přehled místo nové serverové geometrie při každém přiblížení.
5. Předběžné generování přehledu Evropy před přepnutím vydání. Resumovatelný generátor `apps/api/src/geo/warmBoundaryTiles.ts --all` doplní také okresy a obce; čte pouze naše importované geometrie a běží se dvěma pracovníky.
6. Lokální manifest v prohlížeči umožní obnovit známou edici hned a ověřit aktualizaci na pozadí.

Předgenerovaný geografický rozsah je −32 až 45° délky a 34 až 72° šířky. Oblasti mimo rozsah se generují na vyžádání. Nejde o nový import úplných městských částí ani o doplnění dosud chybějících dat; zachovává se pravdivý fallback podle země.

## Ověření

Výsledky nasazení, generování a kontrol jsou doplněné po dokončení níže. Podrobný backlog předchozího vydání zůstává v `docs/plans/2026-09-06-implementation-and-integrations.md`.

### Lokální ověření

- Backend: 660 úspěšných testů, 1 přeskočený; frontend: 475 úspěšných, 7 přeskočených. Bez selhání. Nové testy zahrnují cache po vytvoření nového procesu/cache instance a všechny čtyři náhledy Mapy.com.
- Playwright nad místním frontendem a skutečnými daty VPS: Tarragona (zoom 7,38) → Botarell (12,16, žádné okolní polygonové zdroje) → oddálení na 11,56 obnoví obce provincie → 6,78 obnoví sousední provincie včetně Barcelony, Lleidy a Teruelu.
- Mobil 390 × 844: nabídka uvnitř obrazovky, funkční vlastní zavírání i kliknutí mimo nabídku. Desktopové tlačítko stojí za hranou levého panelu.
- Všechny čtyři obrázky Mapy.com v samotném výběru podkladů mají úspěšně dekódovaný skutečný rozměr 256 × 256; snímek zkontrolován. Klíč zůstává na serveru.
- Jediná chyba konzole místního testu je očekávané odmítnutí přihlášení hosta z localhostu produkčním API (403). Žádné oprávnění CORS se kvůli testu nerozšiřovalo.

### Předgenerované dlaždice na VPS

Kontrola 6. 9. 2026 ověřila konkrétní soubory podle hashů klíčů edice `26dd406168ebf8da1fe35d8a4df280d18408ec3fa44b9eca23c070fb4b861ed9`, nikoli jen celkový počet souborů:

| Úroveň                   | Zoomy | Připravené dlaždice | Chybějící |
| ------------------------ | ----- | ------------------: | --------: |
| Země                     | 0–3   |                  16 |         0 |
| Regiony                  | 0–5   |                  92 |         0 |
| Okresy/provincie         | 4–7   |               1 025 |         0 |
| Obce a pravdivý fallback | 6–9   |              14 905 |         0 |
| Celkem                   |       |              16 038 |         0 |

Celkový obsah 162 305 735 B (154,8 MiB), soubory včetně režie svazku přibližně 177,6 MiB. Výsledek kontroly: `output/boundaries-followup/cache-proof.jsonl`. Připravená pyramida neznamená úplné administrativní pokrytí: obsah stále odpovídá publikované edici a jejím uvedeným mezerám. Dlaždice filtrované na konkrétního rodiče vznikají v lokálním PostGIS a využívají RAM cache; nejsou všechny předgenerované.

### Nasazení a měření

- Nasazeno na `https://mapos.promptstudio3000.com` jako **20260906-boundary-navigation-final**. API i web zdravé; nasazovací kontrola zálohy, její obnovy, migrací a čtení/zápisu předchozím obrazem prošla. Záloha: `/opt/ps3000/apps/mapos-v3/backups/20260906-boundary-navigation-final`.
- Po výměně API kontejneru znovu ověřeno všech 16 038 hashovaných souborů: 0 chybějících. Cache přežila nasazení.
- Kontrola veřejného API: detail Tarragony i správná revize; obecní dlaždice omezená provincií vrací 147 prvků / 34 341 B oproti 380 / 91 015 B bez omezení. Funguje i stávající Mapy routing a výchozí herní model.
- Na VPS přes lokální HTTP bylo po vydání provedeno 10 požadavků na každou ze čtyř nativních úrovní: okresní dlaždice 4,33–9,79 ms, obecní 5,14–15,48 ms. Celá měření v `output/boundaries-followup/server-timing.json`. Jde o dobu odpovědi serveru, nikoli interakci prohlížeče nebo srovnatelný benchmark před/po. První požadavek země dosáhl 82,94 ms.
- Veřejný mobilní prohlížeč: Borders a vlastní zavření funkční, flyout x=12 / y=72 / šířka=306 při viewportu 390 × 844. Během samotné výměny kontejnerů zachycen jeden přechodný 502; kontrola po dokončení provedena znovu.

### Co zbývá

- Doplnění chybějících oficiálních městských částí a auditovaného vztahu rodič–potomek; současné omezení potomků používá reprezentativní bod v polygonu rodiče.
- Výběrem omezené dlaždice zatím vznikají na vyžádání. Je vhodné z reálného provozu vybrat často používané provincie pro jejich předgenerování; neprodukovat bez měření kombinace všech filtrů.
- Samostatný opakovatelný benchmark p95 hoveru a paměti s 6/12 vrstvami na zaznamenaném zařízení. Toto vydání takový benchmark netvrdí.
- Po dokončeném načtení veřejné mapy vizuálně ověřeny vykreslené hranice a poloha ikony nad otevřeným mobilním panelem: `output/boundaries-followup/public-map-final.png`.
