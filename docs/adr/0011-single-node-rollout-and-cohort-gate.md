# ADR 0011: Single-node rollout and cohort gate

Status: accepted, 2026-09-01.

## Context

The source-grounded target sequence includes internal, fixture staging, production shadow reads,
cookie/percentage cohorts, monitoring and gradual rollout. The current production topology is one
VPS with one public web/API pair and one PostgreSQL service. It has no second public origin, edge
traffic splitter or independent replica on which a percentage cohort could safely remain.

Pretending that an atomic replacement is a percentage rollout would make the release record less
useful. Running two revisions against the live write database without a routing and compatibility
boundary would add risk rather than provide a meaningful cohort.

## Decision

V19 uses the strongest verifiable single-node sequence:

1. offline fixture, contract, visual, accessibility and load gates;
2. candidate migrations twice against a disposable database restored from the production backup;
3. candidate API and web HTTP health checks on the private Docker network;
4. candidate repository read/write, data-rights retention and PostGIS index drills on the restored
   database;
5. the previous API image's read/write probe over the expanded schema;
6. one atomic `current` symlink cutover with automatic image/symlink rollback;
7. container health/restart/log checks, a 60-request loopback soak and minimal public HTTPS smoke;
8. retention of the previous release, additive schema and the `VITE_MAP_RUNTIME_V2=0` narrow
   runtime rollback.

A cookie/percentage production cohort is an explicit operational gate, not a completed step. It
requires either an edge proxy capable of sticky version routing plus simultaneously supported
blue/green web/API stacks, or a second isolated production replica. That infrastructure must be
added and tested before a future release claims shadow traffic or gradual percentages.

## Consequences

The current release can truthfully claim a restore-tested, rollback-capable single-node rollout,
but not a percentage cohort. This accepted topology exception does not authorize removal of v1
adapters or legacy rollback assets; the adoption window in ADR 0010 remains open.
