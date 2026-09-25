import { useEffect, useState } from "react";
import { emit, on } from "../../lib/events";

const KEY = "mapos:favorite-layers";
export function readFavoriteLayers(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value)
      ? [...new Set(value.filter((id): id is string => typeof id === "string"))]
      : [];
  } catch {
    return [];
  }
}

export function useFavoriteLayers() {
  const [favorites, setFavorites] = useState(readFavoriteLayers);
  useEffect(() => {
    const off = on("favorite-layers-changed", (next) => setFavorites(next));
    const sync = (event: StorageEvent) => {
      if (event.key === KEY || event.key === null) setFavorites(readFavoriteLayers());
    };
    window.addEventListener("storage", sync);
    return () => {
      off();
      window.removeEventListener("storage", sync);
    };
  }, []);
  const toggleFavorite = (id: string) => {
    const next = favorites.includes(id)
      ? favorites.filter((value) => value !== id)
      : [...favorites, id];
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* session still works */
    }
    setFavorites(next);
    emit("favorite-layers-changed", next);
  };
  return { favorites, toggleFavorite };
}

let requestedItem: string | null = null;
export function requestLayerSettings(itemId: string) {
  requestedItem = itemId;
  emit("layer-settings-request", { itemId });
}
export function consumeLayerSettingsRequest() {
  const item = requestedItem;
  requestedItem = null;
  return item;
}
