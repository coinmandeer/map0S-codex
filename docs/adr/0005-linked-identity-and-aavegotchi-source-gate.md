# ADR 0005: Propojená identita je guest-first a live Aavegotchi inventář čeká na ověřený indexer

- Stav: přijato pro SIWE; live inventář blokuje zdrojový gate
- Datum: 2026-09-01
- Vazba na plán: Phase 14, identity graph, SIWE, ENS/Aavegotchi source gates, GATE-008

## Kontext

MapOS potřebuje zachovat jediný profil uživatele při doplnění e-mailu, peněženky a později dalších
identit. Peněženka proto nesmí automaticky vytvořit druhý účet ani být podmínkou pro lokální práci.
Podpis musí odpovídat EIP-4361 a nesmí se redukovat na důvěru v adresu poslanou klientem.

Oficiální evidence k 2026-09-01 uvádí Base mainnet (chain ID `8453`) a Aavegotchi Diamond na Base
`0xa99c4b08201f2913db8d28e71d020c4298f29dbf`. Staré Polygon kontrakty jsou v oficiálním registru
označené jako deprecated. V dostupných oficiálních zdrojích však není potvrzený produkční Base
indexer endpoint s kontraktem, provozní odpovědností a licencí, který by MapOS mohl pravdivě vydávat
za live inventář.

## Rozhodnutí

- Každý návštěvník nejdřív dostane guest profil. E-mail i wallet se připojí k témuž `user_id`;
  odpojení identity nemaže piny, plány, XP ani jiná uživatelská data.
- SIWE challenge je vytvořená serverem a váže exact domain, URI, chain ID, adresu, nonce, session,
  čas vydání a expiraci. Nonce lze spotřebovat jen jednou a úspěšné propojení rotuje session.
- Podpis EOA se ověřuje lokálně jako EIP-191 nad přesnou serverovou zprávou. Podpis ani jiný secret
  se neukládá do identity ani auditu.
- EIP-1271 smart-contract wallets zůstávají gate: vyžadují explicitní, omezený a monitorovaný RPC
  transport. Do té doby se jejich podpis nevydává za ověřený EOA podpis.
- E-mail/heslo je identita `email/password`, ale bez samostatného e-mailového verification flow má
  `verified_at = NULL` a UI jej takto označí.
- Vývojová simulace je samostatný provider, odpovědi i UI nesou `SIMULACE` a produkce vyžaduje dvě
  explicitní proměnné. Nesmí se zaměnit za on-chain vlastnictví.
- Live Aavegotchi inventář zůstává capability `false`, dokud není potvrzený oficiální Base indexer.
  Bez něj API vrací pravdivý `source-unavailable` stav, nikoli prázdný seznam vydávaný za holdings.
- ENS reverse lookup je pouze zobrazovací enrichment přes explicitní veřejnou HTTPS
  `MAPOS_ENS_RPC_URL`; bez ní se
  žádný veřejný RPC implicitně nepoužije. Pozitivní i negativní výsledek má bounded hodinovou cache
  a chyba nesmí rozbít přihlášení. Jméno `coinmandeer.eth` ani žádné jiné jméno/holdings není
  hardcoded jako identita nebo důkaz vlastnictví.

## Zdrojový gate pro live inventář

Před zapnutím capability musí integrace doložit:

1. oficiální Base endpoint nebo reprodukovatelný vlastní indexer nad potvrzeným kontraktem,
2. chain/contract pinning, reorg policy, pagination, timeouts, cache a bounded request budget,
3. licenci a atribuci metadat i 2D/3D assetů, včetně podmínek redistribuce a transformací,
4. test proti cizímu `identityId`, stale-data indikaci a rozlišení empty/error/unavailable,
5. provozní monitoring, kill switch a pravidelnou revalidaci zdrojové evidence.

## Odkazy na rozhodné zdroje

- EIP-4361: <https://eips.ethereum.org/EIPS/eip-4361>
- Base network information: <https://docs.base.org/get-started/connect-to-base>
- Aavegotchi deployed contracts: <https://github.com/aavegotchi/deployed-contract-addresses>
- Aavegotchi Base repository: <https://github.com/aavegotchi/aavegotchi-base>
- Aavegotchi core subgraph repository: <https://github.com/aavegotchi/aavegotchi-core-subgraph>

Jakákoli změna adresy, sítě nebo endpointu po datu tohoto ADR vyžaduje novou source revalidaci;
konfigurační default nesmí sám odemknout produkční tvrzení o vlastnictví.
