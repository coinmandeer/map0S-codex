# Vrstva weed

Vrstva `weed` zobrazuje veřejně mapované provozovny `shop=cannabis` z OpenStreetMap po celém světě. Načítá je po oblastech při přiblížení mapy; neukládá ani nečte záznamy Weedmaps. Piny mají odkaz na původní prvek OSM a podle dostupných tagů také adresu, web, telefon a otevírací dobu.

## Rozlišení míst

| Typ ve vrstvě      | Pravidlo nad OSM tagy                                               |
| ------------------ | ------------------------------------------------------------------- |
| Léčebná výdejna    | `cannabis:medical=yes/only`, bez potvrzeného rekreačního prodeje    |
| Rekreační prodejna | `cannabis:recreational=yes/only`, bez potvrzeného léčebného prodeje |
| Obojí              | Potvrzené oba typy prodeje                                          |
| Typ neuveden       | Žádný z těchto dvou tagů není potvrzený                             |

Jde o typ prodeje uvedený v OSM, nikoli o ověření státní licence. Výraz „dispensary“ Weedmaps používá i pro některé rekreační prodejny, takže jeho počty podle tohoto označení nejsou přímo srovnatelné s první kategorií vrstvy.

## Kontrola pokrytí, 23. září 2026

- OSM: [dotaz Overpass Turbo](https://overpass-turbo.eu/s/2wXr) pro obdélník `33.70,-118.70,34.35,-118.15` kolem Los Angeles vrátil 100 prvků `shop=cannabis` (73 uzlů, 26 cest, 1 relace).
- Weedmaps: [stránka Los Angeles](https://weedmaps.com/dispensaries/in/united-states/california/los-angeles) uváděla 258 výsledků.

Jde o orientační kontrolu. Weedmaps používá vlastní oblast a pravidla výběru, které neodpovídají přesně obdélníku dotazu OSM; výsledky mohou zahrnovat další formy prodeje. Čísla tedy nejsou mírou přesnosti ani úplnosti bod po bodu. Ukazují, že samotný OSM zdroj zde nedosahuje podobného počtu jako Weedmaps.

Celosvětový součet z Overpass nebyl dostupný: globální dotaz skončil timeoutem serveru. Vrstva má globální dosah při prohlížení jednotlivých oblastí, nikoli předem uložený kompletní katalog celé planety.

## Další zdroje

Pro vyšší pokrytí lze připojit otevřené registry licencovaných provozoven po jednotlivých jurisdikcích a párovat je podle čísla licence, názvu a adresy. Každý zdroj musí mít vlastní původ a licenci; shoda polohy sama o sobě není potvrzení identity. Databázi ani detaily z Weedmaps nelze převzít bez příslušného oprávnění: jejich [pravidla používání](https://weedmaps.com/legal/acceptable-use) zakazují kopírování firemních záznamů pomocí scraperů a jejich [vývojářské podmínky](https://weedmaps.com/legal/developer-terms) omezují další využití dat.
