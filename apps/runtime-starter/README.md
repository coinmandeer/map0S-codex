# MapOS runtime starter

This is the clean-room, keyless starter app for the public MapOS contracts. It intentionally imports
no MapOS product mode or panel component. It validates two checked-in v2 layer fixtures through
`@mapos/map-runtime` and renders canonical features through the same MapLibre data-layer lifecycle
used by MapOS.

From the repository root:

```sh
npm run dev -w @mapos/runtime-starter
```

The command first builds the two local public-contract packages, so it also works directly after a
clean checkout. No provider request or API key is needed: the base style and both fixtures are local.
The accessible feature list is rendered before MapLibre starts, so WebGL failure only removes the
optional map. Replace or add an entry in `src/fixtures/clean-room-layers.json` to prove a second
application can register another data layer without changing or importing MapOS UI. A
server-proxied declarative connector may replace a static fixture; never place a provider secret in
this client.

The clean-room browser proof is also offline:

```sh
npm run test:e2e:runtime
```
