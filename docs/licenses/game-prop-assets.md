# Generic game prop asset advisory inventory

Status date: 2026-09-01.

The pre-v19 VPS contains converted GLB files with names such as `cube-guy-character.glb`,
`tree.glb`, `goblin.glb`, `diamond-block.glb` and `wood-chest.glb`. The historical fetch script
calls the set “third-party CC0”, but the repository contains no original download URL, creator,
licence record, source archive or source checksum. Filename-only web searches did not establish a
reliable origin. The historical “CC0” label is therefore preserved only as unverified advisory
metadata.

V19 keeps the old host directory untouched for the v18 rollback, but its environment mounts a new
release-local `models` directory. That directory is empty at release time to minimize transfer. Requests for a
missing `/models/*.glb` return 404 and the game uses the original MapOS procedural fallback; the SPA
HTML is never returned under a fake model URL.

For production provenance, an operator-supplied model should record:

- original author/publisher and canonical source URL;
- exact licence version and redistribution/modification rights;
- original and deployed SHA-256 checksums;
- conversion steps, attribution placement and any trademark constraints;
- size, geometry, texture, draw-call and low-end performance evidence.

These rows do not block the prototype under ADR 0012. Rendering is controlled by safe local paths,
payload/geometry/texture/draw-call budgets and graceful procedural fallback.
