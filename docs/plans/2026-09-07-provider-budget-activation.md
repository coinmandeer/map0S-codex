# Kvótovaní poskytovatelé — implementace a aktivace

T07 používá dopřednou migraci0023: přidělený ověřený rozpočet, denní spotřeba a rezervace. Žádné automatické granty. Jeden aktivní grant pro poskytovatele/účet/SKU; rezervace zamyká řádek, aktualizuje denní i celkovou spotřebu v jedné transakci. Restart ani více API procesů spotřebu nevynuluje. Expirovaný/chybějící/neověřený grant a nedostupná databáze nepovolí nový transport.

Aplikační stropy jsou v `services/providerBudget/policy.ts`. Samy nedokazují bezplatnost účtu. Foursquare Pro má450 za období a15 za UTC den, Premium0. Ostatní Google stropy odpovídají master plánu; integrace Google je ještě musí použít a ověřit správné SKU. Žádný Google transport se v této etapě neaktivuje.

## Provozní postup

1. Na účtu ověřit skutečné bezplatné jednotky pro MapOS, ostatní projekty, cenu a přesný začátek/konec billing období. Zadané `units` jsou přidělené zbývající jednotky, ne nominální celková kvóta. Neznámá spotřeba = neaktivovat.
2. Nastavit dostupné providerové kvóty a omezený náhradní serverový klíč. Klíč není součástí níže uvedeného příkazu ani této dokumentace.
3. Po migraci spustit v API prostředí s existujícím DATABASE_URL:

```sh
node apps/api/dist/services/providerBudget/allocate.js \
  --product foursquare-pro --account mapos-fsq \
  --units '<ověřený přidělený zůstatek, nejvýše 450>' \
  --start '<začátek skutečného billing období ISO>' \
  --end '<konec skutečného billing období ISO>' \
  --reference '<nesekretní záznam ověření>' --verified-free-allocation
```

CLI nevynuluje existující grant a opakované stejné období odmítne. Nové období vyžaduje nové ověření; žádný automatický měsíční reset na plnou kvótu. Při nejistém výsledku ověřit grant/rezervace v databázi, nevytvářet jiný začátek období, aby se obešla unikátnost.

4. Teprve potom nastavit `FSQ_PLACES_ENABLED=1`, `FSQ_BUDGET_ACCOUNT=mapos-fsq` a serverový `FSQ_API_KEY`. Paměťová skladba bez dostupného budget DB zůstane zavřená. Pro vypnutí nastavit flag0; otevřené datové zdroje zůstávají funkční.
5. Kontrola explicitního detailu: jedno Pro volání, žádné fotografie/tips/hours/rating. Search200m/max3; kandidát se zobrazí z téhož výsledku. Bez aktivace žádný externí požadavek.

## Co se účtuje a uchovává

Rozpočtová brána je součást existujícího transportu: po dedup a před každým pokusem. Retry rezervuje další jednotku. Po udělení rezervace se jednotka konzervativně nevrací ani při DNS chybě nebo abortu před odesláním; případné nedočerpání je přijatelné proti riziku překročení. Kvótované odpovědi se v upstream cache neukládají, pouze sdílejí během běžícího požadavku. Foursquare route má `private, no-store`. Žádné automatické ukládání API odpovědí do otevřeného indexu.

Původní automatický legacy enrichment už neprovádí externí volání; zachovává čtení dříve uložených referencí. Nová Pro integrace používá [aktuální endpoint](https://docs.foursquare.com/fsq-developers-places/reference/place-details), version2025-06-17 a [ověřený allowlist polí](https://docs.foursquare.com/fsq-developers-places/reference/response-fields). Starý účet/token nemusí mít přístup k novému API: oprávnění musí potvrdit skutečný účet.

Zbývá: ověřená aktivace účtů, providerové dashboard kvóty, lokální FSQ OS import a Google integrace. Zde uvedené testy nečerpají žádné providerové kredity.
