import test from 'node:test';
import assert from 'node:assert/strict';
import { vehicleClaim, homeOfficeClaim } from './deductions.js';

const RATES = { centsPerKm: 88, kmCap: 5000 };

test('a simple trip log claims kilometres at the rate', () => {
  const { amount, totalKm } = vehicleClaim([{ vehicle: 'Ute', km: 100 }, { vehicle: 'Ute', km: 50 }], RATES);
  assert.equal(totalKm, 150);
  assert.equal(amount, 132); // 150 * 0.88
});

test('the cap applies per vehicle, not to the total', () => {
  // The failure that matters: two cars each at the cap is a legitimate claim of
  // 10,000 km. Summing first and capping once would pay for half of it.
  const trips = [
    { vehicle: 'Ute', km: 5200 },
    { vehicle: 'Van', km: 5300 },
  ];
  const { vehicles, amount } = vehicleClaim(trips, RATES);
  assert.equal(vehicles.length, 2);
  assert.equal(vehicles[0].claimableKm, 5000);
  assert.equal(vehicles[1].claimableKm, 5000);
  assert.equal(amount, 8800); // 10,000 * 0.88
});

test('kilometres over the cap are reported, not silently dropped', () => {
  const { vehicles } = vehicleClaim([{ vehicle: 'Ute', km: 6000 }], RATES);
  assert.equal(vehicles[0].km, 6000);
  assert.equal(vehicles[0].claimableKm, 5000);
  assert.equal(vehicles[0].cappedBy, 1000);
});

test('trips with no vehicle named are grouped, not lost', () => {
  const { vehicles, totalKm } = vehicleClaim([{ km: 10 }, { vehicle: '   ', km: 5 }], RATES);
  assert.equal(vehicles.length, 1);
  assert.equal(totalKm, 15);
});

test('with no rate configured the claim is null rather than zero', () => {
  // Zero would read as "you are owed nothing"; null means "nobody has told us
  // the rate", which is a different thing and has to be said differently.
  const { amount } = vehicleClaim([{ vehicle: 'Ute', km: 100 }], { centsPerKm: null, kmCap: 5000 });
  assert.equal(amount, null);
});

test('with no cap configured nothing is capped', () => {
  const { vehicles } = vehicleClaim([{ vehicle: 'Ute', km: 9000 }], { centsPerKm: 88, kmCap: null });
  assert.equal(vehicles[0].claimableKm, 9000);
  assert.equal(vehicles[0].cappedBy, 0);
});

test('an empty log claims nothing without erroring', () => {
  assert.deepEqual(vehicleClaim([], RATES), { vehicles: [], totalKm: 0, amount: 0 });
  assert.deepEqual(vehicleClaim(null, RATES).vehicles, []);
});

test('home office hours claim at the fixed rate', () => {
  const { hours, amount } = homeOfficeClaim([{ hours: 6 }, { hours: 4.5 }], { perHour: 0.7 });
  assert.equal(hours, 10.5);
  assert.equal(amount, 7.35);
});

test('home office with no rate configured is null, not zero', () => {
  assert.equal(homeOfficeClaim([{ hours: 100 }], { perHour: null }).amount, null);
});

test('home office rounds money to cents', () => {
  const { amount } = homeOfficeClaim([{ hours: 620 }], { perHour: 0.7 });
  assert.equal(amount, 434);
});
