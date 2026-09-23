import {
  assertLayerManifestV2,
  type LayerCapabilityV2,
  type LayerManifestV2,
  type RendererDescriptorV2
} from "@mapos/layer-sdk";

export interface RuntimeLayerRegistration<TValue> {
  manifest: LayerManifestV2;
  value: TValue;
}

export interface RuntimeHostCapabilities {
  /** Deployment/provider capabilities. Only an explicit truthy value satisfies a requirement. */
  server?: Readonly<Record<string, unknown>>;
  /** Omit to accept every v2 renderer/source implemented by the host application. */
  renderers?: readonly RendererDescriptorV2["type"][];
  sources?: readonly LayerManifestV2["source"]["type"][];
  /** Optional features the host exposes to a layer (detail, export, routing, and so on). */
  layer?: readonly LayerCapabilityV2[];
}

export interface LayerCapabilityNegotiation {
  enabled: boolean;
  missingServerCapabilities: string[];
  rendererSupported: boolean;
  sourceSupported: boolean;
  negotiatedLayerCapabilities: LayerCapabilityV2[];
  unavailableLayerCapabilities: LayerCapabilityV2[];
}

function serverCapabilityAvailable(value: unknown): boolean {
  return value === true || (typeof value === "string" && value.trim().length > 0);
}

export function negotiateLayerCapabilities(
  manifest: LayerManifestV2,
  host: RuntimeHostCapabilities = {}
): LayerCapabilityNegotiation {
  assertLayerManifestV2(manifest);
  const missingServerCapabilities = (manifest.requiresServerCapabilities ?? []).filter(
    (name) => !serverCapabilityAvailable(host.server?.[name])
  );
  const rendererSupported =
    host.renderers === undefined || host.renderers.includes(manifest.renderer.type);
  const sourceSupported = host.sources === undefined || host.sources.includes(manifest.source.type);
  const layerCapabilities = host.layer ? new Set(host.layer) : null;
  const negotiatedLayerCapabilities = layerCapabilities
    ? manifest.capabilities.filter((capability) => layerCapabilities.has(capability))
    : [...manifest.capabilities];
  const unavailableLayerCapabilities = manifest.capabilities.filter(
    (capability) => !negotiatedLayerCapabilities.includes(capability)
  );

  return {
    enabled: missingServerCapabilities.length === 0 && rendererSupported && sourceSupported,
    missingServerCapabilities,
    rendererSupported,
    sourceSupported,
    negotiatedLayerCapabilities,
    unavailableLayerCapabilities
  };
}

/**
 * UI-neutral registry for canonical layer manifests and their host-specific runtime value.
 * The value may be a MapOS plugin, a static fixture, or another application's controller;
 * registration and compatibility rules stay identical.
 */
export class LayerRuntimeRegistry<TValue> {
  private registrations = new Map<string, RuntimeLayerRegistration<TValue>>();

  register(registration: RuntimeLayerRegistration<TValue>): RuntimeLayerRegistration<TValue> {
    assertLayerManifestV2(registration.manifest);
    if (this.registrations.has(registration.manifest.id)) {
      throw new Error(
        `Layer "${registration.manifest.id}" is already registered. Layer ids must be unique.`
      );
    }
    this.registrations.set(registration.manifest.id, registration);
    return registration;
  }

  get(id: string): RuntimeLayerRegistration<TValue> | undefined {
    return this.registrations.get(id);
  }

  all(): RuntimeLayerRegistration<TValue>[] {
    return [...this.registrations.values()];
  }

  available(host: RuntimeHostCapabilities = {}): RuntimeLayerRegistration<TValue>[] {
    return this.all().filter(({ manifest }) => negotiateLayerCapabilities(manifest, host).enabled);
  }

  negotiate(
    id: string,
    host: RuntimeHostCapabilities = {}
  ): LayerCapabilityNegotiation | undefined {
    const registration = this.get(id);
    return registration ? negotiateLayerCapabilities(registration.manifest, host) : undefined;
  }

  /**
   * Removes one layer, reporting whether it was there.
   *
   * Needed because not every layer is known at startup: a layer built from a URL the user
   * pasted is registered when their layer list loads and has to be removable when they delete
   * it, without clearing the built-ins alongside it.
   */
  unregister(id: string): boolean {
    return this.registrations.delete(id);
  }

  clear(): void {
    this.registrations.clear();
  }
}
