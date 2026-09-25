# UI audit input — 2 September 2026

These are the screenshots the redesign brief was written against, captured from the
working tree at commit `aa3f37c` ("Snapshot the feature work that landed before the UI
redesign"). They are the _before_ state: every defect listed in
`docs/plans/2026-09-ui-redesign-and-layer-roadmap.md` §1 and §29.2 is visible in here.

PNGs were re-encoded to JPEG at 960 px wide so the folder stays under 10 MB and no single
file exceeds 300 kB. Re-generate at full resolution with `node e2e/visual-audit.mjs`
(see §31.3) if you need pixel-exact comparison rather than a visual reference.

## Naming

| Prefix | Viewport                            |
| ------ | ----------------------------------- |
| `d-`   | desktop, 1440×900                   |
| `m-`   | mobile, 390×844                     |
| `x-`   | desktop, one-off interaction states |
| `xm-`  | mobile, one-off interaction states  |

For `d-` and `m-` the second segment is the theme (`light` / `dark`), then a sequence number
and the state being shown, so `d-dark-05-layers.jpg` is the Layers drawer in dark mode on
desktop.

## `r2/`

The second capture round, taken after the third wave of Codex changes. It is the evidence
for §29.2: every `r2/d-*` capture shows the left panel offset from the top of the viewport,
`r2/d-*-03-planning-ai.jpg` shows the overlapping text in the AI section, and
`r2/d-*-07-discover.jpg` shows the Discover panel failing to render on desktop.
`r2/*-log.txt` are the console/DOM dumps taken alongside each run.
