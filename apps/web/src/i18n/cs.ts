/** Every string the shell shows, in one flat table.
 *
 *  Not a framework — a convention. Keys are dotted paths so a screen's copy sits together,
 *  and `t()` is a plain lookup. The point is that the UI stops mixing English and Czech
 *  (§2.6) and that developer vocabulary — "fallback", "provider", "canonical", "fixture",
 *  "request" — cannot reach the screen, because adding it here is a visible decision.
 *
 *  Rules for anything added below:
 *  - Empty states are one sentence plus at most one action.
 *  - No apologies, no "bohužel", no exclamation marks.
 *  - Explanatory prose belongs in an `InfoTip`, so keep it short enough for a popover.
 */
export const cs = {
  // ---- Modes -----------------------------------------------------------
  "mode.personal": "Osobní",
  "mode.personal.short": "Osobní",
  "mode.personal.description": "Profil, uložená místa, plány a vlastní vrstvy",
  "mode.discover": "Objevuj",
  "mode.discover.short": "Objevuj",
  "mode.discover.description": "Průvodce, počasí a čísla o místě, kde právě jsi",
  "mode.planning": "Plánování",
  "mode.planning.short": "Plán",
  "mode.planning.description": "Trasa, zastávky, vozidlo a co je po cestě",
  "mode.game": "Hra",
  "mode.game.short": "Hra",
  "mode.game.description": "Zóny, questy a avatar nad reálnou mapou",
  "mode.feed": "Feed",
  "mode.feed.short": "Feed",
  "mode.feed.description": "Příspěvky a zprávy od lidí v okolí",

  // ---- Top bar and search ----------------------------------------------
  "app.name": "MapOS",
  "topbar.menu": "Panel",
  "topbar.openPanel": "Zobrazit panel",
  "topbar.close": "Zavřít panel",
  "topbar.settings": "Nastavení",
  "topbar.modes": "Režim mapy",
  "topbar.presets": "Presety",
  "topbar.basemaps": "Podklady",
  "topbar.basemaps.full": "Mapové podklady",
  "topbar.layers": "Vrstvy",
  "topbar.layers.count": "Zapnutých vrstev",
  "search.placeholder": "Hledat místo, GPS nebo se zeptat AI",
  "search.label": "Hledat",
  "search.myLocation": "Moje poloha",
  "search.myLocation.short": "Poloha",
  "search.recent": "Poslední hledání",
  "search.clearRecent": "Smazat historii",
  "search.empty": "Zadej název místa, souřadnice, nebo se zeptej celou větou.",
  "search.noResults": "Nic jsme nenašli",
  "search.askAi": "Zeptat se AI",
  "search.group.places": "Místa",
  "search.group.other": "Ostatní",
  "search.searchHere": "Hledat v této oblasti",

  // ---- Panel chrome ----------------------------------------------------
  "panel.close": "Zavřít",
  "panel.back": "Zpět",
  "panel.expand": "Rozbalit",
  "panel.collapse": "Sbalit",
  "panel.moveLeft": "Přesunout vlevo",
  "panel.moveRight": "Přesunout vpravo",
  "panel.resize": "Šířka levého panelu",
  "drawer.height": "Výška panelu",
  "drawer.snap.peek": "Náhled",
  "drawer.snap.half": "Do poloviny",
  "drawer.snap.full": "Přes celou výšku",

  // ---- Common actions --------------------------------------------------
  "action.save": "Uložit",
  "action.saved": "Uloženo",
  "action.cancel": "Zrušit",
  "action.delete": "Smazat",
  "action.edit": "Upravit",
  "action.add": "Přidat",
  "action.remove": "Odebrat",
  "action.share": "Sdílet",
  "action.export": "Exportovat",
  "action.import": "Importovat",
  "action.copy": "Kopírovat",
  "action.copied": "Zkopírováno",
  "action.open": "Otevřít",
  "action.openExternal": "Otevřít v jiné mapě",
  "action.retry": "Zkusit znovu",
  "action.refresh": "Načíst znovu",
  "action.more": "Více možností",
  "action.less": "Méně možností",
  "action.showOnMap": "Zobrazit na mapě",
  "action.navigate": "Navigovat",
  "action.addStop": "Přidat zastávku",
  "action.unlock": "Odemknout",
  "action.info": "Více informací",

  // ---- Status ----------------------------------------------------------
  "status.activity": "Průběh načítání",
  "status.loading": "Načítám",
  "status.loadingLayers": "Načítám vrstvy",
  "status.offline": "Jsi offline",
  "status.error": "Nepovedlo se to načíst",
  "status.empty": "Nic tu není",
  "status.noConnection": "Bez připojení nejde načíst nová data",

  // ---- Layers drawer ---------------------------------------------------
  "layers.title": "Vrstvy",
  "layers.world": "Svět",
  "layers.sources": "Zdroje míst",
  "layers.presets": "Sady",
  "layers.categories": "Kategorie",
  "layers.poi": "POI vrstvy",
  "layers.weather": "Počasí",
  "layers.weather.off": "Vypnuto",
  "layers.statistics": "Statistiky",
  "layers.community": "Komunita",
  "layers.filter": "Filtr",
  "layers.filter.reset": "Zrušit filtr",
  "layers.clearAll": "Vypnout vše",
  "layers.empty": "Zapni vrstvu a objeví se na mapě.",
  "layers.legend": "Legenda",
  "layers.attribution": "Zdroje dat",

  // ---- Basemaps drawer -------------------------------------------------
  "basemaps.title": "Mapové podklady",
  "basemaps.general": "Obecné nastavení",
  "basemaps.buildings3d": "3D budovy",
  "basemaps.labels": "Názvy míst",
  "basemaps.terrain": "Terén",
  "basemaps.overlays": "Překryvy",
  "basemaps.followTheme": "Podle světlého/tmavého režimu",

  // ---- Settings --------------------------------------------------------
  "settings.title": "Nastavení",
  "settings.appearance": "Vzhled",
  "settings.theme.light": "Světlý",
  "settings.theme.dark": "Tmavý",
  "settings.theme.system": "Podle systému",
  "settings.units": "Jednotky",
  "settings.privacy": "Soukromí",
  "settings.account": "Účet",
  "settings.about": "O aplikaci a datech",

  // ---- Personal --------------------------------------------------------
  "personal.title": "Osobní",
  "personal.signIn": "Přihlásit se",
  "personal.signOut": "Odhlásit se",
  "personal.guest": "Návštěvník",
  "personal.plans": "Plány",
  "personal.places": "Moje místa",
  "personal.layers": "Moje vrstvy",
  "personal.wallet": "Peněženka",
  "personal.ranks": "Ranky",
  "personal.stats.plans": "plánů",
  "personal.stats.layers": "vrstev",
  "personal.stats.places": "míst",
  "personal.places.search": "Hledat v mých místech",
  "personal.places.empty": "Ulož si první místo přes detail na mapě.",
  "personal.plans.empty": "Naplánuj první trasu v režimu Plánování.",
  "personal.layers.empty": "Vytvoř vlastní vrstvu nebo naimportuj data.",
  "personal.layers.create": "Vytvořit vrstvu",

  // ---- Discover --------------------------------------------------------
  "discover.title": "Objevuj",
  "discover.here": "Zjistit, co je tady",
  "discover.guide": "Průvodce",
  "discover.worthIt": "Stojí za to",
  "discover.practical": "Prakticky",
  "discover.numbers": "Čísla",
  "discover.weather": "Počasí",
  "discover.events": "Události",
  "discover.nearby": "V okolí",
  "discover.sources": "Zdroje a aktuálnost",
  "discover.empty": "Posuň mapu na místo, které tě zajímá.",
  "discover.aiSummary": "Souhrn od AI",
  "discover.aiSummary.note":
    "Souhrn skládá AI z uvedených zdrojů. Může se mýlit — u důležitých věcí zkontroluj zdroj.",

  // ---- Planning --------------------------------------------------------
  "planning.title": "Plánování",
  "planning.name": "Název plánu",
  "planning.name.placeholder": "Bez názvu",
  "planning.stops": "Zastávky",
  "planning.stop.placeholder": "Adresa, město, GPS nebo dotaz na AI",
  "planning.stop.pickOnMap": "Vybrat na mapě",
  "planning.stop.picked": "Vybrat místo",
  "planning.origin": "Odkud",
  "planning.destination": "Kam",
  "planning.vehicle": "Vozidlo",
  "planning.departure": "Odjezd",
  "planning.calculate": "Spočítat trasu",
  "planning.recalculate": "Přepočítat",
  "planning.preference": "Trasa",
  "planning.preference.fast": "Rychlá",
  "planning.preference.short": "Krátká",
  "planning.preference.noTolls": "Bez dálnic",
  "planning.preference.scenic": "Dobrodružná",
  "planning.alternatives": "Varianty",
  "planning.itinerary": "Itinerář",
  "planning.pointsOfInterest": "Zajímavá místa po cestě",
  "planning.empty": "Přidej první zastávku a spočítáme trasu.",
  "planning.exportGpx": "Uložit GPX",
  "planning.askAi": "Zeptat se AI na plán",

  // ---- Game ------------------------------------------------------------
  "game.title": "Hra",
  "game.avatar": "Avatar",
  "game.zones": "Zóny",
  "game.quests": "Questy",
  "game.inventory": "Inventář",
  "game.leaderboard": "Žebříček",
  "game.xp": "XP",
  "game.level": "Úroveň",
  "game.connectWallet": "Připojit peněženku",
  "game.empty": "V okolí zatím není žádná zóna. Posuň mapu nebo zkus to později.",

  // ---- Place detail ----------------------------------------------------
  "place.title": "Detail místa",
  "place.save": "Uložit",
  "place.route": "Trasa sem",
  "place.nearby": "V okolí",
  "place.photos": "Fotky",
  "place.photos.source": "Zdroj fotky",
  "place.photos.none": "K tomuhle místu jsme nenašli fotku.",
  "place.openingHours": "Otevírací doba",
  "place.contact": "Kontakt",
  "place.edit": "Upravit informace",
  "place.history": "Historie změn",
  "place.comments": "Komentáře",

  // ---- AI --------------------------------------------------------------
  "ai.title": "AI",
  "ai.ask": "Zeptej se",
  "ai.placeholder": "Zeptej se na cokoli o mapě",
  "ai.thinking": "Přemýšlím",
  "ai.searching": "Hledám ve vrstvách",
  "ai.sources": "Z čeho jsem čerpal",
  "ai.consent.title": "AI potřebuje poslat kontext",
  "ai.consent.body":
    "Aby AI odpověděla, pošleme jí výřez mapy, zapnuté vrstvy a tvůj dotaz. Neposíláme tvou přesnou polohu ani uložená místa.",
  "ai.consent.accept": "Rozumím",
  "ai.error": "AI teď neodpovídá. Zkus to za chvíli.",
  "ai.createLayer": "Vytvořit z toho vrstvu",
  "ai.openInPlanning": "Otevřít v Plánování",
  "ai.applyToPlan": "Použít v plánu",

  // ---- Attribution and legal ------------------------------------------
  "legal.attribution": "Zdroje",
  "legal.licence": "Licence",
  "legal.dataShared": "Co se odesílá",
  "legal.coverage": "Pokrytí"
} as const;

export type MessageKey = keyof typeof cs;

/** Looks up a string. Missing keys are loud in development and fall back to the key itself
 *  in production, so a typo never renders as an empty element. */
export function t(key: MessageKey): string {
  const value = cs[key];
  if (value === undefined) {
    if (import.meta.env.DEV) console.error(`Missing translation for "${key}"`);
    return key;
  }
  return value;
}
