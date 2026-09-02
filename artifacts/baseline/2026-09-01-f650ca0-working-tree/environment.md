# MapOS Phase 0 — environment

- Snapshot ID: `2026-09-01-f650ca0-working-tree`
- Recorded: `2026-09-01`
- Workspace: `/Users/coinmandeer/Downloads/map0S-v0.1`
- Git branch: `main`
- Git HEAD: `f650ca02dad0f87b2ec1df9ebb9a8f4b70392a0d`
- Git state: dirty working tree (`156` tracked/untracked status entries at capture time)
- Node.js: `v22.23.1`
- npm: `10.9.8`
- Package manager: npm workspaces

This baseline describes the supplied working tree, not a clean Git commit. Existing changes were preserved and were not rewritten as part of Phase 0. Dependency installation was performed in offline mode from the available npm cache to avoid mobile-data transfer.

## Verification scope

Fresh dependency installation, build, lint, typecheck and unit tests completed. Format checking found one pre-existing formatting difference. Playwright E2E was intentionally deferred because running it would require avoidable network/data transfer in the current mobile-data environment.
