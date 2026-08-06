// Country, state and currency reference data, shared by the sign-up form and
// the account editor. Lives on the server so both stay in step and the
// validation that guards the database reads from the same list the form does.
//
// Every country carries its ISO-2 code, default currency and dialling code. States are listed
// where a country has meaningful, well-known subdivisions people expect to
// pick from; elsewhere the form falls back to a free-text field, which is
// honest — inventing a list for a country we don't have one for is worse than
// letting someone type theirs.

export const COUNTRIES = [
  { code: 'AU', name: 'Australia', currency: 'AUD', dial: '+61' },
  { code: 'NZ', name: 'New Zealand', currency: 'NZD', dial: '+64' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', dial: '+44' },
  { code: 'US', name: 'United States', currency: 'USD', dial: '+1' },
  { code: 'CA', name: 'Canada', currency: 'CAD', dial: '+1' },
  { code: 'IE', name: 'Ireland', currency: 'EUR', dial: '+353' },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', dial: '+27' },
  { code: 'IN', name: 'India', currency: 'INR', dial: '+91' },
  { code: 'SG', name: 'Singapore', currency: 'SGD', dial: '+65' },
  { code: 'MY', name: 'Malaysia', currency: 'MYR', dial: '+60' },
  { code: 'PH', name: 'Philippines', currency: 'PHP', dial: '+63' },
  { code: 'HK', name: 'Hong Kong', currency: 'HKD', dial: '+852' },
  { code: 'JP', name: 'Japan', currency: 'JPY', dial: '+81' },
  { code: 'CN', name: 'China', currency: 'CNY', dial: '+86' },
  { code: 'DE', name: 'Germany', currency: 'EUR', dial: '+49' },
  { code: 'FR', name: 'France', currency: 'EUR', dial: '+33' },
  { code: 'ES', name: 'Spain', currency: 'EUR', dial: '+34' },
  { code: 'IT', name: 'Italy', currency: 'EUR', dial: '+39' },
  { code: 'NL', name: 'Netherlands', currency: 'EUR', dial: '+31' },
  { code: 'BE', name: 'Belgium', currency: 'EUR', dial: '+32' },
  { code: 'AT', name: 'Austria', currency: 'EUR', dial: '+43' },
  { code: 'PT', name: 'Portugal', currency: 'EUR', dial: '+351' },
  { code: 'GR', name: 'Greece', currency: 'EUR', dial: '+30' },
  { code: 'PL', name: 'Poland', currency: 'PLN', dial: '+48' },
  { code: 'CZ', name: 'Czechia', currency: 'CZK', dial: '+420' },
  { code: 'SE', name: 'Sweden', currency: 'SEK', dial: '+46' },
  { code: 'NO', name: 'Norway', currency: 'NOK', dial: '+47' },
  { code: 'DK', name: 'Denmark', currency: 'DKK', dial: '+45' },
  { code: 'FI', name: 'Finland', currency: 'EUR', dial: '+358' },
  { code: 'CH', name: 'Switzerland', currency: 'CHF', dial: '+41' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', dial: '+971' },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR', dial: '+966' },
  { code: 'IL', name: 'Israel', currency: 'ILS', dial: '+972' },
  { code: 'TR', name: 'Türkiye', currency: 'TRY', dial: '+90' },
  { code: 'BR', name: 'Brazil', currency: 'BRL', dial: '+55' },
  { code: 'MX', name: 'Mexico', currency: 'MXN', dial: '+52' },
  { code: 'AR', name: 'Argentina', currency: 'ARS', dial: '+54' },
  { code: 'CL', name: 'Chile', currency: 'CLP', dial: '+56' },
  { code: 'KR', name: 'South Korea', currency: 'KRW', dial: '+82' },
  { code: 'TH', name: 'Thailand', currency: 'THB', dial: '+66' },
  { code: 'ID', name: 'Indonesia', currency: 'IDR', dial: '+62' },
  { code: 'VN', name: 'Vietnam', currency: 'VND', dial: '+84' },
  { code: 'PK', name: 'Pakistan', currency: 'PKR', dial: '+92' },
  { code: 'BD', name: 'Bangladesh', currency: 'BDT', dial: '+880' },
  { code: 'NG', name: 'Nigeria', currency: 'NGN', dial: '+234' },
  { code: 'KE', name: 'Kenya', currency: 'KES', dial: '+254' },
  { code: 'EG', name: 'Egypt', currency: 'EGP', dial: '+20' },
  { code: 'FJ', name: 'Fiji', currency: 'FJD', dial: '+679' },
  { code: 'PG', name: 'Papua New Guinea', currency: 'PGK', dial: '+61' },
];

export const STATES = {
  AU: [
    'Australian Capital Territory',
    'New South Wales',
    'Northern Territory',
    'Queensland',
    'South Australia',
    'Tasmania',
    'Victoria',
    'Western Australia',
  ],
  NZ: [
    'Auckland',
    'Bay of Plenty',
    'Canterbury',
    'Gisborne',
    "Hawke's Bay",
    'Manawatū-Whanganui',
    'Marlborough',
    'Nelson',
    'Northland',
    'Otago',
    'Southland',
    'Taranaki',
    'Tasman',
    'Waikato',
    'Wellington',
    'West Coast',
  ],
  GB: ['England', 'Scotland', 'Wales', 'Northern Ireland'],
  US: [
    'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware',
    'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
    'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
    'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
    'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon',
    'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah',
    'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
  ],
  CA: [
    'Alberta', 'British Columbia', 'Manitoba', 'New Brunswick', 'Newfoundland and Labrador',
    'Northwest Territories', 'Nova Scotia', 'Nunavut', 'Ontario', 'Prince Edward Island',
    'Quebec', 'Saskatchewan', 'Yukon',
  ],
  IE: [
    'Carlow', 'Cavan', 'Clare', 'Cork', 'Donegal', 'Dublin', 'Galway', 'Kerry', 'Kildare',
    'Kilkenny', 'Laois', 'Leitrim', 'Limerick', 'Longford', 'Louth', 'Mayo', 'Meath', 'Monaghan',
    'Offaly', 'Roscommon', 'Sligo', 'Tipperary', 'Waterford', 'Westmeath', 'Wexford', 'Wicklow',
  ],
  ZA: [
    'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga',
    'North West', 'Northern Cape', 'Western Cape',
  ],
  IN: [
    'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa',
    'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
    'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan',
    'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  ],
  MY: [
    'Johor', 'Kedah', 'Kelantan', 'Kuala Lumpur', 'Labuan', 'Melaka', 'Negeri Sembilan', 'Pahang',
    'Penang', 'Perak', 'Perlis', 'Putrajaya', 'Sabah', 'Sarawak', 'Selangor', 'Terengganu',
  ],
  DE: [
    'Baden-Württemberg', 'Bavaria', 'Berlin', 'Brandenburg', 'Bremen', 'Hamburg', 'Hesse',
    'Lower Saxony', 'Mecklenburg-Vorpommern', 'North Rhine-Westphalia', 'Rhineland-Palatinate',
    'Saarland', 'Saxony', 'Saxony-Anhalt', 'Schleswig-Holstein', 'Thuringia',
  ],
  BR: [
    'Acre', 'Alagoas', 'Amapá', 'Amazonas', 'Bahia', 'Ceará', 'Distrito Federal', 'Espírito Santo',
    'Goiás', 'Maranhão', 'Mato Grosso', 'Mato Grosso do Sul', 'Minas Gerais', 'Pará', 'Paraíba',
    'Paraná', 'Pernambuco', 'Piauí', 'Rio de Janeiro', 'Rio Grande do Norte', 'Rio Grande do Sul',
    'Rondônia', 'Roraima', 'Santa Catarina', 'São Paulo', 'Sergipe', 'Tocantins',
  ],
};

// Offered in the currency dropdown. The country's own currency is preselected;
// the rest are here because people bill in a currency that isn't their
// country's more often than you'd think.
export const CURRENCIES = [
  { code: 'AUD', name: 'Australian Dollar', symbol: '$' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: '$' },
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: '$' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: '$' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: '$' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr' },
  { code: 'PLN', name: 'Polish Złoty', symbol: 'zł' },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
  { code: 'MXN', name: 'Mexican Peso', symbol: '$' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
  { code: 'ILS', name: 'Israeli Shekel', symbol: '₪' },
  { code: 'FJD', name: 'Fijian Dollar', symbol: '$' },
];

const BY_NAME = new Map(COUNTRIES.map((c) => [c.name.toLowerCase(), c]));
const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export function countryByName(name) {
  return BY_NAME.get(String(name || '').trim().toLowerCase()) || null;
}

export function countryByCode(code) {
  return BY_CODE.get(String(code || '').trim().toUpperCase()) || null;
}

export function isKnownCurrency(code) {
  return CURRENCIES.some((c) => c.code === String(code || '').toUpperCase());
}

// A date should read the way it reads where the person lives: 03/04/2026 is
// the 3rd of April in Sydney and the 4th of March in New York. Reading it off
// the browser is wrong for anyone travelling, or on a work laptop set up
// somewhere else.
//
// English with a region subtag rather than the country's own language — the
// interface is in English, so this changes the order and the separators
// without producing a half-translated one.
export function localeForCountry(name) {
  const country = countryByName(name);
  return country ? `en-${country.code}` : 'en-AU';
}

// A state is valid if the country has no list (anything reasonable goes) or
// the value is on it.
export function isValidState(countryName, state) {
  const country = countryByName(countryName);
  if (!country) return false;
  const list = STATES[country.code];
  if (!list) return typeof state === 'string' && state.trim().length > 0;
  return list.includes(String(state || '').trim());
}
