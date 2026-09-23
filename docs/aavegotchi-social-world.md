# MapOS Hry — 3D Aavegotchi a sociální mapa

Implementace pilotu, 5. září 2026. Hlavní kód je v `apps/web/src/world`,
`apps/api/src/world`, `apps/api/src/routes/worldRoutes.ts` a sdílené DTO v
`packages/layer-sdk/src/world.ts`. Hry používají existující MapLibre mapu a jediný
GameHost/Three.js kontext. Sociální rozhraní funguje také mimo Hry.

## Co je zapojené

- Base inventář, ověření `ownerOf` proti ověřeným peněženkám současného MapOS účtu,
  výběr vlastního tokenu a serverová cache skutečného GLB podle traitů a výbavy.
  Chyba indexeru je odlišena od prázdného inventáře. Půjčené tokeny nejsou podporované.
- 3D esence, otevíraná truhla, portál, původní MapOS varianty Lickquidatora a Strážce
  portálu, anonymní duchové a majáky veřejných zpráv. Vlastní gotchi používá reálnou
  geometrii; neutrální duch je výslovně náhradní postava.
- GPS, přepnutí na testovací šipky/WASD, kamera shora, návrat k hráči, HP/XP,
  inventář a odznaky. Klávesy ignorují psaní do formulářů. Mezerník střílí, Q sesílá
  kouzlo na vybraný cíl. Cíl lze vybrat v mapě nebo seznamu.
- Autoritativní sběr, projektil, plošné kouzlo v okruhu 15 m na záměrně zahájená
  setkání, běžný boj a společný boss pro 2–8 hráčů. Boss má dvě fáze a společné HP.
  Arena má samostatné herní pozice; účast v boji neposouvá GPS pro odměny.
- Návštěvní quest, keš s neveřejnou odpovědí, checkpointová trasa, raid quest a
  vytvoření questu s časovým oknem. Existující externí questové zdroje slouží jako
  kotvy návštěvních MapOS questů; nevytváří to externí geocachingový log.
- Přítomnost vypnutá při vstupu, anonymní okolí do 1 km, stabilní přibližná oblast
  150 m, přijetí kontaktu, oblíbené kontakty, hodinový check-in a oddělený souhlas
  s přesnou polohou na 15 minut. Anonymního hráče lze blokovat bez odhalení identity.
- Trollbox: 100/500/1000/10000/20000/50000 m nebo výřez mapy, stránkování, veřejný
  profil, místo publikace a serverové rozlišení místního/vzdáleného/neověřeného původu.
- „Zanechat zprávu“ z Hry, detailu místa, kontextového menu nebo dlouhého podržení
  mapy: veřejné vlákno, odpovědi, editace, uzavření, nahlášení a uložení do Moje.
  Reference `social-thread:<id>` používá stávající saved-places službu a retry
  nevytváří druhou záložku. Odstranění záložky nemaže veřejný obsah.
- Soukromý textový chat schválených kontaktů, starší historie, nepřečtené zprávy,
  opakování odeslání a okamžité serverové odmítnutí po blokaci/ukončení propojení.
  Obsah není E2EE; HTTPS/WSS zajišťuje nasazovací vrstva. Místní localhost používá HTTP.

## Provoz a konfigurace

Produkční API používá PostgreSQL/PostGIS. Migrace `0021_aavegotchi_social_world`
zakládá `world_*` tabulky pro progres, ledger odměn, vztahy, blokace, oblíbené,
vlákna, zprávy, přečtení, questy, hlášení, výsledky bojů a potvrzení akcí.
Herní inventář a odznaky jsou součástí profilu; session a krátkodobá přítomnost jsou
záměrně v paměti. Restart ukončí nedokončené souboje, potvrzené odměny zůstanou.
Pilot vyžaduje jednu autoritativní instanci API; není určen pro více nezávislých workerů.

| Nastavení                                     | Význam                                                    |
| --------------------------------------------- | --------------------------------------------------------- |
| `MAPOS_WORLD_ENABLED=1`                       | Zapnutí vrstvy; `0` vrací pro svět 503                    |
| `MAPOS_GAME_TEST_MOVEMENT=0`                  | Produkční zákaz testovacích session                       |
| `MAPOS_GOTCHI_LIVE_ENABLED=1`                 | Živý inventář; `0` zachová explicitně zablokovaný adaptér |
| `MAPOS_GOTCHI_CACHE_DIR=.cache/mapos-gotchi`  | Trvalý adresář optimalizovaných modelů                    |
| `MAPOS_BASE_RPC_URL=https://mainnet.base.org` | Base RPC pro vlastnictví                                  |
| `MAPOS_WORLD_MODERATORS`                      | Čárkou oddělená MapOS ID moderátorů                       |
| `MAPOS_WORLD_ORIGIN`                          | Přesný další origin lokálního memory pilotu               |

Odměny jsou centrálně v `WORLD_REWARDS`: esence 10 XP, nepřítel 25,
návštěva 50, keš 100, raid 150 a odznak. Historické XP jsou počáteční zůstatek,
nové GPS odměny se transakčně přičítají k profilu uživatele. Testovací ledger je oddělený.
Stará rozhraní pro klientem hlášené orb odměny a přepis herního stavu vracejí 410,
a to i při vypnuté nové vrstvě. Klientem zaslaná hodnota XP není akceptována.

Souřadnice zařízení jsou v paměti nejvýše dvě minuty. Pro odměny je poloha použitelná
nejvýše 30 sekund s přesností do 40 m. GPS, herní poloha a veřejná přítomnost jsou
oddělené DTO. Cizí anonymní hráč nedostane wallet, token, URL modelu ani přesnou GPS.
Schválení kontaktu samo nezapíná přesnou polohu. Výpadek spojení/přesné polohy
rychle vyřadí živou přítomnost. Kontrola polohy není důkaz odolný proti GPS spoofingu.

Veřejné moderování: autorizovaný účet volá `POST /v2/world/threads/moderate` s `id`.
Hlášení jsou v `world_reports`. Blokace funguje obousměrně pro přítomnost i přístup
ke konverzaci. Export a odstranění účtu zahrnují novou vrstvu. Běžné logy nemají
obsah soukromých zpráv ani syrové souřadnice.

## Assety a původ

Inventář a společná Base adresa vycházejí z
[oficiálního registru](https://github.com/aavegotchi/deployed-contract-addresses).
Hash vzhledu a rozhraní `GLB_3DModel` vycházejí z
[oficiálního rendereru](https://github.com/aavegotchi/aavegotchi-3d-render-skill).
Model nejdříve ověřujeme; nevynucujeme regeneraci existujícího modelu při každém vstupu.
Stažený GLB se optimalizuje pomocí glTF Transform, Meshoptimizer a Sharp: zachování
výbavy, textury 512/256 px a dvě úrovně geometrie. Statické modely používají procedurální
levitaci, otočení a odezvu útoku, nikoli tvrzení o existujících skeletálních klipech.

| Ověřený token | Vyšší detail | Mobilní detail | Trojúhelníky mobilního modelu |
| ------------- | -----------: | -------------: | ----------------------------: |
| 100           |  2 737 852 B |    1 094 808 B |                        11 796 |
| 4211          |  2 910 960 B |    1 099 548 B |                         9 047 |
| 9040          |  3 324 988 B |    1 402 064 B |                        13 605 |

Tyto tři skutečné GLB byly načtené a vizuálně ověřené v mapě. Cache obsahuje hash
vzhledu a metriky každého LOD. Vlastní model se načítá postupně; nejbližší schválený
kontakt může mít mobilní LOD, ostatní používají neutrální geometrii. Tím se omezuje
počáteční objem assetů; plošná garance pro libovolnou kombinaci tokenů není změřená.

[DeFi Dungeons Verse](https://github.com/cinnabarhorse/defi-dungeons-verse) slouží jako
inspirace pro oddělení postav, schopností, lootů a sdílených encounterů. Jeho Phaser
renderer ani sprite assety nejsou kopírované. MapOS objekty, anonymní duch a varianty
nepřátel jsou původní procedurální geometrie, nejsou vydávané za oficiální Aavegotchi
3D assety. Práva k NFT vzhledu a ochranným známkám zůstávají jejich držitelům.

## Ověření a opakování

Z kořene repozitáře:

```sh
npm run build -w @mapos/layer-sdk
npm run typecheck -w @mapos/api
npm run typecheck -w @mapos/web
node --import tsx --test apps/api/src/world/*.test.ts apps/api/src/routes/worldRoutes.test.ts apps/api/src/security/publicApiHardening.test.ts
node --import tsx scripts/world-postgis-smoke.mjs
npm run build -w @mapos/web
```

PostGIS smoke používá místní `infra-postgres-1` na portu 5434, vytváří vlastní dočasnou
databázi a po kontrole ji odstraní. Ověřuje migraci, vzdálenosti v metrech, výřez,
transakční připsání XP i rollback.

Lokální browser pilot (oddělené porty od ostatní práce):

```sh
PORT=4047 MAPOS_WORLD_ORIGIN=http://localhost:5199 MAPOS_FIXTURE_MODE=offline MAPOS_GAME_TEST_MOVEMENT=1 node --import tsx apps/api/src/memory-server.ts
MAPOS_DEV_API_PORT=4047 npm run dev -w @mapos/web -- --port 5199 --strictPort
node scripts/world-browser-smoke.mjs
```

Browser smoke očekává cache výše uvedených tří ověřených modelů. Testuje dvě oddělené
relace, testovací pohyb, sběr 10 XP, anonymitu, přijetí kontaktu, soukromou historii,
společného bosse s výsledkem 160/150 XP, veřejné vlákno a opětovné otevření z Moje po
reloadu. Tři tokenové modely testuje samostatně přes vývojový renderer; nepředstírá
podepsání cizí peněženky. Výstupy jsou v `output/world`, včetně snímků a JSON stavu.
Memory server je demonstrace bez trvalého uložení po restartu; produkční API používá DB.

Automatizované kontroly pokrývají cizí token, přesnost a stáří GPS, vypnutý testovací
režim, souběžné sběry, idempotenci, reconnect, raid, žádosti a blokace, vypršení přesné
polohy, všechny poloměry, stránkování, soukromé odpovědi ke keším a export/mazání účtu.
Zátěžový smoke ověřil 100 WebSocket spojení a doručení 200 snapshotů přibližně za 2,4 s;
není to dlouhodobý produkční soak test. V prohlížeči prošel průchod bez JS chyb,
mobilní viewport i tři skutečné modely. 30 FPS na fyzickém mobilu / 60 FPS desktop
zůstává měřením pilotu, ne doloženým slibem této implementace. Podpis skutečné vlastní
peněženky je nutné ověřit uživatelem, bez předávání privátního klíče.

## Navazující finanční/NFT odměny

Stávající evidence `RewardGrant` je základ pro oddělený nárok: vypsaná odměna →
splnění → ověření → claim → vyzvednutí. Budoucí reward pool bude mít rozpočet, chain,
asset, limit claimů a expiraci; claim unikátní podle uživatele a splnění. Peněžní
ověření musí přidat silnější důkaz než prohlížečovou GPS a výplata musí mít vlastní
idempotentní on-chain transakci. Dnešní esence jsou herní materiály, XP jsou MapOS XP,
nepřevádějí se automaticky na Alchemica nebo on-chain Aavegotchi XP. Finanční/NFT
výplaty ani E2EE nejsou součástí tohoto pilotu.
