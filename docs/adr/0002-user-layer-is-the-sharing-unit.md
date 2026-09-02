# ADR 0002: UserLayer je současná jednotka vlastnictví a sdílení

- Stav: přijato
- Datum: 2026-08-27

## Kontext

Současný produkt má uživatele, vrstvy a piny. Nemá členství týmu, role, tenant branding ani
serverově uloženou konfiguraci celého mapového pohledu. Zavedení obecného `Project/Workspace` bez
konkrétního týmového workflow by zdvojilo vlastnictví a publikaci dřív, než je produkt potřebuje.

## Rozhodnutí

`UserLayer` zůstává v této etapě hlavní jednotkou:

- uživatel ji vlastní,
- obsahuje piny a později i další GeoJSON geometrie,
- nese název, barvu, veřejnost a publikovaný slug,
- je cílem CRUD, importu/exportu a oprávnění.

Mapový režim, aktuální view, podklad a filtry nejsou součástí vrstvy. Nadále žijí v URL a lokálním
nastavení prohlížeče.

## Hranice pro budoucí Project

`Project/Workspace` se zavede teprve tehdy, až bude potřeba alespoň jedno z následujícího:

- více členů spravuje několik vrstev pod společnými rolemi,
- jeden publikovaný odkaz musí zamknout view, podklad, filtry a branding,
- fakturace nebo tenant izolace patří celému mapovému produktu, ne jedné vrstvě.

Budoucí migrace přidá `project_id` k vrstvám jako nullable cizí klíč; dnešní osobní vrstvy proto
zůstanou platné a není nutné měnit jejich ID ani slug.
