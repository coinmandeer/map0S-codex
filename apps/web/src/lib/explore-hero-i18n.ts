const CODE_TO_LOCALE: Record<string, string> = {
  CZ: "cs",
  SK: "sk",
  PL: "pl",
  DE: "de",
  AT: "de",
  FR: "fr",
  ES: "es",
  IT: "it",
  PT: "pt",
  GB: "en",
  US: "en",
  JP: "ja"
};

const DISCOVER_VERB: Record<string, string> = {
  cs: "Objevte",
  sk: "Objavte",
  pl: "Odkryj",
  de: "Entdecke",
  fr: "Découvrez",
  es: "Descubre",
  it: "Scopri",
  en: "Discover",
  ja: "Tansaku"
};

const SUBTITLE: Record<string, string> = {
  cs: "Zajímavá místa a příspěvky lidí na mapě.",
  en: "Interesting places and community posts on the map."
};

export function getExploreHeroCopy(countryCode: string): { title: string; subtitle: string } {
  const c = countryCode.toUpperCase();
  if (c === "ALL") return { title: "Objevte všechny země", subtitle: SUBTITLE.cs! };
  const locale = CODE_TO_LOCALE[c] ?? "en";
  const verb = DISCOVER_VERB[locale] ?? DISCOVER_VERB.en!;
  let countryName: string;
  try {
    countryName = new Intl.DisplayNames([locale], { type: "region" }).of(c) ?? c;
  } catch {
    countryName = c;
  }
  if (c === "CZ") return { title: "Objevte Českou republiku", subtitle: SUBTITLE.cs! };
  return { title: `${verb} ${countryName}`, subtitle: SUBTITLE[locale] ?? SUBTITLE.en! };
}
