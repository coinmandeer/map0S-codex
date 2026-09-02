# MapOS Phase 0 — architecture boundary report

- Snapshot: `f650ca0-working-tree`
- Command: `node scripts/check-architecture-boundaries.mjs --json`
- Result: pass, 0 violations
- Scope: 243 TypeScript/JavaScript source files and 935 static/dynamic import edges

## Source graph

| Source | Files | Internal | SDK | External |
| ------ | ----: | -------: | --: | -------: |
| API    |   103 |      261 |  53 |      108 |
| SDK    |    21 |       52 |   — |        6 |
| Web    |   119 |      307 |  46 |      102 |

## Enforced boundaries

1. `packages/layer-sdk` cannot import either application and cannot depend on React, MapLibre,
   Three.js, Fastify, or Drizzle.
2. Web and API application source cannot import one another; their boundary is the shared SDK and
   HTTP contracts.
3. The web store cannot import UI components. Compatibility facades remain state-side.
4. API domain services cannot import the production or memory composition roots.
5. UI components cannot import provider adapters directly.

The checker is machine-readable with `--json` and exits non-zero when a guarded dependency is
introduced. It intentionally records the current graph without forcing a composition-root rewrite
inside the baseline phase.
