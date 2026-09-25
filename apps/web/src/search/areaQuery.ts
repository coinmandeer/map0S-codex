/**
 * The question the map is currently answering for an area — today the assistant's last place
 * search — so "Search this area" can ask it again after the reader moves the map, the way a
 * map app re-runs "cafés" for the new view instead of only reloading layers.
 *
 * A module-level slot rather than store state: it holds a callback owned by whichever panel
 * asked the question, and nothing about it belongs in a saved or shared view.
 */
export interface AreaQuery {
  /** Stable for one question; a new id resets the "moved since" flag. */
  id: string;
  label: string;
  rerun(): void;
}

let current: AreaQuery | null = null;
let movedSince = false;
let revision = 0;
const listeners = new Set<() => void>();

function changed() {
  revision++;
  for (const listener of listeners) listener();
}

export const areaQuery = {
  get(): AreaQuery | null {
    return current;
  },
  /** True once the reader has moved the map after the current question was answered. */
  moved(): boolean {
    return movedSince;
  },
  set(next: AreaQuery) {
    if (current?.id === next.id) {
      current = next;
      return;
    }
    current = next;
    movedSince = false;
    changed();
  },
  /** Clears the slot only if it still holds `id`, so a late cleanup never drops a newer query. */
  clear(id: string) {
    if (current?.id !== id) return;
    current = null;
    movedSince = false;
    changed();
  },
  /** Called for camera moves the reader made (drag, zoom, keys), not for programmatic ones. */
  markMoved() {
    if (!current || movedSince) return;
    movedSince = true;
    changed();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  revision(): number {
    return revision;
  }
};
