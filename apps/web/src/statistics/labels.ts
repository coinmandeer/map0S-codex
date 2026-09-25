import { activeLocale } from "../i18n";
export function st(cs: string, en: string) {
  return activeLocale() === "cs" ? cs : en;
}
export const GROUPS: Record<string, [string, string]> = {
  population: ["Obyvatelstvo", "Population"],
  economy: ["Ekonomika", "Economy"],
  work: ["Práce", "Work"],
  housing: ["Bydlení a životní podmínky", "Housing and living conditions"],
  education: ["Vzdělání", "Education"],
  health: ["Zdraví", "Health"],
  safety: ["Bezpečnost", "Safety"],
  environment: ["Životní prostředí", "Environment"],
  energy: ["Energie", "Energy"],
  tourism: ["Turismus", "Tourism"],
  digital: ["Digitalizace", "Connectivity"],
  land: ["Využití území", "Land use"],
  elections: ["Volby", "Elections"],
  other: ["Další data", "Other data"]
};
export function groupLabel(id: string) {
  const pair = GROUPS[id] ?? GROUPS.other!;
  return st(...pair);
}
