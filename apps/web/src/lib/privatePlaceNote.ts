const PREFIX = "mapos.private-place-note.v1:";
const MAX_LENGTH = 4_000;

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PrivatePlaceNote {
  body: string;
  updatedAt: string;
}

function key(placeId: string): string {
  return `${PREFIX}${encodeURIComponent(placeId)}`;
}

export function readPrivatePlaceNote(
  storage: KeyValueStorage,
  placeId: string
): PrivatePlaceNote | null {
  try {
    const raw = storage.getItem(key(placeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PrivatePlaceNote>;
    if (typeof parsed.body !== "string" || typeof parsed.updatedAt !== "string") return null;
    const body = parsed.body.trim().slice(0, MAX_LENGTH);
    return body ? { body, updatedAt: parsed.updatedAt } : null;
  } catch {
    return null;
  }
}

export function writePrivatePlaceNote(
  storage: KeyValueStorage,
  placeId: string,
  body: string,
  now = new Date().toISOString()
): PrivatePlaceNote | null {
  const clean = body.trim().slice(0, MAX_LENGTH);
  if (!clean) {
    storage.removeItem(key(placeId));
    return null;
  }
  const note = { body: clean, updatedAt: now };
  storage.setItem(key(placeId), JSON.stringify(note));
  return note;
}
