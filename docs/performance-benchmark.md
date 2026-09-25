# Opakovatelné měření mapy

Produkční sestavení s offline daty a skutečnými clustery:

```sh
MAPOS_PERF_RENDERER=pins MAPOS_E2E_API_PORT=4035 MAPOS_E2E_WEB_PORT=5178 npx playwright test --config=playwright.performance.config.ts
```

Porty musí být volné. Konfigurace spouští vlastní memory API s blokací externích providerů a produkční Vite preview. Nikdy nepoužívá náhodný existující vývojový server. Benchmark output je `dist/performance-web`, běžný web zůstává v `apps/web/dist`.

Scénář používá šest nebo dvanáct vrstev: dva rastry a zbývající bodové vrstvy po 400 prvcích. Provede 50 posunů, deset vypnutí/zapnutí a deset změn podkladu. Po každé změně čeká na načtené **neprázdné** zdroje. Ověřuje návrat počtu mapových zdrojů, vrstev a listenerů i limit růstu hlavního JS heapu po GC. Prázdné čárové zdroje u pinových fixture nesmějí vzniknout.

Bez `MAPOS_PERF_RENDERER=pins` se použije jednodušší kruhový renderer. Výsledky těchto dvou variant nezaměňovat. Běžná Playwright konfigurace je vývojová; produkční profil kontroluje nepřítomnost Vite dev klienta. Testovací bridge existuje jen při compile-time režimu `performance` a nesmí být součástí běžného deploy buildu.

Reporty jsou v `output/performance/map-{6,12}-production-pins-layers.json`. Než provedete změnu, zachovejte výchozí report pod jiným názvem. Zaznamenejte současně revizi, zařízení a zatížení hostu. Jeden běh na sdíleném stroji není důkazem rychlostního zlepšení.

## Diagnostika

- `MAPOS_PERF_CPU_PROFILE=1`: uloží `.cpuprofile`; otevřete v DevTools Performance nebo použijte `node scripts/summarize-cpu-profile.mjs <soubor>`.
- `MAPOS_PERF_TIMELINE=1`: uloží časovou stopu prohlížeče; souhrn vytvoří `node scripts/summarize-map-timeline.mjs <soubor>`. Záznam má limit 64 MiB a stream se vždy uzavírá.
- Pro výběr jediného scénáře přidejte `--grep '12 layers'`.

Samplování a tracing mají vlastní režii. Časy v časové stopě jsou inkluzivní a překrývají se, proto se nesčítají na celkový CPU čas. `(program)` v CPU profilu není automaticky chyba aplikace.

Long-task statistika zahrnuje startup a všechny kroky, měří pouze úlohy nad 50 ms. Její p95 **není p95 reakce na kliknutí**. Heap limit se týká hlavního JavaScriptového vlákna, nikoli workerů, GPU ani celé paměti procesu. Fixture data neprokazují rychlost veřejného API.

Automatizační callback nikdy nesmí vracet `map.jumpTo()`, `map.panBy()` apod. MapLibre vrací celý objekt mapy; jeho serializace přes Playwright zásadně zkreslí měření. Použijte blok bez návratové hodnoty.
