/**
 * Country code mapping for tennis players.
 *
 * The RapidAPI returns 3-letter ISO codes (alpha-3) like "ESP", "ITA", "USA".
 * Emoji flags use 2-letter codes (alpha-2) like "ES", "IT", "US".
 *
 * This module converts alpha-3 → { alpha-2, flag emoji, display name }.
 * Covers every country that appears in ATP/WTA tour play.
 */

export interface CountryInfo {
  /** ISO 3166-1 alpha-3 (from API) */
  alpha3: string;
  /** ISO 3166-1 alpha-2 (for emoji flags) */
  alpha2: string;
  /** Flag emoji */
  flag: string;
  /** English display name */
  name: string;
}

// Special codes used by the API for doubles teams or "no country"
const SPECIAL_CODES: Record<string, CountryInfo> = {
  "N/A": { alpha3: "N/A", alpha2: "", flag: "🏳️", name: "N/A" },
  "": { alpha3: "", alpha2: "", flag: "🏳️", name: "Unknown" },
};

const COUNTRIES: Record<string, CountryInfo> = {
  // Tennis hot-beds + most common nationalities on tour
  ARG: { alpha3: "ARG", alpha2: "AR", flag: "🇦🇷", name: "Argentina" },
  AUS: { alpha3: "AUS", alpha2: "AU", flag: "🇦🇺", name: "Australia" },
  AUT: { alpha3: "AUT", alpha2: "AT", flag: "🇦🇹", name: "Austria" },
  BEL: { alpha3: "BEL", alpha2: "BE", flag: "🇧🇪", name: "Belgium" },
  BLR: { alpha3: "BLR", alpha2: "BY", flag: "🇧🇾", name: "Belarus" },
  BOL: { alpha3: "BOL", alpha2: "BO", flag: "🇧🇴", name: "Bolivia" },
  BRA: { alpha3: "BRA", alpha2: "BR", flag: "🇧🇷", name: "Brazil" },
  BUL: { alpha3: "BUL", alpha2: "BG", flag: "🇧🇬", name: "Bulgaria" },
  CAN: { alpha3: "CAN", alpha2: "CA", flag: "🇨🇦", name: "Canada" },
  CHI: { alpha3: "CHI", alpha2: "CL", flag: "🇨🇱", name: "Chile" },
  CHN: { alpha3: "CHN", alpha2: "CN", flag: "🇨🇳", name: "China" },
  COL: { alpha3: "COL", alpha2: "CO", flag: "🇨🇴", name: "Colombia" },
  CRO: { alpha3: "CRO", alpha2: "HR", flag: "🇭🇷", name: "Croatia" },
  CUB: { alpha3: "CUB", alpha2: "CU", flag: "🇨🇺", name: "Cuba" },
  CYP: { alpha3: "CYP", alpha2: "CY", flag: "🇨🇾", name: "Cyprus" },
  CZE: { alpha3: "CZE", alpha2: "CZ", flag: "🇨🇿", name: "Czechia" },
  DEN: { alpha3: "DEN", alpha2: "DK", flag: "🇩🇰", name: "Denmark" },
  ECU: { alpha3: "ECU", alpha2: "EC", flag: "🇪🇨", name: "Ecuador" },
  EGY: { alpha3: "EGY", alpha2: "EG", flag: "🇪🇬", name: "Egypt" },
  EST: { alpha3: "EST", alpha2: "EE", flag: "🇪🇪", name: "Estonia" },
  FIN: { alpha3: "FIN", alpha2: "FI", flag: "🇫🇮", name: "Finland" },
  FRA: { alpha3: "FRA", alpha2: "FR", flag: "🇫🇷", name: "France" },
  GEO: { alpha3: "GEO", alpha2: "GE", flag: "🇬🇪", name: "Georgia" },
  GER: { alpha3: "GER", alpha2: "DE", flag: "🇩🇪", name: "Germany" },
  GRE: { alpha3: "GRE", alpha2: "GR", flag: "🇬🇷", name: "Greece" },
  HUN: { alpha3: "HUN", alpha2: "HU", flag: "🇭🇺", name: "Hungary" },
  IND: { alpha3: "IND", alpha2: "IN", flag: "🇮🇳", name: "India" },
  INA: { alpha3: "INA", alpha2: "ID", flag: "🇮🇩", name: "Indonesia" },
  IRI: { alpha3: "IRI", alpha2: "IR", flag: "🇮🇷", name: "Iran" },
  IRL: { alpha3: "IRL", alpha2: "IE", flag: "🇮🇪", name: "Ireland" },
  ISR: { alpha3: "ISR", alpha2: "IL", flag: "🇮🇱", name: "Israel" },
  ITA: { alpha3: "ITA", alpha2: "IT", flag: "🇮🇹", name: "Italy" },
  JAM: { alpha3: "JAM", alpha2: "JM", flag: "🇯🇲", name: "Jamaica" },
  JPN: { alpha3: "JPN", alpha2: "JP", flag: "🇯🇵", name: "Japan" },
  KAZ: { alpha3: "KAZ", alpha2: "KZ", flag: "🇰🇿", name: "Kazakhstan" },
  KOR: { alpha3: "KOR", alpha2: "KR", flag: "🇰🇷", name: "South Korea" },
  LAT: { alpha3: "LAT", alpha2: "LV", flag: "🇱🇻", name: "Latvia" },
  LTU: { alpha3: "LTU", alpha2: "LT", flag: "🇱🇹", name: "Lithuania" },
  LUX: { alpha3: "LUX", alpha2: "LU", flag: "🇱🇺", name: "Luxembourg" },
  MAR: { alpha3: "MAR", alpha2: "MA", flag: "🇲🇦", name: "Morocco" },
  MEX: { alpha3: "MEX", alpha2: "MX", flag: "🇲🇽", name: "Mexico" },
  MKD: { alpha3: "MKD", alpha2: "MK", flag: "🇲🇰", name: "North Macedonia" },
  MON: { alpha3: "MON", alpha2: "MC", flag: "🇲🇨", name: "Monaco" },
  MNE: { alpha3: "MNE", alpha2: "ME", flag: "🇲🇪", name: "Montenegro" },
  NED: { alpha3: "NED", alpha2: "NL", flag: "🇳🇱", name: "Netherlands" },
  NOR: { alpha3: "NOR", alpha2: "NO", flag: "🇳🇴", name: "Norway" },
  NZL: { alpha3: "NZL", alpha2: "NZ", flag: "🇳🇿", name: "New Zealand" },
  PER: { alpha3: "PER", alpha2: "PE", flag: "🇵🇪", name: "Peru" },
  PHI: { alpha3: "PHI", alpha2: "PH", flag: "🇵🇭", name: "Philippines" },
  POL: { alpha3: "POL", alpha2: "PL", flag: "🇵🇱", name: "Poland" },
  POR: { alpha3: "POR", alpha2: "PT", flag: "🇵🇹", name: "Portugal" },
  PUR: { alpha3: "PUR", alpha2: "PR", flag: "🇵🇷", name: "Puerto Rico" },
  QAT: { alpha3: "QAT", alpha2: "QA", flag: "🇶🇦", name: "Qatar" },
  ROU: { alpha3: "ROU", alpha2: "RO", flag: "🇷🇴", name: "Romania" },
  RSA: { alpha3: "RSA", alpha2: "ZA", flag: "🇿🇦", name: "South Africa" },
  RUS: { alpha3: "RUS", alpha2: "RU", flag: "🇷🇺", name: "Russia" },
  SRB: { alpha3: "SRB", alpha2: "RS", flag: "🇷🇸", name: "Serbia" },
  SVK: { alpha3: "SVK", alpha2: "SK", flag: "🇸🇰", name: "Slovakia" },
  SLO: { alpha3: "SLO", alpha2: "SI", flag: "🇸🇮", name: "Slovenia" },
  ESP: { alpha3: "ESP", alpha2: "ES", flag: "🇪🇸", name: "Spain" },
  SWE: { alpha3: "SWE", alpha2: "SE", flag: "🇸🇪", name: "Sweden" },
  SUI: { alpha3: "SUI", alpha2: "CH", flag: "🇨🇭", name: "Switzerland" },
  THA: { alpha3: "THA", alpha2: "TH", flag: "🇹🇭", name: "Thailand" },
  TPE: { alpha3: "TPE", alpha2: "TW", flag: "🇹🇼", name: "Chinese Taipei" },
  TUN: { alpha3: "TUN", alpha2: "TN", flag: "🇹🇳", name: "Tunisia" },
  TUR: { alpha3: "TUR", alpha2: "TR", flag: "🇹🇷", name: "Türkiye" },
  UAE: { alpha3: "UAE", alpha2: "AE", flag: "🇦🇪", name: "UAE" },
  UGA: { alpha3: "UGA", alpha2: "UG", flag: "🇺🇬", name: "Uganda" },
  UKR: { alpha3: "UKR", alpha2: "UA", flag: "🇺🇦", name: "Ukraine" },
  USA: { alpha3: "USA", alpha2: "US", flag: "🇺🇸", name: "United States" },
  URU: { alpha3: "URU", alpha2: "UY", flag: "🇺🇾", name: "Uruguay" },
  UZB: { alpha3: "UZB", alpha2: "UZ", flag: "🇺🇿", name: "Uzbekistan" },
  VEN: { alpha3: "VEN", alpha2: "VE", flag: "🇻🇪", name: "Venezuela" },
  // Common alternate codes the API may use
  KOS: { alpha3: "KOS", alpha2: "XK", flag: "🇽🇰", name: "Kosovo" },
  HKG: { alpha3: "HKG", alpha2: "HK", flag: "🇭🇰", name: "Hong Kong" },
};

const FALLBACK: CountryInfo = { alpha3: "??", alpha2: "", flag: "🏳️", name: "Unknown" };

/** Convert an alpha-3 code (from API) to a CountryInfo record. */
export function countryFromAcr(acr: string | null | undefined): CountryInfo {
  if (!acr) return FALLBACK;
  if (SPECIAL_CODES[acr]) return SPECIAL_CODES[acr];
  return COUNTRIES[acr.toUpperCase()] ?? FALLBACK;
}

/** Quick helper: return just the flag emoji for a country code. */
export function flagForCountry(acr: string | null | undefined): string {
  return countryFromAcr(acr).flag;
}

/** Look up a CountryInfo by alpha-2 code (e.g. "IT", "ES"). */
export function countryFromAlpha2(acr: string | null | undefined): CountryInfo {
  if (!acr) return FALLBACK;
  const upper = acr.toUpperCase();
  for (const info of Object.values(COUNTRIES)) {
    if (info.alpha2 === upper) return info;
  }
  return FALLBACK;
}

/** Quick helper: return flag emoji for an alpha-2 country code. */
export function flagFromAlpha2(acr: string | null | undefined): string {
  return countryFromAlpha2(acr).flag;
}
