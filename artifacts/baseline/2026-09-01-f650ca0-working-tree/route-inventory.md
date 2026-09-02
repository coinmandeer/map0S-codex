# MapOS Phase 0 — route and runtime inventory

Snapshot: `2026-09-01-f650ca0-working-tree`

## Composition roots

- Production API: `apps/api/src/index.ts`
- Memory API: `apps/api/src/memory-server.ts`
- Shared provider registry: `apps/api/src/services/featureProviders.ts`
- Web layer host: `apps/web/src/layers/registry.ts`
- Web lifecycle/cache: `apps/web/src/engine/LayerEngine.ts`

The baseline audit found 66 direct production routes and 61 direct memory routes before this slice. Shared route modules are registered by both roots, but the roots still differ materially: production-only place/tag/radar/Wikipedia/staking behavior and a memory-only Park4Night fixture remain. The memory server also advertises more legacy layer providers than its generic v1 feature route can answer.

Phase 1 adds the same canonical feature path to both roots:

```text
GET /v2/layers/:layerId/features
public proxy path: GET /api/v2/layers/:layerId/features
```

The first registered implementation is `earthquakes`; production maps live USGS data and memory mode returns a deterministic offline fixture. Both enforce the v2 result envelope and the 100-feature ceiling.

## Runtime ownership

- V1 manifests and lifecycle remain active for all existing layers.
- `@mapos/layer-sdk` is the sole v1/v2 contract authority.
- V1 layers are normalized to v2 for host discovery through `layerV1ToV2`.
- A native v2 manifest is narrowed to the existing visual renderer through `layerV2ToV1`.
- Unknown schema majors fail before registry mutation.

## Follow-up debt

The two API composition roots should still converge on one app factory with repository/provider adapters and a route parity test. Until then, each new versioned route must be added to both roots and backed by an offline fixture.
