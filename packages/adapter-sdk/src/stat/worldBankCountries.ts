/** World Bank country API snapshot 2026-09-24; region.id=NA aggregates excluded.
 * https://api.worldbank.org/v2/country?format=json&per_page=400
 * Includes separately reported economies; does not assert political recognition. */
export const WORLD_BANK_COUNTRY_CODES: ReadonlySet<string> = new Set(
  "AD AE AF AG AL AM AO AR AS AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CW CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FO FR GA GB GD GE GH GI GL GM GN GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JG JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MR MT MU MV MW MX MY MZ NA NC NE NG NI NL NO NP NR NZ OM PA PE PF PG PH PK PL PR PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TL TM TN TO TR TT TV TZ UA UG US UY UZ VC VE VG VI VN VU WS XK YE ZA ZM ZW".split(
    " "
  )
);
