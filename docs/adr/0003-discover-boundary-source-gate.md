# ADR 0003: Discover nezaměňuje bbox za administrativní hranici

- Stav: dočasné bezpečné rozhodnutí; source-rights část je částečně nahrazena ADR 0012
- Datum: 2026-09-01
- Vazba na plán: Phase 9, GATE-002, DISC-008 až DISC-013

## Kontext

Současný katalog českých regionů i dynamické výsledky z Overpassu obsahují jen obdélníkový rozsah
(`bbox`). Dosavadní API z něj vyrábělo polygon a UI jej kreslilo jako administrativní hranici. To je
geograficky nepravdivé: rozsah slouží pro navigaci a dotaz, nikoli pro výběr oblasti nebo prostorové
statistiky.

Master plán nechává zdroj hranic otevřený mezi ingestem OSM relations, veřejným vektorovým/PMTiles
datasetem nebo kombinací. V prototypu licence výběr neblokuje, ale bez skutečného datasetu,
aktualizačního procesu, zoomové hierarchie a prostorových testů nelze tvrdit, že je tato část Phase 9
hotová.

## Rozhodnutí

- API smí publikovat overlay jen jako validní `Polygon` nebo `MultiPolygon`, který byl ingestován
  společně s identifikátorem zdroje, atribucí, licencí, URL a datem aktualizace.
- Region s pouhým bboxem vrací `boundaryAvailable: false`; `geojson.features` zůstává prázdné a API
  přidá stav `boundaryGate: dataset-required`.
- Bbox zůstává povolený jen jako rozsah pro kameru, cache a zdrojové dotazy. Nikdy se nekonvertuje na
  hranici ani se nepoužije pro tvrzení typu „uvnitř regionu“.
- Discover panel může zobrazit reverse-geocoded breadcrumb a citovaný obsah bez hranice. POI/piny
  mají při překryvu budoucího polygonu vždy prioritu kliknutí.

## Gate pro skutečná data

Před zapnutím hranic je nutné vybrat a zdokumentovat dataset, který splní:

1. hierarchii country/admin1/admin2/locality/neighbourhood alespoň tam, kde je zdroj poskytuje,
2. pokrytí cílové Evropy a stabilní identifikátory,
3. advisory provenance a attribution metadata pro dohledání původu,
4. aktualizační a invalidující proces včetně data posledního importu,
5. zjednodušené geometrie nebo vektorové dlaždice vhodné pro mobilní data,
6. test containmentu, zoomové hierarchie a kliknutí skrz overlay.

Kandidáti se vyhodnotí samostatně; toto ADR žádný z nich bez podkladů nevolí. Dokud gate není
uzavřený, stav `dataset-required` je očekávané bezpečné chování, ne dokončená implementace hranic.
