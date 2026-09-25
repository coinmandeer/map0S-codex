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
  private readonly ready: Promise<LayerHandle>;
  private revision = 0;
  private detached = false;

  constructor(load: () => Promise<LayerHandle>) {
    this.ready = load().then((handle) => {
      // Detaching mid-download has to still tear down whatever the import produced, otherwise
      // the layer's map sources outlive the layer.
      if (this.detached) {
        handle.detach();
        return handle;
      }
      this.real = handle;
      if (this.pendingVisible !== null) handle.setVisible(this.pendingVisible);
      if (this.pendingOpacity !== null) handle.setOpacity(this.pendingOpacity);
      return handle;
    });
    // The engine receives the rejection from update; a detached, never-used handle must not
    // create an unhandled rejection while its module is downloading.
    void this.ready.catch(() => {});
  }

  async update(
    bbox: Bbox,
    filters: FilterValues,
    signal?: AbortSignal
  ): Promise<FeatureCollection | null> {
    const revision = ++this.revision;
    signal?.throwIfAborted();
    const handle = await this.ready;
    signal?.throwIfAborted();
    if (this.detached || revision !== this.revision) {
      throw new DOMException("Layer update superseded", "AbortError");
    }
    return handle.update(bbox, filters, signal);
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
    this.revision++;
    this.real?.detach();
    this.real = null;
  }
}
