# ADR 0001: Režimy používají společný aditivní layer stack

- Stav: přijato
- Datum: 2026-08-27

## Kontext

MapOS má režimy Mapa, Objevuj, Hra, Moje a Počasí. Každý má primární vrstvu, ale uživatel zároveň
skládá mapu z tematických a rastrových overlayů. Dosavadní implementace při změně režimu zapnula
primární vrstvu a dříve zapnuté vrstvy ponechala, což nebylo výslovně potvrzené produktové pravidlo.

## Rozhodnutí

Režim je pohled a sada ovládacích prvků nad jedním společným layer stackem. Přepnutí režimu:

1. změní aktivní panel a navigaci,
2. zapne primární vrstvu nového režimu, pokud ještě není aktivní,
3. nevypne žádnou jinou vrstvu.

Preset je naopak explicitní náhrada stacku. Samostatný přepínač vrstvy ji pouze přidá nebo odebere.
Aktivní vrstvy zůstávají součástí URL, takže složený pohled lze obnovit a sdílet.

## Důsledky

- Počasí, trasy, geologie nebo hra mohou zůstat nad mapou při změně panelu.
- Vrstva nesmí předpokládat, že je jediná svého druhu. Konflikty řeší vlastnictví dat; komunitní pin
  například při souběhu vlastní `user-layers`, zatímco ostatní veřejné piny zůstávají ve fusion.
- UI má režimy popisovat jako pohledy, nikoli jako izolované stránky.
- Pokud bude někdy potřeba „čistý režim“, vznikne jako explicitní akce Resetovat vrstvy, ne jako
  vedlejší efekt navigace.
