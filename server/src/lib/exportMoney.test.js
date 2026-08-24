import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney, currencySymbol, excelMoneyFormat } from './exportMoney.js';

test('groups thousands, which is the whole point', () => {
  assert.equal(formatMoney(3000, 'AUD'), '$3,000.00');
  assert.equal(formatMoney(1234567.89, 'AUD'), '$1,234,567.89');
  assert.equal(formatMoney(999, 'AUD'), '$999.00');
  assert.equal(formatMoney(1000, 'AUD'), '$1,000.00');
});

test('uses the account’s currency, not the server’s idea of one', () => {
  assert.equal(formatMoney(3000, 'GBP'), '£3,000.00');
  assert.equal(formatMoney(3000, 'EUR'), '€3,000.00');
  assert.equal(formatMoney(3000, 'NZD'), '$3,000.00');
});

test('an unknown currency says which one rather than guessing', () => {
  // Better a clear "XYZ 10.00" than a dollar sign on something that is not.
  assert.equal(formatMoney(10, 'XYZ'), 'XYZ 10.00');
  assert.equal(currencySymbol('XYZ'), 'XYZ ');
});

test('falls back to a dollar sign when nothing is given', () => {
  assert.equal(currencySymbol(''), '$');
  assert.equal(currencySymbol(null), '$');
});

test('rounds to cents and keeps them', () => {
  assert.equal(formatMoney(0, 'AUD'), '$0.00');
  assert.equal(formatMoney(0.5, 'AUD'), '$0.50');
  assert.equal(formatMoney(1.006, 'AUD'), '$1.01');
  // A literal like 1.005 is 1.00499… once it is a double, so it rounds down.
  // That is toFixed's behaviour and every other total in this app already
  // agrees with it — matching it beats being cleverer in one place only.
  assert.equal(formatMoney(1.005, 'AUD'), '$1.00');
});

test('a negative is a minus, not brackets', () => {
  assert.equal(formatMoney(-1500, 'AUD'), '-$1,500.00');
});

test('anything that is not a number says so rather than printing NaN', () => {
  assert.equal(formatMoney(null, 'AUD'), '—');
  assert.equal(formatMoney(undefined, 'AUD'), '—');
  assert.equal(formatMoney('not money', 'AUD'), '—');
});

test('the Excel format carries the symbol and the grouping', () => {
  assert.equal(excelMoneyFormat('AUD'), '"$"#,##0.00;-"$"#,##0.00');
  assert.equal(excelMoneyFormat('GBP'), '"£"#,##0.00;-"£"#,##0.00');
});

test('a quote in a symbol cannot break out of the format string', () => {
  assert.ok(!excelMoneyFormat('A"B').includes('""'));
});
