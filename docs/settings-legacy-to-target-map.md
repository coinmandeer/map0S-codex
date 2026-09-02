# Nastavení — legacy-to-target mapa

Stav po UI/UX vlně r14. Tabulka je úplný migrační audit globálního nastavení před refaktorem proti
cíli v master plánu §4.9. „Licence“ zde znamenají pouze zdrojovou informaci a atribuci; v prototypu
neomezují dostupnost dat, vrstev ani funkcí.

| Původní volba / informace      | Cílové umístění                            | Rozhodnutí                                  | Důvod a zachování dat                                                                                   |
| ------------------------------ | ------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Motiv Světlý / Tmavý           | Nastavení › Vzhled › Motiv                 | Zachovat a rozšířit o Systém                | Staré `mapos:theme` se migruje do verzované preference; systémový motiv reaguje na zařízení.            |
| Hustota rozhraní               | Nastavení › Vzhled › Hustota               | Doplnit                                     | Komfortní a kompaktní režim používají stejné minimální dotykové cíle.                                   |
| Jazyk                          | Nastavení › Vzhled › Jazyk                 | Připravit v registru                        | Čeština je aktivní; English je viditelně označené jako připravované, ne jako nefunkční volba.           |
| Mapové podklady / „Tiles“      | Samostatný pravý panel Mapové podklady     | Odstranit z globálního nastavení            | Podklady mají náhledy, radio výběr a vlastní obecné volby; duplicita by vytvářela dva zdroje pravdy.    |
| Datový provider OSM / Mapy.com | Nastavení › O aplikaci, jen read-only stav | Odstranit uživatelský feature flag          | Geokodér vybírá server podle dostupnosti a fallbacku; podklad, POI zdroje a routing zůstávají oddělené. |
| Zdroje míst                    | Vrstvy › Svět                              | Přesunout                                   | Všechny veřejné zdroje lze kombinovat; volba není globální provider switch.                             |
| Pohyb Simulace / GPS           | Hra › herní HUD                            | Přesunout beze ztráty                       | Stávající localStorage klíč a chování zůstávají.                                                        |
| Kamera Za hráčem / Shora       | Hra › herní HUD                            | Přesunout beze ztráty                       | Volba dál řídí mapovou kameru a zůstává uložená.                                                        |
| Avatar Kostka / Aavegotchi     | Hra › Avatar a inventář                    | Přesunout beze ztráty                       | Výběr i inventář zůstávají v herním kontextu; licence aktivum neblokuje.                                |
| Jednotky km / mi               | Nastavení › Mapa                           | Doplnit                                     | Jedna preference formátuje stejné kanonické metry v hledání, seznamech míst a trasách.                  |
| Animace přeletů                | Nastavení › Mapa                           | Doplnit                                     | Vypnutí používá okamžitý přesun mapy; vhodné pro citlivost na pohyb a slabší zařízení.                  |
| „Hledat v této oblasti“        | Nastavení › Mapa                           | Doplnit                                     | Uživatel může CTA skrýt, zatímco rozpočtované načítání vrstev zůstává funkční.                          |
| Profil / přihlášení            | Nastavení › Účet                           | Zachovat                                    | Host, upgrade profilu a připojené identity používají stávající Auth panel.                              |
| Export a smazání dat           | Nastavení › Účet                           | Zviditelnit                                 | Odkazuje na existující export a bezpečné potvrzení smazání bez duplikace destruktivní logiky.           |
| AI/CML stav                    | Nastavení › AI                             | Rozdělit na preference a read-only provider | Globální vypínač skrývá AI hledání a plánovací konverzace; serverový provider a fallback jsou čitelné.  |
| Automatický AI souhrn míst     | Nastavení › AI                             | Doplnit, výchozí vypnuto                    | Na mobilních datech se nic automaticky neposílá; preference je připravena pro detail místa.             |
| Verze                          | Nastavení › O aplikaci                     | Zachovat a zviditelnit stav serveru         | Uživatel rozezná připojený a offline režim.                                                             |
| Zdroje dat a licence           | Nastavení › O aplikaci                     | Zachovat jako harmoniku                     | Katalog je dostupný i pro vypnuté zdroje; jde o atribuci, nikoli licenční gate.                         |
| Dokumentace tvůrců vrstev      | Nastavení › O aplikaci                     | Doplnit                                     | Odkazuje významem na Layer SDK v2, manifesty a příklady v repozitáři.                                   |

## Rozšiřování

Preference mají jeden verzovaný kontrakt v `apps/web/src/settings/preferences.ts`. UI je sestavené
z `SettingsUiRegistry`; nová volba přidá typované pole, výchozí hodnotu a samostatný renderer entry.
Není potřeba rozšiřovat centrální `switch` komponentu. Registry odmítá duplicitní ID a položku v
neznámé sekci; chování ověřují jednotkové testy.
