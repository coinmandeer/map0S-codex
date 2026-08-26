import type { Bbox, FeatureCollection, FilterValues, LayerHandle } from "@mapos/layer-sdk";

/**
 * Stands in for a handle whose module is still downloading, queueing calls and replaying them
 * once the real one exists. This is what keeps heavy dependencies (three.js, deck.gl-style
 * renderers) out of the main bundle: the chunk is only requested when the layer is switched on.
 *
 * Was `LazyGameHandle`, hard-wired to the game layer's import. Any plugin can use it now by
 * returning one from `create` — which is the point of the plugin contract: "expensive to load"
 * stops being a property the engine has to know about.
 */
export class LazyHandle implements LayerHandle {
  private real: LayerHandle | null = null;
  private pendingVisible: boolean | null = null;
  private pendingOpacity: number | null = null;
  private pendingUpdate: { bbox: Bbox; filters: FilterValues } | null = null;
  private detached = false;

  constructor(load: () => Promise<LayerHandle>) {
    void load().then((handle) => {
      // Detaching mid-download has to still tear down whatever the import produced, otherwise
      // the layer's map sources outlive the layer.
      if (this.detached) {
        handle.detach();
        return;
      }
      this.real = handle;
      if (this.pendingVisible !== null) handle.setVisible(this.pendingVisible);
      if (this.pendingOpacity !== null) handle.setOpacity(this.pendingOpacity);
      // Switching to a mode fires exactly one refresh, and it almost always lands before the
      // chunk finishes downloading. Dropping it left the world empty until the user happened to
      // pan — which is what made game mode look broken on first entry.
      if (this.pendingUpdate) {
        const { bbox, filters } = this.pendingUpdate;
        this.pendingUpdate = null;
        void handle.update(bbox, filters);
      }
    });
  }

  async update(
    bbox: Bbox,
    filters: FilterValues,
    signal?: AbortSignal
  ): Promise<FeatureCollection | null> {
    if (!this.real) {
      // Only the newest viewport is worth replaying; older ones are already stale.
      this.pendingUpdate = { bbox, filters };
      return null;
    }
    return this.real.update(bbox, filters, signal);
  }

  setData(data: FeatureCollection) {
    this.real?.setData?.(data);
  }

  setVisible(visible: boolean) {
    this.pendingVisible = visible;
    this.real?.setVisible(visible);
  }

  setOpacity(opacity: number) {
    this.pendingOpacity = opacity;
    this.real?.setOpacity(opacity);
  }

  detach() {
    this.detached = true;
    this.pendingUpdate = null;
    this.real?.detach();
    this.real = null;
  }
}
