# MapOS map runtime

`@mapos/map-runtime` is the UI-neutral browser runtime shared by MapOS and the clean-room starter.
It deliberately exposes MapLibre rather than hiding it behind an imaginary multi-renderer API.

It owns three narrow boundaries:

- canonical v2 manifest validation and unique registration;
- deployment, renderer, source and optional layer-capability negotiation;
- stable MapLibre data-layer handles that restore cached desired state after `style.load`.

The runtime depends on `@mapos/layer-sdk` contracts and MapLibre only. It does not import React,
MapOS modes, panels, stores or API composition. Product-specific plugins remain in `apps/web`; a
different application registers its own runtime value beside the same manifest.

The private workspace resolves TypeScript source directly so a fresh clone can run the starter
without committing generated files. `npm run build` still emits `dist`; package metadata must be
switched to that output as part of the separate signing/publication gate.

From the repository root:

```sh
npm run test -w @mapos/map-runtime
npm run build -w @mapos/map-runtime
npm run dev -w @mapos/runtime-starter
```
