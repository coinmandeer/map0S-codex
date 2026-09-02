# MapOS v19 traceability verification

- Date: `2026-09-01`
- Scope: local working tree; zero public-provider traffic for the browser checks below
- Source requirements SHA-256:
  `1372e028bf44ff57998f60220d20e4e32555630cc15be16427924bd45b8b4295`

## Fresh evidence used by the v19 matrix

| Check                                                | Result                                                               | What it proves                                                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Full `npm test` workspace suite                      | pass (`0`): SDK 58, map runtime 3, API 387, web 287 + 7 opt-in skips | Current unit, integration and contract coverage passes after all v19 changes.                     |
| Phase 8 AI/tool/route/parity suites                  | pass (`0`): AI 54, route 4, route parity 2                           | The authenticated AI runtime, bounded context, tools and both server call sites pass.             |
| `npm run test:contracts`                             | pass (`0`), 10/10                                                    | Clean-room CLI workflow and the API compatibility report passed.                                  |
| `npm run test:migrations`                            | pass (`0`), 27/27                                                    | Ordered additive migrations, rollback metadata and exact schema contracts pass locally.           |
| Optional `npm run audit:source-rights`               | pass (`0`), 7/7                                                      | Advisory provenance inventory is complete; this command is not a CI, runtime or deployment gate.  |
| `npm run test:secrets`                               | pass (`0`)                                                           | Source and built-artifact secret scan passed.                                                     |
| `npm run test:privacy`                               | pass (`0`), 69/69                                                    | Provider transport, telemetry, request correlation and privacy/error boundaries pass.             |
| `npm run test:load`                                  | pass (`0`), 1/1                                                      | Deterministic offline 1/5/10 active-module smoke passed; this is not a VPS capacity claim.        |
| `npm run test:e2e`                                   | pass (`0`), 70 passed, 1 intentionally skipped                       | The complete default browser suite passes; only the separately gated game performance case skips. |
| `npm run test:e2e:offline`                           | pass (`0`), 1/1                                                      | Planning shell and synthetic API booted with zero unexpected external requests.                   |
| `npm run test:e2e:security`                          | pass (`0`), 1/1                                                      | Untrusted planning text stays inert and production CSP blocks and reports inline script.          |
| `npm run test:e2e:accessibility`                     | pass (`0`), 3/3                                                      | Named controls/focus return, mobile keyboard/200% text and `prefers-reduced-motion` all passed.   |
| `MAPOS_FIXTURE_MODE=offline npm run test:e2e:visual` | pass (`0`), 11/11                                                    | Required five-viewport light/dark baseline profile passed without a public provider.              |
| `npm run test:e2e:runtime`                           | pass (`0`), 2/2                                                      | Clean-room registrations and the WebGL-failure primary-data fallback pass offline.                |
| Typecheck, build, lint and format                    | pass (`0`)                                                           | Every workspace compiles, production bundles build and the final tree satisfies static gates.     |

The architecture boundary check invoked by the current suite reported zero violations across
2,177 imports and 551 source files.

## Deliberately unclaimed

- No v19 VPS deployment evidence exists yet. `QUAL-004`, `QUAL-011` and `QUAL-017` therefore remain
  `pending-live`; historical v18 production evidence is not relabelled as v19 evidence.
- Offline load smoke is a deterministic regression check, not evidence of horizontal capacity.
- Public npm publication, hosted documentation, package signing/provenance, off-host backup/PITR,
  cohort/blue-green rollout infrastructure and a durable multi-replica preview store remain gates.
- No public map/data provider, live Ollama response, payment provider, chain indexer or optional
  Aavegotchi binary asset was exercised by these local gates.
