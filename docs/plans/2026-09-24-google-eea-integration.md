# Google v mapOS: EHP, klíče a použitelné varianty

Ověřeno 24. 9. 2026 proti oficiální dokumentaci a viditelné Google Cloud konzoli. Dokument neobsahuje klíče ani podpisové secrety.

## Co přesně brání dlaždicím

Jsou to nezávislé podmínky, nikoli jedna chyba:

1. **Oprávnění konkrétní služby.** Maps JavaScript API nepovoluje Map Tiles API. API klíč může zahrnovat více explicitně povolených služeb.
2. **Omezení aplikace.** Současný klíč má HTTP referrery pro domény promptstudio3000.com a sedm API. Serverové volání Map Tiles z VPS tím není autorizované. Pro server použít samostatný klíč s IP `72.61.188.39` a pouze Map Tiles API; webový klíč ponechat omezený na web.
3. **Dostupnost v EHP.** Pro dotčené nové či změněné projekty s fakturační adresou EHP Google od 8. 7. 2025 neposkytuje satelitní 2D a fotorealistické 3D dlaždice. Tyto požadavky vracejí 403 i se správným klíčem. Roadmap a terrain nejsou tímto konkrétním omezením zakázané. Jde o zveřejněné podmínky a dostupnost produktu Google; není přesné označit to za obecný zákonný zákaz satelitních map v EU.

Dodaná hodnota označená jako secret tvarem odpovídá URL signing secret. Ten slouží k podpisům podporovaných URL, například Maps Static/Street View Static, a není náhradou API klíče ani způsobem odblokování EHP dlaždic. Pro současnou implementaci se nepoužívá.

## Varianta pro mapOS

- **Hlavní mapa:** zachovat MapLibre a nynější dostupné podklady; roadmap/terrain přes existující serverový Map Tiles adaptér zapnout až se správným omezeným klíčem a ověřenou dostupností. Satelitní 2D a 3D Map Tiles pro tento účet nenabízet.
- **Google satelit:** oficiální Google Maps JavaScript mapa je podporovaná alternativa. Je to vlastní renderer, nikoli zdroj obrázků, který lze vytáhnout do MapLibre. Případná implementace musí mít jasně označený samostatný pohled, vlastní atribuci a synchronizaci výřezu. Body/linie/polygony mapOS lze navrhnout pro Google Data/overlay API; stávající MapLibre vrstvy a interakce se automaticky nepřenášejí. Tato změna rendereru není v aktuálním vydání implementovaná.
- **Hledání míst:** nasazený oficiální Places UI Kit zůstává správnou cestou. Je výslovně vyňatý z popsané změny pravidel Places pro EHP. Výsledky zůstávají v jeho komponentě s atribucí. Do mapOS se při výběru předává pouze validovaná poloha; názvy, recenze a fotografie se nekopírují do interního detailu, databáze nebo AI.
- **Běžné Places API:** nepoužívat jako neomezený zdroj obohacení vlastních bodů vedle mapy. Výjimka pro souřadnice a place ID není výjimkou pro celý obsah výsledku.

## Nulové doplatky

Konzole stále uvádí Free Trial, 90 zbývajících dní a kredit Kč6 212,53. Nebyl proveden přechod na Paid ani změna fakturace. Při ponechání Free Trial Google po skončení zkoušky/kreditu bez upgradu účet automaticky zastaví. Aktuální browser povolení mapOS navíc končí 20. 12. 2026. Ruční upgrade na Paid ruší podmínku této verifikace a musí být doprovázen vypnutím trial povolení v mapOS. Rozpočtová upozornění a promo kredit nejsou stropem účtování placeného účtu. Google Tiles zůstává vypnutý; ostatní poskytovatelé respektují nastavení podle navazujícího zadání.

## Oficiální podklady

- [EHP a Map Tiles](https://developers.google.com/maps/comms/eea/map-tiles)
- [EHP a Places, výjimka UI Kit](https://developers.google.com/maps/comms/eea/places)
- [Nastavení Map Tiles API](https://developers.google.com/maps/documentation/tile/get-api-key)
- [Doporučená omezení klíčů](https://developers.google.com/maps/api-security-best-practices)
- [Digitální podpisy](https://developers.google.com/maps/digital-signature)
- [Google Cloud Free Trial](https://docs.cloud.google.com/free/docs/free-cloud-features)
