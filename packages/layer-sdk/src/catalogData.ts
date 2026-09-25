import { GOLEMIO_LAYERS } from "./golemioCatalog.js";
/** Provider facts shared by the catalogue, search and model tools. RGB tiles never imply point values. */
export interface CatalogDataInfo {
  providerId: string;
  description: string;
  geometry: "points" | "polygons" | "raster";
  operations: ("display" | "query-features" | "query-point")[];
  time: string;
  units: string;
  coverage: string;
  sourceUrl: string;
}
export const CATALOG_DATA: Readonly<Record<string, CatalogDataInfo>> = {
  ...Object.fromEntries(
    GOLEMIO_LAYERS.map(([id, , name]) => [
      id,
      {
        providerId: "golemio",
        geometry: "points" as const,
        operations: ["display" as const, "query-features" as const],
        time: "Čas aktualizace u jednotlivých objektů",
        units: "místa",
        coverage: "Praha a okolí; rozsah podle datasetu",
        sourceUrl: "https://api.golemio.cz/docs/openapi/",
        description: `${name}. Samostatná vrstva Golemio. Polohy a publikované atributy zařízení; z polohy stanice nelze odvozovat aktuální měření.`
      }
    ])
  ),
  btcmap: {
    providerId: "btcmap",
    geometry: "points",
    operations: ["display", "query-features"],
    time: "Datum aktualizace a ověření u místa",
    units: "místa",
    coverage: "Celosvětový komunitní adresář, neúplné pokrytí",
    sourceUrl: "https://btcmap.org/",
    description:
      "Místa přijímající bitcoin podle BTC Map. Datum ověření není zárukou aktuální dostupnosti platby."
  },
  europeana: {
    providerId: "europeana",
    geometry: "points",
    operations: ["display", "query-features"],
    time: "Rok kulturního záznamu, pokud je uveden",
    units: "kulturní záznamy",
    coverage: "Výběr evropských sbírek s jednoznačnou polohou",
    sourceUrl: "https://www.europeana.eu/",
    description:
      "Experimentální výběr kulturních záznamů s jednoznačnou polohou v metadatech. Nejde automaticky o dnešní umístění předmětu ani úplný soupis památek. Metadata CC0; práva digitálního objektu samostatně."
  },
  makerspaces: {
    providerId: "spaceapi",
    geometry: "points",
    operations: ["display", "query-features"],
    time: "Poslední hlášení provozovatele; stav otevření jen při čerstvém záznamu",
    units: "místa",
    coverage: "Celosvětový dobrovolný adresář, neúplné pokrytí",
    sourceUrl: "https://spaceapi.io/",
    description:
      "Hackerspaces, makerspaces a komunitní dílny. Nejde o úplný seznam coworkingů; vstup a pracovní zázemí je nutné ověřit u provozovatele."
  },
  "shared-mobility": {
    providerId: "gbfs-stations",
    geometry: "points",
    operations: ["display", "query-features"],
    time: "station availability accepted only within 5 minutes of last report",
    units: "vehicles and docks",
    coverage:
      "worldwide registry; imported country boundaries required outside regional fallback; bounded discovery; docked stations and available dockless vehicles",
    sourceUrl: "https://gbfs.org/documentation/reference/",
    description:
      "Stanice a dostupná volně stojící vozidla podle globálního registru GBFS. Počet vozidel, volných stojanů a provozní stav pouze z hlášení do 5 minut; neznámá dostupnost není nula. Pokrytí je částečné, podmínky a atribuce podle operátora. Volně stojící vozidla vyžadují čerstvý feed do pěti minut; rezervovaná, nefunkční a zastaralá vozidla se nezobrazují."
  },
  "esa-worldcover": {
    providerId: "terrascope",
    geometry: "raster",
    operations: ["display"],
    time: "2021 v200",
    units: "land-cover classes",
    coverage: "60°S–83°N; 10 m",
    sourceUrl: "https://esa-worldcover.org/en/data-access",
    description:
      "ESA WorldCover 2021 v200, klasifikace krajiny v rozlišení 10 m. Pokrytí 60° j. š. až 83° s. š., od přiblížení 6. Historický stav. RGB dlaždice nepodporují numerické dotazy ani agregaci; třídy vysvětluje legenda."
  },
  ...Object.fromEntries(
    [
      ["soil-ph", "pH ×10", "kyselost"],
      ["soil-carbon", "dg/kg", "organický uhlík"],
      ["soil-clay", "g/kg", "jílovitost"]
    ].map(([id, units, name]) => [
      id!,
      {
        providerId: "soilgrids",
        geometry: "raster" as const,
        operations: ["display" as const],
        time: "SoilGrids 2.0 (2020)",
        units: units!,
        coverage: "global model 250 m; depth 0–5 cm",
        sourceUrl: "https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs_02.html",
        description: `SoilGrids 2.0: ${name}, hloubka 0–5 cm, hrubý model 250 m. Jednotka zdrojové legendy: ${units}. WMS slouží ke zobrazení; WCS numerické dotazy nejsou zapojené. Chybějící pokrytí není nulová hodnota. CC BY 4.0.`
      }
    ])
  ),
  "dark-sky": {
    providerId: "nasa-gibs",
    geometry: "raster",
    operations: ["display"],
    time: "2016",
    units: "RGB imagery",
    coverage: "global",
    sourceUrl: "https://earthdata.nasa.gov/",
    description:
      "Historická noční světla NASA Black Marble 2016. Obraz světelných emisí; nejde o měření jasu oblohy, aktuální podmínky ani numerický podklad pro skóre pozorování."
  },
  "sky-brightness": {
    providerId: "sky-atlas",
    geometry: "polygons",
    operations: ["display", "query-point"],
    time: "model 2015",
    units: "mcd/m²",
    coverage: "configured numerical atlas; native extent approximately 60°S–85°N",
    sourceUrl: "https://doi.org/10.5880/GFZ.1.4.2016.001",
    description:
      "Historický model umělé složky zenitového jasu 2015, bez přirozeného pozadí, počasí a Měsíce. Číselné dotazy v pokrytí nahraného atlasu; původní model přibližně 60° j. š. až 85° s. š. Při oddálení řídké vzorky pixelů, ne průměr oblasti. Barvy jsou syté nad 10 mcd/m². CC BY-NC 4.0."
  },
  aurora: {
    providerId: "noaa-swpc",
    geometry: "polygons",
    operations: ["display", "query-features"],
    time: "short-term forecast; timestamp per cell",
    units: "%",
    coverage: "global grid",
    sourceUrl: "https://www.swpc.noaa.gov/products/aurora-30-minute-forecast",
    description:
      "NOAA OVATION: krátkodobý modelový odhad polární záře. Při oddálení maximum v buňce; chybí místní oblačnost a denní světlo. Data starší než 3 hodiny se nepoužijí. Nula je platná hodnota."
  },
  "disaster-impacts": {
    providerId: "gdacs",
    geometry: "polygons",
    operations: ["display", "query-features"],
    time: "last 7 days; episode and footprint dates",
    units: "event-specific; alert categories",
    coverage: "global but bounded to 100 events and 3 local footprint requests",
    sourceUrl: "https://www.gdacs.org/About/termofuse.aspx",
    description:
      "GDACS: události posledních 7 dní a modelované zasažené oblasti při přiblížení. Nejnovější epizoda každé události; barva vyjadřuje úroveň GDACS, ne naměřenou intenzitu. Výběr podle středu události není úplným přehledem. Nenahrazuje místní varování."
  },
  "marine-conditions": {
    providerId: "open-meteo-marine",
    geometry: "points",
    operations: ["display", "query-features"],
    time: "current model; timestamp per point",
    units: "m; s; °C",
    coverage: "one marine grid cell near viewport center",
    sourceUrl: "https://open-meteo.com/en/docs/marine-weather-api",
    description:
      "Jeden modelový vzorek u středu výřezu: výška a perioda vln, teplota hladiny a čas. Souřadnice odpovídají buňce vrácené modelem. Prázdná oblast znamená bez dat, ne bezvětří. Nejde o měření na pláži ani pobřežní navigaci. Hostované API pro nekomerční použití."
  },
  "solar-climate": {
    providerId: "nasa-power",
    geometry: "points",
    operations: ["display", "query-features"],
    time: "climatology; provider reference period per point",
    units: "kWh/m²/day; °C; mm/day",
    coverage: "global; one coarse regional sample per viewport",
    sourceUrl: "https://power.larc.nasa.gov/docs/services/api/temporal/climatology/",
    description:
      "NASA POWER: roční klimatologický průměr denní sluneční energie, teploty a srážek pro střed výřezu. Referenční období ze zdroje je v detailu. Hrubý regionální model, nikoli aktuální počasí, měřicí stanice nebo posouzení konkrétní střechy."
  },
  "jrc-water-seasonality": {
    providerId: "jrc-gsw",
    geometry: "raster",
    operations: ["display"],
    time: "2024, v1.5",
    units: "months with water (0–12)",
    coverage: "global Landsat 30 m",
    sourceUrl: "https://global-surface-water.appspot.com/download",
    description:
      "Sezónnost povrchové vody v roce 2024: počet měsíců s detekcí vody, 0–12. Historický stav, ne aktuální záplavy ani předpověď. Zdrojová legenda odlišuje bez dat; RGB dlaždice nepodporují numerické dotazy."
  },
  "jrc-water-change": {
    providerId: "jrc-gsw",
    geometry: "raster",
    operations: ["display"],
    time: "1984–1999 versus 2000–2024, v1.5",
    units: "% occurrence change (−100 to +100)",
    coverage: "global Landsat 30 m",
    sourceUrl: "https://global-surface-water.appspot.com/download",
    description:
      "Dlouhodobá změna výskytu vody: porovnání období 1984–1999 a 2000–2024, pokles až −100 %, nárůst až +100 %. Nula je beze změny; nedostatek pozorování a bez dat jsou samostatné stavy. Není aktuální povodňová mapa. RGB dlaždice nelze číst jako numerické hodnoty."
  },
  "jrc-surface-water": {
    providerId: "jrc-gsw",
    geometry: "raster",
    operations: ["display"],
    time: "1984–2024, v1.5",
    units: "% of valid observations",
    coverage: "global Landsat 30 m",
    sourceUrl: "https://global-surface-water.appspot.com/download",
    description:
      "Historický podíl pozorování s detekovanou vodou, 1984–2024. Není aktuální povodňovou mapou. RGB dlaždice nejsou vhodné pro numerické analýzy; přechod mezi Landsat kolekcemi může způsobit posun o pixel. Nevykreslené místo neznamená sucho."
  },
  "gebco-bathymetry": {
    providerId: "gebco",
    geometry: "raster",
    operations: ["display"],
    time: "GEBCO 2026",
    units: "m relative to mean sea level",
    coverage: "global 15 arc seconds grid",
    sourceUrl: "https://www.gebco.net/data-products-gridded-bathymetry-data/gebco2026-grid",
    description:
      "GEBCO 2026: výška a hloubka vzhledem ke střední hladině moře. Hrubý model kombinuje měření s interpolací. Raster slouží ke zobrazení; numerické dotazy nejsou zapojené. Nevhodné pro navigaci."
  }
};
