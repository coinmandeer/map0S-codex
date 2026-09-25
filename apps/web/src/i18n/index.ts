/**
 * Which language the shell speaks.
 *
 * `t()` is still a plain synchronous lookup — no context, no hook, no provider — because it is
 * called from module scope (mode manifests, layer catalogues) as often as from components. The
 * active locale therefore lives in a module variable that the app sets from preferences before
 * the first child renders, and switching it remounts the chrome rather than trying to make
 * every caller reactive.
 *
 * English is the default. Czech is a preference, not the baseline.
 */
import { cs, type MessageKey } from "./cs";
import { en } from "./en";
import type { UiLocale } from "../settings/preferences";

export type { MessageKey };

const CATALOGUES: Record<UiLocale, Record<MessageKey, string>> = { en, cs };

/** Locale tags for `Intl`. Distinct from the UI locale, which is only a language. */
const INTL_TAGS: Record<UiLocale, string> = { en: "en-GB", cs: "cs-CZ" };

let active: UiLocale = "en";

export function setActiveLocale(locale: UiLocale): void {
  active = locale;
}

export function activeLocale(): UiLocale {
  return active;
}

/**
 * The tag to hand to `Intl.DateTimeFormat`, `Intl.NumberFormat` and `toLocaleString`.
 *
 * Everything user-visible should go through this rather than a literal, so a date and a
 * distance in the same row cannot disagree about which country the reader is in.
 */
export function intlLocale(): string {
  return INTL_TAGS[active];
}

/**
 * Looks up a string, filling `{name}` placeholders from `values`.
 *
 * Placeholders rather than concatenation, because word order is not a constant: "3rd highest of
 * 14" and "3. nejvyšší ze 14" put the same numbers in different places, and only the catalogue
 * entry can know where. Missing keys are loud in development and fall back to English, then to
 * the key itself, so a typo never renders as an empty element.
 */
export function t(key: MessageKey, values?: Record<string, string | number>): string {
  const value = CATALOGUES[active][key] ?? en[key];
  if (value === undefined) {
    if (import.meta.env.DEV) console.error(`Missing translation for "${key}"`);
    return key;
  }
  if (!values) return value;
  return value.replace(/\{(\w+)\}/gu, (whole, name: string) =>
    name in values ? String(values[name]) : whole
  );
}
