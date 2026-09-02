# Phase 12 — bezpečný detail POI/Place

Datum: 2026-09-01  
Scope: pouze place detail/media/social/provider actions; bez Events, AI gateway, identity,
commerce, deploymentu a databázové migrace.

## Současnost → cíl

- ploché zdrojové taby → pět stabilních dynamických ploch `overview/media/practical/social/more`;
- provider-specific větev v `PinDetail` → generic `fieldOrder`/action adaptér z layer manifestu;
- holé URL fotografií → asset s konkrétním zdrojem, atribucí, licencí, moderací a transformací;
- smíchané hodnocení/komentáře → oddělené provider, MapOS a device-private bloky;
- tiché selhání detail/social → lokální snapshot + loading/offline/error/empty/retry;
- pouze save/route/provider → také stabilní add-to-plan, share a pravdivá OSM correction/report akce.

## Traceability

| Požadavek   | Evidence                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| OS-007      | `detailFieldsFromFeature` vykreslí pouze manifestem vyjmenovaná pole; syntetický partner test bez provider branch. |
| OS-008      | Foursquare/provider panel, MapOS `PlaceSocial` a private note mají samostatné ownership bloky.                     |
| OS-009      | Media kontrakt photo/video/link; MapOS recenze/komentáře; device-private note; odkazy zůstávají registry panel.    |
| OS-010      | Provider action je jen validovaný deep link; neznámé write scope se skryje, bez autologinu.                        |
| OS-022      | Neznámá licence/atribuce, pending moderation nebo processing transform zablokují zobrazení.                        |
| MAP-014/015 | Kanonický overview a manifestová provider pole; sekční a social loading/empty/error stavy.                         |
| MAP-016     | Add-to-plan a share nesou stabilní `place.id`; command test kontroluje `sourceFeatureId`.                          |

## Lokální ověření bez sítě

- Layer SDK unit: **25/25** pass (včetně 2 media-gate testů).
- Web cílené Phase 12 testy: dynamic sections, provider fields/actions/permissions, media rights,
  OSM correction, stable add-to-plan, identity refs, private note a social state — pass.
- Web full unit: **230/230** pass.
- Layer SDK typecheck: pass.
- Web typecheck: pass.
- Web production build: pass (pouze stávající upozornění na velikost hlavních chunků).
- Scoped ESLint: pass bez warnings.
- Scoped Prettier + `git diff --check`: pass.
- Architecture boundary test: pass (**1567 imports / 412 source files** v okamžiku kontroly).

Playwright/E2E nebyl záměrně spuštěn kvůli mobilním datům a zákazu síťového testu. Offline fixture
očekávání v `e2e/placeDetail.spec.ts` byla aktualizována pro novou sekční navigaci; živý vizuální
screenshot zůstává integrační release gate.

## Rollback a otevřené gates

- Rollback: `VITE_DETAIL_SURFACE_V2=0` obnoví legacy ploché taby bez remountu MapCore.
- GATE-P12-REPORT: obecný nativní MapOS report vyžaduje append-only `reports`, ACL, moderaci a
  audit. Nyní se ukazuje pouze pravdivá exact-ref OSM oprava nebo manifestový provider deep link.
- GATE-P12-PRIVATE-SYNC: soukromá poznámka je vědomě device-only; serverová synchronizace čeká na
  owner ACL a leakage testy.
- GATE-P12-MEDIA-INGEST: upload/scan/EXIF/transcode/variants/moderation worker není implementován;
  proto lze zobrazit pouze předem schválený a právně popsaný asset.
- AI enrichment je mimo aktuální uživatelský scope a nebyl měněn.

Rozhodnutí a důvody jsou v `docs/adr/0004-place-detail-content-and-media-boundaries.md`.
