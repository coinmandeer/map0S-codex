# Phase 8 offline evidence — AI-010, AI-021 and AI-022

Evidence date: 2026-09-01

Scope: provider-neutral API services, the shared production/memory HTTP composition and
deterministic local fixtures. This record makes no claim that a live AI provider, public data
provider, browser UI or v19 VPS deployment was exercised. No public-network request was made by
these gates.

## Requirement mapping

- **AI-010** — `find_nearest_poi` accepts a geolocation, map-centre or explicit point; requires
  projected layers and `poi:read`; applies the submitted active filters; computes a stable
  whole-metre distance; and returns only sourced fixture candidates in deterministic order.
  Geolocation is denied when the run projection disallows precise location. The explicit
  provider-neutral orchestration service recognizes the narrow natural-language nearest-bar
  intent, invokes this tool and stores the user/assistant turns with result citations. Production
  and memory servers both register the same authenticated, exact-schema, finite-rate route;
  the memory composition proves the complete Czech prompt-to-sourced-answer path offline.
- **AI-021** — the provider-neutral registry contains 11 tools spanning all seven required domains:
  map, layers, POI, route, weather, events and plans. Every descriptor has strict input/output
  schemas, a server-side permission policy, a data/layer/plan/field projection, timeout, quota and
  response bounds, metadata-only audit/redaction policy, and a deterministic fixture invocation.
  Plan/layer changes are drafts, not direct mutations. The runtime orchestration boundary invokes
  this server registry directly. Its HTTP route exposes only nearest POI and all other catalog
  handlers fail closed until reviewed. Current model adapters still advertise `tools=false`, so
  this is not claimed as a native model tool-call flow.
- **AI-022** — conversations support global, plan, day, stop, segment, feature/POI and layer scopes.
  Long threads retain at most 24 raw messages with an enforced 48,000-character raw-content budget
  and move older messages into bounded data-class-partitioned summary/state. Citation fields and
  counts are bounded. The complete projected model-context JSON, including UTF-8 content, citation
  metadata and structured summaries/state, is capped at 128 KiB and omits older raw turns as needed.

## Fresh offline gates

- `node --import tsx --test 'apps/api/src/services/ai/**/*.test.ts'` — **54/54 passed**,
  including 11/11 catalog fixture subtests, natural-language orchestration, exact encoded-context
  budget and the timeout handler that ignores `AbortSignal`.
- `node --import tsx --test apps/api/src/routes/aiRoutes.test.ts` — **4/4 passed**: actual offline
  memory composition, auth/exact-schema, layer/location policy and dedicated rate limiting.
- `node --import tsx --test apps/api/src/routeParity.test.ts` — **2/2 passed**; both composition
  roots register `/v2/ai/orchestrate` through the same registrar.
- `npm run typecheck -w @mapos/api` — passed.
- Scoped ESLint for the affected AI, route and composition files — passed with no warnings.
- Scoped Prettier check for the affected AI, route, composition and evidence files — passed.
- `node docs/validate-requirements-traceability-v19.mjs` — recorded after the three rows were
  updated; 322/322 IDs and all 19 phases remained valid.

The nearest-POI orchestration is deterministic and provider-neutral. It is not evidence of a live
model/provider and does not claim gateway-native tool calling.
