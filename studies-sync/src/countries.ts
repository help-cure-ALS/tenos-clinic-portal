/**
 * Country normalization — registry country strings → ISO 3166-1 alpha-2.
 *
 * CTgov and CTIS deliver country NAMES ("Germany", "Korea, Republic of"),
 * while consumers (mobile app country filter, clinic data) work with ISO
 * codes. Normalizing at ingestion keeps `Location.address.country` and
 * `trial.countries` consistent across the platform.
 *
 * Unknown values pass through unchanged (fail-open): the UI then shows
 * the raw name and the filter simply won't match it — same behavior as
 * before normalization existed.
 *
 * NOTE: this feeds computeTrialHash via the adapter output, so shipping
 * changes here re-upserts affected studies on the next sync run (text
 * translations are unaffected — they have their own hashes).
 */

const NAME_TO_ISO2: Record<string, string> = {
    // Europe
    "albania": "AL",
    "austria": "AT",
    "belarus": "BY",
    "belgium": "BE",
    "bosnia and herzegovina": "BA",
    "bulgaria": "BG",
    "croatia": "HR",
    "cyprus": "CY",
    "czechia": "CZ",
    "czech republic": "CZ",
    "denmark": "DK",
    "estonia": "EE",
    "finland": "FI",
    "france": "FR",
    "germany": "DE",
    "greece": "GR",
    "hungary": "HU",
    "iceland": "IS",
    "ireland": "IE",
    "italy": "IT",
    "latvia": "LV",
    "lithuania": "LT",
    "luxembourg": "LU",
    "malta": "MT",
    "moldova, republic of": "MD",
    "moldova": "MD",
    "montenegro": "ME",
    "netherlands": "NL",
    "north macedonia": "MK",
    "macedonia, the former yugoslav republic of": "MK",
    "norway": "NO",
    "poland": "PL",
    "portugal": "PT",
    "romania": "RO",
    "russian federation": "RU",
    "russia": "RU",
    "serbia": "RS",
    "slovakia": "SK",
    "slovenia": "SI",
    "spain": "ES",
    "sweden": "SE",
    "switzerland": "CH",
    "ukraine": "UA",
    "united kingdom": "GB",
    "great britain": "GB",

    // Americas
    "argentina": "AR",
    "bolivia, plurinational state of": "BO",
    "bolivia": "BO",
    "brazil": "BR",
    "canada": "CA",
    "chile": "CL",
    "colombia": "CO",
    "costa rica": "CR",
    "cuba": "CU",
    "dominican republic": "DO",
    "ecuador": "EC",
    "guatemala": "GT",
    "mexico": "MX",
    "panama": "PA",
    "paraguay": "PY",
    "peru": "PE",
    "puerto rico": "PR",
    "united states": "US",
    "united states of america": "US",
    "uruguay": "UY",
    "venezuela, bolivarian republic of": "VE",
    "venezuela": "VE",

    // Asia-Pacific
    "australia": "AU",
    "bangladesh": "BD",
    "brunei darussalam": "BN",
    "china": "CN",
    "hong kong": "HK",
    "india": "IN",
    "indonesia": "ID",
    "japan": "JP",
    "kazakhstan": "KZ",
    "korea, republic of": "KR",
    "south korea": "KR",
    "republic of korea": "KR",
    "malaysia": "MY",
    "new zealand": "NZ",
    "pakistan": "PK",
    "philippines": "PH",
    "singapore": "SG",
    "sri lanka": "LK",
    "taiwan": "TW",
    "taiwan, province of china": "TW",
    "thailand": "TH",
    "viet nam": "VN",
    "vietnam": "VN",

    // Middle East & Africa
    "algeria": "DZ",
    "egypt": "EG",
    "iran, islamic republic of": "IR",
    "iran": "IR",
    "israel": "IL",
    "jordan": "JO",
    "kenya": "KE",
    "kuwait": "KW",
    "lebanon": "LB",
    "morocco": "MA",
    "nigeria": "NG",
    "qatar": "QA",
    "saudi arabia": "SA",
    "south africa": "ZA",
    "syrian arab republic": "SY",
    "tunisia": "TN",
    "turkey": "TR",
    "türkiye": "TR",
    "united arab emirates": "AE",
};

const ISO2_PATTERN = /^[A-Za-z]{2}$/;

/**
 * Normalize a registry country string to an ISO 3166-1 alpha-2 code.
 * Already-valid 2-letter codes are uppercased; known English names are
 * mapped; anything else passes through unchanged.
 */
export function toIso2(raw: string): string {
    const trimmed = raw.trim();
    if (ISO2_PATTERN.test(trimmed)) return trimmed.toUpperCase();
    return NAME_TO_ISO2[trimmed.toLowerCase()] ?? trimmed;
}
