# Phase 18 clean-room runtime evidence

Date: 2026-09-01

## Implemented boundary

- `@mapos/map-runtime` owns canonical manifest registration/validation, host capability negotiation
  and stable MapLibre data-layer handles with cached state replay after `style.load`.
- MapOS delegates its web registry to that workspace and injects the lifecycle into `MapCore` /  
  `LayerEngine`; React components, modes and product stores remain outside the runtime package.
- `@mapos/runtime-starter` registers two checked-in static fixtures without importing MapOS UI. Its
  accessible list renders before the lazy MapLibre chunk and stays usable after WebGL failure.
- `VITE_MAP_RUNTIME_V2=0` is the narrow MapOS rollback to direct handles.

## Fresh commands run

| Command                                                                                                 | Result                                                    |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `npm run test -w @mapos/map-runtime`                                                                    | 3/3 passed                                                |
| `node --import tsx --test apps/web/src/layers/registry.test.ts apps/web/src/engine/LayerEngine.test.ts` | 15/15 passed                                              |
| `npm run test -w @mapos/web`                                                                            | 250/250 passed                                            |
| `npm run typecheck -w @mapos/runtime-starter`                                                           | passed                                                    |
| `npm run typecheck -w @mapos/web`                                                                       | passed                                                    |
| targeted ESLint over runtime/starter/integration files                                                  | passed, no findings                                       |
| `npm run test:architecture`                                                                             | passed; 0 violations, 1,928 imports / 492 source files    |
| `npm run test:e2e:runtime`                                                                              | 2/2 passed; external requests aborted and asserted absent |
| `npm run build -w @mapos/runtime-starter`                                                               | passed                                                    |
| deployment dry run for `20260901-mapos-v19-source-grounded`                                             | passed; 810,897-byte archive, no network/change           |

The starter production build emitted a 180.36 kB / 55.44 kB gzip initial JavaScript chunk and a
lazy 1,055.60 kB / 285.29 kB gzip MapLibre chunk. The E2E checks the second independent registration,
44 px targets, reduced-motion camera path without `flyTo`, retained data UI after forced WebGL
initialisation failure, and zero external network attempts.
