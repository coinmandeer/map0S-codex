# MapOS Layer SDK v2

Public, serialisable contracts for MapOS layers. Untrusted integrations are data-only: a manifest,
fixture data and an optional reviewed declarative HTTP mapping. They do not execute JavaScript in
the MapOS origin.

After `npm --workspace @mapos/layer-sdk run build`:

```sh
node packages/layer-sdk/bin/mapos-layer.mjs scaffold ./my-layer
node packages/layer-sdk/bin/mapos-layer.mjs validate ./my-layer/layer.manifest.json
node packages/layer-sdk/bin/mapos-layer.mjs contract ./my-layer/layer.manifest.json ./my-layer/features.fixture.json
```

`validate` and `contract` use SDK 2.0.0 / host runtime 19.0.0 by default. A compatibility check can
model another host with `--sdk-version`, `--runtime-version` and
`--capabilities=capability-a,capability-b`. Failures are JSON with stable, actionable issue codes.

The checked-in offline example is in `examples/fixture-layer`. See
[`../../docs/public-layer-sdk-v2.md`](../../docs/public-layer-sdk-v2.md) for the trust boundary,
package/import contract and publication gates.
