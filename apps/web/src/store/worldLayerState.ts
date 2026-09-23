import {
  readLayerSessionState,
  writeLayerSessionState,
  type LayerSessionState
} from "./layerSessionState";
const key = (id: string) => `mapos:world-layers-v1:${id}`;
export function readWorldLayers(
  storage: Pick<Storage, "getItem"> | null,
  id: string
): LayerSessionState | null {
  if (!storage || !/^[a-z0-9-]{1,64}$/.test(id)) return null;
  try {
    if (storage.getItem(key(id)) === null) return null;
    return readLayerSessionState({ getItem: () => storage.getItem(key(id)) });
  } catch {
    return null;
  }
}
export function writeWorldLayers(
  storage: Pick<Storage, "setItem"> | null,
  id: string,
  layers: Parameters<typeof writeLayerSessionState>[1]
) {
  if (!storage || !/^[a-z0-9-]{1,64}$/.test(id)) return;
  writeLayerSessionState({ setItem: (_key, value) => storage.setItem(key(id), value) }, layers);
}
