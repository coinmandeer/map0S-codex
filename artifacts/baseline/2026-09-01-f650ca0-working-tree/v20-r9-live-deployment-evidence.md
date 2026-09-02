# MapOS v20 UI/UX r9 live deployment evidence

- Release: `20260902-mapos-v20-ui-ux-r9`
- Public origin: `https://mapos.promptstudio3000.com`
- Deployment payload: 964,009 compressed bytes; dependencies, caches, generated output, local models and environment files were excluded.
- Rollback backup: `/opt/ps3000/apps/mapos-v3/backups/20260902-mapos-v20-ui-ux-r9`

## Delivered scope

- `PLAN-008`: a denied or unavailable device location now opens an inline fallback on the affected stop. It explains the browser-setting remedy and offers both fixed-center map selection and directly editable longitude/latitude fields. A successful location updates the same stop and map.
- `PLAN-017`: the 250-stop product/UI cap was removed. The stop editor renders accessible 25-item windows, while routing splits the complete document into overlapping transport batches of at most 100 stops and merges segment results back into the unchanged full document.
- Provider waypoint limits remain isolated: every server-side call still routes one adjacent pair, with bounded concurrency. The transport route keeps its security budget; the browser never sends a whole oversized waypoint request to an external provider.
- A local canonical draft is no longer mistaken for an already-persisted plan merely because its legacy projection has timestamps.
- Source-rights and licensing metadata remain advisory and do not gate these flows.

## Verification before deployment

- Planning browser suite: 12 passed, including denied/allowed planning GPS and a 105-stop load, navigation, 100+6 batch route merge and persistence round trip.
- Web suite: 292 passed, 7 advisory skips, 0 failed.
- Web batching unit suite: 4 passed, including a 205-stop 100+100+7 transport split.
- Targeted PlanDocument API route suite: 6 passed.
- API/web typechecks, ESLint, changed-file Prettier check, production builds and secret/source plus built-artifact scan passed.
- Visual browser evidence: `e2e/screenshots/390-planning-gps-fallback.png`.

## Public runtime smoke

The anonymous smoke made no persistent write.

- Health HTTP: 200
- Web HTML HTTP: 200
- Current JavaScript asset HTTP: 200 (`/assets/index-DeA-C4uw.js`)
- Two live adjacent OSRM segments: HTTP 200, 2/2 ready, 2 provider calls
- Route response: 5,381 bytes uncompressed JSON
- Active symlink: `releases/20260902-mapos-v20-ui-ux-r9`
- Rollback backup presence verified after cutover.

The 105-stop UI/batch/persistence acceptance is fresh browser evidence at offline provider-fixture scope. The live smoke confirms the deployed asset and adjacent routing boundary without claiming a 105-segment public-provider load test.
