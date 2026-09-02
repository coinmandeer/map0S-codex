export type RegionLevel = "country" | "kraj" | "okres";

export interface RegionDef {
  id: string;
  name: string;
  level: RegionLevel;
  parent: string | null;
  /** Navigation and query extent only. It must never be presented as the region boundary. */
  bbox: [number, number, number, number];
}

function fromCenter(
  id: string,
  name: string,
  level: RegionLevel,
  parent: string | null,
  lng: number,
  lat: number,
  dLng: number,
  dLat: number
): RegionDef {
  return { id, name, level, parent, bbox: [lng - dLng, lat - dLat, lng + dLng, lat + dLat] };
}

const KRAJE: RegionDef[] = [
  {
    id: "CZ-PHA",
    name: "Hlavní město Praha",
    level: "kraj",
    parent: "CZ",
    bbox: [14.22, 49.94, 14.71, 50.18]
  },
  {
    id: "CZ-STC",
    name: "Středočeský kraj",
    level: "kraj",
    parent: "CZ",
    bbox: [13.39, 49.44, 15.78, 50.62]
  },
  {
    id: "CZ-JHC",
    name: "Jihočeský kraj",
    level: "kraj",
    parent: "CZ",
    bbox: [13.47, 48.55, 15.61, 49.62]
  },
  {
    id: "CZ-PLK",
    name: "Plzeňský kraj",
    level: "kraj",
    parent: "CZ",
    bbox: [12.4, 49.02, 13.89, 50.13]
  },
  {
    id: "CZ-KVK",
    name: "Karlovarský kraj",
    level: "kraj",
    parent: "CZ",
    bbox: [12.24, 49.89, 13.32, 50.51]
  },
  {
    id: "CZ-ULK",
    name: "Ústecký kraj",
    level: "kraj",
    parent: "CZ",
    bbox: [12.87, 50.17, 14.65, 51.06]
  },
  {
    id: "CZ-LBK",
    name: "Liberecký kraj",
    level: "kraj",
    parent: "CZ",
    bbox: [14.34, 50.42, 15.63, 51.05]
  },
  {
    id: "CZ-HKK",
    name: "Královéhradecký kraj",
    level: "kraj",
    parent: "CZ",
    bbox: [15.02, 50.04, 16.61, 50.77]
  },
  {
    id: "CZ-PAK",
    name: "Pardubický kraj",
    level: "kraj",
    parent: "CZ",
    bbox: [15.4, 49.56, 16.95, 50.21]
  },
  {
    id: "CZ-VYS",
    name: "Kraj Vysočina",
    level: "kraj",
    parent: "CZ",
    bbox: [14.92, 48.97, 16.43, 49.82]
  },
  {
    id: "CZ-JHM",
    name: "Jihomoravský kraj",
    level: "kraj",
    parent: "CZ",
    bbox: [15.53, 48.62, 17.65, 49.63]
  },
  {
    id: "CZ-OLK",
    name: "Olomoucký kraj",
    level: "kraj",
    parent: "CZ",
    bbox: [16.7, 49.18, 17.92, 50.45]
  },
  {
    id: "CZ-ZLK",
    name: "Zlínský kraj",
    level: "kraj",
    parent: "CZ",
    bbox: [17.12, 48.85, 18.37, 49.52]
  },
  {
    id: "CZ-MSK",
    name: "Moravskoslezský kraj",
    level: "kraj",
    parent: "CZ",
    bbox: [17.14, 49.39, 18.86, 50.45]
  }
];

const OKRESY: RegionDef[] = [
  fromCenter("CZ-PHA-00", "Praha", "okres", "CZ-PHA", 14.42, 50.08, 0.25, 0.12),
  fromCenter("CZ-STC-BN", "Benešov", "okres", "CZ-STC", 14.78, 49.78, 0.28, 0.18),
  fromCenter("CZ-STC-BE", "Beroun", "okres", "CZ-STC", 14.07, 49.96, 0.24, 0.16),
  fromCenter("CZ-STC-KD", "Kladno", "okres", "CZ-STC", 14.1, 50.14, 0.24, 0.14),
  fromCenter("CZ-STC-KO", "Kolín", "okres", "CZ-STC", 15.2, 50.03, 0.24, 0.14),
  fromCenter("CZ-STC-KH", "Kutná Hora", "okres", "CZ-STC", 15.27, 49.95, 0.26, 0.16),
  fromCenter("CZ-STC-ME", "Mělník", "okres", "CZ-STC", 14.47, 50.35, 0.24, 0.14),
  fromCenter("CZ-STC-MB", "Mladá Boleslav", "okres", "CZ-STC", 14.9, 50.41, 0.28, 0.16),
  fromCenter("CZ-STC-NB", "Nymburk", "okres", "CZ-STC", 15.04, 50.19, 0.24, 0.14),
  fromCenter("CZ-STC-PY", "Praha-východ", "okres", "CZ-STC", 14.7, 50.1, 0.28, 0.16),
  fromCenter("CZ-STC-PZ", "Praha-západ", "okres", "CZ-STC", 14.25, 49.95, 0.24, 0.16),
  fromCenter("CZ-STC-PB", "Příbram", "okres", "CZ-STC", 14.0, 49.69, 0.32, 0.18),
  fromCenter("CZ-STC-RA", "Rakovník", "okres", "CZ-STC", 13.73, 50.1, 0.26, 0.16),
  fromCenter("CZ-JHC-CB", "České Budějovice", "okres", "CZ-JHC", 14.47, 48.97, 0.28, 0.16),
  fromCenter("CZ-JHC-CK", "Český Krumlov", "okres", "CZ-JHC", 14.32, 48.81, 0.28, 0.16),
  fromCenter("CZ-JHC-JH", "Jindřichův Hradec", "okres", "CZ-JHC", 15.0, 49.14, 0.3, 0.18),
  fromCenter("CZ-JHC-PI", "Písek", "okres", "CZ-JHC", 14.15, 49.31, 0.24, 0.16),
  fromCenter("CZ-JHC-PT", "Prachatice", "okres", "CZ-JHC", 13.99, 49.01, 0.26, 0.16),
  fromCenter("CZ-JHC-ST", "Strakonice", "okres", "CZ-JHC", 13.9, 49.26, 0.24, 0.16),
  fromCenter("CZ-JHC-TA", "Tábor", "okres", "CZ-JHC", 14.66, 49.41, 0.26, 0.16),
  fromCenter("CZ-PLK-DO", "Domažlice", "okres", "CZ-PLK", 12.93, 49.44, 0.26, 0.16),
  fromCenter("CZ-PLK-KT", "Klatovy", "okres", "CZ-PLK", 13.29, 49.4, 0.3, 0.18),
  fromCenter("CZ-PLK-PM", "Plzeň-město", "okres", "CZ-PLK", 13.38, 49.75, 0.12, 0.08),
  fromCenter("CZ-PLK-PJ", "Plzeň-jih", "okres", "CZ-PLK", 13.47, 49.55, 0.24, 0.14),
  fromCenter("CZ-PLK-PS", "Plzeň-sever", "okres", "CZ-PLK", 13.25, 49.9, 0.26, 0.14),
  fromCenter("CZ-PLK-RO", "Rokycany", "okres", "CZ-PLK", 13.59, 49.74, 0.2, 0.14),
  fromCenter("CZ-PLK-TC", "Tachov", "okres", "CZ-PLK", 12.63, 49.8, 0.28, 0.16),
  fromCenter("CZ-KVK-CH", "Cheb", "okres", "CZ-KVK", 12.37, 50.08, 0.24, 0.16),
  fromCenter("CZ-KVK-KV", "Karlovy Vary", "okres", "CZ-KVK", 12.87, 50.23, 0.26, 0.16),
  fromCenter("CZ-KVK-SO", "Sokolov", "okres", "CZ-KVK", 12.64, 50.18, 0.2, 0.14),
  fromCenter("CZ-ULK-DC", "Děčín", "okres", "CZ-ULK", 14.21, 50.78, 0.24, 0.14),
  fromCenter("CZ-ULK-CV", "Chomutov", "okres", "CZ-ULK", 13.42, 50.46, 0.24, 0.14),
  fromCenter("CZ-ULK-LT", "Litoměřice", "okres", "CZ-ULK", 14.13, 50.53, 0.24, 0.14),
  fromCenter("CZ-ULK-LN", "Louny", "okres", "CZ-ULK", 13.8, 50.36, 0.26, 0.14),
  fromCenter("CZ-ULK-MO", "Most", "okres", "CZ-ULK", 13.64, 50.5, 0.18, 0.12),
  fromCenter("CZ-ULK-TP", "Teplice", "okres", "CZ-ULK", 13.83, 50.64, 0.18, 0.12),
  fromCenter("CZ-ULK-UL", "Ústí nad Labem", "okres", "CZ-ULK", 14.04, 50.66, 0.16, 0.12),
  fromCenter("CZ-LBK-CL", "Česká Lípa", "okres", "CZ-LBK", 14.54, 50.69, 0.26, 0.14),
  fromCenter("CZ-LBK-JN", "Jablonec nad Nisou", "okres", "CZ-LBK", 15.17, 50.72, 0.16, 0.1),
  fromCenter("CZ-LBK-LI", "Liberec", "okres", "CZ-LBK", 15.06, 50.77, 0.2, 0.12),
  fromCenter("CZ-LBK-SM", "Semily", "okres", "CZ-LBK", 15.34, 50.6, 0.22, 0.14),
  fromCenter("CZ-HKK-HK", "Hradec Králové", "okres", "CZ-HKK", 15.83, 50.21, 0.22, 0.14),
  fromCenter("CZ-HKK-JC", "Jičín", "okres", "CZ-HKK", 15.35, 50.44, 0.24, 0.14),
  fromCenter("CZ-HKK-NA", "Náchod", "okres", "CZ-HKK", 16.16, 50.42, 0.22, 0.14),
  fromCenter("CZ-HKK-RK", "Rychnov nad Kněžnou", "okres", "CZ-HKK", 16.27, 50.17, 0.22, 0.14),
  fromCenter("CZ-HKK-TU", "Trutnov", "okres", "CZ-HKK", 15.91, 50.56, 0.26, 0.16),
  fromCenter("CZ-PAK-CR", "Chrudim", "okres", "CZ-PAK", 15.8, 49.95, 0.24, 0.14),
  fromCenter("CZ-PAK-PU", "Pardubice", "okres", "CZ-PAK", 15.78, 50.04, 0.2, 0.12),
  fromCenter("CZ-PAK-SY", "Svitavy", "okres", "CZ-PAK", 16.47, 49.76, 0.26, 0.16),
  fromCenter("CZ-PAK-UO", "Ústí nad Orlicí", "okres", "CZ-PAK", 16.39, 49.97, 0.26, 0.14),
  fromCenter("CZ-VYS-HB", "Havlíčkův Brod", "okres", "CZ-VYS", 15.58, 49.61, 0.24, 0.14),
  fromCenter("CZ-VYS-JI", "Jihlava", "okres", "CZ-VYS", 15.59, 49.4, 0.24, 0.14),
  fromCenter("CZ-VYS-PE", "Pelhřimov", "okres", "CZ-VYS", 15.22, 49.43, 0.24, 0.16),
  fromCenter("CZ-VYS-TR", "Třebíč", "okres", "CZ-VYS", 15.88, 49.21, 0.26, 0.16),
  fromCenter("CZ-VYS-ZR", "Žďár nad Sázavou", "okres", "CZ-VYS", 15.94, 49.56, 0.26, 0.16),
  fromCenter("CZ-JHM-BK", "Blansko", "okres", "CZ-JHM", 16.64, 49.36, 0.22, 0.14),
  fromCenter("CZ-JHM-BM", "Brno-město", "okres", "CZ-JHM", 16.61, 49.2, 0.12, 0.08),
  fromCenter("CZ-JHM-BO", "Brno-venkov", "okres", "CZ-JHM", 16.5, 49.1, 0.28, 0.16),
  fromCenter("CZ-JHM-BV", "Břeclav", "okres", "CZ-JHM", 16.88, 48.76, 0.24, 0.14),
  fromCenter("CZ-JHM-HO", "Hodonín", "okres", "CZ-JHM", 17.13, 48.85, 0.24, 0.14),
  fromCenter("CZ-JHM-VY", "Vyškov", "okres", "CZ-JHM", 16.99, 49.28, 0.22, 0.14),
  fromCenter("CZ-JHM-ZN", "Znojmo", "okres", "CZ-JHM", 16.05, 48.86, 0.28, 0.16),
  fromCenter("CZ-OLK-JE", "Jeseník", "okres", "CZ-OLK", 17.2, 50.23, 0.26, 0.16),
  fromCenter("CZ-OLK-OC", "Olomouc", "okres", "CZ-OLK", 17.25, 49.59, 0.24, 0.16),
  fromCenter("CZ-OLK-PV", "Prostějov", "okres", "CZ-OLK", 17.12, 49.47, 0.2, 0.14),
  fromCenter("CZ-OLK-PR", "Přerov", "okres", "CZ-OLK", 17.45, 49.46, 0.22, 0.14),
  fromCenter("CZ-OLK-SU", "Šumperk", "okres", "CZ-OLK", 16.97, 49.97, 0.26, 0.16),
  fromCenter("CZ-ZLK-KM", "Kroměříž", "okres", "CZ-ZLK", 17.39, 49.3, 0.22, 0.14),
  fromCenter("CZ-ZLK-UH", "Uherské Hradiště", "okres", "CZ-ZLK", 17.46, 49.07, 0.24, 0.14),
  fromCenter("CZ-ZLK-VS", "Vsetín", "okres", "CZ-ZLK", 17.99, 49.34, 0.26, 0.16),
  fromCenter("CZ-ZLK-ZL", "Zlín", "okres", "CZ-ZLK", 17.67, 49.23, 0.22, 0.14),
  fromCenter("CZ-MSK-BR", "Bruntál", "okres", "CZ-MSK", 17.46, 49.99, 0.28, 0.18),
  fromCenter("CZ-MSK-FM", "Frýdek-Místek", "okres", "CZ-MSK", 18.35, 49.68, 0.24, 0.16),
  fromCenter("CZ-MSK-KI", "Karviná", "okres", "CZ-MSK", 18.54, 49.85, 0.16, 0.12),
  fromCenter("CZ-MSK-NJ", "Nový Jičín", "okres", "CZ-MSK", 18.01, 49.59, 0.22, 0.14),
  fromCenter("CZ-MSK-OP", "Opava", "okres", "CZ-MSK", 17.9, 49.94, 0.24, 0.14),
  fromCenter("CZ-MSK-OV", "Ostrava-město", "okres", "CZ-MSK", 18.26, 49.83, 0.14, 0.1)
];

export const CZ_COUNTRY: RegionDef = {
  id: "CZ",
  name: "Česko",
  level: "country",
  parent: null,
  bbox: [12.09, 48.55, 18.86, 51.06]
};

export const CZ_REGIONS: RegionDef[] = [CZ_COUNTRY, ...KRAJE, ...OKRESY];

export function regionById(id: string): RegionDef | undefined {
  return CZ_REGIONS.find((r) => r.id === id);
}

export function childrenOf(parentId: string): RegionDef[] {
  return CZ_REGIONS.filter((r) => r.parent === parentId);
}
