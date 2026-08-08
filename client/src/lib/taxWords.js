// The words a country uses for its own tax.
//
// Taxify supports thirty-one countries, and the interface was written in
// Australian: "lodgement", "the ATO". In Britain you file with HMRC, in America
// you file with the IRS, and in most of the rest "lodge" is not a word anybody
// uses about tax at all. Somebody in Dublin reading "your next lodgement" is
// being addressed in a dialect they do not speak, by software holding their tax
// records.
//
// Only where the local term is genuinely different is it listed. Everywhere
// else falls back to the neutral form, which is correct rather than merely
// inoffensive — "file" and "tax office" are understood everywhere, including in
// the countries that have their own word for it.

const OFFICES = {
  Australia: 'the ATO',
  'New Zealand': 'Inland Revenue',
  'United Kingdom': 'HMRC',
  Ireland: 'Revenue',
  'United States': 'the IRS',
  Canada: 'the CRA',
  India: 'the Income Tax Department',
  'South Africa': 'SARS',
  Singapore: 'IRAS',
  Malaysia: 'LHDN',
  Germany: 'the Finanzamt',
  France: 'the DGFiP',
  Netherlands: 'the Belastingdienst',
  Spain: 'the Agencia Tributaria',
  Italy: "the Agenzia delle Entrate",
  Sweden: 'Skatteverket',
  Norway: 'Skatteetaten',
  Denmark: 'Skattestyrelsen',
  Poland: 'the KAS',
  Brazil: 'the Receita Federal',
  Mexico: 'the SAT',
  Japan: 'the NTA',
  'South Korea': 'the NTS',
  Philippines: 'the BIR',
  Indonesia: 'the DJP',
  Thailand: 'the Revenue Department',
  Israel: 'the Israel Tax Authority',
  Switzerland: 'your cantonal tax office',
  'United Arab Emirates': 'the FTA',
  China: 'the STA',
  Fiji: 'FRCS',
};

// "Lodge" is Australian and New Zealand usage. Everywhere else files.
const LODGERS = new Set(['Australia', 'New Zealand', 'Fiji']);

export function taxOffice(country) {
  return OFFICES[country] || 'your tax office';
}

// The verb: "lodge your return" or "file your return".
export function fileVerb(country) {
  return LODGERS.has(country) ? 'lodge' : 'file';
}

// The noun for the act: "lodgement" or "filing".
export function filingNoun(country) {
  return LODGERS.has(country) ? 'lodgement' : 'filing';
}

// Capitalised, for a heading or the start of a sentence.
export function FilingNoun(country) {
  const word = filingNoun(country);
  return word.charAt(0).toUpperCase() + word.slice(1);
}
