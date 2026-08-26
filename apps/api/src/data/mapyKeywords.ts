/** Keyword matrix that stands in for the bulk-POI endpoint api.mapy.com doesn't have.
 *
 *  Mapy's `/v1/suggest` is a *name* search — it will happily return every "hrad" inside a
 *  bbox, but only because Czech castles are literally named that way. So for each category we
 *  keep the words a place of that kind is actually called in each indexed language, and the
 *  POI engine issues one bbox-scoped suggest per (cell × keyword × language).
 *
 *  Rules for editing this table:
 *  - Keywords must be words that appear in *place names*, not translations of the category.
 *    "Restaurace" is a bad castle keyword; "Zřícenina" is a good one.
 *  - Order matters: the engine truncates to KEYWORD_BUDGET per category, most productive first.
 *  - Generic unnamed amenities (parking, toilets, drinking water) are intentionally absent —
 *    they have no names to match and stay Overpass's job. See poiFusionService.
 */

import type { OsmPoiCategoryId } from "@mapos/layer-sdk";
import type { MapyLang } from "./euCountries.js";

/** Most keywords a single category may spend on one cell, to keep the request budget sane. */
export const KEYWORD_BUDGET = 3;

type KeywordsByLang = Partial<Record<MapyLang, string[]>>;

/** Categories worth driving by name search. Anything missing here is skipped for Mapy. */
export const MAPY_KEYWORDS: Partial<Record<OsmPoiCategoryId, KeywordsByLang>> = {
  // "fortress"/"Festung" is deliberately absent: in Mapy's taxonomy that label is dominated by
  // 20th-century bunkers, which flooded the castle layer with concrete boxes.
  castle: {
    cs: ["hrad", "zámek", "tvrz"],
    sk: ["hrad", "zámok", "kaštieľ"],
    pl: ["zamek", "pałac", "gród"],
    de: ["Burg", "Schloss", "Palais"],
    en: ["castle", "chateau", "manor"],
    fr: ["château", "manoir", "donjon"],
    it: ["castello", "rocca", "villa"],
    es: ["castillo", "alcázar", "palacio"],
    pt: ["castelo", "palácio", "solar"],
    nl: ["kasteel", "slot", "burcht"],
    el: ["κάστρο", "φρούριο"],
    tr: ["kale", "hisar", "saray"],
    uk: ["замок", "фортеця"],
    ru: ["замок", "крепость"]
  },
  palace: {
    cs: ["zámek", "palác"],
    sk: ["zámok", "palác"],
    pl: ["pałac", "dwór"],
    de: ["Schloss", "Palais", "Residenz"],
    en: ["palace", "chateau"],
    fr: ["palais", "château"],
    it: ["palazzo", "villa"],
    es: ["palacio"],
    pt: ["palácio"],
    nl: ["paleis"],
    el: ["ανάκτορο"],
    tr: ["saray", "köşk"],
    uk: ["палац"],
    ru: ["дворец"]
  },
  ruins: {
    cs: ["zřícenina", "ruiny", "hradiště"],
    sk: ["zrúcanina", "ruiny", "hradisko"],
    pl: ["ruiny", "grodzisko"],
    de: ["Ruine", "Burgruine"],
    en: ["ruins", "hillfort"],
    fr: ["ruines", "vestiges"],
    it: ["rovine", "ruderi"],
    es: ["ruinas"],
    pt: ["ruínas"],
    nl: ["ruïne"],
    el: ["ερείπια", "αρχαίος"],
    tr: ["ören", "harabe", "antik"],
    uk: ["руїни", "городище"],
    ru: ["руины", "городище"]
  },
  viewpoint: {
    cs: ["vyhlídka", "rozhledna", "vyhlídkové místo"],
    sk: ["vyhliadka", "rozhľadňa"],
    pl: ["punkt widokowy", "wieża widokowa"],
    de: ["Aussichtspunkt", "Aussichtsturm", "Panorama"],
    en: ["viewpoint", "lookout", "observation tower"],
    fr: ["point de vue", "belvédère"],
    it: ["punto panoramico", "belvedere"],
    es: ["mirador", "atalaya"],
    pt: ["miradouro"],
    nl: ["uitzichtpunt", "uitkijktoren"],
    el: ["θέα", "παρατηρητήριο"],
    tr: ["seyir terası", "manzara"],
    uk: ["оглядовий майданчик", "вежа"],
    ru: ["смотровая площадка"]
  },
  peak: {
    cs: ["vrchol", "hora", "vrch"],
    sk: ["vrch", "štít", "hora"],
    pl: ["szczyt", "góra"],
    de: ["Gipfel", "Berg", "Spitze"],
    en: ["peak", "summit", "mount"],
    fr: ["sommet", "pic", "mont"],
    it: ["cima", "monte", "punta"],
    es: ["pico", "monte", "cumbre"],
    pt: ["pico", "monte"],
    nl: ["top", "berg"],
    el: ["κορυφή", "όρος"],
    tr: ["zirve", "dağ"],
    uk: ["вершина", "гора"],
    ru: ["вершина", "гора"]
  },
  waterfall: {
    cs: ["vodopád", "vodopády"],
    sk: ["vodopád"],
    pl: ["wodospad"],
    de: ["Wasserfall"],
    en: ["waterfall", "falls"],
    fr: ["cascade", "chute"],
    it: ["cascata"],
    es: ["cascada", "salto"],
    pt: ["cascata", "queda"],
    nl: ["waterval"],
    el: ["καταρράκτης"],
    tr: ["şelale"],
    uk: ["водоспад"],
    ru: ["водопад"]
  },
  lake: {
    cs: ["jezero", "přehrada", "rybník"],
    sk: ["jazero", "priehrada"],
    pl: ["jezioro", "zalew"],
    de: ["See", "Stausee", "Talsperre"],
    en: ["lake", "reservoir"],
    fr: ["lac", "étang"],
    it: ["lago", "laghetto"],
    es: ["lago", "embalse"],
    pt: ["lago", "albufeira"],
    nl: ["meer", "plas"],
    el: ["λίμνη"],
    tr: ["göl", "baraj"],
    uk: ["озеро", "водосховище"],
    ru: ["озеро", "водохранилище"]
  },
  cave: {
    cs: ["jeskyně", "propast"],
    sk: ["jaskyňa", "priepasť"],
    pl: ["jaskinia", "grota"],
    de: ["Höhle", "Tropfsteinhöhle"],
    en: ["cave", "cavern"],
    fr: ["grotte", "gouffre"],
    it: ["grotta"],
    es: ["cueva", "gruta"],
    pt: ["gruta", "caverna"],
    nl: ["grot"],
    el: ["σπήλαιο"],
    tr: ["mağara"],
    uk: ["печера"],
    ru: ["пещера"]
  },
  museum: {
    cs: ["muzeum", "galerie", "skanzen"],
    sk: ["múzeum", "galéria", "skanzen"],
    pl: ["muzeum", "galeria"],
    de: ["Museum", "Galerie"],
    en: ["museum", "gallery"],
    fr: ["musée", "galerie"],
    it: ["museo", "galleria"],
    es: ["museo", "galería"],
    pt: ["museu", "galeria"],
    nl: ["museum", "galerie"],
    el: ["μουσείο"],
    tr: ["müze"],
    uk: ["музей", "галерея"],
    ru: ["музей", "галерея"]
  },
  monument: {
    cs: ["pomník", "památník", "socha"],
    sk: ["pomník", "pamätník"],
    pl: ["pomnik"],
    de: ["Denkmal", "Mahnmal"],
    en: ["monument", "memorial"],
    fr: ["monument", "mémorial"],
    it: ["monumento"],
    es: ["monumento"],
    pt: ["monumento"],
    nl: ["monument"],
    el: ["μνημείο"],
    tr: ["anıt"],
    uk: ["пам'ятник"],
    ru: ["памятник"]
  },
  brewery: {
    cs: ["pivovar", "minipivovar"],
    sk: ["pivovar"],
    pl: ["browar"],
    de: ["Brauerei", "Brauhaus"],
    en: ["brewery", "brewhouse"],
    fr: ["brasserie"],
    it: ["birrificio"],
    es: ["cervecería"],
    pt: ["cervejaria"],
    nl: ["brouwerij"],
    el: ["ζυθοποιία"],
    tr: ["bira fabrikası"],
    uk: ["броварня"],
    ru: ["пивоварня"]
  },
  restaurant: {
    cs: ["restaurace", "hospoda"],
    sk: ["reštaurácia", "krčma"],
    pl: ["restauracja", "karczma"],
    de: ["Restaurant", "Gasthaus"],
    en: ["restaurant", "inn"],
    fr: ["restaurant", "auberge"],
    it: ["ristorante", "trattoria"],
    es: ["restaurante", "mesón"],
    pt: ["restaurante", "tasca"],
    nl: ["restaurant", "eetcafé"],
    el: ["εστιατόριο", "ταβέρνα"],
    tr: ["restoran", "lokanta"],
    uk: ["ресторан"],
    ru: ["ресторан"]
  },
  cafe: {
    cs: ["kavárna", "cukrárna"],
    sk: ["kaviareň", "cukráreň"],
    pl: ["kawiarnia", "cukiernia"],
    de: ["Café", "Konditorei"],
    en: ["cafe", "coffee"],
    fr: ["café", "pâtisserie"],
    it: ["caffè", "pasticceria"],
    es: ["cafetería", "café"],
    pt: ["café", "pastelaria"],
    nl: ["café", "koffie"],
    el: ["καφέ", "καφενείο"],
    tr: ["kafe", "kahve"],
    uk: ["кав'ярня"],
    ru: ["кафе"]
  },
  bar: {
    cs: ["bar", "vinárna", "pivnice"],
    sk: ["bar", "vináreň"],
    pl: ["bar", "pub", "winiarnia"],
    de: ["Bar", "Weinstube", "Kneipe"],
    en: ["bar", "pub"],
    fr: ["bar", "bistrot"],
    it: ["bar", "enoteca"],
    es: ["bar", "taberna"],
    pt: ["bar"],
    nl: ["bar", "kroeg"],
    el: ["μπαρ"],
    tr: ["bar"],
    uk: ["бар"],
    ru: ["бар"]
  },
  camp_site: {
    cs: ["kemp", "kempink", "tábořiště"],
    sk: ["kemp", "autokemp"],
    pl: ["kemping", "pole namiotowe"],
    de: ["Campingplatz", "Camping"],
    en: ["camping", "campsite"],
    fr: ["camping"],
    it: ["camping", "campeggio"],
    es: ["camping"],
    pt: ["parque de campismo"],
    nl: ["camping"],
    el: ["κάμπινγκ"],
    tr: ["kamp"],
    uk: ["кемпінг"],
    ru: ["кемпинг"]
  },
  alpine_hut: {
    cs: ["chata", "horská chata", "bouda"],
    sk: ["chata", "útulňa"],
    pl: ["schronisko", "chatka"],
    de: ["Hütte", "Berghütte", "Alm"],
    en: ["hut", "mountain hut", "lodge"],
    fr: ["refuge", "chalet"],
    it: ["rifugio", "baita"],
    es: ["refugio"],
    pt: ["abrigo"],
    nl: ["berghut"],
    el: ["καταφύγιο"],
    tr: ["dağ evi"],
    uk: ["притулок"],
    ru: ["приют"]
  },
  shelter: {
    cs: ["přístřešek", "altán"],
    sk: ["prístrešok", "altánok"],
    pl: ["wiata", "altana"],
    de: ["Schutzhütte", "Unterstand"],
    en: ["shelter"],
    fr: ["abri"],
    it: ["riparo"],
    es: ["refugio"],
    pt: ["abrigo"],
    nl: ["schuilplaats"],
    el: ["καταφύγιο"],
    tr: ["barınak"],
    uk: ["навіс"],
    ru: ["навес"]
  }
};

/** Mapy tags every POI with a localized category name in the response's `label` field
 *  ("Hrad", "Rozhledna", "Burg", "Castle"). That is a far better precision signal than the
 *  place's name — a keyword search for "hrad" returns "Autodoprava Hradecký" (label
 *  "Nákladní doprava") right next to "Pražský hrad" (label "Hrad").
 *
 *  Labels that a keyword wouldn't match on its own but that clearly belong to a category are
 *  listed here. Everything else is matched against the category's keywords directly, so this
 *  table only has to carry the exceptions. */
export const MAPY_LABEL_ALIASES: Partial<Record<OsmPoiCategoryId, string[]>> = {
  castle: ["chateau", "schloss", "zamek", "zámek", "kaštieľ", "twierdza"],
  palace: ["letohrádek", "chateau", "palais", "residenz", "villa"],
  ruins: [
    "zřícenina",
    "zrúcanina",
    "ruine",
    "ruin",
    "hradiště",
    "archeological site",
    "ausgrabungsstätte"
  ],
  viewpoint: ["výhled", "vyhlídkové místo", "aussicht", "lookout", "observation deck"],
  peak: ["summit", "hora", "kopec", "gipfel", "berg"],
  lake: ["vodní plocha", "přehrada", "reservoir", "stausee"],
  museum: ["expozice", "výstava", "exhibition", "ausstellung"],
  monument: ["památník", "socha", "sculpture", "memorial", "denkmal"],
  alpine_hut: ["horská chata", "berghütte", "refuge", "rifugio", "chata"],
  camp_site: ["autokemp", "tábořiště", "campingplatz"],
  restaurant: ["restaurace", "hostinec", "gasthaus", "trattoria"],
  cafe: ["kavárna", "cukrárna", "konditorei", "coffee shop"],
  bar: ["pivnice", "vinárna", "pub", "kneipe"],
  brewery: ["pivovar", "brauerei", "brewery"]
};

/** Endonyms for countries whose language Mapy doesn't index. Appended to the `en` keyword set
 *  so a Hungarian castle ("vár") is still found while the query language stays supported. */
export const LOCAL_KEYWORD_HINTS: Record<string, Partial<Record<OsmPoiCategoryId, string[]>>> = {
  HU: { castle: ["vár", "kastély"], viewpoint: ["kilátó"], cave: ["barlang"], museum: ["múzeum"] },
  RO: {
    castle: ["cetate", "castel"],
    viewpoint: ["belvedere"],
    cave: ["peștera"],
    museum: ["muzeul"]
  },
  HR: {
    castle: ["dvorac", "utvrda"],
    viewpoint: ["vidikovac"],
    cave: ["špilja"],
    museum: ["muzej"]
  },
  SI: { castle: ["grad", "dvorec"], viewpoint: ["razgledišče"], cave: ["jama"], museum: ["muzej"] },
  RS: { castle: ["tvrđava"], viewpoint: ["vidikovac"], cave: ["pećina"], museum: ["muzej"] },
  BG: { castle: ["крепост"], viewpoint: ["панорама"], cave: ["пещера"], museum: ["музей"] },
  SE: {
    castle: ["slott", "borg"],
    viewpoint: ["utsikt"],
    waterfall: ["vattenfall"],
    museum: ["museum"]
  },
  NO: {
    castle: ["slott", "festning"],
    viewpoint: ["utsikt"],
    waterfall: ["foss"],
    museum: ["museum"]
  },
  DK: { castle: ["slot", "borg"], viewpoint: ["udsigt"], museum: ["museum"] },
  FI: { castle: ["linna"], viewpoint: ["näkötorni"], waterfall: ["koski"], museum: ["museo"] },
  EE: { castle: ["loss", "linnus"], viewpoint: ["vaatetorn"], museum: ["muuseum"] },
  LV: { castle: ["pils"], viewpoint: ["skatu tornis"], museum: ["muzejs"] },
  LT: { castle: ["pilis"], viewpoint: ["apžvalgos bokštas"], museum: ["muziejus"] },
  IS: { waterfall: ["foss"], peak: ["fjall"], cave: ["hellir"] },
  AL: { castle: ["kalaja"], museum: ["muzeu"] },
  MK: { castle: ["тврдина"], museum: ["музеј"] },
  BA: { castle: ["tvrđava"], viewpoint: ["vidikovac"], museum: ["muzej"] },
  ME: { castle: ["tvrđava"], viewpoint: ["vidikovac"], museum: ["muzej"] },
  MT: { castle: ["kastell"], viewpoint: ["belvedere"] }
};

/** The keywords to search a category with, for a language and (optionally) a country whose
 *  own language isn't indexed. Empty means "this category isn't name-searchable, skip Mapy". */
export function keywordsFor(category: OsmPoiCategoryId, lang: MapyLang, iso?: string): string[] {
  const byLang = MAPY_KEYWORDS[category];
  if (!byLang) return [];
  const base = byLang[lang] ?? byLang.en ?? [];
  const hints = iso ? (LOCAL_KEYWORD_HINTS[iso]?.[category] ?? []) : [];
  return [...new Set([...hints, ...base])].slice(0, KEYWORD_BUDGET);
}

export function isMapySearchable(category: OsmPoiCategoryId): boolean {
  return category in MAPY_KEYWORDS;
}

/** Labels that keep slipping past a keyword match while describing something else entirely —
 *  a shop that sells art is not a gallery you visit, a bunker is not a castle. Checked before
 *  any positive match, so a deny always wins. */
const DENIED_LABELS = [
  "prodejní galerie",
  "e-shop",
  "wander card",
  "zastávka",
  "vlaková stanice",
  "bus stop",
  "apotheke",
  "lékárna",
  "playground",
  "hřiště",
  "spielplatz",
  "agriculture",
  "festung, bunker",
  "fortress, bunker",
  "pevnost, bunkr",
  "accommodations",
  "industrial water treatment"
].map(foldRaw);

function foldRaw(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const fold = foldRaw;

/** Grammatical endings only — enough for "ruin"/"ruins" or "vyhlídka"/"vyhlídkové". */
const MAX_INFLECTION_CHARS = 3;

/** Bidirectional prefix match on whole tokens, tolerating an inflected ending but not a
 *  compound. German makes the distinction matter: "Burg" must match "Burgen" and never
 *  "Bürgerhaus", which is a community centre. Short tokens must match exactly — three letters
 *  share prefixes far too readily. */
function tokenMatches(labelTokens: string[], needle: string): boolean {
  return labelTokens.some((token) => {
    if (token === needle) return true;
    if (needle.length < 4 || token.length < 4) return false;
    if (Math.abs(token.length - needle.length) > MAX_INFLECTION_CHARS) return false;
    return token.startsWith(needle) || needle.startsWith(token);
  });
}

/** Whether a Mapy result's own category label places it in this category. This is the filter
 *  that makes keyword search usable: the query drives recall, the label decides precision. */
export function labelMatchesCategory(
  label: string,
  category: OsmPoiCategoryId,
  lang: MapyLang,
  iso?: string
): boolean {
  const folded = fold(label);
  if (!folded) return false;
  if (DENIED_LABELS.some((denied) => folded.includes(denied))) return false;
  const tokens = folded.split(" ");

  const aliases = MAPY_LABEL_ALIASES[category] ?? [];
  for (const alias of aliases) {
    const foldedAlias = fold(alias);
    if (folded === foldedAlias || tokenMatches(tokens, foldedAlias)) return true;
  }

  // Compare against every language's keywords, not just the query language: Mapy localizes
  // labels to `lang`, but a border fan-out can query in one language and get labels in it
  // while the caller's `iso` hints at another.
  for (const keyword of keywordsFor(category, lang, iso)) {
    if (tokenMatches(tokens, fold(keyword))) return true;
  }
  return false;
}
