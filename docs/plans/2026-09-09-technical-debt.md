# MapOS — technický dluh oddělený od produktového vydání

Stav 9. 9. 2026. Tento backlog není závazkem okamžitého přepisu. Chybné oprávnění, nepravdivý stav, nedokončený potřebný abort a nesprávné filtrování zůstávají součástí právě vydávané funkce.

| Oblast / konkrétní místo                                             | Zjištění a riziko                                                                                                                        | Kdy řešit / ověření                                                                                                                                     |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI brief a obecný chat: apps/api/src/services/ai, routes/aiRoutes.ts | Nový OverviewService a starší obecný tool-loop nejsou plně sjednocené; legacy brief má historickou službu vedle kompatibilního adaptéru. | Při změně sdíleného sběru a rozpočtů; nejprve vypsat odběratele, zachovat veřejný endpoint a source-only hranici.                                       |
| AI souběh: gateway                                                   | Globální souběh je procesový.                                                                                                            | Před druhou API instancí koordinovat společný limit; test souběhu přes procesy. Žádný nový broker bez potřeby.                                          |
| Map state: apps/web/src/store/mapStore.ts a tasks                    | Velký store a několik pracovních stavů zvyšují riziko zbytečných renderů a různých interpretací stavu.                                   | Refaktor pouze po profilu konkrétního přerenderování. Produktové sjednocení významu statusu dělat nyní.                                                 |
| Balíky webu                                                          | Sestavení upozorňuje na velké chunky; historické velikosti nejsou současná baseline.                                                     | Měřit startovní graf a komprimované přenosy. Oddělit jen skutečně nepotřebné startup závislosti, ne přepis frameworku.                                  |
| Importy / edice                                                      | Více importních postupů a různá síla důkazů v historických plánech.                                                                      | Obecný provozní refaktor po dokončení rychlé distribuce existujících hranic. Test atomické publikace a návratu.                                         |
| Historická dokumentace                                               | Starší záznamy oprav někdy odporují současnému kódu (např. auto-overlay v plánování).                                                    | Aktualizovat master a současný stav, historická vydání ponechat označená datem.                                                                         |
| Testovací infrastruktura                                             | Jednotkové a browser scénáře se překrývají; některé fixtures nezaručují živou dostupnost zdroje.                                         | Rozlišovat typ důkazu a konkrétní revizi. Neopakovat plné sady bez změny nebo pochybnosti.                                                              |
| Technologie Martin/deck.gl/Cesium                                    | Návrhy, nikoli prokázaný dluh.                                                                                                           | Martin až pro doložený dynamický SQL bottleneck; deck.gl pro konkrétní velké agregace; Cesium jen izolovaný Planet. Změřit bundle/GPU a životní cyklus. |

## Co sem nepatří

Plná syntéza AI, její relevance a citace jsou produktová funkce. Neaktivní FSQ/Google jsou integrace a aktivační kroky. Numerická hloubka, statistické pokrytí, questy a Planet jsou produktový backlog. Jejich odložení nesmí z UI dělat nefunkční aktivní přepínače.

## Forma budoucích úkolů

Každý úkol musí uvést důkaz, dopad, závislosti, migrační kompatibilitu, minimální změnu, ověření a podmínku zahájení. Plošné sjednocení názvů/abstrakcí bez uživatelského nebo provozního přínosu není priorita.

## Doplnění po UX r1

- Výkonové fixtures původně neznaly CyclOSM Lite; whitelist byl rozšířen jen o konkrétní produkt. Zachovat blokování všech ostatních nenahraných externích požadavků.
- Pozorovaný nárůst hlavního JS heapu o 9–10 MiB během 50 posunů / 30 togglů / 10 stylů vyžaduje delší profil po zahřátí. Počet mapových zdrojů a listenerů se nezvýšil. Není to důkaz GPU/worker stability.
- Jednobodový draft je explicitně označený, UI jej neukládá ani neroutuje a serverová create/replace jej odmítá; před veřejným rozšiřováním draft kontraktu o nedokončené cesty sjednotit perzistenci a kompatibilitu klientů. Nyní nevymýšlet druhý draft store.
- Zbylé produktové body (konkrétní aktivace poskytovatelů, obsahová deduplikace) zůstávají v UX/product backlogu, nikoli v údržbě.

## Doplnění po statistickém chatu (12. 9. 2026)

- Search a AI panel již sdílejí `ui/ai/runChatTurn.ts` a `chatSession`; původní dvojí odesílání při přechodu se neotevírá jako budoucí úkol.
- Obecný Overview a chat nadále nemají všechny collectors společné. Statistická odpověď je úzká deterministická cesta nad publikovanými řadami; není to obecný analytický agent.
- Rozšiřování porozumění dotazům, vícezemní srovnání, obecní data a vysvětlení všech zdrojových příznaků jsou produktový backlog. Nevydávat omezený rozpoznávač za libovolnou rešerši.
- Existující velké bundly se nepřepisovaly. Reálná lokální statistická odpověď na navazující dotaz byla v jediném browser průchodu hotová za 193 ms; to není benchmark celého startu ani p95.

- Regrese bootstrapu identity jsou opravené v aktuálním produktovém balíčku, neodložené: společné čekání na guest cookie, zachování první otázky a invalidace při skutečné změně účtu. UI odběratel může zastavit čekání bez zrušení shell bootstrapu.

## Doplnění po oblastních přehledech 12. 9.

- `OverviewService` nyní sdílí dokončené podklady také mezi navazujícími záměry stejného vlastníka, oprávnění, cíle a revize. Není důvod tuto cache budovat znovu. Obecný chatový tool-loop zůstává samostatným kandidátem ke sjednocení při změně jeho scope/rozpočtů.
- `geo_unit_correspondences` a kontrolovaný import jsou první konkrétní verzované úřední vazby. Obecný provozní scheduler importů je budoucí údržba; chybějící správní identita konkrétního regionu je stále produktové pokrytí.
- Veřejný Caddy vhost má verzovaný zdroj `infra/caddy-mapos.caddy`; aktuální release postup jej automaticky nepřepisuje. Další infrastrukturový zásah musí zachovat vyjmutí obou AI SSE cest z komprese a kontrolovat skutečný první chunk přes veřejný proxy.
- Rychlý prostorový a přesný kódový lookup neslučovat pomocí neindexovatelného OR; regresní metrika a důvody jsou v [předání](2026-09-12-overview-regions-completion.md). Nová mapová databáze ani server nejsou pro tento opravený dotaz nutné.
