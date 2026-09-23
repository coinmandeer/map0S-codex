import { cs } from "./cs";
import { t, type MessageKey } from "./index";
/** Known UI labels are translated; provider and user-defined labels pass through unchanged. */
export function presentationLabel(group: string, id: string, fallback = id): string {
  const key = `polish.${group}.${id}`;
  return key in cs ? t(key as MessageKey) : fallback;
}
