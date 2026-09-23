import type maplibregl from "maplibre-gl";
import type { LayerHandle } from "@mapos/layer-sdk";
import { createTileLayer } from "../tileLayer";

/** Resolve an explicit source edition only on activation/refresh; lifecycle remains in the tile adapter. */
export function createDroughtLayer(map: maplibregl.Map, apiBase: string, id: string): LayerHandle {
  let delegate: LayerHandle | undefined;
  let disposed = false,
    visible = true,
    opacity = 0.65;
  let current: string | undefined;
  let generation = 0,
    expiresAt = 0;
  return {
    async update(bbox, filters, signal) {
      if (disposed || !visible) return null;
      if (delegate && Date.now() < expiresAt) return delegate.update(bbox, filters, signal);
      const own = ++generation;
      const response = await fetch(`${apiBase}/environment/drought/edition`, { signal });
      if (!response.ok) throw new Error("Dostupnou edici sucha se nepodařilo ověřit.");
      const edition = (await response.json()) as {
        at: string;
        bbox: [number, number, number, number];
      };
      signal?.throwIfAborted();
      if (disposed || own !== generation || !visible) return null;
      if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?$/.test(edition.at))
        throw new Error("Neplatná edice sucha");
      if (!delegate || current !== edition.at) {
        delegate?.detach();
        delegate = createTileLayer(map, id, {
          tiles: [
            `https://drought.emergency.copernicus.eu/api/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=cdiad&STYLES=&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE&CROP=land&TIME=${encodeURIComponent(edition.at)}`
          ],
          bounds: edition.bbox,
          minzoom: 2,
          maxzoom: 12,
          attribution: `European Union · Copernicus CEMS · CDI ${edition.at}`
        });
        delegate.setVisible?.(visible);
        delegate.setOpacity?.(opacity);
        current = edition.at;
      }
      expiresAt = Date.now() + 3600000;
      return delegate.update(bbox, filters, signal);
    },
    setVisible(value) {
      visible = value;
      if (!value) generation++;
      delegate?.setVisible?.(value);
    },
    setOpacity(value) {
      opacity = value;
      delegate?.setOpacity?.(value);
    },
    detach() {
      disposed = true;
      generation++;
      delegate?.detach();
      delegate = undefined;
    }
  };
}
