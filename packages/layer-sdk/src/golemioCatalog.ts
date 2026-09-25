/** Public point datasets; each has its own toggle, never an implicit POI merge. */
export const GOLEMIO_LAYERS = [
  ["golemio-gardens", "gardens", "Pražské zahrady", "Prague gardens"],
  ["golemio-playgrounds", "playgrounds", "Pražská hřiště", "Prague playgrounds"],
  ["golemio-libraries", "municipallibraries", "Pražské knihovny", "Prague libraries"],
  ["golemio-health", "medicalinstitutions", "Pražská zdravotnická zařízení", "Prague healthcare"],
  [
    "golemio-police",
    "municipalpolicestations",
    "Pražská městská policie",
    "Prague municipal police"
  ],
  ["golemio-air", "airqualitystations", "Pražské stanice ovzduší", "Prague air quality stations"],
  ["golemio-cycling", "bicyclecounters", "Pražské cyklosčítače", "Prague bicycle counters"],
  ["golemio-waste", "wastecollectionyards", "Pražské sběrné dvory", "Prague waste yards"]
] as const;
