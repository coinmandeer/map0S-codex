const REGIONAL_INDICATOR_A = 0x1f1e6;

/**
 * Render an ISO 3166-1 alpha-2 flag without contacting a third-party image host.
 * Unknown values deliberately fall back to a neutral globe.
 */
export function countryFlagEmoji(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return "🌐";
  return String.fromCodePoint(
    ...[...normalized].map((letter) => REGIONAL_INDICATOR_A + letter.charCodeAt(0) - 65)
  );
}
