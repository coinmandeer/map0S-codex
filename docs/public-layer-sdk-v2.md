# Public Layer SDK v2

## Current to target

Before Phase 13, MapOS had useful TypeScript layer types and a browser-only user-layer transfer
file, but no public contract runner, no reviewed declarative network boundary and no atomic server
import. The Phase 13 foundation adds those boundaries while leaving existing layers and UX intact.

The target integration levels are:

| Level | Contract                                         | Execution boundary               |
| ----- | ------------------------------------------------ | -------------------------------- |
| L0    | static manifest + `FeatureQueryResultV2` fixture | no network, no extension code    |
| L1    | `declarative-http` manifest                      | reviewed MapOS server proxy only |
| L2    | `server-adapter`                                 | trusted, reviewed server module  |
| L3    | `custom-runtime`                                 | trusted first-party UI only      |
| L4    | future sandbox                                   | not implemented                  |

Untrusted packages never execute JavaScript in the MapOS origin.

## First fixture layer

Build the workspace SDK, then run the data-only tools:

```sh
npm --workspace @mapos/layer-sdk run build
node packages/layer-sdk/bin/mapos-layer.mjs scaffold ./my-layer
node packages/layer-sdk/bin/mapos-layer.mjs validate ./my-layer/layer.manifest.json
node packages/layer-sdk/bin/mapos-layer.mjs contract ./my-layer/layer.manifest.json ./my-layer/features.fixture.json
```

`packages/layer-sdk/examples/fixture-layer` is a fully offline example. `contract` returns a
machine-readable report and exits non-zero on a failed check. It covers manifest/fixture shape,
feature budget, layer ownership, source rights, attribution/licence publication readiness,
untrusted runtime boundaries and likely secret material. The programmatic runner additionally
checks deterministic repeated mapping, timeout and cancellation behavior.

The exported `validateLayerManifestV2`, `validateLayerContractV2` and both CLI commands share one
production JSON Schema validator. Compatibility checks default to SDK 2.0.0 / MapOS runtime 19.0.0;
use `--sdk-version`, `--runtime-version` and `--capabilities=a,b` to model another host. Stable issue
codes identify schema v3, an incompatible `sdkRange`, an unmet `minimumRuntime` and all missing host
capabilities before any extension is loaded.

## Declarative HTTP source

An L1 manifest specifies only:

- one fixed credential-free HTTPS endpoint using the default port;
- `GET` and `requiresServerProxy: true`;
- fixed query parameter mappings (`bbox`, bounds, limit, cursor, zoom or `filter:<id>`);
- safe dot paths for items, identity, title, coordinates and optional display fields;
- optional bounded timeout/response size and an opaque `authRef`.

It cannot specify arbitrary headers, JavaScript, templates or a response adapter. Production must
separately register the exact allowed host and resolve `authRef` from trusted configuration. Every
DNS answer and redirect is checked, then HTTPS is pinned to that verified address while TLS still
validates the original hostname. The checked-in composition intentionally registers no live host,
so `GET /v2/layer-sources/:layerId/features` fails closed until review.

## Package and import API

The canonical `mapos.layer-package` v2 bundle contains a manifest and `MapOSFeatureV2`
FeatureCollection, with optional source records, media inventory, styles and README metadata. The
SDK also accepts legacy `mapos.user-layer-package` v2, plain Point GeoJSON and CSV (`lng`, `lat`;
optional name/source/attribution/licence columns). Limits are 5 MiB, 1,000 features, 16 KiB feature
properties and 20 preview samples.

Authenticated server flow:

1. `POST /v2/layer-imports/preview` with `{ filename, document }` for JSON or `{ filename, content }`
   for CSV/raw JSON. The response includes a SHA-256 digest, 15-minute owner-bound `previewId`,
   duplicate groups, warnings, rights errors and the sample. It writes nothing durable.
2. `POST /v2/layer-imports/:previewId/commit` with `{ visibility: "private" | "public" }`. Layer,
   features, provenance and import report are committed in one transaction. Repeating a successful
   preview commit returns the same report instead of creating another layer.
3. `POST /v2/layer-imports/:importId/rollback` deletes only the layer created by that owner's import
   and returns the preserved report with `rolled-back` status. Repeating rollback is safe.

Raw GeoJSON/CSV defaults to private because it has no host-compatibility manifest. A caller may
still request a public commit through the API. Missing attribution, licence or `open` rights is
reported as advisory preview/contract warnings and never blocks a prototype commit. Non-Point
geometry is rejected with an explicit “no silent repair” error. Geometry repair preview and media
binary persistence remain future work.

For deterministic export, use `buildMapOSLayerPackageV2` and `layerPackageGeoJsonV2`. SDK tests
round-trip the canonical fixture and its provenance. Server-side streaming export/download is not
part of this foundation.

## Operations, rollout and rollback

- Migrations `0006_layer_imports` and `0009_layer_import_previews` are additive and
  version-ledgered. Apply both before enabling import routes on a VPS.
- Suggested rollout flag: `layer_sdk_v2_host`. The current composition is equivalent to off for
  live declarative sources because its reviewed registry is empty.
- The workspace package is not published to npm yet; it intentionally remains private until the
  release/version/signing policy is approved.
- Preview payloads live for 15 minutes in an owner-bound repository. Production uses PostgreSQL;
  commit locks and atomically consumes the preview, so preview and commit may hit different API
  instances. This is shared-state evidence, not a horizontal throughput or failover benchmark.
- Removing a source registry entry immediately disables its network access without deleting data;
  that review covers SSRF, credentials and response budgets rather than source-rights metadata.
- Import rollback is per report; a schema rollback is not required.
- Post-deploy gates: run one private preview/commit/rollback transaction against PostgreSQL, verify
  the ledger checksum, and inspect API telemetry for response-size/timeout rejections. Do not add a
  live host until licence/attribution review is recorded.
