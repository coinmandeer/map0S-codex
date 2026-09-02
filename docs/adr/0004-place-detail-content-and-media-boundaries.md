# ADR 0004: Detail místa odděluje zdroje a bezpečně zobrazuje média

- Stav: přijatý bezpečný první řez; rights blokování je částečně nahrazeno ADR 0012
- Datum: 2026-09-01
- Vazba na plán: Phase 12, OS-007 až OS-010, OS-022, MAP-014 až MAP-016

## Kontext

Dosavadní `PinDetail` skládal vlastní akce podle konkrétního provideru, zobrazoval fotografii jako
holou URL a připojil komunitní obsah pod plochý seznam zdrojových panelů. Nebylo zřejmé, zda
hodnocení pochází od provideru nebo z MapOS, a URL fotografie nenesla autora, licenci, moderaci ani
stav transformace.

Master plán požaduje manifestový detail a akce a oddělení provider / MapOS / private obsahu.
ADR 0012 později změnilo source-rights metadata na advisory; technická bezpečnost URL, moderace a
stav transformace zůstávají povinné.

## Rozhodnutí

- Detail má pět stabilních ploch: `overview`, `media`, `practical`, `social`, `more`. Plocha se
  zobrazí jen tehdy, když má reálný panel, data nebo bezpečnou uživatelskou funkci.
- Registry panel deklaruje plochu, vlastníka obsahu a případný zdroj. Providerové recenze, MapOS
  komunita a soukromá poznámka se vykreslují v oddělených a označených blocích.
- Providerová pole smí UI načíst jen z `fieldOrder` existujícího layer manifestu. Nevyjmenované
  položky opaque payloadu se nikdy automaticky nevykreslí.
- Nový detail přijme médium s konkrétním `sourceId`, názvem zdroje, stavem
  `moderationStatus: approved`, stavem `transformStatus: ready` a HTTP(S) URL. Atribuce a licence
  cestují s assetem jako advisory metadata, ale jejich absence zobrazení v prototypu neblokuje.
  Legacy `photo: string` zůstává pouze v rollback větvi, nikoli v nové strukturované cestě.
- Providerová akce je v tomto řezu pouze validovaný HTTP(S) deep link. UI nikdy nepředstírá
  providerový zápis ani automatické přihlášení. Neznámé write/commerce/custom akce se přeskočí.
- Přidání do plánu používá veřejný `PlanDocument` command engine, zachová stabilní feature ID a
  vzdáleně nic neukládá, dokud uživatel plán explicitně neuloží.
- Přesný OSM ref nabídne skutečnou opravu/nahlášení v OSM editoru. Obecné MapOS hlášení se nebude
  fingovat, dokud nevznikne append-only `reports` úložiště, ACL, moderace a audit.
- Soukromá poznámka v prvním řezu funguje offline pouze v daném zařízení a je takto označená.
  Synchronizace mezi zařízeními čeká na owner-only storage a ACL testy.

## Chybové a offline chování

Kliknutý pin se zobrazí okamžitě z mapového snapshotu. Selhání serverového detailu ponechá lokální
obsah viditelný, rozliší offline stav a nabídne retry. MapOS komunitní data mají vlastní
loading/empty/error stav a jejich selhání nesmaže providerový detail ani soukromou poznámku.

## Rollback a otevřené gates

- `VITE_DETAIL_SURFACE_V2=0` vrátí plochý legacy detail bez změny mapového runtime.
- GATE-P12-REPORT: nativní MapOS `reports`, moderace a audit musí být přidány aditivní migrací a se
  serverovou autorizací; do té doby se akce ukazuje jen tam, kde existuje pravdivý provider edit/
  report deep link.
- GATE-P12-PRIVATE-SYNC: synchronizované poznámky vyžadují owner-only API, šifrovaný transport,
  export/delete a test proti úniku mezi uživateli.
- GATE-P12-MEDIA-INGEST: upload, malware/MIME kontrola, EXIF policy, transcode, variants a moderation
  worker nejsou součástí tohoto řezu; UI proto přijímá pouze bezpečné, moderované a připravené assety.
- AI enrichment zůstává mimo tento řez podle aktuálního zadání; jeho budoucí task/citation/empty
  kontrakt nesmí oslabit výše uvedené zdrojové hranice.
