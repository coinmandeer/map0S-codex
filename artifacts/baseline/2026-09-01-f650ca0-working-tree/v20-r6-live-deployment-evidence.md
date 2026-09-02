# MapOS v20 UI/UX r6 — durable plan collaboration live evidence

Date: 2026-09-02  
Public URL: `https://mapos.promptstudio3000.com`  
Release: `20260902-mapos-v20-ui-ux-r6`

Licence and source-rights metadata remains advisory for the prototype. Security, privacy,
ownership and technical validation boundaries remain enforced.

## Delivered scope

- a saved plan can create multiple revocable read-only share links;
- each link uses a one-time 256-bit bearer token while PostgreSQL stores only its SHA-256 digest;
- the browser keeps the token in the URL fragment and resolves it through a bounded request body,
  keeping it out of server URL logs and referrers;
- the public projection anonymises the owner, removes stop and segment notes, removes conversation
  references and annotations, and replaces arbitrary metadata with a read-only marker;
- the shared Planning surface is visibly read-only and can save a private editable copy;
- a saved plan has a durable owner-and-plan-scoped multi-turn AI thread with optimistic revisions,
  bounded history and explicit external-model disclosure;
- account export and deletion include the new non-secret collaboration domains, with PostgreSQL
  cascade cleanup.

## Verification before deployment

- API and web type checks, repository lint and production builds: passed;
- migration 0010 SQL plus Drizzle schema-mirror tests: 2 passed;
- planning browser scenarios: 7 passed;
- focused public-share and persistent-thread browser scenario: passed;
- focused desktop/mobile visual captures: passed;
- full API run: 395 passed; its sole failure was the generated route-parity count, corrected from
  the actual inventory and then verified by the focused parity run (2 passed);
- full web run: 290 passed and 7 advisory skips; one unrelated transient timeout passed in its
  isolated four-test rerun;
- secret and source scan: passed.

Visual evidence:

- `e2e/screenshots/1440-planning-share.png`
- `e2e/screenshots/1440-planning-share-thread.png`
- `e2e/screenshots/390-planning-share.png`
- `e2e/screenshots/390-planning-share-thread.png`

## Data-efficient deployment and live verification

- compressed upload: 948,051 bytes;
- candidate build, migration, restored-backup drill and pre-cutover health: passed;
- verified backup: `/opt/ps3000/apps/mapos-v3/backups/20260902-mapos-v20-ui-ux-r6`;
- atomic cutover completed with healthy API, web and PostgreSQL services;
- active release symlink resolves to `20260902-mapos-v20-ui-ux-r6`;
- live migration ledger contains version `0010` exactly once;
- public API health, SPA root, shared-plan SPA fallback and security headers: passed;
- live temporary-guest scenario: plan save 200, share creation 200, public resolution 200,
  private-field projection passed, revoke 204 and post-revoke resolution 404;
- live configured-model scenario: two consecutive plan-scoped requests returned 200, the second
  response contained the same persistent thread at revision 4 with four ordered messages;
- model identifier and non-empty answer were present without logging the model credential, share
  bearer token, session cookie or response text;
- both temporary live-test accounts were deleted successfully (200).

This evidence is scoped to PLAN-024 and the r6 collaboration slice. It does not claim the remaining
phase-7 adventure, bike-policy or segment-alternative requirements are complete.
