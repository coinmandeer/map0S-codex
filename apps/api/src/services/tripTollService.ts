import type { TripPlan, TripTollItem } from "@mapos/layer-sdk";

type Coord = [number, number];

interface TollCountry {
  code: string;
  box: [number, number, number, number];
  carVignetteCzk?: number;
  truckCzkPerKm?: number;
  officialUrl: string;
}

// Coarse country boxes are intentionally only an estimate. They let the free prototype surface
// likely official products without pretending to be a certified toll calculator.
const COUNTRIES: TollCountry[] = [
  {
    code: "CZ",
    box: [12.05, 48.55, 18.9, 51.1],
    carVignetteCzk: 290,
    truckCzkPerKm: 5.6,
    officialUrl: "https://edalnice.cz"
  },
  {
    code: "SK",
    box: [16.8, 47.7, 22.6, 49.7],
    carVignetteCzk: 300,
    truckCzkPerKm: 5.4,
    officialUrl: "https://eznamka.sk"
  },
  {
    code: "AT",
    box: [9.45, 46.35, 17.2, 49.05],
    carVignetteCzk: 315,
    truckCzkPerKm: 7.2,
    officialUrl: "https://shop.asfinag.at"
  },
  {
    code: "HU",
    box: [16.05, 45.7, 22.9, 48.65],
    carVignetteCzk: 420,
    truckCzkPerKm: 6.8,
    officialUrl: "https://ematrica.nemzetiutdij.hu"
  },
  {
    code: "SI",
    box: [13.35, 45.35, 16.65, 46.9],
    carVignetteCzk: 405,
    truckCzkPerKm: 7.8,
    officialUrl: "https://evinjeta.dars.si"
  },
  {
    code: "CH",
    box: [5.8, 45.75, 10.55, 47.85],
    carVignetteCzk: 1060,
    truckCzkPerKm: 8.2,
    officialUrl: "https://via.admin.ch"
  },
  {
    code: "RO",
    box: [20.2, 43.55, 29.8, 48.3],
    carVignetteCzk: 90,
    truckCzkPerKm: 4.8,
    officialUrl: "https://www.erovinieta.ro"
  },
  {
    code: "BG",
    box: [22.3, 41.2, 28.65, 44.25],
    carVignetteCzk: 220,
    truckCzkPerKm: 4.5,
    officialUrl: "https://web.bgtoll.bg"
  },
  {
    code: "DE",
    box: [5.75, 47.25, 15.1, 55.15],
    truckCzkPerKm: 8.5,
    officialUrl: "https://www.toll-collect.de"
  },
  {
    code: "PL",
    box: [14.05, 49.0, 24.2, 54.9],
    truckCzkPerKm: 6.2,
    officialUrl: "https://etoll.gov.pl"
  }
];

function haversineKm(a: Coord, b: Coord) {
  const radians = (value: number) => (value * Math.PI) / 180;
  const dLat = radians(b[1] - a[1]);
  const dLng = radians(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function countryAt([lng, lat]: Coord) {
  // Small countries first: overlapping coarse boxes otherwise let Germany swallow neighbours.
  return [...COUNTRIES]
    .sort(
      (a, b) =>
        (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]) -
        (b.box[2] - b.box[0]) * (b.box[3] - b.box[1])
    )
    .find(({ box: [w, s, e, n] }) => lng >= w && lng <= e && lat >= s && lat <= n);
}

export function estimateTripToll(coordinates: Coord[], plan: TripPlan) {
  const km = new Map<string, number>();
  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = coordinates[index - 1]!;
    const current = coordinates[index]!;
    const country = countryAt([(previous[0] + current[0]) / 2, (previous[1] + current[1]) / 2]);
    if (!country) continue;
    km.set(country.code, (km.get(country.code) ?? 0) + haversineKm(previous, current));
  }
  const heavy = plan.vehicle.profile === "truck" || (plan.vehicle.weightT ?? 0) > 3.5;
  const items: TripTollItem[] = [];
  for (const [code, distanceKm] of km) {
    const country = COUNTRIES.find((candidate) => candidate.code === code)!;
    if (heavy && country.truckCzkPerKm) {
      items.push({
        countryCode: code,
        label: `Orientační kilometrické mýto · ${Math.round(distanceKm)} km`,
        estimatedCzk: Math.round(distanceKm * country.truckCzkPerKm),
        officialUrl: country.officialUrl
      });
    } else if (plan.variant !== "nohwy" && country.carVignetteCzk) {
      items.push({
        countryCode: code,
        label: "Pravděpodobná dálniční známka",
        estimatedCzk: country.carVignetteCzk,
        officialUrl: country.officialUrl
      });
    }
  }
  return {
    estimatedCzk: items.length
      ? items.reduce((sum, item) => sum + (item.estimatedCzk ?? 0), 0)
      : null,
    items,
    disclaimer:
      "Bezplatný orientační odhad. Platnost, kategorii vozidla a cenu ověř před cestou na oficiálním webu."
  };
}
