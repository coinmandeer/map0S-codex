# PostgreSQL backup and restore drill

The production deploy performs an immutable logical backup before cutover, verifies its SHA-256
and archive catalog, restores it into a uniquely named disposable database, checks the migration
ledger plus core tables, applies the candidate migration set twice, runs a candidate read/write
probe, and runs the previous API image's read/write probe over the expanded schema. Before candidate
startup it also proves that the historical 0001 constraint/type reconciliation is already present
on the restored v18 schema. It then drops only that temporary database and writes
`RESTORE_DRILL.txt` beside the backup. A release is not activated if any step fails.

The same pre-cutover drill stores `POSTGIS_EXPLAIN.json` and fails unless the restored candidate uses
the `canonical_places_geog_gist` index under `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. After cutover,
60 loopback requests across health and layer-registry routes record observed p50/p95 in
`HTTP_SOAK.txt`; this does not call a third party and does not turn one short sample into an SLO.

Manual equivalent from an active release:

```sh
./scripts/backup-postgres.sh /absolute/release-specific/backup-directory
./scripts/restore-drill-postgres.sh /absolute/release-specific/backup-directory/mapos.dump
```

Both scripts require an explicit narrow target and the production compose/env paths. Override
`MAPOS_COMPOSE_FILE` and `MAPOS_ENV_FILE` only when testing another saved deployment. The restore
script creates a database named `mapos_restore_drill_<pid>` and its trap removes that exact name;
it never drops or rewrites `mapos`.

## Release/rollback rules

1. Build while the old containers stay live.
2. Back up and complete the real restore drill.
3. Apply candidate migrations twice and exercise candidate plus previous-image read/write against
   the restored copy; only then atomically switch `current` and migrate the live database.
4. Verify API/web health, explicit 404 for missing/non-bundled model paths, container restart counts and
   critical startup logs.
5. On failure restore the previous symlink and immutable image IDs. Additive schema remains
   compatible; repair forward rather than dropping new columns/tables during the same release.

Backups contain user data and production environment metadata. Directories are mode 0700/files
0600 and must follow the hosting retention/encryption policy. Provider secrets are restored from
the server secret store/env, never copied into a public source archive. Point-in-time recovery and
off-host encrypted retention depend on the chosen VPS backup facility and remain an operational
hosting gate; a local dump alone is not presented as disaster recovery.
