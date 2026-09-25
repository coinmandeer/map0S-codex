# Discover — skutečné produkční pokrytí

Stav z importu 2026-09-05. Data byla ověřena v oddělené databázi `mapos_opt_stage_boundaries` na VPS a všech 92 vydání bylo publikováno do produkce po nasazení `20260905T013214Z-mapos-optimization`. ADM1/ADM2 jsou administrativní úrovně zdroje; ADM2 neznamená automaticky obec. Aktualizace `20260905-interactive-areas`: LAU 2024 pipeline i publikace 34 zemí dokončeny; další evropské země zůstávají bez ověřených obecních dat.

| Země | ADM1                     | ADM2                       | Obce/LAU       |
| ---- | ------------------------ | -------------------------- | -------------- |
| AD   | 7 oblastí                | Zdroj nemá dataset (404)   | Nedodáno       |
| AL   | 12 oblastí               | 37 oblastí                 | 61 LAU 2024    |
| AM   | 11 oblastí               | 39 oblastí                 | Nedodáno       |
| AT   | 9 oblastí                | 94 oblastí                 | 2093 LAU 2024  |
| AZ   | 2 oblastí                | 79 oblastí                 | Nedodáno       |
| BA   | 3 oblastí                | 12 oblastí                 | Nedodáno       |
| BE   | 3 oblastí                | 11 oblastí                 | 581 LAU 2024   |
| BG   | 28 oblastí               | 265 oblastí                | 265 LAU 2024   |
| BY   | 7 oblastí                | 118 oblastí                | Nedodáno       |
| CH   | 26 oblastí               | 169 oblastí                | 2180 LAU 2024  |
| CY   | 6 oblastí                | 610 oblastí                | 615 LAU 2024   |
| CZ   | 14 oblastí               | 77 oblastí                 | 6258 LAU 2024  |
| DE   | 16 oblastí               | 38 oblastí                 | 10978 LAU 2024 |
| DK   | 5 oblastí                | 98 oblastí                 | 99 LAU 2024    |
| EE   | 15 oblastí               | 214 oblastí                | 79 LAU 2024    |
| ES   | 19 oblastí               | 52 oblastí                 | 8132 LAU 2024  |
| FI   | 19 oblastí               | 70 oblastí                 | 309 LAU 2024   |
| FR   | 13 oblastí               | 96 oblastí                 | 34946 LAU 2024 |
| GB   | 4 oblastí                | 216 oblastí                | Nedodáno       |
| GE   | 12 oblastí               | 68 oblastí                 | Nedodáno       |
| GR   | 8 oblastí                | 14 oblastí                 | 6142 LAU 2024  |
| HR   | 21 oblastí               | 560 oblastí                | 556 LAU 2024   |
| HU   | 19 oblastí               | 198 oblastí                | 3155 LAU 2024  |
| IE   | 4 oblastí                | 166 oblastí                | 166 LAU 2024   |
| IS   | 8 oblastí                | 74 oblastí                 | 64 LAU 2024    |
| IT   | 5 oblastí                | 20 oblastí                 | 7900 LAU 2024  |
| LI   | 11 oblastí               | Zdroj nemá dataset (404)   | 11 LAU 2024    |
| LT   | 10 oblastí               | 60 oblastí                 | 60 LAU 2024    |
| LU   | 12 oblastí               | 105 oblastí                | 100 LAU 2024   |
| LV   | 43 oblastí               | 589 oblastí                | 43 LAU 2024    |
| MC   | 1 oblastí                | 9 oblastí                  | Nedodáno       |
| MD   | 37 oblastí               | Zdroj nemá dataset (404)   | Nedodáno       |
| ME   | 23 oblastí               | Zdroj nemá dataset (404)   | Nedodáno       |
| MK   | 8 oblastí                | 84 oblastí                 | 80 LAU 2024    |
| MT   | 68 oblastí               | Zdroj nemá dataset (404)   | 68 LAU 2024    |
| NL   | 12 oblastí               | 344 oblastí                | 342 LAU 2024   |
| NO   | 11 oblastí               | 431 oblastí                | 357 LAU 2024   |
| PL   | 16 oblastí               | 380 oblastí                | 2477 LAU 2024  |
| PT   | 20 oblastí               | 311 oblastí                | 3092 LAU 2024  |
| RO   | 42 oblastí               | 3235 oblastí               | 3181 LAU 2024  |
| RS   | 25 oblastí               | 145 oblastí                | 168 LAU 2024   |
| RU   | 83 oblastí               | Import neprošel — prověřit | Nedodáno       |
| SE   | 21 oblastí               | 290 oblastí                | 290 LAU 2024   |
| SI   | 2 oblastí                | 212 oblastí                | 212 LAU 2024   |
| SK   | 8 oblastí                | 79 oblastí                 | 2927 LAU 2024  |
| SM   | 9 oblastí                | Zdroj nemá dataset (404)   | Nedodáno       |
| TR   | 81 oblastí               | 973 oblastí                | Nedodáno       |
| UA   | 27 oblastí               | 495 oblastí                | Nedodáno       |
| VA   | Zdroj nemá dataset (404) | Zdroj nemá dataset (404)   | Nedodáno       |
| XK   | 7 oblastí                | 38 oblastí                 | Nedodáno       |

Počty jsou počty uložených identifikátorů, nikoli nezávislé potvrzení úplnosti vůči národnímu registru. Další kontrola: edice, licence, ostrovy, hranice sousedních datasetů, úplnost podle země a municipalitní data.

Důkazy: `output/performance/boundary-europe-source-smoke.jsonl`, `boundary-czech-source-smoke.jsonl`, `boundary-release-drill.txt`. Databázová zkouška ověřuje staging, publikaci, rollback, společný fallback přes dlaždice a zachování geometrie při duplicitním kódu.

Kontrola identity 2026-09-05: všech 91 administrativních datasetů znovu importováno podle `shapeID`, žádné opakované ID. Předchozí `shapeISO` slučovalo odlišné regiony (např. Španělsko 1 → 19). Počty výše pocházejí z opravené databáze. Důkaz: `output/performance/boundary-fixed-identities.jsonl`.

Produkční důkaz: `output/performance/boundary-production-publication.jsonl`, `output/performance/production-smoke.json`. Celkem 873 ADM1, 11 175 ADM2 a 240 zemí/území.

## GISCO LAU 2024 — publikováno v produkci 2026-09-05

Kontrolní součet celého staženého souboru: `ae07901e0a11cb7891d1a6d6a31cfd833e25672ca318908856b0e34a1acca594`. 97 987 jednotek v 34 zemích. Obecní jednotky LAU mohou zahrnovat i zvláštní správní území; nejde o nezávislý důkaz úplnosti národních registrů. Geometrie jsou generalizované pro 1 : 1 000 000.

| Země | Jednotky LAU |
| ---- | -----------: |
| AL   |           61 |
| AT   |         2093 |
| BE   |          581 |
| BG   |          265 |
| CH   |         2180 |
| CY   |          615 |
| CZ   |         6258 |
| DE   |        10978 |
| DK   |           99 |
| EE   |           79 |
| ES   |         8132 |
| FI   |          309 |
| FR   |        34946 |
| GR   |         6142 |
| HR   |          556 |
| HU   |         3155 |
| IE   |          166 |
| IS   |           64 |
| IT   |         7900 |
| LI   |           11 |
| LT   |           60 |
| LU   |          100 |
| LV   |           43 |
| MK   |           80 |
| MT   |           68 |
| NL   |          342 |
| NO   |          357 |
| PL   |         2477 |
| PT   |         3092 |
| RO   |         3181 |
| RS   |          168 |
| SE   |          290 |
| SI   |          212 |
| SK   |         2927 |

Import proběhl po zemích s kontrolou počtu, jedinečnosti identity a kontrolního součtu; publikace v produkci vyžaduje samostatný potvrzený krok. Manifest: `output/performance/lau-2024-manifest.json`.

Produkční publikace LAU: `output/performance/lau-production-publication.jsonl`; 34 zemí, 97 987 jednotek. Veřejný manifest a kontrolní Praha/La Selva: `area-production-manifest.json`, `area-production-smoke.json`. Každá země publikována atomicky, předchozí edice zachované.
