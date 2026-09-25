/** Shared, network-free vocabulary used by map search and assistant tools. */
export const LAYER_ALIASES: Record<string, readonly string[]> = {
  makerspaces: ["SpaceAPI", "komunitní dílny", "hackerspace", "makerspace", "sdílená dílna"],
  btcmap: ["bitcoin", "BTC", "bitcoinové platby", "platit bitcoinem", "bitcoin merchants"],
  europeana: [
    "historické fotografie",
    "kulturní dědictví",
    "sbírky",
    "Europeana",
    "cultural heritage"
  ],
  "golemio-gardens": ["Golemio", "zahrady Praha"],
  "golemio-playgrounds": ["Golemio", "dětská hřiště Praha"],
  "golemio-libraries": ["Golemio", "knihovny Praha"],
  "golemio-health": ["Golemio", "lékaři Praha", "nemocnice Praha"],
  "golemio-police": ["Golemio", "policie Praha", "služebny"],
  "golemio-air": ["Golemio", "stanice ovzduší Praha"],
  "golemio-cycling": ["Golemio", "sčítače cyklistů Praha"],
  "golemio-waste": ["Golemio", "odpad Praha", "sběrné dvory Praha"],
  "soil-ph": ["půda", "kyselost", "zásaditost", "zemědělství", "SoilGrids", "soil acidity"],
  "soil-carbon": ["půda", "uhlík", "humus", "soil carbon", "SoilGrids"],
  "soil-clay": ["půda", "jíl", "jílovitost", "clay", "SoilGrids"],
  "jrc-water-seasonality": ["sezonni voda", "vysychani", "seasonal water", "měsíce s vodou", "JRC"],
  "jrc-water-change": [
    "ubytek vody",
    "pribytek vody",
    "water change",
    "dlouhodobe zmeny vody",
    "JRC"
  ],
  "jrc-surface-water": [
    "voda",
    "jezera",
    "řeky",
    "historické vodní plochy",
    "JRC",
    "surface water"
  ],
  "gebco-bathymetry": ["hloubka", "moře", "oceán", "bathymetry", "depth", "ocean floor", "GEBCO"],
  "disaster-impacts": [
    "GDACS",
    "katastrofy",
    "povodně",
    "cyklony",
    "tsunami",
    "disasters",
    "floods",
    "impacts"
  ],
  "marine-conditions": ["moře", "vlny", "surf", "sea", "waves", "teplota vody", "ocean"],
  "solar-climate": ["slunce", "energie", "klima", "solární", "solar", "NASA POWER", "climatology"],
  aurora: ["polární záře", "aurora", "northern lights", "southern lights", "NOAA", "obloha"],
  "sky-brightness": [
    "světelný smog",
    "jas oblohy",
    "tma",
    "hvězdy",
    "Falchi",
    "light pollution",
    "sky brightness",
    "stargazing"
  ],
  "dark-sky": [
    "noční světla",
    "světelný smog",
    "světelné znečištění",
    "tma",
    "hvězdy",
    "night sky",
    "light pollution",
    "stargazing"
  ],
  "weather-clouds": ["mraky", "oblačnost", "clouds", "zataženo", "noční obloha"],
  "weather-radar": ["déšť", "prší", "rain", "radar", "srážky"],
  "weather-temperature": ["teplota", "horko", "zima", "temperature"],
  "weather-wind": ["vítr", "větrno", "wind"],
  "poi-cafe": ["kavárny", "káva", "kafe", "coffee", "cafe"],
  "poi-viewpoint": ["vyhlídky", "výhled", "rozhled", "scenic", "viewpoints"],
  "poi-parking": ["parkování", "parking"],
  "poi-restaurant": ["jídlo", "restaurace", "oběd", "dinner", "food"],
  "snow-cover": ["sníh", "snow"],
  "shared-mobility": ["koloběžky", "sdílená kola", "bikeshare", "scooters"],
  "esa-worldcover": [
    "krajina",
    "lesy",
    "zemědělství",
    "zástavba",
    "land cover",
    "vegetace",
    "worldcover",
    "ESA"
  ],
  "land-cover": ["krajina", "lesy", "land cover", "vegetace"]
};
export function normalizeCatalogText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0,
    j = 0,
    errors = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++errors > 1) return false;
    if (a.length === b.length && a[i] === b[j + 1] && a[i + 1] === b[j]) {
      i += 2;
      j += 2;
      continue;
    }
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return errors + (a.length - i) + (b.length - j) <= 1;
}
/** Zero means no match. Names always outrank aliases and fuzzy tokens. */
export function catalogSearchScore(
  query: string,
  names: readonly string[],
  aliases: readonly string[] = []
): number {
  const q = normalizeCatalogText(query);
  if (!q) return 0;
  const n = names.map(normalizeCatalogText),
    a = aliases.map(normalizeCatalogText);
  if (n.includes(q)) return 100;
  if (n.some((v) => v.startsWith(q))) return 90;
  if (a.includes(q)) return 80;
  if ([...n, ...a].some((v) => v.includes(q))) return 70;
  const tokens = [...n, ...a].flatMap((v) => v.split(" "));
  const words = q.split(" ");
  if (words.every((word) => tokens.some((token) => token.startsWith(word)))) return 60;
  return words.every(
    (word) => word.length >= 4 && tokens.some((token) => withinOneEdit(word, token))
  )
    ? 40
    : 0;
}
