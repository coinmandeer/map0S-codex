# MapOS Phase 0 — command results

Snapshot: `2026-09-01-f650ca0-working-tree`

| Check                    | Command                                                  | Exit/result | Notes                                                                             |
| ------------------------ | -------------------------------------------------------- | ----------: | --------------------------------------------------------------------------------- |
| Environment              | `node --version`                                         |         `0` | `v22.23.1`                                                                        |
| Environment              | `npm --version`                                          |         `0` | `10.9.8`                                                                          |
| Source identity          | `git rev-parse HEAD`                                     |         `0` | `f650ca02dad0f87b2ec1df9ebb9a8f4b70392a0d` on `main`; working tree dirty          |
| Clean dependency install | `npm ci --offline --ignore-scripts --no-audit --no-fund` |         `0` | Completed from local npm cache; no registry download required                     |
| Build                    | `npm run build`                                          |         `0` | SDK, API and web builds succeeded                                                 |
| Lint                     | `npm run lint`                                           |         `0` | Succeeded                                                                         |
| Typecheck                | `npm run typecheck`                                      |         `0` | SDK, API and web typechecks succeeded                                             |
| Unit tests               | `npm test`                                               |         `0` | `215` passed: SDK `4`, API `129`, web `82`                                        |
| Format check             | `npm run format:check`                                   |         `1` | Only `apps/web/src/layers/game/threeScene.ts` differs; classified as pre-existing |
| Playwright E2E           | `npm run test:e2e`                                       |     not run | Intentionally deferred to conserve mobile data; no passing claim is made          |

## Classification

- Blocking new regression: none found by build, lint, typecheck or unit tests.
- Known baseline issue: formatting-only difference in `apps/web/src/layers/game/threeScene.ts`.
- Unverified in this snapshot: browser/E2E behavior and visual matrix.
- Product code was not changed to hide or normalize the formatting failure.
