/**
 * What an operator has to do to switch a "needs setup" layer on. Every key below is free; the
 * links are the providers' own registration pages (also listed in `.env.example`).
 */
export interface SetupHint {
  env: string;
  url?: string;
  cs: string;
  en: string;
}

export const SETUP_HINTS: Readonly<Record<string, SetupHint>> = {
  firms: {
    env: "NASA_FIRMS_MAP_KEY",
    url: "https://firms.modaps.eosdis.nasa.gov/api/map_key/",
    cs: "Bezplatný MAP_KEY od NASA FIRMS",
    en: "Free NASA FIRMS MAP_KEY"
  },
  ocm: {
    env: "OPENCHARGEMAP_API_KEY",
    url: "https://openchargemap.org/site/develop/api",
    cs: "Bezplatný klíč OpenChargeMap",
    en: "Free OpenChargeMap key"
  },
  openaq: {
    env: "OPENAQ_API_KEY",
    url: "https://explore.openaq.org/register",
    cs: "Bezplatný klíč OpenAQ",
    en: "Free OpenAQ key"
  },
  ebird: {
    env: "EBIRD_API_TOKEN",
    url: "https://ebird.org/api/keygen",
    cs: "Bezplatný token eBird",
    en: "Free eBird token"
  },
  ticketmaster: {
    env: "TICKETMASTER_API_KEY",
    url: "https://developer.ticketmaster.com/",
    cs: "Bezplatný klíč Ticketmaster Discovery",
    en: "Free Ticketmaster Discovery key"
  },
  opencaching: {
    env: "OKAPI_KEY_DE (nebo _PL/_NL/_UK/_US)",
    url: "https://www.opencaching.de/okapi/signup.html",
    cs: "Bezplatný OKAPI klíč Opencaching",
    en: "Free Opencaching OKAPI key"
  },
  overture: {
    env: "OVERTURE_ENABLED=1",
    cs: "Výřez Overture PMTiles (scripts/import-overture.mjs) nasazený pod /overture/",
    en: "An Overture PMTiles extract (scripts/import-overture.mjs) served under /overture/"
  },
  park4night: {
    env: "PARK4NIGHT_ENABLED=1",
    cs: "Zapnutí prototypu Park4Night",
    en: "Enable the Park4Night prototype"
  },
  mapillary: {
    env: "MAPILLARY_ACCESS_TOKEN",
    url: "https://www.mapillary.com/dashboard/developers",
    cs: "Bezplatný token Mapillary",
    en: "Free Mapillary token"
  },
  windy: {
    env: "WINDY_API_KEY",
    url: "https://api.windy.com/",
    cs: "Klíč Windy Map Forecast API",
    en: "Windy Map Forecast API key"
  }
};

export function setupHint(capability: string): SetupHint {
  return (
    SETUP_HINTS[capability] ?? {
      env: capability,
      cs: `Serverová konfigurace „${capability}“`,
      en: `Server configuration "${capability}"`
    }
  );
}
