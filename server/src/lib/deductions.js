import pool from '../db.js';

// The deductions that are not expenses: kilometres driven and hours worked at
// home. Both are claimed at a rate that changes every financial year, and both
// have rules that are easy to get quietly wrong.

export const RATE_KEYS = {
  vehicleCentsPerKm: 'vehicle_cents_per_km',
  vehicleKmCap: 'vehicle_km_cap',
  homeOfficePerHour: 'home_office_per_hour',
};

// Every rate configured for a year, as a plain object. Missing is missing —
// there is no fallback, because a wrong rate produces a wrong claim that looks
// exactly like a right one.
export async function ratesFor(financialYear) {
  const [rows] = await pool.execute('SELECT `key`, value FROM tax_rates WHERE financial_year = ?', [financialYear]);
  const out = {};
  for (const row of rows) out[row.key] = Number(row.value);
  return out;
}

// Vehicle claim, per car, capped, then summed.
//
// The cap is per vehicle per year — a household running two cars for work can
// legitimately claim it on each — so trips are grouped by vehicle first and the
// cap applied to each group. Summing the kilometres and capping once would
// silently halve a two-car claim.
export function vehicleClaim(trips, { centsPerKm, kmCap }) {
  const byVehicle = new Map();
  for (const trip of trips || []) {
    const key = (trip.vehicle || 'Vehicle').trim() || 'Vehicle';
    byVehicle.set(key, (byVehicle.get(key) || 0) + Number(trip.km || 0));
  }

  const vehicles = Array.from(byVehicle.entries()).map(([vehicle, km]) => {
    const claimableKm = kmCap ? Math.min(km, kmCap) : km;
    return {
      vehicle,
      km: Math.round(km * 10) / 10,
      claimableKm: Math.round(claimableKm * 10) / 10,
      cappedBy: km > claimableKm ? Math.round((km - claimableKm) * 10) / 10 : 0,
      amount: centsPerKm ? Math.round(claimableKm * centsPerKm) / 100 : null,
    };
  });

  const amount = vehicles.every((v) => v.amount !== null)
    ? Math.round(vehicles.reduce((sum, v) => sum + v.amount, 0) * 100) / 100
    : null;

  return { vehicles, totalKm: Math.round(vehicles.reduce((s, v) => s + v.km, 0) * 10) / 10, amount };
}

// Home office claim: hours at the fixed rate. No cap, but the hours have to
// have been logged as they happened, which is what the table is for.
export function homeOfficeClaim(entries, { perHour }) {
  const hours = (entries || []).reduce((sum, e) => sum + Number(e.hours || 0), 0);
  return {
    hours: Math.round(hours * 100) / 100,
    amount: perHour ? Math.round(hours * perHour * 100) / 100 : null,
  };
}
