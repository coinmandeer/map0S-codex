import type maplibregl from "maplibre-gl";
import type { FeatureCollection, LayerHandle } from "@mapos/layer-sdk";

export interface MapLibreLayerAttachment {
  id: string;
  create: () => LayerHandle;
}

export interface MapDataLayerLifecycle {
  attach(attachment: MapLibreLayerAttachment): LayerHandle;
  destroy(): void;
}

interface ManagedAttachment {
  attachment: MapLibreLayerAttachment;
  current: LayerHandle;
  proxy: LayerHandle;
  visible: boolean;
  opacity: number;
  lastData: FeatureCollection | null;
}

function safelyDetach(handle: LayerHandle): void {
  try {
    handle.detach();
  } catch {
    // A MapLibre style replacement already removed its sources and layers. The old controller
    // still gets a chance to release event listeners, but missing style objects are harmless.
  }
}

/**
 * Keeps desired data-layer state across MapLibre style replacements. The returned handle is a
 * stable proxy: callers never have to discover that its concrete source/layer was recreated.
 */
export class MapLibreDataLayerLifecycle implements MapDataLayerLifecycle {
  private readonly entries = new Map<string, ManagedAttachment>();
  private readonly onStyleLoad = () => this.reattachAll();
  private destroyed = false;

  constructor(private readonly map: maplibregl.Map) {
    map.on("style.load", this.onStyleLoad);
  }

  attach(attachment: MapLibreLayerAttachment): LayerHandle {
    if (this.destroyed) throw new Error("The MapLibre data-layer lifecycle has been destroyed.");
    if (this.entries.has(attachment.id)) {
      throw new Error(`Data layer "${attachment.id}" is already attached.`);
    }

    const current = attachment.create();
    const entry = {} as ManagedAttachment;
    const proxy: LayerHandle = {
      update: async (bbox, filters, signal) => {
        const data = await entry.current.update(bbox, filters, signal);
        if (data) entry.lastData = data;
        return data;
      },
      setData: (data) => {
        entry.lastData = data;
        entry.current.setData?.(data);
      },
      setVisible: (visible) => {
        entry.visible = visible;
        entry.current.setVisible(visible);
      },
      setOpacity: (opacity) => {
        entry.opacity = opacity;
        entry.current.setOpacity(opacity);
      },
      detach: () => this.detach(attachment.id)
    };
    Object.assign(entry, {
      attachment,
      current,
      proxy,
      visible: true,
      opacity: 1,
      lastData: null
    } satisfies ManagedAttachment);
    this.entries.set(attachment.id, entry);
    return proxy;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  private detach(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    safelyDetach(entry.current);
  }

  private reattachAll(): void {
    if (this.destroyed) return;
    for (const entry of this.entries.values()) {
      safelyDetach(entry.current);
      entry.current = entry.attachment.create();
      if (entry.lastData) entry.current.setData?.(entry.lastData);
      entry.current.setVisible(entry.visible);
      entry.current.setOpacity(entry.opacity);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.map.off("style.load", this.onStyleLoad);
    for (const entry of this.entries.values()) safelyDetach(entry.current);
    this.entries.clear();
  }
}
