# Časové snímky WMS

MapOS umí při importu jedné WMS podvrstvy převzít její časovou dimenzi a nabídnout výběr termínu v běžném panelu filtrů. Datum je součástí URL dlaždice, takže jiný snímek má vlastní cache klíč. Přepnutí se týká příslušné vrstvy.

## Ověřený příklad bez API klíče

V osobních vrstvách otevřete přidání zdroje z URL a vložte:

```text
https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?service=WMS&request=GetCapabilities
```

Vyberte samotnou podvrstvu `MODIS_Terra_CorrectedReflectance_TrueColor`, uložte ji a zapněte. V jejím filtru „Čas UTC“ lze změnit den snímku. Dlouhý seznam používá kompaktní výběr i na mobilu. Oblačnost a mezery v pokrytí jsou vlastností satelitních dat; nejde o předpověď počasí.

Ověřovací skript `node --import tsx scripts/wms-time-source-smoke.mjs` načte skutečný katalog přes chráněný transport aplikace a dvě malé obrazové dlaždice pro publikované termíny. Report zapisuje do `output/performance/wms-time-gibs-smoke.json`.

## Současné schopnosti a omezení

- Podporované jsou WMS 1.1.1 a 1.3.0 s Web Mercator, jednotlivé ISO datumy/UTC časy a pevné kroky v dnech, hodinách, minutách a sekundách.
- Časové dimenze se dědí ze skupin. Původní intervaly zůstávají v katalogu kompaktní; seznam nikdy neobsahuje více než 256 termínů.
- U dlouhé řady se nabízejí poslední termíny a platný výchozí termín poskytovatele. Není to úplný historický prohlížeč. Starší uložené vrstvy vytvořené před touto podporou nemají nový časový filtr automaticky; znovu je importujte, pokud filtr potřebujete.
- Kalendářní měsíce/roky, průběžné intervaly, pohyblivé `current` a společná časová doména více vybraných podvrstev zatím ovládání nemají. Jejich nepodporovaná syntaxe se nenahrazuje odhadnutými termíny.
- Výběr data nyní řídí GetMap. Legenda s proměnnými hodnotami v čase a GetFeatureInfo dosud nejsou propojené s datem. Statický legendový obrázek nelze vydávat za potvrzení hodnot konkrétního snímku.
- Katalog se ukládá při importu. Automatická obnova nových vydání u existující vrstvy je další práce.

Parametr TIME a časové intervaly popisuje [dokumentace GeoServeru](https://docs.geoserver.org/stable/en/user/services/wms/time/). Podmínky a pokrytí každé konkrétní datové sady je nutné posuzovat podle jejího poskytovatele.
