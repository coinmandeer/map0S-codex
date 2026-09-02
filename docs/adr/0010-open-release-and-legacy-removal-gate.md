# ADR 0010: Open release and legacy removal gate

Status: accepted, 2026-09-01.

## Context

A source dump is not a usable open platform, while deleting compatibility paths based on assumed
adoption can strand self-hosted clients. The current deployment has no privacy-safe historical
adoption dataset for every v1 manifest, timeline and sheet facade.

## Decision

Ship the Apache-2.0 licence, public contracts and schemas, CLI validator, deterministic fixture,
MapLibre starter, contribution/conduct/security/governance policies, compatibility policy, release
notes, upgrade and export documentation together. Keep provider credentials, licensed binaries and
hosted payment/model operations outside the keyless core.

Retain v1 adapters and compatibility facades until all of these are true: a documented successor is
available, old fixtures still migrate, golden browser flows pass, privacy-safe usage evidence covers
the declared window, and rollback remains available. Missing telemetry means “unknown”, not “zero”.
The two superseded standalone timeline components remain checked in as unused rollback assets. The
shared timeline host is the active path, but its contract and browser coverage do not replace the
missing adoption window and therefore do not authorize source removal.

## Consequences

The starter and its clean-room browser test prove that SDK plus the shared UI-neutral map runtime can
run without MapOS-specific modes. Public npm
publication, package signing and a hosted documentation domain remain explicit distribution gates;
the source-controlled docs and local CLI are the authoritative release surface until those gates
are completed.
