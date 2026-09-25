# Numerický atlas jasu oblohy

Zdroj: Falchi et al., World Atlas of Artificial Night Sky Brightness (2015),
dataset DOI [10.5880/GFZ.1.4.2016.001](https://doi.org/10.5880/GFZ.1.4.2016.001),
článek DOI [10.1126/sciadv.1600377](https://doi.org/10.1126/sciadv.1600377).
Aktuální metadata DOI registru uvádějí CC BY-NC 4.0; zachovaný záznam je
v `sky-atlas-license.json` (verze 1.1, aktualizace srpen 2026).
Starý README z roku 2016 obsahuje starší distribuční podmínky.

## Význam hodnot

Jde o historický model **umělé složky zenitového jasu v mcd/m²**.
Neobsahuje přirozené pozadí a není aktuálním měřením ani předpovědí.
Nulová hodnota je platná, nodata se nezobrazuje. Žádný převod barev na číselnou
hodnotu, Bortleho stupnici ani vymyšlené skóre se neprovádí.

## Příprava omezeného výřezu

Nejdříve ověřit volné místo na cílovém VPS. Originální ZIP má přibližně 653 MiB,
samotný TIFF 2,8 GiB. Základní provoz nepotřebuje celý světový archiv.
Originál získat z DOI odkazu, ověřit souřadnicový systém a jednotky pomocí
metadat balíku a `gdalinfo`; zachovat zdrojový soubor s licencí a kontrolním součtem.
Repozitář obsahuje omezený import bez systémové instalace GDAL:

```sh
node --import tsx scripts/prepare-sky-atlas.mts World_Atlas_2015.tif andalusia-sky-2015.tif -6 35 -3 38
```

Skript ověří WGS84, jediný kanál a orientaci pixelů, odmítne přepsání souboru a výřez přes milion pixelů. Vedle TIFF uloží přesné souřadnice, rozlišení, licenci a SHA-256.

Ověřený místní výřez z 24. 9. 2026 je v `output/data-imports/sky-atlas/`: 361 × 361 pixelů, 522 284 bajtů. Dotaz do výřezu původního modelu dává pro Málagu (-4.421, 36.721) 6.290038 mcd/m² a pro bod v Sierra de las Nieves (-5.02, 36.687) 0.130650 mcd/m²; jde výhradně o historickou umělou složku. Praha je správně mimo pokrytí výřezu. Soubor, manifest a DOI licence jsou připravené na VPS v `/opt/ps3000/apps/mapos-main/data/sky-atlas/`. SHA-256 přeneseného TIFF odpovídá manifestu. Běžící aplikace jej zatím nemá připojený ani aktivovaný.

Na stroji s GDAL lze alternativně připravit region jižního Španělska:

```sh
gdal_translate -projwin -6 38 -3 35 -ot Float32 -co TILED=YES -co BLOCKXSIZE=256 -co BLOCKYSIZE=256 -co COMPRESS=DEFLATE World_Atlas_2015.tif andalusia-sky-2015.tif
gdalinfo andalusia-sky-2015.tif
```

Bez škálování hodnot, bez barevné palety, jediný číselný kanál, WGS84.
V produkci uložit výřez do svazku `mapos-v3-sky-atlas` a nastavit
`MAPOS_SKY_ATLAS_PATH=/data/sky-atlas/andalusia-sky-2015.tif`.
Svazek je pro API pouze ke čtení. Výchozí prázdná proměnná zdroj vypíná.

## Provozní limity

Dotaz do bodu čte pouze dotčený blok. Jeden dekódovaný blok smí mít nejvýše 8 MiB.
Mapový výřez má nejvýše 4 miliony zdrojových pixelů a přibližně tisíc zobrazených
vzorků; větší oblast vyžádá přiblížení. Při oddálení se zobrazují řídké vzorky,
nikoli průměry oblastí. Lineární barevná stupnice se sytí nad 10 mcd/m²;
přesná hodnota zůstává v detailu. Plochy mimo výřez jsou bez dat.

Testy používají malý skutečný Float32 GeoTIFF včetně nul a nodata.
Před aktivací na VPS ověřit také hodnotu alespoň jednoho bodu vůči `gdallocationinfo`
a funkční zobrazení výřezu v prohlížeči. Soubor je na VPS připravený; aktivace produkčního zdroje zatím neproběhla.
