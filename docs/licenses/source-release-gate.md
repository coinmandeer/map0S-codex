# Source-rights advisory inventory for the prototype

MapOS records attribution, governing terms and source URLs so operators can see where data comes
from. In this prototype the inventory is informational: it does not block CI, deployment, panel
registration, the layer picker, export, caching or AI use.

The optional `npm run audit:source-rights` command checks that the catalog remains internally
complete. It is deliberately absent from the default test, CI and VPS deployment paths. A missing
or restrictive record is reported only when an operator chooses to run that audit.

## Place-source metadata

Every `PLACE_SOURCES` entry keeps separate advisory fields for display, cache, export,
redistribution and AI use. `RELEASED_PLACE_SOURCES` is retained as a compatibility export but now
contains the complete place-source catalog. Runtime availability is decided only by technical
conditions such as a configured key, explicit provider switch, server health and API capability.

Park4Night remains documented against its current
[GTCU article 5](https://plus.park4night.com/en/cgu), but the record no longer overrides the
prototype operator switch `PARK4NIGHT_ENABLED`. The OpenStreetMap vanlife source remains available
as a keyless fallback if the provider rejects or throttles prototype traffic.

Provider metadata does not assert that third-party data is openly redistributable. It is retained
for provenance and for a future production policy, without reducing the prototype's data surface.

Large historical game GLBs are not copied into v19 because the rollout is intentionally
bandwidth-efficient. The procedural character fallback remains usable; model ingestion can be
handled as a separate data transfer when desired.
