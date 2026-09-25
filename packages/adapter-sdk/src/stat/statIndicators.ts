import type { StatDatasetDescriptor } from "./statDatasets.js";

/** A catalogue row is one meaning, unit and population, never an unfiltered data cube. */
interface Indicator {
  id: string;
  name: string;
  cs: string;
  group: string;
  code: string;
  unit: string;
  dimensions: Record<string, string>;
  level?: "country" | "nuts2" | "nuts3";
  normalization?: StatDatasetDescriptor["normalization"];
  worse?: boolean;
}
const INDICATORS: Indicator[] = [
  {
    id: "population-65-plus",
    name: "Population aged 65 or over",
    cs: "Obyvatelé ve věku 65 a více let",
    group: "population",
    code: "demo_r_pjanaggr3",
    unit: "people",
    dimensions: { unit: "NR", sex: "T", age: "Y_GE65" },
    level: "nuts3"
  },
  {
    id: "population-density",
    name: "Population density",
    cs: "Hustota obyvatel",
    group: "population",
    code: "demo_r_d3dens",
    unit: "people/km²",
    dimensions: { unit: "PER_KM2" },
    level: "nuts3"
  },
  {
    id: "birth-rate",
    name: "Birth rate",
    cs: "Porodnost",
    group: "population",
    code: "demo_r_gind3",
    unit: "births/1,000 people",
    dimensions: { indic_de: "GBIRTHRT" },
    level: "nuts3"
  },
  {
    id: "death-rate",
    name: "Death rate",
    cs: "Úmrtnost",
    group: "population",
    code: "demo_r_gind3",
    unit: "deaths/1,000 people",
    dimensions: { indic_de: "GDEATHRT" },
    level: "nuts3"
  },
  {
    id: "net-migration",
    name: "Net migration and statistical adjustment",
    cs: "Čistá migrace a statistické vyrovnání",
    group: "population",
    code: "demo_r_gind3",
    unit: "people/1,000 people",
    dimensions: { indic_de: "CNMIGRATRT" },
    level: "nuts3"
  },
  {
    id: "gdp",
    name: "Gross domestic product",
    cs: "Hrubý domácí produkt",
    group: "economy",
    code: "nama_10r_3gdp",
    unit: "million EUR",
    dimensions: { unit: "MIO_EUR" },
    level: "nuts3"
  },
  {
    id: "gdp-per-capita",
    name: "GDP per capita",
    cs: "HDP na obyvatele",
    group: "economy",
    code: "nama_10r_3gdp",
    unit: "EUR/person",
    dimensions: { unit: "EUR_HAB" },
    level: "nuts3"
  },
  {
    id: "gdp-pps",
    name: "GDP per capita in purchasing power standards",
    cs: "HDP v paritě kupní síly",
    group: "economy",
    code: "nama_10r_3gdp",
    unit: "EU27 = 100",
    dimensions: { unit: "PPS_EU27_2020_HAB" },
    level: "nuts3"
  },
  {
    id: "disposable-income",
    name: "Disposable household income",
    cs: "Disponibilní příjem domácností",
    group: "economy",
    code: "nama_10r_2hhinc",
    unit: "EUR/person",
    dimensions: { unit: "EUR_HAB", direct: "BAL", na_item: "B6N" },
    level: "nuts2"
  },
  {
    id: "unemployment",
    name: "Unemployment",
    cs: "Nezaměstnanost",
    group: "work",
    code: "lfst_r_lfu3rt",
    unit: "%",
    dimensions: { unit: "PC", sex: "T", age: "Y15-74", isced11: "TOTAL" },
    level: "nuts2",
    worse: true
  },
  {
    id: "youth-unemployment",
    name: "Youth unemployment (15–24)",
    cs: "Nezaměstnanost mladých (15–24)",
    group: "work",
    code: "lfst_r_lfu3rt",
    unit: "%",
    dimensions: { unit: "PC", sex: "T", age: "Y15-24", isced11: "TOTAL" },
    level: "nuts2",
    worse: true
  },
  {
    id: "employment",
    name: "Employment (20–64)",
    cs: "Zaměstnanost (20–64)",
    group: "work",
    code: "lfst_r_lfe2emprt",
    unit: "%",
    dimensions: { unit: "PC", sex: "T", age: "Y20-64" },
    level: "nuts2"
  },
  {
    id: "poverty",
    name: "At risk of poverty or social exclusion",
    cs: "Ohrožení chudobou nebo sociálním vyloučením",
    group: "housing",
    code: "ilc_peps11n",
    unit: "%",
    dimensions: { unit: "PC" },
    level: "nuts2",
    worse: true
  },
  {
    id: "housing-cost",
    name: "Housing cost overburden",
    cs: "Nadměrné náklady na bydlení",
    group: "housing",
    code: "ilc_lvho07a",
    unit: "%",
    dimensions: { unit: "PC", sex: "T", age: "TOTAL", rskpovth: "TOTAL" },
    worse: true
  },
  {
    id: "overcrowding",
    name: "Overcrowded housing",
    cs: "Přelidněné bydlení",
    group: "housing",
    code: "ilc_lvho05a",
    unit: "%",
    dimensions: { unit: "PC", sex: "T", age: "TOTAL", rskpovth: "TOTAL" },
    worse: true
  },
  {
    id: "tertiary-education",
    name: "Tertiary education (25–64)",
    cs: "Vysokoškolské vzdělání (25–64)",
    group: "education",
    code: "edat_lfse_04",
    unit: "%",
    dimensions: { unit: "PC", sex: "T", age: "Y25-64", isced11: "ED5-8" },
    level: "nuts2"
  },
  {
    id: "early-school-leaving",
    name: "Early school leaving (18–24)",
    cs: "Předčasné odchody ze vzdělávání (18–24)",
    group: "education",
    code: "edat_lfse_16",
    unit: "%",
    dimensions: { unit: "PC", sex: "T", age: "Y18-24" },
    level: "nuts2",
    worse: true
  },
  {
    id: "life-expectancy",
    name: "Life expectancy at birth",
    cs: "Naděje dožití při narození",
    group: "health",
    code: "demo_r_mlifexp",
    unit: "years",
    dimensions: { unit: "YR", sex: "T", age: "Y_LT1" },
    level: "nuts2"
  },
  ...(
    [
      ["assault", "Assault", "Napadení", "ICCS02011"],
      ["robbery", "Robbery", "Loupeže", "ICCS0401"],
      ["burglary", "Burglary", "Vloupání", "ICCS0501"],
      ["theft", "Theft", "Krádeže", "ICCS0502"]
    ] as const
  ).map(([id, name, cs, iccs]): Indicator => ({
    id,
    name,
    cs,
    group: "safety",
    code: "crim_gen_reg",
    unit: "offences/100,000 people",
    dimensions: { unit: "P_HTHAB", iccs },
    level: "nuts3",
    worse: true,
    normalization: "per_100k"
  })),
  {
    id: "renewable-energy",
    name: "Renewable energy share",
    cs: "Podíl obnovitelné energie",
    group: "energy",
    code: "nrg_ind_ren",
    unit: "%",
    dimensions: { unit: "PC", nrg_bal: "REN" }
  },
  {
    id: "renewable-electricity",
    name: "Renewable electricity share",
    cs: "Obnovitelná elektřina",
    group: "energy",
    code: "nrg_ind_ren",
    unit: "%",
    dimensions: { unit: "PC", nrg_bal: "REN_ELC" }
  },
  {
    id: "tourism-nights",
    name: "Tourist overnight stays",
    cs: "Přenocování turistů",
    group: "tourism",
    code: "tour_occ_nin2",
    unit: "nights",
    dimensions: { unit: "NR", c_resid: "TOTAL", nace_r2: "I551-I553" },
    level: "nuts3"
  },
  {
    id: "tourism-pressure",
    name: "Tourist nights per 1,000 residents",
    cs: "Přenocování na 1 000 obyvatel",
    group: "tourism",
    code: "tour_occ_nin2",
    unit: "nights/1,000 people",
    dimensions: { unit: "P_THAB", c_resid: "TOTAL", nace_r2: "I551-I553" },
    level: "nuts3"
  },
  {
    id: "foreign-tourism",
    name: "Foreign visitor overnight stays",
    cs: "Přenocování zahraničních turistů",
    group: "tourism",
    code: "tour_occ_nin2",
    unit: "nights",
    dimensions: { unit: "NR", c_resid: "FOR", nace_r2: "I551-I553" },
    level: "nuts3"
  },
  {
    id: "tourism-beds",
    name: "Tourist accommodation bed places",
    cs: "Ubytovací kapacita",
    group: "tourism",
    code: "tour_cap_nuts2",
    unit: "bed places",
    dimensions: { unit: "NR", accomunit: "BEDPL", nace_r2: "I551-I553" },
    level: "nuts2"
  },
  {
    id: "internet",
    name: "Households with internet access",
    cs: "Domácnosti s internetem",
    group: "digital",
    code: "isoc_r_iacc_h",
    unit: "% of households",
    dimensions: { unit: "PC_HH" },
    level: "nuts2"
  },
  {
    id: "municipal-waste",
    name: "Municipal waste generated",
    cs: "Vyprodukovaný komunální odpad",
    group: "environment",
    code: "env_wasmun",
    unit: "kg/person",
    dimensions: { unit: "KG_HAB", wst_oper: "GEN" },
    worse: true
  }
];

export const EUROPEAN_INDICATORS: StatDatasetDescriptor[] = INDICATORS.flatMap((entry) => {
  const levels =
    entry.level && entry.level !== "country"
      ? [entry.level, "country" as const]
      : ["country" as const];
  return levels.map((level) => {
    const query = new URLSearchParams({
      format: "JSON",
      lang: "EN",
      freq: "A",
      sinceTimePeriod: "2000",
      ...entry.dimensions
    });
    if (level !== "country") query.set("geoLevel", level);
    return {
      id: `eurostat-${entry.id}${level === "country" && entry.level ? "-country" : ""}`,
      themeId: entry.id,
      name: entry.name,
      nameCs: entry.cs,
      group: entry.group,
      providerId: "eurostat",
      geoLevel: level,
      unit: entry.unit,
      normalization: entry.normalization ?? (entry.unit.startsWith("%") ? "percent" : "raw"),
      higherIsWorse: entry.worse ?? false,
      commercialUse: true,
      license: "Eurostat re-use policy",
      attribution: "Eurostat",
      documentationUrl: `https://ec.europa.eu/eurostat/databrowser/view/${entry.code}`,
      endpoint: `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${entry.code}?${query}`,
      dimensions: { freq: "A", ...entry.dimensions },
      boundaryEdition: level.startsWith("nuts") ? "2024" : undefined
    };
  });
});
